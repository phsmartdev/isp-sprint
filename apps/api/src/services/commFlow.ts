/**
 * Motor da esteira de comunicação de contratos.
 * - Começa uma execução por contrato e ciclo quando a data do gatilho entra no alcance da esteira
 *   (maior "X dias antes"); nunca retroage a datas anteriores à publicação da esteira.
 * - Anda pelas setas: espera → envio (fica AGUARDANDO APROVAÇÃO; só sai depois de aprovado) → condição → tarefa → fim.
 * - O envio usa o template publicado (versão gravada no passo), com o botão "Confirmar recebimento".
 * Idempotente: pode rodar várias vezes por dia.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import {
  COMM_TRIGGER_LABELS, PLAYBOOK_ROLE_LABELS, isPlaybookRole, sanitizeEmailHtml, leadDays, nextAnniversary, nextNode, renderComm, waitUntil,
  type CommGraph, type CommNode, type CommRecipient, type CommTrigger,
} from '@isp/domain';
import type { Config } from '../config';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { AuthContext } from '../http/context';
import { forbidden, notFound, unprocessable } from '../http/errors';
import { addEvent, createTask, currentVersion } from './contracts';
import { brl, decryptSecret, sendAlert, tenantName } from './email';
import { publicLink } from './alerts';
import { integrationRow } from './integrations';
import { sendZapiText, waPhone } from './whatsapp';
import { level } from './scope';

type Contract = typeof s.contracts.$inferSelect;
type Step = typeof s.commRunSteps.$inferSelect;
type Run = typeof s.commRuns.$inferSelect;

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const fmtD = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : null);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** Data do gatilho no contrato (ou nula quando o contrato não tem a data). */
export async function anchorOf(db: DbOrTx, c: Contract, trigger: CommTrigger, today: string): Promise<string | null> {
  const v = await currentVersion(db, c);
  switch (trigger) {
    case 'renovacao': return v.endAt;
    case 'reajuste': return v.adjustmentBaseDate ? nextAnniversary(v.adjustmentBaseDate, today) : null;
    case 'garantia': return v.guarantee?.expiresAt ?? null;
    case 'encerramento': return c.closureExpected ? (c.closureAt ?? v.endAt) : null;
    case 'validacao': return c.validatedAt ? c.validatedAt.toISOString().slice(0, 10) : null;
  }
}

export async function commVars(db: DbOrTx, c: Contract, anchor: string, recipientName: string) {
  const v = await currentVersion(db, c);
  const [ct] = await db.select({ name: s.contacts.name }).from(s.contacts).where(eq(s.contacts.id, c.contactId)).limit(1);
  const ids = [c.commercialOwnerId, c.adminOwnerId].filter((x): x is string => !!x);
  const us = ids.length ? await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, ids)) : [];
  const today = todayIso();
  return {
    cliente: ct?.name ?? null, contrato: v.number, codigo: `CT-${c.code}`, objeto: v.object,
    inicio_vigencia: fmtD(v.startAt), fim_vigencia: fmtD(v.endAt), dias_para_vencer: v.endAt ? String(daysBetween(today, v.endAt)) : null,
    valor_mensal: brl(v.monthlyCents), valor_global: v.totalCents != null ? brl(v.totalCents) : null, indice_reajuste: v.adjustmentIndex,
    data_base: v.adjustmentBaseDate ? fmtD(nextAnniversary(v.adjustmentBaseDate, today)) : null, data_evento: fmtD(anchor),
    responsavel: us.find((u) => u.id === c.commercialOwnerId)?.name ?? null, responsavel_administrativo: c.adminOwnerId ? us.find((u) => u.id === c.adminOwnerId)?.name ?? null : null,
    destinatario: recipientName, empresa: await tenantName(db, c.tenantId),
  } as Record<string, string | null>;
}

type Rcpt = { name: string; email: string | null; phone: string | null; kind: string; userId: string | null; actorId: string | null };
async function resolveRecipients(db: DbOrTx, c: Contract, list: CommRecipient[]): Promise<Rcpt[]> {
  const out: Rcpt[] = [];
  const users = async (ids: string[]) => (ids.length ? db.select({ id: s.users.id, name: s.users.name, email: s.users.email, phone: s.users.phone }).from(s.users).where(and(inArray(s.users.id, ids), eq(s.users.active, true))) : []);
  for (const r of list) {
    if (r.kind === 'papel' && isPlaybookRole(r.value)) {
      const us = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, phone: s.users.phone }).from(s.users).where(and(eq(s.users.tenantId, c.tenantId), eq(s.users.active, true), sql`${r.value} = any(${s.users.playbookRoles})`));
      out.push(...us.map((u) => ({ name: u.name, email: u.email, phone: u.phone, kind: `papel:${r.value}`, userId: u.id, actorId: null })));
      const as = await db.select().from(s.contractExternalActors).where(and(eq(s.contractExternalActors.tenantId, c.tenantId), eq(s.contractExternalActors.active, true), sql`${r.value} = any(${s.contractExternalActors.roles})`));
      out.push(...as.map((a) => ({ name: a.name, email: a.channels.includes('email') ? a.email : null, phone: a.channels.includes('whatsapp') ? a.whatsapp : null, kind: `papel:${r.value}`, userId: null, actorId: a.id })));
    } else if (r.kind === 'responsavel') {
      const id = r.value === 'comercial' ? c.commercialOwnerId : r.value === 'administrativo' ? c.adminOwnerId : r.value === 'operacional' ? c.operationalOwnerId : r.value === 'csm' ? c.csmId : null;
      out.push(...(await users(id ? [id] : [])).map((u) => ({ name: u.name, email: u.email, phone: u.phone, kind: `responsavel:${r.value}`, userId: u.id, actorId: null })));
    } else if (r.kind === 'cliente') {
      const [ct] = await db.select({ name: s.contacts.name, email: s.contacts.email, phone: s.contacts.phone }).from(s.contacts).where(eq(s.contacts.id, c.contactId)).limit(1);
      if (ct) out.push({ name: ct.name, email: ct.email, phone: ct.phone, kind: 'cliente', userId: null, actorId: null });
    } else if (r.kind === 'ator') {
      const [a] = await db.select().from(s.contractExternalActors).where(and(eq(s.contractExternalActors.id, r.value), eq(s.contractExternalActors.tenantId, c.tenantId), eq(s.contractExternalActors.active, true))).limit(1);
      if (a) out.push({ name: a.name, email: a.channels.includes('email') ? a.email : null, phone: a.channels.includes('whatsapp') ? a.whatsapp : null, kind: 'ator', userId: null, actorId: a.id });
    } else if (r.kind === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.value)) out.push({ name: r.value, email: r.value, phone: null, kind: 'email', userId: null, actorId: null });
  }
  const seen = new Set<string>();
  return out.filter((x) => { const k = x.userId ?? x.actorId ?? x.email ?? x.phone ?? x.name; if (seen.has(k)) return false; seen.add(k); return true; });
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Corpo do template em texto com **negrito** e listas "- " → HTML seguro do e-mail institucional. */
export function bodyToHtml(text: string) {
  const blocks = text.trim().split(/\n{2,}/);
  return blocks.map((b) => {
    const lines = b.split('\n');
    const inline = (l: string) => esc(l).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (lines.every((l) => /^\s*-\s+/.test(l))) return `<ul style="margin:0 0 12px;padding-left:20px;color:#334155;font-size:14px;line-height:1.6">${lines.map((l) => `<li>${inline(l.replace(/^\s*-\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.6">${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}
/** Pixel de abertura (imagem 1×1 invisível): cada carregamento registra uma abertura do e-mail. */
export const openPixel = (url: string | null | undefined) => (url ? `<img src="${esc(url)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;opacity:0" />` : '');
const replyLink = (url: string) => `<p style="margin:20px 0 0;font-size:13px;color:#334155;font-family:Arial,Helvetica,sans-serif"><a href="${esc(url)}" style="color:#2F5986;font-weight:bold">Responder a esta mensagem</a></p>`;

export function commEmailHtml(o: { company: string; subject: string; bodyHtml: string; pixel?: string | null; reply?: string | null }) {
  return `<!doctype html><html><body style="margin:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #E2E8F0">
<tr><td style="background:#1F3A5F;padding:16px 24px;color:#ffffff;font-size:16px;font-weight:bold">${esc(o.company || 'Gestão de Contratos')}</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 16px;font-size:18px;color:#0F172A">${esc(o.subject)}</h1>${o.bodyHtml}${o.reply ? replyLink(o.reply) : ''}
</td></tr><tr><td style="padding:12px 24px;border-top:1px solid #E2E8F0;color:#94A3B8;font-size:11px">Mensagem enviada pela Gestão de Contratos.</td></tr></table></td></tr></table>${openPixel(o.pixel)}</body></html>`;
}

const stripTags = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Monta o e-mail final: texto formatado na moldura, ou o HTML da empresa (com ou sem moldura).
 * A abertura é rastreada por pixel; quem está fora do sistema recebe também o link "Responder".
 * No HTML, {{link_resposta}} marca onde vai o link de resposta (sem ele, entra no final).
 */
export function buildEmail(o: { company: string; subject: string; body: string; format?: string; layout?: boolean; vars: Record<string, string | null | undefined>; pixel?: string | null; reply?: string | null }) {
  if (o.format !== 'html') {
    const text = renderComm(o.body, o.vars);
    return { html: commEmailHtml({ company: o.company, subject: o.subject, bodyHtml: bodyToHtml(text), pixel: o.pixel, reply: o.reply }), text };
  }
  const MARK = '%%LINK_RESPOSTA%%';
  const src = sanitizeEmailHtml(o.body).replace(/\{\{\s*(link_resposta|botao_confirmacao)\s*\}\}/g, MARK);
  let body = renderComm(src, o.vars, true);
  const rl = o.reply ? replyLink(o.reply) : '';
  body = body.includes(MARK) ? body.split(MARK).join(rl) : body + rl;
  const text = stripTags(body);
  if (o.layout !== false) return { html: commEmailHtml({ company: o.company, subject: o.subject, bodyHtml: body, pixel: o.pixel }), text };
  const px = openPixel(o.pixel);
  const doc = /<html[\s>]/i.test(body) ? (/<\/body>/i.test(body) ? body.replace(/<\/body>/i, `${px}</body>`) : body + px) : `<!doctype html><html><body>${body}${px}</body></html>`;
  return { html: doc, text };
}

async function publishedTemplate(db: DbOrTx, tenantId: string, templateId: string) {
  const [v] = await db.select().from(s.commTemplateVersions).where(and(eq(s.commTemplateVersions.tenantId, tenantId), eq(s.commTemplateVersions.templateId, templateId))).orderBy(desc(s.commTemplateVersions.version)).limit(1);
  return v ?? null;
}

/** Monta o que vai sair (já preenchido) para a pessoa que aprova ver antes. */
async function buildPreview(db: DbOrTx, c: Contract, run: Run, node: CommNode) {
  const t = await publishedTemplate(db, c.tenantId, node.data.templateId!);
  if (!t) throw new Error('Template sem versão publicada.');
  const recipients = await resolveRecipients(db, c, node.data.recipients ?? []);
  // a pré-visualização usa o primeiro destinatário; no envio, {{destinatario}} sai com o nome de cada um
  const vars = await commVars(db, c, run.anchorDate, recipients[0]?.name ?? '');
  const subject = renderComm(t.subject, vars);
  const mail = buildEmail({ company: await tenantName(db, c.tenantId), subject, body: t.body, format: t.format, layout: t.layout, vars });
  return {
    raw: { subject: t.subject, body: t.body, whatsapp: t.whatsapp, format: t.format, layout: t.layout }, vars,
    subject, html: mail.html, text: mail.text, whatsapp: renderComm(t.whatsapp, vars),
    recipients, channels: (node.data.channels ?? []).filter((ch) => t.channels.includes(ch)), templateId: t.templateId, templateVersion: t.version,
  };
}

async function schedule(db: DbOrTx, run: Run, g: CommGraph, nodeId: string | null, prevDone: string) {
  if (!nodeId) return;
  const node = g.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const dueOn = node.type === 'espera' ? waitUntil(node.data.mode!, node.data.days ?? 0, run.anchorDate, prevDone) : prevDone;
  await db.insert(s.commRunSteps).values({ tenantId: run.tenantId, runId: run.id, nodeId: node.id, nodeType: node.type, label: node.data.label || defaultLabel(node), dueOn, approverRole: node.type === 'envio' ? node.data.approverRole ?? null : null });
}

function defaultLabel(n: CommNode) {
  if (n.type === 'espera') return n.data.mode === 'aguardar' ? `Aguardar ${n.data.days} dia(s)` : `${n.data.days} dia(s) ${n.data.mode === 'antes' ? 'antes' : 'depois'} da data`;
  if (n.type === 'envio') return 'Enviar comunicação';
  if (n.type === 'condicao') return 'Condição';
  if (n.type === 'tarefa') return n.data.taskTitle ?? 'Tarefa';
  return n.type === 'fim' ? 'Fim' : 'Gatilho';
}

async function evalCondition(db: DbOrTx, run: Run, c: Contract, node: CommNode, trigger: CommTrigger) {
  const lastSend = (await db.select().from(s.commRunSteps).where(and(eq(s.commRunSteps.runId, run.id), eq(s.commRunSteps.nodeType, 'envio'), eq(s.commRunSteps.status, 'enviado'))).orderBy(desc(s.commRunSteps.doneAt)).limit(1))[0];
  const notices = lastSend?.notificationIds.length ? await db.select({ c: s.contractNotifications.confirmedAt, o: s.contractNotifications.openedAt, r: s.contractNotifications.responseText }).from(s.contractNotifications).where(inArray(s.contractNotifications.id, lastSend.notificationIds)) : [];
  const procKind = trigger === 'reajuste' ? 'reajuste' : trigger === 'encerramento' ? 'encerramento' : 'renovacao';
  switch (node.data.condition) {
    case 'confirmado': return notices.some((n) => !!n.c || !!n.o);
    case 'respondido': return notices.some((n) => !!n.r);
    case 'processo_concluido':
    case 'renovado': {
      const kind = node.data.condition === 'renovado' ? 'renovacao' : procKind;
      const [p] = await db.select({ id: s.contractProcesses.id }).from(s.contractProcesses).where(and(eq(s.contractProcesses.contractId, c.id), eq(s.contractProcesses.kind, kind), eq(s.contractProcesses.cycleKey, run.anchorDate), eq(s.contractProcesses.status, 'concluido'))).limit(1);
      return !!p;
    }
    default: return false;
  }
}

async function finishRunIfIdle(db: DbOrTx, runId: string) {
  const [{ open } = { open: 0 }] = await db.select({ open: sql<number>`count(*)::int` }).from(s.commRunSteps).where(and(eq(s.commRunSteps.runId, runId), inArray(s.commRunSteps.status, ['agendado', 'aguardando_aprovacao'])));
  if (!open) await db.update(s.commRuns).set({ status: 'concluido', finishedAt: new Date() }).where(and(eq(s.commRuns.id, runId), eq(s.commRuns.status, 'ativo')));
}

/** Executa um passo que chegou na data. Envio não sai: fica aguardando aprovação. */
async function execStep(db: DbOrTx, step: Step, today: string) {
  const [run] = await db.select().from(s.commRuns).where(eq(s.commRuns.id, step.runId)).limit(1);
  const [flow] = run ? await db.select().from(s.commFlows).where(eq(s.commFlows.id, run.flowId)).limit(1) : [];
  if (!run || !flow?.publishedGraph || run.status !== 'ativo') return;
  const g = flow.publishedGraph;
  const node = g.nodes.find((n) => n.id === step.nodeId);
  const [c] = await db.select().from(s.contracts).where(eq(s.contracts.id, run.contractId)).limit(1);
  if (!node || !c) return;
  const trigger = g.nodes.find((n) => n.type === 'gatilho')!.data.trigger!;
  const done = async (patch: Partial<Step> = {}, answer?: boolean) => {
    await db.update(s.commRunSteps).set({ status: 'concluido', doneAt: new Date(), ...patch }).where(eq(s.commRunSteps.id, step.id));
    await schedule(db, run, g, nextNode(g, node.id, answer), today);
  };
  if (node.type === 'espera') return done();
  if (node.type === 'fim') { await done(); return; }
  if (node.type === 'condicao') { const ans = await evalCondition(db, run, c, node, trigger); return done({ result: { answer: ans } }, ans); }
  if (node.type === 'tarefa') {
    const owner = node.data.taskOwner === 'administrativo' ? c.adminOwnerId : node.data.taskOwner === 'operacional' ? c.operationalOwnerId : node.data.taskOwner === 'csm' ? c.csmId : c.commercialOwnerId;
    const due = new Date(Date.parse(`${today}T12:00:00Z`) + (node.data.taskDays ?? 0) * 86_400_000);
    const t = await createTask(db, c, owner ?? c.commercialOwnerId, node.data.taskTitle ?? 'Tarefa da esteira', `Criada pela esteira "${flow.name}" (${COMM_TRIGGER_LABELS[trigger]} em ${fmtD(run.anchorDate)}).`, due, null);
    return done({ result: { taskId: t } });
  }
  if (node.type === 'envio') {
    try {
      const preview = await buildPreview(db, c, run, node);
      await db.update(s.commRunSteps).set({ status: 'aguardando_aprovacao', preview }).where(eq(s.commRunSteps.id, step.id));
    } catch (e) {
      await db.update(s.commRunSteps).set({ status: 'falhou', result: { error: (e as Error).message }, doneAt: new Date() }).where(eq(s.commRunSteps.id, step.id));
    }
  }
}

/** Rotina: inicia execuções e anda os passos que venceram. */
export async function runCommFlows(db: DbOrTx, config: Config, today = todayIso(), tenantId?: string) {
  const flows = await db.select().from(s.commFlows).where(and(eq(s.commFlows.active, true), isNotNull(s.commFlows.publishedGraph), tenantId ? eq(s.commFlows.tenantId, tenantId) : undefined));
  let started = 0, executed = 0;
  for (const f of flows) {
    const g = f.publishedGraph!;
    const trig = g.nodes.find((n) => n.type === 'gatilho');
    if (!trig?.data.trigger) continue;
    const lead = leadDays(g);
    const publishedOn = (f.publishedAt ?? new Date()).toISOString().slice(0, 10);
    const ctrs = await db.select().from(s.contracts).where(and(eq(s.contracts.tenantId, f.tenantId), isNotNull(s.contracts.validatedAt), sql`${s.contracts.stage} <> 'arquivado'`));
    for (const c of ctrs) {
      const anchor = await anchorOf(db, c, trig.data.trigger, today);
      // só ciclos que entram no alcance e que não são anteriores à publicação (sem retroagir)
      if (!anchor || anchor < publishedOn || daysBetween(today, anchor) > lead) continue;
      const [run] = await db.insert(s.commRuns).values({ tenantId: f.tenantId, flowId: f.id, flowVersion: f.version, contractId: c.id, anchorDate: anchor }).onConflictDoNothing().returning();
      if (!run) continue;
      started++;
      await schedule(db, run, g, nextNode(g, trig.id), today);
      await addEvent(db, f.tenantId, c.id, null, 'esteira_iniciada', `Esteira "${f.name}" iniciada (${COMM_TRIGGER_LABELS[trig.data.trigger]} em ${fmtD(anchor)}).`);
    }
  }
  // anda os passos vencidos (várias passadas: um passo pode liberar o seguinte no mesmo dia)
  for (let pass = 0; pass < 20; pass++) {
    const due = await db.select().from(s.commRunSteps).where(and(eq(s.commRunSteps.status, 'agendado'), lte(s.commRunSteps.dueOn, today), tenantId ? eq(s.commRunSteps.tenantId, tenantId) : undefined)).orderBy(asc(s.commRunSteps.createdAt)).limit(500);
    if (!due.length) break;
    for (const st of due) { await execStep(db, st, today); executed++; await finishRunIfIdle(db, st.runId); }
  }
  return { started, executed };
}

// ------------------------------------------------------------------ aprovação e envio
/** Quem aprova: titulares do papel indicado no passo; sem titular, quem tem Contratos em nível Total. */
export async function canApprove(db: DbOrTx, auth: AuthContext, step: Step) {
  if (step.approverRole && isPlaybookRole(step.approverRole)) {
    const holders = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true), sql`${step.approverRole} = any(${s.users.playbookRoles})`));
    if (holders.length) return holders.some((h) => h.id === auth.userId);
  }
  return level(auth, 'contratos') === 'total' || auth.access.configuracoes === 'total';
}

async function zapi(db: DbOrTx, tenantId: string) {
  const z = await integrationRow(db, tenantId, 'zapi');
  const tok = z.secrets.instanceToken ? decryptSecret(z.secrets.instanceToken) : null;
  if (!z.enabled || !z.config.instanceId || !tok) return null;
  return { instanceId: z.config.instanceId as string, instanceToken: tok, clientToken: z.secrets.clientToken ? decryptSecret(z.secrets.clientToken) : null };
}

export async function decideStep(db: DbOrTx, config: Config, auth: AuthContext, stepId: string, approve: boolean, note: string | null) {
  const [step] = await db.select().from(s.commRunSteps).where(and(eq(s.commRunSteps.id, stepId), eq(s.commRunSteps.tenantId, auth.tenantId))).limit(1);
  if (!step) throw notFound('Comunicação não encontrada.');
  if (step.status !== 'aguardando_aprovacao' || !step.preview) throw unprocessable('Esta comunicação não está aguardando aprovação.');
  if (!(await canApprove(db, auth, step))) throw forbidden(step.approverRole && isPlaybookRole(step.approverRole) ? `A aprovação é de quem ocupa o papel ${PLAYBOOK_ROLE_LABELS[step.approverRole]}.` : 'Você não aprova comunicações de contratos.');
  const [run] = await db.select().from(s.commRuns).where(eq(s.commRuns.id, step.runId)).limit(1);
  const [flow] = await db.select().from(s.commFlows).where(eq(s.commFlows.id, run!.flowId)).limit(1);
  const [c] = await db.select().from(s.contracts).where(eq(s.contracts.id, run!.contractId)).limit(1);
  const today = todayIso();
  if (!approve) {
    if (!note || note.trim().length < 5) throw unprocessable('Explique por que não aprova (mínimo 5 caracteres).', [{ path: 'note', message: 'Obrigatório' }]);
    await db.update(s.commRunSteps).set({ status: 'rejeitado', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: note.trim(), doneAt: new Date() }).where(eq(s.commRunSteps.id, step.id));
    // envio não aprovado encerra a esteira deste contrato neste ciclo
    await db.update(s.commRunSteps).set({ status: 'cancelado' }).where(and(eq(s.commRunSteps.runId, run!.id), eq(s.commRunSteps.status, 'agendado')));
    await db.update(s.commRuns).set({ status: 'cancelado', finishedAt: new Date() }).where(eq(s.commRuns.id, run!.id));
    await addEvent(db, auth.tenantId, c!.id, auth.userId, 'esteira_rejeitada', `Comunicação "${step.preview.subject}" da esteira "${flow!.name}" não aprovada: ${note.trim()}`);
    return { status: 'rejeitado' as const };
  }
  const p = step.preview;
  const company = await tenantName(db, auth.tenantId);
  const z = p.channels.includes('whatsapp') ? await zapi(db, auth.tenantId) : null;
  const ids: string[] = [];
  const report: { name: string; channel: string; status: string }[] = [];
  for (const r of p.recipients) {
    const v = { ...(p.vars ?? {}), destinatario: r.name };
    const subj = p.raw ? renderComm(p.raw.subject, v) : p.subject;
    const m = { subject: subj, body: p.raw?.body ?? p.text, format: p.raw?.format ?? 'texto', layout: p.raw?.layout ?? true, whatsapp: p.raw ? renderComm(p.raw.whatsapp, v) : p.whatsapp };
    for (const channel of p.channels) {
      const to = channel === 'email' ? r.email : waPhone(r.phone);
      const token = randomBytes(24).toString('base64url');
      const [n] = await db.insert(s.contractNotifications).values({
        tenantId: auth.tenantId, contractId: c!.id, activityId: null, event: 'esteira', raciLetter: null, role: r.kind.startsWith('papel:') ? r.kind.slice(6) : null,
        userId: r.userId, actorId: r.actorId ?? (r.userId ? null : null), recipientName: r.name, channel, toAddress: to ?? null, status: 'sem_contato', token,
        dedupeKey: `esteira:${step.id}:${r.userId ?? r.actorId ?? r.email ?? r.phone ?? r.name}:${channel}`, title: m.subject,
      }).onConflictDoNothing().returning({ id: s.contractNotifications.id });
      if (!n) continue;
      ids.push(n.id);
      const link = publicLink(config, `/r/${token}`);
      const pixel = publicLink(config, `/api/v1/public/open/${token}`);
      const reply = r.userId ? null : link;
      let status: 'enviado' | 'falhou' | 'nao_configurado' | 'sem_contato' = 'sem_contato';
      let error: string | null = null;
      if (to && channel === 'email') {
        const mail = buildEmail({ company, subject: m.subject, body: m.body, format: m.format, layout: m.layout, vars: v, pixel, reply });
        const res = await sendAlert(db, { tenantId: auth.tenantId, kind: 'contrato_esteira', to, subject: m.subject, text: reply ? `${mail.text}\n\nResponder: ${reply}` : mail.text, html: mail.html, contractId: c!.id, createdBy: auth.userId });
        status = res && 'ok' in res && res.ok ? 'enviado' : res && 'notConfigured' in res && res.notConfigured ? 'nao_configurado' : 'falhou';
        error = res && !res.ok ? res.error ?? null : null;
      } else if (to && channel === 'whatsapp') {
        if (!z) { status = 'nao_configurado'; error = 'WhatsApp (Z-API) não configurado.'; }
        else { try { await sendZapiText(z, to, `${m.whatsapp}\n\nLeia${reply ? ' e responda' : ''} por aqui: ${link}`); status = 'enviado'; } catch (e) { status = 'falhou'; error = (e as Error).message.slice(0, 300); } }
      } else error = channel === 'email' ? 'Sem e-mail cadastrado.' : 'Sem WhatsApp cadastrado.';
      await db.update(s.contractNotifications).set({ status, error }).where(eq(s.contractNotifications.id, n.id));
      report.push({ name: r.name, channel, status });
    }
  }
  await db.update(s.commRunSteps).set({ status: 'enviado', decidedBy: auth.userId, decidedAt: new Date(), decisionNote: note?.trim() || null, notificationIds: ids, result: { report }, doneAt: new Date() }).where(eq(s.commRunSteps.id, step.id));
  await addEvent(db, auth.tenantId, c!.id, auth.userId, 'esteira_enviada', `Comunicação "${p.subject}" aprovada e enviada (${report.filter((x) => x.status === 'enviado').length} de ${report.length}).`);
  const g = flow!.publishedGraph!;
  await schedule(db, run!, g, nextNode(g, step.nodeId), today);
  await runCommFlows(db, config, today, auth.tenantId);
  await finishRunIfIdle(db, run!.id);
  return { status: 'enviado' as const, report };
}
