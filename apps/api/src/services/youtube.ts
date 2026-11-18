/**
 * YouTube para a Academia — somente leitura.
 * - Vídeo avulso: com a chave da Data API (Configurações → Integrações → YouTube), título, canal, duração e situação
 *   (privado, removido, incorporação desligada); sem a chave, o oEmbed público dá título, canal e miniatura (a duração
 *   é lida depois pelo player, na primeira reprodução).
 * - Playlist: exige a chave (playlistItems.list), na ordem original, até 500 vídeos.
 * A chave fica cifrada no servidor e nunca vai para a tela. Endereços podem ser trocados por variável de ambiente nos testes.
 */
import { isoDurationSeconds, youtubeThumb, youtubeWatchUrl, type ContentState } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import { unprocessable } from '../http/errors';
import { decryptSecret } from './email';
import { integrationRow } from './integrations';

const oembedUrl = () => process.env.YOUTUBE_OEMBED_URL ?? 'https://www.youtube.com/oembed';
const dataApi = () => process.env.YOUTUBE_API_BASE ?? 'https://www.googleapis.com/youtube/v3';
const TIMEOUT = 8_000;

export type VideoInfo = { id: string; title: string; channel: string | null; thumbnailUrl: string; durationSeconds: number | null; state: ContentState; source: 'api' | 'oembed' };

export async function youtubeKey(db: DbOrTx, tenantId: string): Promise<string | null> {
  const r = await integrationRow(db, tenantId, 'youtube');
  if (!r.enabled || !r.secrets.apiKey) return null;
  return decryptSecret(r.secrets.apiKey);
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try { res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { accept: 'application/json' } }); }
  catch { throw unprocessable('Não foi possível consultar o YouTube agora. Tente de novo em instantes.'); }
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}
const apiErr = (b: unknown) => {
  const e = (b as { error?: { message?: string; errors?: { reason?: string }[] } })?.error;
  const reason = e?.errors?.[0]?.reason;
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') return 'A cota diária da YouTube Data API acabou. Tente amanhã ou aumente a cota no Google Cloud.';
  if (reason === 'keyInvalid' || reason === 'API_KEY_INVALID') return 'A chave da YouTube Data API é inválida. Confira em Configurações → Integrações → YouTube.';
  return `O YouTube recusou a consulta${e?.message ? `: ${e.message}` : '.'}`;
};

type ApiVideo = { id: string; snippet?: { title?: string; channelTitle?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } }; contentDetails?: { duration?: string }; status?: { privacyStatus?: string; embeddable?: boolean; uploadStatus?: string } };
const fromApi = (v: ApiVideo): VideoInfo => ({
  id: v.id, title: v.snippet?.title?.slice(0, 300) || v.id, channel: v.snippet?.channelTitle ?? null,
  thumbnailUrl: v.snippet?.thumbnails?.high?.url ?? v.snippet?.thumbnails?.medium?.url ?? youtubeThumb(v.id),
  durationSeconds: isoDurationSeconds(v.contentDetails?.duration) || null,
  state: v.status?.privacyStatus === 'private' ? 'privado' : v.status?.embeddable === false ? 'sem_incorporacao' : v.status?.uploadStatus === 'rejected' || v.status?.uploadStatus === 'deleted' ? 'removido' : 'disponivel',
  source: 'api',
});

/** Vários vídeos pela Data API (em lotes de 50). Os que não voltam foram removidos ou ficaram privados. */
async function apiVideos(key: string, ids: string[]): Promise<Map<string, VideoInfo>> {
  const out = new Map<string, VideoInfo>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const r = await getJson(`${dataApi()}/videos?part=snippet,contentDetails,status&id=${batch.join(',')}&key=${encodeURIComponent(key)}`);
    if (r.status !== 200) throw unprocessable(apiErr(r.body));
    for (const v of ((r.body as { items?: ApiVideo[] })?.items ?? [])) out.set(v.id, fromApi(v));
  }
  return out;
}

export async function videoInfo(db: DbOrTx, tenantId: string, id: string): Promise<VideoInfo> {
  const key = await youtubeKey(db, tenantId);
  if (key) {
    const m = await apiVideos(key, [id]);
    return m.get(id) ?? { id, title: id, channel: null, thumbnailUrl: youtubeThumb(id), durationSeconds: null, state: 'indisponivel', source: 'api' };
  }
  const r = await getJson(`${oembedUrl()}?format=json&url=${encodeURIComponent(youtubeWatchUrl(id))}`);
  if (r.status === 200) {
    const b = r.body as { title?: string; author_name?: string; thumbnail_url?: string };
    return { id, title: b.title?.slice(0, 300) || id, channel: b.author_name ?? null, thumbnailUrl: b.thumbnail_url ?? youtubeThumb(id), durationSeconds: null, state: 'disponivel', source: 'oembed' };
  }
  // oEmbed: 401 = privado ou incorporação desligada; 404 = não existe (ou removido)
  if (r.status === 401 || r.status === 403) return { id, title: id, channel: null, thumbnailUrl: youtubeThumb(id), durationSeconds: null, state: 'sem_incorporacao', source: 'oembed' };
  if (r.status === 404 || r.status === 400) throw unprocessable('Vídeo não encontrado no YouTube. Confira o link.');
  throw unprocessable('O YouTube não respondeu como esperado. Tente de novo em instantes.');
}

export type PlaylistInfo = { id: string; title: string; channel: string | null; videos: VideoInfo[]; missing: string[] };
/** Playlist na ordem original (até 500 vídeos). Exige a chave da Data API. */
export async function playlistInfo(db: DbOrTx, tenantId: string, id: string): Promise<PlaylistInfo> {
  const key = await youtubeKey(db, tenantId);
  if (!key) throw unprocessable('Importar playlist precisa da chave da YouTube Data API. Peça a quem administra para informar em Configurações → Integrações → YouTube. Vídeos avulsos funcionam sem a chave.');
  const p = await getJson(`${dataApi()}/playlists?part=snippet&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
  if (p.status !== 200) throw unprocessable(apiErr(p.body));
  const pl = ((p.body as { items?: { snippet?: { title?: string; channelTitle?: string } }[] })?.items ?? [])[0];
  if (!pl) throw unprocessable('Playlist não encontrada ou privada. Confira o link.');
  const ids: string[] = [];
  let page: string | null = null;
  do {
    const r = await getJson(`${dataApi()}/playlistItems?part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
    if (r.status !== 200) throw unprocessable(apiErr(r.body));
    const b = r.body as { items?: { contentDetails?: { videoId?: string } }[]; nextPageToken?: string };
    for (const it of b.items ?? []) if (it.contentDetails?.videoId && !ids.includes(it.contentDetails.videoId)) ids.push(it.contentDetails.videoId);
    page = b.nextPageToken ?? null;
  } while (page && ids.length < 500);
  const info = await apiVideos(key, ids);
  return {
    id, title: pl.snippet?.title?.slice(0, 300) || id, channel: pl.snippet?.channelTitle ?? null,
    videos: ids.filter((v) => info.has(v)).map((v) => info.get(v)!),
    missing: ids.filter((v) => !info.has(v)),
  };
}
