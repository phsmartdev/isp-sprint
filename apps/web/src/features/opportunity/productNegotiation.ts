import { costQty, parseMoney, type CostLine, type DealKind, type EconInput } from '@isp/domain';

export const BUSINESS_KINDS: DealKind[] = ['venda', 'servico', 'locacao', 'recorrencia'];
export const BUSINESS_LABELS: Record<DealKind, string> = { venda: 'Venda', servico: 'Instalação', locacao: 'Aluguel', recorrencia: 'Recorrência' };
export type Frequency = 'unico' | 'mensal';
export type CostDraft = CostLine & { key: string; quantity: string; value: string; frequency: Frequency };
export const moneyText = (c: number | null | undefined) => c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const quantityText = (q: number) => (q / 1000).toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 3 });
let seq = 0;
export const rowKey = () => 'draft-' + ++seq;

/** A frequência só escolhe capex ou opex; a classificação original e os parâmetros permanecem intactos. */
export function costDrafts(input: EconInput, kinds: DealKind[]): CostDraft[] {
  const monthly = kinds.filter((k) => k === 'recorrencia' || k === 'locacao');
  const row = (c: CostLine, frequency: Frequency): CostDraft => ({
    ...c, kind: c.kind ?? (frequency === 'mensal' && monthly.length === 1 ? monthly[0] : frequency === 'unico' && kinds.length === 1 ? kinds[0] : null),
    key: rowKey(), quantity: quantityText(c.qtyMilli), value: moneyText(c.unitCents), frequency,
  });
  return [...input.capex.map((c) => row(c, 'unico')), ...input.opex.map((c) => row(c, 'mensal'))];
}
export function costsInput(input: EconInput, costs: CostDraft[]): EconInput {
  const rows = costs.filter((c) => c.description.trim() || c.value.trim());
  const line = ({ key: _k, quantity, value, frequency: _f, ...c }: CostDraft): CostLine => ({
    ...c, description: c.description.trim(), qtyMilli: costQty(quantity) ?? 0, unitCents: parseMoney(value) ?? -1,
  });
  return { ...input, capex: rows.filter((c) => c.frequency === 'unico').map(line), opex: rows.filter((c) => c.frequency === 'mensal').map(line) };
}
