/** ABM: rótulos, cores e o botão "Adicionar ao ABM" usado na ficha da conta e na lista do ABM. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crosshair } from 'lucide-react';
import {
  ABM_ORIGIN_LABELS, ABM_PRIORITY_LABELS, ABM_STATUS_LABELS, ABM_TIER_LABELS, COMMERCIAL_STATUS_LABELS,
  type AbmOrigin, type AbmPriority, type AbmStatus, type AbmTier, type CommercialStatus,
} from '@isp/domain';
import { api } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, FormField, Select, Textarea, Input, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

export const ABM_STATUS_TONE: Record<AbmStatus, Tone> = { candidata: 'neutral', selecionada: 'sky', em_planejamento: 'sky', ativa: 'blue', em_acompanhamento: 'green', pausada: 'orange', encerrada: 'neutral' };
export const ABM_PRIORITY_TONE: Record<AbmPriority, Tone> = { critica: 'red', alta: 'orange', media: 'sky', baixa: 'neutral' };
export const COMMERCIAL_TONE: Record<CommercialStatus, Tone> = { identificada: 'neutral', prospeccao: 'sky', relacionamento: 'sky', oportunidade: 'blue', cliente_ativo: 'green', cliente_sem_contrato: 'orange', ex_cliente: 'neutral' };
export const StatusChip = ({ s }: { s: AbmStatus }) => <Chip tone={ABM_STATUS_TONE[s]}>{ABM_STATUS_LABELS[s]}</Chip>;
export const CommercialChip = ({ s }: { s: CommercialStatus }) => <Chip tone={COMMERCIAL_TONE[s]}>{COMMERCIAL_STATUS_LABELS[s]}</Chip>;
export const PriorityChip = ({ p }: { p: AbmPriority }) => <Chip tone={ABM_PRIORITY_TONE[p]}>Prioridade {ABM_PRIORITY_LABELS[p].toLowerCase()}</Chip>;

/** Campos do ABM comuns a "nova conta" e "adicionar existente". */
export type AbmForm = { tier: AbmTier; priority: AbmPriority; ownerId: string; origin: AbmOrigin | ''; reason: string; objective: string; nextStep: string; nextStepOn: string };
export const blankAbmForm = (origin: AbmOrigin | '' = ''): AbmForm => ({ tier: '1_muitos', priority: 'media', ownerId: '', origin, reason: '', objective: '', nextStep: '', nextStepOn: '' });
export const abmFormBody = (f: AbmForm, meId?: string) => ({ tier: f.tier, priority: f.priority, ownerId: f.ownerId || meId, origin: f.origin || null, reason: f.reason, objective: f.objective || null, nextStep: f.nextStep || null, nextStepOn: f.nextStepOn || null });

export function AbmFields({ f, set, idp }: { f: AbmForm; set: (f: AbmForm) => void; idp: string }) {
  const users = useLookups().data?.users ?? [];
  const { me } = useAuth();
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="Prioridade" htmlFor={`${idp}-p`}><Select id={`${idp}-p`} value={f.priority} onChange={(e) => set({ ...f, priority: e.target.value as AbmPriority })}>{(Object.keys(ABM_PRIORITY_LABELS) as AbmPriority[]).map((p) => <option key={p} value={p}>{ABM_PRIORITY_LABELS[p]}</option>)}</Select></FormField>
        <FormField label="Abordagem" htmlFor={`${idp}-t`}><Select id={`${idp}-t`} value={f.tier} onChange={(e) => set({ ...f, tier: e.target.value as AbmTier })}>{(Object.keys(ABM_TIER_LABELS) as AbmTier[]).map((t) => <option key={t} value={t}>{ABM_TIER_LABELS[t]}</option>)}</Select></FormField>
        <FormField label="Responsável" htmlFor={`${idp}-o`}><Select id={`${idp}-o`} value={f.ownerId || me?.user.id || ''} onChange={(e) => set({ ...f, ownerId: e.target.value })}>{users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Origem" htmlFor={`${idp}-or`}><Select id={`${idp}-or`} value={f.origin} onChange={(e) => set({ ...f, origin: e.target.value as AbmOrigin })}><option value="">Não informada</option>{(Object.keys(ABM_ORIGIN_LABELS) as AbmOrigin[]).map((o) => <option key={o} value={o}>{ABM_ORIGIN_LABELS[o]}</option>)}</Select></FormField>
        <FormField label="Objetivo principal" htmlFor={`${idp}-ob`} hint="Ex.: abrir relacionamento, identificar decisores"><Input id={`${idp}-ob`} value={f.objective} onChange={(e) => set({ ...f, objective: e.target.value })} /></FormField>
      </div>
      <FormField label="Motivo da seleção" htmlFor={`${idp}-r`} required><Textarea id={`${idp}-r`} rows={2} value={f.reason} onChange={(e) => set({ ...f, reason: e.target.value })} placeholder="Potencial, momento, encaixe com a oferta…" /></FormField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <FormField label="Próximo passo" htmlFor={`${idp}-n`}><Input id={`${idp}-n`} value={f.nextStep} onChange={(e) => set({ ...f, nextStep: e.target.value })} /></FormField>
        <FormField label="Até" htmlFor={`${idp}-d`}><Input id={`${idp}-d`} type="date" value={f.nextStepOn} onChange={(e) => set({ ...f, nextStepOn: e.target.value })} /></FormField>
      </div>
    </>
  );
}

/** Botão da ficha da conta: mostra a situação no ABM ou abre "Adicionar ao ABM" (mesmo cadastro; nada é duplicado). */
export function AddToAbmButton({ contactId, contactName }: { contactId: string; contactName: string }) {
  const { can, me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['abm', 'by-contact', contactId], enabled: can('clientes'), queryFn: () => api<{ abm: { id: string; status: AbmStatus } | null }>(`/abm/by-contact/${contactId}`) });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blankAbmForm('base_existente'));
  const m = useMutation({
    mutationFn: () => api('/abm', { method: 'POST', body: { contactId, status: 'candidata', ...abmFormBody(f, me?.user.id) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['abm'] }); setOpen(false); toast({ tone: 'success', message: 'Conta adicionada ao ABM' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (!can('clientes') || q.isLoading) return null;
  if (q.data?.abm) return <Link to={`/abm?id=${q.data.abm.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"><Crosshair className="h-4 w-4" aria-hidden />No ABM: {ABM_STATUS_LABELS[q.data.abm.status]}</Link>;
  return (
    <>
      <Button variant="secondary" icon={<Crosshair className="h-4 w-4" />} onClick={() => setOpen(true)}>Adicionar ao ABM</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Adicionar ao ABM" size="lg" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" disabled={f.reason.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()}>Adicionar</Button></>}>
        <div className="space-y-4">
          <p className="rounded-md bg-surface-2 px-3 py-2 text-sm">Conta: <b className="text-ink">{contactName}</b>. Oportunidades, contratos, atividades e histórico desta conta continuam os mesmos — o ABM só acrescenta a estratégia.</p>
          <AbmFields f={f} set={setF} idp="ata" />
        </div>
      </Modal>
    </>
  );
}
