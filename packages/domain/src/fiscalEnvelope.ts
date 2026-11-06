/**
 * Envelope fiscal por vigência (Reforma Tributária) — fica em Configurações → Filiais → Documentos fiscais, por
 * empresa (filial/CNPJ) e ano:
 * 1. Divisor do markup: os tributos da nota de cada documento fiscal, cadastrados por ano (vigência).
 * 2. DRE de viabilidade: a alíquota efetiva sobre o lucro (IRPJ/CSLL) da empresa no ano.
 * 3. Retenções na fonte (IRRF, CSRF, ISS retido): guardadas para o contas a receber; nunca entram no preço nem na DRE.
 * Nenhuma alíquota tem valor no código: tudo vem do que a empresa cadastra.
 */

/** Até 2026 o regime atual (PIS/COFINS); de 2027 em diante CBS/IBS no lugar (só rótulo: os tributos vêm do cadastro). */
export const REFORM_FIRST_YEAR = 2027;
export type FiscalRegime = 'tradicional' | 'reforma';
export const regimeOfYear = (year: number): FiscalRegime => (year >= REFORM_FIRST_YEAR ? 'reforma' : 'tradicional');
export const FISCAL_REGIME_LABELS: Record<FiscalRegime, string> = { tradicional: 'Regime atual (até 2026)', reforma: 'Reforma Tributária (2027 em diante)' };

/** Retenções na fonte (camada 3): só informativas para o contas a receber; o motor nunca as lê. */
export const ENVELOPE_RETENTIONS = { irrf: 'IRRF', csrf: 'CSRF (PIS/COFINS/CSLL retidos)', issRetido: 'ISS retido' } as const;
export type EnvelopeRetention = keyof typeof ENVELOPE_RETENTIONS;

/** DRE e retenções da empresa no ano. */
export type FiscalEnvelopeValues = {
  /** Aliquota_Efetiva_Lucro_%: IRPJ + CSLL efetivos sobre a margem operacional positiva (presunção do Lucro Presumido, partilha do Simples…) */
  profitTaxBp: number | null;
  retentions?: Partial<Record<EnvelopeRetention, number>>;
  note?: string | null;
};
export type FiscalEnvelope = { id: string; branchId: string; year: number; values: FiscalEnvelopeValues; createdAt?: string | Date };

export function fiscalEnvelopeErrors(e: { year: number; values: FiscalEnvelopeValues }) {
  const err: string[] = [];
  if (!Number.isInteger(e.year) || e.year < 2020 || e.year > 2100) err.push('Vigência inválida (ano).');
  const okBp = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 10_000;
  if (e.values.profitTaxBp != null && !okBp(e.values.profitTaxBp)) err.push('Alíquota efetiva sobre o lucro inválida.');
  for (const [code, v] of Object.entries(e.values.retentions ?? {})) {
    if (!(code in ENVELOPE_RETENTIONS)) err.push(`Retenção inválida: ${code}.`);
    else if (v != null && !okBp(v)) err.push(`Alíquota inválida: ${ENVELOPE_RETENTIONS[code as EnvelopeRetention]}.`);
  }
  return err;
}

/** Envelope da simulação: mesma empresa, o de maior ano até a vigência pedida (a mais recente publicação de cada ano). */
export function pickFiscalEnvelope(envs: FiscalEnvelope[], ctx: { branchId: string | null; year: number }) {
  if (!ctx.branchId) return null;
  const ts = (e: FiscalEnvelope) => (e.createdAt ? new Date(e.createdAt).getTime() : 0);
  return envs.filter((e) => e.branchId === ctx.branchId && e.year <= ctx.year).sort((a, b) => b.year - a.year || ts(b) - ts(a))[0] ?? null;
}

/** Tributos de um documento fiscal no ano: os do maior ano cadastrado até ele; sem nenhum, os tributos base do documento. */
export function docTaxesForYear<T>(doc: { taxes: T[]; taxesByYear?: Record<string, T[]> | null }, year: number): { taxes: T[]; fromYear: number | null } {
  const ys = Object.keys(doc.taxesByYear ?? {}).map(Number).filter((y) => Number.isInteger(y) && y <= year).sort((a, b) => b - a);
  return ys.length ? { taxes: doc.taxesByYear![String(ys[0])]!, fromYear: ys[0]! } : { taxes: doc.taxes, fromYear: null };
}

export type FiscalContextInfo = {
  year: number; regime: FiscalRegime; branchId: string | null;
  envelope: { id: string; year: number } | null;
  /** tributos da nota de cada documento usados no divisor, e de qual ano vieram (null = cadastro base do documento) */
  docs: { name: string; percentBp: number; fromYear: number | null }[];
  /** alíquota efetiva sobre o lucro usada na DRE e na recomendação; source = de onde veio */
  profitTaxBp: number | null; profitTaxSource: 'envelope' | 'parametros' | null;
  /** retenções da empresa no ano: informadas, fora do preço e da DRE */
  retentions: { code: string; label: string; bp: number }[];
};
