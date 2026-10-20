/**
 * A ata vista de dentro da oportunidade: atrelar ao saldo (cota do órgão ou adesão já autorizada),
 * pedir nova adesão para um órgão não participante e desatrelar. Formalizar continua na ficha da ata (exige documento).
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkAdhesion, fmtQty, lineValue, type AgencyKind, type ArpRegime } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';
import { loadOpportunity } from '../services/opportunities';
import { releaseOpportunity } from '../services/arpOpportunity';
import { arpEvent, arpState, canEffectArp, checkAvailable, lockArp, rulesFor, writeLedger, type ArpState } from '../services/arp';

const LineIn = z.object({ itemId: z.string().uuid(), qtyMilli: z.number().int().positive() });

/** Quem pode mexer no vínculo: quem edita a oportunidade (o servidor já filtrou a visibilidade). */
function requireEditable(auth: AuthContext, stage: string) {
  if (auth.access.oportunidades === 'nenhum') throw forbidden('Seu perfil não altera oportunidades.');
  if (stage === 'perdida') throw unprocessable('Oportunidade perdida não usa saldo de ata.');
}
async function vigente(db: DbOrTx, auth: AuthContext, arpId: string) {
  const [a] = await db.select().from(s.arps).where(and(eq(s.arps.id, arpId), eq(s.arps.tenantId, auth.tenantId))).limit(1);
  if (!a) throw unprocessable('Ata não encontrada.');
  if (a.status !== 'vigente') throw unprocessable('Só dá para usar saldo de ata vigente.');
  return a;
}
/** Adesão autorizada no prazo para o órgão (a mais recente). */
function authorizedAdhesion(rows: (typeof s.arpAdhesions.$inferSelect)[], agencyId: string) {
  return rows.filter((r) => r.agencyId === agencyId && r.status === 'autorizada').sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null;
}
function adhesionUsed(st: ArpState, agencyId: string) {
  const agency = new Map<string, number>();
  const total = new Map<string, number>();
  for (const l of st.ledger) {
    if (l.kind !== 'adesao') continue;
    total.set(l.itemId, (total.get(l.itemId) ?? 0) + l.qtyMilli);
    if (l.agencyId === agencyId) agency.set(l.itemId, (agency.get(l.itemId) ?? 0) + l.qtyMilli);
  }
  return { agencyAuthorized: agency, totalAuthorized: total };
}

export const arpOpportunityRoutes = [
  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/arp',
    summary: 'Ata atrelada à oportunidade: itens reservados, adesões pedidas por ela e consumo formalizado',
    tag: 'Atas',
    module: 'oportunidades',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      const adhesions = await app.db.select({ r: s.arpAdhesions, agency: s.arpAgencies.name, number: s.arps.number }).from(s.arpAdhesions).innerJoin(s.arpAgencies, eq(s.arpAgencies.id, s.arpAdhesions.agencyId)).innerJoin(s.arps, eq(s.arps.id, s.arpAdhesions.arpId)).where(eq(s.arpAdhesions.opportunityId, o.id)).orderBy(desc(s.arpAdhesions.createdAt));
      if (!o.arpId) {
        const [v] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.arps).where(and(eq(s.arps.tenantId, auth.tenantId), eq(s.arps.status, 'vigente')));
        return { linked: null, adhesions: adhesions.map(({ r, agency, number }) => ({ ...r, agencyName: agency, arpNumber: number })), canEdit: auth.access.oportunidades !== 'nenhum' && o.stage !== 'perdida', hasActiveArps: (v?.n ?? 0) > 0 };
      }
      const [a] = await app.db.select().from(s.arps).where(eq(s.arps.id, o.arpId)).limit(1);
      const lines = await app.db.select({ l: s.arpOpportunityLines, item: s.arpItems, agency: s.arpAgencies.name, agencyKind: s.arpAgencies.kind }).from(s.arpOpportunityLines).innerJoin(s.arpItems, eq(s.arpItems.id, s.arpOpportunityLines.itemId)).innerJoin(s.arpAgencies, eq(s.arpAgencies.id, s.arpOpportunityLines.agencyId)).where(eq(s.arpOpportunityLines.opportunityId, o.id)).orderBy(asc(s.arpItems.itemNumber));
      const cons = await app.db.select({ kind: s.arpLedger.kind, v: sql<number>`sum(${s.arpLedger.amountCents})::bigint` }).from(s.arpLedger).where(and(eq(s.arpLedger.opportunityId, o.id), inArray(s.arpLedger.kind, ['consumo', 'estorno']))).groupBy(s.arpLedger.kind);
      const contractedCents = cons.reduce((x, r) => x + (r.kind === 'consumo' ? Number(r.v) : -Number(r.v)), 0);
      return {
        linked: {
          arp: { id: a!.id, number: a!.number, object: a!.object, status: a!.status, endAt: a!.endAt },
          lines: lines.map(({ l, item, agency, agencyKind }) => ({ id: l.id, itemId: l.itemId, agencyId: l.agencyId, agencyName: agency, agencyKind, itemNumber: item.itemNumber, lot: item.lot, description: item.description, unit: item.unit, qtyMilli: l.qtyMilli, unitCents: l.unitCents, valueCents: lineValue(l.qtyMilli, l.unitCents), status: l.status })),
          contractedCents,
          canFormalize: canEffectArp(auth) && o.stage === 'ganha',
        },
        adhesions: adhesions.map(({ r, agency, number }) => ({ ...r, agencyName: agency, arpNumber: number })),
        canEdit: auth.access.oportunidades !== 'nenhum' && o.stage !== 'perdida',
        hasActiveArps: true,
      };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/arp/options',
    summary: 'Atas vigentes para atrelar e, com arpId, os órgãos (cota, adesão autorizada ou sem adesão) e o saldo de cada item',
    tag: 'Atas',
    module: 'oportunidades',
    params: IdParams,
    query: z.object({ arpId: z.string().uuid().optional() }),
    handler: async ({ app, auth, params, query }) => {
      await loadOpportunity(app.db, auth, params.id);
      if (!query.arpId) {
        const atas = await app.db.select().from(s.arps).where(and(eq(s.arps.tenantId, auth.tenantId), eq(s.arps.status, 'vigente'))).orderBy(desc(s.arps.createdAt));
        const out = [];
        for (const a of atas) {
          const st = await arpState(app.db, a.id);
          out.push({ id: a.id, number: a.number, object: a.object, endAt: a.endAt, supplierName: a.supplierName, managerName: st.agencies.find((g) => g.kind === 'gerenciador')?.name ?? null, availableValueCents: st.items.reduce((x, i) => x + lineValue(Math.max(0, st.balances.byItem.get(i.id)!.available), i.unitCents), 0), items: st.items.length });
        }
        return { atas: out };
      }
      const a = await vigente(app.db, auth, query.arpId);
      const st = await arpState(app.db, a.id);
      const rule = await rulesFor(app.db, auth.tenantId, a.regime as ArpRegime);
      const adh = await app.db.select().from(s.arpAdhesions).where(eq(s.arpAdhesions.arpId, a.id));
      return {
        arp: { id: a.id, number: a.number, object: a.object },
        rules: { allowAdhesion: rule.rules.allowAdhesion, adhesionPerAgencyBp: rule.rules.adhesionPerAgencyBp, adhesionTotalBp: rule.rules.adhesionTotalBp, contractDeadlineDays: rule.rules.contractDeadlineDays, version: rule.version },
        agencies: st.agencies.map((g) => {
          const auth0 = g.kind === 'nao_participante' ? authorizedAdhesion(adh, g.id) : null;
          const pending = adh.find((r) => r.agencyId === g.id && ['solicitada', 'aceita_fornecedor'].includes(r.status));
          return { id: g.id, name: g.name, kind: g.kind as AgencyKind, mode: g.kind !== 'nao_participante' ? 'cota' : auth0 ? 'adesao_autorizada' : pending ? 'adesao_pendente' : 'sem_adesao', adhesionDeadline: auth0?.deadlineAt ?? null };
        }),
        items: st.items.map((i) => {
          const b = st.balances.byItem.get(i.id)!;
          const total = Math.floor((i.registeredMilli * rule.rules.adhesionTotalBp) / 10_000);
          return {
            id: i.id, itemNumber: i.itemNumber, lot: i.lot, description: i.description, unit: i.unit, unitCents: i.unitCents,
            availableByAgency: Object.fromEntries(st.agencies.map((g) => [g.id, Math.max(0, st.balances.byItemAgency.get(`${i.id}|${g.id}`)?.available ?? 0)])),
            adhesionPerAgencyLimitMilli: Math.floor((i.registeredMilli * rule.rules.adhesionPerAgencyBp) / 10_000),
            adhesionTotalRemainingMilli: Math.max(0, total - b.adhesionAuthorized),
            adhesionByAgency: Object.fromEntries(st.agencies.filter((g) => g.kind === 'nao_participante').map((g) => [g.id, adhesionUsed(st, g.id).agencyAuthorized.get(i.id) ?? 0])),
          };
        }),
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/arp/reserve',
    summary: 'Atrela a oportunidade ao saldo da ata: reserva os itens na cota do órgão ou na adesão já autorizada (substitui reservas anteriores)',
    tag: 'Atas',
    module: 'oportunidades',
    params: IdParams,
    body: z.object({ arpId: z.string().uuid(), agencyId: z.string().uuid(), lines: z.array(LineIn).min(1).max(200) }),
    handler: async ({ app, auth, params, body }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      requireEditable(auth, o.stage);
      if (o.arpId && o.arpId !== body.arpId) throw unprocessable('A oportunidade já está atrelada a outra ata. Desatrele antes de trocar.');
      const a = await vigente(app.db, auth, body.arpId);
      await app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const st = await arpState(tx, a.id);
        const ag = st.agencies.find((g) => g.id === body.agencyId);
        if (!ag) throw unprocessable('Órgão não cadastrado nesta ata.');
        let adhesionId: string | null = null;
        if (ag.kind === 'nao_participante') {
          const adh = authorizedAdhesion(await tx.select().from(s.arpAdhesions).where(eq(s.arpAdhesions.arpId, a.id)), ag.id);
          if (!adh) throw unprocessable(`${ag.name} não tem adesão autorizada nesta ata. Peça a adesão primeiro.`);
          adhesionId = adh.id;
        }
        const cur = await tx.select().from(s.arpOpportunityLines).where(and(eq(s.arpOpportunityLines.opportunityId, o.id), eq(s.arpOpportunityLines.status, 'reservada')));
        const release = new Map<string, number>();
        for (const l of cur) release.set(`${l.itemId}|${l.agencyId}`, (release.get(`${l.itemId}|${l.agencyId}`) ?? 0) + l.qtyMilli);
        const lines = body.lines.map((l) => ({ ...l, agencyId: ag.id }));
        checkAvailable(st, lines, release);
        const rule = await rulesFor(tx, auth.tenantId, a.regime as ArpRegime);
        const stamp = Date.now();
        if (cur.length) await writeLedger(tx, auth, a.id, st, cur.map((l) => ({ kind: 'liberacao' as const, itemId: l.itemId, agencyId: l.agencyId, qtyMilli: l.qtyMilli })), { origin: 'oportunidade', opportunityId: o.id, justification: 'Reservas refeitas pela oportunidade', ruleVersion: rule.version, idem: `opp-libera:${o.id}:${stamp}` });
        await writeLedger(tx, auth, a.id, st, lines.map((l) => ({ kind: 'reserva' as const, ...l })), { origin: 'oportunidade', opportunityId: o.id, adhesionId, justification: adhesionId ? 'Reserva na adesão autorizada' : 'Reserva pela oportunidade', ruleVersion: rule.version, idem: `opp-reserva:${o.id}:${stamp}` });
        await tx.delete(s.arpOpportunityLines).where(and(eq(s.arpOpportunityLines.opportunityId, o.id), eq(s.arpOpportunityLines.status, 'reservada')));
        for (const l of lines) await tx.insert(s.arpOpportunityLines).values({ tenantId: auth.tenantId, arpId: a.id, opportunityId: o.id, itemId: l.itemId, agencyId: l.agencyId, qtyMilli: l.qtyMilli, unitCents: st.items.find((i) => i.id === l.itemId)!.unitCents }).onConflictDoUpdate({ target: [s.arpOpportunityLines.opportunityId, s.arpOpportunityLines.itemId, s.arpOpportunityLines.agencyId], set: { qtyMilli: l.qtyMilli, status: 'reservada', updatedAt: new Date() } });
        if (adhesionId) await tx.update(s.arpAdhesions).set({ opportunityId: o.id, updatedAt: new Date() }).where(and(eq(s.arpAdhesions.id, adhesionId), sql`${s.arpAdhesions.opportunityId} is null`));
        if (!o.arpId) await tx.update(s.opportunities).set({ arpId: a.id, updatedAt: new Date() }).where(eq(s.opportunities.id, o.id));
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: o.id, type: o.arpId ? 'ata_reserva_ajustada' : 'ata_vinculada', actorId: auth.userId, payload: { arpId: a.id, number: a.number, agency: ag.name, lines: lines.length } });
        await arpEvent(tx, auth, auth.tenantId, a.id, o.arpId ? 'reserva_ajustada' : 'oportunidade', `OP-${o.code} ${o.arpId ? 'ajustou as reservas' : 'atrelada à ata'} (${ag.name}): ${lines.map((l) => { const it = st.items.find((i) => i.id === l.itemId)!; return `${it.itemNumber} ${fmtQty(l.qtyMilli)} ${it.unit}`; }).join('; ')}.`, { opportunityId: o.id });
      });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/arp/adhesion',
    summary: 'Pede adesão à ata para um órgão não participante a partir da oportunidade; ao ser autorizada, a quantidade fica reservada para ela',
    tag: 'Atas',
    module: 'oportunidades',
    params: IdParams,
    body: z.object({
      arpId: z.string().uuid(),
      agencyId: z.string().uuid().nullable().default(null),
      newAgency: z.object({ name: z.string().trim().min(2).max(200), document: z.string().trim().max(30).nullable().default(null) }).nullable().default(null),
      requestedAt: z.string().date(),
      justification: z.string().trim().min(10, 'Explique a necessidade do órgão (mín. 10 caracteres)').max(2000),
      items: z.array(LineIn).min(1).max(200),
    }),
    handler: async ({ app, auth, params, body, reply }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      requireEditable(auth, o.stage);
      if (o.arpId && o.arpId !== body.arpId) throw unprocessable('A oportunidade já está atrelada a outra ata. Desatrele antes de trocar.');
      const a = await vigente(app.db, auth, body.arpId);
      const out = await app.db.transaction(async (tx) => {
        await lockArp(tx, a.id);
        const st = await arpState(tx, a.id);
        const rule = await rulesFor(tx, auth.tenantId, a.regime as ArpRegime);
        if (!rule.rules.allowAdhesion) throw unprocessable('O regulamento desta ata não admite adesão.');
        let agencyId = body.agencyId;
        if (!agencyId) {
          if (!body.newAgency) throw unprocessable('Informe o órgão ou a instituição que quer aderir.');
          const ex = st.agencies.find((g) => g.name.trim().toLowerCase() === body.newAgency!.name.trim().toLowerCase());
          agencyId = ex?.id ?? (await tx.insert(s.arpAgencies).values({ tenantId: auth.tenantId, arpId: a.id, kind: 'nao_participante', name: body.newAgency.name, document: body.newAgency.document }).returning())[0]!.id;
        }
        const [ag] = await tx.select().from(s.arpAgencies).where(and(eq(s.arpAgencies.id, agencyId!), eq(s.arpAgencies.arpId, a.id))).limit(1);
        if (!ag) throw unprocessable('Órgão não cadastrado nesta ata.');
        if (ag.kind !== 'nao_participante') throw unprocessable(`${ag.name} já participa da ata: use a cota dele, sem adesão.`);
        const items = body.items.map((i) => { const it = st.items.find((x) => x.id === i.itemId); if (!it) throw unprocessable('Item fora da ata.'); return { ...i, unitCents: it.unitCents }; });
        const [r] = await tx.insert(s.arpAdhesions).values({ tenantId: auth.tenantId, arpId: a.id, agencyId: ag.id, requestedAt: body.requestedAt, justification: body.justification, items, opportunityId: o.id, createdBy: auth.userId }).returning();
        if (!o.arpId) await tx.update(s.opportunities).set({ arpId: a.id, updatedAt: new Date() }).where(eq(s.opportunities.id, o.id));
        const check = checkAdhesion(rule.rules, items, { registered: new Map(st.items.map((i) => [i.id, i.registeredMilli])), ...adhesionUsed(st, ag.id) });
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: o.id, type: 'ata_adesao_pedida', actorId: auth.userId, payload: { arpId: a.id, number: a.number, agency: ag.name, adhesionId: r!.id, withinLimits: check.ok } });
        await arpEvent(tx, auth, auth.tenantId, a.id, 'adesao', `Pedido de adesão de ${ag.name} pela OP-${o.code}: ${items.length} item(ns)${check.ok ? '' : ' (fora dos limites legais)'}.`, { adhesionId: r!.id, opportunityId: o.id });
        return { id: r!.id, check };
      });
      reply.code(201);
      return out;
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/arp/unlink',
    summary: 'Desatrela a oportunidade da ata: libera as reservas (o histórico fica no livro)',
    tag: 'Atas',
    module: 'oportunidades',
    params: IdParams,
    body: z.object({ reason: z.string().trim().min(5, 'Explique o motivo').max(500) }),
    handler: async ({ app, auth, params, body }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      if (auth.access.oportunidades === 'nenhum') throw forbidden('Seu perfil não altera oportunidades.');
      if (!o.arpId) return { ok: true };
      await app.db.transaction(async (tx) => {
        const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.arpLedger).where(and(eq(s.arpLedger.opportunityId, o.id), eq(s.arpLedger.kind, 'consumo')));
        if (c?.n) throw unprocessable('Esta oportunidade já tem consumo formalizado na ata; correções são feitas na ficha da ata.');
        await releaseOpportunity(tx, auth, o.id, body.reason);
        await tx.update(s.opportunities).set({ arpId: null, updatedAt: new Date() }).where(eq(s.opportunities.id, o.id));
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: o.id, type: 'ata_desvinculada', actorId: auth.userId, payload: { arpId: o.arpId, reason: body.reason } });
        await arpEvent(tx, auth, auth.tenantId, o.arpId!, 'oportunidade', `OP-${o.code} desatrelada da ata: ${body.reason}`, { opportunityId: o.id });
      });
      return { ok: true };
    },
  }),
];
