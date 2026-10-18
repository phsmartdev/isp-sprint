/** Alertas automáticos por e-mail. Respeitam as chaves em Configurações → Notificações. */
import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Config } from '../config';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { AuthContext } from '../http/context';
import { brl, notificationsOf, renderEmail, sendAlert, smtpConfig, tenantName, userBasics } from './email';

export const publicLink = (config: Config, path = '/') => `${config.publicUrl.replace(/\/$/, '')}${path}`;

/** Venda fechada: avisa gerência e quem lidera o time do vendedor (menos quem fechou). */
export async function notifyDealWon(db: DbOrTx, config: Config, auth: AuthContext, opp: { id: string; ownerId: string; ownerName: string; contactName: string; planName: string | null; valueCents: number | null }) {
  const n = await notificationsOf(db, auth.tenantId);
  if (!n.dealWon || !(await smtpConfig(db, auth.tenantId))) return;
  const managers = await db.execute<{ id: string; name: string; email: string }>(sql`
    select distinct u.id, u.name, u.email from users u
    where u.tenant_id = ${auth.tenantId} and u.active and u.id <> ${auth.userId} and (
      exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.key = 'gerencia')
      or exists (select 1 from team_memberships lead join team_memberships m on m.team_id = lead.team_id where lead.user_id = u.id and lead.is_lead and m.user_id = ${opp.ownerId})
    )`);
  const empresa = await tenantName(db, auth.tenantId);
  for (const m of managers.rows) {
    const mail = await renderEmail(db, auth.tenantId, 'alerta_venda_fechada', {
      'usuario.nome': m.name, 'cliente.nome': opp.contactName, 'vendedor.nome': opp.ownerName, 'plano.nome': opp.planName ?? '', 'plano.valor': brl(opp.valueCents), link: publicLink(config, `/opportunities/${opp.id}`), 'empresa.nome': empresa,
    });
    await sendAlert(db, { tenantId: auth.tenantId, kind: 'alerta_venda_fechada', to: m.email, ...mail, opportunityId: opp.id, createdBy: auth.userId });
  }
}

/** Lead atribuído a outra pessoa: avisa o novo responsável. */
export async function notifyLeadAssigned(db: DbOrTx, config: Config, auth: AuthContext, ownerId: string, leads: { id: string; name: string; phone: string | null }[]) {
  if (ownerId === auth.userId || !leads.length) return;
  const n = await notificationsOf(db, auth.tenantId);
  if (!n.leadAssigned || !(await smtpConfig(db, auth.tenantId))) return;
  const u = await userBasics(db, auth.tenantId, ownerId);
  if (!u?.active) return;
  const empresa = await tenantName(db, auth.tenantId);
  const first = leads[0]!;
  const mail = await renderEmail(db, auth.tenantId, 'alerta_lead_atribuido', {
    'usuario.nome': u.name,
    'lead.nome': leads.length > 1 ? `${first.name} e mais ${leads.length - 1}` : first.name,
    'lead.telefone': first.phone ?? 'sem telefone',
    atribuido_por: auth.name,
    link: publicLink(config, '/leads'),
    'empresa.nome': empresa,
  });
  await sendAlert(db, { tenantId: auth.tenantId, kind: 'alerta_lead_atribuido', to: u.email, ...mail, createdBy: auth.userId });
}

/** Acesso de usuário (convite ou nova senha). Devolve se o e-mail saiu. */
export async function notifyUserAccess(db: DbOrTx, config: Config, auth: AuthContext, kind: 'convite_usuario' | 'nova_senha', user: { name: string; email: string }, password: string) {
  const n = await notificationsOf(db, auth.tenantId);
  if (!n.userAccess || !(await smtpConfig(db, auth.tenantId))) return false;
  const mail = await renderEmail(db, auth.tenantId, kind, {
    'usuario.nome': user.name, 'usuario.email': user.email, senha_temporaria: password, link: publicLink(config, '/login'), 'empresa.nome': await tenantName(db, auth.tenantId),
  });
  const r = await sendAlert(db, { tenantId: auth.tenantId, kind, to: user.email, ...mail, createdBy: auth.userId });
  return !!r?.ok;
}

/** Resumo diário: atividades de hoje e vencidas de cada pessoa. Chamado pelo agendamento (cron). */
export async function sendActivityDigests(db: DbOrTx, config: Config) {
  const tenants = await db.select({ id: s.tenants.id, name: s.tenants.name, tz: s.tenants.timezone }).from(s.tenants);
  let sent = 0;
  for (const t of tenants) {
    const n = await notificationsOf(db, t.id);
    if (!n.activityDigest || !(await smtpConfig(db, t.id))) continue;
    const endOfDay = sql`((date_trunc('day', now() at time zone ${t.tz}) + interval '1 day') at time zone ${t.tz})`;
    const rows = await db
      .select({ ownerId: s.activities.ownerId, title: s.activities.title, dueAt: s.activities.dueAt, name: s.users.name, email: s.users.email })
      .from(s.activities)
      .innerJoin(s.users, eq(s.users.id, s.activities.ownerId))
      .where(and(eq(s.activities.tenantId, t.id), isNull(s.activities.completedAt), eq(s.users.active, true), lte(s.activities.dueAt, endOfDay)))
      .orderBy(s.activities.dueAt)
      .limit(5000);
    const byUser = new Map<string, typeof rows>();
    for (const r of rows) byUser.set(r.ownerId, [...(byUser.get(r.ownerId) ?? []), r]);
    for (const list of byUser.values()) {
      const u = list[0]!;
      const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: t.tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const lista = list.slice(0, 30).map((a) => `• ${a.dueAt ? fmt.format(a.dueAt) : ''} — ${a.title}`).join('\n') + (list.length > 30 ? `\n… e mais ${list.length - 30}` : '');
      const mail = await renderEmail(db, t.id, 'alerta_atividades', { 'usuario.nome': u.name, quantidade: list.length, lista, link: publicLink(config, '/activities'), 'empresa.nome': t.name });
      const r = await sendAlert(db, { tenantId: t.id, kind: 'alerta_atividades', to: u.email, ...mail });
      if (r?.ok) sent++;
    }
  }
  return { sent };
}

