/** Reconhecimento: reconhecer um colega (categoria, mensagem, visibilidade) e ver os recebidos e enviados. */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, qs } from '../../lib/api';
import { fmtRelative } from '../../lib/format';
import { Avatar, Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import type { PersonCard } from './shared';
import { usePeoplePeople } from './feed/PostEditor';
import { usePostableCommunities } from './feed/api';

export type Category = { id: string; name: string; description: string | null; emoji: string; active: boolean; position: number };
export type RecognitionItem = { id: string; message: string; visibility: 'publica' | 'privada'; createdAt: string; postId: string | null; category: { name: string; emoji: string }; from: PersonCard | null; to: PersonCard | null };
export const useCategories = () => useQuery({ queryKey: ['pessoas', 'reconhecimento', 'categorias'], queryFn: () => api<{ items: Category[]; canManage: boolean }>('/pessoas/reconhecimentos/categorias') });

export function RecognitionPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'recebidos' | 'enviados'>('recebidos');
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <RecognizeForm preset={params.get('para')} />
      <section className="space-y-3" aria-label="Meus reconhecimentos">
        <div role="tablist" aria-label="Reconhecimentos" className="flex w-fit border border-line bg-surface text-sm">
          {(['recebidos', 'enviados'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={clsx('px-3 py-1.5', tab === t ? 'bg-primary text-white' : 'text-text hover:bg-surface-2')}>{t === 'recebidos' ? 'Recebidos' : 'Enviados'}</button>)}
        </div>
        <RecognitionList tipo={tab} />
      </section>
    </div>
  );
}

export function RecognitionList({ tipo, pessoa, compact }: { tipo: 'recebidos' | 'enviados'; pessoa?: string; compact?: boolean }) {
  const q = useQuery({ queryKey: ['pessoas', 'reconhecimentos', tipo, pessoa ?? 'eu'], queryFn: () => api<{ items: RecognitionItem[] }>(`/pessoas/reconhecimentos${qs({ tipo, pessoa })}`) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={3} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.items.length) return <div className={compact ? '' : 'card'}><EmptyState title={tipo === 'recebidos' ? 'Nenhum reconhecimento ainda' : 'Você ainda não reconheceu ninguém'} description={tipo === 'recebidos' ? 'Quando um colega reconhecer seu trabalho, aparece aqui.' : 'Reconhecer é rápido e faz diferença no dia de alguém.'} /></div>;
  return (
    <ul className="space-y-2">
      {q.data.items.map((r) => {
        const other = tipo === 'recebidos' ? r.from : r.to;
        return (
          <li key={r.id} className="card flex gap-3 p-3">
            <span className="text-2xl" aria-hidden>{r.category.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm"><span className="font-semibold text-ink">{r.category.name}</span>{other && <span className="text-muted"> · {tipo === 'recebidos' ? 'de' : 'para'} <Link to={`/pessoas/perfil/${other.id}`} className="hover:underline">{other.name}</Link></span>}{r.visibility === 'privada' && <span className="text-muted"> · privado</span>}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-text">{r.message}</p>
              <p className="mt-1 text-xs text-muted">{fmtRelative(r.createdAt)}{r.postId && <> · <Link to={`/pessoas/publicacao/${r.postId}`} className="hover:underline">ver no feed</Link></>}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RecognizeForm({ preset }: { preset: string | null }) {
  const people = usePeoplePeople().data ?? [];
  const cats = useCategories();
  const comms = usePostableCommunities().data ?? [];
  const qc = useQueryClient();
  const toast = useToast();
  const [to, setTo] = useState<{ id: string; name: string } | null>(null);
  const [term, setTerm] = useState('');
  const [cat, setCat] = useState('');
  const [msg, setMsg] = useState('');
  const [vis, setVis] = useState<'publica' | 'privada'>('publica');
  const [community, setCommunity] = useState('');
  const presetPerson = preset ? people.find((p) => p.id === preset) : undefined;
  const target = to ?? (presetPerson ? { id: presetPerson.id, name: presetPerson.name } : null);
  const send = useMutation({
    mutationFn: () => api<{ id: string; postId: string | null }>('/pessoas/reconhecimentos', { method: 'POST', body: { toUserId: target!.id, categoryId: cat, message: msg.trim(), visibility: vis, communityId: vis === 'publica' && community ? community : null } }),
    onSuccess: (r) => { setTo(null); setMsg(''); setCat(''); setTerm(''); void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: r.postId ? 'Reconhecimento publicado no feed! 🎉' : 'Reconhecimento enviado só para a pessoa' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const hits = term.trim().length >= 2 ? people.filter((p) => p.name.toLowerCase().includes(term.trim().toLowerCase())).slice(0, 6) : [];
  return (
    <form className="card space-y-4 p-5" aria-label="Reconhecer um colega" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
      <div>
        <h2 className="text-md font-bold text-ink">Reconhecer um colega</h2>
        <p className="text-sm text-muted">Conte o que a pessoa fez. Reconhecimento não gera pontos nem vira nota de desempenho: é sobre valorizar.</p>
      </div>
      <FormField label="Colega" htmlFor="rc-to" required>
        {target ? (
          <div className="flex items-center gap-3 border border-primary bg-primary-soft px-3 py-2"><Avatar name={target.name} userId={target.id} hasPhoto={people.find((p) => p.id === target.id)?.hasAvatar} size={32} /><span className="flex-1 text-sm font-semibold text-ink">{target.name}</span><Button size="sm" variant="ghost" onClick={() => { setTo(null); setTerm(''); window.history.replaceState(null, '', '/pessoas/reconhecimento'); }}>Trocar</Button></div>
        ) : (
          <div className="relative">
            <Input id="rc-to" placeholder="Digite o nome" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" />
            {hits.length > 0 && <ul className="absolute z-20 mt-1 w-full border border-line bg-surface shadow-overlay" role="listbox">{hits.map((p) => <li key={p.id}><button type="button" role="option" aria-selected="false" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setTo({ id: p.id, name: p.name })}><Avatar name={p.name} userId={p.id} hasPhoto={p.hasAvatar} size={24} />{p.name}{p.jobTitle && <span className="text-muted">· {p.jobTitle}</span>}</button></li>)}</ul>}
          </div>
        )}
      </FormField>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-ink">Categoria <span className="text-danger">*</span></legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(cats.data?.items ?? []).filter((c) => c.active).map((c) => (
            <label key={c.id} className={clsx('flex cursor-pointer items-start gap-2 border p-2.5 text-sm', cat === c.id ? 'border-primary bg-primary-soft' : 'border-line hover:border-line-strong')} title={c.description ?? undefined}>
              <input type="radio" name="rc-cat" className="sr-only" checked={cat === c.id} onChange={() => setCat(c.id)} />
              <span className="text-xl" aria-hidden>{c.emoji}</span><span><span className="block font-semibold text-ink">{c.name}</span>{c.description && <span className="text-xs text-muted">{c.description}</span>}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <FormField label="Mensagem" htmlFor="rc-msg" required hint={`${msg.length}/1000 · o que a pessoa fez e por que fez diferença`}>
        <Textarea id="rc-msg" rows={4} maxLength={1000} value={msg} onChange={(e) => setMsg(e.target.value)} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Quem vê" htmlFor="rc-vis">
          <Select id="rc-vis" value={vis} onChange={(e) => setVis(e.target.value as 'publica' | 'privada')}>
            <option value="publica">Público (vai para o feed)</option>
            <option value="privada">Privado (só a pessoa)</option>
          </Select>
        </FormField>
        {vis === 'publica' && comms.length > 0 && (
          <FormField label="Publicar em" htmlFor="rc-comm">
            <Select id="rc-comm" value={community} onChange={(e) => setCommunity(e.target.value)}>
              <option value="">Toda a empresa</option>{comms.map((c) => <option key={c.id} value={c.id}>Comunidade: {c.name}</option>)}
            </Select>
          </FormField>
        )}
      </div>
      <div className="flex justify-end"><Button type="submit" variant="primary" loading={send.isPending} disabled={!target || !cat || msg.trim().length < 10}>Reconhecer</Button></div>
    </form>
  );
}
