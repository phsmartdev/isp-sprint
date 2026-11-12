/** Ofícios: modelos (texto e posição), assinatura e numeração por filial, emissão a partir do contrato e filial própria do contrato. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
let tenantId = '', contractId = '', branchId = '';
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63606060f80f00010401005fe5c34b0000000049454e44ae426082', 'hex').toString('base64');

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]);
  tenantId = ((await ctx.db.execute(sql`select tenant_id from users where email = 'carlos@yepnet.test'`)).rows[0] as { tenant_id: string }).tenant_id;
  // contrato público fictício (sem negociação), criado pelo cadastro normal
  const contactId = ((await ctx.db.execute(sql`select id from contacts where tenant_id = ${tenantId} order by created_at limit 1`)).rows[0] as { id: string }).id;
  contractId = ok(await carlos.post('/contracts', { contactId, billingType: 'recorrente', kind: 'publico', legalRegime: 'lei_14133', commercialOwnerId: carlos.me.user.id, version: { number: '171/2022', object: 'a contratação de serviços de TIC fictícios', signedAt: '2022-11-24', startAt: '2022-11-24', termMonths: 60, monthlyCents: 100_000, adjustmentIndex: 'IPCA', items: [{ planId: null, description: 'Colocation', qty: 1, unitCents: 100_000 }], publicTerms: { agency: 'Companhia de Saneamento Fictícia - CSF', processNumber: '2022.01.0001', modality: 'Pregão', commitmentNote: null, budgetLine: null, extensionMaxMonths: null } } }), 201).json().id;
  branchId = ((await ctx.db.execute(sql`insert into sales_branches (tenant_id, name, cnpj, city, state) values (${tenantId}, ${`Filial Ofício ${Date.now()}`}, '18.929.415/0001-00', 'Aracaju', 'SE') returning id`)).rows[0] as { id: string }).id;
  await ctx.db.execute(sql`delete from office_letters where tenant_id = ${tenantId}`);
  await ctx.db.execute(sql`delete from office_letter_seq where tenant_id = ${tenantId}`);
});
afterAll(async () => {
  await ctx.db.execute(sql`delete from office_letters where tenant_id = ${tenantId}`);
  await ctx.db.execute(sql`delete from office_letter_seq where tenant_id = ${tenantId}`);
  await ctx.db.execute(sql`delete from office_templates where tenant_id = ${tenantId}`);
  await ctx.db.execute(sql`delete from branch_signers where tenant_id = ${tenantId}`);
  await ctx.db.execute(sql`update contracts set branch_id = null where branch_id = ${branchId}`);
  await ctx.db.execute(sql`delete from sales_branches where id = ${branchId}`);
  await ctx.close();
});

describe('Ofícios', () => {
  let tplId = '';
  it('modelo: começa do ofício de reajuste; editar gera nova versão; só a administração', async () => {
    expect((await lucas.get('/admin/oficios')).statusCode).toBe(403);
    tplId = ok(await carlos.post('/admin/oficios', { name: 'Reajuste anual' }), 201).json().id;
    const d = ok(await carlos.get('/admin/oficios')).json();
    const t = d.templates.find((x: { id: string }) => x.id === tplId);
    expect(t.blocks.map((b: { id: string }) => b.id)).toEqual(['cabecalho', 'destinatario', 'assunto', 'corpo', 'assinatura']);
    expect(d.vars.some((v: { key: string }) => v.key === 'contrato.numero')).toBe(true);
    const moved = t.blocks.map((b: { id: string; y: number }) => (b.id === 'assinatura' ? { ...b, y: 235 } : b));
    expect(ok(await carlos.patch(`/admin/oficios/${tplId}`, { blocks: moved })).json().version).toBe(2);
    const pv = ok(await carlos.post('/admin/oficios/previa', { blocks: moved, branchId })).json();
    expect(Buffer.from(pv.pdf, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect(pv.boxes.find((b: { id: string }) => b.id === 'assinatura')).toMatchObject({ y: 235 });
    // assinatura digitalizada no próprio bloco, com altura e deslocamento
    const withSig = moved.map((b: { id: string }) => (b.id === 'assinatura' ? { ...b, sigImage: `data:image/png;base64,${PNG}`, sigH: 20, sigDx: 5, sigDy: -2 } : b));
    expect(Buffer.from(ok(await carlos.post('/admin/oficios/previa', { blocks: withSig, branchId })).json().pdf, 'base64').subarray(0, 4).toString()).toBe('%PDF');
    expect((await carlos.post('/admin/oficios/previa', { blocks: withSig.map((b: { id: string }) => (b.id === 'assinatura' ? { ...b, sigImage: 'data:text/html;base64,PGh0bWw+' } : b)), branchId })).statusCode).toBe(422);
    // PNG truncado/corrompido é recusado (o leitor de PNG do pdf-lib travaria o servidor em laço)
    const broken = 'iVBORw0KGgoAAAANSUhEUgAAADwAAAAUCAYAAADRA14pAAAAQklEQVR42u3QMQ0AAAgDIN8/tBV8MAb9I7IsRUZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGDj8fKA0VN4/rTQAAAABJRU5ErkJggg==';
    expect((await carlos.post('/admin/oficios/previa', { blocks: withSig.map((b: { id: string }) => (b.id === 'assinatura' ? { ...b, sigImage: `data:image/png;base64,${broken}` } : b)), branchId })).statusCode).toBe(422);
    expect((await carlos.put(`/admin/oficios/filiais/${branchId}/assinatura`, { data: broken })).statusCode).toBe(422);
    ok(await carlos.patch(`/admin/oficios/${tplId}`, { blocks: withSig }));
  });

  it('filial: quem assina, assinatura e próximo número; contrato com filial própria', async () => {
    ok(await carlos.put(`/admin/oficios/filiais/${branchId}`, { legalName: 'BKT SOLUÇÕES E TECNOLOGIA LTDA', signerName: 'José Welliton Sá da Silva', signerRole: 'Diretor Executivo', nextNumber: 71 }));
    ok(await carlos.put(`/admin/oficios/filiais/${branchId}/assinatura`, { data: PNG }));
    const b = ok(await carlos.get('/admin/oficios')).json().branches.find((x: { id: string }) => x.id === branchId);
    expect(b).toMatchObject({ nextNumber: 71, signer: { signerName: 'José Welliton Sá da Silva', hasSignature: true } });
    ok(await carlos.put(`/contracts/${contractId}`, { branchId }));
    expect((await carlos.put(`/contracts/${contractId}`, { branchId: '00000000-0000-0000-0000-000000000000' })).statusCode).toBe(422);
    const row = (await ctx.db.execute(sql`select branch_id from contracts where id = ${contractId}`)).rows[0] as { branch_id: string };
    expect(row.branch_id).toBe(branchId);
  });

  it('emissão a partir do contrato: valores do contrato, números seguidos por filial e ano, PDF guardado', async () => {
    const d = ok(await carlos.get(`/contracts/${contractId}/oficios`)).json();
    const year = new Date().getFullYear();
    expect(d.branchId).toBe(branchId);
    const num = ((await ctx.db.execute(sql`select v.number from contract_versions v join contracts c on c.id = v.contract_id where c.id = ${contractId} order by v.version desc limit 1`)).rows[0] as { number: string }).number;
    expect(d.vars).toMatchObject({ 'orgao.nome': 'Companhia de Saneamento Fictícia - CSF', 'contrato.indice': 'Índice Nacional de Preços ao Consumidor Amplo – IPCA', 'contrato.assinatura': '24 de novembro de 2022', 'oficio.numero': `71/${year}`, 'contrato.numero': num, 'filial.razao_social': 'BKT SOLUÇÕES E TECNOLOGIA LTDA', 'assinante.cargo': 'Diretor Executivo' });
    const tpl = d.templates.find((t: { id: string }) => t.id === tplId);
    expect(tpl.usedVars).toEqual(expect.arrayContaining(['contrato.numero', 'destinatario.nome', 'orgao.nome']));
    const vars = { ...d.vars, 'destinatario.nome': 'Luciano Gois Paul', 'destinatario.cargo': 'Diretor-Presidente' };
    const a = ok(await carlos.post(`/contracts/${contractId}/oficios`, { templateId: tplId, blocks: tpl.blocks, vars, subject: 'Reajuste' }), 201).json();
    const b = ok(await carlos.post(`/contracts/${contractId}/oficios`, { templateId: tplId, blocks: tpl.blocks, vars }), 201).json();
    expect([a.label, b.label]).toEqual([`71/${year}`, `72/${year}`]);
    const saved = (await ctx.db.execute(sql`select vars->>'oficio.numero' as n, vars->>'destinatario.nome' as dest, template_version from office_letters where id = ${a.id}`)).rows[0] as { n: string; dest: string; template_version: number };
    expect(saved).toMatchObject({ n: `71/${year}`, dest: 'Luciano Gois Paul', template_version: 3 });
    const pdf = await carlos.get(`/oficios/${a.id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(ok(await carlos.get(`/contracts/${contractId}/oficios`)).json().issued.map((l: { label: string }) => l.label)).toEqual([`72/${year}`, `71/${year}`]);
    // número não volta para trás
    expect((await carlos.put(`/admin/oficios/filiais/${branchId}`, { legalName: null, signerName: null, signerRole: null, nextNumber: 72 })).statusCode).toBe(422);
  });
});

describe('Ofício de reajuste e renovação', () => {
  const sent: { to: string; subject: string; attachments?: { filename: string }[] }[] = [];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (days: number) => iso(new Date(Date.now() + days * 86_400_000));
  let cid = '';
  beforeAll(async () => {
    const { setIndexFetcher } = await import('../src/services/indices');
    const { setTransportFactory } = await import('../src/services/email');
    // série simulada do Banco Central: 0,5% ao mês em todos os índices
    setIndexFetcher(async (_code, from, to) => { const out = []; for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = iso(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1))).slice(0, 7)) out.push({ month: m, pct: 0.5 }); return out; });
    setTransportFactory(() => ({ sendMail: async (m: { to: string; subject: string; attachments?: { filename: string }[] }) => { sent.push(m); return { messageId: `m${sent.length}` }; } }) as never);
    ok(await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', password: 'x', fromName: 'Yepnet', fromEmail: 'vendas@yepnet.test', replyTo: null, enabled: true }));
    const contactId = ((await ctx.db.execute(sql`select id from contacts where tenant_id = ${tenantId} order by created_at limit 1`)).rows[0] as { id: string }).id;
    // assinado há 11 meses: aniversário em ~1 mês e término em ~1 mês (dentro dos dois períodos)
    const start = shift(-335);
    cid = ok(await carlos.post('/contracts', { contactId, branchId, renewalClause: 'Cláusula Sexta – prorrogável por iguais períodos até 120 meses.', billingType: 'recorrente', kind: 'publico', legalRegime: 'lei_14133', commercialOwnerId: carlos.me.user.id, version: { number: `R-${Date.now()}`, object: 'link dedicado', signedAt: start, startAt: start, termMonths: 12, monthlyCents: 1_000_000, adjustmentIndex: 'IPCA', adjustmentBaseDate: start, items: [{ planId: null, description: 'Link 500 Mbps', qty: 2, unitCents: 350_000 }, { planId: null, description: 'Colocation', qty: 1, unitCents: 300_000 }], publicTerms: { agency: 'Órgão Fictício', processNumber: '1/2026', modality: 'Pregão', commitmentNote: null, budgetLine: null, extensionMaxMonths: null } } }), 201).json().id;
    ok(await carlos.post(`/contracts/${cid}/validate`));
  });
  afterAll(async () => {
    const { setIndexFetcher } = await import('../src/services/indices');
    const { setTransportFactory } = await import('../src/services/email');
    setIndexFetcher(null); setTransportFactory(null);
    await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', fromName: 'Yepnet', fromEmail: 'vendas@yepnet.test', replyTo: null, enabled: false });
  });

  it('reajuste por item, índices, envio ao cliente, aplicação no período e conferência', async () => {
    const d = ok(await carlos.get(`/contracts/${cid}/oficios`)).json();
    expect(d.contract).toMatchObject({ renewalClause: expect.stringContaining('Cláusula Sexta'), adjust: { inPeriod: true }, renew: { inPeriod: true } });
    expect(d.vars['contrato.clausula_renovacao']).toContain('Cláusula Sexta');
    const ann = d.contract.adjust.anniversary;
    const idx = ok(await carlos.get(`/contracts/${cid}/oficios/indices?anniversary=${ann}`)).json().indices;
    expect(idx.map((r: { index: string }) => r.index)).toEqual(['IPCA', 'INPC', 'IGP-M', 'IGP-DI']);
    expect(idx[0].pct).toBeCloseTo(6.1678, 3);
    const blocks = [{ id: 'corpo', kind: 'texto', x: 20, y: 40, w: 170, align: 'justify', size: 11, lineGap: 1.4, indent: 0, paraGap: 3, text: 'Reajuste de **{{reajuste.percentual}}** ({{reajuste.mensal_atual}} → {{reajuste.mensal_novo}}).\n{{tabela.reajuste}}\n{{tabela.indices}}\nNova vigência: {{renovacao.inicio}} a {{renovacao.termino}} ({{renovacao.prazo}}). {{contrato.clausula_renovacao}}' }];
    const items = d.contract.items.map((i: object, k: number) => ({ ...i, pct: k === 0 ? 5 : 3 }));
    const renewal = d.contract.renew.suggestion;
    ok(await carlos.post(`/contracts/${cid}/oficios/previa`, { blocks, vars: d.vars, branchId, adjustment: { anniversary: ann, index: 'IPCA', items }, renewal, indices: idx }));
    // itens que não batem com o contrato são recusados
    expect((await carlos.post(`/contracts/${cid}/oficios`, { blocks, vars: d.vars, branchId, adjustment: { anniversary: ann, index: 'IPCA', items: items.slice(0, 1) }, renewal: null, indices: idx })).statusCode).toBe(422);
    const l = ok(await carlos.post(`/contracts/${cid}/oficios`, { blocks, vars: d.vars, branchId, subject: 'Reajuste e renovação', adjustment: { anniversary: ann, index: 'IPCA', items }, renewal, indices: idx }), 201).json();
    const row = (await ctx.db.execute(sql`select adjustment, renewal, vars from office_letters where id = ${l.id}`)).rows[0] as { adjustment: { pct: number; newMonthlyCents: number; items: { newUnitCents: number }[] }; renewal: { endAt: string }; vars: Record<string, string> };
    expect(row.adjustment.items.map((i) => i.newUnitCents)).toEqual([367_500, 309_000]);
    expect(row.adjustment.newMonthlyCents).toBe(1_044_000);
    expect(row.adjustment.pct).toBeCloseTo(4.4, 3);
    expect(row.vars['reajuste.percentual']).toBe('4,40%');

    // envio pelo e-mail da empresa, com o PDF anexo
    ok(await carlos.post(`/oficios/${l.id}/enviar`, { to: 'gestor@orgao.test', subject: `Ofício nº ${l.label}`, message: 'Segue o ofício.' }));
    expect(sent.at(-1)).toMatchObject({ to: 'gestor@orgao.test', attachments: [{ filename: `Oficio-${l.label.replace('/', '-')}.pdf` }] });

    // só quem gere contratos aplica; conferir antes de aplicar não vale
    expect((await lucas.post(`/oficios/${l.id}/aplicar`, { acao: 'reajuste' })).statusCode).toBeGreaterThanOrEqual(403);
    expect((await carlos.post(`/oficios/${l.id}/conferir`, { acao: 'reajuste', ok: true })).statusCode).toBe(422);
    ok(await carlos.post(`/oficios/${l.id}/aplicar`, { acao: 'reajuste' }));
    expect((await carlos.post(`/oficios/${l.id}/aplicar`, { acao: 'reajuste' })).statusCode).toBe(422);
    const c = ok(await carlos.get(`/contracts/${cid}/oficios`)).json().contract;
    expect(c.items.map((i: { unitCents: number }) => i.unitCents)).toEqual([367_500, 309_000]);
    expect(c.monthlyCents).toBe(1_044_000);
    expect((await carlos.post(`/oficios/${l.id}/conferir`, { acao: 'reajuste', ok: false })).statusCode).toBe(422);
    ok(await carlos.post(`/oficios/${l.id}/conferir`, { acao: 'reajuste', ok: true }));

    // renovação: nova vigência e conferência com divergência
    ok(await carlos.post(`/oficios/${l.id}/aplicar`, { acao: 'renovacao' }));
    const c2 = ok(await carlos.get(`/contracts/${cid}/oficios`)).json().contract;
    expect([c2.startAt, c2.endAt]).toEqual([renewal.startAt, renewal.endAt]);
    ok(await carlos.post(`/oficios/${l.id}/conferir`, { acao: 'renovacao', ok: false, note: 'Faltou o termo assinado pelo órgão' }));
    const st = (await ctx.db.execute(sql`select renewal->>'checkOk' as ok, (select next_action from contracts where id = ${cid}) as na from office_letters where id = ${l.id}`)).rows[0] as { ok: string; na: string };
    expect(st).toEqual({ ok: 'false', na: `Corrigir divergência da renovação (ofício nº ${l.label})` });
  });
});
