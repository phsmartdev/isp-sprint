// Função serverless da Vercel: encaminha /api/* e /health/* para a API Fastify já compilada no build.
export { default } from '../apps/api/dist/vercel.js';
