/**
 * Licitação: resultado por item — nosso preço unitário (lance e final) e o da empresa vencedora, para análise de preço.
 * Valores em centavos por unidade do item.
 */
export type BidItemResultInput = { finalUnitCents: number | null; winnerIsUs: boolean; winnerCompany: string | null; winnerUnitCents: number | null };

export function bidItemResultError(r: BidItemResultInput): string | null {
  const okC = (v: number | null) => v == null || (Number.isInteger(v) && v >= 0);
  if (!okC(r.finalUnitCents) || !okC(r.winnerUnitCents)) return 'Valor unitário inválido.';
  if (r.winnerIsUs && r.winnerCompany?.trim()) return 'Vencedora: marque "Nós" ou informe outra empresa, não os dois.';
  if (!r.winnerIsUs && r.winnerUnitCents != null && !r.winnerCompany?.trim()) return 'Informe a empresa vencedora do item.';
  return null;
}

/** Preço unitário da vencedora: o nosso final quando vencemos. */
export const winnerUnit = (r: BidItemResultInput) => (r.winnerIsUs ? r.finalUnitCents : r.winnerUnitCents);

/**
 * Diferença do nosso preço para o da vencedora: (nosso − vencedor) / vencedor, em fração.
 * Positivo = ficamos mais caros. Usa o final; sem final, o lance do item.
 */
export function bidItemGap(our: { bidUnitCents: number | null; finalUnitCents: number | null }, winnerUnitCents: number | null) {
  const ours = our.finalUnitCents ?? our.bidUnitCents;
  if (ours == null || winnerUnitCents == null || winnerUnitCents <= 0) return null;
  return (ours - winnerUnitCents) / winnerUnitCents;
}
