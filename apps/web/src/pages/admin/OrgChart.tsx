/**
 * Usuários → Organograma de acessos (identidade BKT). Hierarquia: Diretoria > Gestão > Liderança > Operação, por time.
 * Gestão hierárquica (linha contínua) e funcional (tracejada) ficam evidentes: o time fica embaixo do gestor hierárquico e
 * aparece tracejado embaixo de cada gestor só funcional. Participantes (quem colabora) não entram no desenho.
 * Um filtro por módulo pinta cada card com o que a pessoa enxerga — Empresa toda, Time, Só o próprio ou Sem acesso.
 * O organograma cabe na tela (ajuste automático) e tem zoom e tela cheia. Clicar abre o painel com o porquê e as ações.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode, type WheelEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Expand, GripVertical, Maximize2, Minus, Pencil, Plus, X } from 'lucide-react';
import type { AccessLevel, BusinessModule, ProfileKey } from '@isp/domain';
import { api } from '../../lib/api';
import { Hexagons, Logo } from '../../components/brand';
import { Multi } from '../playbooks/Editor';
import { Avatar, Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { ConfirmDialog, Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type View = { level: AccessLevel; enabled: boolean; reason: string; profileLevel: AccessLevel };
type Person = { id: string; name: string; jobTitle: string | null; hasAvatar: boolean; profile: ProfileKey | null; view: Record<BusinessModule, View> };
type MgrKind = 'hierarquico_funcional' | 'hierarquico' | 'funcional';
type Team = { id: string; name: string; functionalGroupOf?: string | null; directorIds: string[]; managerIds: string[]; managers: { userId: string; kind: MgrKind }[]; leadIds: string[]; memberIds: string[]; participantIds: string[] };
type Grant = { id: string; module: BusinessModule; subjectType: 'equipe' | 'usuario'; subjectId: string; effect: 'liberar' | 'bloquear'; reason: string; validUntil: string | null };
type Chart = { canEdit?: boolean; viewers?: { userIds: string[]; profiles: ProfileKey[] }; top: { name: string | null; title: string | null }; modules: { key: BusinessModule; label: string; technical: string[] }[]; profiles: { key: ProfileKey; label: string }[]; people: Person[]; teams: Team[]; grants: Grant[] };
export const MGR_KIND_LABELS: Record<MgrKind, string> = { hierarquico_funcional: 'Hierárquica e funcional', hierarquico: 'Só hierárquica', funcional: 'Só funcional' };
const isHier = (k: MgrKind) => k !== 'funcional';
const isFunc = (k: MgrKind) => k !== 'hierarquico';

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
const hex = { clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)' };

function HexAvatar({ p, size = 44 }: { p: Person; size?: number }) {
  return <span className="shrink-0 bg-line p-[2px]" style={{ ...hex, width: size + 4, height: size + 4 }}><span className="block overflow-hidden" style={{ ...hex, width: size, height: size }}><Avatar name={p.name} userId={p.id} hasPhoto={p.hasAvatar} size={size} className="!rounded-none" /></span></span>;
}

type DragInfo = { userId: string; fromTeamId: string | null };
function PersonCard({ p, module, profiles, onOpen, active, note, edit, fromTeamId, role }: { p: Person; module: BusinessModule | null; profiles: Chart['profiles']; onOpen: () => void; active: boolean; note?: string; edit?: boolean; fromTeamId?: string | null; role?: string }) {
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
        {role && <span className="block text-[10px] font-semibold text-primary">{role}</span>}
        <span className="block truncate text-sm font-semibold text-ink">{p.name}</span>
        <span className="block truncate text-xs text-muted">{p.jobTitle || label}</span>
        {lv ? <span className={clsx('mt-1 inline-block px-1.5 py-0.5 text-[11px] font-semibold', LEVEL[lv].chip)} data-testid="org-level">{LEVEL[lv].label}</span>
          : <span className="mt-1 flex gap-[3px]" aria-hidden>{(Object.keys(p.view) as BusinessModule[]).map((m) => <span key={m} className={clsx('h-2 w-2', LEVEL[p.view[m].level].bar)} />)}</span>}
        {note && <span className="block text-[11px] text-muted">{note}</span>}
      </span>
    </button>
  );
}

/** Linha de ligação: contínua = hierárquica; tracejada = funcional. */
const VLine = ({ dashed, h = 'h-6' }: { dashed?: boolean; h?: string }) => <span className={clsx('w-0 self-center', h, dashed ? 'border-l-2 border-dashed border-sky' : 'border-l-2 border-line-strong')} aria-hidden />;

function TeamBox({ t, people, module, profiles, open, sel, edit, onDrop, functional }: { t: Team; people: Map<string, Person>; module: BusinessModule | null; profiles: Chart['profiles']; open: (x: Sel) => void; sel: Sel | null; edit: boolean; onDrop: (d: DragInfo, teamId: string) => void; functional?: boolean }) {
  const leads = t.leadIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const members = t.memberIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const [over, setOver] = useState(false);
  const name = (id: string) => people.get(id)?.name ?? '—';
  const hier = t.managers.filter((m) => isHier(m.kind) && people.has(m.userId)), func = t.managers.filter((m) => isFunc(m.kind) && people.has(m.userId));
  const dnd = edit && !functional ? {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('application/x-revops-person')) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); try { onDrop(JSON.parse(e.dataTransfer.getData('application/x-revops-person')) as DragInfo, t.id); } catch { /* arrasto de outra origem */ } },
  } : {};
  // réplica na gestão funcional: o mesmo time, inteiro, em azul claro e tracejado (a composição é a mesma do time original)
  const F = !!functional;
  return (
    <div className={clsx('border transition-colors', F ? 'border-2 border-dashed border-sky bg-sky-soft' : over ? 'border-primary bg-primary-soft outline outline-2 outline-primary' : 'border-ink/80 bg-surface-2')} data-testid={F ? 'org-team-functional' : 'org-team'} aria-label={F ? `Time ${t.name} (gestão funcional)` : `Time ${t.name}`} {...dnd}>
      <button type="button" onClick={() => open({ kind: 'team', id: t.id })} className={clsx('relative flex w-full items-center gap-2 overflow-hidden px-3 py-2 text-left', F ? 'bg-sky text-white hover:bg-primary' : 'bg-ink text-white hover:bg-navy-2', sel?.kind === 'team' && sel.id === t.id && 'outline outline-2 outline-lime')}>
        <span className={clsx('h-3.5 w-3.5 shrink-0', F ? 'border-2 border-white' : 'bg-lime')} style={hex} aria-hidden />
        <span className="font-display text-sm font-bold tracking-wide">{t.name}</span>
        <span className="ml-auto text-xs text-white/80">{F ? (t.functionalGroupOf ? 'pessoas atreladas' : 'gestão funcional') : t.functionalGroupOf ? 'grupo da gestão funcional' : `${leads.length + members.length} pessoa(s)`}</span>
      </button>
      {/* gestão do time: hierárquica (contínua) e funcional (tracejada) */}
      <div className="flex flex-wrap gap-1 px-3 pt-2" aria-label={`Gestão do time ${t.name}`}>
        {hier.map((m) => <span key={`h${m.userId}`} className="border border-primary bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-white" title={MGR_KIND_LABELS[m.kind]}>{m.kind === 'hierarquico_funcional' ? 'Hierárq. + funcional' : 'Hierárquica'}: {name(m.userId)}</span>)}
        {func.filter((m) => m.kind === 'funcional').map((m) => <span key={`f${m.userId}`} className="border border-dashed border-sky px-1.5 py-0.5 text-[10px] font-semibold text-sky" title="Só funcional">Funcional: {name(m.userId)}</span>)}
        {!t.managers.length && <span className="text-[10px] text-muted">Sem gestão definida</span>}
      </div>
      <div className="space-y-2 p-3">
        {leads.map((p) => <PersonCard key={p.id} p={p} module={module} profiles={profiles} onOpen={() => open({ kind: 'person', id: p.id })} active={sel?.kind === 'person' && sel.id === p.id} role="Liderança" edit={edit && !F} fromTeamId={t.id} />)}
        {!!leads.length && !!members.length && <div className="ml-6 h-3 border-l-2 border-line-strong" aria-hidden />}
        {members.map((p) => <PersonCard key={p.id} p={p} module={module} profiles={profiles} onOpen={() => open({ kind: 'person', id: p.id })} active={sel?.kind === 'person' && sel.id === p.id} role="Operação" edit={edit && !F} fromTeamId={t.id} />)}
        {!leads.length && !members.length && <p className="text-xs text-muted">Sem pessoas ativas.</p>}
        {!!t.participantIds.length && !F && <p className="text-[11px] text-muted" title={t.participantIds.map(name).join(', ')}>+ {t.participantIds.length} participante(s) colaborando (fora do organograma)</p>}
        {/* na gestão funcional, quem colabora aparece abaixo da operação */}
        {F && !!t.participantIds.length && <>
          <div className="ml-6 h-3 border-l-2 border-dashed border-sky" aria-hidden />
          <p className="text-[11px] font-semibold text-sky">Participantes</p>
          {(t.participantIds.map((id) => people.get(id)).filter(Boolean) as Person[]).map((p) => <PersonCard key={p.id} p={p} module={module} profiles={profiles} onOpen={() => open({ kind: 'person', id: p.id })} active={sel?.kind === 'person' && sel.id === p.id} role="Participante" fromTeamId={t.id} />)}
        </>}
        {edit && !F && <p className="border border-dashed border-line-strong px-2 py-1.5 text-center text-[11px] text-muted">Solte uma pessoa aqui para trazer ao time</p>}
        {F && <p className="text-[11px] text-sky">Réplica do time: a mesma composição da gestão hierárquica, com os participantes.</p>}
      </div>
    </div>
  );
}

/** Área com zoom: ajusta o organograma inteiro à tela (automático até a pessoa mexer no zoom), +/−, Ctrl+roda e tela cheia. */
function ZoomViewport({ children, refitKey }: { children: ReactNode; refitKey: string }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null);
  const [z, setZ] = useState(1), [size, setSize] = useState({ w: 0, h: 0 }), [manual, setManual] = useState(false), [full, setFull] = useState(false);
  const fitZ = useCallback(() => {
    const o = outer.current; if (!o || !size.w || !size.h) return 1;
    return Math.max(0.2, Math.min(1.25, Math.min((o.clientWidth - 32) / size.w, (o.clientHeight - 32) / size.h)));
  }, [size]);
  useLayoutEffect(() => {
    const el = inner.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const o = outer.current; if (!o) return;
    const ro = new ResizeObserver(() => { if (!manual) setZ(fitZ()); });
    ro.observe(o); return () => ro.disconnect();
  }, [fitZ, manual]);
  useEffect(() => { if (!manual) setZ(fitZ()); }, [fitZ, manual, refitKey]);
  useEffect(() => { const h = () => setFull(document.fullscreenElement === box.current); document.addEventListener('fullscreenchange', h); return () => document.removeEventListener('fullscreenchange', h); }, []);
  const zoom = (f: number) => { setManual(true); setZ((v) => Math.max(0.2, Math.min(2, Math.round(v * f * 100) / 100))); };
  const onWheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1); } };
  const fit = () => { setManual(false); setZ(fitZ()); };
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void box.current?.requestFullscreen?.(); };
  const btn = 'flex h-8 min-w-8 items-center justify-center border border-line bg-surface px-2 text-sm font-semibold text-ink hover:border-primary hover:text-primary';
  return (
    <div ref={box} className={clsx('relative min-w-0 bg-bg', full && 'h-screen')}>
      <div className="absolute right-3 top-3 z-20 flex gap-1 shadow-card" role="group" aria-label="Zoom do organograma">
        <button type="button" className={btn} onClick={() => zoom(1 / 1.2)} aria-label="Diminuir zoom"><Minus className="h-4 w-4" /></button>
        <span className={clsx(btn, 'num w-14 cursor-default')} data-testid="org-zoom" aria-live="polite">{Math.round(z * 100)}%</span>
        <button type="button" className={btn} onClick={() => zoom(1.2)} aria-label="Aumentar zoom"><Plus className="h-4 w-4" /></button>
        <button type="button" className={btn} onClick={fit} aria-label="Ajustar à tela"><Maximize2 className="mr-1 h-4 w-4" />Ajustar</button>
        <button type="button" className={btn} onClick={toggleFull} aria-label={full ? 'Sair da tela cheia' : 'Tela cheia'}><Expand className="h-4 w-4" /></button>
      </div>
      <div ref={outer} onWheel={onWheel} className={clsx('overflow-auto', full ? 'h-full' : 'h-[calc(100vh-300px)] min-h-[520px]')} data-testid="org-viewport">
        <div className="mx-auto p-4" style={{ width: size.w * z + 32, height: size.h * z + 32 }}>
          <div ref={inner} style={{ transform: `scale(${z})`, transformOrigin: '0 0', width: 'max-content' }}>{children}</div>
        </div>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-muted">Ctrl + roda do mouse para zoom · arraste as barras para navegar</p>
    </div>
  );
}

type Sel = { kind: 'person' | 'team'; id: string };

/** Gestão de Times → Organograma: só consulta, para quem a Administração autorizou. */
export function OrgChartPage() {
  return <div className="space-y-3"><OrgChart readOnly /></div>;
}

export function OrgChart({ readOnly = false }: { readOnly?: boolean }) {
  const q = useQuery({ queryKey: ['admin', 'org-chart', readOnly ? 'consulta' : 'edicao'], queryFn: () => api<Chart>(readOnly ? '/org-chart' : '/admin/org-chart'), retry: false });
  const [viewersOpen, setViewersOpen] = useState(false);
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
    onSuccess: () => { toast({ tone: 'success', message: 'Time criado: defina diretoria, gestão, liderança e operação no painel' }); setNewTeam(null); refresh(); void qc.invalidateQueries({ queryKey: ['lookups'] }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const drop = (d: DragInfo, toTeamId: string) => { if (d.fromTeamId !== toTeamId) move.mutate({ ...d, toTeamId }); };

  /** Diretoria > Gestão hierárquica > Times; gestores só funcionais aparecem com o time tracejado. */
  const tree = useMemo(() => {
    if (!q.data) return null;
    const d = q.data, people = new Map(d.people.map((p) => [p.id, p]));
    const ownDir = (t: Team) => t.directorIds.find((x) => people.has(x)) ?? null;
    // grupo de pessoas avulsas segue a diretoria dos setores que o gestor funcional acompanha
    const dirOf = (t: Team): string | null => {
      if (ownDir(t) || !t.functionalGroupOf) return ownDir(t);
      const other = d.teams.find((x) => x.id !== t.id && !x.functionalGroupOf && x.managers.some((m) => m.userId === t.functionalGroupOf) && ownDir(x));
      return other ? ownDir(other) : null;
    };
    const hierOf = (t: Team) => t.managers.find((m) => isHier(m.kind) && people.has(m.userId))?.userId ?? null;
    const directorIds = [...new Set([...d.teams.map(dirOf).filter((x): x is string => !!x), ...d.people.filter((p) => p.profile === 'diretoria').map((p) => p.id)])];
    const groups = [...directorIds.map((id) => ({ director: people.get(id)!, teams: d.teams.filter((t) => dirOf(t) === id) })), { director: null as Person | null, teams: d.teams.filter((t) => !dirOf(t)) }]
      .filter((g) => g.director || g.teams.length)
      .map((g) => {
        const mgrIds = [...new Set(g.teams.map(hierOf).filter((x): x is string => !!x))];
        const funcOf = (id: string) => g.teams.filter((t) => t.managers.some((m) => m.userId === id && m.kind === 'funcional'));
        // gestão só funcional fica ao lado da hierárquica, embaixo da mesma diretoria, ligada aos times por linha tracejada
        const funcIds = [...new Set(g.teams.flatMap((t) => t.managers.filter((m) => m.kind === 'funcional' && people.has(m.userId)).map((m) => m.userId)))].filter((id) => !mgrIds.includes(id));
        return {
          director: g.director,
          managers: [
            ...mgrIds.map((id) => ({ person: people.get(id)!, teams: g.teams.filter((t) => hierOf(t) === id), functional: funcOf(id), onlyFunctional: false })),
            ...funcIds.map((id) => ({ person: people.get(id)!, teams: [] as Team[], functional: funcOf(id), onlyFunctional: true })),
          ],
          // time só funcional (sem gestão hierárquica, com gestão funcional) ou grupo de pessoas avulsas: só aparece solto na edição
          loose: g.teams.filter((t) => !hierOf(t) && (edit || !(t.functionalGroupOf || t.managers.some((m) => m.kind === 'funcional')))),
        };
      });
    // gestores só funcionais de times em outra diretoria já aparecem lá; não há mais área separada
    const onlyFunctional: { person: Person; functional: Team[] }[] = [];
    const inChart = new Set([...directorIds, ...d.teams.flatMap((t) => [...t.leadIds, ...t.memberIds, ...t.managers.map((m) => m.userId)])]);
    const participantsOnly = new Set(d.teams.flatMap((t) => t.participantIds));
    const noTeam = d.people.filter((p) => !inChart.has(p.id) && !participantsOnly.has(p.id));
    return { people, groups, onlyFunctional, noTeam };
  }, [q.data, edit]);

  if (q.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (q.isError) return (q.error as { status?: number })?.status === 403
    ? <EmptyState title="Organograma restrito" description="O organograma é visto só por pessoas autorizadas. Peça à Administração." />
    : <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!, t = tree!;
  const canEdit = !readOnly && d.canEdit !== false;
  const open = (x: Sel) => setSel(x);
  const card = (p: Person, role?: string) => <PersonCard key={p.id} p={p} module={module} profiles={d.profiles} onOpen={() => open({ kind: 'person', id: p.id })} active={sel?.kind === 'person' && sel.id === p.id} role={role} edit={edit} fromTeamId={null} />;
  const box = (team: Team, functional?: boolean) => <TeamBox key={`${team.id}${functional ? 'f' : ''}`} t={team} people={t.people} module={module} profiles={d.profiles} open={open} sel={sel} edit={edit} onDrop={drop} functional={functional} />;
  /** Times sob gestão funcional: o mesmo time replicado, inteiro, em azul claro e tracejado. */
  const funcBlock = (m: { person: Person; functional: Team[] }) => (
    <div className="flex items-start gap-4 border-t-2 border-dashed border-sky pt-4" aria-label={`Gestão funcional de ${m.person.name}`}>{m.functional.map((tm) => box(tm, true))}</div>
  );
  const mgrColumn = (m: { person: Person; teams: Team[]; functional: Team[]; onlyFunctional?: boolean }) => (
    <div key={m.person.id} className="flex flex-col items-center">
      <VLine dashed={m.onlyFunctional} />
      {card(m.person, m.onlyFunctional ? 'Gestão funcional' : 'Gestão')}
      {!!m.teams.length && <><VLine h="h-5" /><div className="flex items-start gap-4 border-t-2 border-line-strong pt-4">{m.teams.map((tm) => box(tm))}</div></>}
      {!!m.functional.length && <><VLine dashed h="h-5" />{funcBlock(m)}</>}
    </div>
  );

  return (
    <div className="space-y-0">
      {/* faixa da marca: degradê grafite → azul só no fundo, símbolo como marca-d'água */}
      <header className="relative overflow-hidden bg-gradient-to-r from-navy-2 via-navy to-primary px-6 py-4 text-white">
        <Hexagons className="absolute inset-0" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="mb-2 flex items-center gap-3" aria-label="BKT RevOps"><Logo className="h-7" /><span className="border-l border-white/30 pl-3 font-display text-sm font-semibold text-white/80">RevOps</span></span>
            <h2 className="font-display text-xl font-bold tracking-wide">Organograma de acessos</h2>
            <p className="mt-1 max-w-2xl text-sm text-white/80">Diretoria &gt; Gestão &gt; Liderança &gt; Operação, por time. Clique numa pessoa ou num time para ver o porquê e ajustar.</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-xs" aria-label="Legenda">
            <span className="flex flex-wrap justify-end gap-x-4 gap-y-1">{(['total', 'equipe', 'proprio', 'nenhum'] as AccessLevel[]).map((l) => <span key={l} className="flex items-center gap-1.5"><span className={clsx('h-3 w-3', LEVEL[l].bar, l === 'nenhum' && 'bg-white/20')} />{LEVEL[l].label}</span>)}</span>
            <span className="flex gap-4"><span className="flex items-center gap-1.5"><span className="w-6 border-t-2 border-white" />Gestão hierárquica</span><span className="flex items-center gap-1.5"><span className="w-6 border-t-2 border-dashed border-lime" />Gestão funcional</span></span>
          </div>
        </div>
        <div className="relative mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Módulo">
          <button type="button" aria-pressed={!module} onClick={() => setModule(null)} className={clsx('border px-3 py-1.5 text-sm font-semibold', !module ? 'border-white bg-white text-ink' : 'border-white/30 text-white hover:border-white')}>Visão geral</button>
          {d.modules.map((m) => <button key={m.key} type="button" aria-pressed={module === m.key} onClick={() => setModule(m.key)} className={clsx('border px-3 py-1.5 text-sm font-semibold', module === m.key ? 'border-white bg-white text-ink' : 'border-white/30 text-white hover:border-white')}>{m.label}</button>)}
          <span className="ml-auto flex gap-1.5">
            {canEdit && <button type="button" onClick={() => setViewersOpen(true)} className="inline-flex items-center gap-1.5 border border-white/30 px-3 py-1.5 text-sm font-semibold text-white hover:border-white">Quem pode ver</button>}
            {edit && <button type="button" onClick={() => setNewTeam('')} className="inline-flex items-center gap-1.5 border border-white/30 px-3 py-1.5 text-sm font-semibold text-white hover:border-white"><Plus className="h-4 w-4" />Novo time</button>}
            {canEdit && <button type="button" aria-pressed={edit} onClick={() => setEdit((v) => !v)} className={clsx('inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold', edit ? 'border-lime bg-lime text-ink' : 'border-white/30 text-white hover:border-white')}>{edit ? 'Concluir ajustes' : 'Ajustar estrutura'}</button>}
            {readOnly && <span className="border border-white/30 px-3 py-1.5 text-sm text-white/85">Só consulta</span>}
          </span>
        </div>
        {edit && <p className="relative mt-3 text-sm text-white/85">Arraste uma pessoa para outro time. Clique num time para definir diretoria, gestão (hierárquica ou funcional), liderança, operação e participantes; clique numa pessoa para os times, as liberações e o perfil. Tudo fica registrado na auditoria.</p>}
        {newTeam !== null && (
          <form className="relative mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); createTeam.mutate(); }}>
            <label className="text-sm text-white/85" htmlFor="oc-nt">Nome do novo time<Input id="oc-nt" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} className="mt-1 w-64 !border-white/30 !bg-white/10 !text-white" /></label>
            <Button type="submit" variant="primary" disabled={newTeam.trim().length < 2} loading={createTeam.isPending}>Criar time</Button><Button onClick={() => setNewTeam(null)}>Cancelar</Button>
          </form>
        )}
      </header>

      <div className="grid border border-t-0 border-line bg-bg lg:grid-cols-[minmax(0,1fr)_auto]">
        <ZoomViewport refitKey={`${d.teams.length}:${d.people.length}:${sel ? 1 : 0}`}>
          <div className="flex flex-col items-center">
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
                {canEdit && <button type="button" onClick={() => setTopForm({ name: d.top.name ?? '', title: d.top.title ?? '' })} aria-label="Editar o topo da estrutura" className="absolute right-2 top-2 p-1 text-white/60 hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>}
              </div>
            )}
            <VLine />
            <div className="flex items-start gap-10 border-t-2 border-line-strong">
              {t.groups.map((g, gi) => (
                <section key={g.director?.id ?? `sem-${gi}`} aria-label={g.director ? `Diretoria de ${g.director.name}` : 'Times sem diretoria definida'} className="flex flex-col items-center">
                  <VLine />
                  {g.director ? card(g.director, 'Diretoria') : <p className="border border-dashed border-line-strong bg-surface px-3 py-2 text-xs text-muted">Sem diretoria definida</p>}
                  {(!!g.managers.length || !!g.loose.length) && <>
                    <VLine h="h-4" />
                    <div className="flex items-start gap-6 border-t-2 border-line-strong">
                      {g.managers.map(mgrColumn)}
                      {!!g.loose.length && (
                        <div className="flex flex-col items-center">
                          <VLine />
                          <p className="mb-2 border border-dashed border-line-strong bg-surface px-3 py-2 text-xs text-muted">Sem gestão hierárquica</p>
                          <div className="flex items-start gap-4">{g.loose.map((tm) => box(tm))}</div>
                        </div>
                      )}
                    </div>
                  </>}
                </section>
              ))}
              {!!t.onlyFunctional.length && (
                <section aria-label="Gestão só funcional" className="flex flex-col items-center">
                  <VLine dashed />
                  <p className="mb-2 border-2 border-dashed border-sky bg-sky-soft px-3 py-2 text-xs font-semibold text-sky">Gestão só funcional</p>
                  <div className="flex items-start gap-6">{t.onlyFunctional.map((m) => (
                    <div key={m.person.id} className="flex flex-col items-center">{card(m.person, 'Gestão funcional')}<VLine dashed h="h-5" />{funcBlock(m)}</div>
                  ))}</div>
                </section>
              )}
            </div>
            <section aria-label="Legenda do organograma" className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border border-line bg-surface px-6 py-4 text-sm text-text" data-testid="org-legend">
              <span className="flex items-center gap-2"><span className="flex h-6 w-16 items-center border border-ink/80 bg-ink px-1.5 text-[10px] font-bold text-white">Time</span>Time na gestão hierárquica</span>
              <span className="flex items-center gap-2"><span className="flex h-6 w-16 items-center border-2 border-dashed border-sky bg-sky px-1.5 text-[10px] font-bold text-white">Time</span>Mesmo time replicado na gestão funcional, com os participantes</span>
              <span className="flex items-center gap-2"><span className="w-10 border-t-2 border-line-strong" />Ligação hierárquica</span>
              <span className="flex items-center gap-2"><span className="w-10 border-t-2 border-dashed border-sky" />Ligação funcional</span>
              <span className="flex items-center gap-2"><span className="border border-primary bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-white">Hierárq. + funcional</span><span className="border border-dashed border-sky px-1.5 py-0.5 text-[10px] font-semibold text-sky">Funcional</span>Tipo de gestão do time</span>
            </section>
            {!!t.noTeam.length && (
              <section aria-label="Pessoas sem time" className="mt-10 w-full max-w-4xl border border-dashed border-line-strong bg-surface p-4">
                <p className="mb-2 text-sm font-semibold text-ink">Pessoas sem time <span className="font-normal text-muted">· no nível "Time" elas não aparecem para nenhuma liderança</span></p>
                <div className="flex flex-wrap gap-3">{t.noTeam.map((p) => card(p))}</div>
              </section>
            )}
          </div>
        </ZoomViewport>
        {sel && <SidePanel key={`${sel.kind}:${sel.id}`} chart={d} sel={sel} onClose={() => setSel(null)} readOnly={!canEdit} />}
        {viewersOpen && <ViewersModal chart={d} onClose={() => setViewersOpen(false)} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ painel: o porquê e as ações
function SidePanel({ chart, sel, onClose, readOnly }: { chart: Chart; sel: Sel; onClose: () => void; readOnly?: boolean }) {
  const qc = useQueryClient(), toast = useToast();
  const person = sel.kind === 'person' ? chart.people.find((p) => p.id === sel.id) ?? null : null;
  const team = sel.kind === 'team' ? chart.teams.find((t) => t.id === sel.id) ?? null : null;
  const subjectType = person ? 'usuario' : 'equipe';
  const [form, setForm] = useState<{ module: BusinessModule; effect: 'liberar' | 'bloquear' } | null>(null);
  const [reason, setReason] = useState(''), [until, setUntil] = useState('');
  const [revoke, setRevoke] = useState<Grant | null>(null), [note, setNote] = useState('');
  const [profile, setProfile] = useState<ProfileKey | ''>(person?.profile ?? '');
  const [comp, setComp] = useState<{ directorIds: string[]; managers: { userId: string; kind: MgrKind }[]; leadIds: string[]; memberIds: string[]; participantIds: string[] } | null>(team ? { directorIds: team.directorIds, managers: team.managers, leadIds: team.leadIds, memberIds: team.memberIds, participantIds: team.participantIds } : null);
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
    mutationFn: (teamId: string) => { const t = chart.teams.find((x) => x.id === teamId)!; return api(`/admin/org-chart/teams/${teamId}`, { method: 'PUT', body: { directorIds: t.directorIds, managers: t.managers, leadIds: t.leadIds.filter((x) => x !== sel.id), memberIds: t.memberIds.filter((x) => x !== sel.id), participantIds: t.participantIds.filter((x) => x !== sel.id) } }); },
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
  const group = person ? chart.teams.find((t) => t.functionalGroupOf === person.id) ?? null : null;
  const [fTeams, setFTeams] = useState<string[]>(person ? chart.teams.filter((t) => !t.functionalGroupOf && t.managers.some((m) => m.userId === person.id && m.kind === 'funcional')).map((t) => t.id) : []);
  const [fPeople, setFPeople] = useState<string[]>(group ? [...group.memberIds] : []);
  const [fName, setFName] = useState(group?.name ?? '');
  const saveFunc = useMutation({
    mutationFn: () => api(`/admin/org-chart/functional/${sel.id}`, { method: 'PUT', body: { teamIds: fTeams, userIds: fPeople, ...(fName.trim().length >= 2 ? { groupName: fName.trim() } : {}) } }),
    onSuccess: () => { toast({ tone: 'success', message: 'Gestão funcional atualizada' }); refresh(); },
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
          <div className="relative"><p className="font-display text-base font-bold tracking-wide">Time {team!.name}</p><p className="text-sm text-white/75">Diretoria: {team!.directorIds.map(name).join(', ') || '—'} · Gestão: {team!.managers.map((m) => `${name(m.userId)} (${MGR_KIND_LABELS[m.kind].toLowerCase()})`).join(', ') || '—'} · Liderança: {team!.leadIds.map(name).join(', ') || '—'} · {team!.memberIds.length} na operação{team!.participantIds.length ? ` · ${team!.participantIds.length} participante(s)` : ''}</p></div>
        )}
      </div>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
        {person && !readOnly && (
          <div className="flex items-end gap-2">
            <FormField label="Perfil" htmlFor="oc-prof" className="flex-1"><Select id="oc-prof" value={profile} onChange={(e) => setProfile(e.target.value as ProfileKey)}>{chart.profiles.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</Select></FormField>
            <Button variant="primary" disabled={!profile || profile === person.profile} loading={saveProfile.isPending} onClick={() => saveProfile.mutate()}>Trocar perfil</Button>
          </div>
        )}
        {person && (() => {
          const mine = chart.teams.filter((t) => t.leadIds.includes(person.id) || t.memberIds.includes(person.id) || t.participantIds.includes(person.id));
          const others = chart.teams.filter((t) => !mine.includes(t));
          return (
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">Times</p>
              {!mine.length ? <p className="text-xs text-muted">Sem time: no nível "Time", nenhuma liderança enxerga esta pessoa.</p> : (
                <ul className="divide-y divide-line border border-line" aria-label="Times da pessoa">{mine.map((t) => {
                  const lead = t.leadIds.includes(person.id), part = t.participantIds.includes(person.id);
                  return (
                    <li key={t.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <span className="flex-1 font-semibold text-ink">{t.name}<span className="ml-1.5 text-xs font-normal text-muted">{lead ? 'liderança' : part ? 'participante (fora do organograma)' : 'operação'}</span></span>
                      {!readOnly && <><button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => moveTo.mutate({ fromTeamId: t.id, toTeamId: t.id, lead: !lead })}>{lead ? 'Tirar liderança' : 'Tornar liderança'}</button>
                      <button type="button" className="text-xs font-semibold text-danger hover:underline" onClick={() => leave.mutate(t.id)}>Tirar do time</button></>}
                    </li>
                  );
                })}</ul>
              )}
              {!!others.length && !readOnly && (
                <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (addTo) moveTo.mutate({ fromTeamId: null, toTeamId: addTo, lead: addLead }); }}>
                  <FormField label="Incluir em outro time" htmlFor="oc-add" className="min-w-[160px] flex-1"><Select id="oc-add" value={addTo} onChange={(e) => setAddTo(e.target.value)}><option value="">Escolha o time</option>{others.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>
                  <label className="flex h-10 items-center gap-1.5 text-xs text-ink"><input type="checkbox" checked={addLead} onChange={(e) => setAddLead(e.target.checked)} />como liderança</label>
                  <Button type="submit" size="sm" disabled={!addTo} loading={moveTo.isPending}>Incluir</Button>
                </form>
              )}
            </div>
          );
        })()}
        {person && !readOnly && (
          <form className="space-y-3 border-l-2 border-dashed border-sky pl-3" aria-label="Gestão funcional" onSubmit={(e) => { e.preventDefault(); saveFunc.mutate(); }}>
            <p className="text-sm font-semibold text-ink">Gestão funcional</p>
            <p className="text-xs text-muted">Atrele setores inteiros e/ou pessoas avulsas. No organograma, eles aparecem replicados em azul embaixo de {person.name}, ao lado da gestão hierárquica.</p>
            <Multi label="Setores (times inteiros)" options={chart.teams.filter((t) => !t.functionalGroupOf && !t.managers.some((m) => m.userId === person.id && m.kind !== 'funcional')).map((t) => ({ id: t.id, label: t.name }))} value={fTeams} onChange={setFTeams} />
            <Multi label="Pessoas avulsas" options={chart.people.filter((p) => p.id !== person.id).map((p) => ({ id: p.id, label: p.name }))} value={fPeople} onChange={setFPeople} />
            {(!!fPeople.length || group) && <FormField label="Nome do grupo de pessoas" htmlFor="oc-fg" hint="Ex.: Negócios. O grupo só aparece solto no organograma na edição."><Input id="oc-fg" value={fName} onChange={(e) => setFName(e.target.value)} placeholder={`Gestão funcional — ${person.name}`} /></FormField>}
            <Button type="submit" size="sm" variant="primary" loading={saveFunc.isPending}>Salvar gestão funcional</Button>
          </form>
        )}
        {team && comp && !readOnly && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveTeam.mutate(); }} aria-label="Composição do time">
            <p className="text-sm font-semibold text-ink">Composição do time</p>
            <Multi label="Diretoria" options={chart.people.map((p) => ({ id: p.id, label: p.name }))} value={comp.directorIds} onChange={(v) => setComp({ ...comp, directorIds: v })} />
            <Multi label="Gestão (veem e acompanham este time)" options={chart.people.map((p) => ({ id: p.id, label: p.name }))} value={comp.managers.map((m) => m.userId)} onChange={(v) => setComp({ ...comp, managers: v.map((u) => comp.managers.find((m) => m.userId === u) ?? { userId: u, kind: 'hierarquico_funcional' as MgrKind }) })} />
            {!!comp.managers.length && (
              <ul className="space-y-1.5 border-l-2 border-primary pl-3" aria-label="Tipo de gestão">{comp.managers.map((m) => (
                <li key={m.userId} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{name(m.userId)}</span>
                  <Select aria-label={`Tipo de gestão de ${name(m.userId)}`} value={m.kind} onChange={(e) => setComp({ ...comp, managers: comp.managers.map((x) => (x.userId === m.userId ? { ...x, kind: e.target.value as MgrKind } : x)) })} className="h-8 w-48 text-xs">
                    {(Object.keys(MGR_KIND_LABELS) as MgrKind[]).map((k) => <option key={k} value={k}>{MGR_KIND_LABELS[k]}</option>)}
                  </Select>
                </li>
              ))}</ul>
            )}
            <Multi label="Liderança" options={chart.people.map((p) => ({ id: p.id, label: p.name }))} value={comp.leadIds} onChange={(v) => setComp({ ...comp, leadIds: v, memberIds: comp.memberIds.filter((x) => !v.includes(x)), participantIds: comp.participantIds.filter((x) => !v.includes(x)) })} />
            <Multi label="Operação" options={chart.people.filter((p) => !comp.leadIds.includes(p.id)).map((p) => ({ id: p.id, label: p.name }))} value={comp.memberIds} onChange={(v) => setComp({ ...comp, memberIds: v, participantIds: comp.participantIds.filter((x) => !v.includes(x)) })} />
            <Multi label="Participantes (colaboram; não entram no organograma)" options={chart.people.filter((p) => !comp.leadIds.includes(p.id) && !comp.memberIds.includes(p.id)).map((p) => ({ id: p.id, label: p.name }))} value={comp.participantIds} onChange={(v) => setComp({ ...comp, participantIds: v })} />
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
                {v && person?.profile && !readOnly && (
                  <label className="mt-1.5 flex items-center gap-2 text-xs text-text">Nível do perfil {profileLabel}
                    <Select aria-label={`Nível do perfil ${profileLabel} em ${m.label}`} value={v.profileLevel} onChange={(e) => setLvlAsk({ module: m.key, level: e.target.value as AccessLevel })} className="h-8 w-36 text-xs">
                      {(['nenhum', 'proprio', 'equipe', 'total'] as AccessLevel[]).map((l) => <option key={l} value={l}>{LEVEL[l].label}</option>)}
                    </Select>
                  </label>
                )}
                {g && <p className="mt-0.5 text-xs text-text">Regra {person ? 'da pessoa' : 'do time'}: <b>{g.effect === 'liberar' ? 'liberado' : 'bloqueado'}</b>{g.validUntil ? ` até ${g.validUntil.split('-').reverse().join('/')}` : ''} — {g.reason}</p>}
                {!readOnly && <div className="mt-1.5 flex gap-3 text-xs font-semibold">
                  {g ? <button type="button" className="text-primary hover:underline" onClick={() => { setRevoke(g); setForm(null); }}>Retirar regra</button> : <>
                    <button type="button" className="text-primary hover:underline" onClick={() => { setForm({ module: m.key, effect: 'liberar' }); setRevoke(null); }}>Liberar</button>
                    <button type="button" className="text-danger hover:underline" onClick={() => { setForm({ module: m.key, effect: 'bloquear' }); setRevoke(null); }}>Bloquear</button>
                  </>}
                </div>}
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
        {readOnly ? <p className="text-xs text-muted">Só consulta. Mudanças na estrutura e nos acessos são feitas pela Administração.</p> : <p className="text-xs text-muted">Liberar não aumenta o nível do perfil: o que a pessoa enxerga dentro do módulo continua definido em <Link to="/settings/security" className="font-semibold text-primary hover:underline">Segurança</Link>. Detalhes de cada módulo em <Link to="/settings/modulos" className="font-semibold text-primary hover:underline">Módulos e liberação</Link>.</p>}
      </div>
    </aside>
  );
}

/** Quem pode ver o organograma (só consulta), além da Administração. */
function ViewersModal({ chart, onClose }: { chart: Chart; onClose: () => void }) {
  const qc = useQueryClient(), toast = useToast();
  const [userIds, setUsers] = useState<string[]>(chart.viewers?.userIds ?? []);
  const [profiles, setProfiles] = useState<string[]>(chart.viewers?.profiles ?? []);
  const save = useMutation({
    mutationFn: () => api('/admin/org-chart/viewers', { method: 'PUT', body: { userIds, profiles } }),
    onSuccess: () => { toast({ tone: 'success', message: 'Quem pode ver o organograma foi atualizado' }); void qc.invalidateQueries({ queryKey: ['admin'] }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title="Quem pode ver o organograma" size="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-text">A Administração sempre vê e ajusta. Quem for autorizado aqui vê o organograma em <b>Gestão de Times → Organograma</b>, só para consulta: não muda times, perfis nem acessos.</p>
        <Multi label="Perfis autorizados" options={chart.profiles.map((p) => ({ id: p.key, label: p.label }))} value={profiles} onChange={setProfiles} />
        <Multi label="Pessoas autorizadas" options={chart.people.map((p) => ({ id: p.id, label: p.name }))} value={userIds} onChange={setUsers} />
        <p className="text-xs text-muted">Quem não está autorizado não vê o item no menu e, mesmo com o link, o sistema recusa. A mudança fica na auditoria.</p>
      </div>
    </Modal>
  );
}
