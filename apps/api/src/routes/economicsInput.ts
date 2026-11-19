import { z } from 'zod';
import { COST_IMPACTS, ECON_MODES, DEAL_KINDS } from '@isp/domain';
const bp = z.number().int().min(0).max(9_999);
const Line = z.object({ category: z.enum(['materia_prima', 'mao_de_obra', 'parceiros', 'despesas_operacionais']).nullable().optional(), description: z.string().trim().min(2).max(160), qtyMilli: z.number().int().min(1).max(1_000_000_000), unitCents: z.number().int().min(0).max(10_000_000_000), unit: z.string().trim().max(12).nullable().optional(), impact: z.enum(COST_IMPACTS).nullable().optional(), costItemId: z.string().uuid().nullable().optional(), priceId: z.string().uuid().nullable().optional(), manual: z.boolean().optional(), kind: z.enum(DEAL_KINDS).nullable().optional() });
export const EconBody = z.object({
  mode: z.enum(ECON_MODES), termMonths: z.number().int().min(1).max(240), receiveMonth: z.number().int().min(0).max(60),
  capex: z.array(Line).max(300), extraInitialCents: z.number().int().min(0).max(10_000_000_000), opex: z.array(Line).max(300),
  commissionBp: bp.nullable(), lossBp: bp.nullable(), marginTargetBp: bp.nullable(), variableBp: bp.nullable().optional(), paybackMonths: z.number().int().min(1).max(240).nullable().optional(), priceCents: z.number().int().min(0).max(10_000_000_000).nullable(), salePriceCents: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
  fiscalYear: z.number().int().min(2020).max(2100).nullable().optional(),
  /** viabilidade B2G: modo A/B, rateio da negociação, alvo, margens manuais, payback pelo alvo, pesos e lances por produto */
  b2g: z.object({
    mode: z.enum(['A', 'B']).optional(), overheadBp: bp.nullable().optional(), netTargetBp: z.number().int().min(-5000).max(9_999).nullable().optional(),
    contributionBp: z.object({ fornecimento: bp.nullable().optional(), implantacao: bp.nullable().optional(), instalacao: bp.nullable().optional() }).optional(), solvePayback: z.boolean().optional(),
    weights: z.record(z.string().max(300), z.number().min(0).max(1)).optional(), bids: z.record(z.string().max(300), z.number().int().min(0).max(10_000_000_000)).optional(),
  }).nullable().optional(),
});
