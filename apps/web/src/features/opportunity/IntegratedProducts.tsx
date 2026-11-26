import { useQuery } from '@tanstack/react-query';
import { globalInputFromSections, type EconInput, type EconItem } from '@isp/domain';
import { api } from '../../lib/api';
import type { Opportunity } from '../../lib/types';
import { ErrorState, LoadingRows, Notice } from '../../components/ui/primitives';
import { DealProducts } from './DealProducts';
import { ProductsTab } from './OpportunityItems';
export function IntegratedProducts({ opp }: { opp: Opportunity }) {
  const q = useQuery({ queryKey: ['economics', opp.id], queryFn: () => api<{ input: EconInput | null; items: EconItem[]; settings?: { netMarginTargetBp?: number | null } | null; financeHidden: boolean }>('/opportunities/' + opp.id + '/economics') });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={5} />;
  if (opp.saleKind === 'consumo_contrato') return <DealProducts key="consumo_contrato" opp={opp} />;
  if (q.data.financeHidden) return <ProductsTab opp={opp} />;
  const input = q.data.input;
  if (input?.sections?.length && (q.data.settings?.netMarginTargetBp == null || !globalInputFromSections(input, q.data.items))) return <div className="space-y-4"><Notice tone="info">Os detalhes por seção desta negociação foram preservados.</Notice><ProductsTab opp={opp} /></div>;
  return <DealProducts opp={opp} />;
}
