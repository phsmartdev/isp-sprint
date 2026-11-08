/**
 * Data Import Engine — execução. Uma execução anda em passos curtos (a API roda com limite de 30 s por chamada):
 * cada passo pega a trava da execução, trabalha até o orçamento de tempo e grava o checkpoint no banco. Assim a
 * importação pausa, retoma, cancela e sobrevive a falhas sem depender de um processo ligado.
 *
 * Fases: extração (fila de buscas na origem → dado bruto) → processamento (mapeia, valida, resolve relações,
 * decide a ação e, na importação, grava no CRM) → fim. A simulação faz tudo igual, menos gravar no CRM.
 */
import { createHash } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  EMPTY_COUNTERS, TARGET_ORDER, conditionHolds, evaluateRecord, targetSchema,
  type EntityMapping, type ImportConfig, type ImportScope, type Issue, type RecordAction, type RunCounters, type TargetEntity, type TargetField,
} from '@isp/domain';
import type { DB, DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { ConnectorError, RetryableError, connectorFor, type FetchJob } from './importConnectors';

export const hashOf = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);
const STEP_BUDGET_MS = 18_000;
const LOCK_MS = 45_000;

export async function importSchema(db: DbOrTx, tenantId: string) {
  const [cf, pf] = await Promise.all([
    db.select({ key: s.customerFields.key, label: s.customerFields.label, type: s.customerFields.type, options: s.customerFields.options }).from(s.customerFields).where(and(eq(s.customerFields.tenantId, tenantId), eq(s.customerFields.active, true))),
    db.selectDistinctOn([s.pipelineFields.key], { key: s.pipelineFields.key, label: s.pipelineFields.label, type: s.pipelineFields.type, options: s.pipelineFields.options }).from(s.pipelineFields).where(and(eq(s.pipelineFields.tenantId, tenantId), eq(s.pipelineFields.active, true))),
  ]);
  return targetSchema([...cf.map((c) => ({ ...c, entity: 'conta' as const })), ...pf.map((c) => ({ ...c, entity: 'oportunidade' as const }))]);
}

// ------------------------------------------------------------------ escopo: filtros conferidos no próprio registro
function inScope(scope: ImportScope, entity: string, payload: Record<string, unknown>, reason: string): boolean {
  if (scope.mode !== 'personalizado' || entity !== 'deals' || reason !== 'selecionado') return true;
  const win = payload.win;
  const status = win === true ? 'ganha' : win === false ? 'perdida' : 'aberta';
  if (scope.status.length && !scope.status.includes(status)) return false;
  const created = String(payload.created_at ?? '').slice(0, 10), closed = String(payload.closed_at ?? '').slice(0, 10);
  if (scope.createdFrom && (!created || created < scope.createdFrom)) return false;
  if (scope.createdTo && (!created || created > scope.createdTo)) return false;
  if (scope.closedFrom && (!closed || closed < scope.closedFrom)) return false;
  if (scope.closedTo && (!closed || closed > scope.closedTo)) return false;
  return true;
}

type RunRow = typeof s.importRuns.$inferSelect;

async function setCounters(db: DbOrTx, runId: string, patch: Partial<RunCounters>) {
  await db.update(s.importRuns).set({ counters: sql`${s.importRuns.counters} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() }).where(eq(s.importRuns.id, runId));
}

/** Enfileira buscas (sem repetir a mesma busca na mesma execução). */
export async function enqueue(db: DbOrTx, runId: string, jobs: FetchJob[]) {
  if (!jobs.length) return;
  await db.insert(s.importFetchJobs).values(jobs.map((job) => ({ runId, job: job as Record<string, unknown>, dedupeKey: hashOf({ k: job.kind, e: job.entity, p: job.path, q: job.params, g: job.page, f: job.fileId }) }))).onConflictDoNothing();
}

// ------------------------------------------------------------------ extração
async function extract(db: DB, run: RunRow, deadline: number): Promise<'continua' | 'feito' | 'aguardando'> {
  const { connector } = await connectorFor(db, run.tenantId, run.connectorId);
  const warnings: string[] = [];
  let imported: Set<string> | null = null;
  if (run.scope.mode === 'personalizado' && run.scope.imported !== 'todos') {
    const links = await db.select({ e: s.importLinks.sourceEntity, id: s.importLinks.sourceId }).from(s.importLinks).where(and(eq(s.importLinks.tenantId, run.tenantId), eq(s.importLinks.source, run.source)));
    imported = new Set(links.map((l) => `${l.e}:${l.id}`));
  }
  while (Date.now() < deadline) {
    const [job] = await db.select().from(s.importFetchJobs).where(and(eq(s.importFetchJobs.runId, run.id), eq(s.importFetchJobs.status, 'pendente'), or(isNull(s.importFetchJobs.notBefore), lte(s.importFetchJobs.notBefore, new Date())))).orderBy(asc(s.importFetchJobs.seq)).limit(1);
    if (!job) {
      const [waiting] = await db.select({ n: sql<number>`count(*)::int` }).from(s.importFetchJobs).where(and(eq(s.importFetchJobs.runId, run.id), eq(s.importFetchJobs.status, 'pendente')));
      if (waiting && waiting.n > 0) { if (warnings.length) await addWarnings(db, run.id, warnings); return 'aguardando'; }
      if (warnings.length) await addWarnings(db, run.id, warnings);
      return 'feito';
    }
    const fj = job.job as unknown as FetchJob;
    try {
      const r = await connector.run(fj);
      warnings.push(...r.warnings);
      const keep = r.records.filter((x) => inScope(run.scope, x.entity, x.payload, x.reason))
        .filter((x) => !imported || x.reason !== 'selecionado' || (run.scope.mode === 'personalizado' && (run.scope.imported === 'importados') === imported.has(`${x.entity}:${x.sourceId}`)));
      const dropped = new Set(r.records.filter((x) => !keep.includes(x)).map((x) => x.sourceId));
      if (keep.length) await db.insert(s.importRawRecords).values(keep.map((x) => ({ tenantId: run.tenantId, runId: run.id, entity: x.entity, sourceId: x.sourceId, payload: x.payload, reason: x.reason }))).onConflictDoNothing();
      // dependências só dos registros que ficaram no escopo
      const next = r.next.filter((n) => !n.reason?.startsWith('dependência da negociação ') || !dropped.has(n.reason.slice('dependência da negociação '.length)));
      await enqueue(db, run.id, next);
      await db.update(s.importFetchJobs).set({ status: 'feito', lastError: null }).where(eq(s.importFetchJobs.id, job.id));
    } catch (e) {
      if (e instanceof RetryableError) {
        const attempts = job.attempts + 1;
        const backoff = Math.max(e.retryAfterMs, 2 ** attempts * 1000);
        if (attempts >= 6) { await db.update(s.importFetchJobs).set({ status: 'falhou', attempts, lastError: e.message }).where(eq(s.importFetchJobs.id, job.id)); warnings.push(`Busca desistida após ${attempts} tentativas: ${fj.path ?? fj.entity} — ${e.message}`); }
        else await db.update(s.importFetchJobs).set({ attempts, notBefore: new Date(Date.now() + backoff), lastError: e.message }).where(eq(s.importFetchJobs.id, job.id));
        if (backoff > deadline - Date.now()) { if (warnings.length) await addWarnings(db, run.id, warnings); return 'aguardando'; }
      } else {
        await db.update(s.importFetchJobs).set({ status: 'falhou', attempts: job.attempts + 1, lastError: (e as Error).message }).where(eq(s.importFetchJobs.id, job.id));
        warnings.push(`Falha na busca ${fj.path ?? fj.entity}: ${(e as Error).message}`);
        if (e instanceof ConnectorError && /token/i.test((e as Error).message)) { await addWarnings(db, run.id, warnings); throw e; }
      }
    }
  }
  if (warnings.length) await addWarnings(db, run.id, warnings);
  return 'continua';
}
async function addWarnings(db: DbOrTx, runId: string, w: string[]) {
  const uniq = [...new Set(w)].slice(0, 50);
  await db.update(s.importRuns).set({ warnings: sql`(select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(${s.importRuns.warnings} || ${JSON.stringify(uniq)}::jsonb) x)` }).where(eq(s.importRuns.id, runId));
}

// ------------------------------------------------------------------ processamento
type Ctx = {
  db: DB; run: RunRow; config: ImportConfig; schema: Record<TargetEntity, TargetField[]>; write: boolean; actorId: string;
  users: Map<string, string>; userEmails: Map<string, string>; stages: Set<string>; sources: Set<string>; branches: Set<string>;
  decisions: Map<string, string>;
};
const ENT_TABLE = { conta: s.contacts, pessoa: s.people, oportunidade: s.opportunities, tarefa: s.activities } as const;

async function loadCtx(db: DB, run: RunRow, actorId: string): Promise<Ctx> {
  const [users, stages, sources, branches] = await Promise.all([
    db.select({ id: s.users.id, email: s.users.email }).from(s.users).where(eq(s.users.tenantId, run.tenantId)),
    db.select({ p: s.pipelineStages.pipelineId, k: s.pipelineStages.key }).from(s.pipelineStages).innerJoin(s.pipelines, eq(s.pipelines.id, s.pipelineStages.pipelineId)).where(eq(s.pipelines.tenantId, run.tenantId)),
    db.select({ id: s.leadSources.id }).from(s.leadSources).where(eq(s.leadSources.tenantId, run.tenantId)),
    db.select({ id: s.salesBranches.id }).from(s.salesBranches).where(eq(s.salesBranches.tenantId, run.tenantId)),
  ]);
  const decisions = new Map<string, string>();
  if (run.simulationRunId) {
    const d = await db.select({ t: s.importRecordResults.targetEntity, e: s.importRecordResults.sourceEntity, id: s.importRecordResults.sourceId, decision: s.importRecordResults.decision }).from(s.importRecordResults).where(and(eq(s.importRecordResults.runId, run.simulationRunId), sql`${s.importRecordResults.decision} is not null`));
    for (const x of d) decisions.set(`${x.t}|${x.e}|${x.id}`, x.decision!);
  }
  return {
    db, run, config: run.configSnapshot, schema: await importSchema(db, run.tenantId), write: run.mode === 'importacao', actorId,
    users: new Map(users.map((u) => [u.id, u.id])), userEmails: new Map(users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u.id])),
    stages: new Set(stages.map((x) => `${x.p}:${x.k}`)), sources: new Set(sources.map((x) => x.id)), branches: new Set(branches.map((x) => x.id)), decisions,
  };
}

/** Resolve uma referência para o ID no ISP Sprint (ou explica por que não dá). */
async function resolveRef(c: Ctx, f: TargetField, v: unknown): Promise<{ id: string | null; issue?: Issue }> {
  const val = String(v).trim();
  switch (f.ref) {
    case 'usuario': {
      const id = c.users.get(val) ?? c.userEmails.get(val.toLowerCase());
      return id ? { id } : { id: null, issue: { field: f.key, level: 'erro', message: `Usuário "${val}" sem equivalência no ISP Sprint (use a tabela de usuários ou o e-mail)` } };
    }
    case 'etapa': return c.stages.has(val) ? { id: val } : { id: null, issue: { field: f.key, level: 'erro', message: `Etapa "${val}" sem equivalência (tabela de etapas)` } };
    case 'origem': return c.sources.has(val) ? { id: val } : { id: null, issue: { field: f.key, level: 'erro', message: `Origem "${val}" sem equivalência` } };
    case 'filial': return c.branches.has(val) ? { id: val } : { id: null, issue: { field: f.key, level: 'erro', message: `Filial "${val}" sem equivalência` } };
    default: {
      const ent = f.ref as TargetEntity;
      const em = c.config.entities.find((e) => e.target === ent && e.enabled) ?? c.config.entities.find((e) => e.target === ent);
      const srcEntity = em?.source ?? '';
      const [link] = await c.db.select({ id: s.importLinks.targetId }).from(s.importLinks).where(and(eq(s.importLinks.tenantId, c.run.tenantId), eq(s.importLinks.source, c.run.source), eq(s.importLinks.targetEntity, ent), eq(s.importLinks.sourceEntity, srcEntity), eq(s.importLinks.sourceId, val))).limit(1);
      if (link) return { id: link.id };
      const [here] = await c.db.select({ action: s.importRecordResults.action, targetId: s.importRecordResults.targetId }).from(s.importRecordResults).where(and(eq(s.importRecordResults.runId, c.run.id), eq(s.importRecordResults.targetEntity, ent), eq(s.importRecordResults.sourceEntity, srcEntity), eq(s.importRecordResults.sourceId, val))).limit(1);
      if (here && (here.action === 'criar' || here.action === 'atualizar')) return { id: here.targetId ?? `nesta-execucao:${val}` };
      if (here) return { id: null, issue: { field: f.key, level: 'erro', message: `Relacionamento incompleto: ${ent} ${val} desta execução ficou como "${here.action}"` } };
      return { id: null, issue: { field: f.key, level: 'erro', message: `Relacionamento incompleto: ${ent} ${val} não está nesta importação nem foi importado antes` } };
    }
  }
}

type Existing = { id: string; updatedAt: Date | null; deleted: boolean } | null;
async function targetRow(c: Ctx, ent: TargetEntity, id: string): Promise<Existing> {
  if (ent === 'anotacao') {
    const [r] = await c.db.select({ id: s.opportunityEvents.id }).from(s.opportunityEvents).where(eq(s.opportunityEvents.id, id)).limit(1);
    return r ? { id: r.id, updatedAt: null, deleted: false } : null;
  }
  const t = ENT_TABLE[ent];
  const [r] = await c.db.select({ id: t.id, updatedAt: t.updatedAt, deleted: 'deletedAt' in t ? sql<boolean>`${(t as typeof s.contacts).deletedAt} is not null` : sql<boolean>`false` }).from(t).where(eq(t.id, id)).limit(1);
  return r ? { id: r.id, updatedAt: r.updatedAt, deleted: !!r.deleted } : null;
}

/** Registro já existente sem vínculo de importação, achado por chave forte (documento da conta, e-mail da pessoa). Nunca por nome. */
async function matchByKey(c: Ctx, ent: TargetEntity, values: Record<string, unknown>): Promise<string | null> {
  if (ent === 'conta' && values.document) {
    const [r] = await c.db.select({ id: s.contacts.id }).from(s.contacts).where(and(eq(s.contacts.tenantId, c.run.tenantId), isNull(s.contacts.deletedAt), sql`regexp_replace(coalesce(${s.contacts.document}, ''), '\\D', '', 'g') = ${String(values.document)}`)).limit(1);
    return r?.id ?? null;
  }
  if (ent === 'pessoa' && values.email) {
    const [r] = await c.db.select({ id: s.people.id }).from(s.people).where(and(eq(s.people.tenantId, c.run.tenantId), sql`lower(${s.people.email}) = ${String(values.email).toLowerCase()}`)).limit(1);
    return r?.id ?? null;
  }
  return null;
}

const customOf = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([k, x]) => k.startsWith('custom.') && x != null).map(([k, x]) => [k.slice(7), x]));
const pick = (v: Record<string, unknown>, keep: 'manter' | 'limpar', keys: string[]) => Object.fromEntries(keys.filter((k) => k in v && (v[k] != null || keep === 'limpar')).map((k) => [k, v[k] ?? null]));

/** Grava no CRM (só na importação). Devolve o ID criado/atualizado. */
async function writeTarget(c: Ctx, tx: DbOrTx, ent: TargetEntity, action: 'criar' | 'atualizar', targetId: string | null, v: Record<string, unknown>, refs: Record<string, string>, em: EntityMapping, sourceId: string): Promise<string> {
  const now = new Date();
  const T = c.run.tenantId;
  const keep = em.policy.emptyValues;
  const mapped = em.fields.filter((f) => f.approved).map((f) => f.target);
  switch (ent) {
    case 'conta': {
      const base = { name: v.name as string, document: v.document as string | null, phone: v.phone as string | null, email: v.email as string | null, segment: v.segment as string, nature: v.nature as string | null, city: v.city as string | null, ownerId: refs.owner ?? null };
      const custom = customOf(v);
      if (action === 'criar') {
        const [r] = await tx.insert(s.contacts).values({ tenantId: T, ...base, segment: base.segment ?? 'empresarial', custom, createdBy: c.actorId, sourceSystem: c.run.source, externalId: sourceId }).returning({ id: s.contacts.id });
        return r!.id;
      }
      const patch = pick({ ...base, ...(mapped.includes('owner') ? { ownerId: refs.owner ?? null } : {}) }, keep, [...mapped.filter((k) => k !== 'owner' && !k.startsWith('custom.')), ...(mapped.includes('owner') ? ['ownerId'] : [])]);
      await tx.update(s.contacts).set({ ...patch, ...(Object.keys(custom).length ? { custom: sql`${s.contacts.custom} || ${JSON.stringify(custom)}::jsonb` } : {}), updatedAt: now }).where(eq(s.contacts.id, targetId!));
      return targetId!;
    }
    case 'pessoa': {
      const base = { name: v.name as string, email: v.email as string | null, phone: v.phone as string | null, notes: v.notes as string | null };
      let id = targetId;
      if (action === 'criar') id = (await tx.insert(s.people).values({ tenantId: T, ...base, sourceSystem: c.run.source, externalId: sourceId, createdBy: c.actorId }).returning({ id: s.people.id }))[0]!.id;
      else await tx.update(s.people).set({ ...pick(base, keep, mapped.filter((k) => k in base)), updatedAt: now }).where(eq(s.people.id, id!));
      if (refs.account) {
        const [st] = await tx.select({ id: s.accountStakeholders.id }).from(s.accountStakeholders).where(and(eq(s.accountStakeholders.contactId, refs.account), eq(s.accountStakeholders.personId, id!))).limit(1);
        if (!st) await tx.insert(s.accountStakeholders).values({ tenantId: T, contactId: refs.account, personId: id!, title: (v.title as string | null) ?? null });
        else if (v.title) await tx.update(s.accountStakeholders).set({ title: v.title as string }).where(eq(s.accountStakeholders.id, st.id));
      }
      return id!;
    }
    case 'oportunidade': {
      const [pipelineId, stageKey] = (refs.stage ?? ':').split(':') as [string, string];
      const status = v.status as 'aberta' | 'ganha' | 'perdida';
      const stage = status === 'ganha' ? 'ganha' : status === 'perdida' ? 'perdida' : stageKey;
      const base = {
        contactId: refs.account!, ownerId: refs.owner!, title: v.title as string, pipelineId, stage, saleKind: (v.saleKind as string | null) ?? null, valueCents: (v.valueCents as number | null) ?? null,
        wonAt: status === 'ganha' ? new Date((v.wonAt as string) ?? (v.createdAt as string) ?? now) : null, lostAt: status === 'perdida' ? new Date((v.lostAt as string) ?? (v.createdAt as string) ?? now) : null,
        lossReason: status === 'perdida' ? ((v.lossReason as string | null) ?? null) : null, sourceId: refs.source ?? null, branchId: refs.branch ?? null, notes: (v.notes as string | null) ?? null,
      };
      const custom = customOf(v);
      if (action === 'criar') {
        const created = v.createdAt ? new Date(v.createdAt as string) : now;
        const [r] = await tx.insert(s.opportunities).values({ tenantId: T, ...base, custom, createdBy: c.actorId, createdAt: created, stageChangedAt: base.wonAt ?? base.lostAt ?? created }).returning({ id: s.opportunities.id });
        await tx.insert(s.opportunityEvents).values({ tenantId: T, opportunityId: r!.id, type: 'importado', actorId: c.actorId, toValue: stage, payload: { source: c.run.source, sourceId, runId: c.run.id }, sourceSystem: c.run.source, occurredAt: created });
        return r!.id;
      }
      const map: Record<string, string[]> = { account: ['contactId'], owner: ['ownerId'], stage: ['pipelineId', 'stage'], status: ['stage', 'wonAt', 'lostAt', 'lossReason'], source: ['sourceId'], branch: ['branchId'] };
      const keys = [...new Set(mapped.flatMap((k) => map[k] ?? (k in base ? [k] : [])))];
      await tx.update(s.opportunities).set({ ...pick(base, keep, keys), ...(Object.keys(custom).length ? { custom: sql`${s.opportunities.custom} || ${JSON.stringify(custom)}::jsonb` } : {}), updatedAt: now }).where(eq(s.opportunities.id, targetId!));
      await tx.insert(s.opportunityEvents).values({ tenantId: T, opportunityId: targetId!, type: 'importado', actorId: c.actorId, payload: { source: c.run.source, sourceId, runId: c.run.id, atualizado: keys }, sourceSystem: c.run.source });
      return targetId!;
    }
    case 'tarefa': {
      let contactId = refs.account ?? null;
      if (!contactId && refs.opportunity) contactId = (await tx.select({ c: s.opportunities.contactId }).from(s.opportunities).where(eq(s.opportunities.id, refs.opportunity)).limit(1))[0]?.c ?? null;
      const done = v.completedAt ? new Date(v.completedAt as string) : null;
      const base = { title: v.title as string, type: (v.type as string | null) ?? 'tarefa', notes: (v.notes as string | null) ?? null, dueAt: v.dueAt ? new Date(v.dueAt as string) : null, ownerId: refs.owner!, opportunityId: refs.opportunity ?? null, contactId, completedAt: done, completedBy: done ? refs.owner! : null, status: done ? 'concluida' : 'a_fazer' };
      if (action === 'criar') return (await tx.insert(s.activities).values({ tenantId: T, ...base, createdBy: c.actorId }).returning({ id: s.activities.id }))[0]!.id;
      await tx.update(s.activities).set({ ...base, updatedAt: now }).where(eq(s.activities.id, targetId!));
      return targetId!;
    }
    case 'anotacao': {
      const payload = { text: v.text as string, source: c.run.source, sourceId, runId: c.run.id };
      if (action === 'criar') return (await tx.insert(s.opportunityEvents).values({ tenantId: T, opportunityId: refs.opportunity!, type: 'nota_importada', actorId: refs.author ?? null, payload, sourceSystem: c.run.source, occurredAt: v.occurredAt ? new Date(v.occurredAt as string) : now }).returning({ id: s.opportunityEvents.id }))[0]!.id;
      // eventos são só de acréscimo: uma anotação já importada não é reescrita
      return targetId!;
    }
  }
}

async function processOne(c: Ctx, raw: typeof s.importRawRecords.$inferSelect, em: EntityMapping): Promise<RecordAction> {
  const ent = em.target;
  const fields = c.schema[ent];
  const ev = evaluateRecord(raw.payload, em, fields, { timezone: c.config.timezone, tables: c.config.tables });
  const issues = [...ev.issues];
  let action: RecordAction;
  let reason = '';
  let targetId: string | null = null;
  let duplicate = false;
  const refs: Record<string, string> = {};
  if (em.filter.length && !em.filter.every((cond) => conditionHolds(raw.payload, cond))) { action = 'ignorar'; reason = 'Fora do filtro do modelo'; }
  else {
    for (const f of fields.filter((x) => x.type === 'ref')) {
      const v = ev.values[f.key];
      if (v == null || v === '') continue;
      const r = await resolveRef(c, f, v);
      if (r.issue) issues.push(r.issue); else refs[f.key] = r.id!;
    }
    const [link] = await c.db.select().from(s.importLinks).where(and(eq(s.importLinks.tenantId, c.run.tenantId), eq(s.importLinks.source, c.run.source), eq(s.importLinks.targetEntity, ent), eq(s.importLinks.sourceEntity, raw.entity), eq(s.importLinks.sourceId, raw.sourceId))).limit(1);
    let existing: Existing = null;
    if (link) {
      existing = await targetRow(c, ent, link.targetId);
      targetId = link.targetId;
    } else if (em.policy.matchByKey !== 'desligado') {
      const m = await matchByKey(c, ent, ev.values);
      if (m) { duplicate = true; targetId = m; existing = await targetRow(c, ent, m); }
    }
    const decision = c.decisions.get(`${ent}|${raw.entity}|${raw.sourceId}`);
    if (issues.some((i) => i.level === 'erro')) { action = 'erro'; reason = 'Erro impeditivo'; }
    else if (link && (!existing || existing.deleted)) { action = 'revisar'; reason = 'O registro importado antes foi excluído no ISP Sprint'; }
    else if (existing && link && existing.updatedAt && existing.updatedAt.getTime() > link.lastWrittenAt.getTime() + 2000 && em.policy.onExisting === 'atualizar' && decision !== 'atualizar') { action = 'revisar'; reason = 'Alterado manualmente no ISP Sprint depois da última importação'; }
    else if (existing && duplicate && !link && em.policy.matchByKey === 'revisar' && decision !== 'vincular') { action = 'revisar'; reason = ent === 'conta' ? 'Já existe uma conta com este CPF/CNPJ' : 'Já existe uma pessoa com este e-mail'; }
    else if (existing) { action = em.policy.onExisting === 'atualizar' ? (ent === 'anotacao' ? 'ignorar' : 'atualizar') : em.policy.onExisting; reason = duplicate ? 'Vinculado a registro existente (chave forte)' : 'Já importado antes'; }
    else { action = em.policy.onNew; reason = 'Novo'; targetId = null; }
    if (issues.some((i) => i.level === 'revisao') && (action === 'criar' || action === 'atualizar') && decision !== 'importar') { action = 'revisar'; reason = 'Campos para revisar'; }
    if (decision === 'ignorar') { action = 'ignorar'; reason = 'Decisão administrativa: ignorar'; }
  }
  // gravação (só na importação)
  if (c.write && (action === 'criar' || action === 'atualizar')) {
    targetId = await c.db.transaction(async (tx) => {
      const id = await writeTarget(c, tx, ent, action as 'criar' | 'atualizar', targetId, ev.values, refs, em, raw.sourceId);
      await tx.insert(s.importLinks).values({ tenantId: c.run.tenantId, source: c.run.source, sourceEntity: raw.entity, sourceId: raw.sourceId, targetEntity: ent, targetId: id, firstRunId: c.run.id, lastRunId: c.run.id, lastWrittenAt: new Date(), legacy: ev.legacy })
        .onConflictDoUpdate({ target: [s.importLinks.tenantId, s.importLinks.source, s.importLinks.targetEntity, s.importLinks.sourceEntity, s.importLinks.sourceId], set: { targetId: id, lastRunId: c.run.id, lastWrittenAt: new Date(), legacy: ev.legacy } });
      return id;
    });
  }
  await c.db.insert(s.importRecordResults).values({ tenantId: c.run.tenantId, runId: c.run.id, rawId: raw.id, sourceEntity: raw.entity, sourceId: raw.sourceId, targetEntity: ent, action, targetId, values: ev.values, originals: ev.originals, converted: ev.converted, issues, legacy: ev.legacy, reason, duplicate })
    .onConflictDoUpdate({ target: [s.importRecordResults.runId, s.importRecordResults.targetEntity, s.importRecordResults.sourceEntity, s.importRecordResults.sourceId], set: { action, targetId, values: ev.values, originals: ev.originals, converted: ev.converted, issues, legacy: ev.legacy, reason, duplicate } });
  return action;
}

async function processBatch(db: DB, run: RunRow, actorId: string, deadline: number): Promise<'continua' | 'feito'> {
  const c = await loadCtx(db, run, actorId);
  const cp = { entityIdx: 0, lastSeq: 0, ...(run.checkpoint as { entityIdx?: number; lastSeq?: number }) };
  const order = TARGET_ORDER.flatMap((t) => c.config.entities.filter((e) => e.enabled && e.target === t));
  const counters = { ...EMPTY_COUNTERS, ...run.counters };
  const key: Record<RecordAction, keyof RunCounters> = { criar: 'criados', atualizar: 'atualizados', ignorar: 'ignorados', revisar: 'revisar', erro: 'erros' };
  while (Date.now() < deadline && cp.entityIdx < order.length) {
    const em = order[cp.entityIdx]!;
    const batch = await db.select().from(s.importRawRecords).where(and(eq(s.importRawRecords.runId, run.id), eq(s.importRawRecords.entity, em.source), gt(s.importRawRecords.seq, cp.lastSeq))).orderBy(asc(s.importRawRecords.seq)).limit(c.config.execution.batchSize);
    if (!batch.length) { cp.entityIdx += 1; cp.lastSeq = 0; continue; }
    for (const raw of batch) {
      if (Date.now() >= deadline) break;
      try {
        const a = await processOne(c, raw, em);
        counters[key[a]] += 1;
      } catch (e) {
        counters.erros += 1;
        await db.insert(s.importRecordResults).values({ tenantId: run.tenantId, runId: run.id, rawId: raw.id, sourceEntity: raw.entity, sourceId: raw.sourceId, targetEntity: em.target, action: 'erro', values: {}, originals: {}, issues: [{ field: '*', level: 'erro', message: `Falha ao gravar: ${(e as Error).message.slice(0, 300)}` }], reason: 'Falha na gravação (desfeita)' })
          .onConflictDoUpdate({ target: [s.importRecordResults.runId, s.importRecordResults.targetEntity, s.importRecordResults.sourceEntity, s.importRecordResults.sourceId], set: { action: 'erro', issues: [{ field: '*', level: 'erro', message: `Falha ao gravar: ${(e as Error).message.slice(0, 300)}` }], reason: 'Falha na gravação (desfeita)' } });
      }
      counters.processados += 1;
      counters.pendentes = Math.max(0, counters.identificados - counters.processados);
      cp.lastSeq = raw.seq;
    }
    await db.update(s.importRuns).set({ counters, checkpoint: cp, updatedAt: new Date() }).where(eq(s.importRuns.id, run.id));
  }
  return cp.entityIdx >= order.length ? 'feito' : 'continua';
}

/** Um passo da execução. Devolve a execução atualizada. Seguro para chamar em paralelo (trava por execução). */
export async function stepRun(db: DB, tenantId: string, runId: string, actorId: string, budgetMs = STEP_BUDGET_MS) {
  const lockUntil = new Date(Date.now() + LOCK_MS);
  const [run] = await db.update(s.importRuns).set({ lockedUntil: lockUntil }).where(and(eq(s.importRuns.id, runId), eq(s.importRuns.tenantId, tenantId), inArray(s.importRuns.status, ['na_fila', 'em_andamento']), or(isNull(s.importRuns.lockedUntil), lte(s.importRuns.lockedUntil, new Date())))).returning();
  if (!run) return { busy: true };
  const deadline = Date.now() + budgetMs;
  try {
    if (run.status === 'na_fila') await db.update(s.importRuns).set({ status: 'em_andamento' }).where(eq(s.importRuns.id, run.id));
    let waiting = false;
    if (run.phase === 'extracao') {
      const r = await extract(db, { ...run, status: 'em_andamento' }, deadline);
      const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(s.importRawRecords).where(and(eq(s.importRawRecords.runId, run.id), inArray(s.importRawRecords.entity, run.configSnapshot.entities.filter((e) => e.enabled).map((e) => e.source))));
      await setCounters(db, run.id, { identificados: cnt?.n ?? 0, pendentes: Math.max(0, (cnt?.n ?? 0) - run.counters.processados) });
      if (r === 'feito') await db.update(s.importRuns).set({ phase: 'processamento', checkpoint: { entityIdx: 0, lastSeq: 0 } }).where(eq(s.importRuns.id, run.id));
      waiting = r === 'aguardando';
    }
    const [cur] = await db.select().from(s.importRuns).where(eq(s.importRuns.id, run.id));
    if (cur!.phase === 'processamento' && Date.now() < deadline && cur!.status === 'em_andamento') {
      const r = await processBatch(db, cur!, actorId, deadline);
      if (r === 'feito') {
        const c = cur!.counters;
        const [final] = await db.select({ counters: s.importRuns.counters }).from(s.importRuns).where(eq(s.importRuns.id, run.id));
        const pend = (final?.counters.revisar ?? c.revisar) + (final?.counters.erros ?? c.erros);
        await db.update(s.importRuns).set({ phase: 'fim', status: pend ? 'concluida_com_pendencias' : 'concluida', finishedAt: new Date(), counters: sql`${s.importRuns.counters} || '{"pendentes":0}'::jsonb` }).where(eq(s.importRuns.id, run.id));
      }
    }
    return { busy: false, waiting };
  } catch (e) {
    await db.update(s.importRuns).set({ status: 'falhou', error: (e as Error).message.slice(0, 500), finishedAt: new Date() }).where(eq(s.importRuns.id, run.id));
    return { busy: false, failed: (e as Error).message };
  } finally {
    await db.update(s.importRuns).set({ lockedUntil: null }).where(eq(s.importRuns.id, run.id));
  }
}

