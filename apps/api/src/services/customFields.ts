/** Campos personalizados (cliente e negociação): validação dos valores e gravação das definições. */
import { and, eq, notInArray } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { unprocessable } from '../http/errors';

type FieldDef = { key: string; label: string; type: string; options: string[] };

/** Junta os valores novos aos atuais conferindo tipo e opções. null ou '' apaga o valor. */
export function mergeCustom(fields: FieldDef[], current: Record<string, unknown>, patch: Record<string, unknown>, where = 'nesta jornada') {
  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    const f = fields.find((x) => x.key === k);
    if (!f) throw unprocessable('Campo personalizado desconhecido.', [{ path: `custom.${k}`, message: `Campo não existe ${where}` }]);
    if (v === null || v === '') { delete merged[k]; continue; }
    const bad = (m: string) => unprocessable(`${f.label}: ${m}`, [{ path: `custom.${k}`, message: m }]);
    if ((f.type === 'numero' || f.type === 'moeda') && (typeof v !== 'number' || !Number.isFinite(v))) throw bad('informe um número');
    if (f.type === 'sim_nao' && typeof v !== 'boolean') throw bad('informe sim ou não');
    if (f.type === 'data' && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))) throw bad('informe uma data');
    if (f.type === 'lista' && !f.options.includes(String(v))) throw bad('escolha uma das opções');
    if ((f.type === 'texto' || f.type === 'texto_longo') && (typeof v !== 'string' || v.length > (f.type === 'texto' ? 300 : 5000))) throw bad('texto inválido ou longo demais');
    merged[k] = v;
  }
  return merged;
}

/** Normaliza a lista vinda da tela: gera a chave pelo rótulo e evita chaves repetidas. */
export function normalizeFields<T extends { chave?: string; rotulo: string; tipo: string; opcoes: string[] }>(list: T[]) {
  const slugify = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c_$1').slice(0, 40);
  const keyOf = (t: string) => { const k = slugify(t); return k.length >= 2 ? k : `campo_${k}`; };
  const taken = new Set<string>();
  return list.map((f) => {
    const base = f.chave ?? keyOf(f.rotulo);
    let k = base;
    for (let i = 2; taken.has(k); i++) k = `${base.slice(0, 36)}_${i}`;
    taken.add(k);
    if (f.tipo === 'lista' && f.opcoes.length < 2) throw unprocessable(`“${f.rotulo}”: lista precisa de ao menos 2 opções.`);
    return { ...f, chave: k };
  });
}

export async function customerFieldList(db: DbOrTx, tenantId: string) {
  return db.select({ key: s.customerFields.key, label: s.customerFields.label, type: s.customerFields.type, options: s.customerFields.options, required: s.customerFields.required })
    .from(s.customerFields).where(and(eq(s.customerFields.tenantId, tenantId), eq(s.customerFields.active, true))).orderBy(s.customerFields.position);
}

/** Substitui os campos de cliente. Nunca apaga: o que sai fica inativo e o valor guardado continua. */
export async function replaceCustomerFields(tx: DbOrTx, tenantId: string, fields: { chave: string; rotulo: string; tipo: string; opcoes: string[]; obrigatorio: boolean }[]) {
  for (const [i, f] of fields.entries()) {
    const values = { label: f.rotulo, type: f.tipo, options: f.opcoes, required: f.obrigatorio, position: i, active: true };
    await tx.insert(s.customerFields).values({ tenantId, key: f.chave, ...values }).onConflictDoUpdate({ target: [s.customerFields.tenantId, s.customerFields.key], set: values });
  }
  await tx.update(s.customerFields).set({ active: false }).where(and(eq(s.customerFields.tenantId, tenantId), fields.length ? notInArray(s.customerFields.key, fields.map((f) => f.chave)) : undefined));
}
