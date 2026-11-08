/**
 * Data Import Engine — cenários com um dublê da API do RD Station v1 (mesmas rotas, parâmetros e paginação da
 * documentação oficial). Nada aqui chega ao RD Station de verdade; os dados são fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { setRdFetchForTests } from '../src/services/importConnectors';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, dir: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const st = Date.now().toString(36);
/** CNPJ fictício válido e único por execução do teste (não colide com outros testes). */
function cnpjOf(seed: number) {
  const b = (String(seed % 1e8).padStart(8, '0') + '0001').split('').map(Number);
  const dv = (arr: number[], w: number[]) => { const r = arr.reduce((a, x, i) => a + x * w[i]!, 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]); const d2 = dv([...b, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...b, d1, d2].join('');
}
const CNPJ = cnpjOf(Date.now());

// ------------------------------------------------------------------ dublê do RD Station
const orgs = [
  { _id: `o1${st}`, id: `o1${st}`, name: `Prefeitura Fictícia ${st}`, organization_custom_fields: [{ custom_field: { label: 'CNPJ' }, value: CNPJ }] },
  { _id: `o2${st}`, id: `o2${st}`, name: `Hospital Fictício ${st}`, organization_custom_fields: [] },
];
const deal = (id: string, org: (typeof orgs)[number], extra: Record<string, unknown>) => ({
  _id: id, id, name: `Negociação ${id}`, amount_total: 1500.5, created_at: '2024-05-02T10:00:00-03:00', organization: { _id: org._id, id: org.id, name: org.name },
  user: { email: 'carlos@yepnet.test' }, deal_stage: { _id: 's1', name: 'Proposta' }, deal_custom_fields: [{ custom_field: { label: 'Modalidade' }, value: 'Pregão' }],
  contacts: [{ _id: `c-${id}`, name: `Contato ${id}`, title: 'Diretor', emails: [{ email: `contato-${id}@exemplo.test` }], phones: [{ phone: '(79) 99999-0000' }] }], ...extra,
});
let deals = [
  deal(`d1${st}`, orgs[0]!, { win: true, closed_at: '2025-01-10T12:00:00-03:00' }),
  deal(`d2${st}`, orgs[0]!, { win: null, closed_at: null }),
  deal(`d3${st}`, orgs[1]!, { win: false, closed_at: '2025-02-01T09:00:00-03:00', deal_lost_reason: { name: 'Preço' } }),
];
const calls: string[] = [];
let failNext: number | null = null;
function fake(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/api/v1', '');
    calls.push(`${path}?${[...url.searchParams].filter(([k]) => k !== 'token').map(([k, v]) => `${k}=${v}`).join('&')}`);
    const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', ...headers } });
    if (url.searchParams.get('token') !== 'token-ficticio-rd-123') return json({ error: 'unauthorized' }, 401);
    if (failNext) { const c = failNext; failNext = null; return json({ error: 'x' }, c, c === 429 ? { 'retry-after': '1' } : {}); }
    const page = Number(url.searchParams.get('page') ?? 1), limit = Number(url.searchParams.get('limit') ?? 20);
    const list = (key: string, items: unknown[]) => json({ total: items.length, has_more: page * limit < items.length, [key]: items.slice((page - 1) * limit, page * limit) });
    if (path === '/users') return list('users', [{ _id: 'u1', name: 'Carlos', email: 'carlos@yepnet.test' }]);
    if (path === '/deal_stages') return list('deal_stages', [{ _id: 's1', name: 'Proposta', deal_pipeline: { name: 'Funil Público' } }]);
    if (path === '/deal_sources') return list('deal_sources', []);
    if (path === '/deal_lost_reasons') return list('deal_lost_reasons', [{ _id: 'l1', name: 'Preço' }]);
    if (path === '/organizations') return list('organizations', orgs);
    const og = /^\/organizations\/(.+)$/.exec(path); if (og) { const o = orgs.find((x) => x._id === og[1]); return o ? json(o) : json({}, 404); }
    if (path === '/deals') {
      let d = deals;
      if (url.searchParams.get('organization')) d = d.filter((x) => x.organization._id === url.searchParams.get('organization'));
      if (url.searchParams.get('deal_stage_id')) d = d.filter((x) => x.deal_stage._id === url.searchParams.get('deal_stage_id'));
      return list('deals', d);
    }
    const dg = /^\/deals\/([^/]+)$/.exec(path); if (dg) { const d = deals.find((x) => x._id === dg[1]); return d ? json(d) : json({}, 404); }
    if (path === '/tasks') { const id = url.searchParams.get('deal_id'); return list('tasks', id === `d1${st}` ? [{ _id: `t1${st}`, subject: 'Enviar proposta', date: '2025-01-05T09:00:00-03:00', done: true, done_date: '2025-01-05T11:00:00-03:00', user: { email: 'carlos@yepnet.test' }, deal_id: id }] : []); }
    if (path === '/activities') { const id = url.searchParams.get('deal_id'); return list('activities', id === `d1${st}` ? [{ _id: `a1${st}`, text: 'Cliente pediu desconto de 5%', date: '2025-01-03T15:00:00-03:00', deal_id: id }] : []); }
    return json({ error: 'rota não existe no dublê' }, 404);
  }) as typeof fetch;
}

beforeAll(async () => {
  ctx = await makeApp();
  setRdFetchForTests(fake());
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
  const email = `dir-imp-${st}@yepnet.test`;
  const u = ok(await carlos.post('/admin/users', { name: 'Diretora Importação', email, profile: 'diretoria', teamIds: [] }), 201).json();
  dir = await login(ctx.app, email, u.temporaryPassword);
});
afterAll(async () => { setRdFetchForTests(null); await ctx.close(); });

/** Roda os passos até a execução terminar (como a tela faz). */
async function runToEnd(c: Client, id: string) {
  for (let i = 0; i < 60; i++) {
    const r = ok(await c.post(`/admin/import/runs/${id}/step`)).json();
    if (['concluida', 'concluida_com_pendencias', 'falhou', 'cancelada', 'pausada'].includes(r.run.status)) return r.run;
    if (r.waiting) await new Promise((res) => setTimeout(res, 1100));
  }
  throw new Error('execução não terminou');
}

let connectorId = '', versionId = '', templateId = '', stageRef = '';
const config = () => ({
  source: 'rdstation_crm', timezone: 'America/Sao_Paulo', execution: { batchSize: 50, largeVolume: 500 },
  tables: [
    { key: 'etapas', label: 'Etapas', refKind: 'etapa', rows: [{ from: 's1', to: stageRef }], fallback: { kind: 'revisar' } },
    { key: 'modalidade', label: 'Modalidade', refKind: 'valor', rows: [{ from: 'Pregão', to: 'licitacao' }], fallback: { kind: 'vazio' } },
  ],
  entities: [
    { source: 'organizations', target: 'conta', enabled: true, legacy: 'preservar', filter: [], policy: { onNew: 'criar', onExisting: 'atualizar', emptyValues: 'manter', matchByKey: 'revisar' }, fields: [
      { id: 'a', target: 'name', kind: 'direta', sources: ['name'], transforms: [{ op: 'trim' }], approved: true },
      { id: 'b', target: 'document', kind: 'direta', sources: ['organization_custom_fields[custom_field.label=CNPJ].value'], transforms: [{ op: 'document' }], approved: true },
      { id: 'c', target: 'segment', kind: 'constante', sources: [], value: 'governamental', transforms: [], approved: true },
    ] },
    { source: 'contacts', target: 'pessoa', enabled: true, legacy: 'preservar', filter: [], policy: { onNew: 'criar', onExisting: 'atualizar', emptyValues: 'manter', matchByKey: 'desligado' }, fields: [
      { id: 'a', target: 'name', kind: 'direta', sources: ['name'], transforms: [], approved: true },
      { id: 'b', target: 'email', kind: 'direta', sources: ['emails[0].email'], transforms: [{ op: 'email' }], approved: true },
      { id: 'c', target: 'phone', kind: 'direta', sources: ['phones[0].phone'], transforms: [{ op: 'phone' }], approved: true },
      { id: 'd', target: 'title', kind: 'direta', sources: ['title'], transforms: [], approved: true },
      { id: 'e', target: 'account', kind: 'direta', sources: ['_ctx.organization_id'], transforms: [], approved: true },
    ] },
    { source: 'deals', target: 'oportunidade', enabled: true, legacy: 'preservar', filter: [], policy: { onNew: 'criar', onExisting: 'atualizar', emptyValues: 'manter', matchByKey: 'revisar' }, fields: [
      { id: 'a', target: 'title', kind: 'direta', sources: ['name'], transforms: [], approved: true },
      { id: 'b', target: 'account', kind: 'direta', sources: ['organization._id'], transforms: [], approved: true },
      { id: 'c', target: 'owner', kind: 'direta', sources: ['user.email'], transforms: [], approved: true },
      { id: 'd', target: 'stage', kind: 'equivalencia', sources: ['deal_stage._id'], table: 'etapas', transforms: [], approved: true },
      { id: 'e', target: 'status', kind: 'condicional', sources: [], rules: [{ when: [{ path: 'win', op: 'true' }], value: 'ganha' }, { when: [{ path: 'win', op: 'false' }], value: 'perdida' }], value: 'aberta', transforms: [], approved: true },
      { id: 'f', target: 'valueCents', kind: 'direta', sources: ['amount_total'], transforms: [{ op: 'cents', decimal: '.', unit: 'reais' }], approved: true },
      { id: 'g', target: 'wonAt', kind: 'direta', sources: ['closed_at'], transforms: [{ op: 'datetime', timezone: 'America/Sao_Paulo' }], approved: true },
      { id: 'h', target: 'lostAt', kind: 'direta', sources: ['closed_at'], transforms: [{ op: 'datetime', timezone: 'America/Sao_Paulo' }], approved: true },
      { id: 'i', target: 'lossReason', kind: 'direta', sources: ['deal_lost_reason.name'], transforms: [], approved: true },
      { id: 'j', target: 'createdAt', kind: 'direta', sources: ['created_at'], transforms: [{ op: 'datetime', timezone: 'America/Sao_Paulo' }], approved: true },
      { id: 'k', target: 'saleKind', kind: 'equivalencia', sources: ['deal_custom_fields[custom_field.label=Modalidade].value'], table: 'modalidade', transforms: [], approved: true },
    ] },
    { source: 'tasks', target: 'tarefa', enabled: true, legacy: 'preservar', filter: [], policy: { onNew: 'criar', onExisting: 'atualizar', emptyValues: 'manter', matchByKey: 'desligado' }, fields: [
      { id: 'a', target: 'title', kind: 'direta', sources: ['subject'], transforms: [], approved: true },
      { id: 'b', target: 'owner', kind: 'direta', sources: ['user.email'], transforms: [], approved: true },
      { id: 'c', target: 'opportunity', kind: 'direta', sources: ['deal_id'], transforms: [], approved: true },
      { id: 'd', target: 'dueAt', kind: 'direta', sources: ['date'], transforms: [{ op: 'datetime', timezone: 'America/Sao_Paulo' }], approved: true },
      { id: 'e', target: 'completedAt', kind: 'direta', sources: ['done_date'], transforms: [{ op: 'datetime', timezone: 'America/Sao_Paulo' }], approved: true },
    ] },
    { source: 'activities', target: 'anotacao', enabled: true, legacy: 'preservar', filter: [], policy: { onNew: 'criar', onExisting: 'atualizar', emptyValues: 'manter', matchByKey: 'desligado' }, fields: [
      { id: 'a', target: 'text', kind: 'direta', sources: ['text'], transforms: [], approved: true },
      { id: 'b', target: 'opportunity', kind: 'direta', sources: ['deal_id'], transforms: [], approved: true },
      { id: 'c', target: 'occurredAt', kind: 'direta', sources: ['date'], transforms: [{ op: 'datetime', timezone: 'America/Sao_Paulo' }], approved: true },
    ] },
  ],
});
const crmCount = async (table: string) => Number(((await ctx.db.execute(sql.raw(`select count(*)::int n from ${table} where source_system = 'rdstation_crm' and external_id like '%${st}%'`))) as unknown as { rows: { n: number }[] }).rows[0]!.n);
const oppCount = async () => Number(((await ctx.db.execute(sql.raw(`select count(*)::int n from opportunities where title like 'Negociação %${st}'`))) as unknown as { rows: { n: number }[] }).rows[0]!.n);

describe('Data Import Engine', () => {
  it('conector: token cifrado, nunca devolvido; teste real da conexão; permissões', async () => {
    expect((await lucas.get('/admin/import/overview')).statusCode).toBe(403);
    expect((await carlos.post('/admin/import/connectors', { kind: 'rdstation_crm', name: `RD ${st}`, token: 'token-ficticio-rd-123' })).statusCode).toBe(403); // gerência não gerencia conectores
    connectorId = ok(await dir.post('/admin/import/connectors', { kind: 'rdstation_crm', name: `RD ${st}`, token: 'token-ficticio-rd-123' }), 201).json().id;
    const list = ok(await carlos.get('/admin/import/connectors')).json();
    const c = list.items.find((x: { id: string }) => x.id === connectorId);
    expect(c).toMatchObject({ hasToken: true, status: 'nao_testado' });
    expect(JSON.stringify(list)).not.toContain('token-ficticio');
    const row = (await ctx.db.execute(sql`select secrets->>'token' t from import_connectors where id = ${connectorId}`)) as unknown as { rows: { t: string }[] };
    expect(row.rows[0]!.t).not.toContain('token-ficticio');
    expect(ok(await dir.post(`/admin/import/connectors/${connectorId}/test`)).json()).toMatchObject({ ok: true });
    stageRef = ok(await carlos.get('/admin/import/schema')).json().refs.etapa[2].id;
  });

  it('descoberta e sugestões a partir de registros reais; nada aprovado sozinho', async () => {
    const d = ok(await carlos.get(`/admin/import/connectors/${connectorId}/discover?entity=deals`)).json();
    expect(d.fields.deals.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(['amount_total', 'deal_custom_fields[custom_field.label=Modalidade].value', 'organization._id']));
    const sug = ok(await carlos.post('/admin/import/templates/suggest', { connectorId })).json();
    const opp = sug.entities.find((e: { target: string }) => e.target === 'oportunidade');
    expect(opp.fields.every((f: { approved: boolean }) => !f.approved)).toBe(true);
    expect(opp.fields.find((f: { target: string }) => f.target === 'status').reason).toMatch(/win/);
    expect(sug.tables.find((t: { key: string }) => t.key === 'etapas').rows).toEqual([{ from: 's1', to: null, label: 'Proposta · Funil Público' }]);
  });

  it('modelo salvo, aprovação por outra pessoa e disponível em nova sessão', async () => {
    const t = ok(await carlos.post('/admin/import/templates', { name: `RD → ISP Sprint | Migração completa ${st}`, connectorId, config: config() }), 201).json();
    templateId = t.id; versionId = t.versionId;
    expect((await carlos.post(`/admin/import/versions/${versionId}/approve`)).statusCode).toBe(403); // gerência não aprova
    ok(await dir.post(`/admin/import/versions/${versionId}/approve`));
    const again = await login(ctx.app, 'carlos@yepnet.test');
    const lib = ok(await again.get('/admin/import/templates')).json();
    expect(lib.items.find((x: { id: string }) => x.id === templateId)).toMatchObject({ current: { number: '1.0' }, versions: 1 });
  });

  it('modo A: uma conta e uma oportunidade — simulação não grava; importação exige simulação e confirmação', async () => {
    const scope = { mode: 'uma_oportunidade', accountId: `o1${st}`, opportunityId: `d1${st}` };
    expect((await dir.post('/admin/import/runs', { mode: 'importacao', connectorId, scope, templateVersionId: versionId, confirm: true })).statusCode).toBe(422);
    const sim = ok(await carlos.post('/admin/import/runs', { mode: 'simulacao', connectorId, scope, templateVersionId: versionId }), 201).json().id;
    const s1 = await runToEnd(carlos, sim);
    expect(s1).toMatchObject({ status: 'concluida', counters: { identificados: 5, criados: 5, erros: 0 } }); // conta, contato, negociação, tarefa, anotação
    expect(await crmCount('contacts')).toBe(0);
    expect(await oppCount()).toBe(0);
    expect(calls.some((c) => c.startsWith(`/deals?`) && c.includes('organization'))).toBe(false); // não buscou as outras oportunidades
    const det = ok(await carlos.get(`/admin/import/runs/${sim}`)).json();
    expect(det.selection.dependencias.map((d: { entity: string }) => d.entity).sort()).toEqual(['activities', 'contacts', 'organizations', 'tasks']);
    expect(det.quality).toMatchObject({ impeditivos: 0, relacionamentos: 100 });
    const recs = ok(await carlos.get(`/admin/import/runs/${sim}/records?entity=oportunidade`)).json();
    expect(recs.items[0]).toMatchObject({ action: 'criar', values: { status: 'ganha', valueCents: 150050, saleKind: 'licitacao', wonAt: '2025-01-10T15:00:00.000Z' }, originals: { valueCents: 1500.5 } });
    expect(recs.items[0].raw.name).toBe(`Negociação d1${st}`);
    expect(recs.items[0].legacy).toHaveProperty('contacts');
    // gerência não executa; diretoria executa com confirmação
    expect((await carlos.post('/admin/import/runs', { mode: 'importacao', connectorId, scope, templateVersionId: versionId, simulationRunId: sim, confirm: true })).statusCode).toBe(403);
    expect((await dir.post('/admin/import/runs', { mode: 'importacao', connectorId, scope, templateVersionId: versionId, simulationRunId: sim })).statusCode).toBe(422);
    const imp = ok(await dir.post('/admin/import/runs', { mode: 'importacao', connectorId, scope, templateVersionId: versionId, simulationRunId: sim, confirm: true }), 201).json().id;
    const r = await runToEnd(dir, imp);
    expect(r).toMatchObject({ status: 'concluida', counters: { criados: 5 } });
    expect(await crmCount('contacts')).toBe(1);
    expect(await oppCount()).toBe(1);
    const opp = ((await ctx.db.execute(sql.raw(`select id, stage, value_cents, sale_kind, won_at from opportunities where title = 'Negociação d1${st}'`))) as unknown as { rows: Record<string, unknown>[] }).rows[0]!;
    expect(opp).toMatchObject({ stage: 'ganha', value_cents: '150050', sale_kind: 'licitacao' });
    const ev = ((await ctx.db.execute(sql.raw(`select type, payload->>'text' t from opportunity_events where opportunity_id = '${opp.id}' order by occurred_at`))) as unknown as { rows: { type: string; t: string | null }[] }).rows;
    expect(ev.map((e) => e.type)).toEqual(['importado', 'nota_importada']);
    const comp = ok(await dir.get(`/admin/import/runs/${imp}`)).json().comparison;
    expect(comp.find((x: { action: string }) => x.action === 'criar')).toEqual({ action: 'criar', simulacao: 5, importacao: 5 });
    // rastreio do registro importado
    const tr = ok(await carlos.get(`/admin/import/trace?entity=oportunidade&targetId=${opp.id}`)).json();
    expect(tr.links[0]).toMatchObject({ source: 'rdstation_crm', sourceId: `d1${st}` });
    expect(tr.history[0].original.name).toBe(`Negociação d1${st}`);
    // versão usada não muda mais
    expect((await carlos.put(`/admin/import/versions/${versionId}`, { config: config(), justification: 'x', rowVersion: 1 })).statusCode).toBe(422);
  });

  it('modo B e repetição: conta inteira sem duplicar; alteração manual vai para revisão', async () => {
    await ctx.db.execute(sql.raw(`update opportunities set title = 'Negociação d1${st}', updated_at = now() + interval '1 minute' where title = 'Negociação d1${st}'`));
    const scope = { mode: 'uma_conta', accountId: `o1${st}` };
    const sim = ok(await carlos.post('/admin/import/runs', { mode: 'simulacao', connectorId, scope, templateVersionId: versionId }), 201).json().id;
    const s = await runToEnd(carlos, sim);
    // conta e contato/tarefa já importados → atualizar; d1 alterado à mão → revisar; d2 e seu contato → criar; anotação já gravada → ignorar
    expect(s.counters).toMatchObject({ criados: 2, revisar: 1, ignorados: 1, erros: 0 });
    const rev = ok(await carlos.get(`/admin/import/runs/${sim}/records?action=revisar`)).json().items[0];
    expect(rev.reason).toMatch(/Alterado manualmente/);
    ok(await carlos.post(`/admin/import/records/${rev.id}/decision`, { decision: 'ignorar' }));
    const imp = ok(await dir.post('/admin/import/runs', { mode: 'importacao', connectorId, scope, templateVersionId: versionId, simulationRunId: sim, confirm: true }), 201).json().id;
    const r = await runToEnd(dir, imp);
    expect(r.counters).toMatchObject({ criados: 2, ignorados: 2, revisar: 0 });
    expect(await oppCount()).toBe(2);
    expect(await crmCount('contacts')).toBe(1);
  });

  it('modo D e alteração temporária: só perdidas, sem mudar o modelo', async () => {
    const scope = { mode: 'personalizado', accountIds: [], opportunityIds: [], ownerIds: [], pipelineIds: [], stageIds: ['s1'], status: ['perdida'], createdFrom: null, createdTo: null, closedFrom: null, closedTo: null, imported: 'nao_importados' };
    const temp = config();
    temp.entities[2]!.fields.find((f) => f.target === 'lossReason')!.transforms = [{ op: 'upper' }];
    const sim = ok(await carlos.post('/admin/import/runs', { mode: 'simulacao', connectorId, scope, templateVersionId: versionId, config: temp }), 201).json().id;
    const s = await runToEnd(carlos, sim);
    expect(s.temporaryChanges).toBe(true);
    const recs = ok(await carlos.get(`/admin/import/runs/${sim}/records?entity=oportunidade`)).json();
    expect(recs.items.map((x: { sourceId: string; values: { lossReason: string } }) => [x.sourceId, x.values.lossReason])).toEqual([[`d3${st}`, 'PREÇO']]);
    const tpl = ok(await carlos.get(`/admin/import/templates/${templateId}`)).json();
    expect(tpl.versions).toHaveLength(1);
    // escopo diferente da simulação não importa
    expect((await dir.post('/admin/import/runs', { mode: 'importacao', connectorId, scope: { mode: 'base_completa' }, templateVersionId: versionId, config: temp, simulationRunId: sim, confirm: true })).statusCode).toBe(422);
  });

  it('modo C, falha da API e retomada: base completa sem duplicar', async () => {
    failNext = 429;
    const sim = ok(await carlos.post('/admin/import/runs', { mode: 'simulacao', connectorId, scope: { mode: 'base_completa' }, templateVersionId: versionId }), 201).json().id;
    ok(await carlos.post(`/admin/import/runs/${sim}/control`, { action: 'pausar' }));
    expect(ok(await carlos.post(`/admin/import/runs/${sim}/step`)).json().run.status).toBe('pausada');
    ok(await carlos.post(`/admin/import/runs/${sim}/control`, { action: 'retomar' }));
    const s = await runToEnd(carlos, sim);
    expect(s.status).toBe('concluida_com_pendencias'); // d1 continua alterado à mão
    expect(s.counters).toMatchObject({ criados: 3, erros: 0 }); // o2, d3 e o contato de d3
    const imp = ok(await dir.post('/admin/import/runs', { mode: 'importacao', connectorId, scope: { mode: 'base_completa' }, templateVersionId: versionId, simulationRunId: sim, confirm: true }), 201).json().id;
    await runToEnd(dir, imp);
    expect(await oppCount()).toBe(3);
    // repetir a base inteira não cria nada
    const again = ok(await carlos.post('/admin/import/runs', { mode: 'simulacao', connectorId, scope: { mode: 'base_completa' }, templateVersionId: versionId }), 201).json().id;
    expect((await runToEnd(carlos, again)).counters.criados).toBe(0);
  });

  it('relacionamento incompleto e equivalência ausente viram erro impeditivo', async () => {
    deals = [...deals, { ...deal(`d4${st}`, orgs[1]!, { win: null }), deal_stage: { _id: 's-nova', name: 'Etapa nova' } }];
    const sim = ok(await carlos.post('/admin/import/runs', { mode: 'simulacao', connectorId, scope: { mode: 'uma_oportunidade', accountId: `o2${st}`, opportunityId: `d4${st}` }, templateVersionId: versionId }), 201).json().id;
    const s = await runToEnd(carlos, sim);
    expect(s.counters.erros).toBeGreaterThan(0);
    const err = ok(await carlos.get(`/admin/import/runs/${sim}/records?action=erro`)).json().items;
    expect(err.map((x: { sourceId: string }) => x.sourceId)).toContain(`d4${st}`);
    expect(JSON.stringify(err)).toMatch(/Sem equivalência em \\"Etapas\\"|Relacionamento incompleto/);
    expect((await dir.post('/admin/import/runs', { mode: 'importacao', connectorId, scope: { mode: 'uma_oportunidade', accountId: `o2${st}`, opportunityId: `d4${st}` }, templateVersionId: versionId, simulationRunId: sim, confirm: true })).statusCode).toBe(422);
  });

  it('nova versão, comparação e token recusado', async () => {
    const c2 = config();
    c2.entities[0]!.fields[2]!.value = 'institucional';
    const v2 = ok(await carlos.post(`/admin/import/templates/${templateId}/versions`, { config: c2, justification: 'Contas do RD entram como institucionais', basedOnVersionId: versionId }), 201).json();
    expect(v2.number).toBe('1.1');
    const diff = ok(await carlos.get(`/admin/import/versions/${v2.id}/compare?with=${versionId}`)).json();
    expect(diff.changes.map((c: { path: string }) => c.path)).toEqual(['organizations→conta · segment']);
    ok(await dir.patch(`/admin/import/connectors/${connectorId}`, { token: 'token-errado-qualquer' }));
    expect(ok(await dir.post(`/admin/import/connectors/${connectorId}/test`)).json()).toMatchObject({ ok: false, detail: expect.stringMatching(/recusado/) });
  });
});
