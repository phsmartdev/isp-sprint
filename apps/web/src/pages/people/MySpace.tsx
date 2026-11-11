/**
 * Meu Espaço: a entrada do colaborador no módulo. Simples de propósito: saudação, atalhos e colegas.
 * As próximas etapas encaixam aqui o editor de publicação, os comunicados e o feed (e, mais à frente,
 * cards de onboarding, aprendizagem, desenvolvimento e clima) sem mudar a estrutura da página.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Award, Bookmark, ChevronRight, Search, Sparkles, UserRound, UsersRound } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { Avatar, EmptyState, ErrorState, Input, LoadingRows } from '../../components/ui/primitives';
import { Hexagons } from '../../components/brand';
import { orgLine, usePeopleMe, type PersonCard } from './shared';
import { PostEditor } from './feed/PostEditor';
import { Feed } from './feed/Feed';
import { AnnouncementsBlock } from './Announcements';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };

export function MySpacePage() {
  const q = usePeopleMe();
  if (q.isLoading) return <div className="card"><LoadingRows rows={5} /></div>;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { me, profileComplete } = q.data;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <section className="relative overflow-hidden rounded-lg bg-gradient-to-br from-navy to-primary p-6 text-white sm:p-8" aria-label="Boas-vindas">
          <Hexagons className="pointer-events-none absolute inset-y-0 right-0 h-full w-[55%] opacity-80" />
          <div className="relative flex flex-wrap items-center gap-4 sm:gap-5">
            <Avatar name={me.name} userId={me.id} hasPhoto={me.hasPhoto} size={72} className="ring-4 ring-white/25" />
            <div className="min-w-0">
              <h2 className="font-display text-2xl font-bold tracking-wide sm:text-[28px]">{greeting()}, {me.firstName}!</h2>
              {orgLine(me) && <p className="mt-1 text-sm text-white/85">{orgLine(me)}</p>}
            </div>
          </div>
          <div className="relative mt-5 flex flex-wrap gap-2">
            <Link to="/pessoas/perfil/eu" className="inline-flex h-10 items-center gap-2 bg-white px-4 text-sm font-bold text-primary hover:bg-primary-soft"><UserRound className="h-4 w-4" aria-hidden />Meu perfil</Link>
            <Link to="/pessoas/reconhecimento" className="inline-flex h-10 items-center gap-2 border border-white/60 px-4 text-sm font-bold text-white hover:bg-white/10"><Award className="h-4 w-4" aria-hidden />Reconhecer colega</Link>
          </div>
        </section>

        {!profileComplete && (
          <section className="card flex flex-wrap items-center gap-4 border-l-4 border-l-lime p-4" aria-label="Complete seu perfil">
            <Sparkles className="h-6 w-6 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">Conte um pouco sobre você</p>
              <p className="text-sm text-muted">Uma bio curta e seus interesses ajudam os colegas a te encontrar e a se conectar.</p>
            </div>
            <Link to="/pessoas/perfil/eu?editar=1" className="inline-flex h-9 items-center bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-hover">Completar perfil</Link>
          </section>
        )}

        <AnnouncementsBlock />
        <PostEditor compact />
        <Feed emptyTitle="O feed está começando" emptyText="Seja a primeira pessoa a compartilhar uma conquista, uma ideia ou um aprendizado." />
      </div>

      <aside className="space-y-4">
        <section className="card p-4" aria-label="Atalhos">
          <h2 className="mb-2 text-md font-bold text-ink">Atalhos</h2>
          <ul className="divide-y divide-line">
            <li><Link to="/pessoas/perfil/eu" className="flex items-center gap-3 py-2.5 text-sm text-ink hover:text-primary"><UserRound className="h-4 w-4 text-primary" aria-hidden /><span className="flex-1">Meu perfil</span><ChevronRight className="h-4 w-4 text-muted" aria-hidden /></Link></li>
            <li><Link to="/pessoas/comunidades" className="flex items-center gap-3 py-2.5 text-sm text-ink hover:text-primary"><UsersRound className="h-4 w-4 text-primary" aria-hidden /><span className="flex-1">Minhas comunidades</span><ChevronRight className="h-4 w-4 text-muted" aria-hidden /></Link></li>
            <li><Link to="/pessoas/reconhecimento" className="flex items-center gap-3 py-2.5 text-sm text-ink hover:text-primary"><Award className="h-4 w-4 text-primary" aria-hidden /><span className="flex-1">Reconhecer colega</span><ChevronRight className="h-4 w-4 text-muted" aria-hidden /></Link></li>
            <li><Link to="/pessoas/salvos" className="flex items-center gap-3 py-2.5 text-sm text-ink hover:text-primary"><Bookmark className="h-4 w-4 text-primary" aria-hidden /><span className="flex-1">Publicações salvas</span><ChevronRight className="h-4 w-4 text-muted" aria-hidden /></Link></li>
          </ul>
        </section>
        <Colleagues />
      </aside>
    </div>
  );
}

/** Encontrar colegas da empresa e abrir o perfil deles. */
function Colleagues() {
  const [term, setTerm] = useState('');
  const dq = useDebounced(term.trim(), 250);
  const q = useQuery({ queryKey: ['pessoas', 'colaboradores', dq], queryFn: () => api<{ items: PersonCard[] }>(`/pessoas/colaboradores${qs({ q: dq || undefined, limit: 8 })}`), placeholderData: (p) => p });
  return (
    <section className="card p-4 sm:p-5" aria-label="Colegas">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-md font-bold text-ink">Colegas</h2>
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Buscar colegas" className="h-9 pl-9" placeholder="Nome ou cargo" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
      </div>
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.items.length ? (
        <EmptyState title="Ninguém encontrado" description="Tente outro nome ou cargo." />
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {q.data.items.map((p) => (
            <li key={p.id}>
              <Link to={`/pessoas/perfil/${p.id}`} className="flex items-center gap-3 border border-line p-2.5 hover:border-primary hover:bg-surface-2">
                <Avatar name={p.name} userId={p.id} hasPhoto={p.hasPhoto} size={40} />
                <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink">{p.name}</span><span className="block truncate text-xs text-muted">{orgLine(p) || 'Colaborador'}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
