/** Distribuição da carteira entre CSMs (só setor Sucesso do Cliente) e Tier/IPC no resumo da conta. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]); });
afterAll(async () => ctx.close());

async function csm(name: string) {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return ok(await carlos.post('/admin/users', { name, email: `${stamp}@yepnet.test`, profile: 'gestao_contratos', sectors: ['sucesso_cliente'] }), 201).json().id as string;
}

describe('distribuir carteira', () => {
  it('prévia equilibrada, aplica com motivo, só para CSMs e só pela gestão', async () => {
    const [luiz, paulo] = [await csm('Luiz CSM Fictício'), await csm('Paulo CSM Fictício')];
    ok(await lucas.post('/cs/distribute', { csmIds: [luiz] }), 403);
    ok(await carlos.post('/cs/distribute', { csmIds: [lucas.me.user.id] }), 422); // sem o setor Sucesso do Cliente

    const p = ok(await carlos.post('/cs/distribute', { csmIds: [luiz, paulo], dryRun: true })).json();
    expect(p.applied).toBe(false);
    expect(p.accounts).toBeGreaterThan(1);
    const [a, b] = p.csms;
    expect(a.accounts + b.accounts).toBe(p.accounts);
    expect(Math.min(a.accounts, b.accounts)).toBeGreaterThan(0);

    ok(await carlos.post('/cs/distribute', { csmIds: [luiz, paulo], dryRun: false, justification: 'curta' }), 422);
    const r = ok(await carlos.post('/cs/distribute', { csmIds: [luiz, paulo], dryRun: false, justification: 'Carteira dividida entre os dois CSMs' })).json();
    expect(r.applied).toBe(true);
    const team = ok(await carlos.get('/cs/team')).json();
    const mine = team.csms.filter((c: { csmId: string | null }) => c.csmId === luiz || c.csmId === paulo);
    expect(mine.reduce((t: number, c: { accounts: number }) => t + c.accounts, 0)).toBe(p.accounts);
    // de novo, mantendo quem já está com eles: nada muda
    expect(ok(await carlos.post('/cs/distribute', { csmIds: [luiz, paulo], dryRun: true })).json().changes).toBe(0);
  });

  it('resumo da conta traz Tier, valor anual e IPC; prospect sem venda não vira conta', async () => {
    const team = ok(await carlos.get('/cs/portfolio')).json();
    const id = (team.accounts ?? team.items)[0].contactId;
    const c = ok(await carlos.get(`/contacts/${id}`)).json();
    expect(c.strategic).toBeTruthy();
    expect(['small', 'middle', 'large']).toContain(c.strategic.tier);
    expect(typeof c.strategic.acvCents).toBe('number');
    const plan = (await lucas.get('/meta/lookups')).json().plans[0];
    const o = ok(await lucas.post('/opportunities', { newContact: { name: `Prospect Tier ${Date.now()}`, segment: 'residencial' }, planId: plan.id }), 201).json();
    expect(ok(await carlos.get(`/contacts/${o.contactId}`)).json().strategic).toBeNull();
  });
});
