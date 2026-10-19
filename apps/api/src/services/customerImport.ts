/**
 * Importação manual da base de clientes por planilha (CSV do Excel, separado por ";" ou ",").
 * Valida tudo antes de gravar (prévia); linha com erro não entra. Código do cliente repetido atualiza.
 */
import { and, eq } from 'drizzle-orm';
import { SEGMENTS } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';

export const IMPORT_COLUMNS = [
  ['codigo_cliente', 'Código do cliente no seu sistema (IXC). Repetido = atualiza.', '1001'],
  ['nome', 'Nome completo ou razão social (obrigatório)', 'Maria Exemplo da Silva'],
  ['tipo', 'residencial, empresarial, governamental ou institucional', 'residencial'],
  ['cpf_cnpj', 'Opcional', ''],
  ['telefone', 'Com DDD', '(79) 99999-0000'],
  ['email', '', 'maria@exemplo.com'],
  ['plano', 'Nome igual ao cadastro de planos', '500 Mega'],
  ['situacao', 'ativo, inadimplente, suspenso, em_implantacao ou cancelado', 'ativo'],
  ['data_inicio', 'dd/mm/aaaa', '15/03/2025'],
  ['data_cancelamento', 'dd/mm/aaaa (só cancelados)', ''],
  ['motivo_cancelamento', 'Só cancelados', ''],
  ['cep', '', '49000-000'],
  ['logradouro', '', 'Rua Exemplo'],
  ['numero', '', '100'],
  ['condominio', 'Nome igual ao cadastro de condomínios (Área de atendimento)', ''],
  ['complemento', 'Bloco, apartamento…', 'Bl. 2 Ap. 302'],
  ['bairro', '', 'Centro'],
  ['cidade', '', 'Aracaju'],
  ['uf', '', 'SE'],
  ['responsavel_email', 'E-mail do vendedor responsável pela carteira (opcional)', ''],
] as const;
type Col = (typeof IMPORT_COLUMNS)[number][0];

/** Modelo para baixar: cabeçalho, uma linha de exemplo (ignorada na importação) e BOM para o Excel abrir com acentos. */
export function importTemplate() {
  const head = IMPORT_COLUMNS.map((c) => c[0]).join(';');
  const example = IMPORT_COLUMNS.map((c) => (c[0] === 'nome' ? 'EXEMPLO - apague esta linha' : c[2])).join(';');
  return `\uFEFF${head}\r\n${example}\r\n`;
}

/** Lê CSV com aspas, ";" ou "," (detecta pelo cabeçalho). */
export function parseCsv(text: string) {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const LIFE = ['ativo', 'inadimplente', 'suspenso', 'em_implantacao', 'cancelado'] as const;
const brDate = (v: string) => {
  const t = v.trim();
  if (!t) return null;
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) { const d = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`; return Number.isNaN(Date.parse(d)) ? undefined : d; }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m && !Number.isNaN(Date.parse(t)) ? t : undefined;
};
const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export type ImportRow = { condominiumId: string | null; line: number; externalId: string | null; name: string; segment: string; document: string | null; phone: string | null; email: string | null; planId: string | null; lifecycle: string; start: string | null; end: string | null; cancelReason: string | null; address: { postalCode: string | null; street: string | null; number: string | null; complement: string | null; district: string | null; city: string | null; state: string | null }; ownerId: string | null };

export async function validateImport(db: DbOrTx, tenantId: string, csv: string) {
  const rows = parseCsv(csv);
  if (!rows.length) return { rows: [] as ImportRow[], errors: [{ line: 1, message: 'Arquivo vazio.' }], total: 0 };
  const header = rows[0]!.map((h) => norm(h).replace(/\s+/g, '_'));
  const idx = (c: Col) => header.indexOf(c);
  if (idx('nome') < 0) return { rows: [], errors: [{ line: 1, message: 'Cabeçalho sem a coluna "nome". Use o modelo baixado.' }], total: 0 };
  const plans = await db.select({ id: s.plans.id, name: s.plans.name }).from(s.plans).where(eq(s.plans.tenantId, tenantId));
  const users = await db.select({ id: s.users.id, email: s.users.email }).from(s.users).where(eq(s.users.tenantId, tenantId));
  const condos = await db.select({ id: s.condominiums.id, name: s.condominiums.name }).from(s.condominiums).where(eq(s.condominiums.tenantId, tenantId));
  const out: ImportRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (c: Col) => (idx(c) >= 0 ? (r[idx(c)] ?? '').trim() : '');
    const name = get('nome');
    if (/^exemplo\b/i.test(name)) return;
    const errs: string[] = [];
    if (name.length < 2) errs.push('nome obrigatório');
    const seg = norm(get('tipo') || 'residencial');
    if (!(SEGMENTS as readonly string[]).includes(seg)) errs.push(`tipo "${get('tipo')}" inválido`);
    const life = norm(get('situacao') || 'ativo').replace(/\s+/g, '_');
    if (!(LIFE as readonly string[]).includes(life)) errs.push(`situação "${get('situacao')}" inválida`);
    const start = brDate(get('data_inicio'));
    if (start === undefined) errs.push('data_inicio inválida (use dd/mm/aaaa)');
    const end = brDate(get('data_cancelamento'));
    if (end === undefined) errs.push('data_cancelamento inválida (use dd/mm/aaaa)');
    if (start && end && end < start) errs.push('cancelamento antes do início');
    let planId: string | null = null;
    if (get('plano')) { planId = plans.find((p) => norm(p.name) === norm(get('plano')))?.id ?? null; if (!planId) errs.push(`plano "${get('plano')}" não existe no cadastro`); }
    let ownerId: string | null = null;
    if (get('responsavel_email')) { ownerId = users.find((u) => u.email.toLowerCase() === get('responsavel_email').toLowerCase())?.id ?? null; if (!ownerId) errs.push(`responsável "${get('responsavel_email')}" não é usuário`); }
    let condominiumId: string | null = null;
    if (get('condominio')) { condominiumId = condos.find((c) => norm(c.name) === norm(get('condominio')))?.id ?? null; if (!condominiumId) errs.push(`condomínio "${get('condominio')}" não está cadastrado`); }
    const email = get('email').toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.push('e-mail inválido');
    const ext = get('codigo_cliente') || null;
    if (ext) { if (seen.has(ext)) errs.push(`código ${ext} repetido no arquivo`); seen.add(ext); }
    if (errs.length) { errors.push({ line, message: `${name || '(sem nome)'}: ${errs.join('; ')}` }); return; }
    out.push({
      condominiumId,
      line, externalId: ext, name, segment: seg, document: get('cpf_cnpj') || null, phone: get('telefone') || null, email, planId, lifecycle: life,
      start: start ?? null, end: end ?? null, cancelReason: get('motivo_cancelamento') || null, ownerId,
      address: { postalCode: get('cep') || null, street: get('logradouro') || null, number: get('numero') || null, complement: get('complemento') || null, district: get('bairro') || null, city: get('cidade') || null, state: get('uf').toUpperCase() || null },
    });
  });
  if (rows.length - 1 > 20_000) errors.unshift({ line: 1, message: 'Máximo de 20.000 linhas por arquivo. Divida a planilha.' });
  return { rows: out, errors, total: rows.length - 1 };
}

export async function applyImport(tx: DbOrTx, tenantId: string, userId: string, rows: ImportRow[]) {
  let created = 0, updated = 0;
  for (const r of rows) {
    const existing = r.externalId
      ? (await tx.select({ id: s.customers.id, contactId: s.customers.contactId }).from(s.customers).where(and(eq(s.customers.tenantId, tenantId), eq(s.customers.sourceSystem, 'importacao'), eq(s.customers.externalId, r.externalId))).limit(1))[0]
      : undefined;
    const contactValues = { name: r.name, phone: r.phone, email: r.email, document: r.document, segment: r.segment, city: r.address.city, ownerId: r.ownerId, updatedAt: new Date() };
    const customerValues = { condominiumId: r.condominiumId, displayName: r.name, lifecycle: r.lifecycle, planId: r.planId, contractStart: r.start, contractEnd: r.end, cancelReason: r.cancelReason, updatedAt: new Date(), sourceUpdatedAt: new Date(), ingestedAt: new Date() };
    if (existing) {
      await tx.update(s.contacts).set(contactValues).where(eq(s.contacts.id, existing.contactId));
      await tx.update(s.customers).set(customerValues).where(eq(s.customers.id, existing.id));
      await tx.delete(s.addresses).where(eq(s.addresses.customerId, existing.id));
      await tx.insert(s.addresses).values({ tenantId, contactId: existing.contactId, customerId: existing.id, ...r.address });
      updated++;
    } else {
      const [c] = await tx.insert(s.contacts).values({ tenantId, ...contactValues, createdBy: userId, sourceSystem: 'importacao', externalId: r.externalId }).returning({ id: s.contacts.id });
      const [cu] = await tx.insert(s.customers).values({ tenantId, contactId: c!.id, ...customerValues, sourceSystem: 'importacao', externalId: r.externalId }).returning({ id: s.customers.id });
      await tx.insert(s.addresses).values({ tenantId, contactId: c!.id, customerId: cu!.id, ...r.address });
      created++;
    }
  }
  return { created, updated };
}
