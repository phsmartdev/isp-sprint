/**
 * Relatório de Medição: monta, a partir do CRM, as propostas enviadas no mês pelas oportunidades de consumo
 * (vinculadas a contrato por medição) da conta e o consolidado dos itens. A prévia e o e-mail usam o mesmo HTML.
 * Oportunidades perdidas ficam de fora. Data de envio da proposta: primeiro envio registrado (e-mail ou WhatsApp);
 * sem registro, a data da proposta anexada quando a situação já é enviada/aceita.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  consolidateItems, DEFAULT_MEASUREMENT_TEXTS, measurementEmailHtml, measurementEmailText, monthLabel, monthRange, officialPeriod,
  type ConsolidatedItem, type MeasurementProposal, type MeasurementTables, type MeasurementTexts,
} from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { sendEmail } from './email';

export type ReportData = { referenceMonth: string; texts: MeasurementTexts; proposals: MeasurementProposal[]; items: ConsolidatedItem[]; partial: boolean; tables?: MeasurementTables | null };

export async function settingsOf(db: DbOrTx, tenantId: string, contactId: string) {
  const [r] = await db.select().from(s.measurementReportSettings).where(and(eq(s.measurementReportSettings.tenantId, tenantId), eq(s.measurementReportSettings.contactId, contactId)));
  return { enabled: r?.enabled ?? false, dueDay: r?.dueDay ?? 5, toAddress: r?.toAddress ?? '', ccAddress: r?.ccAddress ?? '', texts: { ...DEFAULT_MEASUREMENT_TEXTS, ...(r?.texts ?? {}) } };
}

/** Propostas e itens do mês (ao vivo). `excluded` = oportunidades desmarcadas no rascunho. */
export async function buildReport(db: DbOrTx, tenantId: string, contactId: string, referenceMonth: string, texts: MeasurementTexts, today: string, excluded: string[] = []): Promise<ReportData> {
  const { from, to } = monthRange(referenceMonth);
  const rows = (await db.execute<{ id: string; code: number; proposal_number: string | null; title: string; value_cents: string | null; contract_id: string; contract_code: number; sent_on: string | null }>(sql`
    select o.id, o.code, o.proposal_number, o.title, coalesce(o.measurement_cents, o.value_cents) value_cents, o.measurement_contract_id contract_id, c.code contract_code,
      coalesce(
        (select min((e.occurred_at at time zone t.timezone)::date) from opportunity_events e where e.opportunity_id = o.id and ((e.type = 'email_sent' and e.payload->>'kind' = 'proposta') or e.type = 'whatsapp_sent')),
        case when o.proposal_status in ('enviada', 'aceita') then (select max((a.created_at at time zone t.timezone)::date) from opportunity_attachments a where a.opportunity_id = o.id and a.kind = 'proposta' and a.deleted_at is null) end
      )::text sent_on
    from opportunities o
    join contracts c on c.id = o.measurement_contract_id
    join tenants t on t.id = o.tenant_id
    where o.tenant_id = ${tenantId} and c.contact_id = ${contactId} and o.deleted_at is null and o.stage <> 'perdida'`)).rows
    .filter((r) => r.sent_on && r.sent_on >= from && r.sent_on <= to);
  const ids = rows.map((r) => r.id);
  const atts = ids.length ? await db.select({ id: s.opportunityAttachments.id, opportunityId: s.opportunityAttachments.opportunityId, filename: s.opportunityAttachments.filename, sizeBytes: s.opportunityAttachments.sizeBytes, createdAt: s.opportunityAttachments.createdAt })
    .from(s.opportunityAttachments).where(and(inArray(s.opportunityAttachments.opportunityId, ids), eq(s.opportunityAttachments.kind, 'proposta'), isNull(s.opportunityAttachments.deletedAt))) : [];
  const lastAtt = new Map<string, (typeof atts)[number]>();
  for (const a of atts) { const cur = lastAtt.get(a.opportunityId); if (!cur || a.createdAt > cur.createdAt) lastAtt.set(a.opportunityId, a); }
  const proposals: MeasurementProposal[] = rows.map((r) => {
    const a = lastAtt.get(r.id);
    return { opportunityId: r.id, code: Number(r.code), number: r.proposal_number, title: r.title, sentOn: r.sent_on!, valueCents: Number(r.value_cents ?? 0), attachment: a ? { id: a.id, filename: a.filename, sizeBytes: a.sizeBytes } : null, contractNumber: `CT-${r.contract_code}`, included: !excluded.includes(r.id) };
  }).sort((x, y) => x.sentOn.localeCompare(y.sentOn) || x.code - y.code);
  const inc = proposals.filter((p) => p.included).map((p) => p.opportunityId);
  const lines = inc.length ? await db.select().from(s.opportunityItems).where(inArray(s.opportunityItems.opportunityId, inc)) : [];
  // itens do(s) contrato(s) para numerar (ITEM) pela posição no contrato
  const contractIds = [...new Set(rows.filter((r) => inc.includes(r.id)).map((r) => r.contract_id))];
  const cItems: { description: string; number?: string | null; unit?: string | null }[] = contractIds.length
    ? (await db.select({ description: s.contractLines.description, number: s.contractLines.itemNumber, unit: s.contractLines.unit }).from(s.contractLines).where(inArray(s.contractLines.contractId, contractIds)).orderBy(s.contractLines.position)) : [];
  for (const cid of contractIds) {
    const [v] = (await db.execute<{ items: { description: string }[] }>(sql`select v.items from contract_versions v join contracts c on c.id = v.contract_id and c.current_version = v.version where c.id = ${cid}`)).rows;
    cItems.push(...(v?.items ?? []));
  }
  const items = consolidateItems(lines.map((l) => ({ description: l.description, unit: l.unit, qtyMilli: Number(l.qtyMilli), unitCents: Number(l.unitCents), totalCents: Math.round((Number(l.qtyMilli) * Number(l.unitCents)) / 1000) - Number(l.discountCents) + Number(l.surchargeCents) })), cItems);
  return { referenceMonth, texts, proposals, items, partial: today <= to };
}

export const subjectOf = (contactName: string, referenceMonth: string) => `Relatório de Medição · ${contactName} · ${monthLabel(referenceMonth)}`;
export const renderReport = (d: ReportData) => ({ html: measurementEmailHtml(d), text: measurementEmailText(d) });

/** Cria (ou atualiza, se ainda rascunho) o relatório oficial do mês fechado. */
export async function upsertDraft(db: DbOrTx, tenantId: string, contactId: string, referenceMonth: string, dueOn: string, today: string, actorId: string | null) {
  const cfg = await settingsOf(db, tenantId, contactId);
  const [cur] = await db.select().from(s.measurementReports).where(and(eq(s.measurementReports.tenantId, tenantId), eq(s.measurementReports.contactId, contactId), eq(s.measurementReports.referenceMonth, referenceMonth)));
  if (cur?.status === 'enviado') return cur;
  const prev = (cur?.data ?? {}) as Partial<ReportData>;
  const excluded = (prev.proposals ?? []).filter((p) => !p.included).map((p) => p.opportunityId);
  const data: ReportData = { ...(await buildReport(db, tenantId, contactId, referenceMonth, (prev.texts as MeasurementTexts) ?? cfg.texts, today, excluded)), tables: prev.tables ?? null };
  const [c] = await db.select({ name: s.contacts.name }).from(s.contacts).where(eq(s.contacts.id, contactId));
  const values = { data: data as unknown as Record<string, unknown>, subject: cur?.subject ?? subjectOf(c?.name ?? '', referenceMonth), generatedAt: new Date(), generatedBy: actorId, dueOn };
  if (cur) { const [r] = await db.update(s.measurementReports).set(values).where(eq(s.measurementReports.id, cur.id)).returning(); return r!; }
  const [r] = await db.insert(s.measurementReports).values({ tenantId, contactId, referenceMonth, ...values }).onConflictDoNothing().returning();
  return r ?? (await db.select().from(s.measurementReports).where(and(eq(s.measurementReports.tenantId, tenantId), eq(s.measurementReports.contactId, contactId), eq(s.measurementReports.referenceMonth, referenceMonth))))[0]!;
}

/** Rotina diária: em cada conta com envio obrigatório, o rascunho do mês fechado existe a partir do dia 1. */
export async function runMeasurementDrafts(db: DbOrTx, tenantId: string, today: string) {
  const list = await db.select().from(s.measurementReportSettings).where(and(eq(s.measurementReportSettings.tenantId, tenantId), eq(s.measurementReportSettings.enabled, true)));
  let n = 0;
  for (const st of list) {
    const p = officialPeriod(today, st.dueDay);
    const r = await upsertDraft(db, tenantId, st.contactId, p.referenceMonth, p.dueOn, today, null);
    if (r.status === 'rascunho') n++;
  }
  return { rascunhos: n };
}

/** Envia o relatório (e-mail com o HTML + PDFs das propostas incluídas) e congela o conteúdo. */
export async function sendReport(db: DbOrTx, tenantId: string, reportId: string, actorId: string, replyTo: string | null, to: string, cc: string | null) {
  const [r] = await db.select().from(s.measurementReports).where(and(eq(s.measurementReports.id, reportId), eq(s.measurementReports.tenantId, tenantId)));
  if (!r) return { ok: false as const, error: 'Relatório não encontrado.' };
  if (r.status === 'enviado') return { ok: false as const, error: 'Este relatório já foi enviado.' };
  const d = r.data as unknown as ReportData;
  const attIds = d.proposals.filter((p) => p.included && p.attachment).map((p) => p.attachment!.id);
  const files = attIds.length ? await db.select({ filename: s.opportunityAttachments.filename, data: s.opportunityAttachments.data, mime: s.opportunityAttachments.mime }).from(s.opportunityAttachments).where(inArray(s.opportunityAttachments.id, attIds)) : [];
  const { html, text } = renderReport(d);
  const res = await sendEmail(db, { tenantId, kind: 'relatorio_medicao', to, cc, subject: r.subject, text, html, attachments: files.map((f) => ({ filename: f.filename, content: f.data, contentType: f.mime })), createdBy: actorId, replyTo });
  if (!res.ok) { await db.update(s.measurementReports).set({ error: res.error }).where(eq(s.measurementReports.id, r.id)); return { ok: false as const, error: res.error }; }
  await db.update(s.measurementReports).set({ status: 'enviado', sentAt: new Date(), sentBy: actorId, sentTo: to, sentCc: cc, emailMessageId: res.id ?? null, error: null }).where(eq(s.measurementReports.id, r.id));
  return { ok: true as const };
}
