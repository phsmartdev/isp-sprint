/**
 * Eventos de domínio (outbox) — contrato comum entre módulos, conectores e webhooks.
 * Gravados na mesma transação da mudança (emitDomainEvent) e despachados depois (dispatchDomainEvents), com
 * idempotência por chave, tentativas controladas e registro da falha. O payload é mínimo: ids, nunca conteúdo.
 */
import { and, asc, eq, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';

export type DomainEventInput = { tenantId: string; type: string; entityType: string; entityId: string; source: string; payload?: Record<string, unknown>; idemKey?: string; correlationId?: string | null; version?: number };
type Handler = (db: DbOrTx, e: typeof s.domainEvents.$inferSelect) => Promise<void>;
const handlers = new Map<string, Handler[]>();
const MAX_ATTEMPTS = 5;

/** Registra um assinante interno para um tipo de evento (ou '*'). */
export function onDomainEvent(type: string, h: Handler) { handlers.set(type, [...(handlers.get(type) ?? []), h]); }

export async function emitDomainEvent(db: DbOrTx, e: DomainEventInput) {
  await db.insert(s.domainEvents).values({
    tenantId: e.tenantId, type: e.type, entityType: e.entityType, entityId: e.entityId, source: e.source, version: e.version ?? 1,
    correlationId: e.correlationId ?? null, payload: e.payload ?? {}, idemKey: e.idemKey ?? `${e.type}:${e.entityId}:${randomUUID()}`,
  }).onConflictDoNothing();
}

/** Processa os pendentes (rotina diária e sob demanda). Falha de um assinante não apaga nada: tenta de novo depois. */
export async function dispatchDomainEvents(db: DbOrTx, limit = 200) {
  const rows = await db.select().from(s.domainEvents).where(and(eq(s.domainEvents.status, 'pendente'), lt(s.domainEvents.attempts, MAX_ATTEMPTS))).orderBy(asc(s.domainEvents.occurredAt)).limit(limit);
  let ok = 0, failed = 0;
  for (const e of rows) {
    try {
      for (const h of [...(handlers.get(e.type) ?? []), ...(handlers.get('*') ?? [])]) await h(db, e);
      await db.update(s.domainEvents).set({ status: 'processado', processedAt: new Date(), attempts: e.attempts + 1, lastError: null }).where(eq(s.domainEvents.id, e.id));
      ok++;
    } catch (err) {
      const attempts = e.attempts + 1;
      await db.update(s.domainEvents).set({ attempts, status: attempts >= MAX_ATTEMPTS ? 'falhou' : 'pendente', lastError: (err as Error).message.slice(0, 500) }).where(eq(s.domainEvents.id, e.id));
      failed++;
    }
  }
  return { ok, failed };
}

