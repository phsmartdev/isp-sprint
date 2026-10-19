/**
 * Modelos de contrato em Word (.docx) com campos {{variável}}.
 * Conferimos o arquivo ao subir (campos mal fechados viram mensagem clara) e preenchemos na geração.
 * Tabela de itens: {{#itens}} {{descricao}} {{quantidade}} {{valor_unitario}} {{valor_total}} {{/itens}}.
 */
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { eq } from 'drizzle-orm';
import { BILLING_TYPE_LABELS, CONTRACT_TEMPLATE_VARIABLES, type BillingType } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import type { AuthContext } from '../http/context';
import { unprocessable } from '../http/errors';
import { brl } from './email';
import { currentVersion, type ContractRow } from './contracts';
import { ledgerOf } from './contractLedger';

const DELIMS = { start: '{{', end: '}}' };
const parser = (tag: string) => ({
  get(scope: Record<string, unknown>) {
    if (tag === '.') return scope;
    const t = tag.trim();
    if (t in scope) return scope[t];
    return t.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), scope);
  },
});

function explain(e: unknown) {
  const err = e as { properties?: { errors?: { properties?: { explanation?: string } }[]; explanation?: string }; message?: string };
  const list = err.properties?.errors?.map((x) => x.properties?.explanation).filter(Boolean) ?? [];
  return (list.length ? list.slice(0, 5).join(' · ') : err.properties?.explanation ?? err.message ?? 'arquivo inválido').replace(/\{|\}/g, (c) => c);
}

function open(data: Buffer) {
  let zip: PizZip;
  try { zip = new PizZip(data); } catch { throw unprocessable('O arquivo não é um Word (.docx) válido.'); }
  if (!zip.file('word/document.xml')) throw unprocessable('O arquivo não é um Word (.docx) válido.');
  return zip;
}

/** Confere o modelo (corpo, cabeçalho e rodapé, onde fica o timbrado) e lista os campos encontrados. */
export function inspectTemplate(data: Buffer) {
  const zip = open(data);
  try {
    new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: DELIMS, parser });
  } catch (e) {
    throw unprocessable(`Há campos com erro no modelo: ${explain(e)}. Confira se cada campo abre com {{ e fecha com }}.`);
  }
  const keys = new Set<string>();
  const loops = new Set<string>();
  const parts = Object.keys(zip.files).filter((f) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(f));
  for (const f of parts) {
    const text = zip.file(f)!.asText().replace(/<[^>]+>/g, '');
    let depth = 0;
    for (const m of text.matchAll(/\{\{\s*([#/^]?)\s*([^{}]+?)\s*\}\}/g)) {
      const [, mark, name] = m;
      if (mark === '#' || mark === '^') { loops.add(name!); keys.add(name!); depth++; continue; }
      if (mark === '/') { depth = Math.max(0, depth - 1); continue; }
      if (!depth) keys.add(name!);
    }
  }
  return { keys: [...keys].sort(), loops: [...loops] };
}

export function renderTemplate(data: Buffer, values: Record<string, unknown>) {
  const zip = open(data);
  try {
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: DELIMS, parser, nullGetter: () => '' });
    doc.render(values);
    return Buffer.from(doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  } catch (e) {
    throw unprocessable(`Não foi possível preencher o modelo: ${explain(e)}.`);
  }
}

const SYSTEM = new Set(CONTRACT_TEMPLATE_VARIABLES.map((v) => v.key));
/** Campos que não são do sistema viram variáveis do modelo (preenchidas na geração). */
export const customKeys = (keys: string[], loops: string[]) => keys.filter((k) => !SYSTEM.has(k) && !loops.includes(k) && k !== 'itens');

const br = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
export async function contractTemplateValues(db: DbOrTx, auth: AuthContext, c: ContractRow, custom: Record<string, string>) {
  const v = await currentVersion(db, c);
  const [contact] = await db.select().from(s.contacts).where(eq(s.contacts.id, c.contactId)).limit(1);
  const [addr] = await db.select().from(s.addresses).where(eq(s.addresses.contactId, c.contactId)).limit(1);
  const [owner] = await db.select({ name: s.users.name }).from(s.users).where(eq(s.users.id, c.commercialOwnerId)).limit(1);
  const ledger = c.billingType === 'medicao' ? (await ledgerOf(db, c.id)).totals : null;
  const today = new Date().toISOString().slice(0, 10);
  const base: Record<string, unknown> = {
    'cliente.nome': contact?.name ?? '', 'cliente.documento': contact?.document ?? '', 'cliente.email': contact?.email ?? '', 'cliente.telefone': contact?.phone ?? '',
    'cliente.endereco': addr ? [addr.street, addr.number, addr.complement, addr.district, addr.city, addr.state, addr.postalCode].filter(Boolean).join(', ') : '',
    'contrato.numero': v.number, 'contrato.codigo': `CT-${c.code}`, 'contrato.objeto': v.object, 'contrato.tipo': BILLING_TYPE_LABELS[c.billingType as BillingType],
    'contrato.assinatura': br(v.signedAt), 'contrato.inicio': br(v.startAt), 'contrato.termino': br(v.endAt), 'contrato.prazo_meses': v.termMonths ? String(v.termMonths) : '',
    'contrato.valor_mensal': brl(v.monthlyCents), 'contrato.valor_global': brl(v.totalCents), 'contrato.saldo': ledger ? brl(ledger.credited) : '',
    'contrato.dia_faturamento': v.billingDay ? String(v.billingDay) : '', 'contrato.condicoes_faturamento': v.billingTerms ?? '',
    'contrato.indice_reajuste': v.adjustmentIndex ?? '', 'contrato.data_base': br(v.adjustmentBaseDate), 'contrato.condicoes_especificas': v.specialConditions ?? '',
    'contrato.orgao': v.publicTerms?.agency ?? '', 'contrato.processo': v.publicTerms?.processNumber ?? '',
    'contrato.itens_texto': v.items.map((i) => `${i.qty} × ${i.description} — ${brl(i.unitCents)} (total ${brl(i.qty * i.unitCents)})`).join('\n'),
    'responsavel.nome': owner?.name ?? '', 'empresa.nome': auth.tenantName,
    data_hoje: br(today), data_extenso: new Date(`${today}T12:00:00Z`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
    itens: v.items.map((i) => ({ descricao: i.description, quantidade: String(i.qty), valor_unitario: brl(i.unitCents), valor_total: brl(i.qty * i.unitCents) })),
  };
  return { ...base, ...custom, _client: contact?.name ?? '', _number: v.number } as Record<string, unknown>;
}
