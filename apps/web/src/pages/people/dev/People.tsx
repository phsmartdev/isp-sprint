/** Fichas: a própria, a dos liderados diretos e (RH) a de todos com o módulo. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, qs } from '../../../lib/api';
import { useDebounced } from '../../../lib/hooks';
import { Avatar, Chip, EmptyState, ErrorState, Input, LoadingRows } from '../../../components/ui/primitives';
import { orgLine, type PersonCard } from '../shared';

type Row = PersonCard & { relation: 'eu' | 'liderado' | 'rh' };

export function DevPeoplePage() {
  const [term, setTerm] = useState('');
  const dq = useDebounced(term.trim(), 250);
  const q = useQuery({ queryKey: ['pessoas', 'dev', 'pessoas', dq], queryFn: () => api<{ items: Row[]; hr: boolean }>(`/pessoas/desenvolvimento/pessoas${qs({ q: dq || undefined })}`), placeholderData: (p) => p });
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div><h1 className="font-display text-2xl font-bold text-ink">Colaboradores</h1><p className="text-sm text-muted">{q.data?.hr ? 'Como RH, você abre a ficha de todos que usam o módulo.' : 'A sua ficha e a dos seus liderados diretos.'} Conteúdo de feedback nunca aparece na ficha, só os números.</p></div>
      <div className="relative max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden /><Input aria-label="Buscar colaborador" className="pl-9" placeholder="Nome ou cargo" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
      {q.isLoading ? <div className="card"><LoadingRows rows={5} /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? <div className="card"><EmptyState title="Ninguém encontrado" /></div> : (
        <ul className="grid gap-2 sm:grid-cols-2">{q.data!.items.map((p) => (
          <li key={p.id}><Link to={`/pessoas/desenvolvimento/pessoas/${p.id}`} className="card flex items-center gap-3 p-3 hover:border-primary">
            <Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={48} />
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink">{p.name}</span><span className="block truncate text-xs text-muted">{orgLine(p) || 'Colaborador'}</span></span>
            {p.relation === 'eu' ? <Chip tone="blue">Minha ficha</Chip> : p.relation === 'liderado' ? <Chip>Liderado</Chip> : null}
          </Link></li>
        ))}</ul>
      )}
    </div>
  );
}
