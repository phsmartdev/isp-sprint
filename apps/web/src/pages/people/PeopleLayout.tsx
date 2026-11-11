/**
 * Moldura do módulo Pessoas & Cultura no formato do Instagram web: menu lateral do próprio módulo (Feed, Mensagens,
 * Meu Espaço, Comunidades, Reconhecimento, Notificações e, para quem administra, Administração) e o conteúdo ao lado.
 * No celular, o menu vira a barra de ícones embaixo, como no aplicativo.
 */
import { Suspense } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Award, Heart, Home, LayoutGrid, Send, Shield, UsersRound } from 'lucide-react';
import { api } from '../../lib/api';
import { ErrorState, LoadingRows } from '../../components/ui/primitives';
import { PageHeader } from '../../components/layout/PageHeader';
import { usePeopleMe } from './shared';

export const usePeopleCounters = () => useQuery({ queryKey: ['pessoas', 'contadores'], queryFn: () => api<{ messages: number; notifications: number }>('/pessoas/contadores'), refetchInterval: 30_000 });

const Badge = ({ n }: { n: number }) => (n > 0 ? <span className="num absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-[#FF3040] px-1 text-center text-2xs font-bold leading-[18px] text-white">{n > 9 ? '9+' : n}</span> : null);

export function usePeopleAdminItems() {
  const q = usePeopleMe();
  const caps = q.data?.caps;
  return [
    ...(caps?.administer || caps?.communicate || caps?.moderate ? [{ to: '/pessoas/admin/painel', label: 'Painel' }] : []),
    ...(caps?.moderate || q.data?.communityModerator ? [{ to: '/pessoas/admin/moderacao', label: 'Moderação' }] : []),
    ...(caps?.communicate ? [{ to: '/pessoas/admin/comunicados', label: 'Comunicados Oficiais' }] : []),
    ...(caps?.administer ? [{ to: '/pessoas/admin/reconhecimentos', label: 'Reconhecimentos' }] : []),
    ...(caps?.configure ? [{ to: '/pessoas/admin/configuracoes', label: 'Configurações' }] : []),
  ];
}

export function PeopleLayout() {
  const q = usePeopleMe();
  const counters = usePeopleCounters();
  const admin = usePeopleAdminItems();
  const loc = useLocation();
  const items = [
    { to: '/pessoas', end: true, label: 'Feed', icon: Home, active: loc.pathname === '/pessoas' || loc.pathname.startsWith('/pessoas/publicacao') },
    { to: '/pessoas/mensagens', label: 'Mensagens', icon: Send, badge: counters.data?.messages ?? 0 },
    { to: '/pessoas/meu-espaco', label: 'Meu Espaço', icon: LayoutGrid },
    { to: '/pessoas/comunidades', label: 'Comunidades', icon: UsersRound },
    { to: '/pessoas/reconhecimento', label: 'Reconhecimento', icon: Award },
    { to: '/pessoas/notificacoes', label: 'Notificações', icon: Heart, badge: counters.data?.notifications ?? 0 },
  ];
  const link = (active: boolean) => clsx('group flex items-center gap-4 rounded-lg p-3 text-[15px] transition-colors hover:bg-surface-2', active ? 'font-bold text-ink' : 'text-ink');
  return (
    <div className="w-full">
    <PageHeader icon={<UsersRound className="h-9 w-9" strokeWidth={2.2} />} title="Pessoas & Cultura" subtitle="Conecte-se com colegas, compartilhe conhecimento e acompanhe a vida na empresa." />
    <div className="w-full pb-20 md:grid md:grid-cols-[64px_minmax(0,1fr)] md:gap-6 md:pb-0 xl:grid-cols-[208px_minmax(0,1fr)]">
      <nav aria-label="Seções de Pessoas & Cultura" className="sticky top-[88px] hidden max-h-[calc(100vh-104px)] flex-col self-start md:flex">
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.to}>
              <NavLink to={i.to} end={i.end} title={i.label} className={({ isActive }) => link(i.active ?? isActive)}>
                {({ isActive }) => (<>
                  <span className="relative"><i.icon className="h-6 w-6" strokeWidth={(i.active ?? isActive) ? 2.6 : 1.8} aria-hidden /><Badge n={i.badge ?? 0} /></span>
                  <span className="hidden xl:inline">{i.label}</span>
                </>)}
              </NavLink>
            </li>
          ))}
        </ul>
        {admin.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <NavLink to={admin[0]!.to} title="Administração" className={() => link(loc.pathname.startsWith('/pessoas/admin'))}>
              <Shield className="h-6 w-6" strokeWidth={loc.pathname.startsWith('/pessoas/admin') ? 2.6 : 1.8} aria-hidden /><span className="hidden xl:inline">Administração</span>
            </NavLink>
          </div>
        )}
      </nav>
      <div className="min-w-0">
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <Suspense fallback={<div className="card"><LoadingRows rows={6} /></div>}><Outlet /></Suspense>
        )}
      </div>
      {/* celular: barra de ícones embaixo, como no aplicativo */}
      <nav aria-label="Seções de Pessoas & Cultura (celular)" className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t border-line bg-surface md:hidden">
        {items.filter((i) => i.to !== '/pessoas/notificacoes').map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} aria-label={i.label} className="relative flex h-full flex-1 items-center justify-center text-ink">
            {({ isActive }) => <span className="relative"><i.icon className="h-6 w-6" strokeWidth={(i.active ?? isActive) ? 2.6 : 1.8} aria-hidden /><Badge n={i.badge ?? 0} /></span>}
          </NavLink>
        ))}
      </nav>
    </div>
    </div>
  );
}

/** Administração do módulo: tudo num lugar só, com abas por papel. */
export function PeopleAdminLayout() {
  const items = usePeopleAdminItems();
  const me = usePeopleMe();
  const loc = useLocation();
  if (me.isLoading) return <div className="card"><LoadingRows rows={4} /></div>;
  if (!items.length) return <Navigate to="/pessoas" replace />;
  if (loc.pathname.replace(/\/$/, '') === '/pessoas/admin') return <Navigate to={items[0]!.to} replace />;
  return (
    <div>
      <h1 className="mb-3 flex items-center gap-2 font-display text-2xl font-bold text-ink"><Shield className="h-6 w-6" aria-hidden />Administração</h1>
      <nav aria-label="Administração de Pessoas & Cultura" className="scroll-thin mb-5 flex gap-5 overflow-x-auto border-b border-line">
        {items.map((i) => <NavLink key={i.to} to={i.to} className={({ isActive }) => clsx('-mb-px whitespace-nowrap border-b-2 px-1 pb-3 pt-1 text-md', isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-ink')}>{i.label}</NavLink>)}
      </nav>
      <Outlet />
    </div>
  );
}
