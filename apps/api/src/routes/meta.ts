import { and, asc, eq, sql } from 'drizzle-orm';
import { latestActivityScripts } from './activityScripts';
import { defineRoute } from '../http/route';
import * as s from '../db/schema';
import { ensureSalesBranches } from '../services/opportunities';
import { ensureTenantSetup, pipelineAllowed, pipelinesOf } from '../services/instructions';
import { level } from '../services/scope';

export const metaRoutes = [
  defineRoute({
    method: 'GET',
    url: '/meta/lookups',
    summary: 'Listas de apoio: usuários, origens, campanhas, etapas, times e planos ativos',
    tag: 'Configurações',
    anyAuthenticated: true,
    handler: async ({ app, auth }) => {
      const t = auth.tenantId;
      await ensureTenantSetup(app.db, t, ensureSalesBranches);
      const branchesQ = app.db.select({ id: s.salesBranches.id, name: s.salesBranches.name, fiscalKinds: s.salesBranches.fiscalKinds }).from(s.salesBranches).where(and(eq(s.salesBranches.tenantId, t), eq(s.salesBranches.active, true))).orderBy(asc(s.salesBranches.position), asc(s.salesBranches.name));
      const [brandRows, branches, scripts, users, sources, campaigns, pipes, teams, plans] = await Promise.all([
        app.db.select({ slot: s.brandAssets.slot, sha: s.brandAssets.sha256 }).from(s.brandAssets).where(eq(s.brandAssets.tenantId, t)),
        branchesQ,
        latestActivityScripts(app.db, t),
        app.db
          .select({ id: s.users.id, name: s.users.name, sectors: s.users.sectors, isCsm: s.users.isCsm, hasAvatar: sql<boolean>`exists(select 1 from user_avatars ua where ua.user_id = "users"."id")` })
          .from(s.users)
          .where(and(eq(s.users.tenantId, t), eq(s.users.active, true)))
          .orderBy(asc(s.users.name)),
        app.db.select({ id: s.leadSources.id, name: s.leadSources.name }).from(s.leadSources).where(and(eq(s.leadSources.tenantId, t), eq(s.leadSources.active, true))).orderBy(asc(s.leadSources.name)),
        app.db.select({ id: s.campaigns.id, name: s.campaigns.name, sourceId: s.campaigns.sourceId }).from(s.campaigns).where(and(eq(s.campaigns.tenantId, t), eq(s.campaigns.active, true))).orderBy(asc(s.campaigns.name)),
        pipelinesOf(app.db, t),
        app.db.select({ id: s.teams.id, name: s.teams.name }).from(s.teams).where(and(eq(s.teams.tenantId, t), eq(s.teams.active, true))).orderBy(asc(s.teams.name)),
        app.db
          .select({ id: s.plans.id, name: s.plans.name, line: s.plans.line, segment: s.plans.segment, priceCents: s.plans.priceCents, speedMbps: s.plans.speedMbps, fiscalDocCode: s.plans.fiscalDocCode })
          .from(s.plans)
          .where(and(eq(s.plans.tenantId, t), eq(s.plans.active, true)))
          .orderBy(asc(s.plans.priceCents)),
      ]);
      const total = level(auth, 'oportunidades') === 'total';
      const pipelines = pipes.map((p) => ({
        id: p.id, key: p.key, name: p.name, description: p.description, segments: p.segments, isDefault: p.isDefault,
        allowed: pipelineAllowed(p, auth.userId, total),
        fields: p.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options, required: f.required, saleKinds: f.saleKinds })),
        stages: p.stages.map((st) => ({ id: st.id, key: st.key, name: st.name, position: st.position, kind: st.kind, isTerminal: st.isTerminal, color: st.color, requirements: st.requirements })),
      }));
      const def = pipelines.find((p) => p.isDefault) ?? pipelines[0];
      const activityScripts = Object.fromEntries(scripts.filter((x) => x.script).map((x) => [x.type, x.script]));
      /** imagens da Personalização já enviadas (espaço → versão), para as telas não pedirem imagem que não existe */
      const brand = Object.fromEntries(brandRows.map((b) => [b.slot, b.sha.slice(0, 12)]));
      return { users, sources, campaigns, pipelines, stages: def?.stages ?? [], teams, plans, branches, activityScripts, brand };
    },
  }),
];
