/** Etapa 1 — consultas de módulo por empresa e checagem de ações sensíveis. */
import { and, eq } from 'drizzle-orm';
import { SENSITIVE_ACTION_LABELS, type BusinessModule, type SensitiveAction } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import { forbidden } from '../http/errors';

/** Módulo ligado para a EMPRESA (teto), independentemente da pessoa. Sem linha = ligado. */
export async function tenantModuleOn(db: DbOrTx, tenantId: string, module: BusinessModule) {
  const [r] = await db.select({ enabled: s.tenantModules.enabled }).from(s.tenantModules).where(and(eq(s.tenantModules.tenantId, tenantId), eq(s.tenantModules.module, module))).limit(1);
  return r ? r.enabled : true;
}

export function requireAction(auth: AuthContext, action: SensitiveAction, detail?: string) {
  if (!auth.actions[action]) throw forbidden(detail ?? `Seu perfil não tem a permissão "${SENSITIVE_ACTION_LABELS[action]}".`);
}
