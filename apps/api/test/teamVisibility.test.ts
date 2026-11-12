/** Funis: quem vê só as próprias negociações também vê as do time (só leitura); trocar responsável é do responsável ou da liderança. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let ana: Client, lucas: Client, mariana: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); [ana, lucas, mariana] = await Promise.all([login(ctx.app, 'ana@yepnet.test'), login(ctx.app, 'lucas@yepnet.test'), login(ctx.app, 'mariana@yepnet.test')]); });
afterAll(async () => ctx.close());

it('colega do time vê a negociação sem poder alterar; fora do time não vê; supervisão troca o responsável', async () => {
  const lk = ok(await ana.get('/meta/lookups')).json();
  const o = ok(await ana.post('/opportunities', { newContact: { name: `Cliente Time Fictício ${Date.now().toString(36)}`, segment: 'residencial' }, planId: lk.plans[0].id }), 201).json();
  expect(o.ownerId).toBe(ana.me.user.id);
  const seen = ok(await lucas.get(`/opportunities/${o.id}`)).json();
  expect(seen.canEdit).toBe(false);
  expect(ok(await lucas.get(`/opportunities?status=todas&q=${encodeURIComponent('Cliente Time Fictício')}`)).json().items.some((x: { id: string }) => x.id === o.id)).toBe(true);
  // escrever: segue só nas próprias
  expect((await lucas.patch(`/opportunities/${o.id}`, { rowVersion: seen.rowVersion, title: 'x' })).statusCode).toBe(404);
  expect((await lucas.post(`/opportunities/${o.id}/transition`, { toStage: 'perdida', rowVersion: seen.rowVersion, confirm: true, lossReason: 'x' })).statusCode).not.toBe(200);
  // outro time: não vê
  expect((await mariana.get(`/opportunities/${o.id}`)).statusCode).toBe(404);
  // os próprios números do vendedor não somam os do time
  // supervisão troca o responsável
  const cur = ok(await ana.get(`/opportunities/${o.id}`)).json();
  expect(cur.canEdit).toBe(true);
  ok(await ana.patch(`/opportunities/${o.id}`, { rowVersion: cur.rowVersion, ownerId: lucas.me.user.id }));
  expect(ok(await lucas.get(`/opportunities/${o.id}`)).json()).toMatchObject({ ownerId: lucas.me.user.id, canEdit: true });
});
