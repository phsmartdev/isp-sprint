/**
 * Recuperação de acesso pelo deploy: com ADMIN_RESET_EMAIL e ADMIN_RESET_PASSWORD definidos na Vercel,
 * o build define essa senha para o usuário (desbloqueia e reativa). Se o e-mail não existir e houver
 * uma única empresa, cria o usuário como Gerência. A senha nunca é registrada em log.
 * Depois de entrar, remova as duas variáveis.
 */
import { eq, sql } from 'drizzle-orm';
import { createDb } from './client';
import * as s from './schema';
import { hashPassword } from '../auth/password';
import { ensureRoles } from '../routes/admin';

export type RecoverResult = 'reset' | 'created' | 'no_tenant' | 'many_tenants' | 'weak_password';

export async function recoverAccess(url: string, emailRaw: string, password: string): Promise<RecoverResult> {
  const email = emailRaw.trim().toLowerCase();
  if (password.length < 10) return 'weak_password';
  const { db, pool } = createDb(url, 1);
  try {
    const now = new Date();
    const hash = await hashPassword(password);
    const [user] = await db.select().from(s.users).where(sql`lower(${s.users.email}) = ${email}`).limit(1);
    if (user) {
      await db.update(s.users).set({ passwordHash: hash, failedLogins: 0, lockedUntil: null, active: true, updatedAt: now }).where(eq(s.users.id, user.id));
      await db.update(s.sessions).set({ revokedAt: now }).where(eq(s.sessions.userId, user.id));
      await db.insert(s.auditLogs).values({ tenantId: user.tenantId, actorId: user.id, action: 'auth.recovery_reset', metadata: { via: 'deploy' } });
      return 'reset';
    }
    const tenants = await db.select({ id: s.tenants.id }).from(s.tenants).limit(2);
    if (!tenants.length) return 'no_tenant';
    if (tenants.length > 1) return 'many_tenants';
    const tenantId = tenants[0]!.id;
    return await db.transaction(async (tx) => {
      const roles = await ensureRoles(tx, tenantId);
      const [u] = await tx.insert(s.users).values({ tenantId, name: email.split('@')[0]!, email, passwordHash: hash }).returning();
      await tx.insert(s.userRoles).values({ userId: u!.id, roleId: roles.gerencia! });
      await tx.insert(s.auditLogs).values({ tenantId, actorId: u!.id, action: 'auth.recovery_created', metadata: { via: 'deploy' } });
      return 'created' as const;
    });
  } finally {
    await pool.end();
  }
}

export const RECOVER_MESSAGES: Record<RecoverResult, string> = {
  reset: 'senha redefinida, conta desbloqueada e ativa. Remova ADMIN_RESET_EMAIL e ADMIN_RESET_PASSWORD da Vercel.',
  created: 'usuário criado como Gerência. Remova ADMIN_RESET_EMAIL e ADMIN_RESET_PASSWORD da Vercel.',
  no_tenant: 'nenhuma empresa no banco; nada feito (use SEED_DEMO=true ou cadastre a empresa).',
  many_tenants: 'e-mail não encontrado e há mais de uma empresa; nada feito.',
  weak_password: 'ADMIN_RESET_PASSWORD precisa de ao menos 10 caracteres; nada feito.',
};
