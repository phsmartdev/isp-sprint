/** Configurações: modelo de instrução, jornadas, SMTP, notificações, registro de e-mails e agendamento. */
import { syncTenantMail } from '../services/gmail';
import { timingSafeEqual } from 'node:crypto';
import { runAbmDaily } from '../services/abmFollowup';
import { and, desc, eq, max, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { diffInstruction, InstructionUpload, NotificationUpdate, parseInstruction, SmtpTest, SmtpUpdate, type Instruction } from '@isp/shared';
import { defineRoute, IdParams } from '../http/route';
import { notFound, unauthorized, unprocessable, AppError } from '../http/errors';
import * as s from '../db/schema';
import { runCsDaily } from '../services/cs';
import { performanceConfig, syncBusinessEvents } from '../services/businessEvents';
import { closeDueGoals, rollRecurringGoals } from '../services/indicators';
import { syncInterventions } from '../services/interventions';
import { applyJourneys, exportable, getActiveInstruction, journeyBlockers, pipelinesOf } from '../services/instructions';
import { encryptSecret, notificationsOf, sendEmail, smtpConfig } from '../services/email';
import { sendActivityDigests } from '../services/alerts';
import { runIdleAutomations } from '../services/automations';
import { runContractAlerts } from '../services/contractAlerts';
import { audit } from '../services/audit';

const ADMIN = { module: 'configuracoes' as const, min: 'total' as const };

export const settingsRoutes = [
  // ------------------------------------------------------------------ modelo de instrução
  defineRoute({
    method: 'GET',
    url: '/admin/instructions',
    summary: 'Versões do modelo de instrução (ativa, rascunhos e arquivadas)',
    tag: 'Modelo de instrução',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      const active = await getActiveInstruction(app.db, auth.tenantId);
      const creator = sql<string | null>`(select name from users u where u.id = ${s.businessInstructions.createdBy})`;
      const activator = sql<string | null>`(select name from users u where u.id = ${s.businessInstructions.activatedBy})`;
      const versions = await app.db
        .select({ id: s.businessInstructions.id, version: s.businessInstructions.version, status: s.businessInstructions.status, changes: s.businessInstructions.changes, notes: s.businessInstructions.notes, createdAt: s.businessInstructions.createdAt, createdByName: creator, activatedAt: s.businessInstructions.activatedAt, activatedByName: activator })
        .from(s.businessInstructions)
        .where(eq(s.businessInstructions.tenantId, auth.tenantId))
        .orderBy(desc(s.businessInstructions.version))
        .limit(50);
      const j = active.content.jornadas;
      return {
        active: { id: active.id, version: active.version, journeys: j.length, stages: j.reduce((a, x) => a + x.etapas.length, 0), questions: j.reduce((a, x) => a + x.etapas.reduce((b, e) => b + e.perguntas.length, 0), 0), objections: active.content.objecoes.length },
        versions,
      };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/admin/instructions/export',
    summary: 'Baixa o modelo de instrução (ativo ou uma versão) em JSON para adaptar',
    tag: 'Modelo de instrução',
    ...ADMIN,
    query: z.object({ version: z.coerce.number().int().min(1).optional() }),
    handler: async ({ app, auth, query, reply, req }) => {
      let content: unknown;
      let version: number;
      if (query.version) {
        const [r] = await app.db.select().from(s.businessInstructions).where(and(eq(s.businessInstructions.tenantId, auth.tenantId), eq(s.businessInstructions.version, query.version))).limit(1);
        if (!r) throw notFound('Versão não encontrada.');
        content = r.content;
        version = r.version;
      } else {
        const a = await getActiveInstruction(app.db, auth.tenantId);
        content = a.content;
        version = a.version;
      }
      await audit(app.db, req, { action: 'instruction.export', entityType: 'instruction', entityId: String(version), metadata: { version } });
      reply.header('content-type', 'application/json; charset=utf-8').header('content-disposition', `attachment; filename="modelo-instrucao-v${version}.json"`);
      return JSON.stringify(exportable(content as Instruction, version), null, 2);
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/admin/instructions',
    summary: 'Envia uma nova instrução: valida, calcula a prévia e guarda como rascunho (não ativa)',
    tag: 'Modelo de instrução',
    ...ADMIN,
    body: InstructionUpload,
    bodyLimit: 2_000_000,
    handler: async ({ app, auth, body, reply, req }) => {
      const parsed = parseInstruction(body.content);
      if (!parsed.ok) throw unprocessable(`O modelo tem ${parsed.issues.length} problema(s). Corrija e envie de novo.`, parsed.issues.slice(0, 50));
      const active = await getActiveInstruction(app.db, auth.tenantId);
      const changes = diffInstruction(active.content, parsed.value);
      const blockers = await journeyBlockers(app.db, auth.tenantId, parsed.value.jornadas);
      const content = { ...parsed.value, _leia_me: undefined, versao: undefined };
      const row = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'instr:' + auth.tenantId}))`);
        const [m] = await tx.select({ v: max(s.businessInstructions.version) }).from(s.businessInstructions).where(eq(s.businessInstructions.tenantId, auth.tenantId));
        const [r] = await tx
          .insert(s.businessInstructions)
          .values({ tenantId: auth.tenantId, version: (m?.v ?? 0) + 1, status: 'rascunho', content, changes, notes: body.notes ?? null, createdBy: auth.userId })
          .returning({ id: s.businessInstructions.id, version: s.businessInstructions.version });
        return r!;
      });
      await audit(app.db, req, { action: 'instruction.upload', entityType: 'instruction', entityId: String(row.version), metadata: { version: row.version, changes: changes.length } });
      reply.code(201);
      return { id: row.id, version: row.version, changes, blockers };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/admin/instructions/:id/activate',
    summary: 'Ativa uma versão (rascunho ou anterior): aplica jornadas, roteiro, insights e e-mails',
    tag: 'Modelo de instrução',
    ...ADMIN,
    params: IdParams,
    handler: async ({ app, auth, params, req }) => {
      const result = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'instr:' + auth.tenantId}))`);
        const [r] = await tx.select().from(s.businessInstructions).where(and(eq(s.businessInstructions.id, params.id), eq(s.businessInstructions.tenantId, auth.tenantId))).limit(1);
        if (!r) throw notFound('Versão não encontrada.');
        if (r.status === 'ativa') throw unprocessable('Esta versão já está ativa.');
        const parsed = parseInstruction(r.content);
        if (!parsed.ok) throw unprocessable('Esta versão não é mais válida.', parsed.issues);
        await applyJourneys(tx, auth.tenantId, parsed.value.jornadas);
        await tx.update(s.businessInstructions).set({ status: 'arquivada' }).where(and(eq(s.businessInstructions.tenantId, auth.tenantId), eq(s.businessInstructions.status, 'ativa')));
        await tx.update(s.businessInstructions).set({ status: 'ativa', activatedAt: new Date(), activatedBy: auth.userId }).where(eq(s.businessInstructions.id, r.id));
        return { version: r.version };
      });
      await audit(app.db, req, { action: 'instruction.activate', entityType: 'instruction', entityId: String(result.version), metadata: { version: result.version } });
      return { ok: true, version: result.version };
    },
  }),

  defineRoute({
    method: 'DELETE',
    url: '/admin/instructions/:id',
    summary: 'Descarta um rascunho',
    tag: 'Modelo de instrução',
    ...ADMIN,
    params: IdParams,
    handler: async ({ app, auth, params, reply }) => {
      const r = await app.db
        .delete(s.businessInstructions)
        .where(and(eq(s.businessInstructions.id, params.id), eq(s.businessInstructions.tenantId, auth.tenantId), eq(s.businessInstructions.status, 'rascunho')))
        .returning({ id: s.businessInstructions.id });
      if (!r.length) throw unprocessable('Só rascunhos podem ser descartados.');
      return reply.code(204).send();
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/admin/pipelines',
    summary: 'Jornadas e etapas ativas, com contagem de oportunidades abertas',
    tag: 'Modelo de instrução',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      await getActiveInstruction(app.db, auth.tenantId);
      const pipes = await pipelinesOf(app.db, auth.tenantId);
      const counts = await app.db
        .select({ pipelineId: s.opportunities.pipelineId, stage: s.opportunities.stage, n: sql<number>`count(*)::int` })
        .from(s.opportunities)
        .where(and(eq(s.opportunities.tenantId, auth.tenantId), sql`${s.opportunities.deletedAt} is null`))
        .groupBy(s.opportunities.pipelineId, s.opportunities.stage);
      return {
        items: pipes.map((p) => ({ ...p, stages: p.stages.map((st) => ({ ...st, count: counts.find((c) => c.pipelineId === p.id && c.stage === st.key)?.n ?? 0 })) })),
      };
    },
  }),

  // ------------------------------------------------------------------ SMTP
  defineRoute({
    method: 'GET',
    url: '/admin/smtp',
    summary: 'Configuração do SMTP (sem a senha)',
    tag: 'E-mail',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      const c = await smtpConfig(app.db, auth.tenantId);
      if (!c) return { configured: false };
      const { passwordEnc, tenantId: _t, updatedBy: _u, ...rest } = c;
      return { configured: true, ...rest, hasPassword: !!passwordEnc };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/admin/smtp',
    summary: 'Salva o SMTP. A senha é cifrada no servidor e nunca volta para a tela.',
    tag: 'E-mail',
    ...ADMIN,
    body: SmtpUpdate,
    handler: async ({ app, auth, body, req }) => {
      const cur = await smtpConfig(app.db, auth.tenantId);
      const passwordEnc = body.password === undefined ? (cur?.passwordEnc ?? null) : body.password === '' ? null : encryptSecret(body.password);
      const values = { host: body.host, port: body.port, secure: body.secure, username: body.username, passwordEnc, fromName: body.fromName, fromEmail: body.fromEmail, replyTo: body.replyTo ?? null, enabled: body.enabled, updatedBy: auth.userId, updatedAt: new Date() };
      await app.db.insert(s.smtpSettings).values({ tenantId: auth.tenantId, ...values }).onConflictDoUpdate({ target: s.smtpSettings.tenantId, set: values });
      await audit(app.db, req, { action: 'smtp.update', entityType: 'smtp', entityId: auth.tenantId, metadata: { host: body.host, port: body.port, passwordChanged: body.password !== undefined } });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/admin/smtp/test',
    summary: 'Envia um e-mail de teste com a configuração salva',
    tag: 'E-mail',
    ...ADMIN,
    body: SmtpTest,
    rateLimit: () => ({ max: 10, timeWindow: '1 minute' }),
    handler: async ({ app, auth, body }) => {
      if (!(await smtpConfig(app.db, auth.tenantId))) throw unprocessable('Salve a configuração do SMTP antes de testar.');
      const r = await sendEmail(app.db, { tenantId: auth.tenantId, kind: 'teste', to: body.to, subject: 'Teste de e-mail do RevOps', text: `Olá!\n\nSe você recebeu esta mensagem, o envio de e-mail está funcionando.\n\nEnviado por ${auth.name}.`, createdBy: auth.userId });
      await app.db.update(s.smtpSettings).set({ lastTestAt: new Date(), lastTestOk: r.ok, lastTestError: r.ok ? null : r.error }).where(eq(s.smtpSettings.tenantId, auth.tenantId));
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/admin/notifications',
    summary: 'Alertas automáticos por e-mail ligados ou desligados',
    tag: 'E-mail',
    ...ADMIN,
    handler: async ({ app, auth }) => {
      const n = await notificationsOf(app.db, auth.tenantId);
      return { activityDigest: n.activityDigest, leadAssigned: n.leadAssigned, dealWon: n.dealWon, userAccess: n.userAccess, smtpConfigured: !!(await smtpConfig(app.db, auth.tenantId)), cronConfigured: !!app.config.cronSecret };
    },
  }),

  defineRoute({
    method: 'PUT',
    url: '/admin/notifications',
    summary: 'Liga ou desliga os alertas automáticos',
    tag: 'E-mail',
    ...ADMIN,
    body: NotificationUpdate,
    handler: async ({ app, auth, body, req }) => {
      const values = { ...body, updatedBy: auth.userId, updatedAt: new Date() };
      await app.db.insert(s.notificationSettings).values({ tenantId: auth.tenantId, ...values }).onConflictDoUpdate({ target: s.notificationSettings.tenantId, set: values });
      await audit(app.db, req, { action: 'notifications.update', entityType: 'notifications', entityId: auth.tenantId, metadata: body });
      return { ok: true };
    },
  }),

  defineRoute({
    method: 'GET',
    url: '/admin/emails',
    summary: 'Registro de e-mails enviados, com falhas',
    tag: 'E-mail',
    ...ADMIN,
    query: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }),
    handler: async ({ app, auth, query }) => {
      const where = and(eq(s.emailMessages.tenantId, auth.tenantId), ne(s.emailMessages.kind, '__never__'));
      const [items, [{ total } = { total: 0 }]] = await Promise.all([
        app.db
          .select({ id: s.emailMessages.id, kind: s.emailMessages.kind, to: s.emailMessages.toAddress, subject: s.emailMessages.subject, status: s.emailMessages.status, error: s.emailMessages.error, createdAt: s.emailMessages.createdAt, createdByName: s.users.name })
          .from(s.emailMessages)
          .leftJoin(s.users, eq(s.users.id, s.emailMessages.createdBy))
          .where(where)
          .orderBy(desc(s.emailMessages.createdAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        app.db.select({ total: sql<number>`count(*)::int` }).from(s.emailMessages).where(where),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total };
    },
  }),

  // ------------------------------------------------------------------ agendamento (Vercel Cron)
  defineRoute({
    method: 'GET',
    url: '/cron/alerts',
    summary: 'Rotina diária: resumo de atividades, automações paradas e monitoramento de contratos. Exige Authorization: Bearer CRON_SECRET.',
    tag: 'E-mail',
    public: true,
    handler: async ({ app, req }) => {
      const secret = app.config.cronSecret;
      if (!secret) throw new AppError(503, 'Agendamento desligado', 'Defina CRON_SECRET para ativar o resumo diário.');
      const given = Buffer.from(String(req.headers.authorization ?? ''));
      const expected = Buffer.from(`Bearer ${secret}`);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized();
      const digests = await sendActivityDigests(app.db, app.config);
      const idle = await runIdleAutomations(app.db, app.config);
      const contracts = await runContractAlerts(app.db, app.config);
      const tenants = await app.db.select({ id: s.tenants.id }).from(s.tenants);
      const cs: Record<string, unknown> = {};
      for (const t of tenants) cs[t.id] = await runCsDaily(app.db, app.config, t.id).catch((e) => ({ error: (e as Error).message }));
      const events: Record<string, unknown> = {};
      for (const t of tenants) events[t.id] = await syncBusinessEvents(app.db, t.id).catch((e) => ({ error: (e as Error).message }));
      // Gestão de Resultados: apuração oficial das metas vencidas e metas mensais recorrentes do mês
      const results: Record<string, unknown> = {};
      for (const t of tenants) {
        try {
          const [tz] = await app.db.select({ tz: s.tenants.timezone }).from(s.tenants).where(eq(s.tenants.id, t.id)).limit(1);
          const zone = tz?.tz ?? 'America/Sao_Paulo';
          const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
          const { config } = await performanceConfig(app.db, t.id);
          results[t.id] = { closed: await closeDueGoals(app.db, t.id, zone, today, config.traffic ?? { green: 0.9, yellow: 0.85 }), recurring: await rollRecurringGoals(app.db, t.id, today), interventions: await syncInterventions(app.db, t.id, today), abm: await runAbmDaily(app.db, t.id, today, zone), mail: await syncTenantMail(app.db, app.config.gmail, t.id, 0).catch((e) => ({ error: (e as Error).message })) };
        } catch (e) { results[t.id] = { error: (e as Error).message }; }
      }
      return { ...digests, ...idle, ...contracts, customerSuccess: cs, businessEvents: events, results };
    },
  }),
];
