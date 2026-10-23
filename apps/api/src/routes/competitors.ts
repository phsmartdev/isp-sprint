/**
 * Inteligência de licitação: concorrentes a partir dos participantes registrados nos pregões.
 * Concorrente = CNPJ (ou nome, quando o CNPJ não foi informado). Respeita o alcance do módulo Inteligência.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { competitorKey, competitorStats, normalizeLot, rankParticipants, type ParticipantStatus } from '@isp/domain';
import { defineRoute } from '../http/route';
import { notFound } from '../http/errors';
import * as s from '../db/schema';
import { ownerScope } from '../services/scope';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';

async function scopedRows(db: DbOrTx, auth: AuthContext) {
  const rows = await db.select({
    opportunityId: s.bidParticipants.opportunityId, company: s.bidParticipants.company, document: s.bidParticipants.document, lot: s.bidParticipants.lot,
    bidCents: s.bidParticipants.bidCents, status: s.bidParticipants.status, winner: s.bidParticipants.winner, isUs: s.bidParticipants.isUs,
    at: sql<string>`coalesce(nullif(${s.opportunities.custom}->>'data_sessao', ''), to_char(${s.opportunities.createdAt} at time zone 'UTC', 'YYYY-MM-DD'))`,
    code: s.opportunities.code, title: s.opportunities.title, stage: s.opportunities.stage, contactName: s.contacts.name,
    orgao: sql<string | null>`${s.opportunities.custom}->>'orgao_contratante'`, edital: sql<string | null>`${s.opportunities.custom}->>'numero_edital'`,
  }).from(s.bidParticipants)
    .innerJoin(s.opportunities, eq(s.opportunities.id, s.bidParticipants.opportunityId))
    .innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId))
    .where(and(eq(s.bidParticipants.tenantId, auth.tenantId), ownerScope(auth, 'inteligencia', { tenantId: s.opportunities.tenantId, ownerId: s.opportunities.ownerId, deletedAt: s.opportunities.deletedAt })))
    .orderBy(asc(s.bidParticipants.opportunityId), asc(s.bidParticipants.position));
  return rows.map((r) => ({ ...r, status: r.status as ParticipantStatus }));
}

export const competitorRoutes = [
  defineRoute({
    method: 'GET', url: '/intelligence/competitors', summary: 'Concorrentes nos pregões: disputas juntos, vitórias, lances', tag: 'Inteligência', module: 'inteligencia',
    query: z.object({ q: z.string().trim().max(100).optional() }),
    handler: async ({ app, auth, query }) => {
      const rows = await scopedRows(app.db, auth);
      let items = competitorStats(rows);
      if (query.q) {
        // busca sem diferenciar acento nem maiúscula ("omega" acha "Ômega")
        const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const t = norm(query.q); const d = query.q.replace(/\D/g, '');
        items = items.filter((c) => norm(c.name).includes(t) || (d.length >= 3 && !!c.document?.includes(d)));
      }
      const opps = new Set(rows.map((r) => r.opportunityId));
      const ourLots = rows.filter((r) => r.isUs);
      return { items, totals: { pregoes: opps.size, competitors: items.length, ourLots: ourLots.length, ourWins: ourLots.filter((r) => r.winner).length } };
    },
  }),
  defineRoute({
    method: 'GET', url: '/intelligence/competitors/:key', summary: 'Um concorrente: cada pregão, lances dele e nossos, posição e ações', tag: 'Inteligência', module: 'inteligencia',
    params: z.object({ key: z.string().min(3).max(220) }),
    handler: async ({ app, auth, params }) => {
      const rows = await scopedRows(app.db, auth);
      const stats = competitorStats(rows).find((c) => c.key === params.key);
      if (!stats) throw notFound('Concorrente não encontrado.');
      const oppIds = [...new Set(rows.filter((r) => !r.isUs && competitorKey(r) === params.key).map((r) => r.opportunityId))];
      const pregoes = oppIds.map((oid) => {
        const list = rows.filter((r) => r.opportunityId === oid);
        const ranks = rankParticipants(list);
        const withRank = list.map((r, i) => ({ ...r, rank: ranks[i] ?? null }));
        const lots = [...new Set(withRank.filter((r) => !r.isUs && competitorKey(r) === params.key).map((r) => normalizeLot(r.lot)))];
        const head = list[0]!;
        return {
          opportunityId: oid, code: head.code, title: head.title, stage: head.stage, contactName: head.contactName, orgao: head.orgao, edital: head.edital, at: head.at,
          lots: lots.map((lot) => {
            const inLot = withRank.filter((r) => normalizeLot(r.lot) === lot);
            const them = inLot.find((r) => !r.isUs && competitorKey(r) === params.key)!;
            const us = inLot.find((r) => r.isUs) ?? null;
            const win = inLot.find((r) => r.winner) ?? null;
            return { lot, participants: inLot.length, them: { bidCents: them.bidCents, rank: them.rank, status: them.status, winner: them.winner }, us: us && { bidCents: us.bidCents, rank: us.rank, status: us.status, winner: us.winner }, winner: win && { company: win.company, isUs: win.isUs, bidCents: win.bidCents } };
          }),
        };
      }).sort((a, b) => b.at.localeCompare(a.at));
      const acts = oppIds.length ? await app.db.select({ opportunityId: s.bidActions.opportunityId, company: s.bidActions.company, document: s.bidActions.document, kind: s.bidActions.kind, lot: s.bidActions.lot, amountCents: s.bidActions.amountCents, description: s.bidActions.description, occurredAt: s.bidActions.occurredAt })
        .from(s.bidActions).where(and(eq(s.bidActions.tenantId, auth.tenantId), inArray(s.bidActions.opportunityId, oppIds), eq(s.bidActions.isUs, false))).orderBy(asc(s.bidActions.occurredAt)) : [];
      const actions = acts.filter((a) => competitorKey(a) === params.key);
      const byKind: Record<string, number> = {};
      for (const a of actions) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
      return { stats, pregoes, actions, actionsByKind: byKind };
    },
  }),
];
