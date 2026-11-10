/** Lista do feed com ordenação, carregamento por páginas, esqueleto, vazio e erro. */
import { useState } from 'react';
import clsx from 'clsx';
import { Button, EmptyState, ErrorState } from '../../../components/ui/primitives';
import { useFeed, type FeedFilter } from './api';
import { PostCard } from './PostCard';

function Skeleton() {
  return (
    <div className="card animate-pulse p-4" aria-hidden>
      <div className="flex items-center gap-3"><div className="h-11 w-11 rounded-circle bg-surface-2" /><div className="flex-1 space-y-2"><div className="h-3 w-1/3 bg-surface-2" /><div className="h-3 w-1/4 bg-surface-2" /></div></div>
      <div className="mt-4 space-y-2"><div className="h-3 w-full bg-surface-2" /><div className="h-3 w-5/6 bg-surface-2" /><div className="h-40 w-full bg-surface-2" /></div>
    </div>
  );
}

export function Feed({ filter, title, emptyTitle, emptyText, orderable = true }: { filter?: FeedFilter; title?: string; emptyTitle: string; emptyText: string; orderable?: boolean }) {
  const [ordem, setOrdem] = useState<'recentes' | 'relevantes'>('recentes');
  const q = useFeed({ ...filter, ordem: orderable ? ordem : filter?.ordem });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="space-y-3" aria-label={title ?? 'Feed'}>
      {(title || orderable) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-md font-bold text-ink">{title}</h2>}
          {orderable && (
            <div role="radiogroup" aria-label="Ordenar o feed" className="ml-auto flex border border-line bg-surface text-sm">
              {(['recentes', 'relevantes'] as const).map((o) => (
                <button key={o} type="button" role="radio" aria-checked={ordem === o} onClick={() => setOrdem(o)} className={clsx('px-3 py-1.5', ordem === o ? 'bg-primary text-white' : 'text-text hover:bg-surface-2')}>{o === 'recentes' ? 'Mais recentes' : 'Relevantes'}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {orderable && ordem === 'relevantes' && <p className="text-xs text-muted">Relevantes: publicações com mais reações e comentários recentes aparecem primeiro. Nada sobre você ou seu desempenho é usado.</p>}
      {q.isLoading ? <><Skeleton /><Skeleton /></> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !items.length ? (
        <div className="card"><EmptyState title={emptyTitle} description={emptyText} /></div>
      ) : (
        <>
          {items.map((p) => <PostCard key={p.id} post={p} />)}
          {q.hasNextPage ? <div className="flex justify-center"><Button loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Carregar mais</Button></div>
            : <p className="py-2 text-center text-xs text-muted">Você chegou ao fim.</p>}
        </>
      )}
    </section>
  );
}
