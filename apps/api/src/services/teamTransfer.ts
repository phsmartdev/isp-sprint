/**
 * Trabalho em aberto de um time (metas ativas, objetivos ativos, intervenções abertas, rituais ativos e projetos não encerrados)
 * passa para outro time — ao excluir o time ou depois, para um time já excluído. O histórico (eventos, oportunidades) fica onde está.
 */
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export type TeamWork = { goals: number; objectives: number; interventions: number; rituals: number; projects: number };
const OPEN_IV = ['aberta', 'em_andamento'];
const CLOSED_PROJECT = ['concluido', 'cancelado'];

export async function openTeamWork(db: DbOrTx, tenantId: string, teamId: string): Promise<TeamWork> {
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const c = sql<number>`count(*)::int`;
  return {
    goals: await n(db.select({ n: c }).from(s.goals).where(and(eq(s.goals.tenantId, tenantId), eq(s.goals.teamId, teamId), eq(s.goals.status, 'ativa')))),
    objectives: await n(db.select({ n: c }).from(s.objectives).where(and(eq(s.objectives.tenantId, tenantId), eq(s.objectives.teamId, teamId), eq(s.objectives.status, 'ativo')))),
    interventions: await n(db.select({ n: c }).from(s.interventions).where(and(eq(s.interventions.tenantId, tenantId), eq(s.interventions.teamId, teamId), inArray(s.interventions.status, OPEN_IV)))),
    rituals: await n(db.select({ n: c }).from(s.rituals).where(and(eq(s.rituals.tenantId, tenantId), eq(s.rituals.teamId, teamId), eq(s.rituals.active, true)))),
    projects: await n(db.select({ n: c }).from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.teamId, teamId), notInArray(s.projects.status, CLOSED_PROJECT)))),
  };
}

export async function transferTeamWork(tx: DbOrTx, tenantId: string, fromId: string, toId: string): Promise<TeamWork> {
  const cnt = async (q: Promise<unknown[]>) => (await q).length;
  const r = { id: sql`id` };
  return {
    goals: await cnt(tx.update(s.goals).set({ teamId: toId }).where(and(eq(s.goals.tenantId, tenantId), eq(s.goals.teamId, fromId), eq(s.goals.status, 'ativa'))).returning(r)),
    objectives: await cnt(tx.update(s.objectives).set({ teamId: toId }).where(and(eq(s.objectives.tenantId, tenantId), eq(s.objectives.teamId, fromId), eq(s.objectives.status, 'ativo'))).returning(r)),
    interventions: await cnt(tx.update(s.interventions).set({ teamId: toId }).where(and(eq(s.interventions.tenantId, tenantId), eq(s.interventions.teamId, fromId), inArray(s.interventions.status, OPEN_IV))).returning(r)),
    rituals: await cnt(tx.update(s.rituals).set({ teamId: toId }).where(and(eq(s.rituals.tenantId, tenantId), eq(s.rituals.teamId, fromId), eq(s.rituals.active, true))).returning(r)),
    projects: await cnt(tx.update(s.projects).set({ teamId: toId }).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.teamId, fromId), notInArray(s.projects.status, CLOSED_PROJECT))).returning(r)),
  };
}

export const workTotal = (w: TeamWork) => w.goals + w.objectives + w.interventions + w.rituals + w.projects;
