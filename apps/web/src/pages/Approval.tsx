/** Análise e aprovação da negociação: a tela se adapta a novo cliente × cliente da base. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, MessageSquare, RotateCcw, Send, XCircle } from 'lucide-react';
import { APPROVAL_LEVEL_LABELS, NEGOTIATION_TYPES, NEGOTIATION_TYPE_LABELS, toCents, type NegotiationType } from '@isp/domain';
import { api, qs } from '../lib/api';
import { fmtBRL, fmtDateTime } from '../lib/format';
import { useAuth } from '../auth/AuthProvider';
import { Breadcrumb, Button, Chip, ErrorState, FormField, Input, LoadingRows, Select, Textarea, type Tone } from '../components/ui/primitives';
import { Modal, useToast } from '../components/ui/overlay';
import { MoneyToggle } from '../lib/privacy';
import { dec, errMsg } from '../features/contracts/shared';
import type { Analysis, RequestStatus } from '../features/approval/types';
import {
  ClassificationPanel, ContractsPanel, CustomerIntelligence, DataReference, DocumentsPanel, ExecutiveSummary, HistoryPanel, IdentityPanel, MarginPanel, NewCustomerPanel, OpinionPanel, ViabilityStrip, pct,
} from '../features/approval/Panels';

const STATUS: Record<RequestStatus, { label: string; tone: Tone }> = {
  pendente: { label: 'Aguardando decisão', tone: 'yellow' },
  aprovada: { label: 'Aprovada', tone: 'green' },
  reprovada: { label: 'Reprovada', tone: 'red' },
  correcao: { label: 'Correção solicitada', tone: 'orange' },
  substituida: { label: 'Substituída', tone: 'neutral' },
};

export function ApprovalPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['approval', id], queryFn: () => api<Analysis>(`/opportunities/${id}/approval`) });
  const [requestOpen, setRequestOpen] = useState(false);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <div className="card"><LoadingRows rows={10} /></div>;
  const a = q.data;
  const latest = a.requests[0] ?? null;
  const base = a.kind.kind === 'base';
  const canNew = a.viewer.canRequest && a.opportunity.stage !== 'perdida';
  return (
    <div className="w-full">
      <Breadcrumb items={[{ label: 'Oportunidades', to: '/opportunities' }, { label: `OP-${a.opportunity.code}`, to: `/opportunities/${a.opportunity.id}` }, { label: 'Análise e aprovação' }]} />
      <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="w-full min-w-0 md:w-auto md:flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Análise e aprovação</h1>
          <p className="text-md text-muted">
            <Link to={`/opportunities/${a.opportunity.id}`} className="font-semibold text-ink hover:underline">{a.opportunity.title}</Link> · {a.opportunity.pipelineName} · responsável {a.opportunity.ownerName}
          </p>
        </div>
        <Chip tone={base ? 'blue' : 'purple'} title={a.kind.reasons.join(' ')}>{a.kind.label}</Chip>
        {latest && <Chip tone={STATUS[latest.status].tone}>v{latest.version}: {STATUS[latest.status].label}</Chip>}
        <MoneyToggle compact />
        {canNew && <Button variant="primary" icon={<Send className="h-4 w-4" />} onClick={() => setRequestOpen(true)}>{a.pending ? 'Nova versão do pedido' : latest ? 'Pedir nova aprovação' : 'Solicitar aprovação'}</Button>}
      </header>

      {a.materialChanges.length > 0 && (
        <div role="alert" className="mb-4 flex gap-3 rounded-md border border-warning bg-warning-soft px-4 py-3 text-sm text-[#7A3E00]">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div><p className="font-bold">Os dados mudaram desde o pedido — a análise precisa ser atualizada.</p><ul className="mt-1 list-disc pl-5">{a.materialChanges.map((c) => <li key={c}>{c}</li>)}</ul></div>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <ExecutiveSummary a={a} />
          <OpinionPanel a={a} />
          {base && a.intelligence && <CustomerIntelligence a={a} />}
          {!base && <NewCustomerPanel a={a} />}
          <MarginPanel a={a} />
          {base && a.viewer.see.contracts && <ContractsPanel a={a} />}
          {a.classification && a.customer && <ClassificationPanel a={a} />}
          {base && <section className="card p-5"><h2 className="mb-1 text-md font-bold text-ink">Viabilidade técnica e financeira da proposta</h2><ViabilityStrip a={a} /></section>}
          <IdentityPanel a={a} onDecided={() => q.refetch()} />
          <HistoryPanel a={a} />
          <DocumentsPanel a={a} />
          <DataReference a={a} />
        </div>
        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
          {a.pending && <DecisionPanel a={a} />}
          {!a.pending && latest && <LastDecision a={a} />}
          {!latest && <section className="card p-5"><h2 className="text-md font-bold text-ink">Sem pedido de aprovação</h2><p className="mt-1 text-sm text-muted">A análise acima já mostra a situação atual. {canNew ? 'Use “Solicitar aprovação” para enviar as condições à alçada.' : ''}</p></section>}
          <ChatPanel a={a} />
        </aside>
      </div>
      {requestOpen && <RequestDialog a={a} onClose={() => setRequestOpen(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ decisão

function DecisionPanel({ a }: { a: Analysis }) {
  const r = a.pending!;
  const qc = useQueryClient();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [ack, setAck] = useState(false);
  const decide = useMutation({
    mutationFn: (decision: 'aprovada' | 'reprovada' | 'correcao') => api(`/approval-requests/${r.id}/decision`, { method: 'POST', body: { decision, comment, acknowledgeChanges: ack, analysisAt: a.generatedAt } }),
    onSuccess: (_, d) => { qc.invalidateQueries({ queryKey: ['approval', a.opportunity.id] }); qc.invalidateQueries({ queryKey: ['approvals'] }); toast({ tone: 'success', message: d === 'aprovada' ? 'Aprovada' : d === 'reprovada' ? 'Reprovada' : 'Correção solicitada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section className="card overflow-hidden" aria-labelledby="dec-h">
      <div className="bg-[#FFF6D6] px-5 py-3">
        <h2 id="dec-h" className="text-md font-bold text-ink">Decisão solicitada · v{r.version}</h2>
        <p className="text-sm text-text">{a.executive.decisionAsked}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 px-5 py-4 text-sm">
        <div><dt className="text-xs text-muted">Tipo</dt><dd className="font-semibold text-ink">{r.negotiationLabel}</dd></div>
        <div><dt className="text-xs text-muted">Valor proposto</dt><dd className="num font-semibold text-ink">{fmtBRL(r.proposedMonthlyCents)}/mês</dd></div>
        <div><dt className="text-xs text-muted">Desconto</dt><dd className="num font-semibold text-ink">{pct(r.discountBp)}</dd></div>
        <div><dt className="text-xs text-muted">Alçada</dt><dd className="font-semibold text-ink">{r.requiredLabel}{r.exceptional ? ' (excepcional)' : ''}</dd></div>
        {r.replacesMonthlyCents > 0 && <div><dt className="text-xs text-muted">Substitui</dt><dd className="num font-semibold text-ink">{fmtBRL(r.replacesMonthlyCents)}/mês</dd></div>}
        {r.termMonths && <div><dt className="text-xs text-muted">Prazo</dt><dd className="font-semibold text-ink">{r.termMonths} meses</dd></div>}
        {r.conditions && <div className="col-span-2"><dt className="text-xs text-muted">Condições</dt><dd className="text-ink">{r.conditions}</dd></div>}
        <div className="col-span-2"><dt className="text-xs text-muted">Pedido por</dt><dd className="text-ink">{r.requesterName} em {fmtDateTime(r.createdAt)}</dd></div>
      </dl>
      <div className="border-t border-line px-5 py-4">
        {a.viewer.isApprover ? (
          <>
            <FormField label="Comentário" htmlFor="dec-c" hint="Obrigatório para reprovar ou pedir correção.">
              <Textarea id="dec-c" value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-[84px]" />
            </FormField>
            {a.materialChanges.length > 0 && (
              <label className="mt-2 flex items-start gap-2 text-sm text-text"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />Considerei as mudanças nos dados desde o pedido.</label>
            )}
            <div className="mt-3 grid grid-cols-1 gap-2">
              <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} loading={decide.isPending && decide.variables === 'aprovada'} disabled={decide.isPending || (a.materialChanges.length > 0 && !ack)} onClick={() => decide.mutate('aprovada')}>Aprovar</Button>
              <div className="grid grid-cols-2 gap-2">
                <Button icon={<RotateCcw className="h-4 w-4" />} loading={decide.isPending && decide.variables === 'correcao'} disabled={decide.isPending} onClick={() => decide.mutate('correcao')}>Solicitar correção</Button>
                <Button variant="danger" icon={<XCircle className="h-4 w-4" />} loading={decide.isPending && decide.variables === 'reprovada'} disabled={decide.isPending} onClick={() => decide.mutate('reprovada')}>Reprovar</Button>
              </div>
            </div>
            <p className="mt-2 text-2xs text-muted">Sua alçada: {a.viewer.levelLabel}. A decisão fica ligada à versão {r.version} e grava o resumo financeiro desta tela.</p>
          </>
        ) : (
          <p className="text-sm text-muted">{a.viewer.isRequester ? 'Você pediu esta aprovação; a decisão é de outra pessoa com alçada.' : `Aguardando alguém com alçada ${r.requiredLabel} ou superior. Sua alçada: ${a.viewer.levelLabel}.`}</p>
        )}
      </div>
    </section>
  );
}

function LastDecision({ a }: { a: Analysis }) {
  const r = a.requests[0]!;
  const d = r.decision;
  return (
    <section className="card p-5">
      <h2 className="text-md font-bold text-ink">Versão {r.version}: <span className={clsx(r.status === 'aprovada' ? 'text-[#15803D]' : r.status === 'reprovada' ? 'text-danger' : 'text-[#C2610C]')}>{STATUS[r.status].label}</span></h2>
      {d && <p className="mt-1 text-sm text-muted">por {d.by} ({d.level ? APPROVAL_LEVEL_LABELS[d.level as keyof typeof APPROVAL_LEVEL_LABELS] : '—'}) em {fmtDateTime(d.at)}</p>}
      {d?.comment && <p className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-text">{d.comment}</p>}
      {d?.approvedConditions && <p className="mt-2 text-sm text-text">Condições aprovadas: {fmtBRL(Number(d.approvedConditions.proposedMonthlyCents))}/mês, desconto {pct(Number(d.approvedConditions.discountBp))}{d.approvedConditions.termMonths ? `, ${String(d.approvedConditions.termMonths)} meses` : ''}.</p>}
      {d && d.materialChanges.length > 0 && <p className="mt-2 text-xs text-muted">Decidido ciente de: {d.materialChanges.join(' ')}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ pedido (com prévia ao vivo)

function RequestDialog({ a, onClose }: { a: Analysis; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const base = a.pending ?? a.requests[0] ?? null;
  const [f, setF] = useState({
    negotiationType: (base?.negotiationType ?? a.terms.negotiationType) as NegotiationType,
    proposed: dec(base?.proposedMonthlyCents ?? a.terms.proposedMonthlyCents ?? a.terms.listMonthlyCents),
    activation: dec(base?.activationFeeCents ?? a.terms.activationFeeCents),
    replaces: dec(base?.replacesMonthlyCents ?? 0),
    termMonths: base?.termMonths ? String(base.termMonths) : '',
    conditions: base?.conditions ?? '',
    justification: base?.status === 'correcao' ? '' : base?.justification ?? '',
    risks: base?.risks ?? '',
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const proposedCents = f.proposed.trim() ? toCents(f.proposed) : null;
  const activationCents = f.activation.trim() ? toCents(f.activation) : null;
  const replacesCents = f.replaces.trim() ? toCents(f.replaces) ?? 0 : 0;
  // prévia: recalcula alçada, desconto e margem com as condições digitadas
  const [params, setParams] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setParams(qs({ proposed: proposedCents ?? undefined, activation: activationCents ?? undefined, replaces: replacesCents, type: f.negotiationType })), 400);
    return () => clearTimeout(timer.current);
  }, [proposedCents, activationCents, replacesCents, f.negotiationType]);
  const preview = useQuery({ queryKey: ['approval', a.opportunity.id, 'preview', params], enabled: proposedCents !== null, queryFn: () => api<Analysis>(`/opportunities/${a.opportunity.id}/approval${params}`), placeholderData: keepPreviousData });
  const p = preview.data;
  const send = useMutation({
    mutationFn: () => api<{ version: number; notified: string[] }>(`/opportunities/${a.opportunity.id}/approval/requests`, { method: 'POST', body: { negotiationType: f.negotiationType, proposedMonthlyCents: proposedCents, activationFeeCents: activationCents, replacesMonthlyCents: replacesCents, termMonths: f.termMonths ? Number(f.termMonths) : null, conditions: f.conditions.trim() || null, justification: f.justification.trim(), risks: f.risks.trim() || null } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['approval', a.opportunity.id] }); qc.invalidateQueries({ queryKey: ['approvals'] }); toast({ tone: 'success', message: `Aprovação solicitada (v${r.version})` }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (proposedCents === null) return toast({ tone: 'error', message: 'Informe o valor mensal proposto (ex.: 1.500,00).' });
    if (f.justification.trim().length < 10) return toast({ tone: 'error', message: 'Explique a justificativa comercial.' });
    send.mutate();
  };
  return (
    <Modal open onClose={onClose} title={a.pending ? `Nova versão do pedido (substitui a v${a.pending.version})` : 'Solicitar aprovação'} size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="req-form" loading={send.isPending} icon={<Send className="h-4 w-4" />}>Enviar para aprovação</Button></>}>
      <form id="req-form" onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2" noValidate>
        <FormField label="Tipo de negociação" htmlFor="rq-type"><Select id="rq-type" value={f.negotiationType} onChange={(e) => set({ negotiationType: e.target.value as NegotiationType })}>{NEGOTIATION_TYPES.map((t) => <option key={t} value={t}>{NEGOTIATION_TYPE_LABELS[t]}</option>)}</Select></FormField>
        <FormField label="Valor mensal proposto (R$)" htmlFor="rq-val" required hint={a.terms.listMonthlyCents ? `Tabela do plano: ${fmtBRL(a.terms.listMonthlyCents)}` : undefined}><Input id="rq-val" inputMode="decimal" value={f.proposed} onChange={(e) => set({ proposed: e.target.value })} /></FormField>
        <FormField label="Taxa de ativação (R$)" htmlFor="rq-act"><Input id="rq-act" inputMode="decimal" value={f.activation} onChange={(e) => set({ activation: e.target.value })} /></FormField>
        {a.kind.kind === 'base' && <FormField label="Receita atual substituída (R$/mês)" htmlFor="rq-rep" hint="Upgrade, renovação ou troca: quanto da receita atual deixa de existir. 0 = serviço adicional."><Input id="rq-rep" inputMode="decimal" value={f.replaces} onChange={(e) => set({ replaces: e.target.value })} /></FormField>}
        <FormField label="Prazo (meses)" htmlFor="rq-term"><Input id="rq-term" inputMode="numeric" value={f.termMonths} onChange={(e) => set({ termMonths: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></FormField>
        <FormField label="Condições propostas" htmlFor="rq-cond" className="md:col-span-2"><Textarea id="rq-cond" value={f.conditions} onChange={(e) => set({ conditions: e.target.value })} placeholder="Ex.: isenção da ativação, 3 meses com 10% de desconto" /></FormField>
        <FormField label="Justificativa comercial" htmlFor="rq-just" required className="md:col-span-2"><Textarea id="rq-just" value={f.justification} onChange={(e) => set({ justification: e.target.value })} /></FormField>
        <FormField label="Riscos" htmlFor="rq-risk" className="md:col-span-2"><Textarea id="rq-risk" value={f.risks} onChange={(e) => set({ risks: e.target.value })} className="min-h-[64px]" /></FormField>
        <div className="rounded-md border border-line bg-surface-2 p-3 md:col-span-2" aria-live="polite">
          <p className="mb-1 text-xs font-bold text-muted">Prévia com estas condições {preview.isFetching && '· calculando…'}</p>
          {p ? (
            <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <div><dt className="text-2xs text-muted">Desconto</dt><dd className="num font-bold text-ink">{pct(p.margin.discount.bp)}</dd></div>
              <div><dt className="text-2xs text-muted">Alçada</dt><dd className={clsx('font-bold', p.policy.required.exceptional ? 'text-danger' : 'text-ink')}>{APPROVAL_LEVEL_LABELS[p.policy.required.level]}{p.policy.required.exceptional ? ' (excepcional)' : ''}</dd></div>
              <div><dt className="text-2xs text-muted">Receita incremental</dt><dd className="num font-bold text-ink">{p.margin.incremental.revenueCents === null ? '—' : `${fmtBRL(p.margin.incremental.revenueCents)}/mês`}</dd></div>
              <div><dt className="text-2xs text-muted">Margem depois</dt><dd className="num font-bold text-ink">{pct(p.margin.after.marginBp)}</dd></div>
            </dl>
          ) : <p className="text-sm text-muted">Informe o valor proposto.</p>}
          {p && p.margin.warnings.length > 0 && <p className="mt-1 text-xs text-[#9A4B00]">{p.margin.warnings.join(' ')}</p>}
        </div>
        <p className="text-xs text-muted md:col-span-2">O aviso por WhatsApp/e-mail leva só o resumo (cliente, oportunidade, responsável, tipo, valor, justificativa e o link). Os números completos ficam nesta página.</p>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ chat da negociação

function ChatPanel({ a }: { a: Analysis }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const chat = useQuery({ queryKey: ['approval', a.opportunity.id, 'chat'], queryFn: () => api<{ items: Analysis['chat'] }>(`/opportunities/${a.opportunity.id}/chat`), initialData: { items: a.chat }, refetchInterval: 20_000 });
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [chat.data.items.length]);
  const send = useMutation({
    mutationFn: () => api(`/opportunities/${a.opportunity.id}/chat`, { method: 'POST', body: { body: text } }),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['approval', a.opportunity.id, 'chat'] }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section className="card flex max-h-[640px] flex-col" aria-labelledby="chat-h">
      <h2 id="chat-h" className="flex items-center gap-2 px-5 pb-2 pt-4 text-md font-bold text-ink"><MessageSquare className="h-5 w-5 text-primary" aria-hidden />Chat da negociação</h2>
      <ol ref={listRef} className="scroll-thin min-h-[120px] flex-1 space-y-2 overflow-y-auto px-5 pb-3">
        {chat.data.items.length === 0 && <li className="text-sm text-muted">Converse com o time sobre esta negociação. Não vai para o cliente.</li>}
        {chat.data.items.map((m) => m.kind === 'sistema' ? (
          <li key={m.id} className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted"><span className="num">{fmtDateTime(m.createdAt)}</span> · {m.body}</li>
        ) : (
          <li key={m.id} className={clsx('max-w-[90%] rounded-lg px-3 py-2 text-sm', m.authorId === me?.user.id ? 'ml-auto bg-primary text-white' : 'bg-primary-soft text-ink')}>
            <p className={clsx('text-2xs font-semibold', m.authorId === me?.user.id ? 'text-white/80' : 'text-muted')}>{m.authorName} · {fmtDateTime(m.createdAt)}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ol>
      <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }}>
        <label htmlFor="chat-in" className="sr-only">Mensagem para o time</label>
        <Input id="chat-in" value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva para o time…" maxLength={2000} />
        <Button type="submit" variant="primary" aria-label="Enviar mensagem" loading={send.isPending} icon={<Send className="h-4 w-4" />} />
      </form>
    </section>
  );
}
