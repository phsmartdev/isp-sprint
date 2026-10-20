/**
 * Configurações de negócio: jornadas pelo painel (etapas, membros, campos, automações),
 * regiões e condomínios, parâmetros de viabilidade; e na oportunidade, o cálculo de viabilidade.
 */
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  AutomationSchema, CommissionRuleItem, CondominiumUpsert, DeductionItem, EquipmentItem, FieldSchema, PipelineUpsert, RegionUpsert, RouteItem, RouteRuleItem,
  StagesPut, ViabilitySettingsUpdate, ViabilitySimulate, checkAutomation, listOf,
} from '@isp/shared';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { getActiveInstruction, journeyBlockers, pipelinesOf, replaceFields, resolveAutomationPeople, setPipelineMembers } from '../services/instructions';
import { historicalBase, loadViabilityParams, viabilityFor } from '../services/viability';
import { loadOpportunity } from '../services/opportunities';
import { audit } from '../services/audit';
import { portReservations, portUsage } from '../services/ports';

const ADMIN = { module: 'configuracoes' as const, min: 'total' as const };
const slugify = (v: string) =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'e_$1').slice(0, 40) || 'item';

async function uniqueKey(db: DbOrTx, base: string, taken: (k: string) => Promise<boolean>) {
  let k = base.length >= 2 ? base : `${base}_x`;
  for (let i = 2; await taken(k); i++) k = `${base.slice(0, 36)}_${i}`;
  return k;
}

async function pipelineOr404(db: DbOrTx, tenantId: string, id: string) {
  const [p] = await db.select().from(s.pipelines).where(and(eq(s.pipelines.id, id), eq(s.pipelines.tenantId, tenantId))).limit(1);
  if (!p) throw notFound('Jornada não encontrada.');
  return p;
}

async function assertUsers(db: DbOrTx, tenantId: string, ids: string[]) {
  if (!ids.length) return;
  const found = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, tenantId), inArray(s.users.id, ids)));
  if (found.length !== new Set(ids).size) throw unprocessable('Usuário inválido.', [{ path: 'memberIds', message: 'Usuário não encontrado nesta empresa' }]);
}

/** Substitui uma lista simples (upsert pelo id; o que sumiu fica inativo). */
async function replaceList<T extends { id?: string }>(
  db: DbOrTx,
  table: typeof s.viabilityDeductions | typeof s.equipmentItems | typeof s.deliveryRoutes | typeof s.routeRules | typeof s.commissionRules,
  tenantId: string,
  items: T[],
  extra: Record<string, unknown> = {},
  scopeCol?: { col: typeof s.viabilityDeductions.category; value: string },
) {
  const t = table as typeof s.equipmentItems;
  const keep: string[] = [];
  for (const [i, it] of items.entries()) {
    const { id, ...values } = it as T & Record<string, unknown>;
    const row = { ...values, ...extra, ...('position' in (table as object) ? { position: i } : {}) } as Record<string, unknown>;
    if (id) {
      const r = await db.update(t).set(row as never).where(and(eq(t.id, id), eq(t.tenantId, tenantId))).returning({ id: t.id });
      if (!r.length) throw unprocessable('Item não encontrado.', [{ path: `items.${i}.id`, message: 'Item de outra empresa ou removido' }]);
      keep.push(id);
    } else {
      const [r] = await db.insert(t).values({ ...row, tenantId } as never).returning({ id: t.id });
      keep.push(r!.id);
    }
  }
  await db
    .update(t)
    .set({ active: false } as never)
    .where(and(eq(t.tenantId, tenantId), keep.length ? notInArray(t.id, keep) : undefined, scopeCol ? eq(scopeCol.col, scopeCol.value) : undefined));
}

export const businessRoutes = [
  // ================================================================== jornadas
  defineRoute({
    method: 'GET',
    url: '/admin/journeys',
    summary: 'Jornadas com etapas, membros, campos, automações e contagem de oportunidades',
    tag: 'Jornadas',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      await getActiveInstruction(app.db, auth.tenantId);
      const pipes = await pipelinesOf(app.db, auth.tenantId);
      const counts = await app.db
        .select({ pipelineId: s.opportunities.pipelineId, stage: s.opportunities.stage, n: sql<number>`count(*)::int` })
        .from(s.opportunities)
        .where(and(eq(s.opportunities.tenantId, auth.tenantId), sql`${s.opportunities.deletedAt} is null`))
        .groupBy(s.opportunities.pipelineId, s.opportunities.stage);
      const runs = await app.db
        .select({ automationId: s.automationRuns.automationId, n: sql<number>`count(*)::int`, errors: sql<number>`count(*) filter (where ${s.automationRuns.status} = 'erro')::int`, last: sql<string>`max(${s.automationRuns.createdAt})` })
        .from(s.automationRuns)
        .where(eq(s.automationRuns.tenantId, auth.tenantId))
        .groupBy(s.automationRuns.automationId);
      return {
        items: pipes.map((p) => ({
          id: p.id, key: p.key, name: p.name, description: p.description, segments: p.segments, isDefault: p.isDefault,
          members: p.members.map((m) => ({ userId: m.userId, name: m.name, email: m.email })),
          stages: p.stages.map((st) => ({ id: st.id, key: st.key, name: st.name, kind: st.kind, color: st.color, requirements: st.requirements, count: counts.find((c) => c.pipelineId === p.id && c.stage === st.key)?.n ?? 0 })),
          fields: p.fields.map((f) => ({ chave: f.key, rotulo: f.label, tipo: f.type, opcoes: f.options, obrigatorio: f.required })),
          automations: p.automations.map((a) => ({ id: a.id, nome: a.name, ativo: a.active, gatilho: a.trigger, acoes: a.actions, runs: runs.find((r) => r.automationId === a.id) ?? null })),
          open: counts.filter((c) => c.pipelineId === p.id && !['ganha', 'perdida'].includes(c.stage)).reduce((a, c) => a + c.n, 0),
        })),
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/admin/journeys',
    summary: 'Cria jornada (copiando as etapas de outra ou com um funil básico)',
    tag: 'Jornadas',
    ...ADMIN,
    body: PipelineUpsert,
    handler: async ({ app, auth, body, req, reply }) => {
      await getActiveInstruction(app.db, auth.tenantId);
      await assertUsers(app.db, auth.tenantId, body.memberIds);
      const id = await app.db.transaction(async (tx) => {
        const key = await uniqueKey(tx, slugify(body.name), async (k) => !!(await tx.select({ id: s.pipelines.id }).from(s.pipelines).where(and(eq(s.pipelines.tenantId, auth.tenantId), eq(s.pipelines.key, k))).limit(1)).length);
        const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.pipelines).where(eq(s.pipelines.tenantId, auth.tenantId));
        if (body.isDefault) await tx.update(s.pipelines).set({ isDefault: false }).where(eq(s.pipelines.tenantId, auth.tenantId));
        const [p] = await tx.insert(s.pipelines).values({ tenantId: auth.tenantId, key, name: body.name, description: body.description, segments: body.segments, isDefault: body.isDefault, position: n }).returning({ id: s.pipelines.id });
        let stages: { key: string; name: string; kind: string; color: string | null; requirements: Record<string, boolean> }[] = [
          { key: 'novo_lead', name: 'Novo lead', kind: 'open', color: '#3885D3', requirements: {} },
          { key: 'em_andamento', name: 'Em andamento', kind: 'open', color: '#4FBBFF', requirements: {} },
          { key: 'proposta', name: 'Proposta', kind: 'open', color: '#2F5986', requirements: { plano: true } },
          { key: 'negociacao', name: 'Negociação', kind: 'open', color: '#00C2E0', requirements: { proposta: true, plano: true } },
          { key: 'ganha', name: 'Venda fechada', kind: 'won', color: '#22A447', requirements: { plano: true } },
          { key: 'perdida', name: 'Perdido', kind: 'lost', color: '#FF5050', requirements: {} },
        ];
        if (body.copyFromId) {
          const src = await tx.select().from(s.pipelineStages).where(and(eq(s.pipelineStages.pipelineId, body.copyFromId), eq(s.pipelineStages.tenantId, auth.tenantId), eq(s.pipelineStages.active, true))).orderBy(asc(s.pipelineStages.position));
          if (src.length) stages = src.map((x) => ({ key: x.key, name: x.name, kind: x.kind, color: x.color, requirements: x.requirements as Record<string, boolean> }));
        }
        await tx.insert(s.pipelineStages).values(stages.map((st, i) => ({ tenantId: auth.tenantId, pipelineId: p!.id, key: st.key, name: st.name, kind: st.kind, color: st.color, requirements: st.requirements, position: i, isTerminal: st.kind !== 'open' })));
        await setPipelineMembers(tx, p!.id, body.memberIds);
        return p!.id;
      });
      await audit(app.db, req, { action: 'journey.create', entityType: 'pipeline', entityId: id, metadata: { name: body.name } });
      reply.code(201);
      return { id };
    },
  }),

  defineRoute({
    method: 'PATCH',
    url: '/admin/journeys/:id',
    summary: 'Altera nome, descrição, segmentos, padrão, membros ou desativa a jornada',
    tag: 'Jornadas',
    ...ADMIN,
    params: IdParams,
    body: PipelineUpsert.omit({ copyFromId: true }).partial().extend({ active: z.boolean().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const p = await pipelineOr404(app.db, auth.tenantId, params.id);
      if (body.memberIds) await assertUsers(app.db, auth.tenantId, body.memberIds);
      await app.db.transaction(async (tx) => {
        if (body.active === false) {
          const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.opportunities).where(and(eq(s.opportunities.pipelineId, p.id), sql`${s.opportunities.deletedAt} is null`, notInArray(s.opportunities.stage, ['ganha', 'perdida'])));
          if (n) throw unprocessable(`A jornada tem ${n} oportunidade(s) aberta(s). Mova ou encerre antes de desativar.`);
          if (p.isDefault) throw unprocessable('Escolha outra jornada padrão antes de desativar esta.');
        }
        if (body.isDefault) await tx.update(s.pipelines).set({ isDefault: false }).where(eq(s.pipelines.tenantId, auth.tenantId));
        if (body.isDefault === false && p.isDefault) throw unprocessable('Sempre existe uma jornada padrão: marque outra como padrão.');
        if (body.segments) {
          const others = await tx.select({ name: s.pipelines.name, segments: s.pipelines.segments }).from(s.pipelines).where(and(eq(s.pipelines.tenantId, auth.tenantId), eq(s.pipelines.active, true), sql`${s.pipelines.id} <> ${p.id}`));
          const clash = others.find((o) => o.segments.some((x) => body.segments!.includes(x as never)));
          if (clash) throw unprocessable(`O segmento já está na jornada “${clash.name}”.`, [{ path: 'segments', message: 'Cada segmento usa uma jornada' }]);
        }
        await tx.update(s.pipelines).set({ name: body.name, description: body.description, segments: body.segments, isDefault: body.isDefault, active: body.active }).where(eq(s.pipelines.id, p.id));
        if (body.memberIds) await setPipelineMembers(tx, p.id, body.memberIds);
      });
      await audit(app.db, req, { action: 'journey.update', entityType: 'pipeline', entityId: p.id, metadata: { name: body.name ?? p.name } });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/admin/journeys/:id/stages',
    summary: 'Define as etapas da jornada (ordem, nome, cor, tipo e exigências)',
    tag: 'Jornadas',
    ...ADMIN,
    params: IdParams,
    body: StagesPut,
    handler: async ({ app, auth, params, body, req }) => {
      const p = await pipelineOr404(app.db, auth.tenantId, params.id);
      const won = body.stages.filter((x) => x.kind === 'won');
      const lost = body.stages.filter((x) => x.kind === 'lost');
      if (won.length !== 1 || lost.length !== 1) throw unprocessable('A jornada precisa de exatamente uma etapa de venda fechada e uma de perda.');
      if (body.stages[0]!.kind !== 'open') throw unprocessable('A primeira etapa precisa ser aberta.');
      const taken = new Set<string>();
      const stages = body.stages.map((st) => {
        let key = st.kind === 'won' ? 'ganha' : st.kind === 'lost' ? 'perdida' : st.key ?? slugify(st.name);
        if (st.kind === 'open' && (key === 'ganha' || key === 'perdida')) key = `${key}_etapa`;
        let k = key;
        for (let i = 2; taken.has(k); i++) k = `${key.slice(0, 36)}_${i}`;
        taken.add(k);
        return { ...st, key: k };
      });
      const blockers = await journeyBlockers(app.db, auth.tenantId, [{ chave: p.key, nome: p.name, etapas: stages.map((x) => ({ chave: x.key, tipo: x.kind === 'open' ? 'aberta' : x.kind === 'won' ? 'ganha' : 'perdida' })) }]);
      const mine = blockers.filter((b) => b.includes(`“${p.name}”`));
      if (mine.length) throw unprocessable('Há oportunidades abertas em etapas removidas.', mine.map((m) => ({ path: 'stages', message: m })));
      await app.db.transaction(async (tx) => {
        for (const [i, st] of stages.entries()) {
          const values = { name: st.name, kind: st.kind, color: st.color ?? null, requirements: st.requirements, position: i, isTerminal: st.kind !== 'open', active: true };
          await tx.insert(s.pipelineStages).values({ tenantId: auth.tenantId, pipelineId: p.id, key: st.key, ...values }).onConflictDoUpdate({ target: [s.pipelineStages.pipelineId, s.pipelineStages.key], set: values });
        }
        await tx.update(s.pipelineStages).set({ active: false }).where(and(eq(s.pipelineStages.pipelineId, p.id), notInArray(s.pipelineStages.key, stages.map((x) => x.key))));
      });
      await audit(app.db, req, { action: 'journey.stages', entityType: 'pipeline', entityId: p.id, metadata: { name: p.name, stages: stages.length } });
      return { ok: true, keys: stages.map((x) => x.key) };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/admin/journeys/:id/fields',
    summary: 'Define os campos personalizados do cadastro desta jornada',
    tag: 'Jornadas',
    ...ADMIN,
    params: IdParams,
    body: z.object({ fields: z.array(FieldSchema.extend({ chave: FieldSchema.shape.chave.optional() })).max(40) }),
    handler: async ({ app, auth, params, body, req }) => {
      const p = await pipelineOr404(app.db, auth.tenantId, params.id);
      const taken = new Set<string>();
      const fields = body.fields.map((f) => {
        let k = f.chave ?? slugify(f.rotulo);
        for (let i = 2; taken.has(k); i++) k = `${(f.chave ?? slugify(f.rotulo)).slice(0, 36)}_${i}`;
        taken.add(k);
        if (f.tipo === 'lista' && f.opcoes.length < 2) throw unprocessable(`“${f.rotulo}”: lista precisa de ao menos 2 opções.`);
        return { ...f, chave: k };
      });
      await app.db.transaction((tx) => replaceFields(tx, auth.tenantId, p.id, fields));
      await audit(app.db, req, { action: 'journey.fields', entityType: 'pipeline', entityId: p.id, metadata: { name: p.name, fields: fields.length } });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/admin/journeys/:id/automations',
    summary: 'Cria automação (gatilho + ações)',
    tag: 'Jornadas',
    ...ADMIN,
    params: IdParams,
    body: AutomationSchema,
    handler: async ({ app, auth, params, body, req, reply }) => {
      const p = await pipelineOr404(app.db, auth.tenantId, params.id);
      const all = await pipelinesOf(app.db, auth.tenantId);
      const shape = all.map((x) => ({ chave: x.key, etapas: x.stages.map((st) => ({ chave: st.key, tipo: st.kind === 'open' ? 'aberta' : st.kind === 'won' ? 'ganha' : 'perdida' })) }));
      const issues = checkAutomation(body, shape.find((x) => x.chave === p.key)!, shape);
      if (issues.length) throw unprocessable(issues.join(' '), issues.map((m) => ({ path: 'automacao', message: m })));
      const a = await resolveAutomationPeople(app.db, auth.tenantId, body, 'acoes');
      const [{ n } = { n: 0 }] = await app.db.select({ n: sql<number>`count(*)::int` }).from(s.pipelineAutomations).where(eq(s.pipelineAutomations.pipelineId, p.id));
      const [row] = await app.db.insert(s.pipelineAutomations).values({ tenantId: auth.tenantId, pipelineId: p.id, name: a.nome, active: a.ativo, trigger: a.gatilho as never, actions: a.acoes as never, position: n, createdBy: auth.userId }).returning({ id: s.pipelineAutomations.id });
      await audit(app.db, req, { action: 'automation.create', entityType: 'automation', entityId: row!.id, metadata: { name: a.nome } });
      reply.code(201);
      return { id: row!.id };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/admin/automations/:id',
    summary: 'Altera uma automação',
    tag: 'Jornadas',
    ...ADMIN,
    params: IdParams,
    body: AutomationSchema,
    handler: async ({ app, auth, params, body, req }) => {
      const [cur] = await app.db.select().from(s.pipelineAutomations).where(and(eq(s.pipelineAutomations.id, params.id), eq(s.pipelineAutomations.tenantId, auth.tenantId))).limit(1);
      if (!cur) throw notFound('Automação não encontrada.');
      const all = await pipelinesOf(app.db, auth.tenantId);
      const shape = all.map((x) => ({ chave: x.key, id: x.id, etapas: x.stages.map((st) => ({ chave: st.key, tipo: st.kind === 'open' ? 'aberta' : st.kind === 'won' ? 'ganha' : 'perdida' })) }));
      const mine = shape.find((x) => x.id === cur.pipelineId);
      if (!mine) throw unprocessable('A jornada desta automação está inativa.');
      const issues = checkAutomation(body, mine, shape);
      if (issues.length) throw unprocessable(issues.join(' '), issues.map((m) => ({ path: 'automacao', message: m })));
      const a = await resolveAutomationPeople(app.db, auth.tenantId, body, 'acoes');
      await app.db.update(s.pipelineAutomations).set({ name: a.nome, active: a.ativo, trigger: a.gatilho as never, actions: a.acoes as never, updatedAt: new Date() }).where(eq(s.pipelineAutomations.id, cur.id));
      await audit(app.db, req, { action: 'automation.update', entityType: 'automation', entityId: cur.id, metadata: { name: a.nome } });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'DELETE',
    url: '/admin/automations/:id',
    summary: 'Remove (desativa) uma automação; o histórico de execuções fica',
    tag: 'Jornadas',
    ...ADMIN,
    params: IdParams,
    handler: async ({ app, auth, params, reply, req }) => {
      const r = await app.db.update(s.pipelineAutomations).set({ active: false, updatedAt: new Date() }).where(and(eq(s.pipelineAutomations.id, params.id), eq(s.pipelineAutomations.tenantId, auth.tenantId))).returning({ name: s.pipelineAutomations.name });
      if (!r.length) throw notFound('Automação não encontrada.');
      await audit(app.db, req, { action: 'automation.delete', entityType: 'automation', entityId: params.id, metadata: { name: r[0]!.name } });
      return reply.code(204).send();
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/admin/automation-runs',
    summary: 'Últimas execuções de automações',
    tag: 'Jornadas',
    ...ADMIN,
    handler: async ({ app, auth }) => ({
      items: await app.db
        .select({ id: s.automationRuns.id, status: s.automationRuns.status, detail: s.automationRuns.detail, createdAt: s.automationRuns.createdAt, automation: s.pipelineAutomations.name, opportunityId: s.automationRuns.opportunityId, opportunityTitle: s.opportunities.title })
        .from(s.automationRuns)
        .innerJoin(s.pipelineAutomations, eq(s.pipelineAutomations.id, s.automationRuns.automationId))
        .innerJoin(s.opportunities, eq(s.opportunities.id, s.automationRuns.opportunityId))
        .where(eq(s.automationRuns.tenantId, auth.tenantId))
        .orderBy(desc(s.automationRuns.createdAt))
        .limit(50),
    }),
  }),

  // ================================================================== regiões e condomínios
  defineRoute({
    method: 'GET',
    url: '/meta/area',
    summary: 'Regiões e condomínios ativos (para o cadastro da oportunidade)',
    tag: 'Área de atendimento',
    anyAuthenticated: true,
    handler: async ({ app, auth }) => {
      const [regions, condos] = await Promise.all([
        app.db.select({ id: s.regions.id, name: s.regions.name }).from(s.regions).where(and(eq(s.regions.tenantId, auth.tenantId), eq(s.regions.active, true))).orderBy(asc(s.regions.name)),
        app.db.select().from(s.condominiums).where(and(eq(s.condominiums.tenantId, auth.tenantId), eq(s.condominiums.active, true))).orderBy(asc(s.condominiums.name)),
      ]);
      const used = await portUsage(app.db, auth.tenantId);
      const reserved = await portReservations(app.db, auth.tenantId);
      return { regions, condominiums: condos.map(({ tenantId: _t, createdAt: _c, ...c }) => ({ ...c, portsUsed: used.get(c.id) ?? 0, portsReserved: reserved.get(c.id) ?? 0, portsFree: c.ctoPorts == null ? null : Math.max(0, c.ctoPorts - (used.get(c.id) ?? 0) - (reserved.get(c.id) ?? 0)) })) };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/admin/area',
    summary: 'Regiões e condomínios (inclui inativos) com contagem de oportunidades',
    tag: 'Área de atendimento',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      const [regions, condos, counts] = await Promise.all([
        app.db.select().from(s.regions).where(eq(s.regions.tenantId, auth.tenantId)).orderBy(asc(s.regions.name)),
        app.db.select().from(s.condominiums).where(eq(s.condominiums.tenantId, auth.tenantId)).orderBy(asc(s.condominiums.name)),
        app.db.select({ id: s.opportunities.condominiumId, n: sql<number>`count(*)::int`, won: sql<number>`count(*) filter (where ${s.opportunities.stage} = 'ganha')::int` }).from(s.opportunities).where(and(eq(s.opportunities.tenantId, auth.tenantId), sql`${s.opportunities.condominiumId} is not null`)).groupBy(s.opportunities.condominiumId),
      ]);
      const used = await portUsage(app.db, auth.tenantId);
      const reserved = await portReservations(app.db, auth.tenantId);
      return { regions, condominiums: condos.map((c) => ({ ...c, opportunities: counts.find((x) => x.id === c.id)?.n ?? 0, won: counts.find((x) => x.id === c.id)?.won ?? 0, portsUsed: used.get(c.id) ?? 0, portsReserved: reserved.get(c.id) ?? 0 })) };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/admin/regions',
    summary: 'Cadastra região',
    tag: 'Área de atendimento',
    ...ADMIN,
    body: RegionUpsert,
    handler: async ({ app, auth, body, reply }) => {
      const [r] = await app.db.insert(s.regions).values({ tenantId: auth.tenantId, ...body }).onConflictDoNothing().returning();
      if (!r) throw unprocessable('Já existe uma região com esse nome.', [{ path: 'name', message: 'Nome repetido' }]);
      reply.code(201);
      return r;
    },
  }),
  defineRoute({
    method: 'PATCH',
    url: '/admin/regions/:id',
    summary: 'Renomeia ou desativa região',
    tag: 'Área de atendimento',
    ...ADMIN,
    params: IdParams,
    body: RegionUpsert.partial(),
    handler: async ({ app, auth, params, body }) => {
      const r = await app.db.update(s.regions).set(body).where(and(eq(s.regions.id, params.id), eq(s.regions.tenantId, auth.tenantId))).returning();
      if (!r.length) throw notFound('Região não encontrada.');
      return r[0];
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/admin/condominiums',
    summary: 'Cadastra condomínio',
    tag: 'Área de atendimento',
    ...ADMIN,
    body: CondominiumUpsert,
    handler: async ({ app, auth, body, reply }) => {
      const [reg] = await app.db.select({ id: s.regions.id }).from(s.regions).where(and(eq(s.regions.id, body.regionId), eq(s.regions.tenantId, auth.tenantId))).limit(1);
      if (!reg) throw unprocessable('Região inválida.', [{ path: 'regionId', message: 'Região não encontrada' }]);
      const [c] = await app.db.insert(s.condominiums).values({ tenantId: auth.tenantId, ...body }).returning();
      reply.code(201);
      return c;
    },
  }),
  defineRoute({
    method: 'PATCH',
    url: '/admin/condominiums/:id',
    summary: 'Altera ou desativa condomínio',
    tag: 'Área de atendimento',
    ...ADMIN,
    params: IdParams,
    body: CondominiumUpsert.partial(),
    handler: async ({ app, auth, params, body }) => {
      if (body.regionId) {
        const [reg] = await app.db.select({ id: s.regions.id }).from(s.regions).where(and(eq(s.regions.id, body.regionId), eq(s.regions.tenantId, auth.tenantId))).limit(1);
        if (!reg) throw unprocessable('Região inválida.', [{ path: 'regionId', message: 'Região não encontrada' }]);
      }
      const r = await app.db.update(s.condominiums).set(body).where(and(eq(s.condominiums.id, params.id), eq(s.condominiums.tenantId, auth.tenantId))).returning();
      if (!r.length) throw notFound('Condomínio não encontrado.');
      return r[0];
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/meta/cep/:cep',
    summary: 'Consulta CEP (ViaCEP) para preencher o endereço; sem resposta em 4s, segue manual',
    tag: 'Área de atendimento',
    anyAuthenticated: true,
    params: z.object({ cep: z.string().regex(/^\d{5}-?\d{3}$/) }),
    rateLimit: () => ({ max: 30, timeWindow: '1 minute' }),
    handler: async ({ params, app, auth }) => {
      const digits = params.cep.replace('-', '');
      const cep = `${digits.slice(0, 5)}-${digits.slice(5)}`;
      // condomínio cadastrado com esse CEP vem primeiro
      const condos = await app.db.select({ id: s.condominiums.id, name: s.condominiums.name }).from(s.condominiums).where(and(eq(s.condominiums.tenantId, auth.tenantId), eq(s.condominiums.active, true), sql`replace(${s.condominiums.cep}, '-', '') = ${digits}`));
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: ctl.signal });
        clearTimeout(t);
        const j = (await r.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
        if (j.erro) return { found: false, cep, condominiums: condos };
        return { found: true, cep, street: j.logradouro ?? null, district: j.bairro ?? null, city: j.localidade ?? null, state: j.uf ?? null, condominiums: condos };
      } catch {
        return { found: false, cep, unavailable: true, condominiums: condos };
      }
    },
  }),

  // ================================================================== viabilidade
  defineRoute({
    method: 'GET',
    url: '/admin/viability',
    summary: 'Parâmetros de viabilidade: tributos, parceiros, equipamentos, caminhos, regras, comissão e LTV',
    tag: 'Viabilidade',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      const t = auth.tenantId;
      const [deductions, equipments, routes, rules, commissions, [settings]] = await Promise.all([
        app.db.select().from(s.viabilityDeductions).where(and(eq(s.viabilityDeductions.tenantId, t), eq(s.viabilityDeductions.active, true))).orderBy(asc(s.viabilityDeductions.createdAt)),
        app.db.select().from(s.equipmentItems).where(and(eq(s.equipmentItems.tenantId, t), eq(s.equipmentItems.active, true))).orderBy(asc(s.equipmentItems.name)),
        app.db.select().from(s.deliveryRoutes).where(and(eq(s.deliveryRoutes.tenantId, t), eq(s.deliveryRoutes.active, true))).orderBy(asc(s.deliveryRoutes.createdAt)),
        app.db.select().from(s.routeRules).where(and(eq(s.routeRules.tenantId, t), eq(s.routeRules.active, true))).orderBy(asc(s.routeRules.position)),
        app.db.select().from(s.commissionRules).where(and(eq(s.commissionRules.tenantId, t), eq(s.commissionRules.active, true))).orderBy(asc(s.commissionRules.position)),
        app.db.select().from(s.viabilitySettings).where(eq(s.viabilitySettings.tenantId, t)).limit(1),
      ]);
      const params = await loadViabilityParams(app.db, t);
      const base = await historicalBase(app.db, t, params);
      const strip = <T extends { tenantId?: string }>(r: T) => { const { tenantId: _t, ...x } = r; return x; };
      return {
        taxes: deductions.filter((d) => d.category === 'tributo').map(strip),
        partners: deductions.filter((d) => d.category === 'parceiro').map(strip),
        equipments: equipments.map(strip),
        routes: routes.map(strip),
        rules: rules.map(strip),
        commissions: commissions.map(strip),
        settings: settings ? strip(settings) : { autonomyMaxMeters: 100, autonomyMaxMbps: 500, defaultRouteId: null, ltvLifetimeMonths: null, monthlyChurnBp: null, ltvMinSample: 30, maxPaybackMonths: null, defaultActivationFeeCents: null },
        base,
      };
    },
  }),
  ...(
    [
      ['taxes', DeductionItem, s.viabilityDeductions, { category: 'tributo' }, 'Tributos do negócio'],
      ['partners', DeductionItem, s.viabilityDeductions, { category: 'parceiro' }, 'Parceiros e fornecedores'],
      ['equipments', EquipmentItem, s.equipmentItems, {}, 'Equipamentos e custos'],
      ['routes', RouteItem, s.deliveryRoutes, {}, 'Caminhos de entrega'],
      ['rules', RouteRuleItem, s.routeRules, {}, 'Regras de distância e banda (ordem importa)'],
      ['commissions', CommissionRuleItem, s.commissionRules, {}, 'Regras de comissão (ordem importa)'],
    ] as const
  ).map(([name, item, table, extra, summary]) =>
    defineRoute({
      method: 'PUT',
      url: `/admin/viability/${name}`,
      summary: `${summary}: substitui a lista`,
      tag: 'Viabilidade',
      ...ADMIN,
      body: listOf(item as z.ZodTypeAny),
      handler: async ({ app, auth, body, req }) => {
        const items = body.items as { id?: string; routeId?: string; kit?: { equipmentId: string }[]; routeIds?: string[] }[];
        // referências precisam ser da mesma empresa
        const routeIds = [...new Set(items.flatMap((i) => [i.routeId, ...(i.routeIds ?? [])].filter(Boolean) as string[]))];
        if (routeIds.length) {
          const found = await app.db.select({ id: s.deliveryRoutes.id }).from(s.deliveryRoutes).where(and(eq(s.deliveryRoutes.tenantId, auth.tenantId), inArray(s.deliveryRoutes.id, routeIds)));
          if (found.length !== routeIds.length) throw unprocessable('Caminho de entrega inválido.', [{ path: 'routeId', message: 'Caminho não encontrado' }]);
        }
        const eqIds = [...new Set(items.flatMap((i) => (i.kit ?? []).map((k) => k.equipmentId)))];
        if (eqIds.length) {
          const found = await app.db.select({ id: s.equipmentItems.id }).from(s.equipmentItems).where(and(eq(s.equipmentItems.tenantId, auth.tenantId), inArray(s.equipmentItems.id, eqIds)));
          if (found.length !== eqIds.length) throw unprocessable('Equipamento inválido no kit.', [{ path: 'kit', message: 'Equipamento não encontrado' }]);
        }
        await app.db.transaction((tx) => replaceList(tx, table, auth.tenantId, items, extra, 'category' in extra ? { col: s.viabilityDeductions.category, value: (extra as { category: string }).category } : undefined));
        await audit(app.db, req, { action: 'viability.update', entityType: 'viability', entityId: name, metadata: { list: name, items: items.length } });
        return { ok: true };
      },
    }),
  ),
  defineRoute({
    method: 'PUT',
    url: '/admin/viability/settings',
    summary: 'Caminho padrão, LTV (vida média ou churn), amostra mínima, limite de payback e taxa de ativação padrão',
    tag: 'Viabilidade',
    ...ADMIN,
    body: ViabilitySettingsUpdate,
    handler: async ({ app, auth, body, req }) => {
      if (body.defaultRouteId) {
        const [r] = await app.db.select({ id: s.deliveryRoutes.id }).from(s.deliveryRoutes).where(and(eq(s.deliveryRoutes.id, body.defaultRouteId), eq(s.deliveryRoutes.tenantId, auth.tenantId))).limit(1);
        if (!r) throw unprocessable('Caminho padrão inválido.');
      }
      const values = { ...body, updatedBy: auth.userId, updatedAt: new Date() };
      await app.db.insert(s.viabilitySettings).values({ tenantId: auth.tenantId, ...values }).onConflictDoUpdate({ target: s.viabilitySettings.tenantId, set: values });
      await audit(app.db, req, { action: 'viability.update', entityType: 'viability', entityId: 'settings', metadata: { list: 'settings' } });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/meta/viability',
    summary: 'Dados para o formulário: equipamentos, caminhos e taxa de ativação padrão',
    tag: 'Viabilidade',
    module: 'oportunidades',
    handler: async ({ app, auth }) => {
      const p = await loadViabilityParams(app.db, auth.tenantId);
      const [settings] = await app.db.select({ fee: s.viabilitySettings.defaultActivationFeeCents }).from(s.viabilitySettings).where(eq(s.viabilitySettings.tenantId, auth.tenantId)).limit(1);
      return {
        equipments: p.equipments.filter((e) => e.active).map((e) => ({ id: e.id, name: e.name, costCents: e.costCents })),
        routes: p.routes.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name, requiresApproval: r.requiresApproval })),
        defaultActivationFeeCents: settings?.fee ?? null,
        configured: p.routes.some((r) => r.active),
      };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/viability/simulate',
    summary: 'Calcula a viabilidade sem gravar (prévia no formulário)',
    tag: 'Viabilidade',
    module: 'oportunidades',
    body: ViabilitySimulate,
    handler: async ({ app, auth, body }) => {
      let price: number | null = null;
      if (body.planId) {
        const [pl] = await app.db.select({ price: s.plans.priceCents }).from(s.plans).where(and(eq(s.plans.id, body.planId), eq(s.plans.tenantId, auth.tenantId))).limit(1);
        if (!pl) throw unprocessable('Plano inválido.', [{ path: 'planId', message: 'Plano não encontrado' }]);
        price = pl.price;
      }
      const { result } = await viabilityFor(app.db, auth.tenantId, { valueCents: price, planId: body.planId ?? null, cableMeters: body.cableMeters ?? null, activationFeeCents: body.activationFeeCents ?? null, saleType: body.saleType ?? null, equipment: body.equipment ?? null, routeId: body.routeId ?? null, location: body.location ?? null });
      return result;
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/opportunities/:id/viability',
    summary: 'Viabilidade atual da oportunidade (recalculada com os parâmetros de hoje)',
    tag: 'Viabilidade',
    module: 'oportunidades',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      const o = await loadOpportunity(app.db, auth, params.id);
      const { result } = await viabilityFor(app.db, auth.tenantId, o);
      // venda fechada: mostra o que foi gravado no fechamento, para não mudar comissão retroativamente
      const stored = o.stage === 'ganha' && o.viability ? (o.viability as unknown as typeof result) : null;
      return { current: result, closed: stored };
    },
  }),
];

