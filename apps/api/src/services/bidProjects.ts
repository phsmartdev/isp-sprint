/**
 * Projeto de licitação: modelo versionado (o padrão é criado na primeira vez, publicado), criação do projeto a partir
 * de uma cópia da versão publicada e a criação automática pela oportunidade de licitação (uma automática por
 * oportunidade; outras podem ser criadas à mão). O projeto vive no motor de Projetos: etapa = marco, macrotarefa =
 * tarefa, tarefa = subtarefa.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { BID_DEFAULT_MODEL, DEFAULT_PROJECT_STAGES, OFFICIAL_DATES, anchoredDates, instantiateBidModel, type BidModelDef, type OfficialDates, type ProjectTaskSpec } from '@isp/domain';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { dueAtOf, projectEvent, todayLocal } from './projects';

export const BID_TEMPLATE_KEY = 'licitacao';

/** Modelo de licitação da empresa; na primeira vez nasce com o rito padrão já publicado (versão 1). */
export async function ensureBidTemplate(db: DbOrTx, tenantId: string, userId: string | null) {
  const find = async () => (await db.select().from(s.projectTemplates).where(and(eq(s.projectTemplates.tenantId, tenantId), eq(s.projectTemplates.key, BID_TEMPLATE_KEY))).limit(1))[0];
  let t = await find();
  if (t) return upgradeDefaultRite(db, t, userId);
  // dois pedidos ao mesmo tempo não criam dois modelos
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`bid-template:${tenantId}`}))`);
  t = await find();
  if (t) return t;
  const [nt] = await db.insert(s.projectTemplates).values({
    tenantId, name: 'Rito padrão de licitações', description: 'Do cadastro ao resultado: 9 etapas, macrotarefas por área e entregáveis.',
    kind: 'licitacao', def: { stages: DEFAULT_PROJECT_STAGES, milestones: [], tasks: [] }, key: BID_TEMPLATE_KEY, publishedVersion: 1, createdBy: userId,
  }).returning();
  await db.insert(s.projectTemplateVersions).values({ tenantId, templateId: nt!.id, version: 1, status: 'publicado', def: BID_DEFAULT_MODEL, notes: 'Versão inicial do rito padrão', createdBy: userId, publishedAt: new Date(), publishedBy: userId });
  return nt!;
}

/** Rito padrão antigo (11 etapas), reconhecido pelos nomes das etapas: só ele é trocado sozinho. */
const OLD_DEFAULT_PHASES = ['Identificação e abertura', 'Planejamento e mobilização', 'Análise do edital', 'Viabilidade e riscos', 'Decisão Go/No-Go', 'Preparação da proposta', 'Revisão e submissão', 'Sessão pública', 'Diligências e resultado', 'Contratação e transição', 'Encerramento e inteligência'];
const isOldDefault = (def: BidModelDef) => def.phases.length === OLD_DEFAULT_PHASES.length && def.phases.every((p, i) => p.name === OLD_DEFAULT_PHASES[i]);

/**
 * Empresa ainda no rito padrão antigo sem alterações: publica o rito de 9 etapas como nova versão (a anterior é
 * arquivada; projetos já criados seguem com a cópia que receberam). Modelo personalizado não é tocado.
 */
async function upgradeDefaultRite(db: DbOrTx, t: typeof s.projectTemplates.$inferSelect, userId: string | null) {
  const versions = await db.select().from(s.projectTemplateVersions).where(eq(s.projectTemplateVersions.templateId, t.id)).orderBy(desc(s.projectTemplateVersions.version));
  const pub = versions.find((v) => v.version === (t.publishedVersion ?? 1));
  if (!pub || !isOldDefault(pub.def as BidModelDef) || versions.some((v) => v.status === 'rascunho' || v.status === 'em_aprovacao')) return t;
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`bid-template-upgrade:${t.id}`}))`);
  const [again] = await db.select({ pv: s.projectTemplates.publishedVersion }).from(s.projectTemplates).where(eq(s.projectTemplates.id, t.id));
  if ((again?.pv ?? 1) !== pub.version) return t;
  const version = (versions[0]?.version ?? 1) + 1;
  await db.update(s.projectTemplateVersions).set({ status: 'arquivado', updatedAt: new Date() }).where(eq(s.projectTemplateVersions.id, pub.id));
  await db.insert(s.projectTemplateVersions).values({ tenantId: t.tenantId, templateId: t.id, version, status: 'publicado', def: BID_DEFAULT_MODEL, notes: 'Rito padrão atualizado para 9 etapas: cadastro, qualificação e viabilidade, análise do edital e TR pelos setores, reunião do time comercial, lances, documentação, acompanhamento, recurso e resultado.', createdBy: userId, publishedAt: new Date(), publishedBy: userId });
  const [nt] = await db.update(s.projectTemplates).set({ publishedVersion: version, description: 'Do cadastro ao resultado: 9 etapas, macrotarefas por área e entregáveis.' }).where(eq(s.projectTemplates.id, t.id)).returning();
  return nt!;
}

export async function publishedModel(db: DbOrTx, tenantId: string, userId: string | null) {
  const t = await ensureBidTemplate(db, tenantId, userId);
  const [v] = await db.select().from(s.projectTemplateVersions).where(and(eq(s.projectTemplateVersions.templateId, t.id), eq(s.projectTemplateVersions.version, t.publishedVersion ?? 1))).limit(1);
  return { template: t, version: v!.version, def: v!.def as BidModelDef };
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Cria o projeto de licitação da oportunidade a partir da versão publicada do modelo. Devolve null se já havia um automático. */
export async function createBidProject(tx: DbOrTx, auth: AuthContext, oppId: string, opts: { origin: 'auto' | 'manual'; coordinatorId?: string | null; name?: string | null }) {
  const [o] = await tx.select().from(s.opportunities).where(and(eq(s.opportunities.tenantId, auth.tenantId), eq(s.opportunities.id, oppId))).limit(1);
  if (!o) return null;
  const model = await publishedModel(tx, auth.tenantId, auth.userId);
  const custom = (o.custom ?? {}) as Record<string, unknown>;
  const startOn = todayLocal(auth);
  const inst = instantiateBidModel(model.def, startOn);
  // datas que o CRM já tem (sessão, envio da proposta) entram como ponto de partida, ainda não validadas com o edital
  const official: OfficialDates = {};
  for (const d of OFFICIAL_DATES) if ('crmField' in d) { const v = str(custom[d.crmField]); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) official[d.key] = { date: v, validated: false, source: 'CRM' }; }
  for (const t of inst.tasks) { const a = anchoredDates(t, official, 1); if (a && a.dueOn >= startOn) { t.dueOn = a.dueOn; t.startOn = a.startOn < startOn ? startOn : a.startOn; } }
  const coordinatorId = opts.coordinatorId ?? o.ownerId;
  const session = str(custom.data_sessao);
  const [p] = await tx.insert(s.projects).values({
    tenantId: auth.tenantId, name: (opts.name?.trim() || `Licitação · ${o.title}`).slice(0, 160),
    description: str(custom.objeto), kind: 'licitacao', priority: 'alta', ownerId: coordinatorId, startOn,
    dueOn: session && /^\d{4}-\d{2}-\d{2}$/.test(session) && session >= startOn ? session : inst.dueOn,
    contactId: o.contactId, opportunityId: o.id, objective: 'Conduzir a preparação, a participação e o acompanhamento da licitação.',
    templateKey: `custom:${model.template.id}`, templateId: model.template.id, templateVersion: model.version, origin: opts.origin, officialDates: official, createdBy: auth.userId,
  }).onConflictDoNothing().returning({ id: s.projects.id });
  if (!p) return null; // já existe o projeto automático desta oportunidade
  const pid = p.id;
  const members = new Map<string, 'gerente' | 'membro'>([[coordinatorId, 'gerente']]);
  if (auth.userId !== coordinatorId) members.set(auth.userId, 'membro');
  await tx.insert(s.projectMembers).values([...members].map(([userId, role]) => ({ projectId: pid, userId, tenantId: auth.tenantId, role })));
  const stages = await tx.insert(s.projectStages).values(DEFAULT_PROJECT_STAGES.map((st, i) => ({ tenantId: auth.tenantId, projectId: pid, name: st.name, position: i, done: !!st.done }))).returning();
  const firstStage = stages.sort((a, b) => a.position - b.position)[0]!;
  const ms = await tx.insert(s.projectMilestones).values(inst.milestones.map((m) => ({ tenantId: auth.tenantId, projectId: pid, name: m.name, dueOn: m.dueOn, position: m.position, acceptanceCriteria: m.acceptanceCriteria }))).returning({ id: s.projectMilestones.id, position: s.projectMilestones.position });
  const msOf = (phaseKey: string) => ms.find((m) => m.position === inst.milestones.find((x) => x.key === phaseKey)!.position)!.id;
  // as tarefas ficam no projeto (que é ligado à oportunidade): não lotam a lista de tarefas da negociação
  const base = { tenantId: auth.tenantId, type: 'tarefa', ownerId: coordinatorId, projectId: pid, projectStageId: firstStage.id, createdBy: auth.userId };
  const macros = await tx.insert(s.activities).values(inst.tasks.map((t) => ({
    ...base, title: t.name, notes: t.instructions, priority: t.required ? 'alta' : 'media', startOn: t.startOn, dueAt: dueAtOf(auth, t.dueOn) as unknown as Date,
    milestoneId: msOf(t.phaseKey), position: t.position,
    spec: { phaseKey: t.phaseKey, sourceKey: t.key, area: t.area, required: t.required, deliverable: t.deliverable, acceptance: t.acceptance, instructions: t.instructions, anchor: t.anchor, anchorOffsetDays: t.anchorOffsetDays, durationDays: t.durationDays } satisfies ProjectTaskSpec,
  }))).returning({ id: s.activities.id, position: s.activities.position });
  const subs = inst.tasks.flatMap((t) => t.subtasks.map((st, k) => ({
    ...base, title: st.name, priority: 'media', startOn: t.startOn, dueAt: dueAtOf(auth, t.dueOn) as unknown as Date, milestoneId: msOf(t.phaseKey), position: k,
    parentId: macros.find((m) => m.position === t.position)!.id,
    spec: { phaseKey: t.phaseKey, sourceKey: st.key, area: t.area, required: st.required, deliverable: null, acceptance: null, instructions: null } satisfies ProjectTaskSpec,
  })));
  for (let i = 0; i < subs.length; i += 200) await tx.insert(s.activities).values(subs.slice(i, i + 200));
  await projectEvent(tx, auth, pid, 'created', `Projeto de licitação criado ${opts.origin === 'auto' ? 'automaticamente pela oportunidade' : 'pela oportunidade'} a partir do modelo "${model.template.name}" v${model.version} (${inst.milestones.length} etapas, ${inst.tasks.length} macrotarefas, ${subs.length} tarefas)`, { templateId: model.template.id, templateVersion: model.version, origin: opts.origin });
  await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: o.id, type: 'projeto_licitacao', actorId: auth.userId, payload: { projectId: pid, origin: opts.origin, templateVersion: model.version } });
  return pid;
}

/**
 * Depois de criar ou alterar a oportunidade: sendo licitação, garante o projeto automático (sem duplicar);
 * deixando de ser, o projeto não some — fica marcado para a decisão de continuar ou arquivar.
 */
export async function syncBidProject(tx: DbOrTx, auth: AuthContext, oppId: string, isBidNow: boolean) {
  const [auto] = await tx.select({ id: s.projects.id, status: s.projects.status, attention: s.projects.attention }).from(s.projects)
    .where(and(eq(s.projects.tenantId, auth.tenantId), eq(s.projects.opportunityId, oppId), eq(s.projects.origin, 'auto'), isNull(s.projects.deletedAt))).limit(1);
  if (isBidNow) {
    if (!auto) return createBidProject(tx, auth, oppId, { origin: 'auto' });
    if (auto.attention === 'modalidade_alterada') {
      await tx.update(s.projects).set({ attention: null, updatedAt: new Date() }).where(eq(s.projects.id, auto.id));
      await projectEvent(tx, auth, auto.id, 'modalidade', 'A oportunidade voltou a ser licitação: decisão pendente retirada.');
    }
    return auto.id;
  }
  if (auto && !['concluido', 'cancelado'].includes(auto.status) && auto.attention !== 'modalidade_alterada') {
    await tx.update(s.projects).set({ attention: 'modalidade_alterada', updatedAt: new Date() }).where(eq(s.projects.id, auto.id));
    await projectEvent(tx, auth, auto.id, 'modalidade', 'A oportunidade deixou de ser licitação: decidir entre continuar ou arquivar o projeto (o histórico fica preservado).');
  }
  return null;
}

/** Resumo de cada projeto de licitação da oportunidade (para a aba na oportunidade). */
export async function bidProjectsOfOpportunity(db: DbOrTx, auth: AuthContext, oppId: string) {
  const projects = await db.select({ p: s.projects, owner: s.users.name }).from(s.projects).innerJoin(s.users, eq(s.users.id, s.projects.ownerId))
    .where(and(eq(s.projects.tenantId, auth.tenantId), eq(s.projects.opportunityId, oppId), eq(s.projects.kind, 'licitacao'), isNull(s.projects.deletedAt))).orderBy(asc(s.projects.createdAt));
  if (!projects.length) return [];
  const ids = projects.map((x) => x.p.id);
  const today = todayLocal(auth);
  const [tasks, ms, events, pend] = await Promise.all([
    db.select({ projectId: s.activities.projectId, parentId: s.activities.parentId, title: s.activities.title, status: s.activities.status, completedAt: s.activities.completedAt, dueOn: sql<string | null>`to_char(${s.activities.dueAt} at time zone ${auth.timezone}, 'YYYY-MM-DD')`, spec: s.activities.spec, milestoneId: s.activities.milestoneId })
      .from(s.activities).where(and(eq(s.activities.tenantId, auth.tenantId), inArray(s.activities.projectId, ids), isNull(s.activities.deletedAt))),
    db.select().from(s.projectMilestones).where(and(inArray(s.projectMilestones.projectId, ids), isNull(s.projectMilestones.deletedAt))).orderBy(asc(s.projectMilestones.position)),
    db.select({ projectId: s.projectEvents.projectId, type: s.projectEvents.type, summary: s.projectEvents.summary, at: s.projectEvents.occurredAt }).from(s.projectEvents).where(inArray(s.projectEvents.projectId, ids)).orderBy(desc(s.projectEvents.occurredAt)).limit(30),
    db.select({ projectId: s.bidApprovals.projectId, title: s.bidApprovals.title, kind: s.bidApprovals.kind }).from(s.bidApprovals).where(and(inArray(s.bidApprovals.projectId, ids), eq(s.bidApprovals.status, 'aguardando'))),
  ]);
  return projects.map(({ p, owner }) => {
    const tk = tasks.filter((t) => t.projectId === p.id);
    const macros = tk.filter((t) => !t.parentId);
    const open = (t: (typeof tk)[number]) => !t.completedAt && t.status !== 'cancelada';
    const pm = ms.filter((m) => m.projectId === p.id);
    const current = pm.find((m) => !m.completedAt) ?? null;
    const next = pm.filter((m) => !m.completedAt && m.dueOn).sort((a, b) => a.dueOn!.localeCompare(b.dueOn!))[0] ?? null;
    const areas = [...new Set(macros.map((t) => (t.spec as ProjectTaskSpec | null)?.area).filter(Boolean))] as string[];
    return {
      id: p.id, code: p.code, name: p.name, status: p.status, origin: p.origin, attention: p.attention, coordinatorId: p.ownerId, coordinator: owner,
      templateVersion: p.templateVersion, startOn: p.startOn, dueOn: p.dueOn,
      progress: { done: tk.filter((t) => !open(t)).length, total: tk.length },
      currentPhase: current ? { name: current.name, dueOn: current.dueOn, deliverable: current.acceptanceCriteria } : null,
      nextMilestone: next ? { name: next.name, dueOn: next.dueOn } : null,
      pending: macros.filter(open).length,
      late: macros.filter((t) => open(t) && t.dueOn && t.dueOn < today).map((t) => ({ title: t.title, dueOn: t.dueOn, area: (t.spec as ProjectTaskSpec | null)?.area ?? null })).slice(0, 10),
      lateCount: macros.filter((t) => open(t) && t.dueOn && t.dueOn < today).length,
      areas, planStatus: p.planStatus, goDecision: p.goDecision,
      pendingApprovals: pend.filter((a) => a.projectId === p.id).map((a) => ({ title: a.title, kind: a.kind })),
      history: events.filter((e) => e.projectId === p.id).slice(0, 8),
    };
  });
}
