/**
 * Inteligência → Preços por item: histórico das licitações em que participamos, item a item —
 * nosso preço unitário (lance e final) e o da empresa vencedora, com a diferença. Exporta CSV para análise.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtPct } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { Button, EmptyState, ErrorState, Input, LoadingRows } from '../../components/ui/primitives';

type Row = {
  opportunityId: string; code: number; stage: string; contactName: string; at: string; orgao: string | null; edital: string | null;
  itemId: string; description: string; unit: string; qtyMilli: number; bidUnitCents: number | null; finalUnitCents: number | null;
  winnerIsUs: boolean; winnerCompany: string | null; winnerUnitCents: number | null; gap: number | null;
};

const qty = (m: number) => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const csvMoney = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

export function BidItemPrices() {
  const [q, setQ] = useState('');
  const [only, setOnly] = useState(true);
  const dq = useDebounced(q, 300);
  const list = useQuery({ queryKey: ['bid-item-prices', dq, only], queryFn: () => api<{ items: Row[] }>(`/intelligence/bid-item-prices${qs({ q: dq || undefined, onlyResults: only ? 'true' : undefined })}`) });
  const items = list.data?.items ?? [];
  const sum = useMemo(() => {
    const withRes = items.filter((r) => r.winnerIsUs || r.winnerUnitCents != null);
    const lost = withRes.filter((r) => !r.winnerIsUs && r.gap != null);
    return { items: items.length, withRes: withRes.length, won: withRes.filter((r) => r.winnerIsUs).length, avgGap: lost.length ? lost.reduce((t, r) => t + r.gap!, 0) / lost.length : null };
  }, [items]);
  const exportCsv = () => {
    const head = ['Data', 'Oportunidade', 'Órgão', 'Edital', 'Item', 'Qtd', 'Unidade', 'Nosso lance (un.)', 'Nosso final (un.)', 'Vencedora', 'Vencedora (un.)', 'Diferença %'];
    const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = items.map((r) => [r.at, `OP-${r.code}`, r.orgao ?? r.contactName, r.edital ?? '', r.description, qty(r.qtyMilli), r.unit, csvMoney(r.bidUnitCents), csvMoney(r.finalUnitCents), r.winnerIsUs ? 'Nós' : r.winnerCompany ?? '', csvMoney(r.winnerUnitCents), r.gap == null ? '' : (r.gap * 100).toFixed(2).replace('.', ',')].map((v) => esc(String(v))).join(';'));
    const blob = new Blob([`﻿${[head.join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `precos-por-item-licitacoes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-4">
      <section aria-label="Resumo dos preços por item" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[['Itens listados', String(sum.items)], ['Com resultado', String(sum.withRes)], ['Itens que vencemos', String(sum.won)], ['Diferença média nos perdidos', sum.avgGap == null ? '—' : `${sum.avgGap > 0 ? '+' : ''}${fmtPct(sum.avgGap)}`]].map(([l, v]) => (
          <div key={l} className="card p-4"><p className="text-sm text-muted">{l}</p><p className="num whitespace-nowrap text-xl font-extrabold text-ink">{list.isLoading ? '…' : v}</p></div>
        ))}
      </section>
      <section className="card p-5" aria-label="Preços por item nas licitações">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Preços por item nas licitações</h2>
            <p className="text-sm text-muted">Nosso preço unitário e o da vencedora em cada item dos pregões em que participamos. Registre na aba Pregão da oportunidade (Resultado por item).</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />Só itens com resultado</label>
            <div className="relative w-full max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden /><Input aria-label="Buscar item, órgão ou vencedora" className="pl-9" placeholder="Item, órgão, vencedora…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} disabled={!items.length} onClick={exportCsv}>Exportar CSV</Button>
          </div>
        </div>
        {list.isLoading ? <LoadingRows rows={5} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !items.length ? (
          <EmptyState title={only ? 'Nenhum resultado por item ainda' : 'Nenhum item de licitação'} description="Na oportunidade de licitação, aba Pregão → Resultado por item, informe nosso preço final e o da vencedora." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="text-xs text-muted"><tr>{['Data', 'Pregão', 'Item', 'Qtd.', 'Nosso lance (un.)', 'Nosso final (un.)', 'Vencedora', 'Vencedora (un.)', 'Diferença'].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.itemId} className="border-t border-line hover:bg-surface-2">
                    <td className="num px-2 py-2 text-muted">{fmtDate(r.at)}</td>
                    <td className="px-2 py-2"><Link className="font-semibold text-primary hover:underline" to={`/opportunities/${r.opportunityId}?aba=pregao`}>OP-{r.code}</Link><span className="block text-xs text-muted">{r.orgao || r.contactName}{r.edital ? ` · edital ${r.edital}` : ''}</span></td>
                    <td className="px-2 py-2 text-ink">{r.description}</td>
                    <td className="num px-2 py-2">{qty(r.qtyMilli)} {r.unit}</td>
                    <td className="num px-2 py-2">{r.bidUnitCents == null ? '—' : fmtBRL(r.bidUnitCents)}</td>
                    <td className="num px-2 py-2">{r.finalUnitCents == null ? '—' : fmtBRL(r.finalUnitCents)}</td>
                    <td className="px-2 py-2">{r.winnerIsUs ? <span className="font-semibold text-[#15803D]">Nós</span> : r.winnerCompany ?? '—'}</td>
                    <td className="num px-2 py-2 font-semibold">{r.winnerUnitCents == null ? '—' : fmtBRL(r.winnerUnitCents)}</td>
                    <td className={`num px-2 py-2 ${r.gap != null && r.gap > 0 ? 'text-danger' : ''}`}>{r.winnerIsUs ? '—' : r.gap == null ? '—' : `${r.gap > 0 ? '+' : ''}${fmtPct(r.gap)}`}</td>
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
