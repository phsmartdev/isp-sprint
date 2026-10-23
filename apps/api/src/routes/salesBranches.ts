/** Filiais da venda (ex.: BKT Soluções, UPNET): lista da empresa, mantida pela gerência. Desativar não apaga histórico. */
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineRoute } from '../http/route';
import { unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { ensureSalesBranches } from '../services/opportunities';

export const salesBranchRoutes = [
  defineRoute({
    method: 'GET', url: '/admin/sales-branches', summary: 'Filiais da venda (ativas e desativadas)', tag: 'Configurações', module: 'configuracoes', min: 'total',
    handler: async ({ app, auth }) => {
      await ensureSalesBranches(app.db, auth.tenantId);
      return { items: await app.db.select().from(s.salesBranches).where(eq(s.salesBranches.tenantId, auth.tenantId)).orderBy(asc(s.salesBranches.position), asc(s.salesBranches.name)) };
    },
  }),
  defineRoute({
    method: 'PUT', url: '/admin/sales-branches', summary: 'Salva a lista de filiais (incluir, renomear, ordenar, desativar)', tag: 'Configurações', module: 'configuracoes', min: 'total',
    body: z.object({ items: z.array(z.object({ id: z.string().uuid().nullable(), name: z.string().trim().min(2).max(80), active: z.boolean() })).max(30) }),
    handler: async ({ app, auth, body, req }) => app.db.transaction(async (tx) => {
      const names = body.items.map((i) => i.name.toLowerCase());
      if (new Set(names).size !== names.length) throw unprocessable('Há filiais com o mesmo nome.');
      if (!body.items.some((i) => i.active)) throw unprocessable('Deixe pelo menos uma filial ativa.');
      for (const [position, it] of body.items.entries()) {
        if (it.id) await tx.update(s.salesBranches).set({ name: it.name, active: it.active, position }).where(and(eq(s.salesBranches.id, it.id), eq(s.salesBranches.tenantId, auth.tenantId)));
        else await tx.insert(s.salesBranches).values({ tenantId: auth.tenantId, name: it.name, active: it.active, position });
      }
      await audit(tx, req, { action: 'sales_branches.update', entityType: 'tenant', entityId: auth.tenantId, metadata: { items: body.items.map((i) => `${i.name}${i.active ? '' : ' (desativada)'}`) } });
      return { ok: true };
    }),
  }),
];
