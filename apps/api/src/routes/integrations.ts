/** Integrações: configuração pela gerência e endereços públicos de recebimento (webhooks) por código secreto. */
import { timingSafeEqual } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { notFound, unauthorized } from '../http/errors';
import * as s from '../db/schema';
import type { DB } from '../db/client';
import { decryptSecret } from '../services/email';
import { audit } from '../services/audit';
import { zapiStatus } from '../services/whatsapp';
import { INTEGRATION_KINDS, INTEGRATION_SPECS, ingestLead, integrationRow, logEvent, rotateToken, saveIntegration, type IntegrationKind } from '../services/integrations';

const ADMIN = { module: 'configuracoes' as const, min: 'total' as const };
const KindParams = z.object({ kind: z.enum(INTEGRATION_KINDS) });
const HookParams = z.object({ token: z.string().min(20).max(64) });
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

async function byToken(app: { db: DB }, kind: IntegrationKind, token: string) {
  const [r] = await app.db.select().from(s.integrations).where(and(eq(s.integrations.webhookToken, token), eq(s.integrations.kind, kind))).limit(1);
  if (!r) throw notFound('Endereço de integração inválido.');
  return r;
}
const secretOf = (r: typeof s.integrations.$inferSelect, k: string) => (r.secrets[k] ? decryptSecret(r.secrets[k]!) : null);

/** Verificação de webhook do Meta (WhatsApp e Lead Ads): devolve o hub.challenge se o código conferir. */
const verifyRoute = (kind: 'whatsapp' | 'meta') =>
  defineRoute({
    method: 'GET',
    url: `/hooks/${kind}/:token`,
    summary: `Verificação do webhook (${kind}) pelo Meta`,
    tag: 'Integrações',
    public: true,
    params: HookParams,
    query: z.object({ 'hub.mode': z.string().optional(), 'hub.verify_token': z.string().optional(), 'hub.challenge': z.string().max(200).optional() }).passthrough(),
    handler: async ({ app, params, query, reply }) => {
      const r = await byToken(app, kind, params.token);
      const expected = secretOf(r, 'verifyToken');
      if (query['hub.mode'] !== 'subscribe' || !expected || !query['hub.verify_token'] || !same(expected, query['hub.verify_token'])) throw unauthorized();
      await logEvent(app.db, r.tenantId, kind, 'recebido', 'Webhook verificado pelo Meta.');
      return reply.type('text/plain').send(query['hub.challenge'] ?? '');
    },
  });

export const integrationRoutes = [
  defineRoute({
    method: 'GET',
    url: '/admin/integrations',
    summary: 'Integrações com configuração (sem segredos), endereços de recebimento e últimos eventos',
    tag: 'Integrações',
    ...ADMIN,
    handler: async ({ app, auth, req }) => {
      const base = `${req.protocol}://${req.headers['x-forwarded-host'] ?? req.headers.host}/api/v1/hooks`;
      const items = [];
      for (const kind of INTEGRATION_KINDS) {
        const r = await integrationRow(app.db, auth.tenantId, kind);
        const spec = INTEGRATION_SPECS[kind];
        items.push({
          kind, ...spec, enabled: r.enabled, config: r.config,
          secretsSet: Object.fromEntries(spec.fields.filter((f) => f.secret).map((f) => [f.key, !!r.secrets[f.key]])),
          webhookUrl: spec.receivesLeads ? `${base}/${kind}/${r.webhookToken}` : null,
          lastEventAt: r.lastEventAt,
        });
      }
      const events = await app.db.select().from(s.integrationEvents).where(eq(s.integrationEvents.tenantId, auth.tenantId)).orderBy(desc(s.integrationEvents.createdAt)).limit(50);
      return { items, events };
    },
  }),
  defineRoute({
    method: 'PUT',
    url: '/admin/integrations/:kind',
    summary: 'Salva a integração. Segredos: em branco mantém; "" remove.',
    tag: 'Integrações',
    ...ADMIN,
    params: KindParams,
    body: z.object({ enabled: z.boolean(), config: z.record(z.string(), z.string().max(500).nullable()).default({}), secrets: z.record(z.string(), z.string().max(2000)).default({}) }),
    handler: async ({ app, auth, params, body, req }) => {
      await saveIntegration(app.db, auth.tenantId, params.kind, auth.userId, body);
      await audit(app.db, req, { action: 'integration.update', entityType: 'integration', entityId: params.kind, metadata: { enabled: body.enabled, secretsChanged: Object.keys(body.secrets) } });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/admin/integrations/:kind/rotate',
    summary: 'Gera um novo endereço de recebimento (o antigo para de funcionar)',
    tag: 'Integrações',
    ...ADMIN,
    params: KindParams,
    handler: async ({ app, auth, params, req }) => {
      await rotateToken(app.db, auth.tenantId, params.kind);
      await audit(app.db, req, { action: 'integration.rotate', entityType: 'integration', entityId: params.kind, metadata: {} });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/admin/integrations/zapi/test',
    summary: 'Confere se a instância da Z-API está conectada ao celular',
    tag: 'Integrações',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      const r = await integrationRow(app.db, auth.tenantId, 'zapi');
      const token = secretOf(r, 'instanceToken');
      if (!r.config.instanceId || !token) return { ok: false, message: 'Preencha e salve o ID e o token da instância.' };
      try {
        const st = await zapiStatus({ instanceId: r.config.instanceId, instanceToken: token, clientToken: secretOf(r, 'clientToken') });
        const message = st.connected ? `Conectada${st.smartphoneConnected === false ? ', mas o celular está sem internet' : ''}.` : `Instância não conectada: ${st.error ?? 'leia o QR code no painel da Z-API'}.`;
        await logEvent(app.db, auth.tenantId, 'zapi', st.connected ? 'recebido' : 'erro', `Teste de conexão: ${message}`);
        return { ok: !!st.connected, message };
      } catch (e) {
        await logEvent(app.db, auth.tenantId, 'zapi', 'erro', `Teste de conexão: ${(e as Error).message}`);
        return { ok: false, message: (e as Error).message };
      }
    },
  }),

  // ------------------------------------------------------------------ recebimento (públicos, por código secreto)
  defineRoute({
    method: 'POST',
    url: '/hooks/zapi/:token',
    summary: 'Z-API “Ao receber”: cada nova conversa (não grupo, não enviada por nós) vira lead',
    tag: 'Integrações',
    public: true,
    params: HookParams,
    body: z.record(z.string(), z.unknown()),
    rateLimit: () => ({ max: 600, timeWindow: '1 minute' }),
    handler: async ({ app, params, body }) => {
      const r = await byToken(app, 'zapi', params.token);
      if (!r.enabled) return { ok: true };
      if (r.config.instanceId && typeof body.instanceId === 'string' && body.instanceId !== r.config.instanceId) return { ok: true };
      if (body.fromMe === true || body.isGroup === true || body.isNewsletter === true || body.broadcast === true || body.isStatusReply === true) return { ok: true };
      const phone = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : '';
      if (phone.length < 10) return { ok: true };
      const text = (body.text as { message?: string } | undefined)?.message;
      const kind = ['image', 'audio', 'video', 'document', 'sticker', 'location', 'contact'].find((k) => body[k] && typeof body[k] === 'object');
      const name = [body.senderName, body.chatName].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
      await ingestLead(app.db, r, { name: name ?? `+${phone}`, phone: `+${phone}`, message: text ?? `[${kind ?? 'mensagem'}]` });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/hooks/site/:token',
    summary: 'Formulário do site: { nome, telefone, email, mensagem, interesse } (aceita também name/phone/message)',
    tag: 'Integrações',
    public: true,
    params: HookParams,
    body: z.record(z.string(), z.unknown()),
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ app, params, body, reply }) => {
      const r = await byToken(app, 'site', params.token);
      if (!r.enabled) { await logEvent(app.db, r.tenantId, 'site', 'ignorado', 'Recebido com a integração desligada.'); return reply.code(202).send({ ok: false, status: 'desligada' }); }
      const pick = (...k: string[]) => k.map((x) => body[x]).find((v) => typeof v === 'string' && v.trim());
      const known = new Set(['nome', 'name', 'telefone', 'phone', 'whatsapp', 'email', 'e-mail', 'mensagem', 'message', 'interesse', 'interest']);
      const extra = Object.fromEntries(Object.entries(body).filter(([k, v]) => !known.has(k) && typeof v !== 'object').slice(0, 15));
      const out = await ingestLead(app.db, r, { name: pick('nome', 'name'), phone: pick('telefone', 'phone', 'whatsapp'), email: pick('email', 'e-mail'), message: pick('mensagem', 'message'), interest: pick('interesse', 'interest'), extra });
      return reply.code(out.status === 'ignorado' ? 422 : 201).send({ ok: out.status !== 'ignorado', status: out.status });
    },
  }),
  verifyRoute('whatsapp'),
  defineRoute({
    method: 'POST',
    url: '/hooks/whatsapp/:token',
    summary: 'Mensagens recebidas no WhatsApp Cloud API: cada nova conversa vira lead',
    tag: 'Integrações',
    public: true,
    params: HookParams,
    body: z.record(z.string(), z.unknown()),
    rateLimit: () => ({ max: 300, timeWindow: '1 minute' }),
    handler: async ({ app, params, body }) => {
      const r = await byToken(app, 'whatsapp', params.token);
      if (!r.enabled) return { ok: true };
      type Val = { contacts?: { wa_id?: string; profile?: { name?: string } }[]; messages?: { from?: string; type?: string; text?: { body?: string } }[] };
      const entries = (body.entry as { changes?: { value?: Val }[] }[] | undefined) ?? [];
      for (const e of entries) for (const ch of e.changes ?? []) {
        const v = ch.value ?? {};
        for (const m of v.messages ?? []) {
          const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? m.from;
          await ingestLead(app.db, r, { name, phone: m.from ? `+${m.from}` : null, message: m.type === 'text' ? m.text?.body : `[${m.type ?? 'mensagem'}]` });
        }
      }
      return { ok: true };
    },
  }),
  verifyRoute('meta'),
  defineRoute({
    method: 'POST',
    url: '/hooks/meta/:token',
    summary: 'Lead Ads (Facebook/Instagram): busca os dados do lead na Graph API e cria o lead',
    tag: 'Integrações',
    public: true,
    params: HookParams,
    body: z.record(z.string(), z.unknown()),
    rateLimit: () => ({ max: 300, timeWindow: '1 minute' }),
    handler: async ({ app, params, body }) => {
      const r = await byToken(app, 'meta', params.token);
      if (!r.enabled) return { ok: true };
      const token = secretOf(r, 'pageAccessToken');
      const entries = (body.entry as { changes?: { field?: string; value?: { leadgen_id?: string; form_id?: string } }[] }[] | undefined) ?? [];
      for (const e of entries) for (const ch of e.changes ?? []) {
        const id = ch.field === 'leadgen' ? ch.value?.leadgen_id : null;
        if (!id) continue;
        if (!token) { await logEvent(app.db, r.tenantId, 'meta', 'erro', `Lead ${id} recebido, mas falta o token de acesso da página.`); continue; }
        try {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 6000);
          const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(id)}?access_token=${encodeURIComponent(token)}`, { signal: ctl.signal });
          clearTimeout(t);
          const j = (await res.json()) as { field_data?: { name: string; values: string[] }[]; error?: { message?: string } };
          if (!res.ok || !j.field_data) { await logEvent(app.db, r.tenantId, 'meta', 'erro', `Lead ${id}: ${j.error?.message ?? `HTTP ${res.status}`}`); continue; }
          const f = Object.fromEntries(j.field_data.map((x) => [x.name, x.values?.[0] ?? '']));
          const name = f.full_name ?? [f.first_name, f.last_name].filter(Boolean).join(' ');
          const extra = Object.fromEntries(Object.entries(f).filter(([k]) => !['full_name', 'first_name', 'last_name', 'phone_number', 'email'].includes(k)));
          await ingestLead(app.db, r, { name, phone: f.phone_number, email: f.email, message: `Formulário ${ch.value?.form_id ?? ''}`.trim(), extra });
        } catch (err) {
          await logEvent(app.db, r.tenantId, 'meta', 'erro', `Lead ${id}: ${(err as Error).message}`);
        }
      }
      return { ok: true };
    },
  }),
];
