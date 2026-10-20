/** Chat da negociação, menções com @, não lidas e comentários no histórico. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';
import { setTransportFactory } from '../src/services/email';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client, mariana: Client;
const sent: { to: string; subject: string; text: string }[] = [];
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let oppId: string;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas, mariana] = (await Promise.all(['carlos', 'ana', 'lucas', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  setTransportFactory(() => ({ sendMail: async (m: { to: string; subject: string; text: string }) => { sent.push(m); return { messageId: `m${sent.length}` }; } }) as never);
  ok(await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', password: 'x', fromName: 'Yepnet', fromEmail: 'vendas@yepnet.test', replyTo: null, enabled: true }));
  const plan = (await lucas.get('/meta/lookups')).json().plans[0];
  oppId = ok(await lucas.post('/opportunities', { newContact: { name: 'Cliente Chat Fictício', segment: 'residencial' }, planId: plan.id }), 201).json().id;
});
afterAll(async () => {
  await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', fromName: 'Yepnet', fromEmail: 'vendas@yepnet.test', replyTo: null, enabled: false });
  setTransportFactory(null);
  await ctx.close();
});

describe('chat e menções', () => {
  it('só quem tem acesso à negociação pode ser mencionado', async () => {
    const p = ok(await lucas.get(`/opportunities/${oppId}/participants`)).json().items.map((u: { name: string }) => u.name);
    expect(p).toContain('Carlos Silva');
    expect(p).toContain(ana.me.user.name);
    expect(p).not.toContain(mariana.me.user.name);
    expect(p).not.toContain(lucas.me.user.name);
    const r = ok(await lucas.post(`/opportunities/${oppId}/chat`, { body: 'Oi @Mariana', mentions: [mariana.me.user.id] }), 422);
    expect(r.json().detail).toContain('não tem acesso a esta negociação');
    ok(await mariana.get(`/opportunities/${oppId}/chat`), 404);
  });

  it('menção avisa por e-mail, conta como não lida e some ao ler', async () => {
    sent.length = 0;
    const m = ok(await lucas.post(`/opportunities/${oppId}/chat`, { body: '@Carlos Silva pode olhar o desconto?', mentions: [carlos.me.user.id] }), 201).json();
    expect(m.mentions).toEqual([{ id: carlos.me.user.id, name: 'Carlos Silva' }]);
    const mail = sent.find((x) => x.to === 'carlos@yepnet.test')!;
    expect(mail.subject).toContain('mencionou você');
    expect(mail.text).toContain('pode olhar o desconto?');
    expect(mail.text).toContain(`/opportunities/${oppId}?aba=chat`);
    ok(await ana.post(`/opportunities/${oppId}/chat`, { body: 'Estou acompanhando.' }), 201);

    expect(ok(await carlos.get(`/opportunities/${oppId}/unread`)).json()).toMatchObject({ chat: 2, mentions: 1 });
    expect(ok(await lucas.get(`/opportunities/${oppId}/unread`)).json()).toMatchObject({ chat: 1, mentions: 0 }); // a própria mensagem não conta
    const inbox = ok(await carlos.get('/me/mentions')).json();
    expect(inbox.unread).toBeGreaterThanOrEqual(1);
    expect(inbox.items[0]).toMatchObject({ opportunityId: oppId, source: 'chat', author: 'Lucas Lima', unread: true });
    ok(await carlos.post(`/opportunities/${oppId}/read`));
    expect(ok(await carlos.get(`/opportunities/${oppId}/unread`)).json()).toMatchObject({ chat: 0, mentions: 0 });
    expect(ok(await carlos.get('/me/mentions')).json().items.find((i: { opportunityId: string }) => i.opportunityId === oppId).unread).toBe(false);
  });
});

describe('comentários e histórico de alterações', () => {
  it('comentário entra no histórico formal com menção; alterações mostram nomes', async () => {
    sent.length = 0;
    ok(await lucas.post(`/opportunities/${oppId}/comments`, { body: 'Cliente pediu instalação no sábado. @Ana', mentions: [ana.me.user.id] }), 201);
    expect(sent.some((x) => x.subject.includes('mencionou'))).toBe(true);
    expect(ok(await ana.get(`/opportunities/${oppId}/unread`)).json()).toMatchObject({ comments: 1, mentions: 1 });

    const plans = (await lucas.get('/meta/lookups')).json().plans as { id: string; name: string }[];
    const cur = ok(await lucas.get(`/opportunities/${oppId}`)).json();
    ok(await lucas.patch(`/opportunities/${oppId}`, { planId: plans[1]!.id, rowVersion: cur.rowVersion }));
    const tl = ok(await lucas.get(`/opportunities/${oppId}/timeline`)).json();
    const comment = tl.items.find((i: { type: string }) => i.type === 'comment');
    expect(comment).toMatchObject({ reason: 'Cliente pediu instalação no sábado. @Ana', actorName: 'Lucas Lima' });
    expect(comment.payload.mentionNames).toEqual([ana.me.user.name]);
    const upd = tl.items.find((i: { type: string; payload: { changed?: Record<string, unknown> } }) => i.type === 'updated' && i.payload?.changed?.planId);
    expect(tl.labels[upd.payload.changed.planId.to]).toBe(plans[1]!.name);
    expect(tl.labels[upd.payload.changed.planId.from]).toBe(plans[0]!.name);
  });

  it('comentário vazio é recusado e o chat não entra no histórico do relacionamento', async () => {
    ok(await lucas.post(`/opportunities/${oppId}/comments`, { body: '   ' }), 422);
    const a = ok(await carlos.get(`/opportunities/${oppId}/approval`)).json();
    expect(JSON.stringify(a.timelines.relationship)).not.toContain('pode olhar o desconto');
  });
});
