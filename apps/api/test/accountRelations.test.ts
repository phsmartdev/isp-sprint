/** Relações entre contas: registro com direção, sem duplicar nem criar ciclo, sugestões (raiz do CNPJ e pessoas em comum), mapa, remoção com motivo. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
const n = (k: number) => String(Number(stamp.replace(/\D/g, '').slice(-6) || '1') * 10 + k).padStart(6, '0').slice(-6);
let pref: { id: string; contactId: string }, sme: { id: string; contactId: string }, cons: { id: string; contactId: string };

beforeAll(async () => {
  ctx = await makeApp();
  [lucas, rafael] = (await Promise.all(['lucas', 'rafael'].map((x) => login(ctx.app, `${x}@yepnet.test`)))) as [Client, Client];
  const create = async (body: Record<string, unknown>) => {
    let r = await lucas.post('/abm/new-account', body);
    if (r.statusCode === 422 && r.json().duplicates) r = await lucas.post('/abm/new-account', { ...body, ignoreDuplicates: { ids: r.json().duplicates.map((d: { id: string }) => d.id), justification: 'Outra organização do mesmo grupo (teste)' } });
    return ok(r, 201).json();
  };
  pref = await create({ name: `Prefeitura Relações ${stamp}`, segment: 'governamental', reason: 'Cidade conectada', document: `11${n(1)}000191` });
  sme = await create({ name: `Secretaria Relações ${stamp}`, segment: 'governamental', reason: 'Escolas conectadas', document: `11${n(1)}000272` });
  cons = await create({ name: `Consórcio Relações ${stamp}`, reason: 'Consórcio de saúde' });
});
afterAll(async () => ctx.close());

describe('relações entre contas', () => {
  it('sugere pela raiz do CNPJ e por pessoas em comum; registra com direção; não duplica nem cria ciclo; mapa e remoção', async () => {
    // mesma pessoa nas duas contas → sugestão
    const p = ok(await lucas.post(`/accounts/${pref.contactId}/stakeholders`, { person: { name: 'Pessoa Comum', email: `comum.${stamp}@exemplo.test` }, title: 'Chefe de gabinete' }), 201).json();
    ok(await lucas.post(`/accounts/${cons.contactId}/stakeholders`, { personId: p.personId, title: 'Conselheira' }), 201);
    let r = ok(await lucas.get(`/accounts/${pref.contactId}/account-relations`)).json();
    expect(r.items).toEqual([]);
    const sug = Object.fromEntries(r.suggestions.map((x: { contactId: string; reasons: string[] }) => [x.contactId, x.reasons.join(' | ')]));
    expect(sug[cons.contactId]).toMatch(/Pessoas em comum: Pessoa Comum/);
    expect(sug[sme.contactId]).toMatch(/Mesma raiz de CNPJ/);

    ok(await lucas.post(`/accounts/${pref.contactId}/account-relations`, { otherContactId: sme.contactId, kind: 'orgao_superior' }), 201);
    ok(await lucas.post(`/accounts/${sme.contactId}/account-relations`, { otherContactId: cons.contactId, kind: 'membro' }), 201);
    expect(ok(await lucas.post(`/accounts/${sme.contactId}/account-relations`, { otherContactId: pref.contactId, kind: 'orgao_superior' }), 422).json().detail).toMatch(/ciclo/);
    expect(ok(await lucas.post(`/accounts/${pref.contactId}/account-relations`, { otherContactId: sme.contactId, kind: 'orgao_superior' }), 422).json().detail).toMatch(/já está registrada/);
    ok(await lucas.post(`/accounts/${pref.contactId}/account-relations`, { otherContactId: pref.contactId, kind: 'outro' }), 422);
    // "inverter": a secretaria registra que é vinculada (a prefeitura é o órgão superior) — já existe
    expect(ok(await lucas.post(`/accounts/${sme.contactId}/account-relations`, { otherContactId: pref.contactId, kind: 'orgao_superior', inverse: true }), 422).json().detail).toMatch(/já está registrada/);

    r = ok(await lucas.get(`/accounts/${sme.contactId}/account-relations`)).json();
    expect(r.items.map((x: { label: string; other: { name: string } }) => `${x.label} ${x.other.name}`).sort()).toEqual([`é membro de Consórcio Relações ${stamp}`, `é vinculada/subordinada a Prefeitura Relações ${stamp}`]);
    expect(r.network.nodes).toHaveLength(3);
    expect(r.suggestions.some((x: { contactId: string }) => x.contactId === pref.contactId)).toBe(false); // já relacionadas não viram sugestão

    const map = ok(await lucas.get('/abm/account-relations')).json();
    const g = map.groups.find((x: { nodes: { contactId: string }[] }) => x.nodes.some((n2) => n2.contactId === pref.contactId));
    expect(g.edges).toHaveLength(2);

    // fora da carteira: não vê a conta
    ok(await rafael.get(`/accounts/${pref.contactId}/account-relations`), 404);

    const rel = r.items.find((x: { kind: string }) => x.kind === 'membro');
    ok(await lucas.post(`/account-relations/${rel.id}/remove`, { reason: 'x' }), 422);
    ok(await lucas.post(`/account-relations/${rel.id}/remove`, { reason: 'Saiu do consórcio' }));
    expect(ok(await lucas.get(`/accounts/${sme.contactId}/account-relations`)).json().items).toHaveLength(1);
  });
});
