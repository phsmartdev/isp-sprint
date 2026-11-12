/** Licitações · L1: projeto automático pela oportunidade (sem duplicar), vários por oportunidade, decisão ao mudar de tipo e modelo versionado. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { BID_DEFAULT_MODEL } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const macros = BID_DEFAULT_MODEL.phases.reduce((a, p) => a + p.macros.length, 0);
const subs = BID_DEFAULT_MODEL.phases.reduce((a, p) => a + p.macros.reduce((b, m) => b + m.tasks.length, 0), 0);

async function newBid(c: Client, extra: Record<string, unknown> = {}) {
  const lk = ok(await c.get('/meta/lookups')).json();
  const p = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
  return ok(await c.post('/opportunities', {
    newContact: { name: `Órgão Projeto ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, segment: 'governamental' }, title: 'PE 12/2026 – Link dedicado', pipelineId: p.id, saleKind: 'licitacao', branchId: lk.branches[0].id,
    custom: { tipo_disputa: 'Aberta', lance_inicial: 1000, lance_minimo: 800, objeto: 'Link dedicado para as unidades', numero_processo: 'PROC 9/2026', orgao_contratante: 'Órgão Fictício' }, ...extra,
  }), 201).json();
}
const countTasks = async (pid: string) => (await ctx.db.execute(sql`select count(*) filter (where parent_id is null)::int as m, count(*) filter (where parent_id is not null)::int as t from activities where project_id = ${pid} and deleted_at is null`)).rows[0] as { m: number; t: number };

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]);
});
afterAll(async () => ctx.close());

describe('projeto de licitação na oportunidade', () => {
  it('nasce com a oportunidade a partir do modelo publicado, sem duplicar; dá para criar outros; coordenador trocável', async () => {
    const o = await newBid(lucas);
    const list = ok(await lucas.get(`/opportunities/${o.id}/licitacao/projetos`)).json().items;
    expect(list).toHaveLength(1);
    const p = list[0];
    expect(p).toMatchObject({ origin: 'auto', coordinatorId: lucas.me.user.id, currentPhase: { name: 'Etapa 1 — Identificação e abertura' }, templateVersion: expect.any(Number) });
    expect(p.areas).toEqual(expect.arrayContaining(['comercial', 'engenharia', 'juridico', 'financeiro']));
    expect(await countTasks(p.id)).toEqual({ m: macros, t: subs });
    const ms = (await ctx.db.execute(sql`select count(*)::int as n from project_milestones where project_id = ${p.id}`)).rows[0] as { n: number };
    expect(ms.n).toBe(11);
    // reprocessar não duplica (alterar a oportunidade, sincronizar de novo)
    const cur = ok(await lucas.get(`/opportunities/${o.id}`)).json();
    ok(await lucas.patch(`/opportunities/${o.id}`, { rowVersion: cur.rowVersion, title: 'PE 12/2026 – Link dedicado (retificado)' }));
    const cur2 = ok(await lucas.get(`/opportunities/${o.id}`)).json();
    ok(await lucas.patch(`/opportunities/${o.id}`, { rowVersion: cur2.rowVersion, saleKind: 'licitacao', title: 'PE 12/2026 – Link dedicado (2ª retificação)' }));
    const autos = (await ctx.db.execute(sql`select count(*)::int as n from projects where opportunity_id = ${o.id} and origin = 'auto'`)).rows[0] as { n: number };
    expect(autos.n).toBe(1);
    // 1:N — outro projeto, à mão
    ok(await lucas.post(`/opportunities/${o.id}/licitacao/projetos`, { name: 'Lote 2 – Telefonia' }), 201);
    expect(ok(await lucas.get(`/opportunities/${o.id}/licitacao/projetos`)).json().items.map((x: { origin: string }) => x.origin)).toEqual(['auto', 'manual']);
    ok(await lucas.put(`/projects/${p.id}/licitacao/coordenador`, { coordinatorId: carlos.me.user.id }));
    expect(ok(await lucas.get(`/opportunities/${o.id}/licitacao/projetos`)).json().items[0].coordinatorId).toBe(carlos.me.user.id);
  });

  it('deixando de ser licitação: o projeto fica, com a decisão de continuar ou arquivar', async () => {
    const o = await newBid(lucas);
    const cur = ok(await lucas.get(`/opportunities/${o.id}`)).json();
    ok(await lucas.patch(`/opportunities/${o.id}`, { rowVersion: cur.rowVersion, saleKind: 'venda_consultiva' }));
    const p = ok(await lucas.get(`/opportunities/${o.id}/licitacao/projetos`)).json().items[0];
    expect(p.attention).toBe('modalidade_alterada');
    ok(await lucas.post(`/projects/${p.id}/licitacao/decisao`, { decision: 'arquivar', note: 'Virou dispensa' }));
    const after = ok(await lucas.get(`/opportunities/${o.id}/licitacao/projetos`)).json().items[0];
    expect(after).toMatchObject({ status: 'cancelado', attention: null });
    expect((await lucas.post(`/projects/${p.id}/licitacao/decisao`, { decision: 'continuar' })).statusCode).toBe(422);
  });
});

describe('modelo versionado', () => {
  it('rascunho → aprovação → publicado; o projeto antigo não muda e o novo usa a nova versão', async () => {
    const o1 = await newBid(lucas);
    const p1 = ok(await lucas.get(`/opportunities/${o1.id}/licitacao/projetos`)).json().items[0];
    const m = ok(await carlos.get('/modelos-projeto/licitacao')).json();
    const pub = m.template.publishedVersion;
    const open = m.versions.find((v: { status: string }) => v.status === 'rascunho' || v.status === 'em_aprovacao');
    if (open) ok(await carlos.post(`/modelos-projeto/licitacao/versoes/${open.version}/descartar`)); // limpa sobra de execução anterior
    const d = ok(await carlos.post('/modelos-projeto/licitacao/versoes', { fromVersion: pub }), 201).json();
    expect((await carlos.post('/modelos-projeto/licitacao/versoes', { fromVersion: pub })).statusCode).toBe(422); // uma em edição por vez
    const def = structuredClone(d.def);
    def.phases[0].macros.push({ key: 'e1_extra', name: 'Visita técnica ao órgão', area: 'engenharia', required: false, offsetDays: 0, durationDays: 1, tasks: [{ key: 'e1_extra_t1', name: 'Agendar visita', required: true }] });
    expect((await lucas.put(`/modelos-projeto/licitacao/versoes/${d.version}`, { def, rowVersion: d.rowVersion })).statusCode).toBe(403);
    const sv = ok(await carlos.put(`/modelos-projeto/licitacao/versoes/${d.version}`, { def, notes: 'Visita técnica', rowVersion: d.rowVersion })).json();
    expect((await carlos.put(`/modelos-projeto/licitacao/versoes/${d.version}`, { def, rowVersion: d.rowVersion })).statusCode).toBe(409); // edição simultânea
    ok(await carlos.post(`/modelos-projeto/licitacao/versoes/${d.version}/enviar`));
    expect((await carlos.put(`/modelos-projeto/licitacao/versoes/${d.version}`, { def, rowVersion: sv.rowVersion })).statusCode).toBe(422); // em aprovação não se edita
    expect((await lucas.post(`/modelos-projeto/licitacao/versoes/${d.version}/decidir`, { approve: true })).statusCode).toBe(403);
    ok(await carlos.post(`/modelos-projeto/licitacao/versoes/${d.version}/decidir`, { approve: false, note: 'Faltou a área' }));
    ok(await carlos.post(`/modelos-projeto/licitacao/versoes/${d.version}/enviar`));
    ok(await carlos.post(`/modelos-projeto/licitacao/versoes/${d.version}/decidir`, { approve: true, note: 'Ok' }));
    const m2 = ok(await carlos.get('/modelos-projeto/licitacao')).json();
    expect(m2.template.publishedVersion).toBe(d.version);
    expect(m2.versions.find((v: { version: number }) => v.version === pub).status).toBe('arquivado');
    // projeto antigo intacto; novo com a macrotarefa a mais
    const before = await countTasks(p1.id);
    const o2 = await newBid(lucas);
    const p2 = ok(await lucas.get(`/opportunities/${o2.id}/licitacao/projetos`)).json().items[0];
    expect(p2.templateVersion).toBe(d.version);
    expect((await countTasks(p2.id)).m).toBe(before.m + 1);
    expect(await countTasks(p1.id)).toEqual(before);
  });
});
