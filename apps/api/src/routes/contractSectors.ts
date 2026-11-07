/**
 * Setores da Gestão de Contratos: os do sistema (renomeáveis; os que têm etapas dos processos não podem ser excluídos)
 * e os criados pela empresa. Excluir tira o setor das pessoas; o histórico continua.
 */
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PROCESS_SECTORS, SECTORS, SECTOR_KEY, SECTOR_LABELS, type SectorInfo } from '@isp/domain';
import { defineRoute } from '../http/route';
import { notFound, unprocessable } from '../http/errors';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

const ADMIN = { module: 'configuracoes' as const, min: 'total' as const };

export async function contractSectorsOf(db: DbOrTx, tenantId: string): Promise<SectorInfo[]> {
  const rows = await db.select().from(s.contractSectors).where(eq(s.contractSectors.tenantId, tenantId));
  const out: SectorInfo[] = [];
  for (const k of SECTORS) {
    const r = rows.find((x) => x.key === k);
    if (r?.deletedAt) continue;
    out.push({ key: k, label: r?.label ?? SECTOR_LABELS[k], system: true, processSteps: PROCESS_SECTORS.includes(k) });
  }
  for (const r of rows) if (!r.system && !r.deletedAt) out.push({ key: r.key, label: r.label, system: false, processSteps: false });
  return out;
}
/** Confere que os setores escolhidos existem na empresa. */
export async function assertSectors(db: DbOrTx, tenantId: string, keys: string[] | undefined) {
  if (!keys?.length) return;
  const ok = new Set((await contractSectorsOf(db, tenantId)).map((x) => x.key));
  const bad = keys.filter((k) => !ok.has(k));
  if (bad.length) throw unprocessable(`Setor não encontrado: ${bad.join(', ')}.`);
}
const slug = (label: string) => label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36) || 'setor';

export const contractSectorRoutes = [
  defineRoute({
    method: 'GET', url: '/contract-sectors', summary: 'Setores da Gestão de Contratos (do sistema e criados pela empresa)', tag: 'Contratos', anyAuthenticated: true,
    handler: async ({ app, auth }) => ({ items: await contractSectorsOf(app.db, auth.tenantId) }),
  }),
  defineRoute({
    method: 'POST', url: '/contract-sectors', summary: 'Cria setor', tag: 'Contratos', ...ADMIN,
    body: z.object({ label: z.string().trim().min(2).max(60) }),
    handler: async ({ app, auth, body, reply }) => {
      const cur = await contractSectorsOf(app.db, auth.tenantId);
      if (cur.some((x) => x.label.toLowerCase() === body.label.toLowerCase())) throw unprocessable('Já existe um setor com esse nome.');
      const taken = new Set((await app.db.select({ key: s.contractSectors.key }).from(s.contractSectors).where(eq(s.contractSectors.tenantId, auth.tenantId))).map((r) => r.key).concat(SECTORS));
      let key = slug(body.label), n = 2;
      while (taken.has(key)) key = `${slug(body.label).slice(0, 33)}_${n++}`;
      await app.db.insert(s.contractSectors).values({ tenantId: auth.tenantId, key, label: body.label, system: false });
      reply.code(201);
      return { key, label: body.label };
    },
  }),
  defineRoute({
    method: 'PATCH', url: '/contract-sectors/:key', summary: 'Renomeia setor', tag: 'Contratos', ...ADMIN,
    params: z.object({ key: z.string().regex(SECTOR_KEY) }), body: z.object({ label: z.string().trim().min(2).max(60) }),
    handler: async ({ app, auth, params, body }) => {
      const cur = await contractSectorsOf(app.db, auth.tenantId);
      const x = cur.find((c) => c.key === params.key);
      if (!x) throw notFound('Setor não encontrado.');
      if (cur.some((c) => c.key !== x.key && c.label.toLowerCase() === body.label.toLowerCase())) throw unprocessable('Já existe um setor com esse nome.');
      await app.db.insert(s.contractSectors).values({ tenantId: auth.tenantId, key: x.key, label: body.label, system: x.system })
        .onConflictDoUpdate({ target: [s.contractSectors.tenantId, s.contractSectors.key], set: { label: body.label } });
      return { key: x.key, label: body.label };
    },
  }),
  defineRoute({
    method: 'DELETE', url: '/contract-sectors/:key', summary: 'Exclui setor (sai das pessoas; setores com etapas dos processos de contrato não podem ser excluídos)', tag: 'Contratos', ...ADMIN,
    params: z.object({ key: z.string().regex(SECTOR_KEY) }),
    handler: async ({ app, auth, params }) => {
      const x = (await contractSectorsOf(app.db, auth.tenantId)).find((c) => c.key === params.key);
      if (!x) throw notFound('Setor não encontrado.');
      if (x.processSteps) throw unprocessable(`${x.label} tem etapas nos processos de contrato (implantação, renovação, reajuste ou encerramento) e não pode ser excluído. Dá para renomear.`);
      await app.db.transaction(async (tx) => {
        await tx.insert(s.contractSectors).values({ tenantId: auth.tenantId, key: x.key, label: x.label, system: x.system, deletedAt: new Date() })
          .onConflictDoUpdate({ target: [s.contractSectors.tenantId, s.contractSectors.key], set: { deletedAt: new Date() } });
        await tx.update(s.users).set({ sectors: sql`array_remove(${s.users.sectors}, ${x.key})` }).where(and(eq(s.users.tenantId, auth.tenantId), sql`${x.key} = any(${s.users.sectors})`));
      });
      return { ok: true };
    },
  }),
];
