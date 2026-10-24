/** Habilitação: certidões por filial, substituição com histórico, matriz das exigidas e avisos de validade sem repetir. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addDays } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const today = new Date().toISOString().slice(0, 10);
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); lucas = await login(ctx.app, 'lucas@yepnet.test'); });
afterAll(async () => ctx.close());

describe('Habilitação da empresa', () => {
  it('cadastra por filial, substitui mantendo histórico, mostra a matriz e avisa no marco certo uma vez só', async () => {
    const h0 = ok(await carlos.get('/contracts/habilitation')).json();
    const branch = h0.branches[0];
    expect(h0.matrix[0].items.map((i: { kind: string }) => i.kind)).toEqual(['cnd_federal', 'crf_fgts', 'cndt', 'cnd_estadual', 'cnd_municipal']);
    expect((await lucas.post('/contracts/habilitation', { branchId: branch.id, kind: 'cnd_federal', expiresOn: addDays(today, 100), filename: 'cnd.pdf', data: pdf })).statusCode).toBe(403);
    expect((await carlos.post('/contracts/habilitation', { branchId: branch.id, kind: 'cnd_federal', filename: 'cnd.pdf', data: pdf })).statusCode).toBe(422);
    expect((await carlos.post('/contracts/habilitation', { branchId: branch.id, kind: 'cnd_federal', expiresOn: addDays(today, 100), filename: 'cnd.txt', data: Buffer.from('oi').toString('base64') })).statusCode).toBe(422);
    const old = ok(await carlos.post('/contracts/habilitation', { branchId: branch.id, kind: 'cnd_federal', number: 'A1', expiresOn: addDays(today, 100), filename: 'cnd-antiga.pdf', data: pdf }), 201).json().id;
    ok(await carlos.post('/contracts/habilitation', { branchId: branch.id, kind: 'cnd_federal', number: 'A2', expiresOn: addDays(today, 10), filename: 'cnd.pdf', data: pdf }), 201);
    ok(await carlos.post('/contracts/habilitation', { branchId: null, kind: 'crf_fgts', expiresOn: addDays(today, -1), filename: 'fgts.pdf', data: pdf }), 201);
    const h = ok(await carlos.get('/contracts/habilitation')).json();
    const row = h.matrix.find((m: { branchId: string }) => m.branchId === branch.id);
    const by = Object.fromEntries(row.items.map((i: { kind: string; status: string }) => [i.kind, i.status]));
    expect(by).toMatchObject({ cnd_federal: 'vence_15', crf_fgts: 'vencida', cndt: 'falta' });
    const hist = ok(await carlos.get(`/contracts/habilitation/history?kind=cnd_federal&branchId=${branch.id}`)).json().items;
    expect(hist.map((x: { number: string }) => x.number)).toEqual(['A2', 'A1']);
    expect(hist.find((x: { id: string }) => x.id === old).supersededAt).toBeTruthy();
    const dl = await carlos.get(`/contracts/habilitation/${old}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.body.startsWith('%PDF')).toBe(true);
    const r1 = ok(await carlos.post('/contracts/alerts/run')).json();
    expect(r1.companyDocAlerts).toBeGreaterThanOrEqual(2);
    const r2 = ok(await carlos.post('/contracts/alerts/run')).json();
    expect(r2.companyDocAlerts).toBe(0);
    const tasks = (await ctx.db.execute(sql`select title from activities where title like 'Certidão vencida: CRF do FGTS%' or title like 'Renovar certidão: CND Federal%'`)).rows;
    expect(tasks.length).toBeGreaterThanOrEqual(2);
  });
});
