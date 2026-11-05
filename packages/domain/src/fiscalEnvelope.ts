/**
 * Envelope fiscal por vigência (Reforma Tributária): os tributos da nota, a alíquota efetiva sobre o lucro e as
 * retenções na fonte de cada emitente (filial/CNPJ) e município (código IBGE), por ano de vigência.
 *
 * Camadas:
 * 1. Divisor do markup: só os tributos da nota fiscal do envelope (Tributos_Cesta_%), somados por tipo de documento.
 * 2. DRE de viabilidade: amortização, glosa, inadimplência, despesas fixas e IRPJ/CSLL com a alíquota efetiva do envelope.
 * 3. Retenções na fonte (IRRF, CSRF, ISS retido): guardadas para o contas a receber; nunca entram no preço nem na DRE.
 *
 * Nenhuma alíquota tem valor no código: tudo vem do que a empresa cadastra em Configurações → Viabilidade.
 */

/** Regime de cada vigência: até 2026 o regime atual; de 2027 em diante CBS/IBS no lugar de PIS/COFINS. */
export const REFORM_FIRST_YEAR = 2027;
export type FiscalRegime = 'tradicional' | 'reforma';
export const regimeOfYear = (year: number): FiscalRegime => (year >= REFORM_FIRST_YEAR ? 'reforma' : 'tradicional');
export const FISCAL_REGIME_LABELS: Record<FiscalRegime, string> = { tradicional: 'Regime atual (até 2026)', reforma: 'Reforma Tributária (2027 em diante)' };

/** Tributos da nota (camada 1). ICMS e ISS seguem na reforma até a extinção gradual; PIS/COFINS saem em 2027. */
export const ENVELOPE_TAXES = {
  pis: { label: 'PIS', regimes: ['tradicional'] },
  cofins: { label: 'COFINS', regimes: ['tradicional'] },
  cbs: { label: 'CBS', regimes: ['reforma'] },
  ibs: { label: 'IBS', regimes: ['reforma'] },
  icms: { label: 'ICMS', regimes: ['tradicional', 'reforma'] },
  fecoep: { label: 'FECOEP', regimes: ['tradicional', 'reforma'] },
  iss: { label: 'ISS', regimes: ['tradicional', 'reforma'] },
  das: { label: 'DAS efetivo (Simples Nacional)', regimes: ['tradicional', 'reforma'] },
} as const satisfies Record<string, { label: string; regimes: readonly FiscalRegime[] }>;
export type EnvelopeTax = keyof typeof ENVELOPE_TAXES;
export const ENVELOPE_TAX_CODES = Object.keys(ENVELOPE_TAXES) as EnvelopeTax[];
export const envelopeTaxesOf = (regime: FiscalRegime) => ENVELOPE_TAX_CODES.filter((c) => (ENVELOPE_TAXES[c].regimes as readonly FiscalRegime[]).includes(regime));

/** Tipos de documento fiscal (natureza da operação): a carga da nota é por tipo. */
export const ENVELOPE_KINDS = ['venda', 'servico', 'locacao'] as const;
export type EnvelopeKind = (typeof ENVELOPE_KINDS)[number];
export const ENVELOPE_KIND_LABELS: Record<EnvelopeKind, string> = { venda: 'Venda (mercadoria)', servico: 'Prestação de serviço', locacao: 'Locação' };

/** Retenções na fonte (camada 3): só informativas para o contas a receber; o motor nunca as lê. */
export const ENVELOPE_RETENTIONS = { irrf: 'IRRF', csrf: 'CSRF (PIS/COFINS/CSLL retidos)', issRetido: 'ISS retido' } as const;
export type EnvelopeRetention = keyof typeof ENVELOPE_RETENTIONS;

export type FiscalEnvelopeValues = {
  /** alíquotas da nota por tipo de documento, em pontos-base (só os tributos do regime da vigência) */
  taxes: Partial<Record<EnvelopeKind, Partial<Record<EnvelopeTax, number>>>>;
  /** Aliquota_Efetiva_Lucro_%: IRPJ + CSLL efetivos sobre a margem operacional positiva (presunção do Lucro Presumido, partilha do Simples…) */
  profitTaxBp: number | null;
  /** retenções na fonte (camada 3) */
  retentions?: Partial<Record<EnvelopeRetention, number>>;
  note?: string | null;
};
export type FiscalEnvelope = { id: string; branchId: string; ibgeCode: string; municipality?: string | null; year: number; values: FiscalEnvelopeValues; createdAt?: string | Date };

export const IBGE_RE = /^\d{7}$/;
export function fiscalEnvelopeErrors(e: { year: number; ibgeCode: string; values: FiscalEnvelopeValues }) {
  const err: string[] = [];
  if (!Number.isInteger(e.year) || e.year < 2020 || e.year > 2100) err.push('Vigência inválida (ano).');
  if (!IBGE_RE.test(e.ibgeCode)) err.push('Código IBGE do município com 7 dígitos.');
  const allowed = new Set<string>(envelopeTaxesOf(regimeOfYear(e.year)));
  const okBp = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10_000;
  for (const [kind, taxes] of Object.entries(e.values.taxes ?? {})) {
    if (!(ENVELOPE_KINDS as readonly string[]).includes(kind)) { err.push(`Tipo de documento inválido: ${kind}.`); continue; }
    for (const [code, v] of Object.entries(taxes ?? {})) {
      if (v == null) continue;
      if (!allowed.has(code)) err.push(`${ENVELOPE_TAXES[code as EnvelopeTax]?.label ?? code} não existe na vigência ${e.year} (${FISCAL_REGIME_LABELS[regimeOfYear(e.year)]}).`);
      else if (!okBp(v)) err.push(`Alíquota inválida: ${ENVELOPE_TAXES[code as EnvelopeTax].label} em ${ENVELOPE_KIND_LABELS[kind as EnvelopeKind]}.`);
    }
    const sum = Object.values(taxes ?? {}).reduce<number>((s, v) => s + (v ?? 0), 0);
    if (sum >= 10_000) err.push(`Tributos de ${ENVELOPE_KIND_LABELS[kind as EnvelopeKind]} somam 100% ou mais.`);
  }
  if (e.values.profitTaxBp != null && !okBp(e.values.profitTaxBp)) err.push('Alíquota efetiva sobre o lucro inválida.');
  for (const [code, v] of Object.entries(e.values.retentions ?? {})) {
    if (!(code in ENVELOPE_RETENTIONS)) err.push(`Retenção inválida: ${code}.`);
    else if (v != null && !okBp(v)) err.push(`Alíquota inválida: ${ENVELOPE_RETENTIONS[code as EnvelopeRetention]}.`);
  }
  return err;
}

/** Só os tributos do regime da vigência (o resto do payload é ignorado: a tela e o motor leem o schema da chave ativa). */
export function envelopeTaxBp(env: FiscalEnvelope, kind: EnvelopeKind) {
  const allowed = envelopeTaxesOf(regimeOfYear(env.year));
  const t = env.values.taxes?.[kind];
  if (!t) return null;
  const parts = allowed.filter((c) => t[c] != null).map((c) => ({ code: c, label: ENVELOPE_TAXES[c].label, bp: t[c]! }));
  return parts.length ? { bp: parts.reduce((s, p) => s + p.bp, 0), parts } : null;
}

/**
 * Envelope da simulação: mesmo emitente e município, o de maior ano até a vigência pedida, dentro do mesmo regime
 * (a vigência 2028 usa o envelope 2027; nunca usa um envelope de 2026 para 2027, porque PIS/COFINS deixam de existir).
 * Em cada chave vale a publicação mais recente (as anteriores ficam no histórico).
 */
export function pickFiscalEnvelope(envs: FiscalEnvelope[], ctx: { branchId: string | null; ibgeCode: string | null; year: number }) {
  if (!ctx.branchId || !ctx.ibgeCode) return null;
  const reg = regimeOfYear(ctx.year);
  const ts = (e: FiscalEnvelope) => (e.createdAt ? new Date(e.createdAt).getTime() : 0);
  const cands = envs.filter((e) => e.branchId === ctx.branchId && e.ibgeCode === ctx.ibgeCode && e.year <= ctx.year && regimeOfYear(e.year) === reg);
  return cands.sort((a, b) => b.year - a.year || ts(b) - ts(a))[0] ?? null;
}

export type FiscalContextInfo = {
  year: number; regime: FiscalRegime; branchId: string | null; ibgeCode: string | null;
  envelope: { id: string; year: number; municipality: string | null } | null;
  /** carga da nota de cada tipo de documento usada no divisor (camada 1) */
  basket: { kind: EnvelopeKind; bp: number; parts: { code: string; label: string; bp: number }[] }[];
  /** alíquota efetiva sobre o lucro usada na DRE e na recomendação (camada 2); source = de onde veio */
  profitTaxBp: number | null; profitTaxSource: 'envelope' | 'parametros' | null;
  /** retenções do envelope (camada 3): informadas, fora do preço e da DRE */
  retentions: { code: string; label: string; bp: number }[];
};
