/** Relatórios das atas: nove visões conciliadas com o livro de movimentações, com filtros e planilha (CSV). */
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { ARP_LEDGER_KINDS, ARP_LEDGER_LABELS } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtPct } from '../../lib/format';
import { ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { qty, type Agency, type ItemView } from './shared';

export const REPORTS = [
  ['consumo_ata', 'Consumo por ata'], ['consumo_item', 'Consumo por item'], ['orgao', 'Por órgão'], ['saldo', 'Saldo por item e órgão'], ['adesoes', 'Adesões'],
  ['conversoes', 'Conversões e remanejamentos'], ['movimentacoes', 'Movimentações'], ['oportunidades', 'Oportunidades vinculadas'], ['contratacoes', 'Contratações decorrentes'],
] as const;
type ReportType = (typeof REPORTS)[number][0];
type Col = { key: string; label: string; type?: 'qty' | 'money' | 'pct' | 'date' | 'text' };
type Report = { columns: Col[]; rows: Record<string, unknown>[]; totals: Record<string, number>; how: string };

function cell(c: Col, v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  if (c.type === 'qty') return qty(Number(v));
  if (c.type === 'money') return fmtBRL(Number(v));
  if (c.type === 'pct') return fmtPct(Number(v));
  if (c.type === 'date') return fmtDate(String(v));
  return String(v);
}

export function ArpReports({ arpId, items, agencies }: { arpId?: string; items?: ItemView[]; agencies?: Agency[] }) {
  const [f, setF] = useState<{ type: ReportType; from: string; to: string; itemId: string; agencyId: string; agencyKind: string; kind: string }>({ type: arpId ? 'consumo_item' : 'consumo_ata', from: '', to: '', itemId: '', agencyId: '', agencyKind: '', kind: '' });
  const params = { type: f.type, arpId, from: f.from || undefined, to: f.to || undefined, itemId: f.itemId || undefined, agencyId: f.agencyId || undefined, agencyKind: f.agencyKind || undefined, kind: f.kind || undefined };
  const q = useQuery({ queryKey: ['arp-report', params], placeholderData: keepPreviousData, queryFn: () => api<Report>(`/arp-reports${qs(params)}`) });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Relatório" htmlFor="ar-type"><Select id="ar-type" value={f.type} onChange={(e) => set({ type: e.target.value as ReportType })}>{REPORTS.filter(([k]) => !arpId || k !== 'consumo_ata').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField>
        <FormField label="De" htmlFor="ar-from"><Input id="ar-from" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></FormField>
        <FormField label="Até" htmlFor="ar-to"><Input id="ar-to" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></FormField>
        {items && ['consumo_item', 'saldo', 'movimentacoes'].includes(f.type) && <FormField label="Item" htmlFor="ar-item"><Select id="ar-item" value={f.itemId} onChange={(e) => set({ itemId: e.target.value })}><option value="">Todos</option>{items.map((i) => <option key={i.id} value={i.id}>{i.lot ? `${i.lot}/` : ''}{i.itemNumber} · {i.description.slice(0, 40)}</option>)}</Select></FormField>}
        {agencies && ['orgao', 'saldo', 'movimentacoes', 'adesoes', 'oportunidades'].includes(f.type) && <FormField label="Órgão" htmlFor="ar-ag"><Select id="ar-ag" value={f.agencyId} onChange={(e) => set({ agencyId: e.target.value })}><option value="">Todos</option>{agencies.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></FormField>}
        {['orgao', 'saldo', 'movimentacoes'].includes(f.type) && <FormField label="Tipo de órgão" htmlFor="ar-ak"><Select id="ar-ak" value={f.agencyKind} onChange={(e) => set({ agencyKind: e.target.value })}><option value="">Todos</option><option value="gerenciador">Gerenciador</option><option value="participante">Participante</option><option value="nao_participante">Não participante</option></Select></FormField>}
        {f.type === 'movimentacoes' && <FormField label="Movimentação" htmlFor="ar-kind"><Select id="ar-kind" value={f.kind} onChange={(e) => set({ kind: e.target.value })}><option value="">Todas</option>{ARP_LEDGER_KINDS.map((k) => <option key={k} value={k}>{ARP_LEDGER_LABELS[k]}</option>)}</Select></FormField>}
        <a className="ml-auto inline-flex h-10 items-center gap-2 rounded-md border border-primary/60 bg-surface px-4 font-semibold text-primary hover:bg-primary-soft" href={`/api/v1/arp-reports${qs({ ...params, format: 'csv' })}`} download><Download className="h-4 w-4" />Planilha (CSV)</a>
      </div>
      {q.isLoading ? <LoadingRows rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <p className="mb-3 text-sm text-muted">{q.data!.how}</p>
          {!q.data!.rows.length ? <p className="py-6 text-center text-sm text-muted">Nada para mostrar com estes filtros.</p> : (
            <div className="max-h-[560px] overflow-auto rounded-md border border-line">
              <table className="w-full text-left text-sm" style={{ minWidth: Math.max(720, q.data!.columns.length * 120) }}>
                <thead className="sticky top-0 bg-surface-2 text-xs text-muted"><tr>{q.data!.columns.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2 font-medium">{c.label}</th>)}</tr></thead>
                <tbody>{q.data!.rows.map((r, i) => <tr key={i} className="border-t border-line">{q.data!.columns.map((c) => <td key={c.key} className={c.type && c.type !== 'text' && c.type !== 'date' ? 'num whitespace-nowrap px-3 py-2 text-right' : 'px-3 py-2'}>{cell(c, r[c.key])}</td>)}</tr>)}</tbody>
                {Object.keys(q.data!.totals).length > 0 && f.type !== 'movimentacoes' && (
                  <tfoot><tr className="border-t-2 border-line font-semibold">{q.data!.columns.map((c, i) => <td key={c.key} className="num whitespace-nowrap px-3 py-2 text-right">{i === 0 ? `${q.data!.rows.length} linha(s)` : q.data!.totals[c.key] !== undefined && c.type === 'money' ? fmtBRL(q.data!.totals[c.key]) : ''}</td>)}</tr></tfoot>
                )}
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
