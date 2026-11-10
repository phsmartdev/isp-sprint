/**
 * Moldura do módulo Pessoas & Cultura: navegação interna (Experiência do Colaborador e, para quem administra,
 * Experiência Administrativa). As seções aparecem conforme cada etapa do módulo é entregue.
 */
import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import { UsersRound } from 'lucide-react';
import { ErrorState, LoadingRows } from '../../components/ui/primitives';
import { PageHeader } from '../../components/layout/PageHeader';
import { usePeopleMe } from './shared';

const link = ({ isActive }: { isActive: boolean }) => clsx('-mb-px whitespace-nowrap border-b-2 px-1 pb-3 pt-1 text-md', isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-ink');

export function PeopleLayout() {
  const q = usePeopleMe();
  const caps = q.data?.caps;
  const adminItems = [...(caps?.configure ? [{ to: '/pessoas/admin/configuracoes', label: 'Configurações' }] : [])];
  return (
    <div className="w-full">
      <PageHeader icon={<UsersRound className="h-9 w-9" strokeWidth={2.2} />} title="Pessoas & Cultura" subtitle="Conecte-se com colegas, compartilhe conhecimento e acompanhe a vida na empresa." />
      <nav aria-label="Seções de Pessoas & Cultura" className="scroll-thin mb-5 flex items-end gap-5 overflow-x-auto border-b border-line">
        <span className="whitespace-nowrap pb-3 text-xs font-semibold uppercase tracking-wide text-muted">Experiência</span>
        <NavLink to="/pessoas" end className={link}>Meu Espaço</NavLink>
        <NavLink to="/pessoas/comunidades" className={link}>Comunidades</NavLink>
        <NavLink to="/pessoas/perfil/eu" className={link}>Meu Perfil</NavLink>
        {adminItems.length > 0 && <>
          <span className="whitespace-nowrap pb-3 pl-3 text-xs font-semibold uppercase tracking-wide text-muted">Administração</span>
          {adminItems.map((i) => <NavLink key={i.to} to={i.to} className={link}>{i.label}</NavLink>)}
        </>}
      </nav>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <Suspense fallback={<div className="card"><LoadingRows rows={6} /></div>}><Outlet /></Suspense>
      )}
    </div>
  );
}
