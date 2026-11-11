import { HeaderMoneyToggle, setMoneyHidden, useMoneyHidden } from '../../lib/privacy';
import { HeaderSupport } from '../../features/support/Support';
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BarChart3, Bell, UsersRound, HandHelping, Eye, EyeOff, Briefcase, FileSignature, ChevronDown, CircleHelp, Home, Lightbulb, LogOut, Megaphone, Menu, Monitor, Moon, Package, Settings, Sun, UserRound, X, HeartHandshake, FolderKanban, Gauge, Mail, Wallet, Star, BookOpen } from 'lucide-react';
import { CONTRACT_MENU_TABS, type ContractTab, type FeatureKey, type Module } from '@isp/domain';
import { useApprovalCount } from '../../pages/Approvals';
import { MentionsMenu } from '../../features/MentionsMenu';
import { settingsLocate, visibleGroups } from '../../features/settings/nav';
import { useAuth } from '../../auth/AuthProvider';
import { api } from '../../lib/api';
import { useHotkey } from '../../lib/hooks';
import { useTheme, type ThemeChoice } from '../../lib/theme';
import { Avatar, LoadingRows } from '../ui/primitives';
import { Modal } from '../ui/overlay';
import { BrandArt, Hexagons, Logo } from '../brand';
import { GlobalSearch } from './GlobalSearch';
import { AppErrorBoundary } from '../AppErrorBoundary';
import { HeaderSelo } from '../../features/gamification/Gamification';

type NavLeaf = {
  to: string; label: string; icon?: ReactNode; module: Module; feature?: FeatureKey; badge?: 'approvals'; also?: string[];
  /** aba da Gestão de Contratos que o item abre (segue a permissão da aba por perfil) */ contractTab?: ContractTab;
};
type NavGroup = { key: string; label: string; icon: ReactNode; children: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;
const ICON = 'h-[18px] w-[18px] shrink-0';
/** Item do menu lateral: texto 14px numa linha, ícone fino; ativo = fundo sutil e filete na lateral (sem bloco cheio). */
const NAV_ITEM = 'relative flex min-h-10 w-full items-center gap-3 px-3 py-2 text-left text-sm font-medium leading-tight tracking-[0.005em] transition-colors [&>svg]:stroke-[1.75]';
const NAV_ON = 'bg-white/[0.07] before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:bg-lime';
const isGroup = (n: NavEntry): n is NavGroup => 'children' in n;
/** Menu na ordem combinada com o Paulo (21/10/2026). Grupos abrem e fecham; abrem sozinhos quando a página atual está dentro. */
const NAV: NavEntry[] = [
  { to: '/', label: 'Início', icon: <Home className={ICON} />, module: 'inicio' },
  { key: 'comercial', label: 'Comercial', icon: <Briefcase className={ICON} />, children: [
    { to: '/opportunities', label: 'Oportunidades', module: 'oportunidades' },
    { to: '/customers', label: 'Contas', module: 'clientes', feature: 'crm.contas' },
    { to: '/aprovacoes', label: 'Aprovações', module: 'oportunidades', badge: 'approvals' },
    { to: '/activities', label: 'Atividades', module: 'atividades', feature: 'crm.atividades' },
  ] },
  { key: 'contratos', label: 'Gestão de Contratos', icon: <FileSignature className={ICON} />, children: [
    { to: '/contracts?t=painel', label: 'Painel', module: 'contratos', contractTab: 'painel' },
    { to: '/contracts?t=atencao', label: 'Central de atenção', module: 'contratos', contractTab: 'atencao' },
    { to: '/contracts?t=lista', label: 'Lista de contratos', module: 'contratos', contractTab: 'lista' },
    { to: '/contracts?t=comunicacoes', label: 'Comunicações', module: 'contratos', contractTab: 'comunicacoes' },
    { to: '/contracts?t=funil', label: 'Funil', module: 'contratos', contractTab: 'funil' },
    { to: '/contracts?t=atestados', label: 'Atestados', module: 'contratos', contractTab: 'atestados' },
    { to: '/contracts?t=atas', label: 'Atas de Registro de Preço', module: 'contratos', contractTab: 'atas', feature: 'contratos.atas' },
    { to: '/contracts?t=empenhos', label: 'Controle de Empenhos', module: 'contratos', contractTab: 'empenhos' },
    { to: '/contracts?t=calendario', label: 'Calendário', module: 'contratos', contractTab: 'calendario' },
    { to: '/contracts?t=relatorios', label: 'Relatórios', module: 'contratos', contractTab: 'relatorios' },
  ] },
  { to: '/pessoas', label: 'Pessoas & Cultura', icon: <UsersRound className={ICON} />, module: 'pessoas', feature: 'pessoas_cultura.experiencia' },
  { to: '/sucesso', label: 'Sucesso do Cliente', icon: <HeartHandshake className={ICON} />, module: 'clientes', feature: 'crm.sucesso_cliente' },
  { to: '/email', label: 'E-mail', icon: <Mail className={ICON} />, module: 'email', also: ['/email/caixas'] },
  { key: 'marketing', label: 'Marketing', icon: <Megaphone className={ICON} />, children: [
    { to: '/leads', label: 'Leads', module: 'leads' },
    { to: '/abm', label: 'ABM', module: 'clientes', feature: 'marketing.abm' },
    { to: '/campaigns', label: 'Plays/Campanhas', module: 'campanhas' },
    { to: '/brindes', label: 'Brindes', module: 'campanhas' },
  ] },
  { to: '/produto', label: 'Produto', icon: <Package className={ICON} />, module: 'inicio', feature: 'produto.catalogo' },
  { key: 'times', label: 'Gestão de Times', icon: <Gauge className={ICON} />, children: [
    { to: '/times', label: 'Painel', module: 'resultados' },
    { to: '/times/metas', label: 'Metas e indicadores', module: 'desempenho' },
    { to: '/times/acompanhamento', label: 'Acompanhamento', module: 'resultados' },
    { to: '/times/pessoas', label: 'Pessoas', module: 'resultados' },
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


function useOpenActivities() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['activities', 'counts'],
    enabled: can('atividades'),
    queryFn: () => api<{ counts: { overdue: number; today: number; open: number } }>('/activities?status=hoje&pageSize=1'),
    refetchInterval: 60_000,
  });
}

/** Configuração no menu: grupos por assunto; só o grupo da página aberta fica expandido (os outros abrem com um clique). */
function SettingsMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { can, feature } = useAuth();
  const loc = useLocation();
  const groups = visibleGroups(can('configuracoes', 'total'), feature);
  const current = settingsLocate(loc.pathname)?.group.key ?? groups[0]?.key;
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [current]);
  return (
    <ul className="mb-2 mt-1 space-y-0.5 pl-9">
      {groups.map((g) => {
        const expanded = g.key === (open ?? current);
        return (
          <li key={g.key}>
            <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? '' : g.key)} className={clsx('flex w-full items-center justify-between rounded-sm px-3 py-1.5 text-left text-xs font-semibold', g.key === current ? 'text-lime' : 'text-white/70 hover:bg-white/5')}>
              {g.label}<ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden />
            </button>
            {expanded && (
              <ul className="mb-1 space-y-0.5">
                {g.items.map((x) => (
                  <li key={x.to}>
                    <NavLink to={x.to} end onClick={onNavigate} className={({ isActive }) => clsx('block rounded-sm py-1.5 pl-5 pr-3 text-sm', isActive ? 'border-l-2 border-lime bg-navy-active font-semibold text-lime' : 'text-white/85 hover:bg-white/5')}>
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
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, feature } = useAuth();
  const contractTabs = useQuery({ queryKey: ['contracts', 'view'], enabled: can('contratos'), queryFn: () => api<{ tabs: ContractTab[] }>('/contracts/view'), staleTime: 60_000 }).data?.tabs;
  const show = (n: NavLeaf) => can(n.module) && (!n.feature || feature(n.feature)) && (!n.contractTab || !contractTabs || contractTabs.includes(n.contractTab));
  const loc = useLocation();
  // itens com ?t= (submenus de Contratos) comparam também a aba; "Contratos" vale para as demais abas e para as fichas
  const currentTab = new URLSearchParams(loc.search).get('t');
  const leafActive = (c: NavLeaf) => {
    const [path, query] = c.to.split('?');
    // a ficha de um contrato (/contracts/:id) acende "Lista de contratos"; /contracts sem aba abre o Painel
    if (c.to === '/contracts?t=lista' && loc.pathname.startsWith('/contracts/')) return true;
    if (c.to === '/contracts?t=painel' && loc.pathname === '/contracts' && !(CONTRACT_MENU_TABS as readonly string[]).includes(currentTab ?? '')) return true;
    if (query) return loc.pathname === path && currentTab === new URLSearchParams(query).get('t');
    return loc.pathname === c.to || loc.pathname.startsWith(`${c.to}/`);
  };
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
        <ul className="space-y-0.5">
          {NAV.map((n) => {
            if (isGroup(n)) {
              const kids = n.children.filter((c) => show(c));
              if (!kids.length) return null;
              const active = kids.some(leafActive);
              const open = openGroups[n.key] ?? active;
              return (
                <li key={n.key}>
                  <button type="button" aria-expanded={open} onClick={() => toggle(n.key, !open)} className={clsx(NAV_ITEM, active ? 'text-white [&>svg:first-child]:text-lime' : 'text-white/70 hover:bg-white/[0.04] hover:text-white', active && !open && NAV_ON)}>
                    {n.icon}
                    <span className="min-w-0 flex-1 text-balance">{n.label}</span>
                    <ChevronDown className={clsx('h-3.5 w-3.5 shrink-0 text-white/35 transition-transform duration-200', open && 'rotate-180')} aria-hidden />
                  </button>
                  {open && (
                    <ul className="mb-2 ml-[25px] mt-0.5 space-y-px border-l border-white/10 pl-3">
                      {kids.map((c) => (
                        <li key={c.to}>
                          {(() => {
                            const cls = (on: boolean) => clsx('relative flex items-center gap-2 px-2.5 py-[7px] text-[13px] leading-snug transition-colors', on ? 'bg-white/[0.06] font-medium text-white before:absolute before:-left-[13px] before:inset-y-1 before:w-[2px] before:bg-lime' : 'text-white/60 hover:bg-white/[0.04] hover:text-white');
                            const inner = <>
                              <span className="min-w-0 flex-1">{c.label}</span>
                              {c.badge === 'approvals' && approvals > 0 && <span className="num rounded-full bg-white px-2 py-0.5 text-xs font-bold text-navy" aria-label={`${approvals} aguardando sua decisão`}>{approvals}</span>}
                            </>;
                            // submenus de Contratos: a aba (?t=) decide qual está ativo, não só o caminho
                            if (n.key === 'contratos') { const on = leafActive(c); return <Link to={c.to} onClick={onNavigate} aria-current={on ? 'page' : undefined} className={cls(on)}>{inner}</Link>; }
                            return <NavLink to={c.to} end={kids.some((o) => o !== c && o.to.startsWith(`${c.to}/`))} onClick={onNavigate} className={({ isActive }) => cls(isActive)}>{inner}</NavLink>;
                          })()}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            }
            if (!(show(n) || (n.module === 'configuracoes' && inSettings))) return null;
            return (
              <li key={n.to} className={clsx(n.to === '/reports' && 'mt-3 border-t border-white/10 pt-3')}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    clsx(
                      NAV_ITEM,
                      isActive || (n.to === '/settings' && inSettings) ? clsx(NAV_ON, 'text-white [&>svg]:text-lime') : 'text-white/70 hover:bg-white/[0.04] hover:text-white',
                    )
                  }
                >
                  {n.icon}
                  <span className="min-w-0 flex-1 text-balance">{n.label}</span>
                </NavLink>
                {n.to === '/settings' && inSettings && <SettingsMenu onNavigate={onNavigate} />}
              </li>
            );
          })}
        </ul>
      </nav>
      <div className={clsx('relative mx-4 mb-4 overflow-hidden rounded-lg bg-gradient-to-br from-navy-2 to-primary', inSettings ? 'h-[110px] shrink-0 [@media(max-height:1000px)]:hidden' : 'h-[120px] shrink-0 [@media(max-height:900px)]:hidden')} aria-hidden>
        <BrandArt slot="card_sidebar" className="absolute inset-0 h-full w-full" fallback={<>
          <Hexagons className="absolute inset-0 h-full w-full" />
          <img src="/brand/bkt-symbol-white.png" alt="" className="absolute bottom-4 left-5 h-10 w-auto opacity-90" draggable={false} />
        </>} />
      </div>
    </div>
  );
}

const THEMES: { key: ThemeChoice; label: string; icon: ReactNode }[] = [
  { key: 'claro', label: 'Claro', icon: <Sun className="h-4 w-4" aria-hidden /> },
  { key: 'escuro', label: 'Escuro', icon: <Moon className="h-4 w-4" aria-hidden /> },
  { key: 'auto', label: 'Sistema', icon: <Monitor className="h-4 w-4" aria-hidden /> },
];

function UserMenu() {
  const { me, logout } = useAuth();
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const moneyHidden = useMoneyHidden();
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!me) return null;
  return (
    <div className="relative flex items-center gap-1" ref={ref}>
      <HeaderSelo />
      <button aria-label={`Conta de ${me.user.name}`} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)} className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-surface-2">
        <Avatar name={me.user.name} userId={me.user.id} hasPhoto={me.user.hasAvatar} size={44} />
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-md font-bold text-ink">{me.user.name}</span>
          <span className="block text-sm text-muted">{me.user.jobTitle ?? ''}</span>
        </span>
        <ChevronDown className="h-5 w-5 text-ink" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-2 max-h-[calc(100vh-88px)] w-64 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-overlay">
          <div className="border-b border-line px-3 py-2">
            <p className="font-semibold text-ink">{me.user.name}</p>
            <p className="text-sm text-muted">{me.tenant.name}</p>
          </div>
          <button role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-surface-2" onClick={() => { setOpen(false); nav('/settings/profile'); }}>
            <UserRound className="h-4 w-4" /> Meu perfil
          </button>
          <button role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-surface-2" onClick={() => { setOpen(false); nav('/meus-pontos'); }}>
            <Star className="h-4 w-4" /> Meus pontos
          </button>
          {/* celular: os atalhos que não cabem no topo */}
          <div className="border-t border-line sm:hidden">
            <button role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-surface-2" onClick={() => { setOpen(false); nav('/apoio'); }}><HandHelping className="h-4 w-4" /> Pedidos de apoio</button>
            <button role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-surface-2" onClick={() => { setOpen(false); nav('/playbooks'); }}><BookOpen className="h-4 w-4" /> Playbooks</button>
            <button role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-surface-2" onClick={() => setMoneyHidden(!moneyHidden)}>{moneyHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} {moneyHidden ? 'Mostrar valores' : 'Ocultar valores'}</button>
            <button role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-surface-2" onClick={() => { setOpen(false); setHelp(true); }}><CircleHelp className="h-4 w-4" /> Ajuda</button>
          </div>
          <div className="border-y border-line px-3 py-2">
            <p id="theme-label" className="mb-1.5 text-xs font-semibold text-muted">Tema da tela</p>
            <div role="group" aria-labelledby="theme-label" className="grid grid-cols-3 gap-1">
              {THEMES.map((t) => (
                <button key={t.key} type="button" role="menuitemradio" aria-checked={theme === t.key} onClick={() => setTheme(t.key)}
                  className={clsx('flex h-9 items-center justify-center gap-1.5 border text-xs font-semibold', theme === t.key ? 'border-primary bg-primary-soft text-primary' : 'border-line text-text hover:bg-surface-2')}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
          </div>
          <button role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-surface-2" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      )}
      <Modal open={help} onClose={() => setHelp(false)} title="Ajuda" size="sm"><HelpContent /></Modal>
    </div>
  );
}

function HelpContent() {
  return (
    <ul className="space-y-2 text-sm">
      <li><kbd className="rounded border border-line bg-surface-2 px-1.5">/</kbd> busca global</li>
      <li><kbd className="rounded border border-line bg-surface-2 px-1.5">N</kbd> nova oportunidade (fora de campos de texto)</li>
      <li>O que você vê em cada módulo depende do nível do seu perfil (Próprio, Equipe ou Total), definido pela gerência em Configurações → Segurança.</li>
    </ul>
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
<HelpContent />
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
          <div className="ml-auto flex items-center gap-1 sm:gap-4">
            <Link to="/activities" className="relative flex h-11 w-11 items-center justify-center rounded-circle text-ink hover:bg-surface-2" aria-label={notify ? `${notify} atividades para hoje ou vencidas` : 'Sem atividades pendentes hoje'}>
              <Bell className="h-7 w-7" strokeWidth={1.6} />
              {notify > 0 && <span className="absolute right-2 top-1.5 h-3.5 w-3.5 rounded-circle border-2 border-surface bg-danger" aria-hidden />}
            </Link>
            {/* no celular estes vão para o menu da conta (o topo não pode passar da largura da tela) */}
            <div className="hidden items-center gap-4 sm:flex"><HeaderSupport /><HeaderPlaybooks /><HeaderMoneyToggle /></div>
            <MentionsMenu />
            <div className="hidden sm:block"><HelpButton /></div>
            <UserMenu />
          </div>
        </header>
        <main id="conteudo" className="min-w-0 flex-1 px-4 py-6 sm:px-6 2xl:px-8">
          <AppErrorBoundary resetKey={loc.pathname}><Suspense fallback={<div className="card"><LoadingRows rows={6} /></div>}><Outlet /></Suspense></AppErrorBoundary>
        </main>
      </div>
    </div>
  );
}

/** Atalho global para a Central de Playbooks (fica ativo dentro de /playbooks). */
function HeaderPlaybooks() {
  const { pathname } = useLocation();
  const on = pathname === '/playbooks' || pathname.startsWith('/playbooks/');
  return (
    <Link to="/playbooks" aria-label="Playbooks" title="Playbooks" aria-current={on ? 'page' : undefined}
      className={clsx('flex h-11 w-11 items-center justify-center rounded-circle hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary', on ? 'bg-navy text-lime hover:bg-navy' : 'text-ink')}>
      <BookOpen className="h-6 w-6" strokeWidth={1.6} aria-hidden />
    </Link>
  );
}
