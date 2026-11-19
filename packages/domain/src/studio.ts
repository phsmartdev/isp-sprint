/**
 * Estúdio de gravação da Academia — regras puras: modalidades, máquina de estados da gravação e cronômetro.
 * A máquina impede operações simultâneas ou inválidas (ex.: pausar sem estar gravando, iniciar duas vezes).
 */
export const STUDIO_MODES = ['tela_mic', 'tela_camera_mic', 'camera_mic', 'audio'] as const;
export type StudioMode = (typeof STUDIO_MODES)[number];
export const STUDIO_MODE_LABELS: Record<StudioMode, string> = { tela_mic: 'Tela + microfone', tela_camera_mic: 'Tela + câmera + microfone', camera_mic: 'Câmera + microfone', audio: 'Somente áudio' };
export const modeNeeds = (m: StudioMode) => ({ screen: m === 'tela_mic' || m === 'tela_camera_mic', camera: m === 'tela_camera_mic' || m === 'camera_mic', mic: true });

export const CAMERA_CORNERS = ['inf_dir', 'inf_esq', 'sup_dir', 'sup_esq'] as const;
export type CameraCorner = (typeof CAMERA_CORNERS)[number];
export const CAMERA_CORNER_LABELS: Record<CameraCorner, string> = { inf_dir: 'Inferior direito', inf_esq: 'Inferior esquerdo', sup_dir: 'Superior direito', sup_esq: 'Superior esquerdo' };
/** Retângulo da câmera sobre a tela: largura em % da largura do vídeo (15–40), proporção da câmera, margem de 2,5%. */
export function cameraRect(corner: CameraCorner, sizePct: number, canvas: { w: number; h: number }, camAspect: number) {
  const pct = Math.min(40, Math.max(15, sizePct));
  const w = Math.round((canvas.w * pct) / 100), h = Math.round(w / (camAspect || 16 / 9));
  const m = Math.round(canvas.w * 0.025);
  const x = corner.endsWith('dir') ? canvas.w - w - m : m;
  const y = corner.startsWith('inf') ? canvas.h - h - m : m;
  return { x, y, w, h };
}

export type StudioState = 'ocioso' | 'previa' | 'contagem' | 'gravando' | 'pausado' | 'finalizando' | 'revisao' | 'erro';
export type StudioEvent = 'preparar' | 'pronto' | 'iniciar' | 'contagem_fim' | 'pausar' | 'retomar' | 'encerrar' | 'arquivo_pronto' | 'descartar' | 'falha' | 'cancelar';
const T: Partial<Record<StudioState, Partial<Record<StudioEvent, StudioState>>>> = {
  ocioso: { preparar: 'ocioso', pronto: 'previa', falha: 'erro' },
  previa: { iniciar: 'contagem', descartar: 'ocioso', falha: 'erro', pronto: 'previa' },
  contagem: { contagem_fim: 'gravando', cancelar: 'previa', falha: 'erro' },
  gravando: { pausar: 'pausado', encerrar: 'finalizando', falha: 'finalizando' },
  pausado: { retomar: 'gravando', encerrar: 'finalizando', falha: 'finalizando' },
  finalizando: { arquivo_pronto: 'revisao', falha: 'erro' },
  revisao: { descartar: 'ocioso' },
  erro: { descartar: 'ocioso', preparar: 'ocioso' },
};
/** Próximo estado, ou null quando a operação não vale no estado atual (a tela ignora e não chama o navegador). */
export const studioNext = (s: StudioState, e: StudioEvent): StudioState | null => T[s]?.[e] ?? null;

/** Cronômetro que não conta as pausas: acumulado + trecho corrente (ms). */
export type StudioClock = { accMs: number; since: number | null };
export const clockStart = (now: number): StudioClock => ({ accMs: 0, since: now });
export const clockPause = (c: StudioClock, now: number): StudioClock => (c.since === null ? c : { accMs: c.accMs + (now - c.since), since: null });
export const clockResume = (c: StudioClock, now: number): StudioClock => (c.since === null ? { ...c, since: now } : c);
export const clockMs = (c: StudioClock, now: number) => c.accMs + (c.since === null ? 0 : now - c.since);

/** Corte: início e fim válidos dentro da duração, com pelo menos 1 s. */
export function trimRange(start: number, end: number, duration: number) {
  const s = Math.max(0, Math.min(start, duration));
  const e = Math.max(0, Math.min(end, duration));
  return e - s >= 1 ? { start: s, end: e, length: e - s } : null;
}
