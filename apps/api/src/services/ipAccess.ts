/** Acesso por IP liberado (por empresa), com cache curto para não consultar o banco a cada requisição. */
import { eq } from 'drizzle-orm';
import { ipAllowed, type IpPolicy } from '@isp/domain';
import type { FastifyRequest } from 'fastify';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

const cache = new Map<string, { at: number; p: IpPolicy | null }>();
const TTL = 30_000;

export async function ipPolicyOf(db: DbOrTx, tenantId: string, fresh = false): Promise<IpPolicy | null> {
  const c = cache.get(tenantId);
  if (!fresh && c && Date.now() - c.at < TTL) return c.p;
  const [r] = await db.select().from(s.tenantIpPolicies).where(eq(s.tenantIpPolicies.tenantId, tenantId)).limit(1);
  const p = r ? { enabled: r.enabled, rules: r.rules } : null;
  cache.set(tenantId, { at: Date.now(), p });
  return p;
}
export const forgetIpPolicy = (tenantId: string) => cache.delete(tenantId);

/**
 * IP de quem chama. Na Vercel vale o x-real-ip que a própria Vercel preenche (o cliente não consegue forjar);
 * fora dela, o req.ip (com trustProxy só quando há proxy confiável na frente).
 */
export const clientIp = (req: FastifyRequest) => {
  const real = process.env.VERCEL ? req.headers['x-real-ip'] : undefined;
  return (typeof real === 'string' && real.trim() ? real.trim() : req.ip) ?? null;
};

export async function ipCheck(db: DbOrTx, req: FastifyRequest, user: { tenantId: string; ipBypass: boolean }) {
  const p = await ipPolicyOf(db, user.tenantId);
  const ip = clientIp(req);
  return { ok: ipAllowed(ip, p, user.ipBypass), ip };
}
