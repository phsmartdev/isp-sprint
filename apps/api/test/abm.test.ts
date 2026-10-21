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
    expect(l.items.find((x: { id: string }) => x.id === id)).toMatchObject({ tier: '1_1', status: 'candidata', origin: 'base_existente' });
    expect(l.counts.candidata).toBeGreaterThanOrEqual(1);
    expect(typeof l.items.find((x: { id: string }) => x.id === id).commercial).toBe('string');
    const a = ok(await lucas.get(`/abm/${id}`)).json();
    expect((await lucas.patch(`/abm/${id}`, { rowVersion: a.rowVersion, status: 'ativa' })).statusCode).toBe(422); // pula etapas
    ok(await lucas.patch(`/abm/${id}`, { rowVersion: a.rowVersion, status: 'selecionada', nextStep: 'Reunião com a diretoria', nextStepOn: '2026-11-05' }));
    const d = ok(await lucas.get(`/abm/${id}`)).json();
    expect(d.events[0]).toMatchObject({ type: 'situacao' });
    expect((await rafael.get(`/abm/${id}`)).statusCode).toBe(404);
    expect(ok(await carlos.get('/abm')).json().items.map((x: { id: string }) => x.id)).toContain(id);
  });
  it('nova conta: confere duplicidade (CNPJ bloqueia; nome parecido pede confirmação) e entra como candidata', async () => {
    const stamp = Date.now().toString(36);
    const name = `Hospital Fictício ${stamp} Ltda`;
    const id1 = ok(await lucas.post('/abm/new-account', { name, nature: 'privada', segment: 'empresarial', city: 'Aracaju', document: '11.222.333/0001-81', origin: 'indicacao', reason: 'Indicação de cliente atual; 3 unidades' }), 201).json();
    expect(id1).toMatchObject({ status: 'candidata', origin: 'indicacao' });
    // mesmo CNPJ: bloqueia e aponta a conta existente
    const same = await carlos.post('/abm/new-account', { name: 'Outro nome qualquer', document: '11222333000181', reason: 'Tentativa de duplicar' });
    expect(same.statusCode).toBe(422);
    expect(same.json().detail).toContain(name);
    // nome parecido: lista as possíveis duplicidades; pode seguir com justificativa
    const d = ok(await carlos.get(`/abm/dedup?name=${encodeURIComponent(`Hosp. Ficticio ${stamp}`)}&city=Aracaju`)).json();
    expect(d.items[0]).toMatchObject({ id: id1.contactId, inAbm: true });
    const sim = await carlos.post('/abm/new-account', { name: `Hosp. Ficticio ${stamp}`, city: 'Aracaju', reason: 'Prospecção regional' });
    expect(sim.statusCode).toBe(422);
    expect(sim.json().duplicates[0].id).toBe(id1.contactId);
    ok(await carlos.post('/abm/new-account', { name: `Hosp. Ficticio ${stamp}`, city: 'Aracaju', reason: 'Prospecção regional', ignoreDuplicates: { ids: [id1.contactId], justification: 'Instituição diferente, mantida por outra fundação' } }), 201);
    // CNPJ incompleto é recusado (pode ficar em branco)
    expect((await lucas.post('/abm/new-account', { name: `Escola ${stamp}`, document: '123', reason: 'Prospecção de escolas' })).statusCode).toBe(422);
    // a conta criada é a mesma do cadastro de Contas (sem cadastro paralelo)
    const c = ok(await lucas.get(`/abm/by-contact/${id1.contactId}`)).json();
    expect(c.abm.id).toBe(id1.id);
    // encerrar exige motivo
    const a = ok(await lucas.get(`/abm/${id1.id}`)).json();
    expect(a).toMatchObject({ commercial: 'identificada', nature: 'privada' });
    expect((await lucas.patch(`/abm/${id1.id}`, { rowVersion: a.rowVersion, status: 'encerrada', statusReason: 'x' })).statusCode).toBe(422);
    ok(await lucas.patch(`/abm/${id1.id}`, { rowVersion: a.rowVersion, status: 'encerrada', statusReason: 'Sem aderência ao portfólio no momento' }));
    expect(ok(await lucas.get(`/abm/${id1.id}`)).json()).toMatchObject({ status: 'encerrada', statusReason: 'Sem aderência ao portfólio no momento' });
  });
  it('catálogo de produtos para consulta, sem custos de parceiros', async () => {
    const r = ok(await rafael.get('/catalog/plans')).json();
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items[0]).not.toHaveProperty('partnerCosts');
    for (const p of r.items) for (const x of p.products) expect(Object.keys(x).sort()).toEqual(['name', 'qty', 'unitPriceCents']);
  });
});
