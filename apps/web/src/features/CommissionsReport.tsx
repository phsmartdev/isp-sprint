import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BadgeDollarSign, Coins, ShoppingBag, Target } from 'lucide-react';
import { SALE_TYPE_LABELS, type SaleType } from '@isp/domain';
import { api, qs } from '../lib/api';
import { fmtBRL, fmtDate } from '../lib/format';
import { Avatar, Chip, EmptyState, ErrorState, LoadingRows } from '../components/ui/primitives';
import { FitText } from '../components/ui/FitText';

type Data = {
  scope: 'proprio' | 'equipe' | 'total';
  total: { sales: number; commissionCents: number; revenueCents: number; cacCents: number; avgCacCents: number | null };
  sellers: { userId: string; name: string; sales: number; revenueCents: number; commissionCents: number; cacCents: number }[];
  items: { id: string; code: number; contactName: string; planName: string | null; valueCents: number | null; saleType: SaleType | null; commissionCents: number | null; rule: string | null; cacCents: number | null; marginCents: number | null; paybackMonths: string | null; ownerId: string; ownerName: string; wonAt: string }[];
};

/** Comissões das vendas fechadas: vendedor vê as suas; supervisão a equipe; gerência todas (regra no servidor). */
export function CommissionsReport({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['reports', 'commissions', from, to], queryFn: () => api<Data>(`/reports/commissions${qs({ from, to })}`) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const tiles = [
    { icon: <ShoppingBag className="h-6 w-6" />, label: 'Vendas fechadas', value: String(d.total.sales), tone: 'bg-primary-soft text-primary' },
    { icon: <Coins className="h-6 w-6" />, label: d.scope === 'proprio' ? 'Sua comissão' : 'Comissão total', value: fmtBRL(d.total.commissionCents), tone: 'bg-success-soft text-success' },
    { icon: <BadgeDollarSign className="h-6 w-6" />, label: 'Mensalidades vendidas', value: fmtBRL(d.total.revenueCents), tone: 'bg-purple-soft text-purple' },
    { icon: <Target className="h-6 w-6" />, label: 'CAC médio', value: d.total.avgCacCents === null ? '—' : fmtBRL(d.total.avgCacCents), tone: 'bg-warning-soft text-[#EA580C]' },
  ];
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card flex items-center gap-4 p-4">
            <span className={`flex h-12 w-12 items-center justify-center rounded-circle ${t.tone}`}>{t.icon}</span>
            <span className="min-w-0 flex-1"><FitText as="span" className="num text-xl font-extrabold text-ink">{t.value}</FitText><span className="text-sm text-muted">{t.label}</span></span>
          </div>
        ))}
      </section>
      {d.scope !== 'proprio' && d.sellers.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-bold text-ink">Por vendedor</h2>
          <ul className="divide-y divide-line">
            {d.sellers.map((s) => (
              <li key={s.userId} className="grid grid-cols-[1fr_80px_140px_140px] items-center gap-3 py-2.5 text-sm">
                <span className="flex items-center gap-2 text-ink"><Avatar name={s.name} userId={s.userId} size={30} />{s.name}</span>
                <span className="num text-right text-text">{s.sales} venda(s)</span>
                <span className="num text-right text-muted">{fmtBRL(s.revenueCents)}/mês</span>
                <span className="num text-right font-bold text-success">{fmtBRL(s.commissionCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card overflow-hidden">
        <div className="px-5 pb-2 pt-4">
          <h2 className="text-lg font-bold text-ink">Comissões por venda</h2>
          <p className="text-xs text-muted">Valores gravados no fechamento, com os parâmetros de viabilidade da época. {d.scope === 'proprio' ? 'Você vê só as suas vendas.' : ''}</p>
        </div>
        {d.items.length === 0 ? <EmptyState title="Nenhuma venda fechada no período" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Venda', 'Plano', 'Mensalidade', 'Tipo', 'Comissão', 'Regra', 'CAC', 'Margem/mês', 'Payback', 'Vendedor', 'Fechada em'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id} className="border-t border-line">
                    <td className="px-4 py-2.5"><Link className="link font-semibold" to={`/opportunities/${i.id}`}>{i.contactName}</Link><span className="block text-xs text-muted">OP-{i.code}</span></td>
                    <td className="px-4 py-2.5 text-text">{i.planName ?? '—'}</td>
                    <td className="num px-4 py-2.5 text-text">{fmtBRL(i.valueCents)}</td>
                    <td className="px-4 py-2.5">{i.saleType ? <Chip tone={i.saleType === 'ativa' ? 'blue' : 'purple'}>{SALE_TYPE_LABELS[i.saleType]}</Chip> : <span className="text-muted">—</span>}</td>
                    <td className="num px-4 py-2.5 font-bold text-success">{fmtBRL(i.commissionCents)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{i.rule ?? '—'}</td>
                    <td className="num px-4 py-2.5 text-text">{fmtBRL(i.cacCents)}</td>
                    <td className="num px-4 py-2.5 text-text">{fmtBRL(i.marginCents)}</td>
                    <td className="num px-4 py-2.5 text-text">{i.paybackMonths ? `${i.paybackMonths.replace('.', ',')} m` : '—'}</td>
                    <td className="px-4 py-2.5 text-text">{i.ownerName}</td>
                    <td className="num px-4 py-2.5 text-text">{fmtDate(i.wonAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
