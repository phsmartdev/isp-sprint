/**
 * ABM Fase 6 — sincronização dos sinais (abre, atualiza, resolve sozinho) e geração das tarefas das cadências.
 * Roda na rotina diária e, no máximo a cada 10 minutos, quando alguém abre a central de sinais.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { OPEN_SIGNAL, coverageOf, evaluateSignals, nextCadence, type AbmPriority, type InfluenceLevel, type RelationshipStrength, type StakeholderRole, type Stance } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

const ids = (xs: string[]) => sql.join(xs.map((x) => sql`${x}::uuid`), sql`, `);
const ACTIVE_ACCOUNT = ['selecionada', 'em_planejamento', 'ativa', 'em_acompanhamento'];
const lastRun = new Map<string, number>();

export async function syncAbmSignals(db: DbOrTx, tenantId: string, today: string, onlyContactId?: string) {
  const accs = await db.select().from(s.abmAccounts).where(and(eq(s.abmAccounts.tenantId, tenantId), sql`${s.abmAccounts.status} not in ('pausada', 'encerrada')`, onlyContactId ? eq(s.abmAccounts.contactId, onlyContactId) : undefined));
  if (!accs.length) return { opened: 0, resolved: 0 };
  const cids = accs.map((a) => a.contactId);
  const [inter, people, infl, units, runs, ctrs, opps, objs, nps] = await Promise.all([
    db.execute<{ contact_id: string; d: string }>(sql`select contact_id, max(completed_at)::date::text as d from activities where contact_id in (${ids(cids)}) and deleted_at is null and status = 'concluida' group by contact_id`),
    db.select({ id: s.accountStakeholders.id, contactId: s.accountStakeholders.contactId, name: s.people.name, next: s.accountStakeholders.nextInteractionOn, roles: s.accountStakeholders.roles, rel: s.accountStakeholders.relationshipStrength, stance: s.accountStakeholders.stance, unitId: s.accountStakeholders.unitId })
      .from(s.accountStakeholders).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).where(and(inArray(s.accountStakeholders.contactId, cids), eq(s.accountStakeholders.active, true))),
    db.select({ st: s.stakeholderInfluence.stakeholderId, level: s.stakeholderInfluence.level }).from(s.stakeholderInfluence).where(and(eq(s.stakeholderInfluence.tenantId, tenantId), eq(s.stakeholderInfluence.contextType, 'conta'))),
    db.select({ contactId: s.accountOrgUnits.contactId, n: sql<number>`count(*)::int` }).from(s.accountOrgUnits).where(and(inArray(s.accountOrgUnits.contactId, cids), eq(s.accountOrgUnits.active, true))).groupBy(s.accountOrgUnits.contactId),
    db.execute<{ id: string; contact_id: string; play: string; late: number }>(sql`select pr.id, pr.contact_id, p.name as play, count(*)::int as late from abm_play_runs pr join abm_plays p on p.id = pr.play_id join abm_play_run_steps r on r.run_id = pr.id join activities a on a.id = r.activity_id
      where pr.contact_id in (${ids(cids)}) and pr.status = 'em_andamento' and a.deleted_at is null and a.status not in ('concluida', 'cancelada') and a.due_at::date < ${today}::date group by pr.id, pr.contact_id, p.name`),
    db.execute<{ id: string; contact_id: string; code: number; number: string | null; end_at: string }>(sql`select k.id, k.contact_id, k.code, v.number, v.end_at::text from contracts k join contract_versions v on v.contract_id = k.id and v.version = k.current_version where k.contact_id in (${ids(cids)}) and k.stage in ('implantacao', 'vigente', 'renovacao', 'reajuste') and v.end_at is not null`),
    db.execute<{ id: string; contact_id: string; code: number; title: string; days: number }>(sql`select id, contact_id, code, title, (${today}::date - stage_changed_at::date)::int as days from opportunities where contact_id in (${ids(cids)}) and deleted_at is null and stage not in ('ganha', 'perdida') and stage_changed_at::date < ${today}::date - 30`),
    db.select({ id: s.abmObjectives.id, abmId: s.abmObjectives.abmId, title: s.abmObjectives.title, dueOn: s.abmObjectives.dueOn }).from(s.abmObjectives).where(and(inArray(s.abmObjectives.abmId, accs.map((a) => a.id)), inArray(s.abmObjectives.status, ['planejado', 'em_andamento']), sql`${s.abmObjectives.dueOn} is not null`)),
    db.execute<{ id: string; contact_id: string; score: number; on: string }>(sql`select id, contact_id, score, responded_at::text as on from cs_surveys where contact_id in (${ids(cids)}) and kind = 'NPS' and scale = 10 and score <= 6 and responded_at >= ${today}::date - 90`),
  ]);
  const inf = new Map(infl.map((i) => [i.st, i.level as InfluenceLevel]));
  const existing = await db.select().from(s.abmSignals).where(and(eq(s.abmSignals.tenantId, tenantId), onlyContactId ? eq(s.abmSignals.contactId, onlyContactId) : undefined));
  let opened = 0, resolved = 0;
  const now = new Date();
  for (const a of accs) {
    const ppl = people.filter((p) => p.contactId === a.contactId);
    const last = inter.rows.find((r) => r.contact_id === a.contactId)?.d ?? null;
    const daysSince = last ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${last}T12:00:00Z`)) / 86_400_000) : null;
    const cov = coverageOf(ppl.map((p) => ({ roles: p.roles as StakeholderRole[], influence: inf.get(p.id) ?? 'nao_avaliado', relationship: p.rel as RelationshipStrength, stance: p.stance as Stance, unitId: p.unitId, active: true })), units.find((u) => u.contactId === a.contactId)?.n ?? 0, true);
    const cands = evaluateSignals({
      priority: a.priority as AbmPriority, today, daysSinceInteraction: daysSince, accountCreatedOn: a.createdAt.toISOString().slice(0, 10),
      people: ppl.map((p) => ({ id: p.id, name: p.name, nextInteractionOn: p.next, key: (p.roles as string[]).includes('decisor') || ['alto', 'muito_alto'].includes(inf.get(p.id) ?? '') })),
      lateRuns: runs.rows.filter((r) => r.contact_id === a.contactId).map((r) => ({ id: r.id, play: r.play, lateSteps: r.late })),
      contracts: ctrs.rows.filter((r) => r.contact_id === a.contactId).map((r) => ({ id: r.id, label: `CT-${r.code}${r.number ? ` (${r.number})` : ''}`, endAt: r.end_at })),
      staleOpps: opps.rows.filter((r) => r.contact_id === a.contactId).map((r) => ({ id: r.id, label: `OP-${r.code} · ${r.title}`, days: r.days })),
      objectives: objs.filter((o) => o.abmId === a.id).map((o) => ({ id: o.id, title: o.title, dueOn: o.dueOn! })),
      coverage: cov.score, active: ACTIVE_ACCOUNT.includes(a.status),
      detractors: nps.rows.filter((r) => r.contact_id === a.contactId).map((r) => ({ id: r.id, score: r.score, on: r.on })),
    });
    const mine = existing.filter((e) => e.abmId === a.id);
    for (const c of cands) {
      const open = mine.find((e) => e.key === c.key && OPEN_SIGNAL.includes(e.status as never));
      if (open) { await db.update(s.abmSignals).set({ title: c.title, detail: c.detail, severity: c.severity, ref: c.ref, lastSeenAt: now }).where(eq(s.abmSignals.id, open.id)); continue; }
      if (mine.some((e) => e.key === c.key && e.suppressUntil && e.suppressUntil > now)) continue;
      const [row] = await db.insert(s.abmSignals).values({ tenantId, abmId: a.id, contactId: a.contactId, kind: c.kind, key: c.key, severity: c.severity, title: c.title, detail: c.detail, ref: c.ref, ownerId: a.ownerId }).onConflictDoNothing().returning({ id: s.abmSignals.id });
      if (row) { opened++; await db.insert(s.abmSignalEvents).values({ tenantId, signalId: row.id, type: 'detectado', note: c.title }); }
    }
    // condição deixou de existir: resolve sozinho (sinais registrados pela equipe ficam até alguém encerrar)
    for (const e of mine.filter((x) => OPEN_SIGNAL.includes(x.status as never) && x.kind !== 'manual' && !cands.some((c) => c.key === x.key))) {
      await db.update(s.abmSignals).set({ status: 'resolvido', closedAt: now, resolution: 'A condição deixou de existir.', rowVersion: e.rowVersion + 1 }).where(eq(s.abmSignals.id, e.id));
      await db.insert(s.abmSignalEvents).values({ tenantId, signalId: e.id, type: 'resolvido', note: 'A condição deixou de existir.' });
      resolved++;
    }
  }
  if (onlyContactId) return { opened, resolved };
  // contas pausadas/encerradas: sinais automáticos abertos saem
  await db.update(s.abmSignals).set({ status: 'resolvido', closedAt: now, resolution: 'Conta pausada ou encerrada no ABM.' })
    .where(and(eq(s.abmSignals.tenantId, tenantId), inArray(s.abmSignals.status, ['novo', 'em_analise']), sql`${s.abmSignals.kind} <> 'manual'`, sql`${s.abmSignals.abmId} in (select id from abm_accounts where status in ('pausada', 'encerrada'))`));
  return { opened, resolved };
}

/** Gera a próxima tarefa de cada cadência ativa (idempotente por cadência e data). */
export async function generateAbmCadences(db: DbOrTx, tenantId: string, today: string, timezone: string, onlyId?: string) {
  const cads = await db.select().from(s.abmCadences).innerJoin(s.abmAccounts, eq(s.abmAccounts.id, s.abmCadences.abmId))
    .where(and(eq(s.abmCadences.tenantId, tenantId), eq(s.abmCadences.active, true), sql`${s.abmAccounts.status} not in ('pausada', 'encerrada')`, onlyId ? eq(s.abmCadences.id, onlyId) : undefined));
  let created = 0;
  for (const { abm_cadences: c } of cads) {
    const st = await db.execute<{ last_done: string | null; open: number }>(sql`select max(a.completed_at)::date::text as last_done, count(*) filter (where a.deleted_at is null and a.status not in ('concluida', 'cancelada'))::int as open
      from abm_cadence_tasks t join activities a on a.id = t.activity_id where t.cadence_id = ${c.id}`);
    const n = nextCadence({ startOn: c.startOn, everyDays: c.everyDays, lastDoneOn: st.rows[0]?.last_done ?? null, hasOpen: (st.rows[0]?.open ?? 0) > 0 }, today);
    if (!n.generate) continue;
    const [person] = c.stakeholderId ? await db.select({ name: s.people.name }).from(s.accountStakeholders).innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId)).where(eq(s.accountStakeholders.id, c.stakeholderId)).limit(1) : [];
    const [act] = await db.insert(s.activities).values({
      tenantId, type: c.type, title: person ? `${c.title} — ${person.name}` : c.title, notes: `Cadência ABM: a cada ${c.everyDays} dia(s). Ao concluir, registre o que foi conversado; a próxima tarefa nasce sozinha.`,
      priority: 'media', ownerId: c.ownerId, createdBy: c.createdBy, contactId: c.contactId, dueAt: sql`((${n.dueOn}::date + time '18:00') at time zone ${timezone})` as unknown as Date,
      status: 'a_fazer', category: 'Cadência ABM', tags: ['abm', 'cadencia'], stakeholderIds: c.stakeholderId ? [c.stakeholderId] : [],
    }).returning({ id: s.activities.id });
    const [link] = await db.insert(s.abmCadenceTasks).values({ tenantId, cadenceId: c.id, dueOn: n.dueOn, activityId: act!.id }).onConflictDoNothing().returning({ id: s.abmCadenceTasks.id });
    if (!link) { await db.delete(s.activities).where(eq(s.activities.id, act!.id)); continue; }
    await db.insert(s.activityEvents).values({ tenantId, activityId: act!.id, type: 'created', actorId: null, payload: { cadenceId: c.id } });
    created++;
  }
  return { created };
}

export async function runAbmDaily(db: DbOrTx, tenantId: string, today: string, timezone: string) {
  const cad = await generateAbmCadences(db, tenantId, today, timezone);
  const sig = await syncAbmSignals(db, tenantId, today);
  lastRun.set(tenantId, Date.now());
  return { ...cad, ...sig };
}
/** Atualiza sinais e cadências se a última execução tiver mais de 10 minutos. */
export async function ensureFreshAbm(db: DbOrTx, tenantId: string, today: string, timezone: string) {
  if (Date.now() - (lastRun.get(tenantId) ?? 0) < 10 * 60_000) return;
  await runAbmDaily(db, tenantId, today, timezone);
}
