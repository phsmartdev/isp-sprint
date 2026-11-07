/** Regra de pontuação da gamificação (versões; vale a aprovada mais recente). */
import { desc, eq } from 'drizzle-orm';
import type { GamificationSettings } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

/** Proposta inicial (versão 1, status proposta): só vale depois de aprovada. Reconhece venda e ajuda ao colega; liderança pesa mais o time. */
export const GAMIFICATION_START: GamificationSettings = {
  journeys: [],
  teamIds: [],
  points: { lead_qualificado: 5, oportunidade_criada: 2, proposta_enviada: 5, negociacao_ganha: 30, venda_validada: 20, contrato_assinado: 10, contrato_renovado: 15, acompanhamento_registrado: 3, abm_interacao: 2, abm_oportunidade_gerada: 10 },
  participationMultiplierBp: 15_000, hierarchyWeights: { colaborador: { ownBp: 5_000, teamBp: 5_000 }, lideranca: { ownBp: 2_000, teamBp: 8_000 } }, dispersionYellowBp: 3_000, dispersionRedBp: 5_000,
  levels: [{ name: 'Bronze', minPoints: 0 }, { name: 'Prata', minPoints: 300 }, { name: 'Ouro', minPoints: 800 }, { name: 'Diamante', minPoints: 1500 }],
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

