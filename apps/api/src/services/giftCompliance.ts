/**
 * Compliance de brindes, apoios e patrocínios: carga das diretrizes, avaliação de uma solicitação com o histórico,
 * quem vê e quem decide, avisos e pendências de controle. As regras de cálculo estão em @isp/domain (giftCompliance).
 */
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  currentRules, deliveryNeeds, evaluateConcession,
  ATTENTION_LABELS, type ApproverLevel, type AttentionSituation, type ComplianceRule, type KitCategory, type PowerClass, type ConcessionKind, type ConcessionPurpose, type Evaluation, type HistoryEntry,
} from '@isp/domain';
import type { Config } from '../config';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { sendAlert } from './email';
import { publicLink } from './alerts';
import { zapiCfg } from './contractNotify';
import { sendZapiText, waPhone } from './whatsapp';
import { decidesStages, isFinance } from './budget';
import { figuresFor } from '../routes/budgetCentral';

export type Req = typeof s.giftRequests.$inferSelect;

/** Vê tudo: Administração, Diretoria, Financeiro e quem tem Marketing total. Gestão: o próprio e o time que lidera. Demais: só as próprias. */
export const seesAll = (auth: AuthContext) => auth.profiles.includes('administrador') || auth.profiles.includes('diretoria') || isFinance(auth) || auth.access.campanhas === 'total';
export const canSeeRequest = (auth: AuthContext, requesterId: string) => seesAll(auth) || requesterId === auth.userId || (auth.profiles.includes('gerencia') && auth.teamMemberIds.includes(requesterId));
export const levelsOf = (auth: AuthContext): ApproverLevel[] => decidesStages(auth);
/** Configura diretrizes: administrador autorizado. */
export const canConfigure = (auth: AuthContext) => auth.access.configuracoes === 'total';
/** Prestação de contas: Gestão comercial, Diretoria e Administração. */
export const canReport = (auth: AuthContext) => ['gerencia', 'diretoria', 'administrador'].some((p) => auth.profiles.includes(p));

export async function settingsOf(db: DbOrTx, tenantId: string) {
  const [r] = await db.select().from(s.giftComplianceSettings).where(eq(s.giftComplianceSettings.tenantId, tenantId)).limit(1);
  return { segregation: r?.segregation ?? true, conformingLevel: (r?.conformingLevel ?? 'gerencia') as ApproverLevel, channels: r?.channels ?? {}, policyNote: r?.policyNote ?? null, configured: !!r };
}

export const toRule = (r: typeof s.giftComplianceRules.$inferSelect): ComplianceRule => ({
  id: r.id, key: r.ruleKey, version: r.version, name: r.name, description: r.description, param: r.param as ComplianceRule['param'], controlType: r.controlType as ComplianceRule['controlType'],
  approverLevel: r.approverLevel as ApproverLevel, limit: r.limitValue, windowDays: r.windowDays, allowedKitIds: r.allowedKitIds, allowedItemIds: r.allowedItemIds,
  kinds: r.kinds as ConcessionKind[], natures: r.natures as ('publica' | 'privada')[], segments: r.segments, purposes: r.purposes as ConcessionPurpose[], kitCategories: r.kitCategories as KitCategory[],
  validFrom: r.validFrom, validTo: r.validTo, active: r.active,
});
export async function allRules(db: DbOrTx, tenantId: string) {
  return (await db.select().from(s.giftComplianceRules).where(eq(s.giftComplianceRules.tenantId, tenantId)).orderBy(s.giftComplianceRules.ruleKey, desc(s.giftComplianceRules.version))).map(toRule);
}

/** Histórico que conta para limites: aprovadas, reservadas e executadas (valor executado, aprovado ou estimado). */
export async function concessionHistory(db: DbOrTx, tenantId: string, exceptId: string | null): Promise<HistoryEntry[]> {
  const rows = await db.select().from(s.giftRequests).where(and(eq(s.giftRequests.tenantId, tenantId), inArray(s.giftRequests.state, ['aprovado', 'reservado', 'executado']), exceptId ? sql`${s.giftRequests.id} <> ${exceptId}` : undefined));
  if (!rows.length) return [];
  const accs = await db.select().from(s.giftRequestAccounts).where(inArray(s.giftRequestAccounts.requestId, rows.map((r) => r.id)));
  return rows.map((r) => ({ on: r.executedOn ?? r.plannedOn, totalCents: r.executedCents ?? r.approvedCents ?? r.estimatedCents, accounts: accs.filter((a) => a.requestId === r.id).map((a) => ({ id: a.contactId, shareCents: a.shareCents })) }));
}

export type EvalInput = {
  kind: ConcessionKind; purpose: ConcessionPurpose; totalCents: number; kitId: string | null; kits: number; items: { itemId: string; qty: number }[];
  accounts: { contactId: string; shareCents: number }[]; budgetLineId: string | null; on: string;
  kitCategory: KitCategory | null; recipients: { name: string; powerClass: string }[]; collective: boolean; attention: AttentionSituation[];
};

/** Destinatários (stakeholders das contas escolhidas) com nome, cargo e classificação da época. */
export async function recipientsOf(db: DbOrTx, tenantId: string, stakeholderIds: string[], contactIds: string[]) {
  if (!stakeholderIds.length) return [];
  const rows = await db.select({ id: s.accountStakeholders.id, contactId: s.accountStakeholders.contactId, title: s.accountStakeholders.title, powerClass: s.accountStakeholders.powerClass, name: s.people.name })
    .from(s.accountStakeholders).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).where(and(eq(s.accountStakeholders.tenantId, tenantId), inArray(s.accountStakeholders.id, stakeholderIds)));
  if (rows.length !== new Set(stakeholderIds).size || rows.some((r) => !contactIds.includes(r.contactId))) return null;
  return rows.map((r) => ({ stakeholderId: r.id, contactId: r.contactId, name: r.name, title: r.title, powerClass: r.powerClass }));
}

/** Situações detectadas: oportunidade aberta (negociação) e licitação em andamento nas contas. */
export async function detectedAttention(db: DbOrTx, tenantId: string, contactIds: string[]) {
  if (!contactIds.length) return [];
  const opps = await db.select({ title: s.opportunities.title, stage: s.opportunities.stage, contactId: s.opportunities.contactId }).from(s.opportunities)
    .where(and(eq(s.opportunities.tenantId, tenantId), inArray(s.opportunities.contactId, contactIds), notInArray(s.opportunities.stage, ['ganha', 'perdida']), sql`${s.opportunities.deletedAt} is null`));
  return opps.slice(0, 5).map((o) => `Oportunidade em andamento na conta: ${o.title}`);
}

/** Saldo do lançamento de orçamento vinculado (aprovado − consumo). */
export async function budgetAvailable(db: DbOrTx, tenantId: string, lineId: string | null, today: string) {
  if (!lineId) return null;
  const [l] = await db.select().from(s.budgetLines).where(and(eq(s.budgetLines.id, lineId), eq(s.budgetLines.tenantId, tenantId))).limit(1);
  if (!l) return null;
  const [f] = await figuresFor(db, tenantId, [l], today);
  return { lineId: l.id, code: l.code, what: l.what, approved: f!.f.approved, committed: f!.f.committed, realized: f!.f.realized, paid: f!.f.paid, balance: f!.f.balance };
}

export async function evaluate(db: DbOrTx, tenantId: string, input: EvalInput, exceptId: string | null, today: string): Promise<Evaluation> {
  const kit = input.kitId ? (await db.select().from(s.giftKits).where(and(eq(s.giftKits.id, input.kitId), eq(s.giftKits.tenantId, tenantId))).limit(1))[0] : null;
  const needs = deliveryNeeds(kit?.items ?? null, kit ? input.kits : 0, input.items);
  const accounts = input.accounts.length ? await db.select({ id: s.contacts.id, name: s.contacts.name, nature: s.contacts.nature, segment: s.contacts.segment }).from(s.contacts).where(and(eq(s.contacts.tenantId, tenantId), inArray(s.contacts.id, input.accounts.map((a) => a.contactId)))) : [];
  const budget = await budgetAvailable(db, tenantId, input.budgetLineId, today);
  const rules = currentRules(await allRules(db, tenantId), input.on);
  const units = Math.max(1, kit ? input.kits : input.recipients.length || 1);
  const auto = await detectedAttention(db, tenantId, input.accounts.map((a) => a.contactId));
  return evaluateConcession(rules, {
    kitCategory: input.kitCategory, unitCents: Math.round(input.totalCents / units), collective: input.collective,
    recipients: input.recipients.map((r) => ({ name: r.name, powerClass: r.powerClass as PowerClass })),
    attention: [...input.attention.map((a) => ATTENTION_LABELS[a]), ...auto],
    kind: input.kind, purpose: input.purpose, totalCents: input.totalCents, itemUnits: needs.reduce((t, n) => t + n.qty, 0),
    kitIds: kit ? [kit.id] : [], itemIds: input.items.map((i) => i.itemId),
    accounts: input.accounts.map((a) => { const c = accounts.find((x) => x.id === a.contactId); return { id: a.contactId, name: c?.name ?? 'Conta', nature: (c?.nature ?? null) as 'publica' | 'privada' | null, segment: c?.segment ?? null, shareCents: a.shareCents }; }),
    budgetAvailableCents: budget ? budget.balance : null, on: input.on,
  }, await concessionHistory(db, tenantId, exceptId));
}

/** Resumo por conta para ver antes de uma nova solicitação: total, última, exceções e por tipo. */
export async function accountConcessions(db: DbOrTx, tenantId: string, contactIds: string[]) {
  if (!contactIds.length) return [];
  const rows = await db.select({ a: s.giftRequestAccounts, r: s.giftRequests }).from(s.giftRequestAccounts).innerJoin(s.giftRequests, eq(s.giftRequests.id, s.giftRequestAccounts.requestId))
    .where(and(eq(s.giftRequests.tenantId, tenantId), inArray(s.giftRequestAccounts.contactId, contactIds), notInArray(s.giftRequests.state, ['rejeitado', 'cancelado'])));
  return contactIds.map((id) => {
    const mine = rows.filter((x) => x.a.contactId === id);
    const done = mine.filter((x) => x.r.state === 'executado');
    const last = done.map((x) => x.r.executedOn!).sort().at(-1) ?? null;
    return {
      contactId: id, executed: done.length, investedCents: done.reduce((t, x) => t + x.a.shareCents, 0), exceptions: done.filter((x) => x.r.exception).length,
      inProgress: mine.length - done.length, lastOn: last,
    };
  });
}

// ------------------------------------------------------------------ avisos
export const COMPLIANCE_EVENTS = {
  aguardando: 'Solicitação aguardando autorização',
  fora_parametros: 'Solicitação fora dos parâmetros',
  aprovada: 'Aprovação concedida',
  rejeitada: 'Solicitação rejeitada',
  ajustes: 'Ajustes solicitados',
  pendencia_documental: 'Pendência documental',
  executada: 'Execução concluída',
} as const;
export type ComplianceEvent = keyof typeof COMPLIANCE_EVENTS;

/** Quem decide numa alçada (perfil + cargo liderança). */
export async function decidersFor(db: DbOrTx, tenantId: string, level: ApproverLevel) {
  const rows = await db.select({ id: s.users.id, key: s.roles.key, sectorRole: s.users.sectorRole }).from(s.users).innerJoin(s.userRoles, eq(s.userRoles.userId, s.users.id)).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId))
    .where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true), inArray(s.roles.key, level === 'gerencia' ? ['gerencia', 'diretoria'] : ['diretoria'])));
  return [...new Set(rows.filter((r) => r.sectorRole === 'lideranca').map((r) => r.id))];
}

/**
 * Aviso interno sempre; e-mail e WhatsApp só quando a empresa ligou o canal para o evento. GLPI e IXC não recebem avisos internos
 * (não têm destino de aviso para pessoas). Uma chave por evento e pessoa (sem duplicar); cada canal tentado fica registrado.
 */
export async function notifyCompliance(db: DbOrTx, config: Config | null, tenantId: string, userIds: (string | null | undefined)[], ev: { event: ComplianceEvent; title: string; body?: string | null; requestId: string; key: string; actorId?: string | null }) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x && x !== ev.actorId))];
  if (!ids.length) return 0;
  const st = await settingsOf(db, tenantId);
  const ch = st.channels[ev.event] ?? {};
  const users = await db.select({ id: s.users.id, email: s.users.email, phone: s.users.phone, active: s.users.active }).from(s.users).where(and(eq(s.users.tenantId, tenantId), inArray(s.users.id, ids)));
  const link = `/brindes?t=compliance&id=${ev.requestId}`;
  let zapi: Awaited<ReturnType<typeof zapiCfg>> | undefined;
  let n = 0;
  for (const u of users) {
    if (!u.active) continue;
    const [row] = await db.insert(s.userNotifications).values({ tenantId, userId: u.id, module: 'brindes', event: ev.event, title: ev.title.slice(0, 200), body: ev.body?.slice(0, 300) ?? null, link, actorId: ev.actorId ?? null, dedupeKey: `gc:${ev.key}` }).onConflictDoNothing().returning({ id: s.userNotifications.id });
    if (!row) continue;
    n++;
    const log = (channel: 'interna' | 'email' | 'whatsapp', status: typeof s.notificationDeliveries.$inferInsert.status, detail: string | null = null) => db.insert(s.notificationDeliveries).values({ tenantId, notificationId: row.id, channel, status, detail: detail?.slice(0, 300) ?? null });
    await log('interna', 'entregue');
    const text = `${ev.title}\n\nAbrir: ${config ? publicLink(config, link) : link}`;
    if (ch.email) {
      if (!u.email) await log('email', 'sem_contato', 'Sem e-mail cadastrado.');
      else { const r = await sendAlert(db, { tenantId, kind: 'brindes_compliance', to: u.email, subject: ev.title, text }); await log('email', r?.ok ? 'enviado' : r && 'notConfigured' in r && r.notConfigured ? 'nao_configurado' : 'falhou', r && !r.ok ? r.error : null); }
    }
    if (ch.whatsapp) {
      const to = waPhone(u.phone);
      if (!to) await log('whatsapp', 'sem_contato', 'Sem WhatsApp cadastrado.');
      else {
        if (zapi === undefined) zapi = await zapiCfg(db, tenantId);
        if (!zapi) await log('whatsapp', 'nao_configurado', 'WhatsApp (Z-API) não configurado.');
        else try { await sendZapiText(zapi, to, text); await log('whatsapp', 'enviado'); } catch (e) { await log('whatsapp', 'falhou', (e as Error).message); }
      }
    }
  }
  return n;
}

// ------------------------------------------------------------------ pendências e completude
export const EVIDENCE_KINDS = ['comprovante', 'entrega', 'evidencia'];
/** Registro completo para a prestação de contas: justificativa, decisão registrada e ao menos uma evidência de execução. */
export const isComplete = (r: Pick<Req, 'justification'>, decided: boolean, docKinds: string[]) => !!r.justification?.trim() && decided && docKinds.some((k) => EVIDENCE_KINDS.includes(k));

export type Pendency = { requestId: string; code: string; text: string; responsibleId: string; since: string };
export function pendenciesOf(rows: (Req & { docKinds: string[]; decided: boolean; paidCents: number | null })[], today: string): Pendency[] {
  const out: Pendency[] = [];
  for (const r of rows) {
    if (r.state === 'executado' && !r.docKinds.some((k) => EVIDENCE_KINDS.includes(k))) out.push({ requestId: r.id, code: r.code, text: 'Executada sem comprovante ou registro de entrega', responsibleId: r.executorId ?? r.requesterId, since: r.executedOn! });
    if (r.state === 'executado' && !r.decided) out.push({ requestId: r.id, code: r.code, text: 'Executada sem decisão registrada', responsibleId: r.requesterId, since: r.executedOn! });
    if ((r.state === 'aprovado' || r.state === 'reservado') && r.plannedOn < today) out.push({ requestId: r.id, code: r.code, text: 'Aprovada e não executada na data prevista', responsibleId: r.requesterId, since: r.plannedOn });
    if ((r.state === 'solicitado' || r.state === 'ajustes') && r.outcome === 'impedido') out.push({ requestId: r.id, code: r.code, text: 'Restrição obrigatória sem tratamento formal', responsibleId: r.requesterId, since: r.createdAt.toISOString().slice(0, 10) });
    if (r.state === 'executado' && r.kind === 'patrocinio_financeiro' && r.paidCents !== null && r.executedCents !== null && r.paidCents !== r.executedCents) out.push({ requestId: r.id, code: r.code, text: `Pago diferente do executado no orçamento (${(r.paidCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`, responsibleId: r.requesterId, since: r.executedOn! });
    if (r.state === 'executado' && r.kind === 'patrocinio_financeiro' && !r.budgetLineId) out.push({ requestId: r.id, code: r.code, text: 'Patrocínio financeiro sem lançamento de orçamento (pagamento não conciliável)', responsibleId: r.requesterId, since: r.executedOn! });
  }
  return out;
}
