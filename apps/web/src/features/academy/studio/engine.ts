/**
 * Motor do Estúdio — só APIs nativas do navegador:
 * - getDisplayMedia (tela) e getUserMedia (câmera e microfone), sempre a partir de um clique da pessoa;
 * - Canvas para incorporar a câmera ao vídeo da tela (o vídeo final já sai com a câmera no canto);
 * - Web Audio para juntar microfone e áudio da tela num só canal;
 * - MediaRecorder para gravar, em pedaços de 1 s, guardados também no próprio navegador (IndexedDB) para recuperar
 *   a gravação se a aba fechar no meio.
 * O desenho do canvas é cadenciado por um Worker: o navegador desacelera timers de abas em segundo plano, e quem grava
 * a tela costuma estar em outra janela.
 */
import { cameraRect, modeNeeds, type CameraCorner, type StudioMode } from '@isp/domain';

export type Support = { secure: boolean; recorder: boolean; screen: boolean; camera: boolean; mime: string | null; audioMime: string | null };
export function detectSupport(): Support {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const pick = (xs: string[]) => (typeof MediaRecorder !== 'undefined' ? xs.find((m) => MediaRecorder.isTypeSupported(m)) ?? null : null);
  return {
    secure: typeof window !== 'undefined' && window.isSecureContext,
    recorder: typeof MediaRecorder !== 'undefined',
    screen: !!md && typeof md.getDisplayMedia === 'function' && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    camera: !!md && typeof md.getUserMedia === 'function',
    mime: pick(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4']),
    audioMime: pick(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']),
  };
}
export const modeSupported = (m: StudioMode, s: Support) => {
  const n = modeNeeds(m);
  return s.secure && s.recorder && s.camera && (!n.screen || s.screen) && (m === 'audio' ? !!s.audioMime : !!s.mime);
};

export async function listDevices() {
  const ds = await navigator.mediaDevices.enumerateDevices();
  return { cameras: ds.filter((d) => d.kind === 'videoinput'), mics: ds.filter((d) => d.kind === 'audioinput') };
}

/** Mensagem clara para a recusa ou falha de permissão — nunca tentamos contornar a decisão do navegador. */
export function mediaError(e: unknown, what: string) {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return `Sem permissão para usar ${what}. Libere no navegador (ícone ao lado do endereço) e tente de novo.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `Nenhum(a) ${what} encontrado(a). Confira se está conectado(a).`;
  if (name === 'NotReadableError') return `${what[0]!.toUpperCase()}${what.slice(1)} está em uso por outro programa.`;
  if (name === 'AbortError') return `A seleção de ${what} foi cancelada.`;
  return `Não foi possível acessar ${what}.`;
}

export type Sources = { screen: MediaStream | null; camera: MediaStream | null; mic: MediaStream | null };
/** Pede as fontes da modalidade (dispara os pedidos de permissão do navegador). */
export async function acquire(mode: StudioMode, cameraId: string, micId: string): Promise<Sources> {
  const n = modeNeeds(mode);
  const got: Sources = { screen: null, camera: null, mic: null };
  try {
    if (n.screen) {
      try { got.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, width: { max: 1920 }, height: { max: 1080 } }, audio: true }); }
      catch (e) { throw new Error(mediaError(e, 'a tela')); }
    }
    if (n.camera) {
      try { got.camera = await navigator.mediaDevices.getUserMedia({ video: { deviceId: cameraId ? { exact: cameraId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
      catch (e) { throw new Error(mediaError(e, 'a câmera')); }
    }
    try { got.mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: micId ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true }, video: false }); }
    catch (e) { throw new Error(mediaError(e, 'o microfone')); }
    return got;
  } catch (e) { release(got); throw e; }
}
export function release(s: Partial<Sources> | null) {
  for (const st of [s?.screen, s?.camera, s?.mic]) st?.getTracks().forEach((t) => t.stop());
}

/** Ticker num Worker (não é freado em segundo plano como setInterval/requestAnimationFrame). */
function ticker(fps: number, cb: () => void) {
  const src = `let id=setInterval(()=>postMessage(0),${Math.round(1000 / fps)});onmessage=()=>{clearInterval(id);close()}`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(url);
  w.onmessage = cb;
  return () => { w.postMessage(0); w.terminate(); URL.revokeObjectURL(url); };
}
const videoOf = (st: MediaStream) => { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = st; void v.play().catch(() => undefined); return v; };

export type Layout = { corner: CameraCorner; sizePct: number };
/**
 * Junta as fontes num único stream para gravar: vídeo (tela, tela com câmera no canto, ou câmera) e um só áudio
 * (microfone + áudio da tela, quando houver). Devolve também o medidor de nível do microfone.
 */
export function compose(mode: StudioMode, src: Sources, layout: { current: Layout }) {
  const stops: (() => void)[] = [];
  // áudio: microfone + áudio da tela
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  if (src.mic) { const m = ctx.createMediaStreamSource(src.mic); m.connect(dest); m.connect(analyser); }
  if (src.screen?.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream(src.screen.getAudioTracks())).connect(dest);
  stops.push(() => void ctx.close().catch(() => undefined));
  const buf = new Uint8Array(analyser.fftSize);
  const level = () => { analyser.getByteTimeDomainData(buf); let peak = 0; for (const b of buf) peak = Math.max(peak, Math.abs(b - 128)); return Math.min(1, peak / 100); };

  let video: MediaStreamTrack | null = null;
  let canvas: HTMLCanvasElement | null = null;
  if (mode === 'camera_mic') video = src.camera!.getVideoTracks()[0] ?? null;
  else if (mode === 'tela_mic') video = src.screen!.getVideoTracks()[0] ?? null;
  else if (mode === 'tela_camera_mic') {
    // a câmera é desenhada dentro do vídeo da tela: sai incorporada no arquivo final
    const sv = videoOf(src.screen!), cv = videoOf(src.camera!);
    const s = src.screen!.getVideoTracks()[0]!.getSettings();
    canvas = document.createElement('canvas');
    canvas.width = Math.min(1920, s.width ?? 1280); canvas.height = Math.min(1080, s.height ?? 720);
    const g = canvas.getContext('2d')!;
    const draw = () => {
      const c = canvas!;
      if (sv.videoWidth && (sv.videoWidth !== c.width || sv.videoHeight !== c.height) && sv.videoWidth <= 1920) { c.width = sv.videoWidth; c.height = sv.videoHeight; }
      g.fillStyle = '#2D3339'; g.fillRect(0, 0, c.width, c.height);
      if (sv.videoWidth) g.drawImage(sv, 0, 0, c.width, c.height);
      if (cv.videoWidth) {
        const r = cameraRect(layout.current.corner, layout.current.sizePct, { w: c.width, h: c.height }, cv.videoWidth / cv.videoHeight);
        g.fillStyle = '#2F5986'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
        g.drawImage(cv, r.x, r.y, r.w, r.h);
      }
    };
    draw();
    stops.push(ticker(30, draw));
    video = canvas.captureStream(30).getVideoTracks()[0] ?? null;
    stops.push(() => { sv.srcObject = null; cv.srcObject = null; video?.stop(); });
  }
  const tracks = [...(video ? [video] : []), ...dest.stream.getAudioTracks()];
  return { stream: new MediaStream(tracks), level, canvas, stop: () => stops.forEach((f) => f()) };
}

// ------------------------------------------------------------------ guarda local para recuperar a gravação
const DB = 'revops-estudio', STORE = 'pedacos';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const r = f(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); res(r ? (r as IDBRequest<T>).result : undefined); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}
export type Saved = { meta: { mime: string; mode: StudioMode; startedAt: number; ms: number }; blob: Blob };
/** Grava em pedaços no navegador enquanto a gravação acontece (best-effort: se o armazenamento falhar, a gravação segue). */
export const localStore = {
  async reset(meta: Saved['meta']) { try { await tx('readwrite', (s) => { s.clear(); s.add({ meta }); }); } catch { /* sem IndexedDB */ } },
  async push(chunk: Blob, ms: number) { try { await tx('readwrite', (s) => { s.add({ chunk, ms }); }); } catch { /* idem */ } },
  async clear() { try { await tx('readwrite', (s) => { s.clear(); }); } catch { /* idem */ } },
  async load(): Promise<Saved | null> {
    try {
      const rows = (await tx<{ meta?: Saved['meta']; chunk?: Blob; ms?: number }[]>('readonly', (s) => s.getAll())) ?? [];
      const meta = rows.find((r) => r.meta)?.meta;
      const chunks = rows.filter((r) => r.chunk).map((r) => r.chunk!);
      if (!meta || !chunks.length) return null;
      const ms = Math.max(0, ...rows.map((r) => r.ms ?? 0));
      return { meta: { ...meta, ms }, blob: new Blob(chunks, { type: meta.mime }) };
    } catch { return null; }
  },
};

/** Duração real de um arquivo gravado (WebM do MediaRecorder não traz a duração no cabeçalho). */
export function mediaDuration(url: string, audio: boolean): Promise<number> {
  return new Promise((res) => {
    const el = document.createElement(audio ? 'audio' : 'video');
    el.preload = 'metadata'; el.muted = true;
    const done = () => { const d = el.duration; el.removeAttribute('src'); el.load(); res(Number.isFinite(d) ? d : 0); };
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) return done();
      el.ontimeupdate = () => { el.ontimeupdate = null; el.currentTime = 0; done(); };
      el.currentTime = 1e101; // força o navegador a calcular o fim do arquivo
    };
    el.onerror = () => res(0);
    el.src = url;
  });
}

/**
 * Corte de verdade no navegador: toca só o trecho escolhido e regrava (leva o tempo do trecho). O arquivo resultante
 * começa no início escolhido e termina no fim escolhido.
 */
export async function trimMedia(blob: Blob, start: number, end: number, audioOnly: boolean, onProgress: (p: number) => void): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  const el = document.createElement(audioOnly ? 'audio' : 'video') as HTMLVideoElement;
  el.src = url; el.playsInline = true; el.preload = 'auto';
  el.style.cssText = 'position:fixed;left:-9999px;width:320px;height:180px';
  document.body.appendChild(el);
  try {
    await new Promise<void>((res, rej) => { el.onloadedmetadata = () => res(); el.onerror = () => rej(new Error('Não foi possível abrir a gravação para cortar.')); });
    // som pelo Web Audio (não sai nas caixas de som)
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaElementSource(el).connect(dest);
    let videoTrack: MediaStreamTrack | null = null, stopTick: (() => void) | null = null;
    if (!audioOnly) {
      const cap = (el as unknown as { captureStream?: () => MediaStream }).captureStream;
      if (cap) videoTrack = cap.call(el).getVideoTracks()[0] ?? null;
      if (!videoTrack) {
        await new Promise((r) => { if (el.videoWidth) r(0); else el.onloadeddata = () => r(0); });
        const c = document.createElement('canvas'); c.width = el.videoWidth || 1280; c.height = el.videoHeight || 720;
        const g = c.getContext('2d')!;
        stopTick = ticker(30, () => g.drawImage(el, 0, 0, c.width, c.height));
        videoTrack = c.captureStream(30).getVideoTracks()[0] ?? null;
      }
    }
    const mime = blob.type || (audioOnly ? 'audio/webm' : 'video/webm');
    const rec = new MediaRecorder(new MediaStream([...(videoTrack ? [videoTrack] : []), ...dest.stream.getAudioTracks()]), MediaRecorder.isTypeSupported(mime) ? { mimeType: mime } : undefined);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    el.currentTime = start;
    await new Promise<void>((r) => { el.onseeked = () => r(); });
    const out = new Promise<Blob>((res) => { rec.onstop = () => res(new Blob(parts, { type: rec.mimeType || mime })); });
    rec.start(1000);
    await el.play();
    await new Promise<void>((r) => {
      const check = () => { onProgress(Math.min(1, (el.currentTime - start) / (end - start))); if (el.currentTime >= end || el.ended) { el.pause(); r(); } };
      el.ontimeupdate = check;
      el.onended = () => r();
      const id = setInterval(check, 100);
      void out.then(() => clearInterval(id));
      el.onpause = () => r();
    });
    rec.stop();
    stopTick?.();
    const result = await out;
    void ctx.close();
    onProgress(1);
    return result;
  } finally {
    el.remove();
    URL.revokeObjectURL(url);
  }
}
