/** Funil Sucesso do Cliente: criado na primeira vez que for acionado (não muda as jornadas existentes). */
import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { unprocessable } from '../http/errors';

export const CS_KEY = 'sucesso_cliente';
const STAGES = [
  { key: 'acionado', name: 'Acionado', kind: 'open', color: '#3B82F6' },
  { key: 'diagnostico', name: 'Diagnóstico', kind: 'open', color: '#8B5CF6' },
  { key: 'plano_acao', name: 'Plano de ação', kind: 'open', color: '#F59E0B' },
  { key: 'acompanhamento', name: 'Acompanhamento', kind: 'open', color: '#14B8A6' },
  { key: 'ganha', name: 'Cliente atendido', kind: 'won', color: '#22C55E' },
  { key: 'perdida', name: 'Não resolvido', kind: 'lost', color: '#EF4444' },
];

export async function ensureCustomerSuccessPipeline(db: DbOrTx, tenantId: string) {
  const [p] = await db.select().from(s.pipelines).where(and(eq(s.pipelines.tenantId, tenantId), eq(s.pipelines.key, CS_KEY))).limit(1);
  if (p) {
    if (!p.active) throw unprocessable('A jornada Sucesso do Cliente está inativa. Reative em Configurações → Jornadas.');
    return p;
  }
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.pipelines).where(eq(s.pipelines.tenantId, tenantId));
  const [created] = await db.insert(s.pipelines).values({ tenantId, key: CS_KEY, name: 'Sucesso do Cliente', description: 'Clientes da base acionados pelo comercial (criado automaticamente).', segments: [], isDefault: false, position: n }).returning();
  await db.insert(s.pipelineStages).values(STAGES.map((st, i) => ({ tenantId, pipelineId: created!.id, key: st.key, name: st.name, kind: st.kind, color: st.color, requirements: {}, position: i, isTerminal: st.kind !== 'open' })));
  return created!;
}

/** Cliente da base = tem cadastro de cliente que não é só prospecção. */
export async function isBaseCustomer(db: DbOrTx, tenantId: string, contactId: string) {
  const [c] = await db.select({ lifecycle: s.customers.lifecycle }).from(s.customers).where(and(eq(s.customers.tenantId, tenantId), eq(s.customers.contactId, contactId))).limit(1);
  return !!c && c.lifecycle !== 'prospect';
}
