/** Custos e indicadores: relatório do orçamento dos setores (orçado × realizado por centro, categoria e mês), recursos e Budget Guardião. */
import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronDown, Download } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { Button, EmptyState, LoadingRows, Select } from '../../components/ui/primitives';
import { BandChip, BudgetShell, ExecBar, Stat, neg, useStructure, type Totals } from '../../features/budget/shared';

type Cat = Totals & { accountId: string; code: string; name: string; deviationPct: number | null; needsJustification: boolean };
type Sector = Totals & { costCenter: { id: string; code: string; name: string }; categories: Cat[] };
type Report = {
  year: number; quarter: number | null; total: Totals; sectors: Sector[]; months: (Totals & { month: string })[];
  recurring: { count: number; monthlyCents: number; withoutVault: number }; assets: { count: number; valueCents: number };
  guardian: { id: string; costCenterId: string; quarter: number; month: string; deltaCents: number; pct: number | null; status: string; justification: string; createdAt: string }[];
};
const monthName = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
const pctTxt = (t: Pick<Totals, 'pct' | 'over'>) => (t.over ? '>100%' : t.pct === null ? '—' : `${Math.round(t.pct)}%`);

export function BudgetIndicatorsPage() {
  const now = new Date();
  const [f, setF] = useUrlState({ y: String(now.getFullYear()), q: '' });
  const st = useStructure();
  const q = useQuery({ queryKey: ['budget', 'report', f.y, f.q], queryFn: () => api<Report>(`/budget/report${qs({ year: f.y, quarter: f.q || undefined })}`) });
  const [open, setOpen] = useState<string[]>([]);
  const d = q.data;
  const csv = () => {
    if (!d) return;
    const rows = [['Centro de custo', 'Conta', 'Categoria', 'Planejado (R$)', 'Realizado (R$)', '% execução', 'Desvio (%)', 'Precisa justificar']];
    for (const s of d.sectors) for (const c of s.categories) rows.push([`${s.costCenter.code} ${s.costCenter.name}`, c.code, c.name, (-c.planned / 100).toFixed(2), (-c.realized / 100).toFixed(2), pctTxt(c), c.deviationPct === null ? '' : c.deviationPct.toFixed(1), c.needsJustification ? 'sim' : 'não']);
    const blob = new Blob([`﻿${rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orcamento-setores-${d.year}${d.quarter ? `-T${d.quarter}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const maxMonth = Math.max(1, ...(d?.months ?? []).map((m) => Math.max(m.planned, m.realized)));
  const ccOf = (id: string) => st.data?.costCenters.find((c) => c.id === id);
  return (
    <BudgetShell subtitle="Relatório do orçamento dos setores: planejado × realizado, % de execução, desvios e Budget Guardião."
      actions={<div className="flex flex-wrap gap-2">
        <Select aria-label="Ano" className="h-11 w-auto" value={f.y} onChange={(e) => setF({ y: e.target.value })}>{[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        <Select aria-label="Período" className="h-11 w-auto" value={f.q} onChange={(e) => setF({ q: e.target.value })}><option value="">Ano todo</option>{[1, 2, 3, 4].map((x) => <option key={x} value={x}>{x}º trimestre</option>)}</Select>
        <Button variant="outline" icon={<Download className="h-4 w-4" />} disabled={!d} onClick={csv}>Exportar</Button>
      </div>}>
      {q.isLoading || !d ? <div className="card"><LoadingRows /></div> : !d.sectors.length ? <div className="card"><EmptyState title="Sem centros de custo" description="Crie a estrutura em Planejamento orçamentário." /></div> : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-6" aria-label="Resumo do orçamento">
            <Stat label="Planejado aprovado" value={neg(d.total.planned)} />
            <Stat label="Realizado" value={neg(d.total.realized)} />
            <Stat label="Execução" value={pctTxt(d.total)} sub={<BandChip band={d.total.band} />} />
            <Stat label="Disponível" value={fmtBRL(d.total.available)} tone={d.total.available < 0 ? 'danger' : undefined} />
            <Stat label="Recorrentes por mês" value={neg(d.recurring.monthlyCents)} sub={`${d.recurring.count} licença(s)/contrato(s)${d.recurring.withoutVault ? ` · ${d.recurring.withoutVault} fora do Vault` : ''}`} />
            <Stat label="Equipamentos" value={fmtBRL(d.assets.valueCents)} sub={`${d.assets.count} item(ns) ativos`} />
          </dl>

          <section className="card overflow-x-auto p-0" aria-label="Orçamento por setor">
            <header className="flex items-baseline justify-between border-b border-line px-4 py-3"><h2 className="text-md font-bold text-ink">Orçamento por setor</h2><span className="text-xs text-muted">Clique no setor para ver as categorias</span></header>
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted"><th className="px-4 py-2.5 font-semibold">Setor / categoria</th><th className="px-3 py-2.5 text-right font-semibold">Planejado</th><th className="px-3 py-2.5 text-right font-semibold">Realizado</th><th className="px-3 py-2.5 font-semibold">% execução</th><th className="px-3 py-2.5 text-right font-semibold">Desvio</th><th className="px-4 py-2.5 font-semibold">Faixa</th></tr></thead>
              <tbody>
                {d.sectors.map((s) => {
                  const isOpen = open.includes(s.costCenter.id);
                  const toJustify = s.categories.filter((c) => c.needsJustification && (c.planned || c.realized)).length;
                  return (
                    <Fragment key={s.costCenter.id}>
                      <tr className="cursor-pointer border-b border-line hover:bg-surface-2" onClick={() => setOpen((o) => (isOpen ? o.filter((x) => x !== s.costCenter.id) : [...o, s.costCenter.id]))}>
                        <td className="px-4 py-3"><button type="button" aria-expanded={isOpen} className="flex items-center gap-2 text-left font-semibold text-ink"><ChevronDown className={clsx('h-4 w-4 text-muted transition-transform', !isOpen && '-rotate-90')} aria-hidden />{s.costCenter.code} · {s.costCenter.name}</button>{toJustify > 0 && <span className="ml-6 text-xs text-[#C2610C]">{toJustify} categoria(s) com desvio acima de 15%</span>}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{neg(s.planned)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{neg(s.realized)}</td>
                        <td className="px-3 py-3"><ExecBar t={s} wide /></td>
                        <td className="px-3 py-3 text-right tabular-nums text-text" title={`Disponível ${fmtBRL(s.available)}`}>{s.planned ? `${s.realized - s.planned > 0 ? '+' : ''}${(((s.realized - s.planned) / s.planned) * 100).toFixed(1).replace('.', ',')}%` : '—'}</td>
                        <td className="px-4 py-3"><BandChip band={s.band} /></td>
                      </tr>
                      {isOpen && s.categories.map((c) => (
                        <tr key={c.accountId} className="border-b border-line bg-surface-2/50 text-text">
                          <td className="py-2 pl-12 pr-4"><span className="tabular-nums text-muted">{c.code}</span> {c.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{neg(c.planned)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{neg(c.realized)}</td>
                          <td className="px-3 py-2"><ExecBar t={c} wide /></td>
                          <td className={clsx('px-3 py-2 text-right tabular-nums', c.needsJustification && 'font-semibold text-[#C2610C]')}>{c.deviationPct === null ? '—' : `${c.deviationPct > 0 ? '+' : ''}${c.deviationPct.toFixed(1).replace('.', ',')}%`}</td>
                          <td className="px-4 py-2"><BandChip band={c.band} /></td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>

          <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
            <section className="card p-5" aria-label="Planejado e realizado por mês">
              <h2 className="mb-1 text-md font-bold text-ink">Planejado × realizado por mês</h2>
              <p className="mb-4 flex gap-4 text-xs text-muted"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-primary-soft ring-1 ring-primary/40" />Planejado</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-primary" />Realizado</span></p>
              {!d.months.length ? <p className="text-sm text-muted">Nada planejado no período.</p> : (
                <ul className="space-y-2.5">
                  {d.months.map((m) => (
                    <li key={m.month} className="grid grid-cols-[3.5rem_1fr_7rem] items-center gap-3 text-sm">
                      <span className="text-muted">{monthName(m.month)}/{m.month.slice(2, 4)}</span>
                      <div className="relative h-5 bg-surface-2" title={`Planejado ${neg(m.planned)} · realizado ${neg(m.realized)}`}>
                        <div className="absolute inset-y-0 left-0 bg-primary-soft ring-1 ring-inset ring-primary/30" style={{ width: `${(m.planned / maxMonth) * 100}%` }} />
                        <div className={clsx('absolute inset-y-1 left-0', m.realized > m.planned ? 'bg-danger' : 'bg-primary')} style={{ width: `${(m.realized / maxMonth) * 100}%` }} />
                      </div>
                      <span className="text-right tabular-nums text-ink">{neg(m.realized)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card p-0" aria-label="Budget Guardião no período">
              <header className="border-b border-line px-4 py-3"><h2 className="text-md font-bold text-ink">Budget Guardião</h2><p className="text-xs text-muted">Todos os ajustes do ano, reportados à Diretoria</p></header>
              {!d.guardian.length ? <p className="px-4 py-6 text-sm text-muted">Nenhum ajuste.</p> : (
                <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">
                  {d.guardian.map((g) => (
                    <li key={g.id} className="px-4 py-2.5">
                      <p className="flex items-baseline justify-between gap-2 text-sm"><span className="text-ink">{ccOf(g.costCenterId)?.code ?? ''} · {g.quarter}º tri</span><span className="tabular-nums font-semibold text-ink">{g.deltaCents > 0 ? '+' : '−'}{fmtBRL(Math.abs(g.deltaCents))}</span></p>
                      <p className="text-xs text-muted">{g.justification} · {g.status}{g.pct !== null ? ` · ${g.pct.toFixed(1).replace('.', ',')}% acumulado` : ''} · {fmtDate(g.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </BudgetShell>
  );
}
