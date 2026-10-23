/**
 * Roteiros dos tipos de tarefa (Configurações → Modelos → Tipos de tarefa).
 * Cada salvamento é uma nova versão (append-only); vale a mais recente de cada tipo.
 */
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ACTIVITY_TYPES } from '@isp/domain';
import { defineRoute } from '../http/route';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';

export async function latestActivityScripts(db: DbOrTx, tenantId: string) {
  const rows = await db.selectDistinctOn([s.activityScripts.type], { type: s.activityScripts.type, script: s.activityScripts.script, updatedAt: s.activityScripts.createdAt, updatedByName: s.users.name })
    .from(s.activityScripts).leftJoin(s.users, eq(s.users.id, s.activityScripts.createdBy))
    .where(eq(s.activityScripts.tenantId, tenantId)).orderBy(s.activityScripts.type, desc(s.activityScripts.createdAt));
  return ACTIVITY_TYPES.map((type) => rows.find((r) => r.type === type) ?? { type, script: '', updatedAt: null, updatedByName: null });
}

export const activityScriptRoutes = [
  defineRoute({
    method: 'GET', url: '/admin/activity-scripts', summary: 'Roteiros dos tipos de tarefa', tag: 'Configurações', module: 'configuracoes', min: 'total',
    handler: async ({ app, auth }) => ({ items: await latestActivityScripts(app.db, auth.tenantId) }),
  }),
  defineRoute({
    method: 'PUT', url: '/admin/activity-scripts', summary: 'Salva o roteiro de um tipo de tarefa (nova versão)', tag: 'Configurações', module: 'configuracoes', min: 'total',
    body: z.object({ type: z.enum(ACTIVITY_TYPES), script: z.string().max(10_000) }),
    handler: async ({ app, auth, body }) => {
      await app.db.insert(s.activityScripts).values({ tenantId: auth.tenantId, type: body.type, script: body.script.trim(), createdBy: auth.userId });
      return { items: await latestActivityScripts(app.db, auth.tenantId) };
    },
  }),
];
