/** Chamados no GLPI a partir da negociação (contra o GLPI 11 simulado). */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { GLPI_CREDS, startFakeGlpi, type FakeGlpi } from './fakeGlpi';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let glpi: FakeGlpi;
let carlos: Client, lucas: Client, rafael: Client;
let oppId = '', ticketId = '', glpiId = 0, hookToken = '';
const SECRET = 'segredo-do-webhook-glpi';
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

/** Entrega o aviso exatamente como o GLPI: corpo JSON sem Content-Type, assinado com corpo + timestamp. */
async function deliver(item: Record<string, unknown>, opts: { secret?: string; ts?: number } = {}) {
  const payload = JSON.stringify({ event: 'update', item }, null, 4);
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', opts.secret ?? SECRET).update(payload + ts).digest('hex');
  return ctx.app.inject({ method: 'POST', url: `/api/v1/hooks/glpi/${hookToken}`, headers: { 'x-glpi-signature': sig, 'x-glpi-timestamp': ts }, payload });
}

beforeAll(async () => {
  ctx = await makeApp();
  glpi = await startFakeGlpi();
  [carlos, lucas, rafael] = (await Promise.all(['carlos', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const list = ok(await lucas.get('/opportunities?scope=minhas&pageSize=5')).json();
  oppId = (list.items.find((o: { customerId: string | null }) => o.customerId) ?? list.items[0]).id;
});
afterAll(async () => { await ctx.db.execute(sql`update integrations set enabled = false where kind = 'glpi'`); await glpi.close(); await ctx.close(); });

describe('GLPI', () => {
  it('configuração: sem integração a tela avisa; o teste confere cliente e usuário; segredos não voltam', async () => {
    expect(ok(await lucas.get('/glpi/status')).json()).toMatchObject({ ready: false });
    ok(await carlos.put('/admin/integrations/glpi', { enabled: true, config: { baseUrl: `${glpi.url}/`, clientId: GLPI_CREDS.clientId, username: GLPI_CREDS.username }, secrets: { clientSecret: 'errado', password: GLPI_CREDS.password, webhookSecret: SECRET } }));
    expect(ok(await carlos.post('/admin/integrations/glpi/test')).json()).toMatchObject({ ok: false, message: expect.stringMatching(/cliente OAuth/) });
    ok(await carlos.put('/admin/integrations/glpi', { enabled: true, config: { baseUrl: glpi.url, clientId: GLPI_CREDS.clientId, username: GLPI_CREDS.username }, secrets: { clientSecret: GLPI_CREDS.clientSecret } }));
    expect(ok(await carlos.post('/admin/integrations/glpi/test')).json()).toMatchObject({ ok: true, message: expect.stringMatching(/3 entidade/) });
    const adm = ok(await carlos.get('/admin/integrations')).json().items.find((i: { kind: string }) => i.kind === 'glpi');
    expect(adm.secretsSet).toEqual({ clientSecret: true, password: true, webhookSecret: true });
    expect(JSON.stringify(adm)).not.toContain(GLPI_CREDS.password);
    hookToken = adm.webhookUrl.split('/').pop();
    expect(ok(await lucas.get('/glpi/status')).json()).toMatchObject({ ready: true });
    expect((await lucas.put('/admin/integrations/glpi', { enabled: false, config: {}, secrets: {} })).statusCode).toBe(403);
  });

  it('abre o chamado na entidade escolhida, com categoria e grupo do GLPI; lembra a entidade do cliente', async () => {
    const ents = ok(await lucas.get(`/glpi/entities?q=lagarto&opportunityId=${oppId}`)).json();
    expect(ents.items).toEqual([{ id: 3, name: 'Raiz > Clientes > Prefeitura de Lagarto' }]);
    expect(ok(await lucas.get('/glpi/categories')).json().items).toHaveLength(2);
    expect(ok(await lucas.get('/glpi/groups?q=noc')).json().items).toEqual([{ id: 11, name: 'NOC' }]);
    expect((await lucas.post(`/opportunities/${oppId}/glpi-tickets`, { entityId: 3, type: 1, urgency: 4, title: 'Oi', content: 'curto' })).statusCode).toBe(422);
    const r = ok(await lucas.post(`/opportunities/${oppId}/glpi-tickets`, {
      entityId: 3, entityName: 'Raiz > Clientes > Prefeitura de Lagarto', categoryId: 7, categoryName: 'Rede > Link dedicado', groupId: 11, groupName: 'NOC',
      type: 1, urgency: 4, title: 'Viabilidade de link dedicado 200 Mb', content: 'Cliente pede confirmação de viabilidade\npara o prédio da secretaria.',
    }), 201).json();
    ({ id: ticketId, glpiId } = r);
    expect(r.warning).toBeNull();
    const t = glpi.tickets.get(glpiId)!;
    expect(t).toMatchObject({ entity: 3, category: 7, type: 1, urgency: 4, name: 'Viabilidade de link dedicado 200 Mb' });
    expect(t.content).toContain('<p>Cliente pede confirmação de viabilidade<br>para o prédio da secretaria.</p>');
    expect(t.content).toMatch(/Aberto no RevOps por Lucas/);
    expect(t.content.startsWith('<p><strong>Ticket gerado a partir do RevOps por Lucas Lima:</strong></p>')).toBe(true);
    expect(t.team).toEqual([{ type: 'Group', id: 11, role: 'assigned' }]);
    const opp = ok(await lucas.get(`/opportunities/${oppId}`)).json();
    if (opp.customerId) expect(ok(await lucas.get(`/glpi/entities?opportunityId=${oppId}`)).json().linked).toEqual({ id: 3, name: 'Raiz > Clientes > Prefeitura de Lagarto' });
    const tl = ok(await lucas.get(`/opportunities/${oppId}/timeline`)).json();
    expect(JSON.stringify(tl)).toContain('glpi_ticket_opened');
  });

  it('retorno pelo webhook: assinatura conferida; acompanhamento, tarefa e solução entram sem duplicar; solução vira tarefa do dono', async () => {
    await glpi.act(glpiId, { kind: 'followup', text: 'Visita técnica agendada para quinta.' });
    expect((await deliver({ id: 1, itemtype: 'Ticket', items_id: glpiId }, { secret: 'outro' })).statusCode).toBe(401);
    expect((await deliver({ id: 1, itemtype: 'Ticket', items_id: glpiId }, { ts: Math.floor(Date.now() / 1000) - 3600 })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url: `/api/v1/hooks/glpi/${hookToken}`, payload: '{}' })).statusCode).toBe(401);
    ok(await deliver({ id: 1, itemtype: 'Ticket', items_id: glpiId }));
    ok(await deliver({ id: 1, itemtype: 'Ticket', items_id: glpiId })); // repetido: não duplica
    expect(ok(await deliver({ id: 1, itemtype: 'Change', items_id: glpiId })).json()).toMatchObject({ ignored: 'sem chamado' });
    expect(ok(await deliver({ id: 1, itemtype: 'Ticket', items_id: 99999 })).json()).toMatchObject({ ignored: 'chamado não aberto pelo CRM' });
    expect(ok(await lucas.get(`/opportunities/${oppId}/glpi-tickets/unseen`)).json()).toEqual({ total: 1, open: 1, unseen: 2 }); // acompanhamento + situação
    await glpi.act(glpiId, { kind: 'task', text: 'Checar porta no switch do POP', isPrivate: true });
    await glpi.act(glpiId, { kind: 'solution', text: 'Viabilidade confirmada: 200 Mb pela rota norte.' });
    ok(await deliver({ id: glpiId, status: { id: 5, name: 'Solucionado' } }));
    const list = ok(await lucas.get(`/opportunities/${oppId}/glpi-tickets`)).json();
    const t = list.items[0];
    expect(t).toMatchObject({ glpiId, status: 5, statusName: 'Solucionado', open: false, entityName: 'Raiz > Clientes > Prefeitura de Lagarto', groupName: 'NOC', url: `${glpi.url}/front/ticket.form.php?id=${glpiId}` });
    const kinds = t.events.map((e: { kind: string }) => e.kind);
    expect(kinds[0]).toBe('Abertura');
    expect([...kinds].sort()).toEqual(['Abertura', 'Followup', 'Solution', 'Status', 'Status', 'Task']);
    expect(t.events.find((e: { kind: string }) => e.kind === 'Task')).toMatchObject({ isPrivate: true, author: 'Técnico NOC' });
    expect(t.events.find((e: { kind: string }) => e.kind === 'Solution').text).toBe('Viabilidade confirmada: 200 Mb pela rota norte.');
    expect(ok(await lucas.get(`/opportunities/${oppId}/glpi-tickets/unseen`)).json().unseen).toBe(0); // abriu a aba
    const acts = ok(await lucas.get('/activities?status=abertas&pageSize=50')).json();
    expect(acts.items.some((a: { title: string }) => a.title === `Dar retorno ao cliente: chamado GLPI #${glpiId} solucionado`)).toBe(true);
    await expect(ctx.db.execute(sql`update glpi_ticket_events set text = 'x' where ticket_id = ${ticketId}`)).rejects.toThrow(/append-only/);
  });

  it('resposta do CRM vai como acompanhamento e não volta como "novo"; releitura manual; erro do GLPI aparece claro', async () => {
    ok(await lucas.post(`/glpi-tickets/${ticketId}/followups`, { text: 'Cliente aprovou a rota norte, pode seguir.' }), 201);
    const t = glpi.tickets.get(glpiId)!;
    expect(t.timeline.at(-1)!.item.content).toBe('<p><strong>Resposta enviada pelo RevOps por Lucas Lima:</strong></p><p>Cliente aprovou a rota norte, pode seguir.</p>');
    expect(t.timeline.at(-1)!.item.is_private).toBe(false);
    ok(await lucas.post(`/glpi-tickets/${ticketId}/followups`, { text: 'Nota interna: cliente sensível a prazo.', isPrivate: true }), 201);
    expect(t.timeline.at(-1)!.item.is_private).toBe(true);
    expect(ok(await lucas.post(`/glpi-tickets/${ticketId}/sync`)).json()).toMatchObject({ added: 0, status: 5 });
    glpi.failNext(500);
    const bad = await lucas.post(`/glpi-tickets/${ticketId}/sync`);
    expect(bad.statusCode).toBe(502);
    expect(bad.json().detail).toMatch(/GLPI respondeu 500/);
    const list = ok(await lucas.get(`/opportunities/${oppId}/glpi-tickets`)).json();
    expect(list.items[0].syncError).toMatch(/500/);
    expect(list.items[0].events.filter((e: { direction: string }) => e.direction === 'saida').map((e: { kind: string; author: string }) => `${e.kind}:${e.author}`)).toEqual(['Abertura:Lucas Lima', 'Followup:Lucas Lima', 'Followup:Lucas Lima']);
    expect(list.items[0].events.filter((e: { isPrivate: boolean; direction: string }) => e.direction === 'saida' && e.isPrivate)).toHaveLength(1);
  });

  it('aprovação do GLPI respondida na negociação: recusa exige motivo; vai em nome de quem decidiu; pedida a outro aprovador, o GLPI descarta e a ferramenta avisa', async () => {
    await glpi.act(glpiId, { kind: 'validation', text: 'Aprovar desconto de 10% na mensalidade' });
    await glpi.act(glpiId, { kind: 'validation', text: 'Aprovar troca de equipamento', toOther: true });
    ok(await lucas.post(`/glpi-tickets/${ticketId}/sync`));
    const list = async () => (ok(await lucas.get(`/opportunities/${oppId}/glpi-tickets`)).json().items[0].events as { kind: string; validationId: number | null; validationStatus: number | null; text: string; direction: string; author: string }[]).filter((e) => e.kind === 'Validation');
    const vs = await list();
    const v1 = vs.find((e) => e.text === 'Aprovar desconto de 10% na mensalidade');
    const v2 = vs.find((e) => e.text === 'Aprovar troca de equipamento');
    expect(v1).toMatchObject({ validationStatus: 2 });
    expect((await rafael.post(`/glpi-tickets/${ticketId}/validations/${v1!.validationId}`, { decision: 'aprovar' })).statusCode).toBe(404);
    expect((await lucas.post(`/glpi-tickets/${ticketId}/validations/${v1!.validationId}`, { decision: 'recusar', comment: 'não' })).statusCode).toBe(422);
    ok(await lucas.post(`/glpi-tickets/${ticketId}/validations/${v1!.validationId}`, { decision: 'aprovar', comment: 'Margem confere com a tabela.' }));
    const item = glpi.tickets.get(glpiId)!.timeline.find((x) => x.type === 'Validation' && x.item.id === v1!.validationId)!.item;
    expect(item).toMatchObject({ status: 3, approval_comment: '<p><strong>Aprovado no RevOps por Lucas Lima</strong></p><p>Margem confere com a tabela.</p>' });
    const after = await list();
    expect(after.filter((e) => e.validationId === v1!.validationId).map((e) => e.validationStatus)).toEqual([2, 3]);
    // a decisão fica registrada com quem decidiu e o que escreveu (uma vez só, mesmo depois da releitura)
    expect(after.find((e) => e.validationId === v1!.validationId && e.validationStatus === 3)).toMatchObject({ direction: 'saida', author: 'Lucas Lima', text: 'Margem confere com a tabela.' });
    ok(await lucas.post(`/glpi-tickets/${ticketId}/sync`));
    expect((await list()).filter((e) => e.validationId === v1!.validationId && e.validationStatus === 3)).toHaveLength(1);
    expect((await lucas.post(`/glpi-tickets/${ticketId}/validations/${v1!.validationId}`, { decision: 'aprovar' })).json().detail).toMatch(/já foi respondida/);
    const other = await lucas.post(`/glpi-tickets/${ticketId}/validations/${v2!.validationId}`, { decision: 'aprovar' });
    expect(other.statusCode).toBe(502);
    expect(other.json().detail).toMatch(/não registrou a resposta.*pedida ao usuário de integração/);
    // o GLPI respondeu 200 mas descartou a situação: a ferramenta não registra decisão e o pedido continua aberto
    expect((await list()).filter((e) => e.validationId === v2!.validationId).map((e) => e.validationStatus)).toEqual([2]);
  });

  it('isolamento: quem não vê a oportunidade não vê nem responde o chamado; validação do endereço pelo GLPI', async () => {
    expect((await rafael.get(`/opportunities/${oppId}/glpi-tickets`)).statusCode).toBe(404);
    expect((await rafael.post(`/glpi-tickets/${ticketId}/followups`, { text: 'tentativa indevida' })).statusCode).toBe(404);
    const crc = await ctx.app.inject({ method: 'GET', url: `/api/v1/hooks/glpi/${hookToken}?crc_token=abc123` });
    expect(crc.body).toBe(createHmac('sha256', SECRET).update('abc123').digest('hex'));
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/hooks/glpi/${'x'.repeat(32)}?crc_token=abc` })).statusCode).toBe(404);
    // outros endereços continuam exigindo JSON
    expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'text/plain' }, payload: 'x' })).statusCode).toBe(415);
  });
});

describe('GLPI: datas', () => {
  it('data sem fuso é lida no fuso da empresa; com fuso, respeitada', async () => {
    const { glpiDate } = await import('../src/services/glpi');
    expect(glpiDate('2026-10-22 22:15:00', 'America/Sao_Paulo')!.toISOString()).toBe('2026-10-23T01:15:00.000Z');
    expect(glpiDate('2026-10-22T22:15:00+00:00')!.toISOString()).toBe('2026-10-22T22:15:00.000Z');
    expect(glpiDate('ontem')).toBeNull();
  });
});
