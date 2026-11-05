/** Filtro de situação das oportunidades: em aberto, venda fechada, perdidas e todas (Kanban e lista). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

type Stage = { key: string; isTerminal: boolean; count: number; cards: { stage: string }[] };
describe('situação das oportunidades', () => {
  it('Kanban mostra as colunas da situação escolhida', async () => {
    const abertas = ok(await carlos.get('/pipeline')).json().stages as Stage[];
    expect(abertas.every((s) => !s.isTerminal)).toBe(true);
    const ganhas = ok(await carlos.get('/pipeline?status=ganhas')).json().stages as Stage[];
    expect(ganhas.map((s) => s.key)).toEqual(['ganha']);
    expect(ganhas[0]!.cards.every((c) => c.stage === 'ganha')).toBe(true);
    const todas = ok(await carlos.get('/pipeline?status=todas')).json().stages as Stage[];
    expect(todas.map((s) => s.key)).toEqual(expect.arrayContaining(['ganha', 'perdida', ...abertas.map((s) => s.key)]));
    expect(todas.find((s) => s.key === 'ganha')!.count).toBe(ganhas[0]!.count);
  });
  it('lista filtra venda fechada e perdidas', async () => {
    const g = ok(await carlos.get('/opportunities?status=ganhas&pageSize=100')).json().items as { stage: string }[];
    expect(g.length).toBeGreaterThan(0);
    expect(g.every((o) => o.stage === 'ganha')).toBe(true);
    const p = ok(await carlos.get('/opportunities?status=perdidas&pageSize=100')).json().items as { stage: string }[];
    expect(p.every((o) => o.stage === 'perdida')).toBe(true);
  });
});
