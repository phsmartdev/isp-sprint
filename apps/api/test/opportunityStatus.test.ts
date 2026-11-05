/** Filtro de situação das oportunidades: em aberto, venda fechada, perdidas e todas (Kanban e lista). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

type Stage = { key: string; isTerminal: boolean; count: number; cards: { stage: string }[] };
describe('situação das oportunidades', () => {
  it('Kanban: fechadas e perdidas aparecem na etapa em que a ação aconteceu', async () => {
    // funil com vendas fechadas (outros testes mexem no funil padrão)
    const [{ pid } = { pid: '' }] = (await ctx.db.execute<{ pid: string }>(sql`select o.pipeline_id pid from opportunities o join users u on u.tenant_id = o.tenant_id where u.email = 'carlos@yepnet.test' and o.stage = 'ganha' and o.deleted_at is null group by 1 order by count(*) desc limit 1`)).rows;
    const abertas = ok(await carlos.get(`/pipeline?pipelineId=${pid}`)).json().stages as Stage[];
    expect(abertas.every((s) => !s.isTerminal)).toBe(true);
    const keys = abertas.map((s) => s.key);
    const ganhas = ok(await carlos.get(`/pipeline?status=ganhas&pipelineId=${pid}`)).json().stages as Stage[];
    expect(ganhas.map((s) => s.key)).toEqual(keys);
    const cards = ganhas.flatMap((s) => s.cards);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.stage === 'ganha')).toBe(true);
    // a coluna de cada venda fechada é a etapa de onde ela saiu (histórico stage_changed → ganha)
    const rows = (await ctx.db.execute<{ id: string; from_value: string | null }>(sql`
      select o.id, (select e.from_value from opportunity_events e where e.opportunity_id = o.id and e.type = 'stage_changed' and e.to_value = 'ganha' order by e.occurred_at desc limit 1) from_value
      from opportunities o where o.pipeline_id = ${pid} and o.stage = 'ganha'`)).rows;
    for (const s of ganhas) for (const c of s.cards as unknown as { id: string }[]) {
      const r = rows.find((x) => x.id === c.id)!;
      expect(s.key).toBe(r.from_value && keys.includes(r.from_value) ? r.from_value : keys.at(-1));
    }
    const todas = ok(await carlos.get(`/pipeline?status=todas&pipelineId=${pid}`)).json().stages as Stage[];
    expect(todas.map((s) => s.key)).toEqual(keys);
    expect(todas.reduce((a, s) => a + s.count, 0)).toBeGreaterThanOrEqual(abertas.reduce((a, s) => a + s.count, 0) + ganhas.reduce((a, s) => a + s.count, 0));
  });
  it('lista filtra venda fechada e perdidas', async () => {
    const g = ok(await carlos.get('/opportunities?status=ganhas&pageSize=100')).json().items as { stage: string }[];
    expect(g.length).toBeGreaterThan(0);
    expect(g.every((o) => o.stage === 'ganha')).toBe(true);
    const p = ok(await carlos.get('/opportunities?status=perdidas&pageSize=100')).json().items as { stage: string }[];
    expect(p.every((o) => o.stage === 'perdida')).toBe(true);
  });
});
