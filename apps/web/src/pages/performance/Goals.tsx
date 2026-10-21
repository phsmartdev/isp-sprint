/** Objetivos e metas: cascata Diretoria → Gestão → Liderança → pessoa, semáforo, ritmo, governança das alterações. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CornerDownRight, Plus, Target } from 'lucide-react';
import {
  CONSOLIDATIONS, CONSOLIDATION_LABELS, GOAL_CATEGORIES, GOAL_CATEGORY_LABELS, GOAL_SCOPES, GOAL_SCOPE_LABELS, GOAL_STATUS_LABELS, OBJECTIVE_LEVELS, OBJECTIVE_LEVEL_LABELS, PERIOD_LABELS, PERIOD_TYPES, TRAFFIC_LABELS,
  type Consolidation, type GoalStatus, type ObjectiveLevel, type PeriodType, type TrafficColor,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useLookups, useUrlState } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Tabs, Textarea } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';
import { TRAFFIC_TONE, fmtAtt, fmtIndicator } from '../../features/performance/format';
import type { IndicatorRow } from '../../features/performance/IndicatorBuilder';

type Progress = { value: number | null; status: GoalStatus; attainment: number | null; expected: number | null; indicatorStatus: string; closed: boolean; partial?: boolean; direction: 'maior' | 'menor'; unit: string; color: TrafficColor };
export type Goal = {
  id: string; title: string; scope: 'individual' | 'equipe' | 'empresa'; category: string; indicatorId: string | null; indicatorName?: string | null; manualUnit: string | null; userId: string | null; userName?: string | null; teamId: string | null; teamName?: string | null;
  ownerId: string; periodType: PeriodType; periodStart: string; periodEnd: string; target: number; originalTarget: number; version: number; objectiveId: string | null; parentGoalId: string | null; weight: number; consolidation: Consolidation; notes: string | null; status: string; rowVersion: number; progress: Progress;
};
type Objective = { id: string; title: string; description: string | null; level: ObjectiveLevel; parentId: string | null; ownerName: string; periodStart: string; periodEnd: string; status: string; priority: string; goals: Goal[]; progress: number | null; rowVersion: number };

const who = (g: Goal) => (g.scope === 'empresa' ? 'Empresa' : g.scope === 'equipe' ? `Equipe ${g.teamName ?? ''}` : g.userName ?? 'Pessoa');

export function GoalStatusChips({ p }: { p: Progress }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Chip tone={TRAFFIC_TONE[p.color]} title={p.partial ? 'Parcial: cor pelo ritmo até hoje; o oficial é o fechamento do período' : 'Fechamento oficial do período'}>{TRAFFIC_LABELS[p.color]}{p.partial && p.color !== 'sem_dado' ? ' (parcial)' : ''}</Chip>
      <Chip tone={p.status === 'atingida' || p.status === 'no_ritmo' ? 'green' : p.status === 'em_risco' ? 'yellow' : p.status === 'indisponivel' || p.status === 'nao_iniciada' ? 'neutral' : 'red'}>{GOAL_STATUS_LABELS[p.status]}</Chip>
      {p.closed && <Chip tone="blue">Fechada</Chip>}
    </span>
  );
}

export function GoalBar({ g }: { g: Goal }) {
  const p = g.progress;
  const pct = p.attainment === null ? 0 : Math.min(100, Math.max(0, p.attainment * 100));
  const exp = p.expected !== null && g.target ? Math.min(100, (p.expected / g.target) * 100) : null;
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`Atingimento de ${g.title}`}>
      <div className={clsx('h-full rounded-full', p.color === 'verde' ? 'bg-success' : p.color === 'amarelo' ? 'bg-warning' : p.color === 'vermelho' ? 'bg-danger' : 'bg-muted')} style={{ width: `${pct}%` }} />
      {exp !== null && g.progress.direction === 'maior' && !p.closed && <span className="absolute top-0 h-full w-0.5 bg-ink/60" style={{ left: `${exp}%` }} title="Esperado até hoje" aria-hidden />}
    </div>
  );
}

export function GoalsPage() {
  const [u, setU] = useUrlState({ t: 'metas', goal: '' });
  return (
    <div>
      <PageHeader icon={<Target />} title="Objetivos e metas" subtitle="Desdobramento da estratégia em metas de equipe e individuais, calculadas pelos dados reais do sistema." />
      <Tabs label="Objetivos e metas" value={u.t as 'metas' | 'objetivos'} onChange={(t) => setU({ t })} tabs={[{ key: 'metas', label: 'Metas' }, { key: 'objetivos', label: 'Objetivos' }]} className="mb-4" />
      {u.t === 'objetivos' ? <Objectives onGoal={(id) => setU({ goal: id }, { resetPage: false })} /> : <GoalsList onGoal={(id) => setU({ goal: id }, { resetPage: false })} />}
      <GoalDrawer id={u.goal || null} onClose={() => setU({ goal: '' }, { resetPage: false })} onOpen={(id) => setU({ goal: id }, { resetPage: false })} />
    </div>
  );
}

function GoalsList({ onGoal }: { onGoal: (id: string) => void }) {
  const { can } = useAuth();
  const [f, setF] = useState({ scope: '', current: true });
  const [creating, setCreating] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['performance', 'goals', f], queryFn: () => api<{ items: Goal[] }>(`/performance/goals${qs({ scope: f.scope || undefined, current: f.current ? 'true' : undefined })}`) });
  const items = q.data?.items ?? [];
  const roots = items.filter((g) => !g.parentGoalId || !items.some((x) => x.id === g.parentGoalId));
  const kids = (id: string) => items.filter((g) => g.parentGoalId === id);
  const row = (g: Goal, depth: number): React.ReactNode => (
    <div key={g.id}>
      <div className={clsx('flex flex-wrap items-center gap-3 border-t border-line px-4 py-3', depth > 0 && 'bg-surface-2/40')} style={{ paddingLeft: 16 + depth * 24 }}>
        {depth > 0 && <CornerDownRight className="h-4 w-4 text-muted" aria-hidden />}
        <button type="button" className="min-w-[200px] flex-1 text-left" onClick={() => onGoal(g.id)}>
          <span className="block font-semibold text-primary hover:underline">{g.title}</span>
          <span className="text-xs text-muted">{who(g)} · {g.indicatorName ?? `manual (${g.manualUnit})`} · {fmtDate(g.periodStart)} a {fmtDate(g.periodEnd)}{g.version > 1 ? ` · revisada (v${g.version})` : ''}</span>
        </button>
        <span className="num w-44 text-right text-sm"><span className="font-semibold text-ink">{fmtIndicator(g.progress.value, g.progress.unit)}</span> de {fmtIndicator(g.target, g.progress.unit)}</span>
        <span className="w-40"><GoalBar g={g} /><span className="num text-xs text-muted">{fmtAtt(g.progress.attainment)}</span></span>
        <GoalStatusChips p={g.progress} />
        {can('desempenho', 'equipe') && depth < 2 && <Button size="sm" variant="ghost" onClick={() => setCreating(g.id)}>Desdobrar</Button>}
      </div>
      {kids(g.id).map((k) => row(k, depth + 1))}
    </div>
  );
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Nível" htmlFor="gl-scope"><Select id="gl-scope" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}><option value="">Todos</option>{GOAL_SCOPES.map((x) => <option key={x} value={x}>{GOAL_SCOPE_LABELS[x]}</option>)}</Select></FormField>
          <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={f.current} onChange={(e) => setF({ ...f, current: e.target.checked })} />Só do período atual</label>
        </div>
        {can('desempenho', 'equipe') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating('')}>Nova meta</Button>}
      </div>
      {q.isLoading ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !items.length ? <div className="border-t border-line"><EmptyState title="Nenhuma meta" description="Defina a meta da empresa e desdobre para equipes e pessoas." /></div> : roots.map((g) => row(g, 0))}
      <NewGoal parentId={creating} onClose={() => setCreating(null)} goals={items} />
    </section>
  );
}

function NewGoal({ parentId, onClose, goals, objectiveId }: { parentId: string | null; onClose: () => void; goals: Goal[]; objectiveId?: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { level } = useAuth();
  const lk = useLookups().data;
  const inds = useQuery({ queryKey: ['performance', 'indicators'], enabled: parentId !== null, queryFn: () => api<{ items: IndicatorRow[] }>('/performance/indicators') });
  const objs = useQuery({ queryKey: ['performance', 'objectives'], enabled: parentId !== null, queryFn: () => api<{ items: Objective[] }>('/performance/objectives?active=true') });
  const parent = goals.find((g) => g.id === parentId);
  const total = level('desempenho') === 'total';
  const blank = () => ({ title: '', scope: (parent ? (parent.scope === 'empresa' ? 'equipe' : 'individual') : total ? 'empresa' : 'individual') as Goal['scope'], indicatorId: parent?.indicatorId ?? '', manualUnit: '', userId: '', teamId: '', periodType: (parent?.periodType ?? 'mes') as PeriodType, periodStart: parent?.periodStart ?? '', periodEnd: parent?.periodEnd ?? '', target: '', category: 'comercial', objectiveId: objectiveId ?? parent?.objectiveId ?? '', weight: '1', consolidation: 'indicador' as Consolidation });
  const [f, setF] = useState(blank);
  const [key, setKey] = useState<string | null>(null);
  if (parentId !== key) { setKey(parentId); setF(blank()); }
  const m = useMutation({
    mutationFn: () => api('/performance/goals', { method: 'POST', body: {
      title: f.title, scope: f.scope, category: f.category, indicatorId: f.indicatorId || null, manualUnit: f.indicatorId ? null : f.manualUnit || null, userId: f.userId || null, teamId: f.teamId || null,
      periodType: f.periodType, periodStart: f.periodStart || undefined, periodEnd: f.periodType === 'personalizado' ? f.periodEnd : undefined, ref: f.periodType !== 'personalizado' ? f.periodStart || undefined : undefined,
      target: Number(f.target.replace(',', '.')), parentGoalId: parent?.id ?? null, objectiveId: f.objectiveId || null, weight: Number(f.weight) || 1, consolidation: f.consolidation,
    } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['performance'] }); onClose(); toast({ tone: 'success', message: 'Meta criada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const scopes = GOAL_SCOPES.filter((x) => (x !== 'empresa' || total) && (!parent || GOAL_SCOPES.indexOf(x) >= GOAL_SCOPES.indexOf(parent.scope) + 0) && !(parent && x === parent.scope && x === 'empresa'));
  return (
    <Modal open={parentId !== null} onClose={onClose} title={parent ? `Desdobrar: ${parent.title}` : 'Nova meta'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={f.title.trim().length < 3 || !f.target || (!f.indicatorId && !f.manualUnit)} loading={m.isPending} onClick={() => m.mutate()}>Criar meta</Button></>}>
      <div className="space-y-4">
        <FormField label="Título" htmlFor="ng-title" required><Input id="ng-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Nível" htmlFor="ng-scope"><Select id="ng-scope" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as Goal['scope'] })}>{scopes.map((x) => <option key={x} value={x}>{GOAL_SCOPE_LABELS[x]}</option>)}</Select></FormField>
          {f.scope === 'equipe' && <FormField label="Equipe" htmlFor="ng-team"><Select id="ng-team" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}><option value="">Escolha</option>{lk?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>}
          {f.scope === 'individual' && <FormField label="Pessoa" htmlFor="ng-user"><Select id="ng-user" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Escolha</option>{lk?.users.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>}
          <FormField label="Indicador" htmlFor="ng-ind" hint="Sem indicador: meta manual com apontamentos"><Select id="ng-ind" value={f.indicatorId} onChange={(e) => setF({ ...f, indicatorId: e.target.value })}><option value="">Meta manual</option>{inds.data?.items.filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.def.name}</option>)}</Select></FormField>
          {!f.indicatorId && <FormField label="Unidade da meta manual" htmlFor="ng-unit"><Input id="ng-unit" value={f.manualUnit} onChange={(e) => setF({ ...f, manualUnit: e.target.value })} placeholder="visitas, treinamentos…" /></FormField>}
          <FormField label="Valor-alvo" htmlFor="ng-target" required><Input id="ng-target" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></FormField>
          <FormField label="Período" htmlFor="ng-period"><Select id="ng-period" value={f.periodType} onChange={(e) => setF({ ...f, periodType: e.target.value as PeriodType })}>{PERIOD_TYPES.map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}</Select></FormField>
          <FormField label={f.periodType === 'personalizado' ? 'Início' : 'Dia de referência'} htmlFor="ng-start" hint={f.periodType === 'personalizado' ? undefined : 'Em branco: período atual'}><Input id="ng-start" type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></FormField>
          {f.periodType === 'personalizado' && <FormField label="Fim" htmlFor="ng-end"><Input id="ng-end" type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></FormField>}
          <FormField label="Categoria" htmlFor="ng-cat"><Select id="ng-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{GOAL_CATEGORIES.map((c) => <option key={c} value={c}>{GOAL_CATEGORY_LABELS[c]}</option>)}</Select></FormField>
          <FormField label="Objetivo" htmlFor="ng-obj"><Select id="ng-obj" value={f.objectiveId} onChange={(e) => setF({ ...f, objectiveId: e.target.value })}><option value="">Nenhum</option>{objs.data?.items.map((o) => <option key={o.id} value={o.id}>{OBJECTIVE_LEVEL_LABELS[o.level]}: {o.title}</option>)}</Select></FormField>
          {parent && <FormField label="Peso na meta superior" htmlFor="ng-w"><Input id="ng-w" inputMode="numeric" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></FormField>}
        </div>
        <FormField label="Como as metas desdobradas desta consolidam" htmlFor="ng-cons"><Select id="ng-cons" value={f.consolidation} onChange={(e) => setF({ ...f, consolidation: e.target.value as Consolidation })}>{CONSOLIDATIONS.map((c) => <option key={c} value={c}>{CONSOLIDATION_LABELS[c]}</option>)}</Select></FormField>
      </div>
    </Modal>
  );
}

function GoalDrawer({ id, onClose, onOpen }: { id: string | null; onClose: () => void; onOpen: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['performance', 'goal', id], enabled: !!id, queryFn: () => api<Goal & { events: { id: string; type: string; payload: Record<string, unknown>; createdAt: string; actorName: string | null }[]; checkins: { id: string; value: number; note: string | null; createdAt: string; actorName: string | null }[]; children: Goal[]; consolidated: number | null; canManage: boolean }>(`/performance/goals/${id}`) });
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [ck, setCk] = useState({ value: '', note: '' });
  const inv = () => void qc.invalidateQueries({ queryKey: ['performance'] });
  const revise = useMutation({ mutationFn: (cancel?: boolean) => api(`/performance/goals/${id}`, { method: 'PATCH', body: { rowVersion: q.data!.rowVersion, ...(cancel ? { cancel: true } : { target: Number(target.replace(',', '.')) }), reason: reason || undefined } }), onSuccess: () => { inv(); setTarget(''); setReason(''); toast({ tone: 'success', message: 'Meta atualizada; o alvo original fica no histórico' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const checkin = useMutation({ mutationFn: () => api(`/performance/goals/${id}/checkins`, { method: 'POST', body: { value: Number(ck.value.replace(',', '.')), note: ck.note } }), onSuccess: () => { inv(); setCk({ value: '', note: '' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const g = q.data;
  const started = g ? new Date().toLocaleDateString('en-CA') >= g.periodStart : false;
  return (
    <Drawer open={!!id} onClose={onClose} title="Meta" width="lg">
      {!g ? <LoadingRows rows={5} /> : (
        <div className="space-y-5">
          <div>
            <h3 className="text-lg font-bold text-ink">{g.title}</h3>
            <p className="text-sm text-muted">{who(g)} · {g.indicatorName ?? `meta manual (${g.manualUnit})`} · {fmtDate(g.periodStart)} a {fmtDate(g.periodEnd)}</p>
            <div className="mt-2"><GoalStatusChips p={g.progress} /></div>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted">Realizado</dt><dd className="num text-lg font-bold text-ink">{fmtIndicator(g.progress.value, g.progress.unit)}</dd></div>
            <div><dt className="text-xs text-muted">Meta</dt><dd className="num text-lg font-bold text-ink">{fmtIndicator(g.target, g.progress.unit)}</dd>{g.originalTarget !== g.target && <dd className="num text-xs text-muted">original {fmtIndicator(g.originalTarget, g.progress.unit)}</dd>}</div>
            <div><dt className="text-xs text-muted">Atingimento</dt><dd className="num text-lg font-bold text-ink">{fmtAtt(g.progress.attainment)}</dd></div>
            <div><dt className="text-xs text-muted">Esperado até hoje</dt><dd className="num text-lg font-bold text-ink">{g.progress.direction === 'maior' && !g.progress.closed ? fmtIndicator(g.progress.expected, g.progress.unit) : '—'}</dd></div>
          </dl>
          <GoalBar g={g} />
          {g.progress.indicatorStatus === 'incompleto' && <Notice tone="info">Amostra pequena: o resultado ainda é parcial.</Notice>}
          {g.progress.status === 'indisponivel' && <Notice tone="info">Sem dados de origem para calcular. Nada foi estimado.</Notice>}
          {!!g.children.length && (
            <section>
              <h4 className="mb-1 font-bold text-ink">Desdobramento</h4>
              {g.consolidated !== null && <p className="mb-2 text-sm">Consolidado das metas abaixo ({CONSOLIDATION_LABELS[g.consolidation].toLowerCase()}): <span className="num font-semibold text-ink">{fmtIndicator(g.consolidated, g.progress.unit)}</span></p>}
              <ul className="divide-y divide-line">{g.children.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 py-2"><button type="button" className="min-w-0 flex-1 text-left text-sm font-semibold text-primary hover:underline" onClick={() => onOpen(c.id)}>{c.title} <span className="font-normal text-muted">· {who(c)}</span></button><span className="num text-sm">{fmtIndicator(c.progress.value, c.progress.unit)} / {fmtIndicator(c.target, c.progress.unit)}</span><Chip tone={TRAFFIC_TONE[c.progress.color]}>{fmtAtt(c.progress.attainment)}</Chip></li>)}</ul>
            </section>
          )}
          {!g.indicatorId && (
            <section className="space-y-2">
              <h4 className="font-bold text-ink">Apontamentos</h4>
              <ul className="space-y-1 text-sm">{g.checkins.map((c) => <li key={c.id}><span className="num font-semibold text-ink">{fmtIndicator(c.value, 'quantidade')}</span> · {fmtDateTime(c.createdAt)} · {c.actorName} — {c.note}</li>)}</ul>
              {!g.progress.closed && <div className="flex flex-wrap items-end gap-2"><FormField label="Valor acumulado" htmlFor="ck-v"><Input id="ck-v" className="w-28" inputMode="decimal" value={ck.value} onChange={(e) => setCk({ ...ck, value: e.target.value })} /></FormField><FormField label="Evidência / observação" htmlFor="ck-n" className="min-w-[200px] flex-1"><Input id="ck-n" value={ck.note} onChange={(e) => setCk({ ...ck, note: e.target.value })} /></FormField><Button variant="secondary" disabled={!ck.value || ck.note.trim().length < 3} loading={checkin.isPending} onClick={() => checkin.mutate()}>Apontar</Button></div>}
            </section>
          )}
          {g.canManage && !g.progress.closed && (
            <section className="space-y-2 rounded-md border border-line p-3">
              <h4 className="font-bold text-ink">Revisar meta</h4>
              {started && <p className="text-sm text-muted">O período já começou: a mudança exige motivo, gera nova versão e o alvo original fica guardado.</p>}
              <div className="flex flex-wrap items-end gap-2">
                <FormField label="Novo alvo" htmlFor="rv-t"><Input id="rv-t" className="w-28" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></FormField>
                <FormField label="Motivo" htmlFor="rv-r" className="min-w-[220px] flex-1"><Input id="rv-r" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
              </div>
              <div className="flex gap-2"><Button variant="primary" disabled={!target || (started && reason.trim().length < 10)} loading={revise.isPending && revise.variables !== true} onClick={() => revise.mutate(false)}>Salvar revisão</Button><Button variant="ghost" className="text-danger" disabled={started && reason.trim().length < 10} onClick={() => revise.mutate(true)}>Cancelar meta</Button></div>
            </section>
          )}
          <section>
            <h4 className="mb-1 font-bold text-ink">Histórico</h4>
            <ol className="space-y-1 text-sm">{g.events.map((e) => <li key={e.id}><span className="num text-xs text-muted">{fmtDateTime(e.createdAt)}</span> · {e.actorName ?? 'Sistema'}: {e.type === 'revisao' ? `alvo ${e.payload.from} → ${e.payload.to} (v${e.payload.version}) — ${e.payload.reason ?? 'antes do início'}` : e.type === 'resultado' ? `resultado fechado: ${e.payload.value ?? '—'} de ${e.payload.target} (${GOAL_STATUS_LABELS[e.payload.status as GoalStatus] ?? e.payload.status})` : e.type === 'cancelada' ? `cancelou — ${e.payload.reason ?? ''}` : e.type}</li>)}</ol>
          </section>
        </div>
      )}
    </Drawer>
  );
}

function Objectives({ onGoal }: { onGoal: (id: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { level } = useAuth();
  const lk = useLookups().data;
  const q = useQuery({ queryKey: ['performance', 'objectives', 'all'], queryFn: () => api<{ items: Objective[]; canEdit: boolean }>('/performance/objectives') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', description: '', level: 'tatico' as ObjectiveLevel, parentId: '', periodStart: `${new Date().getFullYear()}-01-01`, periodEnd: `${new Date().getFullYear()}-12-31`, priority: 'media', sponsorId: '' });
  const m = useMutation({ mutationFn: () => api('/performance/objectives', { method: 'POST', body: { ...f, parentId: f.parentId || null, sponsorId: f.sponsorId || null, description: f.description || null } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['performance'] }); setOpen(false); toast({ tone: 'success', message: 'Objetivo criado' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <LoadingRows rows={4} />;
  const items = q.data?.items ?? [];
  const node = (o: Objective, depth: number): React.ReactNode => (
    <div key={o.id} style={{ marginLeft: depth * 24 }} className="space-y-2">
      <section className="card p-4">
        <div className="flex flex-wrap items-center gap-2"><Chip tone={o.level === 'estrategico' ? 'purple' : o.level === 'tatico' ? 'blue' : 'sky'}>{OBJECTIVE_LEVEL_LABELS[o.level]}</Chip><h3 className="font-bold text-ink">{o.title}</h3>{o.status !== 'ativo' && <Chip tone="neutral">{o.status}</Chip>}<span className="ml-auto num text-sm text-muted">{o.progress === null ? 'sem metas com dado' : `${Math.round(o.progress * 100)}% das metas`}</span></div>
        <p className="text-xs text-muted">Responsável {o.ownerName} · {fmtDate(o.periodStart)} a {fmtDate(o.periodEnd)}</p>
        {!!o.goals.length && <ul className="mt-2 space-y-1.5">{o.goals.map((g) => <li key={g.id} className="flex items-center gap-2 text-sm"><button type="button" className="min-w-0 flex-1 truncate text-left text-primary hover:underline" onClick={() => onGoal(g.id)}>{g.title} · {who(g)}</button><span className="w-32"><GoalBar g={g} /></span><Chip tone={TRAFFIC_TONE[g.progress.color]}>{fmtAtt(g.progress.attainment)}</Chip></li>)}</ul>}
      </section>
      {items.filter((x) => x.parentId === o.id).map((x) => node(x, depth + 1))}
    </div>
  );
  return (
    <div className="space-y-3">
      {q.data?.canEdit && <div className="flex justify-end"><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Novo objetivo</Button></div>}
      {!items.length ? <section className="card"><EmptyState title="Nenhum objetivo" description="Comece pelo objetivo estratégico e desdobre em táticos e operacionais." /></section> : items.filter((o) => !o.parentId || !items.some((x) => x.id === o.parentId)).map((o) => node(o, 0))}
      <Modal open={open} onClose={() => setOpen(false)} title="Novo objetivo" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" disabled={f.title.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>Criar</Button></>}>
        <div className="space-y-3">
          <FormField label="Objetivo" htmlFor="ob-t" required><Input id="ob-t" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Nível" htmlFor="ob-l"><Select id="ob-l" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as ObjectiveLevel })}>{OBJECTIVE_LEVELS.filter((l) => l !== 'estrategico' || level('desempenho') === 'total').map((l) => <option key={l} value={l}>{OBJECTIVE_LEVEL_LABELS[l]}</option>)}</Select></FormField>
            <FormField label="Objetivo superior" htmlFor="ob-p"><Select id="ob-p" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">Nenhum</option>{items.filter((o) => OBJECTIVE_LEVELS.indexOf(o.level) < OBJECTIVE_LEVELS.indexOf(f.level)).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</Select></FormField>
            <FormField label="Início" htmlFor="ob-s"><Input id="ob-s" type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></FormField>
            <FormField label="Fim" htmlFor="ob-e"><Input id="ob-e" type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></FormField>
            <FormField label="Patrocinador" htmlFor="ob-sp"><Select id="ob-sp" value={f.sponsorId} onChange={(e) => setF({ ...f, sponsorId: e.target.value })}><option value="">Nenhum</option>{lk?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
            <FormField label="Prioridade" htmlFor="ob-pr"><Select id="ob-pr" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></Select></FormField>
          </div>
          <FormField label="Descrição" htmlFor="ob-d"><Textarea id="ob-d" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></FormField>
        </div>
      </Modal>
    </div>
  );
}
