import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { LookupStage, Opportunity } from '../lib/types';
import { Button, FormField, Input, Select, Textarea } from '../components/ui/primitives';
import { Modal, useToast } from '../components/ui/overlay';

export type OppAction = 'pausar' | 'retomar' | 'reabrir';

/** Pausar, retomar ou reabrir uma negociação (reabrir pede motivo e a etapa de volta; sugere a etapa em que foi encerrada). */
export function OppActionDialog({ act, stages, onClose }: { act: { opp: Opportunity; kind: OppAction; column?: string }; stages: LookupStage[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { opp, kind } = act;
  const open = stages.filter((s) => s.kind === 'open');
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [stage, setStage] = useState(open.find((s) => s.key === act.column)?.key ?? open.at(-1)?.key ?? '');
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => kind === 'pausar' ? api(`/opportunities/${opp.id}/pause`, { method: 'POST', body: { reason: reason.trim(), until: until || null, rowVersion: opp.rowVersion } })
      : kind === 'retomar' ? api(`/opportunities/${opp.id}/resume`, { method: 'POST', body: { rowVersion: opp.rowVersion } })
      : api(`/opportunities/${opp.id}/transition`, { method: 'POST', body: { toStage: stage, reason: reason.trim(), rowVersion: opp.rowVersion } }),
    onSuccess: () => { for (const k of ['pipeline', 'opportunities', 'opportunity']) void qc.invalidateQueries({ queryKey: [k] }); toast({ tone: 'success', message: kind === 'pausar' ? 'Negociação pausada' : kind === 'retomar' ? 'Negociação retomada' : 'Negociação reaberta' }); onClose(); },
    onError: (e) => setErr(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : (e as Error).message),
  });
  const title = kind === 'pausar' ? 'Pausar negociação' : kind === 'retomar' ? 'Retomar negociação' : 'Reabrir negociação';
  const ready = kind === 'retomar' || (reason.trim().length >= 5 && (kind === 'pausar' || !!stage));
  return (
    <Modal open onClose={onClose} title={`${title} · ${opp.contactName}`} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ready} loading={m.isPending} onClick={() => { setErr(null); m.mutate(); }}>{title}</Button></>}>
      <div className="space-y-3">
        {err && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
        {kind === 'pausar' && <>
          <p className="text-sm text-muted">A negociação fica na etapa atual, marcada como pausada e fora da cobrança de próxima ação. Volta sozinha na data escolhida, ou quando alguém retomar.</p>
          <FormField label="Motivo da pausa" htmlFor="op-pr" required><Textarea id="op-pr" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: cliente pediu para retomar depois da aprovação do orçamento" /></FormField>
          <FormField label="Retomar em (opcional)" htmlFor="op-pu"><Input id="op-pu" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></FormField>
        </>}
        {kind === 'retomar' && <p className="text-sm text-text">A negociação volta a contar normalmente.{opp.pauseReason ? <> Motivo da pausa: <i>{opp.pauseReason}</i></> : null}</p>}
        {kind === 'reabrir' && <>
          <p className="text-sm text-muted">{opp.stage === 'ganha' ? 'A venda fechada volta a ser negociação em aberto.' : 'A negociação perdida volta a ficar em aberto.'} Reabrir exige permissão de supervisão e fica no histórico.</p>
          <FormField label="Voltar para a etapa" htmlFor="op-rs" required><Select id="op-rs" value={stage} onChange={(e) => setStage(e.target.value)}>{open.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</Select></FormField>
          <FormField label="Motivo da reabertura" htmlFor="op-rr" required><Textarea id="op-rr" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
        </>}
      </div>
    </Modal>
  );
}
