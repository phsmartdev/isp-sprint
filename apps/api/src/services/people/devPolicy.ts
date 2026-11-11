/**
 * Pessoas & Gestão — política de desenvolvimento, versionada (a vigente vale; as anteriores ficam para o histórico).
 * Cada funcionalidade acrescenta a sua parte (F1: feedback situacional; F2: 1:1; F6: metas e IGDP…).
 */
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as s from '../../db/schema';
import type { DbOrTx } from '../../db/client';

export const FEEDBACK_MODALITIES = {
  reconhecimento: 'Reconhecimento', orientacao: 'Orientação', melhoria: 'Oportunidade de melhoria',
  reforco: 'Reforço de comportamento', desenvolvimento: 'Desenvolvimento', alinhamento: 'Alinhamento de expectativas',
} as const;
export type FeedbackModality = keyof typeof FEEDBACK_MODALITIES;

export const DevPolicyConfig = z.object({
  feedback: z.object({
    /** modalidades disponíveis no formulário */
    modalities: z.array(z.enum(Object.keys(FEEDBACK_MODALITIES) as [FeedbackModality])).min(1).default(Object.keys(FEEDBACK_MODALITIES) as FeedbackModality[]),
    /** feedback do liderado para a liderança: só confidencial (mediado pelo RH) ou também identificado */
    ascendingModes: z.array(z.enum(['confidencial', 'identificado'])).min(1).default(['confidencial']),
    /** tamanho mínimo de situação, comportamento e impacto (evita registros genéricos) */
    minChars: z.number().int().min(10).max(500).default(30),
    /** a liderança pode ver quem enviou o feedback ascendente identificado (sempre); o confidencial nunca */
  }).default({}),
}).default({});
export type DevPolicyConfig = z.infer<typeof DevPolicyConfig>;

export async function currentDevPolicy(db: DbOrTx, tenantId: string) {
  const [p] = await db.select().from(s.devPolicies).where(eq(s.devPolicies.tenantId, tenantId)).orderBy(desc(s.devPolicies.version)).limit(1);
  const parsed = DevPolicyConfig.safeParse(p?.config ?? {});
  return { version: p?.version ?? 0, effectiveFrom: p?.effectiveFrom ?? null, config: parsed.success ? parsed.data : DevPolicyConfig.parse({}) };
}
