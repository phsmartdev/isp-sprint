/**
 * Quadro do topo da oportunidade: quantos pontos ESTA oportunidade já rendeu para quem está vendo
 * (suas tarefas da jornada, sua parte no ganho, seus eventos e apoios), pela regra aprovada da gamificação.
 */
import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { api } from '../lib/api';

type R = { enabled: false } | { enabled: true; total: number; parts: Partial<Record<'tarefas' | 'extra' | 'ganho' | 'eventos' | 'participacao' | 'apoio', number>> };
const LABEL: Record<string, string> = { tarefas: 'tarefas', extra: 'crédito extra', ganho: 'parte no ganho', eventos: 'eventos', participacao: 'participação', apoio: 'apoio' };
const n1 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export function MyOpportunityPoints({ oppId }: { oppId: string }) {
  const q = useQuery({ queryKey: ['opportunity', oppId, 'my-points'], queryFn: () => api<R>(`/opportunities/${oppId}/my-points`), refetchInterval: 60_000 });
  const d = q.data;
  const parts = d?.enabled ? Object.entries(d.parts).filter(([, v]) => (v ?? 0) > 0) : [];
  return (
    <div className="card flex items-center gap-3 px-4 py-2.5" role="status" aria-label="Seus pontos nesta oportunidade">
      <span className="flex h-9 w-9 items-center justify-center bg-lime text-navy" aria-hidden><Trophy className="h-5 w-5" /></span>
      <div className="leading-tight">
        <p className="num text-lg font-extrabold text-ink" data-testid="my-opp-points">{!d ? '…' : d.enabled ? `${n1(d.total)} pts` : '—'}</p>
        <p className="text-xs text-muted">{!d ? 'Seus pontos nesta oportunidade' : !d.enabled ? 'Gamificação sem regra aprovada' : parts.length ? `Seus pontos aqui: ${parts.map(([k, v]) => `${n1(v!)} ${LABEL[k]}`).join(' · ')}` : 'Seus pontos aqui: conclua tarefas da jornada para pontuar'}</p>
      </div>
    </div>
  );
}
