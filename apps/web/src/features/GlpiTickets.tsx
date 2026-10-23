/** Chamados no GLPI abertos a partir da negociação: abrir, acompanhar o retorno e responder. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ExternalLink, Plus, RefreshCw, EyeOff, Send } from 'lucide-react';
import { GLPI_KIND_LABELS, GLPI_TYPE_LABELS, GLPI_URGENCY_LABELS, GLPI_VALIDATION_LABELS, pendingValidations, type GlpiTimelineKind, type GlpiValidationDecision } from '@isp/domain';
import { api, qs } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../components/ui/primitives';
import { Modal, useToast } from '../components/ui/overlay';
import { errMsg } from './contracts/shared';

type Ev = { id: string; kind: GlpiTimelineKind | 'Abertura'; direction: 'entrada' | 'saida'; author: string | null; text: string; isPrivate: boolean; occurredAt: string; validationId: number | null; validationStatus: number | null };
type Ticket = {
  id: string; glpiId: number; title: string; entityName: string | null; categoryName: string | null; groupName: string | null; type: number; urgency: number;
  status: number | null; statusName: string; open: boolean; lastSyncAt: string | null; syncError: string | null; unseen: number; openedByName: string; createdAt: string; url: string | null; events: Ev[];
};
type Opt = { id: number; name: string };
const STATUS_TONE = (s: number | null) => (s === 5 ? 'green' : s === 6 ? 'neutral' : s === 4 ? 'orange' : 'blue') as 'green' | 'neutral' | 'orange' | 'blue';
const VAL_TONE = (st: number | null) => (st === 3 ? 'green' : st === 4 ? 'red' : 'yellow') as 'green' | 'red' | 'yellow';
const KIND = (k: Ev['kind']) => (k === 'Abertura' ? 'Abertura' : GLPI_KIND_LABELS[k]);

export function GlpiTickets({ oppId, contactName, hasCustomer }: { oppId: string; contactName: string; hasCustomer: boolean }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['glpi', 'status'], queryFn: () => api<{ ready: boolean; message: string | null }>('/glpi/status'), staleTime: 60_000 });
  const list = useQuery({ queryKey: ['glpi', 'tickets', oppId], queryFn: () => api<{ items: Ticket[] }>(`/opportunities/${oppId}/glpi-tickets`) });
  useEffect(() => { if (list.data) void qc.invalidateQueries({ queryKey: ['glpi', 'unseen', oppId] }); }, [list.data, qc, oppId]);
  const [opening, setOpening] = useState(false);
  const ready = status.data?.ready;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Chamados abertos no GLPI para esta negociação. Situação, acompanhamentos e solução voltam para cá sozinhos.</p>
        {ready && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpening(true)}>Abrir chamado no GLPI</Button>}
      </div>
      {status.data && !ready && <Notice tone="warning">{status.data.message}</Notice>}
      {list.isLoading ? <LoadingRows rows={3} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data?.items.length ? (
        <EmptyState title="Nenhum chamado aberto" description={ready ? 'Precisa de viabilidade técnica, visita ou apoio do suporte? Abra o chamado daqui, já na entidade do cliente.' : undefined} />
      ) : (
        <ul className="space-y-3">{list.data.items.map((t) => <TicketCard key={t.id} t={t} oppId={oppId} />)}</ul>
      )}
      {ready && <OpenTicketDialog open={opening} onClose={() => setOpening(false)} oppId={oppId} contactName={contactName} hasCustomer={hasCustomer} />}
    </div>
  );
}

function TicketCard({ t, oppId }: { t: Ticket; oppId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['glpi', 'tickets', oppId] }); void qc.invalidateQueries({ queryKey: ['glpi', 'unseen', oppId] }); };
  const [reply, setReply] = useState('');
  const [priv, setPriv] = useState(false);
  const sync = useMutation({ mutationFn: () => api<{ added: number }>(`/glpi-tickets/${t.id}/sync`, { method: 'POST' }), onSuccess: (r) => { refresh(); toast({ tone: 'success', message: r.added ? `${r.added} retorno(s) novo(s)` : 'Chamado atualizado' }); }, onError: (e) => { refresh(); toast({ tone: 'error', message: errMsg(e) }); } });
  const pending = new Set(pendingValidations(t.events).map((e) => e.id));
  // pedidos já respondidos (no GLPI ou aqui): o pedido vira histórico e a resposta aparece logo abaixo, sem botão
  const decided = new Set(t.events.filter((e) => e.validationId != null && (e.validationStatus === 3 || e.validationStatus === 4)).map((e) => e.validationId));
  const [answer, setAnswer] = useState<{ ev: Ev; decision: GlpiValidationDecision } | null>(null);
  const [comment, setComment] = useState('');
  const decide = useMutation({
    mutationFn: () => api(`/glpi-tickets/${t.id}/validations/${answer!.ev.validationId}`, { method: 'POST', body: { decision: answer!.decision, comment: comment || undefined } }),
    onSuccess: () => { toast({ tone: 'success', message: answer!.decision === 'aprovar' ? 'Aprovação registrada no GLPI' : 'Recusa registrada no GLPI' }); setAnswer(null); setComment(''); refresh(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const send = useMutation({ mutationFn: () => api(`/glpi-tickets/${t.id}/followups`, { method: 'POST', body: { text: reply, isPrivate: priv } }), onSuccess: () => { setReply(''); setPriv(false); refresh(); toast({ tone: 'success', message: priv ? 'Acompanhamento privado enviado ao GLPI' : 'Acompanhamento enviado ao GLPI' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <li className="rounded-md border border-line" aria-label={`Chamado ${t.glpiId}`}>
      <div className="flex flex-wrap items-start gap-3 border-b border-line p-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink"><span className="num text-muted">#{t.glpiId}</span> {t.title}</p>
          <p className="mt-1 text-xs text-muted">{[t.entityName, t.categoryName, t.groupName && `Grupo ${t.groupName}`, GLPI_TYPE_LABELS[t.type], `Urgência ${GLPI_URGENCY_LABELS[t.urgency]?.toLowerCase()}`].filter(Boolean).join(' · ')}</p>
          <p className="text-xs text-muted">Aberto por {t.openedByName} em {fmtDateTime(t.createdAt)}{t.lastSyncAt ? ` · lido no GLPI em ${fmtDateTime(t.lastSyncAt)}` : ''}</p>
        </div>
        <Chip tone={STATUS_TONE(t.status)}>{t.statusName}</Chip>
        {t.unseen > 0 && <Chip tone="red">{t.unseen} novo(s)</Chip>}
        <span className="flex gap-1.5">
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={sync.isPending} onClick={() => sync.mutate()}>Atualizar</Button>
          {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line px-3 text-sm font-semibold text-primary hover:bg-surface-2"><ExternalLink className="h-4 w-4" />Abrir no GLPI</a>}
        </span>
      </div>
      {t.syncError && <div className="px-4 pt-3"><Notice tone="warning">Última leitura falhou: {t.syncError}</Notice></div>}
      <ol className="space-y-3 p-4" aria-label={`Retornos do chamado ${t.glpiId}`}>
        {t.events.map((e) => (
          <li key={e.id} className={clsx('rounded-md p-3 text-sm', e.direction === 'saida' ? 'ml-6' : e.kind !== 'Status' && e.kind !== 'Solution' && 'mr-6',
            // privado (como no GLPI): fundo amarelo, para ninguém confundir com o que o solicitante vê
            e.isPrivate ? 'border border-warning/50 bg-warning-soft' : e.direction === 'saida' ? 'bg-primary-soft' : e.kind === 'Solution' ? 'border border-success/40 bg-success-soft' : e.kind === 'Status' ? 'bg-surface-2' : e.kind === 'Validation' && pending.has(e.id) ? 'border border-warning/50' : 'border border-line')}>
            <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="font-semibold text-ink">{KIND(e.kind)}</span>
              {e.isPrivate && <Chip tone="yellow"><EyeOff className="mr-1 inline h-3 w-3" aria-hidden />{e.direction === 'saida' ? 'Privado' : 'Privado do suporte'}</Chip>}
              {e.kind === 'Validation' && (e.validationStatus === 2 && decided.has(e.validationId) ? <Chip tone="neutral">Pedido de aprovação</Chip> : <Chip tone={VAL_TONE(e.validationStatus)}>{GLPI_VALIDATION_LABELS[e.validationStatus ?? 1]}</Chip>)}
              <span>{e.author ?? (e.direction === 'entrada' ? 'GLPI' : '')}</span>
              <span className="num">{fmtDateTime(e.occurredAt)}</span>
            </p>
            {e.kind === 'Status' ? <p>Situação mudou para <span className="font-semibold text-ink">{e.text}</span></p> : e.text ? <p className="whitespace-pre-line">{e.text}</p> : null}
            {pending.has(e.id) && (
              <span className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" onClick={() => { setComment(''); setAnswer({ ev: e, decision: 'aprovar' }); }}>Aprovar</Button>
                <Button size="sm" variant="secondary" onClick={() => { setComment(''); setAnswer({ ev: e, decision: 'recusar' }); }}>Recusar</Button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {t.status !== 6 && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line p-4">
          <FormField label="Responder no chamado" htmlFor={`glpi-r-${t.id}`} className="min-w-[240px] flex-1" hint={priv ? 'Privado: só a equipe do GLPI vê; o solicitante não recebe' : 'Público: a equipe do GLPI e o solicitante veem'}>
            <Textarea id={`glpi-r-${t.id}`} rows={2} value={reply} onChange={(e) => setReply(e.target.value)} />
          </FormField>
          <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={priv} onChange={(e) => setPriv(e.target.checked)} /><EyeOff className="h-4 w-4 text-muted" aria-hidden />Privado</label>
          <Button variant="primary" icon={<Send className="h-4 w-4" />} disabled={reply.trim().length < 3} loading={send.isPending} onClick={() => send.mutate()}>Enviar ao GLPI</Button>
        </div>
      )}
      <Modal open={!!answer} onClose={() => setAnswer(null)} title={answer?.decision === 'aprovar' ? 'Aprovar no GLPI' : 'Recusar no GLPI'}
        footer={<><Button variant="secondary" onClick={() => setAnswer(null)}>Cancelar</Button><Button variant={answer?.decision === 'aprovar' ? 'primary' : 'danger'} disabled={answer?.decision === 'recusar' && comment.trim().length < 5} loading={decide.isPending} onClick={() => decide.mutate()}>{answer?.decision === 'aprovar' ? 'Aprovar' : 'Recusar'}</Button></>}>
        <div className="space-y-4">
          {answer?.ev.text && <div className="rounded-md bg-surface-2 p-3 text-sm"><p className="font-semibold text-ink">Pedido de aprovação{answer.ev.author ? ` de ${answer.ev.author}` : ''}</p><p className="mt-1 whitespace-pre-line">{answer.ev.text}</p></div>}
          <FormField label={answer?.decision === 'recusar' ? 'Motivo da recusa' : 'Comentário (opcional)'} htmlFor={`glpi-v-${t.id}`} required={answer?.decision === 'recusar'} hint="Vai para o GLPI com o seu nome: “Aprovado/Recusado no RevOps por …”">
            <Textarea id={`glpi-v-${t.id}`} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </FormField>
        </div>
      </Modal>
    </li>
  );
}

function OpenTicketDialog({ open, onClose, oppId, contactName, hasCustomer }: { open: boolean; onClose: () => void; oppId: string; contactName: string; hasCustomer: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [f, setF] = useState({ entityId: '', categoryId: '', groupId: '', type: '2', urgency: '3', title: '', content: '', remember: true });
  const ents = useQuery({ queryKey: ['glpi', 'entities', oppId, dq], enabled: open, queryFn: () => api<{ linked: Opt | null; items: Opt[] }>(`/glpi/entities${qs({ q: dq || undefined, opportunityId: oppId })}`) });
  const cats = useQuery({ queryKey: ['glpi', 'categories'], enabled: open, staleTime: 5 * 60_000, queryFn: () => api<{ items: Opt[] }>('/glpi/categories') });
  const groups = useQuery({ queryKey: ['glpi', 'groups'], enabled: open, staleTime: 5 * 60_000, queryFn: () => api<{ items: Opt[] }>('/glpi/groups') });
  const linked = ents.data?.linked ?? null;
  useEffect(() => { if (open && linked && !f.entityId) setF((x) => ({ ...x, entityId: String(linked.id) })); }, [open, linked]); // eslint-disable-line react-hooks/exhaustive-deps
  const entityOpts = [...(linked && !ents.data?.items.some((e) => e.id === linked.id) ? [{ id: linked.id, name: linked.name ?? `Entidade ${linked.id}` }] : []), ...(ents.data?.items ?? [])];
  const nameOf = (list: Opt[] | undefined, id: string) => list?.find((x) => String(x.id) === id)?.name ?? null;
  const mut = useMutation({
    mutationFn: () => api<{ glpiId: number; warning: string | null }>(`/opportunities/${oppId}/glpi-tickets`, {
      method: 'POST',
      body: {
        entityId: Number(f.entityId), entityName: nameOf(entityOpts, f.entityId), categoryId: f.categoryId ? Number(f.categoryId) : null, categoryName: nameOf(cats.data?.items, f.categoryId),
        groupId: f.groupId ? Number(f.groupId) : null, groupName: nameOf(groups.data?.items, f.groupId), type: Number(f.type), urgency: Number(f.urgency), title: f.title, content: f.content, rememberEntity: f.remember,
      },
    }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['glpi'] });
      toast({ tone: r.warning ? 'error' : 'success', message: r.warning ?? `Chamado #${r.glpiId} aberto no GLPI` });
      setF({ entityId: '', categoryId: '', groupId: '', type: '2', urgency: '3', title: '', content: '', remember: true });
      onClose();
    },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const valid = f.entityId !== '' && f.title.trim().length >= 5 && f.content.trim().length >= 10;
  return (
    <Modal open={open} onClose={onClose} title="Abrir chamado no GLPI" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} loading={mut.isPending} onClick={() => mut.mutate()}>Abrir chamado</Button></>}>
      <div className="space-y-4">
        {(ents.isError || cats.isError) && <Notice tone="warning">{errMsg(ents.error ?? cats.error)}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Buscar entidade" htmlFor="gl-q" hint={linked ? 'Já vinculada a este cliente; busque para trocar' : `Ex.: ${contactName}`}><Input id="gl-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome do cliente no GLPI" /></FormField>
          <FormField label="Entidade do cliente" htmlFor="gl-ent" required>
            <Select id="gl-ent" value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value })}>
              <option value="">{ents.isLoading ? 'Carregando…' : entityOpts.length ? 'Escolha' : 'Nenhuma entidade encontrada'}</option>
              {entityOpts.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Categoria" htmlFor="gl-cat"><Select id="gl-cat" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Sem categoria</option>{cats.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FormField>
          <FormField label="Grupo técnico" htmlFor="gl-grp"><Select id="gl-grp" value={f.groupId} onChange={(e) => setF({ ...f, groupId: e.target.value })}><option value="">Deixar para a triagem do GLPI</option>{groups.data?.items.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></FormField>
          <FormField label="Tipo" htmlFor="gl-type"><Select id="gl-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(GLPI_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></FormField>
          <FormField label="Urgência" htmlFor="gl-urg"><Select id="gl-urg" value={f.urgency} onChange={(e) => setF({ ...f, urgency: e.target.value })}>{Object.entries(GLPI_URGENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></FormField>
        </div>
        <FormField label="Título" htmlFor="gl-title" required><Input id="gl-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: Viabilidade de link dedicado 200 Mb" /></FormField>
        <FormField label="Descrição" htmlFor="gl-content" required hint="O código desta negociação (OP) e o seu nome vão junto no chamado"><Textarea id="gl-content" rows={5} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></FormField>
        {hasCustomer && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.remember} onChange={(e) => setF({ ...f, remember: e.target.checked })} />Lembrar esta entidade para o cliente</label>}
      </div>
    </Modal>
  );
}
