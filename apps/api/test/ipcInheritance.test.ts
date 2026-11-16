/** IPC herdado: ao relacionar contas (ou vincular à estrutura), quem "assume" passa a ter o IPC da principal. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const uid = Date.now().toString(36);
const ALL = (lv: string) => ({ tamanho: lv, potencial: lv, segmento: lv, criticidade: lv, tempo: lv, relacionamento: lv, maturidade: lv });
let A: string, B: string, C: string;
const ipc = async (id: string) => ok(await carlos.get(`/cs/accounts/${id}`)).json().snapshot.ipc;
const assess = (id: string, lv: string) => carlos.post(`/cs/accounts/${id}/ipc`, { levels: ALL(lv), justification: 'Avaliação de teste do IPC' });

beforeAll(async () => {
  ctx = await makeApp();
  carlos = await login(ctx.app, 'carlos@yepnet.test');
  const mk = async (n: string) => ok(await carlos.post('/contacts', { name: `${n} ${uid}`, segment: 'governamental' }), 201).json().id as string;
  [A, B, C] = [await mk('Secretaria Principal'), await mk('Escola Vinculada'), await mk('Posto Vinculado')];
  ok(await assess(A, 'alto'));
  ok(await assess(B, 'baixo'));
});
afterAll(async () => ctx.close());

it('conta relacionada que assume o IPC passa a ter o score da principal e volta ao próprio ao desfazer', async () => {
  expect((await ipc(A)).total).toBe(100);
  expect((await ipc(B)).total).toBe(20);
  // B é vinculada a A e assume o IPC de A
  const rel = ok(await carlos.post(`/accounts/${B}/account-relations`, { otherContactId: A, kind: 'orgao_superior', inverse: true, ipcFollower: 'esta' }), 201).json().id;
  const b = await ipc(B);
  expect(b.total).toBe(100);
  expect(b.inherited.fromId).toBe(A);
  expect(b.own.total).toBe(20);
  expect(b.reviewDue).toBe(false);
  const list = ok(await carlos.get(`/accounts/${B}/account-relations`)).json().items;
  expect(list.find((x: { id: string }) => x.id === rel).ipcFollower).toBe('esta');

  // avaliar na seguidora é recusado; mudar a principal muda a seguidora
  expect((await assess(B, 'alto')).statusCode).toBe(422);
  ok(await assess(A, 'medio'));
  expect((await ipc(B)).total).toBe((await ipc(A)).total);

  // uma principal só e sem ciclo
  expect((await carlos.post(`/accounts/${B}/account-relations`, { otherContactId: C, kind: 'parceira', ipcFollower: 'esta' })).statusCode).toBe(422);
  expect((await carlos.post(`/accounts/${A}/account-relations`, { otherContactId: B, kind: 'parceira', ipcFollower: 'esta' })).statusCode).toBe(422);
  // individualizado continua permitido
  ok(await carlos.post(`/accounts/${B}/account-relations`, { otherContactId: C, kind: 'parceira', ipcFollower: null }), 201);

  ok(await carlos.post(`/account-relations/${rel}/remove`, { reason: 'Teste de desfazer' }));
  const back = await ipc(B);
  expect(back.total).toBe(20);
  expect(back.inherited).toBeNull();
});

it('conta vinculada à estrutura assume o IPC da conta gestora', async () => {
  const st = ok(await carlos.post('/structures', { name: `Rede Estadual ${uid}`, kind: 'rede' }), 201).json().id;
  // sem gestora não há IPC da estrutura
  expect((await carlos.post(`/structures/${st}/members`, { contactId: C, role: 'participante', inheritsIpc: true })).statusCode).toBe(422);
  ok(await carlos.post(`/structures/${st}/members`, { contactId: A, role: 'gestor' }), 201);
  expect((await carlos.post(`/structures/${st}/members`, { contactId: B, role: 'gestor', inheritsIpc: true })).statusCode).toBe(422);
  const m = ok(await carlos.post(`/structures/${st}/members`, { contactId: C, role: 'participante', inheritsIpc: true }), 201).json().id;
  const c = await ipc(C);
  expect(c.total).toBe((await ipc(A)).total);
  expect(c.inherited.via).toBe('estrutura');
  expect(c.inherited.structureName).toBe(`Rede Estadual ${uid}`);
  const acc = ok(await carlos.get(`/accounts/${B}/structures`)).json();
  expect(acc.available.find((x: { id: string }) => x.id === st).gestor.contactId).toBe(A);
  ok(await carlos.post(`/structure-members/${m}/remove`, { reason: 'Teste de saída' }));
  expect((await ipc(C)).inherited).toBeNull();
});
