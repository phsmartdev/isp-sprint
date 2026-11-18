/**
 * Player da Academia: o player oficial do YouTube (IFrame API, domínio youtube-nocookie), com os controles e anúncios do
 * próprio YouTube. A cada segundo lemos posição, estado e velocidade; só o trecho efetivamente reproduzido vira intervalo
 * (avanço na barra, pausa e repetição não contam). Os intervalos vão ao servidor a cada 10 s e ao pausar, terminar ou
 * sair da aba. O servidor decide o crédito; esta tela só mostra o que ele aceitou.
 */
import { useEffect, useRef, useState } from 'react';
import { emptyTracker, trackSample, type Interval, type TrackerState } from '@isp/domain';
import { api } from '../../lib/api';

type YTPlayer = {
  getCurrentTime(): number; getDuration(): number; getPlayerState(): number; getPlaybackRate(): number;
  seekTo(s: number, allow: boolean): void; destroy(): void; pauseVideo(): void;
};
type YTNamespace = { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer; PlayerState: { PLAYING: number; PAUSED: number; ENDED: number } };
declare global { interface Window { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void } }

let loading: Promise<YTNamespace> | null = null;
function loadYT(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT!); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { loading = null; reject(new Error('Não foi possível carregar o player do YouTube. Confira a conexão ou se a rede bloqueia o YouTube.')); };
    document.head.appendChild(s);
  });
  return loading;
}

export type BeatResult = { duplicate: boolean; credited?: number; watchedSeconds: number; pct: number; done: boolean; minPct: number; durationSeconds?: number | null; track?: { pct: number; complete: boolean; nextLessonId: string | null } };

const sessKey = (lessonId: string) => `academia:sessao:${lessonId}`;
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Controle do player para a tela: ler o tempo atual (anotações) e levar o vídeo a um ponto (links das anotações). */
export type PlayerControl = { time: () => number; seek: (seconds: number) => void };

export function YoutubePlayer({ trackId, lessonId, videoId, resumeAt, onBeat, onEnded, control }: {
  trackId: string; lessonId: string; videoId: string; resumeAt: number;
  onBeat: (r: BeatResult) => void; onEnded?: () => void; control?: { current: PlayerControl | null };
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<'ok' | 'erro' | null>(null);
  const cb = useRef({ onBeat, onEnded });
  cb.current = { onBeat, onEnded };

  useEffect(() => {
    let dead = false;
    let player: YTPlayer | null = null;
    let tracker: TrackerState = emptyTracker();
    let session: { id: string; seq: number } | null = null;
    let inflight: { seq: number; intervals: Interval[]; position: number; ended: boolean } | null = null;
    let sending = false;
    let sampler: number | undefined, beater: number | undefined;
    const t0 = performance.now();

    // a mesma aba retoma a mesma sessão (recarregar não cria outra); outra aba ou aparelho abre a sua
    let clientSessionId = '';
    try { clientSessionId = sessionStorage.getItem(sessKey(lessonId)) ?? ''; } catch { /* sem armazenamento */ }
    if (!clientSessionId) { clientSessionId = newId(); try { sessionStorage.setItem(sessKey(lessonId), clientSessionId); } catch { /* idem */ } }

    const sample = () => {
      if (!player) return;
      try {
        const st = player.getPlayerState();
        const s = { t: (performance.now() - t0) / 1000, pos: player.getCurrentTime(), playing: st === 1, rate: player.getPlaybackRate() || 1 };
        // parou (pausa ou fim): o trecho desde a última leitura foi reproduzido até aqui — fecha-o (com a mesma checagem de relógio)
        if (!s.playing && tracker.last?.playing) tracker = trackSample(tracker, { ...s, playing: true });
        tracker = trackSample(tracker, s);
      } catch { /* player ainda não pronto */ }
    };

    const send = async (opts: { ended?: boolean; keepalive?: boolean } = {}) => {
      if (!session || !player || sending) return;
      sample();
      if (!inflight) {
        if (!tracker.pending.length && !opts.ended) return;
        session.seq += 1;
        inflight = { seq: session.seq, intervals: tracker.pending.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100] as Interval), position: player.getCurrentTime(), ended: !!opts.ended };
        tracker = { ...tracker, pending: [] };
      }
      const body = { ...inflight, duration: player.getDuration() || null };
      sending = true;
      try {
        const r = await api<BeatResult>(`/academia/sessoes/${session.id}/batida`, { method: 'POST', body, keepalive: opts.keepalive });
        inflight = null;
        if (!dead) { setSaving('ok'); cb.current.onBeat(r); }
      } catch {
        // mantém o mesmo envio (mesma sequência) para tentar de novo: o servidor não conta duas vezes
        if (!dead) setSaving('erro');
      } finally { sending = false; }
    };

    (async () => {
      try {
        const s = await api<{ sessionId: string; lastSeq: number }>(`/academia/trilhas/${trackId}/aulas/${lessonId}/sessao`, { method: 'POST', body: { clientSessionId, device: navigator.userAgent.slice(0, 120) } });
        if (dead) return;
        session = { id: s.sessionId, seq: s.lastSeq };
        const YT = await loadYT();
        if (dead || !host.current) return;
        const el = document.createElement('div');
        host.current.replaceChildren(el);
        player = new YT.Player(el, {
          host: 'https://www.youtube-nocookie.com', videoId, width: '100%', height: '100%',
          playerVars: { start: Math.max(0, Math.floor(resumeAt)), rel: 0, playsinline: 1, modestbranding: 1 },
          events: {
            onStateChange: (e: { data: number }) => {
              sample();
              if (e.data === 2) void send(); // pausou
              if (e.data === 0) { void send({ ended: true }); cb.current.onEnded?.(); }
            },
            onError: (e: { data: number }) => setError(e.data === 101 || e.data === 150 ? 'O dono do vídeo não permite reproduzi-lo fora do YouTube. Avise quem cuida da trilha.' : e.data === 100 ? 'Este vídeo foi removido ou ficou privado. Avise quem cuida da trilha.' : 'O YouTube não conseguiu reproduzir este vídeo agora.'),
          },
        });
        if (control) control.current = {
          time: () => { try { return player?.getCurrentTime() ?? 0; } catch { return 0; } },
          // ir a um ponto não credita o trecho pulado: a próxima leitura vê o salto e não conta
          seek: (sec) => { try { sample(); player?.seekTo(Math.max(0, sec), true); } catch { /* player ainda não pronto */ } },
        };
        sampler = window.setInterval(() => sample(), 1000);
        beater = window.setInterval(() => void send(), 10_000);
      } catch (e) { if (!dead) setError((e as Error).message); }
    })();

    const onHide = () => { if (document.visibilityState === 'hidden') void send({ keepalive: true }); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.clearInterval(sampler); window.clearInterval(beater);
      void send({ keepalive: true });
      dead = true;
      if (control) control.current = null;
      try { player?.destroy(); } catch { /* já destruído */ }
    };
  }, [trackId, lessonId, videoId, resumeAt]);

  return (
    <div>
      <div className="relative aspect-video w-full bg-navy">
        <div ref={host} className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full" data-testid="yt-player" />
        {error && <div role="alert" className="absolute inset-0 flex items-center justify-center bg-navy/95 p-6 text-center text-white">{error}</div>}
      </div>
      <p className="mt-1 text-xs text-muted" aria-live="polite">
        {saving === 'erro' ? 'Sem conexão para salvar o progresso agora. Tentamos de novo em instantes; nada do que você assistiu se perde nesta aba.' : 'O progresso conta o trecho realmente reproduzido e é salvo a cada 10 segundos e ao pausar.'}
      </p>
    </div>
  );
}
