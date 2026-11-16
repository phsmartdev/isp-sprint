/** Diretoria decide a proposta de orçamento (item, centro ou tudo; ajustes) e é avisada, mesmo sem cargo Liderança. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, dir: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
const year = new Date().getFullYear();
const month = `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

beforeAll(async () => {
  ctx = await makeApp();
  carlos = await login(ctx.app, 'carlos@yepnet.test');
  const email = `dir-orc-${stamp}@yepnet.test`;
  // diretoria cadastrada com cargo "operador" nos setores: decide e recebe aviso mesmo assim
  const u = ok(await carlos.post('/admin/users', { name: 'Diretoria Orçamento', email, profile: 'diretoria', teamIds: [], sectorRole: 'operador' }), 201).json();
  dir = await login(ctx.app, email, u.temporaryPassword);
});
afterAll(async () => ctx.close());

it('diretoria vê a proposta (planejada e enviada), aprova item, pede ajustes e é avisada do envio', async () => {
  // subconta própria do teste (outra suíte testa o plano de contas sugerido no mesmo banco)
  const tenantId = (await ctx.app.db.select({ t: s.users.tenantId }).from(s.users).where(eq(s.users.email, 'carlos@yepnet.test')))[0]!.t;
  await ctx.app.db.insert(s.budgetAccounts).values({ tenantId, code: 'ZZ-DIR-TESTE', name: 'Proposta (teste)' }).onConflictDoNothing();
  const st = ok(await carlos.get('/budget/structure')).json();
  const acc = st.accounts.find((a: { code: string }) => a.code === 'ZZ-DIR-TESTE').id;
  const cc = ok(await carlos.post('/budget/cost-centers', { code: `DR${stamp.slice(-4)}`.toUpperCase(), name: 'Centro da proposta', leaderId: carlos.me.user.id }), 201).json().id;
  const mk = async (what: string) => ok(await carlos.post('/budget/central/lines', { costCenterId: cc, accountId: acc, what, qty: '1', unit: 'un', unitCents: 100_00, month, justification: 'Proposta do trimestre' }), 201).json().items[0].id as string;
  const a = await mk(`Item A ${stamp}`), b = await mk(`Item B ${stamp}`), c = await mk(`Item C ${stamp}`);
  // proposta ainda não enviada: a diretoria já vê e pode decidir
  const central = ok(await dir.get(`/budget/central?year=${year}&costCenterId=${cc}`)).json();
  const rows = central.rows.filter((r: { id: string }) => [a, b, c].includes(r.id));
  expect(rows.every((r: { canDecide: boolean; proposal: boolean }) => r.canDecide && r.proposal)).toBe(true);
  // gerente (quem criou) não decide o próprio
  expect(ok(await carlos.post('/budget/decisions', { items: [{ lineId: a, decision: 'aprovar' }] })).json().blocked).toHaveLength(1);
  // aprova um item; pede ajustes em outro; o terceiro é enviado e a diretoria é avisada
  expect(ok(await dir.post('/budget/decisions', { items: [{ lineId: a, decision: 'aprovar' }] })).json().decided).toHaveLength(1);
  expect(ok(await dir.post('/budget/decisions', { items: [{ lineId: b, decision: 'revisao', note: 'Detalhar o fornecedor' }] })).json().decided).toHaveLength(1);
  ok(await carlos.post(`/budget/lines/${c}/submit`, {}));
  const notes = await ctx.app.db.select({ title: s.userNotifications.title }).from(s.userNotifications).where(eq(s.userNotifications.userId, dir.me.user.id));
  expect(notes.some((n) => n.title.includes(`Item C ${stamp}`))).toBe(true);
  const after = ok(await dir.get(`/budget/lines/${b}`)).json().line;
  expect(after.approvalState).toBe('em_revisao');
  expect(ok(await dir.get(`/budget/lines/${a}`)).json().line.approvalState).toBe('aprovado');
});
