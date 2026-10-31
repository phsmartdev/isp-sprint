/** Traçado de viabilidade técnica em página cheia (mapa largo), aberto a partir da oportunidade. Só Yepnet. */
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Opportunity } from '../lib/types';
import { Breadcrumb, ErrorState, LoadingRows } from '../components/ui/primitives';
import { RouteStudio } from '../features/route/RouteStudio';

export function RouteStudioPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['opportunity', id], queryFn: () => api<Opportunity>(`/opportunities/${id}`) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={8} /></div>;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  return (
    <div className="w-full">
      <Breadcrumb items={[{ label: 'Oportunidades', to: '/opportunities' }, { label: `OP-${o.code} · ${o.contactName}`, to: `/opportunities/${o.id}?aba=tecnica` }, { label: 'Traçado de viabilidade' }]} />
      <h1 className="mb-1 text-xl font-extrabold text-ink">Traçado de viabilidade técnica</h1>
      <p className="mb-4 text-muted">Marque o cliente, trace o caminho a partir da CTO e salve: a imagem com metragem, porta e localização vai para os anexos e para o chamado da engenharia.</p>
      <RouteStudio opp={o} />
    </div>
  );
}
