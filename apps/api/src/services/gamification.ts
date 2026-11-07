/** Regra de pontuação da gamificação (versões; vale a aprovada mais recente). */
import { desc, eq } from 'drizzle-orm';
import type { GamificationSettings } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

/**
 * Proposta inicial (versão 1, status proposta): só vale depois de aprovada. Níveis de competência da estrutura comercial
 * (apoio, execução, contas, liderança, gerência), bônus de pontualidade e aderência e crédito extra acima da alçada.
 */
export const GAMIFICATION_START: GamificationSettings = {
  journeys: [],
  teamIds: [],
  points: { lead_qualificado: 5, oportunidade_criada: 2, proposta_enviada: 5, negociacao_ganha: 30, venda_validada: 20, contrato_assinado: 10, contrato_renovado: 15, acompanhamento_registrado: 3, abm_interacao: 2, abm_oportunidade_gerada: 10 },
  participationMultiplierBp: 15_000,
  competencyLevels: [
    { key: 'n1', name: 'N1 · Apoio (assistente)', rank: 1, expectedMonthlyPoints: 60, scoresTasks: true, weights: { ownBp: 6_000, teamBp: 4_000, dispersionBp: 0, areaBp: 0 } },
    { key: 'n2', name: 'N2 · Execução (analista)', rank: 2, expectedMonthlyPoints: 100, scoresTasks: true, weights: { ownBp: 6_000, teamBp: 4_000, dispersionBp: 0, areaBp: 0 } },
    { key: 'n3', name: 'N3 · Contas (executivo de contas)', rank: 3, expectedMonthlyPoints: 120, scoresTasks: true, weights: { ownBp: 6_000, teamBp: 4_000, dispersionBp: 0, areaBp: 0 } },
    { key: 'n4', name: 'N4 · Liderança (supervisão)', rank: 4, expectedMonthlyPoints: 100, scoresTasks: true, weights: { ownBp: 3_000, teamBp: 5_000, dispersionBp: 2_000, areaBp: 0 } },
    { key: 'n5', name: 'N5 · Gerência', rank: 5, expectedMonthlyPoints: 0, scoresTasks: false, weights: { ownBp: 0, teamBp: 4_000, dispersionBp: 0, areaBp: 6_000 } },
  ],
  assignments: {}, defaultLevelKey: 'n2', defaultLeadLevelKey: 'n4',
  bonuses: { onTimeBp: 2_000, adherenceBp: 3_000, extraPerLevelBp: 2_500, extraCapBp: 3_000, scoreCapBp: 13_000 },
  dispersionYellowBp: 3_000, dispersionRedBp: 5_000,
  levels: [{ name: 'Bronze', minPoints: 0 }, { name: 'Prata', minPoints: 80 }, { name: 'Ouro', minPoints: 100 }, { name: 'Diamante', minPoints: 120 }],
  // performance por nível: quem sobe na hierarquia pesa mais o coletivo
  performanceWeights: {
    n1: { activity: 5_000, individual: 3_000, team: 2_000, unit: 0, company: 0 },
    n2: { activity: 4_000, individual: 3_500, team: 2_500, unit: 0, company: 0 },
    n3: { activity: 3_000, individual: 4_500, team: 2_500, unit: 0, company: 0 },
    n4: { activity: 1_500, individual: 1_500, team: 4_500, unit: 2_500, company: 0 },
    n5: { activity: 0, individual: 0, team: 2_500, unit: 4_500, company: 3_000 },
  },
  performanceBands: { greenBp: 10_000, yellowBp: 8_000 },
};

const asSettings = (c: Record<string, unknown>) => ({ ...GAMIFICATION_START, ...(c as Partial<GamificationSettings>) });
/** Regra vigente = a aprovada mais recente (null enquanto nenhuma foi aprovada) e a proposta pendente, se houver. */
export async function gamificationSettingsOf(db: DbOrTx, tenantId: string) {
  let rows = await db.select().from(s.gamificationSettings).where(eq(s.gamificationSettings.tenantId, tenantId)).orderBy(desc(s.gamificationSettings.version));
  if (!rows.length) {
    await db.insert(s.gamificationSettings).values({ tenantId, version: 1, config: GAMIFICATION_START as unknown as Record<string, unknown>, note: 'Proposta inicial', status: 'proposta' }).onConflictDoNothing();
    rows = await db.select().from(s.gamificationSettings).where(eq(s.gamificationSettings.tenantId, tenantId)).orderBy(desc(s.gamificationSettings.version));
  }
  const approved = rows.find((r) => r.status === 'aprovada') ?? null;
  const pending = rows.find((r) => r.status === 'proposta' && (!approved || r.version > approved.version)) ?? null;
  return {
    settings: approved ? asSettings(approved.config) : null, version: approved?.version ?? null,
    proposal: pending ? { version: pending.version, settings: asSettings(pending.config), note: pending.note, createdBy: pending.createdBy, createdAt: pending.createdAt } : null,
    lastVersion: rows[0]!.version,
  };
}

