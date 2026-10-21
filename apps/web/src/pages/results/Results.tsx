/** GESTÃO DE RESULTADOS — perspectivas Diretoria, Gestão e Liderança sobre a mesma base, no escopo de cada um. */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Gauge } from 'lucide-react';
import { TRAFFIC_LABELS, type TrafficColor } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { useUrlState } from '../../lib/hooks';
import { EmptyState, ErrorState, FormField, LoadingRows, Notice, Select, Tabs } from '../../components/ui/primitives';
import { PageHeader } from '../../components/layout/PageHeader';
import { GoalBar, GoalStatusChips, type Goal } from '../performance/Goals';
import { fmtAtt, fmtIndicator } from '../../features/performance/format';

type Scope = { perspectives: { key: 'diretoria' | 'gestao' | 'lideranca'; label: string }[]; all: boolean; roles: { perspective: string; name: string; substitute: boolean }[]; units: { id: string; name: string; kind: string; parentId: string | null }[]; teams: { id: string; name: string; orgUnitId: string | null }[]; people: number; canConfigure: boolean };
type Overview = { perspective: string | null; goals: (Goal & { indicatorName: string | null; teamName: string | null; userName: string | null })[]; colors: Record<TrafficColor, number>; scope: { teams: number; people: number } };

const QUESTIONS: Record<string, string> = {
  diretoria: 'Estamos alcançando os objetivos do negócio?',
  gestao: 'As equipes e os processos estão entregando o resultado esperado?',
  lideranca: 'O que precisamos executar para atingir os resultados?',
};
const COLOR_STYLE: Record<TrafficColor, string> = { verde: 'border-success/40 bg-success-soft/50 text-[#15803D]', amarelo: 'border-warning/40 bg-warning-soft/60 text-[#9A5B00]', vermelho: 'border-danger/40 bg-danger-soft/60 text-danger', sem_dado: 'border-line bg-surface-2 text-muted' };

export function ResultsPage() {
  const [u, setU] = useUrlState({ p: '', unit: '', team: '' });
  const sc = useQuery({ queryKey: ['results', 'scope'], queryFn: () => api<Scope>('/results/scope') });
  const p = u.p || sc.data?.perspectives[0]?.key || '';
  const ov = useQuery({
    queryKey: ['results', 'overview', p, u.unit, u.team],
    enabled: !!sc.data,
    queryFn: () => api<Overview>(`/results/overview${qs({ perspective: p || undefined, unitId: u.unit || undefined, teamId: u.team || undefined })}`),
  });
  if (sc.isLoading) return <LoadingRows rows={6} />;
  if (sc.isError) return <ErrorState error={sc.error} onRetry={() => sc.refetch()} />;
  const s = sc.data!;
  return (
    <div>
      <PageHeader icon={<Gauge />} title="GESTÃO DE RESULTADOS" subtitle="Estratégia, metas, indicadores e execução no escopo de quem responde por eles." />
      {!s.perspectives.length ? (
        <Notice tone="info">Você ainda não responde por uma diretoria, área ou time na estrutura de gestão. Aqui aparecem as suas metas; quem administra define responsáveis em Administração → Gestão de Resultados.</Notice>
      ) : (
        <Tabs label="Perspectiva" value={p as 'diretoria'} onChange={(x) => setU({ p: x, unit: '', team: '' })} tabs={s.perspectives.map((x) => ({ key: x.key, label: x.label }))} className="mb-4" />
      )}
      {p && <p className="mb-4 font-display text-lg font-bold text-ink">{QUESTIONS[p]}</p>}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {s.units.length > 0 && p !== 'lideranca' && <FormField label="Unidade" htmlFor="rs-unit"><Select id="rs-unit" value={u.unit} onChange={(e) => setU({ unit: e.target.value, team: '' })}><option value="">Todo o meu escopo</option>{s.units.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>}
        {s.teams.length > 0 && <FormField label="Time" htmlFor="rs-team"><Select id="rs-team" value={u.team} onChange={(e) => setU({ team: e.target.value })}><option value="">Todos</option>{s.teams.filter((t) => !u.unit || t.orgUnitId === u.unit).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>}
        {!!s.roles.length && <p className="pb-2 text-sm text-muted">Você responde por: {s.roles.map((r) => `${r.name}${r.substitute ? ' (substituto)' : ''}`).join(', ')}</p>}
      </div>
      {ov.isLoading ? <LoadingRows rows={5} /> : ov.isError ? <ErrorState error={ov.error} onRetry={() => ov.refetch()} /> : (
        <>
          <ul className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Semáforo das metas do período">
            {(['verde', 'amarelo', 'vermelho', 'sem_dado'] as TrafficColor[]).map((c) => (
              <li key={c} className={clsx('rounded-lg border p-4', COLOR_STYLE[c])}><p className="text-sm font-semibold">{TRAFFIC_LABELS[c]}</p><p className="num text-2xl font-bold">{ov.data!.colors[c] ?? 0}</p><p className="text-xs opacity-80">meta(s) no período</p></li>
            ))}
          </ul>
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between p-4"><h2 className="text-lg font-bold text-ink">Metas do período</h2><Link to="/desempenho/metas" className="text-sm font-semibold text-primary hover:underline">Objetivos e metas</Link></div>
            {!ov.data!.goals.length ? <div className="border-t border-line"><EmptyState title="Nenhuma meta no período para este escopo" description="Defina metas em Objetivos e metas e elas aparecem aqui com o semáforo." /></div> : (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-surface-2 text-xs text-muted"><tr>{['Meta', 'De quem', 'Indicador', 'Realizado / meta', 'Atingimento', 'Situação'].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {ov.data!.goals.map((g) => (
                      <tr key={g.id} className="border-t border-line">
                        <td className="px-4 py-3"><Link to={`/desempenho/metas?goal=${g.id}`} className="font-semibold text-primary hover:underline">{g.title}</Link></td>
                        <td className="px-4 py-3">{g.scope === 'empresa' ? 'Empresa' : g.scope === 'equipe' ? g.teamName : g.userName}</td>
                        <td className="px-4 py-3 text-xs">{g.indicatorName ?? 'manual'}</td>
                        <td className="num px-4 py-3">{fmtIndicator(g.progress.value, g.progress.unit)} / {fmtIndicator(g.target, g.progress.unit)}</td>
                        <td className="w-44 px-4 py-3"><GoalBar g={g} /><span className="num text-xs text-muted">{fmtAtt(g.progress.attainment)}</span></td>
                        <td className="px-4 py-3"><GoalStatusChips p={g.progress} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
