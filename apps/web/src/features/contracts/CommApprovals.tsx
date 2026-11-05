/**
 * Gestão de Contratos → Comunicações: a fila de aprovação dos envios das esteiras (com o que vai sair, para quem e
 * por qual canal) e o histórico. Também a esteira de cada contrato, na ficha.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, XCircle } from 'lucide-react';
import { COMM_STEP_STATUS_LABELS, PLAYBOOK_ROLE_LABELS, type CommStepStatus, type PlaybookRole } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Button, EmptyState, ErrorState, FormField, LoadingRows, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from './shared';

type Preview = { subject: string; html: string; text: string; whatsapp: string; recipients: { name: string; email: string | null; phone: string | null; kind: string }[]; channels: string[]; templateVersion: number };
type Item = { id: string; status: CommStepStatus; label: string; dueOn: string; preview: Preview | null; approverRole: string | null; decidedAt: string | null; decisionNote: string | null; decidedByName: string | null; result: { report?: { name: string; channel: string; status: string }[]; error?: string } | null; flowName: string; contractId: string; anchorDate: string; code: number; client: string; canDecide: boolean; createdAt: string };

const KIND: Record<string, string> = { cliente: 'cliente', ator: 'ator externo', email: 'e-mail avulso' };
const kindLabel = (k: string) => (k.startsWith('papel:') ? PLAYBOOK_ROLE_LABELS[k.slice(6) as PlaybookRole] ?? k.slice(6) : k.startsWith('responsavel:') ? `resp. ${k.slice(12)}` : KIND[k] ?? k);

function Decide({ item, onClose }: { item: Item; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<'email' | 'whatsapp'>(item.preview?.channels.includes('email') ? 'email' : 'whatsapp');
  const m = useMutation({
    mutationFn: (approve: boolean) => api<{ status: string; report?: { status: string }[] }>(`/comm/steps/${item.id}/decision`, { method: 'POST', body: { approve, note: note.trim() || null } }),
    onSuccess: (r, approve) => { qc.invalidateQueries({ queryKey: ['comm-approvals'] }); toast({ tone: 'success', message: approve ? `Aprovado: ${r.report?.filter((x) => x.status === 'enviado').length ?? 0} de ${r.report?.length ?? 0} enviado(s)` : 'Não aprovado: a esteira deste contrato foi encerrada neste ciclo' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const p = item.preview!;
  return (
    <Modal open onClose={onClose} title={`Aprovar comunicação · CT-${item.code} · ${item.client}`} size="xl" footer={<>
      <Button onClick={onClose}>Fechar</Button>
      <Button variant="danger" icon={<XCircle className="h-4 w-4" />} disabled={note.trim().length < 5} loading={m.isPending && m.variables === false} onClick={() => m.mutate(false)}>Não aprovar</Button>
      <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />} loading={m.isPending && m.variables === true} onClick={() => m.mutate(true)}>Aprovar e enviar</Button>
    </>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {p.channels.length > 1 && <div className="mb-2 flex gap-2">{p.channels.map((c) => <Button key={c} size="sm" variant={tab === c ? 'primary' : 'secondary'} onClick={() => setTab(c as 'email' | 'whatsapp')}>{c === 'email' ? 'E-mail' : 'WhatsApp'}</Button>)}</div>}
          {tab === 'email' && <p className="mb-1 text-sm"><span className="text-muted">Assunto:</span> <strong className="text-ink">{p.subject}</strong></p>}
          {tab === 'email' ? <iframe title="E-mail que será enviado" className="h-[480px] w-full rounded-md border border-line bg-white" sandbox="" srcDoc={p.html} />
            : <div className="h-[480px] rounded-md border border-line bg-[#E5DDD5] p-4"><div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-white p-3 text-sm shadow-sm">{p.whatsapp}{'\n\n'}Confirme o recebimento: https://…</div></div>}
        </div>
        <aside className="space-y-3 text-sm">
          <div><p className="text-xs font-semibold text-muted">Esteira</p><p className="text-ink">{item.flowName} · {item.label}</p><p className="text-xs text-muted">Data do gatilho {fmtDate(item.anchorDate)} · template v{p.templateVersion}</p></div>
          <div><p className="text-xs font-semibold text-muted">Para quem ({p.recipients.length})</p>
            {!p.recipients.length ? <p className="text-danger">Ninguém encontrado com os destinatários do passo.</p> : <ul className="space-y-1">{p.recipients.map((r, i) => <li key={i}><span className="font-semibold text-ink">{r.name}</span> <span className="text-xs text-muted">· {kindLabel(r.kind)}</span><span className="block text-xs text-muted">{[p.channels.includes('email') ? r.email ?? 'sem e-mail' : null, p.channels.includes('whatsapp') ? r.phone ?? 'sem WhatsApp' : null].filter(Boolean).join(' · ')}</span></li>)}</ul>}
          </div>
          <FormField label="Observação" htmlFor="dc-note" hint="Obrigatória para não aprovar (fica no histórico do contrato)."><Textarea id="dc-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
        </aside>
      </div>
    </Modal>
  );
}

export function CommApprovals() {
  const q = useQuery({ queryKey: ['comm-approvals'], queryFn: () => api<{ pending: Item[]; history: Item[] }>('/comm/approvals') });
  const [open, setOpen] = useState<Item | null>(null);
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { pending, history } = q.data!;
  return (
    <div className="space-y-4">
      <section className="card p-5" aria-label="Aguardando aprovação">
        <h2 className="mb-1 text-base font-bold text-ink">Aguardando aprovação <span className="text-muted">({pending.length})</span></h2>
        <p className="mb-3 text-xs text-muted">Nada sai antes de aprovado. Não aprovar encerra a esteira daquele contrato no ciclo.</p>
        {!pending.length ? <EmptyState title="Nada para aprovar" description="As comunicações das esteiras aparecem aqui quando chega a data de cada envio." /> : (
          <ul className="divide-y divide-line">{pending.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><p className="font-semibold text-ink">{i.preview?.subject}</p>
                <p className="text-xs text-muted"><Link className="link" to={`/contracts/${i.contractId}`}>CT-{i.code} · {i.client}</Link> · {i.flowName} · {i.preview?.recipients.length ?? 0} destinatário(s) · {(i.preview?.channels ?? []).map((c) => (c === 'email' ? 'e-mail' : 'WhatsApp')).join(' + ')} · aprova: {i.approverRole ? PLAYBOOK_ROLE_LABELS[i.approverRole as PlaybookRole] : 'Contratos Total'}</p></div>
              {i.canDecide ? <Button variant="primary" onClick={() => setOpen(i)}>Revisar e decidir</Button> : <span className="text-xs text-muted">Aguardando quem aprova</span>}
            </li>
          ))}</ul>
        )}
      </section>
      <section className="card p-5" aria-label="Histórico">
        <h2 className="mb-3 text-base font-bold text-ink">Histórico</h2>
        {!history.length ? <p className="text-sm text-muted">Nenhuma comunicação decidida ainda.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-2 pr-3 font-medium">Comunicação</th><th className="py-2 pr-3 font-medium">Contrato</th><th className="py-2 pr-3 font-medium">Situação</th><th className="py-2 pr-3 font-medium">Decidido</th></tr></thead>
            <tbody>{history.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="py-2 pr-3"><span className="font-semibold text-ink">{i.preview?.subject ?? i.label}</span><span className="block text-xs text-muted">{i.flowName}</span></td>
                <td className="py-2 pr-3 text-xs"><Link className="link" to={`/contracts/${i.contractId}`}>CT-{i.code} · {i.client}</Link></td>
                <td className={clsx('py-2 pr-3 text-xs font-semibold', i.status === 'enviado' ? 'text-success' : 'text-danger')}>{COMM_STEP_STATUS_LABELS[i.status]}{i.result?.report && <span className="block font-normal text-muted">{i.result.report.filter((r) => r.status === 'enviado').length} de {i.result.report.length} entregue(s) ao provedor</span>}{i.result?.error && <span className="block font-normal text-muted">{i.result.error}</span>}</td>
                <td className="py-2 pr-3 text-xs">{i.decidedByName ?? '—'}<span className="block text-muted">{fmtDateTime(i.decidedAt)}{i.decisionNote ? ` · “${i.decisionNote}”` : ''}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {open && <Decide item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

type Run = { id: string; flowName: string; anchorDate: string; status: string; startedAt: string; steps: { id: string; label: string; nodeType: string; status: CommStepStatus; dueOn: string; doneAt: string | null; notices: { recipientName: string; channel: string; status: string; confirmedAt: string | null; responseText: string | null; openedAt: string | null; openCount: number }[] }[] };
const STEP_TONE: Record<CommStepStatus, string> = { agendado: 'text-muted', aguardando_aprovacao: 'text-[#C2610C]', enviado: 'text-success', concluido: 'text-success', rejeitado: 'text-danger', falhou: 'text-danger', cancelado: 'text-muted' };

/** Ficha do contrato: as esteiras dele, passo a passo, com confirmação e resposta de cada destinatário. */
export function ContractCommRuns({ contractId }: { contractId: string }) {
  const q = useQuery({ queryKey: ['contract-comm', contractId], queryFn: () => api<{ items: Run[] }>(`/contracts/${contractId}/comm`) });
  if (q.isLoading) return <LoadingRows rows={3} />;
  const items = q.data?.items ?? [];
  if (!items.length) return null;
  return (
    <section className="space-y-3" aria-label="Esteiras de comunicação">
      <h2 className="font-bold text-ink">Esteiras de comunicação</h2>
      {items.map((r) => (
        <div key={r.id} className="rounded-md border border-line p-3">
          <p className="text-sm font-semibold text-ink">{r.flowName} <span className="font-normal text-muted">· ciclo de {fmtDate(r.anchorDate)} · {r.status === 'ativo' ? 'em andamento' : r.status === 'concluido' ? 'concluída' : 'encerrada'}</span></p>
          <ol className="mt-2 space-y-1.5 border-l border-line pl-4">{r.steps.map((s) => (
            <li key={s.id} className="text-sm">
              <span className="text-ink">{s.label}</span> <span className={clsx('text-xs font-semibold', STEP_TONE[s.status])}>· {COMM_STEP_STATUS_LABELS[s.status]}</span> <span className="text-xs text-muted">· {s.doneAt ? fmtDateTime(s.doneAt) : `previsto ${fmtDate(s.dueOn)}`}</span>
              {s.notices.length > 0 && <ul className="mt-0.5 text-xs text-muted">{s.notices.map((n, i) => <li key={i}>{n.recipientName} ({n.channel === 'email' ? 'e-mail' : 'WhatsApp'}): {n.openedAt ? <span className="text-success">abriu {fmtDateTime(n.openedAt)}{n.openCount > 1 ? ` (${n.openCount}×)` : ''}</span> : n.confirmedAt ? <span className="text-success">leu {fmtDateTime(n.confirmedAt)}</span> : n.status === 'enviado' ? 'enviado, ainda não aberto' : n.status}{n.responseText ? ` · respondeu: “${n.responseText}”` : ''}</li>)}</ul>}
            </li>
          ))}</ol>
        </div>
      ))}
    </section>
  );
}
