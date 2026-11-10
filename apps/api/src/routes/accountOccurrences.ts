/**
 * Ocorrências da conta e evolução do relacionamento.
 * Ocorrência é registrada pela equipe (nada é inferido). A evolução só lê o que já existe: contratos, aditivos, reajustes,
 * ocorrências de contrato, oportunidades, projetos, stakeholders, interações concluídas e as ocorrências da conta.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ACCOUNT_OCCURRENCE_CHANNELS, ACCOUNT_OCCURRENCE_IMPACTS, ACCOUNT_OCCURRENCE_KINDS, DEFAULT_ACCOUNT_OCCURRENCE_IMPACT, NEGOTIATION_ASPECTS,
  atLeast, evolutionByYear, quarterKey, responseState, type AccountOccurrenceImpact,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { audit } from '../services/audit';
import { todayIso } from '../services/commitmentControl';
import { assertAccount } from './stakeholders';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const Fields = z.object({
  kind: z.enum(ACCOUNT_OCCURRENCE_KINDS),
  occurredOn: isoDate,
  title: z.string().trim().min(3, 'Dê um título com pelo menos 3 letras').max(200),
  description: z.string().trim().max(4000).nullable().default(null),
  impact: z.enum(ACCOUNT_OCCURRENCE_IMPACTS).optional(),
  channel: z.enum(ACCOUNT_OCCURRENCE_CHANNELS).nullable().default(null),
  aspects: z.array(z.enum(NEGOTIATION_ASPECTS)).max(NEGOTIATION_ASPECTS.length).default([]),
  stakeholderId: z.string().uuid().nullable().default(null),
  opportunityId: z.string().uuid().nullable().default(null),
  contractId: z.string().uuid().nullable().default(null),
  responseDueOn: isoDate.nullable().default(null),
  respondedOn: isoDate.nullable().default(null),
  responseNote: z.string().trim().max(2000).nullable().default(null),
});
type FieldsT = z.infer<typeof Fields>;

/** Vínculos precisam ser da mesma conta; datas fazem sentido entre si e não estão no futuro. */
async function validate(db: DbOrTx, auth: AuthContext, contactId: string, f: Pick<FieldsT, 'kind' | 'occurredOn' | 'aspects' | 'stakeholderId' | 'opportunityId' | 'contractId' | 'responseDueOn' | 'respondedOn'>) {
  const today = todayIso();
  if (f.occurredOn > today) throw unprocessable('A data da ocorrência não pode ser futura.', [{ path: 'occurredOn', message: 'Futura' }]);
  if (f.responseDueOn && f.responseDueOn < f.occurredOn) throw unprocessable('O prazo de resposta não pode ser antes da ocorrência.', [{ path: 'responseDueOn', message: 'Antes da ocorrência' }]);
  if (f.respondedOn && (f.respondedOn < f.occurredOn || f.respondedOn > today)) throw unprocessable('A data da resposta deve ficar entre a ocorrência e hoje.', [{ path: 'respondedOn', message: 'Fora do período' }]);
  if (f.aspects.length && f.kind !== 'mudanca_negociacao') throw unprocessable('"O que mudou" é só para mudança na negociação.');
  const one = async (tbl: typeof s.accountStakeholders | typeof s.opportunities | typeof s.contracts, id: string | null, label: string) => {
    if (!id) return;
    const [r] = await db.select({ c: tbl.contactId }).from(tbl).where(and(eq(tbl.id, id), eq(tbl.tenantId, auth.tenantId))).limit(1);
    if (!r || r.c !== contactId) throw unprocessable(`${label} não é desta conta.`);
  };
  await one(s.accountStakeholders, f.stakeholderId, 'A pessoa');
  await one(s.opportunities, f.opportunityId, 'A oportunidade');
  await one(s.contracts, f.contractId, 'O contrato');
}

async function loadOccurrence(db: DbOrTx, auth: AuthContext, id: string) {
  const [o] = await db.select().from(s.accountOccurrences).where(and(eq(s.accountOccurrences.id, id), eq(s.accountOccurrences.tenantId, auth.tenantId), isNull(s.accountOccurrences.removedAt))).limit(1).for('update');
  if (!o) throw notFound('Ocorrência não encontrada.');
  await assertAccount(db, auth, o.contactId);
  return o;
}
/** Quem registrou altera; supervisão (Equipe ou Total em Clientes) também. */
const canChange = (auth: AuthContext, o: { createdBy: string }) => o.createdBy === auth.userId || atLeast(level(auth, 'clientes'), 'equipe');

async function listOccurrences(db: DbOrTx, auth: AuthContext, contactId: string) {
  const r = await db.execute<Record<string, unknown>>(sql`
    select o.id, o.kind, o.occurred_on as "occurredOn", o.title, o.description, o.impact, o.channel, o.aspects,
      o.stakeholder_id as "stakeholderId", p.name as "stakeholderName",
      o.opportunity_id as "opportunityId", op.code as "opportunityCode", op.title as "opportunityTitle",
      o.contract_id as "contractId", cv.number as "contractNumber",
      o.response_due_on as "responseDueOn", o.responded_on as "respondedOn", o.response_note as "responseNote",
      o.created_by as "createdBy", u.name as "createdByName", o.created_at as "createdAt", o.row_version as "rowVersion"
    from account_occurrences o
    join users u on u.id = o.created_by
    left join account_stakeholders st on st.id = o.stakeholder_id left join people p on p.id = st.person_id
    left join opportunities op on op.id = o.opportunity_id
    left join contracts c on c.id = o.contract_id left join contract_versions cv on cv.contract_id = c.id and cv.version = c.current_version
    where o.tenant_id = ${auth.tenantId} and o.contact_id = ${contactId} and o.removed_at is null
    order by o.occurred_on desc, o.created_at desc`);
  const today = todayIso();
  return r.rows.map((x) => ({ ...x, response: responseState(x as { responseDueOn: string | null; respondedOn: string | null }, today), canChange: canChange(auth, x as { createdBy: string }) }));
}

export const accountOccurrenceRoutes = [
  defineRoute({
    method: 'GET', url: '/accounts/:id/occurrences', summary: 'Ocorrências registradas na conta (notificações, elogios, mudanças na negociação…)', tag: 'Clientes', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      await assertAccount(app.db, auth, params.id);
      return { items: await listOccurrences(app.db, auth, params.id) };
    },
  }),
  defineRoute({
    method: 'POST', url: '/accounts/:id/occurrences', summary: 'Registra uma ocorrência na conta', tag: 'Clientes', module: 'clientes', params: IdParams, body: Fields,
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      await assertAccount(tx, auth, params.id);
      await validate(tx, auth, params.id, body);
      const [o] = await tx.insert(s.accountOccurrences).values({
        ...body, impact: body.impact ?? DEFAULT_ACCOUNT_OCCURRENCE_IMPACT[body.kind], tenantId: auth.tenantId, contactId: params.id, createdBy: auth.userId,
      }).returning({ id: s.accountOccurrences.id });
      await audit(tx, req, { action: 'account_occurrence.create', entityType: 'contact', entityId: params.id, metadata: { occurrenceId: o!.id, kind: body.kind } });
      return { id: o!.id };
    }),
  }),
  defineRoute({
    method: 'PATCH', url: '/account-occurrences/:id', summary: 'Altera uma ocorrência da conta (inclusive registrar a resposta dada ao cliente)', tag: 'Clientes', module: 'clientes', params: IdParams,
    body: Fields.partial().extend({ rowVersion: z.number().int() }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      const o = await loadOccurrence(tx, auth, params.id);
      if (!canChange(auth, o)) throw forbidden('Só quem registrou ou a supervisão altera esta ocorrência.');
      if (o.rowVersion !== body.rowVersion) throw conflict(o.rowVersion);
      const { rowVersion: _rv, ...rest } = body;
      const next = { ...o, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) } as typeof o;
      if (rest.kind && rest.kind !== 'mudanca_negociacao' && rest.aspects === undefined) next.aspects = [];
      await validate(tx, auth, o.contactId, { ...next, aspects: next.aspects as FieldsT['aspects'], kind: next.kind as FieldsT['kind'] });
      await tx.update(s.accountOccurrences).set({
        kind: next.kind, occurredOn: next.occurredOn, title: next.title, description: next.description, impact: next.impact, channel: next.channel, aspects: next.aspects,
        stakeholderId: next.stakeholderId, opportunityId: next.opportunityId, contractId: next.contractId,
        responseDueOn: next.responseDueOn, respondedOn: next.respondedOn, responseNote: next.responseNote,
        updatedBy: auth.userId, updatedAt: new Date(), rowVersion: sql`${s.accountOccurrences.rowVersion} + 1`,
      }).where(eq(s.accountOccurrences.id, o.id));
      await audit(tx, req, { action: 'account_occurrence.update', entityType: 'contact', entityId: o.contactId, metadata: { occurrenceId: o.id, fields: Object.keys(rest) } });
      return { ok: true };
    }),
  }),
  defineRoute({
    method: 'POST', url: '/account-occurrences/:id/remove', summary: 'Retira uma ocorrência registrada por engano (fica na auditoria com o motivo)', tag: 'Clientes', module: 'clientes', params: IdParams,
    body: z.object({ reason: z.string().trim().min(5, 'Explique o motivo com pelo menos 5 letras').max(500), rowVersion: z.number().int() }),
    handler: async ({ app, auth, params, body, req }) => app.db.transaction(async (tx) => {
      const o = await loadOccurrence(tx, auth, params.id);
      if (!canChange(auth, o)) throw forbidden('Só quem registrou ou a supervisão retira esta ocorrência.');
      if (o.rowVersion !== body.rowVersion) throw conflict(o.rowVersion);
      await tx.update(s.accountOccurrences).set({ removedAt: new Date(), removedBy: auth.userId, removedReason: body.reason, rowVersion: sql`${s.accountOccurrences.rowVersion} + 1` }).where(eq(s.accountOccurrences.id, o.id));
      await audit(tx, req, { action: 'account_occurrence.remove', entityType: 'contact', entityId: o.contactId, metadata: { occurrenceId: o.id, reason: body.reason } });
      return { ok: true };
    }),
  }),

  defineRoute({
    method: 'GET', url: '/accounts/:id/evolution', summary: 'Evolução do relacionamento: contratos, aditivos, reajustes, oportunidades, projetos, pessoas, interações e ocorrências ao longo do tempo', tag: 'Clientes', module: 'clientes', params: IdParams,
    handler: async ({ app, auth, params }) => {
      await assertAccount(app.db, auth, params.id);
      const db = app.db, t = auth.tenantId, c = params.id;
      const seeContracts = atLeast(level(auth, 'contratos'), 'proprio');
      const seeOpps = atLeast(level(auth, 'oportunidades'), 'proprio');
      const seeProjects = atLeast(level(auth, 'projetos'), 'proprio');
      const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute<T & Record<string, unknown>>(q)).rows as T[];
      type Ctr = { id: string; number: string; object: string; startAt: string | null; endAt: string | null; monthlyCents: number; stage: string; closedOn: string | null };
      const [contracts, amendments, adjustments, ctrOccurrences, opportunities, projects, peopleIn, peopleChanged, interactions, occurrences] = await Promise.all([
        seeContracts ? rows<Ctr>(sql`select c.id, v.number, v.object, v.start_at::text as "startAt", v.end_at::text as "endAt", v.monthly_cents::float8 as "monthlyCents", c.stage, (c.closed_at at time zone 'America/Sao_Paulo')::date::text as "closedOn"
          from contracts c join contract_versions v on v.contract_id = c.id and v.version = c.current_version where c.tenant_id = ${t} and c.contact_id = ${c} order by v.start_at nulls last`) : [],
        seeContracts ? rows<{ contractId: string; on: string; number: string; kind: string; description: string }>(sql`select a.contract_id as "contractId", a.signed_on::text as "on", a.number, a.kind, a.description
          from contract_amendments a join contracts c on c.id = a.contract_id where c.tenant_id = ${t} and c.contact_id = ${c} order by a.signed_on`) : [],
        seeContracts ? rows<{ contractId: string; on: string; indexName: string; inputText: string; mode: string }>(sql`select a.contract_id as "contractId", a.base_date::text as "on", a.index_name as "indexName", a.input_text as "inputText", a.mode
          from contract_adjustments a join contracts c on c.id = a.contract_id where c.tenant_id = ${t} and c.contact_id = ${c} order by a.base_date`) : [],
        seeContracts ? rows<{ contractId: string; on: string; kind: string; title: string }>(sql`select o.contract_id as "contractId", o.occurred_on::text as "on", o.kind, o.title
          from contract_occurrences o join contracts c on c.id = o.contract_id where c.tenant_id = ${t} and c.contact_id = ${c} order by o.occurred_on`) : [],
        seeOpps ? rows<{ id: string; code: number; title: string; stage: string; valueCents: number | null; createdOn: string; wonOn: string | null; lostOn: string | null }>(sql`select o.id, o.code, o.title, o.stage, o.value_cents::float8 as "valueCents",
          (o.created_at at time zone 'America/Sao_Paulo')::date::text as "createdOn", (o.won_at at time zone 'America/Sao_Paulo')::date::text as "wonOn", (o.lost_at at time zone 'America/Sao_Paulo')::date::text as "lostOn"
          from opportunities o where o.tenant_id = ${t} and o.contact_id = ${c} and o.deleted_at is null order by o.created_at`) : [],
        seeProjects ? rows<{ id: string; code: number; name: string; status: string; kind: string; startOn: string; dueOn: string | null; doneOn: string | null }>(sql`select p.id, p.code, p.name, p.status, p.kind, p.start_on::text as "startOn", p.due_on::text as "dueOn",
          (p.completed_at at time zone 'America/Sao_Paulo')::date::text as "doneOn" from projects p where p.tenant_id = ${t} and p.contact_id = ${c} and p.deleted_at is null order by p.start_on`) : [],
        rows<{ id: string; name: string; title: string | null; on: string }>(sql`select st.id, p.name, st.title, (st.created_at at time zone 'America/Sao_Paulo')::date::text as "on"
          from account_stakeholders st join people p on p.id = st.person_id where st.tenant_id = ${t} and st.contact_id = ${c} order by st.created_at`),
        rows<{ id: string; name: string; on: string; payload: { from?: Record<string, unknown>; to?: Record<string, unknown> } }>(sql`select st.id, p.name, (e.created_at at time zone 'America/Sao_Paulo')::date::text as "on", e.payload
          from stakeholder_events e join account_stakeholders st on st.id = e.stakeholder_id join people p on p.id = st.person_id
          where e.tenant_id = ${t} and st.contact_id = ${c} and e.type = 'alterado' and (e.payload->'to' ? 'stance' or e.payload->'to' ? 'active') order by e.created_at`),
        rows<{ on: string }>(sql`select (a.completed_at at time zone 'America/Sao_Paulo')::date::text as "on" from activities a
          where a.tenant_id = ${t} and a.deleted_at is null and a.completed_at is not null and a.type <> 'tarefa'
            and (a.contact_id = ${c} or a.opportunity_id in (select id from opportunities where contact_id = ${c} and tenant_id = ${t}))`),
        listOccurrences(db, auth, c),
      ]);
      const today = todayIso();
      const people = [
        ...peopleIn.map((p) => ({ stakeholderId: p.id, name: p.name, on: p.on, change: 'entrou' as const, detail: p.title })),
        ...peopleChanged.map((p) => {
          const to = p.payload.to ?? {}, from = p.payload.from ?? {};
          if (to.active === false) return { stakeholderId: p.id, name: p.name, on: p.on, change: 'saiu' as const, detail: null };
          if (to.active === true) return { stakeholderId: p.id, name: p.name, on: p.on, change: 'voltou' as const, detail: null };
          return { stakeholderId: p.id, name: p.name, on: p.on, change: 'posicionamento' as const, detail: `${String(from.stance ?? 'desconhecido')} → ${String(to.stance)}` };
        }),
      ].sort((a, b) => a.on.localeCompare(b.on));
      const byQuarter: Record<string, number> = {};
      for (const i of interactions) byQuarter[quarterKey(i.on)] = (byQuarter[quarterKey(i.on)] ?? 0) + 1;
      const occ = occurrences as unknown as { occurredOn: string; impact: AccountOccurrenceImpact }[];
      const years = evolutionByYear({
        contracts, opportunities: opportunities.map((o) => ({ createdOn: o.createdOn, wonOn: o.wonOn, lostOn: o.lostOn })),
        interactions: interactions.map((i) => i.on), occurrences: occ.map((o) => ({ on: String(o.occurredOn), impact: o.impact })),
      }, today);
      return {
        today, visible: { contracts: seeContracts, opportunities: seeOpps, projects: seeProjects },
        contracts: contracts.map((k) => ({
          ...k,
          amendments: amendments.filter((a) => a.contractId === k.id),
          adjustments: adjustments.filter((a) => a.contractId === k.id),
          occurrences: ctrOccurrences.filter((a) => a.contractId === k.id),
        })),
        opportunities, projects, people, interactionsByQuarter: byQuarter, occurrences, years,
      };
    },
  }),
];

