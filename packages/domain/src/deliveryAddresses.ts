/**
 * Contrato → Endereços de entrega (um ou vários). Cada linha: sequência, endereço, banda/serviço e colunas extras definidas por quem cadastra.
 * Entrada: digitação, colar do Excel (com a linha de títulos) ou planilha (.xlsx/.csv). Colunas reconhecidas pelo título, em qualquer ordem;
 * títulos que não são sequência, endereço ou banda/serviço viram colunas extras.
 */

export type DeliveryAddress = { seq: number; address: string; service: string | null; extra: Record<string, string> };
export type DeliveryAddresses = { columns: string[]; rows: DeliveryAddress[] };
export const DELIVERY_MAX_ROWS = 2000;
export const DELIVERY_MAX_COLUMNS = 12;

const norm = (h: unknown) => String(h ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.:;()\[\]*º°ª#]/g, ' ').replace(/\s+/g, ' ').trim();
const isSeq = (h: string) => /^(seq|sequencia|sequencial|ordem|item|n|no|num|numero|ponto)$/.test(h);
const isAddress = (h: string) => /^(endereco|endereco de entrega|endereco completo|local|localizacao|logradouro|endereco instalacao|endereco de instalacao)$/.test(h);
const isService = (h: string) => /^(banda|servico|banda servico|banda\/servico|banda \/ servico|velocidade|plano|produto|servico banda)$/.test(h.replace(/\s*\/\s*/g, '/')) || /^banda ?\/ ?servico$/.test(h);

export type ParseResult = DeliveryAddresses & { errors: { row: number; message: string }[]; missing: string[] };

/** Lê a tabela (primeira linha = títulos). Sequência vazia: numera na ordem. */
export function parseDeliveryTable(table: (string | number | null)[][], current: DeliveryAddresses = { columns: [], rows: [] }): ParseResult {
  const clean = table.filter((r) => r.some((c) => String(c ?? '').trim()));
  const head = (clean[0] ?? []).map((h) => String(h ?? '').trim());
  const nh = head.map(norm);
  const si = nh.findIndex(isSeq), ai = nh.findIndex(isAddress), vi = nh.findIndex(isService);
  if (ai < 0) return { columns: current.columns, rows: [], errors: [], missing: ['Endereço'] };
  const extraIdx = head.map((h, i) => ({ h, i })).filter((x) => x.h && x.i !== si && x.i !== ai && x.i !== vi);
  const columns = [...current.columns];
  for (const x of extraIdx) if (!columns.some((c) => norm(c) === norm(x.h))) columns.push(x.h);
  const errors: ParseResult['errors'] = [];
  if (columns.length > DELIVERY_MAX_COLUMNS) return { columns: current.columns, rows: [], errors: [{ row: 1, message: `No máximo ${DELIVERY_MAX_COLUMNS} colunas extras.` }], missing: [] };
  let next = current.rows.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
  const rows: DeliveryAddress[] = [];
  clean.slice(1).forEach((r, k) => {
    const row = k + 2;
    const address = String(r[ai] ?? '').trim();
    if (!address) { errors.push({ row, message: 'Endereço vazio.' }); return; }
    if (address.length > 500) { errors.push({ row, message: 'Endereço com mais de 500 caracteres.' }); return; }
    const rawSeq = si >= 0 ? String(r[si] ?? '').trim() : '';
    let seq: number;
    if (rawSeq) { seq = Number(rawSeq.replace(',', '.')); if (!Number.isInteger(seq) || seq < 1) { errors.push({ row, message: 'Sequência deve ser um número inteiro.' }); return; } }
    else seq = next;
    next = Math.max(next, seq + 1);
    const extra: Record<string, string> = {};
    for (const x of extraIdx) { const v = String(r[x.i] ?? '').trim(); if (v) extra[columns.find((c) => norm(c) === norm(x.h))!] = v.slice(0, 300); }
    rows.push({ seq, address, service: vi >= 0 ? String(r[vi] ?? '').trim().slice(0, 200) || null : null, extra });
  });
  return { columns, rows, errors, missing: [] };
}

/** Erros que impedem salvar: endereço vazio, sequência repetida ou inválida, limites. */
export function deliveryErrors(d: DeliveryAddresses): string[] {
  const e: string[] = [];
  if (d.rows.length > DELIVERY_MAX_ROWS) e.push(`No máximo ${DELIVERY_MAX_ROWS} endereços por contrato.`);
  if (d.columns.length > DELIVERY_MAX_COLUMNS) e.push(`No máximo ${DELIVERY_MAX_COLUMNS} colunas extras.`);
  const cols = new Set<string>();
  for (const c of d.columns) { const n = norm(c); if (!n) e.push('Coluna extra sem nome.'); else if (cols.has(n) || isSeq(n) || isAddress(n) || isService(n)) e.push(`Coluna repetida: ${c}.`); cols.add(n); }
  const seqs = new Set<number>();
  d.rows.forEach((r, i) => {
    if (!r.address.trim()) e.push(`Linha ${i + 1}: endereço vazio.`);
    if (!Number.isInteger(r.seq) || r.seq < 1) e.push(`Linha ${i + 1}: sequência inválida.`);
    else if (seqs.has(r.seq)) e.push(`Sequência ${r.seq} repetida.`);
    seqs.add(r.seq);
  });
  return e;
}

/** Junta novos endereços aos atuais (sequência repetida: a nova linha substitui a antiga). */
export function mergeDelivery(cur: DeliveryAddresses, add: DeliveryAddresses): DeliveryAddresses {
  const bySeq = new Map(cur.rows.map((r) => [r.seq, r]));
  for (const r of add.rows) bySeq.set(r.seq, r);
  return { columns: add.columns.length >= cur.columns.length ? add.columns : cur.columns, rows: [...bySeq.values()].sort((a, b) => a.seq - b.seq) };
}

/** Modelo para baixar (CSV com ;). */
export const deliveryTemplateCsv = (columns: string[] = []) => ['Sequência', 'Endereço', 'Banda/Serviço', ...columns].join(';') + '\n1;Rua Exemplo, 100 - Centro - Aracaju/SE;100 Mbps' + ';'.repeat(columns.length) + '\n';
