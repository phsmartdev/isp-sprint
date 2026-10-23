/** Contatos da oportunidade (CRM, sem ABM): várias pessoas, papel por negociação, sem duplicar pessoas. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let lucas: Client, rafael: Client;
let oppId = '';
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);

beforeAll(async () => {
  ctx = await makeApp();
  lucas = await login(ctx.app, 'lucas@yepnet.test');
  rafael = await login(ctx.app, 'rafael@yepnet.test');
  const mine = ok(await lucas.get('/opportunities?status=todas&pageSize=100')).json().items.find((o: { ownerId: string }) => o.ownerId === lucas.me.user.id);
  oppId = mine.id;
});
afterAll(async () => ctx.close());

describe('Contatos da oportunidade', () => {
  it('adiciona várias pessoas; a primeira vira contato principal; reaproveita a pessoa pelo e-mail; muda papel e retira', async () => {
    const email = `diretora-${stamp}@cliente.test`;
    ok(await lucas.post(`/opportunities/${oppId}/contacts`, { person: { name: 'Diretora de TI', email, phone: '79 99999-0000' }, title: 'Diretora de TI' }), 201);
    ok(await lucas.post(`/opportunities/${oppId}/contacts`, { person: { name: `Comprador ${stamp}`, email: null, phone: null }, title: 'Compras' }), 201);
    let d = ok(await lucas.get(`/opportunities/${oppId}/contacts`)).json();
    const dir = d.items.find((i: { name: string }) => i.name === 'Diretora de TI');
    const comp = d.items.find((i: { name: string }) => i.name === `Comprador ${stamp}`);
    expect(dir).toMatchObject({ title: 'Diretora de TI', email, phone: '79 99999-0000' });
    expect(comp.role).not.toBe('contato_principal');
    // mesmo e-mail: a pessoa é a mesma e já está ligada
    expect((await lucas.post(`/opportunities/${oppId}/contacts`, { person: { name: 'Outro Nome', email, phone: null } })).json().detail).toMatch(/já é contato/);
    ok(await lucas.patch(`/opportunities/${oppId}/contacts/${comp.id}`, { rowVersion: comp.rowVersion, role: 'decisor' }));
    ok(await lucas.post(`/opportunities/${oppId}/contacts/${comp.id}/remove`));
    d = ok(await lucas.get(`/opportunities/${oppId}/contacts`)).json();
    expect(d.items.some((i: { id: string }) => i.id === comp.id)).toBe(false);
    // continua na conta: pode voltar pela lista da conta, sem recadastrar
    const back = d.available.find((a: { name: string }) => a.name === `Comprador ${stamp}`);
    expect(back).toBeTruthy();
    ok(await lucas.post(`/opportunities/${oppId}/contacts`, { stakeholderId: back.stakeholderId, role: 'aprovador_financeiro' }), 201);
    d = ok(await lucas.get(`/opportunities/${oppId}/contacts`)).json();
    expect(d.items.find((i: { name: string }) => i.name === `Comprador ${stamp}`).role).toBe('aprovador_financeiro');
  });

  it('quem não vê a oportunidade não vê nem altera os contatos', async () => {
    expect((await rafael.get(`/opportunities/${oppId}/contacts`)).statusCode).toBe(404);
    expect((await rafael.post(`/opportunities/${oppId}/contacts`, { person: { name: 'Intruso', email: null, phone: null } })).statusCode).toBe(404);
  });
});
