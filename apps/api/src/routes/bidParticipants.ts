/**
 * Licitação: empresas participantes, lances por lote, ranking e vencedor(es).
 * A lista é salva inteira (conferida no servidor) e cada mudança entra no histórico da oportunidade.
 * Pode ser registrada também depois do encerramento, porque o resultado do pregão costuma sair depois.
 */
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { BID_ACTION_KINDS, normalizeLot, PARTICIPANT_STATUSES, participantsError, rankParticipants } from '@isp/domain';
import { defineRoute } from '../http/route';
import { conflict, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { bumpVersion, loadOpportunity } from '../services/opportunities';
import { isBid } from './opportunityItems';

const onlyDigits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

const OppParams = z.object({ id: z.string().uuid() });
const Row = z.object({
  company: z.string().trim().max(200), document: z.string().trim().max(20).nullable().optional(), lot: z.string().trim().max(60).nullable().optional(),
  bidCents: z.number().int().min(0).max(100_000_000_000).nullable().optional(), status: z.enum(PARTICIPANT_STATUSES).default('ativo'),
  winner: z.boolean().default(false), isUs: z.boolean().default(false), notes: z.string().trim().max(500).nullable().optional(),
});
const fmt = (c: number | null) => (c === null ? 'sem lance' : (c / 100).toFixed(2));

export const bidParticipantRoutes = [
  defineRoute({
    method: 'GET', url: '/opportunities/:id/bid-participants', summary: 'Participantes da licitação, com lances, ranking por lote e vencedor(es)', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const rows = await app.db.select().from(s.bidParticipants).where(and(eq(s.bidParticipants.opportunityId, opp.id), eq(s.bidParticipants.tenantId, auth.tenantId))).orderBy(asc(s.bidParticipants.position));
      const ranks = rankParticipants(rows.map((r) => ({ ...r, status: r.status as (typeof PARTICIPANT_STATUSES)[number] })));
      return { bid: await isBid(app.db, auth.tenantId, opp), rowVersion: opp.rowVersion, items: rows.map((r, i) => ({ ...r, rank: ranks[i] })) };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/opportunities/:id/bid-participants', summary: 'Salva os participantes da licitação (lista inteira)', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    body: z.object({ rowVersion: z.number().int(), items: z.array(Row).max(200) }),
    handler: async ({ app, auth, params, body }) => {
      return app.db.transaction(async (tx) => {
        const opp = await loadOpportunity(tx, auth, params.id);
        if (opp.rowVersion !== body.rowVersion) throw conflict(opp.rowVersion);
        if (!(await isBid(tx, auth.tenantId, opp))) throw unprocessable('Participantes só se registram em oportunidades do tipo Licitação.');
        const items = body.items.map((r) => ({ company: r.company, document: onlyDigits(r.document) || null, lot: normalizeLot(r.lot), bidCents: r.bidCents ?? null, status: r.status, winner: r.winner, isUs: r.isUs, notes: r.notes || null }));
        const err = participantsError(items);
        if (err) throw unprocessable(err);
        const before = await tx.select().from(s.bidParticipants).where(and(eq(s.bidParticipants.opportunityId, opp.id), eq(s.bidParticipants.tenantId, auth.tenantId)));
        await tx.delete(s.bidParticipants).where(and(eq(s.bidParticipants.opportunityId, opp.id), eq(s.bidParticipants.tenantId, auth.tenantId)));
        if (items.length) await tx.insert(s.bidParticipants).values(items.map((r, position) => ({ ...r, tenantId: auth.tenantId, opportunityId: opp.id, position, createdBy: auth.userId })));
        const updated = await tx.update(s.opportunities).set({ updatedAt: new Date(), rowVersion: bumpVersion() })
          .where(and(eq(s.opportunities.id, opp.id), eq(s.opportunities.rowVersion, body.rowVersion))).returning({ rowVersion: s.opportunities.rowVersion });
        if (!updated.length) throw conflict(opp.rowVersion);
        // histórico: o quadro antes e depois, legível
        const describe = (rows: { company: string; lot: string; bidCents: number | null; winner: boolean; status: string }[]) => rows.length
          ? rows.map((r) => `${r.company} (lote ${r.lot}: ${fmt(r.bidCents)}${r.winner ? ', vencedora' : ''}${r.status !== 'ativo' ? `, ${r.status}` : ''})`).join('; ')
          : 'nenhum';
        const from = describe(before), to = describe(items);
        if (from !== to) {
          await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: opp.id, type: 'updated', actorId: auth.userId, rowVersion: updated[0]!.rowVersion, payload: { changed: { participantes: { from, to } } } });
        }
        const rows = await tx.select().from(s.bidParticipants).where(eq(s.bidParticipants.opportunityId, opp.id)).orderBy(asc(s.bidParticipants.position));
        const ranks = rankParticipants(rows.map((r) => ({ ...r, status: r.status as (typeof PARTICIPANT_STATUSES)[number] })));
        return { bid: true, rowVersion: updated[0]!.rowVersion, items: rows.map((r, i) => ({ ...r, rank: ranks[i] })) };
      });
    },
  }),
];

const ActionBody = z.object({
  company: z.string().trim().min(2).max(200), document: z.string().trim().max(20).nullable().optional(), isUs: z.boolean().default(false),
  kind: z.enum(BID_ACTION_KINDS), lot: z.string().trim().max(60).nullable().optional(), amountCents: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(), occurredAt: z.string().datetime({ offset: true }),
});

/** Linha do tempo do pregão: só inclui (append-only); correção é um novo registro. */
export const bidActionRoutes = [
  defineRoute({
    method: 'GET', url: '/opportunities/:id/bid-actions', summary: 'Linha do tempo do pregão (ações de cada empresa)', tag: 'Oportunidades', module: 'oportunidades', params: OppParams,
    handler: async ({ app, auth, params }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      const items = await app.db.select({ id: s.bidActions.id, company: s.bidActions.company, document: s.bidActions.document, isUs: s.bidActions.isUs, kind: s.bidActions.kind, lot: s.bidActions.lot, amountCents: s.bidActions.amountCents, description: s.bidActions.description, occurredAt: s.bidActions.occurredAt, createdAt: s.bidActions.createdAt, createdByName: s.users.name })
        .from(s.bidActions).leftJoin(s.users, eq(s.users.id, s.bidActions.createdBy))
        .where(and(eq(s.bidActions.opportunityId, opp.id), eq(s.bidActions.tenantId, auth.tenantId))).orderBy(asc(s.bidActions.occurredAt), asc(s.bidActions.createdAt));
      return { items };
    },
  }),
  defineRoute({
    method: 'POST', url: '/opportunities/:id/bid-actions', summary: 'Registra uma ação do pregão (lance, recurso, impugnação…)', tag: 'Oportunidades', module: 'oportunidades', params: OppParams, body: ActionBody,
    handler: async ({ app, auth, params, body, reply }) => {
      const opp = await loadOpportunity(app.db, auth, params.id);
      if (!(await isBid(app.db, auth.tenantId, opp))) throw unprocessable('A linha do tempo do pregão é só para oportunidades do tipo Licitação.');
      const doc = onlyDigits(body.document);
      if (doc && doc.length !== 14) throw unprocessable('CNPJ com 14 dígitos.', [{ path: 'document', message: 'CNPJ com 14 dígitos' }]);
      const when = new Date(body.occurredAt);
      if (when.getTime() > Date.now() + 5 * 60_000) throw unprocessable('A ação não pode estar no futuro.', [{ path: 'occurredAt', message: 'Data no futuro' }]);
      const [row] = await app.db.insert(s.bidActions).values({ tenantId: auth.tenantId, opportunityId: opp.id, company: body.company, document: doc || null, isUs: body.isUs, kind: body.kind, lot: body.lot?.trim() || null, amountCents: body.amountCents ?? null, description: body.description || null, occurredAt: when, createdBy: auth.userId }).returning({ id: s.bidActions.id });
      reply.status(201);
      return { id: row!.id };
    },
  }),
];
