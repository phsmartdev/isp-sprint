/** Recursos e Orçamento (Política de Orçamento — Anexo I). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const now = new Date();
const year = now.getFullYear();
const quarter = Math.ceil((now.getMonth() + 1) / 3);
const month = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const today = now.toISOString().slice(0, 10);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
let ccMkt = '', ccCom = '', crm = '', midia = '', passagens = '';

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas] = (await Promise.all(['carlos', 'ana', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
});
afterAll(async () => ctx.close());

describe('estrutura: plano de contas e centros de custo', () => {
  it('Diretoria cria a estrutura sugerida e contas novas; código segue a hierarquia; vendedor sem acesso', async () => {
    expect((await lucas.get('/budget/structure')).statusCode).toBe(403);
    expect((await ana.post('/budget/setup')).statusCode).toBe(403);
    expect(ok(await carlos.post('/budget/setup')).json()).toMatchObject({ costCenters: 5 });
    expect(ok(await carlos.post('/budget/setup')).json()).toMatchObject({ accounts: 0, costCenters: 0 }); // idempotente
    const st = ok(await carlos.get('/budget/structure')).json();
    const acc = (code: string) => st.accounts.find((a: { code: string }) => a.code === code);
    crm = acc('3.2.01').id; midia = acc('3.1.01').id; passagens = acc('3.3.01').id;
    expect(acc('3.2')).toMatchObject({ leaf: false, path: 'Despesas da área comercial › Ferramentas' });
    expect((await carlos.post('/budget/accounts', { parentId: acc('3.2').id, code: '3.3.09', name: 'Errada' })).statusCode).toBe(422);
    const n = ok(await carlos.post('/budget/accounts', { parentId: acc('3.2').id, code: '3.2.04', name: 'Inteligência artificial' }), 201).json();
    expect(n.nature).toBe('despesa');
    ccMkt = st.costCenters.find((c: { code: string }) => c.code === 'MKT').id;
    ccCom = st.costCenters.find((c: { code: string }) => c.code === 'COM').id;
    ok(await carlos.patch(`/budget/cost-centers/${ccMkt}`, { leaderId: ana.me.user.id }));
    // líder só vê o próprio centro
    const mine = ok(await ana.get('/budget/structure')).json().costCenters;
    expect(mine.map((c: { code: string }) => c.code)).toEqual(['MKT']);
    expect((await ana.get(`/budget/plan?year=${year}&quarter=${quarter}&costCenterId=${ccCom}`)).statusCode).toBe(403);
  });
});

describe('planejamento trimestral e aprovação da Diretoria', () => {
  let lines: string[] = [];
  it('líder planeja o quê, como e quando; mesmo item em outra categoria é recusado; categoria não recebe lançamento', async () => {
    const a = ok(await ana.post('/budget/plan/lines', { costCenterId: ccMkt, accountId: midia, what: 'Campanha de mídia paga', how: 'Google e LinkedIn', month, amountCents: 1_000_000, itemType: 'midia' }), 201).json();
    const b = ok(await ana.post('/budget/plan/lines', { costCenterId: ccMkt, accountId: crm, what: 'Licença do CRM', month, amountCents: 300_000, itemType: 'software' }), 201).json();
    const c = ok(await ana.post('/budget/plan/lines', { costCenterId: ccMkt, accountId: passagens, what: 'Viagem a feira', month, amountCents: 200_000, itemType: 'viagem' }), 201).json();
    lines = [a.id, b.id, c.id];
    expect((await ana.post('/budget/plan/lines', { costCenterId: ccMkt, accountId: midia, what: 'licença  do crm', month, amountCents: 1000 })).statusCode).toBe(422);
    const st = ok(await carlos.get('/budget/structure')).json();
    const cat = st.accounts.find((x: { code: string }) => x.code === '3.1').id;
    expect((await ana.post('/budget/plan/lines', { costCenterId: ccMkt, accountId: cat, what: 'Na categoria', month, amountCents: 1000 })).json().detail).toMatch(/subcategoria/);
  });
  it('envia; Diretoria recusa um item e aprova o total do centro; plano aprovado não recebe item novo', async () => {
    expect(ok(await ana.post('/budget/plan/submit', { costCenterId: ccMkt, year, quarter })).json()).toMatchObject({ lines: 3, totalCents: 1_500_000 });
    const plan = ok(await ana.get(`/budget/plan?year=${year}&quarter=${quarter}&costCenterId=${ccMkt}`)).json();
    expect(plan.plan.status).toBe('em_aprovacao');
    expect((await ana.post('/budget/plan/decide', { planId: plan.plan.id, decision: 'aprovar' })).statusCode).toBe(403);
    expect((await carlos.post('/budget/plan/decide', { planId: plan.plan.id, lineIds: [lines[2]], decision: 'recusar' })).statusCode).toBe(422); // motivo obrigatório
    ok(await carlos.post('/budget/plan/decide', { planId: plan.plan.id, lineIds: [lines[2]], decision: 'recusar', note: 'Feira fora da estratégia do trimestre' }));
    expect(ok(await carlos.post('/budget/plan/decide', { planId: plan.plan.id, decision: 'aprovar' })).json()).toMatchObject({ lines: 2, totalCents: 1_300_000, planStatus: 'aprovado' });
    expect((await ana.post('/budget/plan/lines', { costCenterId: ccMkt, accountId: midia, what: 'Outra', month, amountCents: 1000 })).json().detail).toMatch(/Budget Guardião/);
    const q = ok(await carlos.get(`/budget/quarter?year=${year}&quarter=${quarter}`)).json();
    expect(q.items.find((i: { costCenter: { code: string } }) => i.costCenter.code === 'MKT')).toMatchObject({ planStatus: 'aprovado', approved: 1_300_000, realized: 0, band: 'subexecucao' });
  });
});

describe('consumo pelo líder, Budget Guardião e revisão mensal', () => {
  it('gasto exige checagem com o Financeiro e saldo; acima do aprovado só com Guardião', async () => {
    const base = { costCenterId: ccMkt, accountId: midia, occurredOn: today, description: 'Mídia LinkedIn (fictício)', paymentMethod: 'cartao_corporativo' };
    expect((await ana.post('/budget/expenses', { ...base, amountCents: 400_000, financeCheck: false })).json().detail).toMatch(/Financeiro/);
    ok(await ana.post('/budget/expenses', { ...base, amountCents: 900_000, financeCheck: true, doc: { name: 'nota.pdf', data: PDF } }), 201);
    const over = await ana.post('/budget/expenses', { ...base, amountCents: 300_000, financeCheck: true });
    expect(over.statusCode).toBe(422);
    expect(over.json().detail).toMatch(/Budget Guardião/);
    // Guardião: até 15% do trimestre do centro (1,3 mi → 195 mil) entra com justificativa
    expect((await ana.post('/budget/adjustments', { costCenterId: ccMkt, accountId: midia, month, deltaCents: 150_000, justification: 'curta' })).statusCode).toBe(422);
    expect(ok(await ana.post('/budget/adjustments', { costCenterId: ccMkt, accountId: midia, month, deltaCents: 150_000, justification: 'Campanha com retorno acima do previsto' }), 201).json()).toMatchObject({ status: 'registrado', needsDirector: false });
    ok(await ana.post('/budget/expenses', { ...base, amountCents: 250_000, financeCheck: true }), 201);
    // acumulado passa de 15%: vai para a Diretoria
    const big = ok(await ana.post('/budget/adjustments', { costCenterId: ccMkt, accountId: midia, month, deltaCents: 100_000, justification: 'Ampliação da campanha para nova região' }), 201).json();
    expect(big).toMatchObject({ status: 'pendente', needsDirector: true });
    expect((await ana.post(`/budget/adjustments/${big.id}/decide`, { approve: true })).statusCode).toBe(403);
    ok(await carlos.post(`/budget/adjustments/${big.id}/decide`, { approve: true, note: 'Ok, região prioritária' }));
    const q = ok(await ana.get(`/budget/quarter?year=${year}&quarter=${quarter}`)).json().items[0];
    expect(q).toMatchObject({ approved: 1_300_000, adjusted: 250_000, planned: 1_550_000, realized: 1_150_000 });
    expect(q.band).toBe('adequada');
  });
  it('revisão do mês aponta desvio acima de 15% por categoria e registra a justificativa; histórico reporta à Diretoria', async () => {
    let r = ok(await ana.get(`/budget/review?costCenterId=${ccMkt}&month=${month}`)).json();
    const ferr = r.items.find((i: { code: string }) => i.code === '3.2');
    expect(ferr).toMatchObject({ planned: 300_000, realized: 0, needsJustification: true });
    expect(r.pending).toBeGreaterThan(0);
    ok(await ana.post('/budget/reviews', { costCenterId: ccMkt, month, accountId: ferr.accountId, justification: 'Licença renovada só no próximo mês' }), 201);
    r = ok(await ana.get(`/budget/review?costCenterId=${ccMkt}&month=${month}`)).json();
    expect(r.items.find((i: { code: string }) => i.code === '3.2').justification).toMatch(/próximo mês/);
    const ev = ok(await carlos.get('/budget/events?limit=50')).json().items.map((e: { summary: string }) => e.summary).join('\n');
    expect(ev).toMatch(/Budget Guardião MKT.*registrado dentro do limite de 15% e reportado/);
    expect(ev).toMatch(/Diretoria recusou 1 item/);
  });
});

describe('recursos: softwares, contratos, ativos e compras', () => {
  it('licença sem senha (Vault), em dólar com cotação, entra no planejamento; compra específica pede Jurídico e Diretoria', async () => {
    const lic = { kind: 'software', costCenterId: ccCom, accountId: crm, name: 'Ferramenta de prospecção (fictícia)', currency: 'USD', amountCents: 10_000, period: 'mensal', startOn: `${year}-01-01`, paymentMethod: 'cartao_corporativo' };
    expect((await carlos.post('/budget/resources', { ...lic, fxRate: 5.4, notes: 'senha: 123456' })).json().detail).toMatch(/Vault/);
    expect((await carlos.post('/budget/resources', lic)).json().detail).toMatch(/cotação/);
    expect((await carlos.post('/budget/resources', { ...lic, fxRate: 5.4, vaultRegistered: true })).json().detail).toMatch(/referência/);
    ok(await carlos.post('/budget/resources', { ...lic, fxRate: 5.4, vaultRegistered: true, vaultRef: 'Comercial/Prospecção' }), 201);
    const list = ok(await carlos.get('/budget/resources?kind=software')).json().items;
    expect(list[0]).toMatchObject({ monthlyBrlCents: 54_000, pending: [] });
    expect(ok(await carlos.post('/budget/plan/import-resources', { costCenterId: ccCom, year, quarter })).json().created).toBe(3);
    expect(ok(await carlos.post('/budget/plan/import-resources', { costCenterId: ccCom, year, quarter })).json().created).toBe(0);
    const p = ok(await carlos.post('/budget/purchases', { costCenterId: ccCom, title: 'Notebooks para o time', specification: 'Notebook 16 GB, SSD 512 GB, garantia de 3 anos', kind: 'especifica', estimatedCents: 3_000_000 }), 201).json();
    expect((await carlos.patch(`/budget/purchases/${p.id}`, { status: 'comprado', financeCheck: true })).json().detail).toMatch(/Jurídico/);
    ok(await carlos.patch(`/budget/purchases/${p.id}`, { financeCheck: true, legalReview: true, directorSigned: true, quotes: [{ supplier: 'Fornecedor Fictício', amountCents: 2_900_000, chosen: true }] }));
    ok(await carlos.patch(`/budget/purchases/${p.id}`, { status: 'comprado' }));
    ok(await carlos.post('/budget/assets', { costCenterId: ccCom, name: 'Notebook 01', tag: 'PAT-0001', category: 'notebook', acquiredOn: `${year - 1}-01-15`, valueCents: 600_000, usefulLifeMonths: 36 }), 201);
    const assets = ok(await carlos.get('/budget/assets')).json().items;
    expect(assets[0].bookValueCents).toBeLessThan(600_000);
    const rep = ok(await carlos.get(`/budget/report?year=${year}&quarter=${quarter}`)).json();
    expect(rep.sectors.map((x: { costCenter: { code: string } }) => x.costCenter.code)).toEqual(expect.arrayContaining(['MKT', 'COM']));
    expect(rep.recurring).toMatchObject({ count: 1, monthlyCents: 54_000, withoutVault: 0 });
    expect(rep.assets.count).toBe(1);
  });
});
