/**
 * Gatilhos que vêm de fora da tela (retorno de chamado do GLPI/IXC/e-mail, leitura de e-mail) entram numa fila
 * idempotente e rodam as automações da jornada da oportunidade. Quem recebe o sinal enfileira; quem tem a
 * configuração (rotas e rotina diária) processa.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { ixcOrder } from '@isp/domain';
import type { Config } from '../config';
import type { DB, DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { runAutomations, type AutomationEvent } from './automations';
import { ixcClientFor, ixcConfig, ixcList } from './ixc';

export async function enqueueAutomation(db: DbOrTx, tenantId: string, opportunityId: string, event: AutomationEvent, dedupeKey: string) {
  await db.insert(s.automationQueue).values({ tenantId, opportunityId, event: event as unknown as Record<string, unknown>, dedupeKey }).onConflictDoNothing();
}

/** Processa a fila (de uma empresa ou de todas). Falha numa automação não trava as demais. */
export async function drainAutomationQueue(db: DB, config: Config, tenantId?: string, max = 50) {
  const rows = await db.select().from(s.automationQueue).where(and(isNull(s.automationQueue.processedAt), tenantId ? eq(s.automationQueue.tenantId, tenantId) : undefined)).orderBy(asc(s.automationQueue.createdAt)).limit(max);
  let ran = 0;
  for (const r of rows) {
    // marca antes de rodar: duas chamadas ao mesmo tempo não rodam a mesma automação duas vezes
    const [claimed] = await db.update(s.automationQueue).set({ processedAt: new Date() }).where(and(eq(s.automationQueue.id, r.id), isNull(s.automationQueue.processedAt))).returning({ id: s.automationQueue.id });
    if (!claimed) continue;
    try { await runAutomations(db, config, r.tenantId, null, r.opportunityId, r.event as unknown as AutomationEvent); ran++; }
    catch (e) { await db.update(s.automationQueue).set({ error: (e as Error).message.slice(0, 300) }).where(eq(s.automationQueue.id, r.id)); }
  }
  return { processados: ran, lidos: rows.length };
}

/** Oportunidades em aberto da conta cujas jornadas têm automação de retorno de chamado para a origem. */
async function openOppsWithTrigger(db: DbOrTx, tenantId: string, contactId: string | null, origem: 'glpi' | 'ixc' | 'email') {
  return (await db.execute<{ id: string; contact_id: string }>(sql`
    select o.id, o.contact_id from opportunities o
    where o.tenant_id = ${tenantId} and o.deleted_at is null and o.stage not in ('perdida') ${contactId ? sql`and o.contact_id = ${contactId}` : sql``}
      and exists (select 1 from pipeline_automations a where a.pipeline_id = o.pipeline_id and a.active and a.trigger->>'tipo' = 'chamado_retorno'
        and coalesce(a.trigger->>'origem', 'qualquer') in ('qualquer', ${origem}))`)).rows;
}

/**
 * IXC: compara as ordens de serviço das contas que têm oportunidade com automação de retorno de chamado.
 * Primeira leitura só registra; mudança de situação (ou nova mensagem) depois disso vira gatilho.
 */
export async function pollIxcReturns(db: DbOrTx, tenantId: string, maxContacts = 25) {
  const c = await ixcConfig(db, tenantId);
  if (!c) return { contas: 0, retornos: 0 };
  const opps = await openOppsWithTrigger(db, tenantId, null, 'ixc');
  const byContact = new Map<string, string[]>();
  for (const o of opps) byContact.set(o.contact_id, [...(byContact.get(o.contact_id) ?? []), o.id]);
  let retornos = 0, contas = 0;
  for (const [contactId, oppIds] of [...byContact.entries()].slice(0, maxContacts)) {
    const client = await ixcClientFor(db, c, contactId).catch(() => null);
    if (!client) continue;
    contas++;
    const r = await ixcList(c, 'su_oss_chamado', { qtype: 'su_oss_chamado.id_cliente', query: client.id, rp: 20, sortname: 'su_oss_chamado.id', sortorder: 'desc' });
    for (const os of r.registros.map(ixcOrder)) {
      const fp = createHash('sha1').update(`${os.status}|${os.mensagem ?? ''}|${os.fechamento ?? ''}`).digest('hex');
      const [prev] = await db.select().from(s.ixcOsWatch).where(and(eq(s.ixcOsWatch.tenantId, tenantId), eq(s.ixcOsWatch.contactId, contactId), eq(s.ixcOsWatch.osId, os.id)));
      if (prev && prev.fingerprint === fp) continue;
      await db.insert(s.ixcOsWatch).values({ tenantId, contactId, osId: os.id, status: os.status, fingerprint: fp }).onConflictDoUpdate({ target: [s.ixcOsWatch.tenantId, s.ixcOsWatch.contactId, s.ixcOsWatch.osId], set: { status: os.status, fingerprint: fp, seenAt: new Date() } });
      if (!prev) continue; // primeira vez que vemos esta OS: só registra
      retornos++;
      for (const oppId of oppIds) await enqueueAutomation(db, tenantId, oppId, { type: 'chamado_retorno', origem: 'ixc', detail: `OS IXC ${os.protocolo ?? os.id}: ${os.statusLabel}` }, `ixc:${os.id}:${fp}:${oppId}`);
    }
  }
  return { contas, retornos };
}

/** Resposta do cliente por e-mail numa conversa vinculada à oportunidade. */
export async function enqueueEmailReply(db: DbOrTx, tenantId: string, opportunityId: string, messageId: string, subject: string | null) {
  await enqueueAutomation(db, tenantId, opportunityId, { type: 'chamado_retorno', origem: 'email', detail: `Resposta por e-mail${subject ? `: ${subject.slice(0, 120)}` : ''}` }, `mail:${messageId}`);
}
