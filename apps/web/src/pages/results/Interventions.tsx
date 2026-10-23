/** Gestão de Times → Intervenções: o que a apuração oficial exige de ação (vermelho, dois amarelos seguidos, revisão do primeiro amarelo). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Siren } from 'lucide-react';
import {
  INTERVENTION_KIND_LABELS, INTERVENTION_STATUS_LABELS, INTERVENTION_TRIGGER_LABELS, TRAFFIC_LABELS,
  toCents, type InterventionKind, type InterventionStatus, type InterventionTrigger, type TrafficColor,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { NewProjectDialog } from '../../features/projects/shared';
import { useLookups, useUrlState } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { useAuth } from '../../auth/AuthProvider';
import { errMsg } from '../../features/contracts/shared';
import { fmtAtt, fmtIndicator } from '../../features/performance/format';
import { FitText } from '../../components/ui/FitText';

type Item = { id: string; kind: InterventionKind; trigger: InterventionTrigger; status: InterventionStatus; competencias: string[]; goalId: string; goalTitle: string; ownerName: string; subjectName: string | null; teamName: string | null; unitName: string | null; dueOn: string; overdue: boolean; escalationLevel: number; escalatedTo: string | null };
type Counts = { abertas: number; planos: number; revisoes: number; atrasadas: number; escaladas: number; minhas: number };
const STATUS_TONE: Record<InterventionStatus, Tone> = { aberta: 'orange', em_andamento: 'blue', concluida: 'green', dispensada: 'neutral' };
const COLOR_DOT: Record<string, string> = { verde: 'bg-success', amarelo: 'bg-warning', vermelho: 'bg-danger', sem_dado: 'bg-line' };
const comp = (c: string) => { const [y, m] = c.split('-'); return `${m}/${y}`; };
const EVENT_TEXT: Record<string, string> = {
  aberta: 'abriu a intervenção', promovida: 'virou plano de ação obrigatório', reincidencia: 'nova competência fora da meta (reincidência)', escalada: 'prazo vencido: escalonada',
  acao_incluida: 'incluiu uma ação no plano', acao_cancelada: 'cancelou uma ação do plano', projeto_ligado: 'ligou o projeto do plano', projeto_desligado: 'desligou o projeto do plano',
  revisada: 'registrou a revisão', analise_iniciada: 'começou a análise de causa', analise_concluida: 'concluiu a análise de causa', analise_reaberta: 'reabriu a análise de causa', plano_registrado: 'registrou o plano de ação', plano_atualizado: 'atualizou o plano de ação', concluida: 'concluiu', dispensada: 'dispensou',
  dispensada_retificacao: 'dispensada automaticamente após retificação da apuração',
};

export function InterventionsPage() {
  const [u, setU] = useUrlState({ status: 'abertas', kind: '', mine: '', id: '' });
  const q = useQuery({
    queryKey: ['interventions', u.status, u.kind, u.mine], placeholderData: keepPreviousData,
    queryFn: () => api<{ today: string; counts: Counts; items: Item[] }>(`/interventions${qs({ status: u.status, kind: u.kind || undefined, mine: u.mine ? 'true' : undefined })}`),
  });
  const c = q.data?.counts;
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <PageHeader icon={<Siren />} title="Intervenções" subtitle="O que precisa de análise e plano: metas que a apuração pôs fora da faixa e intervenções abertas por iniciativa do time." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova intervenção</Button>} />
      {c && (
        <ul className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Resumo das intervenções abertas">
          {([['planos', 'Planos obrigatórios', 'kind', 'plano'], ['revisoes', 'Revisões de amarelo', 'kind', 'revisao'], ['atrasadas', 'Com prazo vencido', null, null], ['escaladas', 'Escalonadas', null, null], ['minhas', 'Comigo', 'mine', '1']] as const).map(([k, label, fk, fv]) => (
            <li key={k}>
              <button type="button" disabled={!fk} onClick={() => fk && setU({ status: 'abertas', kind: fk === 'kind' ? (u.kind === fv ? '' : fv) : '', mine: fk === 'mine' ? (u.mine ? '' : '1') : '' })}
                className={clsx('w-full rounded-lg border p-4 text-left', (fk === 'kind' && u.kind === fv) || (fk === 'mine' && u.mine) ? 'border-primary bg-primary/5' : 'border-line bg-surface', (k === 'atrasadas' || k === 'escaladas') && c[k] > 0 && 'border-danger/40 text-danger')}>
                <span className="block text-sm font-semibold">{label}</span><FitText as="span" className="num text-2xl font-bold">{c[k]}</FitText>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Situação" htmlFor="iv-st"><Select id="iv-st" value={u.status} onChange={(e) => setU({ status: e.target.value })}><option value="abertas">Abertas</option><option value="aberta">Aguardando ação</option><option value="em_andamento">Plano em execução</option><option value="concluida">Concluídas</option><option value="dispensada">Dispensadas</option><option value="todas">Todas</option></Select></FormField>
        <FormField label="Tipo" htmlFor="iv-k"><Select id="iv-k" value={u.kind} onChange={(e) => setU({ kind: e.target.value })}><option value="">Todos</option><option value="plano">Plano de ação</option><option value="revisao">Revisão simplificada</option></Select></FormField>
      </div>
      <section className="card overflow-hidden">
        {q.isLoading ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? (
          <EmptyState title={u.status === 'abertas' ? 'Nenhuma intervenção aberta' : 'Nada com esses filtros'} description="Quando uma meta fecha o mês em vermelho, ou em amarelo, a intervenção aparece aqui com o responsável e o prazo." />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Meta ou problema', 'Motivo', 'Competências', 'De quem', 'Responsável', 'Prazo', 'Situação'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {q.data!.items.map((i) => (
                  <tr key={i.id} className="border-t border-line align-top">
                    <td className="px-3 py-2.5"><button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => setU({ id: i.id }, { resetPage: false })}>{i.goalTitle}</button><span className="block text-xs text-muted">{INTERVENTION_KIND_LABELS[i.kind]}</span></td>
                    <td className="px-3 py-2.5"><Chip tone={i.trigger === 'manual' ? 'blue' : i.trigger === 'primeiro_amarelo' ? 'orange' : 'red'}>{INTERVENTION_TRIGGER_LABELS[i.trigger]}</Chip></td>
                    <td className="num px-3 py-2.5">{i.competencias.length ? i.competencias.map(comp).join(', ') : '—'}</td>
                    <td className="px-3 py-2.5">{i.subjectName ?? i.teamName ?? i.unitName ?? 'Empresa'}</td>
                    <td className="px-3 py-2.5">{i.ownerName}{i.escalatedTo && <span className="block text-xs font-semibold text-danger">escalonada para {i.escalatedTo}</span>}</td>
                    <td className={clsx('num px-3 py-2.5', i.overdue && 'font-semibold text-danger')}>{fmtDate(i.dueOn)}{i.overdue && <span className="block text-xs">vencido</span>}</td>
                    <td className="px-3 py-2.5"><Chip tone={STATUS_TONE[i.status]}>{INTERVENTION_STATUS_LABELS[i.status]}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <InterventionDrawer id={u.id || null} onClose={() => setU({ id: '' }, { resetPage: false })} />
      <NewIntervention open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setU({ id, status: 'abertas', kind: '', mine: '' }, { resetPage: false }); }} />
    </div>
  );
}

type Detail = Item & {
  rowVersion: number; goal: { id: string; title: string; target: number } | null; displayTitle: string; reason: string | null; createdByName: string | null;
  indicator: { id: string; name: string; unit: string; direction: string; months: { competencia: string; value: number | null; partial: boolean }[] } | null; diagnosis: string | null; actionPlan: string | null; planDueOn: string | null; reviewCause: string | null; reviewDecision: string | null; conclusion: string | null; resolvedByName: string | null; resolvedAt: string | null;
  chain: { id: string; name: string | null; level: number; called: boolean }[];
  closings: { competencia: string; color: TrafficColor; attainment: number | null; value: number | null; target: number; status: string }[];
  events: { id: string; type: string; createdAt: string; actorName: string | null; payload: Record<string, unknown> }[];
  can: { act: boolean; dismiss: boolean };
  analysisStatus: 'rascunho' | 'concluida' | null; config: { requireAnalysis?: boolean };
  actions: Action[]; progress: { total: number; done: number; cancelled: number; open: number; overdue: number; pct: number }; project: { id: string; name: string; code: number } | null; planCostCents: number;
};

function InterventionDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['interventions', 'one', id], enabled: !!id, queryFn: () => api<Detail>(`/interventions/${id}`) });
  const d = q.data;
  const [f, setF] = useState({ cause: '', decision: 'manter', diagnosis: '', actionPlan: '', planDueOn: '', conclusion: '', reason: '' });
  const [mode, setMode] = useState<'plan' | 'conclude' | 'dismiss' | null>(null);
  const done = (msg: string) => { void qc.invalidateQueries({ queryKey: ['interventions'] }); void qc.invalidateQueries({ queryKey: ['mentions'] }); setMode(null); toast({ tone: 'success', message: msg }); };
  const post = (path: string, body: Record<string, unknown>, msg: string) => ({ mutationFn: () => api(`/interventions/${id}/${path}`, { method: 'POST', body: { rowVersion: d!.rowVersion, ...body } }), onSuccess: () => done(msg), onError: (e: unknown) => toast({ tone: 'error', message: errMsg(e) }) });
  const review = useMutation(post('review', { cause: f.cause, decision: f.decision }, 'Revisão registrada'));
  const plan = useMutation(post('plan', { diagnosis: f.diagnosis, actionPlan: f.actionPlan, planDueOn: f.planDueOn || undefined }, 'Plano de ação registrado'));
  const conclude = useMutation(post('conclude', { conclusion: f.conclusion }, 'Intervenção concluída'));
  const dismiss = useMutation(post('dismiss', { reason: f.reason }, 'Intervenção dispensada'));
  const close = () => { setMode(null); setF({ cause: '', decision: 'manter', diagnosis: '', actionPlan: '', planDueOn: '', conclusion: '', reason: '' }); onClose(); };
  const open = d && (d.status === 'aberta' || d.status === 'em_andamento');
  const startPlan = () => { setF({ ...f, diagnosis: d!.diagnosis ?? '', actionPlan: d!.actionPlan ?? '', planDueOn: d!.planDueOn ?? '' }); setMode('plan'); };
  return (
    <Drawer open={!!id} onClose={close} title="Intervenção" width="lg">
      {!d ? <LoadingRows rows={6} /> : (
        <div className="space-y-5">
          <div>
            <p className="text-sm text-muted">{INTERVENTION_KIND_LABELS[d.kind]} · {INTERVENTION_TRIGGER_LABELS[d.trigger]}</p>
            <h3 className="text-lg font-bold text-ink">{d.goal ? <Link to={`/desempenho/metas?goal=${d.goal.id}`} className="hover:underline">{d.goal.title}</Link> : d.displayTitle}</h3>
            {d.reason && <p className="mt-1 text-sm"><b>Motivo:</b> {d.reason}{d.createdByName && <span className="text-muted"> — aberta por {d.createdByName}</span>}</p>}
            <div className="mt-1 flex flex-wrap gap-2"><Chip tone={STATUS_TONE[d.status]}>{INTERVENTION_STATUS_LABELS[d.status]}</Chip><span className="text-sm">Responsável: <b>{d.ownerName}</b>{d.subjectName && <> · Avaliado: {d.subjectName}</>}</span></div>
          </div>

          {d.indicator && <IndicatorTrend ind={d.indicator} />}

          {!!d.closings.length && <section aria-label="Apurações da série">
            <h4 className="mb-1 font-bold text-ink">Apurações</h4>
            <ol className="flex flex-wrap gap-2">
              {d.closings.map((c) => (
                <li key={c.competencia} className={clsx('rounded-md border px-3 py-2 text-sm', d.competencias.includes(c.competencia) ? 'border-ink/30' : 'border-line')}>
                  <span className="num font-semibold">{comp(c.competencia)}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs"><span className={clsx('h-2.5 w-2.5 rounded-circle', COLOR_DOT[c.color])} aria-hidden />{TRAFFIC_LABELS[c.color]} · <span className="num">{fmtAtt(c.attainment)}</span></span>
                </li>
              ))}
            </ol>
          </section>}

          {open && (
            <section className="rounded-lg border border-line p-3">
              <p className="text-sm">{d.status === 'aberta' ? (d.kind === 'plano' ? 'Registrar o diagnóstico e o plano de ação até' : 'Registrar a revisão até') : 'Concluir o plano até'} <b className={clsx('num', d.overdue && 'text-danger')}>{fmtDate(d.dueOn)}</b>{d.overdue && <span className="font-semibold text-danger"> (vencido)</span>}</p>
              {!!d.chain.length && <p className="mt-1 text-xs text-muted">Se atrasar, sobe para: {d.chain.map((c) => `${c.name}${c.called ? ' (acionado)' : ''}`).join(' → ')}</p>}
            </section>
          )}

          {(d.kind === 'plano' || d.analysisStatus) && (
            <section className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
              <div className="min-w-[200px] flex-1">
                <h4 className="font-bold text-ink">Análise de causa</h4>
                <p className="text-sm text-muted">{d.analysisStatus === 'concluida' ? 'Concluída: problema, Pareto, Ishikawa e 5 Porquês.' : d.analysisStatus === 'rascunho' ? 'Em andamento.' : d.config.requireAnalysis !== false ? 'Obrigatória antes do plano de ação.' : 'Recomendada antes do plano de ação.'}</p>
              </div>
              <Link to={`/times/intervencoes/${d.id}/analise`} className="text-sm font-semibold text-primary hover:underline">{d.analysisStatus ? 'Abrir análise' : open && d.can.act ? 'Começar análise' : 'Ver análise'}</Link>
            </section>
          )}

          {d.reviewCause && <section><h4 className="font-bold text-ink">Revisão</h4><p className="whitespace-pre-line text-sm">{d.reviewCause}</p><p className="text-xs text-muted">Decisão: {d.reviewDecision === 'plano' ? 'abrir plano de ação' : 'manter acompanhamento'}</p></section>}
          {d.diagnosis && <section><h4 className="font-bold text-ink">Diagnóstico</h4><p className="whitespace-pre-line text-sm">{d.diagnosis}</p></section>}
          {(d.actionPlan || d.planDueOn) && <section><h4 className="font-bold text-ink">Plano registrado</h4>{d.actionPlan && <p className="whitespace-pre-line text-sm">{d.actionPlan}</p>}{d.planDueOn && <p className="num text-xs text-muted">Concluir até {fmtDate(d.planDueOn)}</p>}</section>}
          {d.conclusion && <section><h4 className="font-bold text-ink">{d.status === 'dispensada' ? 'Motivo da dispensa' : 'Conclusão'}</h4><p className="whitespace-pre-line text-sm">{d.conclusion}</p>{d.resolvedByName && <p className="text-xs text-muted">{d.resolvedByName} · {d.resolvedAt && fmtDateTime(d.resolvedAt)}</p>}</section>}

          {open && !d.can.act && !d.can.dismiss && <Notice tone="info">Você acompanha esta intervenção. Quem registra a revisão ou o plano é {d.ownerName} ou quem está acima na estrutura.</Notice>}

          {open && d.can.act && d.kind === 'revisao' && d.status === 'aberta' && (
            <section className="space-y-3 rounded-lg border border-line p-3">
              <h4 className="font-bold text-ink">Revisão simplificada</h4>
              <FormField label="Causa provável" htmlFor="iv-cause" required><Textarea id="iv-cause" rows={3} value={f.cause} onChange={(e) => setF({ ...f, cause: e.target.value })} /></FormField>
              <FormField label="Decisão" htmlFor="iv-dec"><Select id="iv-dec" value={f.decision} onChange={(e) => setF({ ...f, decision: e.target.value })}><option value="manter">Manter acompanhamento (causa pontual)</option><option value="plano">Abrir plano de ação</option></Select></FormField>
              <Button variant="primary" disabled={f.cause.trim().length < 10} loading={review.isPending} onClick={() => review.mutate()}>Registrar revisão</Button>
            </section>
          )}

          {d.kind === 'plano' && (d.actions.length > 0 || (open && d.can.act)) && (
            <PlanSection d={d} canEdit={!!open && d.can.act} analysisOk={d.config.requireAnalysis === false || d.analysisStatus === 'concluida'} onChanged={() => void qc.invalidateQueries({ queryKey: ['interventions'] })} />
          )}

          {open && d.can.act && d.kind === 'plano' && (mode === 'plan' ? (
            <section className="space-y-3 rounded-lg border border-line p-3">
              <h4 className="font-bold text-ink">{d.status === 'aberta' ? 'Registrar o plano' : 'Atualizar o plano'}</h4>
              <FormField label="Diagnóstico" htmlFor="iv-diag" required hint="Vem da análise de causa; ajuste se precisar"><Textarea id="iv-diag" rows={4} value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></FormField>
              <FormField label="Resumo do plano" htmlFor="iv-plan" hint="Opcional: a estratégia em uma frase"><Textarea id="iv-plan" rows={2} value={f.actionPlan} onChange={(e) => setF({ ...f, actionPlan: e.target.value })} /></FormField>
              <FormField label="Concluir o plano até" htmlFor="iv-due" hint="Em branco: o prazo da última ação"><Input id="iv-due" type="date" value={f.planDueOn} onChange={(e) => setF({ ...f, planDueOn: e.target.value })} /></FormField>
              <div className="flex gap-2"><Button variant="secondary" onClick={() => setMode(null)}>Cancelar</Button><Button variant="primary" disabled={f.diagnosis.trim().length < 10} loading={plan.isPending} onClick={() => plan.mutate()}>Salvar plano</Button></div>
            </section>
          ) : mode === 'conclude' ? (
            <section className="space-y-3 rounded-lg border border-line p-3">
              <FormField label="Resultado do plano" htmlFor="iv-conc" required><Textarea id="iv-conc" rows={3} value={f.conclusion} onChange={(e) => setF({ ...f, conclusion: e.target.value })} /></FormField>
              <div className="flex gap-2"><Button variant="secondary" onClick={() => setMode(null)}>Cancelar</Button><Button variant="primary" disabled={f.conclusion.trim().length < 10} loading={conclude.isPending} onClick={() => conclude.mutate()}>Concluir intervenção</Button></div>
            </section>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={!d.actions.some((a) => a.status !== 'cancelada')} title={!d.actions.some((a) => a.status !== 'cancelada') ? 'Inclua pelo menos uma ação 5W2H' : undefined} onClick={startPlan}>{d.status === 'aberta' ? 'Registrar plano de ação' : 'Atualizar plano'}</Button>
              {d.status === 'em_andamento' && <Button variant="secondary" disabled={d.progress.open > 0 || d.progress.done === 0} title={d.progress.open > 0 ? 'Há ações em aberto' : undefined} onClick={() => setMode('conclude')}>Concluir intervenção</Button>}
            </div>
          ))}

          {open && d.can.dismiss && (mode === 'dismiss' ? (
            <section className="space-y-3 rounded-lg border border-line p-3">
              <FormField label="Por que dispensar" htmlFor="iv-why" required><Textarea id="iv-why" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></FormField>
              <div className="flex gap-2"><Button variant="secondary" onClick={() => setMode(null)}>Cancelar</Button><Button variant="danger" disabled={f.reason.trim().length < 10} loading={dismiss.isPending} onClick={() => dismiss.mutate()}>Dispensar</Button></div>
            </section>
          ) : mode === null && <button type="button" className="text-sm font-semibold text-muted hover:text-ink hover:underline" onClick={() => setMode('dismiss')}>Dispensar intervenção</button>)}

          <section>
            <h4 className="mb-1 font-bold text-ink">Histórico</h4>
            <ol className="space-y-1 text-sm">{d.events.map((e) => <li key={e.id}><span className="num text-xs text-muted">{fmtDateTime(e.createdAt)}</span> · {e.actorName ?? 'Sistema'}: {EVENT_TEXT[e.type] ?? e.type}{typeof e.payload.competencia === 'string' && ` (${comp(e.payload.competencia)})`}</li>)}</ol>
          </section>
        </div>
      )}
    </Drawer>
  );
}

type Action = { id: string; activityId: string; what: string; why: string; where: string; how: string; howMuchCents: number | null; cancelReason: string | null; status: string; ownerName: string; dueOn: string | null; projectId: string | null };
const TASK_STATUS_LABELS: Record<string, string> = { a_fazer: 'A fazer', em_andamento: 'Em andamento', aguardando: 'Aguardando', em_aprovacao: 'Em aprovação', concluida: 'Concluída', cancelada: 'Cancelada' };
const TASK_TONE: Record<string, Tone> = { a_fazer: 'neutral', em_andamento: 'blue', aguardando: 'orange', em_aprovacao: 'sky', concluida: 'green', cancelada: 'neutral' };

/** Plano 5W2H: cada ação é uma tarefa real (quem, quando e situação vêm dela); projeto opcional recebe as novas ações. */
function PlanSection({ d, canEdit, analysisOk, onChanged }: { d: Detail; canEdit: boolean; analysisOk: boolean; onChanged: () => void }) {
  const toast = useToast();
  const users = useLookups().data?.users ?? [];
  const an = useQuery({ queryKey: ['interventions', 'analysis', d.id], enabled: canEdit, queryFn: () => api<{ content: { whys: { rootCause: string; confirmed: boolean }[] } }>(`/interventions/${d.id}/analysis`) });
  const roots = (an.data?.content.whys ?? []).filter((w) => w.confirmed && w.rootCause.trim()).map((w) => w.rootCause.trim());
  const today = new Date().toLocaleDateString('en-CA');
  const blank = { what: '', why: '', where: '', whenDue: '', whoId: '', how: '', howMuch: '' };
  const [f, setF] = useState(blank);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<{ id: string; reason: string } | null>(null);
  const [newProject, setNewProject] = useState(false);
  const projects = useQuery({ queryKey: ['projects', 'mine-open'], enabled: canEdit && !d.project, queryFn: () => api<{ items: { id: string; code: number; name: string }[] }>('/projects') });
  const fail = (e: unknown) => toast({ tone: 'error', message: errMsg(e) });
  const add = useMutation({
    mutationFn: () => api(`/interventions/${d.id}/actions`, { method: 'POST', body: { what: f.what, why: f.why, where: f.where, whenDue: f.whenDue, whoId: f.whoId || null, how: f.how, howMuchCents: f.howMuch.trim() ? toCents(f.howMuch) : null, rootCause: roots.includes(f.why) ? f.why : null } }),
    onSuccess: () => { setF(blank); setAdding(false); onChanged(); toast({ tone: 'success', message: 'Ação incluída e tarefa criada para quem executa' }); },
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: () => api(`/interventions/${d.id}/actions/${cancelling!.id}/cancel`, { method: 'POST', body: { reason: cancelling!.reason } }),
    onSuccess: () => { setCancelling(null); onChanged(); toast({ tone: 'success', message: 'Ação cancelada' }); },
    onError: fail,
  });
  const link = useMutation({
    mutationFn: (projectId: string | null) => api(`/interventions/${d.id}/project`, { method: 'POST', body: { projectId } }),
    onSuccess: () => { onChanged(); toast({ tone: 'success', message: 'Projeto do plano atualizado' }); },
    onError: fail,
  });
  const p = d.progress;
  const valid = f.what.trim().length >= 5 && f.why.trim().length >= 5 && f.how.trim().length >= 5 && !!f.whoId && !!f.whenDue && f.whenDue >= today;
  return (
    <section className="space-y-3 rounded-lg border border-line p-3" aria-label="Plano de ação 5W2H">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-bold text-ink">Plano de ação (5W2H)</h4>
        {p.total > 0 && <span className="text-sm"><span className="num font-semibold">{p.done}</span> de <span className="num">{p.total - p.cancelled}</span> ações concluídas{p.overdue > 0 && <span className="font-semibold text-danger"> · <span className="num">{p.overdue}</span> atrasada(s)</span>}{d.planCostCents > 0 && <> · custo previsto <span className="num">{fmtBRL(d.planCostCents)}</span></>}</span>}
      </div>
      {p.total > 0 && <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Andamento do plano" aria-valuenow={Math.round(p.pct * 100)} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-success" style={{ width: `${Math.round(p.pct * 100)}%` }} /></div>}
      {!analysisOk && canEdit && <Notice tone="info">Conclua a análise de causa para montar o plano.</Notice>}

      {!!d.actions.length && (
        <ul className="divide-y divide-line">
          {d.actions.map((a) => (
            <li key={a.id} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-start gap-2">
                <Link to={`/tarefas?task=${a.activityId}`} className={clsx('min-w-0 flex-1 font-semibold hover:underline', a.status === 'cancelada' ? 'text-muted line-through' : 'text-primary')}>{a.what}</Link>
                <Chip tone={TASK_TONE[a.status] ?? 'neutral'}>{TASK_STATUS_LABELS[a.status] ?? a.status}</Chip>
              </div>
              <p className="text-xs text-muted">{a.ownerName} · até <span className={clsx('num', a.dueOn && a.dueOn < today && a.status !== 'concluida' && a.status !== 'cancelada' && 'font-semibold text-danger')}>{a.dueOn ? fmtDate(a.dueOn) : '—'}</span>{a.where && <> · {a.where}</>}{a.howMuchCents ? <> · <span className="num">{fmtBRL(a.howMuchCents)}</span></> : null}</p>
              <p className="mt-0.5 text-xs"><b>Por quê:</b> {a.why} · <b>Como:</b> {a.how}</p>
              {a.cancelReason && <p className="text-xs text-muted">Cancelada: {a.cancelReason}</p>}
              {canEdit && a.status !== 'concluida' && a.status !== 'cancelada' && (cancelling?.id === a.id ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <FormField label="Motivo do cancelamento" htmlFor={`cx-${a.id}`} className="min-w-[220px] flex-1"><Input id={`cx-${a.id}`} value={cancelling.reason} onChange={(e) => setCancelling({ id: a.id, reason: e.target.value })} /></FormField>
                  <Button variant="secondary" size="sm" onClick={() => setCancelling(null)}>Voltar</Button>
                  <Button variant="danger" size="sm" disabled={cancelling.reason.trim().length < 10} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancelar ação</Button>
                </div>
              ) : <button type="button" className="mt-1 text-xs font-semibold text-muted hover:text-ink hover:underline" onClick={() => setCancelling({ id: a.id, reason: '' })}>Cancelar ação</button>)}
            </li>
          ))}
        </ul>
      )}

      {canEdit && analysisOk && (adding ? (
        <div className="space-y-3 rounded-md bg-surface-2 p-3">
          <FormField label="O quê" htmlFor="w-what" required><Input id="w-what" value={f.what} onChange={(e) => setF({ ...f, what: e.target.value })} /></FormField>
          <FormField label="Por quê" htmlFor="w-why" required hint={roots.length ? 'Escolha a causa raiz que a ação ataca ou escreva' : 'Qual causa a ação ataca'}>
            <Input id="w-why" list="w-roots" value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} />
          </FormField>
          <datalist id="w-roots">{roots.map((r) => <option key={r} value={r} />)}</datalist>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Quem" htmlFor="w-who" required><Select id="w-who" value={f.whoId} onChange={(e) => setF({ ...f, whoId: e.target.value })}><option value="">Escolha</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
            <FormField label="Quando (prazo)" htmlFor="w-when" required><Input id="w-when" type="date" min={today} value={f.whenDue} onChange={(e) => setF({ ...f, whenDue: e.target.value })} /></FormField>
            <FormField label="Onde" htmlFor="w-where"><Input id="w-where" value={f.where} onChange={(e) => setF({ ...f, where: e.target.value })} /></FormField>
            <FormField label="Quanto custa (R$)" htmlFor="w-much" hint="Em branco: sem custo"><Input id="w-much" inputMode="decimal" value={f.howMuch} onChange={(e) => setF({ ...f, howMuch: e.target.value })} /></FormField>
          </div>
          <FormField label="Como" htmlFor="w-how" required><Textarea id="w-how" rows={2} value={f.how} onChange={(e) => setF({ ...f, how: e.target.value })} /></FormField>
          {d.project && <p className="text-xs text-muted">A tarefa entra no projeto {d.project.name}; quem executa precisa estar na equipe dele.</p>}
          <div className="flex gap-2"><Button variant="secondary" onClick={() => { setAdding(false); setF(blank); }}>Cancelar</Button><Button variant="primary" disabled={!valid} loading={add.isPending} onClick={() => add.mutate()}>Incluir ação</Button></div>
        </div>
      ) : <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Nova ação 5W2H</Button>)}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
        <span className="font-semibold text-ink">Projeto:</span>
        {d.project ? (
          <>
            <Link to={`/projetos/${d.project.id}`} className="font-semibold text-primary hover:underline">{d.project.name}</Link>
            {canEdit && <button type="button" className="text-xs font-semibold text-muted hover:underline" onClick={() => link.mutate(null)}>desligar</button>}
          </>
        ) : canEdit ? (
          <>
            <Select aria-label="Ligar projeto existente" className="h-8 w-56 text-sm" value="" onChange={(e) => e.target.value && link.mutate(e.target.value)}><option value="">Ligar projeto existente…</option>{(projects.data?.items ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
            <Button variant="ghost" size="sm" onClick={() => setNewProject(true)}>Criar projeto do plano</Button>
          </>
        ) : <span className="text-muted">nenhum (ações como tarefas avulsas)</span>}
      </div>
      <NewProjectDialog open={newProject} onClose={() => setNewProject(false)} prefill={{ name: `Plano de ação — ${d.displayTitle}` }} onCreated={(id) => link.mutate(id)} />
    </section>
  );
}

/** Evolução do indicador acompanhado (6 meses; o atual é parcial). */
function IndicatorTrend({ ind }: { ind: NonNullable<Detail['indicator']> }) {
  const vals = ind.months.map((m) => m.value ?? 0);
  const max = Math.max(1, ...vals);
  return (
    <section aria-label={`Evolução de ${ind.name}`}>
      <h4 className="mb-1 font-bold text-ink">{ind.name}</h4>
      <p className="mb-2 text-xs text-muted">Últimos 6 meses no escopo da intervenção ({ind.direction === 'menor' ? 'menor é melhor' : 'maior é melhor'}).</p>
      <ol className="flex items-end gap-2">
        {ind.months.map((m) => (
          <li key={m.competencia} className="flex flex-1 flex-col items-center gap-1">
            <span className="num text-xs font-semibold">{m.value === null ? '—' : fmtIndicator(m.value, ind.unit)}</span>
            <span className={clsx('w-full rounded-t', m.partial ? 'bg-primary/30' : 'bg-primary')} style={{ height: `${Math.max(4, ((m.value ?? 0) / max) * 64)}px` }} aria-hidden />
            <span className="num text-xs text-muted">{comp(m.competencia)}{m.partial && '*'}</span>
          </li>
        ))}
      </ol>
      <p className="mt-1 text-xs text-muted">* mês em andamento</p>
    </section>
  );
}

type NewOptions = { indicators: { id: string; name: string; category: string }[]; teams: { id: string; name: string }[]; units: { id: string; name: string }[]; people: { id: string; name: string }[]; owners: { id: string; name: string }[]; canCompany: boolean };
/** Abrir intervenção por iniciativa própria: escolher o indicador, o escopo e o motivo. */
function NewIntervention({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const o = useQuery({ queryKey: ['interventions', 'new-options'], enabled: open, queryFn: () => api<NewOptions>('/interventions/new-options') });
  const blank = { title: '', reason: '', indicatorId: '', scope: 'pessoa' as 'pessoa' | 'time' | 'unidade' | 'empresa', target: '', ownerId: '', dueOn: '' };
  const [f, setF] = useState(blank);
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/interventions', { method: 'POST', body: {
      title: f.title, reason: f.reason, indicatorId: f.indicatorId || null,
      subjectUserId: f.scope === 'pessoa' ? f.target || null : null, teamId: f.scope === 'time' ? f.target || null : null, orgUnitId: f.scope === 'unidade' ? f.target || null : null,
      ownerId: f.ownerId || undefined, dueOn: f.dueOn || undefined,
    } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['interventions'] }); setF(blank); toast({ tone: 'success', message: 'Intervenção aberta. Comece pela análise de causa.' }); onCreated(r.id); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const d = o.data;
  const targets = f.scope === 'pessoa' ? d?.people : f.scope === 'time' ? d?.teams : f.scope === 'unidade' ? d?.units : [];
  const valid = f.title.trim().length >= 5 && f.reason.trim().length >= 10 && (f.scope === 'empresa' || !!f.target);
  return (
    <Modal open={open} onClose={onClose} title="Nova intervenção" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Abrir intervenção</Button></>}>
      {!d ? <LoadingRows rows={4} /> : (
        <div className="space-y-4">
          <p className="text-sm text-muted">Para agir antes de a meta ficar vermelha, ou sobre um problema ou oportunidade. O roteiro é o mesmo: análise de causa, plano 5W2H com tarefas e conclusão.</p>
          <FormField label="Indicador" htmlFor="ni-ind" hint="O que você quer melhorar; a ficha mostra a evolução dele no escopo escolhido">
            <Select id="ni-ind" value={f.indicatorId} onChange={(e) => setF({ ...f, indicatorId: e.target.value, title: f.title || (d.indicators.find((x) => x.id === e.target.value)?.name ?? '') })}>
              <option value="">Sem indicador</option>{d.indicators.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Problema ou oportunidade" htmlFor="ni-title" required><Input id="ni-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
          <FormField label="Por que abrir agora" htmlFor="ni-reason" required hint="O sinal que você viu: tendência, reclamação, risco, oportunidade"><Textarea id="ni-reason" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Sobre" htmlFor="ni-scope"><Select id="ni-scope" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as typeof f.scope, target: '' })}><option value="pessoa">Uma pessoa</option><option value="time">Um time</option><option value="unidade">Uma unidade</option>{d.canCompany && <option value="empresa">A empresa toda</option>}</Select></FormField>
            {f.scope !== 'empresa' && <FormField label={f.scope === 'pessoa' ? 'Pessoa' : f.scope === 'time' ? 'Time' : 'Unidade'} htmlFor="ni-target" required><Select id="ni-target" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}><option value="">Escolha</option>{(targets ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>}
            <FormField label="Responsável" htmlFor="ni-owner"><Select id="ni-owner" value={f.ownerId || me?.user.id || ''} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{d.owners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
            <FormField label="Prazo para o plano" htmlFor="ni-due" hint="Em branco: o padrão da empresa"><Input id="ni-due" type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></FormField>
          </div>
        </div>
      )}
    </Modal>
  );
}
