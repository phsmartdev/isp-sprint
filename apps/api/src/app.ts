import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Config } from './config';
import type { DB } from './db/client';
import { errorHandler, sendProblem } from './http/errors';
import { resolveSession } from './http/context';
import { registerRoutes, routeRegistry } from './http/route';
import { buildOpenApi } from './http/openapi';
import { authRoutes } from './routes/auth';
import { leadRoutes } from './routes/leads';
import { opportunityRoutes } from './routes/opportunities';
import { activityRoutes } from './routes/activities';
import { contactRoutes } from './routes/contacts';
import { homeRoutes } from './routes/home';
import { reportRoutes } from './routes/reports';
import { intelligenceRoutes } from './routes/intelligence';
import { insightsRoutes } from './routes/insights';
import { integrationRoutes } from './routes/integrations';
import { customFieldRoutes } from './routes/customFields';
import { campaignRoutes } from './routes/campaigns';
import { dataAdminRoutes } from './routes/dataAdmin';
import { proposalRoutes } from './routes/proposals';
import { adminRoutes } from './routes/admin';
import { metaRoutes } from './routes/meta';
import { sprintRoutes } from './routes/sprint';
import { settingsRoutes } from './routes/settings';
import { businessRoutes } from './routes/business';

export const API_PREFIX = '/api/v1';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(opts: { config: Config; db: DB; logger?: boolean; rateLimitMax?: number }): Promise<FastifyInstance> {
  const { config, db } = opts;
  const app = Fastify({
    trustProxy: config.trustProxy,
    logger:
      opts.logger === false
        ? false
        : {
            level: config.logLevel,
            // nunca logar cookies, tokens nem senhas
            redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password', '*.passwordHash'], censor: '[redacted]' },
          },
    genReqId: (req) => {
      const h = req.headers['x-request-id'];
      return typeof h === 'string' && /^[\w-]{8,64}$/.test(h) ? h : randomUUID();
    },
    bodyLimit: 256 * 1024,
  });

  app.decorate('db', db);
  app.decorate('config', config);
  app.decorateRequest('auth', null);

  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } });
  // webhooks de integração (formulário do site em outro domínio) aceitam qualquer origem, sem cookies
  await app.register(cors, {
    delegator: (req, cb) => cb(null, req.url?.startsWith('/api/v1/hooks/') ? { origin: true, credentials: false, methods: ['GET', 'POST'] } : { origin: config.webOrigins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] }),
  });
  await app.register(cookie, { secret: config.cookieSecret });
  await app.register(rateLimit, { max: opts.rateLimitMax ?? 600, timeWindow: '1 minute' });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('cache-control', 'no-store');
    if (!req.url.startsWith('/api/')) return;
    // CSRF: navegador sempre envia Origin em requisições que alteram estado; se vier, precisa ser permitido.
    if (MUTATING.has(req.method) && !req.url.startsWith('/api/v1/hooks/')) {
      const origin = req.headers.origin;
      if (origin && !config.webOrigins.includes(origin)) {
        return sendProblem(reply, req, { status: 403, title: 'Origem não permitida', detail: 'Requisição bloqueada (proteção CSRF).' });
      }
      const ct = req.headers['content-type'] ?? '';
      const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || !!req.headers['transfer-encoding'];
      if (hasBody && !ct.startsWith('application/json')) {
        return sendProblem(reply, req, { status: 415, title: 'Tipo de conteúdo não suportado', detail: 'Envie application/json.' });
      }
    }
  });

  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/')) req.auth = await resolveSession(app, req);
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((req, reply) => sendProblem(reply, req, { status: 404, title: 'Não encontrado', detail: 'Rota inexistente.' }));

  // healthchecks fora do prefixo versionado
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ok', db: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'degraded', db: 'unavailable' });
    }
  });

  registerRoutes(app, API_PREFIX, [
    ...authRoutes,
    ...metaRoutes,
    ...sprintRoutes,
    ...settingsRoutes,
    ...businessRoutes,
    ...homeRoutes,
    ...leadRoutes,
    ...opportunityRoutes,
    ...activityRoutes,
    ...contactRoutes,
    ...reportRoutes,
    ...intelligenceRoutes,
    ...insightsRoutes,
    ...integrationRoutes,
    ...customFieldRoutes,
    ...campaignRoutes,
    ...dataAdminRoutes,
    ...proposalRoutes,
    ...adminRoutes,
  ]);
  app.get(`${API_PREFIX}/openapi.json`, async () => buildOpenApi(routeRegistry));

  return app;
}
