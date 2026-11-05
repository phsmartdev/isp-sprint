/**
 * Cadastro ERP: valores herdados (lidos na hora, nunca copiados), visão do formulário, permissões com
 * segregação de funções e a ficha de lançamento em PDF (timbrado da filial da venda).
 */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  ERP_FIELDS, ERP_GROUPS, ERP_GROUP_LABELS, ERP_STATUS_LABELS, effectiveValue, erpIssues, personTypeOf, snapshotText,
  type ErpExtra, type ErpItem, type ErpStatus, type InheritedValues, type PlaybookRole,
} from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { AuthContext } from '../http/context';
import { isAdmin, currentVersion, type ContractRow } from './contracts';
import { level } from './scope';
import { letterheadPainter, type Letterhead } from './economicsExport';
import { safeText, wrap } from './proposals';

export type ErpRecordRow = typeof s.contractErpRecords.$inferSelect;

const BILLING_LABEL: Record<string, string> = { recorrente: 'Recorrente', frequente: 'Frequente', medicao: 'Medição' };

/** Tudo o que o Cadastro ERP herda do contrato, da conta, do endereço e da oportunidade. */
export async function inheritedFor(db: DbOrTx, c: ContractRow) {
  const v = await currentVersion(db, c);
  const [contact] = await db.select({ name: s.contacts.name, document: s.contacts.document, email: s.contacts.email, phone: s.contacts.phone }).from(s.contacts).where(eq(s.contacts.id, c.contactId)).limit(1);
  const [addr] = await db.select().from(s.addresses).where(eq(s.addresses.contactId, c.contactId)).orderBy(desc(s.addresses.validFrom)).limit(1);
  const [opp] = c.opportunityId ? await db.select({ branchId: s.opportunities.branchId }).from(s.opportunities).where(eq(s.opportunities.id, c.opportunityId)).limit(1) : [];
  const [branch] = opp?.branchId ? await db.select({ id: s.salesBranches.id, name: s.salesBranches.name }).from(s.salesBranches).where(eq(s.salesBranches.id, opp.branchId)).limit(1) : [];
  const ids = [c.commercialOwnerId, c.operationalOwnerId].filter((x): x is string => !!x);
  const people = ids.length ? await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, ids)) : [];
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? null : null);
  const inherited: InheritedValues = {
    'contact.name': contact?.name ?? null, 'contact.document': contact?.document ?? null, 'contact.email': contact?.email ?? null, 'contact.phone': contact?.phone ?? null,
    'contact.personType': personTypeOf(contact?.document),
    'address.postalCode': addr?.postalCode ?? null, 'address.street': addr?.street ?? null, 'address.number': addr?.number ?? null, 'address.complement': addr?.complement ?? null,
    'address.district': addr?.district ?? null, 'address.city': addr?.city ?? null, 'address.state': addr?.state ?? null,
    'version.number': v.number, 'version.signedAt': v.signedAt, 'version.startAt': v.startAt, 'version.endAt': v.endAt,
    'version.monthlyCents': v.monthlyCents || null, 'version.totalCents': v.totalCents, 'version.billingDay': v.billingDay,
    'version.billingStartAt': v.billingStartAt, 'version.adjustmentIndex': v.adjustmentIndex, 'version.adjustmentBaseDate': v.adjustmentBaseDate,
    'version.specialConditions': v.specialConditions,
    'contract.kind': c.kind, 'contract.billingType': BILLING_LABEL[c.billingType] ?? c.billingType,
    'contract.commercialOwner': nameOf(c.commercialOwnerId), 'contract.operationalOwner': nameOf(c.operationalOwnerId),
    'branch.name': branch?.name ?? null,
  };
  const baseItems: ErpItem[] = v.items.map((i) => ({ description: i.description, qty: i.qty, unitCents: i.unitCents, ixcCode: null, unit: null, periodicity: null, location: null, notes: null }));
  return { inherited, baseItems, branchId: branch?.id ?? null, branchName: branch?.name ?? null };
}

/** Itens do grupo C: os complementos do cadastro sobre os itens da versão vigente (casados pela posição). */
export function mergeItems(base: readonly ErpItem[], saved: readonly ErpItem[] | null): ErpItem[] {
  if (!saved) return [...base];
  return base.map((b, i) => {
    const s0 = saved[i];
    return s0 && s0.description === b.description ? { ...b, ixcCode: s0.ixcCode, unit: s0.unit, periodicity: s0.periodicity, location: s0.location, notes: s0.notes } : b;
  });
}

/** Valores efetivos (manual vence herdado) de todos os campos, sem a senha. */
export function effectiveAll(r: Pick<ErpRecordRow, 'values'>, inherited: InheritedValues) {
  const out: Record<string, string | null> = {};
  for (const def of ERP_FIELDS) if (def.type !== 'secret') out[def.key] = effectiveValue(def, r.values, inherited).value;
  return out;
}

export function hashSnapshot(values: Record<string, string | null>, items: readonly ErpItem[]) {
  return createHash('sha256').update(snapshotText(values, items)).digest('hex');
}

// ------------------------------------------------------------------ permissões (Playbook + segregação)
/** Quem ocupa os papéis: parametrizado no cadastro de cada usuário (Configurações → Usuários). */
async function holders(db: DbOrTx, tenantId: string, roles: PlaybookRole[]) {
  const r = await db.select({ id: s.users.id }).from(s.users)
    .where(and(eq(s.users.tenantId, tenantId), eq(s.users.active, true), sql`${s.users.playbookRoles} && ${sql.raw(`ARRAY[${roles.map((x) => `'${x}'`).join(',')}]::text[]`)}`));
  return { defined: r.length > 0, users: new Set(r.map((x) => x.id)) };
}

/**
 * Quem pode o quê. Com titulares definidos no Playbook, valem eles (ASC preenche e lança; SC confere, com GC acima).
 * Com o papel em aberto, vale o nível do módulo: quem acessa o contrato preenche; a conferência fica com nível Equipe ou Total.
 * Nunca quem editou o cadastro desde a última aprovação aprova, e nunca quem lançou confere no IXC.
 */
export async function erpPermissions(db: DbOrTx, auth: AuthContext, r: ErpRecordRow | null) {
  const [asc0, sc] = await Promise.all([holders(db, auth.tenantId, ['ASC']), holders(db, auth.tenantId, ['SC', 'GC'])]);
  const lvl = level(auth, 'contratos');
  const manager = lvl === 'total';
  const fill = asc0.defined ? asc0.users.has(auth.userId) || manager || isAdmin(auth) : lvl !== 'nenhum';
  const reviewer = sc.defined ? sc.users.has(auth.userId) : lvl === 'equipe' || lvl === 'total';
  const authored = !!r && (r.editors.includes(auth.userId) || r.submittedBy === auth.userId);
  return {
    fill,
    review: reviewer && !authored,
    reviewBlockedReason: reviewer && authored ? 'Você preencheu ou alterou este cadastro: a conferência precisa ser de outra pessoa.' : !reviewer ? (sc.defined ? 'A conferência é da Supervisão Comercial (titulares do Playbook).' : 'A conferência exige nível Equipe ou Total em Contratos.') : null,
    launch: fill,
    check: fill && (!r?.launchedBy || r.launchedBy !== auth.userId),
    checkBlockedReason: r?.launchedBy === auth.userId ? 'Quem lançou no IXC não confere o próprio lançamento.' : null,
  };
}

// ------------------------------------------------------------------ visão
export async function erpView(db: DbOrTx, auth: AuthContext, c: ContractRow, r: ErpRecordRow) {
  const { inherited, baseItems, branchName } = await inheritedFor(db, c);
  const items = mergeItems(baseItems, r.items);
  const effective = effectiveAll(r, inherited);
  const snap = r.approvedSnapshot?.values ?? null;
  const compare = new Map((r.lastCompare ?? []).map((x) => [x.key, x]));
  const fields = ERP_FIELDS.map((def) => {
    if (def.type === 'secret') return { key: def.key, value: null, inherited: null, origin: r.secretEnc ? 'manual' : 'vazio', state: r.secretEnc ? 'preenchido' : 'pendente', hasValue: !!r.secretEnc };
    const ev = effectiveValue(def, r.values, inherited);
    const cmp = compare.get(def.key);
    const state = cmp?.status === 'divergente' ? 'divergente' : cmp?.status === 'ok' ? 'sincronizado' : !ev.value ? 'pendente' : snap && snap[def.key] === ev.value ? 'validado' : 'preenchido';
    return { key: def.key, value: ev.value, inherited: def.inherit ? inherited[def.inherit] ?? null : null, origin: ev.origin, state, ixcFound: cmp?.found ?? null, hasValue: !!ev.value };
  });
  const issues = erpIssues(effective, items, !!r.secretEnc);
  const [events, perms] = await Promise.all([
    db.select({ id: s.contractErpEvents.id, action: s.contractErpEvents.action, fromStatus: s.contractErpEvents.fromStatus, toStatus: s.contractErpEvents.toStatus, note: s.contractErpEvents.note, data: s.contractErpEvents.data, createdAt: s.contractErpEvents.createdAt, actorName: s.users.name })
      .from(s.contractErpEvents).leftJoin(s.users, eq(s.users.id, s.contractErpEvents.actorId)).where(eq(s.contractErpEvents.recordId, r.id)).orderBy(desc(s.contractErpEvents.createdAt)),
    erpPermissions(db, auth, r),
  ]);
  const ids = [r.submittedBy, r.approvedBy, r.launchedBy, r.checkedBy, r.launcherId, ...r.editors].filter((x): x is string => !!x);
  const people = ids.length ? await db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(inArray(s.users.id, [...new Set(ids)])) : [];
  const nm = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? null : null);
  const docs = await db.select({ id: s.contractDocuments.id, name: s.contractDocuments.name, category: s.contractDocuments.category, version: s.contractDocuments.version, signed: s.contractDocuments.signed }).from(s.contractDocuments).where(and(eq(s.contractDocuments.contractId, c.id), isNull(s.contractDocuments.deletedAt))).orderBy(asc(s.contractDocuments.name));
  return {
    id: r.id, seq: r.seq, cycle: r.cycle, status: r.status as ErpStatus, statusLabel: ERP_STATUS_LABELS[r.status as ErpStatus], rowVersion: r.rowVersion,
    fields, items, extras: r.extras, evidenceDocIds: r.evidenceDocIds, documents: docs, issues, branchName,
    ixcClientId: r.ixcClientId, ixcContractId: r.ixcContractId, compare: r.lastCompare,
    submittedByName: nm(r.submittedBy), submittedAt: r.submittedAt, approvedByName: nm(r.approvedBy), approvedAt: r.approvedAt, approvedHash: r.approvedHash,
    launcherName: nm(r.launcherId), launchedByName: nm(r.launchedBy), launchedAt: r.launchedAt, checkedByName: nm(r.checkedBy), checkedAt: r.checkedAt,
    editorNames: r.editors.map(nm).filter(Boolean), createdAt: r.createdAt, events, can: perms,
  };
}

// ------------------------------------------------------------------ ficha de lançamento (PDF)
export async function letterheadForBranch(db: DbOrTx, tenantId: string, branchId: string | null): Promise<Letterhead | null> {
  if (!branchId) return null;
  const [lh] = await db.select({ mime: s.branchLetterheads.mime, data: s.branchLetterheads.data, topMm: s.branchLetterheads.topMm, bottomMm: s.branchLetterheads.bottomMm, sideMm: s.branchLetterheads.sideMm }).from(s.branchLetterheads).where(and(eq(s.branchLetterheads.tenantId, tenantId), eq(s.branchLetterheads.branchId, branchId))).limit(1);
  return lh ? { ...lh, data: Buffer.from(lh.data as unknown as Uint8Array) } : null;
}

const MM = 72 / 25.4;
const fmtVal = (type: string, v: string | null) => {
  if (v == null || v === '') return '—';
  if (type === 'money') return (Number(v) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  return v;
};

/** Ficha usada para lançar à mão no IXC: os valores APROVADOS (fotografia), campo IXC ao lado, sem observações internas nem senha. */
export async function buildErpSheet(opts: {
  contractCode: number; contractNumber: string; clientName: string; record: ErpRecordRow; letterhead: Letterhead | null; generatedBy: string;
}) {
  const r = opts.record;
  const snap = r.approvedSnapshot!;
  const doc = await PDFDocument.create();
  doc.setTitle(`Ficha de lançamento IXC - CT-${opts.contractCode}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, ink = rgb(0.18, 0.2, 0.22), muted = rgb(0.42, 0.45, 0.5), line = rgb(0.85, 0.87, 0.9);
  const lh = opts.letterhead;
  const M = lh ? lh.sideMm * MM : 48, TOP = lh ? lh.topMm * MM : 48, BOT = lh ? lh.bottomMm * MM : 48;
  const paint = await letterheadPainter(doc, lh);
  const newPage = () => { const p = doc.addPage([W, H]); paint?.(p); return p; };
  let page: PDFPage = newPage();
  let y = H - TOP - 14;
  const need = (h: number) => { if (y - h < BOT + 20) { page = newPage(); y = H - TOP - 14; } };
  const text = (t: string, x: number, size = 9.5, f: PDFFont = font, color = ink) => page.drawText(safeText(f, t), { x, y, size, font: f, color });
  const section = (t: string) => { y -= 6; need(30); text(t, M, 11.5, bold); y -= 7; page.drawLine({ start: { x: M, y: y + 3 }, end: { x: W - M, y: y + 3 }, thickness: 0.6, color: line }); y -= 11; };
  const colL = M, colV = M + 170, colI = W - M - 120, valW = colI - colV - 8;
  const row = (label: string, value: string, ixc: string) => {
    const ls = wrap(font, label, 9, colV - colL - 8), vs = wrap(font, value, 9.5, valW);
    const n = Math.max(ls.length, vs.length, 1);
    need(n * 12 + 2);
    for (let i = 0; i < n; i++) { if (ls[i]) text(ls[i]!, colL, 9, font, muted); if (vs[i]) text(vs[i]!, colV, 9.5, i === 0 ? bold : font); if (i === 0 && ixc) text(ixc, colI, 8, font, muted); y -= 12; }
    y -= 2;
  };

  text('Ficha de lançamento no IXC', M, 17, bold); y -= 22;
  text(`CT-${opts.contractCode} · Contrato ${opts.contractNumber} · ${opts.clientName}`, M, 10); y -= 14;
  text(`Ciclo ${r.seq} · aprovado em ${r.approvedAt ? new Date(r.approvedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'} · hash ${(r.approvedHash ?? '').slice(0, 16)}`, M, 8.5, font, muted); y -= 12;
  text('Valores aprovados na conferência interna. A senha da Central do assinante não sai na ficha: veja no sistema (fica registrado).', M, 8.5, font, muted); y -= 6;

  for (const g of ERP_GROUPS) {
    if (g === 'C') {
      section(`C. ${ERP_GROUP_LABELS.C}`);
      for (const it of snap.items) row(`${it.qty} × ${it.description}`, `${fmtVal('money', String(it.unitCents))} · código IXC ${it.ixcCode ?? '—'} · ${it.unit ?? '—'} · ${it.periodicity ?? '—'}${it.location ? ` · ${it.location}` : ''}`, '');
      continue;
    }
    const defs = ERP_FIELDS.filter((d) => d.group === g && !d.internal && d.type !== 'secret');
    if (!defs.length) continue;
    section(`${g}. ${ERP_GROUP_LABELS[g]}`);
    let sec: string | undefined;
    for (const d of defs) {
      if (d.section && d.section !== sec) { sec = d.section; need(16); text(d.section, M, 9, bold, muted); y -= 12; }
      const v = snap.values[d.key] ?? null;
      const label = d.options?.find((o) => o.value === v)?.label ?? fmtVal(d.type, v);
      row(d.label, label, d.ixc ?? '');
    }
    if (g === 'G') for (const ex of snap.extras as ErpExtra[]) row(ex.label, ex.value, ex.ixc ?? '');
  }
  y -= 10; need(14);
  text(`Gerada por ${opts.generatedBy} em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`, M, 8, font, muted);
  return Buffer.from(await doc.save());
}
