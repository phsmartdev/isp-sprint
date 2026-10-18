import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowRight, Bell, Box, CalendarClock, ChevronRight, CircleHelp, Clock, Database, FileText, Filter, Image as ImageIcon, KeyRound, Link2, MessageSquare, Monitor,
  Palette, Plus, RefreshCw, Settings, Shield, Target, Trash2, Upload, UserPlus, Users, Workflow,
} from 'lucide-react';
import {
  LEVEL_LABELS, MODULE_LABELS, PROFILE_LABELS, SEGMENTS, SEGMENT_LABELS, toCents, type AccessLevel, type Module, type ProfileKey, type Segment,
} from '@isp/domain';
import type { BrandSlot } from '@isp/shared';
import { api, ApiError, qs } from '../../lib/api';
import { fmtBRL, fmtDateTime } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Avatar, Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Pagination, Select } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { BrandImage, ConfiarFacil, useBrand } from '../../components/brand';

// =================================================================== layout
const TABS = [
  { to: '/settings', label: 'Visão geral', end: true },
  { to: '/settings/users', label: 'Usuários' },
  { to: '/settings/plans', label: 'Planos e produtos' },
  { to: '/settings/stages', label: 'Etapas de vendas' },
  { to: '/settings/sources', label: 'Origem de leads' },
  { to: '/settings/integrations', label: 'Integrações' },
  { to: '/settings/notifications', label: 'Notificações' },
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
        mascot={{ slot: 'mascote_administracao', lines: ['Tudo sob controle', 'para seu time vender mais.'], highlight: <ConfiarFacil /> }}
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
      <span className={clsx('flex h-14 w-14 shrink-0 items-center justify-center rounded-full', tone)}>{icon}</span>
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
      <span className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', tone)}>{icon}</span>
      <span className="min-w-0 flex-1"><span className="num block text-xl font-extrabold text-ink">{n}</span><span className="block whitespace-nowrap text-sm text-muted">{label}</span></span>
      <ChevronRight className="h-5 w-5 text-ink" aria-hidden />
    </Link>
  );
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_270px]">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stat('/settings/users', <Users className="h-7 w-7" />, 'bg-primary-soft text-primary', d.counts.users, 'Usuários ativos')}
          {stat('/settings/plans', <Box className="h-7 w-7" />, 'bg-success-soft text-success', d.counts.plans, 'Planos cadastrados')}
          {stat('/settings/stages', <Filter className="h-7 w-7" />, 'bg-purple-soft text-purple', d.counts.stages, 'Etapas de vendas')}
          {stat('/settings/integrations', <Workflow className="h-7 w-7" />, 'bg-success-soft text-success', d.counts.integrations, 'Integrações ativas')}
        </div>
        <section className="card p-5">
          <h2 className="text-lg font-bold text-ink">Configurações principais</h2>
          <p className="mb-4 text-sm text-muted">Acesse e gerencie todas as áreas da plataforma.</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Tile to="/settings/users" icon={<Users className="h-7 w-7" />} tone="bg-primary-soft text-primary" title="Usuários e permissões" desc="Cadastre usuários, defina perfis e controle os acessos." foot={`${d.counts.users} usuários cadastrados`} />
            <Tile to="/settings/plans" icon={<Box className="h-7 w-7" />} tone="bg-success-soft text-success" title="Planos e produtos" desc="Gerencie os planos de internet, produtos e serviços." foot={`${d.counts.plans} planos cadastrados`} />
            <Tile to="/settings/stages" icon={<Filter className="h-7 w-7" />} tone="bg-purple-soft text-purple" title="Etapas de vendas" desc="Configure o funil de vendas e os status das oportunidades." foot={`${d.counts.stages} etapas configuradas`} />
            <Tile to="/settings/sources" icon={<Target className="h-7 w-7" />} tone="bg-warning-soft text-[#EA580C]" title="Origem de leads" desc="Cadastre e categorize as origens de leads (site, WhatsApp, campanhas etc)." foot={`${d.counts.sources} origens configuradas`} />
            <Tile to="/settings/integrations" icon={<Link2 className="h-7 w-7" />} tone="bg-primary-soft text-primary" title="Integrações" desc="Conecte com IXC, WhatsApp, e-mail e sistemas externos." foot={`${d.counts.integrations} integrações ativas`} />
            <Tile to="/settings/notifications" icon={<Bell className="h-7 w-7" />} tone="bg-[#FFF3CC] text-[#E5A100]" title="Notificações" desc="Configure alertas por e-mail, WhatsApp e sistema." foot="Alertas personalizados" />
            <Tile to="/settings/security" icon={<Shield className="h-7 w-7" />} tone="bg-danger-soft text-danger" title="Segurança" desc="Defina níveis de acesso por módulo e perfil, e acompanhe a auditoria." foot="Matriz de acesso por módulo" />
            <Tile to="/settings/branding" icon={<Palette className="h-7 w-7" />} tone="bg-purple-soft text-purple" title="Personalização" desc="Envie logo, mascotes, banner e imagens da identidade visual." foot="Identidade Yepnet" />
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
          <div className="mb-3 flex items-center justify-between"><h2 className="text-md font-bold text-ink">Informações do sistema</h2><Chip tone="green"><span className="h-2 w-2 rounded-full bg-success" />Online</Chip></div>
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
              ['/settings/stages', <Filter key="i" className="h-4 w-4 text-purple" />, 'Configurar etapa de venda'],
              ['/settings/integrations', <MessageSquare key="i" className="h-4 w-4 text-success" />, 'Integrar WhatsApp'],
              ['/settings/branding', <Palette key="i" className="h-4 w-4 text-purple" />, 'Personalizar imagens'],
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
            <li>Imagens da marca: Configurações → Personalização.</li>
            <li>Atalhos: <kbd>/</kbd> busca, <kbd>N</kbd> nova oportunidade.</li>
          </ul>
        )}
      </Modal>
    </div>
  );
}

// =================================================================== usuários
type AdminUser = {
  id: string; name: string; email: string; jobTitle: string | null; active: boolean; lastLoginAt: string | null; profile: ProfileKey | null;
  goalSales: number; goalProposals: number; goalLeads: number; hasAvatar: boolean; teamIds: string[]; leadTeamIds: string[];
};

async function fileToBase64(file: File) {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function UserForm({ user, teams, onDone }: { user?: AdminUser; teams: { id: string; name: string }[]; onDone: (temp?: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const [form, setForm] = useState({
    name: user?.name ?? '', email: user?.email ?? '', jobTitle: user?.jobTitle ?? '', profile: (user?.profile ?? 'vendedor') as ProfileKey, active: user?.active ?? true,
    teamIds: user?.teamIds ?? [], leadTeamIds: user?.leadTeamIds ?? [], goalSales: user?.goalSales ?? 0, goalProposals: user?.goalProposals ?? 0, goalLeads: user?.goalLeads ?? 0,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const m = useMutation({
    mutationFn: () => user
      ? api(`/admin/users/${user.id}`, { method: 'PATCH', body: { name: form.name, jobTitle: form.jobTitle || null, profile: form.profile, active: form.active, teamIds: form.teamIds, leadTeamIds: form.leadTeamIds, goalSales: form.goalSales, goalProposals: form.goalProposals, goalLeads: form.goalLeads } })
      : api<{ temporaryPassword: string }>('/admin/users', { method: 'POST', body: { name: form.name, email: form.email, jobTitle: form.jobTitle || null, profile: form.profile, teamIds: form.teamIds, leadTeamIds: form.leadTeamIds } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['admin'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); toast({ tone: 'success', message: user ? 'Usuário atualizado' : 'Usuário cadastrado' }); onDone((r as { temporaryPassword?: string } | undefined)?.temporaryPassword); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); toast({ tone: 'error', message: (e as Error).message }); },
  });
  const self = user?.id === me?.user.id;
  return (
    <form id="user-form" className="space-y-4" noValidate onSubmit={(e: FormEvent) => { e.preventDefault(); if (!m.isPending) m.mutate(); }}>
      <FormField label="Nome" htmlFor="uf-name" required error={errors.name}><Input id="uf-name" value={form.name} onChange={(e) => set('name', e.target.value)} data-autofocus /></FormField>
      {!user && <FormField label="E-mail" htmlFor="uf-email" required error={errors.email}><Input id="uf-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></FormField>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Cargo" htmlFor="uf-job" hint="Aparece abaixo do nome no topo"><Input id="uf-job" value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} placeholder="Ex.: Comercial" /></FormField>
        <FormField label="Perfil de acesso" htmlFor="uf-profile" hint={self ? 'Você não pode tirar o próprio acesso de gerência' : 'Níveis por módulo em Segurança'}>
          <Select id="uf-profile" value={form.profile} disabled={self} onChange={(e) => set('profile', e.target.value as ProfileKey)}>{(['vendedor', 'supervisor', 'gerencia'] as ProfileKey[]).map((p) => <option key={p} value={p}>{PROFILE_LABELS[p]}</option>)}</Select>
        </FormField>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-ink">Times</legend>
        <p className="mb-2 text-xs text-muted">Marque “lidera” para o supervisor ver o time inteiro (nível Equipe).</p>
        <ul className="space-y-1.5">
          {teams.map((t) => {
            const member = form.teamIds.includes(t.id) || form.leadTeamIds.includes(t.id);
            const lead = form.leadTeamIds.includes(t.id);
            return (
              <li key={t.id} className="flex items-center gap-4 rounded-sm border border-line px-3 py-2 text-sm">
                <label className="flex flex-1 items-center gap-2"><input type="checkbox" checked={member} onChange={() => { set('teamIds', member ? form.teamIds.filter((x) => x !== t.id) : [...form.teamIds, t.id]); if (member) set('leadTeamIds', form.leadTeamIds.filter((x) => x !== t.id)); }} />{t.name}</label>
                <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={lead} onChange={() => { set('leadTeamIds', lead ? form.leadTeamIds.filter((x) => x !== t.id) : [...form.leadTeamIds, t.id]); if (!member) set('teamIds', [...form.teamIds, t.id]); }} />lidera</label>
              </li>
            );
          })}
        </ul>
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
      if (f.size > 2 * 1024 * 1024) throw new Error('A imagem passa de 2 MB.');
      return api(`/admin/users/${u.id}/avatar`, { method: 'PUT', body: { data: await fileToBase64(f) } });
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
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Usuário', 'Perfil', 'Times', 'Metas (vendas/propostas/leads)', 'Último acesso', 'Situação', ''].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
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
        {editing && <UserForm key={editing === 'new' ? 'new' : editing.id} user={editing === 'new' ? undefined : editing} teams={teams} onDone={(tp) => { if (tp && editing === 'new') setTemp({ name: 'novo usuário', password: tp }); setEditing(null); }} />}
      </Drawer>
      <Modal open={!!temp} onClose={() => setTemp(null)} title="Senha temporária" size="sm" footer={<Button variant="primary" onClick={() => setTemp(null)}>Já copiei</Button>}>
        <p className="text-sm">Senha temporária para {temp?.name}. Ela aparece só agora; peça para trocar no primeiro acesso em Meu perfil.</p>
        <p className="num mt-3 select-all rounded-sm border border-line bg-surface-2 px-3 py-2 text-center text-lg font-bold text-ink">{temp?.password}</p>
      </Modal>
    </div>
  );
}

// =================================================================== planos
type Plan = { id: string; name: string; line: string | null; segment: Segment; priceCents: number; active: boolean; sourceSystem: string };

export function AdminPlans() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api<{ items: Plan[] }>('/admin/plans') });
  const [editing, setEditing] = useState<Plan | 'new' | null>(() => (new URLSearchParams(location.search).get('novo') ? 'new' : null));
  const [form, setForm] = useState({ name: '', line: '', segment: 'residencial' as Segment, price: '', active: true });
  const open = (p: Plan | 'new') => { setEditing(p); setForm(p === 'new' ? { name: '', line: '', segment: 'residencial', price: '', active: true } : { name: p.name, line: p.line ?? '', segment: p.segment, price: (p.priceCents / 100).toFixed(2).replace('.', ','), active: p.active }); };
  const m = useMutation({
    mutationFn: () => {
      const priceCents = toCents(form.price);
      if (priceCents === null) throw new Error('Informe o preço no formato 99,90.');
      const body = { name: form.name, line: form.line || null, segment: form.segment, priceCents, active: form.active };
      return editing === 'new' ? api('/admin/plans', { method: 'POST', body }) : api(`/admin/plans/${(editing as Plan).id}`, { method: 'PATCH', body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); setEditing(null); toast({ tone: 'success', message: 'Plano salvo' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
        <div><h2 className="text-lg font-bold text-ink">Planos e produtos</h2><p className="text-sm text-muted">O preço daqui é o valor usado nas oportunidades. Catálogo manual até a integração com o IXC.</p></div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => open('new')}>Cadastrar plano</Button>
      </div>
      {q.isLoading ? <LoadingRows /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Plano', 'Linha', 'Segmento', 'Preço mensal', 'Situação', ''].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {q.data?.items.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-5 py-3 font-semibold text-ink">{p.name}</td>
                  <td className="px-5 py-3 text-text">{p.line ?? '—'}</td>
                  <td className="px-5 py-3 text-text">{SEGMENT_LABELS[p.segment]}</td>
                  <td className="num px-5 py-3 text-ink">{fmtBRL(p.priceCents)}</td>
                  <td className="px-5 py-3"><Chip tone={p.active ? 'green' : 'neutral'}>{p.active ? 'Ativo' : 'Inativo'}</Chip></td>
                  <td className="px-5 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => open(p)}>Editar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Cadastrar plano' : 'Editar plano'} size="sm" footer={<><Button onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Salvar</Button></>}>
        <div className="space-y-3">
          <FormField label="Nome" htmlFor="pl-name" required><Input id="pl-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: 500 Mega" data-autofocus /></FormField>
          <FormField label="Linha" htmlFor="pl-line"><Input id="pl-line" value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })} placeholder="Ex.: Yep Família" /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Segmento" htmlFor="pl-seg"><Select id="pl-seg" value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value as Segment })}>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}</Select></FormField>
            <FormField label="Preço mensal (R$)" htmlFor="pl-price" required><Input id="pl-price" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="99,90" /></FormField>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Ativo (aparece para novas oportunidades)</label>
        </div>
      </Modal>
    </section>
  );
}

// =================================================================== etapas
export function AdminStages() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'stages'], queryFn: () => api<{ items: { id: string; key: string; name: string; position: number; isTerminal: boolean }[] }>('/admin/stages') });
  const [names, setNames] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api(`/admin/stages/${id}`, { method: 'PATCH', body: { name } }),
    onSuccess: () => { qc.invalidateQueries(); toast({ tone: 'success', message: 'Etapa renomeada' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold text-ink">Etapas de vendas</h2>
      <p className="mb-4 text-sm text-muted">Você pode renomear as etapas. A ordem e as regras (venda fechada pede confirmação, perda pede motivo, reabrir exige nível Equipe) são do sistema.</p>
      {q.isLoading ? <LoadingRows /> : (
        <ol className="space-y-2">
          {q.data?.items.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line px-4 py-3">
              <span className="num flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary">{i + 1}</span>
              <Input aria-label={`Nome da etapa ${i + 1}`} className="max-w-xs" value={names[s.id] ?? s.name} onChange={(e) => setNames({ ...names, [s.id]: e.target.value })} />
              {s.isTerminal && <Chip tone="neutral">Encerra a oportunidade</Chip>}
              {(names[s.id] ?? s.name) !== s.name && <Button size="sm" variant="primary" loading={m.isPending} onClick={() => m.mutate({ id: s.id, name: names[s.id]! })}>Salvar</Button>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// =================================================================== origens
export function AdminSources() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'sources'], queryFn: () => api<{ items: { id: string; name: string; active: boolean }[] }>('/admin/sources') });
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api('/admin/sources', { method: 'POST', body: { name } }),
    onSuccess: () => { setName(''); qc.invalidateQueries({ queryKey: ['admin'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); toast({ tone: 'success', message: 'Origem cadastrada' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const toggle = useMutation({
    mutationFn: (s: { id: string; active: boolean }) => api(`/admin/sources/${s.id}`, { method: 'PATCH', body: { active: !s.active } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); },
  });
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold text-ink">Origem de leads</h2>
      <p className="mb-4 text-sm text-muted">Origens desativadas somem dos formulários, mas os registros antigos continuam com a origem original.</p>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) create.mutate(); }}>
        <Input aria-label="Nova origem" className="max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Panfleto" />
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
export function AdminIntegrations() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api<Overview>('/admin/overview') });
  const items = [
    { name: 'IXC Provedor', desc: 'Clientes, contratos, planos, cobertura e faturas.', status: `Simulado (${q.data?.system.ixcMode ?? 'mock'}) — leitura real na Fase 4`, icon: <Database className="h-6 w-6" /> },
    { name: 'WhatsApp Business', desc: 'Envio de propostas e lembretes pelo WhatsApp.', status: 'Não conectado', icon: <MessageSquare className="h-6 w-6" /> },
    { name: 'E-mail (SMTP)', desc: 'Alertas e envio de propostas por e-mail.', status: 'Não conectado', icon: <FileText className="h-6 w-6" /> },
  ];
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold text-ink">Integrações</h2>
      <p className="mb-4 text-sm text-muted">Nenhuma integração externa está ativa. Credenciais ficam só no servidor e nunca aparecem aqui.</p>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {items.map((i) => (
          <li key={i.name} className="rounded-md border border-line p-4">
            <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary">{i.icon}</span>
            <p className="font-bold text-ink">{i.name}</p>
            <p className="text-sm text-muted">{i.desc}</p>
            <p className="mt-3"><Chip tone="neutral">{i.status}</Chip></p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AdminNotifications() {
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold text-ink">Notificações</h2>
      <p className="mb-4 text-sm text-muted">Hoje o sino do topo mostra atividades de hoje e vencidas de cada pessoa.</p>
      <Notice>Alertas por e-mail e WhatsApp dependem das integrações e ainda não estão disponíveis.</Notice>
    </section>
  );
}

// =================================================================== segurança
type SecurityData = { profiles: { key: ProfileKey; users: number }[]; modules: { key: Module; allowed: AccessLevel[] }[]; matrix: Record<ProfileKey, Record<Module, AccessLevel>>; defaults: Record<ProfileKey, Record<Module, AccessLevel>> };
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
      <section className="card overflow-hidden">
        <div className="px-5 pb-3 pt-4">
          <h2 className="text-lg font-bold text-ink">Níveis de acesso por módulo</h2>
          <p className="text-sm text-muted">Cada perfil recebe um nível em cada módulo. A regra vale no servidor: a tela e a API obedecem ao mesmo nível. Toda mudança fica no log.</p>
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
              {d.modules.map((mod) => (
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
              ))}
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
const SLOT_INFO: Record<BrandSlot, { label: string; where: string; size: string; bg: string }> = {
  logo_escuro: { label: 'Logo (fundo escuro)', where: 'Menu lateral e tela de login', size: '400 × 120 px', bg: 'bg-navy' },
  logo_claro: { label: 'Logo (fundo claro)', where: 'Exportações e e-mails', size: '400 × 120 px', bg: 'bg-surface-2' },
  favicon: { label: 'Ícone do navegador', where: 'Aba do navegador', size: '256 × 256 px', bg: 'bg-surface-2' },
  banner_inicio: { label: 'Banner do Início', where: 'Arte à direita do destaque “Uma venda mais fácil…” (sem texto)', size: '1600 × 600 px', bg: 'bg-[#0B3AA6]' },
  card_sidebar: { label: 'Card do menu lateral', where: 'Arte de fundo do “Confiar ficou fácil.” (o texto é aplicado pelo sistema)', size: '400 × 600 px', bg: 'bg-navy' },
  mascote_leads: { label: 'Mascote — Leads', where: 'Cabeçalho da tela Leads', size: '400 × 400 px', bg: 'bg-surface-2' },
  mascote_oportunidades: { label: 'Mascote — Oportunidades', where: 'Cabeçalho da tela Oportunidades', size: '400 × 400 px', bg: 'bg-surface-2' },
  mascote_clientes: { label: 'Mascote — Clientes', where: 'Cabeçalho da tela Clientes', size: '400 × 400 px', bg: 'bg-surface-2' },
  mascote_atividades: { label: 'Mascote — Atividades', where: 'Cabeçalho da tela Atividades', size: '400 × 400 px', bg: 'bg-surface-2' },
  mascote_relatorios: { label: 'Mascote — Relatórios', where: 'Cabeçalho da tela Relatórios', size: '400 × 400 px', bg: 'bg-surface-2' },
  mascote_inteligencia: { label: 'Mascote — Inteligência', where: 'Cabeçalho da tela Inteligência', size: '400 × 400 px', bg: 'bg-surface-2' },
  mascote_administracao: { label: 'Mascote — Administração', where: 'Cabeçalho da tela Administração', size: '400 × 400 px', bg: 'bg-surface-2' },
};

function SlotCard({ slot, info }: { slot: BrandSlot; info?: { hasImage: boolean; sizeBytes?: number; updatedAt?: string; updatedByName?: string | null } }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { bump } = useBrand();
  const file = useRef<HTMLInputElement>(null);
  const meta = SLOT_INFO[slot];
  const upload = useMutation({
    mutationFn: async (f: File) => {
      if (!IMG_TYPES.includes(f.type)) throw new Error('Formato não aceito. Envie PNG, JPG ou WebP (SVG não é aceito).');
      if (f.size > 2 * 1024 * 1024) throw new Error('A imagem passa de 2 MB.');
      return api(`/admin/branding/${slot}`, { method: 'PUT', body: { data: await fileToBase64(f) } });
    },
    onSuccess: () => { bump(); qc.invalidateQueries({ queryKey: ['admin', 'branding'] }); toast({ tone: 'success', message: `${meta.label} atualizado` }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/admin/branding/${slot}`, { method: 'DELETE' }),
    onSuccess: () => { bump(); qc.invalidateQueries({ queryKey: ['admin', 'branding'] }); toast({ tone: 'success', message: `${meta.label} removido` }); },
  });
  return (
    <li className="card flex flex-col overflow-hidden">
      <div className={clsx('flex h-36 items-center justify-center', meta.bg)}>
        {info?.hasImage ? <BrandImage slot={slot} alt={meta.label} className="max-h-32 max-w-[90%] object-contain" /> : <span className="flex flex-col items-center gap-1 text-sm text-muted"><ImageIcon className="h-8 w-8" />Sem imagem</span>}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <p className="font-bold text-ink">{meta.label}</p>
        <p className="text-sm text-muted">{meta.where}</p>
        <p className="mt-1 text-xs text-faint">Recomendado: {meta.size} · PNG, JPG ou WebP até 2 MB</p>
        {info?.hasImage && info.updatedAt && <p className="mt-1 text-xs text-faint">Enviado {fmtDateTime(info.updatedAt)}{info.updatedByName ? ` por ${info.updatedByName}` : ''} · {Math.round((info.sizeBytes ?? 0) / 1024)} KB</p>}
        <div className="mt-auto flex gap-2 pt-3">
          <Button size="sm" variant="primary" icon={info?.hasImage ? <RefreshCw className="h-4 w-4" /> : <Upload className="h-4 w-4" />} loading={upload.isPending} onClick={() => file.current?.click()}>{info?.hasImage ? 'Trocar' : 'Enviar imagem'}</Button>
          {info?.hasImage && <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} loading={remove.isPending} onClick={() => remove.mutate()}>Remover</Button>}
        </div>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label={`Arquivo para ${meta.label}`} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
      </div>
    </li>
  );
}

export function AdminBranding() {
  const q = useQuery({ queryKey: ['admin', 'branding'], queryFn: () => api<{ slots: ({ slot: BrandSlot; hasImage: boolean; sizeBytes?: number; updatedAt?: string; updatedByName?: string | null })[] }>('/admin/branding') });
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="text-lg font-bold text-ink">Personalização</h2>
        <p className="text-sm text-muted">Envie as imagens da identidade visual. Valem para a empresa inteira. Sem imagem, o espaço fica vazio ou mostra só o texto, sem quebrar o layout. Os textos dos balões são fixos.</p>
      </section>
      {q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data!.slots.map((s) => <SlotCard key={s.slot} slot={s.slot} info={s} />)}
        </ul>
      )}
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
