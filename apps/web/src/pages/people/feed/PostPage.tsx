/** Publicação aberta: o cartão e a conversa completa (comentários com um nível de resposta). */
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../../lib/api';
import { ErrorState, LoadingRows } from '../../../components/ui/primitives';
import type { Comment, FeedPost } from './api';
import { PostCard } from './PostCard';
import { CommentsThread } from './Comments';

export function PostPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['pessoas', 'post', id], queryFn: () => api<{ post: FeedPost; comments: Comment[] }>(`/pessoas/posts/${id}`) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={6} /></div>;
  if (q.isError || !q.data) return (
    <div className="mx-auto max-w-2xl"><ErrorState error={q.error} /><p className="mt-2 text-sm"><Link to="/pessoas" className="link">Voltar ao feed</Link></p></div>
  );
  return (
    <div className="mx-auto w-full max-w-[560px] space-y-3">
      <Link to="/pessoas" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Feed</Link>
      {q.data.post.status !== 'rascunho' ? <PostCard post={q.data.post} detail /> : <div className="card p-4 text-sm text-muted">Rascunho: só você vê. Publique pelo editor no Feed → Rascunhos.</div>}
      {q.data.post.status === 'publicado' && (
        <section className="card p-4" aria-label="Comentários">
          <h2 className="mb-3 text-md font-bold text-ink">Comentários ({q.data.post.commentCount})</h2>
          <CommentsThread postId={id} />
        </section>
      )}
    </div>
  );
}

