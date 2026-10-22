/**
 * Registro declarativo de rotas: cada rota declara o MÓDULO e o nível mínimo exigido.
 * O helper aplica autenticação, a matriz de segurança (negação por padrão), validação 422
 * e alimenta o OpenAPI. O escopo de registros (próprio/equipe/total) é aplicado nas consultas.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodTypeAny } from 'zod';
import { BUSINESS_MODULE_LABELS, MODULE_OWNER, featureDef, featureOn, redactMoney, routeFeature, type AccessLevel, type FeatureKey, type Module } from '@isp/domain';
import { forbidden, unauthorized, unprocessable, zodToProblemErrors } from './errors';
import type { AuthContext } from './context';
import { requireLevel } from '../services/scope';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type RouteDef<B extends ZodTypeAny = ZodTypeAny, Q extends ZodTypeAny = ZodTypeAny, P extends ZodTypeAny = ZodTypeAny> = {
  method: Method;
  url: string;
  summary: string;
  tag: string;
  /** Rota pública (sem sessão). Use com parcimônia. */
  public?: boolean;
  /** Módulo da matriz de segurança e nível mínimo (padrão: Próprio). */
  module?: Module;
  min?: AccessLevel;
  /** Usuário autenticado basta (ex.: /me, logout). Precisa ser declarado explicitamente. */
  anyAuthenticated?: boolean;
  body?: B;
  query?: Q;
  params?: P;
  bodyLimit?: number;
  /** Limite específico da rota, calculado a partir da configuração (ex.: login). */
  rateLimit?: (c: FastifyInstance['config']) => { max: number; timeWindow: string };
  handler: (ctx: {
    req: FastifyRequest;
    reply: FastifyReply;
    auth: AuthContext;
    body: z.infer<B>;
    query: z.infer<Q>;
    params: z.infer<P>;
    app: FastifyInstance;
  }) => Promise<unknown>;
};

export const routeRegistry: (RouteDef & { feature: FeatureKey | null })[] = [];

/** Etapa 1: módulo de negócio desligado ou funcionalidade desligada → 403 com o motivo, antes da matriz de níveis. */
export function assertModuleOpen(auth: AuthContext, module: Module | undefined, feature: FeatureKey | null) {
  const owner = module ? MODULE_OWNER[module] : 'fundacao';
  if (owner !== 'fundacao' && !auth.modules[owner]) throw forbidden(`O módulo ${BUSINESS_MODULE_LABELS[owner]} não está liberado para você.`);
  if (feature && !featureOn(feature, auth.modules, auth.disabledFeatures, auth.access)) {
    const f = featureDef(feature);
    const off = [f.module, ...(f.requires ?? [])].find((m) => !auth.modules[m]);
    if (off) throw forbidden(`O módulo ${BUSINESS_MODULE_LABELS[off]} não está liberado para você.`);
    throw forbidden(auth.disabledFeatures.includes(feature) ? `A funcionalidade "${f.label}" está desligada na empresa.` : `Seu perfil não tem acesso a ${f.label}.`);
  }
}

export function defineRoute<B extends ZodTypeAny = ZodTypeAny, Q extends ZodTypeAny = ZodTypeAny, P extends ZodTypeAny = ZodTypeAny>(
  def: RouteDef<B, Q, P>,
): RouteDef<B, Q, P> {
  return def;
}

function parse<T extends ZodTypeAny>(schema: T | undefined, value: unknown, where: string) {
  if (!schema) return undefined;
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw unprocessable(`Parâmetros inválidos em ${where}.`, zodToProblemErrors(r.error));
  return r.data;
}

export const IdParams = z.object({ id: z.string().uuid('ID inválido') });

export function registerRoutes(app: FastifyInstance, prefix: string, defs: RouteDef<any, any, any>[]) {
  for (const def of defs) {
    if (!def.public && !def.module && !def.anyAuthenticated) {
      throw new Error(`Rota ${def.method} ${def.url} sem política de acesso declarada`);
    }
    const feature = def.public ? null : routeFeature(def.method, def.url);
    routeRegistry.push({ ...def, url: prefix + def.url, feature });
    app.route({
      method: def.method,
      url: prefix + def.url,
      bodyLimit: def.bodyLimit,
      config: def.rateLimit ? { rateLimit: def.rateLimit(app.config) } : undefined,
      handler: async (req, reply) => {
        const auth = req.auth;
        if (!def.public) {
          if (!auth) throw unauthorized();
          assertModuleOpen(auth, def.module, feature);
          if (def.module) requireLevel(auth, def.module, def.min ?? 'proprio');
          if (def.method === 'DELETE' && (/^\/[a-z-]+\/:id$/.test(def.url) || def.url === '/contracts/:id/documents/:docId') && !auth.actions.arquivar) throw forbidden('Seu perfil não pode arquivar nem excluir registros.');
        }
        const params = parse(def.params, req.params, 'URL');
        const query = parse(def.query, req.query, 'consulta');
        const body = parse(def.body, req.body, 'corpo');
        const result = await def.handler({ req, reply, auth: auth as AuthContext, body, query, params, app });
        if (reply.sent) return;
        if (result === undefined || result === null) return reply.code(204).send();
        // sem a ação "ver financeiro", valores em R$ saem como ocultos em qualquer resposta (tela, relatório, indicador)
        if (auth && !def.public && !auth.actions.ver_financeiro && typeof result === 'object' && !Buffer.isBuffer(result)) {
          reply.header('x-isp-financeiro', 'oculto');
          return redactMoney(result);
        }
        return result;
      },
    });
  }
}
