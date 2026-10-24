/** Acesso por IP liberado: lista de endereços, trava contra se trancar fora, exceção por pessoa e bloqueio no login e nas sessões. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, ORIGIN, PASSWORD, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
});
afterAll(async () => {
  await carlos.put('/admin/ip-access', { enabled: false, rules: [] });
  await carlos.patch(`/admin/users/${carlos.me.user.id}`, { ipBypass: false });
  await ctx.close();
});

describe('acesso por IP', () => {
  it('liga com a lista, não deixa se trancar fora, bloqueia login e sessão fora da rede e respeita a exceção', async () => {
    const cur = ok(await carlos.get('/admin/ip-access')).json();
    expect(cur).toMatchObject({ enabled: false, myIp: '127.0.0.1' });
    expect((await lucas.get('/admin/ip-access')).statusCode).toBe(403);
    // inválido e grande demais
    expect((await carlos.put('/admin/ip-access', { enabled: true, rules: [{ cidr: 'abc', label: 'x' }] })).statusCode).toBe(422);
    expect((await carlos.put('/admin/ip-access', { enabled: true, rules: [{ cidr: '0.0.0.0/0', label: 'tudo' }] })).statusCode).toBe(422);
    // sem o próprio IP: recusado (perderia o acesso)
    const locked = await carlos.put('/admin/ip-access', { enabled: true, rules: [{ cidr: '10.0.0.0/8', label: 'Escritório' }] });
    expect(locked.statusCode).toBe(422);
    expect(locked.json().detail).toMatch(/127\.0\.0\.1/);
    // com o IP atual: liga e todo mundo da rede entra
    ok(await carlos.put('/admin/ip-access', { enabled: true, rules: [{ cidr: '127.0.0.1', label: 'Rede local' }, { cidr: '10.0.0.0/8', label: 'Escritório' }] }));
    ok(await lucas.get('/me'));
    // só o escritório: quem não tem exceção perde a sessão e não consegue entrar
    ok(await carlos.patch(`/admin/users/${carlos.me.user.id}`, { ipBypass: true }));
    ok(await carlos.put('/admin/ip-access', { enabled: true, rules: [{ cidr: '10.0.0.0/8', label: 'Escritório' }] }));
    const blocked = await lucas.get('/me');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ type: 'urn:isp:ip-bloqueado', title: 'Acesso fora da rede autorizada' });
    const relogin = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN }, payload: { email: 'lucas@yepnet.test', password: PASSWORD } });
    expect(relogin.statusCode).toBe(403);
    expect(relogin.json().detail).toMatch(/Seu IP: 127\.0\.0\.1/);
    // a partir do escritório entra
    const office = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: ORIGIN }, payload: { email: 'lucas@yepnet.test', password: PASSWORD }, remoteAddress: '10.2.3.4' });
    expect(office.statusCode).toBe(200);
    // quem tem exceção continua usando
    ok(await carlos.get('/me'));
    const st = ok(await carlos.get('/admin/ip-access')).json();
    expect(st.blocked7d).toBeGreaterThanOrEqual(1);
    expect(st.bypassUsers.map((u: { email: string }) => u.email)).toContain('carlos@yepnet.test');
    // desligado: volta ao normal
    ok(await carlos.put('/admin/ip-access', { enabled: false, rules: [{ cidr: '10.0.0.0/8', label: 'Escritório' }] }));
    ok(await lucas.get('/me'));
  });
});
