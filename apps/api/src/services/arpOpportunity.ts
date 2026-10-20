/** Oportunidade ↔ ata: reservas, liberação na perda e tarefa de formalização no ganho. */
import { and, eq } from 'drizzle-orm';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';
import { arpEvent, arpState, lockArp, rulesFor, writeLedger, addDaysIso, todayIso } from './arp';
import type { ArpRegime } from '@isp/domain';

/** Libera as reservas ainda abertas da oportunidade (perda ou desvinculação). Idempotente. */
export async function releaseOpportunity(tx: DbOrTx, auth: AuthContext, oppId: string, reason: string) {
  const [o] = await tx.select({ arpId: s.opportunities.arpId, code: s.opportunities.code }).from(s.opportunities).where(eq(s.opportunities.id, oppId)).limit(1);
  if (!o?.arpId) return 0;
  await lockArp(tx, o.arpId);
  const lines = await tx.select().from(s.arpOpportunityLines).where(and(eq(s.arpOpportunityLines.opportunityId, oppId), eq(s.arpOpportunityLines.status, 'reservada')));
  if (!lines.length) return 0;
  const [arp] = await tx.select().from(s.arps).where(eq(s.arps.id, o.arpId)).limit(1);
  const st = await arpState(tx, o.arpId);
  const rule = await rulesFor(tx, auth.tenantId, arp!.regime as ArpRegime);
  const n = await writeLedger(tx, auth, o.arpId, st, lines.map((l) => ({ kind: 'liberacao' as const, itemId: l.itemId, agencyId: l.agencyId, qtyMilli: l.qtyMilli })), { origin: 'oportunidade', opportunityId: oppId, justification: reason, ruleVersion: rule.version, idem: `libera:${oppId}:${lines.map((l) => l.id).join(',')}:${lines.map((l) => l.updatedAt.getTime()).join(',')}` });
  for (const l of lines) await tx.update(s.arpOpportunityLines).set({ status: 'liberada', updatedAt: new Date() }).where(eq(s.arpOpportunityLines.id, l.id));
  await arpEvent(tx, auth, auth.tenantId, o.arpId, 'reserva_liberada', `Reservas da OP-${o.code} liberadas: ${reason}`, { opportunityId: oppId });
  return n;
}

/** Venda fechada de ata: não consome saldo; cria a tarefa de formalização (documento) para o responsável. */
export async function onArpOpportunityWon(tx: DbOrTx, auth: AuthContext, oppId: string) {
  const [o] = await tx.select({ arpId: s.opportunities.arpId, ownerId: s.opportunities.ownerId, contactId: s.opportunities.contactId, code: s.opportunities.code, title: s.opportunities.title }).from(s.opportunities).where(eq(s.opportunities.id, oppId)).limit(1);
  if (!o?.arpId) return;
  const [arp] = await tx.select({ number: s.arps.number }).from(s.arps).where(eq(s.arps.id, o.arpId)).limit(1);
  await tx.insert(s.activities).values({
    tenantId: auth.tenantId, type: 'tarefa', title: `Formalizar contratação da ata ${arp?.number ?? ''} (OP-${o.code})`,
    notes: 'Venda fechada não consome o saldo da ata. Anexe o empenho, contrato ou ordem de serviço na ata e registre a formalização em Gestão de Contratos → Atas → Oportunidades.',
    dueAt: new Date(`${addDaysIso(todayIso(), 5)}T12:00:00Z`), priority: 'alta', ownerId: o.ownerId, opportunityId: oppId, contactId: o.contactId, createdBy: auth.userId,
  });
  await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: oppId, type: 'ata_formalizacao_pendente', actorId: auth.userId, payload: { arpId: o.arpId } });
  await arpEvent(tx, auth, auth.tenantId, o.arpId, 'oportunidade_ganha', `OP-${o.code} fechada: aguardando formalização documental para consumir o saldo.`, { opportunityId: oppId });
}
