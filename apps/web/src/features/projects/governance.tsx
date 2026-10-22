/** Projeto: riscos (probabilidade × impacto), impedimentos (mesmo registro dos rituais) e homologação de marcos. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  IMPEDIMENT_SEVERITY_LABELS, IMPEDIMENT_STATUS_LABELS, RISK_IMPACTS, RISK_IMPACT_LABELS, RISK_LEVEL_LABELS, RISK_PROBABILITIES, RISK_PROBABILITY_LABELS, RISK_STATUSES, RISK_STATUS_LABELS, riskLevel,
  type FrontSummary, type ImpedimentStatus, type RiskImpact, type RiskLevel, type RiskProbability, type RiskStatus,
} from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Risk = { id: string; title: string; description: string | null; probability: RiskProbability; impact: RiskImpact; level: RiskLevel; mitigation: string | null; status: RiskStatus; ownerId: string; ownerName: string | null; reviewOn: string | null; rowVersion: number; canEdit: boolean };
type Imp = { id: string; title: string; description: string | null; severity: 'alta' | 'media' | 'baixa'; status: ImpedimentStatus; ownerId: string; ownerName: string | null; dueOn: string | null; milestoneName: string | null; resolution: string | null; overdue: boolean; rowVersion: number; canEdit: boolean };
type Hom = { id: string; milestoneId: string; milestoneName: string; decision: 'homologado' | 'reprovado'; note: string; actorName: string | null; createdAt: string };
export type Governance = { can: { manage: boolean; work: boolean; homologate: boolean }; summary: FrontSummary; risks: Risk[]; impediments: Imp[]; homologations: Hom[] };

export const LEVEL_TONE = { baixo: 'neutral', moderado: 'yellow', alto: 'orange', critico: 'red' } as const;
const SEV_TONE = { alta: 'red', media: 'yellow', baixa: 'neutral' } as const;
const OPEN_IMP: ImpedimentStatus[] = ['aberto', 'em_tratamento'];

export function useGovernance(id: string) {
  return useQuery({ queryKey: ['project', id, 'governance'], queryFn: () => api<Governance>(`/projects/${id}/governance`) });
}
function useRefreshGov(id: string) {
  const qc = useQueryClient();
  return () => { void qc.invalidateQueries({ queryKey: ['project', id] }); void qc.invalidateQueries({ queryKey: ['projects'] }); void qc.invalidateQueries({ queryKey: ['impediments'] }); };
}

/** Diálogo para homologar ou reprovar um marco concluído. */
export function HomologationDialog({ projectId, milestone, criteria, onClose }: { projectId: string; milestone: { id: string; name: string } | null; criteria: string | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshGov(projectId);
  const [note, setNote] = useState('');
  const mut = useMutation({
    mutationFn: (decision: 'homologado' | 'reprovado') => api(`/projects/${projectId}/milestones/${milestone!.id}/homologation`, { method: 'POST', body: { decision, note } }),
    onSuccess: (_r, d) => { refresh(); toast({ tone: 'success', message: d === 'homologado' ? 'Marco homologado' : 'Marco reprovado e reaberto' }); setNote(''); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const ok = note.trim().length >= 10;
  return (
    <Modal open={!!milestone} onClose={onClose} title={`Homologar “${milestone?.name ?? ''}”`}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" disabled={!ok} loading={mut.isPending && mut.variables === 'reprovado'} onClick={() => mut.mutate('reprovado')}>Reprovar e reabrir</Button>
        <Button variant="primary" disabled={!ok} loading={mut.isPending && mut.variables === 'homologado'} onClick={() => mut.mutate('homologado')}>Homologar</Button>
      </>}>
      <div className="space-y-4">
        {criteria && <div className="rounded-md bg-surface-2 p-3 text-sm"><p className="font-semibold text-ink">Critério de aceite</p><p className="mt-1 whitespace-pre-line">{criteria}</p></div>}
        <FormField label="O que foi conferido" htmlFor="hom-note" required hint="Fica no histórico de homologação, que não pode ser alterado. Mínimo de 10 caracteres.">
          <Textarea id="hom-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
        <p className="text-xs text-muted">Quem executou o trabalho do marco não pode homologá-lo. Reprovar reabre o marco para ajustes.</p>
      </div>
    </Modal>
  );
}

export function RisksAndImpediments({ projectId }: { projectId: string }) {
  const g = useGovernance(projectId);
  if (g.isLoading) return <LoadingRows rows={4} />;
  if (g.isError || !g.data) return <ErrorState error={g.error} onRetry={() => g.refetch()} />;
  return (
    <div className="space-y-4">
      <Risks projectId={projectId} g={g.data} />
      <Impediments projectId={projectId} g={g.data} />
      <section className="card overflow-hidden" aria-label="Histórico de homologação">
        <div className="p-4"><h2 className="text-lg font-bold text-ink">Histórico de homologação</h2><p className="text-sm text-muted">Cada aceite ou reprovação de marco, com quem decidiu e o que foi conferido.</p></div>
        {!g.data.homologations.length ? <div className="border-t border-line"><EmptyState title="Nenhuma homologação ainda" /></div> : (
          <ul className="divide-y divide-line border-t border-line">
            {g.data.homologations.map((h) => (
              <li key={h.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                <Chip tone={h.decision === 'homologado' ? 'green' : 'red'}>{h.decision === 'homologado' ? 'Homologado' : 'Reprovado'}</Chip>
                <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{h.milestoneName}</p><p className="whitespace-pre-line">{h.note}</p></div>
                <span className="num text-xs text-muted">{h.actorName} · {fmtDateTime(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Risks({ projectId, g }: { projectId: string; g: Governance }) {
  const toast = useToast();
  const refresh = useRefreshGov(projectId);
  const { me } = useAuth();
  const users = useLookups().data?.users ?? [];
  const blank = { title: '', description: '', probability: 'media' as RiskProbability, impact: 'medio' as RiskImpact, mitigation: '', ownerId: me?.user.id ?? '', reviewOn: '', status: 'aberto' as RiskStatus, note: '' };
  const [edit, setEdit] = useState<Risk | 'new' | null>(null);
  const [f, setF] = useState(blank);
  const openEdit = (r: Risk | 'new') => { setEdit(r); setF(r === 'new' ? blank : { title: r.title, description: r.description ?? '', probability: r.probability, impact: r.impact, mitigation: r.mitigation ?? '', ownerId: r.ownerId, reviewOn: r.reviewOn ?? '', status: r.status, note: '' }); };
  const mut = useMutation({
    mutationFn: () => {
      const body = { title: f.title, description: f.description || null, probability: f.probability, impact: f.impact, mitigation: f.mitigation || null, ownerId: f.ownerId, reviewOn: f.reviewOn || null };
      return edit === 'new' ? api(`/projects/${projectId}/risks`, { method: 'POST', body }) : api(`/projects/${projectId}/risks/${(edit as Risk).id}`, { method: 'PATCH', body: { ...body, rowVersion: (edit as Risk).rowVersion, status: f.status, note: f.note || undefined } });
    },
    onSuccess: () => { refresh(); setEdit(null); toast({ tone: 'success', message: 'Risco salvo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const lvl = riskLevel(f.probability, f.impact);
  const needsMitigation = (lvl === 'alto' || lvl === 'critico') && f.mitigation.trim().length < 10;
  const closing = edit !== 'new' && edit && f.status !== edit.status && f.status === 'encerrado';
  return (
    <section className="card overflow-hidden" aria-label="Riscos">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><h2 className="text-lg font-bold text-ink">Riscos</h2><p className="text-sm text-muted">O que pode atrasar ou comprometer a frente. Risco alto ou crítico precisa de plano de mitigação.</p></div>
        {g.can.work && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openEdit('new')}>Novo risco</Button>}
      </div>
      {!g.risks.length ? <div className="border-t border-line"><EmptyState title="Nenhum risco registrado" /></div> : (
        <ul className="divide-y divide-line border-t border-line">
          {g.risks.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
              <Chip tone={r.status === 'encerrado' ? 'neutral' : LEVEL_TONE[r.level]}>{RISK_LEVEL_LABELS[r.level]}</Chip>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{r.title}</p>
                <p className="text-xs text-muted">Probabilidade {RISK_PROBABILITY_LABELS[r.probability].toLowerCase()}, impacto {RISK_IMPACT_LABELS[r.impact].toLowerCase()} · {r.ownerName}{r.reviewOn ? ` · revisar em ${fmtDate(r.reviewOn)}` : ''}</p>
                {r.mitigation && <p className="mt-1"><span className="font-semibold text-ink">Mitigação:</span> {r.mitigation}</p>}
              </div>
              <Chip tone={r.status === 'ocorrido' ? 'red' : r.status === 'encerrado' ? 'green' : 'neutral'}>{RISK_STATUS_LABELS[r.status]}</Chip>
              {r.canEdit && <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>Editar</Button>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Novo risco' : 'Editar risco'}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" disabled={f.title.trim().length < 5 || needsMitigation || (!!closing && f.note.trim().length < 5)} loading={mut.isPending} onClick={() => mut.mutate()}>Salvar risco</Button></>}>
        <div className="space-y-4">
          <FormField label="Risco" htmlFor="rk-title" required><Input id="rk-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Probabilidade" htmlFor="rk-p"><Select id="rk-p" value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value as RiskProbability })}>{RISK_PROBABILITIES.map((k) => <option key={k} value={k}>{RISK_PROBABILITY_LABELS[k]}</option>)}</Select></FormField>
            <FormField label="Impacto" htmlFor="rk-i"><Select id="rk-i" value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value as RiskImpact })}>{RISK_IMPACTS.map((k) => <option key={k} value={k}>{RISK_IMPACT_LABELS[k]}</option>)}</Select></FormField>
            <div><p className="mb-1.5 text-sm font-medium text-ink">Nível</p><Chip tone={LEVEL_TONE[lvl]}>{RISK_LEVEL_LABELS[lvl]}</Chip></div>
          </div>
          <FormField label="Plano de mitigação" htmlFor="rk-mit" required={lvl === 'alto' || lvl === 'critico'} error={needsMitigation && f.mitigation ? 'Descreva a mitigação (mínimo de 10 caracteres).' : undefined}><Textarea id="rk-mit" rows={2} value={f.mitigation} onChange={(e) => setF({ ...f, mitigation: e.target.value })} /></FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Responsável" htmlFor="rk-own"><Select id="rk-own" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
            <FormField label="Revisar em" htmlFor="rk-rev"><Input id="rk-rev" type="date" value={f.reviewOn} onChange={(e) => setF({ ...f, reviewOn: e.target.value })} /></FormField>
          </div>
          {edit !== 'new' && (
            <>
              <FormField label="Situação" htmlFor="rk-st"><Select id="rk-st" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as RiskStatus })}>{RISK_STATUSES.map((k) => <option key={k} value={k}>{RISK_STATUS_LABELS[k]}</option>)}</Select></FormField>
              {closing && <FormField label="Por que encerrar" htmlFor="rk-note" required><Textarea id="rk-note" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></FormField>}
            </>
          )}
        </div>
      </Modal>
    </section>
  );
}

function Impediments({ projectId, g }: { projectId: string; g: Governance }) {
  const toast = useToast();
  const refresh = useRefreshGov(projectId);
  const { me } = useAuth();
  const users = useLookups().data?.users ?? [];
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ title: '', severity: 'media' as Imp['severity'], ownerId: me?.user.id ?? '', dueOn: '' });
  const [closing, setClosing] = useState<{ imp: Imp; to: ImpedimentStatus } | null>(null);
  const [resolution, setResolution] = useState('');
  const create = useMutation({
    mutationFn: () => api(`/projects/${projectId}/impediments`, { method: 'POST', body: { title: f.title, severity: f.severity, ownerId: f.ownerId, dueOn: f.dueOn || null } }),
    onSuccess: () => { refresh(); setCreating(false); setF({ ...f, title: '', dueOn: '' }); toast({ tone: 'success', message: 'Impedimento registrado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const move = useMutation({
    mutationFn: ({ imp, to, res }: { imp: Imp; to: ImpedimentStatus; res?: string }) => api(`/projects/${projectId}/impediments/${imp.id}`, { method: 'PATCH', body: { rowVersion: imp.rowVersion, status: to, resolution: res } }),
    onSuccess: () => { refresh(); setClosing(null); setResolution(''); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section className="card overflow-hidden" aria-label="Impedimentos">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><h2 className="text-lg font-bold text-ink">Impedimentos</h2><p className="text-sm text-muted">O que está travando agora. É o mesmo registro de Gestão de Times, então aparece também nos rituais.</p></div>
        {g.can.work && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Novo impedimento</Button>}
      </div>
      {!g.impediments.length ? <div className="border-t border-line"><EmptyState title="Nenhum impedimento" /></div> : (
        <ul className="divide-y divide-line border-t border-line">
          {g.impediments.map((i) => {
            const open = OPEN_IMP.includes(i.status);
            return (
              <li key={i.id} className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
                <Chip tone={open ? SEV_TONE[i.severity] : 'neutral'}>{IMPEDIMENT_SEVERITY_LABELS[i.severity]}</Chip>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{i.title}</p>
                  <p className="text-xs text-muted">{i.ownerName}{i.milestoneName ? ` · ${i.milestoneName}` : ''}{i.dueOn ? ` · ${i.overdue ? 'venceu' : 'até'} ${fmtDate(i.dueOn)}` : ''}</p>
                  {i.resolution && <p className="mt-1"><span className="font-semibold text-ink">Resolução:</span> {i.resolution}</p>}
                </div>
                <Chip tone={open ? (i.overdue ? 'red' : 'yellow') : 'green'}>{IMPEDIMENT_STATUS_LABELS[i.status]}</Chip>
                {i.canEdit && (
                  <span className="flex gap-1.5">
                    {i.status === 'aberto' && <Button size="sm" variant="secondary" loading={move.isPending && move.variables?.imp === i} onClick={() => move.mutate({ imp: i, to: 'em_tratamento' })}>Em tratamento</Button>}
                    {open ? <Button size="sm" variant="primary" onClick={() => setClosing({ imp: i, to: 'removido' })}>Resolver</Button> : <Button size="sm" variant="secondary" onClick={() => move.mutate({ imp: i, to: 'aberto' })}>Reabrir</Button>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Novo impedimento"
        footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button><Button variant="primary" disabled={f.title.trim().length < 5} loading={create.isPending} onClick={() => create.mutate()}>Registrar impedimento</Button></>}>
        <div className="space-y-4">
          <FormField label="O que está travando" htmlFor="im-title" required><Input id="im-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Gravidade" htmlFor="im-sev"><Select id="im-sev" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value as Imp['severity'] })}>{(['alta', 'media', 'baixa'] as const).map((k) => <option key={k} value={k}>{IMPEDIMENT_SEVERITY_LABELS[k]}</option>)}</Select></FormField>
            <FormField label="Quem resolve" htmlFor="im-own"><Select id="im-own" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
            <FormField label="Prazo" htmlFor="im-due"><Input id="im-due" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></FormField>
          </div>
        </div>
      </Modal>
      <Modal open={!!closing} onClose={() => setClosing(null)} title="Resolver impedimento"
        footer={<><Button variant="secondary" onClick={() => setClosing(null)}>Cancelar</Button><Button variant="primary" disabled={resolution.trim().length < 5} loading={move.isPending} onClick={() => closing && move.mutate({ imp: closing.imp, to: closing.to, res: resolution })}>Salvar resolução</Button></>}>
        <div className="space-y-4">
          <FormField label="Desfecho" htmlFor="im-to"><Select id="im-to" value={closing?.to ?? 'removido'} onChange={(e) => closing && setClosing({ ...closing, to: e.target.value as ImpedimentStatus })}><option value="removido">{IMPEDIMENT_STATUS_LABELS.removido}</option><option value="aceito">{IMPEDIMENT_STATUS_LABELS.aceito}</option></Select></FormField>
          <FormField label="Como foi resolvido" htmlFor="im-res" required><Textarea id="im-res" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} /></FormField>
        </div>
      </Modal>
    </section>
  );
}
