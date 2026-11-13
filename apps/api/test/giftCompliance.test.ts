/** Compliance de brindes, apoios e patrocínios: diretrizes, avaliação, alçadas, segregação, execução sem baixa dupla, conta e prestação de contas. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as s from '../src/db/schema';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client, dir: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
const today = new Date().toISOString().slice(0, 10);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
let accA = '', accB = '', accPub = '', item = '', kit = '';
const base = () => ({ kind: 'kit', purpose: 'relacionamento', description: 'Kit de fim de ano fictício', justification: 'Relacionamento com a conta no encerramento do ano', plannedOn: today, kitId: kit, kits: 1, items: [], estimatedCents: 50_00 });
const req = async (c: Client, id: string) => ok(await c.get(`/brindes/compliance/solicitacoes/${id}`)).json();
const stock = async () => (ok(await carlos.get('/brindes')).json().items as { id: string; stock: number }[]).find((i) => i.id === item)!.stock;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, rafael] = (await Promise.all(['carlos', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const email = `dir-gc-${stamp}@yepnet.test`;
  const u = ok(await carlos.post('/admin/users', { name: 'Diretoria Fictícia', email, profile: 'diretoria', teamIds: [] }), 201).json();
  dir = await login(ctx.app, email, u.temporaryPassword);
  accA = ok(await lucas.post('/contacts', { name: `Conta Privada A ${stamp}`, segment: 'empresarial', phone: '79999991001' }), 201).json().id;
  accB = ok(await lucas.post('/contacts', { name: `Conta Privada B ${stamp}`, segment: 'empresarial', phone: '79999991002' }), 201).json().id;
  accPub = ok(await lucas.post('/contacts', { name: `Órgão Público ${stamp}`, segment: 'governamental', phone: '79999991003' }), 201).json().id;
  await ctx.app.db.update(s.contacts).set({ nature: 'privada' }).where(eq(s.contacts.id, accA));
  await ctx.app.db.update(s.contacts).set({ nature: 'publica' }).where(eq(s.contacts.id, accPub));
  item = ok(await carlos.post('/brindes/itens', { name: `Caneta GC ${stamp}`, unitCostCents: 10_00, initialStock: 10 }), 201).json().id;
  kit = ok(await carlos.post('/brindes/kits', { name: `Kit GC ${stamp}`, items: [{ itemId: item, qty: 2 }] }), 201).json().id;
  ok(await carlos.put('/brindes/compliance/ajustes', { segregation: true, conformingLevel: 'gerencia', channels: {}, policyNote: 'Política fictícia de testes' }));
  const rule = (b: object) => carlos.post('/brindes/compliance/diretrizes', { validFrom: '2020-01-01', changeNote: 'Cadastro inicial (teste)', ...b });
  ok(await rule({ ruleKey: undefined, name: `Valor recomendado ${stamp}`, param: 'valor_por_concessao', controlType: 'orientativa', limitValue: 300_00, kinds: ['kit'] }), 201);
  ok(await rule({ name: `Patrocínio a ente público ${stamp}`, param: 'condicao', controlType: 'restricao', natures: ['publica'], kinds: ['patrocinio_financeiro'] }), 201);
});
afterAll(async () => {
  // as diretrizes valem para a empresa toda: desliga as do teste para não afetar outros testes
  const rules = ok(await carlos.get('/brindes/compliance/diretrizes')).json().rules as { ruleKey: string; version: number; name: string; param: string; controlType: string; limitValue: number | null; natures: string[]; kinds: string[] }[];
  for (const r of rules.filter((x) => x.name.includes(stamp) || x.ruleKey.startsWith('politica-'))) {
    const latest = rules.filter((x) => x.ruleKey === r.ruleKey).sort((a, b) => b.version - a.version)[0]!;
    if (latest.version !== r.version) continue;
    await ctx.app.db.update(s.giftComplianceRules).set({ active: false }).where(eq(s.giftComplianceRules.ruleKey, r.ruleKey));
  }
  await ctx.close();
});

describe('compliance de concessões', () => {
  it('operação solicita; avaliação conforme; gestão aprova; reserva; execução baixa o estoque uma vez e registra na conta', async () => {
    const pre = ok(await lucas.post('/brindes/compliance/avaliar', { ...base(), accounts: [{ contactId: accA }] })).json();
    expect(pre.evaluation.outcome).toBe('conforme');
    expect(pre.level).toBe('gerencia');
    const r = ok(await lucas.post('/brindes/compliance/solicitacoes', { ...base(), accounts: [{ contactId: accA }] }), 201).json();
    expect(r.code).toMatch(/^GC-\d{4}-\d{4}$/);
    expect(r).toMatchObject({ state: 'solicitado', outcome: 'conforme' });
    // quem solicitou não decide; outro operador nem vê
    expect((await lucas.post(`/brindes/compliance/solicitacoes/${r.id}/decidir`, { decision: 'aprovar', rowVersion: r.rowVersion })).statusCode).toBe(403);
    expect((await rafael.get(`/brindes/compliance/solicitacoes/${r.id}`)).statusCode).toBe(404);
    const a = ok(await carlos.post(`/brindes/compliance/solicitacoes/${r.id}/decidir`, { decision: 'aprovar', rowVersion: r.rowVersion })).json();
    expect(a.state).toBe('aprovado');
    // aprovado não é saída de estoque
    expect(await stock()).toBe(10);
    ok(await lucas.post(`/brindes/compliance/solicitacoes/${r.id}/reservar`));
    expect(await stock()).toBe(10);
    const e1 = ok(await lucas.post(`/brindes/compliance/solicitacoes/${r.id}/executar`, { executedOn: today })).json();
    expect(e1.state).toBe('executado');
    expect(await stock()).toBe(8);
    // reprocessamento não baixa de novo
    ok(await lucas.post(`/brindes/compliance/solicitacoes/${r.id}/executar`, { executedOn: today }));
    expect(await stock()).toBe(8);
    const acc = ok(await lucas.get(`/accounts/${accA}/brindes`)).json();
    expect(acc.concessions.find((c: { id: string }) => c.id === r.id)).toMatchObject({ state: 'executado', shareCents: 50_00, approverName: 'Carlos Silva' });
    expect(acc.concessionSummary.executed).toBeGreaterThanOrEqual(1);
    // sem comprovante: pendência documental; com comprovante, sai
    let d = ok(await carlos.get(`/brindes/compliance?from=${today}&to=${today}`)).json();
    expect(d.pendencies.some((p: { requestId: string }) => p.requestId === r.id)).toBe(true);
    ok(await lucas.post(`/brindes/compliance/solicitacoes/${r.id}/documentos`, { kind: 'comprovante', name: 'entrega.pdf', mime: 'application/pdf', data: PDF }), 201);
    d = ok(await carlos.get(`/brindes/compliance?from=${today}&to=${today}`)).json();
    expect(d.pendencies.some((p: { requestId: string }) => p.requestId === r.id)).toBe(false);
    expect(d.rows.find((x: { id: string }) => x.id === r.id).complete).toBe(true);
    // estorno devolve o estoque
    ok(await lucas.post(`/brindes/compliance/solicitacoes/${r.id}/cancelar`, { reason: 'Evento adiado (teste)' }));
    expect(await stock()).toBe(10);
    expect((await req(carlos, r.id)).events.map((e: { type: string }) => e.type)).toContain('estornada');
  });

  it('acima do recomendado: exceção com fundamentação; rateio sem dupla contagem; mudança material reavalia', async () => {
    const r = ok(await lucas.post('/brindes/compliance/solicitacoes', { ...base(), estimatedCents: 400_01, accounts: [{ contactId: accA }, { contactId: accB }] }), 201).json();
    expect(r.outcome).toBe('excecao');
    let det = await req(carlos, r.id);
    expect(det.accounts.map((a: { shareCents: number }) => a.shareCents).reduce((t: number, x: number) => t + x, 0)).toBe(400_01);
    expect(det.evaluation.findings[0].message).toMatch(/ultrapassa o recomendado/);
    expect(det.can.decide).toEqual(['aprovar_excecao', 'ajustes', 'rejeitar']);
    expect((await carlos.post(`/brindes/compliance/solicitacoes/${r.id}/decidir`, { decision: 'aprovar', rowVersion: r.rowVersion })).statusCode).toBe(403);
    expect((await carlos.post(`/brindes/compliance/solicitacoes/${r.id}/decidir`, { decision: 'aprovar_excecao', reason: 'curto', rowVersion: r.rowVersion })).statusCode).toBe(422);
    const a = ok(await carlos.post(`/brindes/compliance/solicitacoes/${r.id}/decidir`, { decision: 'aprovar_excecao', reason: 'Conta estratégica em renovação; aprovado só para esta solicitação', conditions: 'Entregar na reunião de renovação', rowVersion: r.rowVersion })).json();
    expect(a).toMatchObject({ state: 'aprovado', exception: true });
    // rateio informado que não soma o total é recusado
    expect((await lucas.patch(`/brindes/compliance/solicitacoes/${r.id}`, { ...base(), estimatedCents: 400_01, accounts: [{ contactId: accA, shareCents: 100 }, { contactId: accB, shareCents: 100 }], rowVersion: a.rowVersion })).statusCode).toBe(422);
    // versão desatualizada
    expect((await lucas.patch(`/brindes/compliance/solicitacoes/${r.id}`, { ...base(), estimatedCents: 450_00, accounts: [{ contactId: accA }], rowVersion: a.rowVersion - 1 })).statusCode).toBe(409);
    const u = ok(await lucas.patch(`/brindes/compliance/solicitacoes/${r.id}`, { ...base(), estimatedCents: 450_00, accounts: [{ contactId: accA }], rowVersion: a.rowVersion })).json();
    expect(u).toMatchObject({ state: 'solicitado', exception: false, approvedCents: null });
    det = await req(carlos, r.id);
    expect(det.decisions).toHaveLength(1);
    expect(det.events.map((e: { type: string }) => e.type)).toContain('reautorizacao');
  });

  it('restrição obrigatória impede; ninguém aprova por autorização gerencial; segregação vale para a gestão', async () => {
    const r = ok(await lucas.post('/brindes/compliance/solicitacoes', { kind: 'patrocinio_financeiro', purpose: 'evento', eventName: 'Evento fictício', description: 'Patrocínio de evento', justification: 'Presença da marca no evento do órgão', plannedOn: today, estimatedCents: 1_000_00, accounts: [{ contactId: accPub }] }), 201).json();
    expect(r.outcome).toBe('impedido');
    for (const c of [carlos, dir]) expect((await c.post(`/brindes/compliance/solicitacoes/${r.id}/decidir`, { decision: 'aprovar_excecao', reason: 'Tentativa de afastar restrição obrigatória', rowVersion: r.rowVersion })).statusCode).toBe(403);
    ok(await dir.post(`/brindes/compliance/solicitacoes/${r.id}/decidir`, { decision: 'ajustes', reason: 'Sem tratamento formal compatível', rowVersion: r.rowVersion }));
    const own = ok(await carlos.post('/brindes/compliance/solicitacoes', { ...base(), accounts: [{ contactId: accA }] }), 201).json();
    // pedido da Gestão comercial sobe para a Diretoria (nível acima de quem pediu)
    expect(own.approvalLevel).toBe('diretoria');
    const det = await req(carlos, own.id);
    expect(det.level).toBe('diretoria');
    expect(det.can.decide).toEqual([]);
    expect(det.can.decideReason).toMatch(/Diretoria/);
    expect((await carlos.post(`/brindes/compliance/solicitacoes/${own.id}/decidir`, { decision: 'aprovar', rowVersion: own.rowVersion })).statusCode).toBe(403);
    // fica pendente na tela da Diretoria, habilitado só para ela
    const pend = ok(await dir.get('/brindes/compliance')).json().rows.find((x: { id: string }) => x.id === own.id);
    expect(pend).toMatchObject({ state: 'solicitado', approvalLevel: 'diretoria', canDecide: true });
    expect(ok(await carlos.get('/brindes/compliance')).json().rows.find((x: { id: string }) => x.id === own.id).canDecide).toBe(false);
    ok(await dir.post(`/brindes/compliance/solicitacoes/${own.id}/decidir`, { decision: 'aprovar', rowVersion: own.rowVersion }));
    // pedido da operação: Gestão comercial decide e vê pendente mesmo sem ser do time de quem pediu
    const op = ok(await lucas.post('/brindes/compliance/solicitacoes', { ...base(), accounts: [{ contactId: accA }] }), 201).json();
    expect(op.approvalLevel).toBe('gerencia');
    expect(ok(await carlos.get('/brindes/compliance')).json().rows.find((x: { id: string }) => x.id === op.id).canDecide).toBe(true);
    // a própria Diretoria pedindo: outra pessoa da Diretoria decide
    const dOwn = ok(await dir.post('/brindes/compliance/solicitacoes', { ...base(), accounts: [] , institutionalClass: 'Evento setorial fictício' }), 201).json();
    expect(dOwn.approvalLevel).toBe('diretoria');
    expect((await dir.post(`/brindes/compliance/solicitacoes/${dOwn.id}/decidir`, { decision: 'aprovar', rowVersion: dOwn.rowVersion })).statusCode).toBe(403);
  });

  it('diretrizes versionadas: só administrador configura; decisão guarda a versão da época', async () => {
    expect((await lucas.post('/brindes/compliance/diretrizes', { name: 'Tentativa da operação', param: 'valor_por_concessao', controlType: 'orientativa', limitValue: 1, validFrom: today, changeNote: 'tentativa' })).statusCode).toBe(403);
    const list = ok(await carlos.get('/brindes/compliance/diretrizes')).json();
    const r1 = list.rules.find((r: { name: string }) => r.name === `Valor recomendado ${stamp}`);
    expect((await carlos.post('/brindes/compliance/diretrizes', { ruleKey: r1.ruleKey, name: r1.name, param: 'valor_por_concessao', controlType: 'orientativa', validFrom: '2020-01-01', changeNote: 'sem limite' })).statusCode).toBe(422);
    const v2 = ok(await carlos.post('/brindes/compliance/diretrizes', { ruleKey: r1.ruleKey, name: r1.name, param: 'valor_por_concessao', controlType: 'orientativa', limitValue: 1_000_00, kinds: ['kit'], validFrom: '2020-01-01', changeNote: 'Política revisada (teste)' }), 201).json();
    expect(v2.version).toBe(2);
    const pre = ok(await lucas.post('/brindes/compliance/avaliar', { ...base(), estimatedCents: 400_00, accounts: [{ contactId: accA }] })).json();
    expect(pre.evaluation.outcome).toBe('conforme');
  });

  it('política carregada: categoria por kit, matriz IA/INA/NIA/NINA, situação de atenção detectada e registro dos destinatários', async () => {
    expect((await lucas.post('/brindes/compliance/diretrizes/politica')).statusCode).toBe(403);
    const r = ok(await carlos.post('/brindes/compliance/diretrizes/politica')).json();
    expect(r.created + r.skipped).toBe(7);
    expect(ok(await carlos.post('/brindes/compliance/diretrizes/politica')).json().created).toBe(0);
    const rules = ok(await carlos.get('/brindes/compliance/diretrizes')).json().rules;
    expect(rules.find((x: { ruleKey: string }) => x.ruleKey === 'politica-cat-a').limitValue).toBe(400_00);
    const acc = ok(await lucas.post('/contacts', { name: `Conta Política ${stamp}`, segment: 'empresarial', phone: '79999991004' }), 201).json().id;
    const person = ok(await lucas.post(`/accounts/${acc}/stakeholders`, { person: { name: `Pessoa NIA ${stamp}` }, title: 'Analista', powerClass: 'nia' }), 201).json();
    const sid = person.id ?? person.stakeholder?.id;
    const body = { ...base(), kitCategory: 'B', kits: 1, estimatedCents: 200_00, stakeholderIds: [sid], accounts: [{ contactId: acc }] };
    const pre = ok(await lucas.post('/brindes/compliance/avaliar', body)).json();
    expect(pre.evaluation.outcome).toBe('excecao');
    expect(pre.evaluation.findings.map((f: { ruleKey: string }) => f.ruleKey)).toContain('politica-matriz');
    const ok2 = ok(await lucas.post('/brindes/compliance/avaliar', { ...body, kitCategory: 'C', estimatedCents: 140_00 })).json();
    expect(ok2.evaluation.outcome).toBe('conforme');
    expect(ok(await lucas.post('/brindes/compliance/avaliar', { ...body, kitCategory: 'C', estimatedCents: 160_00 })).json().evaluation.findings.map((f: { ruleKey: string }) => f.ruleKey)).toContain('politica-cat-c');
    const att = ok(await lucas.post('/brindes/compliance/avaliar', { ...body, kitCategory: 'C', estimatedCents: 140_00, attention: ['renovacao'] })).json();
    expect(att.evaluation.outcome).toBe('autorizacao');
    const created = ok(await lucas.post('/brindes/compliance/solicitacoes', { ...body, kitCategory: 'C', estimatedCents: 140_00 }), 201).json();
    expect(created.recipients[0]).toMatchObject({ name: `Pessoa NIA ${stamp}`, title: 'Analista', powerClass: 'nia' });
    // entrega coletiva exige descrever o grupo
    expect((await lucas.post('/brindes/compliance/avaliar', { ...body, stakeholderIds: [], collective: true, audience: '' })).statusCode).toBe(422);
  });

  it('prestação de contas: PDF guardado com versão; só gestão emite', async () => {
    expect((await lucas.post('/brindes/compliance/prestacoes', { from: today, to: today })).statusCode).toBe(403);
    const r = ok(await carlos.post('/brindes/compliance/prestacoes', { from: today, to: today, analysis: 'Período de testes fictício.', evidences: true }), 201).json();
    expect(r.code).toMatch(/^PC-\d{4}-\d{3}$/);
    const r2 = ok(await carlos.post('/brindes/compliance/prestacoes', { from: today, to: today }), 201).json();
    expect(r2.version).toBe(r.version + 1);
    const pdf = await carlos.get(`/brindes/compliance/prestacoes/${r.id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    if (process.env.GC_PDF_OUT) (await import('node:fs')).writeFileSync(process.env.GC_PDF_OUT, pdf.rawPayload);
    const list = ok(await carlos.get('/brindes/compliance/prestacoes')).json();
    expect(list.items.find((x: { id: string }) => x.id === r.id)).toMatchObject({ sha256: r.sha256 });
  });
});
