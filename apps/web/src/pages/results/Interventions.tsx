/** Gestão de Times → Intervenções: o que a apuração oficial exige de ação (vermelho, dois amarelos seguidos, revisão do primeiro amarelo). */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Siren } from 'lucide-react';
import {
  INTERVENTION_KIND_LABELS, INTERVENTION_STATUS_LABELS, INTERVENTION_TRIGGER_LABELS, TRAFFIC_LABELS,
  type InterventionKind, type InterventionStatus, type InterventionTrigger, type TrafficColor,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Drawer, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';
import { fmtAtt } from '../../features/performance/format';

type Item = { id: string; kind: InterventionKind; trigger: InterventionTrigger; status: InterventionStatus; competencias: string[]; goalId: string; goalTitle: string; ownerName: string; subjectName: string | null; teamName: string | null; unitName: string | null; dueOn: string; overdue: boolean; escalationLevel: number; escalatedTo: string | null };
type Counts = { abertas: number; planos: number; revisoes: number; atrasadas: number; escaladas: number; minhas: number };
const STATUS_TONE: Record<InterventionStatus, Tone> = { aberta: 'orange', em_andamento: 'blue', concluida: 'green', dispensada: 'neutral' };
const COLOR_DOT: Record<string, string> = { verde: 'bg-success', amarelo: 'bg-warning', vermelho: 'bg-danger', sem_dado: 'bg-line' };
const comp = (c: string) => { const [y, m] = c.split('-'); return `${m}/${y}`; };
const EVENT_TEXT: Record<string, string> = {
  aberta: 'abriu a intervenção', promovida: 'virou plano de ação obrigatório', reincidencia: 'nova competência fora da meta (reincidência)', escalada: 'prazo vencido: escalonada',
  revisada: 'registrou a revisão', plano_registrado: 'registrou o plano de ação', plano_atualizado: 'atualizou o plano de ação', concluida: 'concluiu', dispensada: 'dispensou',
  dispensada_retificacao: 'dispensada automaticamente após retificação da apuração',
};

export function InterventionsPage() {
  const [u, setU] = useUrlState({ status: 'abertas', kind: '', mine: '', id: '' });
  const q = useQuery({
    queryKey: ['interventions', u.status, u.kind, u.mine], placeholderData: keepPreviousData,
    queryFn: () => api<{ today: string; counts: Counts; items: Item[] }>(`/interventions${qs({ status: u.status, kind: u.kind || undefined, mine: u.mine ? 'true' : undefined })}`),
  });
  const c = q.data?.counts;
  return (
    <div>
      <PageHeader icon={<Siren />} title="Intervenções" subtitle="Metas que a apuração oficial pôs fora da faixa: o que precisa de plano, o que pede revisão e o que está atrasado." />
      {c && (
        <ul className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Resumo das intervenções abertas">
          {([['planos', 'Planos obrigatórios', 'kind', 'plano'], ['revisoes', 'Revisões de amarelo', 'kind', 'revisao'], ['atrasadas', 'Com prazo vencido', null, null], ['escaladas', 'Escalonadas', null, null], ['minhas', 'Comigo', 'mine', '1']] as const).map(([k, label, fk, fv]) => (
            <li key={k}>
              <button type="button" disabled={!fk} onClick={() => fk && setU({ status: 'abertas', kind: fk === 'kind' ? (u.kind === fv ? '' : fv) : '', mine: fk === 'mine' ? (u.mine ? '' : '1') : '' })}
                className={clsx('w-full rounded-lg border p-4 text-left', (fk === 'kind' && u.kind === fv) || (fk === 'mine' && u.mine) ? 'border-primary bg-primary/5' : 'border-line bg-surface', (k === 'atrasadas' || k === 'escaladas') && c[k] > 0 && 'border-danger/40 text-danger')}>
                <span className="block text-sm font-semibold">{label}</span><span className="num text-2xl font-bold">{c[k]}</span>
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
              <thead className="bg-surface-2 text-xs text-muted"><tr>{['Meta', 'Motivo', 'Competências', 'De quem', 'Responsável', 'Prazo', 'Situação'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {q.data!.items.map((i) => (
                  <tr key={i.id} className="border-t border-line align-top">
                    <td className="px-3 py-2.5"><button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => setU({ id: i.id }, { resetPage: false })}>{i.goalTitle}</button><span className="block text-xs text-muted">{INTERVENTION_KIND_LABELS[i.kind]}</span></td>
                    <td className="px-3 py-2.5"><Chip tone={i.trigger === 'primeiro_amarelo' ? 'orange' : 'red'}>{INTERVENTION_TRIGGER_LABELS[i.trigger]}</Chip></td>
                    <td className="num px-3 py-2.5">{i.competencias.map(comp).join(', ')}</td>
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
    </div>
  );
}

type Detail = Item & {
  rowVersion: number; goal: { id: string; title: string; target: number }; diagnosis: string | null; actionPlan: string | null; planDueOn: string | null; reviewCause: string | null; reviewDecision: string | null; conclusion: string | null; resolvedByName: string | null; resolvedAt: string | null;
  chain: { id: string; name: string | null; level: number; called: boolean }[];
  closings: { competencia: string; color: TrafficColor; attainment: number | null; value: number | null; target: number; status: string }[];
  events: { id: string; type: string; createdAt: string; actorName: string | null; payload: Record<string, unknown> }[];
  can: { act: boolean; dismiss: boolean };
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
  const plan = useMutation(post('plan', { diagnosis: f.diagnosis, actionPlan: f.actionPlan, planDueOn: f.planDueOn }, 'Plano de ação registrado'));
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
            <h3 className="text-lg font-bold text-ink"><Link to={`/desempenho/metas?goal=${d.goal.id}`} className="hover:underline">{d.goal.title}</Link></h3>
            <div className="mt-1 flex flex-wrap gap-2"><Chip tone={STATUS_TONE[d.status]}>{INTERVENTION_STATUS_LABELS[d.status]}</Chip><span className="text-sm">Responsável: <b>{d.ownerName}</b>{d.subjectName && <> · Avaliado: {d.subjectName}</>}</span></div>
          </div>

          <section aria-label="Apurações da série">
            <h4 className="mb-1 font-bold text-ink">Apurações</h4>
            <ol className="flex flex-wrap gap-2">
              {d.closings.map((c) => (
                <li key={c.competencia} className={clsx('rounded-md border px-3 py-2 text-sm', d.competencias.includes(c.competencia) ? 'border-ink/30' : 'border-line')}>
                  <span className="num font-semibold">{comp(c.competencia)}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs"><span className={clsx('h-2.5 w-2.5 rounded-full', COLOR_DOT[c.color])} aria-hidden />{TRAFFIC_LABELS[c.color]} · <span className="num">{fmtAtt(c.attainment)}</span></span>
                </li>
              ))}
            </ol>
          </section>

          {open && (
            <section className="rounded-lg border border-line p-3">
              <p className="text-sm">{d.status === 'aberta' ? (d.kind === 'plano' ? 'Registrar o diagnóstico e o plano de ação até' : 'Registrar a revisão até') : 'Concluir o plano até'} <b className={clsx('num', d.overdue && 'text-danger')}>{fmtDate(d.dueOn)}</b>{d.overdue && <span className="font-semibold text-danger"> (vencido)</span>}</p>
              {!!d.chain.length && <p className="mt-1 text-xs text-muted">Se atrasar, sobe para: {d.chain.map((c) => `${c.name}${c.called ? ' (acionado)' : ''}`).join(' → ')}</p>}
            </section>
          )}

          {d.reviewCause && <section><h4 className="font-bold text-ink">Revisão</h4><p className="whitespace-pre-line text-sm">{d.reviewCause}</p><p className="text-xs text-muted">Decisão: {d.reviewDecision === 'plano' ? 'abrir plano de ação' : 'manter acompanhamento'}</p></section>}
          {d.diagnosis && <section><h4 className="font-bold text-ink">Diagnóstico</h4><p className="whitespace-pre-line text-sm">{d.diagnosis}</p></section>}
          {d.actionPlan && <section><h4 className="font-bold text-ink">Plano de ação</h4><p className="whitespace-pre-line text-sm">{d.actionPlan}</p>{d.planDueOn && <p className="num text-xs text-muted">Prazo: {fmtDate(d.planDueOn)}</p>}</section>}
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

          {open && d.can.act && d.kind === 'plano' && (mode === 'plan' ? (
            <section className="space-y-3 rounded-lg border border-line p-3">
              <h4 className="font-bold text-ink">Plano de ação</h4>
              <FormField label="Diagnóstico" htmlFor="iv-diag" required hint="O que explica o resultado?"><Textarea id="iv-diag" rows={3} value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></FormField>
              <FormField label="Ações" htmlFor="iv-plan" required hint="O que será feito, por quem e quando"><Textarea id="iv-plan" rows={4} value={f.actionPlan} onChange={(e) => setF({ ...f, actionPlan: e.target.value })} /></FormField>
              <FormField label="Concluir até" htmlFor="iv-due" required><Input id="iv-due" type="date" value={f.planDueOn} onChange={(e) => setF({ ...f, planDueOn: e.target.value })} /></FormField>
              <div className="flex gap-2"><Button variant="secondary" onClick={() => setMode(null)}>Cancelar</Button><Button variant="primary" disabled={f.diagnosis.trim().length < 10 || f.actionPlan.trim().length < 10 || !f.planDueOn} loading={plan.isPending} onClick={() => plan.mutate()}>Salvar plano</Button></div>
            </section>
          ) : mode === 'conclude' ? (
            <section className="space-y-3 rounded-lg border border-line p-3">
              <FormField label="Resultado do plano" htmlFor="iv-conc" required><Textarea id="iv-conc" rows={3} value={f.conclusion} onChange={(e) => setF({ ...f, conclusion: e.target.value })} /></FormField>
              <div className="flex gap-2"><Button variant="secondary" onClick={() => setMode(null)}>Cancelar</Button><Button variant="primary" disabled={f.conclusion.trim().length < 10} loading={conclude.isPending} onClick={() => conclude.mutate()}>Concluir intervenção</Button></div>
            </section>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={startPlan}>{d.status === 'aberta' ? 'Registrar plano de ação' : 'Atualizar plano'}</Button>
              {d.status === 'em_andamento' && <Button variant="secondary" onClick={() => setMode('conclude')}>Concluir</Button>}
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
