/**
 * Classificação estratégica da conta (decisão de 05/11/2026): só a Classe estratégica (tag qualitativa) e o Score IPC.
 * - Classe estratégica: Reputação, Potencial, Expansão ou Aposta Estratégica. Não entra no IPC; definida pela liderança
 *   Comercial e pela Diretoria, com revisão trimestral (ou em evento relevante). Histórico append-only.
 * - IPC: soma dos 7 critérios (20 a 100). Tamanho (ACV do grupo) e tempo de relacionamento são calculados; os demais
 *   são avaliados pela equipe (Sucesso do Cliente → Avaliar IPC).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CLASSIFICATION_DIMENSIONS, DEFAULT_CS_CONFIG, IPC_CRITERIA, IPC_LABELS, IPC_LEVEL_TEXT, daysBetween, type IpcCriterion } from '@isp/domain';
import { api } from '../lib/api';
import { fmtBRL, fmtDate } from '../lib/format';
import { useAuth } from '../auth/AuthProvider';
import { Button, FormField, Select, Textarea } from '../components/ui/primitives';
import { useToast } from '../components/ui/overlay';
import { errMsg } from './contracts/shared';
import type { Classification } from './approval/types';
import { IpcDialog } from './cs/Account360';
import type { Snapshot } from './cs/shared';

type R = { current: Classification | null; history: Classification[]; options: Record<string, string[]> };
const IPC_HINT: Record<IpcCriterion, string> = {
  tamanho: 'ACV anual consolidado do grupo: até R$ 120 mil Small (10), até R$ 500 mil Middle (20), acima Large (30).',
  potencial: 'Espaço real de crescimento: novos contratos, unidades, upgrades, cross-sell (10, 15 ou 20).',
  segmento: 'Aderência do segmento ao foco estratégico e ao IPC da BK (0, 5 ou 10).',
  criticidade: 'Quão crítico é o serviço da BK para a operação do cliente (0, 5 ou 10).',
  tempo: 'Histórico formal: menos de 6 meses (0), 6 a 24 meses (5), mais de 2 anos (10).',
  relacionamento: 'Acesso a decisores e influenciadores e abertura do cliente (0, 5 ou 10).',
  maturidade: 'Governança, orçamento e capacidade de contratação (0, 5 ou 10).',
};

export function ClassificationSection({ contactId }: { contactId: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['classification', contactId], queryFn: () => api<R>(`/contacts/${contactId}/classification`) });
  const cs = useQuery({ queryKey: ['cs-account', contactId], enabled: can('clientes'), retry: false, queryFn: () => api<{ snapshot: Snapshot; canEdit: boolean }>(`/cs/accounts/${contactId}`) });
  const [edit, setEdit] = useState<{ classKey: string; notes: string } | null>(null);
  const [ipcOpen, setIpcOpen] = useState(false);
  const canEdit = can('clientes', 'equipe');
  const c = q.data?.current ?? null;
  const save = useMutation({
    // só a classe e as observações mudam; as demais dimensões antigas ficam como estavam no histórico
    mutationFn: () => api(`/contacts/${contactId}/classification`, { method: 'POST', body: { ...Object.fromEntries(CLASSIFICATION_DIMENSIONS.map((k) => [k, c?.[k] ?? null])), classKey: edit!.classKey || null, notes: edit!.notes.trim() || null } }),
    onSuccess: () => { setEdit(null); qc.invalidateQueries({ queryKey: ['classification', contactId] }); qc.invalidateQueries({ queryKey: ['cs-account', contactId] }); toast({ tone: 'success', message: 'Classe estratégica registrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const ask = useMutation({
    mutationFn: () => api(`/contacts/${contactId}/classification/request-update`, { method: 'POST', body: {} }),
    onSuccess: () => toast({ tone: 'success', message: 'Tarefa de atualização criada' }),
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (!q.data) return null;
  const today = new Date().toISOString().slice(0, 10);
  const stale = c?.classifiedAt ? daysBetween(c.classifiedAt.slice(0, 10), today) > 90 : false;
  const sn = cs.data?.snapshot;
  const pts = (k: IpcCriterion) => { const l = sn?.ipc.levels[k]; return l ? DEFAULT_CS_CONFIG.ipcPoints[k][l] : null; };
  return (
    <section className="mt-6 border-t border-line pt-5" aria-labelledby="cls-h">
      <h2 id="cls-h" className="mb-3 font-bold text-ink">Classificação estratégica</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="rounded-md border border-line p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Classe estratégica</p>
            {canEdit && !edit && <Button size="sm" onClick={() => setEdit({ classKey: c?.classKey ?? '', notes: c?.notes ?? '' })}>{c?.classKey ? 'Revisar' : 'Classificar'}</Button>}
            {!canEdit && <Button size="sm" variant="ghost" loading={ask.isPending} onClick={() => ask.mutate()}>Pedir atualização</Button>}
          </div>
          {edit ? (
            <div className="space-y-3">
              <FormField label="Classe estratégica" htmlFor="cls-classKey">
                <Select id="cls-classKey" value={edit.classKey} onChange={(e) => setEdit({ ...edit, classKey: e.target.value })}>
                  <option value="">Não classificada</option>
                  {(q.data.options.classKey ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  {edit.classKey && !(q.data.options.classKey ?? []).includes(edit.classKey) && <option value={edit.classKey}>{edit.classKey} (fora da lista)</option>}
                </Select>
              </FormField>
              <FormField label="Motivo / observações" htmlFor="cls-notes"><Textarea id="cls-notes" rows={3} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></FormField>
              <div className="flex gap-2"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button><Button onClick={() => setEdit(null)}>Cancelar</Button></div>
            </div>
          ) : (
            <>
              <p className={clsx('text-2xl font-extrabold', c?.classKey ? 'text-ink' : 'text-muted')}>{c?.classKey ?? 'Não classificada'}</p>
              {c?.notes && <p className="mt-1 text-sm text-text">{c.notes}</p>}
              {c?.classifiedAt && <p className={clsx('mt-2 text-xs', stale ? 'font-semibold text-[#C2610C]' : 'text-muted')}>Revisada em {fmtDate(c.classifiedAt)} por {c.classifiedBy ?? '—'}.{stale ? ' Passou da revisão trimestral.' : ''}</p>}
            </>
          )}
          <p className="mt-3 text-xs text-muted">Tag qualitativa (não entra no IPC). Definida pela liderança Comercial e pela Diretoria, com revisão trimestral ou em evento relevante.</p>
        </div>

        <div className="rounded-md border border-line p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Score IPC do cliente</p>
            {cs.data?.canEdit && sn && <Button size="sm" onClick={() => setIpcOpen(true)}>Avaliar IPC</Button>}
          </div>
          {!sn ? <p className="text-sm text-muted">{cs.isLoading ? 'Carregando…' : 'Sem acesso ao Score IPC desta conta.'}</p> : (
            <>
              <p className="flex items-baseline gap-2"><span className="num text-3xl font-extrabold text-ink">{sn.ipc.total ?? sn.ipc.partial}</span><span className="text-sm text-muted">/ 100{sn.ipc.total === null ? ` · incompleto (${sn.ipc.pending.length} critério(s) pendente(s))` : ''}</span></p>
              <span className="mt-1 block h-2 rounded-full bg-surface-2" aria-hidden><span className="block h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, sn.ipc.total ?? sn.ipc.partial)}%` }} /></span>
              <ul className="mt-3 divide-y divide-line text-sm">
                {IPC_CRITERIA.map((k) => {
                  const l = sn.ipc.levels[k];
                  const p = pts(k);
                  return (
                    <li key={k} className="grid grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-3 py-1.5" title={IPC_HINT[k]}>
                      <span className="min-w-0"><span className="text-ink">{IPC_LABELS[k]}</span>{sn.ipc.auto.includes(k) && <span className="ml-1 text-xs text-muted">· calculado</span>}<span className="block truncate text-xs text-muted">{IPC_HINT[k]}</span></span>
                      <span className={l ? 'font-semibold text-ink' : 'text-xs text-muted'}>{l ? IPC_LEVEL_TEXT[k][l] : 'Pendente'}</span>
                      <span className="num text-right font-semibold">{p ?? '—'}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-muted">ACV anual consolidado do grupo: {fmtBRL(sn.groupAcvCents)}{sn.ipc.assessedAt ? ` · última avaliação ${fmtDate(sn.ipc.assessedAt)}` : ' · ainda não avaliado'}{sn.ipc.reviewDue ? ' · revisão pendente' : ''}.</p>
            </>
          )}
        </div>
      </div>
      {ipcOpen && sn && <IpcDialog contactId={contactId} sn={sn} open onClose={() => { setIpcOpen(false); void qc.invalidateQueries({ queryKey: ['cs-account', contactId] }); }} />}
    </section>
  );
}
