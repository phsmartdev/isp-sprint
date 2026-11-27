/**
 * Indicadores do departamento, dentro do próprio quadro (sem módulo novo). Esforço é sempre o estimado/comprometido:
 * a tela diz isso e só mostra horas realizadas onde há apontamento. Sem ranking de produtividade por pessoa.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CAPACITY_CATEGORIES, CAPACITY_CATEGORY_LABELS, fmtMinutes, type BoardKey, type CapacityCategory } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/overlay';
import { Button } from '../../components/ui/primitives';

const h = (m: number | null | undefined) => (m == null ? '—' : fmtMinutes(m) || '0h');
const p = (v: number | null | undefined) => (v == null ? '—' : `${String(v).replace('.', ',')}%`);
const CAT_BAR: Record<CapacityCategory, string> = { comercial: 'bg-primary', interno: 'bg-[#0F766E]', hipotese: 'bg-[#B45309]' };
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
type Cat = Record<CapacityCategory, number>;
type Data = {
  period: { from: string; to: string }; basis: string;
  compliance: { original: { minutes: number; deliveredMinutes: number; pct: number | null }; revised: { minutes: number; deliveredMinutes: number; pct: number | null } };
  distribution: { planned: Cat; executed: Cat; policy: Cat | null };
  unplanned: { minutes: number; pct: number | null }; displaced: Cat;
  furaFilas: { included: number; requests: number; rejected: number; origins: { origin: string; n: number }[]; layers: { livre: number; hipotese: number; interno: number; comercial: number } };
  replanned: number;
  commercialUnplanned: { tasks: number; estimateMinutes: number; withoutEstimate: number; opportunities: number; valueCents: number };
  criticalLate: { id: string; title: string; ownerName: string | null; dueDay: string | null; link: string | null }[];
  blocked: { count: number; items: { id: string; title: string; ownerName: string | null; waitingOn: string | null; days: number | null }[] };
  capacity: { userId: string; name: string; availableMinutes: number | null; committedMinutes: number; remainingMinutes: number; overload: boolean }[];
  flow: { done: number; leadTimeDays: number | null; cycleTimeDays: number | null; estimateVsActual: { tasks: number; estimateMinutes: number; actualMinutes: number } | null };
  history: { weekStart: string; status: string; originalPct: number | null; revisedPct: number | null; originalMinutes: number; revisedMinutes: number; unplannedMinutes: number; furaFilas: number; displacedComercial: number; plannedDeviationPp: number | null }[];
};

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'danger' | 'warn' }) {
  return (
    <div className={clsx('border p-3', tone === 'danger' ? 'border-danger/50 bg-danger-soft' : tone === 'warn' ? 'border-[#B45309]/40 bg-[#FFF7E6]' : 'border-line bg-surface')}>
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={clsx('num mt-0.5 text-2xl font-bold', tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Bars({ d, policy }: { d: Cat; policy: Cat | null }) {
  const total = CAPACITY_CATEGORIES.reduce((t, c) => t + d[c], 0);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden bg-surface-2" aria-hidden>{total ? CAPACITY_CATEGORIES.map((c) => <div key={c} className={CAT_BAR[c]} style={{ width: `${(d[c] / total) * 100}%` }} />) : null}</div>
      <ul className="mt-1 flex flex-wrap gap-x-3 text-xs">{CAPACITY_CATEGORIES.map((c) => <li key={c}><span className={clsx('mr-1 inline-block h-2 w-2', CAT_BAR[c])} />{CAPACITY_CATEGORY_LABELS[c]} <b className="num">{total ? Math.round((d[c] / total) * 100) : 0}%</b>{policy ? <span className="text-muted"> / meta {policy[c] / 100}%</span> : null}</li>)}</ul>
    </div>
  );
}

export function IndicatorsModal({ board, week, people, onClose }: { board: BoardKey; week: string; people: { id: string; name: string }[]; onClose: () => void }) {
  const [f, setF] = useState({ from: addDays(week, -49), to: week, ownerId: '' });
  const q = useQuery({ queryKey: ['quadro', board, 'indicadores', f], queryFn: () => api<Data>(`/quadros/${board}/indicadores${qs({ from: f.from, to: f.to, ownerId: f.ownerId || undefined })}`) });
  const d = q.data;
  return (
    <Modal open onClose={onClose} size="xl" title="Indicadores do departamento" footer={<Button variant="ghost" onClick={onClose}>Fechar</Button>}>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <FormField label="Semanas a partir de" htmlFor="ind-from"><Input id="ind-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></FormField>
        <FormField label="Até a semana de" htmlFor="ind-to"><Input id="ind-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></FormField>
        <FormField label="Responsável" htmlFor="ind-owner"><Select id="ind-owner" className="w-56" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}><option value="">Todo o departamento</option>{people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
      </div>
      {q.isLoading ? <LoadingRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : d && (
        <div className="space-y-4">
          <p className="text-xs text-muted">Sprints de {fmtDate(d.period.from)} a {fmtDate(d.period.to)}. Valores em {d.basis}.</p>
          <section aria-label="Cumprimento do planejamento" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Cumprimento do plano original" value={p(d.compliance.original.pct)} hint={`${h(d.compliance.original.deliveredMinutes)} de ${h(d.compliance.original.minutes)}; replanejadas continuam na base`} tone={d.compliance.original.pct != null && d.compliance.original.pct < 70 ? 'warn' : undefined} />
            <Kpi label="Cumprimento do plano revisado" value={p(d.compliance.revised.pct)} hint={`${h(d.compliance.revised.deliveredMinutes)} de ${h(d.compliance.revised.minutes)}`} />
            <Kpi label="Trabalho não planejado" value={p(d.unplanned.pct)} hint={`${h(d.unplanned.minutes)} em fura-filas`} />
            <Kpi label="Capacidade comercial deslocada" value={h(d.displaced.comercial)} hint={`Internas ${h(d.displaced.interno)} · hipóteses ${h(d.displaced.hipotese)}`} tone={d.displaced.comercial ? 'danger' : undefined} />
          </section>
          <section aria-label="Aderência ao 70/20/10" className="grid gap-4 border border-line p-3 sm:grid-cols-2">
            <div><p className="mb-1 text-sm font-bold text-ink">Planejado</p><Bars d={d.distribution.planned} policy={d.distribution.policy} /></div>
            <div><p className="mb-1 text-sm font-bold text-ink">Executado (entregue na Sprint)</p><Bars d={d.distribution.executed} policy={d.distribution.policy} /></div>
          </section>
          <section aria-label="Fura-filas e comercial fora do plano" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Fura-filas incluídos" value={String(d.furaFilas.included)} hint={`${d.furaFilas.requests} pedidos · ${d.furaFilas.rejected} rejeitados · ${d.replanned} replanejadas`} />
            <Kpi label="Consumo das camadas" value={`${d.furaFilas.layers.hipotese} · ${d.furaFilas.layers.interno} · ${d.furaFilas.layers.comercial}`} hint={`Vezes que 10% · 20% · 70% foram usados; capacidade livre: ${d.furaFilas.layers.livre}`} tone={d.furaFilas.layers.comercial ? 'warn' : undefined} />
            <Kpi label="Comerciais fora do plano" value={String(d.commercialUnplanned.tasks)} hint={`${h(d.commercialUnplanned.estimateMinutes)} estimadas${d.commercialUnplanned.withoutEstimate ? ` (${d.commercialUnplanned.withoutEstimate} sem estimativa)` : ''} · ${d.commercialUnplanned.opportunities} oportunidade(s), ${fmtBRL(d.commercialUnplanned.valueCents)}`} tone={d.commercialUnplanned.tasks ? 'warn' : undefined} />
            <Kpi label="Fluxo" value={d.flow.leadTimeDays == null ? '—' : `${String(d.flow.leadTimeDays).replace('.', ',')} d`} hint={`Lead time de ${d.flow.done} concluída(s); cycle time ${d.flow.cycleTimeDays == null ? '—' : `${String(d.flow.cycleTimeDays).replace('.', ',')} d`}${d.flow.estimateVsActual ? ` · estimado ${h(d.flow.estimateVsActual.estimateMinutes)} × apontado ${h(d.flow.estimateVsActual.actualMinutes)} em ${d.flow.estimateVsActual.tasks}` : ' · sem apontamento de horas'}`} />
          </section>
          {!!d.furaFilas.origins.length && <p className="text-xs text-muted">Origem dos fura-filas: {d.furaFilas.origins.map((o) => `${o.origin} (${o.n})`).join(' · ')}</p>}
          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-label="Atividades críticas em atraso" className="border border-line">
              <h3 className="border-b border-line px-3 py-2 text-sm font-bold text-ink">Críticas em atraso <span className="font-normal text-muted">(ligadas a oportunidade, cliente, contrato ou projeto)</span></h3>
              {!d.criticalLate.length ? <p className="px-3 py-2 text-sm text-muted">Nenhuma.</p> : <ul className="max-h-60 divide-y divide-line overflow-y-auto text-sm">{d.criticalLate.map((x) => <li key={x.id} className="px-3 py-1.5"><span className="font-semibold text-ink">{x.title}</span><span className="block text-xs text-muted">{x.link ?? '—'} · {x.ownerName ?? '—'} · venceu {x.dueDay ? fmtDate(x.dueDay) : '—'}</span></li>)}</ul>}
            </section>
            <section aria-label="Atividades bloqueadas" className="border border-line">
              <h3 className="border-b border-line px-3 py-2 text-sm font-bold text-ink">Bloqueadas <span className="num font-normal text-muted">{d.blocked.count}</span></h3>
              {!d.blocked.items.length ? <p className="px-3 py-2 text-sm text-muted">Nenhuma.</p> : <ul className="max-h-60 divide-y divide-line overflow-y-auto text-sm">{d.blocked.items.map((x) => <li key={x.id} className="px-3 py-1.5"><span className="font-semibold text-ink">{x.title}</span><span className="block text-xs text-muted">{x.ownerName ?? '—'}{x.waitingOn ? ` · aguardando ${x.waitingOn}` : ''}{x.days != null ? ` · há ${x.days} dia(s)` : ''}</span></li>)}</ul>}
            </section>
          </div>
          <section aria-label="Capacidade por colaborador" className="border border-line">
            <h3 className="border-b border-line px-3 py-2 text-sm font-bold text-ink">Capacidade por colaborador nesta semana</h3>
            <table className="w-full text-sm"><thead className="bg-surface-2 text-left text-xs text-muted"><tr><th className="px-3 py-1 font-semibold">Pessoa</th><th className="px-3 py-1 font-semibold">Disponível</th><th className="px-3 py-1 font-semibold">Comprometido</th><th className="px-3 py-1 font-semibold">Restante</th></tr></thead>
              <tbody>{d.capacity.map((c) => <tr key={c.userId} className="border-t border-line"><td className="px-3 py-1">{c.name}</td><td className="num px-3 py-1">{c.availableMinutes == null ? 'sem jornada' : h(c.availableMinutes)}</td><td className={clsx('num px-3 py-1', c.overload && 'font-bold text-danger')}>{h(c.committedMinutes)}</td><td className="num px-3 py-1">{h(c.remainingMinutes)}</td></tr>)}</tbody>
            </table>
          </section>
          <section aria-label="Evolução das Sprints" className="border border-line">
            <h3 className="border-b border-line px-3 py-2 text-sm font-bold text-ink">Evolução do planejamento</h3>
            {!d.history.length ? <p className="px-3 py-2 text-sm text-muted">Nenhuma Sprint aberta no período.</p> : (
              <table className="w-full text-sm"><thead className="bg-surface-2 text-left text-xs text-muted"><tr>{['Semana', 'Original', 'Revisado', 'Não planejado', 'Fura-filas', 'Comercial deslocado', 'Desvio 70/20/10'].map((x) => <th key={x} className="px-3 py-1 font-semibold">{x}</th>)}</tr></thead>
                <tbody>{d.history.map((x) => <tr key={x.weekStart} className="border-t border-line"><td className="px-3 py-1">{fmtDate(x.weekStart)}{x.status === 'andamento' ? ' (em andamento)' : ''}</td><td className="num px-3 py-1">{p(x.originalPct)} de {h(x.originalMinutes)}</td><td className="num px-3 py-1">{p(x.revisedPct)} de {h(x.revisedMinutes)}</td><td className="num px-3 py-1">{h(x.unplannedMinutes)}</td><td className="num px-3 py-1">{x.furaFilas}</td><td className={clsx('num px-3 py-1', x.displacedComercial ? 'font-semibold text-danger' : '')}>{h(x.displacedComercial)}</td><td className="num px-3 py-1">{x.plannedDeviationPp == null ? '—' : `${String(x.plannedDeviationPp).replace('.', ',')} p.p.`}</td></tr>)}</tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
