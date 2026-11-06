/**
 * Esteira de comunicação de contratos: templates (versões publicadas), esteiras desenhadas como fluxo
 * (rascunho → publicar), fila de aprovação dos envios e as execuções por contrato.
 * Configuração: administração ou Contratos em nível Total. Aprovação: papel indicado no passo.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  COMM_CHANNELS, COMM_CONDITIONS, COMM_NODE_TYPES, COMM_RECIPIENT_KINDS, COMM_TRIGGERS, CONTRACT_OWNERS, COMM_FORMATS, FRAME_HEIGHT, renderComm, templateIssues, validateCommGraph,
  type CommGraph, type CommFormat,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import { canManagePlaybook } from './playbook';
import { loadContract } from '../services/contracts';
import { buildEmail, canApprove, commImages, decideStep, runCommFlows } from '../services/commFlow';
import { sendAlert, tenantName } from '../services/email';

const guard = (auth: AuthContext) => { if (!canManagePlaybook(auth)) throw forbidden('Só a administração ou quem tem nível Total em Contratos monta esteiras e templates.'); };

const Template = z.object({
  name: z.string().trim().min(2).max(120),
  channels: z.array(z.enum(COMM_CHANNELS)).min(1).max(2),
  subject: z.string().max(250).default(''),
  body: z.string().max(20_000).default(''),
  whatsapp: z.string().max(4000).default(''),
  format: z.enum(COMM_FORMATS).default('texto'),
  layout: z.boolean().default(true),
  headerAssetId: z.string().uuid().nullable().optional(),
  footerAssetId: z.string().uuid().nullable().optional(),
  frameHeight: z.number().int().min(FRAME_HEIGHT.min).max(FRAME_HEIGHT.max).default(FRAME_HEIGHT.default),
});
type TemplateBody = z.infer<typeof Template>;

/** No modelo com imagens o assunto é o próprio nome do modelo (com as variáveis do contrato); as imagens são da empresa. */
async function normalizeTemplate(db: DbOrTx, tenantId: string, b: TemplateBody) {
  const out = { ...b, headerAssetId: b.headerAssetId ?? null, footerAssetId: b.footerAssetId ?? null };
  if (b.format === 'modelo') out.subject = b.name;
  const ids = [out.headerAssetId, out.footerAssetId].filter((x): x is string => !!x);
  if (ids.length) {
    const rows = await db.select({ id: s.commAssets.id }).from(s.commAssets).where(and(eq(s.commAssets.tenantId, tenantId), inArray(s.commAssets.id, ids)));
    if (rows.length !== new Set(ids).size) throw unprocessable('Imagem de cabeçalho ou rodapé não encontrada.');
  }
  return out;
}

/** Tipo e tamanho da imagem pelos bytes (PNG, JPG ou GIF); null = não é imagem aceita. */
function imageInfo(b: Buffer): { mime: string; width: number | null; height: number | null } | null {
  if (b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 10 && b.subarray(0, 3).toString('latin1') === 'GIF') return { mime: 'image/gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1]!;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return { mime: 'image/jpeg', width: null, height: null };
  }
  return null;
}

const Node = z.object({
  id: z.string().min(1).max(60), type: z.enum(COMM_NODE_TYPES), x: z.number(), y: z.number(),
  data: z.object({
    label: z.string().max(120).optional(),
    trigger: z.enum(COMM_TRIGGERS).optional(),
    mode: z.enum(['antes', 'depois', 'aguardar']).optional(), days: z.number().int().min(0).max(730).optional(),
    channels: z.array(z.enum(COMM_CHANNELS)).max(2).optional(), templateId: z.string().uuid().nullable().optional(),
    recipients: z.array(z.object({ kind: z.enum(COMM_RECIPIENT_KINDS), value: z.string().max(200) })).max(20).optional(),
    approverRole: z.string().max(20).nullable().optional(), requireConfirmation: z.boolean().optional(),
    condition: z.enum(COMM_CONDITIONS).optional(),
    taskTitle: z.string().max(200).optional(), taskOwner: z.enum(CONTRACT_OWNERS).optional(), taskDays: z.number().int().min(0).max(365).optional(),
  }),
});
const Graph = z.object({ nodes: z.array(Node).max(80), edges: z.array(z.object({ id: z.string().max(80), source: z.string().max(60), target: z.string().max(60), handle: z.enum(['sim', 'nao']).nullable().optional() })).max(200) });

const SAMPLE: Record<string, string> = {
  cliente: 'Cliente Exemplo Ltda', contrato: '045/2026', codigo: 'CT-100', objeto: 'Link dedicado 200 Mbps', inicio_vigencia: '01/01/2026', fim_vigencia: '31/12/2026',
  dias_para_vencer: '90', valor_mensal: 'R$ 3.500,00', valor_global: 'R$ 42.000,00', indice_reajuste: 'IPCA', data_base: '01/01/2027', data_evento: '31/12/2026',
  responsavel: 'Responsável Comercial', responsavel_administrativo: 'Responsável Administrativo', destinatario: 'Destinatário',
};

export const commRoutes = [
  // ---------------------------------------------------------------- templates
  defineRoute({
    method: 'GET', url: '/comm/templates', summary: 'Templates de comunicação de contratos', tag: 'Comunicação', module: 'contratos',
    handler: async ({ app, auth }) => ({ items: await app.db.select().from(s.commTemplates).where(eq(s.commTemplates.tenantId, auth.tenantId)).orderBy(asc(s.commTemplates.name)), canManage: canManagePlaybook(auth) }),
  }),
  defineRoute({
    method: 'POST', url: '/comm/templates', summary: 'Cria template (rascunho)', tag: 'Comunicação', module: 'contratos', body: Template,
    handler: async ({ app, auth, body, reply }) => {
      guard(auth);
      const [t] = await app.db.insert(s.commTemplates).values({ tenantId: auth.tenantId, ...(await normalizeTemplate(app.db, auth.tenantId, body)), createdBy: auth.userId }).returning({ id: s.commTemplates.id });
      reply.code(201);
      return t!;
    },
  }),
  defineRoute({
    method: 'PUT', url: '/comm/templates/:id', summary: 'Salva o rascunho do template (a versão publicada continua valendo até publicar de novo)', tag: 'Comunicação', module: 'contratos',
    params: IdParams, body: Template.extend({ rowVersion: z.number().int() }),
    handler: async ({ app, auth, params, body }) => {
      guard(auth);
      const [t] = await app.db.select().from(s.commTemplates).where(and(eq(s.commTemplates.id, params.id), eq(s.commTemplates.tenantId, auth.tenantId))).limit(1);
      if (!t) throw notFound('Template não encontrado.');
      if (t.rowVersion !== body.rowVersion) throw conflict(t.rowVersion);
      const { rowVersion: _rv, ...raw } = body;
      const rest = await normalizeTemplate(app.db, auth.tenantId, raw);
      const [u] = await app.db.update(s.commTemplates).set({ ...rest, status: t.status === 'arquivado' ? 'arquivado' : t.version ? 'publicado' : 'rascunho', updatedAt: new Date(), rowVersion: sql`${s.commTemplates.rowVersion} + 1` }).where(eq(s.commTemplates.id, t.id)).returning({ rowVersion: s.commTemplates.rowVersion });
      return { rowVersion: u!.rowVersion, dirty: true };
    },
  }),
  defineRoute({
    method: 'POST', url: '/comm/templates/:id/publish', summary: 'Publica o rascunho como nova versão (as esteiras usam sempre a última versão publicada)', tag: 'Comunicação', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => app.db.transaction(async (tx) => {
      guard(auth);
      const [t] = await tx.select().from(s.commTemplates).where(and(eq(s.commTemplates.id, params.id), eq(s.commTemplates.tenantId, auth.tenantId))).limit(1);
      if (!t) throw notFound('Template não encontrado.');
      const issues = templateIssues({ subject: t.subject, body: t.body, whatsapp: t.whatsapp, format: t.format as CommFormat }, t.channels as ('email' | 'whatsapp')[]);
      if (issues.length) throw unprocessable(issues.join(' '));
      const version = t.version + 1;
      await tx.insert(s.commTemplateVersions).values({ tenantId: auth.tenantId, templateId: t.id, version, channels: t.channels, subject: t.subject, body: t.body, whatsapp: t.whatsapp, format: t.format, layout: t.layout, headerAssetId: t.headerAssetId, footerAssetId: t.footerAssetId, frameHeight: t.frameHeight, publishedBy: auth.userId });
      await tx.update(s.commTemplates).set({ version, status: 'publicado', updatedAt: new Date(), rowVersion: sql`${s.commTemplates.rowVersion} + 1` }).where(eq(s.commTemplates.id, t.id));
      return { version };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/comm/templates/preview', summary: 'Pré-visualiza o template com dados de exemplo (HTML do e-mail e texto do WhatsApp)', tag: 'Comunicação', module: 'contratos',
    body: Template.pick({ subject: true, body: true, whatsapp: true, format: true, layout: true, headerAssetId: true, footerAssetId: true, frameHeight: true }).extend({ name: z.string().max(120).optional() }),
    handler: async ({ app, auth, body }) => {
      const vars = { ...SAMPLE, empresa: await tenantName(app.db, auth.tenantId) };
      const subject = renderComm(body.format === 'modelo' ? body.name ?? '' : body.subject, vars);
      const images = body.format === 'modelo' ? await commImages(app.db, auth.tenantId, body) : {};
      return { subject, html: buildEmail({ company: vars.empresa, subject, body: body.body, format: body.format, layout: body.layout, vars, reply: '#', images, frameHeight: body.frameHeight, inline: true }).html, whatsapp: renderComm(body.whatsapp, vars) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/comm/templates/:id/test', summary: 'Envia o rascunho para o seu e-mail, com dados de exemplo', tag: 'Comunicação', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      guard(auth);
      const [t] = await app.db.select().from(s.commTemplates).where(and(eq(s.commTemplates.id, params.id), eq(s.commTemplates.tenantId, auth.tenantId))).limit(1);
      if (!t) throw notFound('Template não encontrado.');
      const [me] = await app.db.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, auth.userId)).limit(1);
      const vars = { ...SAMPLE, empresa: await tenantName(app.db, auth.tenantId), destinatario: auth.name };
      const subject = `[TESTE] ${renderComm(t.subject, vars)}`;
      const images = t.format === 'modelo' ? await commImages(app.db, auth.tenantId, t) : {};
      const mail = buildEmail({ company: vars.empresa, subject, body: t.body, format: t.format, layout: t.layout, vars, images, frameHeight: t.frameHeight });
      const r = await sendAlert(app.db, { tenantId: auth.tenantId, kind: 'contrato_esteira_teste', to: me!.email, subject, text: mail.text, html: mail.html, attachments: mail.attachments, createdBy: auth.userId });
      if (!r || !r.ok) throw unprocessable(r && 'error' in r && r.error ? r.error : 'Não foi possível enviar o teste.');
      return { to: me!.email };
    },
  }),

  // ---------------------------------------------------------------- imagens do modelo (cabeçalho e rodapé)
  defineRoute({
    method: 'POST', url: '/comm/assets', summary: 'Envia a imagem de cabeçalho ou rodapé do modelo de e-mail (PNG, JPG ou GIF até 1 MB; largura ideal 600 px)', tag: 'Comunicação', module: 'contratos',
    bodyLimit: 1_600_000,
    body: z.object({ kind: z.enum(['cabecalho', 'rodape']), filename: z.string().trim().min(1).max(160), data: z.string().min(10).max(1_500_000) }),
    handler: async ({ app, auth, body, reply }) => {
      guard(auth);
      const data = Buffer.from(body.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (data.length > 1_000_000) throw unprocessable('Imagem maior que 1 MB: e-mails pesados caem no spam. Exporte com qualidade menor.');
      const info = imageInfo(data);
      if (!info) throw unprocessable('Envie a imagem em PNG, JPG ou GIF.');
      const [a] = await app.db.insert(s.commAssets).values({ tenantId: auth.tenantId, kind: body.kind, filename: body.filename, mime: info.mime, data, width: info.width, height: info.height, createdBy: auth.userId }).returning({ id: s.commAssets.id });
      reply.code(201);
      return { id: a!.id, mime: info.mime, width: info.width, height: info.height, warning: info.width != null && info.width < 600 ? `A imagem tem ${info.width} px de largura: no e-mail ela é esticada para 600 px e pode ficar borrada.` : null };
    },
  }),
  defineRoute({
    method: 'GET', url: '/comm/assets/:id', summary: 'Imagem do modelo de e-mail (para a tela do editor)', tag: 'Comunicação', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const [a] = await app.db.select({ mime: s.commAssets.mime, data: s.commAssets.data }).from(s.commAssets).where(and(eq(s.commAssets.id, params.id), eq(s.commAssets.tenantId, auth.tenantId))).limit(1);
      if (!a) throw notFound('Imagem não encontrada.');
      return reply.header('content-type', a.mime).header('cache-control', 'private, max-age=31536000, immutable').send(Buffer.from(a.data));
    },
  }),

  // ---------------------------------------------------------------- esteiras
  defineRoute({
    method: 'GET', url: '/comm/flows', summary: 'Esteiras de comunicação', tag: 'Comunicação', module: 'contratos',
    handler: async ({ app, auth }) => {
      const flows = await app.db.select().from(s.commFlows).where(eq(s.commFlows.tenantId, auth.tenantId)).orderBy(asc(s.commFlows.name));
      const runs = flows.length ? await app.db.select({ flowId: s.commRuns.flowId, status: s.commRuns.status, n: sql<number>`count(*)::int` }).from(s.commRuns).where(inArray(s.commRuns.flowId, flows.map((f) => f.id))).groupBy(s.commRuns.flowId, s.commRuns.status) : [];
      return { items: flows.map((f) => ({ ...f, runs: Object.fromEntries(runs.filter((r) => r.flowId === f.id).map((r) => [r.status, r.n])), draftChanged: JSON.stringify(f.graph) !== JSON.stringify(f.publishedGraph) })), canManage: canManagePlaybook(auth) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/comm/flows', summary: 'Cria esteira em branco (só o gatilho)', tag: 'Comunicação', module: 'contratos',
    body: z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ app, auth, body, reply }) => {
      guard(auth);
      const graph: CommGraph = { nodes: [{ id: 'gatilho', type: 'gatilho', x: 40, y: 160, data: {} }], edges: [] };
      const [f] = await app.db.insert(s.commFlows).values({ tenantId: auth.tenantId, name: body.name, description: body.description ?? null, graph, createdBy: auth.userId }).returning({ id: s.commFlows.id });
      reply.code(201);
      return f!;
    },
  }),
  defineRoute({
    method: 'PUT', url: '/comm/flows/:id', summary: 'Salva o desenho (rascunho) da esteira', tag: 'Comunicação', module: 'contratos',
    params: IdParams, body: z.object({ rowVersion: z.number().int(), name: z.string().trim().min(2).max(120), description: z.string().trim().max(500).nullable().optional(), graph: Graph }),
    handler: async ({ app, auth, params, body }) => {
      guard(auth);
      const [f] = await app.db.select().from(s.commFlows).where(and(eq(s.commFlows.id, params.id), eq(s.commFlows.tenantId, auth.tenantId))).limit(1);
      if (!f) throw notFound('Esteira não encontrada.');
      if (f.rowVersion !== body.rowVersion) throw conflict(f.rowVersion);
      const [u] = await app.db.update(s.commFlows).set({ name: body.name, description: body.description ?? null, graph: body.graph as CommGraph, updatedAt: new Date(), rowVersion: sql`${s.commFlows.rowVersion} + 1` }).where(eq(s.commFlows.id, f.id)).returning({ rowVersion: s.commFlows.rowVersion });
      return { rowVersion: u!.rowVersion, issues: validateCommGraph(body.graph as CommGraph) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/comm/flows/:id/publish', summary: 'Valida e publica o desenho; as execuções novas usam a versão publicada', tag: 'Comunicação', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      guard(auth);
      const [f] = await app.db.select().from(s.commFlows).where(and(eq(s.commFlows.id, params.id), eq(s.commFlows.tenantId, auth.tenantId))).limit(1);
      if (!f) throw notFound('Esteira não encontrada.');
      const issues = validateCommGraph(f.graph);
      const tplIds = f.graph.nodes.filter((n) => n.type === 'envio' && n.data.templateId).map((n) => n.data.templateId!);
      const pub = tplIds.length ? await app.db.select({ id: s.commTemplates.id, version: s.commTemplates.version, name: s.commTemplates.name }).from(s.commTemplates).where(and(inArray(s.commTemplates.id, tplIds), eq(s.commTemplates.tenantId, auth.tenantId))) : [];
      for (const id of tplIds) { const t = pub.find((x) => x.id === id); if (!t) issues.push({ nodeId: null, message: 'Um envio aponta para um template que não existe.' }); else if (!t.version) issues.push({ nodeId: null, message: `O template "${t.name}" ainda não foi publicado.` }); }
      if (issues.length) throw unprocessable(`A esteira tem ${issues.length} pendência(s): ${issues.slice(0, 4).map((i) => i.message).join(' ')}`, issues.map((i) => ({ path: i.nodeId ?? 'graph', message: i.message })));
      await app.db.update(s.commFlows).set({ publishedGraph: f.graph, version: f.version + 1, publishedAt: new Date(), publishedBy: auth.userId, updatedAt: new Date(), rowVersion: sql`${s.commFlows.rowVersion} + 1` }).where(eq(s.commFlows.id, f.id));
      return { version: f.version + 1 };
    },
  }),
  defineRoute({
    method: 'POST', url: '/comm/flows/:id/active', summary: 'Liga ou desliga a esteira (desligar não apaga o que já rodou)', tag: 'Comunicação', module: 'contratos',
    params: IdParams, body: z.object({ active: z.boolean() }),
    handler: async ({ app, auth, params, body }) => {
      guard(auth);
      const [f] = await app.db.select().from(s.commFlows).where(and(eq(s.commFlows.id, params.id), eq(s.commFlows.tenantId, auth.tenantId))).limit(1);
      if (!f) throw notFound('Esteira não encontrada.');
      if (body.active && !f.publishedGraph) throw unprocessable('Publique a esteira antes de ligar.');
      await app.db.update(s.commFlows).set({ active: body.active, updatedAt: new Date(), rowVersion: sql`${s.commFlows.rowVersion} + 1` }).where(eq(s.commFlows.id, f.id));
      if (body.active) await runCommFlows(app.db, app.config, undefined, auth.tenantId);
      return { active: body.active };
    },
  }),

  // ---------------------------------------------------------------- aprovação e execuções
  defineRoute({
    method: 'GET', url: '/comm/approvals', summary: 'Comunicações aguardando aprovação (com o que vai sair) e as últimas decididas', tag: 'Comunicação', module: 'contratos',
    handler: async ({ app, auth }) => {
      const rows = await app.db.select({ step: s.commRunSteps, flowName: s.commFlows.name, contractId: s.commRuns.contractId, anchorDate: s.commRuns.anchorDate, code: s.contracts.code, client: s.contacts.name, decidedByName: s.users.name })
        .from(s.commRunSteps).innerJoin(s.commRuns, eq(s.commRuns.id, s.commRunSteps.runId)).innerJoin(s.commFlows, eq(s.commFlows.id, s.commRuns.flowId))
        .innerJoin(s.contracts, eq(s.contracts.id, s.commRuns.contractId)).innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId)).leftJoin(s.users, eq(s.users.id, s.commRunSteps.decidedBy))
        .where(and(eq(s.commRunSteps.tenantId, auth.tenantId), eq(s.commRunSteps.nodeType, 'envio'), inArray(s.commRunSteps.status, ['aguardando_aprovacao', 'enviado', 'rejeitado', 'falhou'])))
        .orderBy(desc(s.commRunSteps.createdAt)).limit(200);
      const items = await Promise.all(rows.map(async (r) => ({ ...r.step, flowName: r.flowName, contractId: r.contractId, anchorDate: r.anchorDate, code: r.code, client: r.client, decidedByName: r.decidedByName, canDecide: r.step.status === 'aguardando_aprovacao' && (await canApprove(app.db, auth, r.step)) })));
      return { pending: items.filter((i) => i.status === 'aguardando_aprovacao'), history: items.filter((i) => i.status !== 'aguardando_aprovacao').slice(0, 50) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/comm/steps/:id/decision', summary: 'Aprova (envia) ou não aprova (encerra a esteira do contrato neste ciclo, com justificativa)', tag: 'Comunicação', module: 'contratos',
    params: IdParams, body: z.object({ approve: z.boolean(), note: z.string().trim().max(1000).nullable().optional() }),
    handler: async ({ app, auth, params, body }) => decideStep(app.db, app.config, auth, params.id, body.approve, body.note ?? null),
  }),
  defineRoute({
    method: 'GET', url: '/contracts/:id/comm', summary: 'Esteiras do contrato: execuções e passos (agendado, aguardando aprovação, enviado, confirmado)', tag: 'Comunicação', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const runs = await app.db.select({ run: s.commRuns, flowName: s.commFlows.name }).from(s.commRuns).innerJoin(s.commFlows, eq(s.commFlows.id, s.commRuns.flowId)).where(eq(s.commRuns.contractId, c.id)).orderBy(desc(s.commRuns.startedAt));
      const steps = runs.length ? await app.db.select().from(s.commRunSteps).where(inArray(s.commRunSteps.runId, runs.map((r) => r.run.id))).orderBy(asc(s.commRunSteps.dueOn), asc(s.commRunSteps.createdAt)) : [];
      const nIds = steps.flatMap((x) => x.notificationIds);
      const notices = nIds.length ? await app.db.select({ id: s.contractNotifications.id, recipientName: s.contractNotifications.recipientName, channel: s.contractNotifications.channel, status: s.contractNotifications.status, confirmedAt: s.contractNotifications.confirmedAt, responseText: s.contractNotifications.responseText, openedAt: s.contractNotifications.openedAt, openCount: s.contractNotifications.openCount }).from(s.contractNotifications).where(inArray(s.contractNotifications.id, nIds)) : [];
      return { items: runs.map((r) => ({ ...r.run, flowName: r.flowName, steps: steps.filter((x) => x.runId === r.run.id).map((x) => ({ ...x, notices: notices.filter((n) => x.notificationIds.includes(n.id)) })) })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/comm/run', summary: 'Roda agora a esteira desta empresa (a rotina diária faz o mesmo)', tag: 'Comunicação', module: 'contratos', min: 'total',
    handler: async ({ app, auth }) => runCommFlows(app.db, app.config, undefined, auth.tenantId),
  }),
];
