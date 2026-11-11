/** Enviar uma publicação por mensagem (como o avião do Instagram): para colegas e/ou grupos, com um recado opcional. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Link2, Search, UsersRound } from 'lucide-react';
import { api, qs } from '../../../lib/api';
import { useDebounced } from '../../../lib/hooks';
import { Avatar, Button, Input } from '../../../components/ui/primitives';
import { Modal, useToast } from '../../../components/ui/overlay';
import { errMsg } from '../../../features/contracts/shared';
import type { PersonCard } from '../shared';

type Conv = { id: string; kind: 'direta' | 'grupo'; title: string; with: PersonCard | null; members: PersonCard[] };
type Target = { key: string; kind: 'user' | 'group'; id: string; name: string; sub: string; person?: PersonCard; members?: PersonCard[] };

export function ShareDialog({ postId, open, onClose }: { postId: string; open: boolean; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [sel, setSel] = useState<Record<string, Target>>({});
  const [note, setNote] = useState('');
  const dq = useDebounced(term.trim(), 250);
  const toast = useToast();
  const qc = useQueryClient();
  const convs = useQuery({ queryKey: ['pessoas', 'mensagens'], enabled: open, queryFn: () => api<{ items: Conv[] }>('/pessoas/mensagens') });
  const people = useQuery({ queryKey: ['pessoas', 'colaboradores', 'share', dq], enabled: open, queryFn: () => api<{ items: PersonCard[] }>(`/pessoas/colaboradores${qs({ q: dq || undefined, limit: 12 })}`), placeholderData: (p) => p });
  const groups: Target[] = (convs.data?.items ?? []).filter((c) => c.kind === 'grupo' && (!dq || c.title.toLowerCase().includes(dq.toLowerCase()))).map((c) => ({ key: `g:${c.id}`, kind: 'group', id: c.id, name: c.title, sub: `${c.members.length + 1} pessoas`, members: c.members }));
  const users: Target[] = (people.data?.items ?? []).map((p) => ({ key: `u:${p.id}`, kind: 'user', id: p.id, name: p.name, sub: p.jobTitle ?? '', person: p }));
  const chosen = Object.values(sel);
  const send = useMutation({
    mutationFn: () => api<{ sent: number }>(`/pessoas/posts/${postId}/enviar`, { method: 'POST', body: { userIds: chosen.filter((c) => c.kind === 'user').map((c) => c.id), conversationIds: chosen.filter((c) => c.kind === 'group').map((c) => c.id), note: note.trim() } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['pessoas', 'mensagens'] }); toast({ tone: 'success', message: r.sent === 1 ? 'Enviada' : `Enviada para ${r.sent} conversas` }); setSel({}); setNote(''); setTerm(''); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const copy = async () => { try { await navigator.clipboard.writeText(`${location.origin}/pessoas/publicacao/${postId}`); toast({ tone: 'success', message: 'Link copiado. Só quem pode ver a publicação consegue abrir.' }); } catch { toast({ tone: 'error', message: 'Não foi possível copiar o link.' }); } };
  const row = (t: Target) => (
    <li key={t.key}>
      <button type="button" role="checkbox" aria-checked={!!sel[t.key]} aria-label={t.name} onClick={() => setSel((s) => { const n = { ...s }; if (n[t.key]) delete n[t.key]; else n[t.key] = t; return n; })} className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left hover:bg-surface-2">
        {t.kind === 'user' ? <Avatar name={t.name} userId={t.id} hasPhoto={t.person?.hasPhoto} size={40} /> : <span className="flex h-10 w-10 items-center justify-center rounded-circle bg-primary-soft text-primary"><UsersRound className="h-5 w-5" aria-hidden /></span>}
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink">{t.name}</span><span className="block truncate text-xs text-muted">{t.sub}</span></span>
        <span className={clsx('flex h-6 w-6 items-center justify-center rounded-circle border-2', sel[t.key] ? 'border-primary bg-primary text-white' : 'border-line-strong')}>{sel[t.key] && <Check className="h-4 w-4" aria-hidden />}</span>
      </button>
    </li>
  );
  return (
    <Modal open={open} onClose={onClose} title="Enviar" size="sm"
      footer={<div className="flex w-full flex-col gap-2">
        {chosen.length > 0 && <Input aria-label="Escrever um recado" placeholder="Escreva um recado (opcional)" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}
        <div className="flex gap-2"><Button icon={<Link2 className="h-4 w-4" />} onClick={() => void copy()}>Copiar link</Button><Button variant="primary" className="flex-1" disabled={!chosen.length} loading={send.isPending} onClick={() => send.mutate()}>{chosen.length > 1 ? `Enviar para ${chosen.length}` : 'Enviar'}</Button></div>
      </div>}>
      <div className="relative mb-3"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden /><Input aria-label="Pesquisar colega ou grupo" className="pl-9" placeholder="Pesquisar colega ou grupo" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus /></div>
      <div className="max-h-80 overflow-y-auto">
        {groups.length > 0 && <><p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">Grupos</p><ul>{groups.map(row)}</ul></>}
        <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">Colegas</p>
        <ul>{users.map(row)}</ul>
      </div>
    </Modal>
  );
}
