/** E-mail de cadastro no visual do RevOps: link, usuário, senha temporária, wiki e a assinatura (imagem) de quem cadastrou. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { setTransportFactory } from '../src/services/email';
import { accessEmailHtml } from '../src/services/accessEmail';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const sent: { to: string; subject: string; text: string; html?: string; attachments?: { cid?: string; contentType: string }[] }[] = [];
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const st = Date.now().toString(36).slice(-6);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeAll(async () => {
  ctx = await makeApp();
  carlos = await login(ctx.app, 'carlos@yepnet.test');
  setTransportFactory(() => ({ sendMail: async (m: (typeof sent)[number]) => { sent.push(m); return { messageId: `m${sent.length}` }; } }) as never);
  ok(await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', password: 'x', fromName: 'RevOps', fromEmail: 'acesso@yepnet.test', replyTo: null, enabled: true }));
});
afterAll(async () => {
  await carlos.put('/admin/smtp', { host: 'smtp.exemplo.test', port: 587, secure: false, username: 'u', fromName: 'RevOps', fromEmail: 'acesso@yepnet.test', replyTo: null, enabled: false });
  await carlos.del('/mail/signature/image');
  await carlos.put('/mail/signature', { text: '' });
  await ctx.db.execute(sql`update users set active = false where email like ${`novo.${st}@%`}`); // não entra nos avisos de outros testes
  setTransportFactory(null);
  await ctx.close();
});

describe('e-mail de cadastro do usuário', () => {
  it('monta o HTML com os dados de acesso e escapa o que vem do cadastro', () => {
    const html = accessEmailHtml({ kind: 'convite_usuario', name: 'Ana <b>Teste</b>', email: 'ana@exemplo.test', password: 'Tmp-123', loginUrl: 'https://revops.exemplo.test/login', wikiUrl: 'https://revops.exemplo.test/playbooks', logoUrl: 'https://revops.exemplo.test/brand/bkt-logo-white.png', company: 'BKT' });
    expect(html).toContain('Olá, Ana!');
    expect(html).not.toContain('<b>Teste</b>');
    expect(html).toContain('Tmp-123');
    expect(html).toContain('ana@exemplo.test');
    expect(html).toContain('href="https://revops.exemplo.test/login"');
    expect(html).toContain('href="https://revops.exemplo.test/playbooks"');
    expect(html).toContain('Wiki RevOps');
    expect(html).not.toContain('border-radius');
  });

  it('cadastro envia o e-mail em HTML com a assinatura em imagem de quem cadastrou', async () => {
    ok(await carlos.put('/mail/signature', { text: 'Carlos Silva\nComercial · BKT' }));
    ok(await carlos.put('/mail/signature/image', { data: PNG, width: 360 }));
    const email = `novo.${st}@exemplo.test`;
    const r = ok(await carlos.post('/admin/users', { name: `Pessoa Nova ${st}`, email, jobTitle: null, phone: null, profile: 'operacao', teamIds: [], leadTeamIds: [], sectors: [], isCsm: false, playbookRoles: [], goalSales: 0, goalProposals: 0, goalLeads: 0 }), 201).json();
    expect(r.emailSent).toBe(true);
    const m = sent.find((x) => x.to === email)!;
    expect(m).toBeTruthy();
    expect(m.html).toContain(r.temporaryPassword);
    expect(m.html).toContain(email);
    expect(m.html).toMatch(/href="[^"]*\/login"/);
    expect(m.html).toMatch(/href="[^"]*\/playbooks"/);
    expect(m.html).toContain('src="cid:assinatura@revops"');
    expect(m.attachments).toEqual([expect.objectContaining({ cid: 'assinatura@revops', contentType: 'image/png' })]);
    // versão em texto: dados de acesso, wiki e a assinatura em texto
    expect(m.text).toContain(r.temporaryPassword);
    expect(m.text).toContain('Carlos Silva');
  });
});
