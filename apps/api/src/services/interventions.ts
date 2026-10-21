/**
 * Gestão de Times — Fase 5: intervenções derivadas da apuração oficial (`result_closings`).
 * Projeção idempotente, como os eventos de negócio: lê a versão vigente de cada competência, decide pela regra do domínio
 * e grava abertura, promoção, reincidência, dispensa por retificação e escalonamento — nunca duplica (índice único por série aberta).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  DEFAULT_INTERVENTION_CONFIG, OPEN_INTERVENTION, addDaysIso, escalationLevel, interventionAction, interventionNeed,
  type InterventionConfig, type InterventionKind, type TrafficColor,
} from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { orgData } from './results';
import { performanceConfig } from './businessEvents';

type Org = Awaited<ReturnType<typeof orgData>>;
type Goal = typeof s.goals.$inferSelect;

export function ancestorsResponsibles(org: Org, unitId: string | null) {
  const out: string[] = [];
  let cur = unitId ? org.units.find((u) => u.id === unitId) : undefined;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.active && cur.responsibleId) out.push(cur.responsibleId);
    cur = cur.parentId ? org.units.find((u) => u.id === cur!.parentId) : undefined;
  }
  return out;
}
export const teamLead = (org: Org, teamId: string) => org.members.find((m) => m.teamId === teamId && m.isLead)?.userId ?? org.teams.find((t) => t.id === teamId)?.substituteLeadId ?? null;

/**
 * Quem responde pela intervenção e a cadeia acima dele (escalonamento), pela estrutura — não pelo cargo.
 * Individual → líder do time da pessoa; Time → líder; Unidade → responsável; Empresa → responsável da diretoria.
 */
export function responsibilityChain(org: Org, g: Goal) {
  const roots = org.units.filter((u) => u.active && u.kind === 'diretoria' && !u.parentId).map((u) => u.responsibleId).filter(Boolean) as string[];
  let people: (string | null)[] = [];
  let teamId: string | null = g.teamId;
  if (g.scope === 'individual' && g.userId) {
    const mine = org.members.filter((m) => m.userId === g.userId);
    const t = mine.find((m) => !m.isLead) ?? mine[0];
    teamId = t?.teamId ?? null;
    const lead = teamId ? teamLead(org, teamId) : null;
    people = [lead && lead !== g.userId ? lead : null, ...ancestorsResponsibles(org, teamId ? org.teams.find((x) => x.id === teamId)?.orgUnitId ?? null : null)];
  } else if (g.scope === 'equipe' && g.teamId) {
    people = [teamLead(org, g.teamId), ...ancestorsResponsibles(org, org.teams.find((x) => x.id === g.teamId)?.orgUnitId ?? null)];
  } else if (g.scope === 'unidade' && g.orgUnitId) {
    people = ancestorsResponsibles(org, g.orgUnitId);
  }
  people.push(...roots);
  const chain = [...new Set(people.filter((p): p is string => !!p && p !== g.userId))];
  const owner = chain[0] ?? g.ownerId;
  const orgUnitId = g.orgUnitId ?? (teamId ? org.teams.find((x) => x.id === teamId)?.orgUnitId ?? null : null);
  return { ownerId: owner, chain: chain.filter((p) => p !== owner), teamId, orgUnitId };
}

const cfgOf = (c: { interventions?: InterventionConfig }) => ({ ...DEFAULT_INTERVENTION_CONFIG, ...(c.interventions ?? {}) });
const BAD: TrafficColor[] = ['vermelho', 'amarelo'];

export async function logIntervention(db: DbOrTx, tenantId: string, interventionId: string, type: string, payload: Record<string, unknown>, notify: (string | null | undefined)[], actorId: string | null) {
  await db.insert(s.interventionEvents).values({ tenantId, interventionId, type, payload, notify: [...new Set(notify.filter((x): x is string => !!x && x !== actorId))], actorId });
}

const lastSync = new Map<string, number>();
/** Executa a projeção se a última tiver mais de 1 minuto (telas) — a rotina diária chama direto. */
export async function ensureFreshInterventions(db: DbOrTx, tenantId: string, today: string) {
  const at = lastSync.get(tenantId) ?? 0;
  if (Date.now() - at < 60_000) return null;
  lastSync.set(tenantId, Date.now());
  return syncInterventions(db, tenantId, today);
}

export async function syncInterventions(db: DbOrTx, tenantId: string, today: string, seriesIds?: string[]) {
  const { config } = await performanceConfig(db, tenantId);
  const cfg = cfgOf(config);
  const since = addDaysIso(today, -150).slice(0, 7);
  // versão vigente de cada competência por série
  const cur = await db.execute<{ id: string; goal_id: string; series_id: string; competencia: string; color: TrafficColor; attainment: number | null }>(sql`
    select distinct on (rc.series_id, rc.competencia) rc.id, rc.goal_id, rc.series_id, rc.competencia, rc.color, rc.attainment
      from result_closings rc
     where rc.tenant_id = ${tenantId} and rc.series_id is not null and rc.competencia >= ${since}
       ${seriesIds?.length ? sql`and rc.series_id in (${sql.join(seriesIds.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``}
     order by rc.series_id, rc.competencia, rc.version desc`);
  const bySeries = new Map<string, typeof cur.rows>();
  for (const r of cur.rows) bySeries.set(r.series_id, [...(bySeries.get(r.series_id) ?? []), r]);
  const series = [...bySeries.keys()];
  const existing = series.length ? await db.select().from(s.interventions).where(and(eq(s.interventions.tenantId, tenantId), inArray(s.interventions.seriesId, series))) : [];
  const goalIds = [...new Set(cur.rows.map((r) => r.goal_id))];
  const goals = goalIds.length ? await db.select().from(s.goals).where(inArray(s.goals.id, goalIds)) : [];
  const org = await orgData(db, tenantId);
  const out = { opened: 0, promoted: 0, recurrences: 0, dismissed: 0, escalated: 0 };

  for (const [seriesId, rowsAsc] of bySeries) {
    const hist = [...rowsAsc].sort((a, b) => a.competencia.localeCompare(b.competencia));
    const g = goals.find((x) => x.id === hist[hist.length - 1]!.goal_id);
    if (!g || g.status === 'cancelada') continue;
    const mine = existing.filter((i) => i.seriesId === seriesId);
    const open = mine.find((i) => OPEN_INTERVENTION.includes(i.status as 'aberta'));
    const colorOf = (c: string) => hist.find((h) => h.competencia === c)?.color;

    // retificação: se nenhuma competência coberta pede mais intervenção, a aberta é dispensada automaticamente
    if (open && open.trigger !== 'manual' && open.competencias.every((c) => { const col = colorOf(c); return col !== undefined && !BAD.includes(col); })) {
      await db.update(s.interventions).set({ status: 'dispensada', conclusion: 'Apuração retificada: as competências cobertas deixaram de pedir intervenção.', resolvedAt: new Date(), updatedAt: new Date(), rowVersion: sql`${s.interventions.rowVersion} + 1` }).where(eq(s.interventions.id, open.id));
      await logIntervention(db, tenantId, open.id, 'dispensada_retificacao', { competencias: open.competencias }, [open.ownerId], null);
      out.dismissed++;
      continue;
    }
    // avalia as duas últimas competências em ordem (cobre retificação do mês anterior e a regra dos dois amarelos), sem reabrir histórico antigo
    let cur: { id: string; kind: string; competencias: string[]; ownerId: string; escalationChain: string[]; escalationLevel: number } | null = open ?? null;
    for (let k = Math.max(0, hist.length - 2); k < hist.length; k++) {
      const point = hist[k]!;
      const need = interventionNeed(hist.slice(0, k + 1).map((h) => ({ competencia: h.competencia, color: h.color })));
      // competência já tratada (intervenção concluída/dispensada que a cobriu) não reabre
      if (need && !cur && mine.some((x) => x.competencias.includes(need.competencia))) continue;
      const act = interventionAction(need, cur ? { kind: cur.kind as InterventionKind, competencias: cur.competencias } : null);
      const pg = goals.find((x) => x.id === point.goal_id) ?? g;
      if (act.do === 'criar') {
        const r = responsibilityChain(org, pg);
        const [row] = await db.insert(s.interventions).values({
          tenantId, seriesId, goalId: pg.id, closingId: point.id, kind: act.kind, trigger: act.trigger, competencias: [act.competencia],
          ownerId: r.ownerId, subjectUserId: pg.userId, teamId: r.teamId, orgUnitId: r.orgUnitId, escalationChain: r.chain,
          dueOn: addDaysIso(today, act.kind === 'plano' ? cfg.planDays : cfg.reviewDays),
        }).onConflictDoNothing().returning({ id: s.interventions.id });
        if (row) {
          await logIntervention(db, tenantId, row.id, 'aberta', { kind: act.kind, trigger: act.trigger, competencia: act.competencia, attainment: point.attainment }, [r.ownerId], null);
          out.opened++;
          cur = { id: row.id, kind: act.kind, competencias: [act.competencia], ownerId: r.ownerId, escalationChain: r.chain, escalationLevel: 0 };
        }
      } else if (act.do === 'promover' && cur) {
        const comps = cur.competencias.includes(act.competencia) ? cur.competencias : [...cur.competencias, act.competencia];
        await db.update(s.interventions).set({ kind: 'plano', trigger: act.trigger, status: 'aberta', competencias: comps, goalId: pg.id, closingId: point.id, dueOn: addDaysIso(today, cfg.planDays), updatedAt: new Date(), rowVersion: sql`${s.interventions.rowVersion} + 1` }).where(eq(s.interventions.id, cur.id));
        await logIntervention(db, tenantId, cur.id, 'promovida', { trigger: act.trigger, competencia: act.competencia }, [cur.ownerId], null);
        out.promoted++;
        cur = { ...cur, kind: 'plano', competencias: comps };
      } else if (act.do === 'reincidencia' && cur) {
        const comps = [...cur.competencias, act.competencia];
        await db.update(s.interventions).set({ competencias: comps, goalId: pg.id, closingId: point.id, updatedAt: new Date(), rowVersion: sql`${s.interventions.rowVersion} + 1` }).where(eq(s.interventions.id, cur.id));
        await logIntervention(db, tenantId, cur.id, 'reincidencia', { trigger: act.trigger, competencia: act.competencia, attainment: point.attainment }, [cur.ownerId, ...cur.escalationChain.slice(0, Math.max(1, cur.escalationLevel))], null);
        out.recurrences++;
        cur = { ...cur, competencias: comps };
      }
    }
  }

  // escalonamento: prazo vencido sobe na cadeia (só aumenta; quem já foi acionado continua acompanhando)
  const opens = await db.select().from(s.interventions).where(and(eq(s.interventions.tenantId, tenantId), inArray(s.interventions.status, OPEN_INTERVENTION), ...(seriesIds?.length ? [inArray(s.interventions.seriesId, seriesIds)] : [])));
  for (const i of opens) {
    const due = i.status === 'aberta' ? i.dueOn : i.planDueOn ?? i.dueOn;
    const lvl = escalationLevel(due, today, cfg.escalateAfterDays, i.escalationChain.length);
    if (lvl > i.escalationLevel) {
      const upd = await db.update(s.interventions).set({ escalationLevel: lvl, updatedAt: new Date(), rowVersion: sql`${s.interventions.rowVersion} + 1` }).where(and(eq(s.interventions.id, i.id), eq(s.interventions.escalationLevel, i.escalationLevel))).returning({ id: s.interventions.id });
      if (upd.length) {
        await logIntervention(db, tenantId, i.id, 'escalada', { level: lvl, to: i.escalationChain.slice(i.escalationLevel, lvl), due, stage: i.status }, [i.ownerId, ...i.escalationChain.slice(i.escalationLevel, lvl)], null);
        out.escalated++;
      }
    }
  }
  return out;
}
