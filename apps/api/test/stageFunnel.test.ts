/** Bloco 4: dias em cada etapa da negociação e conversão por etapa e do funil. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const today = new Date().toISOString().slice(0, 10);
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
});
afterAll(async () => ctx.close());

describe('tempo por etapa e conversão do funil', () => {
  it('soma as passagens (inclusive concluídas), e a coorte do período entra na conversão', async () => {
    const plan = (await lucas.get('/meta/lookups')).json().plans[0];
    const o = ok(await lucas.post('/opportunities', { newContact: { name: 'Conta Funil Fictícia', segment: 'residencial' }, planId: plan.id }), 201).json();
    const first = ok(await lucas.get(`/opportunities/${o.id}/stage-times`)).json();
    expect(first.stages).toHaveLength(1);
    expect(first.stages[0]).toMatchObject({ visits: 1, current: true });
    const firstKey = first.stages[0].key;
    const move = async (toStage: string) => ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage, confirm: true, reason: 'Teste', rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
    await move('proposta');
    await move(firstKey);
    await move('proposta');
    // recua o histórico: 3 dias na primeira etapa, 2 na proposta, volta 1 dia, proposta desde ontem
    const ev = await ctx.app.db.execute<{ id: string }>(sql`select id from opportunity_events where opportunity_id = ${o.id} and type in ('created','stage_changed','reopened') order by occurred_at`);
    const ago = [7, 4, 2, 1];
    // só no teste: a tabela é append-only; o gatilho é desligado para simular a passagem do tempo
    await ctx.app.db.transaction(async (tx) => {
      await tx.execute(sql`alter table opportunity_events disable trigger user`);
      for (const [i, r] of ev.rows.entries()) await tx.execute(sql`update opportunity_events set occurred_at = now() - (${ago[i]!} || ' days')::interval where id = ${r.id}`);
      await tx.execute(sql`alter table opportunity_events enable trigger user`);
    });
    const t = ok(await lucas.get(`/opportunities/${o.id}/stage-times`)).json().stages;
    expect(t.map((x: { key: string; visits: number; current: boolean }) => [x.key, x.visits, x.current])).toEqual([[firstKey, 2, false], ['proposta', 2, true]]);
    expect(Math.round(t[0].days)).toBe(4); // 3 + 1
    expect(Math.round(t[1].days)).toBe(3); // 2 + 1 (até agora)

    const f = ok(await carlos.get(`/intelligence/stage-funnel?from=${today}&to=${today}`)).json();
    expect(f.pipelines.length).toBeGreaterThan(0);
    expect(f.total).toBeGreaterThanOrEqual(1);
    const row = f.rows.find((r: { key: string }) => r.key === 'proposta');
    expect(row.reached).toBeGreaterThanOrEqual(1);
    expect(row.here).toBeGreaterThanOrEqual(1);
    expect(f.rows[0].reached).toBe(f.total);
    // escopo: outra empresa não vê a oportunidade
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/opportunities/${o.id}/stage-times` })).statusCode).toBe(401);
  });
});
