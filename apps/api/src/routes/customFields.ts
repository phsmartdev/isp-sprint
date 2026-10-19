/** Campos personalizados: definição (gerência) e valores na ficha do cliente; cópia de campos entre jornadas. */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { FieldSchema } from '@isp/shared';
import { defineRoute, IdParams } from '../http/route';
import { notFound } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { ownerScope } from '../services/scope';
import { customerFieldList, mergeCustom, normalizeFields, replaceCustomerFields } from '../services/customFields';
import { replaceFields } from '../services/instructions';

const ADMIN = { module: 'configuracoes' as const, min: 'total' as const };
const FieldsBody = z.object({ fields: z.array(FieldSchema.extend({ chave: FieldSchema.shape.chave.optional() })).max(40) });

export const customFieldRoutes = [
  defineRoute({
    method: 'GET',
    url: '/customer-fields',
    summary: 'Campos personalizados da ficha do cliente',
    tag: 'Clientes',
    module: 'clientes',
    handler: async ({ app, auth }) => ({ items: await customerFieldList(app.db, auth.tenantId) }),
  }),
  defineRoute({
    method: 'PUT',
    url: '/admin/customer-fields',
    summary: 'Define os campos personalizados de cliente (o que sai fica inativo; valores guardados continuam)',
    tag: 'Clientes',
    ...ADMIN,
    body: FieldsBody,
    handler: async ({ app, auth, body, req }) => {
      const fields = normalizeFields(body.fields);
      await app.db.transaction((tx) => replaceCustomerFields(tx, auth.tenantId, fields));
      await audit(app.db, req, { action: 'customer.fields', entityType: 'tenant', entityId: auth.tenantId, metadata: { fields: fields.length } });
      return { ok: true, items: await customerFieldList(app.db, auth.tenantId) };
    },
  }),
  defineRoute({
    method: 'PATCH',
    url: '/contacts/:id/custom',
    summary: 'Grava os campos personalizados na ficha do cliente',
    tag: 'Clientes',
    module: 'clientes',
    params: IdParams,
    body: z.object({ custom: z.record(z.string(), z.union([z.string().max(5000), z.number(), z.boolean(), z.null()])) }),
    handler: async ({ app, auth, params, body, req }) => {
      const [c] = await app.db.select({ id: s.contacts.id, custom: s.contacts.custom }).from(s.contacts)
        .where(and(eq(s.contacts.id, params.id), ownerScope(auth, 'clientes', { tenantId: s.contacts.tenantId, ownerId: s.contacts.ownerId, deletedAt: s.contacts.deletedAt }))).limit(1);
      if (!c) throw notFound('Cliente não encontrado.');
      const fields = await customerFieldList(app.db, auth.tenantId);
      const custom = mergeCustom(fields, c.custom ?? {}, body.custom, 'no cadastro de clientes');
      await app.db.update(s.contacts).set({ custom, updatedAt: new Date(), rowVersion: sql`${s.contacts.rowVersion} + 1` }).where(eq(s.contacts.id, c.id));
      await audit(app.db, req, { action: 'customer.custom', entityType: 'contact', entityId: c.id, metadata: { changed: Object.keys(body.custom) } });
      return { custom };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/admin/journeys/:id/fields/copy',
    summary: 'Copia os campos desta jornada para outras (ou todas). Campos que só existem no destino continuam.',
    tag: 'Jornadas',
    ...ADMIN,
    params: IdParams,
    body: z.object({ to: z.array(z.string().uuid()).max(50).optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const [src] = await app.db.select({ id: s.pipelines.id, name: s.pipelines.name }).from(s.pipelines).where(and(eq(s.pipelines.id, params.id), eq(s.pipelines.tenantId, auth.tenantId))).limit(1);
      if (!src) throw notFound('Jornada não encontrada.');
      const fields = await app.db.select().from(s.pipelineFields).where(and(eq(s.pipelineFields.pipelineId, src.id), eq(s.pipelineFields.active, true))).orderBy(s.pipelineFields.position);
      const targets = await app.db.select({ id: s.pipelines.id }).from(s.pipelines)
        .where(and(eq(s.pipelines.tenantId, auth.tenantId), ne(s.pipelines.id, src.id), eq(s.pipelines.active, true), body.to?.length ? inArray(s.pipelines.id, body.to) : undefined));
      await app.db.transaction(async (tx) => {
        for (const t of targets) {
          const existing = await tx.select().from(s.pipelineFields).where(and(eq(s.pipelineFields.pipelineId, t.id), eq(s.pipelineFields.active, true))).orderBy(s.pipelineFields.position);
          const keys = new Set(fields.map((f) => f.key));
          const list = [...fields, ...existing.filter((e) => !keys.has(e.key))].map((f) => ({ chave: f.key, rotulo: f.label, tipo: f.type, opcoes: f.options, obrigatorio: f.required }));
          await replaceFields(tx, auth.tenantId, t.id, list);
        }
      });
      await audit(app.db, req, { action: 'journey.fields.copy', entityType: 'pipeline', entityId: src.id, metadata: { name: src.name, journeys: targets.length, fields: fields.length } });
      return { ok: true, journeys: targets.length };
    },
  }),
];
