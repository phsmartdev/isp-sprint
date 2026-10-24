/**
 * Funcionalidade 03 — E-mail corporativo (Gmail) dentro do CRM: caixa de entrada com filas, prazo de primeira resposta,
 * leitura, resposta, atribuição e vínculo com a conta; e a página das caixas (conectar com o Google).
 * Integração construída contra a API do Gmail; validação real com o Google pendente.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Inbox, Link2, Mail, Paperclip, RefreshCw, Search, Send, UserRound } from 'lucide-react';
import {
  MAILBOX_KIND_LABELS, MAILBOX_STATUS_LABELS, MAIL_PRIORITIES, MAIL_PRIORITY_LABELS, SLA_LABELS, THREAD_STATUSES, THREAD_STATUS_LABELS,
  type MailboxKind, type MailboxStatus, type MailPriority, type SlaState, type ThreadStatus,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtDateTime, fmtRelativeShort } from '../../lib/format';
import { useDebounced, useLookups, useUrlState } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { useAuth } from '../../auth/AuthProvider';
import { useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';
import { EmailToDeal } from '../../features/email/EmailToDeal';

export type MailboxRow = { id: string; kind: MailboxKind; address: string; displayName: string | null; ownerId: string | null; status: MailboxStatus; lastSyncAt: string | null; lastError: string | null; connectedAt: string | null; rowVersion: number; scopes: string[]; lastRun: { kind: string; ok: boolean; fetched: number; stored: number; error: string | null; created_at: string } | null };
type Queue = { id: string; name: string; mailboxId: string | null; routing: string; slaHours: number; members: string[]; active: boolean; rowVersion: number };
type Sla = { state: SlaState; dueAt: string | null };
type ThreadRow = { id: string; sender: string | null; subject: string; snippet: string | null; participants: string[]; lastMessageAt: string; status: ThreadStatus; priority: MailPriority; tags: string[]; unread: boolean; mailbox: { address: string; kind: MailboxKind }; queue: { id: string; name: string } | null; assignee: { id: string; name: string } | null; contact: { id: string; name: string } | null; linkAmbiguous: boolean; sla: Sla };
type ThreadDetail = {
  id: string; subject: string; status: ThreadStatus; priority: MailPriority; tags: string[]; rowVersion: number; participants: string[];
  mailbox: { id: string; address: string; kind: MailboxKind; status: MailboxStatus }; queue: { id: string; name: string; slaHours: number; members: string[] } | null;
  assigneeId: string | null; contact: { id: string; name: string } | null; opportunityId: string | null; linkSource: string | null; linkAmbiguous: boolean; sla: Sla;
  messages: { id: string; direction: 'entrada' | 'saida'; from: string; fromName: string | null; to: string[]; cc: string[]; subject: string; sentAt: string; text: string; hasAttachments: boolean; sentBy: string | null }[];
  events: { id: string; type: string; payload: Record<string, unknown>; actor: string | null; at: string }[];
  suggestions: { id: string; name: string; via: string }[]; opportunities: { id: string; label: string; stage: string }[]; canWork: boolean;
};

const STATUS_TONE: Record<ThreadStatus, Tone> = { nova: 'blue', em_atendimento: 'orange', aguardando_cliente: 'purple', resolvida: 'green', arquivada: 'neutral' };
const SLA_TONE: Record<SlaState, Tone> = { sem_prazo: 'neutral', no_prazo: 'green', vencendo: 'orange', vencido: 'red', respondida_no_prazo: 'green', respondida_fora: 'red' };
const VIEWS = [
  { key: 'minhas', label: 'Minhas' }, { key: 'sem_responsavel', label: 'Sem responsável' }, { key: 'prazo', label: 'Aguardando 1ª resposta' }, { key: 'todas', label: 'Todas' },
] as const;
type View = (typeof VIEWS)[number]['key'];

export function useMailboxes() {
  return useQuery({ queryKey: ['mail', 'boxes'], queryFn: () => api<{ items: MailboxRow[]; canConfigure: boolean; me: { email: string } }>('/mail/mailboxes') });
}

/** Barra do prazo de primeira resposta: quanto do prazo já passou. Some quando não há prazo. */
function SlaFuse({ sla, slaHours }: { sla: Sla; slaHours?: number | null }) {
  if (!sla.dueAt || !slaHours || sla.state.startsWith('respondida')) return null;
  const total = slaHours * 3_600_000;
  const used = Math.min(1, Math.max(0, 1 - (Date.parse(sla.dueAt) - Date.now()) / total));
  return (
    <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${SLA_LABELS[sla.state]}: ${Math.round(used * 100)}% do prazo usado`}>
      <span className={clsx('block h-full rounded-full', sla.state === 'vencido' ? 'bg-danger' : sla.state === 'vencendo' ? 'bg-warning' : 'bg-success')} style={{ width: `${Math.max(4, used * 100)}%` }} />
    </span>
  );
}

const who = (participants: string[], own: string) => participants.filter((p) => p !== own).slice(0, 2).join(', ') || own;

// ---------------------------------------------------------------- caixa de entrada
export function EmailPage() {
  const [f, setF] = useUrlState({ view: 'minhas', queue: '', box: '', status: 'abertas', q: '', t: '' });
  const [search, setSearch] = useState(f.q);
  const dq = useDebounced(search, 350);
  useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const boxes = useMailboxes();
  const queues = useQuery({ queryKey: ['mail', 'queues'], queryFn: () => api<{ items: Queue[]; canEdit: boolean }>('/mail/queues') });
  const params = { view: f.view, queueId: f.queue || undefined, mailboxId: f.box || undefined, status: f.status, q: f.q || undefined };
  const list = useQuery({ queryKey: ['mail', 'threads', params], placeholderData: keepPreviousData, refetchInterval: 60_000, queryFn: () => api<{ items: ThreadRow[]; hasMore: boolean }>(`/mail/threads${qs(params)}`) });
  const queueSla = useMemo(() => new Map((queues.data?.items ?? []).map((q) => [q.id, q.slaHours])), [queues.data]);
  const connected = (boxes.data?.items ?? []).filter((b) => b.status === 'conectada');
  const none = boxes.data && !boxes.data.items.length;

  return (
    <div>
      <PageHeader icon={<Mail />} title="E-mail" subtitle="Conversas das caixas da empresa e a sua, ligadas às contas do CRM."
        actions={<Link to="/email/caixas" className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-line bg-surface px-4 font-semibold text-ink hover:bg-surface-2">Caixas e conexão</Link>} />
      {none ? (
        <div className="card"><EmptyState icon={<Inbox className="h-10 w-10" />} title="Nenhuma caixa conectada" description="Conecte a sua caixa do Gmail ou peça à gerência para conectar as caixas compartilhadas da empresa." action={<Link to="/email/caixas" className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-sm bg-primary px-4 font-semibold text-white hover:bg-primary-hover">Conectar caixa</Link>} /></div>
      ) : (
        <div className="card grid min-h-[70vh] grid-cols-1 overflow-hidden lg:grid-cols-[13rem_minmax(18rem,24rem)_1fr]">
          {/* trilho: visões, filas e caixas */}
          <nav aria-label="Filtros do e-mail" className={clsx('border-line lg:border-r', f.t && 'hidden lg:block')}>
            <div className="flex gap-2 overflow-x-auto p-3 lg:block lg:space-y-1 lg:overflow-visible">
              {VIEWS.map((v) => (
                <button key={v.key} type="button" onClick={() => setF({ view: v.key, t: '' })} aria-pressed={f.view === v.key}
                  className={clsx('shrink-0 rounded-md px-3 py-1.5 text-left text-sm font-semibold lg:block lg:w-full', f.view === v.key ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2')}>{v.label}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 px-3 pb-3 lg:grid-cols-1">
              <FormField label="Fila" htmlFor="ml-q"><Select id="ml-q" value={f.queue} onChange={(e) => setF({ queue: e.target.value, t: '' })}><option value="">Todas</option>{(queues.data?.items ?? []).map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}</Select></FormField>
              <FormField label="Caixa" htmlFor="ml-b"><Select id="ml-b" value={f.box} onChange={(e) => setF({ box: e.target.value, t: '' })}><option value="">Todas</option>{(boxes.data?.items ?? []).map((b) => <option key={b.id} value={b.id}>{b.kind === 'pessoal' ? 'Minha caixa' : b.displayName ?? b.address}</option>)}</Select></FormField>
              <FormField label="Situação" htmlFor="ml-s"><Select id="ml-s" value={f.status} onChange={(e) => setF({ status: e.target.value, t: '' })}><option value="abertas">Abertas</option><option value="todas">Todas</option>{THREAD_STATUSES.map((s) => <option key={s} value={s}>{THREAD_STATUS_LABELS[s]}</option>)}</Select></FormField>
            </div>
            {!!connected.length && <p className="hidden px-3 pb-3 text-xs text-muted lg:block">Sincronizado {connected[0]!.lastSyncAt ? fmtRelativeShort(connected[0]!.lastSyncAt) : 'agora'}.</p>}
          </nav>

          {/* lista */}
          <section aria-label="Conversas" className={clsx('flex min-w-0 flex-col border-line lg:border-r', f.t && 'hidden lg:flex')}>
            <div className="border-b border-line p-3">
              <label className="relative block"><span className="sr-only">Buscar conversas</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Assunto, endereço ou texto" className="pl-9" />
              </label>
            </div>
            {list.isLoading ? <LoadingRows rows={6} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data!.items.length ? (
              <EmptyState title={f.view === 'minhas' ? 'Nada com você agora' : 'Nenhuma conversa'} description={f.view === 'minhas' ? 'Veja "Sem responsável" para assumir uma conversa da fila.' : 'Ajuste os filtros ou sincronize a caixa.'} />
            ) : (
              <ul className="scroll-thin flex-1 divide-y divide-line overflow-y-auto">
                {list.data!.items.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setF({ t: t.id })} aria-current={f.t === t.id}
                      className={clsx('block w-full px-4 py-3 text-left hover:bg-surface-2', f.t === t.id && 'bg-primary-soft/60')}>
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={clsx('min-w-0 truncate text-sm', t.unread ? 'font-bold text-ink' : 'font-semibold text-ink/80')}>{t.sender ?? who(t.participants, t.mailbox.address)}</span>
                        <span className="num shrink-0 text-xs text-muted">{fmtRelativeShort(t.lastMessageAt)}</span>
                      </span>
                      <span className={clsx('block truncate text-sm', t.unread ? 'font-semibold text-ink' : 'text-ink/80')}>{t.subject || '(sem assunto)'}</span>
                      <span className="block truncate text-xs text-muted">{t.snippet}</span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {t.sla.state === 'vencido' && <Chip tone="red">Prazo vencido</Chip>}
                        {t.priority === 'alta' && <Chip tone="red">Alta</Chip>}
                        {t.status !== 'nova' && <Chip tone={STATUS_TONE[t.status]}>{THREAD_STATUS_LABELS[t.status]}</Chip>}
                        {t.contact && <Chip tone="sky">{t.contact.name}</Chip>}
                        {!t.contact && t.linkAmbiguous && <Chip tone="yellow">Conta a confirmar</Chip>}
                        {t.assignee && f.view !== 'minhas' && <Chip>{t.assignee.name.split(' ')[0]}</Chip>}
                        {t.tags.map((x) => <Chip key={x} tone="purple">{x}</Chip>)}
                      </span>
                      <SlaFuse sla={t.sla} slaHours={t.queue ? queueSla.get(t.queue.id) : null} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* leitura */}
          <section aria-label="Conversa" className={clsx('min-w-0', !f.t && 'hidden lg:block')}>
            {f.t ? <ThreadView id={f.t} onBack={() => setF({ t: '' })} /> : <EmptyState icon={<Mail className="h-10 w-10" />} title="Escolha uma conversa" description="A conversa abre aqui, com a conta ligada e o prazo de resposta." />}
          </section>
        </div>
      )}
    </div>
  );
}

function ThreadView({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const users = useLookups().data?.users ?? [];
  const q = useQuery({ queryKey: ['mail', 'thread', id], queryFn: () => api<ThreadDetail>(`/mail/threads/${id}`) });
  const [text, setText] = useState('');
  const [showHist, setShowHist] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const me = useAuth().me?.user.id ?? null;
  const { can } = useAuth();
  useEffect(() => { setText(''); }, [id]);
  useEffect(() => { if (q.data) { end.current?.scrollIntoView({ block: 'nearest' }); void qc.invalidateQueries({ queryKey: ['mail', 'threads'] }); } }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (m: string) => { void qc.invalidateQueries({ queryKey: ['mail'] }); toast({ tone: 'success', message: m }); };
  const patch = useMutation({
    mutationFn: (b: Record<string, unknown>) => api(`/mail/threads/${id}`, { method: 'PATCH', body: { rowVersion: q.data!.rowVersion, ...b } }),
    onSuccess: () => done('Conversa atualizada'), onError: (e) => { toast({ tone: 'error', message: errMsg(e) }); void q.refetch(); },
  });
  const reply = useMutation({
    mutationFn: (resolve: boolean) => api(`/mail/threads/${id}/reply`, { method: 'POST', body: { text, resolve } }),
    onSuccess: (_, resolve) => { setText(''); done(resolve ? 'Resposta enviada e conversa resolvida' : 'Resposta enviada'); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <div className="p-4"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const d = q.data!;
  const shared = d.mailbox.kind === 'compartilhada';
  const members = shared ? users.filter((u) => !d.queue || d.queue.members.includes(u.id)) : [];
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-4">
        <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-primary lg:hidden"><ArrowLeft className="h-4 w-4" />Conversas</button>
        <h2 className="break-words text-lg font-bold text-ink">{d.subject || '(sem assunto)'}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip tone={STATUS_TONE[d.status]}>{THREAD_STATUS_LABELS[d.status]}</Chip>
          {d.sla.state !== 'sem_prazo' && <Chip tone={SLA_TONE[d.sla.state]} title={d.sla.dueAt ? `Prazo: ${fmtDateTime(d.sla.dueAt)}` : undefined}>{SLA_LABELS[d.sla.state]}{d.sla.dueAt && !d.sla.state.startsWith('respondida') ? ` · até ${fmtDateTime(d.sla.dueAt)}` : ''}</Chip>}
          <Chip>{shared ? d.mailbox.address : 'Minha caixa'}</Chip>
          {d.queue && <Chip tone="blue">{d.queue.name}</Chip>}
        </div>
        {d.canWork && (
          <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-3">
            {shared && (
              <FormField label="Responsável" htmlFor="th-a">
                <Select id="th-a" value={d.assigneeId ?? ''} disabled={patch.isPending} onChange={(e) => patch.mutate({ assigneeId: e.target.value || null })}>
                  <option value="">Sem responsável</option>{members.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </FormField>
            )}
            <FormField label="Situação" htmlFor="th-s">
              <Select id="th-s" value={d.status} disabled={patch.isPending} onChange={(e) => patch.mutate({ status: e.target.value })}>
                {THREAD_STATUSES.map((s) => <option key={s} value={s} disabled={s === 'nova' && d.status !== 'nova'}>{THREAD_STATUS_LABELS[s]}</option>)}
              </Select>
            </FormField>
            <FormField label="Prioridade" htmlFor="th-p">
              <Select id="th-p" value={d.priority} disabled={patch.isPending} onChange={(e) => patch.mutate({ priority: e.target.value })}>{MAIL_PRIORITIES.map((p) => <option key={p} value={p}>{MAIL_PRIORITY_LABELS[p]}</option>)}</Select>
            </FormField>
            {shared && !d.assigneeId && <div className="col-span-2 flex xl:col-span-3"><Button variant="secondary" icon={<UserRound className="h-4 w-4" />} loading={patch.isPending} onClick={() => patch.mutate({ assigneeId: me })}>Assumir esta conversa</Button></div>}
          </div>
        )}
        <CrmLink d={d} onPatch={(b) => patch.mutate(b)} busy={patch.isPending} />
        {d.canWork && can('oportunidades') && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {d.opportunityId
              ? <Link className="text-sm font-semibold text-primary hover:underline" to={`/opportunities/${d.opportunityId}`}>Abrir a negociação desta conversa</Link>
              : <EmailToDeal d={d} />}
          </div>
        )}
      </div>

      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto bg-surface-2/50 p-4">
        {d.messages.map((m) => (
          <article key={m.id} className={clsx('rounded-md border p-3', m.direction === 'saida' ? 'ml-6 border-primary/20 bg-primary-soft/40' : 'mr-6 border-line bg-surface')}>
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted">
              <span><b className="text-ink">{m.direction === 'saida' ? (m.sentBy ?? m.fromName ?? m.from) : (m.fromName ?? m.from)}</b>{m.fromName && m.direction === 'entrada' ? ` <${m.from}>` : ''} para {m.to.join(', ')}{m.cc.length ? ` · cc ${m.cc.join(', ')}` : ''}</span>
              <time className="num" dateTime={m.sentAt}>{fmtDateTime(m.sentAt)}</time>
            </header>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{m.text}</p>
            {m.hasAttachments && <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted"><Paperclip className="h-3.5 w-3.5" />Tem anexo (abra no Gmail)</p>}
          </article>
        ))}
        <div ref={end} />
        <div>
          <button type="button" className="text-xs font-semibold text-primary" onClick={() => setShowHist((v) => !v)} aria-expanded={showHist}>{showHist ? 'Ocultar histórico' : `Histórico (${d.events.length})`}</button>
          {showHist && <ul className="mt-2 space-y-1 text-xs text-muted">{d.events.map((e) => <li key={e.id}><span className="num">{fmtDateTime(e.at)}</span> · {eventText(e, users)}{e.actor ? ` · ${e.actor}` : ''}</li>)}</ul>}
        </div>
      </div>

      {d.canWork && (
        <div className="border-t border-line p-3">
          {d.mailbox.status !== 'conectada' ? <Notice tone="warning">A caixa {d.mailbox.address} não está conectada. Reconecte em Caixas e conexão para responder.</Notice> : (
            <>
              <label htmlFor="th-r" className="sr-only">Resposta</label>
              <Textarea id="th-r" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Responder como ${d.mailbox.address}`} />
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button variant="secondary" disabled={!text.trim()} loading={reply.isPending && reply.variables === true} onClick={() => reply.mutate(true)}>Responder e resolver</Button>
                <Button variant="primary" icon={<Send className="h-4 w-4" />} disabled={!text.trim()} loading={reply.isPending && reply.variables === false} onClick={() => reply.mutate(false)}>Responder</Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


function eventText(e: ThreadDetail['events'][number], users: { id: string; name: string }[]) {
  const name = (id: unknown) => users.find((u) => u.id === id)?.name ?? 'ninguém';
  const p = e.payload;
  switch (e.type) {
    case 'recebida': return p.direction === 'saida' ? 'Conversa iniciada pela empresa' : 'Chegou na caixa';
    case 'regra': return `Regra aplicada: ${String(p.name)}`;
    case 'atribuida': return `Responsável: ${name(p.to)}${p.how === 'rodizio' ? ' (rodízio)' : p.how === 'carteira' ? ' (dono da conta)' : p.how === 'assumiu' ? ' (assumiu)' : p.how === 'respondeu' ? ' (respondeu)' : ''}`;
    case 'situacao': return `Situação: ${THREAD_STATUS_LABELS[p.to as ThreadStatus] ?? String(p.to)}${p.note ? ` — ${String(p.note)}` : ''}`;
    case 'vinculada': return p.contactId ? `Ligada à conta${p.automatic ? ' (automático)' : ''}` : 'Vínculo com a conta removido';
    case 'oportunidade': return p.opportunityId ? 'Ligada a uma oportunidade' : 'Oportunidade desligada';
    case 'prioridade': return `Prioridade: ${MAIL_PRIORITY_LABELS[p.to as MailPriority]}`;
    case 'fila': return 'Fila alterada';
    default: return e.type;
  }
}

function CrmLink({ d, onPatch, busy }: { d: ThreadDetail; onPatch: (b: Record<string, unknown>) => void; busy: boolean }) {
  const [picking, setPicking] = useState(false);
  const [term, setTerm] = useState('');
  const dt = useDebounced(term, 300);
  const found = useQuery({ queryKey: ['contacts', 'pick', dt], enabled: picking && dt.length >= 2, queryFn: () => api<{ items: { id: string; name: string }[] }>(`/contacts${qs({ q: dt })}`) });
  return (
    <div className="mt-3 rounded-md border border-line p-3 text-sm">
      {d.contact ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link2 className="h-4 w-4 text-muted" aria-hidden />
          <span>Conta: <Link to={`/customers/${d.contact.id}`} className="font-semibold text-primary hover:underline">{d.contact.name}</Link>{d.linkSource === 'automatico' && <span className="text-xs text-muted"> (pelo endereço)</span>}</span>
          {d.canWork && !!d.opportunities.length && (
            <label className="flex items-center gap-2"><span className="text-xs text-muted">Oportunidade</span>
              <Select value={d.opportunityId ?? ''} disabled={busy} onChange={(e) => onPatch({ opportunityId: e.target.value || null })} aria-label="Oportunidade da conversa" className="h-8 py-0 text-sm">
                <option value="">Nenhuma</option>{d.opportunities.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </Select>
            </label>
          )}
          {d.canWork && <button type="button" className="text-xs font-semibold text-primary" onClick={() => setPicking(true)}>trocar</button>}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-muted"><Link2 className="h-4 w-4" aria-hidden />{d.linkAmbiguous ? 'Os endereços desta conversa aparecem em mais de uma conta. Confirme qual é.' : 'Conversa ainda sem conta do CRM.'}</p>
          {d.canWork && !!d.suggestions.length && <div className="flex flex-wrap gap-2">{d.suggestions.map((s) => <Button key={s.id} size="sm" variant="secondary" disabled={busy} onClick={() => onPatch({ contactId: s.id })}>Ligar a {s.name}</Button>)}</div>}
          {d.canWork && !picking && <button type="button" className="text-xs font-semibold text-primary" onClick={() => setPicking(true)}>Procurar conta</button>}
        </div>
      )}
      {picking && (
        <div className="mt-2 space-y-2">
          <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Nome, documento ou telefone da conta" aria-label="Procurar conta" />
          <div className="flex flex-wrap gap-2">
            {(found.data?.items ?? []).slice(0, 8).map((c) => <Button key={c.id} size="sm" variant="secondary" disabled={busy} onClick={() => { onPatch({ contactId: c.id }); setPicking(false); setTerm(''); }}>{c.name}</Button>)}
            {d.contact && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { onPatch({ contactId: null }); setPicking(false); }}>Remover vínculo</Button>}
            <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- caixas e conexão
const CONNECT_MSG: Record<string, { tone: 'info' | 'warning'; text: string }> = {
  ok: { tone: 'info', text: 'Caixa conectada. As mensagens dos últimos dias já foram trazidas.' },
  outra_conta: { tone: 'warning', text: 'A conta Google escolhida não é a desta caixa. Entre com o endereço da caixa.' },
  estado: { tone: 'warning', text: 'A conexão expirou ou não foi iniciada aqui. Tente de novo.' },
  cancelada: { tone: 'warning', text: 'A autorização foi cancelada no Google.' },
  escopos: { tone: 'warning', text: 'O Google não liberou a leitura e o envio de e-mails. Marque as permissões pedidas e tente de novo.' },
  sem_acesso_offline: { tone: 'warning', text: 'O Google não liberou o acesso contínuo. Remova o acesso do RevOps na conta Google e conecte de novo.' },
  falhou: { tone: 'warning', text: 'O Google recusou a conexão. Tente de novo em instantes.' },
  google_desligado: { tone: 'warning', text: 'A integração com o Google não está configurada no servidor.' },
};

/** Conexão do Gmail pessoal com senha de app (IMAP/SMTP do Gmail), sem depender do Google Cloud. */
function AppPasswordConnect({ boxId, address }: { boxId: string; address: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pwd, setPwd] = useState('');
  const go = useMutation({
    mutationFn: () => api<{ ok: boolean; sync: { ok: boolean; stored: number; error: string | null } }>(`/mail/mailboxes/${boxId}/app-password`, { method: 'POST', body: { password: pwd } }),
    onSuccess: (r) => { setPwd(''); void qc.invalidateQueries({ queryKey: ['mail'] }); toast({ tone: r.sync.ok ? 'success' : 'error', message: r.sync.ok ? `Gmail conectado. ${r.sync.stored} mensagem(ns) trazida(s).` : `Conectado, mas a leitura falhou: ${r.sync.error}` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const letters = pwd.replace(/\s+/g, '');
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="text-sm text-text">Conectar com <b>senha de app</b> do Gmail</p>
      <p className="text-xs text-muted">Crie em <a className="font-semibold text-primary hover:underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a> entrando com {address} (precisa da verificação em duas etapas). São 16 letras; não é a senha normal da conta.</p>
      <div className="flex flex-wrap gap-2">
        <Input aria-label={`Senha de app de ${address}`} type="password" autoComplete="off" className="min-w-0 flex-1" placeholder="abcd efgh ijkl mnop" value={pwd} onChange={(e) => setPwd(e.target.value)} />
        <Button size="sm" variant="primary" disabled={letters.length !== 16} loading={go.isPending} onClick={() => go.mutate()}>Conectar com senha de app</Button>
      </div>
    </div>
  );
}

export function MailboxesPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const result = sp.get('conexao');
  const boxes = useMailboxes();
  const settings = useQuery({ queryKey: ['mail', 'settings'], queryFn: () => api<{ allowedDomains: string[]; google: { configured: boolean; simulated: boolean } }>('/mail/settings') });
  // pessoal: cadastra e já leva para a autorização do Google (corporativa do login ou Gmail particular)
  const [privateAddr, setPrivateAddr] = useState('');
  const create = useMutation({
    mutationFn: (address?: string) => api<{ id: string }>('/mail/mailboxes', { method: 'POST', body: { kind: 'pessoal', ...(address ? { address } : {}) } }),
    // com a integração do Google, já abre a autorização; sem ela, a caixa aparece pedindo a senha de app
    onSuccess: (b) => { void qc.invalidateQueries({ queryKey: ['mail'] }); setPrivateAddr(''); if (settings.data?.google.configured) connect.mutate(b.id); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const connect = useMutation({ mutationFn: (id: string) => api<{ url: string }>(`/mail/mailboxes/${id}/connect`, { method: 'POST' }), onSuccess: (r) => { window.location.assign(r.url); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const sync = useMutation({ mutationFn: (id: string) => api<{ ok: boolean; stored: number; error: string | null }>(`/mail/mailboxes/${id}/sync`, { method: 'POST' }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['mail'] }); toast({ tone: r.ok ? 'success' : 'error', message: r.ok ? `${r.stored} mensagem(ns) nova(s)` : r.error ?? 'Falhou' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const state = useMutation({ mutationFn: (v: { id: string; action: string }) => api(`/mail/mailboxes/${v.id}/state`, { method: 'POST', body: { action: v.action } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['mail'] }); toast({ tone: 'success', message: 'Caixa atualizada' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (boxes.isLoading || settings.isLoading) return <div className="card"><LoadingRows rows={4} /></div>;
  if (boxes.isError) return <ErrorState error={boxes.error} onRetry={() => boxes.refetch()} />;
  const d = boxes.data!;
  const mine = d.items.find((b) => b.kind === 'pessoal' && b.address.toLowerCase() === d.me.email.toLowerCase());
  const privates = d.items.filter((b) => b.kind === 'pessoal' && b.address.toLowerCase() !== d.me.email.toLowerCase());
  const myDomain = d.me.email.split('@')[1] ?? '';
  const domainOk = settings.data?.allowedDomains.includes(myDomain);
  return (
    <div className="space-y-4">
      <PageHeader icon={<Mail />} title="Caixas de e-mail" subtitle="Conecte o Gmail para ler e responder pelo CRM. O acesso fica guardado cifrado e pode ser removido a qualquer momento." actions={<Link to="/email" className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-line bg-surface px-4 font-semibold text-ink hover:bg-surface-2">Voltar ao e-mail</Link>} />
      {result && CONNECT_MSG[result] && <Notice tone={CONNECT_MSG[result]!.tone}>{CONNECT_MSG[result]!.text} <button type="button" className="font-semibold underline" onClick={() => nav('/email/caixas', { replace: true })}>ok</button></Notice>}
      {settings.data?.google.simulated && <Notice tone="warning">Ambiente de teste: o Google aqui é simulado. A conexão real depende do projeto no Google Cloud com a Gmail API aprovada.</Notice>}
      {!settings.data?.google.configured && <Notice>Conecte o seu Gmail com uma <b>senha de app</b>: cadastre a caixa e cole a senha de 16 letras criada em myaccount.google.com/apppasswords (precisa da verificação em duas etapas ligada).</Notice>}
      <div className="grid gap-3 md:grid-cols-2">
        {!mine && (
          <div className="card flex flex-col items-start gap-2 p-4">
            <h2 className="text-md font-bold text-ink">Meu e-mail corporativo</h2>
            <p className="text-sm text-muted">{domainOk ? `Conecte ${d.me.email}. Só você vê esta caixa.` : `O domínio ${myDomain} não está liberado em Configurações → E-mail corporativo.`}</p>
            <Button variant="primary" disabled={!domainOk} loading={create.isPending && !create.variables} onClick={() => create.mutate(undefined)}>Conectar meu Gmail</Button>
          </div>
        )}
        {privates.length < 2 && (
          <div className="card flex flex-col items-start gap-2 p-4">
            <h2 className="text-md font-bold text-ink">Meu Gmail particular</h2>
            <p className="text-sm text-muted">Conecte também uma conta Gmail sua fora do domínio da empresa (ex.: @gmail.com). Só você vê esta caixa; o Google pede para entrar com essa mesma conta.</p>
            <div className="flex w-full flex-wrap gap-2">
              <Input aria-label="Endereço do Gmail particular" type="email" className="min-w-0 flex-1" placeholder="seu.nome@gmail.com" value={privateAddr} onChange={(e) => setPrivateAddr(e.target.value)} />
              <Button variant="primary" disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(privateAddr.trim())} loading={create.isPending && !!create.variables} onClick={() => create.mutate(privateAddr.trim())}>Conectar Gmail particular</Button>
            </div>
          </div>
        )}
        {d.items.map((b) => (
          <article key={b.id} className="card space-y-2 p-4" aria-label={`Caixa ${b.address}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0"><h2 className="truncate text-md font-bold text-ink">{b.kind === 'pessoal' ? (b.address.toLowerCase() === d.me.email.toLowerCase() ? 'Meu e-mail corporativo' : 'Meu Gmail particular') : b.displayName ?? b.address}</h2><p className="truncate text-sm text-muted">{b.address}</p></div>
              <div className="flex gap-1.5"><Chip>{MAILBOX_KIND_LABELS[b.kind]}</Chip><Chip tone={b.status === 'conectada' ? 'green' : b.status === 'erro' ? 'red' : 'neutral'}>{MAILBOX_STATUS_LABELS[b.status]}</Chip></div>
            </div>
            {b.lastError && <Notice tone="warning">{b.lastError}</Notice>}
            <p className="text-xs text-muted">{b.lastRun ? `Última sincronização ${fmtDateTime(b.lastRun.created_at)} (${b.lastRun.kind}): ${b.lastRun.ok ? `${b.lastRun.stored} nova(s)` : 'falhou'}` : 'Ainda não sincronizada.'}</p>
            {(b.kind === 'pessoal' || d.canConfigure) && (
              <div className="flex flex-wrap gap-2">
                {b.status !== 'conectada' && settings.data?.google.configured && <Button size="sm" variant="primary" loading={connect.isPending && connect.variables === b.id} onClick={() => connect.mutate(b.id)}>{b.status === 'desconectada' ? 'Conectar com o Google' : 'Reconectar'}</Button>}
                {b.status === 'conectada' && <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={sync.isPending && sync.variables === b.id} onClick={() => sync.mutate(b.id)}>Sincronizar agora</Button>}
                {b.status === 'conectada' && <Button size="sm" variant="ghost" onClick={() => state.mutate({ id: b.id, action: 'pausar' })}>Pausar</Button>}
                {b.status === 'pausada' && <Button size="sm" variant="ghost" onClick={() => state.mutate({ id: b.id, action: 'retomar' })}>Retomar</Button>}
                {b.status !== 'desconectada' && <Button size="sm" variant="ghost" onClick={() => state.mutate({ id: b.id, action: 'desconectar' })}>Desconectar</Button>}
              </div>
            )}
            {b.kind === 'pessoal' && b.status !== 'conectada' && b.status !== 'pausada' && <AppPasswordConnect boxId={b.id} address={b.address} />}
          </article>
        ))}
      </div>
      {d.canConfigure && <p className="text-sm text-muted">Caixas compartilhadas, filas e regras ficam em <Link to="/settings/gmail" className="font-semibold text-primary hover:underline">Configuração → E-mail corporativo</Link>.</p>}
    </div>
  );
}
