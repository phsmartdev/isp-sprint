/** Visão 360° da conta no Sucesso do Cliente (aba da ficha do cliente) e as ações rápidas do CSM. */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CalendarPlus, ClipboardCheck, Flag, MessageSquarePlus, RefreshCw, Star, Target } from 'lucide-react';
import { CRIT_LABELS, CS_ACTIVITY_KINDS, CS_ACTIVITY_LABELS, CS_LEVELS, CS_LEVEL_LABELS, HEALTH_LABELS, IPC_CRITERIA, IPC_LABELS, IPC_LEVEL_TEXT, IPC_OBJECTIVE, STAGE_LABELS, type CritFactor, type CsLevel, type HealthFactor, type IpcCriterion, type OpportunityStage } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime, fmtPct, isoToLocalInput } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { HealthBadge, IPC_LEVEL_OPTS, LevelChip, TierChip, covText, type Coverage, type Snapshot } from './shared';

type FollowUp = { id: string; title: string; kind: string | null; dueAt: string | null; plannedAt: string | null; completedAt: string | null; result: string | null; cadence: string | null; ownerName: string | null };
type Data = {
  contact: { id: string; name: string }; canEdit: boolean; csm: { id: string; name: string; email: string } | null; churnRisk: 'baixo' | 'medio' | 'alto' | null; snapshot: Snapshot | null; reason: string | null; coverage: Coverage;
  journeys: { id: string; templateName: string; status: string; startedAt: string; contractId: string | null }[];
  surveys: { id: string; kind: string; score: number; scale: number; comment: string | null; respondedAt: string; respondent: string | null }[];
  visits: { id: string; type: string; modality: string; objective: string; plannedAt: string; doneAt: string | null; status: string; summary: string | null; demands: string | null; risks: string | null; opportunities: string | null; nextSteps: string | null; csmName: string | null; participants: string | null }[];
  plans: { id: string; kind: 'plano' | 'ocorrencia'; severity: string | null; title: string; reason: string | null; status: string; ownerName: string | null; dueAt: string | null; createdAt: string; closedNote: string | null }[];
  alerts: { id: string; key: string; category: string; level: string; text: string; firstSeenAt: string }[];
  ipcHistory: { id: string; score: number | null; level: string; justification: string | null; evidence: string | null; createdAt: string; actorName: string | null; data: Record<string, string> }[];
  history: { id: string; kind: string; level: string | null; score: number | null; justification: string | null; createdAt: string; actorName: string | null }[];
  classHistory: { classKey: string | null; createdAt: string; by: string | null; notes: string | null }[];
  opportunities: { id: string; code: number; title: string; stage: string; valueCents: number | null; wonAt: string | null; createdAt: string }[];
  followUps: FollowUp[]; ixc: { configured: boolean; dataAvailable: boolean }; options: { visitTypes: string[]; surveyKinds: string[] };
};
const KIND_LABEL: Record<string, string> = { tier: 'Tier', saude: 'Saúde', criticidade: 'Criticidade', prioridade_manual: 'Prioridade manual', csm: 'Troca de CSM' };

function Card({ title, children, action, className }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={clsx('rounded-lg border border-line p-4', className)}><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-bold text-ink">{title}</h3>{action}</div>{children}</section>;
}
const Stat = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => <div><p className="text-xs text-muted">{label}</p><div className="mt-0.5 font-semibold text-ink">{children}</div>{hint && <p className="text-xs text-muted">{hint}</p>}</div>;

function useAct(contactId: string, close: () => void, msg: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return (path: string, method = 'POST') => useMutation({ // eslint-disable-line react-hooks/rules-of-hooks
    mutationFn: (body: unknown) => api(path, { method, body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['cs-account', contactId] }); void qc.invalidateQueries({ queryKey: ['cs-portfolio'] }); close(); toast({ tone: 'success', message: msg }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
}

export function FollowUpDialog({ contactId, activity, open, onClose }: { contactId: string; activity: FollowUp | null; open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ kind: (activity?.kind ?? 'contato') as string, result: '', doneAt: isoToLocalInput(new Date().toISOString()), nextAction: '', nextAt: '' });
  const m = useAct(contactId, onClose, 'Acompanhamento registrado')(`/cs/accounts/${contactId}/followups`);
  return (
    <Modal open={open} onClose={onClose} title={activity ? `Registrar: ${activity.title}` : 'Registrar contato ou acompanhamento'} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={f.result.trim().length < 5} loading={m.isPending} onClick={() => m.mutate({ activityId: activity?.id ?? null, kind: f.kind, result: f.result, doneAt: new Date(f.doneAt).toISOString(), nextAction: f.nextAction || null, nextAt: f.nextAt || null })}>Registrar</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Tipo" htmlFor="fu-kind"><Select id="fu-kind" value={f.kind} disabled={!!activity?.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{CS_ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{CS_ACTIVITY_LABELS[k]}</option>)}</Select></FormField>
          <FormField label="Realizado em" htmlFor="fu-at"><Input id="fu-at" type="datetime-local" value={f.doneAt} max={isoToLocalInput(new Date().toISOString())} onChange={(e) => setF({ ...f, doneAt: e.target.value })} /></FormField>
        </div>
        <FormField label="Resultado" htmlFor="fu-result" required hint="Sem resultado registrado, o acompanhamento não conta na cobertura."><Textarea id="fu-result" rows={3} value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })} /></FormField>
        <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
          <FormField label="Próxima ação" htmlFor="fu-next"><Input id="fu-next" value={f.nextAction} onChange={(e) => setF({ ...f, nextAction: e.target.value })} /></FormField>
          <FormField label="Quando" htmlFor="fu-nextat"><Input id="fu-nextat" type="date" value={f.nextAt} onChange={(e) => setF({ ...f, nextAt: e.target.value })} /></FormField>
        </div>
      </div>
    </Modal>
  );
}

export function VisitDialog({ contactId, types, open, onClose, contracts }: { contactId: string; types: string[]; open: boolean; onClose: () => void; contracts?: { id: string; number: string }[] }) {
  const [f, setF] = useState({ type: types[0] ?? 'Relacionamento', modality: 'presencial', objective: '', plannedAt: '', participants: '', contractIds: [] as string[] });
  const m = useAct(contactId, onClose, 'Visita agendada')(`/cs/accounts/${contactId}/visits`);
  return (
    <Modal open={open} onClose={onClose} title="Agendar visita" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!f.plannedAt || f.objective.trim().length < 5} loading={m.isPending} onClick={() => m.mutate({ ...f, plannedAt: new Date(f.plannedAt).toISOString(), participants: f.participants || null })}>Agendar</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Tipo" htmlFor="vi-type"><Select id="vi-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{types.map((t) => <option key={t}>{t}</option>)}</Select></FormField>
        <FormField label="Modalidade" htmlFor="vi-mod"><Select id="vi-mod" value={f.modality} onChange={(e) => setF({ ...f, modality: e.target.value })}><option value="presencial">Presencial</option><option value="remota">Remota</option></Select></FormField>
        <FormField label="Data e hora" htmlFor="vi-at" required><Input id="vi-at" type="datetime-local" value={f.plannedAt} onChange={(e) => setF({ ...f, plannedAt: e.target.value })} /></FormField>
        <FormField label="Participantes" htmlFor="vi-part"><Input id="vi-part" value={f.participants} onChange={(e) => setF({ ...f, participants: e.target.value })} /></FormField>
        <FormField label="Objetivo" htmlFor="vi-obj" required className="sm:col-span-2"><Textarea id="vi-obj" rows={2} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} /></FormField>
        {!!contracts?.length && <fieldset className="sm:col-span-2"><legend className="mb-1 text-sm font-semibold text-ink">Contratos tratados</legend><div className="flex flex-wrap gap-3">{contracts.map((c) => <label key={c.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={f.contractIds.includes(c.id)} onChange={(e) => setF({ ...f, contractIds: e.target.checked ? [...f.contractIds, c.id] : f.contractIds.filter((x) => x !== c.id) })} />{c.number}</label>)}</div></fieldset>}
      </div>
    </Modal>
  );
}

function VisitResult({ contactId, visit, onClose }: { contactId: string; visit: Data['visits'][number] | null; onClose: () => void }) {
  const [f, setF] = useState({ status: 'realizada', doneAt: isoToLocalInput(new Date().toISOString()), summary: '', demands: '', risks: '', opportunities: '', steps: '', createOpportunity: false });
  const m = useAct(contactId, onClose, 'Visita registrada')(`/cs/visits/${visit?.id}`, 'PATCH');
  const steps = f.steps.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [title, date] = l.split('|').map((x) => x.trim()); return { title: title!, dueAt: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) }; }).filter((x) => x.title.length >= 3);
  return (
    <Modal open={!!visit} onClose={onClose} title="Registrar visita" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant={f.status === 'cancelada' ? 'danger' : 'primary'} disabled={f.status === 'realizada' && f.summary.trim().length < 20} loading={m.isPending} onClick={() => m.mutate({ status: f.status, doneAt: new Date(f.doneAt).toISOString(), summary: f.summary || null, demands: f.demands || null, risks: f.risks || null, opportunities: f.opportunities || null, nextSteps: f.status === 'realizada' ? steps : [], createOpportunity: f.createOpportunity })}>{f.status === 'cancelada' ? 'Cancelar visita' : 'Registrar visita'}</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Situação" htmlFor="vr-st"><Select id="vr-st" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="realizada">Realizada</option><option value="cancelada">Não aconteceu (cancelar)</option></Select></FormField>
        <FormField label="Realizada em" htmlFor="vr-at"><Input id="vr-at" type="datetime-local" value={f.doneAt} onChange={(e) => setF({ ...f, doneAt: e.target.value })} /></FormField>
        <FormField label="Resumo" htmlFor="vr-sum" required className="sm:col-span-2" hint="Mínimo 20 caracteres: sem registro, a visita não conta."><Textarea id="vr-sum" rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></FormField>
        <FormField label="Demandas" htmlFor="vr-dem"><Textarea id="vr-dem" rows={2} value={f.demands} onChange={(e) => setF({ ...f, demands: e.target.value })} /></FormField>
        <FormField label="Riscos" htmlFor="vr-risk"><Textarea id="vr-risk" rows={2} value={f.risks} onChange={(e) => setF({ ...f, risks: e.target.value })} /></FormField>
        <FormField label="Oportunidades" htmlFor="vr-opp" className="sm:col-span-2"><Textarea id="vr-opp" rows={2} value={f.opportunities} onChange={(e) => setF({ ...f, opportunities: e.target.value })} /></FormField>
        {f.opportunities.trim() && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.createOpportunity} onChange={(e) => setF({ ...f, createOpportunity: e.target.checked })} />Abrir negociação com a oportunidade identificada</label>}
        <FormField label="Próximos passos (um por linha; data opcional: Enviar proposta | 2026-11-05)" htmlFor="vr-steps" className="sm:col-span-2"><Textarea id="vr-steps" rows={3} value={f.steps} onChange={(e) => setF({ ...f, steps: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

function SurveyDialog({ contactId, kinds, open, onClose }: { contactId: string; kinds: string[]; open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ kind: kinds[0] ?? 'nps', score: '', respondent: '', comment: '', respondedAt: new Date().toISOString().slice(0, 10) });
  const scale = f.kind === 'csat' ? 5 : 10;
  const m = useAct(contactId, onClose, 'Pesquisa registrada')(`/cs/accounts/${contactId}/surveys`);
  const n = Number(f.score);
  const valid = f.score !== '' && Number.isInteger(n) && n >= (scale === 5 ? 1 : 0) && n <= scale;
  return (
    <Modal open={open} onClose={onClose} title="Registrar pesquisa" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate({ kind: f.kind, score: n, scale, respondent: f.respondent || null, comment: f.comment || null, respondedAt: f.respondedAt })}>Registrar</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Pesquisa" htmlFor="sv-kind"><Select id="sv-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{kinds.map((k) => <option key={k} value={k}>{k === 'nps' ? 'NPS (0–10)' : k === 'csat' ? 'CSAT (1–5)' : `${k} (0–10)`}</option>)}</Select></FormField>
        <FormField label="Nota" htmlFor="sv-score" required><Input id="sv-score" type="number" min={scale === 5 ? 1 : 0} max={scale} value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} /></FormField>
        <FormField label="Respondente" htmlFor="sv-resp"><Input id="sv-resp" value={f.respondent} onChange={(e) => setF({ ...f, respondent: e.target.value })} /></FormField>
        <FormField label="Data" htmlFor="sv-date"><Input id="sv-date" type="date" value={f.respondedAt} onChange={(e) => setF({ ...f, respondedAt: e.target.value })} /></FormField>
        <FormField label="Comentário" htmlFor="sv-com" className="col-span-2"><Textarea id="sv-com" rows={2} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

function IpcDialog({ contactId, sn, open, onClose }: { contactId: string; sn: Snapshot; open: boolean; onClose: () => void }) {
  const [levels, setLevels] = useState<Record<string, string>>(() => Object.fromEntries(IPC_CRITERIA.map((k) => [k, sn.ipc.levels[k] ?? ''])));
  const [just, setJust] = useState('');
  const [ev, setEv] = useState('');
  const m = useAct(contactId, onClose, 'Score IPC registrado')(`/cs/accounts/${contactId}/ipc`);
  return (
    <Modal open={open} onClose={onClose} title="Avaliar Score IPC" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={just.trim().length < 10} loading={m.isPending} onClick={() => m.mutate({ levels: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, v || null])), justification: just, evidence: ev || null })}>Registrar avaliação</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Tamanho e tempo de relacionamento são calculados pelo sistema quando há contrato. Critério sem informação fica pendente; a avaliação fica incompleta até todos estarem preenchidos.</p>
        {IPC_CRITERIA.map((k) => {
          const auto = sn.ipc.auto.includes(k);
          return (
            <div key={k} className="grid grid-cols-[minmax(0,1fr)_220px] items-center gap-3">
              <label htmlFor={`ipc-${k}`} className="text-sm text-ink">{IPC_LABELS[k as IpcCriterion]}{auto && <span className="ml-1 text-xs text-muted">(calculado)</span>}</label>
              <Select id={`ipc-${k}`} value={levels[k] ?? ''} disabled={auto} onChange={(e) => setLevels({ ...levels, [k]: e.target.value })}><option value="">Sem informação</option>{IPC_LEVEL_OPTS.map(([v]) => <option key={v} value={v}>{IPC_LEVEL_TEXT[k as IpcCriterion][v]}</option>)}</Select>
            </div>
          );
        })}
        <FormField label="Justificativa" htmlFor="ipc-just" required><Textarea id="ipc-just" rows={2} value={just} onChange={(e) => setJust(e.target.value)} /></FormField>
        <FormField label="Evidências" htmlFor="ipc-ev"><Textarea id="ipc-ev" rows={2} value={ev} onChange={(e) => setEv(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}

function PriorityDialog({ contactId, sn, open, onClose }: { contactId: string; sn: Snapshot; open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ level: sn.manual?.level ?? '', reason: '', reviewAt: sn.manual?.reviewAt ?? new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) });
  const m = useAct(contactId, onClose, 'Prioridade atualizada')(`/cs/accounts/${contactId}/priority`);
  return (
    <Modal open={open} onClose={onClose} title="Prioridade manual" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={f.reason.trim().length < 10} loading={m.isPending} onClick={() => m.mutate({ level: f.level || null, reason: f.reason, reviewAt: f.level ? f.reviewAt : null })}>Salvar</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Criticidade calculada: <LevelChip level={sn.criticality.level} />. A prioridade manual não apaga a calculada; as duas ficam registradas.</p>
        <FormField label="Prioridade manual" htmlFor="pr-level"><Select id="pr-level" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="">Remover prioridade manual</option>{CS_LEVELS.map((l) => <option key={l} value={l}>{CS_LEVEL_LABELS[l]}</option>)}</Select></FormField>
        {f.level && <FormField label="Revisar até" htmlFor="pr-review" required><Input id="pr-review" type="date" value={f.reviewAt} onChange={(e) => setF({ ...f, reviewAt: e.target.value })} /></FormField>}
        <FormField label="Justificativa" htmlFor="pr-reason" required><Textarea id="pr-reason" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

export function PlanDialog({ contactId, open, onClose, kind = 'plano', alert }: { contactId: string; open: boolean; onClose: () => void; kind?: 'plano' | 'ocorrencia'; alert?: { key: string; text: string } | null }) {
  const [f, setF] = useState({ kind, title: alert ? `Plano: ${alert.text}`.slice(0, 200) : '', reason: alert?.text ?? '', severity: 'media', dueAt: '', steps: '' });
  const m = useAct(contactId, onClose, f.kind === 'plano' ? 'Plano de ação aberto' : 'Ocorrência registrada')(`/cs/accounts/${contactId}/plans`);
  const steps = f.steps.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [title, date] = l.split('|').map((x) => x.trim()); return { title: title!, dueAt: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : f.dueAt || new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) }; }).filter((x) => x.title.length >= 3);
  return (
    <Modal open={open} onClose={onClose} title={f.kind === 'plano' ? 'Plano de ação' : 'Registrar ocorrência'} footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={f.title.trim().length < 3} loading={m.isPending} onClick={() => m.mutate({ kind: f.kind, title: f.title, reason: f.reason || null, severity: f.severity, dueAt: f.dueAt || null, alertKey: alert?.key ?? null, steps })}>Salvar</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Tipo" htmlFor="pl-kind"><Select id="pl-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'plano' })}><option value="plano">Plano de ação</option><option value="ocorrencia">Ocorrência</option></Select></FormField>
        <FormField label="Gravidade" htmlFor="pl-sev"><Select id="pl-sev" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option></Select></FormField>
        <FormField label="Título" htmlFor="pl-title" required className="col-span-2"><Input id="pl-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
        <FormField label="Motivo / descrição" htmlFor="pl-reason" className="col-span-2"><Textarea id="pl-reason" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></FormField>
        <FormField label="Prazo" htmlFor="pl-due"><Input id="pl-due" type="date" value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></FormField>
        <FormField label="Passos (um por linha; data opcional: Ligar para o TI | 2026-11-03)" htmlFor="pl-steps" className="col-span-2"><Textarea id="pl-steps" rows={3} value={f.steps} onChange={(e) => setF({ ...f, steps: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

function ClosePlan({ contactId, plan, onClose }: { contactId: string; plan: Data['plans'][number] | null; onClose: () => void }) {
  const [f, setF] = useState({ status: 'concluido', note: '' });
  const m = useAct(contactId, onClose, 'Plano encerrado')(`/cs/plans/${plan?.id}`, 'PATCH');
  return (
    <Modal open={!!plan} onClose={onClose} title="Encerrar" footer={<><Button variant="secondary" onClick={onClose}>Voltar</Button><Button variant="primary" disabled={f.note.trim().length < 5} loading={m.isPending} onClick={() => m.mutate(f)}>Encerrar</Button></>}>
      <div className="space-y-4">
        <FormField label="Desfecho" htmlFor="cp-st"><Select id="cp-st" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="concluido">Concluído</option><option value="cancelado">Cancelado</option></Select></FormField>
        <FormField label="O que foi feito" htmlFor="cp-note" required><Textarea id="cp-note" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

export function Account360({ contactId }: { contactId: string }) {
  const q = useQuery({ queryKey: ['cs-account', contactId], queryFn: () => api<Data>(`/cs/accounts/${contactId}`) });
  const lookups = useLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const [dlg, setDlg] = useState<null | 'followup' | 'visit' | 'survey' | 'ipc' | 'priority' | 'plan' | 'occ'>(null);
  const [act, setAct] = useState<FollowUp | null>(null);
  const [visit, setVisit] = useState<Data['visits'][number] | null>(null);
  const [planAlert, setPlanAlert] = useState<{ key: string; text: string } | null>(null);
  const [closing, setClosing] = useState<Data['plans'][number] | null>(null);
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/cs/accounts/${contactId}`, { method: 'PATCH', body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['cs-account', contactId] }); toast({ tone: 'success', message: 'Conta atualizada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const recompute = useMutation({ mutationFn: () => api('/cs/recompute', { method: 'POST', body: { contactId } }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['cs-account', contactId] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const journeyStart = useMutation({ mutationFn: (contractId: string) => api('/cs/journeys', { method: 'POST', body: { contractId } }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['cs-account', contactId] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <LoadingRows rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const sn = d.snapshot;
  if (!sn) return <EmptyState title="Conta ainda não acompanhada" description="A conta entra no Sucesso do Cliente com um contrato validado ou com uma jornada iniciada." />;
  const today = new Date().toISOString().slice(0, 10);
  const open = d.followUps.filter((f) => !f.completedAt);
  const doneList = d.followUps.filter((f) => f.completedAt).slice(0, 8);
  return (
    <div className="space-y-4">
      {/* resumo */}
      <section className="rounded-lg bg-surface-2/70 p-4" aria-label="Resumo do Sucesso do Cliente">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-text"><span className="font-semibold text-ink">Por que esta prioridade:</span> {d.reason}</p>
          <span className="flex items-center gap-2 text-xs text-muted">Calculado {fmtDateTime(sn.computedAt)} · {sn.ruleVersion ? `regras v${sn.ruleVersion}` : 'regras padrão'}<button className="inline-flex items-center gap-1 font-semibold text-primary" onClick={() => recompute.mutate()} aria-label="Recalcular"><RefreshCw className={clsx('h-3.5 w-3.5', recompute.isPending && 'animate-spin')} />Recalcular</button></span>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="CSM">{d.csm?.name ?? <span className="text-danger">Sem CSM</span>}</Stat>
          <Stat label="Tier · valor anual" hint={[sn.groupContacts > 1 ? `grupo com ${sn.groupContacts} cadastros` : null, sn.acvParts ? `recorrente ${fmtBRL(sn.acvParts.recorrente)} · medição ${fmtBRL(sn.acvParts.medicao)} · frequente ${fmtBRL(sn.acvParts.frequente)}${sn.acvParts.semContrato ? ` · ganhas sem contrato ${fmtBRL(sn.acvParts.semContrato)}` : ''}` : 'valor anual consolidado', sn.acvExcluded?.count ? `consumo de medição fora do total: ${fmtBRL(sn.acvExcluded.cents)}` : null].filter(Boolean).join(' · ')}><span className="flex items-center gap-2"><TierChip tier={sn.tier} /><span className="num">{fmtBRL(sn.groupAcvCents)}</span></span></Stat>
          <Stat label="Score IPC" hint={sn.ipc.total === null ? `incompleto: ${sn.ipc.pending.length} critério(s) pendente(s)` : sn.ipc.reviewDue ? 'revisão vencida' : sn.ipc.assessedAt ? `avaliado em ${fmtDate(sn.ipc.assessedAt)}` : undefined}>{sn.ipc.total ?? <span className="text-muted">Incompleto ({sn.ipc.partial})</span>}</Stat>
          <Stat label="Classe estratégica">{sn.classKey ?? <span className="text-muted">Não classificada</span>}</Stat>
          <Stat label="Saúde" hint={`dados em ${Math.round(sn.health.coverage * 100)}% dos pesos`}><HealthBadge score={sn.health.score} label={sn.health.label} /></Stat>
          <Stat label="Criticidade calculada"><LevelChip level={sn.criticality.level} /></Stat>
          <Stat label="Prioridade efetiva" hint={sn.manual ? `manual até ${fmtDate(sn.manual.reviewAt)}` : undefined}><LevelChip level={sn.effective.level} manual={sn.effective.source === 'manual'} /></Stat>
          <Stat label="Cobertura (90 dias)" hint={d.coverage.planned ? `${d.coverage.onTime}/${d.coverage.planned} no prazo${d.coverage.extra ? ` · +${d.coverage.extra} extra` : ''}` : undefined}>{covText(d.coverage)}</Stat>
          <Stat label="Último contato" hint={sn.policy?.contactDays ? `cadência: a cada ${sn.policy.contactDays} dias` : 'sem cadência'}>{sn.lastContactAt ? fmtDate(sn.lastContactAt) : <span className="text-danger">Nenhum</span>}</Stat>
          <Stat label="Próximo contato">{sn.nextContactAt ? fmtDate(sn.nextContactAt) : '—'}</Stat>
        </div>
        {d.canEdit && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => { setAct(null); setDlg('followup'); }}>Registrar contato</Button>
            <Button size="sm" variant="secondary" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setDlg('visit')}>Agendar visita</Button>
            <Button size="sm" variant="secondary" icon={<Target className="h-4 w-4" />} onClick={() => { setPlanAlert(null); setDlg('plan'); }}>Plano de ação</Button>
            <Button size="sm" variant="secondary" icon={<Star className="h-4 w-4" />} onClick={() => setDlg('survey')}>Pesquisa</Button>
            <Button size="sm" variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setDlg('ipc')}>Avaliar IPC</Button>
            <Button size="sm" variant="secondary" icon={<Flag className="h-4 w-4" />} onClick={() => setDlg('priority')}>Revisar prioridade</Button>
            <Link to="/opportunities/new" className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2">Abrir negociação</Link>
          </div>
        )}
      </section>

      {!!d.alerts.length && (
        <Card title={`Alertas (${d.alerts.length})`}>
          <ul className="space-y-2">{d.alerts.map((a) => <li key={a.id} className={clsx('flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-sm', a.level === 'alta' ? 'bg-danger-soft' : 'bg-warning-soft')}><AlertTriangle className={clsx('h-4 w-4', a.level === 'alta' ? 'text-danger' : 'text-[#C2610C]')} aria-hidden /><span className="min-w-0 flex-1">{a.text}</span><span className="text-xs text-muted">desde {fmtDate(a.firstSeenAt)}</span>{d.canEdit && <button className="text-xs font-semibold text-primary hover:underline" onClick={() => { setPlanAlert({ key: a.key, text: a.text }); setDlg('plan'); }}>Abrir plano</button>}</li>)}</ul>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Saúde e criticidade">
          <ul className="space-y-1.5 text-sm">
            {sn.health.parts.map((p) => <li key={p.key} className="grid grid-cols-[minmax(0,1fr)_120px_60px] items-center gap-3"><span>{HEALTH_LABELS[p.key as HealthFactor]}</span>{p.value === null ? <span className="text-xs text-muted">{p.key === 'inadimplencia' ? (d.ixc.configured ? 'IXC sem faturas lidas' : 'Aguardando IXC') : 'Sem dado'}</span> : <span className="h-2 rounded-full bg-surface-2"><span className={clsx('block h-2 rounded-full', p.value >= 75 ? 'bg-success' : p.value >= 50 ? 'bg-[#F59E0B]' : 'bg-danger')} style={{ width: `${p.value}%` }} /></span>}<span className="num text-right text-xs text-muted">peso {p.weight}</span></li>)}
          </ul>
          <p className="mt-3 text-xs text-muted">Fator sem dado não conta como bom nem como ruim: a saúde usa só o que existe e exige um mínimo de dados.</p>
          {!!sn.criticality.reasons.length && <div className="mt-3 border-t border-line pt-3"><p className="mb-1 text-sm font-semibold text-ink">O que pesa na criticidade ({sn.criticality.points} pts)</p><ul className="space-y-1 text-sm">{sn.criticality.reasons.map((r) => <li key={r.key} className="flex justify-between gap-3"><span>{CRIT_LABELS[r.key as CritFactor]}: {r.reason}</span><span className="num text-muted">{r.points}</span></li>)}</ul></div>}
          {d.canEdit && <div className="mt-3 flex items-center gap-2 text-sm"><label htmlFor="cs-churn" className="text-muted">Risco de cancelamento</label><Select id="cs-churn" className="h-9 w-auto" value={d.churnRisk ?? ''} onChange={(e) => patch.mutate({ churnRisk: e.target.value || null })}><option value="">Não avaliado</option><option value="baixo">Baixo</option><option value="medio">Médio</option><option value="alto">Alto</option></Select></div>}
        </Card>

        <Card title="Score IPC" action={d.canEdit ? <button className="text-sm font-semibold text-primary hover:underline" onClick={() => setDlg('ipc')}>Avaliar</button> : undefined}>
          <ul className="space-y-1 text-sm">{IPC_CRITERIA.map((k) => { const l = sn.ipc.levels[k]; return <li key={k} className="flex justify-between gap-3"><span>{IPC_LABELS[k]}{IPC_OBJECTIVE.includes(k) && <span className="text-xs text-muted"> · calculado</span>}</span><span className={l ? 'font-semibold' : 'text-muted'}>{l ? IPC_LEVEL_TEXT[k][l] : 'Pendente'}</span></li>; })}</ul>
          <p className="mt-2 text-sm">Total: <span className="font-bold">{sn.ipc.total ?? `incompleto (${sn.ipc.partial} pts até agora)`}</span> · Classe estratégica: <span className="font-semibold">{sn.classKey ?? 'não classificada'}</span> <span className="text-xs text-muted">(não soma no IPC)</span></p>
          {!!d.ipcHistory.length && <details className="mt-2 text-sm"><summary className="cursor-pointer text-muted">Histórico de avaliações ({d.ipcHistory.length})</summary><ul className="mt-1 space-y-1">{d.ipcHistory.map((h) => <li key={h.id}>{fmtDate(h.createdAt)} · {h.score ?? 'incompleto'} · {h.actorName}: {h.justification}{h.evidence ? ` (evidência: ${h.evidence})` : ''}</li>)}</ul></details>}
        </Card>

        <Card title="Relacionamento" action={d.canEdit ? <button className="text-sm font-semibold text-primary hover:underline" onClick={() => { setAct(null); setDlg('followup'); }}>Registrar</button> : undefined}>
          {!!d.journeys.length && <ul className="mb-3 space-y-1 text-sm">{d.journeys.map((j) => <li key={j.id}><Link className="font-semibold text-primary hover:underline" to={`/sucesso/jornadas/${j.id}`}>Jornada · {j.templateName}</Link> <span className="text-muted">desde {fmtDate(j.startedAt)} · {j.status}</span></li>)}</ul>}
          {!d.journeys.length && d.canEdit && sn.contracts[0] && <p className="mb-3 text-sm">Sem jornada. <button className="font-semibold text-primary hover:underline" onClick={() => journeyStart.mutate(sn.contracts[0]!.id)}>Iniciar jornada do contrato {sn.contracts[0].number}</button></p>}
          <p className="mb-1 text-sm font-semibold text-ink">Previstos</p>
          {!open.length ? <p className="mb-3 text-sm text-muted">Nenhum acompanhamento em aberto.</p> : <ul className="mb-3 space-y-1 text-sm">{open.slice(0, 8).map((f) => <li key={f.id} className="flex items-center gap-2"><span className={clsx('num w-20 shrink-0 text-xs', f.plannedAt && f.plannedAt < today ? 'font-semibold text-danger' : 'text-muted')}>{fmtDate(f.plannedAt ?? f.dueAt)}</span><span className="min-w-0 flex-1 truncate">{f.title}</span>{d.canEdit && <button className="text-xs font-semibold text-primary hover:underline" onClick={() => { setAct(f); setDlg('followup'); }}>Registrar</button>}</li>)}</ul>}
          <p className="mb-1 text-sm font-semibold text-ink">Realizados</p>
          {!doneList.length ? <p className="text-sm text-muted">Nenhum ainda.</p> : <ul className="space-y-1 text-sm">{doneList.map((f) => <li key={f.id}><span className="num text-xs text-muted">{fmtDate(f.completedAt)}</span> {f.kind ? CS_ACTIVITY_LABELS[f.kind as keyof typeof CS_ACTIVITY_LABELS] : 'Tarefa'}: {f.result ? <span className="text-text">{f.result.slice(0, 120)}</span> : <span className="text-[#C2610C]">sem resultado registrado (não conta na cobertura)</span>}</li>)}</ul>}
        </Card>

        <Card title="Visitas" action={d.canEdit ? <button className="text-sm font-semibold text-primary hover:underline" onClick={() => setDlg('visit')}>Agendar</button> : undefined}>
          {!d.visits.length ? <p className="text-sm text-muted">Nenhuma visita.</p> : <ul className="space-y-2 text-sm">{d.visits.slice(0, 8).map((v) => <li key={v.id} className="rounded-md border border-line p-2.5"><div className="flex flex-wrap items-center gap-2"><Chip tone={v.status === 'realizada' ? 'green' : v.status === 'cancelada' ? 'neutral' : new Date(v.plannedAt) < new Date() ? 'red' : 'blue'}>{v.status === 'agendada' && new Date(v.plannedAt) < new Date() ? 'Atrasada' : v.status === 'agendada' ? 'Agendada' : v.status === 'realizada' ? 'Realizada' : 'Cancelada'}</Chip><span className="font-semibold">{v.type}</span><span className="text-muted">{fmtDateTime(v.doneAt ?? v.plannedAt)} · {v.modality} · {v.csmName}</span>{v.status === 'agendada' && d.canEdit && <button className="ml-auto text-xs font-semibold text-primary hover:underline" onClick={() => setVisit(v)}>Registrar</button>}</div><p className="mt-1 text-text">{v.summary ?? v.objective}</p>{v.opportunities && <p className="mt-1 text-xs"><span className="font-semibold">Oportunidade:</span> {v.opportunities}</p>}{v.risks && <p className="text-xs"><span className="font-semibold">Riscos:</span> {v.risks}</p>}</li>)}</ul>}
        </Card>

        <Card title="Contratos e consumo">
          {!sn.contracts.length ? <p className="text-sm text-muted">Sem contratos.</p> : <ul className="space-y-2 text-sm">{sn.contracts.map((c) => <li key={c.id} className="rounded-md border border-line p-2.5"><div className="flex flex-wrap justify-between gap-2"><Link className="font-semibold text-primary hover:underline" to={`/contracts/${c.id}`}>{c.number}</Link><span className="text-muted">{c.startAt ? `${fmtDate(c.startAt)} a ${fmtDate(c.endAt)}` : ''} · ACV {fmtBRL(c.acvCents)}</span></div>
            {c.consumption ? <div className="mt-1.5"><div className="h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, (c.consumption.share ?? 0) * 100)}%` }} /></div><p className="mt-1 text-xs text-muted">{fmtPct(c.consumption.share)} consumido ({fmtBRL(c.consumption.consumed)} de {fmtBRL(c.consumption.credited)}){c.consumption.elapsedShare !== null ? ` · ${fmtPct(c.consumption.elapsedShare)} da vigência` : ''}{c.consumption.exhaustAt ? ` · no ritmo atual acaba em ${fmtDate(c.consumption.exhaustAt)}` : ''}</p></div> : <p className="text-xs text-muted">{c.billingType === 'recorrente' ? 'Recorrente (sem saldo de consumo)' : 'Sem saldo lançado'}</p>}</li>)}</ul>}
          <Notice>Inadimplência: {d.ixc.configured ? 'integração com o IXC configurada, mas a leitura de faturas ainda não está disponível.' : 'aguardando integração com o IXC.'} Sem dado, nada é considerado adimplente.</Notice>
        </Card>

        <Card title="Expansão">
          {!d.opportunities.length ? <p className="text-sm text-muted">Nenhuma negociação.</p> : <ul className="space-y-1 text-sm">{d.opportunities.slice(0, 8).map((o) => <li key={o.id} className="flex justify-between gap-3"><Link className="truncate text-primary hover:underline" to={`/opportunities/${o.id}`}>OP-{o.code} · {o.title}</Link><span className="shrink-0 text-muted">{STAGE_LABELS[o.stage as OpportunityStage] ?? o.stage} · {fmtBRL(o.valueCents)}</span></li>)}</ul>}
          <p className="mt-2 text-sm">Em aberto: <span className="font-semibold">{sn.expansion.openCount}</span> · {fmtBRL(sn.expansion.openValueCents)}/mês</p>
        </Card>

        <Card title="Planos de ação e ocorrências" action={d.canEdit ? <span className="flex gap-3"><button className="text-sm font-semibold text-primary hover:underline" onClick={() => { setPlanAlert(null); setDlg('plan'); }}>Novo plano</button><button className="text-sm font-semibold text-primary hover:underline" onClick={() => setDlg('occ')}>Ocorrência</button></span> : undefined}>
          {!d.plans.length ? <p className="text-sm text-muted">Nenhum.</p> : <ul className="space-y-1.5 text-sm">{d.plans.slice(0, 10).map((p) => <li key={p.id} className="flex flex-wrap items-center gap-2"><Chip tone={p.status === 'aberto' ? (p.severity === 'alta' ? 'red' : 'yellow') : 'neutral'}>{p.kind === 'plano' ? 'Plano' : 'Ocorrência'} · {p.status}</Chip><span className="min-w-0 flex-1">{p.title}</span><span className="text-xs text-muted">{p.ownerName}{p.dueAt ? ` · até ${fmtDate(p.dueAt)}` : ''}</span>{p.status === 'aberto' && d.canEdit && <button className="text-xs font-semibold text-primary hover:underline" onClick={() => setClosing(p)}>Encerrar</button>}</li>)}</ul>}
        </Card>

        <Card title="Pesquisas e histórico">
          {!d.surveys.length ? <p className="mb-2 text-sm text-muted">Nenhuma pesquisa registrada.</p> : <ul className="mb-2 space-y-1 text-sm">{d.surveys.slice(0, 6).map((s) => <li key={s.id}><span className="num text-xs text-muted">{fmtDate(s.respondedAt)}</span> <span className="font-semibold uppercase">{s.kind}</span> {s.score}/{s.scale}{s.comment ? ` · ${s.comment}` : ''}</li>)}</ul>}
          {!!d.history.length && <details className="text-sm"><summary className="cursor-pointer text-muted">Mudanças de Tier, saúde, criticidade, prioridade e CSM ({d.history.length})</summary><ul className="mt-1 space-y-1">{d.history.map((h) => <li key={h.id}>{fmtDateTime(h.createdAt)} · {KIND_LABEL[h.kind] ?? h.kind}: {h.level ?? ''}{h.score !== null ? ` (${h.score})` : ''}{h.justification ? ` · ${h.justification}` : ''} · {h.actorName ?? 'cálculo automático'}</li>)}</ul></details>}
          {d.canEdit && lookups.data && <div className="mt-3 flex items-center gap-2 text-sm"><label htmlFor="cs-csm" className="text-muted">CSM</label><Select id="cs-csm" className="h-9 w-auto" value={d.csm?.id ?? ''} onChange={(e) => e.target.value && patch.mutate({ csmId: e.target.value, justification: 'Troca de CSM pela ficha' })}><option value="">Escolha</option>{lookups.data.users.filter((u) => u.sectors?.includes('sucesso_cliente') || u.id === d.csm?.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></div>}
        </Card>
      </div>

      {dlg === 'followup' && <FollowUpDialog contactId={contactId} activity={act} open onClose={() => setDlg(null)} />}
      {dlg === 'visit' && <VisitDialog contactId={contactId} types={d.options.visitTypes} contracts={sn.contracts.map((c) => ({ id: c.id, number: c.number }))} open onClose={() => setDlg(null)} />}
      {dlg === 'survey' && <SurveyDialog contactId={contactId} kinds={d.options.surveyKinds} open onClose={() => setDlg(null)} />}
      {dlg === 'ipc' && <IpcDialog contactId={contactId} sn={sn} open onClose={() => setDlg(null)} />}
      {dlg === 'priority' && <PriorityDialog contactId={contactId} sn={sn} open onClose={() => setDlg(null)} />}
      {(dlg === 'plan' || dlg === 'occ') && <PlanDialog contactId={contactId} open kind={dlg === 'occ' ? 'ocorrencia' : 'plano'} alert={planAlert} onClose={() => setDlg(null)} />}
      <VisitResult contactId={contactId} visit={visit} onClose={() => setVisit(null)} />
      <ClosePlan contactId={contactId} plan={closing} onClose={() => setClosing(null)} />
    </div>
  );
}
