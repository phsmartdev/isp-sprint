/**
 * Integração Zenith — preparação dos campos. Monta, a partir do CRM e do cadastro Zenith do contrato, exatamente o que
 * as telas do Zenith pedem (Novo Cliente e Modelagem de Contrato) e aponta o que falta. Ainda não envia: o envio
 * depende da API do Zenith (endpoints e autenticação a receber).
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { needsZenith, SLA_DEFAULTS, SLA_METRIC_LABELS, DEFAULT_ZENITH_LISTS, ZENITH_MODALITIES, normalizeZenith, zenithErrors, zenithFields, type ZenithContract, type ZenithLists } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { audit } from '../services/audit';
import { currentVersion, loadContract } from '../services/contracts';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

const Contact = z.object({ name: z.string().trim().max(200), email: z.string().trim().max(200).nullable().default(null), phone: z.string().trim().max(40).nullable().default(null) });
export const ZenithBody = z.object({
  modality: z.enum(ZENITH_MODALITIES), holderCompany: z.string().trim().max(200), alias: z.string().trim().max(200),
  managedNetwork: z.boolean().nullable(), publicIp: z.boolean().nullable(), unlimitedBalance: z.boolean().default(false),
  cdiUnits: z.number().int().min(0).max(1_000_000).nullable(), cdmUnits: z.number().int().min(0).max(1_000_000).nullable(),
  slaType: z.string().trim().max(120), availabilityPct: z.number().min(0).max(100).nullable().default(null), packetLossPct: z.number().min(0).max(100).nullable().default(null), techContact: Contact, adminContact: Contact,
}).superRefine((v, ctx) => { for (const e of zenithErrors(v as ZenithContract)) ctx.addIssue({ code: 'custom', path: e.path.split('.'), message: `Cadastro Zenith: ${e.message}` }); })
  .transform((v) => normalizeZenith(v as ZenithContract));

export async function zenithListsOf(db: DbOrTx, tenantId: string): Promise<ZenithLists> {
  const [r] = await db.select({ v: sql<ZenithLists | null>`${s.contractSettings.settings} -> 'zenith'` }).from(s.contractSettings).where(eq(s.contractSettings.tenantId, tenantId)).limit(1);
  return { ...DEFAULT_ZENITH_LISTS, ...(r?.v ?? {}) };
}

/** As metas do cadastro Zenith viram as metas de SLA do contrato (a mesma tabela da aba Execução); mudar substitui a anterior. */
export async function syncZenithSlas(db: DbOrTx, tenantId: string, contractId: string, z: ZenithContract | null | undefined, actorId: string) {
  if (!z) return;
  for (const [metric, value] of [['disponibilidade', z.availabilityPct], ['perda_pacotes', z.packetLossPct]] as const) {
    if (value == null) continue;
    const [cur] = await db.select({ id: s.contractSlas.id, target: s.contractSlas.target }).from(s.contractSlas).where(and(eq(s.contractSlas.contractId, contractId), eq(s.contractSlas.metric, metric), isNull(s.contractSlas.supersededAt))).orderBy(desc(s.contractSlas.createdAt)).limit(1);
    if (cur && cur.target === value) continue;
    if (cur) await db.update(s.contractSlas).set({ supersededAt: new Date() }).where(eq(s.contractSlas.id, cur.id));
    await db.insert(s.contractSlas).values({ tenantId, contractId, metric, label: SLA_METRIC_LABELS[metric], target: value, unit: SLA_DEFAULTS[metric].unit, direction: SLA_DEFAULTS[metric].direction, createdBy: actorId });
  }
}

const SLA_FIELD = { disponibilidade: 'availabilityPct', perda_pacotes: 'packetLossPct' } as const;

export const zenithRoutes = [
  defineRoute({
    method: 'GET', url: '/contracts/zenith-lists', summary: 'Listas do cadastro Zenith (empresas detentoras e tipos de SLA)', tag: 'Contratos', module: 'contratos',
    handler: async ({ app, auth }) => zenithListsOf(app.db, auth.tenantId),
  }),
  defineRoute({
    method: 'PUT', url: '/admin/contract-settings/zenith', summary: 'Salva as listas do cadastro Zenith', tag: 'Contratos', module: 'configuracoes', min: 'total',
    body: z.object({ holders: z.array(z.string().trim().min(2).max(200)).max(50), slaTypes: z.array(z.string().trim().min(2).max(120)).min(1, 'Deixe ao menos um tipo de SLA').max(50) }),
    handler: async ({ app, auth, body, req }) => {
      const v = { holders: [...new Set(body.holders)], slaTypes: [...new Set(body.slaTypes)] };
      await app.db.insert(s.contractSettings).values({ tenantId: auth.tenantId, settings: { zenith: v }, updatedBy: auth.userId })
        .onConflictDoUpdate({ target: s.contractSettings.tenantId, set: { settings: sql`${s.contractSettings.settings} || ${JSON.stringify({ zenith: v })}::jsonb`, updatedBy: auth.userId, updatedAt: new Date() } });
      await audit(app.db, req, { action: 'contract.settings.zenith', entityType: 'tenant', entityId: auth.tenantId, metadata: v });
      return v;
    },
  }),
  defineRoute({
    method: 'GET', url: '/contracts/:id/zenith', summary: 'Espelho do Zenith: cada campo com valor, origem (CRM ou cadastro Zenith) e pendências', tag: 'Contratos', module: 'contratos', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const v = await currentVersion(app.db, c);
      if (!needsZenith(v.serviceType)) return { applicable: false as const, serviceType: v.serviceType, fields: [], missing: [], ready: false, zenith: null, sending: 'aguardando_api' as const };
      const [contact] = await app.db.select({ name: s.contacts.name, document: s.contacts.document }).from(s.contacts).where(eq(s.contacts.id, c.contactId)).limit(1);
      const [csa] = await app.db.select({ snap: s.csAccounts.snapshot }).from(s.csAccounts).where(and(eq(s.csAccounts.tenantId, auth.tenantId), eq(s.csAccounts.contactId, c.contactId))).limit(1);
      let ipc = ((csa?.snap as { ipc?: { total?: number | null } } | null)?.ipc?.total) ?? null;
      if (ipc == null) {
        const [a] = await app.db.select({ score: s.csAssessments.score }).from(s.csAssessments).where(and(eq(s.csAssessments.tenantId, auth.tenantId), eq(s.csAssessments.contactId, c.contactId), eq(s.csAssessments.kind, 'ipc'), eq(s.csAssessments.level, 'completa'))).orderBy(desc(s.csAssessments.createdAt)).limit(1);
        ipc = a?.score ?? null;
      }
      // subclientes: contas das quais este cliente é matriz/controladora
      const subs = await app.db.select({ name: s.contacts.name, document: s.contacts.document }).from(s.accountRelations).innerJoin(s.contacts, eq(s.contacts.id, s.accountRelations.toContactId))
        .where(and(eq(s.accountRelations.tenantId, auth.tenantId), eq(s.accountRelations.fromContactId, c.contactId), eq(s.accountRelations.kind, 'matriz'), eq(s.accountRelations.active, true)));
      const slaRows = await app.db.select({ metric: s.contractSlas.metric, target: s.contractSlas.target }).from(s.contractSlas)
        .where(and(eq(s.contractSlas.contractId, c.id), isNull(s.contractSlas.supersededAt), inArray(s.contractSlas.metric, Object.keys(SLA_FIELD)))).orderBy(desc(s.contractSlas.createdAt));
      const slas = { availabilityPct: null as number | null, packetLossPct: null as number | null };
      for (const r of slaRows) { const k = SLA_FIELD[r.metric as keyof typeof SLA_FIELD]; if (slas[k] == null) slas[k] = r.target; }
      const out = zenithFields({ client: { name: contact?.name ?? '', document: contact?.document ?? null, ipc, subclients: subs }, contract: { number: v.number, zenith: (v.zenith as ZenithContract | null) ?? null }, slas });
      return { applicable: true as const, serviceType: v.serviceType, ...out, ready: !out.missing.length, zenith: v.zenith ?? null, sending: 'aguardando_api' as const };
    },
  }),
];
