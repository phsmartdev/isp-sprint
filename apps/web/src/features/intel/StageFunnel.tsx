/** Conversão por etapa e do funil, perda por etapa e tempo em cada etapa (coorte criada no período). */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, qs } from '../../lib/api';
import { LoadingRows, Select } from '../../components/ui/primitives';

type Row = { key: string; name: string; reached: number; advanced: number; lostHere: number; here: number; conversion: number | null; ofTotal: number | null; avgDays: number | null; medianDays: number | null; samples: number };
type Funnel = { pipelines: { id: string; name: string }[]; pipelineId: string; rows: Row[]; total: number; won: number; lost: number; open: number; conversion: number | null; winRate: number | null; avgCycleDays: number | null; medianCycleDays: number | null };

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: x < 0.1 ? 1 : 0 })}%`);
const days = (x: number | null) => (x === null ? '—' : x < 1 ? '< 1 d' : `${Math.round(x).toLocaleString('pt-BR')} d`);
const MIN = 5;

export function StageFunnel({ from, to }: { from: string; to: string }) {
  const [pipelineId, setPipelineId] = useState<string | undefined>();
  const q = useQuery({ queryKey: ['stage-funnel', from, to, pipelineId], queryFn: () => api<Funnel>(`/intelligence/stage-funnel${qs({ from, to, pipelineId })}`) });
  const d = q.data;
  const candidates = d ? d.rows.slice(0, -1).filter((r) => r.reached >= MIN && r.conversion !== null) : [];
  const worst = candidates.length ? candidates.reduce((a, b) => (b.conversion! < a.conversion! ? b : a)) : null;
  return (
    <section className="card p-5" aria-labelledby="h-stage-funnel">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="h-stage-funnel" className="text-lg font-bold text-ink">Conversão e tempo por etapa</h2>
          <p className="text-xs text-muted">Negociações criadas no período e até onde chegaram. Quem pulou uma etapa conta como tendo passado por ela.</p>
        </div>
        {d && d.pipelines.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            Funil
            <Select aria-label="Funil" value={d.pipelineId} onChange={(e) => setPipelineId(e.target.value)} className="h-9 w-auto">
              {d.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </label>
        )}
      </div>
      {!d ? <LoadingRows rows={5} /> : (
        <>
          <dl className="mb-5 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-5" aria-label="Resumo do funil">
            {[
              ['Criadas', d.total.toLocaleString('pt-BR')],
              ['Ganhas', d.won.toLocaleString('pt-BR')],
              ['Conversão do funil', pct(d.conversion)],
              ['Vitória nas fechadas', pct(d.winRate)],
              ['Ciclo das ganhas', d.avgCycleDays === null ? '—' : `${days(d.avgCycleDays)} (mediana ${days(d.medianCycleDays)})`],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface px-4 py-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5 text-lg font-bold tabular-nums text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {!d.total ? <p className="text-sm text-muted">Nenhuma negociação criada neste funil no período.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" aria-label="Conversão por etapa">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-semibold">Etapa</th>
                    <th className="w-[34%] py-2 pr-3 font-semibold">Chegaram</th>
                    <th className="py-2 pr-3 text-right font-semibold">Avançaram</th>
                    <th className="py-2 pr-3 text-right font-semibold">Perdidas aqui</th>
                    <th className="py-2 pr-3 text-right font-semibold">Estão aqui</th>
                    <th className="py-2 text-right font-semibold" title="Tempo nesta etapa, somando todas as passagens (inclusive as concluídas)">Tempo médio · mediana</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r, i) => {
                    const last = i === d.rows.length - 1;
                    return (
                      <tr key={r.key} className="border-b border-line last:border-0" data-worst={worst?.key === r.key || undefined}>
                        <td className="py-2.5 pr-3 font-semibold text-ink">{r.name}</td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2.5 flex-1 bg-primary-soft" aria-hidden><div className="h-full bg-primary" style={{ width: `${(r.ofTotal ?? 0) * 100}%` }} /></div>
                            <span className="w-16 text-right tabular-nums text-ink">{r.reached}</span>
                            <span className="w-10 text-right text-xs tabular-nums text-muted">{pct(r.ofTotal)}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          <span className="text-ink">{r.advanced}</span>{' '}
                          <span className={clsx('text-xs font-semibold', worst?.key === r.key ? 'text-danger' : 'text-primary')} title={last ? 'Conversão desta etapa em venda fechada' : 'Conversão para a etapa seguinte'}>
                            {pct(r.conversion)}{last ? ' em ganha' : ''}
                          </span>
                          {worst?.key === r.key && <span className="ml-1 text-2xs text-danger">maior queda</span>}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-text">{r.lostHere || '—'}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-text">{r.here || '—'}</td>
                        <td className="py-2.5 text-right tabular-nums text-text" title={`${r.samples} negociação(ões) com tempo nesta etapa`}>{days(r.avgDays)} · {days(r.medianDays)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {d.total < 10 && <p className="mt-3 text-xs text-muted">Amostra pequena ({d.total}); use um período maior para comparar etapas.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
