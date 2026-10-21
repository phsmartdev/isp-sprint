/**
 * ABM Fase 5 — Plays: biblioteca (9 modelos copiados para a empresa), construtor versionado, sugestões justificadas
 * por conta e por pessoa, e execução em que cada etapa é uma tarefa real do módulo de Tarefas.
 * Sugestões só leem as avaliações humanas (influência, posicionamento…); nada aqui as altera.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  COMMERCIAL_STATUSES, INFLUENCE_LEVELS, PLAY_ASSIGNEES, PLAY_CATEGORIES, PLAY_GAPS, PLAY_STEP_TYPES, PLAY_TEMPLATES, RELATIONSHIP_STRENGTHS, STAKEHOLDER_ROLES, STANCES,
  atLeast, planSteps, runProgress, suggestPlays, validatePlay,
  type InfluenceLevel, type PlayDefinition, type RelationshipStrength, type RunStepStatus, type StakeholderRole, type Stance,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { assertAssignableUser, level, ownerScope } from '../services/scope';
import { dueAtOf } from '../services/projects';
import { applyStatus, taskEvent } from '../services/tasks';
import { factsOf, emptyFacts } from './abm';
import { abmPolicy, assertAccount, canViewInfluence, stakeholderRows } from './stakeholders';

/** JSON com chaves ordenadas (o jsonb reordena as chaves ao gravar). */
const canonical = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const canManage = (auth: AuthContext) => atLeast(level(auth, 'clientes'), 'equipe');
const todayOf = (auth: AuthContext) => new Intl.DateTimeFormat('en-CA', { timeZone: auth.timezone }).format(new Date());
const abmEvent = (db: DbOrTx, auth: AuthContext, abmId: string, type: string, payload: Record<string, unknown>) => db.insert(s.abmEvents).values({ tenantId: auth.tenantId, abmId, type, payload, actorId: auth.userId });

const StepBody = z.object({ key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/), title: z.string().trim().min(3).max(200), type: z.enum(PLAY_STEP_TYPES), dayOffset: z.number().int(), assignee: z.enum(PLAY_ASSIGNEES), instructions: z.string().trim().max(2000).default('') });
const AudienceBody = z.object({
  target: z.enum(['conta', 'stakeholder']),
  commercial: z.array(z.enum(COMMERCIAL_STATUSES)).max(7).optional(), nature: z.array(z.enum(['publica', 'privada'])).max(2).optional(), gaps: z.array(z.enum(PLAY_GAPS)).max(3).optional(),
  contractEndingDays: z.number().int().min(1).max(730).nullable().optional(),
  roles: z.array(z.enum(STAKEHOLDER_ROLES)).max(11).optional(), stances: z.array(z.enum(STANCES)).max(6).optional(), minInfluence: z.enum(INFLUENCE_LEVELS).exclude(['nao_avaliado']).nullable().optional(),
  relationship: z.array(z.enum(RELATIONSHIP_STRENGTHS)).max(5).optional(),
});
const DefinitionBody = z.object({ steps: z.array(StepBody).min(1).max(30), successCriteria: z.string().trim().max(500), audience: AudienceBody });
const PlayBody = z.object({ name: z.string().trim().min(3).max(120), category: z.enum(PLAY_CATEGORIES), objective: z.string().trim().max(500).default(''), definition: DefinitionBody });

function checkPlay(b: z.infer<typeof PlayBody>) {
  const errs = validatePlay({ name: b.name, ...(b.definition as PlayDefinition) });
  if (errs.length) throw unprocessable(errs[0]!, errs.map((m) => ({ path: 'definition', message: m })));
}

/** Copia os modelos que a empresa ainda não tem (idempotente). */
async function ensureTemplates(db: DbOrTx, auth: AuthContext) {
  const have = await db.select({ k: s.abmPlays.templateKey }).from(s.abmPlays).where(eq(s.abmPlays.tenantId, auth.tenantId));
  const known = new Set(have.map((h) => h.k));
  for (const t of PLAY_TEMPLATES.filter((x) => !known.has(x.key))) {
    const [p] = await db.insert(s.abmPlays).values({ tenantId: auth.tenantId, templateKey: t.key, name: t.name, category: t.category, objective: t.objective, target: t.audience.target, createdBy: null }).onConflictDoNothing().returning({ id: s.abmPlays.id });
    if (p) await db.insert(s.abmPlayVersions).values({ tenantId: auth.tenantId, playId: p.id, version: 1, definition: { steps: t.steps, successCriteria: t.successCriteria, audience: t.audience }, note: 'Modelo inicial do RevOps', createdBy: null });
  }
}

async function playsWithDefinition(db: DbOrTx, tenantId: string, ids?: string[]) {
  const rows = await db.select({ p: s.abmPlays, def: s.abmPlayVersions.definition }).from(s.abmPlays)
    .innerJoin(s.abmPlayVersions, and(eq(s.abmPlayVersions.playId, s.abmPlays.id), eq(s.abmPlayVersions.version, s.abmPlays.currentVersion)))
    .where(and(eq(s.abmPlays.tenantId, tenantId), ids ? inArray(s.abmPlays.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) : sql`true`)).orderBy(asc(s.abmPlays.name));
  return rows.map((r) => ({ ...r.p, definition: r.def }));
}

/** Execuções com etapas (situação lida da tarefa: fonte única) e andamento. */
async function runsDetail(db: DbOrTx, auth: AuthContext, where: ReturnType<typeof and>) {
  const runs = await db.select({ r: s.abmPlayRuns, play: s.abmPlays.name, category: s.abmPlays.category, owner: s.users.name, account: s.contacts.name, person: s.people.name })
    .from(s.abmPlayRuns).innerJoin(s.abmPlays, eq(s.abmPlays.id, s.abmPlayRuns.playId)).innerJoin(s.users, eq(s.users.id, s.abmPlayRuns.ownerId)).innerJoin(s.contacts, eq(s.contacts.id, s.abmPlayRuns.contactId))
    .leftJoin(s.accountStakeholders, eq(s.accountStakeholders.id, s.abmPlayRuns.stakeholderId)).leftJoin(s.people, eq(s.people.id, s.accountStakeholders.personId))
    .where(where).orderBy(desc(s.abmPlayRuns.createdAt)).limit(300);
  if (!runs.length) return [];
  const steps = await db.select({ runId: s.abmPlayRunSteps.runId, position: s.abmPlayRunSteps.position, stepKey: s.abmPlayRunSteps.stepKey, activityId: s.activities.id, title: s.activities.title, type: s.activities.type, status: s.activities.status, deletedAt: s.activities.deletedAt, ownerName: s.users.name,
    dueOn: sql<string>`to_char(${s.activities.dueAt} at time zone ${auth.timezone}, 'YYYY-MM-DD')` })
    .from(s.abmPlayRunSteps).innerJoin(s.activities, eq(s.activities.id, s.abmPlayRunSteps.activityId)).innerJoin(s.users, eq(s.users.id, s.activities.ownerId))
    .where(inArray(s.abmPlayRunSteps.runId, runs.map((r) => r.r.id))).orderBy(asc(s.abmPlayRunSteps.position));
  const today = todayOf(auth);
  return runs.map(({ r, ...x }) => {
    const st = steps.filter((p) => p.runId === r.id).map((p) => ({ ...p, stepStatus: (p.deletedAt || p.status === 'cancelada' ? 'cancelada' : p.status === 'concluida' ? 'concluida' : 'pendente') as RunStepStatus }));
    return { ...r, playName: x.play, category: x.category, ownerName: x.owner, account: x.account, stakeholderName: x.person, steps: st, progress: runProgress(st.map((p) => ({ status: p.stepStatus, dueOn: p.dueOn ?? today })), today) };
  });
}

async function loadRun(db: DbOrTx, auth: AuthContext, id: string) {
  const [r] = await db.select().from(s.abmPlayRuns).where(and(eq(s.abmPlayRuns.id, id), eq(s.abmPlayRuns.tenantId, auth.tenantId))).limit(1).for('update');
  if (!r) throw notFound('Execução de play não encontrada.');
  await assertAccount(db, auth, r.contactId);
  return r;
}
async function assertCanCloseRun(db: DbOrTx, auth: AuthContext, r: typeof s.abmPlayRuns.$inferSelect) {
  if (r.ownerId === auth.userId || canManage(auth)) return;
  const [a] = await db.select({ ownerId: s.abmAccounts.ownerId }).from(s.abmAccounts).where(eq(s.abmAccounts.id, r.abmId)).limit(1);
  if (a?.ownerId !== auth.userId) throw forbidden('Só quem conduz o play, o responsável pela conta ou a liderança encerra a execução.');
}

/** Contexto da conta para sugestões: status comercial, natureza, vencimento do contrato e stakeholders (só leitura). */
async function accountContext(db: DbOrTx, auth: AuthContext, contactId: string) {
  const [c] = await db.select({ nature: s.contacts.nature }).from(s.contacts).where(eq(s.contacts.id, contactId)).limit(1);
  const facts = (await factsOf(db, auth, [contactId])).get(contactId) ?? emptyFacts();
  const end = await db.execute<{ d: number | null }>(sql`
    select min(v.end_at - (now() at time zone ${auth.timezone})::date)::int as d from contracts k
    join contract_versions v on v.contract_id = k.id and v.version = k.current_version
    where k.contact_id = ${contactId} and k.stage in ('implantacao', 'vigente', 'renovacao', 'reajuste') and v.end_at is not null and v.end_at >= (now() at time zone ${auth.timezone})::date`);
  const pol = await abmPolicy(db, auth.tenantId);
  const people = await stakeholderRows(db, auth, [contactId], pol.influence);
  const running = await db.select({ playId: s.abmPlayRuns.playId, st: s.abmPlayRuns.stakeholderId }).from(s.abmPlayRuns).where(and(eq(s.abmPlayRuns.contactId, contactId), eq(s.abmPlayRuns.status, 'em_andamento')));
  return {
    commercial: facts.commercial, nature: (c?.nature ?? null) as 'publica' | 'privada' | null, nextContractEndDays: end.rows[0]?.d ?? null,
    influenceVisible: canViewInfluence(auth, pol.influence),
    stakeholders: people.map((p) => ({ id: p.id, name: p.name, roles: p.roles as StakeholderRole[], stance: p.stance as Stance, influence: p.influence as InfluenceLevel | null, relationship: p.relationshipStrength as RelationshipStrength, active: p.active, relationshipOwnerId: p.relationshipOwnerId })),
    running: new Set(running.map((x) => `${x.playId}:${x.st ?? ''}`)),
  };
}

export const abmPlayRoutes = [
  // ------------------------------------------------------------ biblioteca e construtor
  defineRoute({
    method: 'GET', url: '/abm/plays', summary: 'Biblioteca de plays do ABM (modelos iniciais copiados na primeira consulta) com execuções', tag: 'Marketing', module: 'clientes',
    handler: async ({ app, auth }) => {
      await ensureTemplates(app.db, auth);
      const plays = await playsWithDefinition(app.db, auth.tenantId);
      const stats = await app.db.select({ playId: s.abmPlayRuns.playId, status: s.abmPlayRuns.status, success: s.abmPlayRuns.successAchieved, n: sql<number>`count(*)::int` }).from(s.abmPlayRuns).where(eq(s.abmPlayRuns.tenantId, auth.tenantId)).groupBy(s.abmPlayRuns.playId, s.abmPlayRuns.status, s.abmPlayRuns.successAchieved);
      const sum = (id: string, f: (x: (typeof stats)[number]) => boolean) => stats.filter((x) => x.playId === id && f(x)).reduce((a, x) => a + x.n, 0);
      return {
        canManage: canManage(auth),
        items: plays.map((p) => ({ ...p, running: sum(p.id, (x) => x.status === 'em_andamento'), concluded: sum(p.id, (x) => x.status === 'concluido'), succeeded: sum(p.id, (x) => x.status === 'concluido' && x.success === true) })),
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/abm/plays/:id', summary: 'Play com todas as versões da definição', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const [p] = await playsWithDefinition(app.db, auth.tenantId, [params.id]);
      if (!p) throw notFound('Play não encontrado.');
      const versions = await app.db.select({ v: s.abmPlayVersions, by: s.users.name }).from(s.abmPlayVersions).leftJoin(s.users, eq(s.users.id, s.abmPlayVersions.createdBy)).where(eq(s.abmPlayVersions.playId, p.id)).orderBy(desc(s.abmPlayVersions.version));
      return { ...p, canManage: canManage(auth), versions: versions.map((x) => ({ ...x.v, createdByName: x.by ?? 'RevOps' })) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/abm/plays', summary: 'Cria play (do zero ou a partir de outro) — versão 1', tag: 'Marketing', module: 'clientes', min: 'equipe', body: PlayBody,
    handler: async ({ app, auth, body, reply }) => {
      checkPlay(body);
      const id = await app.db.transaction(async (tx) => {
        const [p] = await tx.insert(s.abmPlays).values({ tenantId: auth.tenantId, name: body.name, category: body.category, objective: body.objective, target: body.definition.audience.target, createdBy: auth.userId }).onConflictDoNothing().returning({ id: s.abmPlays.id });
        if (!p) throw unprocessable('Já existe um play com este nome.', [{ path: 'name', message: 'Escolha outro nome' }]);
        await tx.insert(s.abmPlayVersions).values({ tenantId: auth.tenantId, playId: p.id, version: 1, definition: body.definition as PlayDefinition, note: 'Criação', createdBy: auth.userId });
        return p.id;
      });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/abm/plays/:id', summary: 'Edita o play; mudança na definição gera nova versão (execuções em andamento seguem a versão em que começaram)', tag: 'Marketing', module: 'clientes', min: 'equipe', params: IdParams,
    body: PlayBody.extend({ rowVersion: z.number().int(), note: z.string().trim().min(3).max(300) }),
    handler: async ({ app, auth, params, body }) => {
      checkPlay(body);
      return app.db.transaction(async (tx) => {
        const [p] = await playsWithDefinition(tx, auth.tenantId, [params.id]);
        if (!p) throw notFound('Play não encontrado.');
        if (p.rowVersion !== body.rowVersion) throw conflict(p.rowVersion);
        const changedDef = canonical(p.definition) !== canonical(body.definition);
        const version = changedDef ? p.currentVersion + 1 : p.currentVersion;
        if (changedDef) await tx.insert(s.abmPlayVersions).values({ tenantId: auth.tenantId, playId: p.id, version, definition: body.definition as PlayDefinition, note: body.note, createdBy: auth.userId });
        const [dup] = await tx.select({ id: s.abmPlays.id }).from(s.abmPlays).where(and(eq(s.abmPlays.tenantId, auth.tenantId), eq(s.abmPlays.name, body.name), sql`${s.abmPlays.id} <> ${p.id}`)).limit(1);
        if (dup) throw unprocessable('Já existe um play com este nome.', [{ path: 'name', message: 'Escolha outro nome' }]);
        await tx.update(s.abmPlays).set({ name: body.name, category: body.category, objective: body.objective, target: body.definition.audience.target, currentVersion: version, rowVersion: p.rowVersion + 1, updatedAt: new Date() }).where(eq(s.abmPlays.id, p.id));
        return { version };
      });
    },
  }),
  defineRoute({
    method: 'POST', url: '/abm/plays/:id/active', summary: 'Ativa ou desativa o play (desativado não é sugerido nem aplicado; execuções seguem)', tag: 'Marketing', module: 'clientes', min: 'equipe', params: IdParams,
    body: z.object({ active: z.boolean() }),
    handler: async ({ app, auth, params, body }) => {
      const r = await app.db.update(s.abmPlays).set({ active: body.active, updatedAt: new Date(), rowVersion: sql`${s.abmPlays.rowVersion} + 1` }).where(and(eq(s.abmPlays.id, params.id), eq(s.abmPlays.tenantId, auth.tenantId))).returning({ id: s.abmPlays.id });
      if (!r.length) throw notFound('Play não encontrado.');
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------ na conta: sugestões e execuções
  defineRoute({
    method: 'GET', url: '/accounts/:id/plays', summary: 'Plays da conta: sugestões com motivos, execuções e plays disponíveis', tag: 'Marketing', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      await assertAccount(app.db, auth, params.id);
      await ensureTemplates(app.db, auth);
      const [abm] = await app.db.select({ id: s.abmAccounts.id }).from(s.abmAccounts).where(and(eq(s.abmAccounts.contactId, params.id), eq(s.abmAccounts.tenantId, auth.tenantId))).limit(1);
      const plays = (await playsWithDefinition(app.db, auth.tenantId)).filter((p) => p.active);
      const ctx = await accountContext(app.db, auth, params.id);
      const suggestions = abm ? suggestPlays(plays.map((p) => ({ id: p.id, name: p.name, category: p.category as never, audience: p.definition.audience, active: p.active })), ctx) : [];
      return {
        inAbm: !!abm, suggestions, influenceVisible: ctx.influenceVisible,
        plays: plays.map((p) => ({ id: p.id, name: p.name, category: p.category, target: p.target, objective: p.objective, successCriteria: p.definition.successCriteria, steps: p.definition.steps })),
        stakeholders: ctx.stakeholders.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name })),
        runs: await runsDetail(app.db, auth, and(eq(s.abmPlayRuns.tenantId, auth.tenantId), eq(s.abmPlayRuns.contactId, params.id))),
      };
    },
  }),
  defineRoute({
    method: 'POST', url: '/accounts/:id/play-runs', summary: 'Aplica um play à conta (ou a uma pessoa): cada etapa vira tarefa com prazo e responsável', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ playId: z.string().uuid(), stakeholderId: z.string().uuid().nullable().default(null), ownerId: z.string().uuid().optional(), startOn: isoDate, reason: z.string().trim().min(5).max(1000), fromSuggestion: z.boolean().default(false) }),
    handler: async ({ app, auth, params, body, reply }) => {
      const acc = await assertAccount(app.db, auth, params.id);
      const ownerId = body.ownerId ?? auth.userId;
      await assertAssignableUser(app.db, auth, 'clientes', ownerId);
      const id = await app.db.transaction(async (tx) => {
        const [abm] = await tx.select().from(s.abmAccounts).where(and(eq(s.abmAccounts.contactId, params.id), eq(s.abmAccounts.tenantId, auth.tenantId))).limit(1);
        if (!abm) throw unprocessable('Adicione a conta ao ABM antes de aplicar um play.');
        const [p] = await playsWithDefinition(tx, auth.tenantId, [body.playId]);
        if (!p || !p.active) throw unprocessable('Play não encontrado ou desativado.', [{ path: 'playId', message: 'Escolha um play ativo' }]);
        const def = p.definition;
        let person: { id: string; name: string; relationshipOwnerId: string | null } | null = null;
        if (def.audience.target === 'stakeholder') {
          if (!body.stakeholderId) throw unprocessable('Este play é para uma pessoa: escolha o stakeholder.', [{ path: 'stakeholderId', message: 'Escolha a pessoa' }]);
          const [st] = await tx.select({ id: s.accountStakeholders.id, name: s.people.name, relationshipOwnerId: s.accountStakeholders.relationshipOwnerId, active: s.accountStakeholders.active }).from(s.accountStakeholders).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId))
            .where(and(eq(s.accountStakeholders.id, body.stakeholderId), eq(s.accountStakeholders.contactId, params.id))).limit(1);
          if (!st || !st.active) throw unprocessable('Pessoa não encontrada nesta conta.', [{ path: 'stakeholderId', message: 'Escolha uma pessoa ativa da conta' }]);
          person = st;
        } else if (body.stakeholderId) throw unprocessable('Este play é para a conta, não para uma pessoa.');
        const [run] = await tx.insert(s.abmPlayRuns).values({ tenantId: auth.tenantId, playId: p.id, playVersion: p.currentVersion, abmId: abm.id, contactId: params.id, stakeholderId: person?.id ?? null, ownerId, startOn: body.startOn, reason: body.reason, fromSuggestion: body.fromSuggestion, createdBy: auth.userId })
          .onConflictDoNothing().returning({ id: s.abmPlayRuns.id });
        if (!run) throw unprocessable(person ? `O play "${p.name}" já está em andamento para ${person.name}.` : `O play "${p.name}" já está em andamento nesta conta.`);
        const who = (a: string) => (a === 'responsavel_conta' ? abm.ownerId : a === 'responsavel_relacionamento' ? person?.relationshipOwnerId ?? ownerId : ownerId);
        const planned = planSteps(def.steps, body.startOn);
        for (const [i, st] of planned.entries()) {
          const owner = who(st.assignee);
          const notes = [st.instructions, '', `Play: ${p.name} (versão ${p.currentVersion}) · ${acc.name}${person ? ` · ${person.name}` : ''}`, p.objective && `Objetivo: ${p.objective}`, `Critério de sucesso: ${def.successCriteria}`].filter((x) => x !== '' && x !== null).join('\n');
          const [a] = await tx.insert(s.activities).values({
            tenantId: auth.tenantId, type: st.type, title: person ? `${st.title} — ${person.name}` : st.title, notes, priority: 'media', ownerId: owner, createdBy: auth.userId, contactId: params.id,
            dueAt: dueAtOf(auth, st.dueOn) as unknown as Date, status: 'a_fazer', category: 'Play ABM', tags: ['abm', 'play'], participants: owner === ownerId ? [] : [ownerId],
          }).returning({ id: s.activities.id });
          await taskEvent(tx, auth, a!.id, 'created', { delegatedTo: owner !== auth.userId ? owner : null, playRunId: run.id });
          await tx.insert(s.abmPlayRunSteps).values({ tenantId: auth.tenantId, runId: run.id, stepKey: st.key, position: i, activityId: a!.id });
        }
        await abmEvent(tx, auth, abm.id, 'play_iniciado', { runId: run.id, play: p.name, version: p.currentVersion, stakeholder: person?.name ?? null, reason: body.reason, fromSuggestion: body.fromSuggestion, steps: planned.length });
        if (person) await tx.insert(s.stakeholderEvents).values({ tenantId: auth.tenantId, stakeholderId: person.id, type: 'play_iniciado', payload: { runId: run.id, play: p.name }, actorId: auth.userId });
        return run.id;
      });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'GET', url: '/abm/play-runs', summary: 'Execuções de plays nas contas visíveis (em andamento por padrão)', tag: 'Marketing', module: 'clientes',
    query: z.object({ status: z.enum(['em_andamento', 'concluido', 'cancelado']).default('em_andamento'), mine: z.enum(['0', '1']).default('0') }),
    handler: async ({ app, auth, query: q }) => {
      const ok = (await app.db.select({ id: s.contacts.id }).from(s.abmAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.abmAccounts.contactId))
        .where(and(eq(s.abmAccounts.tenantId, auth.tenantId), ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt })))).map((v) => v.id);
      if (!ok.length) return { items: [] };
      return { items: await runsDetail(app.db, auth, and(eq(s.abmPlayRuns.tenantId, auth.tenantId), eq(s.abmPlayRuns.status, q.status), inArray(s.abmPlayRuns.contactId, ok), q.mine === '1' ? eq(s.abmPlayRuns.ownerId, auth.userId) : sql`true`)) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/play-runs/:id/conclude', summary: 'Encerra a execução com o resultado (exige etapas concluídas ou canceladas)', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ outcome: z.string().trim().min(10).max(2000), successAchieved: z.boolean() }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const r = await loadRun(tx, auth, params.id);
      if (r.status !== 'em_andamento') throw unprocessable('Esta execução já foi encerrada.');
      await assertCanCloseRun(tx, auth, r);
      const [d] = await runsDetail(tx, auth, eq(s.abmPlayRuns.id, r.id));
      if (!d!.progress.canConclude) throw unprocessable(d!.progress.open ? `Ainda há ${d!.progress.open} etapa(s) em aberto: conclua ou cancele as tarefas antes.` : 'Conclua pelo menos uma etapa antes de encerrar.');
      await tx.update(s.abmPlayRuns).set({ status: 'concluido', outcome: body.outcome, successAchieved: body.successAchieved, closedAt: new Date(), closedBy: auth.userId, rowVersion: r.rowVersion + 1, updatedAt: new Date() }).where(eq(s.abmPlayRuns.id, r.id));
      await abmEvent(tx, auth, r.abmId, 'play_concluido', { runId: r.id, play: d!.playName, outcome: body.outcome, successAchieved: body.successAchieved });
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/play-runs/:id/cancel', summary: 'Cancela a execução (motivo obrigatório); tarefas em aberto são canceladas', tag: 'Marketing', module: 'clientes', params: IdParams,
    body: z.object({ reason: z.string().trim().min(10).max(1000) }),
    handler: async ({ app, auth, params, body }) => app.db.transaction(async (tx) => {
      const r = await loadRun(tx, auth, params.id);
      if (r.status !== 'em_andamento') throw unprocessable('Esta execução já foi encerrada.');
      await assertCanCloseRun(tx, auth, r);
      const open = await tx.select().from(s.activities).innerJoin(s.abmPlayRunSteps, eq(s.abmPlayRunSteps.activityId, s.activities.id))
        .where(and(eq(s.abmPlayRunSteps.runId, r.id), sql`${s.activities.deletedAt} is null`, sql`${s.activities.status} not in ('concluida', 'cancelada')`));
      for (const o of open) await applyStatus(tx, auth, o.activities, 'cancelada', { note: `Play cancelado: ${body.reason}` });
      await tx.update(s.abmPlayRuns).set({ status: 'cancelado', outcome: body.reason, closedAt: new Date(), closedBy: auth.userId, rowVersion: r.rowVersion + 1, updatedAt: new Date() }).where(eq(s.abmPlayRuns.id, r.id));
      const [p] = await tx.select({ name: s.abmPlays.name }).from(s.abmPlays).where(eq(s.abmPlays.id, r.playId)).limit(1);
      await abmEvent(tx, auth, r.abmId, 'play_cancelado', { runId: r.id, play: p?.name, reason: body.reason, tasksCanceled: open.length });
      return { ok: true, tasksCanceled: open.length };
    }),
  }),
];
