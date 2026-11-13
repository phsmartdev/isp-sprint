/** Fase 7: fechamento mensal com governança, trava do período, relatório por destinatário e avisos. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, dir: Client, ana: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const M = '2022-07';
const stamp = Date.now().toString(36);

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'ana@yepnet.test')]);
  const email = `dir-fech-${stamp}@yepnet.test`;
  const u = ok(await carlos.post('/admin/users', { name: 'Diretora Fechamento', email, profile: 'diretoria', teamIds: [] }), 201).json();
  dir = await login(ctx.app, email, u.temporaryPassword);
  await ctx.db.execute(sql`delete from budget_report_dispatches where month = ${M}`);
  await ctx.db.execute(sql`delete from budget_closings where month = ${M}`);
  ok(await carlos.post('/budget/setup'));
});
afterAll(async () => ctx.close());

it('fechamento: conferência, validação pela Diretoria (não por quem enviou), trava, relatório com escopo e reabertura', async () => {
  const st = ok(await carlos.get('/budget/structure')).json();
  const acc = st.accounts.find((a: { code: string }) => a.code === '3.4.03').id;
  const cc = ok(await carlos.post('/budget/cost-centers', { code: `FC${stamp.slice(-4)}`, name: 'Centro do fechamento', leaderId: carlos.me.user.id }), 201).json();
  const line = ok(await carlos.post('/budget/central/lines', { costCenterId: cc.id, accountId: acc, what: 'Treinamento fictício', qty: 1, unitCents: 5_000_00, month: M, justification: 'Capacitação' }), 201).json().items[0];
  ok(await carlos.post(`/budget/lines/${line.id}/submit`, {}));
  // a Diretoria recebeu o aviso da nova solicitação no sino
  const bell = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from user_notifications where user_id = ${dir.me.user.id} and module = 'orcamento' and event = 'aprovacao_pedida'`);
  expect(bell.rows[0]!.n).toBeGreaterThan(0);
  ok(await dir.post('/budget/decisions', { items: [{ lineId: line.id, decision: 'aprovar' }] }));
  ok(await carlos.post(`/budget/lines/${line.id}/realized`, { occurredOn: `${M}-10`, description: 'Nota da turma', amountCents: 4_800_00, idempotencyKey: `real-${stamp}-1` }), 201);

  expect((await carlos.post(`/budget/closings/${M}/transition`, { to: 'fechado' })).statusCode).toBe(422); // pula etapas
  ok(await carlos.post(`/budget/closings/${M}/transition`, { to: 'em_conferencia' }));
  ok(await carlos.post(`/budget/closings/${M}/transition`, { to: 'aguardando_validacao' }));
  expect((await carlos.post(`/budget/closings/${M}/transition`, { to: 'fechado' })).statusCode).toBe(403);
  ok(await dir.post(`/budget/closings/${M}/transition`, { to: 'fechado' }));
  const c = ok(await dir.get(`/budget/closings/${M}`)).json();
  expect(c.closing.status).toBe('fechado');
  const mine = c.snapshot.centers.find((x: { id: string }) => x.id === cc.id);
  expect(mine).toMatchObject({ approved: 5_000_00, realized: 4_800_00, deviation: -200_00 });
  // período fechado: nada retroativo
  expect(ok(await carlos.post(`/budget/lines/${line.id}/realized`, { occurredOn: `${M}-20`, description: 'Ajuste', amountCents: 100, idempotencyKey: `real-${stamp}-2` }), 422).json().detail).toMatch(/fechada/);
  // relatório: cada destinatário só com os seus centros; sem SMTP, a falha fica registrada para reenviar
  const prep = ok(await carlos.post(`/budget/closings/${M}/reports/prepare`, {})).json();
  expect(prep.created).toBeGreaterThan(0);
  expect(ok(await carlos.post(`/budget/closings/${M}/reports/prepare`, {})).json().created).toBe(0); // idempotente
  const ds = ok(await dir.get(`/budget/closings/${M}`)).json().dispatches as { id: string; role: string; email: string; status: string }[];
  const forDir = ds.find((d) => d.role === 'diretoria' && d.email.startsWith('dir-fech'))!;
  const forCarlos = ds.find((d) => d.email === 'carlos@yepnet.test')!;
  expect(forCarlos.role).not.toBe('diretoria');
  const htmlCarlos = (await carlos.get(`/budget/reports/${forCarlos.id}/preview`)).body;
  expect(htmlCarlos).toContain(cc.code);
  expect(htmlCarlos).not.toContain('>MKT<');
  expect(htmlCarlos).toContain('Fechamento Orçamentário');
  expect(htmlCarlos).toContain('R$');
  expect((await ana.get(`/budget/reports/${forDir.id}/preview`)).statusCode).toBe(403);
  expect((await ana.post(`/budget/closings/${M}/reports/send`, {})).statusCode).toBe(403);
  const sent = ok(await dir.post(`/budget/closings/${M}/reports/send`, { ids: [forCarlos.id] })).json();
  expect(sent.sent + sent.failed).toBe(1);
  // reabertura excepcional: só Diretoria, com justificativa; depois libera a alteração
  expect((await dir.post(`/budget/closings/${M}/transition`, { to: 'reaberto', reason: 'curto' })).statusCode).toBe(422);
  ok(await dir.post(`/budget/closings/${M}/transition`, { to: 'reaberto', reason: 'Nota fiscal chegou depois do fechamento' }));
  ok(await carlos.post(`/budget/lines/${line.id}/realized`, { occurredOn: `${M}-20`, description: 'Complemento', amountCents: 100_00, idempotencyKey: `real-${stamp}-3` }), 201);
});
