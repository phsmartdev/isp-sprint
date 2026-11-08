/**
 * Data Import Engine — camada de conectores. Cada fonte implementa a mesma interface (buscar, expandir dependências,
 * pesquisar registros para o escopo, listar valores de referência). Trocar ou somar fontes não mexe no resto do motor.
 *
 * RD Station CRM (API v1, documentação oficial): base https://crm.rdstation.com/api/v1, token do usuário no parâmetro
 * "token", listas com page/limit (máx. 200), 120 requisições por minuto e só os 10 mil primeiros registros por filtro.
 * O formato das respostas é lido de forma defensiva: o que chega de verdade fica guardado bruto e a descoberta
 * trabalha sobre os registros reais.
 */
import { and, eq } from 'drizzle-orm';
import type { ImportScope } from '@isp/domain';
import type { DB } from '../db/client';
import * as s from '../db/schema';
import { decryptSecret } from './email';
import { parseCsv } from './customerImport';

export type FetchJob = { kind: 'list' | 'get' | 'file' | 'stages_partition'; entity: string; path?: string; params?: Record<string, string | number>; page?: number; reason?: string; ctx?: Record<string, string>; expand?: boolean; fileId?: string };
export type FetchedRecord = { entity: string; sourceId: string; payload: Record<string, unknown>; reason: string };
export type Fetched = { records: FetchedRecord[]; next: FetchJob[]; warnings: string[] };
export type RefOption = { id: string; label: string; sub?: string };
export type SourceEntityDef = { key: string; label: string; suggestedTarget: string | null };

export class RetryableError extends Error { constructor(msg: string, public retryAfterMs: number) { super(msg); } }
export class ConnectorError extends Error {}

export interface Connector {
  kind: 'rdstation_crm' | 'csv';
  test(): Promise<{ ok: boolean; detail: string }>;
  entities(): Promise<SourceEntityDef[]>;
  initialJobs(scope: ImportScope): FetchJob[];
  run(job: FetchJob): Promise<Fetched>;
  /** Amostra real para a descoberta de campos. */
  sample(entity: string, n: number): Promise<Record<string, unknown>[]>;
  search(kind: 'conta' | 'oportunidade', q: string, accountId?: string): Promise<RefOption[]>;
  references(kind: 'usuario' | 'etapa' | 'origem' | 'motivo'): Promise<RefOption[]>;
}

const idOf = (o: unknown): string | null => {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const v = r.id ?? r._id;
  return v == null ? null : String(v);
};
/** O array de uma resposta de lista: pela chave esperada, ou a única lista do objeto. */
export function arrayOf(json: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[];
    const arrays = Object.values(o).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0] as Record<string, unknown>[];
  }
  return [];
}
const unwrap = (json: unknown, key: string) => (json && typeof json === 'object' && (json as Record<string, unknown>)[key] && typeof (json as Record<string, unknown>)[key] === 'object' && !Array.isArray((json as Record<string, unknown>)[key]) ? (json as Record<string, unknown>)[key] : json) as Record<string, unknown>;

// ------------------------------------------------------------------ RD Station CRM v1
export const RD_BASE = 'https://crm.rdstation.com/api/v1';
export const RD_PAGE = 200;
export const RD_CAP = 10_000;
/** Pode ser trocado nos testes automatizados (dublê da API); em produção é o fetch do Node. */
let rdFetch: typeof fetch = (...a) => fetch(...a);
let lastCall = 0;
let MIN_INTERVAL = 500; // 120 por minuto
export function setRdFetchForTests(f: typeof fetch | null) { rdFetch = f ?? ((...a) => fetch(...a)); MIN_INTERVAL = f ? 0 : 500; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LIST_KEY: Record<string, string> = { organizations: 'organizations', deals: 'deals', contacts: 'contacts', tasks: 'tasks', activities: 'activities', users: 'users', deal_stages: 'deal_stages', deal_pipelines: 'deal_pipelines', deal_sources: 'deal_sources', deal_lost_reasons: 'deal_lost_reasons' };

export class RdStationConnector implements Connector {
  kind = 'rdstation_crm' as const;
  constructor(private token: string) {}

  private async call(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
    const wait = lastCall + MIN_INTERVAL - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const url = new URL(RD_BASE + path);
    url.searchParams.set('token', this.token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    let res: Response;
    try { res = await rdFetch(url.toString(), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }); }
    catch (e) { throw new RetryableError(`Sem resposta do RD Station (${(e as Error).message})`, 5_000); }
    if (res.status === 429) { const ra = Number(res.headers.get('retry-after')); throw new RetryableError('Limite de requisições do RD Station (429)', (Number.isFinite(ra) && ra > 0 ? ra : 30) * 1000); }
    if (res.status >= 500) throw new RetryableError(`RD Station respondeu ${res.status}`, 10_000);
    if (res.status === 401 || res.status === 403) throw new ConnectorError('Token do RD Station recusado (401/403). Confira o token em Conectores.');
    if (res.status === 404) throw new ConnectorError(`Não encontrado no RD Station: ${path}`);
    if (!res.ok) throw new ConnectorError(`RD Station respondeu ${res.status} em ${path}`);
    return res.json();
  }

  async test() {
    try {
      const j = await this.call('/users', { page: 1, limit: 1 });
      const n = arrayOf(j, 'users').length;
      return { ok: true, detail: `Conectado. A API respondeu com ${n ? 'usuários' : 'uma lista vazia de usuários'}.` };
    } catch (e) { return { ok: false, detail: (e as Error).message }; }
  }

  async entities(): Promise<SourceEntityDef[]> {
    return [
      { key: 'organizations', label: 'Empresas', suggestedTarget: 'conta' },
      { key: 'contacts', label: 'Contatos das negociações', suggestedTarget: 'pessoa' },
      { key: 'deals', label: 'Negociações', suggestedTarget: 'oportunidade' },
      { key: 'tasks', label: 'Tarefas', suggestedTarget: 'tarefa' },
      { key: 'activities', label: 'Anotações', suggestedTarget: 'anotacao' },
    ];
  }

  initialJobs(scope: ImportScope): FetchJob[] {
    const deals = (params: Record<string, string | number>, reason = 'selecionado'): FetchJob => ({ kind: 'list', entity: 'deals', path: '/deals', params, page: 1, reason, expand: true });
    switch (scope.mode) {
      case 'uma_oportunidade': return [{ kind: 'get', entity: 'deals', path: `/deals/${scope.opportunityId}`, reason: 'selecionado', expand: true, ctx: { expectedOrg: scope.accountId } }];
      case 'uma_conta': return [{ kind: 'get', entity: 'organizations', path: `/organizations/${scope.accountId}`, reason: 'selecionado' }, deals({ organization: scope.accountId })];
      case 'base_completa': return [{ kind: 'list', entity: 'organizations', path: '/organizations', params: {}, page: 1, reason: 'selecionado' }, { kind: 'stages_partition', entity: 'deals', reason: 'selecionado' }];
      case 'personalizado': {
        const jobs: FetchJob[] = [];
        for (const a of scope.accountIds) jobs.push({ kind: 'get', entity: 'organizations', path: `/organizations/${a}`, reason: 'selecionado' }, deals({ organization: a }));
        for (const o of scope.opportunityIds) jobs.push({ kind: 'get', entity: 'deals', path: `/deals/${o}`, reason: 'selecionado', expand: true });
        if (!scope.accountIds.length && !scope.opportunityIds.length) {
          // filtros documentados da API (responsável, funil, etapa); status e datas são conferidos no registro
          const owners = scope.ownerIds.length ? scope.ownerIds : [null];
          const stages = scope.stageIds.length ? scope.stageIds.map((x) => ({ deal_stage_id: x })) : scope.pipelineIds.length ? scope.pipelineIds.map((x) => ({ deal_pipeline_id: x })) : [{}];
          for (const o of owners) for (const st of stages) jobs.push(deals({ ...(o ? { user_id: o } : {}), ...st }));
        }
        return jobs;
      }
    }
  }

  /** Dependências de uma negociação: empresa, contatos, tarefas e anotações. */
  private expandDeal(d: Record<string, unknown>, dealId: string): FetchJob[] {
    const org = idOf(d.organization) ?? (d.organization_id != null ? String(d.organization_id) : null);
    const why = `dependência da negociação ${dealId}`;
    const jobs: FetchJob[] = [
      { kind: 'list', entity: 'tasks', path: '/tasks', params: { deal_id: dealId }, page: 1, reason: why, ctx: { deal_id: dealId, ...(org ? { organization_id: org } : {}) } },
      { kind: 'list', entity: 'activities', path: '/activities', params: { deal_id: dealId }, page: 1, reason: why, ctx: { deal_id: dealId, ...(org ? { organization_id: org } : {}) } },
    ];
    if (org) jobs.unshift({ kind: 'get', entity: 'organizations', path: `/organizations/${org}`, reason: why });
    // contatos: vêm na própria negociação quando existem; senão, pela rota de contatos da negociação
    if (!Array.isArray(d.contacts)) jobs.push({ kind: 'list', entity: 'contacts', path: `/deals/${dealId}/contacts`, params: {}, page: 1, reason: why, ctx: { deal_id: dealId, ...(org ? { organization_id: org } : {}) } });
    return jobs;
  }
  private contactsOf(d: Record<string, unknown>, dealId: string, org: string | null): FetchedRecord[] {
    if (!Array.isArray(d.contacts)) return [];
    return (d.contacts as Record<string, unknown>[]).map((c, i) => ({ entity: 'contacts', sourceId: idOf(c) ?? `${dealId}#${i}`, payload: { ...c, _ctx: { deal_id: dealId, organization_id: org } }, reason: `dependência da negociação ${dealId}` }));
  }

  async run(job: FetchJob): Promise<Fetched> {
    const warnings: string[] = [];
    if (job.kind === 'stages_partition') {
      // Base completa: a API só lista 10 mil por filtro, então as negociações são buscadas etapa por etapa.
      const st = arrayOf(await this.call('/deal_stages', { limit: RD_PAGE }), 'deal_stages');
      const ids = st.map(idOf).filter((x): x is string => !!x);
      if (!ids.length) return { records: [], next: [{ kind: 'list', entity: 'deals', path: '/deals', params: {}, page: 1, reason: job.reason, expand: true }], warnings: ['Sem etapas na resposta: negociações buscadas numa lista única (limite de 10 mil da API).'] };
      return { records: [], next: ids.map((id) => ({ kind: 'list' as const, entity: 'deals', path: '/deals', params: { deal_stage_id: id }, page: 1, reason: job.reason, expand: true })), warnings };
    }
    if (job.kind === 'get') {
      const raw = await this.call(job.path!);
      const key = job.entity === 'deals' ? 'deal' : job.entity === 'organizations' ? 'organization' : job.entity;
      const rec = unwrap(raw, key);
      const id = idOf(rec);
      if (!id) throw new ConnectorError(`Resposta sem ID em ${job.path}`);
      const records: FetchedRecord[] = [{ entity: job.entity, sourceId: id, payload: { ...rec, ...(job.ctx ? { _ctx: job.ctx } : {}) }, reason: job.reason ?? 'selecionado' }];
      let next: FetchJob[] = [];
      if (job.entity === 'deals' && job.expand) {
        const org = idOf(rec.organization);
        if (job.ctx?.expectedOrg && org && org !== job.ctx.expectedOrg) warnings.push(`A negociação ${id} pertence a outra empresa (${org}) e não à escolhida (${job.ctx.expectedOrg}).`);
        records.push(...this.contactsOf(rec, id, org));
        next = this.expandDeal(rec, id);
      }
      return { records, next, warnings };
    }
    // list
    const page = job.page ?? 1;
    const params = { ...(job.params ?? {}), page, limit: RD_PAGE };
    const raw = await this.call(job.path!, params);
    const items = arrayOf(raw, LIST_KEY[job.entity] ?? job.entity);
    const records: FetchedRecord[] = [];
    const next: FetchJob[] = [];
    for (const it of items) {
      const id = idOf(it) ?? (job.entity === 'contacts' && job.ctx?.deal_id ? `${job.ctx.deal_id}#${records.length}` : null);
      if (!id) { warnings.push(`Registro sem ID em ${job.path} (página ${page}) ignorado.`); continue; }
      records.push({ entity: job.entity, sourceId: id, payload: { ...it, ...(job.ctx ? { _ctx: job.ctx } : {}) }, reason: job.reason ?? 'selecionado' });
      if (job.entity === 'deals' && job.expand) { const org = idOf(it.organization); records.push(...this.contactsOf(it, id, org)); next.push(...this.expandDeal(it, id)); }
    }
    const hasMore = raw && typeof raw === 'object' && 'has_more' in (raw as object) ? Boolean((raw as Record<string, unknown>).has_more) : items.length >= RD_PAGE;
    if (hasMore) {
      if (page * RD_PAGE >= RD_CAP) warnings.push(`A API do RD Station lista só os 10 mil primeiros registros de ${job.path} ${JSON.stringify(job.params ?? {})}. Divida o escopo (responsável, funil, etapa) ou complemente com a exportação oficial.`);
      else next.push({ ...job, page: page + 1 });
    }
    return { records, next, warnings };
  }

  async sample(entity: string, n: number) {
    if (entity === 'contacts' || entity === 'tasks' || entity === 'activities') {
      const deals = arrayOf(await this.call('/deals', { page: 1, limit: 5 }), 'deals');
      const out: Record<string, unknown>[] = [];
      for (const d of deals) {
        const id = idOf(d)!;
        if (entity === 'contacts') out.push(...(Array.isArray(d.contacts) ? (d.contacts as Record<string, unknown>[]) : arrayOf(await this.call(`/deals/${id}/contacts`), 'contacts')).map((c) => ({ ...c, _ctx: { deal_id: id, organization_id: idOf(d.organization) } })));
        else out.push(...arrayOf(await this.call(`/${entity}`, { deal_id: id, limit: 5 }), entity).map((x) => ({ ...x, _ctx: { deal_id: id, organization_id: idOf(d.organization) } })));
        if (out.length >= n) break;
      }
      return out.slice(0, n);
    }
    return arrayOf(await this.call(`/${entity}`, { page: 1, limit: Math.min(n, RD_PAGE) }), LIST_KEY[entity] ?? entity).slice(0, n);
  }

  async search(kind: 'conta' | 'oportunidade', q: string, accountId?: string) {
    if (kind === 'conta') return arrayOf(await this.call('/organizations', { page: 1, limit: 20, ...(q ? { q } : {}) }), 'organizations').map((o) => ({ id: idOf(o)!, label: String(o.name ?? idOf(o)) }));
    const params: Record<string, string | number> = { page: 1, limit: 50, ...(accountId ? { organization: accountId } : {}), ...(q ? { name: q } : {}) };
    return arrayOf(await this.call('/deals', params), 'deals').map((d) => ({ id: idOf(d)!, label: String(d.name ?? idOf(d)), sub: [d.deal_stage && (d.deal_stage as Record<string, unknown>).name, d.win === true ? 'ganha' : d.win === false ? 'perdida' : null].filter(Boolean).join(' · ') }));
  }

  async references(kind: 'usuario' | 'etapa' | 'origem' | 'motivo') {
    const path = { usuario: '/users', etapa: '/deal_stages', origem: '/deal_sources', motivo: '/deal_lost_reasons' }[kind];
    const key = path.slice(1);
    const all: RefOption[] = [];
    for (let page = 1; page <= 10; page++) {
      const raw = await this.call(path, { page, limit: RD_PAGE });
      const items = arrayOf(raw, key);
      all.push(...items.map((x) => ({ id: idOf(x) ?? String(x.name), label: String(x.name ?? x.email ?? idOf(x)), sub: kind === 'usuario' ? String(x.email ?? '') : kind === 'etapa' ? String((x.deal_pipeline as Record<string, unknown> | undefined)?.name ?? '') : undefined })));
      if (items.length < RD_PAGE) break;
    }
    return all;
  }
}

// ------------------------------------------------------------------ CSV (arquivos enviados ao conector)
export class CsvConnector implements Connector {
  kind = 'csv' as const;
  constructor(private db: DB, private tenantId: string, private connectorId: string) {}
  private files() { return this.db.select().from(s.importSourceFiles).where(and(eq(s.importSourceFiles.tenantId, this.tenantId), eq(s.importSourceFiles.connectorId, this.connectorId))); }
  private static rowsOf(content: string) {
    const rows = parseCsv(content);
    const [head, ...body] = rows;
    if (!head) return [];
    return body.filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
  }
  async test() { const f = await this.files(); return f.length ? { ok: true, detail: `${f.length} arquivo(s): ${f.map((x) => `${x.entity} (${x.rows} linhas)`).join(', ')}` } : { ok: false, detail: 'Envie ao menos um arquivo CSV.' }; }
  async entities() { return (await this.files()).map((f) => ({ key: f.entity, label: `${f.entity} (${f.name})`, suggestedTarget: null })); }
  initialJobs(scope: ImportScope): FetchJob[] {
    const only = scope.mode === 'personalizado' ? [...scope.accountIds, ...scope.opportunityIds] : scope.mode === 'uma_conta' ? [scope.accountId] : scope.mode === 'uma_oportunidade' ? [scope.accountId, scope.opportunityId] : [];
    return [{ kind: 'file', entity: '*', reason: 'selecionado', ctx: only.length ? { only: only.join('\u0001') } : undefined }];
  }
  async run(job: FetchJob): Promise<Fetched> {
    const files = await this.files();
    if (job.entity === '*') return { records: [], next: files.map((f) => ({ kind: 'file' as const, entity: f.entity, fileId: f.id, reason: job.reason, ctx: job.ctx })), warnings: [] };
    const f = files.find((x) => x.id === job.fileId);
    if (!f) throw new ConnectorError(`Arquivo ${job.entity} não está mais no conector.`);
    const only = job.ctx?.only ? new Set(job.ctx.only.split('\u0001')) : null;
    const records: FetchedRecord[] = [];
    const idCols = CsvConnector.idCols(f.idColumn);
    const seen = new Map<string, number>();
    let dups = 0;
    CsvConnector.rowsOf(f.content).forEach((r, i) => {
      const id = CsvConnector.idOfRow(r, idCols, i);
      if (seen.has(id)) { dups += 1; return; }
      seen.set(id, i);
      if (only && !only.has(id) && !Object.values(r).some((v) => only.has(v.trim()))) return;
      records.push({ entity: f.entity, sourceId: id, payload: r, reason: only ? 'selecionado (ou ligado a um ID escolhido)' : 'selecionado' });
    });
    const warnings: string[] = [];
    if (!idCols.length) warnings.push(`${f.name}: sem coluna de ID; a linha do arquivo vira o ID (reimportar outro arquivo pode duplicar).`);
    if (dups) warnings.push(`${f.name} (${f.entity}): ${dups} linha(s) com o mesmo ID de outra linha (${idCols.join(' + ')}); só a primeira entrou.`);
    return { records, next: [], warnings };
  }
  /** ID da linha: uma coluna, ou várias juntas ("Nome + Empresa + Data de criação"). */
  static idCols(idColumn: string | null) { return idColumn ? idColumn.split(' + ').map((x) => x.trim()).filter(Boolean) : []; }
  static idOfRow(r: Record<string, string>, cols: string[], i: number) {
    if (!cols.length) return `linha-${i + 2}`;
    const parts = cols.map((c) => (r[c] ?? '').trim());
    return parts.every((p) => !p) ? `linha-${i + 2}` : parts.join(' | ');
  }
  async sample(entity: string, n: number) { const f = (await this.files()).find((x) => x.entity === entity); return f ? CsvConnector.rowsOf(f.content).slice(0, n) : []; }
  /** Todas as linhas de uma aba (para listar os valores distintos de uma coluna nas equivalências). */
  async allRows(entity: string) { const f = (await this.files()).find((x) => x.entity === entity); return f ? CsvConnector.rowsOf(f.content) : []; }
  async search(_k: 'conta' | 'oportunidade', q: string) {
    const out: RefOption[] = [];
    for (const f of await this.files()) for (const [i, r] of CsvConnector.rowsOf(f.content).entries()) {
      const id = CsvConnector.idOfRow(r, CsvConnector.idCols(f.idColumn), i);
      const label = Object.values(r).slice(0, 3).join(' · ');
      if (!q || label.toLowerCase().includes(q.toLowerCase())) out.push({ id, label, sub: f.entity });
      if (out.length >= 30) return out;
    }
    return out;
  }
  async references() { return []; }
}

export async function connectorFor(db: DB, tenantId: string, connectorId: string): Promise<{ row: typeof s.importConnectors.$inferSelect; connector: Connector }> {
  const [row] = await db.select().from(s.importConnectors).where(and(eq(s.importConnectors.id, connectorId), eq(s.importConnectors.tenantId, tenantId))).limit(1);
  if (!row) throw new ConnectorError('Conector não encontrado.');
  if (row.kind === 'rdstation_crm') {
    const token = row.secrets.token ? decryptSecret(row.secrets.token) : null;
    if (!token) throw new ConnectorError('Cadastre o token do RD Station no conector.');
    return { row, connector: new RdStationConnector(token) };
  }
  return { row, connector: new CsvConnector(db, tenantId, row.id) };
}
