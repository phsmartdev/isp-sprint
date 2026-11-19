/**
 * Academia — Estúdio de gravação (etapa 1: gravação funcional, revisão com corte e arquivo local).
 * Tela, câmera e microfone só depois de um clique e da autorização do navegador; a câmera sai incorporada no vídeo;
 * a gravação é guardada no navegador enquanto acontece, para recuperar se a aba fechar. Salvar na biblioteca da
 * Academia e publicar dependem do armazenamento de vídeos (etapa 2).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, ChevronLeft, Circle, Download, Mic, Monitor, MonitorPlay, Pause, Play, RotateCcw, Square, Trash2, Video } from 'lucide-react';
import {
  CAMERA_CORNERS, CAMERA_CORNER_LABELS, STUDIO_MODES, STUDIO_MODE_LABELS, clockMs, clockPause, clockResume, clockStart, fmtTimecode, modeNeeds, studioNext, trimRange,
  type CameraCorner, type StudioClock, type StudioEvent, type StudioMode, type StudioState,
} from '@isp/domain';
import { Button, EmptyState, FormField, Input, LoadingRows, Select } from '../../../components/ui/primitives';
import { ConfirmDialog } from '../../../components/ui/overlay';
import { acquire, compose, detectSupport, listDevices, localStore, mediaDuration, modeSupported, release, trimMedia, type Layout, type Saved, type Sources } from '../../../features/academy/studio/engine';
import { useAcademyGestao } from './Manage';

const MODE_ICON: Record<StudioMode, typeof Monitor> = { tela_mic: Monitor, tela_camera_mic: MonitorPlay, camera_mic: Video, audio: Mic };
type Take = { blob: Blob; url: string; duration: number; mime: string; mode: StudioMode };
const ext = (mime: string) => (mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.startsWith('audio') ? 'weba' : 'webm');
const mb = (n: number) => `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;

export function AcademyStudioPage() {
  const g = useAcademyGestao();
  if (g.isLoading) return <LoadingRows rows={4} />;
  if (!g.data?.can.create) return <EmptyState title="Estúdio restrito" description="Gravar treinamentos é para quem gere a Academia: liderança de time, Supervisão, Gerência e Diretoria." />;
  return <Studio />;
}

function Studio() {
  const support = useMemo(detectSupport, []);
  const [state, setState] = useState<StudioState>('ocioso');
  const stateRef = useRef<StudioState>('ocioso');
  /** Aplica um evento só se ele vale no estado atual (evita operações simultâneas ou fora de ordem). */
  const go = useCallback((e: StudioEvent) => { const n = studioNext(stateRef.current, e); if (n) { stateRef.current = n; setState(n); } return !!n; }, []);

  const [mode, setMode] = useState<StudioMode>(() => STUDIO_MODES.find((m) => modeSupported(m, support)) ?? 'camera_mic');
  const [devices, setDevices] = useState<{ cameras: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cameras: [], mics: [] });
  const [cameraId, setCameraId] = useState(''), [micId, setMicId] = useState('');
  const [corner, setCorner] = useState<CameraCorner>('inf_dir'), [size, setSize] = useState(25);
  const layout = useRef<Layout>({ corner, sizePct: size });
  useEffect(() => { layout.current = { corner, sizePct: size }; }, [corner, size]);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [clock, setClock] = useState<StudioClock | null>(null);
  const [now, setNow] = useState(Date.now());
  const [level, setLevel] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [recovered, setRecovered] = useState<Saved | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const sources = useRef<Sources | null>(null);
  const comp = useRef<ReturnType<typeof compose> | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const clockRef = useRef<StudioClock | null>(null);
  const preview = useRef<HTMLVideoElement>(null);

  const refreshDevices = useCallback(async () => { try { setDevices(await listDevices()); } catch { /* sem lista */ } }, []);
  useEffect(() => { void refreshDevices(); void localStore.load().then((s) => s && setRecovered(s)); }, [refreshDevices]);

  const teardown = useCallback(() => { comp.current?.stop(); comp.current = null; release(sources.current); sources.current = null; if (preview.current) preview.current.srcObject = null; }, []);
  useEffect(() => () => { try { if (rec.current?.state !== 'inactive') rec.current?.stop(); } catch { /* já parado */ } teardown(); }, [teardown]);

  // nível do microfone e cronômetro
  useEffect(() => {
    if (!['previa', 'contagem', 'gravando', 'pausado'].includes(state)) return;
    const id = window.setInterval(() => { setNow(Date.now()); setLevel(comp.current?.level() ?? 0); }, 100);
    return () => window.clearInterval(id);
  }, [state]);
  // não sair da página no meio da gravação sem aviso
  useEffect(() => {
    if (state !== 'gravando' && state !== 'pausado') return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [state]);

  const finish = useCallback(() => {
    const r = rec.current;
    if (!r || r.state === 'inactive') return;
    if (clockRef.current) { clockRef.current = clockPause(clockRef.current, Date.now()); setClock(clockRef.current); }
    r.stop();
  }, []);

  /** Prévia: pede as fontes (o navegador pergunta) e monta o que será gravado. */
  const prepare = async () => {
    setError(null); setNotice(null);
    if (!modeSupported(mode, support)) { setError('Esta modalidade não é suportada neste navegador.'); return; }
    try {
      const src = await acquire(mode, cameraId, micId);
      sources.current = src;
      comp.current = compose(mode, src, layout);
      void refreshDevices();
      // parar o compartilhamento pela barra do navegador
      src.screen?.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (stateRef.current === 'gravando' || stateRef.current === 'pausado') {
          setNotice('O compartilhamento de tela foi interrompido. A gravação foi encerrada e o que já foi gravado está salvo.');
          go('falha'); finish();
        } else if (stateRef.current === 'previa' || stateRef.current === 'contagem') {
          setNotice('O compartilhamento de tela foi interrompido antes de gravar.');
          teardown(); stateRef.current = 'ocioso'; setState('ocioso');
        }
      });
      go('pronto');
    } catch (e) { teardown(); setError((e as Error).message); }
  };
  useEffect(() => { if (state === 'previa' && preview.current && comp.current && mode !== 'audio') { preview.current.srcObject = comp.current.stream; void preview.current.play().catch(() => undefined); } }, [state, mode]);

  const start = () => {
    if (!go('iniciar')) return;
    setCount(3);
    let n = 3;
    const id = window.setInterval(() => {
      n -= 1;
      if (stateRef.current !== 'contagem') { window.clearInterval(id); return; }
      if (n > 0) { setCount(n); return; }
      window.clearInterval(id);
      record();
    }, 1000);
  };
  const record = () => {
    const c = comp.current;
    if (!c || !go('contagem_fim')) return;
    const mime = (mode === 'audio' ? support.audioMime : support.mime) ?? '';
    const r = new MediaRecorder(c.stream, mime ? { mimeType: mime } : undefined);
    rec.current = r; chunks.current = [];
    const startedAt = Date.now();
    void localStore.reset({ mime: r.mimeType || mime, mode, startedAt, ms: 0 });
    r.ondataavailable = (e) => { if (e.data.size) { chunks.current.push(e.data); void localStore.push(e.data, clockRef.current ? clockMs(clockRef.current, Date.now()) : 0); } };
    r.onerror = () => { setNotice('O navegador interrompeu a gravação. O que já foi gravado está salvo.'); go('falha'); finish(); };
    r.onstop = async () => {
      const blob = new Blob(chunks.current, { type: r.mimeType || mime });
      teardown();
      const url = URL.createObjectURL(blob);
      const dur = (await mediaDuration(url, mode === 'audio')) || (clockRef.current ? clockMs(clockRef.current, Date.now()) / 1000 : 0);
      setTake({ blob, url, duration: dur, mime: blob.type, mode });
      go('arquivo_pronto');
    };
    r.start(1000);
    clockRef.current = clockStart(Date.now()); setClock(clockRef.current);
  };
  const pause = () => { if (rec.current?.state === 'recording' && go('pausar')) { rec.current.pause(); clockRef.current = clockPause(clockRef.current!, Date.now()); setClock(clockRef.current); } };
  const resume = () => { if (rec.current?.state === 'paused' && go('retomar')) { rec.current.resume(); clockRef.current = clockResume(clockRef.current!, Date.now()); setClock(clockRef.current); } };
  const stop = () => { if (go('encerrar')) finish(); };
  const cancelPreview = () => { teardown(); go('descartar'); };
  const discardTake = async () => {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null); setConfirmDiscard(false); await localStore.clear(); go('descartar'); clockRef.current = null; setClock(null);
  };
  const recover = async () => {
    if (!recovered) return;
    const url = URL.createObjectURL(recovered.blob);
    const dur = (await mediaDuration(url, recovered.meta.mode === 'audio')) || recovered.meta.ms / 1000;
    setTake({ blob: recovered.blob, url, duration: dur, mime: recovered.blob.type, mode: recovered.meta.mode });
    setRecovered(null);
    stateRef.current = 'revisao'; setState('revisao');
  };

  const elapsed = clock ? clockMs(clock, now) : 0;
  const live = state === 'gravando' || state === 'pausado';
  const needs = modeNeeds(mode);
  const lockSettings = state !== 'ocioso' && state !== 'erro';

  if (state === 'revisao' && take) return <Review take={take} onDiscard={() => setConfirmDiscard(true)} confirm={confirmDiscard} onConfirm={discardTake} onCancel={() => setConfirmDiscard(false)} />;

  return (
    <div className="-mx-4 -mt-6 min-h-[calc(100vh-72px)] bg-[#1F2429] text-white sm:-mx-6 2xl:-mx-8">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-6 py-3">
        <Link to="/playbooks?aba=academia" className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white"><ChevronLeft className="h-4 w-4" />Academia — Gestão</Link>
        <h1 className="font-display text-lg font-bold tracking-wide">Estúdio de gravação</h1>
        {live && (
          <span className="ml-auto flex items-center gap-2 bg-black/30 px-3 py-1.5" role="status" aria-live="polite" data-testid="rec-indicator">
            <span className={clsx('h-3 w-3 rounded-circle', state === 'gravando' ? 'animate-pulse bg-[#E5484D]' : 'bg-[#F5B400]')} aria-hidden />
            <span className="text-sm font-semibold">{state === 'gravando' ? 'Gravando' : 'Pausado'}</span>
            <span className="num font-display text-lg" data-testid="rec-timer">{fmtTimecode(elapsed / 1000)}</span>
          </span>
        )}
      </div>

      {recovered && state === 'ocioso' && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[#F5B400]/40 bg-[#F5B400]/10 px-6 py-3 text-sm" role="alert">
          <RotateCcw className="h-4 w-4 text-[#F5B400]" aria-hidden />
          <span className="flex-1">Há uma gravação interrompida neste navegador ({fmtTimecode(recovered.meta.ms / 1000)}, {mb(recovered.blob.size)}).</span>
          <Button size="sm" variant="primary" onClick={() => void recover()}>Recuperar gravação</Button>
          <Button size="sm" onClick={() => { void localStore.clear(); setRecovered(null); }}>Descartar</Button>
        </div>
      )}

      <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col p-6">
          {/* área de prévia */}
          <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden border border-white/10 bg-black/40" data-testid="stage">
            {mode !== 'audio' && <video ref={preview} muted playsInline className={clsx('h-full w-full object-contain', state === 'ocioso' && 'hidden')} data-testid="preview" />}
            {mode === 'audio' && state !== 'ocioso' && (
              <div className="flex flex-col items-center gap-4"><Mic className="h-16 w-16 text-white/80" aria-hidden /><div className="flex h-24 items-end gap-1">{Array.from({ length: 24 }, (_, i) => <span key={i} className="w-2 bg-[#5B8AC4] transition-[height] duration-100" style={{ height: `${Math.max(6, level * 100 * (0.5 + Math.abs(Math.sin(i * 1.7)) * 0.5))}%` }} />)}</div></div>
            )}
            {state === 'ocioso' && (
              <div className="max-w-md space-y-3 p-6 text-center">
                <p className="font-display text-xl font-bold">Pronto para gravar</p>
                <p className="text-sm text-white/70">Escolha a modalidade ao lado e ative as fontes. O navegador vai pedir permissão para {needs.screen ? 'a tela, ' : ''}{needs.camera ? 'a câmera e ' : ''}o microfone. Nada é gravado antes de você clicar em Iniciar.</p>
              </div>
            )}
            {state === 'contagem' && <div className="absolute inset-0 flex items-center justify-center bg-black/50"><span className="num font-display text-[9rem] font-bold leading-none" data-testid="countdown">{count}</span></div>}
            {state === 'finalizando' && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-lg font-semibold">Finalizando a gravação…</div>}
            {live && <span className="absolute left-3 top-3 flex items-center gap-1.5 bg-[#E5484D] px-2 py-1 text-xs font-bold" aria-hidden><Circle className="h-2.5 w-2.5 fill-white" />REC</span>}
          </div>
          {(error || notice) && <p role="alert" className={clsx('mt-3 flex items-start gap-2 px-3 py-2 text-sm', error ? 'bg-[#E5484D]/15 text-[#FFB4B6]' : 'bg-[#F5B400]/15 text-[#FFE08A]')}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error ?? notice}</p>}

          {/* barra de controles */}
          <div className="mt-4 flex flex-wrap items-center gap-3 border border-white/10 bg-black/30 px-4 py-3">
            <div className="flex items-center gap-2" aria-label="Nível do microfone"><Mic className="h-4 w-4 text-white/60" aria-hidden /><span className="h-2 w-28 bg-white/10"><span className="block h-full bg-[#46A758] transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} data-testid="level" /></span></div>
            <span className="num ml-2 font-display text-lg text-white/80">{fmtTimecode(elapsed / 1000)}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              {(state === 'ocioso' || state === 'erro') && <Button variant="primary" onClick={() => void prepare()} disabled={!modeSupported(mode, support)}>Ativar {needs.screen ? 'tela, ' : ''}{needs.camera ? 'câmera e ' : ''}microfone</Button>}
              {state === 'previa' && <><Button onClick={cancelPreview}>Trocar fontes</Button><button type="button" onClick={start} className="inline-flex h-10 items-center gap-2 bg-[#E5484D] px-5 text-sm font-bold text-white hover:bg-[#D13F44]"><Circle className="h-3.5 w-3.5 fill-white" />Iniciar gravação</button></>}
              {state === 'contagem' && <Button onClick={() => { go('cancelar'); }}>Cancelar</Button>}
              {state === 'gravando' && <Button icon={<Pause className="h-4 w-4" />} onClick={pause}>Pausar</Button>}
              {state === 'pausado' && <Button icon={<Play className="h-4 w-4" />} onClick={resume}>Retomar</Button>}
              {live && <button type="button" onClick={stop} className="inline-flex h-10 items-center gap-2 bg-white px-5 text-sm font-bold text-navy hover:bg-white/90"><Square className="h-3.5 w-3.5 fill-navy" />Encerrar</button>}
            </div>
          </div>
        </div>

        {/* painel de configurações */}
        <aside className="space-y-5 border-l border-white/10 bg-black/20 p-5" aria-label="Configurações da gravação">
          <fieldset disabled={lockSettings} className="space-y-2">
            <legend className="mb-2 text-sm font-semibold text-white/80">Modalidade</legend>
            {STUDIO_MODES.map((m) => {
              const ok = modeSupported(m, support), I = MODE_ICON[m];
              return (
                <button key={m} type="button" aria-pressed={mode === m} disabled={!ok || lockSettings} onClick={() => setMode(m)} className={clsx('flex w-full items-center gap-3 border px-3 py-2.5 text-left text-sm', mode === m ? 'border-[#5B8AC4] bg-[#2F5986]/40' : 'border-white/10 hover:border-white/30', (!ok || lockSettings) && 'cursor-not-allowed opacity-50')}>
                  <I className="h-5 w-5 shrink-0" aria-hidden /><span className="flex-1">{STUDIO_MODE_LABELS[m]}{!ok && <span className="block text-xs text-white/60">Não disponível neste navegador</span>}</span>
                </button>
              );
            })}
          </fieldset>
          {!support.secure && <p className="text-xs text-[#FFE08A]">Gravação só funciona em conexão segura (https).</p>}
          {support.secure && !support.screen && <p className="text-xs text-white/70">Este navegador não permite gravar a tela (comum em celular e tablet). Use câmera ou áudio, ou grave no computador.</p>}
          <div className="space-y-3 [&_label]:text-white/80">
            {needs.camera && <FormField label="Câmera" htmlFor="st-cam"><Select id="st-cam" value={cameraId} disabled={lockSettings} onChange={(e) => setCameraId(e.target.value)} className="!border-white/20 !bg-white/10 !text-white [&>option]:text-ink"><option value="">Padrão do sistema</option>{devices.cameras.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Câmera ${i + 1}`}</option>)}</Select></FormField>}
            <FormField label="Microfone" htmlFor="st-mic"><Select id="st-mic" value={micId} disabled={lockSettings} onChange={(e) => setMicId(e.target.value)} className="!border-white/20 !bg-white/10 !text-white [&>option]:text-ink"><option value="">Padrão do sistema</option>{devices.mics.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microfone ${i + 1}`}</option>)}</Select></FormField>
          </div>
          {mode === 'tela_camera_mic' && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold text-white/80">Câmera no vídeo</legend>
              <div className="grid grid-cols-2 gap-1.5">{CAMERA_CORNERS.map((c) => <button key={c} type="button" aria-pressed={corner === c} onClick={() => setCorner(c)} className={clsx('border px-2 py-1.5 text-xs', corner === c ? 'border-[#5B8AC4] bg-[#2F5986]/40' : 'border-white/10 hover:border-white/30')}>{CAMERA_CORNER_LABELS[c]}</button>)}</div>
              <label className="block text-xs text-white/70" htmlFor="st-size">Tamanho: {size}% da largura</label>
              <input id="st-size" type="range" min={15} max={40} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full accent-[#5B8AC4]" />
              <p className="text-xs text-white/50">Dá para mudar o canto e o tamanho durante a gravação.</p>
            </fieldset>
          )}
          <div className="border border-[#F5B400]/30 bg-[#F5B400]/10 p-3 text-xs text-[#FFE08A]">
            <p className="font-semibold">Antes de gravar a tela</p>
            <p className="mt-1">Feche e-mails, conversas e dados de clientes que não devem aparecer. Tudo o que estiver na tela compartilhada entra no vídeo.</p>
          </div>
          <p className="text-xs text-white/50">A gravação fica neste navegador até você baixar ou descartar. Salvar na biblioteca da Academia e publicar numa trilha chegam na próxima etapa.</p>
        </aside>
      </div>
    </div>
  );
}

function Review({ take, onDiscard, confirm, onConfirm, onCancel }: { take: Take; onDiscard: () => void; confirm: boolean; onConfirm: () => void; onCancel: () => void }) {
  const media = useRef<HTMLVideoElement>(null);
  const [range, setRange] = useState<[number, number]>([0, take.duration]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pos, setPos] = useState(0);
  const tr = trimRange(range[0], range[1], take.duration);
  const trimmed = range[0] > 0.05 || range[1] < take.duration - 0.05;
  const audio = take.mode === 'audio';
  // nome do arquivo sem acentos e símbolos (alguns navegadores descartam o nome com caracteres especiais)
  const name = `${(title.trim() || 'gravacao').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9\- ]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'gravacao'}.${ext(take.mime)}`;
  const save = (b: Blob) => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 10_000); };
  const download = async () => {
    setErr(null);
    if (!trimmed) { save(take.blob); return; }
    if (!tr) { setErr('O trecho precisa ter pelo menos 1 segundo.'); return; }
    try { setBusy(0); const out = await trimMedia(take.blob, tr.start, tr.end, audio, setBusy); save(out); (window as unknown as { __studioLast?: Blob }).__studioLast = out; }
    catch (e) { setErr((e as Error).message || 'Não foi possível cortar.'); }
    finally { setBusy(null); }
  };
  // a prévia toca só dentro do trecho escolhido
  const onTime = () => { const el = media.current; if (!el) return; setPos(el.currentTime); if (el.currentTime >= range[1]) { el.pause(); el.currentTime = range[0]; } };
  const pct = (s: number) => `${(s / (take.duration || 1)) * 100}%`;
  const Media = audio ? 'audio' : 'video';
  return (
    <div className="-mx-4 -mt-6 min-h-[calc(100vh-72px)] bg-[#1F2429] text-white sm:-mx-6 2xl:-mx-8">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-6 py-3">
        <Link to="/playbooks?aba=academia" className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white"><ChevronLeft className="h-4 w-4" />Academia — Gestão</Link>
        <h1 className="font-display text-lg font-bold tracking-wide">Revisar gravação</h1>
        <span className="ml-auto text-sm text-white/60" data-testid="take-info">{fmtTimecode(take.duration)} · {mb(take.blob.size)} · {ext(take.mime).toUpperCase()}</span>
      </div>
      <div className="grid lg:grid-cols-[1fr_320px]">
        <div className="space-y-4 p-6">
          <Media ref={media as never} src={take.url} controls playsInline onTimeUpdate={onTime} onPlay={() => { const el = media.current; if (el && (el.currentTime < range[0] || el.currentTime >= range[1])) el.currentTime = range[0]; }} className={clsx('w-full bg-black', audio ? 'mt-10' : 'aspect-video')} data-testid="review-player" />
          {/* linha do tempo com corte de início e fim */}
          <div className="border border-white/10 bg-black/30 p-4" aria-label="Linha do tempo">
            <div className="relative h-12 bg-white/5">
              <div className="absolute inset-y-0 bg-[#2F5986]/60" style={{ left: pct(range[0]), width: `calc(${pct(range[1])} - ${pct(range[0])})` }} />
              <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: pct(pos) }} aria-hidden />
              <span className="absolute inset-y-0 w-1 bg-[#5B8AC4]" style={{ left: pct(range[0]) }} aria-hidden />
              <span className="absolute inset-y-0 w-1 bg-[#5B8AC4]" style={{ left: `calc(${pct(range[1])} - 4px)` }} aria-hidden />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-white/70">Início do corte: <span className="num font-semibold text-white" data-testid="trim-start">{fmtTimecode(range[0])}</span>
                <input aria-label="Início do corte" type="range" min={0} max={take.duration} step={0.1} value={range[0]} onChange={(e) => { const v = Math.min(Number(e.target.value), range[1] - 1); setRange([Math.max(0, v), range[1]]); if (media.current) media.current.currentTime = Math.max(0, v); }} className="mt-1 w-full accent-[#5B8AC4]" />
              </label>
              <label className="text-xs text-white/70">Fim do corte: <span className="num font-semibold text-white" data-testid="trim-end">{fmtTimecode(range[1])}</span>
                <input aria-label="Fim do corte" type="range" min={0} max={take.duration} step={0.1} value={range[1]} onChange={(e) => { const v = Math.max(Number(e.target.value), range[0] + 1); setRange([range[0], Math.min(take.duration, v)]); }} className="mt-1 w-full accent-[#5B8AC4]" />
              </label>
            </div>
            <p className="mt-2 text-xs text-white/60">Duração final: <span className="num font-semibold text-white">{fmtTimecode(tr?.length ?? 0)}</span>{trimmed && ' · o corte é aplicado de verdade no arquivo ao baixar (leva o tempo do trecho)'}</p>
          </div>
          {busy !== null && <div className="border border-white/10 p-3" role="status"><p className="mb-1 text-sm">Aplicando o corte… {Math.round(busy * 100)}%</p><div className="h-1.5 bg-white/10"><div className="h-full bg-[#5B8AC4]" style={{ width: `${busy * 100}%` }} /></div></div>}
          {err && <p role="alert" className="bg-[#E5484D]/15 px-3 py-2 text-sm text-[#FFB4B6]">{err}</p>}
        </div>
        <aside className="space-y-4 border-l border-white/10 bg-black/20 p-5 [&_label]:!text-white/80">
          <FormField label="Título" htmlFor="rv-title"><Input id="rv-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Como apresentar a proposta" className="!border-white/20 !bg-white/10 !text-white [&>option]:text-ink" /></FormField>
          <button type="button" onClick={() => void download()} disabled={busy !== null || (trimmed && !tr)} className="flex h-11 w-full items-center justify-center gap-2 bg-[#2F5986] text-sm font-bold hover:bg-[#3A6A9C] disabled:opacity-50"><Download className="h-4 w-4" />{trimmed ? 'Cortar e baixar' : 'Baixar gravação'}</button>
          <Button className="w-full" icon={<Trash2 className="h-4 w-4" />} onClick={onDiscard}>Descartar e gravar outra</Button>
          <p className="text-xs text-white/50">Salvar na biblioteca da Academia, vincular a uma aula e enviar para aprovação chegam quando o armazenamento de vídeos for configurado. Até lá, o arquivo baixado pode ser publicado no YouTube (não listado) e incluído na trilha pelo link.</p>
        </aside>
      </div>
      <ConfirmDialog open={confirm} title="Descartar a gravação?" confirmLabel="Descartar" tone="danger" onConfirm={onConfirm} onCancel={onCancel}>A gravação será apagada deste navegador. Se ainda não baixou, ela será perdida.</ConfirmDialog>
    </div>
  );
}
