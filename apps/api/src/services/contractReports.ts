/**
 * Relatório mensal do contrato: aviso de inclusão na rotina (ao exigir o relatório) e lembrete X dias antes do prazo,
 * por e-mail, WhatsApp e chamado no GLPI, com os MODELOS escritos pela empresa (Configurações → Comunicação de contratos).
 * Quem recebe: as pessoas do setor responsável pelo envio e quem valida. Modelo não configurado = nada é enviado
 * (fica registrado no histórico). Cada envio fica em contract_notifications (sem repetir por ciclo).
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, like } from 'drizzle-orm';
import {
  REPORT_CHANNELS, REPORT_MESSAGE_KINDS, REPORT_MESSAGE_LABELS, SECTOR_LABELS, daysBetween, nextReportDue, renderComm,
  type ReportChannel, type ReportMessage, type ReportMessageKind, type ReportMessages, type ReportTerms,
} from '@isp/domain';
import type { Config } from '../config';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { sendAlert, tenantName } from './email';
import { publicLink } from './alerts';
import { addEvent, currentVersion, usersBySector, type ContractRow } from './contracts';
import { noticeHtml, zapiCfg } from './contractNotify';
import { glpiConfig, glpiCreateTicket } from './glpi';
import { sendZapiText, waPhone } from './whatsapp';

const fmtD = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : null);
const intOrNull = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

export function normalizeReportMessages(v: unknown): ReportMessages {
  const x = (v && typeof v === 'object' ? v : {}) as Record<string, Partial<ReportMessage>>;
  const out: ReportMessages = {};
  for (const k of REPORT_MESSAGE_KINDS) {
    const m = x[k];
    if (!m) continue;
    out[k] = {
      channels: Array.isArray(m.channels) ? REPORT_CHANNELS.filter((c) => m.channels!.includes(c)) : [],
      subject: String(m.subject ?? '').slice(0, 300), body: String(m.body ?? '').slice(0, 10_000), whatsapp: String(m.whatsapp ?? '').slice(0, 4000),
      glpi: { entityId: intOrNull(m.glpi?.entityId), groupId: intOrNull(m.glpi?.groupId) || null, categoryId: intOrNull(m.glpi?.categoryId) || null },
    };
  }
  return out;
}

export async function reportMessagesOf(db: DbOrTx, tenantId: string): Promise<ReportMessages> {
  const [r] = await db.select({ settings: s.contractSettings.settings }).from(s.contractSettings).where(eq(s.contractSettings.tenantId, tenantId)).limit(1);
  return normalizeReportMessages((r?.settings as { reportMessages?: unknown } | undefined)?.reportMessages);
}

/** Chave da configuração do relatório: mudar setor, validador ou dia gera um novo aviso de inclusão na rotina. */
export const reportTermsKey = (t: ReportTerms) => createHash('sha1').update(`${t.sector}|${t.validatorId}|${t.dueDay}`).digest('hex').slice(0, 12);

type Person = { id: string; name: string; email: string; phone: string | null };

/** Envia a mensagem do relatório (inclusão na rotina ou lembrete) a cada pessoa e canal. Nunca derruba quem chamou. */
export async function sendReportMessage(db: DbOrTx, config: Config, c: ContractRow, kind: ReportMessageKind, cycle: string, today = new Date().toISOString().slice(0, 10)) {
  try {
    const v = await currentVersion(db, c);
    const t = v.reportTerms;
    if (!t?.required || !t.sector) return { sent: 0, skipped: 'sem_relatorio' as const };
    const msg = (await reportMessagesOf(db, c.tenantId))[kind];
    if (!msg || !msg.channels.length) {
      await addEvent(db, c.tenantId, c.id, null, 'relatorio', `Relatório mensal: modelo “${REPORT_MESSAGE_LABELS[kind]}” não configurado; nada foi enviado. Configure em Configurações → Comunicação de contratos.`);
      return { sent: 0, skipped: 'sem_modelo' as const };
    }
    const sector = await usersBySector(db, c.tenantId, [t.sector]);
    const ids = [...new Set([...sector.map((u) => u.id), ...(t.validatorId ? [t.validatorId] : [])])];
    const people: Person[] = ids.length ? await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, phone: s.users.phone }).from(s.users).where(and(eq(s.users.tenantId, c.tenantId), eq(s.users.active, true))).then((us) => us.filter((u) => ids.includes(u.id))) : [];
    const validator = people.find((p) => p.id === t.validatorId) ?? null;
    const [ct] = await db.select({ name: s.contacts.name }).from(s.contacts).where(eq(s.contacts.id, c.contactId)).limit(1);
    const due = t.dueDay ? nextReportDue(t.dueDay, today) : null;
    const base = {
      cliente: ct?.name ?? null, contrato: v.number, codigo: `CT-${c.code}`, objeto: v.object, setor: SECTOR_LABELS[t.sector], validador: validator?.name ?? null,
      dia_envio: t.dueDay ? `dia ${t.dueDay}` : null, proximo_envio: fmtD(due), dias_para_envio: due ? String(daysBetween(today, due)) : null, empresa: await tenantName(db, c.tenantId),
    };
    const title = `Relatório mensal · ${REPORT_MESSAGE_LABELS[kind]}`;
    const zapi = msg.channels.includes('whatsapp') ? await zapiCfg(db, c.tenantId) : null;
    let sent = 0;
    const record = async (channel: ReportChannel, p: { id: string | null; name: string }, to: string | null, run: (token: string) => Promise<{ status: string; error: string | null; to?: string }>) => {
      const token = randomBytes(24).toString('base64url');
      const [n] = await db.insert(s.contractNotifications).values({
        tenantId: c.tenantId, contractId: c.id, activityId: null, event: `relatorio_${kind}`, userId: p.id, recipientName: p.name, channel, toAddress: to, status: 'sem_contato', token,
        dedupeKey: `relatorio:${c.id}:${kind}:${cycle}:${p.id ?? 'grupo'}:${channel}`, title,
      }).onConflictDoNothing().returning({ id: s.contractNotifications.id });
      if (!n) return;
      const r: { status: string; error: string | null; to?: string } = await run(token).catch((e: Error) => ({ status: 'falhou', error: e.message.slice(0, 300) }));
      await db.update(s.contractNotifications).set({ status: r.status, error: r.error, ...(r.to ? { toAddress: r.to } : {}) }).where(eq(s.contractNotifications.id, n.id));
      if (r.status === 'enviado') sent++;
    };
    for (const p of people) {
      const vars = { ...base, destinatario: p.name };
      if (msg.channels.includes('email')) {
        await record('email', p, p.email, async (token) => {
          const subject = renderComm(msg.subject || title, vars);
          const lines = renderComm(msg.body, vars).split('\n');
          const res = await sendAlert(db, { tenantId: c.tenantId, kind: 'contrato_relatorio', to: p.email, subject, text: lines.join('\n'), html: noticeHtml({ title: subject, lines: lines.filter((l) => l.trim()), pixel: publicLink(config, `/api/v1/public/open/${token}`), reply: null }), contractId: c.id });
          return res && 'ok' in res && res.ok ? { status: 'enviado', error: null } : res && 'notConfigured' in res && res.notConfigured ? { status: 'nao_configurado', error: 'E-mail (SMTP) não configurado.' } : { status: 'falhou', error: (res as { error?: string } | null)?.error ?? null };
        });
      }
      if (msg.channels.includes('whatsapp')) {
        const to = waPhone(p.phone);
        await record('whatsapp', p, to, async () => {
          if (!to) return { status: 'sem_contato', error: 'Sem WhatsApp no cadastro do usuário.' };
          if (!zapi) return { status: 'nao_configurado', error: 'WhatsApp (Z-API) não configurado.' };
          await sendZapiText(zapi, to, renderComm(msg.whatsapp || msg.body, vars));
          return { status: 'enviado', error: null };
        });
      }
    }
    if (msg.channels.includes('glpi')) {
      // um chamado por ciclo, para o setor (grupo do GLPI configurado no modelo)
      await record('glpi', { id: null, name: `Setor ${base.setor}` }, null, async () => {
        if (msg.glpi.entityId == null) return { status: 'nao_configurado', error: 'Entidade do GLPI não informada no modelo.' };
        const cfg = await glpiConfig(db, c.tenantId).catch((e: Error) => { throw new Error(e.message); });
        const vars = { ...base, destinatario: `Setor ${base.setor}` };
        const r = await glpiCreateTicket(cfg, { title: renderComm(msg.subject || title, vars).slice(0, 250), content: renderComm(msg.body, vars), author: 'RevOps (rotina de relatório mensal)', type: 2, urgency: 3, entityId: msg.glpi.entityId, categoryId: msg.glpi.categoryId, groupId: msg.glpi.groupId });
        return { status: 'enviado', error: r.groupWarning ? `Chamado aberto, grupo não atribuído: ${r.groupWarning}` : null, to: `#${r.id}` };
      });
    }
    await addEvent(db, c.tenantId, c.id, null, 'relatorio', `Relatório mensal: ${REPORT_MESSAGE_LABELS[kind].toLowerCase()} enviado (${sent} envio(s)) ao setor ${base.setor}${validator ? ` e a ${validator.name}` : ''}.`, { kind, cycle, sent });
    return { sent };
  } catch (e) {
    console.error('relatório mensal: envio falhou', e);
    return { sent: 0, error: (e as Error).message };
  }
}

/** Ao salvar o contrato: relatório exigido com configuração nova (ou alterada) avisa que entrou na rotina. */
export async function reportOnboarding(db: DbOrTx, config: Config, contractId: string) {
  const [c] = await db.select().from(s.contracts).where(eq(s.contracts.id, contractId)).limit(1);
  if (!c || c.stage === 'arquivado') return;
  const v = await currentVersion(db, c);
  if (!v.reportTerms?.required) return;
  await sendReportMessage(db, config, c, 'inicio_rotina', reportTermsKey(v.reportTerms));
}

export async function reportNotices(db: DbOrTx, tenantId: string, contractId: string) {
  return db.select({
    id: s.contractNotifications.id, event: s.contractNotifications.event, recipientName: s.contractNotifications.recipientName, channel: s.contractNotifications.channel,
    toAddress: s.contractNotifications.toAddress, status: s.contractNotifications.status, error: s.contractNotifications.error, sentAt: s.contractNotifications.sentAt,
    openedAt: s.contractNotifications.openedAt, openCount: s.contractNotifications.openCount,
  }).from(s.contractNotifications).where(and(eq(s.contractNotifications.tenantId, tenantId), eq(s.contractNotifications.contractId, contractId), like(s.contractNotifications.event, 'relatorio_%'))).orderBy(desc(s.contractNotifications.sentAt)).limit(200);
}
