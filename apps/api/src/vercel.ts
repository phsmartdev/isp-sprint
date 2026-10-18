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

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await getApp();
    app.server.emit('request', req, res);
  } catch (e) {
    console.error('Falha ao iniciar a API', e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/problem+json');
    res.end(JSON.stringify({ type: 'about:blank', title: 'API indisponível', status: 500, detail: 'A API não conseguiu iniciar. Confira DATABASE_URL e COOKIE_SECRET nas variáveis do projeto na Vercel.' }));
  }
}
