/**
 * Usuários → Organograma de acessos (identidade BKT): Diretoria e Administração → Gerência e gestores → Times (liderança
 * em cima, pessoas embaixo). Um filtro por módulo pinta cada card com o que a pessoa enxerga — Empresa toda, Time,
 * Só o próprio ou Sem acesso — calculado pelas mesmas regras que o sistema aplica. Clicar numa pessoa ou num time abre o
 * painel com o porquê e as ações: liberar ou bloquear o módulo (com motivo e validade, auditado) e trocar o perfil.
 */
import { useMemo, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { GripVertical, Pencil, Plus, X } from 'lucide-react';
import type { AccessLevel, BusinessModule, ProfileKey } from '@isp/domain';
import { api } from '../../lib/api';
import { Hexagons } from '../../components/brand';
import { Multi } from '../playbooks/Editor';
import { Avatar, Button, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { ConfirmDialog, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type View = { level: AccessLevel; enabled: boolean; reason: string; profileLevel: AccessLevel };
type Person = { id: string; name: string; jobTitle: string | null; hasAvatar: boolean; profile: ProfileKey | null; view: Record<BusinessModule, View> };
type Team = { id: string; name: string; managerIds: string[]; leadIds: string[]; memberIds: string[] };
type Grant = { id: string; module: BusinessModule; subjectType: 'equipe' | 'usuario'; subjectId: string; effect: 'liberar' | 'bloquear'; reason: string; validUntil: string | null };
type Chart = { top: { name: string | null; title: string | null }; modules: { key: BusinessModule; label: string; technical: string[] }[]; profiles: { key: ProfileKey; label: string }[]; people: Person[]; teams: Team[]; grants: Grant[] };

/** Visualização em escala de azuis da marca; "sem acesso" em grafite tracejado. O texto acompanha a cor (não depende só dela). */
const LEVEL: Record<AccessLevel, { label: string; bar: string; chip: string }> = {
  total: { label: 'Empresa toda', bar: 'bg-primary', chip: 'bg-primary text-white' },
  equipe: { label: 'Time', bar: 'bg-sky', chip: 'bg-sky text-white' },
  proprio: { label: 'Só o próprio', bar: 'bg-lime', chip: 'bg-lime/25 text-ink' },
  nenhum: { label: 'Sem acesso', bar: 'bg-[repeating-linear-gradient(135deg,rgb(var(--purple))_0_3px,transparent_3px_6px)]', chip: 'border border-dashed border-purple text-muted' },
};
const REASON: Record<string, string> = {
  todos: 'módulo liberado para todos os perfis com acesso', nao_liberado: 'módulo só para liberados, e a pessoa não está liberada', empresa_desligou: 'módulo desligado na empresa',
  pessoa_bloqueada: 'bloqueado para a pessoa', pessoa_liberada: 'liberado para a pessoa', equipe_bloqueada: 'bloqueado para o time', equipe_liberada: 'liberado para o time',
};
const PROFILE_ORDER: ProfileKey[] = ['diretoria', 'administrador', 'gerencia', 'supervisor', 'operacao'] as ProfileKey[];
const hex = { clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)' };

function HexAvatar({ p, size = 44 }: { p: Person; size?: number }) {
  return <span className="shrink-0 bg-line p-[2px]" style={{ ...hex, width: size + 4, height: size + 4 }}><span className="block overflow-hidden" style={{ ...hex, width: size, height: size }}><Avatar name={p.name} userId={p.id} hasPhoto={p.hasAvatar} size={size} className="!rounded-none" /></span></span>;
}

type DragInfo = { userId: string; fromTeamId: string | null };
function PersonCard({ p, module, profiles, onOpen, active, note, edit, fromTeamId }: { p: Person; module: BusinessModule | null; profiles: Chart['profiles']; onOpen: () => void; active: boolean; note?: string; edit?: boolean; fromTeamId?: string | null }) {
  const lv = module ? p.view[module].level : null;
  const label = profiles.find((x) => x.key === p.profile)?.label ?? 'Sem perfil';
  const onDragStart = (e: DragEvent) => { e.dataTransfer.setData('application/x-revops-person', JSON.stringify({ userId: p.id, fromTeamId: fromTeamId ?? null } satisfies DragInfo)); e.dataTransfer.effectAllowed = 'move'; };
  return (
    <button type="button" onClick={onOpen} data-testid="org-person" aria-label={`${p.name}, ${label}${lv ? `: ${LEVEL[lv].label}` : ''}`} draggable={!!edit} onDragStart={edit ? onDragStart : undefined}
      className={clsx('group relative flex w-[232px] items-center gap-3 border bg-surface py-2.5 pl-4 pr-3 text-left shadow-card transition-colors hover:border-primary', active ? 'border-primary ring-2 ring-primary/30' : 'border-line', edit && 'cursor-grab active:cursor-grabbing')}>
      {edit && <GripVertical className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-faint" aria-hidden />}
      <span className={clsx('absolute inset-y-0 left-0 w-1.5', lv ? LEVEL[lv].bar : 'bg-ink')} aria-hidden />
      <HexAvatar p={p} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{p.name}</span>
        <span className="block truncate text-xs text-muted">{p.jobTitle || label}</span>
        {lv ? <span className={clsx('mt-1 inline-block px-1.5 py-0.5 text-[11px] font-semibold', LEVEL[lv].chip)} data-testid="org-level">{LEVEL[lv].label}</span>
          : <span className="mt-1 flex gap-[3px]" aria-hidden>{(Object.keys(p.view) as BusinessModule[]).map((m) => <span key={m} className={clsx('h-2 w-2', LEVEL[p.view[m].level].bar)} />)}</span>}
        {note && <span className="block text-[11px] text-muted">{note}</span>}
      </span>
    </button>
  );
}

function TeamBox({ t, people, module, profiles, open, sel, managersAlso, edit, onDrop }: { t: Team; people: Map<string, Person>; module: BusinessModule | null; profiles: Chart['profiles']; open: (x: Sel) => void; sel: Sel | null; managersAlso: string[]; edit: boolean; onDrop: (d: DragInfo, teamId: string) => void }) {
  const leads = t.leadIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const members = t.memberIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const [over, setOver] = useState(false);
  const dnd = edit ? {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('application/x-revops-person')) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); try { onDrop(JSON.parse(e.dataTransfer.getData('application/x-revops-person')) as DragInfo, t.id); } catch { /* arrasto de outra origem */ } },
  } : {};
  return (
    <div className={clsx('border bg-surface-2 transition-colors', over ? 'border-primary bg-primary-soft outline outline-2 outline-primary' : 'border-ink/80')} data-testid="org-team" aria-label={`Time ${t.name}`} {...dnd}>
      <button type="button" onClick={() => open({ kind: 'team', id: t.id })} className={clsx('relative flex w-full items-center gap-2 overflow-hidden bg-ink px-3 py-2 text-left text-white hover:bg-navy-2', sel?.kind === 'team' && sel.id === t.id && 'outline outline-2 outline-lime')}>
        <span className="h-3.5 w-3.5 shrink-0 bg-lime" style={hex} aria-hidden />
        <span className="font-display text-sm font-bold tracking-wide">{t.name}</span>
        <span className="ml-auto text-xs text-white/70">{leads.length + members.length} pessoa(s)</span>
      </button>
      {!!managersAlso.length && <p className="px-3 pt-1.5 text-[11px] text-muted">Também gerido por {managersAlso.join(', ')}</p>}
      <div className="space-y-2 p-3">
        {leads.map((p) => <PersonCard key={p.id} p={p} module={module} profiles={profiles} onOpen={() => open({ kind: 'person', id: p.id })} active={sel?.kind === 'person' && sel.id === p.id} note="Liderança do time" edit={edit} fromTeamId={t.id} />)}
        {!!leads.length && !!members.length && <div className="ml-6 h-3 border-l-2 border-line-strong" aria-hidden />}
        {members.map((p) => <PersonCard key={p.id} p={p} module={module} profiles={profiles} onOpen={() => open({ kind: 'person', id: p.id })} active={sel?.kind === 'person' && sel.id === p.id} edit={edit} fromTeamId={t.id} />)}
        {!leads.length && !members.length && <p className="text-xs text-muted">Sem pessoas ativas.</p>}
        {edit && <p className="border border-dashed border-line-strong px-2 py-1.5 text-center text-[11px] text-muted">Solte uma pessoa aqui para trazer ao time</p>}
      </div>
    </div>
  );
}

type Sel = { kind: 'person' | 'team'; id: string };

export function OrgChart() {
  const q = useQuery({ queryKey: ['admin', 'org-chart'], queryFn: () => api<Chart>('/admin/org-chart') });
  const [module, setModule] = useState<BusinessModule | null>('crm');
  const [sel, setSel] = useState<Sel | null>(null);
  const [edit, setEdit] = useState(false);
  const [topForm, setTopForm] = useState<{ name: string; title: string } | null>(null);
  const [newTeam, setNewTeam] = useState<string | null>(null);
  const qc = useQueryClient(), toast = useToast();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin'] });
  const move = useMutation({
    mutationFn: (x: DragInfo & { toTeamId: string }) => api('/admin/org-chart/move', { method: 'POST', body: { userId: x.userId, fromTeamId: x.fromTeamId, toTeamId: x.toTeamId, lead: false } }),
    onSuccess: () => { toast({ tone: 'success', message: 'Pessoa movida de time' }); refresh(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const saveTop = useMutation({
    mutationFn: () => api('/admin/org-chart/top', { method: 'PUT', body: { name: topForm!.name, title: topForm!.title || null } }),
    onSuccess: () => { setTopForm(null); refresh(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const createTeam = useMutation({
    mutationFn: () => api('/admin/teams', { method: 'POST', body: { name: newTeam } }),
    onSuccess: () => { toast({ tone: 'success', message: 'Time criado: monte gestores, liderança e pessoas no painel' }); setNewTeam(null); refresh(); void qc.invalidateQueries({ queryKey: ['lookups'] }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const drop = (d: DragInfo, toTeamId: string) => { if (d.fromTeamId !== toTeamId) move.mutate({ ...d, toTeamId }); };
  const tree = useMemo(() => {
    if (!q.data) return null;
    const d = q.data, people = new Map(d.people.map((p) => [p.id, p]));
    const top = d.people.filter((p) => p.profile === 'diretoria' || p.profile === 'administrador').sort((a, b) => PROFILE_ORDER.indexOf(a.profile!) - PROFILE_ORDER.indexOf(b.profile!));
    // gestores: quem gere algum time, mais a Gerência
    const mgrIds = [...new Set([...d.teams.flatMap((t) => t.managerIds), ...d.people.filter((p) => p.profile === 'gerencia').map((p) => p.id)])].filter((id) => people.has(id) && !top.some((x) => x.id === id));
    const managers = mgrIds.map((id) => people.get(id)!).sort((a, b) => a.name.localeCompare(b.name));
    const teamsOf = (mid: string) => d.teams.filter((t) => t.managerIds.find((x) => people.has(x)) === mid);
    const loose = d.teams.filter((t) => !t.managerIds.some((x) => people.has(x)));
    const inTeam = new Set(d.teams.flatMap((t) => [...t.leadIds, ...t.memberIds]));
    const noTeam = d.people.filter((p) => !inTeam.has(p.id) && !top.some((x) => x.id === p.id) && !mgrIds.includes(p.id));
    return { people, top, managers, teamsOf, loose, noTeam };
  }, [q.data]);

  if (q.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!, t = tree!;
  const open = (x: Sel) => setSel(x);
  const mgrNames = (team: Team, except: string) => team.managerIds.filter((x) => x !== except && t.people.has(x)).map((x) => t.people.get(x)!.name);
  const card = (p: Person, note?: string) => <PersonCard key={p.id} p={p} module={module} profiles={d.profiles} onOpen={() => open({ kind: 'person', id: p.id })} active={sel?.kind === 'person' && sel.id === p.id} note={note} edit={edit} fromTeamId={null} />;
  const box = (team: Team, also: string[]) => <TeamBox key={team.id} t={team} people={t.people} module={module} profiles={d.profiles} open={open} sel={sel} managersAlso={also} edit={edit} onDrop={drop} />;

  return (
    <div className="space-y-0">
      {/* faixa da marca: degradê grafite → azul só no fundo, símbolo como marca-d'água */}
      <header className="relative overflow-hidden bg-gradient-to-r from-navy-2 via-navy to-primary px-6 py-5 text-white">
        <Hexagons className="absolute inset-0" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold tracking-wide">Organograma de acessos</h2>
            <p className="mt-1 max-w-2xl text-sm text-white/80">Quem vê o quê em cada módulo, pela estrutura de times. Clique numa pessoa ou num time para ver o porquê e ajustar.</p>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legenda">
            {(['total', 'equipe', 'proprio', 'nenhum'] as AccessLevel[]).map((l) => <span key={l} className="flex items-center gap-1.5"><span className={clsx('h-3 w-3', LEVEL[l].bar, l === 'nenhum' && 'bg-white/20')} />{LEVEL[l].label}</span>)}
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Módulo">
          <button type="button" aria-pressed={!module} onClick={() => setModule(null)} className={clsx('border px-3 py-1.5 text-sm font-semibold', !module ? 'border-white bg-white text-ink' : 'border-white/30 text-white hover:border-white')}>Visão geral</button>
          {d.modules.map((m) => <button key={m.key} type="button" aria-pressed={module === m.key} onClick={() => setModule(m.key)} className={clsx('border px-3 py-1.5 text-sm font-semibold', module === m.key ? 'border-white bg-white text-ink' : 'border-white/30 text-white hover:border-white')}>{m.label}</button>)}
          <span className="ml-auto flex gap-1.5">
            {edit && <button type="button" onClick={() => setNewTeam('')} className="inline-flex items-center gap-1.5 border border-white/30 px-3 py-1.5 text-sm font-semibold text-white hover:border-white"><Plus className="h-4 w-4" />Novo time</button>}
            <button type="button" aria-pressed={edit} onClick={() => setEdit((v) => !v)} className={clsx('inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold', edit ? 'border-lime bg-lime text-ink' : 'border-white/30 text-white hover:border-white')}>{edit ? 'Concluir ajustes' : 'Ajustar estrutura'}</button>
          </span>
        </div>
        {edit && <p className="relative mt-3 text-sm text-white/85">Arraste uma pessoa para outro time. Clique num time para definir gestores, liderança e pessoas; clique numa pessoa para os times, as liberações e o perfil. Tudo fica registrado na auditoria.</p>}
        {newTeam !== null && (
          <form className="relative mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); createTeam.mutate(); }}>
            <label className="text-sm text-white/85" htmlFor="oc-nt">Nome do novo time<Input id="oc-nt" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} className="mt-1 w-64 !border-white/30 !bg-white/10 !text-white" /></label>
            <Button type="submit" variant="primary" disabled={newTeam.trim().length < 2} loading={createTeam.isPending}>Criar time</Button><Button onClick={() => setNewTeam(null)}>Cancelar</Button>
          </form>
        )}
      </header>

      <div className="grid border border-t-0 border-line bg-bg lg:grid-cols-[1fr_auto]">
        <div className="overflow-x-auto p-6">
          <div className="mx-auto flex w-max min-w-full flex-col items-center">
            {/* topo da estrutura (quem encabeça), editável */}
            {topForm ? (
              <form className="flex flex-wrap items-end gap-2 border border-primary bg-surface p-3 shadow-card" onSubmit={(e) => { e.preventDefault(); saveTop.mutate(); }} aria-label="Topo da estrutura">
                <FormField label="Nome" htmlFor="oc-tn"><Input id="oc-tn" value={topForm.name} onChange={(e) => setTopForm({ ...topForm, name: e.target.value })} /></FormField>
                <FormField label="Cargo" htmlFor="oc-tt"><Input id="oc-tt" value={topForm.title} onChange={(e) => setTopForm({ ...topForm, title: e.target.value })} /></FormField>
                <Button type="submit" variant="primary" disabled={topForm.name.trim().length < 2} loading={saveTop.isPending}>Salvar</Button><Button onClick={() => setTopForm(null)}>Cancelar</Button>
              </form>
            ) : (
              <div className="relative min-w-[280px] overflow-hidden border-l-4 border-primary bg-ink px-6 py-3.5 text-white shadow-card" data-testid="org-top">
                <p className="font-display text-base font-bold tracking-wide">{d.top.name ?? 'Defina quem encabeça a estrutura'}</p>
                {d.top.title && <p className="text-sm text-white/75">{d.top.title}</p>}
                <button type="button" onClick={() => setTopForm({ name: d.top.name ?? '', title: d.top.title ?? '' })} aria-label="Editar o topo da estrutura" className="absolute right-2 top-2 p-1 text-white/60 hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>
              </div>
            )}
            <span className="h-6 w-0.5 bg-line-strong" aria-hidden />
            {!!t.top.length && (
              <section aria-label="Diretoria e Administração" className="flex flex-col items-center">
                <p className="mb-2 text-xs font-semibold text-muted">Diretoria e Administração</p>
                <div className="flex flex-wrap justify-center gap-3">{t.top.map((p) => card(p))}</div>
                <span className="h-6 w-0.5 bg-line-strong" aria-hidden />
              </section>
            )}
            <section aria-label="Gerência e times" className="flex flex-col items-center">
              <p className="mb-2 text-xs font-semibold text-muted">Gerência, gestores e times</p>
              <div className="flex items-start gap-8 border-t-2 border-line-strong pt-6">
                {t.managers.map((m) => (
                  <div key={m.id} className="relative flex flex-col items-center">
                    <span className="absolute -top-6 h-6 w-0.5 bg-line-strong" aria-hidden />
                    {card(m)}
                    {!!t.teamsOf(m.id).length && <>
                      <span className="h-5 w-0.5 bg-line-strong" aria-hidden />
                      <div className="flex items-start gap-4">{t.teamsOf(m.id).map((team) => box(team, mgrNames(team, m.id)))}</div>
                    </>}
                  </div>
                ))}
                {!!t.loose.length && (
                  <div className="relative flex flex-col items-center">
                    <span className="absolute -top-6 h-6 w-0.5 bg-line-strong" aria-hidden />
                    <p className="mb-2 border border-dashed border-line-strong bg-surface px-3 py-2 text-xs text-muted">Times sem gestor definido</p>
                    <div className="flex items-start gap-4">{t.loose.map((team) => box(team, []))}</div>
                  </div>
                )}
              </div>
            </section>
            {!!t.noTeam.length && (
              <section aria-label="Pessoas sem time" className="mt-8 w-full max-w-4xl border border-dashed border-line-strong bg-surface p-4">
                <p className="mb-2 text-sm font-semibold text-ink">Pessoas sem time <span className="font-normal text-muted">· no nível "Time" elas não aparecem para nenhuma liderança</span></p>
                <div className="flex flex-wrap gap-3">{t.noTeam.map((p) => card(p))}</div>
              </section>
            )}
          </div>
        </div>
        {sel && <SidePanel key={`${sel.kind}:${sel.id}`} chart={d} sel={sel} onClose={() => setSel(null)} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ painel: o porquê e as ações
function SidePanel({ chart, sel, onClose }: { chart: Chart; sel: Sel; onClose: () => void }) {
  const qc = useQueryClient(), toast = useToast();
  const person = sel.kind === 'person' ? chart.people.find((p) => p.id === sel.id) ?? null : null;
  const team = sel.kind === 'team' ? chart.teams.find((t) => t.id === sel.id) ?? null : null;
  const subjectType = person ? 'usuario' : 'equipe';
  const [form, setForm] = useState<{ module: BusinessModule; effect: 'liberar' | 'bloquear' } | null>(null);
  const [reason, setReason] = useState(''), [until, setUntil] = useState('');
  const [revoke, setRevoke] = useState<Grant | null>(null), [note, setNote] = useState('');
  const [profile, setProfile] = useState<ProfileKey | ''>(person?.profile ?? '');
  const [comp, setComp] = useState<{ managerIds: string[]; leadIds: string[]; memberIds: string[] } | null>(team ? { managerIds: team.managerIds, leadIds: team.leadIds, memberIds: team.memberIds } : null);
  const [addTo, setAddTo] = useState(''), [addLead, setAddLead] = useState(false);
  const [lvlAsk, setLvlAsk] = useState<{ module: BusinessModule; level: AccessLevel } | null>(null);
  const saveTeam = useMutation({
    mutationFn: () => api(`/admin/org-chart/teams/${sel.id}`, { method: 'PUT', body: comp }),
    onSuccess: () => { toast({ tone: 'success', message: 'Time atualizado' }); refresh(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const moveTo = useMutation({
    mutationFn: (x: { fromTeamId: string | null; toTeamId: string; lead: boolean }) => api('/admin/org-chart/move', { method: 'POST', body: { userId: sel.id, ...x } }),
    onSuccess: () => { toast({ tone: 'success', message: 'Times atualizados' }); setAddTo(''); setAddLead(false); refresh(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const leave = useMutation({
    mutationFn: (teamId: string) => { const t = chart.teams.find((x) => x.id === teamId)!; return api(`/admin/org-chart/teams/${teamId}`, { method: 'PUT', body: { managerIds: t.managerIds, leadIds: t.leadIds.filter((x) => x !== sel.id), memberIds: t.memberIds.filter((x) => x !== sel.id) } }); },
    onSuccess: () => { toast({ tone: 'success', message: 'Pessoa retirada do time' }); refresh(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const setLevel = useMutation({
    mutationFn: async (x: { module: BusinessModule; level: AccessLevel }) => {
      const techs = chart.modules.find((m) => m.key === x.module)!.technical;
      for (const t of techs) await api('/admin/security', { method: 'PUT', body: { profile: person!.profile, module: t, level: x.level } });
    },
    onSuccess: () => { toast({ tone: 'success', message: `Nível do perfil ${profileLabel} atualizado` }); setLvlAsk(null); refresh(); },
    onError: (e) => { setLvlAsk(null); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['admin'] }); };
  const grant = useMutation({
    mutationFn: () => api(`/admin/modules/${form!.module}/grants`, { method: 'POST', body: { subjectType, subjectId: sel.id, effect: form!.effect, reason, validUntil: until || null } }),
    onSuccess: () => { toast({ tone: 'success', message: form!.effect === 'liberar' ? 'Módulo liberado' : 'Módulo bloqueado' }); setForm(null); setReason(''); setUntil(''); refresh(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const unGrant = useMutation({
    mutationFn: () => api(`/admin/module-grants/${revoke!.id}/revoke`, { method: 'POST', body: { note } }),
    onSuccess: () => { toast({ tone: 'success', message: 'Regra retirada: vale a regra do módulo' }); setRevoke(null); setNote(''); refresh(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const saveProfile = useMutation({
    mutationFn: () => api(`/admin/users/${sel.id}`, { method: 'PUT', body: { profile } }),
    onSuccess: () => { toast({ tone: 'success', message: 'Perfil atualizado' }); refresh(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (!person && !team) return null;
  const own = (m: BusinessModule) => chart.grants.find((g) => g.module === m && g.subjectType === subjectType && g.subjectId === sel.id) ?? null;
  const profileLabel = person ? chart.profiles.find((x) => x.key === person.profile)?.label ?? '' : '';
  const samePerfil = person ? chart.people.filter((p) => p.profile === person.profile).length : 0;
  const name = (id: string) => chart.people.find((p) => p.id === id)?.name ?? '—';
  return (
    <aside aria-label={person ? `Acesso de ${person.name}` : `Time ${team!.name}`} className="w-full border-l border-line bg-surface lg:w-[380px]" data-testid="org-panel">
      <div className="relative overflow-hidden bg-ink px-5 py-4 text-white">
        <Hexagons className="absolute inset-0" />
        <button type="button" onClick={onClose} aria-label="Fechar painel" className="absolute right-3 top-3 p-1 text-white/70 hover:text-white"><X className="h-4 w-4" /></button>
        {person ? (
          <div className="relative flex items-center gap-3"><HexAvatar p={person} size={52} /><div><p className="font-display text-base font-bold tracking-wide">{person.name}</p><p className="text-sm text-white/75">{chart.profiles.find((x) => x.key === person.profile)?.label ?? 'Sem perfil'}{person.jobTitle ? ` · ${person.jobTitle}` : ''}</p></div></div>
        ) : (
          <div className="relative"><p className="font-display text-base font-bold tracking-wide">Time {team!.name}</p><p className="text-sm text-white/75">Gestão: {team!.managerIds.map(name).join(', ') || 'sem gestor'} · Liderança: {team!.leadIds.map(name).join(', ') || 'sem liderança'} · {team!.memberIds.length} pessoa(s)</p></div>
        )}
      </div>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
        {person && (
          <div className="flex items-end gap-2">
            <FormField label="Perfil" htmlFor="oc-prof" className="flex-1"><Select id="oc-prof" value={profile} onChange={(e) => setProfile(e.target.value as ProfileKey)}>{chart.profiles.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</Select></FormField>
            <Button variant="primary" disabled={!profile || profile === person.profile} loading={saveProfile.isPending} onClick={() => saveProfile.mutate()}>Trocar perfil</Button>
          </div>
        )}
        {person && (() => {
          const mine = chart.teams.filter((t) => t.leadIds.includes(person.id) || t.memberIds.includes(person.id));
          const others = chart.teams.filter((t) => !mine.includes(t));
          return (
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">Times</p>
              {!mine.length ? <p className="text-xs text-muted">Sem time: no nível "Time", nenhuma liderança enxerga esta pessoa.</p> : (
                <ul className="divide-y divide-line border border-line" aria-label="Times da pessoa">{mine.map((t) => {
                  const lead = t.leadIds.includes(person.id);
                  return (
                    <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className="flex-1 font-semibold text-ink">{t.name}<span className="ml-1.5 text-xs font-normal text-muted">{lead ? 'liderança' : 'membro'}</span></span>
                      <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => moveTo.mutate({ fromTeamId: t.id, toTeamId: t.id, lead: !lead })}>{lead ? 'Tirar liderança' : 'Tornar liderança'}</button>
                      <button type="button" className="text-xs font-semibold text-danger hover:underline" onClick={() => leave.mutate(t.id)}>Tirar do time</button>
                    </li>
                  );
                })}</ul>
              )}
              {!!others.length && (
                <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (addTo) moveTo.mutate({ fromTeamId: null, toTeamId: addTo, lead: addLead }); }}>
                  <FormField label="Incluir em outro time" htmlFor="oc-add" className="min-w-[160px] flex-1"><Select id="oc-add" value={addTo} onChange={(e) => setAddTo(e.target.value)}><option value="">Escolha o time</option>{others.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>
                  <label className="flex h-10 items-center gap-1.5 text-xs text-ink"><input type="checkbox" checked={addLead} onChange={(e) => setAddLead(e.target.checked)} />como liderança</label>
                  <Button type="submit" size="sm" disabled={!addTo} loading={moveTo.isPending}>Incluir</Button>
                </form>
              )}
            </div>
          );
        })()}
        {team && comp && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveTeam.mutate(); }} aria-label="Composição do time">
            <p className="text-sm font-semibold text-ink">Composição do time</p>
            <Multi label="Gestores (veem e acompanham este time)" options={chart.people.map((p) => ({ id: p.id, label: p.name }))} value={comp.managerIds} onChange={(v) => setComp({ ...comp, managerIds: v })} />
            <Multi label="Liderança" options={chart.people.map((p) => ({ id: p.id, label: p.name }))} value={comp.leadIds} onChange={(v) => setComp({ ...comp, leadIds: v, memberIds: comp.memberIds.filter((x) => !v.includes(x)) })} />
            <Multi label="Pessoas do time" options={chart.people.filter((p) => !comp.leadIds.includes(p.id)).map((p) => ({ id: p.id, label: p.name }))} value={comp.memberIds} onChange={(v) => setComp({ ...comp, memberIds: v })} />
            <Button type="submit" variant="primary" loading={saveTeam.isPending}>Salvar time</Button>
          </form>
        )}
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">{person ? 'O que enxerga em cada módulo' : 'Regras do time por módulo'}</p>
          <ul className="divide-y divide-line border border-line">{chart.modules.map((m) => {
            const v = person?.view[m.key], g = own(m.key);
            return (
              <li key={m.key} className="px-3 py-2.5" data-testid={`org-mod-${m.key}`}>
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-sm font-semibold text-ink">{m.label}</span>
                  {v && <span className={clsx('px-1.5 py-0.5 text-[11px] font-semibold', LEVEL[v.level].chip)}>{LEVEL[v.level].label}</span>}
                </div>
                {v && <p className="text-xs text-muted">{v.enabled ? `${REASON[v.reason] ?? v.reason}; o nível vem do perfil` : REASON[v.reason] ?? v.reason}</p>}
                {v && person?.profile && (
                  <label className="mt-1.5 flex items-center gap-2 text-xs text-text">Nível do perfil {profileLabel}
                    <Select aria-label={`Nível do perfil ${profileLabel} em ${m.label}`} value={v.profileLevel} onChange={(e) => setLvlAsk({ module: m.key, level: e.target.value as AccessLevel })} className="h-8 w-36 text-xs">
                      {(['nenhum', 'proprio', 'equipe', 'total'] as AccessLevel[]).map((l) => <option key={l} value={l}>{LEVEL[l].label}</option>)}
                    </Select>
                  </label>
                )}
                {g && <p className="mt-0.5 text-xs text-text">Regra {person ? 'da pessoa' : 'do time'}: <b>{g.effect === 'liberar' ? 'liberado' : 'bloqueado'}</b>{g.validUntil ? ` até ${g.validUntil.split('-').reverse().join('/')}` : ''} — {g.reason}</p>}
                <div className="mt-1.5 flex gap-3 text-xs font-semibold">
                  {g ? <button type="button" className="text-primary hover:underline" onClick={() => { setRevoke(g); setForm(null); }}>Retirar regra</button> : <>
                    <button type="button" className="text-primary hover:underline" onClick={() => { setForm({ module: m.key, effect: 'liberar' }); setRevoke(null); }}>Liberar</button>
                    <button type="button" className="text-danger hover:underline" onClick={() => { setForm({ module: m.key, effect: 'bloquear' }); setRevoke(null); }}>Bloquear</button>
                  </>}
                </div>
                {form?.module === m.key && (
                  <form className="mt-2 space-y-2 border-l-2 border-primary pl-3" onSubmit={(e) => { e.preventDefault(); grant.mutate(); }}>
                    <FormField label={`Motivo para ${form.effect === 'liberar' ? 'liberar' : 'bloquear'}`} htmlFor={`oc-r-${m.key}`}><Input id={`oc-r-${m.key}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: acompanha os contratos do time" /></FormField>
                    <FormField label="Vale até (opcional)" htmlFor={`oc-u-${m.key}`}><Input id={`oc-u-${m.key}`} type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></FormField>
                    <div className="flex gap-2"><Button size="sm" type="submit" variant="primary" loading={grant.isPending}>{form.effect === 'liberar' ? 'Liberar' : 'Bloquear'} {m.label}</Button><Button size="sm" onClick={() => setForm(null)}>Cancelar</Button></div>
                  </form>
                )}
                {revoke?.module === m.key && (
                  <form className="mt-2 space-y-2 border-l-2 border-primary pl-3" onSubmit={(e) => { e.preventDefault(); unGrant.mutate(); }}>
                    <FormField label="Por que retirar a regra?" htmlFor={`oc-n-${m.key}`} hint="Pelo menos 10 caracteres; fica na auditoria."><Input id={`oc-n-${m.key}`} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
                    <div className="flex gap-2"><Button size="sm" type="submit" variant="primary" loading={unGrant.isPending}>Retirar regra</Button><Button size="sm" onClick={() => setRevoke(null)}>Cancelar</Button></div>
                  </form>
                )}
              </li>
            );
          })}</ul>
        </div>
        <ConfirmDialog open={!!lvlAsk} title={`Mudar o nível do perfil ${profileLabel}?`} confirmLabel="Mudar para todo o perfil" loading={setLevel.isPending} onConfirm={() => lvlAsk && setLevel.mutate(lvlAsk)} onCancel={() => setLvlAsk(null)}>
          {lvlAsk && <>Em {chart.modules.find((m) => m.key === lvlAsk.module)?.label}, o perfil {profileLabel} passa a ver: <b>{LEVEL[lvlAsk.level].label}</b>. Vale para as {samePerfil} pessoa(s) com esse perfil, não só para {person?.name}. Para mudar só esta pessoa, use Liberar ou Bloquear, ou troque o perfil dela.</>}
        </ConfirmDialog>
        <p className="text-xs text-muted">Liberar não aumenta o nível do perfil: o que a pessoa enxerga dentro do módulo continua definido em <Link to="/settings/security" className="font-semibold text-primary hover:underline">Segurança</Link>. Detalhes de cada módulo em <Link to="/settings/modulos" className="font-semibold text-primary hover:underline">Módulos e liberação</Link>.</p>
      </div>
    </aside>
  );
}
