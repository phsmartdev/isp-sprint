/** Z-API: envio da proposta pelo WhatsApp da empresa, teste de conexão e conversas recebidas viram lead. */
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]); });
afterAll(async () => ctx.close());
afterEach(() => vi.restoreAllMocks());

it('envia o PDF pela Z-API com Client-Token e marca a proposta como enviada', async () => {
  expect((await carlos.put('/admin/integrations/zapi', { enabled: true, config: { instanceId: 'INST123' }, secrets: { instanceToken: 'TOK456', clientToken: 'SEC789' } })).statusCode).toBe(200);
  const list = (await carlos.get('/admin/integrations')).json();
  const z = list.items.find((i: { kind: string }) => i.kind === 'zapi');
  expect(z.secretsSet).toEqual({ instanceToken: true, clientToken: true });
  expect(JSON.stringify(list)).not.toContain('TOK456');

  const plan = (await carlos.get('/meta/lookups')).json().plans[0];
  const o = (await lucas.post('/opportunities', { newContact: { name: 'Cliente Zapi Fictício', phone: '(79) 98888-7777' }, planId: plan.id })).json();
  const pdf = Buffer.from('%PDF-1.4 teste').toString('base64');
  const att = (await lucas.post(`/opportunities/${o.id}/attachments`, { kind: 'proposta', filename: 'Proposta Yep.pdf', data: pdf })).json();

  const calls: { url: string; init: RequestInit }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => { calls.push({ url: String(url), init: init! }); return new Response(JSON.stringify({ zaapId: 'z1', messageId: 'm1', id: 'm1' }), { status: 200 }); });
  const r = await lucas.post(`/opportunities/${o.id}/attachments/${att.id}/whatsapp`, { phone: '(79) 98888-7777', message: 'Segue a proposta', mode: 'api' });
  expect(r.statusCode, r.body).toBe(200);
  expect(calls[0]!.url).toBe('https://api.z-api.io/instances/INST123/token/TOK456/send-document/pdf');
  expect((calls[0]!.init.headers as Record<string, string>)['client-token']).toBe('SEC789');
  const sent = JSON.parse(String(calls[0]!.init.body));
  expect(sent).toMatchObject({ phone: '5579988887777', fileName: 'Proposta Yep', caption: 'Segue a proposta' });
  expect(sent.document).toBe(`data:application/pdf;base64,${pdf}`);
  expect((await lucas.get(`/opportunities/${o.id}`)).json().proposalStatus).toBe('enviada');

  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Instance not found' }), { status: 400 }));
  const bad = await lucas.post(`/opportunities/${o.id}/attachments/${att.id}/whatsapp`, { phone: '79988887777', message: '', mode: 'api' });
  expect(bad.statusCode).toBe(422);
  expect(bad.json().detail).toContain('Instance not found');

  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ connected: true, smartphoneConnected: true }), { status: 200 }));
  expect((await carlos.post('/admin/integrations/zapi/test')).json()).toEqual({ ok: true, message: 'Conectada.' });
  expect((await lucas.post('/admin/integrations/zapi/test')).statusCode).toBe(403);
});

it('mensagem recebida na Z-API vira lead; enviadas por nós e grupos são ignoradas', async () => {
  const z = (await carlos.get('/admin/integrations')).json().items.find((i: { kind: string }) => i.kind === 'zapi');
  const url = new URL(z.webhookUrl).pathname;
  const hook = (body: object) => ctx.app.inject({ method: 'POST', url, payload: body });
  expect((await hook({ instanceId: 'INST123', phone: '5579977776666', fromMe: true, text: { message: 'oi' } })).statusCode).toBe(200);
  await hook({ instanceId: 'INST123', phone: '120363000000@g.us', isGroup: true, text: { message: 'grupo' } });
  await hook({ instanceId: 'INST123', phone: '5579977776666', fromMe: false, isGroup: false, senderName: 'Joana Fictícia', text: { message: 'Quero internet' }, type: 'ReceivedCallback' });
  await hook({ instanceId: 'INST123', phone: '5579977776666', senderName: 'Joana Fictícia', text: { message: 'Alô?' } });
  const ev = (await carlos.get('/admin/integrations')).json().events.filter((e: { kind: string }) => e.kind === 'zapi').map((e: { status: string }) => e.status);
  expect(ev.filter((s: string) => s === 'lead_criado')).toHaveLength(1);
  expect(ev).toContain('duplicado');
  const leads = (await carlos.get('/leads?q=Joana')).json();
  expect(leads.items[0].contactName ?? leads.items[0].name).toContain('Joana');
});
