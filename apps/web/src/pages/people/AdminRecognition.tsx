/** Gestão de Reconhecimentos (Pessoas e Cultura): categorias. Sem ranking individual: reconhecer é valorizar, não medir. */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Button, EmptyState, ErrorState, Input, LoadingRows } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { useCategories, type Category } from './Recognition';

export function AdminRecognitionPage() {
  const q = useCategories();
  const qc = useQueryClient();
  const toast = useToast();
  const [n, setN] = useState({ name: '', emoji: '⭐', description: '' });
  const done = (m: string) => { void qc.invalidateQueries({ queryKey: ['pessoas', 'reconhecimento'] }); toast({ tone: 'success', message: m }); };
  const create = useMutation({ mutationFn: () => api('/pessoas/reconhecimentos/categorias', { method: 'POST', body: { ...n, description: n.description || null, position: (q.data?.items.length ?? 0) } }), onSuccess: () => { setN({ name: '', emoji: '⭐', description: '' }); done('Categoria criada'); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<Category> }) => api(`/pessoas/reconhecimentos/categorias/${id}`, { method: 'PATCH', body }), onSuccess: () => done('Categoria atualizada'), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={5} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.canManage) return <div className="card"><EmptyState title="Sem acesso" description="As categorias de reconhecimento são configuradas por Pessoas e Cultura." /></div>;
  return (
    <div className="space-y-4">
      <section className="card p-5" aria-label="Categorias de reconhecimento">
        <h2 className="text-md font-bold text-ink">Categorias de reconhecimento</h2>
        <p className="mb-3 text-sm text-muted">Categoria desativada some do formulário; os reconhecimentos já feitos continuam. No futuro, cada categoria poderá ser ligada a um valor oficial da empresa.</p>
        <ul className="divide-y divide-line">{q.data.items.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <Input aria-label={`Emoji de ${c.name}`} className="h-9 w-14 text-center" defaultValue={c.emoji} maxLength={8} onBlur={(e) => e.target.value !== c.emoji && patch.mutate({ id: c.id, body: { emoji: e.target.value } })} />
            <Input aria-label={`Nome de ${c.name}`} className="h-9 min-w-[160px] flex-1" defaultValue={c.name} maxLength={60} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && patch.mutate({ id: c.id, body: { name: e.target.value.trim() } })} />
            <Input aria-label={`Descrição de ${c.name}`} className="h-9 min-w-[200px] flex-[2]" defaultValue={c.description ?? ''} maxLength={200} onBlur={(e) => e.target.value !== (c.description ?? '') && patch.mutate({ id: c.id, body: { description: e.target.value || null } })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={c.active} onChange={(e) => patch.mutate({ id: c.id, body: { active: e.target.checked } })} />Ativa</label>
          </li>
        ))}</ul>
        <form className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Input aria-label="Emoji da nova categoria" className="h-9 w-14 text-center" value={n.emoji} maxLength={8} onChange={(e) => setN({ ...n, emoji: e.target.value })} />
          <Input aria-label="Nome da nova categoria" className="h-9 min-w-[160px] flex-1" placeholder="Nova categoria" value={n.name} maxLength={60} onChange={(e) => setN({ ...n, name: e.target.value })} />
          <Input aria-label="Descrição da nova categoria" className="h-9 min-w-[200px] flex-[2]" placeholder="Descrição (opcional)" value={n.description} maxLength={200} onChange={(e) => setN({ ...n, description: e.target.value })} />
          <Button type="submit" variant="primary" size="sm" disabled={n.name.trim().length < 2} loading={create.isPending}>Adicionar</Button>
        </form>
      </section>
    </div>
  );
}
