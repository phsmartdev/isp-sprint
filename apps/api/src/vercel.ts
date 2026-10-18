/**
 * Entrada da API na Vercel (função serverless). O app Fastify é criado uma vez por instância
 * e reaproveitado entre requisições; o pool de conexões é pequeno porque cada instância
 * é um processo separado e o banco gerenciado limita conexões.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { buildApp } from './app';

let ready: Promise<FastifyInstance> | null = null;

function getApp() {
  if (!ready) {
    ready = (async () => {
      const config = loadConfig();
      const { db } = createDb(config.databaseUrl, 3);
      const app = await buildApp({ config, db });
      await app.ready();
      return app;
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

/** Diagnóstico sem expor segredos: diz qual variável falta ou está inválida. */
function explain(e: unknown) {
  const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
  if (issues?.length) {
    return issues
      .map((i) => {
        const v = String(i.path[0]);
        if (!process.env[v]) return `a variável ${v} não está cadastrada na Vercel`;
        if (v === 'DATABASE_URL') return 'DATABASE_URL não é uma URL válida (ela começa com postgresql:// e, se a senha tiver caracteres como @ # / ?, troque a senha do banco por uma só com letras e números)';
        return `a variável ${v} está inválida (${i.message})`;
      })
      .join('; ') + '. Depois de corrigir, faça Redeploy.';
  }
  const msg = (e as Error)?.message ?? String(e);
  return msg.replace(/postgres(ql)?:\/\/[^\s]+/gi, '[url do banco]') + ' (depois de corrigir a variável na Vercel, faça Redeploy).';
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await getApp();
    app.server.emit('request', req, res);
  } catch (e) {
    console.error('Falha ao iniciar a API', e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/problem+json');
    res.end(JSON.stringify({ type: 'about:blank', title: 'API indisponível', status: 500, detail: `A API não conseguiu iniciar: ${explain(e)}` }));
  }
}
