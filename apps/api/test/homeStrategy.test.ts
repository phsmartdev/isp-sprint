/** Início estratégico: a parte de cada pessoa na meta da empresa do planejamento, por número do Início. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const st = Date.now().toString(36).slice(-5);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
});
afterAll(async () => { await ctx.close(); });

describe('Início: contribuição para o planejamento estratégico', () => {
  it('sem meta da empresa ligada, não inventa número; com meta, mostra a parte da pessoa e o atingimento da empresa', async () => {
    const h0 = ok(await lucas.get('/home')).json();
    expect(Object.keys(h0.strategy).sort()).toEqual(['abertas', 'atividades_hoje', 'propostas', 'valor']);
    const start = `${today().slice(0, 7)}-01`;
    // com KPIs principais, os objetivos estratégicos são eles; sem KPIs, cria-se um estratégico
    const objs = ok(await carlos.get('/performance/objectives')).json();
    const kpiObj = objs.items.find((o: { kpi: unknown; status: string }) => o.kpi && o.status === 'ativo');
    const obj = kpiObj?.id ?? ok(await carlos.post('/performance/objectives', { title: `Crescer a base ${st}`, level: 'estrategico', periodStart: start, periodEnd: `${today().slice(0, 4)}-12-31` }), 201).json().id;
    const ind = ok(await carlos.post('/performance/indicators', { def: { name: `Tarefas concluídas ${st}`, category: 'tarefas', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'tarefa_concluida', measure: 'contagem' } } }), 201).json().id;
    // percentual não é somável: não serve para "a sua parte"
    const pct = ok(await carlos.post('/performance/indicators', { def: { name: `Propostas % ${st}`, category: 'comercial', calc: 'percentual', unit: 'percentual', direction: 'maior', period: 'mes', numerator: { event: 'proposta_enviada', measure: 'contagem' }, denominator: { event: 'oportunidade_criada', measure: 'contagem' } } }), 201).json().id;
    const g = ok(await carlos.post('/performance/goals', { title: `Tarefas da empresa ${st}`, scope: 'empresa', indicatorId: ind, periodType: 'mes', target: 400, objectiveId: obj, consolidation: 'soma' }), 201).json().id;
    ok(await carlos.post('/performance/goals', { title: `Conversão em proposta ${st}`, scope: 'empresa', indicatorId: pct, periodType: 'mes', target: 50, objectiveId: obj }), 201);
    // Lucas conclui uma atividade: entra na parte dele
    const act = ok(await lucas.post('/activities', { type: 'tarefa', title: `Ligar para cliente ${st}`, dueAt: new Date().toISOString() }), 201).json();
    ok(await lucas.patch(`/activities/${act.id}`, { rowVersion: act.rowVersion, completed: true }));
    await ctx.db.execute(sql`update business_event_sync set last_run_at = now() - interval '1 hour'`); // o projetor roda no máximo 1x por minuto
    const h = ok(await lucas.get('/home')).json();
    const a = h.strategy.atividades_hoje;
    expect(a).toMatchObject({ goalId: g, objective: { id: obj, level: 'estrategico' }, target: 400, unit: 'quantidade' });
    expect(a.mine).toBeGreaterThanOrEqual(1);
    expect(a.share).toBe(Math.round((a.mine / 400) * 1000) / 10);
    expect(a.company.value).toBeGreaterThanOrEqual(a.mine);
    expect(h.strategy.propostas).toBeNull(); // só havia meta percentual de propostas
  });
});
