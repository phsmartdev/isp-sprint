/** Ofícios: modelos (texto e posição), assinatura e numeração por filial, emissão a partir do contrato e filial própria do contrato. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
let tenantId = '', contractId = '', branchId = '';
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex').toString('base64');

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
    expect(saved).toMatchObject({ n: `71/${year}`, dest: 'Luciano Gois Paul', template_version: 2 });
    const pdf = await carlos.get(`/oficios/${a.id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(ok(await carlos.get(`/contracts/${contractId}/oficios`)).json().issued.map((l: { label: string }) => l.label)).toEqual([`72/${year}`, `71/${year}`]);
    // número não volta para trás
    expect((await carlos.put(`/admin/oficios/filiais/${branchId}`, { legalName: null, signerName: null, signerRole: null, nextNumber: 72 })).statusCode).toBe(422);
  });
});
