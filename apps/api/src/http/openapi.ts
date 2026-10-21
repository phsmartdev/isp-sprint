import { zodToJsonSchema } from 'zod-to-json-schema';
import type { RouteDef } from './route';

/** Gera OpenAPI 3.1 a partir das rotas registradas (schemas Zod são a fonte única). */
export function buildOpenApi(routes: RouteDef[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  const seen = new Set<string>();
  for (const r of routes) {
    const key = `${r.method} ${r.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const path = r.url.replace(/:([a-zA-Z]+)/g, '{$1}');
    const parameters: unknown[] = [];
    const pathParams = [...r.url.matchAll(/:([a-zA-Z]+)/g)].map((m) => m[1]);
    for (const p of pathParams) parameters.push({ name: p, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } });
    if (r.query) {
      const js = zodToJsonSchema(r.query, { target: 'openApi3', $refStrategy: 'none' }) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(js.properties ?? {})) {
        parameters.push({ name, in: 'query', required: js.required?.includes(name) ?? false, schema });
      }
    }
    const op: Record<string, unknown> = {
      summary: r.summary,
      tags: [r.tag],
      parameters,
      security: r.public ? [] : [{ session: [] }],
      'x-access': r.module ? `${r.module}:${r.min ?? 'proprio'}` : r.anyAuthenticated ? '(autenticado)' : 'público',
      responses: {
        '200': { description: 'OK' },
        '401': { description: 'Não autenticado', content: { 'application/problem+json': {} } },
        '403': { description: 'Nível de acesso insuficiente no módulo' },
        '404': { description: 'Não encontrado (inclui registros de outra empresa)' },
        '409': { description: 'Conflito de versão (rowVersion)' },
        '422': { description: 'Validação ou regra de negócio' },
      },
    };
    if (r.body) {
      op.requestBody = { required: true, content: { 'application/json': { schema: zodToJsonSchema(r.body, { target: 'openApi3', $refStrategy: 'none' }) } } };
    }
    (paths[path] ??= {})[r.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: { title: 'RevOps API', version: '1.0.0-fase1', description: 'API interna do CRM RevOps. Erros em application/problem+json com requestId.' },
    servers: [{ url: '/' }],
    components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'isp_session' } } },
    paths,
  };
}
