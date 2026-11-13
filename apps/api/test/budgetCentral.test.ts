/** Central do orçamento: ciclo completo do lançamento (critérios de aceite do prompt master). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, dir: Client, fin: Client, gestor: Client, lucas: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const year = new Date().getFullYear();
const month = `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const stamp = Date.now().toString(36);
let cc = '', other = '', acc = '', lineId = '';
const line = async (c: Client = ana) => ok(await c.get(`/budget/lines/${lineId}`)).json();

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas] = (await Promise.all(['carlos', 'ana', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const teamId = (await carlos.get('/admin/users')).json().teams[0].id as string;
  const mk = async (profile: string, extra: object = {}) => {
    const email = `${profile}-oc-${stamp}-${Math.random().toString(36).slice(2, 6)}@yepnet.test`;
    const u = ok(await carlos.post('/admin/users', { name: `Pessoa Fictícia ${profile}`, email, profile, teamIds: [teamId], ...(profile === 'supervisor' ? { leadTeamIds: [teamId] } : {}), ...extra }), 201).json();
    return login(ctx.app, email, u.temporaryPassword);
  };
  dir = await mk('diretoria');
  fin = await mk('supervisor', { sectors: ['financeiro'], sectorRole: 'operador' });
  gestor = await mk('supervisor');
  ok(await carlos.post('/budget/setup'));
  const st = ok(await carlos.get('/budget/structure')).json();
  acc = st.accounts.find((a: { code: string }) => a.code === '3.1.03').id; // Brindes e materiais impressos
  cc = ok(await carlos.post('/budget/cost-centers', { code: `OC${stamp.slice(-4)}`, name: 'Centro Fictício', leaderId: ana.me.user.id, executorIds: [ana.me.user.id] }), 201).json().id;
  other = ok(await carlos.post('/budget/cost-centers', { code: `OX${stamp.slice(-4)}`, name: 'Outro Centro' }), 201).json().id;
  ok(await carlos.patch(`/budget/cost-centers/${cc}`, { managerId: gestor.me.user.id }));
});
afterAll(async () => ctx.close());

describe('planejamento, aprovação e governança', () => {
  it('responsável planeja por quantidade no próprio centro; não planeja em centro alheio; operação sem acesso', async () => {
    const r = ok(await ana.post('/budget/central/lines', { costCenterId: cc, accountId: acc, what: 'Brindes para evento de clientes', qty: 500, unit: 'un', unitCents: 40_00, month, justification: 'Evento anual com contas estratégicas', objective: 'Relacionamento' }), 201).json();
    lineId = r.items[0].id;
    expect(r.items[0]).toMatchObject({ amountCents: 20_000_00 });
    expect(r.items[0].code).toMatch(new RegExp(`^ORC-${year}-\\d{4}$`));
    expect((await ana.post('/budget/central/lines', { costCenterId: other, accountId: acc, what: 'Fora do meu centro', qty: 1, unitCents: 100, month })).statusCode).toBe(403);
    expect((await lucas.get(`/budget/central?year=${year}`)).statusCode).toBe(403);
    const l = await line();
    expect(l.line).toMatchObject({ approvalState: 'planejado', qty: '500', unitCents: 4000 });
  });

  it('recorrente cria um lançamento por mês, sem duplicar o código', async () => {
    const r = ok(await ana.post('/budget/central/lines', { costCenterId: cc, accountId: acc, what: 'Assinatura de banco de imagens', qty: 1, unitCents: 300_00, month, recurrenceMonths: 3, justification: 'Uso contínuo' }), 201).json();
    expect(r.items).toHaveLength(3);
    expect(new Set(r.items.map((i: { code: string }) => i.code)).size).toBe(3);
  });

  it('diretoria questiona quantidade e valor; aprovação fica travada até o responsável responder', async () => {
    ok(await ana.post(`/budget/lines/${lineId}/submit`, {}));
    expect((await line()).line).toMatchObject({ approvalState: 'enviado', approvalStage: 'gerencia' });
    // a gerência recomenda e envia à diretoria
    expect(ok(await carlos.post('/budget/decisions', { items: [{ lineId, decision: 'aprovar' }] })).json().decided[0].state).toBe('em_analise');
    const q = ok(await dir.post('/budget/questions', { lineId, kind: 'quantidade', message: 'Precisa mesmo de 500 unidades?' }), 201).json();
    ok(await dir.post('/budget/questions', { lineId, kind: 'valor_unitario', message: 'R$ 40 por unidade está acima do mercado?', blocking: false }), 201);
    expect((await line()).line.approvalState).toBe('questionado');
    const blocked = ok(await dir.post('/budget/decisions', { items: [{ lineId, decision: 'aprovar' }] })).json();
    expect(blocked.blocked[0].reason).toMatch(/questionamento/);
    expect((await lucas.post(`/budget/questions/${q.id}/answer`, { answer: 'x' })).statusCode).toBe(403);
    ok(await ana.post(`/budget/questions/${q.id}/answer`, { answer: 'Sim: 450 convidados e 50 de reserva.' }));
    expect((await line()).line.approvalState).toBe('em_analise');
  });

  it('quem pediu não decide; diretoria aprova com valor-alvo e valor-limite no mesmo lançamento', async () => {
    expect((await ana.post('/budget/decisions', { items: [{ lineId, decision: 'aprovar' }] })).statusCode).toBe(403); // supervisão não aprova
    expect(ok(await carlos.post('/budget/decisions', { items: [{ lineId, decision: 'aprovar' }] })).json().blocked[0].reason).toMatch(/alçada/);
    const bad = ok(await dir.post('/budget/decisions', { items: [{ lineId, decision: 'aprovar_condicoes', approvedCents: 18_000_00, limitCents: 19_000_00, conditions: 'x' }] })).json();
    expect(bad.blocked[0].reason).toMatch(/limite/);
    const r = ok(await dir.post('/budget/decisions', { items: [{ lineId, decision: 'aprovar_condicoes', approvedCents: 18_000_00, targetUnitCents: 35_00, limitCents: 18_000_00, conditions: 'Negociar com fornecedor e preservar a qualidade' }] })).json();
    expect(r.decided[0].state).toBe('aprovado_ressalvas');
    const l = await line();
    expect(l.line).toMatchObject({ id: lineId, approvedCents: 18_000_00, limitCents: 18_000_00, targetUnitCents: 35_00, firstApprovedCents: 18_000_00, status: 'aprovado' });
    expect(l.figures).toMatchObject({ planned: 20_000_00, approved: 18_000_00, reserved: 18_000_00 });
    expect(l.events.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['criado', 'enviado', 'aprovado_gerencia', 'questionado', 'respondido', 'aprovar_condicoes']));
  });
});

describe('execução, Budget Guardião e financeiro', () => {
  it('bloqueia comprometer acima do autorizado; registra fornecedor e documentos', async () => {
    const l = await line();
    const over = await ana.post(`/budget/lines/${lineId}/execution`, { rowVersion: l.line.rowVersion, contractedCents: 19_000_00 });
    expect(over.statusCode).toBe(422);
    expect(over.json().detail).toMatch(/Budget Guardião/);
    const sup = ok(await carlos.post('/budget/suppliers', { name: `Fornecedor Fictício ${stamp}` }), 201).json();
    ok(await ana.post(`/budget/lines/${lineId}/execution`, { rowVersion: l.line.rowVersion, supplierId: sup.id, quoteCents: 17_000_00, negotiatedCents: 16_500_00, contractedCents: 16_500_00, contractedQty: 500, contractedOn: `${month}-05`, poNumber: 'PC-001' }));
    ok(await ana.post(`/budget/lines/${lineId}/documents`, { kind: 'cotacao', doc: { name: 'cotacao.pdf', data: PDF } }), 201);
    const n = await line();
    expect(n.line).toMatchObject({ executionState: 'comprometido', contractedCents: 16_500_00, poNumber: 'PC-001' });
    expect(n.figures).toMatchObject({ committed: 16_500_00, reserved: 1_500_00, balance: 1_500_00 });
    expect(n.documents).toHaveLength(1);
  });

  it('Budget Guardião exige decisão da diretoria e consome a reserva sem duplicar em pedidos simultâneos', async () => {
    ok(await dir.put('/budget/policy', { alertPct: 90, blockPct: 100, reserveMode: 'centro', globalReserveCents: null, centers: [{ id: cc, alertPct: null, blockPct: null, guardianReserveCents: 1_000_00 }] }));
    const a = ok(await ana.post(`/budget/lines/${lineId}/guardian`, { deltaCents: 800_00, justification: 'Frete adicional cobrado pelo fornecedor' }), 201).json();
    const b = ok(await ana.post(`/budget/lines/${lineId}/guardian`, { deltaCents: 800_00, justification: 'Segundo pedido simultâneo de frete' }), 201).json();
    expect((await ana.post(`/budget/guardian/${a.id}/decide`, { decision: 'aprovar' })).statusCode).toBe(403);
    const [ra, rb] = await Promise.all([dir.post(`/budget/guardian/${a.id}/decide`, { decision: 'aprovar' }), dir.post(`/budget/guardian/${b.id}/decide`, { decision: 'aprovar' })]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 422]); // reserva de R$ 1.000 só cobre um
    const l = await line();
    expect(l.line).toMatchObject({ approvedCents: 18_800_00, limitCents: 18_800_00 });
  });

  it('financeiro: só o setor Financeiro registra; parcelas, pagamento parcial, juros, duplicidade e estorno', async () => {
    expect((await ana.post(`/budget/lines/${lineId}/payables`, { amountCents: 100, competence: month, firstDueOn: `${month}-10`, externalId: 'x-1' })).statusCode).toBe(403);
    const body = { invoiceNumber: '1234', amountCents: 16_500_00, competence: month, firstDueOn: `${year - 1}-12-10`, installments: 2, externalId: `nf-1234-${stamp}` };
    const t = ok(await fin.post(`/budget/lines/${lineId}/payables`, body), 201).json();
    expect(t.items.map((i: { amountCents: number }) => i.amountCents)).toEqual([8_250_00, 8_250_00]);
    expect(ok(await fin.post(`/budget/lines/${lineId}/payables`, body)).json().duplicate).toBe(true); // reenvio não duplica
    const p1 = t.items[0].id;
    const pay = { paidOn: `${year - 1}-12-20`, amountCents: 8_250_00, interestCents: 30_00, fineCents: 165_00, method: 'boleto', idempotencyKey: `pg-${stamp}-1`, proof: { name: 'comprovante.pdf', data: PDF } };
    const [x, y] = await Promise.all([fin.post(`/budget/payables/${p1}/payments`, pay), fin.post(`/budget/payables/${p1}/payments`, pay)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 201]); // a mesma chave não paga duas vezes
    expect((await fin.post(`/budget/payables/${p1}/payments`, { ...pay, idempotencyKey: `pg-${stamp}-2` })).statusCode).toBe(422); // passa do saldo
    ok(await fin.post(`/budget/payables/${t.items[1].id}/payments`, { paidOn: `${year - 1}-12-01`, amountCents: 4_000_00, idempotencyKey: `pg-${stamp}-3` }), 201);
    let l = await line();
    const [a, b] = l.payables;
    expect(a.flags).toEqual(['pago', 'pago_atraso', 'pago_com_juros']);
    expect(b.flags).toEqual(['parcial', 'vencido']);
    expect(l.figures).toMatchObject({ paid: 12_250_00, charges: 195_00 });
    expect(l.financial).toBe('vencido');
    const pid = a.payments[0].id;
    ok(await fin.post(`/budget/payments/${pid}/reverse`, { reason: 'Pagamento em duplicidade no banco', paidOn: `${year - 1}-12-21` }));
    expect((await fin.post(`/budget/payments/${pid}/reverse`, { reason: 'De novo', paidOn: `${year - 1}-12-21` })).statusCode).toBe(422);
    l = await line();
    expect(l.figures.paid).toBe(4_000_00);
    expect(l.payables[0].flags).toEqual(['estornado', 'vencido']);
  });

  it('central: indicadores do período, visão por centro e permissões', async () => {
    const c = ok(await dir.get(`/budget/central?year=${year}&costCenterId=${cc}`)).json();
    const row = c.rows.find((r: { id: string }) => r.id === lineId);
    expect(row).toMatchObject({ approved: 18_800_00, committed: 16_500_00, paid: 4_000_00, approvalState: 'aprovado_ressalvas', financial: 'vencido' });
    expect(c.kpis.approved).toBeGreaterThanOrEqual(18_800_00);
    expect(c.kpis.excessAuthorized).toBe(0); // excedente do lançamento já está no aprovado da linha
    expect(c.kpis.guardianBalance).toBe(200_00);
    expect(c.series.length).toBe(12);
    // gestor do centro vê só o que está sob a sua gestão; responsável não vê centro alheio
    const g = ok(await gestor.get(`/budget/central?year=${year}`)).json();
    expect(g.options.costCenters.map((x: { id: string }) => x.id)).toContain(cc);
    expect(g.options.costCenters.map((x: { id: string }) => x.id)).not.toContain(other);
    expect(ok(await ana.get(`/budget/central?year=${year}`)).json().options.costCenters.map((x: { id: string }) => x.id)).not.toContain(other);
    // planejamento aprovado não muda mais
    const l = await line();
    expect((await ana.patch(`/budget/lines/${lineId}`, { rowVersion: l.line.rowVersion, unitCents: 1 })).statusCode).toBe(422);
  });
});
