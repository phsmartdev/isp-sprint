import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BarChart3, Bell, Briefcase, FileSignature, ChevronDown, CircleHelp, Home, Lightbulb, LogOut, Megaphone, Menu, Package, Settings, UserRound, X, HeartHandshake, FolderKanban, Gauge, Mail, Wallet } from 'lucide-react';
import type { FeatureKey, Module } from '@isp/domain';
import { useApprovalCount } from '../../pages/Approvals';
import { MentionsMenu } from '../../features/MentionsMenu';
import { useAuth } from '../../auth/AuthProvider';
import { api } from '../../lib/api';
import { useHotkey } from '../../lib/hooks';
import { Avatar } from '../ui/primitives';
import { Modal } from '../ui/overlay';
import { Hexagons, Logo } from '../brand';
import { GlobalSearch } from './GlobalSearch';

type NavLeaf = { to: string; label: string; icon?: ReactNode; module: Module; feature?: FeatureKey; badge?: boolean | 'approvals'; also?: string[] };
type NavGroup = { key: string; label: string; icon: ReactNode; children: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;
const ICON = 'h-[22px] w-[22px] shrink-0';
const isGroup = (n: NavEntry): n is NavGroup => 'children' in n;
/** Menu na ordem combinada com o Paulo (21/10/2026). Grupos abrem e fecham; abrem sozinhos quando a página atual está dentro. */
const NAV: NavEntry[] = [
  { to: '/', label: 'Início', icon: <Home className={ICON} />, module: 'inicio' },
  { key: 'comercial', label: 'Comercial', icon: <Briefcase className={ICON} />, children: [
    { to: '/opportunities', label: 'Oportunidades', module: 'oportunidades' },
    { to: '/customers', label: 'Contas', module: 'clientes', feature: 'crm.contas' },
    { to: '/aprovacoes', label: 'Aprovações', module: 'oportunidades', badge: 'approvals' },
    { to: '/activities', label: 'Atividades', module: 'atividades', feature: 'crm.atividades', badge: true },
  ] },
  { to: '/contracts', label: 'Gestão de Contratos', icon: <FileSignature className={ICON} />, module: 'contratos' },
  { to: '/sucesso', label: 'Sucesso do Cliente', icon: <HeartHandshake className={ICON} />, module: 'clientes', feature: 'crm.sucesso_cliente' },
  { to: '/email', label: 'E-mail', icon: <Mail className={ICON} />, module: 'email', also: ['/email/caixas'] },
  { key: 'marketing', label: 'Marketing', icon: <Megaphone className={ICON} />, children: [
    { to: '/leads', label: 'Leads', module: 'leads' },
    { to: '/abm', label: 'ABM', module: 'clientes', feature: 'marketing.abm' },
    { to: '/campaigns', label: 'Plays/Campanhas', module: 'campanhas' },
  ] },
  { to: '/produto', label: 'Produto', icon: <Package className={ICON} />, module: 'inicio', feature: 'produto.catalogo' },
  { key: 'times', label: 'Gestão de Times', icon: <Gauge className={ICON} />, children: [
    { to: '/times', label: 'Visão geral', module: 'resultados' },
    { to: '/times/intervencoes', label: 'Intervenções', module: 'resultados' },
    { to: '/times/rituais', label: 'Rituais', module: 'resultados' },
    { to: '/times/decisoes', label: 'Decisões e impedimentos', module: 'resultados' },
    { to: '/desempenho/metas', label: 'Objetivos e metas', module: 'desempenho' },
  ] },
  { key: 'projetos', label: 'Projetos', icon: <FolderKanban className={ICON} />, children: [
    { to: '/projetos', label: 'Projetos', module: 'projetos' },
    { to: '/tarefas', label: 'Tarefas', module: 'atividades', feature: 'projetos.tarefas' },
  ] },
  { key: 'orcamento', label: 'Recursos e Orçamento', icon: <Wallet className={ICON} />, children: [
    { to: '/orcamento', label: 'Planejamento orçamentário', module: 'orcamento', feature: 'orcamento.planejamento' },
    { to: '/orcamento/ferramentas', label: 'Ferramentas e equipamentos', module: 'orcamento', feature: 'orcamento.recursos' },
    { to: '/orcamento/softwares', label: 'Softwares e licenças', module: 'orcamento', feature: 'orcamento.recursos' },
    { to: '/orcamento/contratos', label: 'Contratos e assinaturas', module: 'orcamento', feature: 'orcamento.recursos' },
    { to: '/orcamento/compras', label: 'Compras e fornecedores', module: 'orcamento', feature: 'orcamento.recursos' },
    { to: '/orcamento/indicadores', label: 'Custos e indicadores', module: 'orcamento', feature: 'orcamento.planejamento' },
  ] },
  { to: '/reports', label: 'Relatórios', icon: <BarChart3 className={ICON} />, module: 'relatorios', feature: 'relatorios.comercial' },
  { to: '/intelligence', label: 'Inteligência', icon: <Lightbulb className={ICON} />, module: 'inteligencia' },
  { to: '/settings', label: 'Configuração', icon: <Settings className={ICON} />, module: 'configuracoes' },
];

export const SETTINGS_NAV: { to: string; label: string; admin: boolean; group?: string }[] = [
  { to: '/settings/profile', label: 'Meu perfil', admin: false },
  { to: '/settings', label: 'Administração', admin: true },
  // permissões juntas: quem acessa (usuários), o que fica liberado (módulos) e com que nível (segurança)
  { to: '/settings/users', label: 'Usuários', admin: true, group: 'Permissões' },
  { to: '/settings/modulos', label: 'Módulos e liberação', admin: true, group: 'Permissões' },
  { to: '/settings/security', label: 'Segurança', admin: true, group: 'Permissões' },
  { to: '/settings/journeys', label: 'Jornadas e automações', admin: true },
  { to: '/settings/area', label: 'Área de atendimento', admin: true },
  { to: '/settings/viability', label: 'Viabilidade', admin: true },
  { to: '/settings/plans', label: 'Planos e produtos', admin: true },
  { to: '/settings/sources', label: 'Canais de entrada', admin: true },
  { to: '/settings/modelos', label: 'Modelos', admin: true },
  { to: '/settings/gmail', label: 'E-mail corporativo (Gmail)', admin: true },
  { to: '/settings/integrations', label: 'Integrações', admin: true },
  { to: '/settings/fields', label: 'Campos personalizados', admin: true },
  { to: '/settings/filiais', label: 'Filiais da venda', admin: true },
  { to: '/settings/contracts', label: 'Contratos', admin: true },
  { to: '/settings/approvals', label: 'Aprovações e alçadas', admin: true },
  { to: '/settings/customer-success', label: 'Sucesso do Cliente', admin: true },
  { to: '/settings/desempenho', label: 'Gestão de desempenho', admin: true },
  { to: '/settings/resultados', label: 'Gestão de Times', admin: true },
  { to: '/settings/abm', label: 'ABM', admin: true },
  { to: '/settings/data', label: 'Base de dados', admin: true },
  { to: '/settings/branding', label: 'Personalização', admin: true },
  { to: '/settings/logs', label: 'Logs do sistema', admin: true },
];

function useOpenActivities() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['activities', 'counts'],
    enabled: can('atividades'),
    queryFn: () => api<{ counts: { overdue: number; today: number; open: number } }>('/activities?status=hoje&pageSize=1'),
    refetchInterval: 60_000,
  });
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, feature } = useAuth();
  const show = (n: NavLeaf) => can(n.module) && (!n.feature || feature(n.feature));
  const loc = useLocation();
  const counts = useOpenActivities().data?.counts;
  const badge = counts ? counts.today + counts.overdue : 0;
  const approvals = useApprovalCount().data?.toDecide ?? 0;
  const inSettings = loc.pathname.startsWith('/settings');
  // grupos abertos/fechados lembrados neste navegador (conveniência; sem armazenamento, segue a página atual)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('isp:nav-groups') ?? '{}') as Record<string, boolean>; } catch { return {}; } });
  const toggle = (k: string, v: boolean) => setOpenGroups((g) => { const n = { ...g, [k]: v }; try { localStorage.setItem('isp:nav-groups', JSON.stringify(n)); } catch { /* sem armazenamento */ } return n; });
  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-navy to-navy-2 text-white">
      <Link to="/" onClick={onNavigate} className="flex h-[84px] items-center gap-3 px-7" aria-label="RevOps — início">
        <Logo />
        <span className="border-l border-white/25 pl-3 font-display text-sm font-semibold text-white/70">RevOps</span>
      </Link>
      <nav aria-label="Navegação principal" className="scroll-thin flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-1">
          {NAV.map((n) => {
            if (isGroup(n)) {
              const kids = n.children.filter((c) => show(c));
              if (!kids.length) return null;
              const active = kids.some((c) => loc.pathname === c.to || loc.pathname.startsWith(`${c.to}/`));
              const open = openGroups[n.key] ?? active;
              const total = kids.reduce((a, c) => a + (c.badge === true ? badge : c.badge === 'approvals' ? approvals : 0), 0);
              return (
                <li key={n.key}>
                  <button type="button" aria-expanded={open} onClick={() => toggle(n.key, !open)} className={clsx('relative flex h-12 w-full items-center gap-3.5 rounded-md px-4 text-left text-md transition-colors', active && !open ? 'bg-navy-active font-semibold text-lime' : 'text-white/95 hover:bg-white/5')}>
                    {n.icon}
                    <span className="min-w-0 flex-1 leading-[1.15]">{n.label}</span>
                    {!open && total > 0 && <span className="num rounded-full bg-lime px-2 py-0.5 text-xs font-bold text-navy">{total}</span>}
                    <ChevronDown className={clsx('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
                  </button>
                  {open && (
                    <ul className="mb-1 mt-0.5 space-y-0.5 pl-9">
                      {kids.map((c) => (
                        <li key={c.to}>
                          <NavLink to={c.to} end={kids.some((o) => o !== c && o.to.startsWith(`${c.to}/`))} onClick={onNavigate} className={({ isActive }) => clsx('flex items-center gap-2 rounded-sm px-3 py-2 text-sm', isActive ? 'border-l-2 border-lime bg-navy-active font-semibold text-lime' : 'text-white/90 hover:bg-white/5')}>
                            <span className="min-w-0 flex-1">{c.label}</span>
                            {c.badge === true && badge > 0 && <span className="num rounded-full bg-lime px-2 py-0.5 text-xs font-bold text-navy">{badge}</span>}
                            {c.badge === 'approvals' && approvals > 0 && <span className="num rounded-full bg-white px-2 py-0.5 text-xs font-bold text-navy" aria-label={`${approvals} aguardando sua decisão`}>{approvals}</span>}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            }
            if (!(show(n) || (n.module === 'configuracoes' && inSettings))) return null;
            return (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    clsx(
                      'relative flex h-12 items-center gap-3.5 rounded-md px-4 text-md transition-colors',
                      isActive || (n.to === '/settings' && inSettings) ? 'bg-navy-active font-semibold text-lime before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-lime' : 'text-white/95 hover:bg-white/5',
                    )
                  }
                >
                  {n.icon}
                  <span className="line-clamp-2 min-w-0 flex-1 leading-[1.15]">{n.label}</span>
                </NavLink>
                {n.to === '/settings' && inSettings && (
                  <ul className="mb-2 mt-1 space-y-0.5 pl-9">
                    {SETTINGS_NAV.filter((x) => !x.admin || can('configuracoes', 'total')).map((x, i, all) => (
                      <li key={x.to} className={clsx(x.group && all[i - 1]?.group !== x.group && 'mt-2', !x.group && all[i - 1]?.group && 'mt-2')}>
                        {x.group && all[i - 1]?.group !== x.group && <p className="px-3 pb-0.5 text-2xs font-semibold text-white/55">{x.group}</p>}
                        <NavLink
                          to={x.to}
                          end
                          onClick={onNavigate}
                          className={({ isActive }) => clsx('block rounded-sm px-3 py-1.5 text-sm', isActive ? 'border-l-2 border-lime bg-navy-active font-semibold text-lime' : 'text-white/85 hover:bg-white/5')}
                        >
                          {x.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <div className={clsx('relative mx-4 mb-4 overflow-hidden rounded-lg bg-gradient-to-br from-navy-2 to-primary', inSettings ? 'h-[140px] shrink-0 [@media(max-height:960px)]:hidden' : 'h-[200px] min-h-[140px] shrink-0 [@media(max-height:720px)]:hidden')} aria-hidden>
        <Hexagons className="absolute inset-0 h-full w-full" />
        <img src="/brand/bkt-symbol-white.png" alt="" className="absolute bottom-4 left-5 h-10 w-auto opacity-90" draggable={false} />
      </div>
    </div>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!me) return null;
  return (
    <div className="relative" ref={ref}>
      <button aria-label={`Conta de ${me.user.name}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)} className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-surface-2">
        <Avatar name={me.user.name} userId={me.user.id} hasPhoto={me.user.hasAvatar} size={44} />
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-md font-bold text-ink">{me.user.name}</span>
          <span className="block text-sm text-muted">{me.user.jobTitle ?? ''}</span>
        </span>
        <ChevronDown className="h-5 w-5 text-ink" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-64 rounded-md border border-line bg-surface p-1 shadow-overlay">
          <div className="border-b border-line px-3 py-2">
            <p className="font-semibold text-ink">{me.user.name}</p>
            <p className="text-sm text-muted">{me.tenant.name}</p>
          </div>
          <button role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-surface-2" onClick={() => { setOpen(false); nav('/settings/profile'); }}>
            <UserRound className="h-4 w-4" /> Meu perfil
          </button>
          <button role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-surface-2" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      )}
    </div>
  );
}

function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-circle text-ink hover:bg-surface-2" aria-label="Ajuda">
        <CircleHelp className="h-7 w-7" strokeWidth={1.6} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Ajuda" size="sm">
        <ul className="space-y-2 text-sm">
          <li><kbd className="rounded border border-line bg-surface-2 px-1.5">/</kbd> busca global</li>
          <li><kbd className="rounded border border-line bg-surface-2 px-1.5">N</kbd> nova oportunidade (fora de campos de texto)</li>
          <li>O que você vê em cada módulo depende do nível do seu perfil (Próprio, Equipe ou Total), definido pela gerência em Configurações → Segurança.</li>
        </ul>
      </Modal>
    </>
  );
}

export function AppShell() {
  const { can } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const search = useRef<{ focus: () => void }>(null);
  const nav = useNavigate();
  const loc = useLocation();
  const counts = useOpenActivities().data?.counts;
  const newOpp = useCallback(() => can('oportunidades') && nav('/opportunities/new'), [can, nav]);
  useHotkey('/', useCallback(() => search.current?.focus(), []));
  useHotkey('n', newOpp);
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  const notify = (counts?.overdue ?? 0) + (counts?.today ?? 0);

  return (
    <div className="flex min-h-screen">
      <a href="#conteudo" className="sr-only z-50 rounded bg-primary px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-2 focus:top-2">Pular para o conteúdo</a>
      <aside className="hidden w-[228px] shrink-0 bg-navy lg:block print:!hidden">
        <div className="sticky top-0 h-screen"><Sidebar /></div>
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="w-[260px]"><Sidebar onNavigate={() => setMobileOpen(false)} /></div>
          <button className="flex-1 bg-ink/40" aria-label="Fechar menu" onClick={() => setMobileOpen(false)}><X className="ml-2 mt-3 h-6 w-6 text-white" /></button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex print:hidden h-[72px] items-center gap-3 border-b border-line/60 bg-surface/95 px-4 backdrop-blur sm:px-6">
          <button className="rounded-sm p-1.5 text-ink hover:bg-surface-2 lg:hidden" aria-label="Abrir menu" onClick={() => setMobileOpen(true)}><Menu className="h-6 w-6" /></button>
          <GlobalSearch ref={search} />
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <Link to="/activities" className="relative flex h-11 w-11 items-center justify-center rounded-circle text-ink hover:bg-surface-2" aria-label={notify ? `${notify} atividades para hoje ou vencidas` : 'Sem atividades pendentes hoje'}>
              <Bell className="h-7 w-7" strokeWidth={1.6} />
              {notify > 0 && <span className="absolute right-2 top-1.5 h-3.5 w-3.5 rounded-circle border-2 border-surface bg-danger" aria-hidden />}
            </Link>
            <MentionsMenu />
            <HelpButton />
            <UserMenu />
          </div>
        </header>
        <main id="conteudo" className="min-w-0 flex-1 px-4 py-6 sm:px-6 2xl:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
