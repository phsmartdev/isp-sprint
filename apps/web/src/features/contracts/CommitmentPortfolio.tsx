/**
 * Gestão de Contratos → Controle de Empenhos: a carteira inteira num lugar (PF09.5). Os quatro saldos somados,
 * o que está em risco e, por contrato, onde agir. Cada linha abre o controle do contrato.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Download, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Chip, EmptyState, ErrorState, Input, LoadingRows } from '../../components/ui/primitives';
import { downloadCsv, money, pctOf } from './commitmentShared';

type Totals = { contracted: number; committed: number; executed: number; pending: number; invoiced: number; toCommit: number; uncovered: number; executionPct: number | null };
type Row = {
  id: string; code: number; number: string | null; object: string | null; contact: string; agency: string | null; stage: string; startAt: string | null; endAt: string | null;
  lines: number; commitments: number; totals: Totals | null; alerts: { level: 'alto' | 'medio' | 'info'; key: string; text: string }[];
  pendingV4: number; exhaustBefore: number; toInvoiceV4: number; nextYearNeedV4: number;
};
type Filter = 'todos' | 'atencao' | 'sem_itens';

const daysTo = (iso: string | null, today: string) => (iso ? Math.round((new Date(`${iso}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000) : null);

export function CommitmentPortfolio() {
  const q = useQuery({ queryKey: ['commitment-portfolio'], queryFn: () => api<{ items: Row[]; today: string }>('/contracts/commitment-portfolio') });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('todos');
  const rows = q.data?.items ?? [];
  const today = q.data?.today ?? new Date().toISOString().slice(0, 10);
  const sum = useMemo(() => {
    const t = { contracted: 0, committed: 0, executed: 0, invoiced: 0, pending: 0, toCommit: 0, nextYear: 0 };
    for (const r of rows) {
      if (!r.totals) continue;
      t.contracted += r.totals.contracted; t.committed += r.totals.committed; t.executed += r.totals.executed + r.totals.pending; t.invoiced += r.totals.invoiced;
      t.pending += r.pendingV4; t.toCommit += r.totals.toCommit; t.nextYear += r.nextYearNeedV4;
    }
    return t;
  }, [rows]);
  if (q.isLoading) return <div className="card p-5"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!rows.length) return <div className="card p-5"><EmptyState title="Nenhum contrato com controle de empenhos" description="Contratos públicos ou faturados por medição aparecem aqui. Abra o contrato e importe a planilha de controle." /></div>;

  const attention = (r: Row) => r.alerts.some((a) => a.level === 'alto') || r.pendingV4 > 0;
  const counts = { todos: rows.length, atencao: rows.filter(attention).length, sem_itens: rows.filter((r) => !r.lines).length };
  const s = search.trim().toLowerCase();
  const shown = rows
    .filter((r) => filter === 'todos' || (filter === 'atencao' ? attention(r) : !r.lines))
    .filter((r) => !s || `${r.number ?? ''} ${r.contact} ${r.agency ?? ''} ${r.object ?? ''}`.toLowerCase().includes(s))
    .sort((a, b) => Number(attention(b)) - Number(attention(a)) || b.pendingV4 - a.pendingV4 || (a.endAt ?? '9').localeCompare(b.endAt ?? '9'));
  const exportCsv = () => downloadCsv('carteira-controle-empenhos.csv', [
    ['Contrato', 'Cliente', 'Órgão', 'Fim da vigência', 'Contratado', 'Empenhado', 'Executado', 'Faturado', 'Falta empenhar', 'Em risco', 'Itens que acabam antes do fim', 'Alertas'],
    ...rows.map((r) => [r.number ?? `CT-${r.code}`, r.contact, r.agency ?? '', r.endAt ?? '', (r.totals?.contracted ?? 0) / 10_000, (r.totals?.committed ?? 0) / 10_000, ((r.totals?.executed ?? 0) + (r.totals?.pending ?? 0)) / 10_000, (r.totals?.invoiced ?? 0) / 10_000, (r.totals?.toCommit ?? 0) / 10_000, r.pendingV4 / 10_000, r.exhaustBefore, r.alerts.map((a) => a.text).join(' | ')]),
  ]);

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <p className="max-w-3xl text-sm text-muted">Todos os contratos públicos ou por medição. Os saldos são calculados pelas medições e empenhos de cada contrato; clique num contrato para lançar medição, empenho ou reajuste.</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Big label="Contratado" value={money(sum.contracted)} hint={`${rows.filter((r) => r.lines).length} contrato(s) com itens`} />
          <Big label="Empenhado" value={money(sum.committed)} hint={sum.toCommit > 0 ? `Falta empenhar ${money(sum.toCommit)}` : 'Tudo empenhado'} warn={sum.toCommit > 0} />
          <Big label="Executado" value={money(sum.executed)} hint={`${pctOf(sum.executed, sum.contracted).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da carteira`} />
          <Big label="Faturado" value={money(sum.invoiced)} hint={sum.executed > sum.invoiced ? `${money(sum.executed - sum.invoiced)} medido sem nota` : 'Tudo faturado'} warn={sum.executed > sum.invoiced} />
          <Big label="Em risco" value={money(sum.pending)} hint="Sem empenho, sem nota ou retroativo a cobrar" danger={sum.pending > 0} />
        </dl>
        {sum.nextYear > 0 && <p className="mt-3 text-sm text-[#C2610C]">Empenho a providenciar para o próximo exercício: <b className="num">{money(sum.nextYear)}</b> (projeção pelo consumo médio).</p>}
      </section>

      <section className="card p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="flex border border-line text-xs font-semibold" role="group" aria-label="Filtrar contratos">
            {([['todos', 'Todos'], ['atencao', 'Precisam de atenção'], ['sem_itens', 'Sem itens cadastrados']] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={clsx('px-3 py-1.5', filter === k ? 'bg-primary text-white' : 'text-ink hover:bg-surface-2')}>{l} ({counts[k]})</button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
            <Input aria-label="Buscar contrato" className="h-9 w-64 pl-8" placeholder="Contrato, cliente ou órgão" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button type="button" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline" onClick={exportCsv}><Download className="h-4 w-4" aria-hidden />Exportar planilha</button>
        </div>
        {!shown.length ? <div className="p-5"><EmptyState title="Nada neste filtro" description="Mude o filtro ou a busca." /></div> : (
          <ul className="divide-y divide-line">{shown.map((r) => {
            const t = r.totals;
            const days = daysTo(r.endAt, today);
            const top = r.alerts.filter((a) => a.level === 'alto');
            const exec = t ? t.executed + t.pending : 0;
            return (
              <li key={r.id}>
                <Link to={`/contracts/${r.id}?aba=empenhos`} className="block px-4 py-3 hover:bg-surface-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-ink">{r.number ?? `CT-${r.code}`} <span className="font-normal text-muted">· {r.agency ?? r.contact}</span></p>
                      <p className="line-clamp-1 text-xs text-muted">{r.object}{r.endAt ? ` · vigência até ${fmtDate(r.endAt)}` : ''}{days != null && days >= 0 && days <= 180 ? ` (${days} dias)` : ''}</p>
                    </div>
                    {!t ? <Chip tone="yellow">Sem itens: importe a planilha</Chip> : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.pendingV4 > 0 && <Chip tone="red">{money(r.pendingV4)} em risco</Chip>}
                        {r.exhaustBefore > 0 && <Chip tone="yellow">{r.exhaustBefore} item(ns) acabam antes do fim</Chip>}
                        {!r.pendingV4 && !top.length && <Chip tone="green">Em dia</Chip>}
                      </div>
                    )}
                  </div>
                  {t && (
                    <>
                      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                        <Num label="Contratado" value={money(t.contracted)} />
                        <Num label="Empenhado" value={money(t.committed)} sub={t.toCommit > 0 ? `falta ${money(t.toCommit)}` : undefined} />
                        <Num label="Executado" value={money(exec)} sub={`${pctOf(exec, t.contracted).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`} />
                        <Num label="Faturado" value={money(t.invoiced)} sub={exec > t.invoiced ? `${money(exec - t.invoiced)} sem nota` : undefined} />
                      </dl>
                      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <span className="bg-success" style={{ width: `${pctOf(t.invoiced, t.contracted)}%` }} />
                        <span className="bg-[#F59E0B]" style={{ width: `${pctOf(Math.max(0, exec - t.invoiced), t.contracted)}%` }} />
                      </div>
                      {!!top.length && <ul className="mt-2 space-y-0.5">{top.slice(0, 3).map((a) => <li key={a.key} className="flex items-start gap-1.5 text-xs text-ink"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />{a.text}</li>)}{top.length > 3 && <li className="text-xs text-muted">+{top.length - 3} alerta(s)</li>}</ul>}
                    </>
                  )}
                </Link>
              </li>
            );
          })}</ul>
        )}
      </section>
    </div>
  );
}

function Big({ label, value, hint, warn, danger }: { label: string; value: string; hint: string; warn?: boolean; danger?: boolean }) {
  return (
    <div className="border border-line p-3">
      <dt className="text-xs font-semibold uppercase text-muted">{label}</dt>
      <dd className={clsx('num mt-0.5 text-xl font-bold', danger ? 'text-danger' : 'text-ink')}>{value}</dd>
      <dd className={clsx('mt-0.5 text-xs', warn || danger ? 'font-semibold text-[#C2610C]' : 'text-muted')}>{hint}</dd>
    </div>
  );
}
const Num = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div><dt className="text-2xs uppercase text-muted">{label}</dt><dd className="num font-semibold text-ink">{value}{sub && <span className="ml-1 text-xs font-normal text-muted">{sub}</span>}</dd></div>
);
