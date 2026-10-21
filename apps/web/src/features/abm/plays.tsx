/** ABM Fase 5 — plays: sugestões justificadas e execuções na Conta 360; biblioteca e construtor na página do ABM. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Lightbulb, Plus, Trash2 } from 'lucide-react';
import {
  COMMERCIAL_STATUS_LABELS, INFLUENCE_LEVELS, PLAY_ASSIGNEE_LABELS, PLAY_CATEGORY_LABELS, PLAY_GAP_LABELS, PLAY_STEP_TYPE_LABELS, RELATIONSHIP_LABELS, STAKEHOLDER_ROLE_LABELS, STANCE_LABELS, DEFAULT_INFLUENCE_LABELS, validatePlay,
  type CommercialStatus, type InfluenceLevel, type PlayAssignee, type PlayAudience, type PlayCategory, type PlayDefinition, type PlayGap, type PlayStep, type PlayStepType, type RelationshipStrength, type StakeholderRole, type Stance,
} from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { TaskDrawer } from '../tasks/TaskDrawer';

const today = () => new Intl.DateTimeFormat('en-CA').format(new Date());
type RunStep = { activityId: string; stepKey: string; title: string; type: PlayStepType; stepStatus: 'pendente' | 'concluida' | 'cancelada'; dueOn: string | null; ownerName: string };
export type Run = {
  id: string; playId: string; playName: string; playVersion: number; category: PlayCategory; contactId: string; abmId: string; account: string; stakeholderName: string | null; ownerName: string; status: 'em_andamento' | 'concluido' | 'cancelado';
  startOn: string; reason: string; fromSuggestion: boolean; outcome: string | null; successAchieved: boolean | null; closedAt: string | null;
  steps: RunStep[]; progress: { total: number; done: number; canceled: number; open: number; late: number; pct: number; canConclude: boolean };
};
type AccountPlays = {
  inAbm: boolean; influenceVisible: boolean;
  suggestions: { playId: string; playName: string; stakeholderId: string | null; stakeholderName: string | null; reasons: string[] }[];
  plays: { id: string; name: string; category: PlayCategory; target: 'conta' | 'stakeholder'; objective: string; successCriteria: string; steps: PlayStep[] }[];
  stakeholders: { id: string; name: string }[];
  runs: Run[];
};

// ---------------------------------------------------------------- Conta 360 → Plays
export function AccountPlaysPanel({ contactId }: { contactId: string }) {
  const q = useQuery({ queryKey: ['abm-plays', 'account', contactId], queryFn: () => api<AccountPlays>(`/accounts/${contactId}/plays`) });
  const [apply, setApply] = useState<{ playId: string; stakeholderId: string; reason: string; fromSuggestion: boolean } | null>(null);
  const [task, setTask] = useState<string | null>(null);
  if (q.isLoading) return <LoadingRows rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const running = d.runs.filter((r) => r.status === 'em_andamento');
  const closed = d.runs.filter((r) => r.status !== 'em_andamento');
  return (
    <div className="space-y-4">
      <section className="card p-4" aria-label="Plays sugeridos">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h3 className="flex items-center gap-2 font-bold text-ink"><Lightbulb className="h-4 w-4 text-warning" />Plays sugeridos</h3><p className="text-xs text-muted">Recomendações a partir dos dados da conta e das avaliações feitas pela equipe. Aplicar é uma decisão sua; nenhuma sugestão muda avaliações.</p></div>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!d.inAbm} onClick={() => setApply({ playId: '', stakeholderId: '', reason: '', fromSuggestion: false })}>Aplicar play</Button>
        </div>
        {!d.inAbm ? <div className="mt-3"><Notice tone="info">Adicione a conta ao ABM para receber sugestões e aplicar plays.</Notice></div> : !d.suggestions.length ? <p className="mt-3 text-sm text-muted">Nenhuma sugestão agora. Complete stakeholders e avaliações para receber recomendações por pessoa.</p> : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">{d.suggestions.map((s) => (
            <li key={s.playId + (s.stakeholderId ?? '')} className="flex flex-col rounded-lg border border-line p-3">
              <p className="font-semibold text-ink">{s.playName}{s.stakeholderName && <span className="font-normal text-muted"> para {s.stakeholderName}</span>}</p>
              <ul className="mt-1 flex-1 list-disc space-y-0.5 pl-5 text-xs text-muted">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              <Button size="sm" variant="secondary" className="mt-2 self-start" onClick={() => setApply({ playId: s.playId, stakeholderId: s.stakeholderId ?? '', reason: `Sugerido: ${s.reasons.join('; ')}`, fromSuggestion: true })}>Aplicar</Button>
            </li>
          ))}</ul>
        )}
      </section>
      <section aria-label="Plays em andamento" className="space-y-3">
        <h3 className="font-bold text-ink">Em andamento ({running.length})</h3>
        {!running.length ? <div className="card"><EmptyState title="Nenhum play em andamento" description="Aplique um play sugerido ou escolha um da biblioteca. Cada etapa vira uma tarefa com prazo e responsável." /></div> : running.map((r) => <RunCard key={r.id} r={r} onTask={setTask} />)}
      </section>
      {!!closed.length && <details className="card p-4"><summary className="cursor-pointer font-bold text-ink">Encerrados ({closed.length})</summary><div className="mt-3 space-y-3">{closed.map((r) => <RunCard key={r.id} r={r} onTask={setTask} />)}</div></details>}
      {apply && <ApplyPlay contactId={contactId} data={d} initial={apply} onClose={() => setApply(null)} />}
      <TaskDrawer id={task} onClose={() => setTask(null)} onOpen={setTask} />
    </div>
  );
}

const STEP_TONE = { pendente: 'neutral', concluida: 'green', cancelada: 'neutral' } as const;
export function RunCard({ r, onTask, showAccount }: { r: Run; onTask: (id: string) => void; showAccount?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [closing, setClosing] = useState<'concluir' | 'cancelar' | null>(null);
  const [text, setText] = useState('');
  const [success, setSuccess] = useState<boolean | null>(null);
  const m = useMutation({
    mutationFn: () => closing === 'concluir' ? api(`/play-runs/${r.id}/conclude`, { method: 'POST', body: { outcome: text, successAchieved: success } }) : api(`/play-runs/${r.id}/cancel`, { method: 'POST', body: { reason: text } }),
    onSuccess: () => { const c = closing; setClosing(null); setText(''); setSuccess(null); void qc.invalidateQueries({ queryKey: ['abm-plays'] }); void qc.invalidateQueries({ queryKey: ['abm'] }); toast({ tone: 'success', message: c === 'concluir' ? 'Play encerrado com o resultado' : 'Play cancelado e tarefas em aberto canceladas' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const today0 = today();
  return (
    <article className="card p-4" aria-label={`Play ${r.playName}${r.stakeholderName ? ` para ${r.stakeholderName}` : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-ink">{r.playName}{r.stakeholderName && <span className="font-normal text-muted"> para {r.stakeholderName}</span>}</p>
          <p className="text-xs text-muted">{showAccount && <><Link className="font-semibold text-primary hover:underline" to={`/abm/contas/${r.abmId}?t=plays`}>{r.account}</Link> · </>}Conduz: {r.ownerName} · início {fmtDate(r.startOn)} · versão {r.playVersion}{r.fromSuggestion && ' · aplicado a partir de sugestão'}</p>
        </div>
        <span className="flex items-center gap-2">
          {r.status === 'em_andamento' ? (r.progress.late ? <Chip tone="red">{r.progress.late} atrasada(s)</Chip> : <Chip tone="blue">Em andamento</Chip>) : r.status === 'concluido' ? <Chip tone={r.successAchieved ? 'green' : 'orange'}>{r.successAchieved ? 'Concluído com sucesso' : 'Concluído sem atingir o critério'}</Chip> : <Chip tone="neutral">Cancelado</Chip>}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2" aria-label={`${r.progress.done} de ${r.progress.total - r.progress.canceled} etapas concluídas`}>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-success transition-all" style={{ width: `${r.progress.pct}%` }} /></div>
        <span className="num text-xs font-semibold text-ink">{r.progress.done}/{r.progress.total - r.progress.canceled}</span>
      </div>
      <ol className="mt-3 space-y-1">{r.steps.map((s) => (
        <li key={s.activityId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className={clsx('inline-block h-2.5 w-2.5 shrink-0 rounded-full', s.stepStatus === 'concluida' ? 'bg-success' : s.stepStatus === 'cancelada' ? 'bg-line' : s.dueOn && s.dueOn < today0 ? 'bg-danger' : 'bg-sky')} aria-hidden />
          <button type="button" className={clsx('min-w-0 text-left hover:underline', s.stepStatus === 'cancelada' && 'text-muted line-through', s.stepStatus === 'concluida' && 'text-muted')} onClick={() => onTask(s.activityId)}>{s.title}</button>
          <span className="text-xs text-muted">{PLAY_STEP_TYPE_LABELS[s.type] ?? s.type} · {s.ownerName}{s.dueOn && ` · ${fmtDate(s.dueOn)}`}</span>
          {s.stepStatus !== 'pendente' && <Chip tone={STEP_TONE[s.stepStatus]}>{s.stepStatus === 'concluida' ? 'Concluída' : 'Cancelada'}</Chip>}
        </li>
      ))}</ol>
      <p className="mt-2 text-xs text-muted">Motivo: {r.reason}</p>
      {r.outcome && <p className="mt-1 text-sm"><b>{r.status === 'cancelado' ? 'Motivo do cancelamento' : 'Resultado'}:</b> {r.outcome}</p>}
      {r.status === 'em_andamento' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={!r.progress.canConclude} title={r.progress.canConclude ? undefined : 'Conclua ou cancele todas as etapas antes'} onClick={() => setClosing('concluir')}>Encerrar com resultado</Button>
          <Button size="sm" variant="secondary" onClick={() => setClosing('cancelar')}>Cancelar play</Button>
        </div>
      )}
      <Modal open={!!closing} onClose={() => setClosing(null)} title={closing === 'concluir' ? 'Encerrar play com resultado' : 'Cancelar play'}
        footer={<><Button variant="secondary" onClick={() => setClosing(null)}>Voltar</Button><Button variant={closing === 'cancelar' ? 'danger' : 'primary'} disabled={text.trim().length < 10 || (closing === 'concluir' && success === null)} loading={m.isPending} onClick={() => m.mutate()}>{closing === 'concluir' ? 'Encerrar play' : 'Cancelar play'}</Button></>}>
        <div className="space-y-3">
          {closing === 'concluir' && (
            <fieldset><legend className="mb-1 text-sm font-semibold text-ink">O critério de sucesso foi atingido?</legend>
              <div className="flex gap-4 text-sm"><label className="flex items-center gap-1.5"><input type="radio" name={`ok-${r.id}`} checked={success === true} onChange={() => setSuccess(true)} />Sim</label><label className="flex items-center gap-1.5"><input type="radio" name={`ok-${r.id}`} checked={success === false} onChange={() => setSuccess(false)} />Não</label></div>
            </fieldset>
          )}
          <FormField label={closing === 'concluir' ? 'Resultado' : 'Motivo do cancelamento'} htmlFor={`rc-${r.id}`} required hint={closing === 'cancelar' ? 'As tarefas ainda abertas serão canceladas.' : 'O que aconteceu e qual o próximo passo?'}><Textarea id={`rc-${r.id}`} rows={3} value={text} onChange={(e) => setText(e.target.value)} /></FormField>
        </div>
      </Modal>
    </article>
  );
}

function ApplyPlay({ contactId, data, initial, onClose }: { contactId: string; data: AccountPlays; initial: { playId: string; stakeholderId: string; reason: string; fromSuggestion: boolean }; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const users = useLookups().data?.users ?? [];
  const [f, setF] = useState({ ...initial, ownerId: me?.user.id ?? '', startOn: today() });
  const play = data.plays.find((p) => p.id === f.playId);
  const m = useMutation({
    mutationFn: () => api(`/accounts/${contactId}/play-runs`, { method: 'POST', body: { playId: f.playId, stakeholderId: play?.target === 'stakeholder' ? f.stakeholderId || null : null, ownerId: f.ownerId || undefined, startOn: f.startOn, reason: f.reason, fromSuggestion: f.fromSuggestion } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['abm-plays'] }); void qc.invalidateQueries({ queryKey: ['abm'] }); toast({ tone: 'success', message: `Play aplicado: ${play?.steps.length ?? 0} tarefa(s) criada(s)` }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const valid = play && f.reason.trim().length >= 5 && (play.target === 'conta' || f.stakeholderId) && f.startOn;
  const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  return (
    <Modal open onClose={onClose} title="Aplicar play" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Aplicar e criar tarefas</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Play" htmlFor="ap-p"><Select id="ap-p" value={f.playId} onChange={(e) => setF({ ...f, playId: e.target.value, fromSuggestion: false })}><option value="">Escolha</option>{data.plays.map((p) => <option key={p.id} value={p.id}>{p.name}{p.target === 'stakeholder' ? ' (para uma pessoa)' : ''}</option>)}</Select></FormField>
          {play?.target === 'stakeholder' && <FormField label="Pessoa" htmlFor="ap-s"><Select id="ap-s" value={f.stakeholderId} onChange={(e) => setF({ ...f, stakeholderId: e.target.value })}><option value="">Escolha</option>{data.stakeholders.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></FormField>}
          <FormField label="Quem conduz" htmlFor="ap-o"><Select id="ap-o" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
          <FormField label="Início" htmlFor="ap-d"><Input id="ap-d" type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} /></FormField>
        </div>
        <FormField label="Por que aplicar este play" htmlFor="ap-r" required><Textarea id="ap-r" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></FormField>
        {play && (
          <div className="rounded-md bg-surface-2 p-3 text-sm">
            {play.objective && <p><b>Objetivo:</b> {play.objective}</p>}
            <p><b>Critério de sucesso:</b> {play.successCriteria}</p>
            <p className="mt-2 font-semibold text-ink">Tarefas que serão criadas</p>
            <ol className="mt-1 space-y-0.5">{play.steps.map((s) => <li key={s.key} className="flex flex-wrap gap-x-2"><span className="num w-24 shrink-0 text-xs text-muted">{f.startOn ? fmtDate(addDays(f.startOn, s.dayOffset)) : `dia ${s.dayOffset}`}</span><span>{s.title}</span><span className="text-xs text-muted">{PLAY_STEP_TYPE_LABELS[s.type]} · {PLAY_ASSIGNEE_LABELS[s.assignee]}</span></li>)}</ol>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- ABM → Plays: biblioteca, construtor e execuções
type LibPlay = { id: string; templateKey: string | null; name: string; category: PlayCategory; objective: string; target: 'conta' | 'stakeholder'; active: boolean; currentVersion: number; rowVersion: number; definition: PlayDefinition; running: number; concluded: number; succeeded: number };
export function PlaysLibrary() {
  const q = useQuery({ queryKey: ['abm-plays', 'library'], queryFn: () => api<{ canManage: boolean; items: LibPlay[] }>('/abm/plays') });
  const runs = useQuery({ queryKey: ['abm-plays', 'runs'], queryFn: () => api<{ items: Run[] }>('/abm/play-runs') });
  const [edit, setEdit] = useState<LibPlay | 'new' | null>(null);
  const [task, setTask] = useState<string | null>(null);
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <section className="card overflow-hidden" aria-label="Biblioteca de plays">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div><h3 className="font-bold text-ink">Biblioteca de plays</h3><p className="text-xs text-muted">Roteiros de ação para contas e pessoas. Cada etapa vira tarefa ao aplicar. Mudanças geram nova versão; plays em andamento seguem a versão em que começaram.</p></div>
          {d.canManage && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Novo play</Button>}
        </div>
        <div className="scroll-thin overflow-x-auto border-t border-line">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Play', 'Para', 'Etapas', 'Em andamento', 'Concluídos', 'Com sucesso', 'Versão'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>{d.items.map((p) => (
              <tr key={p.id} className={clsx('border-t border-line', !p.active && 'opacity-60')}>
                <td className="px-3 py-2.5"><button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => setEdit(p)}>{p.name}</button><span className="block max-w-md text-xs text-muted">{PLAY_CATEGORY_LABELS[p.category] === p.name ? p.objective : PLAY_CATEGORY_LABELS[p.category]}{!p.active && ' · desativado'}</span></td>
                <td className="px-3 py-2.5">{p.target === 'conta' ? 'Conta' : 'Pessoa'}</td>
                <td className="num px-3 py-2.5">{p.definition.steps.length}</td>
                <td className="num px-3 py-2.5">{p.running}</td>
                <td className="num px-3 py-2.5">{p.concluded}</td>
                <td className="num px-3 py-2.5">{p.concluded ? `${Math.round((p.succeeded / p.concluded) * 100)}%` : '—'}</td>
                <td className="num px-3 py-2.5">v{p.currentVersion}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <section aria-label="Plays em andamento nas contas" className="space-y-3">
        <h3 className="font-bold text-ink">Em andamento nas contas ({runs.data?.items.length ?? 0})</h3>
        {runs.isLoading ? <LoadingRows rows={3} /> : !runs.data?.items.length ? <div className="card"><EmptyState title="Nenhum play em andamento" description="Aplique plays na Conta 360, na aba Plays." /></div> : <div className="grid gap-3 xl:grid-cols-2">{runs.data.items.map((r) => <RunCard key={r.id} r={r} onTask={setTask} showAccount />)}</div>}
      </section>
      {edit && <PlayEditor play={edit === 'new' ? null : edit} canManage={d.canManage} existing={d.items} onClose={() => setEdit(null)} />}
      <TaskDrawer id={task} onClose={() => setTask(null)} onOpen={setTask} />
    </div>
  );
}

const blankDef = (): PlayDefinition => ({ successCriteria: '', audience: { target: 'conta' }, steps: [{ key: 'etapa1', title: '', type: 'tarefa', dayOffset: 0, assignee: 'executor', instructions: '' }] });
function toggle<T>(arr: T[] | undefined, v: T) { const a = arr ?? []; return a.includes(v) ? a.filter((x) => x !== v) : [...a, v]; }
function Checks<T extends string>({ legend, labels, value, onChange, disabled }: { legend: string; labels: Record<T, string>; value: T[] | undefined; onChange: (v: T[]) => void; disabled: boolean }) {
  return <fieldset><legend className="mb-1 text-sm font-semibold text-ink">{legend}</legend><div className="flex flex-wrap gap-x-4 gap-y-1">{(Object.keys(labels) as T[]).map((k) => <label key={k} className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={disabled} checked={(value ?? []).includes(k)} onChange={() => onChange(toggle(value, k))} />{labels[k]}</label>)}</div></fieldset>;
}

function PlayEditor({ play, canManage, existing, onClose }: { play: LibPlay | null; canManage: boolean; existing: LibPlay[]; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['abm-plays', 'one', play?.id], enabled: !!play, queryFn: () => api<{ versions: { id: string; version: number; note: string; createdByName: string; createdAt: string }[] }>(`/abm/plays/${play!.id}`) });
  const [f, setF] = useState({ name: play?.name ?? '', category: (play?.category ?? 'outro') as PlayCategory, objective: play?.objective ?? '', def: play?.definition ?? blankDef(), note: '' });
  const [from, setFrom] = useState('');
  useEffect(() => { if (!from) return; const src = existing.find((x) => x.id === from); if (src) setF((o) => ({ ...o, category: src.category, objective: src.objective, def: JSON.parse(JSON.stringify(src.definition)) as PlayDefinition, name: o.name || `${src.name} (cópia)` })); }, [from, existing]);
  const ro = !canManage;
  const a = f.def.audience;
  const setA = (p: Partial<PlayAudience>) => setF({ ...f, def: { ...f.def, audience: { ...a, ...p } } });
  const setStep = (i: number, p: Partial<PlayStep>) => setF({ ...f, def: { ...f.def, steps: f.def.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) } });
  const move = (i: number, d: -1 | 1) => { const s = [...f.def.steps]; const [x] = s.splice(i, 1); s.splice(i + d, 0, x!); setF({ ...f, def: { ...f.def, steps: s } }); };
  const errs = validatePlay({ name: f.name, ...f.def });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, category: f.category, objective: f.objective, definition: f.def };
      return play ? api<{ version?: number }>(`/abm/plays/${play.id}`, { method: 'PUT', body: { ...body, rowVersion: play.rowVersion, note: f.note } }) : api<{ version?: number }>('/abm/plays', { method: 'POST', body });
    },
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['abm-plays'] }); toast({ tone: 'success', message: play ? `Play salvo (versão ${r.version})` : 'Play criado' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const active = useMutation({
    mutationFn: (v: boolean) => api(`/abm/plays/${play!.id}/active`, { method: 'POST', body: { active: v } }),
    onSuccess: (_r, v) => { void qc.invalidateQueries({ queryKey: ['abm-plays'] }); toast({ tone: 'success', message: v ? 'Play ativado' : 'Play desativado: não será sugerido nem aplicado' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const setTarget = (t: 'conta' | 'stakeholder') => setF({ ...f, def: { ...f.def, audience: { target: t }, steps: f.def.steps.map((s) => (t === 'conta' && s.assignee === 'responsavel_relacionamento' ? { ...s, assignee: 'executor' } : s)) } });
  return (
    <Drawer open onClose={onClose} title={play ? play.name : 'Novo play'} width="lg">
      <div className="space-y-5">
        {!play && existing.length > 0 && <FormField label="Começar a partir de" htmlFor="pe-from" hint="Opcional: copia etapas e público de um play existente"><Select id="pe-from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Do zero</option>{existing.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormField>}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Nome" htmlFor="pe-n"><Input id="pe-n" disabled={ro} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
          <FormField label="Tipo" htmlFor="pe-c"><Select id="pe-c" disabled={ro} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as PlayCategory })}>{(Object.keys(PLAY_CATEGORY_LABELS) as PlayCategory[]).map((k) => <option key={k} value={k}>{PLAY_CATEGORY_LABELS[k]}</option>)}</Select></FormField>
        </div>
        <FormField label="Objetivo" htmlFor="pe-o"><Input id="pe-o" disabled={ro} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} /></FormField>
        <FormField label="Critério de sucesso" htmlFor="pe-s" required hint="Como saber, ao encerrar, que o play deu certo"><Input id="pe-s" disabled={ro} value={f.def.successCriteria} onChange={(e) => setF({ ...f, def: { ...f.def, successCriteria: e.target.value } })} /></FormField>

        <section className="space-y-3 rounded-lg border border-line p-3" aria-label="Quando sugerir">
          <h4 className="font-bold text-ink">Quando sugerir</h4>
          <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Para quem">
            <label className="flex items-center gap-1.5"><input type="radio" disabled={ro} checked={a.target === 'conta'} onChange={() => setTarget('conta')} />Para a conta</label>
            <label className="flex items-center gap-1.5"><input type="radio" disabled={ro} checked={a.target === 'stakeholder'} onChange={() => setTarget('stakeholder')} />Para uma pessoa</label>
          </div>
          {a.target === 'conta' ? (
            <>
              <Checks legend="Status comercial" labels={COMMERCIAL_STATUS_LABELS as Record<CommercialStatus, string>} value={a.commercial} onChange={(v) => setA({ commercial: v })} disabled={ro} />
              <Checks legend="Natureza" labels={{ publica: 'Pública', privada: 'Privada' }} value={a.nature} onChange={(v) => setA({ nature: v })} disabled={ro} />
              <Checks legend="Lacunas no mapeamento (qualquer uma)" labels={PLAY_GAP_LABELS as Record<PlayGap, string>} value={a.gaps} onChange={(v) => setA({ gaps: v })} disabled={ro} />
              <FormField label="Contrato vencendo em até (dias)" htmlFor="pe-ce"><Input id="pe-ce" type="number" min={1} max={730} className="w-32" disabled={ro} value={a.contractEndingDays ?? ''} onChange={(e) => setA({ contractEndingDays: e.target.value ? Number(e.target.value) : null })} /></FormField>
            </>
          ) : (
            <>
              <Checks legend="Papéis (qualquer um)" labels={STAKEHOLDER_ROLE_LABELS as Record<StakeholderRole, string>} value={a.roles} onChange={(v) => setA({ roles: v })} disabled={ro} />
              <Checks legend="Posicionamento" labels={STANCE_LABELS as Record<Stance, string>} value={a.stances} onChange={(v) => setA({ stances: v })} disabled={ro} />
              <Checks legend="Força do relacionamento" labels={RELATIONSHIP_LABELS as Record<RelationshipStrength, string>} value={a.relationship} onChange={(v) => setA({ relationship: v })} disabled={ro} />
              <FormField label="Influência mínima (avaliada pela equipe)" htmlFor="pe-mi" hint="Pessoas não avaliadas nunca entram por este critério"><Select id="pe-mi" disabled={ro} value={a.minInfluence ?? ''} onChange={(e) => setA({ minInfluence: (e.target.value || null) as InfluenceLevel | null })}><option value="">Qualquer</option>{INFLUENCE_LEVELS.filter((l) => l !== 'nao_avaliado').map((l) => <option key={l} value={l}>{DEFAULT_INFLUENCE_LABELS[l]} ou mais</option>)}</Select></FormField>
            </>
          )}
          <p className="text-xs text-muted">Sem nenhum critério marcado, o play não é sugerido; ele continua disponível para aplicar manualmente.</p>
        </section>

        <section className="space-y-2" aria-label="Etapas">
          <h4 className="font-bold text-ink">Etapas ({f.def.steps.length})</h4>
          {f.def.steps.map((s, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-line p-3" role="group" aria-label={`Etapa ${i + 1}`}>
              <div className="flex items-center gap-2"><span className="num text-xs font-bold text-muted">{i + 1}</span><Input aria-label={`Etapa ${i + 1}: o que fazer`} disabled={ro} placeholder="O que fazer" value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} />
                {!ro && <><Button size="sm" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)} icon={<ArrowUp className="h-4 w-4" />} /><Button size="sm" variant="ghost" aria-label="Descer" disabled={i === f.def.steps.length - 1} onClick={() => move(i, 1)} icon={<ArrowDown className="h-4 w-4" />} /><Button size="sm" variant="ghost" aria-label="Remover etapa" disabled={f.def.steps.length === 1} onClick={() => setF({ ...f, def: { ...f.def, steps: f.def.steps.filter((_, j) => j !== i) } })} icon={<Trash2 className="h-4 w-4" />} /></>}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Select aria-label={`Etapa ${i + 1}: tipo`} disabled={ro} value={s.type} onChange={(e) => setStep(i, { type: e.target.value as PlayStepType })}>{(Object.keys(PLAY_STEP_TYPE_LABELS) as PlayStepType[]).map((k) => <option key={k} value={k}>{PLAY_STEP_TYPE_LABELS[k]}</option>)}</Select>
                <label className="flex items-center gap-2 text-sm">Dia<Input aria-label={`Etapa ${i + 1}: dias depois do início`} type="number" min={0} max={365} disabled={ro} value={s.dayOffset} onChange={(e) => setStep(i, { dayOffset: Number(e.target.value) })} /></label>
                <Select aria-label={`Etapa ${i + 1}: responsável`} disabled={ro} value={s.assignee} onChange={(e) => setStep(i, { assignee: e.target.value as PlayAssignee })}>{(Object.keys(PLAY_ASSIGNEE_LABELS) as PlayAssignee[]).filter((k) => a.target === 'stakeholder' || k !== 'responsavel_relacionamento').map((k) => <option key={k} value={k}>{PLAY_ASSIGNEE_LABELS[k]}</option>)}</Select>
              </div>
              <Textarea aria-label={`Etapa ${i + 1}: orientação`} rows={2} disabled={ro} placeholder="Orientação para quem executa (vai na descrição da tarefa)" value={s.instructions} onChange={(e) => setStep(i, { instructions: e.target.value })} />
            </div>
          ))}
          {!ro && <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setF({ ...f, def: { ...f.def, steps: [...f.def.steps, { key: `etapa${Date.now().toString(36)}`, title: '', type: 'tarefa', dayOffset: (f.def.steps.at(-1)?.dayOffset ?? 0) + 3, assignee: 'executor', instructions: '' }] } })}>Incluir etapa</Button>}
        </section>

        {!ro && (
          <section className="space-y-2 border-t border-line pt-4">
            {errs.map((e) => <Notice key={e} tone="warning">{e}</Notice>)}
            {play && <FormField label="O que mudou" htmlFor="pe-note" required hint={`Hoje na versão ${play.currentVersion}. Mudança nas etapas ou no público gera nova versão.`}><Input id="pe-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></FormField>}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={!!errs.length || (!!play && f.note.trim().length < 3)} loading={save.isPending} onClick={() => save.mutate()}>{play ? 'Salvar play' : 'Criar play'}</Button>
              {play && <Button variant="secondary" loading={active.isPending} onClick={() => active.mutate(!play.active)}>{play.active ? 'Desativar' : 'Ativar'}</Button>}
            </div>
          </section>
        )}
        {play && !!detail.data?.versions.length && (
          <section><h4 className="mb-1 font-bold text-ink">Versões</h4><ol className="space-y-1 text-sm">{detail.data.versions.map((v) => <li key={v.id}><b>v{v.version}</b> · <span className="num text-xs text-muted">{fmtDateTime(v.createdAt)}</span> · {v.createdByName}: {v.note}</li>)}</ol></section>
        )}
      </div>
    </Drawer>
  );
}
