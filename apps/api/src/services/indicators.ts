/**
 * Cálculo de indicadores sobre os eventos de negócio válidos (Etapa 6).
 * Só campos e filtros de uma lista fechada viram SQL; todo valor vem parametrizado.
 * Sem dado de origem → "indisponível"; denominador zero → "sem base"; amostra pequena → "incompleto".
 */
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  attainment, combine, compositeScore, goalStatus, normalizeWeights, periodRange, scorecardScore, DEFAULT_CAP,
  type IndicatorDef, type NumericField, type Source, type SourceFilter, type PeriodType, type GoalStatus,
} from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export type Who = { users: string[] | 'all' };
export type Range = { from: string; to: string };
export type IndicatorStatus = 'ok' | 'incompleto' | 'indisponivel' | 'sem_base';
export type IndicatorResult = { value: number | null; status: IndicatorStatus; sample: number; parts: Record<string, number | null> };

const FIELD_SQL: Record<NumericField, SQL> = {
  minutesToComplete: sql`(e.context->>'minutesToComplete')::numeric`,
  hoursToDecide: sql`(e.context->>'hoursToDecide')::numeric`,
  cycleDays: sql`(extract(epoch from (e.occurred_at - (e.context->>'createdAt')::timestamptz)) / 86400.0)`,
  checklist: sql`(e.context->>'checklist')::numeric`,
};
function filterSql(f: SourceFilter): SQL {
  const col = f.field === 'outcome' ? sql`e.outcome` : ['onTime', 'selfCreated', 'approved', 'hadDue'].includes(f.field) ? sql`(e.context->>${f.field})::boolean` : sql`(e.context->>${f.field})`;
  const val = typeof f.value === 'boolean' ? sql`${f.value}::boolean` : sql`${String(f.value)}`;
  return f.op === 'eq' ? sql`${col} = ${val}` : sql`${col} is distinct from ${val}`;
}
function baseWhere(tenantId: string, tz: string, src: Source, range: Range): SQL {
  const parts: SQL[] = [
    sql`e.tenant_id = ${tenantId}`, sql`e.type = ${src.event}`, sql`e.validation = 'valido'`,
    sql`(e.occurred_at at time zone ${tz})::date between ${range.from}::date and ${range.to}::date`,
    ...(src.filters ?? []).map(filterSql),
  ];
  return sql.join(parts, sql` and `);
}

/** Apura uma origem para um conjunto de pessoas. Crédito "Resultado" pondera pela parte de cada um (sem dupla contagem). */
export async function computeSource(db: DbOrTx, tenantId: string, tz: string, src: Source, who: Who, range: Range): Promise<{ value: number | null; sample: number }> {
  const credit = src.credit ?? 'direto';
  const where = baseWhere(tenantId, tz, src, range);
  const field = src.field ? FIELD_SQL[src.field] : sql`null::numeric`;
  let q: SQL;
  if (credit === 'direto') {
    const users = who.users === 'all' ? sql`true` : who.users.length ? sql`c.user_id in ${who.users}` : sql`false`;
    q = sql`select coalesce(sum(c.share_bp) / 10000.0, 0) as cnt, sum(e.value_cents * c.share_bp / 10000.0) as sumv,
                   sum(${field} * c.share_bp) / nullif(sum(case when ${field} is not null then c.share_bp end), 0) as avgf, count(distinct e.id)::int as sample
              from business_events e join business_event_credits c on c.event_id = e.id and c.kind = 'direto'
             where ${where} and ${users}`;
  } else {
    const kinds = credit === 'qualquer' ? sql`c.kind in ('direto', 'participacao', 'gestao')` : sql`c.kind = ${credit}`;
    const users = who.users === 'all' ? sql`true` : who.users.length ? sql`c.user_id in ${who.users}` : sql`false`;
    q = sql`select count(*)::numeric as cnt, sum(e.value_cents) as sumv, avg(${field}) as avgf, count(*)::int as sample
              from business_events e where ${where} and exists (select 1 from business_event_credits c where c.event_id = e.id and ${kinds} and ${users})`;
  }
  const [r] = (await db.execute(q)).rows as { cnt: string | null; sumv: string | null; avgf: string | null; sample: number }[];
  const cnt = Number(r?.cnt ?? 0);
  const sumv = r?.sumv === null || r?.sumv === undefined ? null : Number(r.sumv);
  const avgf = r?.avgf === null || r?.avgf === undefined ? null : Number(r.avgf);
  const sample = r?.sample ?? 0;
  switch (src.measure) {
    case 'contagem': return { value: cnt, sample };
    case 'soma_valor': return { value: sumv ?? 0, sample };
    case 'media_valor': return { value: sumv !== null && cnt > 0 ? sumv / cnt : null, sample };
    case 'media_campo': return { value: avgf, sample };
  }
}

const sources = (d: IndicatorDef): Record<string, Source> => {
  if (['percentual', 'taxa', 'razao'].includes(d.calc)) return { num: d.numerator!, den: d.denominator! };
  if (d.calc === 'formula') return d.vars ?? {};
  return { base: d.base! };
};

/** Tipos sem nenhum evento registrado na empresa (nunca) → o indicador fica indisponível, sem inventar zero. */
async function typesWithData(db: DbOrTx, tenantId: string, types: string[]) {
  if (!types.length) return new Set<string>();
  const rows = await db.selectDistinct({ type: s.businessEvents.type }).from(s.businessEvents).where(and(eq(s.businessEvents.tenantId, tenantId), inArray(s.businessEvents.type, types)));
  return new Set(rows.map((r) => r.type));
}

export async function computeIndicator(db: DbOrTx, tenantId: string, tz: string, def: IndicatorDef, who: Who, range: Range): Promise<IndicatorResult> {
  const src = sources(def);
  const types = [...new Set(Object.values(src).map((x) => x.event))];
  const have = await typesWithData(db, tenantId, types);
  if (types.some((t) => !have.has(t))) return { value: null, status: 'indisponivel', sample: 0, parts: {} };
  const entries = await Promise.all(Object.entries(src).map(async ([k, v]) => [k, await computeSource(db, tenantId, tz, v, who, range)] as const));
  const parts = Object.fromEntries(entries.map(([k, r]) => [k, r.value]));
  const sample = Math.max(0, ...entries.map(([, r]) => r.sample));
  const value = combine(def, def.calc === 'formula' ? { vars: parts } : { base: parts.base, num: parts.num, den: parts.den });
  const status: IndicatorStatus = value === null ? 'sem_base' : def.minSample && sample < def.minSample ? 'incompleto' : 'ok';
  return { value: value === null ? null : Math.round(value * 1000) / 1000, status, sample, parts };
}

/** Eventos que compõem o resultado (detalhamento), com o peso de cada um para a(s) pessoa(s). */
export async function sourceEvents(db: DbOrTx, tenantId: string, tz: string, src: Source, who: Who, range: Range, limit = 200) {
  const where = baseWhere(tenantId, tz, src, range);
  const credit = src.credit ?? 'direto';
  const kinds = credit === 'direto' ? sql`c.kind = 'direto'` : credit === 'qualquer' ? sql`true` : sql`c.kind = ${credit}`;
  const users = who.users === 'all' ? sql`true` : who.users.length ? sql`c.user_id in ${who.users}` : sql`false`;
  const rows = await db.execute(sql`
    select e.id, e.type, e.occurred_at, e.value_cents, e.outcome, e.source_type, e.source_id, e.context, u.name as owner_name,
           ${credit === 'direto' ? sql`(select sum(c.share_bp) from business_event_credits c where c.event_id = e.id and ${kinds} and ${users})::int` : sql`10000`} as weight_bp
      from business_events e left join users u on u.id = e.owner_id
     where ${where} and exists (select 1 from business_event_credits c where c.event_id = e.id and ${kinds} and ${users})
     order by e.occurred_at desc limit ${limit}`);
  return rows.rows as { id: string; type: string; occurred_at: string; value_cents: string | null; outcome: string | null; source_type: string; source_id: string; context: Record<string, unknown>; owner_name: string | null; weight_bp: number }[];
}

export async function teamUsers(db: DbOrTx, tenantId: string, teamId: string) {
  const r = await db.select({ userId: s.teamMemberships.userId }).from(s.teamMemberships).innerJoin(s.teams, eq(s.teams.id, s.teamMemberships.teamId)).where(and(eq(s.teamMemberships.teamId, teamId), eq(s.teams.tenantId, tenantId)));
  return [...new Set(r.map((x) => x.userId))];
}

export async function indicatorDef(db: DbOrTx, tenantId: string, id: string) {
  const [i] = await db.select().from(s.indicators).where(and(eq(s.indicators.id, id), eq(s.indicators.tenantId, tenantId))).limit(1);
  if (!i) return null;
  const [v] = await db.select().from(s.indicatorVersions).where(and(eq(s.indicatorVersions.indicatorId, id), eq(s.indicatorVersions.version, i.currentVersion))).limit(1);
  return v ? { indicator: i, version: v.version, def: v.def } : null;
}

export async function allIndicators(db: DbOrTx, tenantId: string) {
  const rows = await db.select({ i: s.indicators, v: s.indicatorVersions }).from(s.indicators).innerJoin(s.indicatorVersions, and(eq(s.indicatorVersions.indicatorId, s.indicators.id), eq(s.indicatorVersions.version, s.indicators.currentVersion))).where(eq(s.indicators.tenantId, tenantId)).orderBy(asc(s.indicators.createdAt));
  return rows.map(({ i, v }) => ({ ...i, def: v.def, versionNote: v.note, versionAt: v.createdAt }));
}

// ------------------------------------------------------------------ metas
export type GoalRow = typeof s.goals.$inferSelect;
export async function goalWho(db: DbOrTx, g: Pick<GoalRow, 'scope' | 'userId' | 'teamId' | 'tenantId'>): Promise<Who> {
  if (g.scope === 'empresa') return { users: 'all' };
  if (g.scope === 'equipe' && g.teamId) return { users: await teamUsers(db, g.tenantId, g.teamId) };
  return { users: g.userId ? [g.userId] : [] };
}

export type GoalProgress = { value: number | null; status: GoalStatus; attainment: number | null; expected: number | null; indicatorStatus: IndicatorStatus | 'manual'; closed: boolean; direction: 'maior' | 'menor'; unit: string };

export async function goalProgress(db: DbOrTx, tz: string, today: string, g: GoalRow): Promise<GoalProgress> {
  const range = { from: g.periodStart, to: g.periodEnd };
  const [closed] = await db.select().from(s.goalResults).where(eq(s.goalResults.goalId, g.id)).limit(1);
  let def: IndicatorDef | null = null;
  let version: number | null = null;
  if (g.indicatorId) { const d = await indicatorDef(db, g.tenantId, g.indicatorId); def = d?.def ?? null; version = d?.version ?? null; }
  const direction = def?.direction ?? 'maior';
  const unit = def?.unit ?? g.manualUnit ?? 'quantidade';
  if (closed) return { value: closed.value, status: closed.status as GoalStatus, attainment: closed.attainment, expected: g.target, indicatorStatus: g.indicatorId ? 'ok' : 'manual', closed: true, direction, unit };
  let value: number | null;
  let indicatorStatus: IndicatorStatus | 'manual';
  if (def) {
    const r = await computeIndicator(db, g.tenantId, tz, def, await goalWho(db, g), range);
    value = r.status === 'indisponivel' ? null : r.value;
    indicatorStatus = r.status;
  } else {
    const [c] = await db.select({ value: s.goalCheckins.value }).from(s.goalCheckins).where(eq(s.goalCheckins.goalId, g.id)).orderBy(desc(s.goalCheckins.createdAt)).limit(1);
    value = c?.value ?? null;
    indicatorStatus = 'manual';
  }
  const st = goalStatus(value, g.target, direction, range, today);
  // período encerrado: fecha o resultado (imutável) uma vez só
  if (today > g.periodEnd && g.status === 'ativa') {
    await db.insert(s.goalResults).values({ goalId: g.id, tenantId: g.tenantId, value, target: g.target, attainment: st.attainment, status: st.status, indicatorVersion: version }).onConflictDoNothing();
    await db.insert(s.goalEvents).values({ tenantId: g.tenantId, goalId: g.id, type: 'resultado', payload: { value, target: g.target, status: st.status } });
    return { ...st, value, indicatorStatus, closed: true, direction, unit };
  }
  return { ...st, value, indicatorStatus, closed: false, direction, unit };
}

// ------------------------------------------------------------------ scorecards
export async function applicableScorecards(db: DbOrTx, tenantId: string, userId: string) {
  const [u] = await db.select({ jobTitle: s.users.jobTitle }).from(s.users).where(eq(s.users.id, userId)).limit(1);
  const profiles = (await db.select({ key: s.roles.key }).from(s.userRoles).innerJoin(s.roles, eq(s.roles.id, s.userRoles.roleId)).where(eq(s.userRoles.userId, userId))).map((r) => r.key);
  const teams = (await db.select({ teamId: s.teamMemberships.teamId }).from(s.teamMemberships).where(eq(s.teamMemberships.userId, userId))).map((r) => r.teamId);
  const cards = await db.select({ c: s.scorecards, v: s.scorecardVersions }).from(s.scorecards).innerJoin(s.scorecardVersions, and(eq(s.scorecardVersions.scorecardId, s.scorecards.id), eq(s.scorecardVersions.version, s.scorecards.currentVersion))).where(and(eq(s.scorecards.tenantId, tenantId), eq(s.scorecards.active, true)));
  const explicit = await db.select().from(s.scorecardAssignments).where(and(eq(s.scorecardAssignments.userId, userId), eq(s.scorecardAssignments.tenantId, tenantId)));
  if (explicit.length) return cards.filter(({ c }) => explicit.some((a) => a.scorecardId === c.id)).map((x) => ({ ...x, weight: explicit.find((a) => a.scorecardId === x.c.id)!.weight, source: 'atribuido' as const }));
  return cards
    .filter(({ c }) => c.appliesProfiles.some((p) => profiles.includes(p)) || (!!u?.jobTitle && c.appliesJobTitles.some((j) => j.toLowerCase() === u.jobTitle!.toLowerCase())) || c.appliesTeamIds.some((t) => teams.includes(t)))
    .map((x) => ({ ...x, weight: 100, source: 'regra' as const }));
}

/** Notas dos scorecards de uma pessoa num dia de referência (cada scorecard no seu período). */
export async function scorecardsFor(db: DbOrTx, tenantId: string, tz: string, userId: string, ref: string) {
  const cards = await applicableScorecards(db, tenantId, userId);
  const inds = await allIndicators(db, tenantId);
  const out = [];
  for (const { c, v, weight, source } of cards) {
    const range = periodRange((c.periodicity === 'personalizado' ? 'mes' : c.periodicity) as Exclude<PeriodType, 'personalizado'>, ref);
    const items = [];
    for (const it of normalizeWeights(v.def.items)) {
      const ind = inds.find((i) => i.id === it.indicatorId);
      if (!ind) { items.push({ indicatorId: it.indicatorId, name: '(indicador removido)', weight: it.weight, norm: it.norm, value: null, target: null, attainment: null, status: 'indisponivel' as const, unit: 'quantidade', direction: 'maior' as const }); continue; }
      const r = await computeIndicator(db, tenantId, tz, ind.def, { users: [userId] }, range);
      const [goal] = await db.select({ target: s.goals.target }).from(s.goals).where(and(eq(s.goals.tenantId, tenantId), eq(s.goals.indicatorId, ind.id), eq(s.goals.userId, userId), eq(s.goals.status, 'ativa'), sql`${s.goals.periodStart} <= ${range.to}::date and ${s.goals.periodEnd} >= ${range.from}::date`)).orderBy(desc(s.goals.createdAt)).limit(1);
      const target = goal?.target ?? it.target ?? ind.def.target ?? null;
      const usable = r.status === 'ok' || r.status === 'incompleto';
      items.push({ indicatorId: ind.id, name: ind.def.name, weight: it.weight, norm: it.norm, value: r.value, target, attainment: usable ? attainment(r.value, target, ind.def.direction) : null, status: target === null && usable ? ('sem_meta' as const) : r.status, unit: ind.def.unit, direction: ind.def.direction, sample: r.sample });
    }
    const sc = scorecardScore(items.map((i) => ({ weight: i.weight, attainment: i.attainment, cap: v.def.cap })), v.def.cap ?? DEFAULT_CAP);
    out.push({ scorecardId: c.id, name: c.name, version: v.version, range, weight, source, ...sc, items });
  }
  return { cards: out, composite: compositeScore(out.map((c) => ({ score: c.score, weight: c.weight }))) };
}

