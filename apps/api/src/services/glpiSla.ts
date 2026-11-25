/**
 * Dados Planejados: lê do GLPI os chamados atribuídos aos grupos e às pessoas do Comercial (mapeados no cadastro de
 * usuários), calcula prazo e nível de serviço pelo SLA configurado e manda os avisos por e-mail e WhatsApp.
 *
 * Leitura (API de alto nível do GLPI 11): GET /Assistance/Ticket com filtro RSQL em date_mod, paginado por start/limit,
 * na entidade raiz configurada com as subentidades (GLPI-Entity + GLPI-Entity-Recursive). A equipe do chamado vem no
 * campo `team` ([{ type: 'User'|'Group', id, name, role }]); quando a lista não traz, lê /Assistance/Ticket/{id}/TeamMember.
 * Prazos do GLPI: resolution_date (solucionar; sem ele, internal_resolution_date) e take_into_account_date (assumido em).
 *
 * Validação real pendente: conferido contra o GLPI simulado dos testes; os nomes de campo seguem o esquema público da API.
 */
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import {
  ALERT_STAGE_LABELS, DEFAULT_SLA_SETTINGS, dueText, glpiStatusLabel, isOpenStatus, localParts, slaDueAlerts, ticketDue, ticketSituation,
  type AlertStage, type SlaSettings,
} from '@isp/domain';
import type { Config } from '../config';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { glpiCall, glpiConfig, glpiDate, type GlpiCfg } from './glpi';
import { sendAlert, smtpConfig } from './email';
import { publicLink } from './alerts';
import { zapiCfg } from './contractNotify';
import { sendZapiText, waPhone } from './whatsapp';

type Row = typeof s.glpiQueueTickets.$inferSelect;
type Ref = { id?: number; name?: string | null; completename?: string | null } | number | null | undefined;
type HlTeam = { type?: string; itemtype?: string; id?: number; items_id?: number; name?: string | null; role?: string | number }[];
type HlTicket = {
  id: number; name?: string; status?: Ref; entity?: Ref; category?: Ref; priority?: Ref; user_recipient?: Ref;
  date?: string | null; date_creation?: string | null; date_mod?: string | null; date_solve?: string | null; date_close?: string | null;
  resolution_date?: string | null; internal_resolution_date?: string | null; take_into_account_date?: string | null; time_to_own?: string | null;
  team?: HlTeam;
};

const refId = (r: Ref) => (typeof r === 'number' ? r : r?.id ?? null);
const refName = (r: Ref) => (typeof r === 'object' && r ? r.completename ?? r.name ?? null : null);

export async function slaSettingsRow(db: DbOrTx, tenantId: string) {
  const [r] = await db.select().from(s.glpiSlaSettings).where(eq(s.glpiSlaSettings.tenantId, tenantId)).limit(1);
  if (r) return r;
  const [created] = await db.insert(s.glpiSlaSettings).values({ tenantId }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(s.glpiSlaSettings).where(eq(s.glpiSlaSettings.tenantId, tenantId)).limit(1))[0]!;
}
export const settingsOf = (r: { settings: Record<string, unknown> }): SlaSettings => ({ ...DEFAULT_SLA_SETTINGS, ...(r.settings as Partial<SlaSettings>) });

/** Quem do RevOps está ligado ao GLPI: usuário e grupos. Os grupos monitorados são os grupos dessas pessoas. */
export async function glpiPeople(db: DbOrTx, tenantId: string) {
  const people = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, phone: s.users.phone, glpiUserId: s.users.glpiUserId, glpiGroupIds: s.users.glpiGroupIds, glpiGroupNames: s.users.glpiGroupNames })
    .from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true)));
  const mapped = people.filter((p) => p.glpiUserId || p.glpiGroupIds.length);
  const groups = new Map<number, string>();
  for (const p of mapped) p.glpiGroupIds.forEach((g, i) => { if (!groups.has(g)) groups.set(g, p.glpiGroupNames[i] ?? `Grupo ${g}`); });
  return { people: mapped, all: people, groups, userIds: new Set(mapped.map((p) => p.glpiUserId).filter((x): x is number => !!x)) };
}

function teamOf(t: HlTeam | undefined) {
  const assigned = (t ?? []).filter((m) => m.role === 'assigned' || m.role === 2 || m.role === '2');
  const kind = (m: HlTeam[number]) => (m.type ?? m.itemtype ?? '').toLowerCase();
  const pick = (k: string) => assigned.filter((m) => kind(m) === k).map((m) => ({ id: Number(m.id ?? m.items_id), name: m.name ?? null })).filter((m) => Number.isFinite(m.id));
  return { groups: pick('group'), users: pick('user') };
}

const glpiTs = (d: Date, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

/** Lê do GLPI o que mudou desde a última leitura e grava os chamados dos grupos e pessoas mapeados. */
export async function syncGlpiQueue(db: DbOrTx, tenantId: string, now = new Date()) {
  const st = await slaSettingsRow(db, tenantId);
  const cfg = await glpiConfig(db, tenantId);
  const [tn] = await db.select({ tz: s.tenants.timezone }).from(s.tenants).where(eq(s.tenants.id, tenantId)).limit(1);
  const tz = tn?.tz ?? 'America/Sao_Paulo';
  const { people, groups, userIds } = await glpiPeople(db, tenantId);
  if (!people.length) return { read: 0, stored: 0, note: 'Ninguém ligado ao GLPI no cadastro de usuários.' };
  const byGlpiUser = new Map(people.filter((p) => p.glpiUserId).map((p) => [p.glpiUserId!, p.id]));
  // margem de 10 min sobre a última leitura; na primeira, os últimos 45 dias
  const since = st.lastSyncAt ? new Date(st.lastSyncAt.getTime() - 10 * 60_000) : new Date(now.getTime() - 45 * 86_400_000);
  const filter = `date_mod=ge="${glpiTs(since, tz)}"`;
  let start = 0, read = 0, stored = 0;
  const limit = 100;
  for (let page = 0; page < 30; page++) {
    const list = await glpiCall<HlTicket[]>(cfg, 'GET', '/Assistance/Ticket', { query: { filter, limit, start, sort: 'date_mod' }, entityId: st.rootEntityId, recursive: true });
    const items = Array.isArray(list) ? list : [];
    for (const t of items) {
      read++;
      let team = t.team;
      if (!team) {
        try { team = await glpiCall<HlTeam>(cfg, 'GET', `/Assistance/Ticket/${t.id}/TeamMember`, { entityId: refId(t.entity) ?? st.rootEntityId }); } catch { team = []; }
      }
      const { groups: gs, users: us } = teamOf(team);
      const relevant = gs.some((g) => groups.has(g.id)) || us.some((u) => userIds.has(u.id));
      const [existing] = await db.select({ id: s.glpiQueueTickets.id }).from(s.glpiQueueTickets).where(and(eq(s.glpiQueueTickets.tenantId, tenantId), eq(s.glpiQueueTickets.glpiId, t.id))).limit(1);
      if (!relevant && !existing) continue;
      const status = refId(t.status);
      const values = {
        tenantId, glpiId: t.id, entityId: refId(t.entity), entityName: refName(t.entity), title: (t.name ?? `Chamado ${t.id}`).slice(0, 300),
        categoryName: refName(t.category), requesterName: refName(t.user_recipient), status, statusName: refName(t.status) ?? glpiStatusLabel(status), priority: refId(t.priority),
        openedAt: glpiDate(t.date ?? t.date_creation, tz) ?? now,
        dueSolveAt: glpiDate(t.resolution_date ?? t.internal_resolution_date, tz), dueOwnAt: glpiDate(t.time_to_own, tz), takenAt: glpiDate(t.take_into_account_date, tz),
        solvedAt: glpiDate(t.date_solve, tz) ?? (status && status >= 5 ? glpiDate(t.date_close, tz) : null), closedAt: glpiDate(t.date_close, tz),
        // sem relevância (foi tirado dos nossos grupos), os atribuídos ficam vazios e o chamado sai do painel
        groupIds: relevant ? gs.map((g) => g.id) : [], groupNames: relevant ? gs.map((g) => g.name ?? groups.get(g.id) ?? `Grupo ${g.id}`) : [],
        glpiUserIds: relevant ? us.map((u) => u.id) : [], glpiUserNames: relevant ? us.map((u) => u.name ?? `Usuário ${u.id}`) : [],
        userIds: relevant ? us.map((u) => byGlpiUser.get(u.id)).filter((x): x is string => !!x) : [],
        glpiUpdatedAt: t.date_mod ?? null, lastSyncAt: now,
      };
      const { tenantId: _t, glpiId: _g, ...upd } = values;
      await db.insert(s.glpiQueueTickets).values(values).onConflictDoUpdate({ target: [s.glpiQueueTickets.tenantId, s.glpiQueueTickets.glpiId], set: upd });
      stored++;
    }
    if (items.length < limit) break;
    start += limit;
  }
  await db.update(s.glpiSlaSettings).set({ lastSyncAt: now, lastError: null }).where(eq(s.glpiSlaSettings.tenantId, tenantId));
  return { read, stored };
}

// ------------------------------------------------------------------ avisos

type Person = { id: string; name: string; email: string; phone: string | null };
const glpiLink = (cfg: GlpiCfg | null, id: number) => (cfg ? `${cfg.baseUrl}/front/ticket.form.php?id=${id}` : null);
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmtWhen = (d: Date | null, tz: string) => (d ? new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d) : 'sem prazo');

const STAGE_COLOR: Record<AlertStage, string> = { chegou: '#2F5986', sem_dono: '#C62828', vence: '#B7791F', venceu: '#C62828', escalado: '#2D3339' };

/** Texto do aviso: quem, o quê e até quando. */
export function alertMessage(stage: AlertStage, r: Row, who: { forName: string; isAssignee: boolean }, due: Date | null, now: Date, tz: string, links: { glpi: string | null; revops: string }) {
  const resp = r.glpiUserNames.length ? r.glpiUserNames.join(', ') : 'ninguém assumiu';
  const head = {
    chegou: 'Novo chamado para o seu grupo',
    sem_dono: 'Chamado sem responsável',
    vence: `Vence ${dueText(due, now).replace('vence ', '')}`,
    venceu: `ATRASADO: ${dueText(due, now)}`,
    escalado: `Escalado: ${dueText(due, now)}`,
  }[stage];
  const what = r.takenAt ? 'solucionar' : 'assumir e solucionar';
  const lines = [
    `Chamado #${r.glpiId} · ${r.title}`,
    `Cliente: ${r.entityName ?? '—'} · Grupo: ${r.groupNames.join(', ') || '—'}`,
    `Responsável: ${who.isAssignee ? 'você' : resp}`,
    `Falta: ${what} · Prazo: ${fmtWhen(due, tz)}`,
  ];
  const subject = `[${ALERT_STAGE_LABELS[stage].toUpperCase()}] #${r.glpiId} ${r.title}${due ? ` · ${dueText(due, now)}` : ''}`.slice(0, 180);
  const text = `${who.forName}, ${head.toLowerCase()}.\n\n${lines.join('\n')}\n\n${links.glpi ? `Abrir no GLPI: ${links.glpi}\n` : ''}Ver no RevOps: ${links.revops}`;
  const wa = `*${head}*\n${lines.join('\n')}${links.glpi ? `\n${links.glpi}` : ''}`;
  const color = STAGE_COLOR[stage];
  const row = (k: string, v: string, strong = false) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #E1E5EA;font-size:12px;color:#5F6B76;width:110px">${k}</td><td style="padding:8px 12px;border-bottom:1px solid #E1E5EA;font-size:14px;color:${strong ? color : '#2D3339'};font-weight:${strong ? 700 : 600}">${v}</td></tr>`;
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F2F4F6;font-family:'Work Sans','Segoe UI',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-collapse:collapse">
<tr><td style="background:#2D3339;padding:16px 24px;font-family:Orbitron,Arial,sans-serif;color:#FFFFFF;font-size:18px;font-weight:700">BKT <span style="font-size:12px;font-weight:600;color:rgba(255,255,255,.8);border-left:1px solid rgba(255,255,255,.35);padding-left:10px;margin-left:6px">RevOps · Dados Planejados</span></td></tr>
<tr><td style="height:4px;background:${color};font-size:0;line-height:4px">&nbsp;</td></tr>
<tr><td style="padding:20px 24px">
<p style="margin:0 0 14px;font-size:15px;color:#2D3339">${esc(who.forName)}, <b style="color:${color}">${esc(head.toLowerCase())}</b>.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E1E5EA;border-left:4px solid ${color}">
${row('Chamado', `#${r.glpiId} · ${esc(r.title)}`)}${row('Cliente', esc(r.entityName ?? '—'))}${row('Grupo', esc(r.groupNames.join(', ') || '—'))}${row('Responsável', who.isAssignee ? 'você' : esc(resp))}${row('O que falta', what)}${row('Prazo', `${esc(fmtWhen(due, tz))}${due ? ` (${esc(dueText(due, now))})` : ''}`, stage !== 'chegou')}
</table>
<p style="margin:18px 0 0">${links.glpi ? `<a href="${esc(links.glpi)}" style="display:inline-block;background:#2F5986;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 18px;margin-right:8px">Abrir no GLPI</a>` : ''}<a href="${esc(links.revops)}" style="display:inline-block;border:1px solid #2F5986;color:#2F5986;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px">Ver no RevOps</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, wa, html };
}

async function deliver(db: DbOrTx, tenantId: string, key: string, stage: string, ticketId: string | null, p: Person, ch: 'email' | 'whatsapp', msg: { subject: string; text: string; html: string; wa: string }, zapi: Awaited<ReturnType<typeof zapiCfg>>) {
  // reserva antes de enviar: com duas rotinas ao mesmo tempo, só uma envia
  const [claim] = await db.insert(s.glpiSlaAlerts).values({ tenantId, ticketId, alertKey: key, stage, userId: p.id, channel: ch, ok: false }).onConflictDoNothing().returning({ id: s.glpiSlaAlerts.id });
  if (!claim) return 0;
  let ok = false, error: string | null = null;
  try {
    if (ch === 'email') {
      const r = await sendAlert(db, { tenantId, kind: 'dados_planejados', to: p.email, subject: msg.subject, text: msg.text, html: msg.html });
      ok = !!r && 'ok' in r && r.ok; if (!ok) error = r && 'error' in r ? r.error : 'Falha no envio';
    } else {
      const ph = waPhone(p.phone);
      if (!ph || !zapi) error = !ph ? 'Sem WhatsApp no cadastro do usuário' : 'Z-API não configurada';
      else { await sendZapiText(zapi, ph, msg.wa); ok = true; }
    }
  } catch (e) { error = (e as Error).message.slice(0, 300); }
  await db.update(s.glpiSlaAlerts).set({ ok, error }).where(eq(s.glpiSlaAlerts.id, claim.id));
  return ok ? 1 : 0;
}

/** Visível no painel: atribuído a uma pessoa mapeada ou a um grupo monitorado. */
export const isMonitored = (r: Pick<Row, 'groupIds' | 'userIds'>, groups: Map<number, string>) => r.userIds.length > 0 || r.groupIds.some((g) => groups.has(g));

/** Manda os avisos que já deveriam ter saído (régua) e o resumo diário. */
export async function runSlaAlerts(db: DbOrTx, config: Config, tenantId: string, now = new Date()) {
  const st = await slaSettingsRow(db, tenantId);
  const set = settingsOf(st);
  const [tn] = await db.select({ tz: s.tenants.timezone }).from(s.tenants).where(eq(s.tenants.id, tenantId)).limit(1);
  const tz = tn?.tz ?? 'America/Sao_Paulo';
  const { people, all, groups } = await glpiPeople(db, tenantId);
  const byId = new Map(all.map((p) => [p.id, p]));
  const cfg = await glpiConfig(db, tenantId).catch(() => null);
  const email = set.email && !!(await smtpConfig(db, tenantId))?.enabled;
  const zapi = set.whatsapp ? await zapiCfg(db, tenantId) : null;
  const channels: ('email' | 'whatsapp')[] = [...(email ? ['email' as const] : []), ...(set.whatsapp && zapi ? ['whatsapp' as const] : [])];
  if (!channels.length) return { sent: 0, note: 'Nenhum canal pronto (SMTP ou Z-API).' };
  const rows = (await db.select().from(s.glpiQueueTickets).where(and(eq(s.glpiQueueTickets.tenantId, tenantId), or(isNull(s.glpiQueueTickets.status), lt(s.glpiQueueTickets.status, 5)))))
    .filter((r) => isMonitored(r, groups));
  const members = (r: Row) => people.filter((p) => p.glpiGroupIds.some((g) => r.groupIds.includes(g)));
  const leaders = (r: Row) => [...new Set(r.groupIds.flatMap((g) => st.groupLeaders[String(g)] ?? []))];
  const managers = st.managerIds;
  let sent = 0;
  const revops = publicLink(config, '/dados-planejados');
  for (const r of rows) {
    const fresh = r.firstSeenAt.getTime() - r.openedAt.getTime() < 3_600_000 && now.getTime() - r.openedAt.getTime() < 24 * 3_600_000;
    const due = ticketDue(r, set, tz);
    for (const a of slaDueAlerts({ ...r, assignedUserIds: r.glpiUserIds }, now, set, tz, fresh)) {
      const assignees = r.userIds.length ? r.userIds : members(r).map((p) => p.id);
      const to = new Set<string>(
        a.stage === 'sem_dono' ? (leaders(r).length ? leaders(r) : managers)
          : a.stage === 'escalado' ? (managers.length ? managers : leaders(r))
            : a.stage === 'venceu' ? [...assignees, ...leaders(r)]
              : assignees,
      );
      for (const uid of to) {
        const p = byId.get(uid);
        if (!p) continue;
        const msg = alertMessage(a.stage, r, { forName: p.name.split(' ')[0]!, isAssignee: r.userIds.includes(uid) }, due, now, tz, { glpi: glpiLink(cfg, r.glpiId), revops });
        for (const ch of channels) sent += await deliver(db, tenantId, `${r.glpiId}:${a.key}`, a.stage, r.id, p, ch, msg, zapi);
      }
    }
  }
  sent += await sendDigests(db, tenantId, set, tz, now, rows, people, managers, byId, channels, zapi, cfg, revops);
  return { sent };
}

async function sendDigests(db: DbOrTx, tenantId: string, set: SlaSettings, tz: string, now: Date, rows: Row[], people: Person[] & { glpiGroupIds: number[] }[], managers: string[], byId: Map<string, Person>, channels: ('email' | 'whatsapp')[], zapi: Awaited<ReturnType<typeof zapiCfg>>, cfg: GlpiCfg | null, revops: string) {
  const lp = localParts(now, tz);
  if (!set.businessDays.includes(lp.weekday) || lp.hour < set.digestHour) return 0;
  const today = lp.date;
  const pend = rows.map((r) => ({ r, due: ticketDue(r, set, tz), sit: ticketSituation({ ...r, assignedUserIds: r.glpiUserIds }, now, set, tz) }))
    .filter((x) => x.sit === 'atrasado' || (x.due && localParts(x.due, tz).date === today));
  const line = (x: (typeof pend)[number]) => `• #${x.r.glpiId} ${x.r.title} — ${x.r.glpiUserNames.join(', ') || 'sem responsável'} — ${dueText(x.due, now)}`;
  let sent = 0;
  const targets = new Map<string, (typeof pend)>();
  for (const p of people as (Person & { glpiGroupIds: number[] })[]) {
    const mine = pend.filter((x) => x.r.userIds.includes(p.id) || (!x.r.userIds.length && p.glpiGroupIds.some((g) => x.r.groupIds.includes(g))));
    if (mine.length) targets.set(p.id, mine);
  }
  for (const m of managers) if (pend.length) targets.set(m, pend);
  for (const [uid, list] of targets) {
    const p = byId.get(uid);
    if (!p) continue;
    const late = list.filter((x) => x.sit === 'atrasado').length;
    const subject = `Dados Planejados: ${late} atrasado(s) e ${list.length - late} vencendo hoje`;
    const text = `${p.name.split(' ')[0]}, seus chamados de hoje:\n\n${list.slice(0, 40).map(line).join('\n')}\n\nVer no RevOps: ${revops}`;
    const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F2F4F6;font-family:'Work Sans','Segoe UI',Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" style="max-width:600px;width:100%;background:#FFFFFF;border-collapse:collapse"><tr><td style="background:#2D3339;padding:16px 24px;font-family:Orbitron,Arial,sans-serif;color:#FFFFFF;font-size:18px;font-weight:700">BKT <span style="font-size:12px;color:rgba(255,255,255,.8)">RevOps · Resumo do dia</span></td></tr><tr><td style="padding:20px 24px;font-size:14px;color:#2D3339"><p style="margin:0 0 12px">${esc(p.name.split(' ')[0]!)}, <b>${late} atrasado(s)</b> e <b>${list.length - late} vencendo hoje</b>:</p><ul style="margin:0;padding-left:18px">${list.slice(0, 40).map((x) => `<li style="margin:4px 0">${cfg ? `<a href="${esc(glpiLink(cfg, x.r.glpiId)!)}" style="color:#2F5986">#${x.r.glpiId}</a>` : `#${x.r.glpiId}`} ${esc(x.r.title)} · ${esc(x.r.glpiUserNames.join(', ') || 'sem responsável')} · <b style="color:${x.sit === 'atrasado' ? '#C62828' : '#8A5A00'}">${esc(dueText(x.due, now))}</b></li>`).join('')}</ul><p style="margin:16px 0 0"><a href="${esc(revops)}" style="display:inline-block;background:#2F5986;color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 18px">Abrir Dados Planejados</a></p></td></tr></table></td></tr></table></body></html>`;
    const wa = `*Resumo do dia · Dados Planejados*\n${late} atrasado(s), ${list.length - late} vencendo hoje\n${list.slice(0, 10).map(line).join('\n')}${list.length > 10 ? `\n… e mais ${list.length - 10}` : ''}`;
    for (const ch of channels) sent += await deliver(db, tenantId, `resumo:${today}`, 'resumo', null, p, ch, { subject, text, html, wa }, zapi);
  }
  return sent;
}

/**
 * Rotina: lê o GLPI e manda os avisos. Roda no máximo a cada 4 minutos por empresa (a tela de quem está usando a
 * ferramenta e o agendamento externo chamam; quem chegar primeiro roda). `force` ignora o intervalo.
 */
export async function runGlpiSla(db: DbOrTx, config: Config, tenantId: string, opts: { force?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const st = await slaSettingsRow(db, tenantId);
  if (!st.enabled) return { skipped: 'desligado' };
  const claimed = await db.update(s.glpiSlaSettings).set({ lastRunAt: now })
    .where(and(eq(s.glpiSlaSettings.tenantId, tenantId), opts.force ? sql`true` : or(isNull(s.glpiSlaSettings.lastRunAt), lt(s.glpiSlaSettings.lastRunAt, new Date(now.getTime() - 4 * 60_000)))))
    .returning({ t: s.glpiSlaSettings.tenantId });
  if (!claimed.length) return { skipped: 'recente' };
  let sync: unknown;
  try { sync = await syncGlpiQueue(db, tenantId, now); }
  catch (e) {
    await db.update(s.glpiSlaSettings).set({ lastError: (e as Error).message.slice(0, 300) }).where(eq(s.glpiSlaSettings.tenantId, tenantId));
    sync = { error: (e as Error).message };
  }
  const alerts = await runSlaAlerts(db, config, tenantId, now).catch((e) => ({ error: (e as Error).message }));
  return { sync, alerts };
}

export async function runGlpiSlaAll(db: DbOrTx, config: Config) {
  const rows = await db.select({ tenantId: s.glpiSlaSettings.tenantId }).from(s.glpiSlaSettings).where(eq(s.glpiSlaSettings.enabled, true));
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.tenantId] = await runGlpiSla(db, config, r.tenantId).catch((e) => ({ error: (e as Error).message }));
  return out;
}

