/**
 * Licitação → Pregão: resultado por item. Nosso preço unitário (lance e final depois da disputa) e o da empresa vencedora,
 * para o histórico de preços da Inteligência. Pode ser preenchido depois do encerramento (o resultado sai depois).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bidItemGap, bidItemResultError, parseMoney } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtPct } from '../../lib/format';
import { Button, Input, LoadingRows, ErrorState } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Item = { id: string; description: string; unit: string; qtyMilli: number; bidUnitCents: number | null; finalUnitCents: number | null; winnerIsUs: boolean; winnerCompany: string | null; winnerUnitCents: number | null };
type Data = { items: Item[]; rowVersion: number };
type Participant = { company: string; isUs: boolean; winner: boolean };
type Row = { id: string; final: string; us: boolean; company: string; unit: string };

const money = (c: number | null) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qty = (m: number) => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const cents = (s: string) => (s.trim() ? parseMoney(s) : null);

export function BidItemResults({ oppId }: { oppId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['opp-items', oppId], queryFn: () => api<Data>(`/opportunities/${oppId}/items`) });
  const parts = useQuery({ queryKey: ['bid-participants', oppId], queryFn: () => api<{ items: Participant[] }>(`/opportunities/${oppId}/bid-participants`) });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const items = q.data?.items ?? [];
  // vencedora do pregão (uma só): sugestão para os itens ainda sem resultado
  const winners = (parts.data?.items ?? []).filter((p) => p.winner);
  const solo = winners.length === 1 ? winners[0]! : null;
  const start = () => {
    setRows(items.map((i) => {
      const empty = i.finalUnitCents == null && !i.winnerIsUs && !i.winnerCompany && i.winnerUnitCents == null;
      return { id: i.id, final: money(i.finalUnitCents ?? (empty ? i.bidUnitCents : null)), us: empty && solo ? solo.isUs : i.winnerIsUs, company: i.winnerCompany ?? (empty && solo && !solo.isUs ? solo.company : ''), unit: money(i.winnerUnitCents) };
    }));
    setErr(null);
  };
  const save = useMutation({
    mutationFn: async () => {
      const fresh = await api<Data>(`/opportunities/${oppId}/items`);
      return api<Data>(`/opportunities/${oppId}/items/bid-results`, { method: 'PUT', body: { rowVersion: fresh.rowVersion, items: rows!.map((r) => ({ id: r.id, finalUnitCents: cents(r.final), winnerIsUs: r.us, winnerCompany: r.us ? null : r.company.trim() || null, winnerUnitCents: r.us ? null : cents(r.unit) })) } });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['opp-items', oppId] });
      void qc.invalidateQueries({ queryKey: ['opportunity', oppId] });
      void qc.invalidateQueries({ queryKey: ['timeline', oppId] });
      void qc.invalidateQueries({ queryKey: ['bid-item-prices'] });
      setRows(null);
      toast({ tone: 'success', message: 'Resultado por item salvo' });
    },
    onError: (e) => setErr(errMsg(e)),
  });
  const submit = () => {
    for (const [k, r] of rows!.entries()) {
      const d = items[k]!.description;
      if ((r.final.trim() && cents(r.final) === null) || (!r.us && r.unit.trim() && cents(r.unit) === null)) return setErr(`${d}: valor no formato 1.500,00`);
      const e = bidItemResultError({ finalUnitCents: cents(r.final), winnerIsUs: r.us, winnerCompany: r.us ? null : r.company, winnerUnitCents: r.us ? null : cents(r.unit) });
      if (e) return setErr(`${d}: ${e}`);
    }
    save.mutate();
  };
  const set = (id: string, p: Partial<Row>) => setRows(rows!.map((r) => (r.id === id ? { ...r, ...p } : r)));

  return (
    <section aria-label="Resultado por item" className="card p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-ink">Resultado por item</h2>
          <p className="text-sm text-muted">Nosso preço unitário e o da empresa vencedora em cada item. Alimenta o histórico de preços em Inteligência → Preços por item.</p>
        </div>
        {!rows && items.length > 0 && <Button size="sm" variant="outline" onClick={start}>Registrar resultado</Button>}
      </div>
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !items.length ? (
        <p className="text-sm text-muted">Lance os itens na aba Produtos para registrar o resultado de cada um.</p>
      ) : (
        <div>
          {err && <p role="alert" className="mb-2 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-xs text-muted"><tr>{['Item', 'Qtd.', 'Nosso lance (un.)', 'Nosso final (un.)', 'Vencedora', 'Vencedora (un.)', 'Diferença'].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {items.map((i, k) => {
                const r = rows?.[k];
                const fin = r ? cents(r.final) : i.finalUnitCents;
                const win = r ? (r.us ? fin : cents(r.unit)) : i.winnerIsUs ? i.finalUnitCents ?? i.bidUnitCents : i.winnerUnitCents;
                const us = r ? r.us : i.winnerIsUs;
                const gap = us ? 0 : bidItemGap({ bidUnitCents: i.bidUnitCents, finalUnitCents: fin }, win);
                return (
                  <tr key={i.id} className="border-t border-line align-top">
                    <td className="px-2 py-2 font-semibold text-ink">{i.description}</td>
                    <td className="num px-2 py-2">{qty(i.qtyMilli)} {i.unit}</td>
                    <td className="num px-2 py-2">{i.bidUnitCents == null ? '—' : fmtBRL(i.bidUnitCents)}</td>
                    <td className="num px-2 py-2">{r ? <Input aria-label={`Nosso preço unitário final de ${i.description}`} inputMode="decimal" className="num h-8 w-[120px]" placeholder="R$ 0,00" value={r.final} onChange={(e) => set(i.id, { final: e.target.value })} /> : i.finalUnitCents == null ? '—' : fmtBRL(i.finalUnitCents)}</td>
                    <td className="px-2 py-2">{r ? (
                      <div className="flex flex-col gap-1">
                        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={r.us} onChange={(e) => set(i.id, { us: e.target.checked })} aria-label={`Nós vencemos ${i.description}`} />Nós vencemos</label>
                        {!r.us && <Input aria-label={`Empresa vencedora de ${i.description}`} className="h-8 w-[200px]" placeholder="Empresa vencedora" list={`venc-${oppId}`} value={r.company} onChange={(e) => set(i.id, { company: e.target.value })} />}
                      </div>
                    ) : us ? <span className="font-semibold text-[#15803D]">Nós</span> : i.winnerCompany ?? '—'}</td>
                    <td className="num px-2 py-2">{r && !r.us ? <Input aria-label={`Preço unitário da vencedora de ${i.description}`} inputMode="decimal" className="num h-8 w-[120px]" placeholder="R$ 0,00" value={r.unit} onChange={(e) => set(i.id, { unit: e.target.value })} /> : win == null ? '—' : fmtBRL(win)}</td>
                    <td className={`num px-2 py-2 ${gap != null && gap > 0 ? 'text-danger' : ''}`}>{us ? '—' : gap == null ? '—' : `${gap > 0 ? '+' : ''}${fmtPct(gap)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <datalist id={`venc-${oppId}`}>{[...new Set((parts.data?.items ?? []).filter((p) => !p.isUs).map((p) => p.company))].map((c) => <option key={c} value={c} />)}</datalist>
          <p className="mt-2 text-xs text-muted">Diferença = nosso final (ou o lance, sem final) contra o unitário da vencedora. Positivo: ficamos mais caros.</p>
          {rows && <div className="mt-3 flex justify-end gap-2"><Button size="sm" onClick={() => setRows(null)}>Cancelar</Button><Button size="sm" variant="primary" loading={save.isPending} onClick={submit}>Salvar resultado</Button></div>}
        </div>
      )}
    </section>
  );
}
