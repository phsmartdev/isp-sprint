/**
 * Integrações: configuração (segredos cifrados) e recebimento de leads por webhook.
 * IXC: leitura de faturas e ordens de serviço (somente leitura, ver services/ixc.ts).
 */
import { randomBytes } from 'node:crypto';
import { and, eq, ilike, notInArray, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { encryptSecret } from './email';

export const INTEGRATION_KINDS = ['ixc', 'zapi', 'zapsign', 'glpi', 'whatsapp', 'meta', 'site'] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
type Field = { key: string; label: string; secret?: boolean; hint?: string; type?: 'user' | 'text' };

/** O que cada integração pede. A tela é montada a partir daqui. */
export const INTEGRATION_SPECS: Record<IntegrationKind, { name: string; description: string; fields: Field[]; receivesLeads: boolean; status: string; webhook?: boolean }> = {
  ixc: {
    name: 'IXC Provedor',
    description: 'Faturas (contas a receber) e ordens de serviço de cada conta, em SOMENTE LEITURA: o sistema só faz consultas de listagem e recusa qualquer inclusão, alteração ou exclusão. Crie no IXC um usuário com “Permite acesso ao webservice” e informe aqui o número do usuário e o token. A conta é encontrada pelo código do IXC ou pelo CPF/CNPJ.',
    receivesLeads: false,
    status: 'Somente leitura · faturas e ordens de serviço',
    fields: [
      { key: 'baseUrl', label: 'Endereço do IXC', hint: 'Ex.: https://ixc.suaempresa.com.br' },
      { key: 'user', label: 'Usuário/ID do token', hint: 'Número do usuário dono do token no IXC' },
      { key: 'token', label: 'Token da API', secret: true },
    ],
  },
  zapi: {
    name: 'WhatsApp (Z-API)',
    description: 'Envia propostas pelo WhatsApp da empresa conectado à Z-API e transforma cada nova conversa recebida em lead. No painel da Z-API, em Webhooks, cole o endereço abaixo em “Ao receber”.',
    receivesLeads: true,
    status: '',
    fields: [
      { key: 'instanceId', label: 'ID da instância', hint: 'Painel da Z-API → Instâncias' },
      { key: 'instanceToken', label: 'Token da instância', secret: true },
      { key: 'clientToken', label: 'Token de segurança da conta (Client-Token)', secret: true, hint: 'Painel → Segurança. Obrigatório se estiver ativado lá.' },
      { key: 'defaultOwnerId', label: 'Responsável pelos leads', type: 'user' },
      { key: 'sourceName', label: 'Canal de entrada', hint: 'Padrão: WhatsApp' },
    ],
  },
  zapsign: {
    name: 'ZapSign (assinatura eletrônica)',
    description: 'Envia contratos e aditivos para assinatura e traz o documento assinado de volta para a ficha do contrato. No painel da ZapSign, em Configurações → Integrações → Webhooks, cadastre o endereço abaixo.',
    receivesLeads: false,
    webhook: true,
    status: '',
    fields: [
      { key: 'apiToken', label: 'Token da API', secret: true, hint: 'ZapSign → Configurações → Integrações → ZAPSIGN API' },
      { key: 'environment', label: 'Ambiente', hint: 'producao ou sandbox (sandbox não tem validade jurídica)' },
    ],
  },
  glpi: {
    name: 'GLPI (chamados)',
    description: 'Abre chamados no GLPI a partir da negociação e traz de volta situação, acompanhamentos, tarefas, solução e documentos. No GLPI 11: crie um cliente OAuth (Configuração → Clientes OAuth, escopo "api", concessão "Senha") e um usuário de integração com permissão para criar e ver chamados nas entidades dos clientes. Em Configuração → Webhooks, cadastre o endereço abaixo para Chamado, Acompanhamento, Solução e Tarefa de chamado (criação e atualização), com o mesmo segredo informado aqui.',
    receivesLeads: false,
    webhook: true,
    status: 'Construída e testada com GLPI simulado · validação com a instância real pendente',
    fields: [
      { key: 'baseUrl', label: 'Endereço do GLPI', hint: 'Ex.: https://glpi.suaempresa.com.br (precisa estar acessível pela internet)' },
      { key: 'clientId', label: 'ID do cliente OAuth' },
      { key: 'clientSecret', label: 'Segredo do cliente OAuth', secret: true },
      { key: 'username', label: 'Usuário de integração', hint: 'Login do usuário que abre os chamados no GLPI' },
      { key: 'password', label: 'Senha do usuário de integração', secret: true },
      { key: 'webhookSecret', label: 'Segredo do webhook', secret: true, hint: 'O mesmo segredo cadastrado no webhook do GLPI (confere a assinatura de cada aviso)' },
    ],
  },
  whatsapp: {
    name: 'WhatsApp Business (Cloud API da Meta)',
    description: 'Cada nova conversa recebida vira um lead com o telefone e o nome do perfil. Configure o webhook no Meta for Developers com o endereço e o código de verificação abaixo.',
    receivesLeads: true,
    status: '',
    fields: [
      { key: 'phoneNumberId', label: 'ID do número (Phone number ID)' },
      { key: 'businessAccountId', label: 'ID da conta WhatsApp Business' },
      { key: 'accessToken', label: 'Token de acesso permanente', secret: true, hint: 'Usado para responder e enviar propostas' },
      { key: 'verifyToken', label: 'Código de verificação do webhook', secret: true, hint: 'Invente um código e use o mesmo no Meta' },
      { key: 'defaultOwnerId', label: 'Responsável pelos leads', type: 'user' },
      { key: 'sourceName', label: 'Canal de entrada', hint: 'Padrão: WhatsApp' },
    ],
  },
  meta: {
    name: 'Meta Business (formulários de anúncios)',
    description: 'Leads dos formulários do Facebook e do Instagram (Lead Ads). Assine o evento "leadgen" da página no Meta for Developers com o endereço e o código de verificação abaixo.',
    receivesLeads: true,
    status: '',
    fields: [
      { key: 'pageId', label: 'ID da página' },
      { key: 'pageAccessToken', label: 'Token de acesso da página', secret: true, hint: 'Necessário para ler os dados de cada lead' },
      { key: 'verifyToken', label: 'Código de verificação do webhook', secret: true },
      { key: 'defaultOwnerId', label: 'Responsável pelos leads', type: 'user' },
      { key: 'sourceName', label: 'Canal de entrada', hint: 'Padrão: Instagram/Facebook' },
    ],
  },
  site: {
    name: 'Site (formulário de contato)',
    description: 'O formulário do site envia nome, telefone, e-mail e mensagem para o endereço abaixo e o lead entra no CRM na hora.',
    receivesLeads: true,
    status: '',
    fields: [
      { key: 'defaultOwnerId', label: 'Responsável pelos leads', type: 'user' },
      { key: 'sourceName', label: 'Canal de entrada', hint: 'Padrão: Site' },
    ],
  },
};

const newToken = () => randomBytes(24).toString('base64url');

export async function integrationRow(db: DbOrTx, tenantId: string, kind: IntegrationKind) {
  const [r] = await db.select().from(s.integrations).where(and(eq(s.integrations.tenantId, tenantId), eq(s.integrations.kind, kind))).limit(1);
  if (r) return r;
  const [created] = await db.insert(s.integrations).values({ tenantId, kind, webhookToken: newToken() }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(s.integrations).where(and(eq(s.integrations.tenantId, tenantId), eq(s.integrations.kind, kind))).limit(1))[0]!;
}

export async function saveIntegration(db: DbOrTx, tenantId: string, kind: IntegrationKind, userId: string, body: { enabled: boolean; config: Record<string, string | null>; secrets: Record<string, string> }) {
  const cur = await integrationRow(db, tenantId, kind);
  const spec = INTEGRATION_SPECS[kind];
  const config: Record<string, string | null> = {};
  const secrets: Record<string, string> = { ...cur.secrets };
  for (const f of spec.fields) {
    if (f.secret) {
      const v = body.secrets[f.key];
      if (v === undefined) continue;
      if (v === '') delete secrets[f.key];
      else secrets[f.key] = encryptSecret(v);
    } else config[f.key] = body.config[f.key]?.trim() || null;
  }
  await db.update(s.integrations).set({ enabled: body.enabled, config, secrets, updatedBy: userId, updatedAt: new Date() }).where(and(eq(s.integrations.tenantId, tenantId), eq(s.integrations.kind, kind)));
}

export async function rotateToken(db: DbOrTx, tenantId: string, kind: IntegrationKind) {
  await integrationRow(db, tenantId, kind);
  await db.update(s.integrations).set({ webhookToken: newToken(), updatedAt: new Date() }).where(and(eq(s.integrations.tenantId, tenantId), eq(s.integrations.kind, kind)));
}

export async function logEvent(db: DbOrTx, tenantId: string, kind: IntegrationKind, status: string, summary: string, leadId: string | null = null) {
  await db.insert(s.integrationEvents).values({ tenantId, kind, status, summary: summary.slice(0, 500), leadId });
  await db.update(s.integrations).set({ lastEventAt: new Date() }).where(and(eq(s.integrations.tenantId, tenantId), eq(s.integrations.kind, kind)));
}

const DEFAULT_SOURCE: Record<IntegrationKind, string> = { ixc: 'IXC', zapi: 'WhatsApp', zapsign: 'ZapSign', glpi: 'GLPI', whatsapp: 'WhatsApp', meta: 'Instagram/Facebook', site: 'Site' };
const clean = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const digits = (v: string | null) => (v ? v.replace(/\D/g, '') : '');

/**
 * Cria o lead recebido por uma integração. Se o mesmo telefone ou e-mail já tem lead aberto,
 * só registra a nova interação no lead existente (não duplica).
 */
export async function ingestLead(
  db: DbOrTx,
  integ: typeof s.integrations.$inferSelect,
  data: { name?: unknown; phone?: unknown; email?: unknown; message?: unknown; interest?: unknown; extra?: Record<string, unknown> },
) {
  const kind = integ.kind as IntegrationKind;
  const name = clean(data.name, 120) ?? clean(data.phone, 40) ?? clean(data.email, 120);
  const phone = clean(data.phone, 40);
  const email = clean(data.email, 200)?.toLowerCase() ?? null;
  if (!name || (!phone && !email)) {
    await logEvent(db, integ.tenantId, kind, 'ignorado', 'Recebido sem nome/telefone/e-mail suficientes.');
    return { status: 'ignorado' as const, leadId: null };
  }
  const message = clean(data.message, 2000);
  return db.transaction(async (tx) => {
    // já existe lead aberto com este telefone ou e-mail?
    const phoneDigits = digits(phone);
    const match = await tx
      .select({ leadId: s.leads.id, notes: s.leads.notes })
      .from(s.leads)
      .innerJoin(s.contacts, eq(s.contacts.id, s.leads.contactId))
      .where(and(
        eq(s.leads.tenantId, integ.tenantId),
        notInArray(s.leads.status, ['convertido', 'descartado', 'perdido']),
        or(
          phoneDigits.length >= 8 ? sql`regexp_replace(coalesce(${s.contacts.phone}, ''), '[^0-9]', '', 'g') like ${'%' + phoneDigits.slice(-8)}` : undefined,
          email ? eq(s.contacts.email, email) : undefined,
        ),
      ))
      .limit(1);
    const note = `${DEFAULT_SOURCE[kind]}: ${message ?? 'novo contato'}`;
    if (match[0]) {
      await tx.update(s.leads).set({ lastInteractionNote: note.slice(0, 300), updatedAt: new Date() }).where(eq(s.leads.id, match[0].leadId));
      await logEvent(tx, integ.tenantId, kind, 'duplicado', `${name}: já tinha lead aberto; interação registrada.`, match[0].leadId);
      return { status: 'duplicado' as const, leadId: match[0].leadId };
    }
    const sourceName = integ.config.sourceName || DEFAULT_SOURCE[kind];
    let [src] = await tx.select({ id: s.leadSources.id }).from(s.leadSources).where(and(eq(s.leadSources.tenantId, integ.tenantId), ilike(s.leadSources.name, sourceName))).limit(1);
    if (!src) [src] = await tx.insert(s.leadSources).values({ tenantId: integ.tenantId, name: sourceName }).returning({ id: s.leadSources.id });
    let ownerId = integ.config.defaultOwnerId || null;
    if (ownerId) {
      const [u] = await tx.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, ownerId), eq(s.users.tenantId, integ.tenantId), eq(s.users.active, true))).limit(1);
      if (!u) ownerId = null;
    }
    const [contact] = await tx.insert(s.contacts).values({ tenantId: integ.tenantId, name, phone, email, ownerId, sourceSystem: `integracao_${kind}` }).returning({ id: s.contacts.id });
    const extra = data.extra && Object.keys(data.extra).length ? `\n${Object.entries(data.extra).map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`).join('\n')}` : '';
    const [lead] = await tx
      .insert(s.leads)
      .values({ tenantId: integ.tenantId, contactId: contact!.id, ownerId, sourceId: src!.id, channel: sourceName, interests: clean(data.interest, 60) ? [clean(data.interest, 60)!] : [], lastInteractionNote: note.slice(0, 300), notes: `${message ?? ''}${extra}`.trim() || null })
      .returning({ id: s.leads.id });
    await logEvent(tx, integ.tenantId, kind, 'lead_criado', `${name}${phone ? ` · ${phone}` : ''}${email ? ` · ${email}` : ''}`, lead!.id);
    return { status: 'lead_criado' as const, leadId: lead!.id };
  });
}
