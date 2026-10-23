/** Exigências para entrar numa etapa (definidas no modelo de instrução, por jornada). */
import { and, eq, isNull } from 'drizzle-orm';
import type { Instruction } from '@isp/shared';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export type Requirements = { proposta?: boolean; plano?: boolean; proximaAcao?: boolean; respostasObrigatorias?: boolean };
type Opp = { id: string; pipelineId: string; planId: string | null; valueCents?: number | null; nextAction: string | null; nextActionAt: Date | null };

export async function checkStageRequirements(db: DbOrTx, tenantId: string, opp: Opp, target: { key: string; requirements: Requirements }, instruction: Instruction, pipelineKey: string) {
  const r = target.requirements ?? {};
  const issues: { path: string; message: string }[] = [];
  // "plano" = a oportunidade tem valor: plano do catálogo, itens lançados ou itens da ata
  if (r.plano && !opp.planId && !(opp.valueCents && opp.valueCents > 0)) {
    // oportunidade de ata: o produto são os itens da ata reservados
    const [line] = await db.select({ id: s.arpOpportunityLines.id }).from(s.arpOpportunityLines).where(and(eq(s.arpOpportunityLines.opportunityId, opp.id), eq(s.arpOpportunityLines.tenantId, tenantId))).limit(1);
    if (!line) issues.push({ path: 'requirements.plano', message: 'Defina o valor da oportunidade (plano ou itens) antes de avançar.' });
  }
  if (r.proximaAcao && (!opp.nextAction || !opp.nextActionAt)) issues.push({ path: 'requirements.proximaAcao', message: 'Defina a próxima ação e quando ela acontece.' });
  if (r.proposta) {
    const [a] = await db
      .select({ id: s.opportunityAttachments.id })
      .from(s.opportunityAttachments)
      .where(and(eq(s.opportunityAttachments.opportunityId, opp.id), eq(s.opportunityAttachments.tenantId, tenantId), eq(s.opportunityAttachments.kind, 'proposta'), isNull(s.opportunityAttachments.deletedAt)))
      .limit(1);
    if (!a) issues.push({ path: 'requirements.proposta', message: 'Anexe a proposta antes de avançar.' });
  }
  if (r.respostasObrigatorias) {
    const journey = instruction.jornadas.find((j) => j.chave === pipelineKey);
    const idx = journey?.etapas.findIndex((e) => e.chave === target.key) ?? -1;
    const required = (journey?.etapas.slice(0, Math.max(0, idx)) ?? []).flatMap((e) => e.perguntas.filter((q) => q.obrigatoria).map((q) => ({ q, stage: e.nome })));
    if (required.length) {
      const answered = new Set(
        (await db.select({ q: s.opportunityAnswers.questionId }).from(s.opportunityAnswers).where(and(eq(s.opportunityAnswers.opportunityId, opp.id), eq(s.opportunityAnswers.tenantId, tenantId)))).map((x) => x.q),
      );
      const missing = required.filter((x) => !answered.has(x.q.id));
      if (missing.length) issues.push({ path: 'requirements.respostasObrigatorias', message: `Responda as perguntas obrigatórias: ${missing.map((m) => `“${m.q.texto}” (${m.stage})`).join('; ')}.` });
    }
  }
  return issues;
}
