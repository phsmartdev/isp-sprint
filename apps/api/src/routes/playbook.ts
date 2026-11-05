/**
 * Playbook Comercial: matriz RACI (fixa, do documento), quem ocupa cada papel, SLA por atividade, regras de aviso por
 * nível de responsabilidade e atores externos.
 * Parametrização: papéis de cada pessoa no CADASTRO DO USUÁRIO (Configurações → Usuários); SLA, avisos e atores
 * externos em Configurações → Responsabilidades de contratos. A aba do módulo só consulta.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  NOTIFY_EVENTS, PLAYBOOK_EXTERNAL_ROLES, PLAYBOOK_ROLES, PLAYBOOK_ROLE_LABELS, RACI_KEYS, RACI_LETTERS, RACI_MATRIX, RACI_PHASES, RACI_PHASE_LABELS, isExternalRole, normalizeAssignees, normalizeNotifyRules,
} from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import { level } from '../services/scope';
import { isAdmin } from '../services/contracts';
import { notifyRulesOf } from '../services/contractNotify';
import { waPhone } from '../services/whatsapp';

export const canManagePlaybook = (auth: AuthContext) => isAdmin(auth) || level(auth, 'contratos') === 'total';
const guard = (auth: AuthContext) => { if (!canManagePlaybook(auth)) throw forbidden('Só a administração ou quem tem nível Total em Contratos parametriza responsabilidades.'); };

const Actor = z.object({
  name: z.string().trim().min(2).max(120),
  organization: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(200).nullable().optional().or(z.literal('').transform(() => null)),
  whatsapp: z.string().trim().max(30).nullable().optional(),
  channels: z.array(z.enum(['email', 'whatsapp'])).max(2).default([]),
  roles: z.array(z.enum(PLAYBOOK_EXTERNAL_ROLES, { errorMap: () => ({ message: 'Ator externo só ocupa papéis externos' }) })).max(7).default([]),
  notes: z.string().trim().max(1000).nullable().optional(),
  active: z.boolean().optional(),
});
function checkActor(b: z.infer<typeof Actor>) {
  if (b.channels.includes('email') && !b.email) throw unprocessable('Informe o e-mail para avisar por e-mail.', [{ path: 'email', message: 'Obrigatório no canal e-mail' }]);
  if (b.channels.includes('whatsapp') && !waPhone(b.whatsapp)) throw unprocessable('Informe o WhatsApp com DDD para avisar por WhatsApp.', [{ path: 'whatsapp', message: 'Número inválido' }]);
}

async function rulesSave(db: Parameters<typeof notifyRulesOf>[0], tenantId: string, rules: unknown, userId: string) {
  const [r] = await db.select({ settings: s.contractSettings.settings }).from(s.contractSettings).where(eq(s.contractSettings.tenantId, tenantId)).limit(1);
  const settings = { ...((r?.settings ?? {}) as Record<string, unknown>), notifyRules: rules };
  await db.insert(s.contractSettings).values({ tenantId, settings, updatedBy: userId }).onConflictDoUpdate({ target: s.contractSettings.tenantId, set: { settings, updatedBy: userId, updatedAt: new Date() } });
}

export const playbookRoutes = [
  defineRoute({
    method: 'GET',
    url: '/contract-playbook',
    summary: 'Matriz RACI, quem ocupa cada papel (usuários e atores externos), SLA por atividade e regras de aviso',
    tag: 'Contratos',
    module: 'contratos',
    handler: async ({ app, auth }) => {
      const [users, actors, sla, rules] = await Promise.all([
        app.db.select({ id: s.users.id, name: s.users.name, email: s.users.email, roles: s.users.playbookRoles }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true))).orderBy(asc(s.users.name)),
        app.db.select().from(s.contractExternalActors).where(eq(s.contractExternalActors.tenantId, auth.tenantId)).orderBy(asc(s.contractExternalActors.name)),
        app.db.select({ key: s.raciSettings.activityKey, slaHours: s.raciSettings.slaHours, assignees: s.raciSettings.assignees }).from(s.raciSettings).where(eq(s.raciSettings.tenantId, auth.tenantId)),
        notifyRulesOf(app.db, auth.tenantId),
      ]);
      const slaOf = new Map(sla.map((x) => [x.key, x]));
      const manage = canManagePlaybook(auth);
      const nameOf = new Map<string, { name: string; active: boolean }>([...users.map((u) => [`user:${u.id}`, { name: u.name, active: true }] as const), ...actors.map((a) => [`actor:${a.id}`, { name: a.name, active: a.active }] as const)]);
      const named = (v: unknown) => Object.fromEntries(Object.entries(normalizeAssignees(v)).map(([l, ps]) => [l, ps.map((p) => ({ ...p, name: nameOf.get(`${p.kind}:${p.id}`)?.name ?? 'Pessoa removida', active: nameOf.get(`${p.kind}:${p.id}`)?.active ?? false }))]));
      return {
        roles: PLAYBOOK_ROLES.map((r) => ({
          key: r, label: PLAYBOOK_ROLE_LABELS[r], external: isExternalRole(r),
          users: users.filter((u) => u.roles.includes(r)).map((u) => ({ id: u.id, name: u.name })),
          actors: actors.filter((a) => a.active && a.roles.includes(r)).map((a) => ({ id: a.id, name: a.name, organization: a.organization, channels: a.channels })),
        })),
        phases: RACI_PHASES.map((p) => ({ key: p, label: RACI_PHASE_LABELS[p] })),
        matrix: RACI_MATRIX.map((x) => ({ ...x, slaHours: slaOf.get(x.key)?.slaHours ?? null, assignees: named(slaOf.get(x.key)?.assignees) })),
        // quem pode ser indicado como responsável numa atividade
        people: manage ? [...users.map((u) => ({ kind: 'user' as const, id: u.id, name: u.name })), ...actors.filter((a) => a.active).map((a) => ({ kind: 'actor' as const, id: a.id, name: a.name, organization: a.organization }))] : [],
        rules,
        // contato dos atores externos só para quem parametriza
        actors: manage ? actors : actors.map((a) => ({ id: a.id, name: a.name, organization: a.organization, roles: a.roles, channels: a.channels, active: a.active })),
        canManage: manage,
      };
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

  defineRoute({
    method: 'PUT',
    url: '/contract-playbook/assignees/:key',
    summary: 'Responsáveis nomeados de uma atividade por letra (R/A/C/I); letra vazia = vale o papel da matriz',
    tag: 'Contratos',
    module: 'contratos',
    params: z.object({ key: z.string() }),
    body: z.object({ assignees: z.record(z.enum(RACI_LETTERS), z.array(z.object({ kind: z.enum(['user', 'actor']), id: z.string().uuid() })).max(10)) }),
    handler: async ({ app, auth, params, body }) => {
      guard(auth);
      if (!RACI_KEYS.includes(params.key)) throw notFound('Atividade fora da matriz RACI.');
      if ((body.assignees.A?.length ?? 0) > 1) throw unprocessable('A atividade tem um único responsável final (A).', [{ path: 'assignees.A', message: 'Só uma pessoa' }]);
      const assignees = normalizeAssignees(body.assignees);
      const all = Object.values(assignees).flat();
      const uIds = [...new Set(all.filter((p) => p.kind === 'user').map((p) => p.id))], aIds = [...new Set(all.filter((p) => p.kind === 'actor').map((p) => p.id))];
      const [us, as] = await Promise.all([
        uIds.length ? app.db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, auth.tenantId), eq(s.users.active, true), inArray(s.users.id, uIds))) : [],
        aIds.length ? app.db.select({ id: s.contractExternalActors.id }).from(s.contractExternalActors).where(and(eq(s.contractExternalActors.tenantId, auth.tenantId), eq(s.contractExternalActors.active, true), inArray(s.contractExternalActors.id, aIds))) : [],
      ]);
      if (us.length !== uIds.length || as.length !== aIds.length) throw unprocessable('Pessoa indicada não encontrada ou inativa.');
      await app.db.insert(s.raciSettings).values({ tenantId: auth.tenantId, activityKey: params.key, assignees, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: [s.raciSettings.tenantId, s.raciSettings.activityKey], set: { assignees, updatedBy: auth.userId, updatedAt: new Date() } });
      return { key: params.key, assignees };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/contract-playbook/notify-rules',
    summary: 'Regras de aviso por nível de responsabilidade: quem (R/A/C/I) recebe cada evento, antecedência e escalonamento',
    tag: 'Contratos',
    module: 'contratos',
    body: z.object({
      events: z.record(z.enum(NOTIFY_EVENTS), z.array(z.enum(RACI_LETTERS)).max(4)),
      dueSoonHours: z.number().int().min(1).max(24 * 60).nullable(),
      escalation: z.array(z.object({ afterHours: z.number().int().min(1).max(24 * 365), role: z.enum(PLAYBOOK_ROLES) })).max(5),
    }),
    handler: async ({ app, auth, body }) => {
      guard(auth);
      const rules = normalizeNotifyRules(body);
      await rulesSave(app.db, auth.tenantId, rules, auth.userId);
      return rules;
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/contract-external-actors',
    summary: 'Cadastra ator externo do Playbook com os papéis e os canais de aviso',
    tag: 'Contratos',
    module: 'contratos',
    body: Actor,
    handler: async ({ app, auth, body, reply }) => {
      guard(auth); checkActor(body);
      const [a] = await app.db.insert(s.contractExternalActors).values({ tenantId: auth.tenantId, name: body.name, organization: body.organization ?? null, email: body.email ?? null, whatsapp: body.whatsapp ?? null, channels: body.channels, roles: body.roles, notes: body.notes ?? null, createdBy: auth.userId }).returning({ id: s.contractExternalActors.id });
      reply.code(201);
      return a!;
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/contract-external-actors/:id',
    summary: 'Atualiza ator externo (papéis, canais, contato, ativo)',
    tag: 'Contratos',
    module: 'contratos',
    params: IdParams,
    body: Actor,
    handler: async ({ app, auth, params, body }) => {
      guard(auth); checkActor(body);
      const r = await app.db.update(s.contractExternalActors).set({ name: body.name, organization: body.organization ?? null, email: body.email ?? null, whatsapp: body.whatsapp ?? null, channels: body.channels, roles: body.roles, notes: body.notes ?? null, active: body.active ?? true, updatedAt: new Date() })
        .where(and(eq(s.contractExternalActors.id, params.id), eq(s.contractExternalActors.tenantId, auth.tenantId))).returning({ id: s.contractExternalActors.id });
      if (!r.length) throw notFound('Ator externo não encontrado.');
      return { ok: true };
    },
  }),
];
