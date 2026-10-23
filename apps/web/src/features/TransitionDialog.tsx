import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, Paperclip } from 'lucide-react';
import { LOSS_REASONS, LOSS_REASON_LABELS, type LossReason } from '@isp/domain';
import { api } from '../lib/api';
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, fileToBase64 } from '../lib/files';
import type { Opportunity, StageRequirements } from '../lib/types';
import { ConfirmDialog, useToast } from '../components/ui/overlay';
import { Button, FormField, Notice, Select, Textarea } from '../components/ui/primitives';

export type TransitionRequest = {
  opp: Opportunity;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  toKind: 'open' | 'won' | 'lost';
  requirements: StageRequirements;
  title: string;
};
export type TransitionPayload = { toStage: string; reason?: string | null; lossReason?: LossReason | null; confirm?: boolean };

export const isClosed = (stage: string) => stage === 'ganha' || stage === 'perdida';

/** Exigências que o navegador consegue conferir; as perguntas obrigatórias o servidor confere. */
export function unmetRequirements(opp: Opportunity, req: StageRequirements, toKind: 'open' | 'won' | 'lost') {
  if (toKind === 'lost') return [];
  const out: { key: keyof StageRequirements; label: string }[] = [];
  if (req.plano && !opp.planId && !(opp.valueCents && opp.valueCents > 0)) out.push({ key: 'plano', label: 'Definir o valor (plano ou itens)' });
  if (req.proximaAcao && (!opp.nextAction || !opp.nextActionAt)) out.push({ key: 'proximaAcao', label: 'Definir a próxima ação e quando' });
  if (req.proposta && !opp.proposalCount) out.push({ key: 'proposta', label: 'Anexar a proposta' });
  return out;
}

/** Abre diálogo para venda fechada, perda, reabertura e etapas com exigência ainda não cumprida. */
export const needsDialog = (r: Pick<TransitionRequest, 'opp' | 'from' | 'to' | 'toKind' | 'requirements'>) =>
  r.toKind !== 'open' || isClosed(r.from) || unmetRequirements(r.opp, r.requirements, r.toKind).length > 0;

export function TransitionDialog({ request, onCancel, onConfirm, loading }: { request: TransitionRequest | null; onCancel: () => void; onConfirm: (p: TransitionPayload) => void; loading?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState('');
  const [loss, setLoss] = useState<LossReason | ''>('');
  const [uploaded, setUploaded] = useState(0);
  const [uploading, setUploading] = useState(false);
  useEffect(() => { setReason(''); setLoss(''); setUploaded(0); }, [request]);
  if (!request) return null;
  const { from, to, opp } = request;
  const reopening = isClosed(from);
  const unmet = unmetRequirements({ ...opp, proposalCount: opp.proposalCount + uploaded }, request.requirements, request.toKind);
  const title = reopening ? 'Reabrir oportunidade' : to === 'ganha' ? 'Marcar venda fechada' : to === 'perdida' ? 'Marcar como perdida' : `Mover para ${request.toName}`;

  const upload = async (f: File) => {
    if (f.size > MAX_ATTACHMENT_BYTES) return toast({ tone: 'error', message: 'O arquivo passa de 3 MB.' });
    setUploading(true);
    try {
      await api(`/opportunities/${opp.id}/attachments`, { method: 'POST', body: { kind: 'proposta', filename: f.name, data: await fileToBase64(f) } });
      setUploaded((n) => n + 1);
      qc.invalidateQueries({ queryKey: ['attachments', opp.id] });
      qc.invalidateQueries({ queryKey: ['opportunity', opp.id] });
      toast({ tone: 'success', message: 'Proposta anexada' });
    } catch (e) {
      toast({ tone: 'error', message: (e as Error).message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <ConfirmDialog
      open
      title={title}
      tone={to === 'perdida' ? 'danger' : 'primary'}
      confirmLabel={reopening ? 'Reabrir' : to === 'ganha' ? 'Marcar venda fechada' : to === 'perdida' ? 'Marcar como perdida' : 'Mover'}
      loading={loading}
      confirmDisabled={(to === 'perdida' && !loss) || (reopening && !reason.trim()) || unmet.length > 0}
      onCancel={onCancel}
      onConfirm={() => onConfirm({ toStage: to, confirm: true, reason: reason.trim() || null, lossReason: to === 'perdida' ? (loss as LossReason) : null })}
    >
      <p><strong>{request.title}</strong>: {request.fromName} → {request.toName}</p>
      {to === 'ganha' && <Notice tone="warning">Venda fechada é ganho comercial. O contrato só conta como confirmado após validação no IXC.</Notice>}
      {(request.requirements.proposta || request.requirements.plano || request.requirements.proximaAcao || request.requirements.respostasObrigatorias) && request.toKind !== 'lost' && (
        <div className="rounded-md border border-line p-3">
          <p className="mb-2 text-sm font-semibold text-ink">Para entrar em “{request.toName}”</p>
          <ul className="space-y-1.5 text-sm">
            {request.requirements.plano && <Req ok={!unmet.some((u) => u.key === 'plano')}>Valor definido (plano ou itens)</Req>}
            {request.requirements.proximaAcao && <Req ok={!unmet.some((u) => u.key === 'proximaAcao')}>Próxima ação com data</Req>}
            {request.requirements.respostasObrigatorias && <Req ok>Perguntas obrigatórias respondidas <span className="text-xs text-muted">(conferido ao salvar)</span></Req>}
            {request.requirements.proposta && (
              <Req ok={!unmet.some((u) => u.key === 'proposta')}>
                Proposta anexada
                {unmet.some((u) => u.key === 'proposta') && (
                  <>
                    <Button size="sm" className="ml-2" icon={<Paperclip className="h-4 w-4" />} loading={uploading} onClick={() => file.current?.click()}>Anexar agora</Button>
                    <input ref={file} type="file" className="hidden" accept={ATTACHMENT_ACCEPT} aria-label="Arquivo da proposta" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
                  </>
                )}
              </Req>
            )}
          </ul>
          {unmet.some((u) => u.key !== 'proposta') && <p className="mt-2 text-xs text-muted">Complete os itens na <Link className="link" to={`/opportunities/${opp.id}`} onClick={onCancel}>oportunidade</Link> e tente de novo.</p>}
        </div>
      )}
      {to === 'perdida' && (
        <FormField label="Motivo da perda" htmlFor="td-loss" required>
          <Select id="td-loss" value={loss} onChange={(e) => setLoss(e.target.value as LossReason)} data-autofocus>
            <option value="">Selecione</option>
            {LOSS_REASONS.map((r) => <option key={r} value={r}>{LOSS_REASON_LABELS[r]}</option>)}
          </Select>
        </FormField>
      )}
      <FormField label={reopening ? 'Por que reabrir?' : 'Observação (opcional)'} htmlFor="td-reason" required={reopening}>
        <Textarea id="td-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[64px]" />
      </FormField>
    </ConfirmDialog>
  );
}

function Req({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      {ok ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="Cumprido" /> : <CircleAlert className="h-4 w-4 text-warning" aria-label="Pendente" />}
      <span className={ok ? 'text-text' : 'font-semibold text-ink'}>{children}</span>
    </li>
  );
}
