/** Gestão de Contratos: do contrato assinado na oportunidade ao arquivamento, com versões, setores, alertas e documentos. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addDays, endFromTerm } from '@isp/domain';
import { setTransportFactory } from '../src/services/email';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client, rafael: Client, mariana: Client;
const sent: { to: string; cc?: string; subject: string; attachments?: unknown[] }[] = [];
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n% contrato ficticio\n').toString('base64')}`;
const today = new Date().toISOString().slice(0, 10);
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, ana, rafael, mariana] = (await Promise.all(['carlos', 'lucas', 'ana', 'rafael', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client, Client];
  setTransportFactory(() => ({ sendMail: async (m: { to: string; cc?: string; subject: string; attachments?: unknown[] }) => { sent.push(m); return { messageId: `m${sent.length}` }; } }) as never);
  ok(await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', password: 'x', fromName: 'Yepnet', fromEmail: 'vendas@yepnet.test', replyTo: null, enabled: true }));
  const users = (await carlos.get('/admin/users')).json().users as { id: string; email: string }[];
  const id = (e: string) => users.find((u) => u.email === e)!.id;
  ok(await carlos.patch(`/admin/users/${id('ana@yepnet.test')}`, { sectors: ['financeiro'] }));
  ok(await carlos.patch(`/admin/users/${id('rafael@yepnet.test')}`, { sectors: ['inteligencia_comercial'] }));
  ok(await carlos.patch(`/admin/users/${id('mariana@yepnet.test')}`, { sectors: ['implantacao', 'sucesso_cliente'] }));
  [ana, rafael, mariana] = (await Promise.all(['ana', 'rafael', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
});
afterAll(async () => {
  await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', fromName: 'Yepnet', fromEmail: 'vendas@yepnet.test', replyTo: null, enabled: false });
  setTransportFactory(null);
  await ctx.close();
});

async function wonOpportunity(name: string, segment = 'empresarial') {
  const plan = (await lucas.get('/meta/lookups')).json().plans[0];
  const o = ok(await lucas.post('/opportunities', { newContact: { name, segment }, planId: plan.id }), 201).json();
  return { o, plan, won: async () => ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion })) };
}
const step = (c: Client, id: string, pid: string, key: string, body: object) => c.post(`/contracts/${id}/processes/${pid}/steps/${key}`, body);
const detail = async (id: string) => (await carlos.get(`/contracts/${id}`)).json();
const proc = async (id: string, kind: string) => (await detail(id)).processes.find((p: { kind: string; status: string }) => p.kind === kind && p.status === 'aberto');

describe('contrato privado: oportunidade → implantação → renovação → reajuste', () => {
  let contractId = '', oppId = '';

  it('só cadastra a partir de oportunidade concluída, com dados do CRM e sem copiar o cliente', async () => {
    const w = await wonOpportunity('Empresa Contrato Fictícia LTDA');
    oppId = w.o.id;
    expect((await mariana.get(`/contracts/prefill?opportunityId=${oppId}`)).statusCode).toBe(404);
    const pre1 = (await lucas.get(`/contracts/prefill?opportunityId=${oppId}`)).json();
    expect(pre1.won).toBe(false);
    const base = { commercialOwnerId: lucas.me.user.id, version: { number: 'CT-PRIV-001', object: 'Link dedicado fictício', items: pre1.suggestion.version.items, monthlyCents: 150_000 } };
    expect((await lucas.post('/contracts', { ...base, opportunityId: oppId })).statusCode).toBe(422);
    await w.won();
    const pre = (await lucas.get(`/contracts/prefill?opportunityId=${oppId}`)).json();
    expect(pre.won).toBe(true);
    expect(pre.client.name).toBe('Empresa Contrato Fictícia LTDA');
    expect(pre.suggestion.version.items.length).toBeGreaterThan(0);
    const r = ok(await lucas.post('/contracts', { ...base, opportunityId: oppId }), 201);
    contractId = r.json().id;
    expect((await lucas.post('/contracts', { ...base, opportunityId: oppId })).statusCode).toBe(422);
    const d = await detail(contractId);
    expect(d.stage).toBe('cadastro_validacao');
    expect(d.contact.name).toBe('Empresa Contrato Fictícia LTDA');
    expect(d.current.version).toBe(1);
  });

  it('validação: completa o cadastro, separa as datas e dispara ERP, Financeiro, implantação e Sucesso do Cliente', async () => {
    expect((await lucas.post(`/contracts/${contractId}/validate`)).statusCode).toBe(403);
    const miss = await carlos.post(`/contracts/${contractId}/validate`);
    expect(miss.statusCode).toBe(422);
    expect(miss.json().detail).toContain('data de assinatura');
    ok(await lucas.put(`/contracts/${contractId}`, { version: { signedAt: addDays(today, -10), startAt: addDays(today, -5), termMonths: 12, adjustmentIndex: 'IPCA', adjustmentBaseDate: addDays(today, -5) } }));
    const d = await detail(contractId);
    expect(d.current.version).toBe(2);
    expect(d.current.endAt).toBe(endFromTerm(addDays(today, -5), 12));
    expect(d.current.renewalAt).toBe(addDays(endFromTerm(addDays(today, -5), 12), 1));
    expect(d.current.activationAt).toBeNull();
    expect(d.current.billingStartAt).toBeNull();
    sent.length = 0;
    const v = ok(await carlos.post(`/contracts/${contractId}/validate`)).json();
    expect(v.erp.status).toBe('pendente_integracao');
    expect(v.provisioning.emails.map((e: { to: string; status: string }) => `${e.to}:${e.status}`)).toEqual(['ana@yepnet.test:enviado']);
    expect(v.delivery.emails.map((e: { to: string }) => e.to)).toEqual(['mariana@yepnet.test']);
    expect(sent.some((m) => m.subject.startsWith('Provisionamento de faturamento – Contrato CT-PRIV-001'))).toBe(true);
    const after = await detail(contractId);
    expect(after.stage).toBe('implantacao');
    expect(after.alerts.map((a: { kind: string }) => a.kind).sort()).toEqual(['documento_pendente', 'implantacao', 'provisionamento']);
    const opp = (await carlos.get(`/opportunities/${oppId}`)).json();
    expect(opp.handoffStage ?? (await ctx.app.db.execute(sql`select handoff_stage from opportunities where id = ${oppId}`)).rows[0]!.handoff_stage).toBe('sucesso_cliente');
    const evs = (await ctx.app.db.execute<{ type: string }>(sql`select type from opportunity_events where opportunity_id = ${oppId}`)).rows.map((r) => r.type);
    expect(evs).toEqual(expect.arrayContaining(['contrato_cadastrado', 'contrato_validado', 'erp_solicitado', 'provisionamento_solicitado', 'sucesso_cliente']));
    const tasks = (await ctx.app.db.execute<{ title: string }>(sql`select a.title from activities a join users u on u.id = a.owner_id where u.email = 'ana@yepnet.test' and a.contract_id = ${contractId}`)).rows.map((r) => r.title);
    expect(tasks.sort()).toEqual(['Cadastrar/atualizar no ERP: contrato CT-PRIV-001 – Empresa Contrato Fictícia LTDA', 'Provisionar faturamento: contrato CT-PRIV-001 – Empresa Contrato Fictícia LTDA']);
  });

  it('implantação: cada etapa pelo setor certo; ativação e faturamento viram novas versões', async () => {
    const p = await proc(contractId, 'implantacao');
    expect((await step(lucas, contractId, p.id, 'provisionamento', { note: 'ok' })).statusCode).toBe(403);
    ok(await step(ana, contractId, p.id, 'provisionamento', { note: 'Provisionado no faturamento de novembro' }));
    expect((await step(carlos, contractId, p.id, 'erp_cadastro', {})).statusCode).toBe(422);
    ok(await step(carlos, contractId, p.id, 'erp_cadastro', { value: { ref: 'ERP-7788' } }));
    expect((await step(lucas, contractId, p.id, 'documento_assinado', {})).statusCode).toBe(422);
    const doc = ok(await lucas.post(`/contracts/${contractId}/documents`, { category: 'CONTRATO', docDate: '2026-10-09', summary: 'Link dedicado fictício', mime: 'application/pdf', data: PDF, signed: true }), 201).json();
    expect(doc.name).toBe('261009 - CONTRATO - EMPRESA CONTRATO FICTÍCIA LTDA - LINK DEDICADO FICTÍCIO');
    ok(await step(lucas, contractId, p.id, 'documento_assinado', {}));
    ok(await step(mariana, contractId, p.id, 'implantacao_entrega', { note: 'Equipe agendada' }));
    ok(await step(mariana, contractId, p.id, 'ativacao_tecnica', { value: { date: addDays(today, -2) } }));
    const r = ok(await step(ana, contractId, p.id, 'inicio_faturamento', { value: { date: addDays(today, -1) } })).json();
    expect(r.processStatus).toBe('concluido');
    const d = await detail(contractId);
    expect(d.stage).toBe('vigente');
    expect(d.erpRef).toBe('ERP-7788');
    expect(d.current.activationAt).toBe(addDays(today, -2));
    expect(d.current.billingStartAt).toBe(addDays(today, -1));
    expect(d.versions.map((x: { changeKind: string }) => x.changeKind)).toEqual(['ativacao', 'ativacao', 'edicao', 'cadastro']);
    // versão é só INSERT: o banco recusa alterar ou apagar
    await expect(ctx.app.db.execute(sql`update contract_versions set monthly_cents = 1 where contract_id = ${contractId}`)).rejects.toThrow(/append-only/);
    await expect(ctx.app.db.execute(sql`delete from contract_events where contract_id = ${contractId}`)).rejects.toThrow(/append-only/);
    // monitor resolve os alertas cumpridos
    ok(await carlos.post('/contracts/alerts/run'));
    const open = (await carlos.get(`/contracts/alerts?contractId=${contractId}`)).json().items;
    expect(open).toEqual([]);
  });

  it('renovação: 60 dias antes abre o processo, cria tarefa para Inteligência Comercial, avisa comercial e CSM; sem duplicar', async () => {
    expect((await carlos.put(`/contracts/${contractId}`, { version: { endAt: addDays(today, 50) } })).statusCode).toBe(422);
    ok(await carlos.put(`/contracts/${contractId}`, { csmId: mariana.me.user.id, version: { endAt: addDays(today, 50) }, reason: 'Teste: término antecipado' }));
    sent.length = 0;
    const r1 = ok(await carlos.post('/contracts/alerts/run')).json();
    expect(r1.contractAlerts).toBeGreaterThanOrEqual(1);
    const r2 = ok(await carlos.post('/contracts/alerts/run')).json();
    expect(r2.contractAlerts).toBe(0);
    const d = await detail(contractId);
    expect(d.stage).toBe('renovacao');
    expect(d.alerts.filter((a: { kind: string }) => a.kind === 'renovacao')).toHaveLength(1);
    const icTasks = (await ctx.app.db.execute<{ title: string }>(sql`select a.title from activities a join users u on u.id = a.owner_id where u.email = 'rafael@yepnet.test' and a.contract_id = ${contractId}`)).rows.map((r) => r.title);
    expect(icTasks).toContain('Renovação: contrato CT-PRIV-001 – Empresa Contrato Fictícia LTDA');
    expect(sent.map((m) => m.to).sort()).toEqual(['lucas@yepnet.test', 'mariana@yepnet.test']);
  });

  it('renovação privada: proposta, aditivo assinado, ERP e nova vigência (Contrato Renovado)', async () => {
    const p = await proc(contractId, 'renovacao');
    ok(await step(lucas, contractId, p.id, 'revisao_condicoes', { note: 'Cliente satisfeito' }));
    ok(await step(lucas, contractId, p.id, 'proposta_continuidade', { note: 'Mesmas condições por 12 meses' }));
    ok(await step(lucas, contractId, p.id, 'renegociacao', { skip: true }));
    expect((await step(lucas, contractId, p.id, 'nova_vigencia', { value: { termMonths: 12 } })).statusCode).toBe(422);
    ok(await lucas.post(`/contracts/${contractId}/documents`, { category: 'ADITIVO', docDate: today, summary: 'Prorrogação 12 meses', mime: 'application/pdf', data: PDF, signed: true }), 201);
    ok(await step(lucas, contractId, p.id, 'formalizacao', {}));
    ok(await step(carlos, contractId, p.id, 'assinatura_diretoria', { value: { date: today } }));
    ok(await step(lucas, contractId, p.id, 'assinatura_cliente', { value: { date: today } }));
    ok(await step(ana, contractId, p.id, 'erp', { value: { ref: 'ERP-7788-A1' } }));
    const r = ok(await step(rafael, contractId, p.id, 'nova_vigencia', { value: { termMonths: 12 } })).json();
    expect(r.processStatus).toBe('concluido');
    const d = await detail(contractId);
    expect(d.stage).toBe('vigente');
    expect(d.renewed).toBe(true);
    expect(d.current.startAt).toBe(addDays(today, 51));
    expect(d.current.changeKind).toBe('renovacao');
    ok(await carlos.post('/contracts/alerts/run'));
    expect((await detail(contractId)).alerts.find((a: { kind: string }) => a.kind === 'renovacao').status).toBe('concluido');
  });

  it('reajuste independente: cálculo, aprovação, aplicação com histórico de valores', async () => {
    ok(await carlos.post(`/contracts/${contractId}/stage`, { stage: 'reajuste' }));
    const p = await proc(contractId, 'reajuste');
    const calc = ok(await step(ana, contractId, p.id, 'calculo', { value: { index: 'IPCA', pct: 4.5 } })).json();
    expect(calc.newCents).toBe(156_750);
    expect((await step(ana, contractId, p.id, 'aplicacao', { value: { date: today } })).statusCode).toBe(422);
    ok(await step(carlos, contractId, p.id, 'aprovacao', { value: { decision: 'sim' } }));
    ok(await step(lucas, contractId, p.id, 'comunicacao', { note: 'Carta enviada ao cliente' }));
    expect((await step(ana, contractId, p.id, 'documentacao', { skip: true })).statusCode).toBe(403);
    ok(await step(rafael, contractId, p.id, 'documentacao', { skip: true }));
    ok(await step(ana, contractId, p.id, 'aplicacao', { value: { date: today } }));
    ok(await step(ana, contractId, p.id, 'erp', { value: { ref: 'ERP-REAJ-1' } }));
    const d = await detail(contractId);
    expect(d.stage).toBe('vigente');
    expect(d.current.monthlyCents).toBe(156_750);
    expect(d.current.changeKind).toBe('reajuste');
    expect(d.versions.find((x: { changeKind: string }) => x.changeKind === 'renovacao').monthlyCents).toBe(150_000);
  });

  it('acesso: vendedor vê só os dele; setor de apoio vê todos; documento restrito por setor', async () => {
    const doc = ok(await carlos.post(`/contracts/${contractId}/documents`, { category: 'PARECER JURIDICO', docDate: today, summary: 'Parecer', mime: 'application/pdf', data: PDF, restrictedTo: ['juridico'] }), 201).json();
    expect((await lucas.get(`/contracts/${contractId}/documents/${doc.id}/download`)).statusCode).toBe(403);
    expect((await carlos.get(`/contracts/${contractId}/documents/${doc.id}/download`)).statusCode).toBe(200);
    expect((await rafael.get(`/contracts/${contractId}`)).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/contracts/${contractId}`, headers: { cookie: (await login(ctx.app, 'mariana@yepnet.test')).cookie } })).statusCode).toBe(200);
    const list = (await lucas.get('/contracts')).json();
    expect(list.items.every((x: { ownerId: string }) => x.ownerId === lucas.me.user.id)).toBe(true);
    const tl = (await lucas.get(`/contracts/${contractId}/timeline`)).json();
    expect(tl.events.length).toBeGreaterThan(10);
    expect(tl.emails.length).toBeGreaterThan(0);
  });
});

describe('contrato público: ofício, não renovação e encerramento com validações', () => {
  let id = '';
  it('cadastro público exige órgão; ofício pelo modelo e envio com cópia para contratos@', async () => {
    const w = await wonOpportunity('Prefeitura Fictícia de Teste', 'governamental');
    await w.won();
    const pre = (await lucas.get(`/contracts/prefill?opportunityId=${w.o.id}`)).json();
    expect(pre.suggestion.kind).toBe('publico');
    id = ok(await carlos.post('/contracts', { opportunityId: w.o.id, kind: 'publico', legalRegime: 'lei_14133', commercialOwnerId: lucas.me.user.id, version: { number: '045/2025', object: 'Internet para escolas', items: [{ planId: null, description: 'Link 500 Mbps', qty: 2, unitCents: 80_000 }], monthlyCents: 160_000, signedAt: addDays(today, -300), startAt: addDays(today, -290), endAt: addDays(today, 40), activationAt: addDays(today, -280), billingStartAt: addDays(today, -280) } }), 201).json().id;
    expect((await carlos.post(`/contracts/${id}/validate`)).json().detail).toContain('órgão');
    ok(await carlos.put(`/contracts/${id}`, { version: { publicTerms: { agency: 'Secretaria Municipal de Educação (fictícia)', processNumber: 'PROC-123', modality: 'Pregão', commitmentNote: null, budgetLine: null, extensionMaxMonths: 120 } } }));
    ok(await carlos.post(`/contracts/${id}/validate`));
    ok(await carlos.post(`/contracts/${id}/stage`, { stage: 'vigente' }));
    ok(await carlos.post('/contracts/alerts/run'));
    const p = await proc(id, 'renovacao');
    expect(p).toBeTruthy();
    ok(await step(rafael, id, p.id, 'verificar_prorrogacao', { value: { decision: 'sim' }, note: 'Prorrogável até 10 anos (validado por Rafael)' }));
    const of = ok(await rafael.post(`/contracts/${id}/processes/${p.id}/oficio`, { oficioNumber: '12/2026', months: 12 }), 201).json();
    expect(of.name).toMatch(/^\d{6} - OFICIO - PREFEITURA FICTÍCIA DE TESTE - RENOVACAO CONTRATO 045 2025$/);
    sent.length = 0;
    const r = ok(await rafael.post(`/contracts/${id}/processes/${p.id}/oficio/send`, { to: 'compras@prefeitura.test' })).json();
    expect(r.subject).toBe('Ofício de Renovação Contratual – Contrato 045/2025 – Cliente Prefeitura Fictícia de Teste');
    expect(sent[0]).toMatchObject({ to: 'compras@prefeitura.test', cc: 'contratos@bktele.com.br' });
    expect(sent[0]!.attachments).toHaveLength(1);
    const steps = (await proc(id, 'renovacao')).steps;
    expect(Object.keys(steps).sort()).toEqual(['enviar_oficio', 'gerar_oficio', 'verificar_prorrogacao']);
  });

  it('cliente não renova: encerramento previsto, avisos de 90/30 dias com o assunto do processo, sem encerrar sozinho', async () => {
    const p = await proc(id, 'renovacao');
    expect((await step(rafael, id, p.id, 'manifestacao_cliente', { value: { decision: 'nao' } })).statusCode).toBe(422);
    ok(await step(rafael, id, p.id, 'manifestacao_cliente', { value: { decision: 'nao' }, note: 'Órgão fará nova licitação' }));
    let d = await detail(id);
    expect(d.closureExpected).toBe(true);
    sent.length = 0;
    ok(await carlos.post('/contracts/alerts/run'));
    d = await detail(id);
    expect(d.stage).toBe('encerramento');
    expect(d.alerts.map((a: { kind: string }) => a.kind)).toEqual(expect.arrayContaining(['encerramento_90']));
    expect(sent.some((m) => m.subject === 'Encerramento Contratual Imediato – Contrato 045/2025')).toBe(true);
    expect((await carlos.post(`/contracts/${id}/stage`, { stage: 'arquivado' })).statusCode).toBe(422);
    const c = d.processes.find((x: { kind: string; status: string }) => x.kind === 'encerramento' && x.status === 'aberto');
    expect(c.steps.aviso_90.doneByName).toBe('Sistema');
    expect((await step(carlos, id, c.id, 'arquivamento', { note: 'fim', value: { location: 'Arquivo X' } })).statusCode).toBe(422);
    ok(await step(mariana, id, c.id, 'validacao_cs', { value: { decision: 'sim' } }));
    ok(await step(mariana, id, c.id, 'desmobilizacao', { note: 'Equipamentos recolhidos' }));
    ok(await step(ana, id, c.id, 'faturamento_final', { note: 'Fatura final emitida' }));
    ok(await step(mariana, id, c.id, 'baixa_operacional', { note: 'Circuitos desativados' }));
    ok(await step(ana, id, c.id, 'baixa_financeira', { note: 'Sem pendências' }));
    ok(await step(ana, id, c.id, 'erp', { value: { ref: 'ERP-BAIXA-1' } }));
    ok(await step(carlos, id, c.id, 'arquivamento', { note: 'Encerrado sem pendências', value: { location: 'Drive/Contratos/Encerrados/045-2025' } }));
    d = await detail(id);
    expect(d.stage).toBe('arquivado');
    expect(d.archiveLocation).toBe('Drive/Contratos/Encerrados/045-2025');
    expect(d.alerts.every((a: { status: string }) => a.status !== 'aberto')).toBe(true);
    const docs = (await carlos.get(`/contracts/${id}/documents`)).json().items;
    expect(docs.every((x: { folder: string }) => x.folder === 'Encerrados')).toBe(true);
  });

  it('painel, calendário, relatório mensal (CSV) e configurações', async () => {
    const dash = (await carlos.get('/contracts/dashboard')).json();
    expect(dash.active).toBeGreaterThanOrEqual(1);
    expect(dash.archived).toBeGreaterThanOrEqual(1);
    expect(dash.monthlyCents).toBeGreaterThan(0);
    const cal = (await carlos.get(`/contracts/calendar?from=${today}&to=${addDays(today, 400)}`)).json();
    expect(cal.items.some((e: { kind: string }) => e.kind === 'renovacao')).toBe(true);
    expect(cal.items.some((e: { kind: string }) => e.kind === 'reajuste')).toBe(true);
    const month = addDays(today, 0).slice(0, 7);
    const rep = (await carlos.get(`/contracts/reports/expiring?month=${month}`)).json();
    expect(rep.month).toBe(month);
    const csv = await carlos.get('/contracts/reports/expiring?format=csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\r\n')[0]).toContain('Contrato;Código;Cliente');
    const intel = (await carlos.get(`/intelligence/contracts?from=${addDays(today, -30)}&to=${today}`)).json();
    expect(intel.active).toBeGreaterThanOrEqual(1);
    expect(intel.closedInPeriod).toBeGreaterThanOrEqual(1);
    expect(intel.revenue.billedCents).toBeNull();
    expect(intel.renewal.renewed).toBeGreaterThanOrEqual(1);
    expect(intel.renewal.notRenewed).toBeGreaterThanOrEqual(1);
    expect(intel.adjustments.done).toBeGreaterThanOrEqual(1);
    expect(intel.adjustments.increaseCents).toBe(6_750);
    expect(intel.implantation.n).toBeGreaterThanOrEqual(1);
    const pub = (await carlos.get(`/intelligence/contracts?from=${addDays(today, -30)}&to=${today}&kind=publico`)).json();
    expect(pub.byKind.every((k: { key: string }) => k.key === 'publico')).toBe(true);
    expect((await lucas.get(`/intelligence/contracts?from=${today}&to=${today}`)).statusCode).toBe(403);
    const cfg = (await carlos.get('/admin/contract-settings')).json();
    expect(cfg.ccEmail).toBe('contratos@bktele.com.br');
    expect(cfg.closureSubject).toBe('Encerramento Contratual Imediato – Contrato [Nº]');
    ok(await carlos.put('/admin/contract-settings', { ...cfg, financeEmail: 'financeiro@yepnet.test', renewalAlertDays: 75 }));
    expect((await carlos.get('/admin/contract-settings')).json().renewalAlertDays).toBe(75);
    expect((await lucas.get('/admin/contract-settings')).statusCode).toBe(403);
    ok(await carlos.put('/admin/contract-settings', cfg));
  });
});
