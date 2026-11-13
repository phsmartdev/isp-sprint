/**
 * Gestão de Times → Painel: um cartão por time com o que importa para a análise de gestores e diretoria
 * (performance do mês, metas no semáforo, equilíbrio do time, intervenções abertas e férias nos próximos 30 dias).
 * Junta dados que já existem; cada cartão leva direto para a tela onde se age.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowUpRight, ChevronRight, Gauge, Palmtree, Siren } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDate, fmtPct, teamLabel } from '../../lib/format';
import { PageHeader } from '../../components/layout/PageHeader';
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/primitives';
import { DISPERSION_LABEL, useGamification, type DispersionTone } from '../../features/gamification/Gamification';
import type { Goal } from '../performance/Goals';

type Tone = 'verde' | 'amarelo' | 'vermelho' | 'sem_dados';
type Perf = { pending: boolean; month: string; bands?: { greenBp: number; yellowBp: number }; overall?: number | null; me?: { score: number | null; tone: Tone; levelName: string } | null; units?: { id: string; name: string; kind: 'diretoria' | 'area' | 'unidade'; parentId: string | null; average: number | null }[]; teams?: { teamId: string; name: string; unitId: string | null; unitName: string | null; average: number | null; members: Member[] }[] };
type Color = 'verde' | 'amarelo' | 'vermelho' | 'sem_dado';
type Overview = { goals: (Goal & { progress: { color: Color } })[] };
type Iv = { items: { id: string; teamName: string | null; goalTitle: string; overdue: boolean; dueOn: string }[]; counts: { abertas: number; atrasadas: number } };
type Fer = { today: string; teams: { id: string; name: string }[]; people: { id: string; name: string; teamIds: string[] }[]; vacations: { id: string; userId: string; startDate: string; endDate: string; status: string }[] };

const TONE_TEXT: Record<Tone, string> = { verde: 'text-[#15803D]', amarelo: 'text-[#B45309]', vermelho: 'text-danger', sem_dados: 'text-muted' };
const TONE_BAR: Record<Tone, string> = { verde: 'bg-[#15803D]', amarelo: 'bg-[#D97706]', vermelho: 'bg-danger', sem_dados: 'bg-line' };
const TONE_LABEL: Record<Tone, string> = { verde: 'No alvo', amarelo: 'Atenção', vermelho: 'Abaixo', sem_dados: 'Sem dados' };
const toneOf = (v: number | null | undefined, b?: Perf['bands']): Tone => (v == null || !b ? 'sem_dados' : v * 100 >= b.greenBp ? 'verde' : v * 100 >= b.yellowBp ? 'amarelo' : 'vermelho');
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Agg = { goals: Record<Color, number>; interventions: number; overdue: number; vacations: { name: string; start: string; end: string }[] };
type Member = { userId: string; name: string; levelName: string; lead: boolean; score: number | null; tone: Tone };
type Node = { id: string; kind: 'geral' | 'diretoria' | 'area' | 'unidade' | 'time' | 'pessoa'; name: string; average: number | null; agg: Agg | null; dispersion: DispersionTone | null; children: Node[]; level?: string };
const KIND_LABEL: Record<Node['kind'], string> = { geral: 'Geral', diretoria: 'Diretoria', area: 'Área', unidade: 'Unidade', time: 'Time', pessoa: '' };
const emptyAgg = (): Agg => ({ goals: { verde: 0, amarelo: 0, vermelho: 0, sem_dado: 0 }, interventions: 0, overdue: 0, vacations: [] });
const sumAgg = (xs: (Agg | null)[], extra: Agg = emptyAgg()) => xs.reduce<Agg>((t, x) => (x ? { goals: { verde: t.goals.verde + x.goals.verde, amarelo: t.goals.amarelo + x.goals.amarelo, vermelho: t.goals.vermelho + x.goals.vermelho, sem_dado: t.goals.sem_dado + x.goals.sem_dado }, interventions: t.interventions + x.interventions, overdue: t.overdue + x.overdue, vacations: [...t.vacations, ...x.vacations] } : t), extra);

function GoalsMini({ g }: { g: Record<Color, number> }) {
  const total = g.verde + g.amarelo + g.vermelho + g.sem_dado;
  if (!total) return <span className="text-muted">—</span>;
  const seg: [Color, string][] = [['verde', 'bg-[#15803D]'], ['amarelo', 'bg-[#D97706]'], ['vermelho', 'bg-danger'], ['sem_dado', 'bg-line']];
  return (
    <span className="block" title={`${g.verde} no alvo · ${g.amarelo} em atenção · ${g.vermelho} abaixo · ${g.sem_dado} sem dado`}>
      <span className="flex h-1.5 w-full max-w-[140px] gap-px overflow-hidden bg-surface-2" aria-hidden>{seg.map(([k, c]) => g[k] > 0 && <span key={k} className={c} style={{ width: `${(g[k] / total) * 100}%` }} />)}</span>
      <span className="num mt-1 block text-xs text-ink"><b>{g.verde}</b>/{total} no alvo{g.vermelho > 0 && <span className="font-semibold text-danger"> · {g.vermelho} abaixo</span>}</span>
    </span>
  );
}

function Row({ n, depth, open, toggle, bands }: { n: Node; depth: number; open: Set<string>; toggle: (id: string) => void; bands?: Perf['bands'] }) {
  const tone = n.kind === 'pessoa' ? toneOf(n.average, bands) : toneOf(n.average, bands);
  const isOpen = open.has(n.id);
  const can = n.children.length > 0;
  const top = n.kind === 'geral';
  return (
    <>
      <div role="row" aria-label={`${KIND_LABEL[n.kind] ? `${KIND_LABEL[n.kind]} ` : ''}${n.name}`} aria-expanded={can ? isOpen : undefined}
        className={clsx('grid grid-cols-[minmax(0,1fr)_96px] items-center gap-x-4 border-t border-line px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_120px_minmax(0,1fr)_minmax(0,1fr)_96px_minmax(0,1fr)]', top && 'bg-navy text-white', !top && n.kind !== 'pessoa' && n.kind !== 'time' && 'bg-surface-2/60', n.kind === 'pessoa' && 'py-2')}>
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 22 }}>
          {can ? <button type="button" onClick={() => toggle(n.id)} aria-label={`${isOpen ? 'Recolher' : 'Abrir'} ${n.name}`} className={clsx('flex h-6 w-6 shrink-0 items-center justify-center', top ? 'text-white hover:bg-white/10' : 'text-muted hover:bg-surface-2')}><ChevronRight className={clsx('h-4 w-4 transition-transform', isOpen && 'rotate-90')} /></button> : <span className="w-6 shrink-0" />}
          <span className="min-w-0">
            {KIND_LABEL[n.kind] && !top && <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{KIND_LABEL[n.kind]}</span>}
            <span className={clsx('truncate', n.kind === 'pessoa' ? 'text-sm text-ink' : 'font-semibold', top ? 'font-display text-lg' : 'text-ink')}>{n.name}</span>
            {n.level && <span className="ml-2 text-xs text-muted">{n.level}</span>}
          </span>
        </div>
        <div className="text-right md:text-left">
          <span className={clsx('num font-display font-extrabold', top ? 'text-2xl text-white' : n.kind === 'pessoa' ? 'text-base' : 'text-xl', !top && TONE_TEXT[tone])}>{n.average == null ? '—' : fmtPct(n.average)}</span>
          <span className={clsx('mt-1 block h-1 w-full max-w-[96px] md:max-w-[110px]', top ? 'bg-white/15' : 'bg-surface-2')} aria-hidden><span className={clsx('block h-1', TONE_BAR[tone])} style={{ width: `${Math.min(100, ((n.average ?? 0) / 120) * 100)}%` }} /></span>
        </div>
        {n.kind === 'pessoa' ? <div className="hidden md:col-span-4 md:block" /> : (
          <>
            <div className={clsx('hidden md:block', top && '[&_*]:!text-white')}>{n.agg && <GoalsMini g={n.agg.goals} />}</div>
            <div className={clsx('hidden text-xs md:block', top && 'text-white')}>{n.dispersion ? <span className={clsx('font-semibold', !top && TONE_TEXT[n.dispersion])}>{DISPERSION_LABEL[n.dispersion]}</span> : <span className={top ? 'text-white/60' : 'text-muted'}>—</span>}</div>
            <div className={clsx('hidden text-sm md:block', top && 'text-white')}>{n.agg?.interventions ? <><span className="num font-semibold">{n.agg.interventions}</span>{n.agg.overdue > 0 && <span className={clsx('ml-1 text-xs font-semibold', top ? 'text-white' : 'text-danger')}>({n.agg.overdue} atras.)</span>}</> : <span className={top ? 'text-white/60' : 'text-muted'}>—</span>}</div>
            <div className={clsx('hidden truncate text-xs md:block', top ? 'text-white' : 'text-ink')} title={n.agg?.vacations.map((v) => v.name).join(', ')}>{n.agg?.vacations.length ? (n.kind === 'time' ? n.agg.vacations.map((v) => `${v.name.split(' ')[0]} ${fmtDate(v.start).slice(0, 5)}`).join(', ') : `${n.agg.vacations.length} pessoa(s)`) : <span className={top ? 'text-white/60' : 'text-muted'}>—</span>}</div>
          </>
        )}
      </div>
      {isOpen && n.children.map((c) => <Row key={c.id} n={c} depth={depth + 1} open={open} toggle={toggle} bands={bands} />)}
    </>
  );
}

export function TeamPanelPage() {
  const [open, setOpen] = useState<Set<string> | null>(null);
  const perf = useQuery({ queryKey: ['performance-hier', ''], queryFn: () => api<Perf>('/times/performance') });
  const gam = useGamification();
  const ov = useQuery({ queryKey: ['results', 'overview', 'painel'], queryFn: () => api<Overview>('/results/overview') });
  const iv = useQuery({ queryKey: ['interventions', 'abertas', '', ''], queryFn: () => api<Iv>('/interventions?status=abertas') });
  const fer = useQuery({ queryKey: ['ferias'], queryFn: () => api<Fer>('/times/ferias') });

  if (perf.isLoading) return <LoadingRows rows={6} />;
  if (perf.isError) return <ErrorState error={perf.error} onRetry={() => perf.refetch()} />;
  const p = perf.data!;
  const today = fer.data?.today ?? new Date().toISOString().slice(0, 10);
  const until = addDays(today, 30);
  const board = gam.data?.monthBoard?.teams ?? [];
  const goals = ov.data?.goals ?? [];
  const ivs = iv.data?.items ?? [];

  // folhas: times (com as pessoas); acima, as unidades na hierarquia; no topo, o geral
  const teamNodes: (Node & { unitId: string | null })[] = (p.teams ?? []).map((t) => {
    const members = t.members.map((m) => m.userId);
    const agg = emptyAgg();
    for (const x of goals) if (x.teamId === t.teamId || (x.scope === 'individual' && x.userId && members.includes(x.userId))) agg.goals[x.progress.color] += 1;
    const mine = ivs.filter((i) => i.teamName === t.name);
    agg.interventions = mine.length; agg.overdue = mine.filter((i) => i.overdue).length;
    agg.vacations = (fer.data?.vacations ?? []).filter((v) => v.status !== 'cancelada' && members.includes(v.userId) && v.endDate >= today && v.startDate <= until)
      .sort((x, y) => x.startDate.localeCompare(y.startDate)).map((v) => ({ name: fer.data!.people.find((x) => x.id === v.userId)?.name ?? '', start: v.startDate, end: v.endDate }));
    const people: Node[] = t.members.map((m) => ({ id: `${t.teamId}:${m.userId}`, kind: 'pessoa', name: m.name, level: `${m.levelName}${m.lead ? ' · liderança' : ''}`, average: m.score, agg: null, dispersion: null, children: [] }));
    return { id: t.teamId, unitId: t.unitId, kind: 'time', name: t.name, average: t.average, agg, dispersion: board.find((x) => x.teamId === t.teamId)?.dispersion?.tone ?? null, children: people };
  });
  const units = p.units ?? [];
  const unitNode = (u: (typeof units)[number]): Node => {
    const children = [...units.filter((x) => x.parentId === u.id).map(unitNode), ...teamNodes.filter((t) => t.unitId === u.id)];
    const own = emptyAgg();
    for (const x of goals) if (x.scope === 'unidade' && x.orgUnitId === u.id) own.goals[x.progress.color] += 1;
    return { id: u.id, kind: u.kind, name: u.name, average: u.average, agg: sumAgg(children.map((c) => c.agg), own), dispersion: null, children };
  };
  const topUnits = units.filter((u) => !u.parentId || !units.some((x) => x.id === u.parentId)).map(unitNode);
  const loose = teamNodes.filter((t) => !t.unitId || !units.some((u) => u.id === t.unitId));
  const firstLevel = [...topUnits, ...loose];
  const company = emptyAgg();
  for (const x of goals) if (x.scope === 'empresa') company.goals[x.progress.color] += 1;
  const allGoals: Record<Color, number> = { verde: 0, amarelo: 0, vermelho: 0, sem_dado: 0 };
  for (const x of goals) allGoals[x.progress.color] += 1;
  // no Geral, todas as metas visíveis (as mesmas do resumo), inclusive as de times excluídos ou pessoas fora de time
  const rootAgg = sumAgg(firstLevel.map((c) => c.agg), company);
  rootAgg.goals = { ...allGoals };
  const root: Node = { id: 'geral', kind: 'geral', name: 'Geral', average: p.overall ?? null, agg: rootAgg, dispersion: null, children: firstLevel };
  const cards = teamNodes;
  const opened = open ?? new Set(['geral', ...topUnits.map((u) => u.id)]);
  const toggle = (id: string) => { const n = new Set(opened); if (n.has(id)) n.delete(id); else n.add(id); setOpen(n); };
  const avg = cards.length ? p.overall ?? null : null;
  const vacCount = root.agg!.vacations.length;
  const monthName = new Date(`${p.month}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div>
      <PageHeader icon={<Gauge />} title="Gestão de Times" subtitle={`Como cada time está em ${monthName}: performance, metas, equilíbrio, intervenções e férias.`} />

      <section aria-label="Resumo" className="mb-6 grid grid-cols-2 border border-line bg-surface lg:grid-cols-4">
        {[
          { label: 'Performance média', value: avg == null ? (p.me?.score != null ? fmtPct(p.me.score) : '—') : fmtPct(avg), hint: avg == null && p.me ? 'a sua, no mês' : `${cards.length} time${cards.length === 1 ? '' : 's'}`, tone: toneOf(avg ?? p.me?.score, p.bands) },
          { label: 'Metas no alvo', value: `${allGoals.verde}/${goals.length}`, hint: !goals.length ? 'nenhuma meta no mês' : allGoals.vermelho ? `${allGoals.vermelho} abaixo do esperado` : allGoals.amarelo ? `${allGoals.amarelo} em atenção` : allGoals.sem_dado ? `${allGoals.sem_dado} ainda sem dado` : 'todas no alvo', tone: (allGoals.vermelho ? 'vermelho' : allGoals.amarelo ? 'amarelo' : goals.length && allGoals.verde === goals.length ? 'verde' : 'sem_dados') as Tone },
          { label: 'Intervenções abertas', value: String(iv.data?.counts.abertas ?? 0), hint: iv.data?.counts.atrasadas ? `${iv.data.counts.atrasadas} com prazo vencido` : 'nenhuma atrasada', tone: (iv.data?.counts.atrasadas ? 'vermelho' : 'sem_dados') as Tone },
          { label: 'Férias em 30 dias', value: String(vacCount), hint: vacCount ? 'reveja rotinas e tarefas' : 'ninguém sai', tone: 'sem_dados' as Tone },
        ].map((k, i) => (
          <div key={k.label} className={clsx('px-5 py-4', i > 0 && 'border-l border-line', i === 2 && 'max-lg:border-l-0 max-lg:border-t', i === 3 && 'max-lg:border-t')}>
            <p className="text-sm text-muted">{k.label}</p>
            <p className={clsx('num mt-1 font-display text-3xl font-extrabold', k.tone === 'sem_dados' ? 'text-ink' : TONE_TEXT[k.tone])}>{k.value}</p>
            <p className="text-xs text-muted">{k.hint}</p>
          </div>
        ))}
      </section>

      {ivs.some((i) => i.overdue) && (
        <section aria-label="Precisa de atenção" className="mb-6 border-l-4 border-danger bg-danger-soft/40 px-5 py-3">
          <p className="mb-1 flex items-center gap-2 text-sm font-bold text-ink"><Siren className="h-4 w-4 text-danger" aria-hidden />Precisa de atenção</p>
          <ul className="space-y-0.5 text-sm">{ivs.filter((i) => i.overdue).slice(0, 4).map((i) => <li key={i.id}><Link className="hover:underline" to={`/times/acompanhamento?aba=intervencoes&id=${i.id}`}>{i.goalTitle}</Link><span className="text-muted"> · {teamLabel(i.teamName) ?? 'sem time'} · prazo {fmtDate(i.dueOn)}</span></li>)}</ul>
        </section>
      )}

      {p.pending && <p className="mb-3 border-l-4 border-warning bg-warning-soft/50 px-4 py-2 text-sm text-ink">A performance aparece quando a regra de pontuação for aprovada em Pessoas → Pontuação e regras. Metas, intervenções e férias já valem.</p>}
      {cards.length ? (
        <section aria-label="Performance por hierarquia" className="border border-line bg-surface">
          <div role="row" className="hidden grid-cols-[minmax(0,1.6fr)_120px_minmax(0,1fr)_minmax(0,1fr)_96px_minmax(0,1fr)] gap-x-4 px-4 py-2.5 text-xs font-semibold text-muted md:grid">
            <span>Estrutura</span><span>Performance</span><span>Metas</span><span>Equilíbrio</span><span>Intervenções</span><span>Férias em 30 dias</span>
          </div>
          <Row n={root} depth={0} open={opened} toggle={toggle} bands={p.bands} />
        </section>
      ) : (
        <div className="border border-line bg-surface">
          <EmptyState title={p.me ? 'Você vê o seu resultado; os times aparecem para a liderança e a gestão' : 'Nenhum time por aqui ainda'} description={p.me ? 'Sua performance, suas metas e seus pontos estão em Pessoas e Metas e indicadores.' : 'Quem administra monta os times e responsáveis em Configuração → Gestão de Times.'} />
          {p.me && <div className="flex justify-center gap-4 pb-6 text-sm font-semibold"><Link className="inline-flex items-center gap-1 text-primary hover:underline" to="/times/pessoas">Minha performance<ArrowUpRight className="h-4 w-4" /></Link><Link className="inline-flex items-center gap-1 text-primary hover:underline" to="/meus-pontos">Meus pontos<ArrowUpRight className="h-4 w-4" /></Link></div>}
        </div>
      )}
      {vacCount > 0 && <p className="mt-4 flex items-center gap-2 text-xs text-muted"><Palmtree className="h-4 w-4" aria-hidden />As férias em 30 dias já avisam a pessoa e a liderança para rever rotinas e tarefas do período.</p>}
    </div>
  );
}
