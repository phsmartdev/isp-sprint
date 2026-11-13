/** Fase 8: revisões e remanejamentos com versão (sem criar dinheiro), projeção e decisões simultâneas. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, dir: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const year = new Date().getFullYear();
const month = `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
const stamp = Date.now().toString(36);

beforeAll(async () => {
  ctx = await makeApp();
  carlos = await login(ctx.app, 'carlos@yepnet.test');
  const email = `dir-rev-${stamp}@yepnet.test`;
  const u = ok(await carlos.post('/admin/users', { name: 'Diretor Revisão', email, profile: 'diretoria', teamIds: [] }), 201).json();
  dir = await login(ctx.app, email, u.temporaryPassword);
  ok(await carlos.post('/budget/setup'));
});
afterAll(async () => ctx.close());

it('remanejamento soma zero e não move dinheiro consumido; revisão preserva o original; entre centros só a Diretoria; decisão simultânea não duplica', async () => {
  const st = ok(await carlos.get('/budget/structure')).json();
  const acc = st.accounts.find((a: { code: string }) => a.code === '3.3.01').id;
  const a = ok(await carlos.post('/budget/cost-centers', { code: `RA${stamp.slice(-4)}`, name: 'Revisão A', leaderId: carlos.me.user.id }), 201).json().id;
  const b = ok(await carlos.post('/budget/cost-centers', { code: `RB${stamp.slice(-4)}`, name: 'Revisão B', leaderId: carlos.me.user.id }), 201).json().id;
  const mk = async (cc: string, v: number) => {
    const id = ok(await carlos.post('/budget/central/lines', { costCenterId: cc, accountId: acc, what: `Viagem ${v}`, qty: 1, unitCents: v, month, justification: 'Visitas' }), 201).json().items[0].id;
    ok(await carlos.post(`/budget/lines/${id}/submit`, {}));
    ok(await dir.post('/budget/decisions', { items: [{ lineId: id, decision: 'aprovar' }] }));
    return id;
  };
  const l1 = await mk(a, 10_000_00), l2 = await mk(a, 5_000_00), l3 = await mk(b, 3_000_00);
  ok(await carlos.post(`/budget/lines/${l1}/realized`, { occurredOn: `${month}-02`, description: 'Passagens', amountCents: 7_000_00, idempotencyKey: `rv-${stamp}` }), 201);
  // só R$ 3.000 livres em l1
  expect(ok(await carlos.post('/budget/revisions', { kind: 'remanejamento', justification: 'Mover saldo para outra viagem', moves: [{ fromLineId: l1, toLineId: l2, cents: 4_000_00 }] }), 422).json().detail).toMatch(/consumido/);
  const r1 = ok(await carlos.post('/budget/revisions', { kind: 'remanejamento', justification: 'Mover saldo para outra viagem', moves: [{ fromLineId: l1, toLineId: l2, cents: 2_000_00 }] }), 201).json();
  expect(r1.items.reduce((t: number, i: { beforeCents: number; afterCents: number }) => t + i.afterCents - i.beforeCents, 0)).toBe(0);
  expect((await carlos.post(`/budget/revisions/${r1.id}/decide`, { decision: 'aprovar' })).statusCode).toBe(403); // quem pediu não decide
  // duas decisões ao mesmo tempo: aplica uma vez só
  const [x, y] = await Promise.all([dir.post(`/budget/revisions/${r1.id}/decide`, { decision: 'aprovar' }), dir.post(`/budget/revisions/${r1.id}/decide`, { decision: 'aprovar' })]);
  expect([x.statusCode, y.statusCode].sort()).toEqual([200, 422]);
  const g = async (id: string) => ok(await carlos.get(`/budget/lines/${id}`)).json().line;
  expect((await g(l1)).approvedCents).toBe(8_000_00);
  expect((await g(l2)).approvedCents).toBe(7_000_00);
  expect((await g(l1)).firstApprovedCents).toBe(10_000_00); // original preservado
  // entre centros: precisa da Diretoria (a Gerência não decide)
  const email = `ger-rev-${stamp}@yepnet.test`;
  const gu = ok(await carlos.post('/admin/users', { name: 'Gerente Revisão', email, profile: 'gerencia', teamIds: [] }), 201).json();
  const ger = await login(ctx.app, email, gu.temporaryPassword);
  const r2 = ok(await carlos.post('/budget/revisions', { kind: 'remanejamento', justification: 'Apoio entre áreas', moves: [{ fromLineId: l2, toLineId: l3, cents: 1_000_00 }] }), 201).json();
  expect((await ger.post(`/budget/revisions/${r2.id}/decide`, { decision: 'aprovar' })).statusCode).toBe(403);
  ok(await dir.post(`/budget/revisions/${r2.id}/decide`, { decision: 'recusar', note: 'Manter no centro de origem' }));
  // revisão para baixo
  const r3 = ok(await carlos.post('/budget/revisions', { kind: 'revisao', justification: 'Viagem cancelada em parte', changes: [{ lineId: l2, newApprovedCents: 6_000_00 }] }), 201).json();
  ok(await ger.post(`/budget/revisions/${r3.id}/decide`, { decision: 'aprovar' }));
  const list = ok(await carlos.get(`/budget/revisions?year=${year}`)).json().items;
  expect(list.filter((r: { id: string }) => [r1.id, r2.id, r3.id].includes(r.id)).map((r: { status: string }) => r.status).sort()).toEqual(['aprovado', 'aprovado', 'recusado']);
  expect(list[0].version).toBeGreaterThan(list[list.length - 1].version);
  // projeção do ano para o centro A
  const p = ok(await carlos.get(`/budget/projection?year=${year}&costCenterId=${a}`)).json();
  expect(p.months).toHaveLength(12);
  expect(p.totals.approved).toBe(8_000_00 + 6_000_00);
  expect(p.totals.realized).toBe(7_000_00);

  // alterações simultâneas no planejamento: a segunda com versão antiga é recusada (409), nada é sobrescrito
  const draft = ok(await carlos.post('/budget/central/lines', { costCenterId: a, accountId: acc, what: 'Rascunho concorrente', qty: 2, unitCents: 100_00, month }), 201).json().items[0].id;
  const rv = (await g(draft)).rowVersion;
  const [p1, p2] = await Promise.all([carlos.patch(`/budget/lines/${draft}`, { rowVersion: rv, unitCents: 150_00 }), carlos.patch(`/budget/lines/${draft}`, { rowVersion: rv, unitCents: 175_00 })]);
  expect([p1.statusCode, p2.statusCode].sort()).toEqual([200, 409]);
  expect([300_00, 350_00]).toContain((await g(draft)).amountCents);
});
