import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { compressImage } from '../../lib/files';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowRight, Bell, Box, CalendarClock, ChevronRight, CircleHelp, Clock, Database, FileText, Filter, Image as ImageIcon, KeyRound, Link2, MessageSquare, Monitor,
  Palette, Plus, RefreshCw, Settings, Shield, Target, Trash2, Upload, UserPlus, Users, Workflow,
} from 'lucide-react';
import {
  BUSINESS_MODULE_LABELS, LEVEL_LABELS, MODULE_LABELS, MODULE_OWNER, PROFILE_KEYS, PROFILE_LABELS, SECTORS, SECTOR_LABELS, SEGMENTS, SEGMENT_LABELS, toCents, type AccessLevel, type Module, type ProfileKey, type Sector, type Segment,
} from '@isp/domain';
import type { BrandSlot } from '@isp/shared';
import { api, ApiError, qs } from '../../lib/api';
import { fmtBRL, fmtDateTime } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Pagination, Select } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { BrandImage, useBrand } from '../../components/brand';
import { FitText } from '../../components/ui/FitText';
import { IpAccessCard } from '../../features/admin/IpAccess';

// =================================================================== layout
const TABS = [
  { to: '/settings', label: 'Visão geral', end: true },
  { to: '/settings/users', label: 'Usuários' },
  { to: '/settings/journeys', label: 'Jornadas e automações' },
  { to: '/settings/area', label: 'Área de atendimento' },
  { to: '/settings/viability', label: 'Viabilidade' },
  { to: '/settings/plans', label: 'Planos e produtos' },
  { to: '/settings/sources', label: 'Canais de entrada' },
  { to: '/settings/modelos?aba=propostas', label: 'Modelos de proposta' },
  { to: '/settings/modelos?aba=contratos', label: 'Modelos de contrato' },
  { to: '/settings/modelos?aba=instrucao', label: 'Modelo de instrução' },
  { to: '/settings/modelos?aba=emails', label: 'E-mail e alertas' },
  { to: '/settings/integrations', label: 'Integrações' },
  { to: '/settings/fields', label: 'Campos personalizados' },
  { to: '/settings/modulos?cfg=contratos', label: 'Contratos' },
  { to: '/settings/approvals', label: 'Aprovações e alçadas' },
  { to: '/settings/customer-success', label: 'Sucesso do Cliente' },
  { to: '/settings/desempenho', label: 'Gestão de desempenho' },
  { to: '/settings/resultados', label: 'Gestão de Times' },
  { to: '/settings/abm', label: 'ABM' },
  { to: '/settings/data', label: 'Base de dados' },
  { to: '/settings/security', label: 'Segurança' },
  { to: '/settings/branding', label: 'Personalização' },
  { to: '/settings/logs', label: 'Logs' },
];

export function AdminLayout() {
  return (
    <div className="w-full">
      <PageHeader
        icon={<Settings className="h-9 w-9" strokeWidth={2.2} />}
        title="Administração"
        subtitle="Gerencie todos os parâmetros da plataforma."
      />
      <nav aria-label="Seções da administração" className="scroll-thin mb-5 flex gap-5 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => clsx('-mb-px whitespace-nowrap border-b-2 px-1 pb-3 pt-1 text-md', isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-ink')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

// =================================================================== visão geral
type Overview = {
  counts: { users: number; plans: number; stages: number; sources: number; integrations: number };
  system: { version: string; online: boolean; lastUpdate: string | null; database: string; uptimeSeconds: number; ixcMode: string };
  recent: { id: string; createdAt: string; actorId: string | null; actorName: string | null; label: string; details: string }[];
};

function uptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} dias, ${h} horas` : h ? `${h} horas, ${m} min` : `${m} min`;
}

function Tile({ to, icon, tone, title, desc, foot }: { to: string; icon: ReactNode; tone: string; title: string; desc: string; foot: string }) {
  return (
    <Link to={to} className="card group flex gap-4 p-5 hover:border-line-strong">
      <span className={clsx('flex h-14 w-14 shrink-0 items-center justify-center rounded-circle', tone)}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2"><span className="text-md font-bold text-ink">{title}</span><ChevronRight className="h-5 w-5 text-ink" aria-hidden /></span>
        <span className="mt-1 block text-sm text-muted">{desc}</span>
        <span className="mt-3 block text-sm text-text">{foot}</span>
      </span>
    </Link>
  );
}

export function AdminOverview() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api<Overview>('/admin/overview') });
  const [help, setHelp] = useState<string | null>(null);
  if (q.isLoading) return <div className="card"><LoadingRows rows={8} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const stat = (to: string, icon: ReactNode, tone: string, n: number, label: string) => (
    <Link to={to} className="card flex items-center gap-3 p-4 hover:border-line-strong">
      <span className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-circle', tone)}>{icon}</span>
      <span className="min-w-0 flex-1"><FitText as="span" className="num text-xl font-extrabold text-ink">{n}</FitText><span className="block whitespace-nowrap text-sm text-muted">{label}</span></span>
      <ChevronRight className="h-5 w-5 text-ink" aria-hidden />
    </Link>
  );
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_270px]">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stat('/settings/users', <Users className="h-7 w-7" />, 'bg-primary-soft text-primary', d.counts.users, 'Usuários ativos')}
          {stat('/settings/plans', <Box className="h-7 w-7" />, 'bg-success-soft text-success', d.counts.plans, 'Planos cadastrados')}
          {stat('/settings/journeys', <Filter className="h-7 w-7" />, 'bg-purple-soft text-purple', d.counts.stages, 'Etapas nas jornadas')}
          {stat('/settings/integrations', <Workflow className="h-7 w-7" />, 'bg-success-soft text-success', d.counts.integrations, 'Integrações ativas')}
        </div>
        <section className="card p-5">
          <h2 className="text-lg font-bold text-ink">Configurações principais</h2>
          <p className="mb-4 text-sm text-muted">Acesse e gerencie todas as áreas da plataforma.</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Tile to="/settings/users" icon={<Users className="h-7 w-7" />} tone="bg-primary-soft text-primary" title="Usuários e permissões" desc="Cadastre usuários, defina perfis e controle os acessos." foot={`${d.counts.users} usuários cadastrados`} />
            <Tile to="/settings/plans" icon={<Box className="h-7 w-7" />} tone="bg-success-soft text-success" title="Planos e produtos" desc="Gerencie os planos de internet, produtos e serviços." foot={`${d.counts.plans} planos cadastrados`} />
            <Tile to="/settings/journeys" icon={<Filter className="h-7 w-7" />} tone="bg-purple-soft text-purple" title="Jornadas e automações" desc="Crie funis, defina quem trabalha em cada um, campos do cadastro e automações." foot={`${d.counts.stages} etapas configuradas`} />
            <Tile to="/settings/viability" icon={<Target className="h-7 w-7" />} tone="bg-success-soft text-success" title="Viabilidade" desc="Tributos, parceiros, equipamentos, caminhos de entrega, comissão e LTV." foot="CAC, margem e payback" />
            <Tile to="/settings/area" icon={<Box className="h-7 w-7" />} tone="bg-primary-soft text-primary" title="Área de atendimento" desc="Regiões e condomínios, com blocos e endereço." foot="Região → condomínio" />
            <Tile to="/settings/modelos?aba=instrucao" icon={<FileText className="h-7 w-7" />} tone="bg-[#FFF3CC] text-[#E5A100]" title="Modelo de instrução" desc="Exporte e adapte o playbook: roteiro, insights, jornadas e e-mails." foot="Versões com prévia" />
            <Tile to="/settings/sources" icon={<Target className="h-7 w-7" />} tone="bg-warning-soft text-[#EA580C]" title="Canais de entrada" desc="WhatsApp, Instagram, telefone, site: por onde o cliente chega." foot={`${d.counts.sources} canais configurados`} />
            <Tile to="/settings/integrations" icon={<Link2 className="h-7 w-7" />} tone="bg-primary-soft text-primary" title="Integrações" desc="Conecte com IXC, WhatsApp, e-mail e sistemas externos." foot={`${d.counts.integrations} integrações ativas`} />
            <Tile to="/settings/modelos?aba=emails" icon={<Bell className="h-7 w-7" />} tone="bg-[#FFF3CC] text-[#E5A100]" title="E-mail e alertas" desc="Servidor SMTP, alertas automáticos e registro de envios." foot="Propostas, follow-ups e avisos" />
            <Tile to="/settings/security" icon={<Shield className="h-7 w-7" />} tone="bg-danger-soft text-danger" title="Segurança" desc="Defina níveis de acesso por módulo e perfil, e acompanhe a auditoria." foot="Matriz de acesso por módulo" />
            <Tile to="/settings/branding" icon={<Palette className="h-7 w-7" />} tone="bg-purple-soft text-purple" title="Personalização" desc="Identidade visual BKT aplicada em todo o sistema." foot="Identidade BKT" />
            <Tile to="/settings/logs" icon={<FileText className="h-7 w-7" />} tone="bg-surface-2 text-ink" title="Logs do sistema" desc="Acompanhe todas as ações realizadas na plataforma." foot="Registro de atividades" />
          </div>
        </section>
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <h2 className="text-lg font-bold text-ink">Atividades recentes na administração</h2>
            <Link to="/settings/logs" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">Ver todos <ArrowRight className="h-4 w-4" /></Link>
          </div>
          {d.recent.length === 0 ? <EmptyState title="Nenhuma ação administrativa registrada ainda" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-surface-2 text-xs text-muted"><tr>{['Data e hora', 'Usuário', 'Ação realizada', 'Detalhes'].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {d.recent.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="num px-5 py-2.5 text-text">{fmtDateTime(r.createdAt)}</td>
                      <td className="px-5 py-2.5"><span className="flex items-center gap-2 text-text"><Avatar name={r.actorName} userId={r.actorId} size={26} />{r.actorName ?? 'Sistema'}</span></td>
                      <td className="px-5 py-2.5 text-ink">{r.label}</td>
                      <td className="px-5 py-2.5 text-muted">{r.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <aside className="space-y-4">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-md font-bold text-ink">Informações do sistema</h2><Chip tone="green"><span className="h-2 w-2 rounded-circle bg-success" />Online</Chip></div>
          <dl className="space-y-3 text-sm">
            {[
              [<Monitor key="i" className="h-4 w-4 text-primary" />, 'Versão', d.system.version],
              [<CalendarClock key="i" className="h-4 w-4 text-primary" />, 'Última atualização', d.system.lastUpdate ? fmtDateTime(d.system.lastUpdate) : '—'],
              [<Database key="i" className="h-4 w-4 text-primary" />, 'Banco de dados', d.system.database],
              [<Clock key="i" className="h-4 w-4 text-primary" />, 'Tempo de atividade', uptime(d.system.uptimeSeconds)],
            ].map(([icon, k, v]) => (
              <div key={k as string} className="flex items-center gap-2"><dt className="flex flex-1 items-center gap-2 text-muted">{icon}{k}</dt><dd className="text-right text-text">{v}</dd></div>
            ))}
          </dl>
        </section>
        <section className="card p-5">
          <h2 className="mb-2 text-md font-bold text-ink">Configurações rápidas</h2>
          <ul className="space-y-1.5 text-sm">
            {[
              ['/settings/users?novo=1', <UserPlus key="i" className="h-4 w-4 text-primary" />, 'Adicionar novo usuário'],
              ['/settings/plans?novo=1', <Box key="i" className="h-4 w-4 text-success" />, 'Cadastrar plano'],
              ['/settings/journeys', <Filter key="i" className="h-4 w-4 text-purple" />, 'Configurar jornadas'],
              ['/settings/modelos?aba=emails', <Bell key="i" className="h-4 w-4 text-[#E5A100]" />, 'Configurar e-mail (SMTP)'],
              ['/settings/integrations', <MessageSquare key="i" className="h-4 w-4 text-success" />, 'Integrar WhatsApp'],
              ['/settings/branding', <Palette key="i" className="h-4 w-4 text-purple" />, 'Identidade visual'],
            ].map(([to, icon, label]) => (
              <li key={label as string}><Link to={to as string} className="flex items-center gap-2 rounded-sm border border-line px-3 py-2 hover:border-line-strong">{icon}<span className="flex-1 text-text">{label}</span><ChevronRight className="h-4 w-4 text-muted" /></Link></li>
            ))}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="mb-2 text-md font-bold text-ink">Suporte e manutenção</h2>
          <ul className="space-y-1.5 text-sm">
            <li><button onClick={() => setHelp('ajuda')} className="flex w-full items-center gap-2 rounded-sm border border-line px-3 py-2 text-left hover:border-line-strong"><CircleHelp className="h-4 w-4 text-primary" /><span className="flex-1">Central de ajuda</span><ChevronRight className="h-4 w-4 text-muted" /></button></li>
            <li><a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-sm border border-line px-3 py-2 hover:border-line-strong"><FileText className="h-4 w-4 text-primary" /><span className="flex-1">Documentação da API</span><ChevronRight className="h-4 w-4 text-muted" /></a></li>
            <li><button onClick={() => setHelp('suporte')} className="flex w-full items-center gap-2 rounded-sm border border-line px-3 py-2 text-left hover:border-line-strong"><MessageSquare className="h-4 w-4 text-primary" /><span className="flex-1">Falar com o suporte</span><ChevronRight className="h-4 w-4 text-muted" /></button></li>
          </ul>
        </section>
      </aside>
      <Modal open={!!help} onClose={() => setHelp(null)} title={help === 'suporte' ? 'Falar com o suporte' : 'Central de ajuda'} size="sm">
        {help === 'suporte' ? <Notice>O canal de suporte ainda não foi configurado para esta empresa. Ele entra junto com as Notificações.</Notice> : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Níveis de acesso: Configurações → Segurança.</li>
            <li>Metas do mês: Configurações → Usuários (editar usuário).</li>
            <li>Identidade visual: fixa, conforme o Brand Book BKT.</li>
            <li>Atalhos: <kbd>/</kbd> busca, <kbd>N</kbd> nova oportunidade.</li>
          </ul>
        )}
      </Modal>
    </div>
  );
}

// =================================================================== usuários
type AdminUser = {
  id: string; name: string; email: string; jobTitle: string | null; phone: string | null; active: boolean; ipBypass?: boolean; lastLoginAt: string | null; profile: ProfileKey | null;
  goalSales: number; goalProposals: number; goalLeads: number; hasAvatar: boolean; teamIds: string[]; leadTeamIds: string[]; sectors: Sector[];
};

async function fileToBase64(file: File) {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function UserForm({ user, teams, users = [], onDone }: { user?: AdminUser; teams: { id: string; name: string }[]; users?: AdminUser[]; onDone: (temp?: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const [form, setForm] = useState({
    name: user?.name ?? '', email: user?.email ?? '', jobTitle: user?.jobTitle ?? '', phone: user?.phone ?? '', profile: (user?.profile ?? 'vendedor') as ProfileKey, active: user?.active ?? true, ipBypass: user?.ipBypass ?? false,
    teamIds: user?.teamIds ?? [], leadTeamIds: user?.leadTeamIds ?? [], sectors: (user?.sectors ?? []) as Sector[], goalSales: user?.goalSales ?? 0, goalProposals: user?.goalProposals ?? 0, goalLeads: user?.goalLeads ?? 0,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const m = useMutation({
    mutationFn: () => {
      if (form.profile === 'supervisor' && !form.leadTeamIds.length) { setErrors({ leadTeamIds: 'Escolha ao menos um time para supervisionar.' }); throw new Error('O supervisor precisa supervisionar ao menos um time.'); }
      const leadTeamIds = form.profile === 'supervisor' ? form.leadTeamIds : [];
      return user
      ? api(`/admin/users/${user.id}`, { method: 'PATCH', body: { name: form.name, email: form.email, jobTitle: form.jobTitle || null, phone: form.phone.trim() || null, profile: form.profile, active: form.active, ipBypass: form.ipBypass, teamIds: form.teamIds, leadTeamIds, sectors: form.sectors, goalSales: form.goalSales, goalProposals: form.goalProposals, goalLeads: form.goalLeads } })
      : api<{ temporaryPassword: string }>('/admin/users', { method: 'POST', body: { name: form.name, email: form.email, jobTitle: form.jobTitle || null, phone: form.phone.trim() || null, profile: form.profile, teamIds: form.teamIds, leadTeamIds, sectors: form.sectors } });
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['admin'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); toast({ tone: 'success', message: user ? 'Usuário atualizado' : 'Usuário cadastrado' }); onDone((r as { temporaryPassword?: string } | undefined)?.temporaryPassword); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); toast({ tone: 'error', message: (e as Error).message }); },
  });
  const self = user?.id === me?.user.id;
  return (
    <form id="user-form" className="space-y-4" noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); if (!m.isPending) m.mutate(); }}>
      <FormField label="Nome" htmlFor="uf-name" required error={errors.name}><Input id="uf-name" value={form.name} onChange={(e) => set('name', e.target.value)} data-autofocus /></FormField>
      <FormField label="E-mail" htmlFor="uf-email" required error={errors.email} hint={user ? 'É o login e o e-mail usado no “Entrar com Google”. Ao trocar, a conta Google vinculada é desfeita.' : 'Use o e-mail real da pessoa (o mesmo da conta Google, se for entrar com Google).'}><Input id="uf-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Cargo" htmlFor="uf-job" hint="Aparece abaixo do nome no topo"><Input id="uf-job" value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} placeholder="Ex.: Comercial" /></FormField>
        <FormField label="WhatsApp" htmlFor="uf-phone" hint="Para avisos internos (pedidos de aprovação)"><Input id="uf-phone" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(79) 99999-0000" /></FormField>
        <FormField label="Perfil de acesso" htmlFor="uf-profile" hint={self ? 'Você não pode tirar o próprio acesso de gerência' : 'Níveis por módulo em Segurança'}>
          <Select id="uf-profile" value={form.profile} disabled={self} onChange={(e) => set('profile', e.target.value as ProfileKey)}>{PROFILE_KEYS.map((p) => <option key={p} value={p}>{PROFILE_LABELS[p]}</option>)}</Select>
        </FormField>
      </div>
      {form.profile === 'supervisor' ? (
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink">Times que supervisiona</legend>
          <p className="mb-2 text-xs text-muted">O supervisor vê leads, oportunidades, clientes, atividades e relatórios só das pessoas destes times.</p>
          {errors.leadTeamIds && <p className="mb-2 text-sm text-danger">{errors.leadTeamIds}</p>}
          <ul className="space-y-1.5">
            {teams.map((t) => {
              const lead = form.leadTeamIds.includes(t.id);
              const people = users.filter((x) => x.id !== user?.id && x.teamIds.includes(t.id));
              return (
                <li key={t.id} className={`rounded-sm border px-3 py-2 text-sm ${lead ? 'border-primary bg-primary-soft' : 'border-line'}`}>
                  <label className="flex items-center gap-2 font-semibold text-ink">
                    <input type="checkbox" checked={lead} onChange={() => { set('leadTeamIds', lead ? form.leadTeamIds.filter((x) => x !== t.id) : [...form.leadTeamIds, t.id]); set('teamIds', lead ? form.teamIds.filter((x) => x !== t.id) : [...new Set([...form.teamIds, t.id])]); }} />
                    {t.name}
                  </label>
                  <p className="ml-6 text-xs text-muted">{people.length ? people.map((x) => x.name).join(', ') : 'Ninguém neste time ainda'}</p>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : (
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-ink">{form.profile === 'gerencia' ? 'Times (opcional)' : 'Time de que faz parte'}</legend>
          <p className="mb-2 text-xs text-muted">{form.profile === 'gerencia' ? 'A gerência vê todos os times.' : 'O supervisor deste time vê o trabalho desta pessoa.'}</p>
          <ul className="space-y-1.5">
            {teams.map((t) => {
              const member = form.teamIds.includes(t.id);
              return (
                <li key={t.id} className="rounded-sm border border-line px-3 py-2 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={member} onChange={() => { set('teamIds', member ? form.teamIds.filter((x) => x !== t.id) : [...form.teamIds, t.id]); set('leadTeamIds', []); }} />{t.name}</label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-ink">Setores (Gestão de Contratos)</legend>
        <p className="mb-2 text-xs text-muted">Definem quem recebe as tarefas e notificações dos contratos e quem conclui cada etapa. Setores de apoio enxergam todos os contratos.</p>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {SECTORS.map((x) => <label key={x} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.sectors.includes(x)} onChange={() => set('sectors', form.sectors.includes(x) ? form.sectors.filter((y) => y !== x) : [...form.sectors, x])} />{SECTOR_LABELS[x]}</label>)}
        </div>
      </fieldset>
      {user && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-ink">Metas do mês</legend>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Vendas" htmlFor="uf-gs"><Input id="uf-gs" type="number" min={0} value={form.goalSales} onChange={(e) => set('goalSales', Number(e.target.value))} /></FormField>
            <FormField label="Propostas" htmlFor="uf-gp"><Input id="uf-gp" type="number" min={0} value={form.goalProposals} onChange={(e) => set('goalProposals', Number(e.target.value))} /></FormField>
            <FormField label="Novos leads" htmlFor="uf-gl"><Input id="uf-gl" type="number" min={0} value={form.goalLeads} onChange={(e) => set('goalLeads', Number(e.target.value))} /></FormField>
          </div>
        </fieldset>
      )}
      {user && !self && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />Usuário ativo (desativar encerra as sessões)</label>}
      {user && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ipBypass} onChange={(e) => set('ipBypass', e.target.checked)} />Pode entrar de qualquer IP (exceção ao acesso por IP liberado)</label>}
    </form>
  );
}

export function AdminUsers() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<{ users: AdminUser[]; teams: { id: string; name: string }[] }>('/admin/users') });
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(() => (new URLSearchParams(location.search).get('novo') ? 'new' : null));
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const [newTeam, setNewTeam] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [avatarFor, setAvatarFor] = useState<AdminUser | null>(null);
  const reset = useMutation({
    mutationFn: (u: AdminUser) => api<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`, { method: 'POST' }),
    onSuccess: (r, u) => setTemp({ name: u.name, password: r.temporaryPassword }),
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const team = useMutation({
    mutationFn: () => api('/admin/teams', { method: 'POST', body: { name: newTeam } }),
    onSuccess: () => { setNewTeam(''); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const avatar = useMutation({
    mutationFn: async ({ u, f }: { u: AdminUser; f: File }) => {
      if (!IMG_TYPES.includes(f.type)) throw new Error('Envie PNG, JPG ou WebP.');
      const img = await compressImage(f, { maxBytes: 1_800_000, maxDim: 2400, keepAlpha: true });
      if (img.size > 2 * 1024 * 1024) throw new Error('A imagem passa de 2 MB mesmo reduzida. Exporte em tamanho menor.');
      return api(`/admin/users/${u.id}/avatar`, { method: 'PUT', body: { data: await fileToBase64(img) } });
    },
    onSuccess: () => { toast({ tone: 'success', message: 'Foto atualizada' }); qc.invalidateQueries(); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { users, teams } = q.data!;
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? '';
  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
          <div><h2 className="text-lg font-bold text-ink">Usuários e permissões</h2><p className="text-sm text-muted">Perfil define o nível de acesso por módulo; times definem o que a supervisão enxerga.</p></div>
          <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setEditing('new')}>Novo usuário</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Usuário', 'Perfil', 'Times', 'Setores', 'Metas (vendas/propostas/leads)', 'Último acesso', 'Situação', ''].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-3">
                      <button className="relative" title="Trocar foto" onClick={() => { setAvatarFor(u); file.current?.click(); }} aria-label={`Trocar foto de ${u.name}`}><Avatar name={u.name} userId={u.id} hasPhoto={u.hasAvatar} size={38} /></button>
                      <span><span className="block font-semibold text-ink">{u.name}</span><span className="block text-xs text-muted">{u.email}{u.jobTitle ? ` · ${u.jobTitle}` : ''}</span></span>
                    </span>
                  </td>
                  <td className="px-5 py-3">{u.profile ? <Chip tone={u.profile === 'gerencia' ? 'purple' : u.profile === 'supervisor' ? 'blue' : 'green'}>{PROFILE_LABELS[u.profile]}</Chip> : '—'}</td>
                  <td className="px-5 py-3 text-text">{u.teamIds.map((t) => `${teamName(t)}${u.leadTeamIds.includes(t) ? ' (lidera)' : ''}`).join(', ') || '—'}</td>
                  <td className="px-5 py-3 text-text">{u.sectors?.map((x) => SECTOR_LABELS[x]).join(', ') || '—'}</td>
                  <td className="num px-5 py-3 text-text">{u.goalSales} / {u.goalProposals} / {u.goalLeads}</td>
                  <td className="num px-5 py-3 text-text">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'Nunca'}</td>
                  <td className="px-5 py-3"><Chip tone={u.active ? 'green' : 'neutral'}>{u.active ? 'Ativo' : 'Inativo'}</Chip></td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Editar</Button>
                    <Button size="sm" variant="ghost" icon={<KeyRound className="h-4 w-4" />} onClick={() => reset.mutate(u)}>Nova senha</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card p-5">
        <h2 className="mb-2 text-md font-bold text-ink">Times</h2>
        <ul className="mb-3 flex flex-wrap gap-2">{teams.map((t) => <li key={t.id}><Chip tone="blue">{t.name}</Chip></li>)}</ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newTeam.trim().length >= 2) team.mutate(); }}>
          <Input aria-label="Nome do novo time" className="max-w-xs" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} placeholder="Nome do novo time" />
          <Button type="submit" icon={<Plus className="h-4 w-4" />} loading={team.isPending}>Criar time</Button>
        </form>
      </section>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && avatarFor) avatar.mutate({ u: avatarFor, f }); e.target.value = ''; }} />
      <Drawer open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Novo usuário' : editing?.name ?? ''} footer={<><Button onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" type="submit" form="user-form">{editing === 'new' ? 'Cadastrar' : 'Salvar'}</Button></>}>
        {editing && <UserForm key={editing === 'new' ? 'new' : editing.id} user={editing === 'new' ? undefined : editing} teams={teams} users={users} onDone={(tp) => { if (tp && editing === 'new') setTemp({ name: 'novo usuário', password: tp }); setEditing(null); }} />}
      </Drawer>
      <Modal open={!!temp} onClose={() => setTemp(null)} title="Senha temporária" size="sm" footer={<Button variant="primary" onClick={() => setTemp(null)}>Já copiei</Button>}>
        <p className="text-sm">Senha temporária para {temp?.name}. Ela aparece só agora; peça para trocar no primeiro acesso em Meu perfil.</p>
        <p className="num mt-3 select-all rounded-sm border border-line bg-surface-2 px-3 py-2 text-center text-lg font-bold text-ink">{temp?.password}</p>
      </Modal>
    </div>
  );
}

// =================================================================== planos
export { AdminPlans } from './Plans';

// =================================================================== origens
export function AdminSources() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'sources'], queryFn: () => api<{ items: { id: string; name: string; active: boolean }[] }>('/admin/sources') });
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api('/admin/sources', { method: 'POST', body: { name } }),
    onSuccess: () => { setName(''); qc.invalidateQueries({ queryKey: ['admin'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); toast({ tone: 'success', message: 'Canal cadastrado' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const toggle = useMutation({
    mutationFn: (s: { id: string; active: boolean }) => api(`/admin/sources/${s.id}`, { method: 'PATCH', body: { active: !s.active } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); },
  });
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold text-ink">Canais de entrada</h2>
      <p className="mb-4 text-sm text-muted">Por onde o cliente chega (WhatsApp, Instagram, telefone…). Canais desativados somem dos formulários, mas os registros antigos continuam com a origem original.</p>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) create.mutate(); }}>
        <Input aria-label="Novo canal" className="max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Instagram" />
        <Button type="submit" variant="primary" icon={<Plus className="h-4 w-4" />} loading={create.isPending}>Cadastrar</Button>
      </form>
      {q.isLoading ? <LoadingRows /> : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {q.data?.items.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-4 py-3">
              <span className={clsx('font-medium', s.active ? 'text-ink' : 'text-muted line-through')}>{s.name}</span>
              <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={s.active} onChange={() => toggle.mutate(s)} />Ativa</label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// =================================================================== integrações e notificações
export { AdminIntegrations } from './Integrations';

// =================================================================== segurança
type SecurityData = { profiles: { key: ProfileKey; users: number }[]; modules: { key: Module; allowed: AccessLevel[] }[]; matrix: Record<ProfileKey, Record<Module, AccessLevel>>; defaults: Record<ProfileKey, Record<Module, AccessLevel>> };
const GROUPS = ['crm', 'marketing', 'contratos', 'projetos', 'relatorios', 'gestao_time', 'fundacao'] as const;
const LEVEL_TONE: Record<AccessLevel, string> = { nenhum: 'border-line bg-surface-2 text-muted', proprio: 'border-success/30 bg-success-soft text-[#15803D]', equipe: 'border-primary/30 bg-primary-soft text-primary', total: 'border-purple/30 bg-purple-soft text-purple' };

export function AdminSecurity() {
  const qc = useQueryClient();
  const toast = useToast();
  const { refresh } = useAuth();
  const q = useQuery({ queryKey: ['admin', 'security'], queryFn: () => api<SecurityData>('/admin/security') });
  const m = useMutation({
    mutationFn: (b: { profile: ProfileKey; module: Module; level: AccessLevel }) => api('/admin/security', { method: 'PUT', body: b }),
    onSuccess: (_r, b) => { qc.invalidateQueries({ queryKey: ['admin', 'security'] }); refresh(); toast({ tone: 'success', message: `${PROFILE_LABELS[b.profile]} · ${MODULE_LABELS[b.module]}: ${LEVEL_LABELS[b.level]}` }); },
    onError: (e) => { toast({ tone: 'error', message: (e as Error).message }); qc.invalidateQueries({ queryKey: ['admin', 'security'] }); },
  });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <IpAccessCard />
      <section className="card overflow-hidden">
        <div className="px-5 pb-3 pt-4">
          <h2 className="text-lg font-bold text-ink">Níveis de acesso por módulo</h2>
          <p className="text-sm text-muted">Cada perfil recebe um nível em cada módulo. A regra vale no servidor: a tela e a API obedecem ao mesmo nível. Toda mudança fica no log. Módulo de negócio desligado em Módulos e liberação vale acima deste nível.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Matriz de segurança: módulos por perfil</caption>
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Módulo</th>
                {d.profiles.map((p) => <th key={p.key} scope="col" className="px-5 py-3 font-medium"><span className="block text-sm font-bold text-ink">{PROFILE_LABELS[p.key]}</span>{p.users} usuário(s)</th>)}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => [
                <tr key={`g-${g}`} className="border-t border-line bg-surface-2/60"><th scope="rowgroup" colSpan={d.profiles.length + 1} className="px-5 py-2 text-xs font-bold text-ink">{g === 'fundacao' ? 'Fundação (sempre ligada)' : BUSINESS_MODULE_LABELS[g]}</th></tr>,
                ...d.modules.filter((mod) => MODULE_OWNER[mod.key] === g).map((mod) => (
                <tr key={mod.key} className="border-t border-line">
                  <th scope="row" className="px-5 py-3 font-semibold text-ink">{MODULE_LABELS[mod.key]}</th>
                  {d.profiles.map((p) => {
                    const lvl = d.matrix[p.key][mod.key];
                    const locked = p.key === 'gerencia' && mod.key === 'configuracoes';
                    return (
                      <td key={p.key} className="px-5 py-2.5">
                        <select
                          aria-label={`${PROFILE_LABELS[p.key]} em ${MODULE_LABELS[mod.key]}`}
                          className={clsx('h-9 w-full max-w-[170px] rounded-sm border px-2 text-sm font-semibold', LEVEL_TONE[lvl])}
                          value={lvl}
                          disabled={locked || m.isPending}
                          title={locked ? 'A Gerência mantém acesso total a Configurações' : undefined}
                          onChange={(e) => m.mutate({ profile: p.key, module: mod.key, level: e.target.value as AccessLevel })}
                        >
                          {mod.allowed.map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}{d.defaults[p.key][mod.key] === l ? ' (padrão)' : ''}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))])}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card p-5">
        <h2 className="mb-3 text-md font-bold text-ink">O que cada nível significa</h2>
        <dl className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {([
            ['proprio', 'Lança e acompanha só a própria carteira e os próprios números. Sem ranking de colegas.'],
            ['equipe', 'Vê e gerencia os times que lidera (somados), inclusive reatribuir e reabrir. Nunca outros times.'],
            ['total', 'Vê 100% da empresa. Em Configurações, administra usuários, planos, segurança e imagens.'],
            ['nenhum', 'O módulo some do menu e a API recusa o acesso.'],
          ] as [AccessLevel, string][]).map(([l, t]) => (
            <div key={l} className={clsx('rounded-md border p-3', LEVEL_TONE[l])}><dt className="font-bold">{LEVEL_LABELS[l]}</dt><dd className="mt-1 text-sm text-text">{t}</dd></div>
          ))}
        </dl>
      </section>
    </div>
  );
}

// =================================================================== personalização
export function AdminBranding() {
  const q = useQuery({ queryKey: ['admin', 'branding'], queryFn: () => api<{ slots: ({ slot: BrandSlot; hasImage: boolean; sizeBytes?: number; updatedAt?: string; updatedByName?: string | null })[] }>('/admin/branding') });
  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center gap-5 p-5">
        <img src="/brand/bkt-logo.png" alt="BKT" className="h-12 w-auto" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-ink">Identidade visual BKT</h2>
          <p className="text-sm text-muted">A identidade segue o Brand Book da BKT: logotipo oficial, azul #2F5986 e grafite #2D3339, títulos em Orbitron, textos em Work Sans e hexágonos como grafismo. Ela é fixa no sistema para não ser alterada por engano, por isso não há imagens a enviar aqui.</p>
        </div>
      </section>
    </div>
  );
}

// =================================================================== logs
export function AdminLogs() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['admin', 'logs', page], queryFn: () => api<{ items: { id: string; createdAt: string; actorId: string | null; actorName: string | null; label: string; details: string; requestId: string | null }[]; page: number; pageSize: number; total: number }>(`/admin/logs${qs({ page, pageSize: 25 })}`) });
  return (
    <section className="card overflow-hidden">
      <div className="px-5 pb-3 pt-4"><h2 className="text-lg font-bold text-ink">Logs do sistema</h2><p className="text-sm text-muted">Registro imutável de logins, alterações de acesso, atribuições, encerramentos, exportações e consultas a fichas.</p></div>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Data e hora', 'Usuário', 'Ação realizada', 'Detalhes', 'Requisição'].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {q.data!.items.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="num whitespace-nowrap px-5 py-2.5 text-text">{fmtDateTime(l.createdAt)}</td>
                    <td className="px-5 py-2.5"><span className="flex items-center gap-2 text-text"><Avatar name={l.actorName} userId={l.actorId} size={26} />{l.actorName ?? 'Sistema'}</span></td>
                    <td className="px-5 py-2.5 text-ink">{l.label}</td>
                    <td className="px-5 py-2.5 text-muted">{l.details}</td>
                    <td className="num px-5 py-2.5 text-2xs text-faint">{l.requestId?.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination noun="registros" page={q.data!.page} pageSize={q.data!.pageSize} total={q.data!.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}
