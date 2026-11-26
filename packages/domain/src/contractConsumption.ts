import { impactOfCategory, type CostFrequency } from './dealSections';
import { costLineTotal, isMonthlyKind, SERVICE_INVESTMENT_BP, serviceInvestmentExtra, type CostLine, type DealKind, type EconInput, type EconSettings } from './finance';

export const CONTRACT_CONSUMPTION_ENGINE = 'consumo-contrato-v1';

export function contractConsumptionInput(input: EconInput): EconInput {
  if (!input.sections?.length || input.pricingMode === 'global') return input;
  const capex: CostLine[] = [], opex: CostLine[] = [];
  for (const section of input.sections) {
    for (const { frequency, ...cost } of section.costs) {
      const monthly = frequency === 'mensal' && isMonthlyKind(section.kind);
      (monthly ? opex : capex).push({ ...cost, kind: section.kind, impact: cost.category ? impactOfCategory(cost.category, frequency) : null });
    }
  }
  return { ...input, capex, opex, sections: null };
}

type ConsumptionTotal = { kind: DealKind | null; frequency: CostFrequency; contractCents: number; inferenceCents: number | null };
export type ContractConsumptionResult = { engineVersion: typeof CONTRACT_CONSUMPTION_ENGINE; rateBp: number | null; totals: ConsumptionTotal[] };

export function calculateContractConsumption(input: EconInput, settings: Pick<EconSettings, 'serviceCostBp'> | null): ContractConsumptionResult {
  const { capex, opex } = contractConsumptionInput(input);
  const rateBp = settings ? settings.serviceCostBp ?? SERVICE_INVESTMENT_BP : null;
  const totals = new Map<string, ConsumptionTotal>();
  const add = (cost: CostLine, frequency: CostFrequency) => {
    const kind = cost.kind ?? null;
    const period = kind && !isMonthlyKind(kind) ? 'unico' : frequency;
    const key = `${kind}:${period}`;
    const total = totals.get(key) ?? { kind, frequency: period, contractCents: 0, inferenceCents: null };
    total.contractCents += costLineTotal(cost);
    totals.set(key, total);
  };
  capex.forEach((cost) => add(cost, 'unico'));
  opex.forEach((cost) => add(cost, 'mensal'));
  return {
    engineVersion: CONTRACT_CONSUMPTION_ENGINE,
    rateBp,
    totals: [...totals.values()].map((total) => ({
      ...total,
      inferenceCents: total.kind === 'venda' ? 0 : total.kind && rateBp != null ? serviceInvestmentExtra(total.contractCents, rateBp) : null,
    })),
  };
}
