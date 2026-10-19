/** Contratos (parte 2): tipos, saldo por medição consumido pela oportunidade, Sucesso do Cliente, modelos .docx e ZapSign. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import PizZip from 'pizzip';
import { sql } from 'drizzle-orm';
import { addDays } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client;
const today = new Date().toISOString().slice(0, 10);
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, ana] = (await Promise.all(['carlos', 'lucas', 'ana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const users = (await carlos.get('/admin/users')).json().users as { id: string; email: string }[];
  ok(await carlos.patch(`/admin/users/${users.find((u) => u.email === 'ana@yepnet.test')!.id}`, { sectors: ['financeiro'] }));
  ana = await login(ctx.app, 'ana@yepnet.test');
});
afterAll(async () => ctx.close());
afterEach(() => vi.restoreAllMocks());

function docx(body: string, header?: string) {
  const zip = new PizZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}</Types>`);
  if (header) {
    zip.file('word/header1.xml', `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t xml:space="preserve">${header}</w:t></w:r></w:p></w:hdr>`);
    zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdL" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/timbrado.png"/></Relationships>');
    zip.file('word/media/timbrado.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  }
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paras = body.split('\n').map((l) => `<w:p><w:r><w:t xml:space="preserve">${l}</w:t></w:r></w:p>`).join('');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`);
  return zip.generate({ type: 'nodebuffer' }).toString('base64');
}
const textOf = (b64: Buffer) => new PizZip(b64).file('word/document.xml')!.asText().replace(/<[^>]+>/g, '');

async function wonContract(name: string, billingType: string, extra: object = {}) {
  const plan = (await lucas.get('/meta/lookups')).json().plans[0];
  const o = ok(await lucas.post('/opportunities', { newContact: { name, segment: 'empresarial' }, planId: plan.id }), 201).json();
  ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
  const id = ok(await carlos.post('/contracts', { opportunityId: o.id, billingType, commercialOwnerId: lucas.me.user.id, version: { number: `T-${billingType}`, object: `Contrato ${billingType} fictício`, signedAt: addDays(today, -5), startAt: addDays(today, -5), termMonths: 12, monthlyCents: billingType === 'recorrente' ? 50_000 : 0, items: billingType === 'medicao' ? [] : [{ planId: null, description: 'Serviço', qty: 1, unitCents: 50_000 }] }, ...extra }), 201).json().id;
  return { id, contactId: o.contactId as string, plan };
}

describe('tipos de contrato e saldo por medição', () => {
  let med: Awaited<ReturnType<typeof wonContract>>;
  it('medição: saldo inicial, validação e consumo pela oportunidade com estorno ao reabrir', async () => {
    med = await wonContract('Cliente Medição Fictício', 'medicao', { initialBalanceCents: 100_000 });
    ok(await carlos.post(`/contracts/${med.id}/validate`));
    let led = (await lucas.get(`/contracts/${med.id}/ledger`)).json();
    expect(led.totals).toMatchObject({ credited: 100_000, available: 100_000 });
    const o = ok(await lucas.post('/opportunities', { contactId: med.contactId, planId: med.plan.id, customerSuccess: false }), 201).json();
    const opts = (await lucas.get(`/opportunities/${o.id}/measurement-options`)).json().items;
    expect(opts[0]).toMatchObject({ id: med.id, available: 100_000 });
    expect((await lucas.put(`/opportunities/${o.id}/measurement`, { contractId: med.id, amountCents: 150_000 })).statusCode).toBe(422);
    ok(await lucas.put(`/opportunities/${o.id}/measurement`, { contractId: med.id, amountCents: 40_000 }));
    ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
    led = (await lucas.get(`/contracts/${med.id}/ledger`)).json();
    expect(led.totals).toMatchObject({ consumed: 40_000, available: 60_000 });
    expect(led.items[0]).toMatchObject({ kind: 'consumo', amountCents: 40_000, balanceAfter: 60_000 });
    // reabrir estorna; fechar de novo consome de novo (sem duplicar)
    ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'proposta', confirm: true, reason: 'Ajuste', rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
    expect((await lucas.get(`/contracts/${med.id}/ledger`)).json().totals.available).toBe(100_000);
    ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
    expect((await lucas.get(`/contracts/${med.id}/ledger`)).json().totals.available).toBe(60_000);
    // saldo não pode ficar negativo
    const o2 = ok(await lucas.post('/opportunities', { contactId: med.contactId, planId: med.plan.id }), 201).json();
    expect((await lucas.put(`/opportunities/${o2.id}/measurement`, { contractId: med.id, amountCents: 70_000 })).statusCode).toBe(422);
    await expect(ctx.app.db.execute(sql`update contract_ledger set amount_cents = 1 where contract_id = ${med.id}`)).rejects.toThrow(/append-only/);
  });

  it('frequente: lançamentos de faturamento pelo Financeiro; painel mostra o faturamento por tipo', async () => {
    const fr = await wonContract('Cliente Frequente Fictício', 'frequente');
    ok(await carlos.post(`/contracts/${fr.id}/validate`));
    expect((await lucas.post(`/contracts/${fr.id}/ledger`, { kind: 'faturamento', amountCents: 30_000, occurredOn: today, description: 'Atendimento' })).statusCode).toBe(403);
    ok(await ana.post(`/contracts/${fr.id}/ledger`, { kind: 'faturamento', amountCents: 30_000, occurredOn: today, description: 'Atendimento avulso' }), 201);
    expect((await ana.post(`/contracts/${fr.id}/ledger`, { kind: 'consumo', amountCents: 1_000, occurredOn: today, description: 'x' })).statusCode).toBe(422);
    const d = (await carlos.get(`/contracts/dashboard?from=${today.slice(0, 7)}-01&to=${today}`)).json();
    const t = Object.fromEntries(d.billing.byType.map((x: { type: string }) => [x.type, x]));
    expect(t.frequente.billedCents).toBeGreaterThanOrEqual(30_000);
    expect(t.medicao.billedCents).toBeGreaterThanOrEqual(40_000);
    expect(t.medicao.balance.available).toBeGreaterThanOrEqual(60_000);
    expect(d.billing.totalCents).toBe(d.billing.byType.reduce((a: number, x: { billedCents: number }) => a + x.billedCents, 0));
    expect(d.byOwner.length).toBeGreaterThan(0);
    expect(d.topClients.length).toBeGreaterThan(0);
    expect(d.expiringByMonth).toHaveLength(12);
  });
});

describe('Sucesso do Cliente na oportunidade de cliente da base', () => {
  it('sim duplica no funil Sucesso do Cliente; não mantém só a original', async () => {
    const [cust] = (await ctx.app.db.execute<{ contact_id: string }>(sql`select c.contact_id from customers c join contacts ct on ct.id = c.contact_id join tenants t on t.id = c.tenant_id where t.slug = 'yepnet' and c.lifecycle = 'ativo' and ct.owner_id = (select id from users where email = 'lucas@yepnet.test') limit 1`)).rows;
    expect(cust).toBeTruthy();
    const plan = (await lucas.get('/meta/lookups')).json().plans[0];
    const yes = ok(await lucas.post('/opportunities', { contactId: cust!.contact_id, planId: plan.id, customerSuccess: true }), 201).json();
    expect(yes.customerSuccessId).toBeTruthy();
    const copy = (await lucas.get(`/opportunities/${yes.customerSuccessId}`)).json();
    const pipes = (await carlos.get('/admin/journeys')).json().items as { id: string; key: string; name: string }[];
    expect(pipes.find((p) => p.id === copy.pipelineId)!.key).toBe('sucesso_cliente');
    expect(copy.stage).toBe('acionado');
    const no = ok(await lucas.post('/opportunities', { contactId: cust!.contact_id, planId: plan.id, customerSuccess: false }), 201).json();
    expect(no.customerSuccessId).toBeNull();
    const copies = (await ctx.app.db.execute(sql`select 1 from opportunities where duplicated_from_id = ${no.id}`)).rows;
    expect(copies).toHaveLength(0);
  });
});

describe('modelos de contrato e ZapSign', () => {
  let ct = '';
  it('sobe modelo .docx, detecta variáveis, recusa campo mal fechado e gera o contrato preenchido', async () => {
    const bad = await carlos.post('/contract-templates', { name: 'Ruim', fileName: 'ruim.docx', data: docx('Cliente {{cliente.nome') });
    expect(bad.statusCode).toBe(422);
    const lx = await lucas.post('/contract-templates', { fileName: 'x.docx', data: docx('{{cliente.nome}}'), name: 'Modelo X' });
    expect(lx.statusCode, lx.body).toBe(403);
    const t = ok(await carlos.post('/contract-templates', { name: 'Contrato padrão', fileName: 'padrao.docx', billingType: 'recorrente', data: docx('CONTRATO {{contrato.numero}} - {{cliente.nome}}\nValor: {{contrato.valor_mensal}}\nEntrega em {{prazo_entrega}}\n{{#itens}}Item: {{descricao}} {{valor_total}}{{/itens}}', 'TIMBRADO {{empresa.nome}} - Contrato {{contrato.numero}}'), variables: [{ key: 'prazo_entrega', label: 'Prazo de entrega', type: 'texto', default: '30 dias' }] }), 201).json();
    expect(t.detected).toEqual(expect.arrayContaining(['cliente.nome', 'contrato.numero', 'prazo_entrega', 'itens']));
    expect(t.variables).toEqual([{ key: 'prazo_entrega', label: 'Prazo de entrega', type: 'texto', default: '30 dias' }]);
    const rec = await wonContract('Cliente Modelo Fictício LTDA', 'recorrente');
    ct = rec.id;
    const g = ok(await lucas.post(`/contracts/${ct}/generate`, { templateId: t.id, values: { prazo_entrega: '15 dias úteis' } }), 201).json();
    expect(g.name).toMatch(/ - CONTRATO - CLIENTE MODELO FICTÍCIO LTDA - /);
    const file = await lucas.get(`/contracts/${ct}/documents/${g.id}/download`);
    const text = textOf(file.rawPayload);
    expect(text).toContain('CONTRATO T-recorrente - Cliente Modelo Fictício LTDA');
    expect(text).toContain('Entrega em 15 dias úteis');
    expect(text).toMatch(/Item: Serviço R\$\s?500,00/);
    // timbrado (cabeçalho e imagem) preservado e campos do cabeçalho preenchidos
    const out = new PizZip(file.rawPayload);
    expect(out.file('word/header1.xml')!.asText().replace(/<[^>]+>/g, '')).toBe('TIMBRADO Yepnet (demonstração) - Contrato T-recorrente');
    expect(out.file('word/media/timbrado.png')).toBeTruthy();
  });

  it('envia para assinatura na ZapSign e o webhook traz o PDF assinado e conclui a etapa', async () => {
    ok(await carlos.post(`/contracts/${ct}/validate`));
    const docs = (await lucas.get(`/contracts/${ct}/documents`)).json().items;
    const docId = docs[0].id;
    expect((await lucas.post(`/contracts/${ct}/documents/${docId}/signature`, { signers: [{ name: 'Cliente', email: 'cliente@exemplo.test' }] })).statusCode).toBe(422);
    ok(await carlos.put('/admin/integrations/zapsign', { enabled: true, config: { environment: 'sandbox' }, secrets: { apiToken: 'ZS-TOKEN' } }));
    const calls: { url: string; init?: RequestInit }[] = [];
    const pdf = Buffer.from('%PDF-1.4 assinado');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u, init) => {
      const url = String(u);
      calls.push({ url, init });
      if (url.endsWith('/api/v1/docs/') && init?.method === 'POST') return new Response(JSON.stringify({ token: 'DOC1', status: 'pending', name: 'x', original_file: null, signed_file: null, signers: [{ token: 'S1', sign_url: 'https://app.zapsign.com.br/verificar/S1', status: 'new', name: 'Cliente', email: 'cliente@exemplo.test', phone_number: null, signed_at: null }] }), { status: 200 });
      if (url.endsWith('/api/v1/docs/DOC1/')) return new Response(JSON.stringify({ token: 'DOC1', status: 'signed', name: 'x', original_file: null, signed_file: 'https://files.zapsign.test/assinado.pdf', signers: [{ token: 'S1', sign_url: 'https://app.zapsign.com.br/verificar/S1', status: 'signed', name: 'Cliente', email: 'cliente@exemplo.test', phone_number: null, signed_at: '2026-10-19T12:00:00Z' }] }), { status: 200 });
      if (url === 'https://files.zapsign.test/assinado.pdf') return new Response(pdf, { status: 200 });
      return new Response('{}', { status: 404 });
    });
    const sent = ok(await lucas.post(`/contracts/${ct}/documents/${docId}/signature`, { signers: [{ name: 'Cliente', email: 'cliente@exemplo.test' }], message: 'Por favor, assine' }), 201).json();
    expect(sent.signers[0].signUrl).toBe('https://app.zapsign.com.br/verificar/S1');
    expect(calls[0]!.url).toBe('https://sandbox.api.zapsign.com.br/api/v1/docs/');
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer ZS-TOKEN');
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.base64_docx).toBeTruthy();
    expect(body.signers[0]).toMatchObject({ name: 'Cliente', email: 'cliente@exemplo.test', send_automatic_email: true });
    expect((await lucas.post(`/contracts/${ct}/documents/${docId}/signature`, { signers: [{ name: 'Cliente', email: 'cliente@exemplo.test' }] })).statusCode).toBe(422);
    const integ = (await carlos.get('/admin/integrations')).json().items.find((i: { kind: string }) => i.kind === 'zapsign');
    const hook = await ctx.app.inject({ method: 'POST', url: new URL(integ.webhookUrl).pathname, payload: { event_type: 'doc_signed', token: 'DOC1' } });
    expect(hook.statusCode).toBe(200);
    const sigs = (await lucas.get(`/contracts/${ct}/signatures`)).json().items;
    expect(sigs[0]).toMatchObject({ status: 'assinado' });
    const after = (await lucas.get(`/contracts/${ct}/documents`)).json().items;
    const signed = after.find((d: { id: string }) => d.id === sigs[0].signedDocumentId);
    expect(signed).toMatchObject({ signed: true, version: 2, mime: 'application/pdf' });
    const detail = (await carlos.get(`/contracts/${ct}`)).json();
    const impl = detail.processes.find((p: { kind: string }) => p.kind === 'implantacao');
    expect(impl.steps.documento_assinado.doneByName).toBe('ZapSign');
    const bogus = await ctx.app.inject({ method: 'POST', url: '/api/v1/hooks/zapsign/abcdefghijklmnopqrstuvwxyz0123456789', payload: { token: 'DOC1' } });
    expect(bogus.statusCode).toBe(404);
  });
});

describe('modelo de contrato igual ao de proposta (arte + campos)', () => {
  it('cria modelo de contrato no mesmo editor, gera o PDF com o timbrado e não aparece nas propostas', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAABQCAIAAADKqIEEAAAAY0lEQVR4nO3OUQkAIBBAMb8tYTH75zCG72CwAFv73HHW94F0mLS0dIC0tHSAtLR0gLS0dIC0tHSAtLR0gLS0dIC0tHSAtLR0gLS0dIC0tHSAtLR0gLS0dIC0tHSAtLR0wMj0A7oIvkjy3AeBAAAAAElFTkSuQmCC';
    const t = ok(await carlos.post('/admin/proposal-templates', { name: 'Contrato Yepnet', purpose: 'contrato', billingType: 'recorrente', variables: [{ key: 'foro', label: 'Foro', type: 'texto', default: 'Aracaju/SE' }], fields: [{ id: 'f1', page: 0, x: 10, y: 10, w: 80, size: 12, color: '#000000', align: 'left', bold: true, text: 'Contrato {{contrato.numero}} - {{cliente.nome}} - foro {{foro}}' }] }), 201).json();
    ok(await carlos.post(`/admin/proposal-templates/${t.id}/pages`, { data: PNG }), 201);
    const list = (await carlos.get('/admin/proposal-templates?purpose=contrato')).json();
    expect(list.items.map((x: { id: string }) => x.id)).toContain(t.id);
    expect(list.systemVariables.map((v: { key: string }) => v.key)).toContain('contrato.valor_mensal');
    expect((await carlos.get('/admin/proposal-templates')).json().items.some((x: { id: string }) => x.id === t.id)).toBe(false);
    const rec = await wonContract('Cliente Arte Fictício', 'recorrente');
    const avail = (await lucas.get('/contract-templates')).json();
    expect(avail.art.map((x: { id: string }) => x.id)).toContain(t.id);
    const g = ok(await lucas.post(`/contracts/${rec.id}/generate`, { templateId: t.id, source: 'arte', values: { foro: 'Itabaiana/SE' } }), 201).json();
    const file = await lucas.get(`/contracts/${rec.id}/documents/${g.id}/download`);
    expect(file.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(g.name).toMatch(/ - CONTRATO - CLIENTE ARTE FICTÍCIO - /);
    const o = (await lucas.get(`/contracts/${rec.id}`)).json().opportunity;
    const props = (await lucas.get(`/opportunities/${o.id}/proposal-templates`)).json().items;
    expect(props.some((x: { id: string }) => x.id === t.id)).toBe(false);
  });
});

describe('relatório completo', () => {
  it('traz todos os contratos com faturamento do período, saldo e pendências; exporta planilha', async () => {
    const r = (await carlos.get(`/contracts/reports/full?from=${today.slice(0, 4)}-01-01&to=${today}`)).json();
    expect(r.summary.contracts).toBe(r.items.length);
    expect(r.summary.byType.map((x: { type: string }) => x.type)).toEqual(['recorrente', 'frequente', 'medicao']);
    const med = r.items.find((x: { billingType: string; number: string }) => x.number === 'T-medicao');
    expect(med.balance.available).toBe(60_000);
    expect(med.billedCents).toBe(40_000);
    const onlyMed = (await carlos.get('/contracts/reports/full?billingType=medicao')).json();
    expect(onlyMed.items.every((x: { billingType: string }) => x.billingType === 'medicao')).toBe(true);
    const csv = await carlos.get('/contracts/reports/full?format=csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    const head = csv.body.split('\r\n')[0];
    expect(head).toContain('Tipo de contrato');
    expect(head).toContain('Saldo disponível (R$)');
    expect(csv.body.split('\r\n').filter(Boolean)).toHaveLength(r.items.length + 1);
    const own = (await lucas.get('/contracts/reports/full')).json();
    expect(own.items.every((x: { ownerId: string }) => x.ownerId === lucas.me.user.id)).toBe(true);
  });
});
