/**
 * Avisos de atividades de contrato por NÍVEL DE RESPONSABILIDADE (Playbook): para cada evento, quem recebe sai
 * da matriz RACI da atividade (R = quem executa; A, C, I = titulares do papel) e do escalonamento por atraso.
 * Titulares: usuários (papéis no cadastro do usuário) e atores externos (canais cadastrados).
 * Todo aviso leva um link "Confirmar recebimento"; o ator externo pode responder pelo mesmo link.
 * Um aviso por atividade, evento, ciclo, pessoa e canal (idempotente: o cron pode rodar várias vezes).
 */
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  NOTIFY_EVENT_LABELS, RACI_LETTER_LABELS, PLAYBOOK_ROLE_LABELS, escalationReached, normalizeNotifyRules, raciRow, rolesToNotify,
  type NotifyEvent, type NotifyRules, type PlaybookRole, type RaciLetter,
} from '@isp/domain';
import type { Config } from '../config';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { decryptSecret, sendAlert } from './email';
import { publicLink } from './alerts';
import { integrationRow } from './integrations';
import { sendZapiText, waPhone } from './whatsapp';

export async function notifyRulesOf(db: DbOrTx, tenantId: string): Promise<NotifyRules> {
  const [r] = await db.select({ settings: s.contractSettings.settings }).from(s.contractSettings).where(eq(s.contractSettings.tenantId, tenantId)).limit(1);
  return normalizeNotifyRules((r?.settings as { notifyRules?: unknown } | undefined)?.notifyRules);
}

type Recipient = { kind: 'user' | 'actor'; id: string; name: string; email: string | null; phone: string | null; channels: ('email' | 'whatsapp')[]; letter: RaciLetter | null; role: PlaybookRole | null };

/** Titulares (usuários ativos e atores externos ativos) dos papéis. */
async function holdersOf(db: DbOrTx, tenantId: string, roles: PlaybookRole[], letter: RaciLetter | null): Promise<Recipient[]> {
  if (!roles.length) return [];
  const arr = sql.raw(`ARRAY[${roles.map((r) => `'${r}'`).join(',')}]::text[]`);
  const [us, as] = await Promise.all([
    db.select({ id: s.users.id, name: s.users.name, email: s.users.email, phone: s.users.phone, roles: s.users.playbookRoles }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true), sql`${s.users.playbookRoles} && ${arr}`)),
    db.select().from(s.contractExternalActors).where(and(eq(s.contractExternalActors.tenantId, tenantId), eq(s.contractExternalActors.active, true), sql`${s.contractExternalActors.roles} && ${arr}`)),
  ]);
  const roleOf = (rs: string[]) => roles.find((r) => rs.includes(r)) ?? null;
  return [
    ...us.map((u) => ({ kind: 'user' as const, id: u.id, name: u.name, email: u.email, phone: u.phone, channels: ['email' as const], letter, role: roleOf(u.roles) })),
    ...as.map((a) => ({ kind: 'actor' as const, id: a.id, name: a.name, email: a.email, phone: a.whatsapp, channels: a.channels.filter((c): c is 'email' | 'whatsapp' => c === 'email' || c === 'whatsapp'), letter, role: roleOf(a.roles) })),
  ];
}

type Task = typeof s.activities.$inferSelect;

async function recipientsFor(db: DbOrTx, task: Task, letters: readonly RaciLetter[]): Promise<Recipient[]> {
  const row = raciRow(task.raciKey);
  const out: Recipient[] = [];
  for (const { letter, roles } of rolesToNotify(row, letters)) {
    if (letter === 'R') {
      // R é quem executa: o dono da tarefa (e atores externos do papel R, que não têm tarefa no sistema)
      const [u] = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, phone: s.users.phone }).from(s.users).where(eq(s.users.id, task.ownerId)).limit(1);
      if (u) out.push({ kind: 'user', id: u.id, name: u.name, email: u.email, phone: u.phone, channels: ['email'], letter: 'R', role: null });
      out.push(...(await holdersOf(db, task.tenantId, roles, 'R')).filter((x) => x.kind === 'actor'));
      continue;
    }
    if (!row && letter === 'A' && task.contractId) {
      // atividade fora da matriz: o A é o responsável administrativo do contrato (ou o comercial)
      const [c] = await db.select({ a: s.contracts.adminOwnerId, c: s.contracts.commercialOwnerId }).from(s.contracts).where(eq(s.contracts.id, task.contractId)).limit(1);
      const uid = c?.a ?? c?.c;
      const [u] = uid ? await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, phone: s.users.phone }).from(s.users).where(eq(s.users.id, uid)).limit(1) : [];
      if (u) out.push({ kind: 'user', id: u.id, name: u.name, email: u.email, phone: u.phone, channels: ['email'], letter: 'A', role: null });
      continue;
    }
    out.push(...(await holdersOf(db, task.tenantId, roles, letter)));
  }
  // uma pessoa recebe um aviso por evento, com o nível mais alto em que aparece
  const rank: Record<string, number> = { A: 0, R: 1, C: 2, I: 3 };
  const seen = new Map<string, Recipient>();
  for (const r of out) { const k = `${r.kind}:${r.id}`; const p = seen.get(k); if (!p || rank[r.letter ?? 'I']! < rank[p.letter ?? 'I']!) seen.set(k, r); }
  return [...seen.values()];
}

const fmtDay = (d: Date | null) => (d ? d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'sem prazo');
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** E-mail institucional do aviso: abertura rastreada por pixel; quem está fora do sistema recebe o link para responder. */
export function noticeHtml(o: { title: string; lines: string[]; pixel: string | null; reply: string | null }) {
  const rows = o.lines.map((l) => `<p style="margin:0 0 8px;color:#334155;font-size:14px;line-height:1.5">${esc(l)}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#F1F5F9;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #E2E8F0">
<tr><td style="background:#1F3A5F;padding:16px 24px;color:#ffffff;font-size:16px;font-weight:bold">Gestão de Contratos</td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 16px;font-size:18px;color:#0F172A">${esc(o.title)}</h1>${rows}
${o.reply ? `<p style="margin:20px 0 0;font-size:13px"><a href="${esc(o.reply)}" style="color:#2F5986;font-weight:bold">Responder (aceite, dúvida ou impedimento)</a></p>` : ''}
</td></tr></table></td></tr></table>${o.pixel ? `<img src="${esc(o.pixel)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;opacity:0" />` : ''}</body></html>`;
}

async function zapiCfg(db: DbOrTx, tenantId: string) {
  const z = await integrationRow(db, tenantId, 'zapi');
  const tok = z.secrets.instanceToken ? decryptSecret(z.secrets.instanceToken) : null;
  if (!z.enabled || !z.config.instanceId || !tok) return null;
  return { instanceId: z.config.instanceId as string, instanceToken: tok, clientToken: z.secrets.clientToken ? decryptSecret(z.secrets.clientToken) : null };
}

export type NotifyOpts = { cycle?: string; letters?: RaciLetter[]; escalationRole?: PlaybookRole; reason?: string };

/** Envia o aviso do evento a cada destinatário e canal (sem repetir). Nunca derruba a ação que o disparou. */
export async function notifyTask(db: DbOrTx, config: Config, taskId: string, event: NotifyEvent | 'escalada', opts: NotifyOpts = {}) {
  try {
    const [task] = await db.select().from(s.activities).where(eq(s.activities.id, taskId)).limit(1);
    if (!task || !task.contractId || task.deletedAt) return { sent: 0 };
    const rules = await notifyRulesOf(db, task.tenantId);
    let recipients: Recipient[];
    if (event === 'escalada') recipients = opts.escalationRole ? await holdersOf(db, task.tenantId, [opts.escalationRole], null) : [];
    else recipients = await recipientsFor(db, task, opts.letters ?? rules.events[event]);
    if (!recipients.length) return { sent: 0 };
    const [ctr] = await db.select({ code: s.contracts.code, client: s.contacts.name }).from(s.contracts).innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId)).where(eq(s.contracts.id, task.contractId)).limit(1);
    const row = raciRow(task.raciKey);
    const label = event === 'escalada' ? `Escalonamento: atividade vencida (${opts.escalationRole ? PLAYBOOK_ROLE_LABELS[opts.escalationRole] : ''})` : NOTIFY_EVENT_LABELS[event];
    const title = `${label} — ${task.title}`;
    const zapi = recipients.some((r) => r.channels.includes('whatsapp')) ? await zapiCfg(db, task.tenantId) : null;
    let sent = 0;
    for (const r of recipients) {
      for (const channel of r.channels) {
        const token = randomBytes(24).toString('base64url');
        const dedupeKey = `${task.id}:${event}:${opts.cycle ?? ''}:${r.kind}:${r.id}:${channel}`;
        const to = channel === 'email' ? r.email : waPhone(r.phone);
        const [n] = await db.insert(s.contractNotifications).values({
          tenantId: task.tenantId, contractId: task.contractId, activityId: task.id, event, raciLetter: r.letter, role: r.role ?? opts.escalationRole ?? null,
          userId: r.kind === 'user' ? r.id : null, actorId: r.kind === 'actor' ? r.id : null, recipientName: r.name, channel, toAddress: to ?? null,
          status: 'sem_contato', token, dedupeKey, title,
        }).onConflictDoNothing().returning({ id: s.contractNotifications.id });
        if (!n) continue; // já avisado neste ciclo
        const link = publicLink(config, `/r/${token}`);
        const lines = [
          `Contrato CT-${ctr?.code ?? ''} · ${ctr?.client ?? ''}`,
          `Atividade: ${task.title}`,
          `Prazo: ${fmtDay(task.dueAt)}`,
          r.letter ? `Seu papel nesta atividade: ${RACI_LETTER_LABELS[r.letter]}${row ? ` (${row.label})` : ''}` : opts.escalationRole ? `Você recebe por escalonamento (${PLAYBOOK_ROLE_LABELS[opts.escalationRole]}).` : '',
          opts.reason ?? '',
        ].filter(Boolean);
        let status: 'enviado' | 'falhou' | 'nao_configurado' | 'sem_contato' = 'sem_contato';
        let error: string | null = null;
        if (to && channel === 'email') {
          const reply = r.kind === 'actor' ? link : null;
          const res = await sendAlert(db, { tenantId: task.tenantId, kind: 'contrato_atividade', to, subject: title, text: reply ? `${lines.join('\n')}\n\nResponder: ${reply}` : lines.join('\n'), html: noticeHtml({ title, lines, pixel: publicLink(config, `/api/v1/public/open/${token}`), reply }), contractId: task.contractId });
          status = res && 'ok' in res && res.ok ? 'enviado' : res && 'notConfigured' in res && res.notConfigured ? 'nao_configurado' : 'falhou';
          error = res && !res.ok ? res.error ?? null : null;
        } else if (to && channel === 'whatsapp') {
          if (!zapi) { status = 'nao_configurado'; error = 'WhatsApp (Z-API) não configurado.'; }
          else {
            try { await sendZapiText(zapi, to, `*${title}*\n${lines.join('\n')}\n\nLeia${r.kind === 'actor' ? ' e responda' : ''} por aqui: ${link}`); status = 'enviado'; }
            catch (e) { status = 'falhou'; error = (e as Error).message.slice(0, 300); }
          }
        } else error = channel === 'email' ? 'Sem e-mail cadastrado.' : 'Sem WhatsApp cadastrado.';
        await db.update(s.contractNotifications).set({ status, error }).where(eq(s.contractNotifications.id, n.id));
        if (status === 'enviado') sent++;
      }
    }
    return { sent };
  } catch (e) {
    console.error('aviso de atividade de contrato falhou', e);
    return { sent: 0, error: (e as Error).message };
  }
}

/** Rotina diária: perto de vencer, vencidas e escalonamento por atraso, por empresa. */
export async function runContractTaskNotices(db: DbOrTx, config: Config, now = new Date()) {
  const tenants = await db.select({ id: s.tenants.id }).from(s.tenants);
  const out: Record<string, { dueSoon: number; overdue: number; escalated: number }> = {};
  for (const t of tenants) {
    const rules = await notifyRulesOf(db, t.id);
    const tasks = await db.select().from(s.activities).where(and(eq(s.activities.tenantId, t.id), isNotNull(s.activities.contractId), isNull(s.activities.completedAt), isNull(s.activities.deletedAt), sql`${s.activities.status} <> 'cancelada'`));
    const r = { dueSoon: 0, overdue: 0, escalated: 0 };
    for (const task of tasks) {
      // atividades criadas pelo sistema (alertas, processos) também avisam quem executa e os demais níveis
      if (now.getTime() - task.createdAt.getTime() <= 48 * 3_600_000) await notifyTask(db, config, task.id, 'criada', { cycle: 'inicio' });
      if (!task.dueAt) continue;
      const due = task.dueAt;
      const cycle = due.toISOString().slice(0, 10);
      const hoursLeft = (due.getTime() - now.getTime()) / 3_600_000;
      if (hoursLeft >= 0 && rules.dueSoonHours && hoursLeft <= rules.dueSoonHours) r.dueSoon += (await notifyTask(db, config, task.id, 'vence_em_breve', { cycle })).sent;
      if (hoursLeft < 0) {
        r.overdue += (await notifyTask(db, config, task.id, 'vencida', { cycle })).sent;
        for (const lvl of escalationReached(-hoursLeft, rules.escalation)) r.escalated += (await notifyTask(db, config, task.id, 'escalada', { cycle: `${cycle}:${lvl.index}`, escalationRole: lvl.role, reason: `Atrasada há mais de ${lvl.afterHours} hora(s).` })).sent;
      }
    }
    out[t.id] = r;
  }
  return out;
}

/** Avisos de uma atividade (para a gaveta da tarefa e auditoria). */
export async function noticesOf(db: DbOrTx, tenantId: string, activityIds: string[]) {
  if (!activityIds.length) return [];
  return db.select({ id: s.contractNotifications.id, activityId: s.contractNotifications.activityId, event: s.contractNotifications.event, raciLetter: s.contractNotifications.raciLetter, role: s.contractNotifications.role, recipientName: s.contractNotifications.recipientName, channel: s.contractNotifications.channel, status: s.contractNotifications.status, error: s.contractNotifications.error, sentAt: s.contractNotifications.sentAt, confirmedAt: s.contractNotifications.confirmedAt, openedAt: s.contractNotifications.openedAt, lastOpenedAt: s.contractNotifications.lastOpenedAt, openCount: s.contractNotifications.openCount, responseText: s.contractNotifications.responseText, respondedAt: s.contractNotifications.respondedAt, actorId: s.contractNotifications.actorId })
    .from(s.contractNotifications).where(and(eq(s.contractNotifications.tenantId, tenantId), inArray(s.contractNotifications.activityId, activityIds))).orderBy(sql`${s.contractNotifications.sentAt} desc`);
}
