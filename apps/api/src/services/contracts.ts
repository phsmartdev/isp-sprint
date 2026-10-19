/**
 * Gestão de Contratos: acesso, versões (só INSERT), linha do tempo, processos e notificações.
 * O cliente vem de contacts/customers (sem cópia). ERP: nenhuma chamada é inventada; as etapas de ERP
 * ficam como tarefa com referência informada por uma pessoa até o ERP ser integrado.
 */
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  DEFAULT_CONTRACT_SETTINGS, DEFAULT_OFICIO, SECTOR_LABELS, processSteps,
  type ContractKind, type ContractSettings, type ProcessKind, type Sector, type StepDef,
} from '@isp/domain';
import type { Config } from '../config';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { AuthContext } from '../http/context';
import { forbidden, notFound, unprocessable } from '../http/errors';
import { level } from './scope';
import { brl, sendAlert } from './email';
import { publicLink } from './alerts';

export type ContractRow = typeof s.contracts.$inferSelect;
export type VersionRow = typeof s.contractVersions.$inferSelect;

// ------------------------------------------------------------------ configurações
export async function contractSettingsOf(db: DbOrTx, tenantId: string): Promise<ContractSettings & { oficioTemplateId: string | null }> {
  const [r] = await db.select().from(s.contractSettings).where(eq(s.contractSettings.tenantId, tenantId)).limit(1);
  const v = (r?.settings ?? {}) as Record<string, unknown>;
  return { ...DEFAULT_CONTRACT_SETTINGS, financeEmail: null, deliveryEmail: null, oficioTemplate: DEFAULT_OFICIO, oficioTemplateId: null, ...v } as ContractSettings & { oficioTemplateId: string | null };
}

// ------------------------------------------------------------------ acesso
export const isAdmin = (auth: AuthContext) => auth.access.configuracoes === 'total';
/** Setores de apoio (Financeiro, Jurídico, Diretoria...) enxergam todos os contratos da empresa. */
const SUPPORT: Sector[] = ['inteligencia_comercial', 'financeiro', 'juridico', 'sucesso_cliente', 'diretoria', 'administracao', 'implantacao'];
export const hasSector = (auth: AuthContext, list: readonly Sector[]) => isAdmin(auth) || auth.sectors.some((x) => list.includes(x));

/** Quem vê o contrato: nível do módulo pelo responsável comercial/operacional/CSM, ou setor de apoio. */
export function contractScope(auth: AuthContext): SQL {
  const l = level(auth, 'contratos');
  const base = eq(s.contracts.tenantId, auth.tenantId);
  if (l === 'nenhum') return sql`false`;
  if (l === 'total' || auth.sectors.some((x) => SUPPORT.includes(x))) return base;
  const ids = l === 'equipe' ? auth.teamMemberIds : [auth.userId];
  return and(base, or(inArray(s.contracts.commercialOwnerId, ids), inArray(s.contracts.operationalOwnerId, ids), inArray(s.contracts.csmId, ids)))!;
}

export async function loadContract(db: DbOrTx, auth: AuthContext, id: string) {
  const [c] = await db.select().from(s.contracts).where(and(eq(s.contracts.id, id), contractScope(auth))).limit(1);
  if (!c) throw notFound('Contrato não encontrado.');
  return c;
}
export async function currentVersion(db: DbOrTx, c: Pick<ContractRow, 'id' | 'currentVersion'>) {
  const [v] = await db.select().from(s.contractVersions).where(and(eq(s.contractVersions.contractId, c.id), eq(s.contractVersions.version, c.currentVersion))).limit(1);
  return v!;
}

/** Quem pode concluir a etapa: gerência, setor da etapa, ou o responsável do contrato no papel correspondente. */
export async function assertCanDoStep(db: DbOrTx, auth: AuthContext, c: ContractRow, step: StepDef) {
  if (hasSector(auth, step.sectors)) return;
  if (step.sectors.includes('comercial') && c.commercialOwnerId === auth.userId) return;
  if (step.sectors.includes('implantacao') && c.operationalOwnerId === auth.userId) return;
  if (step.sectors.includes('sucesso_cliente') && c.csmId === auth.userId) return;
  // ninguém na empresa tem o setor ainda: quem tem o módulo em nível Total pode concluir
  const holders = await usersBySector(db, auth.tenantId, step.sectors);
  if (!holders.length && level(auth, 'contratos') === 'total') return;
  throw forbidden(`Esta etapa é do setor ${step.sectors.map((x) => SECTOR_LABELS[x]).join(' ou ')}.`);
}

export async function usersBySector(db: DbOrTx, tenantId: string, sectors: readonly Sector[]) {
  if (!sectors.length) return [];
  return db
    .select({ id: s.users.id, name: s.users.name, email: s.users.email })
    .from(s.users)
    .where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true), sql`${s.users.sectors} && ${sql.raw(`ARRAY[${sectors.map((x) => `'${x}'`).join(',')}]::text[]`)}`))
    .orderBy(asc(s.users.name));
}
export async function userById(db: DbOrTx, tenantId: string, id: string | null) {
  if (!id) return null;
  const [u] = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, active: s.users.active }).from(s.users).where(and(eq(s.users.id, id), eq(s.users.tenantId, tenantId))).limit(1);
  return u?.active ? u : null;
}

// ------------------------------------------------------------------ histórico
export async function addEvent(db: DbOrTx, tenantId: string, contractId: string, actorId: string | null, type: string, summary: string, payload: Record<string, unknown> | null = null) {
  await db.insert(s.contractEvents).values({ tenantId, contractId, actorId, type, summary: summary.slice(0, 500), payload });
}

export type VersionPatch = Partial<Omit<VersionRow, 'id' | 'tenantId' | 'contractId' | 'version' | 'createdAt' | 'createdBy' | 'changeKind' | 'reason'>>;
/** Nova versão = cópia da atual + mudanças (INSERT). A anterior continua intacta. */
export async function newVersion(db: DbOrTx, c: ContractRow, actorId: string | null, patch: VersionPatch, changeKind: VersionRow['changeKind'], reason: string) {
  const cur = await currentVersion(db, c);
  const { id: _i, createdAt: _c, version: _v, createdBy: _b, changeKind: _k, reason: _r, ...keep } = cur;
  const changed = Object.entries(patch).filter(([k, v]) => v !== undefined && JSON.stringify(v) !== JSON.stringify((cur as Record<string, unknown>)[k])).map(([k]) => k);
  if (!changed.length) return { version: cur.version, changed };
  const next = cur.version + 1;
  const values = { ...keep, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), version: next, changeKind, reason, createdBy: actorId };
  await db.insert(s.contractVersions).values(values as typeof s.contractVersions.$inferInsert);
  await db.update(s.contracts).set({ currentVersion: next, updatedAt: new Date(), rowVersion: sql`${s.contracts.rowVersion} + 1` }).where(eq(s.contracts.id, c.id));
  await addEvent(db, c.tenantId, c.id, actorId, 'versao', `Versão ${next} (${changeKind}): ${reason}`, { version: next, changed });
  return { version: next, changed };
}

export async function setStage(db: DbOrTx, c: ContractRow, actorId: string | null, stage: ContractRow['stage'], reason: string) {
  if (c.stage === stage) return;
  await db.update(s.contracts).set({ stage, stageChangedAt: new Date(), updatedAt: new Date(), rowVersion: sql`${s.contracts.rowVersion} + 1` }).where(eq(s.contracts.id, c.id));
  await addEvent(db, c.tenantId, c.id, actorId, 'etapa', `Etapa: ${reason}`, { from: c.stage, to: stage });
  c.stage = stage;
}

// ------------------------------------------------------------------ tarefas e e-mails
export async function createTask(db: DbOrTx, c: Pick<ContractRow, 'id' | 'tenantId' | 'contactId'>, ownerId: string, title: string, notes: string, dueAt: Date, actorId: string | null, priority: 'baixa' | 'media' | 'alta' = 'media') {
  const [a] = await db.insert(s.activities).values({ tenantId: c.tenantId, type: 'tarefa', title: title.slice(0, 200), notes, dueAt, priority, ownerId, contactId: c.contactId, contractId: c.id, createdBy: actorId }).returning({ id: s.activities.id });
  await db.insert(s.activityEvents).values({ tenantId: c.tenantId, activityId: a!.id, type: 'created', actorId, payload: { contrato: c.id } });
  return a!.id;
}

/** Responsáveis por um setor; se ninguém tiver o setor, cai no responsável indicado. */
export async function sectorOwners(db: DbOrTx, tenantId: string, sectors: readonly Sector[], fallbackIds: (string | null)[]) {
  const list = await usersBySector(db, tenantId, sectors);
  if (list.length) return list;
  const out = [];
  for (const id of [...new Set(fallbackIds.filter(Boolean))]) { const u = await userById(db, tenantId, id); if (u) out.push(u); }
  return out;
}

export async function mailTo(db: DbOrTx, c: Pick<ContractRow, 'id' | 'tenantId'>, kind: string, to: string, subject: string, text: string, actorId: string | null, extra: { cc?: string | null; attachments?: { filename: string; content: Buffer; contentType: string }[] } = {}) {
  const r = await sendAlert(db, { tenantId: c.tenantId, kind, to, subject, text, contractId: c.id, createdBy: actorId, cc: extra.cc ?? null, attachments: extra.attachments });
  const status = r?.ok ? 'enviado' : r && 'notConfigured' in r && r.notConfigured ? 'nao_configurado' : 'falhou';
  return { to, status, error: r && !r.ok ? r.error : null };
}

// ------------------------------------------------------------------ resumo para telas e e-mails
export async function contractSummary(db: DbOrTx, c: ContractRow, config: Config) {
  const v = await currentVersion(db, c);
  const [contact] = await db.select({ name: s.contacts.name, document: s.contacts.document, email: s.contacts.email, phone: s.contacts.phone, segment: s.contacts.segment }).from(s.contacts).where(eq(s.contacts.id, c.contactId)).limit(1);
  const owner = await userById(db, c.tenantId, c.commercialOwnerId);
  const lines = [
    `Contrato nº ${v.number} (CT-${c.code})`,
    `Cliente: ${contact?.name ?? ''}${contact?.document ? ` · ${contact.document}` : ''}`,
    `Objeto: ${v.object}`,
    `Vigência: ${v.startAt ?? '—'} a ${v.endAt ?? '—'}${v.termMonths ? ` (${v.termMonths} meses)` : ''}`,
    `Assinatura: ${v.signedAt ?? '—'} · Ativação técnica: ${v.activationAt ?? 'pendente'} · Início do faturamento: ${v.billingStartAt ?? 'pendente'}`,
    `Valor mensal: ${brl(v.monthlyCents)}${v.totalCents ? ` · Valor global: ${brl(v.totalCents)}` : ''}`,
    v.billingDay ? `Dia de faturamento: ${v.billingDay}` : null,
    v.billingTerms ? `Condições de faturamento: ${v.billingTerms}` : null,
    v.items.length ? `Itens:\n${v.items.map((i) => `- ${i.qty} × ${i.description}: ${brl(i.unitCents)} (total ${brl(i.qty * i.unitCents)})`).join('\n')}` : null,
    `Responsável comercial: ${owner?.name ?? '—'}`,
    c.erpRef ? `Referência no ERP: ${c.erpRef}` : 'ERP: cadastro pendente',
    `Abrir no ISP Sprint: ${publicLink(config, `/contracts/${c.id}`)}`,
  ].filter(Boolean);
  return { v, contact, owner, text: lines.join('\n') };
}

// ------------------------------------------------------------------ processos
export async function openProcess(db: DbOrTx, c: ContractRow, kind: ProcessKind, cycleKey: string, actorId: string | null, data: Record<string, unknown> = {}, dueAt: string | null = null, ownerId: string | null = null) {
  const [exists] = await db.select().from(s.contractProcesses).where(and(eq(s.contractProcesses.contractId, c.id), eq(s.contractProcesses.kind, kind), eq(s.contractProcesses.cycleKey, cycleKey))).limit(1);
  if (exists) return { process: exists, created: false };
  const [p] = await db.insert(s.contractProcesses).values({ tenantId: c.tenantId, contractId: c.id, kind, cycleKey, data, dueAt, ownerId: ownerId ?? c.commercialOwnerId, openedBy: actorId }).onConflictDoNothing().returning();
  if (!p) return { process: (await db.select().from(s.contractProcesses).where(and(eq(s.contractProcesses.contractId, c.id), eq(s.contractProcesses.kind, kind), eq(s.contractProcesses.cycleKey, cycleKey))).limit(1))[0]!, created: false };
  await addEvent(db, c.tenantId, c.id, actorId, 'processo_aberto', `Processo de ${kind} aberto${dueAt ? ` (prazo ${dueAt})` : ''}`, { processId: p.id, kind, cycleKey });
  return { process: p, created: true };
}

export const stepsOf = (kind: ProcessKind, contractKind: string) => processSteps(kind, contractKind as ContractKind);
export function pendingRequired(p: { kind: string; steps: Record<string, unknown> }, contractKind: string) {
  return stepsOf(p.kind as ProcessKind, contractKind).filter((d) => !d.optional && !p.steps[d.key]);
}

/** Quais contratos o usuário tem em aberto (pendências) — usado no painel e na ficha. */
export async function openPendencies(db: DbOrTx, contractIds: string[]) {
  if (!contractIds.length) return new Map<string, { alerts: number; overdue: number; steps: number }>();
  const today = new Date().toISOString().slice(0, 10);
  const alerts = await db.select({ contractId: s.contractAlerts.contractId, dueAt: s.contractAlerts.dueAt }).from(s.contractAlerts).where(and(inArray(s.contractAlerts.contractId, contractIds), eq(s.contractAlerts.status, 'aberto')));
  const procs = await db.select({ contractId: s.contractProcesses.contractId, kind: s.contractProcesses.kind, steps: s.contractProcesses.steps, contractKind: s.contracts.kind }).from(s.contractProcesses).innerJoin(s.contracts, eq(s.contracts.id, s.contractProcesses.contractId)).where(and(inArray(s.contractProcesses.contractId, contractIds), eq(s.contractProcesses.status, 'aberto')));
  const m = new Map<string, { alerts: number; overdue: number; steps: number }>();
  const get = (id: string) => m.get(id) ?? (m.set(id, { alerts: 0, overdue: 0, steps: 0 }), m.get(id)!);
  for (const a of alerts) { const x = get(a.contractId); x.alerts++; if (a.dueAt && a.dueAt < today) x.overdue++; }
  for (const p of procs) get(p.contractId).steps += pendingRequired(p, p.contractKind).length;
  return m;
}

export const notArchived = () => sql`${s.contracts.stage} <> 'arquivado'`;
export const notDeleted = () => isNull(s.contractDocuments.deletedAt);
