/**
 * Academia RevOps (dentro da Central de Playbooks): trilhas → cursos → módulos → aulas, com vídeos do YouTube.
 *
 * Motor de progresso:
 * - no navegador, a posição do player é lida a cada segundo; dois instantes seguidos tocando viram um trecho
 *   assistido só se a posição andou o que o relógio permite (arrastar a barra quebra o trecho e o pulado não conta);
 * - no servidor, os trechos novos são limitados à duração, unidos aos que já existiam (rever não soma de novo) e o tempo
 *   novo creditado não passa do tempo real desde o último crédito × a velocidade máxima do player, mais uma folga;
 * - a aula conclui ao atingir o percentual mínimo; a trilha soma por quantidade de aulas (A) ou por duração (B).
 * O percentual é uma estimativa de reprodução (o que o player incorporado informa), não prova de aprendizagem.
 */

// ------------------------------------------------------------------ cadastros
export const TRACK_MODES = ['livre', 'obrigatoria', 'atribuida'] as const;
export type TrackMode = (typeof TRACK_MODES)[number];
export const TRACK_MODE_LABELS: Record<TrackMode, string> = { livre: 'Livre', obrigatoria: 'Obrigatória', atribuida: 'Atribuída' };
export const TRACK_LEVELS = ['basico', 'intermediario', 'avancado'] as const;
export type TrackLevel = (typeof TRACK_LEVELS)[number];
export const TRACK_LEVEL_LABELS: Record<TrackLevel, string> = { basico: 'Básico', intermediario: 'Intermediário', avancado: 'Avançado' };
export const PROGRESS_METHODS = ['quantidade', 'duracao'] as const;
export type ProgressMethod = (typeof PROGRESS_METHODS)[number];
export const PROGRESS_METHOD_LABELS: Record<ProgressMethod, string> = { quantidade: 'Por quantidade de aulas', duracao: 'Por duração assistida' };
export const MIN_WATCH_PCTS = [50, 75, 90, 100] as const;
export const TRACK_STATUSES = ['rascunho', 'revisao_gerencia', 'homologacao_diretoria', 'publicada', 'arquivada'] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];
export const TRACK_STATUS_LABELS: Record<TrackStatus, string> = { rascunho: 'Rascunho', revisao_gerencia: 'Em análise da Gerência', homologacao_diretoria: 'Em homologação da Diretoria', publicada: 'Publicada', arquivada: 'Arquivada' };
export const CONTENT_KINDS = ['youtube_video', 'link'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export const CONTENT_STATES = ['disponivel', 'indisponivel', 'privado', 'removido', 'sem_incorporacao', 'desconhecido'] as const;
export type ContentState = (typeof CONTENT_STATES)[number];
export const CONTENT_STATE_LABELS: Record<ContentState, string> = { disponivel: 'Disponível', indisponivel: 'Indisponível', privado: 'Privado', removido: 'Removido', sem_incorporacao: 'Incorporação desligada', desconhecido: 'Não conferido' };
export const playableState = (s: ContentState) => s === 'disponivel' || s === 'desconhecido';
export const ENROLLMENT_STATUSES = ['nao_iniciada', 'em_andamento', 'concluida', 'atrasada'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = { nao_iniciada: 'Não iniciada', em_andamento: 'Em andamento', concluida: 'Concluída', atrasada: 'Atrasada' };
/** Velocidade máxima do player do YouTube (2x) e folga do crédito por envio. */
export const MAX_PLAYBACK_RATE = 2;
export const CREDIT_SLACK_SECONDS = 5;

// ------------------------------------------------------------------ YouTube
export type YtRef = { kind: 'video'; id: string } | { kind: 'playlist'; id: string };
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^(PL|UU|LL|FL|OL|RD)[A-Za-z0-9_-]{10,64}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

/** Link (vídeo, shorts, embed, youtu.be, playlist) ou código → vídeo ou playlist do YouTube; null quando não é do YouTube. */
export function parseYoutube(input: string): YtRef | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  if (VIDEO_ID.test(s)) return { kind: 'video', id: s };
  if (PLAYLIST_ID.test(s)) return { kind: 'playlist', id: s };
  let u: URL;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !YT_HOSTS.has(u.hostname.toLowerCase())) return null;
  const list = u.searchParams.get('list');
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  let video: string | null = null;
  if (host.endsWith('youtu.be')) video = parts[0] ?? null;
  else if (parts[0] === 'watch') video = u.searchParams.get('v');
  else if (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) video = parts[1] ?? null;
  if (list && PLAYLIST_ID.test(list) && (parts[0] === 'playlist' || !video || (parts[0] === 'embed' && parts[1] === 'videoseries'))) return { kind: 'playlist', id: list };
  if (video && VIDEO_ID.test(video)) return { kind: 'video', id: video };
  return null;
}
export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const youtubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
/** Duração ISO 8601 da Data API (PT1H2M3S) em segundos. */
export function isoDurationSeconds(iso: string | null | undefined): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m || iso === 'P' || iso === 'PT') return null;
  return (Number(m[1] ?? 0) * 86_400) + (Number(m[2] ?? 0) * 3_600) + (Number(m[3] ?? 0) * 60) + Number(m[4] ?? 0);
}

// ------------------------------------------------------------------ trechos assistidos
export type Interval = [number, number];
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Une trechos que se tocam ou se sobrepõem (folga de 0,25 s entre leituras). */
export function mergeIntervals(xs: readonly Interval[]): Interval[] {
  const v = xs.filter((x) => Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] > x[0]).map(([a, b]) => [a, b] as Interval).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [a, b] of v) {
    const last = out.at(-1);
    if (last && a <= last[1] + 0.25) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => [r3(a), r3(b)]);
}
export const coveredSeconds = (xs: readonly Interval[]) => mergeIntervals(xs).reduce((t, [a, b]) => t + (b - a), 0);
export const clampIntervals = (xs: readonly Interval[], duration: number | null): Interval[] =>
  xs.map(([a, b]) => [Math.max(0, a), duration != null && duration > 0 ? Math.min(duration, b) : b] as Interval).filter(([a, b]) => b > a);
/** Partes de `incoming` que ainda não estão em `existing`. */
export function freshParts(existing: readonly Interval[], incoming: readonly Interval[]): Interval[] {
  const ex = mergeIntervals(existing);
  const out: Interval[] = [];
  for (const [a0, b] of mergeIntervals(incoming)) {
    let a = a0;
    for (const [x, y] of ex) {
      if (y <= a) continue;
      if (x >= b) break;
      if (x > a) out.push([a, Math.min(x, b)]);
      a = Math.max(a, y);
      if (a >= b) break;
    }
    if (a < b) out.push([a, b]);
  }
  return out.filter(([a, b]) => b - a > 1e-6);
}

/**
 * Crédito de um envio do player: trechos limitados à duração, só o que é novo, e no máximo o tempo real desde o último
 * crédito × a velocidade máxima + folga (duas abas ao mesmo tempo não dobram o progresso).
 */
export function creditIntervals(a: { existing: readonly Interval[]; incoming: readonly Interval[]; durationSeconds: number | null; elapsedSeconds: number; maxRate?: number; slackSeconds?: number }) {
  const fresh = freshParts(a.existing, clampIntervals(a.incoming, a.durationSeconds));
  const cap = Math.max(0, a.elapsedSeconds) * (a.maxRate ?? MAX_PLAYBACK_RATE) + (a.slackSeconds ?? CREDIT_SLACK_SECONDS);
  const taken: Interval[] = [];
  let left = cap;
  for (const [x, y] of fresh) {
    if (left <= 0) break;
    const len = Math.min(y - x, left);
    taken.push([x, x + len]);
    left -= len;
  }
  const freshTotal = fresh.reduce((t, [x, y]) => t + (y - x), 0);
  const credited = taken.reduce((t, [x, y]) => t + (y - x), 0);
  const merged = mergeIntervals([...a.existing, ...taken]);
  return { merged, credited: r3(credited), rejected: r3(freshTotal - credited), watchedSeconds: r3(coveredSeconds(merged)) };
}

/** Leitura do player no navegador: instante (s de relógio), posição (s), tocando, velocidade. */
export type PlayerSample = { t: number; pos: number; playing: boolean; rate: number };
export type TrackerState = { last: PlayerSample | null; pending: Interval[] };
export const emptyTracker = (): TrackerState => ({ last: null, pending: [] });
/** Soma o trecho entre a leitura anterior e esta só se as duas estavam tocando e a posição andou o que o relógio permite. */
export function trackSample(st: TrackerState, s: PlayerSample): TrackerState {
  const l = st.last;
  if (l && l.playing && s.playing) {
    const dt = s.t - l.t, dp = s.pos - l.pos;
    const rate = Math.min(MAX_PLAYBACK_RATE, Math.max(l.rate || 1, s.rate || 1));
    if (dt > 0 && dt <= 30 && dp > 0 && dp <= dt * rate + 1.5) return { last: s, pending: mergeIntervals([...st.pending, [l.pos, s.pos]]) };
  }
  return { last: s, pending: st.pending };
}

// ------------------------------------------------------------------ aula e trilha
export const watchPct = (watched: number, duration: number | null | undefined) => (duration && duration > 0 ? Math.min(100, (watched / duration) * 100) : 0);
/** Percentual mínimo efetivo: a exceção da aula, senão a do curso, senão a da trilha. */
export const effectiveMinPct = (lesson: number | null | undefined, course: number | null | undefined, track: number) => lesson ?? course ?? track;
/** Folga de 1 s no fim: a última leitura do player raramente cai no último segundo do vídeo. */
export const lessonDone = (watched: number, duration: number | null | undefined, minPct: number) =>
  !!duration && duration > 0 && (watchPct(watched, duration) >= minPct - 1e-6 || (minPct >= 100 && watched >= duration - 1));

export type LessonState = { lessonId: string; required: boolean; available: boolean; durationSeconds: number | null; watchedSeconds: number; done: boolean };
export type TrackProgress = { pct: number; doneRequired: number; totalRequired: number; watchedSeconds: number; totalSeconds: number; videoComplete: boolean; unavailable: number };
/**
 * Progresso audiovisual da trilha sobre as aulas obrigatórias disponíveis: A = aulas concluídas ÷ aulas;
 * B = tempo assistido ÷ duração total (sem duração conhecida em alguma aula, cai para A). Aula indisponível sai da conta.
 */
export function trackProgress(lessons: readonly LessonState[], method: ProgressMethod): TrackProgress {
  const req = lessons.filter((l) => l.required);
  const ok = req.filter((l) => l.available);
  const done = ok.filter((l) => l.done).length;
  const withDur = ok.filter((l) => (l.durationSeconds ?? 0) > 0);
  const totalSeconds = withDur.reduce((t, l) => t + l.durationSeconds!, 0);
  const watched = withDur.reduce((t, l) => t + Math.min(l.watchedSeconds, l.durationSeconds!), 0);
  const byCount = ok.length ? (done / ok.length) * 100 : 0;
  const pct = method === 'duracao' && withDur.length === ok.length && totalSeconds > 0 ? (watched / totalSeconds) * 100 : byCount;
  return { pct: Math.round(pct * 10) / 10, doneRequired: done, totalRequired: ok.length, watchedSeconds: Math.round(watched), totalSeconds, videoComplete: ok.length > 0 && done === ok.length, unavailable: req.length - ok.length };
}
/** Situação da inscrição: concluída, atrasada (prazo vencido), em andamento ou não iniciada. */
export function enrollmentStatus(a: { complete: boolean; started: boolean; dueOn: string | null; today: string }): EnrollmentStatus {
  if (a.complete) return 'concluida';
  if (a.dueOn && a.dueOn < a.today) return 'atrasada';
  return a.started ? 'em_andamento' : 'nao_iniciada';
}
/** Sequência obrigatória: a aula fica bloqueada enquanto houver obrigatória disponível anterior não concluída. */
export function lockedLessons(order: readonly LessonState[], sequential: boolean): Set<string> {
  const out = new Set<string>();
  if (!sequential) return out;
  let blocked = false;
  for (const l of order) {
    if (blocked) out.add(l.lessonId);
    if (l.required && l.available && !l.done) blocked = true;
  }
  return out;
}

// ------------------------------------------------------------------ estrutura publicada (fotografia da versão)
export type SnapLesson = { id: string; title: string; description: string | null; contentId: string; kind: ContentKind; externalId: string | null; url: string | null; durationSeconds: number | null; thumbnailUrl: string | null; required: boolean; minWatchPct: number | null };
export type SnapModule = { id: string; title: string; playlistId?: string | null; lessons: SnapLesson[] };
export type SnapCourse = { id: string; title: string; description: string | null; minWatchPct: number | null; modules: SnapModule[] };
export type TrackSnapshot = { courses: SnapCourse[] };
export const snapshotLessons = (s: TrackSnapshot) => s.courses.flatMap((c) => c.modules.flatMap((m) => m.lessons.map((l) => ({ ...l, courseId: c.id, moduleId: m.id, courseMinPct: c.minWatchPct }))));
export function structureErrors(s: TrackSnapshot): string[] {
  const e: string[] = [];
  const lessons = snapshotLessons(s);
  if (!s.courses.length) e.push('Inclua ao menos um curso.');
  if (s.courses.some((c) => !c.modules.length)) e.push('Cada curso precisa de ao menos um módulo.');
  if (s.courses.some((c) => c.modules.some((m) => !m.lessons.length))) e.push('Cada módulo precisa de ao menos uma aula.');
  if (lessons.length && !lessons.some((l) => l.required)) e.push('Marque ao menos uma aula como obrigatória.');
  return e;
}
/** Carga horária em minutos pela soma das durações conhecidas. */
export const snapshotMinutes = (s: TrackSnapshot) => Math.round(snapshotLessons(s).reduce((t, l) => t + (l.durationSeconds ?? 0), 0) / 60);
export const fmtDuration = (sec: number | null | undefined) => {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};

// ------------------------------------------------------------------ certificado e anotações
/** Código de verificação do certificado da trilha: ACD-AAAA-NNNNNN. */
export const academyCertificateCode = (year: number, n: number) => `ACD-${year}-${String(n).padStart(6, '0')}`;
/** Carga horária a partir de segundos: "2 h 15 min", "45 min", "1 h". Menos de 1 min vira "1 min". */
export function fmtWorkload(seconds: number) {
  const min = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
/** Tempo do vídeo para a anotação: "3:07" ou "1:02:05". */
export const fmtTimecode = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
/** Carga do certificado: soma da duração das aulas em vídeo concluídas (obrigatórias e opcionais); links não têm duração. */
export function certificateWorkload(lessons: readonly { kind: ContentKind; durationSeconds: number | null; done: boolean }[]) {
  const done = lessons.filter((l) => l.done && l.kind === 'youtube_video');
  return { seconds: done.reduce((t, l) => t + (l.durationSeconds ?? 0), 0), lessons: done.length };
}
