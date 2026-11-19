/** Objetivos estratégicos = KPIs principais; indicadores e metas se ligam a eles. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import * as s from '../src/db/schema';
import { KPI_SHEETS } from '../src/services/kpiDemo';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const st = Date.now().toString(36).slice(-5);
let kpiId = '';
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
  const [t] = await ctx.db.select({ id: s.users.tenantId }).from(s.users).where(eq(s.users.email, 'carlos@yepnet.test')).limit(1);
  const base = KPI_SHEETS[0]!.def;
  const [i] = await ctx.db.insert(s.indicators).values({ tenantId: t!.id, key: `kpi_teste_${st}` }).returning({ id: s.indicators.id });
  await ctx.db.insert(s.indicatorVersions).values({ tenantId: t!.id, indicatorId: i!.id, version: 1, def: { ...base, name: `Win Rate teste ${st}` }, note: 'teste' });
  kpiId = i!.id;
});
afterAll(async () => {
  await ctx.db.update(s.indicators).set({ active: false }).where(eq(s.indicators.id, kpiId)); // não polui o painel dos outros testes
  await carlos.get('/performance/objectives');
  await ctx.close();
});

describe('Objetivos estratégicos a partir dos KPIs', () => {
  it('cada KPI vira um objetivo estratégico, com o placar; estratégico avulso não é mais criado', async () => {
    const r = ok(await carlos.get('/performance/objectives')).json();
    expect(r.kpiDriven).toBe(true);
    const o = r.items.find((x: { kpi: { indicatorId: string } | null }) => x.kpi?.indicatorId === kpiId);
    expect(o).toMatchObject({ title: `Win Rate teste ${st}`, level: 'estrategico', status: 'ativo', kpi: { unit: 'percentual' } });
    expect(o.kpi.board).toHaveProperty('annual');
    // idempotente: não duplica
    const again = ok(await carlos.get('/performance/objectives')).json();
    expect(again.items.filter((x: { kpi: { indicatorId: string } | null }) => x.kpi?.indicatorId === kpiId)).toHaveLength(1);
    // KPIs vêm primeiro
    expect(again.items[0].kpi).not.toBeNull();
    const y = new Date().getFullYear();
    const bad = await carlos.post('/performance/objectives', { title: `Estratégico avulso ${st}`, level: 'estrategico', periodStart: `${y}-01-01`, periodEnd: `${y}-12-31` });
    expect(bad.statusCode).toBe(422);
    // nome segue a ficha
    expect((await carlos.patch(`/performance/objectives/${o.id}`, { rowVersion: o.rowVersion, title: 'Outro nome' })).statusCode).toBe(422);
    // tático ligado ao KPI continua possível
    ok(await carlos.post('/performance/objectives', { title: `Tático ${st}`, level: 'tatico', parentId: o.id, periodStart: `${y}-01-01`, periodEnd: `${y}-12-31` }), 201);
  });

  it('indicador se liga ao objetivo do KPI; a meta herda o objetivo do indicador', async () => {
    const obj = ok(await carlos.get('/performance/objectives')).json().items.find((x: { kpi: { indicatorId: string } | null }) => x.kpi?.indicatorId === kpiId);
    const ind = ok(await carlos.post('/performance/indicators', { def: { name: `Propostas enviadas ${st}`, category: 'comercial', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'proposta_enviada', measure: 'contagem' } } }), 201).json().id;
    expect((await lucas.patch(`/performance/indicators/${ind}`, { objectiveId: obj.id })).statusCode).toBe(403);
    expect((await carlos.patch(`/performance/indicators/${kpiId}`, { objectiveId: obj.id })).statusCode).toBe(422); // o KPI já é o objetivo
    ok(await carlos.patch(`/performance/indicators/${ind}`, { objectiveId: obj.id }));
    const list = ok(await carlos.get('/performance/indicators')).json().items;
    expect(list.find((i: { id: string }) => i.id === ind).objectiveId).toBe(obj.id);
    const o2 = ok(await carlos.get('/performance/objectives')).json().items.find((x: { id: string }) => x.id === obj.id);
    expect(o2.indicators.map((i: { id: string }) => i.id)).toContain(ind);
    const g = ok(await carlos.post('/performance/goals', { title: `Propostas do mês ${st}`, scope: 'empresa', indicatorId: ind, periodType: 'mes', target: 30, consolidation: 'soma' }), 201).json().id;
    const [row] = await ctx.db.select({ objectiveId: s.goals.objectiveId }).from(s.goals).where(eq(s.goals.id, g));
    expect(row!.objectiveId).toBe(obj.id);
    await ctx.db.update(s.goals).set({ status: 'cancelada' }).where(eq(s.goals.id, g)); // não entra no Início dos outros testes
    // desligar
    ok(await carlos.patch(`/performance/indicators/${ind}`, { objectiveId: null }));
    // KPI desativado: o objetivo encerra
    await ctx.db.update(s.indicators).set({ active: false }).where(eq(s.indicators.id, kpiId));
    const o3 = ok(await carlos.get('/performance/objectives')).json().items.find((x: { id: string }) => x.id === obj.id);
    expect(o3.status).toBe('encerrado');
    await ctx.db.update(s.indicators).set({ active: true }).where(eq(s.indicators.id, kpiId));
  });
});
