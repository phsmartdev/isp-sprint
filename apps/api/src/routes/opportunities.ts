import { consumeForOpportunity, reverseForOpportunity } from '../services/contractLedger';
import { ensureCustomerSuccessPipeline, isBaseCustomer } from '../services/customerSuccess';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { OpportunityCreate, OpportunityListQuery, OpportunityTransition, OpportunityUpdate } from '@isp/shared';
import { pipelinesOf, resolvePipeline, getActiveInstruction } from '../services/instructions';
import { checkStageRequirements } from '../services/requirements';
import { notifyDealWon } from '../services/alerts';
import { duplicateOpportunity, runAutomations } from '../services/automations';
import { TERMINAL_STAGES, atLeast, validateTransition, type OpportunityStage } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { conflict, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { storeViability, viabilityFor } from '../services/viability';
import { assertPortAvailable, portUsage } from '../services/ports';
import { bumpVersion, detailsPatch, createOpportunity, loadOpportunity, opportunityDto, opportunityQuery, oppVisibility, planPrice } from '../services/opportunities';
import { assertAssignableUser, assertTenantRefs, level, ownerScope } from '../services/scope';
import { audit } from '../services/audit';
import { pctDelta } from '../services/metrics';

const SORTS = {
  updated_at: s.opportunities.updatedAt,
  created_at: s.opportunities.createdAt,
  title: s.opportunities.title,
  value_cents: s.opportunities.valueCents,
  next_action_at: s.opportunities.nextActionAt,
  stage: s.opportunities.stage,
} as const;

const FilterQuery = z.object({
  q: z.string().trim().max(100).optional(),
  ownerId: z.union([z.string().uuid(), z.literal('me')]).optional(),
  sourceId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
  pipelineId: z.string().uuid().optional(),
});

const OPEN = sql`${s.opportunities.stage} not in ('ganha','perdida')`;

function filters(auth: AuthContext, f: { q?: string; ownerId?: string; sourceId?: string; planId?: string; pipelineId?: string }) {
  const where: SQL[] = [oppVisibility(auth)];
  if (f.q) {
    const term = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
    where.push(or(ilike(s.opportunities.title, term), ilike(s.contacts.name, term), sql`${s.opportunities.code}::text = ${f.q.replace(/^OP-/i, '')}`)!);
  }
  if (f.ownerId === 'me') where.push(eq(s.opportunities.ownerId, auth.userId));
  else if (f.ownerId) where.push(eq(s.opportunities.ownerId, f.ownerId));
  if (f.sourceId) where.push(eq(s.opportunities.sourceId, f.sourceId));
  if (f.planId) where.push(eq(s.opportunities.planId, f.planId));
  if (f.pipelineId) where.push(eq(s.opportunities.pipelineId, f.pipelineId));
  return where;
}

/**
 * Indicadores de oportunidades da carteira visível. Comparações só com denominadores equivalentes:
 * posição atual × posição reconstruída no mesmo instante do mês anterior; vendas do mês até hoje ×
 * mesmo intervalo do mês anterior. Sem histórico, delta = null.
 */
export async function opportunityKpis(db: DbOrTx, auth: AuthContext, module: 'oportunidades' | 'inicio' = 'oportunidades') {
  const tz = auth.timezone;
  const vis = ownerScope(auth, module, { tenantId: s.opportunities.tenantId, ownerId: s.opportunities.ownerId, deletedAt: s.opportunities.deletedAt });
  const openAt = (t: SQL) => sql`${s.opportunities.createdAt} <= ${t} and coalesce(${s.opportunities.wonAt}, ${s.opportunities.lostAt}, 'infinity') > ${t}`;
  const monthStart = sql`(date_trunc('month', now() at time zone ${tz}) at time zone ${tz})`;
  const prevMonthStart = sql`(date_trunc('month', (now() at time zone ${tz}) - interval '1 month') at time zone ${tz})`;
  const prevSameMoment = sql`(now() - interval '1 month')`;
  const [r] = (
    await db.execute<{ open: number; open_prev: number; value: string; value_prev: string; working: number; proposals: number; won_mtd: number; won_prev_mtd: number }>(sql`
      select
        count(*) filter (where ${s.opportunities.stage} not in ('ganha','perdida'))::int open,
        count(*) filter (where ${openAt(prevSameMoment)})::int open_prev,
        coalesce(sum(${s.opportunities.valueCents}) filter (where ${s.opportunities.stage} not in ('ganha','perdida')),0)::bigint value,
        coalesce(sum(${s.opportunities.valueCents}) filter (where ${openAt(prevSameMoment)}),0)::bigint value_prev,
        count(*) filter (where exists (select 1 from pipeline_stages ps where ps.pipeline_id = ${s.opportunities.pipelineId} and ps.key = ${s.opportunities.stage} and ps.kind = 'open' and ps.position > 0))::int working,
        count(*) filter (where ${s.opportunities.proposalStatus} = 'enviada' and ${s.opportunities.stage} not in ('ganha','perdida'))::int proposals,
        count(*) filter (where ${s.opportunities.wonAt} >= ${monthStart})::int won_mtd,
        count(*) filter (where ${s.opportunities.wonAt} >= ${prevMonthStart} and ${s.opportunities.wonAt} < ${prevSameMoment})::int won_prev_mtd
      from ${s.opportunities} where ${vis}`)
  ).rows;
  return [
    { key: 'abertas', label: 'Oportunidades', value: r!.open, delta: pctDelta(r!.open, r!.open_prev), unit: 'count', formula: 'Oportunidades abertas agora × abertas no mesmo dia do mês anterior' },
    { key: 'valor', label: 'Valor potencial', value: Number(r!.value), delta: pctDelta(Number(r!.value), Number(r!.value_prev)), unit: 'brl_cents', formula: 'Soma do valor mensal (preço do catálogo) das oportunidades abertas' },
    { key: 'andamento', label: 'Em andamento', value: r!.working, delta: null, unit: 'count', formula: 'Abertas que já passaram da primeira etapa da jornada. Sem histórico de etapa para comparar.' },
    { key: 'propostas', label: 'Propostas enviadas', value: r!.proposals, delta: null, unit: 'count', formula: 'Abertas com proposta enviada e ainda sem resposta' },
    { key: 'vendas_mes', label: 'Vendas (mês)', value: r!.won_mtd, delta: pctDelta(r!.won_mtd, r!.won_prev_mtd), unit: 'count', formula: 'Vendas fechadas (ganho comercial) do dia 1 até hoje × mesmo intervalo do mês anterior. Não é contrato confirmado.' },
  ];
}

export const opportunityRoutes = [
  defineRoute({
    method: 'GET',
    url: '/opportunities/summary',
    summary: 'Indicadores de oportunidades da carteira visível',
    tag: 'Oportunidades',
    module: 'oportunidades',
    handler: async ({ app, auth }) => ({ kpis: await opportunityKpis(app.db, auth) }),
  }),

  defineRoute({
    method: 'GET',
    url: '/opportunities',
    summary: 'Lista oportunidades (tabela) com filtros e paginação',
    tag: 'Oportunidades',
    module: 'oportunidades',
    query: OpportunityListQuery,
    handler: async ({ app, auth, query }) => {
      const where = filters(auth, query);
      if (query.stage) where.push(eq(s.opportunities.stage, query.stage));
      if (query.status === 'abertas') where.push(OPEN);
      if (query.status === 'encerradas') where.push(inArray(s.opportunities.stage, TERMINAL_STAGES as unknown as string[]));
      const cond = and(...where);
      const col = SORTS[query.sort];
      const [rows, [{ total } = { total: 0 }]] = await Promise.all([
        opportunityQuery(app.db)
          .where(cond)
          .orderBy(query.dir === 'asc' ? sql`${col} asc nulls last` : sql`${col} desc nulls last`, desc(s.opportunities.id))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        app.db.select({ total: sql<number>`count(*)::int` }).from(s.opportunities).innerJoin(s.contacts, eq(s.contacts.id, s.opportunities.contactId)).where(cond),
      ]);
      const now = new Date();
      return { items: rows.map((r) => opportunityDto(r, now)), page: query.page, pageSize: query.pageSize, total };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/pipeline',
    summary: 'Kanban: etapas abertas com contagem, valor e cards',
    tag: 'Oportunidades',
    module: 'oportunidades',
    query: FilterQuery,
    handler: async ({ app, auth, query }) => {
      const pipe = await resolvePipeline(app.db, auth.tenantId, { pipelineId: query.pipelineId, userId: auth.userId, total: level(auth, 'oportunidades') === 'total' });
      const where = filters(auth, { ...query, pipelineId: pipe.id });
      where.push(OPEN);
      const rows = await opportunityQuery(app.db).where(and(...where)).orderBy(desc(s.opportunities.updatedAt)).limit(1000);
      const now = new Date();
      return {
        pipeline: { id: pipe.id, key: pipe.key, name: pipe.name },
        stages: pipe.stages.filter((st) => st.kind === 'open').map((st) => {
          const cards = rows.filter((r) => r.stage === st.key).map((r) => opportunityDto(r, now));
          return { key: st.key as OpportunityStage, name: st.name, color: st.color, requirements: st.requirements, isTerminal: false, count: cards.length, valueCents: cards.reduce((a, c) => a + (c.valueCents ?? 0), 0), cards };
        }),
        terminalStages: pipe.stages.filter((st) => st.kind !== 'open').map((st) => ({ key: st.key, name: st.name })),
        generatedAt: now.toISOString(),
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/opportunities',
    summary: 'Cria oportunidade (persistida imediatamente) — abre o workspace Sprint',
    tag: 'Oportunidades',
    module: 'oportunidades',
    body: OpportunityCreate,
    handler: async ({ app, auth, body, req, reply }) => {
      const opp = await app.db.transaction(async (tx) => {
        const created = await createOpportunity(tx, auth, req, body);
        if (body.leadId) {
          await tx
            .update(s.leads)
            .set({ status: 'convertido', convertedOpportunityId: created.id, updatedAt: new Date(), rowVersion: sql`${s.leads.rowVersion} + 1` })
            .where(and(eq(s.leads.id, body.leadId), eq(s.leads.tenantId, auth.tenantId), isNull(s.leads.convertedOpportunityId)));
        }
        return created;
      });
      await runAutomations(app.db, app.config, auth.tenantId, auth.userId, opp.id, { type: 'criada' });
      // cliente da base: o vendedor escolhe se aciona Sucesso do Cliente (duplica no funil); se não, nada é duplicado
      let customerSuccessId: string | null = null;
      const contactId = (await loadOpportunity(app.db, auth, opp.id)).contactId;
      if (await isBaseCustomer(app.db, auth.tenantId, contactId)) {
        await app.db.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: opp.id, type: 'sucesso_cliente_decisao', actorId: auth.userId, payload: { acionar: !!body.customerSuccess } });
        if (body.customerSuccess) {
          const cs = await ensureCustomerSuccessPipeline(app.db, auth.tenantId);
          customerSuccessId = await duplicateOpportunity(app.db, auth.tenantId, auth.userId, opp.id, { tipo: 'duplicar', jornada: cs.key, etapa: null, responsavel: 'mesmo' }, 'Sucesso do Cliente acionado na criação');
          await audit(app.db, req, { action: 'opportunity.customer_success', entityType: 'opportunity', entityId: opp.id, metadata: { copy: customerSuccessId } });
        }
      }
      reply.code(201);
      return { ...opportunityDto(await loadOpportunity(app.db, auth, opp.id)), customerSuccessId };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/opportunities/:id',
    summary: 'Detalhe da oportunidade',
    tag: 'Oportunidades',
    module: 'oportunidades',
    params: IdParams,
    handler: async ({ app, auth, params }) => opportunityDto(await loadOpportunity(app.db, auth, params.id)),
  }),

  defineRoute({
    method: 'PATCH',
    url: '/opportunities/:id',
    summary: 'Atualiza campos da oportunidade (não altera etapa nem status externos)',
    tag: 'Oportunidades',
    module: 'oportunidades',
    params: IdParams,
    body: OpportunityUpdate,
    handler: async ({ app, auth, params, body, req }) => {
      await app.db.transaction(async (tx) => {
        const cur = await loadOpportunity(tx, auth, params.id);
        if (cur.rowVersion !== body.rowVersion) throw conflict(cur.rowVersion);
        if (body.ownerId && body.ownerId !== cur.ownerId) await assertAssignableUser(tx, auth, 'oportunidades', body.ownerId);
        await assertTenantRefs(tx, auth, { sourceId: body.sourceId, campaignId: body.campaignId });
        const plan = body.planId === undefined ? undefined : await planPrice(tx, auth, body.planId);
        let pipelineChange: { pipelineId: string; stage: string } | undefined;
        if (body.pipelineId && body.pipelineId !== cur.pipelineId) {
          if (TERMINAL_STAGES.includes(cur.stage as OpportunityStage)) throw unprocessable('Oportunidade encerrada não muda de jornada.');
          const np = await resolvePipeline(tx, auth.tenantId, { pipelineId: body.pipelineId, userId: auth.userId, total: level(auth, 'oportunidades') === 'total' });
          const same = np.stages.find((st) => st.key === cur.stage && st.kind === 'open');
          pipelineChange = { pipelineId: np.id, stage: (same ?? np.stages.find((st) => st.kind === 'open')!).key };
        }
        const patch = {
          title: body.title ?? undefined,
          ownerId: body.ownerId,
          sourceId: body.sourceId,
          campaignId: body.campaignId,
          channel: body.channel,
          reasons: body.reasons,
          planId: plan === undefined ? undefined : plan?.id ?? null,
          valueCents: plan === undefined ? undefined : plan?.priceCents ?? null,
          nextAction: body.nextAction,
          nextActionAt: body.nextActionAt === undefined ? undefined : body.nextActionAt ? new Date(body.nextActionAt) : null,
          notes: body.notes,
          pipelineId: pipelineChange?.pipelineId,
          stage: pipelineChange?.stage,
          ...(await detailsPatch(tx, auth, body, pipelineChange?.pipelineId ?? cur.pipelineId, cur.custom ?? {}, { id: cur.id, stage: cur.stage, condominiumId: cur.condominiumId })),
        };
        const changed: Record<string, { from: unknown; to: unknown }> = {};
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) continue;
          const before = (cur as Record<string, unknown>)[k];
          const norm = (x: unknown) => (x instanceof Date ? x.toISOString() : Array.isArray(x) || (x && typeof x === 'object') ? JSON.stringify(x) : x ?? null);
          if (norm(before) !== norm(v)) changed[k] = { from: k === 'notes' ? undefined : norm(before), to: k === 'notes' ? undefined : norm(v) };
        }
        const updated = await tx
          .update(s.opportunities)
          .set({ ...patch, ...(pipelineChange ? { stageChangedAt: new Date() } : {}), updatedAt: new Date(), rowVersion: bumpVersion() })
          .where(and(eq(s.opportunities.id, params.id), eq(s.opportunities.tenantId, auth.tenantId), eq(s.opportunities.rowVersion, body.rowVersion)))
          .returning({ rowVersion: s.opportunities.rowVersion });
        if (!updated.length) throw conflict(cur.rowVersion);
        if (Object.keys(changed).some((k) => ['planId', 'cableMeters', 'activationFeeCents', 'saleType', 'equipment', 'routeId', 'condominiumId', 'installStreet'].includes(k))) await storeViability(tx, auth.tenantId, params.id);
        if (changed.ownerId) await tx.update(s.contacts).set({ ownerId: body.ownerId! }).where(and(eq(s.contacts.id, cur.contactId), eq(s.contacts.tenantId, auth.tenantId)));
        if (Object.keys(changed).length) {
          await tx.insert(s.opportunityEvents).values({
            tenantId: auth.tenantId,
            opportunityId: params.id,
            type: changed.ownerId ? 'assigned' : 'updated',
            actorId: auth.userId,
            payload: { changed },
            rowVersion: updated[0]!.rowVersion,
          });
        }
        if (changed.ownerId) await audit(tx, req, { action: 'opportunity.assign', entityType: 'opportunity', entityId: params.id, metadata: changed.ownerId });
      });
      return opportunityDto(await loadOpportunity(app.db, auth, params.id));
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/transition',
    summary: 'Muda a etapa do funil com regras de servidor (409 versão, 422 regra)',
    tag: 'Oportunidades',
    module: 'oportunidades',
    params: IdParams,
    body: OpportunityTransition,
    handler: async ({ app, auth, params, body, req }) => {
      await app.db.transaction(async (tx) => {
        const cur = await loadOpportunity(tx, auth, params.id);
        if (cur.rowVersion !== body.rowVersion) throw conflict(cur.rowVersion);
        const from = cur.stage as OpportunityStage;
        // reabrir venda fechada ou perdida exige nível Equipe (supervisão) ou superior
        const pipes = await pipelinesOf(tx, auth.tenantId);
        const pipe = pipes.find((p) => p.id === cur.pipelineId);
        const target = pipe?.stages.find((st) => st.key === body.toStage);
        if (!pipe || !target) throw unprocessable('Etapa não existe nesta jornada.', [{ path: 'toStage', message: 'Etapa inválida para a jornada da oportunidade' }]);
        const v = validateTransition({ from, to: body.toStage as OpportunityStage, reason: body.reason, lossReason: body.lossReason, confirm: body.confirm, canReopen: atLeast(level(auth, 'oportunidades'), 'equipe') });
        if (!v.ok) throw unprocessable(v.message, [{ path: v.code, message: v.message }]);
        if (target.kind !== 'lost') {
          const { content } = await getActiveInstruction(tx, auth.tenantId);
          const issues = await checkStageRequirements(tx, auth.tenantId, cur, target, content, pipe.key);
          if (issues.length) throw unprocessable(`Para entrar em “${target.name}”: ${issues.map((i) => i.message).join(' ')}`, issues);
        }
        // reabrir uma perdida volta a reservar a porta do condomínio
        if (target.kind === 'open' && from === 'perdida' && cur.condominiumId) await assertPortAvailable(tx, auth.tenantId, cur.condominiumId, cur.id);
        if (target.kind === 'won' && cur.condominiumId) {
          // a venda ocupa uma porta da CTO do condomínio
          const [c] = await tx.select({ name: s.condominiums.name, ports: s.condominiums.ctoPorts }).from(s.condominiums).where(eq(s.condominiums.id, cur.condominiumId)).limit(1);
          if (c?.ports != null) {
            const used = (await portUsage(tx, auth.tenantId, [cur.condominiumId], cur.id)).get(cur.condominiumId) ?? 0;
            if (used >= c.ports) throw unprocessable(`A CTO do ${c.name} está sem portas livres (${used} de ${c.ports} ocupadas). Libere uma porta ou fale com a engenharia antes de fechar.`, [{ path: 'condominiumId', message: 'Sem portas livres na CTO' }]);
          }
        }
        if (target.kind === 'won') {
          // fora da autonomia da operação, só fecha com a viabilidade da engenharia aprovada
          const { result } = await viabilityFor(tx, auth.tenantId, cur);
          if (result.engineering.required && cur.engineeringStatus !== 'aprovada')
            throw unprocessable(`Fora da autonomia da operação (${result.engineering.reasons.join(' e ')}). Registre a viabilidade aprovada pela engenharia antes de fechar.`, [{ path: 'engineeringStatus', message: 'Viabilidade da engenharia pendente' }]);
        }
        const now = new Date();
        const reopening = TERMINAL_STAGES.includes(from);
        const updated = await tx
          .update(s.opportunities)
          .set({
            stage: body.toStage,
            stageChangedAt: now,
            wonAt: body.toStage === 'ganha' ? now : reopening ? null : undefined,
            portReleasedAt: body.toStage === 'ganha' ? null : undefined,
            portReleaseReason: body.toStage === 'ganha' ? null : undefined,
            lostAt: body.toStage === 'perdida' ? now : reopening ? null : undefined,
            lossReason: body.toStage === 'perdida' ? body.lossReason : reopening ? null : undefined,
            updatedAt: now,
            rowVersion: bumpVersion(),
          })
          .where(and(eq(s.opportunities.id, params.id), eq(s.opportunities.tenantId, auth.tenantId), eq(s.opportunities.rowVersion, body.rowVersion)))
          .returning({ rowVersion: s.opportunities.rowVersion });
        if (!updated.length) throw conflict(cur.rowVersion);
        // contrato por medição: venda fechada dá saída no saldo; reabrir uma venda fechada estorna
        if (target.kind === 'won') await consumeForOpportunity(tx, auth.tenantId, auth.userId, cur);
        if (reopening && from === 'ganha') await reverseForOpportunity(tx, auth.tenantId, auth.userId, cur);
        await tx.insert(s.opportunityEvents).values({
          tenantId: auth.tenantId,
          opportunityId: params.id,
          type: reopening ? 'reopened' : 'stage_changed',
          actorId: auth.userId,
          fromValue: from,
          toValue: body.toStage,
          reason: body.reason ?? null,
          payload: body.lossReason ? { lossReason: body.lossReason } : null,
          rowVersion: updated[0]!.rowVersion,
        });
        if (reopening || TERMINAL_STAGES.includes(body.toStage as OpportunityStage)) {
          await audit(tx, req, { action: reopening ? 'opportunity.reopen' : `opportunity.${body.toStage}`, entityType: 'opportunity', entityId: params.id, metadata: { from, to: body.toStage } });
        }
      });
      if (body.toStage === 'ganha') await storeViability(app.db, auth.tenantId, params.id);
      await runAutomations(app.db, app.config, auth.tenantId, auth.userId, params.id, body.toStage === 'ganha' ? { type: 'ganha' } : body.toStage === 'perdida' ? { type: 'perdida' } : { type: 'entrou_na_etapa', stage: body.toStage });
      const dto = opportunityDto(await loadOpportunity(app.db, auth, params.id));
      if (body.toStage === 'ganha') await notifyDealWon(app.db, app.config, auth, dto);
      return dto;
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/timeline',
    summary: 'Linha do tempo: eventos da oportunidade e atividades vinculadas',
    tag: 'Oportunidades',
    module: 'oportunidades',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      await loadOpportunity(app.db, auth, params.id);
      const events = await app.db
        .select({
          id: s.opportunityEvents.id,
          type: s.opportunityEvents.type,
          fromValue: s.opportunityEvents.fromValue,
          toValue: s.opportunityEvents.toValue,
          reason: s.opportunityEvents.reason,
          payload: s.opportunityEvents.payload,
          occurredAt: s.opportunityEvents.occurredAt,
          observedAt: s.opportunityEvents.observedAt,
          sourceSystem: s.opportunityEvents.sourceSystem,
          actorName: s.users.name,
        })
        .from(s.opportunityEvents)
        .leftJoin(s.users, eq(s.users.id, s.opportunityEvents.actorId))
        .where(and(eq(s.opportunityEvents.opportunityId, params.id), eq(s.opportunityEvents.tenantId, auth.tenantId)))
        .orderBy(desc(s.opportunityEvents.occurredAt));
      const acts = await app.db
        .select({ id: s.activityEvents.id, type: s.activityEvents.type, payload: s.activityEvents.payload, occurredAt: s.activityEvents.occurredAt, actorName: s.users.name, title: s.activities.title, activityType: s.activities.type })
        .from(s.activityEvents)
        .innerJoin(s.activities, eq(s.activities.id, s.activityEvents.activityId))
        .leftJoin(s.users, eq(s.users.id, s.activityEvents.actorId))
        .where(and(eq(s.activities.opportunityId, params.id), eq(s.activities.tenantId, auth.tenantId)));
      const items = [
        ...events.map((e) => ({ kind: 'opportunity' as const, ...e })),
        ...acts.map((a) => ({ kind: 'activity' as const, ...a, observedAt: a.occurredAt, sourceSystem: 'crm' })),
      ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      return { items };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/opportunities/:id/release-port',
    summary: 'Cliente cancelou: libera a porta da CTO ocupada por esta venda (supervisão ou gerência)',
    tag: 'Oportunidades',
    module: 'oportunidades',
    min: 'equipe',
    params: IdParams,
    body: z.object({ reason: z.string().trim().min(3).max(300), rowVersion: z.number().int() }),
    handler: async ({ app, auth, params, body, req }) => {
      const dto = await app.db.transaction(async (tx) => {
        const cur = await loadOpportunity(tx, auth, params.id);
        if (cur.rowVersion !== body.rowVersion) throw conflict(cur.rowVersion);
        if (cur.stage !== 'ganha' || !cur.condominiumId) throw unprocessable('Só venda fechada em condomínio ocupa porta da CTO.');
        if (cur.portReleasedAt) throw unprocessable('A porta desta venda já foi liberada.');
        const now = new Date();
        await tx.update(s.opportunities).set({ portReleasedAt: now, portReleaseReason: body.reason, updatedAt: now, rowVersion: bumpVersion() }).where(eq(s.opportunities.id, cur.id));
        await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: cur.id, type: 'port_released', actorId: auth.userId, reason: body.reason });
        return opportunityDto(await loadOpportunity(tx, auth, params.id));
      });
      await audit(app.db, req, { action: 'opportunity.port_release', entityType: 'opportunity', entityId: params.id, metadata: { reason: body.reason } });
      return dto;
    },
  }),
];
