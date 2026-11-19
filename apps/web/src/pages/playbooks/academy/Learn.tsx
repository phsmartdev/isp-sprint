/**
 * Academia — lado de quem aprende: Trilhas de Aprendizagem (catálogo), Minha Aprendizagem, a página da trilha (jornada)
 * e a página da aula com o player. Tudo o que aparece de progresso vem do servidor.
 */
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Award, Check, ChevronLeft, ChevronRight, Clock, ExternalLink, Lock, Pencil, Play, Search, Trash2 } from 'lucide-react';
import { CONTENT_STATE_LABELS, ENROLLMENT_STATUS_LABELS, TRACK_LEVEL_LABELS, TRACK_MODE_LABELS, fmtDuration, fmtTimecode, fmtWorkload, type ContentState, type EnrollmentStatus, type TrackLevel, type TrackMode } from '@isp/domain';
import { api, qs } from '../../../lib/api';
import { fmtDate } from '../../../lib/format';
import { useDebounced } from '../../../lib/hooks';
import { Breadcrumb, Button, EmptyState, ErrorState, LoadingRows, Textarea } from '../../../components/ui/primitives';
import { useToast } from '../../../components/ui/overlay';
import { errMsg } from '../../../features/contracts/shared';
import { YoutubePlayer, type BeatResult, type PlayerControl } from '../../../features/academy/YoutubePlayer';

export type Note = { id: string; lessonId: string; position: number; text: string; createdAt: string; updatedAt: string };
const lessonLink = (trackId: string, lessonId: string, t?: number) => `/playbooks/academia/trilhas/${trackId}/aulas/${lessonId}${t !== undefined ? `?t=${t}` : ''}`;

export type TrackCard = {
  id: string; title: string; description: string | null; cover: string | null; mode: TrackMode; level: TrackLevel; minutes: number; lessons: number;
  competencies: string[]; team: string | null; curator: string | null; dueDays: number | null; status: string;
  me: { enrolled: true; source: string; dueOn: string | null; status: EnrollmentStatus; pct: number; done: number; total: number; nextLessonId: string | null; completedAt: string | null; lastLessonId: string | null } | null;
};
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);
const STATUS_TONE: Record<EnrollmentStatus, string> = { nao_iniciada: 'text-muted', em_andamento: 'text-primary', concluida: 'text-[#15803D]', atrasada: 'text-danger' };

export function Bar({ pct, className }: { pct: number; className?: string }) {
  return <div className={clsx('h-1.5 w-full bg-surface-2', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} /></div>;
}

function Card({ c }: { c: TrackCard }) {
  return (
    <Link to={`/playbooks/academia/trilhas/${c.id}`} className="group flex flex-col border border-line bg-surface hover:border-line-strong" data-testid="track-card">
      <div className="relative aspect-[16/7] overflow-hidden bg-navy">
        {c.cover && <img src={c.cover} alt="" className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" loading="lazy" />}
        <span className="absolute left-0 top-0 bg-navy px-2 py-1 text-xs font-semibold text-white">{TRACK_MODE_LABELS[c.mode]}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-display text-base font-bold leading-snug text-ink">{c.title}</h3>
        {c.description && <p className="line-clamp-2 text-sm text-text">{c.description}</p>}
        <p className="flex flex-wrap gap-x-3 text-xs text-muted"><span>{TRACK_LEVEL_LABELS[c.level]}</span><span>{c.lessons} aula(s)</span>{c.minutes > 0 && <span>{hm(c.minutes)}</span>}{c.team && <span>{c.team}</span>}</p>
        <div className="mt-auto pt-2">
          {c.me ? (
            <>
              <div className="mb-1 flex items-baseline justify-between text-xs"><span className={clsx('font-semibold', STATUS_TONE[c.me.status])}>{ENROLLMENT_STATUS_LABELS[c.me.status]}</span><span className="num text-muted">{c.me.pct.toLocaleString('pt-BR')}%</span></div>
              <Bar pct={c.me.pct} />
              {c.me.dueOn && c.me.status !== 'concluida' && <p className="mt-1 text-xs text-muted">Prazo {fmtDate(c.me.dueOn)}</p>}
            </>
          ) : <span className="text-sm font-semibold text-primary">Ver trilha</span>}
        </div>
      </div>
    </Link>
  );
}
const Grid = ({ items }: { items: TrackCard[] }) => <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map((c) => <Card key={c.id} c={c} />)}</div>;

/** Aba “Trilhas de Aprendizagem”: as trilhas publicadas que a pessoa pode ver. */
export function TrackCatalog() {
  const [term, setTerm] = useState('');
  const q = useDebounced(term, 300);
  const r = useQuery({ queryKey: ['academia', 'catalogo', q], queryFn: () => api<{ items: TrackCard[] }>(`/academia/catalogo${qs({ q: q || undefined })}`) });
  return (
    <div className="space-y-5">
      <label className="flex max-w-xl items-center gap-2 border border-line bg-surface px-3">
        <Search className="h-4 w-4 text-muted" aria-hidden />
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Buscar trilha, tema ou competência" aria-label="Buscar trilhas" className="h-10 flex-1 bg-transparent outline-none" />
      </label>
      {r.isLoading ? <LoadingRows rows={4} /> : r.isError ? <ErrorState error={r.error} onRetry={() => r.refetch()} /> : !r.data!.items.length
        ? <EmptyState title={q ? 'Nenhuma trilha encontrada' : 'Ainda não há trilhas publicadas para você'} description={q ? 'Tente outras palavras.' : 'As trilhas aprovadas pela Gerência aparecem aqui conforme o seu time e perfil.'} />
        : <Grid items={r.data!.items} />}
    </div>
  );
}

type Mine = { inProgress: TrackCard[]; required: TrackCard[]; notStarted: TrackCard[]; completed: TrackCard[]; recommended: TrackCard[]; next: { trackId: string; title: string; lessonId: string } | null; totals: { enrolled: number; completed: number; late: number; minutes: number } };
/** Aba “Minha Aprendizagem”. */
export function MyLearning() {
  const r = useQuery({ queryKey: ['academia', 'minha'], queryFn: () => api<Mine>('/academia/minha') });
  if (r.isLoading) return <LoadingRows rows={4} />;
  if (r.isError) return <ErrorState error={r.error} onRetry={() => r.refetch()} />;
  const d = r.data!;
  const shelf = (title: string, items: TrackCard[]) => !!items.length && <section aria-label={title} className="space-y-3"><h2 className="font-display text-lg font-bold text-ink">{title}</h2><Grid items={items} /></section>;
  const stat = (label: string, v: string, tone?: string) => <div className="bg-surface px-5 py-4"><p className="text-sm text-muted">{label}</p><p className={clsx('num font-display text-2xl font-extrabold', tone ?? 'text-ink')}>{v}</p></div>;
  return (
    <div className="space-y-8">
      {d.next && (
        <Link to={`/playbooks/academia/trilhas/${d.next.trackId}/aulas/${d.next.lessonId}`} className="flex items-center gap-4 bg-navy px-5 py-4 text-white hover:bg-navy/95" data-testid="continue">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-primary"><Play className="h-5 w-5" aria-hidden /></span>
          <span className="flex-1"><span className="block text-sm text-white/70">Continue de onde parou</span><span className="font-semibold">{d.next.title}</span></span>
          <ChevronRight className="h-5 w-5" aria-hidden />
        </Link>
      )}
      <section aria-label="Resumo" className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {stat('Trilhas', String(d.totals.enrolled))}
        {stat('Concluídas', String(d.totals.completed), d.totals.completed ? 'text-[#15803D]' : undefined)}
        {stat('Atrasadas', String(d.totals.late), d.totals.late ? 'text-danger' : undefined)}
        {stat('Carga concluída', hm(d.totals.minutes))}
      </section>
      {shelf('Obrigatórias e atribuídas a você', d.required)}
      {shelf('Em andamento', d.inProgress.filter((c) => !d.required.some((x) => x.id === c.id)))}
      {shelf('Não iniciadas', d.notStarted.filter((c) => !d.required.some((x) => x.id === c.id)))}
      {shelf('Concluídas', d.completed)}
      {shelf('Recomendadas', d.recommended)}
      {!d.totals.enrolled && !d.recommended.length && <EmptyState title="Você ainda não está em nenhuma trilha" description="Veja as trilhas disponíveis em “Trilhas de Aprendizagem”. As obrigatórias e as atribuídas pela liderança aparecem aqui sozinhas." />}
    </div>
  );
}

// ------------------------------------------------------------------ página da trilha (jornada)
type LessonView = { id: string; title: string; kind: 'youtube_video' | 'link'; durationSeconds: number | null; thumbnailUrl: string | null; required: boolean; pct: number; done: boolean; locked: boolean; available: boolean; state: ContentState; minPct: number };
type TrackPage = {
  track: { id: string; title: string; description: string | null; cover: string | null; mode: TrackMode; level: TrackLevel; minutes: number; objectives: string[]; competencies: string[]; team: string | null; curator: string | null; minWatchPct: number; progressMethod: string; sequential: boolean; version: number; archived: boolean };
  courses: { id: string; title: string; description: string | null; modules: { id: string; title: string; lessons: LessonView[] }[] }[];
  prerequisites: { id: string; title: string; done: boolean }[];
  me: { enrolled: true; status: EnrollmentStatus; dueOn: string | null; source: string; completedAt: string | null; lastLessonId: string | null } | null;
  progress: { pct: number; doneRequired: number; totalRequired: number; unavailable: number }; nextLessonId: string | null; newerVersion: boolean;
  certificate: { enabled: boolean; issued: { id: string; code: string; seconds: number; lessons: number; issuedOn: string } | null };
  notes: Note[];
};

function Node({ l, enrolled, trackId }: { l: LessonView; enrolled: boolean; trackId: string }) {
  const icon = !l.available ? <AlertTriangle className="h-4 w-4" aria-hidden /> : l.done ? <Check className="h-4 w-4" aria-hidden /> : l.locked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : l.kind === 'link' ? <ExternalLink className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />;
  const dot = <span className={clsx('relative z-10 flex h-8 w-8 shrink-0 items-center justify-center border-2', !l.available ? 'border-[#B45309] bg-surface text-[#B45309]' : l.done ? 'border-[#15803D] bg-[#15803D] text-white' : l.pct > 0 ? 'border-primary bg-surface text-primary' : 'border-line-strong bg-surface text-muted')}>{icon}</span>;
  const body = (
    <span className="min-w-0 flex-1">
      <span className="block font-semibold text-ink">{l.title}</span>
      <span className="flex flex-wrap gap-x-3 text-xs text-muted">
        {l.kind === 'link' ? <span>Material de apoio</span> : <span>{l.durationSeconds ? fmtDuration(l.durationSeconds) : 'duração após a 1ª reprodução'}</span>}
        {!l.required && <span>opcional</span>}
        {l.kind !== 'link' && l.available && <span className="num">{l.pct.toLocaleString('pt-BR')}% assistido · conclui com {l.minPct}%</span>}
        {!l.available && <span className="font-semibold text-[#B45309]">{CONTENT_STATE_LABELS[l.state]} — fora do cálculo</span>}
        {l.locked && <span>libera após a anterior</span>}
      </span>
    </span>
  );
  const can = enrolled && l.available && !l.locked && l.kind !== 'link';
  return (
    <li className="relative flex items-center gap-3 py-2">
      {dot}
      {can ? <Link to={`/playbooks/academia/trilhas/${trackId}/aulas/${l.id}`} className="flex min-w-0 flex-1 items-center gap-3 hover:text-primary">{body}<ChevronRight className="h-4 w-4 text-muted" aria-hidden /></Link> : body}
    </li>
  );
}

export function AcademyTrackPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const r = useQuery({ queryKey: ['academia', 'trilha', id], queryFn: () => api<TrackPage>(`/academia/trilhas/${id}`) });
  const enroll = useMutation({
    mutationFn: () => api(`/academia/trilhas/${id}/inscrever`, { method: 'POST' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['academia'] }); toast({ tone: 'success', message: 'Inscrição feita' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (r.isLoading) return <LoadingRows rows={6} />;
  if (r.isError) return <ErrorState error={r.error} onRetry={() => r.refetch()} />;
  const d = r.data!, t = d.track;
  const preMissing = d.prerequisites.some((p) => !p.done);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <Breadcrumb items={[{ label: 'Playbooks', to: '/playbooks' }, { label: 'Trilhas de Aprendizagem', to: '/playbooks?aba=trilhas' }, { label: t.title }]} />
      <header className="grid gap-0 border border-line bg-surface md:grid-cols-[1fr_320px]">
        <div className="space-y-3 p-6">
          <p className="text-sm text-muted">{TRACK_MODE_LABELS[t.mode]} · {TRACK_LEVEL_LABELS[t.level]}{t.minutes ? ` · ${hm(t.minutes)}` : ''} · versão {t.version}</p>
          <h1 className="font-display text-2xl font-bold text-ink">{t.title}</h1>
          {t.description && <p className="text-text">{t.description}</p>}
          {!!t.objectives.length && <ul className="list-disc space-y-0.5 pl-5 text-sm text-text">{t.objectives.map((o) => <li key={o}>{o}</li>)}</ul>}
          {!!t.competencies.length && <p className="flex flex-wrap gap-1.5">{t.competencies.map((c) => <span key={c} className="border border-line px-2 py-0.5 text-xs text-ink">{c}</span>)}</p>}
          <p className="text-xs text-muted">{[t.team && `Time ${t.team}`, t.curator && `Curadoria ${t.curator}`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex flex-col justify-center gap-3 bg-navy p-6 text-white">
          {d.me ? (
            <>
              <p className="text-sm text-white/70">{ENROLLMENT_STATUS_LABELS[d.me.status]}{d.me.dueOn && d.me.status !== 'concluida' ? ` · prazo ${fmtDate(d.me.dueOn)}` : ''}</p>
              <p className="num font-display text-4xl font-extrabold" data-testid="track-pct">{d.progress.pct.toLocaleString('pt-BR')}%</p>
              <Bar pct={d.progress.pct} className="bg-white/15" />
              <p className="text-sm text-white/80">{d.progress.doneRequired} de {d.progress.totalRequired} aulas obrigatórias concluídas{d.progress.unavailable ? ` · ${d.progress.unavailable} indisponível(is) fora da conta` : ''}</p>
              {d.nextLessonId && <Button variant="primary" onClick={() => nav(`/playbooks/academia/trilhas/${id}/aulas/${d.nextLessonId}`)} icon={<Play className="h-4 w-4" />}>{d.progress.pct > 0 ? 'Continuar' : 'Começar'}</Button>}
              {d.me.completedAt && <p className="text-sm font-semibold">Concluída em {fmtDate(d.me.completedAt)}</p>}
              {d.certificate.issued && (
                <a href={`/api/v1/academia/trilhas/${id}/certificado`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 border border-white/25 px-3 py-2 hover:bg-white/10" data-testid="certificate">
                  <Award className="h-6 w-6 shrink-0" aria-hidden />
                  <span><span className="block font-semibold">Baixar certificado</span><span className="text-xs text-white/75">{fmtWorkload(d.certificate.issued.seconds)} · {d.certificate.issued.lessons} aula(s) · {d.certificate.issued.code}</span></span>
                </a>
              )}
              {d.certificate.enabled && !d.me.completedAt && <p className="text-xs text-white/70">Ao concluir, você recebe o certificado com a carga horária das aulas que assistiu.</p>}
            </>
          ) : (
            <>
              <p className="text-sm text-white/80">Cada aula conclui com {t.minWatchPct}% assistido de verdade (o tempo pulado na barra não conta).</p>
              {preMissing && <p className="text-sm text-white/80">Conclua antes: {d.prerequisites.filter((p) => !p.done).map((p) => p.title).join(', ')}.</p>}
              <Button variant="primary" loading={enroll.isPending} disabled={preMissing || t.archived} onClick={() => enroll.mutate()}>Inscrever-me</Button>
            </>
          )}
        </div>
      </header>
      {d.newerVersion && <p className="border border-line bg-surface-2 px-4 py-2 text-sm text-text">Esta trilha tem uma versão mais nova. Você segue na versão em que entrou, para o seu progresso não mudar.</p>}
      <section aria-label="Jornada" className="space-y-6">
        {d.courses.map((c, ci) => (
          <div key={c.id} className="border border-line bg-surface">
            <div className="border-b border-line px-5 py-3"><p className="text-xs text-muted">Curso {ci + 1}</p><h2 className="font-display text-lg font-bold text-ink">{c.title}</h2>{c.description && <p className="text-sm text-text">{c.description}</p>}</div>
            <div className="space-y-4 px-5 py-4">
              {c.modules.map((m) => {
                const req = m.lessons.filter((l) => l.required && l.available);
                return (
                  <div key={m.id}>
                    <p className="mb-1 flex items-baseline justify-between gap-3"><span className="font-semibold text-ink">{m.title}</span><span className="num text-xs text-muted">{req.filter((l) => l.done).length}/{req.length}</span></p>
                    <ol className="relative before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-0.5 before:bg-line">{m.lessons.map((l) => <Node key={l.id} l={l} enrolled={!!d.me} trackId={id} />)}</ol>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>
      {!!d.notes.length && (
        <section aria-label="Minhas anotações" className="border border-line bg-surface">
          <h2 className="border-b border-line px-5 py-3 font-display text-lg font-bold text-ink">Minhas anotações</h2>
          <ul className="divide-y divide-line">{d.courses.flatMap((c) => c.modules.flatMap((m) => m.lessons)).filter((l) => d.notes.some((n) => n.lessonId === l.id)).map((l) => (
            <li key={l.id} className="px-5 py-3">
              <p className="mb-1 text-sm font-semibold text-ink">{l.title}</p>
              <ul className="space-y-1">{d.notes.filter((n) => n.lessonId === l.id).map((n) => (
                <li key={n.id} className="flex gap-3 text-sm"><Link to={lessonLink(id, l.id, n.position)} className="num shrink-0 font-semibold text-primary hover:underline" aria-label={`Ir para ${fmtTimecode(n.position)} de ${l.title}`}>{fmtTimecode(n.position)}</Link><span className="whitespace-pre-line text-text">{n.text}</span></li>
              ))}</ul>
            </li>
          ))}</ul>
        </section>
      )}
    </div>
  );
}

/** Anotações da aula: cada uma presa ao ponto do vídeo em que foi feita; o tempo é um link que leva o vídeo até lá. */
function LessonNotes({ trackId, lessonId, initial, control, canSeek }: { trackId: string; lessonId: string; initial: Note[]; control: { current: PlayerControl | null }; canSeek: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [notes, setNotes] = useState(initial);
  const [text, setText] = useState('');
  const [at, setAt] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const now = () => Math.floor(control.current?.time() ?? 0);
  const sorted = (xs: Note[]) => [...xs].sort((a, b) => a.position - b.position);
  const done = () => void qc.invalidateQueries({ queryKey: ['academia', 'trilha', trackId] });
  const add = useMutation({
    mutationFn: () => api<Note>(`/academia/trilhas/${trackId}/aulas/${lessonId}/anotacoes`, { method: 'POST', body: { position: at ?? now(), text } }),
    onSuccess: (n) => { setNotes((xs) => sorted([...xs, n])); setText(''); setAt(null); done(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const save = useMutation({
    mutationFn: (x: { id: string; text: string; position: number }) => api<Note>(`/academia/anotacoes/${x.id}`, { method: 'PUT', body: { text: x.text, position: x.position } }),
    onSuccess: (n) => { setNotes((xs) => sorted(xs.map((y) => (y.id === n.id ? n : y)))); setEdit(null); done(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const del = useMutation({
    mutationFn: (nid: string) => api(`/academia/anotacoes/${nid}`, { method: 'DELETE' }),
    onSuccess: (_r, nid) => { setNotes((xs) => xs.filter((y) => y.id !== nid)); done(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const go = (sec: number) => { control.current?.seek(sec); document.querySelector('[data-testid="yt-player"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  return (
    <section aria-label="Anotações" className="space-y-3 border border-line bg-surface p-4">
      <h2 className="font-semibold text-ink">Anotações</h2>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
        <Textarea aria-label="Nova anotação" rows={2} value={text} placeholder="Escreva o que quer lembrar deste ponto do vídeo" onFocus={() => { if (at === null) setAt(now()); }} onChange={(e) => { if (at === null) setAt(now()); setText(e.target.value); }} />
        <div className="flex flex-wrap items-center gap-2">
          {at === null ? <span className="text-sm text-muted">O ponto do vídeo é marcado quando você começa a escrever.</span> : <span className="text-sm text-muted">No vídeo em <span className="num font-semibold text-ink" data-testid="note-at">{fmtTimecode(at)}</span></span>}
          <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setAt(now())}>Usar o tempo atual</button>
          <Button type="submit" size="sm" variant="primary" className="ml-auto" disabled={!text.trim()} loading={add.isPending}>Salvar anotação</Button>
        </div>
      </form>
      {!notes.length ? <p className="text-sm text-muted">Suas anotações ficam só para você e levam o vídeo de volta ao ponto em que foram feitas.</p> : (
        <ul className="divide-y divide-line border-t border-line" data-testid="notes">{notes.map((n) => (
          <li key={n.id} className="flex items-start gap-3 py-2">
            <a href={lessonLink(trackId, lessonId, n.position)} onClick={(e) => { if (canSeek) { e.preventDefault(); go(n.position); } }} className="num shrink-0 bg-primary-soft px-2 py-0.5 text-sm font-semibold text-primary hover:underline" aria-label={`Ir para ${fmtTimecode(n.position)} do vídeo`}>{fmtTimecode(n.position)}</a>
            {edit?.id === n.id ? (
              <form className="flex-1 space-y-1" onSubmit={(e) => { e.preventDefault(); if (edit.text.trim()) save.mutate({ id: n.id, text: edit.text, position: n.position }); }}>
                <Textarea aria-label="Editar anotação" rows={2} value={edit.text} onChange={(e) => setEdit({ id: n.id, text: e.target.value })} />
                <div className="flex gap-2"><Button size="sm" type="submit" variant="primary" loading={save.isPending}>Salvar</Button><Button size="sm" onClick={() => setEdit(null)}>Cancelar</Button></div>
              </form>
            ) : <p className="flex-1 whitespace-pre-line text-sm text-text">{n.text}</p>}
            {edit?.id !== n.id && <span className="flex shrink-0 gap-1">
              <button type="button" aria-label="Editar anotação" className="p-1 text-muted hover:text-ink" onClick={() => setEdit({ id: n.id, text: n.text })}><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label="Excluir anotação" className="p-1 text-muted hover:text-danger" onClick={() => del.mutate(n.id)}><Trash2 className="h-3.5 w-3.5" /></button>
            </span>}
          </li>
        ))}</ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ página da aula
type LessonPage = {
  track: { id: string; title: string; progress: { pct: number }; sequential: boolean };
  lesson: { id: string; title: string; description: string | null; kind: string; videoId: string | null; url: string | null; required: boolean; minPct: number; locked: boolean; state: ContentState; available: boolean; durationSeconds: number | null; channel: string | null };
  progress: { pct: number; watchedSeconds: number; done: boolean; resumeAt: number };
  course: { id: string; title: string }; module: { id: string; title: string; lessons: { id: string; title: string; durationSeconds: number | null; pct: number; done: boolean; locked: boolean; available: boolean; required: boolean }[] };
  materials: { id: string; title: string; url: string | null }[];
  notes: Note[];
  prevId: string | null; nextId: string | null;
};
/** Uma instância por aula e por link de anotação (?t=), para o player abrir no ponto certo ao trocar de aula. */
export function AcademyLessonPage() {
  const { lessonId = '' } = useParams();
  const [sp] = useSearchParams();
  return <LessonPage key={`${lessonId}:${sp.get('t') ?? ''}`} />;
}

function LessonPage() {
  const { id = '', lessonId = '' } = useParams();
  const qc = useQueryClient();
  // sempre busca de novo ao abrir a aula (anotações e ponto de retomada atuais); não recarrega com a aula aberta, para não recriar o player
  const r = useQuery({ queryKey: ['academia', 'aula', id, lessonId], queryFn: () => api<LessonPage>(`/academia/trilhas/${id}/aulas/${lessonId}`), staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const [live, setLive] = useState<BeatResult | null>(null);
  const control = useRef<PlayerControl | null>(null);
  // ?t= vindo de uma anotação: abre o vídeo naquele ponto (lido uma vez, para não recriar o player)
  const [sp] = useSearchParams();
  const [startAt] = useState(() => { const t = Number(sp.get('t')); return Number.isFinite(t) && t >= 0 && sp.has('t') ? Math.floor(t) : null; });
  if (r.isLoading || !r.isFetchedAfterMount) return <LoadingRows rows={6} />;
  if (r.isError) return <ErrorState error={r.error} onRetry={() => r.refetch()} />;
  const d = r.data!, l = d.lesson;
  const pct = live && !live.duplicate ? live.pct : d.progress.pct;
  const done = live?.done ?? d.progress.done;
  const trackPct = live?.track?.pct ?? d.track.progress.pct;
  const onBeat = (b: BeatResult) => { setLive(b); if (b.done !== d.progress.done || b.track?.complete) void qc.invalidateQueries({ queryKey: ['academia', 'trilha', id] }); void qc.invalidateQueries({ queryKey: ['academia', 'minha'] }); };
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <Breadcrumb items={[{ label: 'Playbooks', to: '/playbooks' }, { label: d.track.title, to: `/playbooks/academia/trilhas/${id}` }, { label: l.title }]} />
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          {l.locked ? <EmptyState title="Aula bloqueada" description="Conclua as aulas obrigatórias anteriores para liberar esta." />
            : !l.available || !l.videoId ? <div role="alert" className="flex aspect-video items-center justify-center bg-navy p-6 text-center text-white">Vídeo {CONTENT_STATE_LABELS[l.state].toLowerCase()}. Esta aula fica fora do cálculo até quem cuida da trilha trocar o vídeo.</div>
              : <YoutubePlayer key={l.id} trackId={id} lessonId={l.id} videoId={l.videoId} resumeAt={startAt ?? d.progress.resumeAt} onBeat={onBeat} control={control} />}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted">{d.course.title} · {d.module.title}</p>
              <h1 className="font-display text-xl font-bold text-ink">{l.title}</h1>
              {l.channel && <p className="text-sm text-muted">{l.channel} · YouTube</p>}
            </div>
            <div className="w-56" aria-label="Progresso da aula">
              <p className="flex justify-between text-sm"><span className={clsx('font-semibold', done ? 'text-[#15803D]' : 'text-ink')}>{done ? 'Aula concluída' : `Conclui com ${l.minPct}%`}</span><span className="num text-muted" data-testid="lesson-pct">{pct.toLocaleString('pt-BR')}%</span></p>
              <Bar pct={pct} className="mt-1" />
              <p className="mt-1 text-xs text-muted">Trilha: <span className="num" data-testid="lesson-track-pct">{trackPct.toLocaleString('pt-BR')}%</span></p>
            </div>
          </div>
          {!l.locked && l.available && l.videoId && <LessonNotes key={l.id} trackId={id} lessonId={l.id} initial={d.notes} control={control} canSeek />}
          {l.description && <p className="whitespace-pre-line text-sm text-text">{l.description}</p>}
          {!!d.materials.length && (
            <section aria-label="Materiais de apoio"><h2 className="mb-1 font-semibold text-ink">Materiais de apoio</h2>
              <ul className="space-y-1">{d.materials.map((m) => <li key={m.id}><a href={m.url ?? '#'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"><ExternalLink className="h-3.5 w-3.5" aria-hidden />{m.title}</a></li>)}</ul>
            </section>
          )}
          <div className="flex justify-between gap-2 border-t border-line pt-3">
            {d.prevId ? <Link to={`/playbooks/academia/trilhas/${id}/aulas/${d.prevId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><ChevronLeft className="h-4 w-4" />Aula anterior</Link> : <span />}
            {d.nextId && <Link to={`/playbooks/academia/trilhas/${id}/aulas/${d.nextId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary">Próxima aula<ChevronRight className="h-4 w-4" /></Link>}
          </div>
        </div>
        <aside aria-label="Aulas do módulo" className="border border-line bg-surface lg:self-start">
          <p className="border-b border-line px-4 py-2.5 font-semibold text-ink">{d.module.title}</p>
          <ol>{d.module.lessons.map((x) => {
            const cur = x.id === l.id;
            const inner = <><span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center border text-xs', x.done ? 'border-[#15803D] bg-[#15803D] text-white' : 'border-line-strong text-muted')}>{x.done ? <Check className="h-3.5 w-3.5" /> : x.locked ? <Lock className="h-3 w-3" /> : <Clock className="h-3 w-3" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm">{x.title}</span><span className="num text-xs text-muted">{fmtDuration(x.durationSeconds)}{x.pct ? ` · ${x.pct.toLocaleString('pt-BR')}%` : ''}</span></span></>;
            return <li key={x.id}>{x.locked || !x.available || cur ? <div className={clsx('flex items-center gap-2 px-4 py-2', cur && 'bg-primary-soft font-semibold', (x.locked || !x.available) && 'opacity-60')}>{inner}</div> : <Link to={`/playbooks/academia/trilhas/${id}/aulas/${x.id}`} className="flex items-center gap-2 px-4 py-2 hover:bg-surface-2">{inner}</Link>}</li>;
          })}</ol>
        </aside>
      </div>
    </div>
  );
}
