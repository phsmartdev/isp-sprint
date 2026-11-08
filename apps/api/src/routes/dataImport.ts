/**
 * Data Import Engine — rotas administrativas (Administração → Integrações e Dados). Conectores, biblioteca de modelos
 * versionados, descoberta e sugestões, execuções (simulação obrigatória antes da importação), revisão e rastreio.
 */
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  DEFAULT_EXECUTION, DEFAULT_POLICY, EMPTY_COUNTERS, getPath, IMPORT_SOURCES, RECORD_ACTIONS, TARGET_ENTITIES, configIssues, diffConfigs, discoverFields, importCan, nextImportVersion, qualityOf, suggestMappings,
  type EntityMapping, type FieldMapping, type ImportCap, type ImportConfig, type ImportScope, type QualityInput, type TargetEntity,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import { audit } from '../services/audit';
import { encryptSecret } from '../services/email';
import { ConnectorError, CsvConnector, connectorFor } from '../services/importConnectors';
import { RD_DEAL_ID_COLS, RD_TASK_ID_COLS, isRdDealsExport, isRdTasksExport, rdExportPreset } from '../services/importPresets';
import { enqueue, hashOf, importSchema, stepRun } from '../services/importEngine';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

type Auth = { tenantId: string; userId: string; profiles: string[] };
const need = (auth: Auth, cap: ImportCap) => { if (!importCan(auth.profiles, cap)) throw forbidden('Seu perfil não tem esta permissão no Data Import Engine.'); };
const M = { module: 'configuracoes' as const, min: 'total' as const, tag: 'Data Import Engine' };
const capsOf = (auth: Auth) => Object.fromEntries((['painel', 'conectores', 'modelos', 'aprovar_versao', 'simular', 'executar', 'grande_volume', 'auditoria'] as ImportCap[]).map((c) => [c, importCan(auth.profiles, c)]));

// ------------------------------------------------------------------ validação da configuração (estrutura)
const Cond = z.object({ path: z.string().max(300), op: z.enum(['eq', 'neq', 'contains', 'empty', 'not_empty', 'in', 'true', 'false']), value: z.string().max(500).optional() });
const TransformZ = z.discriminatedUnion('op', [
  z.object({ op: z.literal('trim') }), z.object({ op: z.literal('upper') }), z.object({ op: z.literal('lower') }), z.object({ op: z.literal('digits') }),
  z.object({ op: z.literal('truncate'), max: z.number().int().min(1).max(20000) }), z.object({ op: z.literal('default'), value: z.string().max(500) }),
  z.object({ op: z.literal('null_if'), values: z.array(z.string().max(200)).max(30) }), z.object({ op: z.literal('date'), format: z.enum(['iso', 'dd/mm/yyyy', 'mm/dd/yyyy']) }),
  z.object({ op: z.literal('datetime'), timezone: z.string().max(60) }), z.object({ op: z.literal('cents'), decimal: z.enum([',', '.']), unit: z.enum(['reais', 'centavos']) }),
  z.object({ op: z.literal('number'), decimal: z.enum([',', '.']) }), z.object({ op: z.literal('percent'), decimal: z.enum([',', '.']) }),
  z.object({ op: z.literal('phone') }), z.object({ op: z.literal('document') }), z.object({ op: z.literal('email') }),
  z.object({ op: z.literal('boolean'), trueValues: z.array(z.string().max(50)).max(10) }), z.object({ op: z.literal('equivalence'), table: z.string().max(60) }),
  z.object({ op: z.literal('split_first'), sep: z.string().max(5) }),
]);
const FieldZ = z.object({
  id: z.string().max(60), target: z.string().max(120), kind: z.enum(['direta', 'composicao', 'condicional', 'equivalencia', 'constante']), sources: z.array(z.string().max(300)).max(10),
  template: z.string().max(500).optional(), value: z.string().max(500).optional(), table: z.string().max(60).optional(),
  rules: z.array(z.object({ when: z.array(Cond).max(5), value: z.string().max(500).optional(), path: z.string().max(300).optional() })).max(20).optional(),
  transforms: z.array(TransformZ).max(10), approved: z.boolean(), confidence: z.number().optional(), reason: z.string().max(500).optional(),
});
export const ConfigZ = z.object({
  source: z.enum(IMPORT_SOURCES), timezone: z.string().max(60).default('America/Sao_Paulo'),
  entities: z.array(z.object({
    source: z.string().max(80), target: z.enum(TARGET_ENTITIES), enabled: z.boolean(), fields: z.array(FieldZ).max(80), legacy: z.enum(['preservar', 'descartar']),
    policy: z.object({ onNew: z.enum(['criar', 'ignorar', 'revisar']), onExisting: z.enum(['atualizar', 'ignorar', 'revisar']), emptyValues: z.enum(['manter', 'limpar']), matchByKey: z.enum(['revisar', 'vincular', 'desligado']) }),
    filter: z.array(Cond).max(10),
    keyFrom: z.array(z.string().max(300)).max(6).optional(), altKeyFrom: z.array(z.string().max(300)).max(6).optional(),
  })).max(12),
  tables: z.array(z.object({ key: z.string().min(1).max(60), label: z.string().max(120), refKind: z.enum(['conta', 'pessoa', 'oportunidade', 'tarefa', 'anotacao', 'usuario', 'etapa', 'origem', 'filial', 'valor']), rows: z.array(z.object({ from: z.string().max(300), to: z.string().max(300).nullable(), label: z.string().max(300).optional() })).max(2000), fallback: z.object({ kind: z.enum(['revisar', 'padrao', 'vazio']), value: z.string().max(300).optional() }) })).max(30),
  execution: z.object({ batchSize: z.number().int().min(5).max(200), largeVolume: z.number().int().min(10).max(1_000_000) }),
});
const ScopeZ = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('uma_oportunidade'), accountId: z.string().min(1).max(100), opportunityId: z.string().min(1).max(100) }),
  z.object({ mode: z.literal('uma_conta'), accountId: z.string().min(1).max(100) }),
  z.object({ mode: z.literal('base_completa') }),
  z.object({
    mode: z.literal('personalizado'), accountIds: z.array(z.string().max(100)).max(500).default([]), opportunityIds: z.array(z.string().max(100)).max(500).default([]),
    ownerIds: z.array(z.string().max(100)).max(100).default([]), pipelineIds: z.array(z.string().max(100)).max(100).default([]), stageIds: z.array(z.string().max(100)).max(200).default([]),
    status: z.array(z.enum(['aberta', 'ganha', 'perdida'])).default([]), createdFrom: z.string().nullable().default(null), createdTo: z.string().nullable().default(null),
    closedFrom: z.string().nullable().default(null), closedTo: z.string().nullable().default(null), imported: z.enum(['todos', 'importados', 'nao_importados']).default('todos'),
  }),
]);

async function loadVersion(db: DbOrTx, tenantId: string, id: string) {
  const [v] = await db.select().from(s.importTemplateVersions).where(and(eq(s.importTemplateVersions.id, id), eq(s.importTemplateVersions.tenantId, tenantId))).limit(1);
  if (!v) throw notFound('Versão do modelo não encontrada.');
  return v;
}
async function loadRun(db: DbOrTx, tenantId: string, id: string) {
  const [r] = await db.select().from(s.importRuns).where(and(eq(s.importRuns.id, id), eq(s.importRuns.tenantId, tenantId))).limit(1);
  if (!r) throw notFound('Execução não encontrada.');
  return r;
}
const connErr = (e: unknown) => { if (e instanceof ConnectorError) throw unprocessable(e.message); throw e; };

/** Modelo sugerido a partir de registros reais da origem. Nada vem aprovado: cada correspondência traz motivo e confiança. */
async function suggestConfig(db: DbOrTx, tenantId: string, connectorId: string): Promise<ImportConfig> {
  const { row, connector } = await connectorFor(db as never, tenantId, connectorId);
  const schema = await importSchema(db, tenantId);
  const ents = await connector.entities();
  // exportação de negociações do RD Station enviada como planilha: modelo pronto para ela
  if (row.kind === 'csv' && connector instanceof CsvConnector) {
    const files = await Promise.all(ents.map(async (e) => { const rows = await connector.allRows(e.key); return { entity: e.key, headers: Object.keys(rows[0] ?? {}), rows }; }));
    const preset = await rdExportPreset(db, tenantId, files);
    if (preset) return preset;
  }
  const entities: EntityMapping[] = [];
  const rd = row.kind === 'rdstation_crm';
  for (const e of ents) {
    const target = (e.suggestedTarget ?? null) as TargetEntity | null;
    if (!target) continue;
    const discovered = discoverFields(await connector.sample(e.key, 30));
    const sug = suggestMappings(discovered, schema[target]);
    const fields: FieldMapping[] = sug.map((x, i) => ({ id: `s${i}`, target: x.target, kind: 'direta', sources: [x.source], transforms: [], approved: false, confidence: x.confidence, reason: x.reason }));
    // padrões conhecidos do RD Station (documentados): situação pela coluna win, contexto da negociação para relações
    if (rd && target === 'oportunidade') {
      const rest = fields.filter((f) => f.target !== 'status');
      rest.push({ id: 'rd-status', target: 'status', kind: 'condicional', sources: [], rules: [{ when: [{ path: 'win', op: 'true' }], value: 'ganha' }, { when: [{ path: 'win', op: 'false' }], value: 'perdida' }], value: 'aberta', transforms: [], approved: false, confidence: 0.85, reason: 'No RD Station, win=true é ganha, win=false é perdida e vazio é em aberto' });
      const st = rest.find((f) => f.target === 'stage'); if (st) { st.kind = 'equivalencia'; st.table = 'etapas'; }
      for (const f of rest) if (f.target === 'valueCents') f.transforms = [{ op: 'cents', decimal: '.', unit: 'reais' }];
      for (const f of rest) if (['wonAt', 'lostAt', 'createdAt'].includes(f.target)) f.transforms = [{ op: 'datetime', timezone: 'America/Sao_Paulo' }];
      entities.push({ source: e.key, target, enabled: true, fields: rest, legacy: 'preservar', policy: DEFAULT_POLICY, filter: [] });
      continue;
    }
    if (rd && (target === 'pessoa' || target === 'tarefa' || target === 'anotacao')) {
      const ctxField = (t: string, path: string, why: string) => { const i = fields.findIndex((f) => f.target === t); const m: FieldMapping = { id: `ctx-${t}`, target: t, kind: 'direta', sources: [path], transforms: [], approved: false, confidence: 0.9, reason: why }; if (i >= 0) fields[i] = m; else fields.push(m); };
      if (target === 'pessoa') ctxField('account', '_ctx.organization_id', 'Empresa da negociação de onde o contato veio');
      if (target !== 'pessoa') ctxField('opportunity', '_ctx.deal_id', 'Negociação de onde o registro veio');
      if (target === 'tarefa') ctxField('account', '_ctx.organization_id', 'Empresa da negociação');
    }
    if (target === 'conta') fields.push({ id: 'seg', target: 'segment', kind: 'constante', sources: [], value: 'empresarial', transforms: [], approved: false, confidence: 0.5, reason: 'A origem não tem segmento: escolha o padrão (ou use uma condição)' });
    entities.push({ source: e.key, target, enabled: true, fields, legacy: 'preservar', policy: DEFAULT_POLICY, filter: [] });
  }
  const tables: ImportConfig['tables'] = [];
  if (rd) {
    for (const [key, label, kind, refKind] of [['etapas', 'Etapas do RD → jornada e etapa', 'etapa', 'etapa'], ['usuarios', 'Usuários do RD → usuários', 'usuario', 'usuario'], ['origens', 'Fontes do RD → origens', 'origem', 'origem']] as const) {
      const refs = await connector.references(kind).catch(() => []);
      tables.push({ key, label, refKind, rows: refs.map((r) => ({ from: r.id, to: null, label: [r.label, r.sub].filter(Boolean).join(' · ') })), fallback: { kind: 'revisar' } });
    }
  }
  return { source: row.kind as ImportConfig['source'], timezone: 'America/Sao_Paulo', entities, tables, execution: DEFAULT_EXECUTION };
}

async function runSummary(db: DbOrTx, r: typeof s.importRuns.$inferSelect) {
  const [tpl] = r.templateId ? await db.select({ name: s.importTemplates.name }).from(s.importTemplates).where(eq(s.importTemplates.id, r.templateId)) : [];
  const [ver] = r.templateVersionId ? await db.select({ number: s.importTemplateVersions.number }).from(s.importTemplateVersions).where(eq(s.importTemplateVersions.id, r.templateVersionId)) : [];
  const [by] = r.startedBy ? await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, r.startedBy)) : [];
  return { id: r.id, code: r.code, mode: r.mode, status: r.status, phase: r.phase, counters: r.counters, scope: r.scope, template: tpl?.name ?? null, version: ver?.number ?? null, temporaryChanges: r.temporaryChanges, startedBy: by?.name ?? null, createdAt: r.createdAt, finishedAt: r.finishedAt, warnings: r.warnings, error: r.error, simulationRunId: r.simulationRunId, source: r.source };
}

export const dataImportRoutes = [
  defineRoute({
    method: 'GET', url: '/admin/import/overview', summary: 'Painel do Data Import Engine', ...M,
    handler: async ({ app, auth }) => {
      need(auth, 'painel');
      const T = auth.tenantId;
      const runs = await app.db.select().from(s.importRuns).where(eq(s.importRuns.tenantId, T)).orderBy(desc(s.importRuns.createdAt));
      const imp = runs.filter((r) => r.mode === 'importacao');
      const sum = (k: keyof typeof EMPTY_COUNTERS) => imp.reduce((a, r) => a + (r.counters[k] ?? 0), 0);
      const [tpl] = await app.db.select({ n: count() }).from(s.importTemplates).where(and(eq(s.importTemplates.tenantId, T), isNull(s.importTemplates.archivedAt)));
      return {
        can: capsOf(auth),
        totals: { importacoes: imp.length, andamento: imp.filter((r) => ['na_fila', 'em_andamento', 'pausada'].includes(r.status)).length, concluidas: imp.filter((r) => r.status === 'concluida' || r.status === 'concluida_com_pendencias').length, comErros: imp.filter((r) => r.status === 'falhou' || r.counters.erros > 0).length, simulacoes: runs.length - imp.length, modelos: tpl?.n ?? 0 },
        records: { processados: sum('processados'), criados: sum('criados'), atualizados: sum('atualizados'), ignorados: sum('ignorados'), revisar: sum('revisar'), erros: sum('erros') },
        latest: await Promise.all(runs.slice(0, 10).map((r) => runSummary(app.db, r))),
      };
    },
  }),

  // ---------------------------------------------------------------- conectores
  defineRoute({
    method: 'GET', url: '/admin/import/connectors', summary: 'Conectores (sem segredos)', ...M,
    handler: async ({ app, auth }) => {
      need(auth, 'painel');
      const rows = await app.db.select().from(s.importConnectors).where(eq(s.importConnectors.tenantId, auth.tenantId)).orderBy(asc(s.importConnectors.name));
      const files = await app.db.select({ id: s.importSourceFiles.id, connectorId: s.importSourceFiles.connectorId, entity: s.importSourceFiles.entity, name: s.importSourceFiles.name, idColumn: s.importSourceFiles.idColumn, rows: s.importSourceFiles.rows, createdAt: s.importSourceFiles.createdAt }).from(s.importSourceFiles).where(eq(s.importSourceFiles.tenantId, auth.tenantId));
      return { can: capsOf(auth), items: rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, status: r.status, lastTestAt: r.lastTestAt, lastTestResult: r.lastTestResult, archived: !!r.archivedAt, hasToken: !!r.secrets.token, files: files.filter((f) => f.connectorId === r.id) })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/connectors', summary: 'Cria conector (token cifrado)', ...M,
    body: z.object({ kind: z.enum(IMPORT_SOURCES), name: z.string().trim().min(2).max(120), token: z.string().trim().min(10).max(500).optional() }),
    handler: async ({ app, auth, body, req, reply }) => {
      need(auth, 'conectores');
      if (body.kind === 'rdstation_crm' && !body.token) throw unprocessable('Informe o token do RD Station CRM.');
      const [r] = await app.db.insert(s.importConnectors).values({ tenantId: auth.tenantId, kind: body.kind, name: body.name, secrets: body.token ? { token: encryptSecret(body.token) } : {}, createdBy: auth.userId }).returning({ id: s.importConnectors.id });
      await audit(app.db, req, { action: 'import.connector.create', entityType: 'import_connector', entityId: r!.id, metadata: { kind: body.kind, name: body.name } });
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/admin/import/connectors/:id', summary: 'Renomeia, troca o token ou arquiva', ...M, params: IdParams,
    body: z.object({ name: z.string().trim().min(2).max(120).optional(), token: z.string().trim().min(10).max(500).optional(), archived: z.boolean().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      need(auth, 'conectores');
      const { row } = await connectorFor(app.db, auth.tenantId, params.id).catch((e) => { if (e instanceof ConnectorError && /token/.test(e.message)) return { row: null }; throw e; }) as { row: typeof s.importConnectors.$inferSelect | null };
      const [cur] = row ? [row] : await app.db.select().from(s.importConnectors).where(and(eq(s.importConnectors.id, params.id), eq(s.importConnectors.tenantId, auth.tenantId)));
      if (!cur) throw notFound();
      await app.db.update(s.importConnectors).set({ ...(body.name ? { name: body.name } : {}), ...(body.token ? { secrets: { ...cur.secrets, token: encryptSecret(body.token) }, status: 'nao_testado' } : {}), ...(body.archived !== undefined ? { archivedAt: body.archived ? new Date() : null } : {}), updatedAt: new Date() }).where(eq(s.importConnectors.id, cur.id));
      await audit(app.db, req, { action: 'import.connector.update', entityType: 'import_connector', entityId: cur.id, metadata: { name: body.name, tokenTrocado: !!body.token, archived: body.archived } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/connectors/:id/test', summary: 'Testa a conexão real', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      need(auth, 'conectores');
      const { connector } = await connectorFor(app.db, auth.tenantId, params.id).catch(connErr);
      const r = await connector.test();
      await app.db.update(s.importConnectors).set({ status: r.ok ? 'ok' : 'falhou', lastTestAt: new Date(), lastTestResult: r.detail }).where(eq(s.importConnectors.id, params.id));
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/connectors/:id/files', summary: 'Envia um CSV ao conector (uma entidade por arquivo)', ...M, params: IdParams, bodyLimit: 15_000_000,
    body: z.object({ entity: z.string().trim().min(2).max(60).regex(/^[\w-]+$/, 'Use letras, números, _ ou -'), name: z.string().max(200), idColumn: z.string().max(600).nullable(), content: z.string().min(1).max(14_000_000) }),
    handler: async ({ app, auth, params, body, req }) => {
      need(auth, 'conectores');
      const [c] = await app.db.select().from(s.importConnectors).where(and(eq(s.importConnectors.id, params.id), eq(s.importConnectors.tenantId, auth.tenantId)));
      if (!c || c.kind !== 'csv') throw unprocessable('Arquivos só em conectores CSV.');
      const { parseCsv } = await import('../services/customerImport');
      const rows = parseCsv(body.content);
      if (rows.length < 2) throw unprocessable('O arquivo precisa de cabeçalho e ao menos uma linha.');
      const head = rows[0]!.map((h) => h.trim());
      const missing = (body.idColumn ?? '').split(' + ').map((x) => x.trim()).filter((x) => x && !head.includes(x));
      if (missing.length) throw unprocessable(`Coluna(s) de ID fora do cabeçalho: ${missing.join(', ')}.`);
      await app.db.insert(s.importSourceFiles).values({ tenantId: auth.tenantId, connectorId: c.id, entity: body.entity, name: body.name, idColumn: body.idColumn, content: body.content, rows: rows.length - 1, uploadedBy: auth.userId })
        .onConflictDoUpdate({ target: [s.importSourceFiles.connectorId, s.importSourceFiles.entity], set: { name: body.name, idColumn: body.idColumn, content: body.content, rows: rows.length - 1, uploadedBy: auth.userId, createdAt: new Date() } });
      await audit(app.db, req, { action: 'import.connector.file', entityType: 'import_connector', entityId: c.id, metadata: { entity: body.entity, name: body.name, rows: rows.length - 1 } });
      return { rows: rows.length - 1, columns: rows[0] };
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/import/connectors/:id/discover', summary: 'Descoberta: campos reais da origem (tipo, exemplos, preenchimento)', ...M, params: IdParams,
    query: z.object({ entity: z.string().max(80).optional() }),
    handler: async ({ app, auth, params, query }) => {
      need(auth, 'modelos');
      const { connector } = await connectorFor(app.db, auth.tenantId, params.id).catch(connErr);
      const entities = await connector.entities().catch(connErr);
      const pick = query.entity ? entities.filter((e) => e.key === query.entity) : entities;
      const out: Record<string, ReturnType<typeof discoverFields>> = {};
      for (const e of pick) out[e.key] = discoverFields(await connector.sample(e.key, 30).catch(connErr));
      return { entities, fields: out };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/id-columns', summary: 'Sugere as colunas que identificam cada linha (exportações do RD não trazem ID)', ...M,
    body: z.object({ headers: z.array(z.string().max(200)).max(300) }),
    handler: async ({ auth, body }) => {
      need(auth, 'painel');
      const h = body.headers.map((x) => x.trim());
      if (isRdDealsExport(h)) return { columns: RD_DEAL_ID_COLS.filter((c) => h.includes(c)), kind: 'negociacoes_rd' };
      if (isRdTasksExport(h)) return { columns: RD_TASK_ID_COLS.filter((c) => h.includes(c)), kind: 'tarefas_rd' };
      const id = h.find((x) => /^(id|_id|codigo|código)$/i.test(x));
      return { columns: id ? [id] : [], kind: null };
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/import/connectors/:id/values', summary: 'Valores distintos de um campo (ou composição) da origem, com contagem — para as equivalências', ...M, params: IdParams,
    query: z.object({ entity: z.string().max(80), paths: z.string().max(600), template: z.string().max(200).optional() }),
    handler: async ({ app, auth, params, query }) => {
      need(auth, 'modelos');
      const { connector } = await connectorFor(app.db, auth.tenantId, params.id).catch(connErr);
      const rows = connector instanceof CsvConnector ? await connector.allRows(query.entity) : await connector.sample(query.entity, 200).catch(connErr);
      const paths = query.paths.split(',').map((x) => x.trim()).filter(Boolean);
      const counts = new Map<string, number>();
      for (const r of rows) {
        const parts = paths.map((p) => String(getPath(r, p) ?? '').trim());
        const v = (query.template ?? paths.map((_, i) => `{${i}}`).join(' ')).replace(/\{(\d+)\}/g, (_, i) => parts[Number(i)] ?? '').replace(/\s+/g, ' ').trim();
        if (v && !/^[·|\s-]*$/.test(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return { complete: connector instanceof CsvConnector, items: [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 2000) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/import/connectors/:id/search', summary: 'Pesquisa contas ou oportunidades na origem (para o escopo)', ...M, params: IdParams,
    query: z.object({ kind: z.enum(['conta', 'oportunidade']), q: z.string().max(120).default(''), accountId: z.string().max(100).optional() }),
    handler: async ({ app, auth, params, query }) => {
      need(auth, 'simular');
      const { connector } = await connectorFor(app.db, auth.tenantId, params.id).catch(connErr);
      const items = await connector.search(query.kind, query.q, query.accountId).catch(connErr);
      // marca o que já foi importado
      const links = items.length ? await app.db.select({ id: s.importLinks.sourceId, targetId: s.importLinks.targetId }).from(s.importLinks).where(and(eq(s.importLinks.tenantId, auth.tenantId), eq(s.importLinks.targetEntity, query.kind), inArray(s.importLinks.sourceId, items.map((i) => i.id)))) : [];
      return { items: items.map((i) => ({ ...i, importedAs: links.find((l) => l.id === i.id)?.targetId ?? null })) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/import/connectors/:id/references', summary: 'Valores de referência da origem (usuários, etapas, fontes, motivos)', ...M, params: IdParams,
    query: z.object({ kind: z.enum(['usuario', 'etapa', 'origem', 'motivo']) }),
    handler: async ({ app, auth, params, query }) => {
      need(auth, 'modelos');
      const { connector } = await connectorFor(app.db, auth.tenantId, params.id).catch(connErr);
      return { items: await connector.references(query.kind).catch(connErr) };
    },
  }),

  // ---------------------------------------------------------------- destino
  defineRoute({
    method: 'GET', url: '/admin/import/schema', summary: 'Campos de destino do ISP Sprint e opções das equivalências', ...M,
    handler: async ({ app, auth }) => {
      need(auth, 'painel');
      const T = auth.tenantId;
      const [schema, users, stages, sources, branches] = await Promise.all([
        importSchema(app.db, T),
        app.db.select({ id: s.users.id, label: s.users.name, sub: s.users.email }).from(s.users).where(and(eq(s.users.tenantId, T), eq(s.users.active, true))).orderBy(asc(s.users.name)),
        app.db.select({ p: s.pipelines.id, pn: s.pipelines.name, k: s.pipelineStages.key, n: s.pipelineStages.name }).from(s.pipelineStages).innerJoin(s.pipelines, eq(s.pipelines.id, s.pipelineStages.pipelineId)).where(and(eq(s.pipelines.tenantId, T), eq(s.pipelines.active, true))).orderBy(asc(s.pipelines.position), asc(s.pipelineStages.position)),
        app.db.select({ id: s.leadSources.id, label: s.leadSources.name }).from(s.leadSources).where(eq(s.leadSources.tenantId, T)),
        app.db.select({ id: s.salesBranches.id, label: s.salesBranches.name }).from(s.salesBranches).where(eq(s.salesBranches.tenantId, T)),
      ]);
      return { schema, can: capsOf(auth), refs: { usuario: users, etapa: stages.map((x) => ({ id: `${x.p}:${x.k}`, label: `${x.pn} · ${x.n}` })), origem: sources, filial: branches } };
    },
  }),

  // ---------------------------------------------------------------- modelos
  defineRoute({
    method: 'GET', url: '/admin/import/templates', summary: 'Biblioteca de modelos', ...M,
    query: z.object({ archived: z.enum(['0', '1']).default('0') }),
    handler: async ({ app, auth, query }) => {
      need(auth, 'painel');
      const T = auth.tenantId;
      const tpls = await app.db.select().from(s.importTemplates).where(and(eq(s.importTemplates.tenantId, T), query.archived === '1' ? sql`true` : isNull(s.importTemplates.archivedAt))).orderBy(asc(s.importTemplates.name));
      const vers = tpls.length ? await app.db.select({ id: s.importTemplateVersions.id, templateId: s.importTemplateVersions.templateId, number: s.importTemplateVersions.number, status: s.importTemplateVersions.status, createdAt: s.importTemplateVersions.createdAt, lockedAt: s.importTemplateVersions.lockedAt }).from(s.importTemplateVersions).where(inArray(s.importTemplateVersions.templateId, tpls.map((t) => t.id))).orderBy(desc(s.importTemplateVersions.createdAt)) : [];
      const runs = tpls.length ? await app.db.select({ t: s.importRuns.templateId, n: count(), last: sql<string>`max(${s.importRuns.createdAt})` }).from(s.importRuns).where(inArray(s.importRuns.templateId, tpls.map((t) => t.id))).groupBy(s.importRuns.templateId) : [];
      const conns = await app.db.select({ id: s.importConnectors.id, name: s.importConnectors.name }).from(s.importConnectors).where(eq(s.importConnectors.tenantId, T));
      return {
        can: capsOf(auth),
        items: tpls.map((t) => {
          const vs = vers.filter((v) => v.templateId === t.id);
          const cur = vs.find((v) => v.id === t.currentVersionId) ?? null;
          return { id: t.id, name: t.name, description: t.description, source: t.source, connector: conns.find((c) => c.id === t.connectorId)?.name ?? null, connectorId: t.connectorId, archived: !!t.archivedAt, current: cur && { id: cur.id, number: cur.number }, latest: vs[0] && { id: vs[0].id, number: vs[0].number, status: vs[0].status }, versions: vs.length, runs: runs.find((r) => r.t === t.id)?.n ?? 0, lastRunAt: runs.find((r) => r.t === t.id)?.last ?? null, updatedAt: t.updatedAt };
        }),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/templates/suggest', summary: 'Gera configuração sugerida a partir dos registros reais do conector (nada aprovado)', ...M,
    body: z.object({ connectorId: z.string().uuid() }),
    handler: async ({ app, auth, body }) => { need(auth, 'modelos'); return suggestConfig(app.db, auth.tenantId, body.connectorId).catch(connErr); },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/templates', summary: 'Cria modelo (versão 1.0 em rascunho)', ...M,
    body: z.object({ name: z.string().trim().min(3).max(160), description: z.string().trim().max(1000).nullable().default(null), connectorId: z.string().uuid().nullable(), config: ConfigZ, justification: z.string().trim().min(3).max(1000).default('Mapeamento inicial') }),
    handler: async ({ app, auth, body, req, reply }) => {
      need(auth, 'modelos');
      const [dup] = await app.db.select({ id: s.importTemplates.id }).from(s.importTemplates).where(and(eq(s.importTemplates.tenantId, auth.tenantId), eq(s.importTemplates.name, body.name)));
      if (dup) throw unprocessable('Já existe um modelo com este nome.');
      const out = await app.db.transaction(async (tx) => {
        const [t] = await tx.insert(s.importTemplates).values({ tenantId: auth.tenantId, name: body.name, description: body.description, source: body.config.source, connectorId: body.connectorId, createdBy: auth.userId }).returning();
        const [v] = await tx.insert(s.importTemplateVersions).values({ tenantId: auth.tenantId, templateId: t!.id, number: '1.0', config: body.config as ImportConfig, justification: body.justification, createdBy: auth.userId }).returning();
        await tx.update(s.importTemplates).set({ currentVersionId: v!.id }).where(eq(s.importTemplates.id, t!.id));
        return { id: t!.id, versionId: v!.id };
      });
      await audit(app.db, req, { action: 'import.template.create', entityType: 'import_template', entityId: out.id, metadata: { name: body.name } });
      reply.code(201);
      return out;
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/import/templates/:id', summary: 'Modelo com versões e execuções', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      need(auth, 'painel');
      const [t] = await app.db.select().from(s.importTemplates).where(and(eq(s.importTemplates.id, params.id), eq(s.importTemplates.tenantId, auth.tenantId)));
      if (!t) throw notFound('Modelo não encontrado.');
      const vs = await app.db.select({ v: s.importTemplateVersions, author: s.users.name }).from(s.importTemplateVersions).leftJoin(s.users, eq(s.users.id, s.importTemplateVersions.createdBy)).where(eq(s.importTemplateVersions.templateId, t.id)).orderBy(desc(s.importTemplateVersions.createdAt));
      const approvers = await app.db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, vs.map((x) => x.v.approvedBy).filter((x): x is string => !!x).concat(['00000000-0000-0000-0000-000000000000'])));
      const runs = await app.db.select().from(s.importRuns).where(eq(s.importRuns.templateId, t.id)).orderBy(desc(s.importRuns.createdAt)).limit(30);
      return {
        can: capsOf(auth),
        template: { id: t.id, name: t.name, description: t.description, source: t.source, connectorId: t.connectorId, currentVersionId: t.currentVersionId, archived: !!t.archivedAt, createdAt: t.createdAt },
        versions: vs.map(({ v, author }) => ({ id: v.id, number: v.number, status: v.status, justification: v.justification, author, createdAt: v.createdAt, approvedBy: approvers.find((a) => a.id === v.approvedBy)?.name ?? null, approvedAt: v.approvedAt, locked: !!v.lockedAt, rowVersion: v.rowVersion, config: v.config, mine: v.createdBy === auth.userId })),
        runs: await Promise.all(runs.map((r) => runSummary(app.db, r))),
      };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/admin/import/templates/:id', summary: 'Renomeia, descreve ou arquiva (nunca apaga um modelo usado)', ...M, params: IdParams,
    body: z.object({ name: z.string().trim().min(3).max(160).optional(), description: z.string().trim().max(1000).nullable().optional(), connectorId: z.string().uuid().nullable().optional(), archived: z.boolean().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      need(auth, 'modelos');
      const [t] = await app.db.update(s.importTemplates).set({ ...(body.name ? { name: body.name } : {}), ...(body.description !== undefined ? { description: body.description } : {}), ...(body.connectorId !== undefined ? { connectorId: body.connectorId } : {}), ...(body.archived !== undefined ? { archivedAt: body.archived ? new Date() : null } : {}), updatedAt: new Date() }).where(and(eq(s.importTemplates.id, params.id), eq(s.importTemplates.tenantId, auth.tenantId))).returning({ id: s.importTemplates.id });
      if (!t) throw notFound();
      await audit(app.db, req, { action: 'import.template.update', entityType: 'import_template', entityId: t.id, metadata: body });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/templates/:id/duplicate', summary: 'Duplica o modelo (a partir de uma versão) como novo modelo', ...M, params: IdParams,
    body: z.object({ name: z.string().trim().min(3).max(160), versionId: z.string().uuid().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      need(auth, 'modelos');
      const [t] = await app.db.select().from(s.importTemplates).where(and(eq(s.importTemplates.id, params.id), eq(s.importTemplates.tenantId, auth.tenantId)));
      if (!t) throw notFound();
      const v = await loadVersion(app.db, auth.tenantId, body.versionId ?? t.currentVersionId!);
      const [dup] = await app.db.select({ id: s.importTemplates.id }).from(s.importTemplates).where(and(eq(s.importTemplates.tenantId, auth.tenantId), eq(s.importTemplates.name, body.name)));
      if (dup) throw unprocessable('Já existe um modelo com este nome.');
      const out = await app.db.transaction(async (tx) => {
        const [n] = await tx.insert(s.importTemplates).values({ tenantId: auth.tenantId, name: body.name, description: t.description, source: t.source, connectorId: t.connectorId, createdBy: auth.userId }).returning();
        const [nv] = await tx.insert(s.importTemplateVersions).values({ tenantId: auth.tenantId, templateId: n!.id, number: '1.0', config: v.config, justification: `Duplicado de "${t.name}" v${v.number}`, createdBy: auth.userId, basedOnVersionId: v.id }).returning();
        await tx.update(s.importTemplates).set({ currentVersionId: nv!.id }).where(eq(s.importTemplates.id, n!.id));
        return { id: n!.id, versionId: nv!.id };
      });
      await audit(app.db, req, { action: 'import.template.duplicate', entityType: 'import_template', entityId: out.id, metadata: { from: t.id, version: v.number } });
      reply.code(201);
      return out;
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/templates/:id/versions', summary: 'Nova versão (de uma versão anterior ou de configuração editada); restaurar = nova versão', ...M, params: IdParams,
    body: z.object({ config: ConfigZ, justification: z.string().trim().min(5, 'Explique o que mudou').max(1000), major: z.boolean().default(false), basedOnVersionId: z.string().uuid().nullable().default(null) }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      need(auth, 'modelos');
      const [t] = await app.db.select().from(s.importTemplates).where(and(eq(s.importTemplates.id, params.id), eq(s.importTemplates.tenantId, auth.tenantId)));
      if (!t) throw notFound();
      const [last] = await app.db.select({ number: s.importTemplateVersions.number }).from(s.importTemplateVersions).where(eq(s.importTemplateVersions.templateId, t.id)).orderBy(desc(s.importTemplateVersions.createdAt)).limit(1);
      const number = nextImportVersion(last?.number ?? null, body.major);
      const [v] = await app.db.insert(s.importTemplateVersions).values({ tenantId: auth.tenantId, templateId: t.id, number, config: body.config as ImportConfig, justification: body.justification, basedOnVersionId: body.basedOnVersionId, createdBy: auth.userId }).returning({ id: s.importTemplateVersions.id });
      await app.db.update(s.importTemplates).set({ updatedAt: new Date() }).where(eq(s.importTemplates.id, t.id));
      await audit(app.db, req, { action: 'import.template.version', entityType: 'import_template', entityId: t.id, metadata: { number, justification: body.justification } });
      reply.code(201);
      return { id: v!.id, number };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/admin/import/versions/:id', summary: 'Edita uma versão em rascunho (nunca uma já usada ou aprovada)', ...M, params: IdParams,
    body: z.object({ config: ConfigZ, justification: z.string().trim().min(3).max(1000), rowVersion: z.number().int() }),
    handler: async ({ app, auth, params, body }) => {
      need(auth, 'modelos');
      const v = await loadVersion(app.db, auth.tenantId, params.id);
      if (v.status !== 'rascunho' || v.lockedAt) throw unprocessable('Esta versão já foi aprovada ou usada e não muda mais. Crie uma nova versão.');
      const [u] = await app.db.update(s.importTemplateVersions).set({ config: body.config as ImportConfig, justification: body.justification, rowVersion: v.rowVersion + 1, updatedAt: new Date() }).where(and(eq(s.importTemplateVersions.id, v.id), eq(s.importTemplateVersions.rowVersion, body.rowVersion))).returning({ rowVersion: s.importTemplateVersions.rowVersion });
      if (!u) throw unprocessable('Outra pessoa salvou esta versão antes. Recarregue.');
      return u;
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/versions/:id/approve', summary: 'Aprova a versão (vira a atual do modelo)', ...M, params: IdParams,
    handler: async ({ app, auth, params, req }) => {
      need(auth, 'aprovar_versao');
      const v = await loadVersion(app.db, auth.tenantId, params.id);
      if (v.status !== 'rascunho') throw unprocessable('Só rascunhos são aprovados.');
      if (v.createdBy === auth.userId && !auth.profiles.includes('administrador')) throw forbidden('Quem fez a versão não aprova a própria versão.');
      const issues = configIssues(v.config, await importSchema(app.db, auth.tenantId)).filter((i) => i.level === 'erro');
      if (issues.length) throw unprocessable(`A versão tem erros: ${issues.slice(0, 3).map((i) => i.message).join('; ')}`);
      await app.db.transaction(async (tx) => {
        await tx.update(s.importTemplateVersions).set({ status: 'substituida' }).where(and(eq(s.importTemplateVersions.templateId, v.templateId), eq(s.importTemplateVersions.status, 'aprovada')));
        await tx.update(s.importTemplateVersions).set({ status: 'aprovada', approvedBy: auth.userId, approvedAt: new Date() }).where(eq(s.importTemplateVersions.id, v.id));
        await tx.update(s.importTemplates).set({ currentVersionId: v.id, updatedAt: new Date() }).where(eq(s.importTemplates.id, v.templateId));
      });
      await audit(app.db, req, { action: 'import.template.approve', entityType: 'import_template', entityId: v.templateId, metadata: { version: v.number } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/import/versions/:id/compare', summary: 'Diferenças entre duas versões', ...M, params: IdParams,
    query: z.object({ with: z.string().uuid() }),
    handler: async ({ app, auth, params, query }) => {
      need(auth, 'painel');
      const [a, b] = await Promise.all([loadVersion(app.db, auth.tenantId, query.with), loadVersion(app.db, auth.tenantId, params.id)]);
      return { before: { id: a.id, number: a.number }, after: { id: b.id, number: b.number }, changes: diffConfigs(a.config, b.config) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/check', summary: 'Confere a configuração contra o destino e a origem atuais (compatibilidade)', ...M,
    body: z.object({ config: ConfigZ, connectorId: z.string().uuid().nullable() }),
    handler: async ({ app, auth, body }) => {
      need(auth, 'modelos');
      let sourceFields: Record<string, string[]> | undefined;
      if (body.connectorId) {
        try {
          const { connector } = await connectorFor(app.db, auth.tenantId, body.connectorId);
          sourceFields = {};
          for (const e of body.config.entities.filter((x) => x.enabled)) sourceFields[e.source] = discoverFields(await connector.sample(e.source, 30)).map((f) => f.path);
        } catch { sourceFields = undefined; }
      }
      return { issues: configIssues(body.config as ImportConfig, await importSchema(app.db, auth.tenantId), sourceFields), checkedSource: !!sourceFields };
    },
  }),

  // ---------------------------------------------------------------- execuções
  defineRoute({
    method: 'POST', url: '/admin/import/runs', summary: 'Inicia simulação ou importação', ...M,
    body: z.object({
      mode: z.enum(['simulacao', 'importacao']), connectorId: z.string().uuid(), scope: ScopeZ, templateVersionId: z.string().uuid().nullable().default(null),
      /** configuração alterada só para esta execução (não muda o modelo) */
      config: ConfigZ.nullable().default(null), simulationRunId: z.string().uuid().nullable().default(null), confirm: z.boolean().default(false), acceptErrors: z.boolean().default(false),
    }),
    handler: async ({ app, auth, body, req, reply }) => {
      need(auth, body.mode === 'simulacao' ? 'simular' : 'executar');
      const T = auth.tenantId;
      const version = body.templateVersionId ? await loadVersion(app.db, T, body.templateVersionId) : null;
      const config = (body.config ?? version?.config) as ImportConfig | undefined;
      if (!config) throw unprocessable('Escolha um modelo ou monte uma configuração.');
      const temporary = !!body.config && (!version || hashOf(body.config) !== hashOf(version.config));
      const { row: conn, connector } = await connectorFor(app.db, T, body.connectorId).catch(connErr);
      if (conn.kind !== config.source) throw unprocessable('O conector não é da mesma origem do modelo.');
      const issues = configIssues(config, await importSchema(app.db, T)).filter((i) => i.level === 'erro');
      if (issues.length) throw unprocessable(`Configuração com erros: ${issues.slice(0, 4).map((i) => i.message).join('; ')}`, issues.map((i) => ({ path: i.field, message: i.message })));
      const configHash = hashOf(config), scopeHash = hashOf(body.scope);
      let largeVolumeBy: string | null = null;
      if (body.mode === 'importacao') {
        if (!body.confirm) throw unprocessable('Confirme a gravação definitiva.');
        if (!body.simulationRunId) throw unprocessable('Nenhuma importação sem simulação: rode a simulação antes.');
        const sim = await loadRun(app.db, T, body.simulationRunId);
        if (sim.mode !== 'simulacao' || !['concluida', 'concluida_com_pendencias'].includes(sim.status)) throw unprocessable('A simulação ainda não terminou.');
        if (sim.configHash !== configHash || sim.scopeHash !== scopeHash || sim.connectorId !== body.connectorId) throw unprocessable('A configuração ou o escopo mudaram depois da simulação. Simule de novo.');
        if (sim.counters.erros > 0 && !body.acceptErrors) throw unprocessable(`A simulação tem ${sim.counters.erros} registro(s) com erro impeditivo. Corrija, ou confirme que eles ficam de fora (nunca são gravados).`);
        if (sim.counters.identificados > config.execution.largeVolume) { need(auth, 'grande_volume'); largeVolumeBy = auth.userId; }
        if (version && version.status !== 'aprovada' && !temporary) throw unprocessable('Importe com uma versão aprovada do modelo (ou rode com alterações temporárias registradas).');
      }
      const [run] = await app.db.insert(s.importRuns).values({
        tenantId: T, mode: body.mode, templateId: version?.templateId ?? null, templateVersionId: version?.id ?? null, temporaryChanges: temporary, configSnapshot: config, configHash, connectorId: conn.id, source: conn.kind, scope: body.scope as ImportScope, scopeHash,
        simulationRunId: body.mode === 'importacao' ? body.simulationRunId : null, counters: EMPTY_COUNTERS, startedBy: auth.userId, approvedBy: body.mode === 'importacao' ? auth.userId : null, approvedAt: body.mode === 'importacao' ? new Date() : null, largeVolumeBy,
      }).returning();
      if (version && body.mode === 'importacao') await app.db.update(s.importTemplateVersions).set({ lockedAt: sql`coalesce(${s.importTemplateVersions.lockedAt}, now())` }).where(eq(s.importTemplateVersions.id, version.id));
      if (version && body.mode === 'simulacao' && version.status === 'aprovada') await app.db.update(s.importTemplateVersions).set({ lockedAt: sql`coalesce(${s.importTemplateVersions.lockedAt}, now())` }).where(eq(s.importTemplateVersions.id, version.id));
      await enqueue(app.db, run!.id, connector.initialJobs(body.scope as ImportScope));
      await audit(app.db, req, { action: body.mode === 'importacao' ? 'import.run.execute' : 'import.run.simulate', entityType: 'import_run', entityId: run!.id, metadata: { scope: body.scope, version: version?.number ?? null, temporary, largeVolume: !!largeVolumeBy, acceptErrors: body.acceptErrors } });
      reply.code(201);
      return { id: run!.id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/runs/:id/step', summary: 'Processa um lote (chamado repetidamente pela tela até terminar)', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      const r = await loadRun(app.db, auth.tenantId, params.id);
      need(auth, r.mode === 'simulacao' ? 'simular' : 'executar');
      const res = await stepRun(app.db, auth.tenantId, r.id, auth.userId);
      return { ...res, run: await runSummary(app.db, await loadRun(app.db, auth.tenantId, r.id)) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/runs/:id/control', summary: 'Pausa, retoma, cancela ou refaz as buscas que falharam', ...M, params: IdParams,
    body: z.object({ action: z.enum(['pausar', 'retomar', 'cancelar', 'refazer_falhas']) }),
    handler: async ({ app, auth, params, body, req }) => {
      const r = await loadRun(app.db, auth.tenantId, params.id);
      need(auth, r.mode === 'simulacao' ? 'simular' : 'executar');
      const done = ['cancelada', 'concluida', 'concluida_com_pendencias', 'falhou'].includes(r.status);
      if (body.action === 'pausar') { if (!['na_fila', 'em_andamento'].includes(r.status)) throw unprocessable('Só execuções em andamento pausam.'); await app.db.update(s.importRuns).set({ status: 'pausada' }).where(eq(s.importRuns.id, r.id)); }
      if (body.action === 'retomar') { if (r.status !== 'pausada' && r.status !== 'falhou') throw unprocessable('Só execuções pausadas ou interrompidas retomam.'); await app.db.update(s.importRuns).set({ status: 'em_andamento', error: null, finishedAt: null }).where(eq(s.importRuns.id, r.id)); }
      if (body.action === 'cancelar') { if (done) throw unprocessable('A execução já terminou.'); await app.db.update(s.importRuns).set({ status: 'cancelada', finishedAt: new Date() }).where(eq(s.importRuns.id, r.id)); }
      if (body.action === 'refazer_falhas') {
        const n = await app.db.update(s.importFetchJobs).set({ status: 'pendente', attempts: 0, notBefore: null }).where(and(eq(s.importFetchJobs.runId, r.id), eq(s.importFetchJobs.status, 'falhou'))).returning({ id: s.importFetchJobs.id });
        if (!n.length) throw unprocessable('Nenhuma busca falhou nesta execução.');
        if (r.status === 'cancelada') throw unprocessable('Execução cancelada não retoma.');
        // volta a buscar; o processamento é idempotente (resultado por registro e vínculos não duplicam)
        await app.db.update(s.importRuns).set({ status: 'em_andamento', phase: 'extracao', checkpoint: {}, finishedAt: null, error: null }).where(eq(s.importRuns.id, r.id));
      }
      await audit(app.db, req, { action: `import.run.${body.action}`, entityType: 'import_run', entityId: r.id });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/import/runs', summary: 'Histórico de execuções', ...M,
    query: z.object({ mode: z.enum(['simulacao', 'importacao']).optional(), status: z.string().max(40).optional(), templateId: z.string().uuid().optional() }),
    handler: async ({ app, auth, query }) => {
      need(auth, 'auditoria');
      const rows = await app.db.select().from(s.importRuns).where(and(eq(s.importRuns.tenantId, auth.tenantId), query.mode ? eq(s.importRuns.mode, query.mode) : undefined, query.status ? eq(s.importRuns.status, query.status) : undefined, query.templateId ? eq(s.importRuns.templateId, query.templateId) : undefined)).orderBy(desc(s.importRuns.createdAt)).limit(200);
      return { items: await Promise.all(rows.map((r) => runSummary(app.db, r))) };
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/import/runs/:id', summary: 'Execução: progresso real, indicadores de qualidade, avisos e comparação com a simulação', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      need(auth, 'auditoria');
      const r = await loadRun(app.db, auth.tenantId, params.id);
      const schema = await importSchema(app.db, auth.tenantId);
      const res = await app.db.select({ targetEntity: s.importRecordResults.targetEntity, action: s.importRecordResults.action, values: s.importRecordResults.values, originals: s.importRecordResults.originals, converted: s.importRecordResults.converted, issues: s.importRecordResults.issues, legacy: s.importRecordResults.legacy, duplicate: s.importRecordResults.duplicate }).from(s.importRecordResults).where(eq(s.importRecordResults.runId, r.id));
      const quality = qualityOf(res.map((x): QualityInput => ({ entity: x.targetEntity as TargetEntity, action: x.action as QualityInput['action'], mappedFields: Object.values(x.values).filter((v) => v != null).length, totalTargetFields: schema[x.targetEntity as TargetEntity]?.length ?? 0, converted: x.converted.length, mapped: Object.keys(x.originals).length, issues: x.issues, legacyKeys: Object.keys(x.legacy).length, refErrors: x.issues.filter((i) => i.message.startsWith('Relacionamento')).length, duplicate: x.duplicate })));
      const byEntity: Record<string, Record<string, number>> = {};
      for (const x of res) { const e = (byEntity[x.targetEntity] ??= {}); e[x.action] = (e[x.action] ?? 0) + 1; }
      const jobs = await app.db.select({ status: s.importFetchJobs.status, n: count() }).from(s.importFetchJobs).where(eq(s.importFetchJobs.runId, r.id)).groupBy(s.importFetchJobs.status);
      const failedJobs = await app.db.select({ job: s.importFetchJobs.job, error: s.importFetchJobs.lastError, attempts: s.importFetchJobs.attempts }).from(s.importFetchJobs).where(and(eq(s.importFetchJobs.runId, r.id), eq(s.importFetchJobs.status, 'falhou'))).limit(30);
      const deps = await app.db.select({ reason: s.importRawRecords.reason, entity: s.importRawRecords.entity, n: count() }).from(s.importRawRecords).where(eq(s.importRawRecords.runId, r.id)).groupBy(s.importRawRecords.reason, s.importRawRecords.entity);
      let comparison: { action: string; simulacao: number; importacao: number }[] | null = null;
      if (r.simulationRunId) {
        const sim = await loadRun(app.db, auth.tenantId, r.simulationRunId);
        const k = { criados: 'criar', atualizados: 'atualizar', ignorados: 'ignorar', revisar: 'revisar', erros: 'erro' } as const;
        comparison = Object.entries(k).map(([c, a]) => ({ action: a, simulacao: sim.counters[c as keyof typeof k], importacao: r.counters[c as keyof typeof k] }));
      }
      return {
        run: await runSummary(app.db, r), can: capsOf(auth), config: r.configSnapshot, quality, byEntity, comparison,
        jobs: Object.fromEntries(jobs.map((j) => [j.status, j.n])), failedJobs,
        selection: { selecionados: deps.filter((d) => d.reason.startsWith('selecionado')).reduce((a, d) => a + d.n, 0), dependencias: deps.filter((d) => !d.reason.startsWith('selecionado')).map((d) => ({ entity: d.entity, reason: d.reason, n: d.n })).slice(0, 40) },
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/import/runs/:id/records', summary: 'Registros da execução: original (origem) lado a lado com o transformado', ...M, params: IdParams,
    query: z.object({ action: z.enum(RECORD_ACTIONS).optional(), entity: z.enum(TARGET_ENTITIES).optional(), page: z.coerce.number().int().min(1).default(1), q: z.string().max(100).optional() }),
    handler: async ({ app, auth, params, query }) => {
      need(auth, 'auditoria');
      const r = await loadRun(app.db, auth.tenantId, params.id);
      const where = and(eq(s.importRecordResults.runId, r.id), query.action ? eq(s.importRecordResults.action, query.action) : undefined, query.entity ? eq(s.importRecordResults.targetEntity, query.entity) : undefined, query.q ? sql`(${s.importRecordResults.sourceId} ilike ${`%${query.q}%`} or ${s.importRecordResults.values}::text ilike ${`%${query.q}%`})` : undefined);
      const [tot] = await app.db.select({ n: count() }).from(s.importRecordResults).where(where);
      const rows = await app.db.select({ r: s.importRecordResults, raw: s.importRawRecords.payload, rawReason: s.importRawRecords.reason }).from(s.importRecordResults).innerJoin(s.importRawRecords, eq(s.importRawRecords.id, s.importRecordResults.rawId)).where(where).orderBy(asc(s.importRawRecords.seq)).limit(25).offset((query.page - 1) * 25);
      return { total: tot?.n ?? 0, page: query.page, items: rows.map(({ r: x, raw, rawReason }) => ({ id: x.id, sourceEntity: x.sourceEntity, sourceId: x.sourceId, targetEntity: x.targetEntity, action: x.action, targetId: x.targetId, values: x.values, originals: x.originals, converted: x.converted, issues: x.issues, legacy: x.legacy, reason: x.reason, duplicate: x.duplicate, decision: x.decision, raw, selectedBecause: rawReason })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/records/:id/decision', summary: 'Decisão administrativa de um registro em revisão (vale para a importação desta simulação)', ...M, params: IdParams,
    body: z.object({ decision: z.enum(['importar', 'ignorar', 'vincular', 'atualizar']).nullable() }),
    handler: async ({ app, auth, params, body, req }) => {
      need(auth, 'simular');
      const [x] = await app.db.select({ id: s.importRecordResults.id, runId: s.importRecordResults.runId, action: s.importRecordResults.action }).from(s.importRecordResults).where(and(eq(s.importRecordResults.id, params.id), eq(s.importRecordResults.tenantId, auth.tenantId)));
      if (!x) throw notFound();
      const run = await loadRun(app.db, auth.tenantId, x.runId);
      if (run.mode !== 'simulacao') throw unprocessable('Decisões são tomadas na simulação, antes de importar.');
      if (x.action !== 'revisar' && body.decision !== 'ignorar' && body.decision !== null) throw unprocessable('Só registros em revisão recebem decisão (ou podem ser ignorados).');
      await app.db.update(s.importRecordResults).set({ decision: body.decision, decidedBy: body.decision ? auth.userId : null }).where(eq(s.importRecordResults.id, x.id));
      await audit(app.db, req, { action: 'import.record.decision', entityType: 'import_run', entityId: run.id, metadata: { record: x.id, decision: body.decision } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/admin/import/runs/:id/decisions', summary: 'Decisão em lote para os registros em revisão de uma simulação', ...M, params: IdParams,
    body: z.object({ entity: z.enum(TARGET_ENTITIES), reason: z.string().max(200), decision: z.enum(['importar', 'ignorar', 'vincular', 'atualizar']).nullable() }),
    handler: async ({ app, auth, params, body, req }) => {
      need(auth, 'simular');
      const run = await loadRun(app.db, auth.tenantId, params.id);
      if (run.mode !== 'simulacao') throw unprocessable('Decisões são tomadas na simulação, antes de importar.');
      const r = await app.db.update(s.importRecordResults).set({ decision: body.decision, decidedBy: body.decision ? auth.userId : null }).where(and(eq(s.importRecordResults.runId, run.id), eq(s.importRecordResults.targetEntity, body.entity), eq(s.importRecordResults.action, 'revisar'), eq(s.importRecordResults.reason, body.reason))).returning({ id: s.importRecordResults.id });
      await audit(app.db, req, { action: 'import.record.decision.bulk', entityType: 'import_run', entityId: run.id, metadata: { ...body, count: r.length } });
      return { count: r.length };
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/import/runs/:id/review-groups', summary: 'Registros em revisão agrupados por motivo (para decidir em lote)', ...M, params: IdParams,
    handler: async ({ app, auth, params }) => {
      need(auth, 'auditoria');
      const run = await loadRun(app.db, auth.tenantId, params.id);
      const rows = await app.db.select({ entity: s.importRecordResults.targetEntity, reason: s.importRecordResults.reason, n: count(), decided: sql<number>`count(${s.importRecordResults.decision})::int` }).from(s.importRecordResults).where(and(eq(s.importRecordResults.runId, run.id), eq(s.importRecordResults.action, 'revisar'))).groupBy(s.importRecordResults.targetEntity, s.importRecordResults.reason);
      const bad = await app.db.select({ entity: s.importRecordResults.targetEntity, action: s.importRecordResults.action, issues: s.importRecordResults.issues }).from(s.importRecordResults).where(and(eq(s.importRecordResults.runId, run.id), inArray(s.importRecordResults.action, ['erro', 'revisar'])));
      const group = (level: 'erro' | 'revisao') => {
        const m = new Map<string, number>();
        for (const e of bad) for (const i of e.issues.filter((x) => x.level === level)) { const k = `${e.entity}\u0001${i.message.replace(/"[^"]*"/g, '"…"').slice(0, 160)}`; m.set(k, (m.get(k) ?? 0) + 1); }
        return [...m.entries()].map(([k, n]) => { const [entity, message] = k.split('\u0001'); return { entity, message, n }; }).sort((a, b) => b.n - a.n).slice(0, 30);
      };
      return { review: rows, reviewIssues: group('revisao'), errors: group('erro') };
    },
  }),
  defineRoute({
    method: 'GET', url: '/admin/import/trace', summary: 'Origem de um registro do ISP Sprint: dado original, transformação aplicada e execuções', ...M,
    query: z.object({ entity: z.enum(TARGET_ENTITIES), targetId: z.string().uuid() }),
    handler: async ({ app, auth, query }) => {
      need(auth, 'auditoria');
      const links = await app.db.select().from(s.importLinks).where(and(eq(s.importLinks.tenantId, auth.tenantId), eq(s.importLinks.targetEntity, query.entity), eq(s.importLinks.targetId, query.targetId)));
      const history = links.length ? await app.db.select({ r: s.importRecordResults, raw: s.importRawRecords.payload, code: s.importRuns.code, mode: s.importRuns.mode, at: s.importRuns.createdAt }).from(s.importRecordResults).innerJoin(s.importRawRecords, eq(s.importRawRecords.id, s.importRecordResults.rawId)).innerJoin(s.importRuns, eq(s.importRuns.id, s.importRecordResults.runId))
        .where(and(eq(s.importRecordResults.tenantId, auth.tenantId), eq(s.importRecordResults.targetEntity, query.entity), inArray(s.importRecordResults.sourceId, links.map((l) => l.sourceId)), eq(s.importRuns.mode, 'importacao'))).orderBy(desc(s.importRuns.createdAt)).limit(20) : [];
      return { links: links.map((l) => ({ source: l.source, sourceEntity: l.sourceEntity, sourceId: l.sourceId, legacy: l.legacy, importedAt: l.createdAt, lastWrittenAt: l.lastWrittenAt })), history: history.map((h) => ({ run: h.code, at: h.at, action: h.r.action, original: h.raw, values: h.r.values, originals: h.r.originals, converted: h.r.converted })) };
    },
  }),
];
