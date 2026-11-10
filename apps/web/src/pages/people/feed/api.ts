/** Feed de Pessoas & Cultura: tipos, consultas e envio de mídias. */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../../lib/api';
import { compressImage, fileToBase64 } from '../../../lib/files';
import type { PersonCard } from '../shared';

export type Media = { id: string; kind: 'imagem' | 'video' | 'arquivo'; mime: string; filename: string; sizeBytes: number };
export type Reaction = 'curtir' | 'celebrar' | 'apoiar' | 'inspirador';
export const REACTIONS: { key: Reaction; label: string; emoji: string }[] = [
  { key: 'curtir', label: 'Curtir', emoji: '👍' }, { key: 'celebrar', label: 'Celebrar', emoji: '🎉' },
  { key: 'apoiar', label: 'Apoiar', emoji: '🤝' }, { key: 'inspirador', label: 'Inspirador', emoji: '💡' },
];
export type FeedPost = {
  id: string; kind: 'social' | 'institucional' | string; audience: string; audienceLabel: string; status: 'publicado' | 'rascunho' | string;
  body: string; publishedAt: string | null; editedAt: string | null; createdAt: string;
  author: PersonCard; mentions: { id: string; name: string }[]; media: Media[];
  reactionCount: number; commentCount: number; reactions: Partial<Record<Reaction, number>>; myReaction: Reaction | null; saved: boolean; mine: boolean;
};
export type Comment = { id: string; parentId: string | null; body: string; createdAt: string; editedAt: string | null; mine: boolean; author: PersonCard; mentions: { id: string; name: string }[] };

export type FeedFilter = { ordem?: 'recentes' | 'relevantes'; autor?: string; salvos?: boolean };
export const feedKey = (f: FeedFilter) => ['pessoas', 'feed', f.ordem ?? 'recentes', f.autor ?? '', f.salvos ? 'salvos' : ''];
export const useFeed = (f: FeedFilter) => useInfiniteQuery({
  queryKey: feedKey(f),
  initialPageParam: null as string | null,
  queryFn: ({ pageParam }) => api<{ items: FeedPost[]; next: string | null }>(`/pessoas/feed${qs({ ordem: f.ordem, autor: f.autor, salvos: f.salvos ? 1 : undefined, cursor: pageParam, limite: 10 })}`),
  getNextPageParam: (last) => last.next,
});
export const useDrafts = () => useQuery({ queryKey: ['pessoas', 'rascunhos'], queryFn: () => api<{ items: FeedPost[] }>('/pessoas/rascunhos') });
export const mediaUrl = (id: string) => `/api/v1/pessoas/midias/${id}`;

const PART = 2_500_000;
/** Envia a mídia em partes (cada requisição cabe no limite da hospedagem); imagem grande é reduzida antes. */
export async function uploadMedia(file: File, limits: { imageMb: number; videoMb: number }, onProgress?: (p: number) => void): Promise<Media> {
  let f = file;
  if (/^image\/(png|jpe?g|webp)$/.test(file.type) && file.size > 1_500_000) f = await compressImage(file, { maxBytes: Math.min(limits.imageMb * 1024 * 1024, 4_000_000), maxDim: 2560 });
  const isVideo = file.type.startsWith('video/');
  const max = (file.type.startsWith('image/') ? limits.imageMb : isVideo ? limits.videoMb : Math.min(20, limits.videoMb)) * 1024 * 1024;
  if (f.size > max) throw new Error(`${file.name}: acima de ${Math.round(max / 1024 / 1024)} MB.`);
  const id = crypto.randomUUID();
  const parts = Math.max(1, Math.ceil(f.size / PART));
  for (let n = 0; n < parts; n++) {
    const data = await fileToBase64(new File([f.slice(n * PART, (n + 1) * PART)], f.name));
    await api(`/pessoas/midias/envios/${id}/partes/${n}`, { method: 'PUT', body: { data } });
    onProgress?.((n + 1) / (parts + 1));
  }
  const m = await api<Media>(`/pessoas/midias/envios/${id}/concluir`, { method: 'POST', body: { filename: f.name, parts, sizeBytes: f.size } });
  onProgress?.(1);
  return m;
}
