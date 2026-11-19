/**
 * Usuários → Organograma de acessos (identidade BKT): Diretoria e Administração → Gerência e gestores → Times (liderança
 * em cima, pessoas embaixo). Um filtro por módulo pinta cada card com o que a pessoa enxerga — Empresa toda, Time,
 * Só o próprio ou Sem acesso — calculado pelas mesmas regras que o sistema aplica. Clicar numa pessoa ou num time abre o
 * painel com o porquê e as ações: liberar ou bloquear o módulo (com motivo e validade, auditado) e trocar o perfil.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { X } from 'lucide-react';
import type { AccessLevel, BusinessModule, ProfileKey } from '@isp/domain';
import { api } from '../../lib/api';
import { BrandSymbol, Hexagons } from '../../components/brand';
import { Avatar, Button, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type View = { level: AccessLevel; enabled: boolean; reason: string };
type Person = { id: string; name: string; jobTitle: string | null; hasAvatar: boolean; profile: ProfileKey | null; view: Record<BusinessModule, View> };
type Team = { id: string; name: string; managerIds: string[]; leadIds: string[]; memberIds: string[] };
type Grant = { id: string; module: BusinessModule; subjectType: 'equipe' | 'usuario'; subjectId: string; effect: 'liberar' | 'bloquear'; reason: string; validUntil: string | null };
type Chart = { modules: { key: BusinessModule; label: string }[]; profiles: { key: ProfileKey; label: string }[]; people: Person[]; teams: Team[]; grants: Grant[] };

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

function PersonCard({ p, module, profiles, onOpen, active, note }: { p: Person; module: BusinessModule | null; profiles: Chart['profiles']; onOpen: () => void; active: boolean; note?: string }) {
  const lv = module ? p.view[module].level : null;
  const label = profiles.find((x) => x.key === p.profile)?.label ?? 'Sem perfil';
  return (
    <button type="button" onClick={onOpen} data-testid="org-person" aria-label={`${p.name}, ${label}${lv ? `: ${LEVEL[lv].label}` : ''}`}
      className={clsx('group relative flex w-[232px] items-center gap-3 border bg-surface py-2.5 pl-4 pr-3 text-left shadow-card transition-colors hover:border-primary', active ? 'border-primary ring-2 ring-primary/30' : 'border-line')}>
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

function TeamBox({ t, people, module, profiles, open, sel, managersAlso }: { t: Team; people: Map<string, Person>; module: BusinessModule | null; profiles: Chart['profiles']; open: (x: Sel) => void; sel: Sel | null; managersAlso: string[] }) {
  const leads = t.leadIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const members = t.memberIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  return (
    <div className="border border-ink/80 bg-surface-2" data-testid="org-team" aria-label={`Time ${t.name}`}>
      <button type="button" onClick={() => open({ kind: 'team', id: t.id })} className={clsx('relative flex w-full items-center gap-2 overflow-hidden bg-ink px-3 py-2 text-left text-white hover:bg-navy-2', sel?.kind === 'team' && sel.id === t.id && 'outline outline-2 outline-lime')}>
        <span className="h-3.5 w-3.5 shrink-0 bg-lime" style={hex} aria-hidden />
        <span className="font-display text-sm font-bold tracking-wide">{t.name}</span>
        <span className="ml-auto text-xs text-white/70">{leads.length + members.length} pessoa(s)</span>
      </button>
      {!!managersAlso.length && <p className="px-3 pt-1.5 text-[11px] text-muted">Também gerido por {managersAlso.join(', ')}</p>}
      <div className="space-y-2 p-3">
        {leads.map((p) => <PersonCard key={p.id} p={p} module={module} profiles={profiles} onOpen={() => open({ kind: 'person', id: p.id })} active={sel?.kind === 'person' && sel.id === p.id} note="Liderança do time" />)}
        {!!leads.length && !!members.length && <div className="ml-6 h-3 border-l-2 border-line-strong" aria-hidden />}
        {members.map((p) => <PersonCard key={p.id} p={p} module={module} profiles={profiles} onOpen={() => open({ kind: 'person', id: p.id })} active={sel?.kind === 'person' && sel.id === p.id} />)}
        {!leads.length && !members.length && <p className="text-xs text-muted">Sem pessoas ativas.</p>}
      </div>
    </div>
  );
}

type Sel = { kind: 'person' | 'team'; id: string };

export function OrgChart() {
  const q = useQuery({ queryKey: ['admin', 'org-chart'], queryFn: () => api<Chart>('/admin/org-chart') });
  const [module, setModule] = useState<BusinessModule | null>('crm');
  const [sel, setSel] = useState<Sel | null>(null);
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
  const card = (p: Person, note?: string) => <PersonCard key={p.id} p={p} module={module} profiles={d.profiles} onOpen={() => open({ kind: 'person', id: p.id })} active={sel?.kind === 'person' && sel.id === p.id} note={note} />;

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
        </div>
      </header>

      <div className="grid border border-t-0 border-line bg-bg lg:grid-cols-[1fr_auto]">
        <div className="overflow-x-auto p-6">
          <div className="mx-auto flex w-max min-w-full flex-col items-center">
            {/* raiz: a empresa */}
            <div className="flex items-center gap-3 border border-line bg-surface px-5 py-3 shadow-card"><BrandSymbol className="h-9 w-9" /><span className="font-display text-base font-bold tracking-wide text-ink">Empresa</span></div>
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
                      <div className="flex items-start gap-4">{t.teamsOf(m.id).map((team) => <TeamBox key={team.id} t={team} people={t.people} module={module} profiles={d.profiles} open={open} sel={sel} managersAlso={mgrNames(team, m.id)} />)}</div>
                    </>}
                  </div>
                ))}
                {!!t.loose.length && (
                  <div className="relative flex flex-col items-center">
                    <span className="absolute -top-6 h-6 w-0.5 bg-line-strong" aria-hidden />
                    <p className="mb-2 border border-dashed border-line-strong bg-surface px-3 py-2 text-xs text-muted">Times sem gestor definido</p>
                    <div className="flex items-start gap-4">{t.loose.map((team) => <TeamBox key={team.id} t={team} people={t.people} module={module} profiles={d.profiles} open={open} sel={sel} managersAlso={[]} />)}</div>
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
        {sel && <SidePanel chart={d} sel={sel} onClose={() => setSel(null)} />}
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
        <p className="text-xs text-muted">Liberar não aumenta o nível do perfil: o que a pessoa enxerga dentro do módulo continua definido em <Link to="/settings/security" className="font-semibold text-primary hover:underline">Segurança</Link>. Detalhes de cada módulo em <Link to="/settings/modulos" className="font-semibold text-primary hover:underline">Módulos e liberação</Link>.</p>
      </div>
    </aside>
  );
}
