/**
 * Meus pontos: qualquer pessoa vê a própria nota (mês e ano) e de onde veio cada ponto. Nunca mostra colegas, posição ou ranking.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { BUSINESS_EVENT_TYPES } from '@isp/domain';
import { api } from '../lib/api';
import { EmptyState, ErrorState, Input, LoadingRows, Notice } from '../components/ui/primitives';
import { PageHeader } from '../components/layout/PageHeader';
import { BkGoldMedal, fmtPts, type MemberScore, type Role } from '../features/gamification/Gamification';

type Data = {
  pending: boolean; participates?: boolean; month: string; year: number; settingsVersion?: number;
  weights?: Record<Role, { ownBp: number; teamBp: number }>; participationMultiplierBp?: number;
  monthScore?: MemberScore | null; yearScore?: MemberScore | null; level?: string | null; gold?: boolean;
  myTeams?: { name: string; average: number }[];
  items?: { source: 'tarefa' | 'ganho'; journey: string; opportunityId: string; code: number | null; contact: string | null; points: number }[];
  events?: { type: string; kind: 'direto' | 'participacao'; points: number }[];
};
const eventLabel = (k: string) => BUSINESS_EVENT_TYPES.find((t) => t.key === k)?.label ?? k;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Score({ title, m }: { title: string; m: MemberScore | null | undefined }) {
  const rows: [string, number][] = m ? [['Tarefas da jornada', m.tasks], ['Negócios ganhos (minha parte)', m.wins], ['Eventos próprios', m.direct], ['Ajudando colegas', m.participation], ['Média do time', m.teamAverage]] : [];
  return (
    <section aria-label={title} className="card p-4">
      <h2 className="text-sm font-bold text-ink">{title}</h2>
      <p className="font-display text-3xl font-extrabold text-ink"><span className="num">{fmtPts(m?.score ?? 0)}</span> <span className="text-base font-semibold text-muted">pts</span></p>
      {m ? <dl className="mt-2 text-sm">{rows.map(([l, v]) => <div key={l} className="flex justify-between border-b border-line py-1"><dt className="text-muted">{l}</dt><dd className="num font-semibold">{fmtPts(v)}</dd></div>)}</dl> : <p className="mt-2 text-sm text-muted">Sem pontos no período.</p>}
    </section>
  );
}

export function MyPointsPage() {
  const [month, setMonth] = useState('');
  const q = useQuery({ queryKey: ['meus-pontos', month], queryFn: () => api<Data>(`/me/pontos${month ? `?month=${month}` : ''}`) });
  if (q.isLoading) return <LoadingRows rows={5} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const monthName = cap(new Date(`${d.month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const header = <PageHeader icon={<Star />} title="Meus pontos" subtitle="A sua nota e de onde veio cada ponto. Só você vê esta tela: não há ranking nem comparação com colegas." actions={!d.pending ? <Input aria-label="Mês" type="month" className="h-10 w-[170px]" value={month || d.month} onChange={(e) => setMonth(e.target.value)} /> : undefined} />;
  if (d.pending) return <div>{header}<Notice tone="info">A regra de pontuação ainda está aguardando aprovação. Assim que for aprovada, seus pontos aparecem aqui.</Notice></div>;
  const items = d.items ?? [];
  const events = d.events ?? [];
  const weights = d.weights;
  return (
    <div>
      {header}
      {!d.participates && <div className="mb-4"><Notice tone="info">Você não está num time que participa da gamificação. Os pontos aparecem quando a regra incluir o seu time.</Notice></div>}
      {d.gold && (
        <section aria-label="Selo BK de Qualidade" className="selo-card mb-4 flex items-center gap-4 border border-[#D4A62A] bg-gradient-to-r from-[#FFF8E1] to-surface p-4">
          <BkGoldMedal size={52} year={d.year} />
          <p className="font-display text-lg font-bold text-ink">Medalha de ouro · Selo BK de Qualidade {d.year}<span className="block font-sans text-sm font-normal text-muted">Maior nota do ano.</span></p>
        </section>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Score title={monthName} m={d.monthScore} />
        <Score title={`Ano ${d.year}${d.level ? ` · nível ${d.level}` : ''}`} m={d.yearScore} />
      </div>

      <section aria-label="De onde vieram os pontos" className="card mt-4 p-4">
        <h2 className="mb-2 text-lg font-bold text-ink">De onde vieram os pontos em {monthName.toLowerCase()}</h2>
        {!items.length && !events.length ? <EmptyState title="Nenhum ponto no mês" description="Conclua as tarefas da jornada nas oportunidades: cada uma vale pontos para quem conclui." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-muted"><tr>{['Origem', 'Jornada ou evento', 'Oportunidade', 'Pontos'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {items.map((i, k) => (
                  <tr key={`i${k}`} className="border-t border-line">
                    <td className="px-2 py-1.5">{i.source === 'tarefa' ? 'Tarefa da jornada' : 'Negócio ganho (minha parte)'}</td>
                    <td className="px-2 py-1.5">{i.journey}</td>
                    <td className="px-2 py-1.5"><Link className="font-semibold text-primary hover:underline" to={`/opportunities/${i.opportunityId}?aba=tarefas`}>{i.code != null ? `OP-${i.code}` : 'Oportunidade'}</Link>{i.contact && <span className="text-muted"> · {i.contact}</span>}</td>
                    <td className="num px-2 py-1.5 font-bold">+{fmtPts(i.points)}</td>
                  </tr>
                ))}
                {events.map((e, k) => (
                  <tr key={`e${k}`} className="border-t border-line">
                    <td className="px-2 py-1.5">{e.kind === 'participacao' ? 'Ajuda a colega' : 'Evento'}</td>
                    <td className="px-2 py-1.5">{eventLabel(e.type)}</td>
                    <td className="px-2 py-1.5 text-muted">—</td>
                    <td className="num px-2 py-1.5 font-bold">+{fmtPts(e.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Como a minha nota é calculada" className="card mt-4 p-4 text-sm text-muted">
        <h2 className="mb-1 font-display text-lg font-bold text-ink">Como a minha nota é calculada</h2>
        <p>Cada tarefa da jornada concluída vale pontos para quem conclui; excluir ou reabrir tira os pontos. No negócio ganho, o peso do ganho é dividido entre quem trabalhou nas tarefas daquela oportunidade.</p>
        {weights && d.monthScore && <p className="mt-1">Sua nota soma {(d.monthScore.role === 'lideranca' ? weights.lideranca : weights.colaborador).ownBp / 100}% dos seus pontos e {(d.monthScore.role === 'lideranca' ? weights.lideranca : weights.colaborador).teamBp / 100}% da média do time: quando o time sobe, todo mundo sobe.</p>}
        {d.participationMultiplierBp && <p className="mt-1">Ajudar na venda de um colega vale {fmtPts(d.participationMultiplierBp / 10_000)}× o crédito.</p>}
        {!!d.myTeams?.length && <p className="mt-1">Média dos meus times no mês: {d.myTeams.map((t) => `${t.name} ${fmtPts(t.average)}`).join(' · ')}.</p>}
      </section>
    </div>
  );
}
