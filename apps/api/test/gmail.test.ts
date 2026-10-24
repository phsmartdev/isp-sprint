/**
 * E-mail corporativo (Gmail) contra o servidor SIMULADO do Google: domínios, conexão OAuth com tokens cifrados,
 * sincronização inicial e incremental, regras, filas com rodízio, vínculo com a conta, privacidade da caixa pessoal,
 * resposta pelo Gmail, prazo de primeira resposta e eventos para indicadores.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, ORIGIN, type Client } from './helpers';
import { startFakeGoogle, type FakeGoogle } from './fakeGoogle';
import { syncBusinessEvents } from '../src/services/businessEvents';
import { syncMailbox } from '../src/services/gmail';

let g: FakeGoogle;
let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client, ana: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
const SHARED = `comercial-${stamp}@yepnet.test`;
let tenantId: string, sharedId: string, personalId: string, queueId: string, contactId: string, ruleId: string;
type Thread = { id: string; subject: string; status: string; assignee: { id: string } | null; queue: { id: string } | null; contact: { id: string } | null; priority: string; tags: string[]; sla: { state: string } };

/** Faz a dança do OAuth: connect → (Google simulado consente) → callback com o cookie de estado. */
async function connect(c: Client, boxId: string) {
  const r = ok(await c.post(`/mail/mailboxes/${boxId}/connect`));
  const stateCookie = String(r.headers['set-cookie']).split(';')[0]!;
  const auth = await fetch(r.json().url, { redirect: 'manual' });
  const cb = new URL(auth.headers.get('location')!);
  return ctx.app.inject({ method: 'GET', url: cb.pathname + cb.search, headers: { cookie: `${c.cookie}; ${stateCookie}`, origin: ORIGIN } });
}
const threads = async (c: Client, qs = '') => ok(await c.get(`/mail/threads?${qs}`)).json().items as Thread[];

beforeAll(async () => {
  g = await startFakeGoogle();
  ctx = await makeApp({ GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'gsecret', PUBLIC_URL: 'https://crm.exemplo.test', GOOGLE_FAKE_BASE: g.url });
  [carlos, lucas, rafael, ana] = (await Promise.all(['carlos', 'lucas', 'rafael', 'ana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  tenantId = lucas.me.tenant.id;
  const acc = ok(await lucas.post('/abm/new-account', { name: `Prefeitura Fictícia Email ${stamp}`, reason: 'Teste de e-mail' }), 201).json();
  contactId = acc.contactId;
  ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'Compradora Fictícia', email: `compras-${stamp}@prefeitura-ficticia.test` }, roles: ['decisor'] }), 201);
});
afterAll(async () => { await ctx.close(); await g.close(); });

describe('Gmail: configuração e conexão', () => {
  it('domínio obrigatório; só Configurações total cria caixa compartilhada; caixa fora do domínio é recusada', async () => {
    expect((await carlos.put('/mail/settings', { allowedDomains: [], syncDays: 30 })).statusCode).toBe(422);
    ok(await carlos.put('/mail/settings', { allowedDomains: ['@yepnet.test'], syncDays: 30 }));
    const st = ok(await lucas.get('/mail/settings')).json();
    expect(st).toMatchObject({ allowedDomains: ['yepnet.test'], canEdit: false, google: { configured: true, simulated: true, redirectUri: 'https://crm.exemplo.test/api/v1/mail/oauth/callback' } });
    expect((await lucas.post('/mail/mailboxes', { kind: 'compartilhada', address: SHARED })).statusCode).toBe(403);
    expect((await carlos.post('/mail/mailboxes', { kind: 'compartilhada', address: 'contato@outro-dominio.test' })).statusCode).toBe(422);
    sharedId = ok(await carlos.post('/mail/mailboxes', { kind: 'compartilhada', address: SHARED, displayName: 'Comercial Yepnet' }), 201).json().id;
    const own = await lucas.post('/mail/mailboxes', { kind: 'pessoal' });
    personalId = (own.statusCode === 201 ? own.json() : (ok(await lucas.get('/mail/mailboxes')).json().items.find((b: { kind: string }) => b.kind === 'pessoal'))).id;
  });

  it('OAuth: conta errada é recusada; a certa conecta com token cifrado e sincroniza a janela inicial', async () => {
    // mensagem antiga (fora da janela de 30 dias) e uma recente já na caixa
    g.deliver(SHARED, { from: 'Antigo <antigo@cliente.test>', subject: 'Mensagem antiga', text: 'fora da janela', at: Date.now() - 60 * 86_400_000 });
    g.deliver(SHARED, { from: `Compradora <compras-${stamp}@prefeitura-ficticia.test>`, subject: `Cotação de link dedicado ${stamp}`, text: 'Precisamos de 200 Mbps na secretaria.', at: Date.now() - 3600_000 });
    g.setNextAccount('outra.pessoa@yepnet.test');
    expect((await connect(carlos, sharedId)).headers.location).toBe('/email/caixas?conexao=outra_conta');
    g.setNextAccount(null);
    // cookie de estado forjado
    const bad = await ctx.app.inject({ method: 'GET', url: '/api/v1/mail/oauth/callback?code=x&state=y', headers: { cookie: carlos.cookie, origin: ORIGIN } });
    expect(bad.headers.location).toBe('/email/caixas?conexao=estado');
    expect((await connect(carlos, sharedId)).headers.location).toBe('/email/caixas?conexao=ok');
    const [row] = (await ctx.db.execute(sql`select status, refresh_token_enc, history_id from mailboxes where id = ${sharedId}`)).rows as { status: string; refresh_token_enc: string; history_id: string }[];
    expect(row!.status).toBe('conectada');
    expect(row!.refresh_token_enc).toMatch(/^v1:/);
    expect(row!.refresh_token_enc).not.toContain('rt_');
    expect(row!.history_id).toBeTruthy();
    const box = ok(await carlos.get('/mail/mailboxes')).json().items.find((b: { id: string }) => b.id === sharedId);
    expect(JSON.stringify(box)).not.toMatch(/token/i);
    expect(box.lastRun).toMatchObject({ ok: true, kind: 'completa', stored: 1 });
    const t = (await threads(carlos, `mailboxId=${sharedId}&status=todas`));
    expect(t.map((x) => x.subject)).toEqual([`Cotação de link dedicado ${stamp}`]);
    expect(t[0]!.contact?.id).toBe(contactId); // ligada sozinha pelo e-mail da stakeholder
  });
});

describe('Gmail: regras, filas e direcionamento', () => {
  it('fila em rodízio + regra de prioridade; mensagens novas entram pelo histórico, sem duplicar', async () => {
    const users = ok(await carlos.get('/admin/users')).json().users as { id: string; email: string }[];
    const uid = (n: string) => users.find((u) => u.email === `${n}@yepnet.test`)!.id;
    expect((await carlos.post('/mail/queues', { name: 'x', mailboxId: sharedId, routing: 'rodizio', slaHours: 4, members: [] })).statusCode).toBe(422);
    queueId = ok(await carlos.post('/mail/queues', { name: 'Comercial empresarial', mailboxId: sharedId, routing: 'rodizio', slaHours: 4, members: [uid('lucas'), uid('ana')] }), 201).json().id;
    expect((await carlos.post('/mail/rules', { name: 'Urgente', mailboxId: null, def: { match: 'todas', conditions: [{ field: 'assunto', op: 'contem', value: 'urgente' }], actions: {} } })).statusCode).toBe(422);
    ruleId = ok(await carlos.post('/mail/rules', { name: 'Urgente vai para a fila com prioridade', mailboxId: sharedId, def: { match: 'qualquer', conditions: [{ field: 'assunto', op: 'contem', value: 'urgente' }], actions: { queueId, priority: 'alta', tag: 'urgente' } } }), 201).json().id;
    expect(ok(await carlos.post('/mail/rules/test', { mailboxId: sharedId, from: 'a@b.test', subject: 'URGENTE: link caiu' })).json().rule.id).toBe(ruleId);
    ok(await carlos.post('/mail/rules', { name: 'Newsletter é ignorada', mailboxId: null, def: { match: 'todas', conditions: [{ field: 'dominio', op: 'igual', value: 'news.test' }], actions: { ignore: true } } }), 201);

    g.deliver(SHARED, { from: 'Hospital <ti@hospital-ficticio.test>', subject: `Urgente: link fora ${stamp}`, text: 'Sem conexão desde as 8h.' });
    g.deliver(SHARED, { from: 'Escola <dir@escola-ficticia.test>', subject: `Orçamento ${stamp}`, text: 'Gostaria de um orçamento.', attachment: 'planta.pdf' });
    g.deliver(SHARED, { from: 'promo@news.test', subject: `Ofertas da semana ${stamp}`, text: 'promo' });
    const r1 = await syncMailbox(ctx.db, ctx.app.config.gmail!, sharedId);
    expect(r1).toMatchObject({ ok: true, stored: 3 });
    expect((await syncMailbox(ctx.db, ctx.app.config.gmail!, sharedId)).stored).toBe(0);

    const all = await threads(carlos, `mailboxId=${sharedId}&status=todas`);
    const urg = all.find((x) => x.subject.startsWith('Urgente'))!;
    expect(urg).toMatchObject({ priority: 'alta', tags: ['urgente'], queue: { id: queueId } });
    const orc = all.find((x) => x.subject.startsWith('Orçamento'))!;
    expect(orc.queue?.id).toBe(queueId); // caixa da fila: entra mesmo sem regra
    expect(new Set([urg.assignee!.id, orc.assignee!.id])).toEqual(new Set([uid('lucas'), uid('ana')])); // rodízio
    expect(all.find((x) => x.subject.startsWith('Ofertas'))!.status).toBe('arquivada');
    expect(['no_prazo', 'vencendo']).toContain(urg.sla.state);
    const det = ok(await carlos.get(`/mail/threads/${orc.id}`)).json();
    expect(det.messages[0]).toMatchObject({ direction: 'entrada', from: 'dir@escola-ficticia.test', hasAttachments: true, text: 'Gostaria de um orçamento.' });
    expect(det.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['recebida', 'atribuida']));
  });

  it('histórico do Gmail expirado: refaz a janela sem duplicar', async () => {
    g.expireHistory(SHARED);
    g.deliver(SHARED, { from: 'novo@cliente-ficticio.test', subject: `Depois da expiração ${stamp}`, text: 'oi' });
    const r = await syncMailbox(ctx.db, ctx.app.config.gmail!, sharedId);
    expect(r).toMatchObject({ ok: true, stored: 1 });
    const runs = (await ctx.db.execute(sql`select kind from mail_sync_runs where mailbox_id = ${sharedId} order by created_at desc limit 1`)).rows as { kind: string }[];
    expect(runs[0]!.kind).toMatch(/histórico expirado/);
  });
});

describe('Gmail: visibilidade, atendimento e resposta', () => {
  it('quem não está na fila não vê a caixa compartilhada; caixa pessoal só a dona vê (nem a gerência)', async () => {
    expect((await threads(rafael, `status=todas`)).some((x) => x.subject.includes(stamp))).toBe(false);
    expect((await threads(lucas, `mailboxId=${sharedId}&status=todas`)).length).toBeGreaterThan(0);
    g.deliver(`lucas@yepnet.test`, { from: 'amigo@pessoal.test', subject: `Particular ${stamp}`, text: 'assunto pessoal' });
    expect((await connect(lucas, personalId)).headers.location).toBe('/email/caixas?conexao=ok');
    const mine = await threads(lucas, `mailboxId=${personalId}&status=todas`);
    expect(mine.map((x) => x.subject)).toContain(`Particular ${stamp}`);
    expect((await threads(carlos, 'status=todas')).some((x) => x.subject === `Particular ${stamp}`)).toBe(false);
    expect((await carlos.get(`/mail/threads/${mine[0]!.id}`)).statusCode).toBe(404);
    expect((await carlos.post(`/mail/mailboxes/${personalId}/connect`)).statusCode).toBe(404); // não é a dona
  });

  it('responder sai pelo Gmail na mesma conversa, marca a 1ª resposta, muda a situação e vira evento', async () => {
    const t = (await threads(lucas, `mailboxId=${sharedId}&status=todas`)).find((x) => x.subject.startsWith('Cotação'))!;
    expect((await rafael.post(`/mail/threads/${t.id}/reply`, { text: 'oi' })).statusCode).toBe(404);
    ok(await lucas.post(`/mail/threads/${t.id}/reply`, { text: 'Olá! Segue a proposta de 200 Mbps em anexo no portal.' }));
    const sent = g.sent.at(-1)!;
    expect(sent.from).toBe(SHARED);
    const raw = Buffer.from(sent.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    expect(raw).toMatch(/^From: Comercial Yepnet <comercial-/);
    expect(raw).toMatch(/In-Reply-To: <.+@remetente\.test>/);
    const subj = raw.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)![1]!;
    expect(Buffer.from(subj, 'base64').toString()).toBe(`Re: Cotação de link dedicado ${stamp}`);
    expect(raw).toContain(`To: compras-${stamp}@prefeitura-ficticia.test`);
    const det = ok(await lucas.get(`/mail/threads/${t.id}`)).json();
    expect(det.messages.map((m: { direction: string }) => m.direction)).toEqual(['entrada', 'saida']);
    expect(det.status).toBe('aguardando_cliente');
    expect(det.sla.state).toBe('sem_prazo'); // conversa sem fila (chegou antes da fila existir)
    // sincronizar de novo não duplica a mensagem enviada
    await syncMailbox(ctx.db, ctx.app.config.gmail!, sharedId);
    expect(ok(await lucas.get(`/mail/threads/${t.id}`)).json().messages).toHaveLength(2);
    // cliente responde → volta para atendimento
    g.deliver(SHARED, { from: `compras-${stamp}@prefeitura-ficticia.test`, subject: `Re: Cotação de link dedicado ${stamp}`, text: 'Recebido, obrigado.', threadOf: det.messages[0].id });
    await syncMailbox(ctx.db, ctx.app.config.gmail!, sharedId);
    expect(ok(await lucas.get(`/mail/threads/${t.id}`)).json().status).toBe('em_atendimento');
    // aparece no histórico de interações da conta
    const inter = ok(await lucas.get(`/accounts/${contactId}/interactions`)).json().items as { source: string; title: string }[];
    expect(inter.filter((i) => i.source === 'gmail').length).toBeGreaterThanOrEqual(3);
    expect(ok(await lucas.get(`/accounts/${contactId}/emails`)).json().items[0].id).toBe(t.id);
  });

  it('atribuição e situação com regras; resolvida vira evento; vínculo manual exige conta e oportunidade da mesma conta', async () => {
    const t = (await threads(carlos, `queueId=${queueId}`)).find((x) => x.subject.startsWith('Urgente'))!;
    let d = ok(await carlos.get(`/mail/threads/${t.id}`)).json();
    expect((await rafael.patch(`/mail/threads/${t.id}`, { rowVersion: d.rowVersion, assigneeId: rafael.me.user.id })).statusCode).toBe(404);
    expect((await lucas.patch(`/mail/threads/${t.id}`, { rowVersion: d.rowVersion, assigneeId: rafael.me.user.id })).statusCode).toBe(422); // fora da fila
    ok(await carlos.patch(`/mail/threads/${t.id}`, { rowVersion: d.rowVersion, status: 'em_atendimento' }));
    d = ok(await carlos.get(`/mail/threads/${t.id}`)).json();
    expect((await carlos.patch(`/mail/threads/${t.id}`, { rowVersion: d.rowVersion, status: 'nova' })).statusCode).toBe(422);
    expect((await carlos.patch(`/mail/threads/${t.id}`, { rowVersion: d.rowVersion - 1, priority: 'baixa' })).statusCode).toBe(409);
    const other = ok(await carlos.post('/abm/new-account', { name: `Hospital Fictício Email ${stamp}`, reason: 'Outra conta' }), 201).json();
    const plan = (await carlos.get('/meta/lookups')).json().plans[0];
    const opp = ok(await carlos.post('/opportunities', { contactId, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false }), 201).json().id;
    ok(await carlos.patch(`/mail/threads/${t.id}`, { rowVersion: d.rowVersion, contactId: other.contactId }));
    d = ok(await carlos.get(`/mail/threads/${t.id}`)).json();
    expect((await carlos.patch(`/mail/threads/${t.id}`, { rowVersion: d.rowVersion, opportunityId: opp })).statusCode).toBe(422);
    ok(await carlos.patch(`/mail/threads/${t.id}`, { rowVersion: d.rowVersion, contactId, opportunityId: opp }));
    d = ok(await carlos.get(`/mail/threads/${t.id}`)).json();
    ok(await lucas.post(`/mail/threads/${t.id}/reply`, { text: 'Equipe técnica a caminho.', resolve: true })); // lucas está na fila
    d = ok(await carlos.get(`/mail/threads/${t.id}`)).json();
    expect(d.status).toBe('resolvida');
    expect(['respondida_no_prazo', 'respondida_fora']).toContain(d.sla.state);
    await syncBusinessEvents(ctx.db, tenantId);
    const evs = (await ctx.db.execute(sql`select type, outcome, context from business_events where tenant_id = ${tenantId} and source_id = ${t.id} order by type`)).rows as { type: string; outcome: string; context: { minutesToReply: number } }[];
    expect(evs.map((e) => e.type)).toEqual(['email_resolvido', 'email_respondido']);
    expect(evs[1]!.outcome).toBe('no_prazo');
    expect(typeof evs[1]!.context.minutesToReply).toBe('number');
    // números da fila
    const st = ok(await carlos.get('/mail/stats')).json().items.find((x: { queue_id: string }) => x.queue_id === queueId);
    expect(st).toMatchObject({ queue: 'Comercial empresarial' });
    expect(st.respondidas).toBeGreaterThanOrEqual(1);
    expect(st.resolvidas).toBeGreaterThanOrEqual(1);
  });

  it('e-mail vira negociação: anexo .eml, conversa ligada, resposta da negociação sai pela mesma conversa', async () => {
    g.deliver(SHARED, { from: `Licitações <licita-${stamp}@camara-ficticia.test>`, subject: `Pedido de proposta ${stamp}`, text: 'Solicitamos proposta para 10 pontos de fibra.' });
    await syncMailbox(ctx.db, ctx.app.config.gmail!, sharedId);
    const t = (await threads(carlos, `mailboxId=${sharedId}&status=todas`)).find((x) => x.subject === `Pedido de proposta ${stamp}`)!;
    expect(t).toBeTruthy();
    const lk = ok(await carlos.get('/meta/lookups')).json();
    const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
    const body = { opportunity: { pipelineId: corp.id, saleKind: 'venda_consultiva', branchId: lk.branches[0].id, title: `Pedido de proposta ${stamp}`, newContact: { name: `Câmara Fictícia ${stamp}`, email: `licita-${stamp}@camara-ficticia.test`, segment: 'governamental' } } };
    const oppId = ok(await carlos.post(`/mail/threads/${t.id}/opportunity`, body), 201).json().id;
    expect((await carlos.post(`/mail/threads/${t.id}/opportunity`, body)).statusCode).toBe(422);
    const att = ok(await carlos.get(`/opportunities/${oppId}/attachments`)).json().items as { id: string; kind: string; filename: string; mime: string }[];
    const eml = att.find((a) => a.kind === 'email')!;
    expect(eml).toMatchObject({ mime: 'message/rfc822', filename: `E-mail de origem - Pedido de proposta ${stamp}.eml` });
    const dl = await carlos.get(`/opportunities/${oppId}/attachments/${eml.id}/download`);
    expect(dl.body).toContain(`From: =?UTF-8?B?`);
    expect(dl.body).toContain(`<licita-${stamp}@camara-ficticia.test>`);
    const d = ok(await carlos.get(`/mail/threads/${t.id}`)).json();
    expect(d.opportunityId).toBe(oppId);
    const origin = ok(await carlos.get(`/opportunities/${oppId}/origin-email`)).json().thread;
    expect(origin).toMatchObject({ id: t.id, mailbox: SHARED, canReply: true });
    expect(origin.messages[0].text).toMatch(/10 pontos de fibra/);
    const before = g.sent.length;
    ok(await carlos.post(`/opportunities/${oppId}/origin-email/reply`, { text: 'Recebemos o pedido; enviaremos a proposta amanhã.' }));
    expect(g.sent.length).toBe(before + 1);
    const sent = g.sent.at(-1)!;
    expect(sent.from).toBe(SHARED);
    expect(sent.threadId).toBeTruthy();
    const raw = Buffer.from(sent.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    expect(raw).toContain(`To: licita-${stamp}@camara-ficticia.test`);
    expect(raw).toMatch(/In-Reply-To: <.+>/);
    expect((await rafael.post(`/opportunities/${oppId}/origin-email/reply`, { text: 'x' })).statusCode).toBe(404);
    const tl = ok(await carlos.get(`/opportunities/${oppId}/timeline`)).json();
    expect(JSON.stringify(tl.items)).toMatch(/resposta enviada pela caixa/);
  });

  it('acesso revogado no Google: caixa fica com erro e pede nova conexão; desconectar apaga os tokens', async () => {
    g.revokeAll();
    await ctx.db.execute(sql`update mailboxes set access_expires_at = now() - interval '1 hour' where id = ${sharedId}`);
    const r = await syncMailbox(ctx.db, ctx.app.config.gmail!, sharedId);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/revogado/);
    expect(((await ctx.db.execute(sql`select status from mailboxes where id = ${sharedId}`)).rows[0] as { status: string }).status).toBe('erro');
    expect((await ana.post(`/mail/mailboxes/${sharedId}/state`, { action: 'desconectar' })).statusCode).toBe(403);
    ok(await carlos.post(`/mail/mailboxes/${sharedId}/state`, { action: 'desconectar' }));
    const [row] = (await ctx.db.execute(sql`select status, refresh_token_enc, access_token_enc from mailboxes where id = ${sharedId}`)).rows as { status: string; refresh_token_enc: string | null; access_token_enc: string | null }[];
    expect(row).toEqual({ status: 'desconectada', refresh_token_enc: null, access_token_enc: null });
    // as conversas continuam
    expect((await threads(carlos, `mailboxId=${sharedId}&status=todas`)).length).toBeGreaterThan(3);
    // mensagens são imutáveis
    await expect(ctx.db.execute(sql`update mail_messages set body_text = 'x' where mailbox_id = ${sharedId}`)).rejects.toThrow(/append-only/);
  });
});
