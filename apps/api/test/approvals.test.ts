/** Análise e aprovação da negociação: novo × base, alçadas, decisão, mudança material, chat, avisos e classificação. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { setTransportFactory } from '../src/services/email';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client, mariana: Client;
const sent: { to: string; subject: string; text: string }[] = [];
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const today = new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas, mariana] = (await Promise.all(['carlos', 'ana', 'lucas', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  setTransportFactory(() => ({ sendMail: async (m: { to: string; subject: string; text: string }) => { sent.push(m); return { messageId: `m${sent.length}` }; } }) as never);
  ok(await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', password: 'x', fromName: 'Yepnet', fromEmail: 'vendas@yepnet.test', replyTo: null, enabled: true }));
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', fromName: 'Yepnet', fromEmail: 'vendas@yepnet.test', replyTo: null, enabled: false });
  setTransportFactory(null);
  await ctx.close();
});

const plan = async () => (await lucas.get('/meta/lookups')).json().plans[0] as { id: string; priceCents: number; name: string };

describe('novo cliente', () => {
  let oppId: string;
  it('mostra potencial e viabilidade, sem histórico financeiro', async () => {
    const p = await plan();
    oppId = ok(await lucas.post('/opportunities', { newContact: { name: 'Prospect Aprovação Fictício', phone: '(79) 97777-1111', segment: 'residencial' }, planId: p.id, cableMeters: 80, saleType: 'ativa' }), 201).json().id;
    const a = ok(await lucas.get(`/opportunities/${oppId}/approval`)).json();
    expect(a.kind.kind).toBe('novo');
    expect(a.intelligence).toBeNull();
    expect(a.executive).toMatchObject({ kindLabel: 'Novo cliente', monthlyRevenueCents: null, activeContracts: null });
    expect(a.terms.listMonthlyCents).toBe(p.priceCents);
    expect(a.viability).not.toBeNull();
    expect(a.opinion.summary).toContain('Novo cliente');
    expect(a.dataReference.some((d: { source: string }) => d.source.includes('IXC'))).toBe(true);
    // prévia com desconto muda a alçada
    const pre = ok(await lucas.get(`/opportunities/${oppId}/approval?proposed=${Math.round(p.priceCents * 0.9)}`)).json();
    expect(pre.margin.discount.bp).toBe(1000);
    expect(pre.policy.required.level).toBe('gerencia');
  });

  it('pedido com desconto exige Gerência; vendedor, supervisora e o próprio solicitante não decidem', async () => {
    const p = await plan();
    sent.length = 0;
    const r = ok(await lucas.post(`/opportunities/${oppId}/approval/requests`, { negotiationType: 'novo_servico', proposedMonthlyCents: Math.round(p.priceCents * 0.9), justification: 'Cliente fecha hoje com 10% de desconto no primeiro ano.' }), 201).json();
    expect(r).toMatchObject({ version: 1, requiredLevel: 'gerencia', exceptional: false });
    // aviso só com o resumo seguro, para quem tem alçada
    expect(sent.map((m) => m.to)).toContain('carlos@yepnet.test');
    expect(sent.map((m) => m.to)).not.toContain('ana@yepnet.test');
    const mail = sent.find((m) => m.to === 'carlos@yepnet.test')!;
    expect(mail.text).toContain('Prospect Aprovação Fictício');
    expect(mail.text).toContain('/aprovacao');
    expect(mail.text).not.toMatch(/margem|total pago|contratos ativos/i);

    expect(ok(await ana.post(`/approval-requests/${r.id}/decision`, { decision: 'aprovada' }), 403).json().detail).toContain('alçada Gerência');
    ok(await lucas.post(`/approval-requests/${r.id}/decision`, { decision: 'aprovada' }), 403);
    ok(await carlos.post(`/approval-requests/${r.id}/decision`, { decision: 'reprovada', comment: '' }), 422);
    ok(await carlos.post(`/approval-requests/${r.id}/decision`, { decision: 'aprovada', comment: 'Ok dentro da política.' }));
    ok(await carlos.post(`/approval-requests/${r.id}/decision`, { decision: 'aprovada' }), 422);

    const a = ok(await lucas.get(`/opportunities/${oppId}/approval`)).json();
    expect(a.requests[0]).toMatchObject({ status: 'aprovada', version: 1 });
    expect(a.requests[0].decision).toMatchObject({ by: 'Carlos Silva', level: 'gerencia' });
    expect(a.requests[0].decision.approvedConditions.proposedMonthlyCents).toBe(Math.round(p.priceCents * 0.9));
    expect(a.chat.map((m: { body: string }) => m.body).join(' | ')).toMatch(/Aprovação solicitada \(v1\).*Aprovada \(v1\) por Carlos Silva/);
    expect(a.timelines.negotiation.some((i: { kind: string }) => i.kind === 'approval_decided')).toBe(true);
    // lucas recebeu o resultado
    expect(sent.some((m) => m.to === 'lucas@yepnet.test' && m.subject.startsWith('Aprovada'))).toBe(true);
  });

  it('histórico é append-only', async () => {
    await expect(ctx.db.execute(sql`update approval_requests set justification = 'x'`)).rejects.toThrow(/append-only/);
    await expect(ctx.db.execute(sql`delete from approval_decisions`)).rejects.toThrow(/append-only/);
  });
});

describe('cliente da base', () => {
  let contactId: string, oppId: string, requestId: string;
  it('cliente com contrato: Inteligência do Cliente, contratos e margem sem duplicar receita', async () => {
    const p = await plan();
    const o = ok(await lucas.post('/opportunities', { newContact: { name: 'Empresa Base Aprovação Fictícia', segment: 'empresarial' }, planId: p.id, cableMeters: 50, saleType: 'ativa' }), 201).json();
    contactId = o.contactId;
    ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
    const cid = ok(await carlos.post('/contracts', { opportunityId: o.id, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { number: 'APR-1', object: 'Link dedicado fictício', signedAt: addDays(today, -400), startAt: addDays(today, -400), termMonths: 24, monthlyCents: 80_000, items: [{ planId: null, description: 'Link 200M', qty: 1, unitCents: 80_000 }] } }), 201).json().id;
    ok(await carlos.post(`/contracts/${cid}/validate`));

    oppId = ok(await lucas.post('/opportunities', { contactId, planId: p.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false }), 201).json().id;
    const a = ok(await lucas.get(`/opportunities/${oppId}/approval`)).json();
    expect(a.kind.kind).toBe('base');
    expect(a.intelligence.activeContracts).toBe(1);
    expect(a.intelligence.monthlyRevenueCents.value).toBe(80_000); // venda com contrato conta uma vez só, pelo contrato
    expect(a.intelligence.services).toHaveLength(1);
    expect(a.intelligence.relationshipMonths).toBeGreaterThanOrEqual(12);
    expect(a.intelligence.totalPaid.kind).toBe('indisponivel');
    expect(a.contracts[0]).toMatchObject({ number: 'APR-1', status: 'ativo', monthlyCents: 80_000 });
    expect(a.classification.current).toBeNull();
    expect(a.opinion.pending.map((x: { text: string }) => x.text)).toContain('Cliente sem classificação estratégica (Não classificado).');
    expect(a.executive.marginBeforeBp).not.toBeUndefined();
  });

  it('classificação: só opções cadastradas; pedido de atualização vira tarefa', async () => {
    ok(await lucas.post(`/contacts/${contactId}/classification`, { classKey: 'Classe A' }), 403); // vendedor (nível Próprio) não classifica
    ok(await carlos.post(`/contacts/${contactId}/classification`, { classKey: 'Classe Z' }), 422);
    ok(await carlos.post(`/contacts/${contactId}/classification`, { classKey: 'Classe A', payerProfile: 'Pontual', risk: 'Baixo', notes: 'Conta estratégica' }), 201);
    const c = ok(await carlos.get(`/contacts/${contactId}/classification`)).json();
    expect(c.current).toMatchObject({ classKey: 'Classe A', payerProfile: 'Pontual', classifiedBy: 'Carlos Silva' });
    const t = ok(await lucas.post(`/contacts/${contactId}/classification/request-update`, { opportunityId: oppId }), 201).json();
    expect(t.activityId).toBeTruthy();
  });

  it('upgrade: substitui receita; mudança material pede confirmação antes de aprovar', async () => {
    const r = ok(await lucas.post(`/opportunities/${oppId}/approval/requests`, { negotiationType: 'upgrade', proposedMonthlyCents: 100_000, replacesMonthlyCents: 80_000, justification: 'Upgrade do link com SLA melhor.' }), 201).json();
    requestId = r.id;
    const a = ok(await carlos.get(`/opportunities/${oppId}/approval`)).json();
    expect(a.margin.incremental.revenueCents).toBe(20_000);
    expect(a.margin.after.revenueCents).toBe(100_000);
    expect(a.executive.classKey).toBe('Classe A');
    expect(a.opinion.summary).toContain('Cliente da base classificado como Classe A');
    expect(a.viewer.isApprover).toBe(true);
    // a classificação muda depois do pedido
    ok(await carlos.post(`/contacts/${contactId}/classification`, { classKey: 'Classe B', payerProfile: 'Atrasos eventuais' }), 201);
    const b = ok(await carlos.get(`/opportunities/${oppId}/approval`)).json();
    expect(b.materialChanges).toContain('A classificação estratégica do cliente foi atualizada.');
    expect(ok(await carlos.post(`/approval-requests/${requestId}/decision`, { decision: 'aprovada' }), 422).json().detail).toContain('Os dados mudaram');
    ok(await carlos.post(`/approval-requests/${requestId}/decision`, { decision: 'aprovada', acknowledgeChanges: true, comment: 'Ciente da reclassificação.' }));
    const [d] = (await ctx.db.execute(sql`select material_changes, financial_summary, level from approval_decisions where request_id = ${requestId}`)).rows as { material_changes: string[]; financial_summary: { incrementalRevenueCents: number }; level: string }[];
    expect(d!.material_changes).toContain('A classificação estratégica do cliente foi atualizada.');
    expect(d!.financial_summary.incrementalRevenueCents).toBe(20_000);
  });

  it('nova versão substitui a pendente; fila mostra o que cabe na alçada', async () => {
    const v1 = ok(await lucas.post(`/opportunities/${oppId}/approval/requests`, { negotiationType: 'upgrade', proposedMonthlyCents: 95_000, replacesMonthlyCents: 80_000, justification: 'Contraproposta do cliente.' }), 201).json();
    const v2 = ok(await lucas.post(`/opportunities/${oppId}/approval/requests`, { negotiationType: 'upgrade', proposedMonthlyCents: 97_000, replacesMonthlyCents: 80_000, justification: 'Ajuste após conversa.' }), 201).json();
    expect(v2.version).toBe(v1.version + 1);
    const a = ok(await lucas.get(`/opportunities/${oppId}/approval`)).json();
    expect(a.requests.find((x: { id: string }) => x.id === v1.id).status).toBe('substituida');
    const q = ok(await carlos.get('/approvals')).json();
    expect(q.items.some((i: { id: string; canDecide: boolean }) => i.id === v2.id && i.canDecide)).toBe(true);
    expect(q.items.some((i: { id: string }) => i.id === v1.id)).toBe(false);
    // mariana (vendedora de outro time) não abre a análise
    ok(await mariana.get(`/opportunities/${oppId}/approval`), 404);
  });

  it('chat da negociação e cadastros parecidos sem consolidar automaticamente', async () => {
    ok(await lucas.post(`/opportunities/${oppId}/chat`, { body: 'Cliente pediu resposta até sexta.' }), 201);
    const chat = ok(await carlos.get(`/opportunities/${oppId}/chat`)).json().items;
    expect(chat.at(-1)).toMatchObject({ kind: 'mensagem', authorName: 'Lucas Lima' });
    // cadastro duplicado (mesmo telefone) aparece como candidato, sem entrar na análise
    const dupe = ok(await lucas.post('/opportunities', { newContact: { name: 'Empresa Base (cadastro antigo)', phone: '(79) 96666-2222', segment: 'empresarial' } }), 201).json();
    await ctx.db.execute(sql`update contacts set phone = '(79) 96666-2222' where id = ${contactId}`);
    let a = ok(await carlos.get(`/opportunities/${oppId}/approval`)).json();
    const cand = a.identity.candidates.find((c: { id: string }) => c.id === dupe.contactId);
    expect(cand).toMatchObject({ match: ['telefone'], decision: null });
    expect(a.identity.contactIds).toEqual([contactId]);
    ok(await carlos.post(`/opportunities/${oppId}/approval/identity`, { otherContactId: dupe.contactId, decision: 'mesmo' }));
    a = ok(await carlos.get(`/opportunities/${oppId}/approval`)).json();
    expect(a.identity.contactIds).toContain(dupe.contactId);
    expect(a.otherOpportunities.some((o: { id: string }) => o.id === dupe.id)).toBe(true);
  });
});

describe('configurações e WhatsApp', () => {
  it('alçadas em ordem; aviso só com resumo seguro; WhatsApp pela Z-API para quem tem número', async () => {
    const st = ok(await carlos.get('/admin/approval-settings')).json();
    const bad = { ...st, policy: { limits: st.policy.limits.map((l: { level: string }) => (l.level === 'gerencia' ? { ...l, maxDiscountBp: 100 } : l)) } };
    ok(await carlos.put('/admin/approval-settings', bad), 422);
    ok(await carlos.put('/admin/approval-settings', { ...st, template: 'Total pago {{total_pago}} {{link}}' }), 422);
    ok(await lucas.get('/admin/approval-settings'), 403);
    ok(await carlos.put('/admin/approval-settings', { ...st, notifyEmail: false, notifyWhatsapp: true, notifyShowClass: true }));
    ok(await carlos.put('/admin/integrations/zapi', { enabled: true, config: { instanceId: 'INSTAPR' }, secrets: { instanceToken: 'TOKAPR', clientToken: 'CLIAPR' } }));
    const users = (await carlos.get('/admin/users')).json().users as { id: string; email: string }[];
    ok(await carlos.patch(`/admin/users/${users.find((u) => u.email === 'carlos@yepnet.test')!.id}`, { phone: '(79) 99999-0000' }));

    const p = await plan();
    const o = ok(await lucas.post('/opportunities', { newContact: { name: 'Cliente WhatsApp Aprovação Fictício', segment: 'residencial' }, planId: p.id }), 201).json();
    ok(await carlos.post(`/contacts/${o.contactId}/classification`, { classKey: 'Classe C' }), 201);
    const calls: { url: string; body: { phone: string; message: string } }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => { calls.push({ url: String(url), body: JSON.parse(String(init!.body)) }); return new Response(JSON.stringify({ messageId: 'w1' }), { status: 200 }); });
    ok(await lucas.post(`/opportunities/${o.id}/approval/requests`, { negotiationType: 'novo_servico', proposedMonthlyCents: p.priceCents, justification: 'Venda padrão sem desconto.' }), 201);
    const toCarlos = calls.find((c) => c.body.phone === '5579999990000')!;
    expect(toCarlos.url).toBe('https://api.z-api.io/instances/INSTAPR/token/TOKAPR/send-text');
    expect(toCarlos.body.message).toContain('Classe: Classe C');
    expect(toCarlos.body.message).toContain(`OP-`);
    const chat = ok(await lucas.get(`/opportunities/${o.id}/chat`)).json().items;
    expect(chat.at(-1).body).toContain('WhatsApp para Carlos Silva.');
    expect(chat.at(-1).body).toContain('sem número no cadastro'); // outros aprovadores sem WhatsApp
    ok(await carlos.put('/admin/approval-settings', st));
    ok(await carlos.put('/admin/integrations/zapi', { enabled: false, config: { instanceId: 'INSTAPR' }, secrets: {} }));
  });
});
