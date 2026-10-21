/** Marketing → ABM sobre contas existentes e catálogo de produtos. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, rafael] = (await Promise.all(['carlos', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
});
afterAll(async () => ctx.close());

describe('ABM', () => {
  it('marca conta da carteira como alvo, sem duplicar; histórico; escopo do responsável', async () => {
    const [c] = (await ctx.db.execute(sql`select c.id from contacts c join users u on u.id = c.owner_id where u.email = 'lucas@yepnet.test' and c.deleted_at is null limit 1`)).rows as { id: string }[];
    const id = ok(await lucas.post('/abm', { contactId: c!.id, tier: '1_1', priority: 'alta', reason: 'Rede de clínicas com 12 unidades na região' }), 201).json().id;
    expect((await lucas.post('/abm', { contactId: c!.id, reason: 'De novo a mesma conta' })).statusCode).toBe(422);
    const l = ok(await lucas.get('/abm')).json();
    expect(l.items.find((x: { id: string }) => x.id === id)).toMatchObject({ tier: '1_1', status: 'identificada' });
    expect(l.counts.identificada).toBeGreaterThanOrEqual(1);
    const a = ok(await lucas.get(`/abm/${id}`)).json();
    ok(await lucas.patch(`/abm/${id}`, { rowVersion: a.rowVersion, status: 'engajando', nextStep: 'Reunião com a diretoria', nextStepOn: '2026-11-05' }));
    const d = ok(await lucas.get(`/abm/${id}`)).json();
    expect(d.events[0]).toMatchObject({ type: 'situacao' });
    expect((await rafael.get(`/abm/${id}`)).statusCode).toBe(404);
    expect(ok(await carlos.get('/abm')).json().items.map((x: { id: string }) => x.id)).toContain(id);
  });
  it('catálogo de produtos para consulta, sem custos de parceiros', async () => {
    const r = ok(await rafael.get('/catalog/plans')).json();
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items[0]).not.toHaveProperty('partnerCosts');
    for (const p of r.items) for (const x of p.products) expect(Object.keys(x).sort()).toEqual(['name', 'qty', 'unitPriceCents']);
  });
});
