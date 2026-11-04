/**
 * Playbook Comercial: matriz RACI (fixa, do documento), titulares dos papéis e SLA por atividade.
 * Titulares e SLA começam em aberto; quem administra Contratos preenche quando a empresa definir.
 */
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { PLAYBOOK_ROLES, PLAYBOOK_ROLE_LABELS, RACI_KEYS, RACI_MATRIX, RACI_PHASES, RACI_PHASE_LABELS, isPlaybookRole } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { assertUsersActive } from '../services/tasks';
import { isAdmin } from '../services/contracts';

export const canManagePlaybook = (auth: AuthContext) => isAdmin(auth) || level(auth, 'contratos') === 'total';
const guard = (auth: AuthContext) => { if (!canManagePlaybook(auth)) throw forbidden('Só a gerência de contratos ou a administração altera titulares e prazos.'); };

export const playbookRoutes = [
  defineRoute({
    method: 'GET',
    url: '/contract-playbook',
    summary: 'Matriz RACI do Playbook, titulares dos papéis (em aberto até serem definidos) e SLA por atividade',
    tag: 'Contratos',
    module: 'contratos',
    handler: async ({ app, auth }) => {
      const [holders, sla] = await Promise.all([
        app.db.select({ id: s.playbookRoleHolders.id, role: s.playbookRoleHolders.role, userId: s.playbookRoleHolders.userId, userName: s.users.name, externalName: s.playbookRoleHolders.externalName })
          .from(s.playbookRoleHolders).leftJoin(s.users, eq(s.users.id, s.playbookRoleHolders.userId))
          .where(eq(s.playbookRoleHolders.tenantId, auth.tenantId)).orderBy(asc(s.playbookRoleHolders.createdAt)),
        app.db.select({ key: s.raciSettings.activityKey, slaHours: s.raciSettings.slaHours }).from(s.raciSettings).where(eq(s.raciSettings.tenantId, auth.tenantId)),
      ]);
      const slaOf = new Map(sla.map((x) => [x.key, x.slaHours]));
      return {
        roles: PLAYBOOK_ROLES.map((r) => ({ key: r, label: PLAYBOOK_ROLE_LABELS[r], holders: holders.filter((h) => h.role === r) })),
        phases: RACI_PHASES.map((p) => ({ key: p, label: RACI_PHASE_LABELS[p] })),
        matrix: RACI_MATRIX.map((x) => ({ ...x, slaHours: slaOf.get(x.key) ?? null })),
        canManage: canManagePlaybook(auth),
      };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/contract-playbook/holders',
    summary: 'Define um titular do papel: usuário do sistema ou ator externo (nome, sem login)',
    tag: 'Contratos',
    module: 'contratos',
    body: z.object({ role: z.string(), userId: z.string().uuid().nullable().optional(), externalName: z.string().trim().min(2).max(120).nullable().optional() }),
    handler: async ({ app, auth, body, reply }) => {
      guard(auth);
      if (!isPlaybookRole(body.role)) throw unprocessable('Papel desconhecido.', [{ path: 'role', message: 'Fora do Playbook' }]);
      if (!body.userId === !body.externalName) throw unprocessable('Escolha um usuário ou informe o nome do ator externo.', [{ path: 'userId', message: 'Um dos dois' }]);
      if (body.userId) await assertUsersActive(app.db, auth, [body.userId], 'userId');
      const [h] = await app.db.insert(s.playbookRoleHolders).values({ tenantId: auth.tenantId, role: body.role, userId: body.userId ?? null, externalName: body.externalName ?? null, createdBy: auth.userId }).onConflictDoNothing().returning({ id: s.playbookRoleHolders.id });
      if (!h) throw unprocessable('Esta pessoa já é titular do papel.');
      reply.code(201);
      return h;
    },
  }),

  defineRoute({
    method: 'DELETE',
    url: '/contract-playbook/holders/:id',
    summary: 'Remove um titular do papel (o papel volta a ficar em aberto se for o último)',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    handler: async ({ app, auth, params }) => {
      guard(auth);
      const r = await app.db.delete(s.playbookRoleHolders).where(and(eq(s.playbookRoleHolders.id, params.id), eq(s.playbookRoleHolders.tenantId, auth.tenantId))).returning({ id: s.playbookRoleHolders.id });
      if (!r.length) throw notFound('Titular não encontrado.');
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/contract-playbook/sla/:key',
    summary: 'Prazo (SLA, em horas) de uma atividade da matriz; vazio = sem SLA',
    tag: 'Contratos',
    module: 'contratos',
    params: z.object({ key: z.string() }),
    body: z.object({ slaHours: z.number().int().min(1).max(24 * 365).nullable() }),
    handler: async ({ app, auth, params, body }) => {
      guard(auth);
      if (!RACI_KEYS.includes(params.key)) throw notFound('Atividade fora da matriz RACI.');
      await app.db.insert(s.raciSettings).values({ tenantId: auth.tenantId, activityKey: params.key, slaHours: body.slaHours, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: [s.raciSettings.tenantId, s.raciSettings.activityKey], set: { slaHours: body.slaHours, updatedBy: auth.userId, updatedAt: new Date() } });
      return { key: params.key, slaHours: body.slaHours };
    },
  }),
];
