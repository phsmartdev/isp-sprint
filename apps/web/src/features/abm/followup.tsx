/** ABM Fase 6 — central de sinais, cadências e histórico único de interações. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BellRing, Mail, MessageSquare, Phone, Plus, Users } from 'lucide-react';
import {
  CADENCE_TYPES, CADENCE_TYPE_LABELS, SIGNAL_KIND_LABELS, SIGNAL_SEVERITIES, SIGNAL_SEVERITY_LABELS, SIGNAL_STATUS_LABELS,
  type CadenceType, type SignalKind, type SignalSeverity, type SignalStatus,
} from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime, isoToLocalInput } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { TaskDrawer } from '../tasks/TaskDrawer';

type Signal = { id: string; kind: SignalKind; key: string; severity: SignalSeverity; title: string; detail: string | null; status: SignalStatus; account: string; contactId: string; abmId: string; owner: string | null; detectedAt: string; lastSeenAt: string; closedAt: string | null; resolution: string | null; taskId: string | null };
const SEV_TONE: Record<SignalSeverity, Tone> = { alta: 'red', media: 'orange', baixa: 'neutral' };
const today = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const age = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000); return d <= 0 ? 'hoje' : d === 1 ? 'há 1 dia' : `há ${d} dias`; };

/** Lista de sinais (central ou da conta) com as ações de cada estado. */
export function SignalsPanel({ contactId, abmAccounts }: { contactId?: string; abmAccounts?: { contactId: string; name: string }[] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const users = useLookups().data?.users ?? [];
  const [f, setF] = useState({ status: 'abertos', severity: '', mine: '0' });
  const qs = new URLSearchParams({ status: f.status, mine: f.mine, ...(f.severity ? { severity: f.severity } : {}), ...(contactId ? { contactId } : {}) }).toString();
  const q = useQuery({ queryKey: ['abm-signals', qs], queryFn: () => api<{ items: Signal[]; counts: { total: number; bySeverity: Record<string, number>; novos: number } }>(`/abm/signals?${qs}`) });
  const [act, setAct] = useState<{ s: Signal; to: 'tratado' | 'descartado' | 'tarefa' } | null>(null);
  const [form, setForm] = useState({ note: '', title: '', dueOn: today(), ownerId: '' });
  const [creating, setCreating] = useState(false);
  const [nw, setNw] = useState({ contactId: contactId ?? '', title: '', detail: '', severity: 'media' as SignalSeverity });
  const [task, setTask] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['abm-signals'] });
  const tr = useMutation({
    mutationFn: (v: { id: string; to: string; note: string }) => api(`/abm/signals/${v.id}/transition`, { method: 'POST', body: { to: v.to, note: v.note } }),
    onSuccess: (_r, v) => { setAct(null); refresh(); toast({ tone: 'success', message: v.to === 'em_analise' ? 'Sinal em análise' : v.to === 'tratado' ? 'Sinal tratado' : 'Sinal descartado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const mk = useMutation({
    mutationFn: (v: { id: string }) => api<{ taskId: string }>(`/abm/signals/${v.id}/task`, { method: 'POST', body: { title: form.title, dueOn: form.dueOn, ownerId: form.ownerId || undefined } }),
    onSuccess: () => { setAct(null); refresh(); toast({ tone: 'success', message: 'Tarefa criada; o sinal está em análise' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const add = useMutation({
    mutationFn: () => api('/abm/signals', { method: 'POST', body: { contactId: nw.contactId, title: nw.title, detail: nw.detail || null, severity: nw.severity } }),
    onSuccess: () => { setCreating(false); setNw({ ...nw, title: '', detail: '' }); refresh(); toast({ tone: 'success', message: 'Sinal registrado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const d = q.data;
  return (
    <section className="space-y-3" aria-label="Sinais">
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Situação" htmlFor={`sg-s-${contactId ?? 'all'}`}><Select id={`sg-s-${contactId ?? 'all'}`} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="abertos">Abertos</option><option value="encerrados">Encerrados</option></Select></FormField>
        <FormField label="Severidade" htmlFor={`sg-v-${contactId ?? 'all'}`}><Select id={`sg-v-${contactId ?? 'all'}`} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="">Todas</option>{SIGNAL_SEVERITIES.map((s) => <option key={s} value={s}>{SIGNAL_SEVERITY_LABELS[s]}</option>)}</Select></FormField>
        {!contactId && <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={f.mine === '1'} onChange={(e) => setF({ ...f, mine: e.target.checked ? '1' : '0' })} />Só das minhas contas</label>}
        <Button className="ml-auto" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Registrar sinal</Button>
      </div>
      {d && f.status === 'abertos' && <p className="text-sm text-muted"><b className="num text-ink">{d.counts.total}</b> aberto(s) · <span className="text-danger">{d.counts.bySeverity.alta ?? 0} alta</span> · {d.counts.bySeverity.media ?? 0} média · {d.counts.bySeverity.baixa ?? 0} baixa · {d.counts.novos} novo(s)</p>}
      {q.isLoading ? <LoadingRows rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d!.items.length ? <div className="card"><EmptyState title={f.status === 'abertos' ? 'Nenhum sinal aberto' : 'Nenhum sinal encerrado'} description="Sinais aparecem quando algo pede ação: conta sem contato, interação vencida, play atrasado, contrato vencendo, NPS de detrator…" /></div> : (
        <ul className="space-y-2">{d!.items.map((s) => (
          <li key={s.id} className={clsx('card flex flex-wrap items-start gap-3 p-3', s.severity === 'alta' && s.status !== 'resolvido' && 'border-l-4 border-l-danger')}>
            <BellRing className={clsx('mt-0.5 h-5 w-5 shrink-0', s.severity === 'alta' ? 'text-danger' : s.severity === 'media' ? 'text-warning' : 'text-muted')} aria-hidden />
            <div className="min-w-[220px] flex-1 text-sm">
              <p className="flex flex-wrap items-center gap-2"><b className="text-ink">{s.title}</b><Chip tone={SEV_TONE[s.severity]}>{SIGNAL_SEVERITY_LABELS[s.severity]}</Chip><Chip tone={s.status === 'novo' ? 'blue' : 'neutral'}>{SIGNAL_STATUS_LABELS[s.status]}</Chip></p>
              {s.detail && <p className="text-muted">{s.detail}</p>}
              <p className="text-xs text-muted">{SIGNAL_KIND_LABELS[s.kind]}{!contactId && <> · <Link className="font-semibold text-primary hover:underline" to={`/abm/contas/${s.abmId}?t=acompanhamento`}>{s.account}</Link></>} · {s.owner ?? '—'} · detectado {age(s.detectedAt)}{s.taskId && <> · <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setTask(s.taskId)}>ver tarefa</button></>}</p>
              {s.resolution && <p className="mt-1 text-xs">{s.status === 'resolvido' ? '' : 'Registro: '}{s.resolution}{s.closedAt && ` (${fmtDateTime(s.closedAt)})`}</p>}
            </div>
            {(s.status === 'novo' || s.status === 'em_analise') && (
              <div className="flex flex-wrap gap-1.5">
                {s.status === 'novo' && <Button size="sm" variant="ghost" loading={tr.isPending && tr.variables?.id === s.id} onClick={() => tr.mutate({ id: s.id, to: 'em_analise', note: '' })}>Em análise</Button>}
                {!s.taskId && <Button size="sm" variant="secondary" onClick={() => { setAct({ s, to: 'tarefa' }); setForm({ ...form, title: s.title, ownerId: me?.user.id ?? '' }); }}>Criar tarefa</Button>}
                <Button size="sm" variant="primary" onClick={() => { setAct({ s, to: 'tratado' }); setForm({ ...form, note: '' }); }}>Tratado</Button>
                <Button size="sm" variant="ghost" onClick={() => { setAct({ s, to: 'descartado' }); setForm({ ...form, note: '' }); }}>Descartar</Button>
              </div>
            )}
          </li>
        ))}</ul>
      )}
      <Modal open={!!act} onClose={() => setAct(null)} title={act?.to === 'tarefa' ? 'Criar tarefa para o sinal' : act?.to === 'tratado' ? 'Marcar como tratado' : 'Descartar sinal'}
        footer={<><Button variant="secondary" onClick={() => setAct(null)}>Cancelar</Button>{act?.to === 'tarefa' ? <Button variant="primary" disabled={form.title.trim().length < 3} loading={mk.isPending} onClick={() => mk.mutate({ id: act.s.id })}>Criar tarefa</Button> : <Button variant={act?.to === 'descartado' ? 'danger' : 'primary'} disabled={form.note.trim().length < 10} loading={tr.isPending} onClick={() => act && tr.mutate({ id: act.s.id, to: act.to, note: form.note })}>{act?.to === 'tratado' ? 'Marcar como tratado' : 'Descartar'}</Button>}</>}>
        {act?.to === 'tarefa' ? (
          <div className="space-y-3">
            <FormField label="Tarefa" htmlFor="sg-t"><Input id="sg-t" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></FormField>
            <div className="grid gap-3 sm:grid-cols-2"><FormField label="Prazo" htmlFor="sg-d"><Input id="sg-d" type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} /></FormField><FormField label="Responsável" htmlFor="sg-o"><Select id="sg-o" value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField></div>
          </div>
        ) : (
          <FormField label={act?.to === 'tratado' ? 'O que foi feito' : 'Por que descartar'} htmlFor="sg-n" required hint={act?.to === 'descartado' ? 'Se a situação continuar, o sinal só volta depois de 30 dias.' : 'Se a situação continuar, o sinal volta em 7 dias.'}><Textarea id="sg-n" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></FormField>
        )}
      </Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title="Registrar sinal" footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancelar</Button><Button variant="primary" disabled={!nw.contactId || nw.title.trim().length < 5} loading={add.isPending} onClick={() => add.mutate()}>Registrar</Button></>}>
        <div className="space-y-3">
          {!contactId && <FormField label="Conta" htmlFor="ns-a"><Select id="ns-a" value={nw.contactId} onChange={(e) => setNw({ ...nw, contactId: e.target.value })}><option value="">Escolha</option>{(abmAccounts ?? []).map((a) => <option key={a.contactId} value={a.contactId}>{a.name}</option>)}</Select></FormField>}
          <FormField label="O que aconteceu" htmlFor="ns-t" hint="Ex.: secretário substituído, edital publicado, corte de orçamento"><Input id="ns-t" value={nw.title} onChange={(e) => setNw({ ...nw, title: e.target.value })} /></FormField>
          <FormField label="Detalhes" htmlFor="ns-d"><Textarea id="ns-d" rows={2} value={nw.detail} onChange={(e) => setNw({ ...nw, detail: e.target.value })} /></FormField>
          <FormField label="Severidade" htmlFor="ns-s"><Select id="ns-s" value={nw.severity} onChange={(e) => setNw({ ...nw, severity: e.target.value as SignalSeverity })}>{SIGNAL_SEVERITIES.map((s) => <option key={s} value={s}>{SIGNAL_SEVERITY_LABELS[s]}</option>)}</Select></FormField>
        </div>
      </Modal>
      <TaskDrawer id={task} onClose={() => setTask(null)} onOpen={setTask} />
    </section>
  );
}

/** Aba Sinais do ABM: central de todas as contas visíveis. */
export function SignalsCenter() {
  const accs = useQuery({ queryKey: ['abm', 'list-min'], queryFn: () => api<{ items: { contactId: string; name: string }[] }>('/abm') });
  return <SignalsPanel abmAccounts={accs.data?.items} />;
}

// ---------------------------------------------------------------- Conta 360 → Acompanhamento
type Cadence = { id: string; title: string; type: CadenceType; everyDays: number; active: boolean; startOn: string; ownerName: string; personName: string | null; lastDoneOn: string | null; openTaskId: string | null; openDueOn: string | null; nextDueOn: string; doneCount: number; rowVersion: number };
type Interaction = { id: string; source: 'atividade' | 'email' | 'gmail' | 'pesquisa' | 'visita'; kind: string; title: string; text: string | null; at: string; by: string | null; people: string[]; activityId: string | null };
const KIND_ICON: Record<string, typeof Phone> = { ligacao: Phone, email: Mail, whatsapp: MessageSquare, reuniao: Users, visita: Users };

export function AccountFollowup({ contactId }: { contactId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const users = useLookups().data?.users ?? [];
  const people = useQuery({ queryKey: ['stakeholders', contactId], queryFn: () => api<{ items: { id: string; name: string; active: boolean }[] }>(`/accounts/${contactId}/stakeholders`) });
  const cad = useQuery({ queryKey: ['abm-cadences', contactId], queryFn: () => api<{ items: Cadence[] }>(`/accounts/${contactId}/cadences`) });
  const [who, setWho] = useState('');
  const inter = useQuery({ queryKey: ['abm-interactions', contactId, who], queryFn: () => api<{ items: Interaction[] }>(`/accounts/${contactId}/interactions${who ? `?stakeholderId=${who}` : ''}`) });
  const [newCad, setNewCad] = useState<{ title: string; type: CadenceType; everyDays: number; startOn: string; stakeholderId: string; ownerId: string } | null>(null);
  const [log, setLog] = useState<{ type: string; at: string; summary: string; stakeholderIds: string[] } | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const active = (people.data?.items ?? []).filter((p) => p.active);
  const mkCad = useMutation({
    mutationFn: () => api<{ tasksCreated: number }>(`/accounts/${contactId}/cadences`, { method: 'POST', body: { ...newCad, stakeholderId: newCad!.stakeholderId || null, ownerId: newCad!.ownerId || undefined } }),
    onSuccess: (r) => { setNewCad(null); void qc.invalidateQueries({ queryKey: ['abm-cadences', contactId] }); toast({ tone: 'success', message: r.tasksCreated ? 'Cadência criada; a primeira tarefa já está na agenda' : 'Cadência criada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const pause = useMutation({
    mutationFn: (c: Cadence) => api(`/abm/cadences/${c.id}`, { method: 'PATCH', body: { rowVersion: c.rowVersion, active: !c.active } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['abm-cadences', contactId] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const mkLog = useMutation({
    mutationFn: () => api(`/accounts/${contactId}/interactions`, { method: 'POST', body: { ...log, at: new Date(log!.at).toISOString() } }),
    onSuccess: () => { setLog(null); void qc.invalidateQueries({ queryKey: ['abm-interactions', contactId] }); void qc.invalidateQueries({ queryKey: ['abm'] }); void qc.invalidateQueries({ queryKey: ['abm-signals'] }); toast({ tone: 'success', message: 'Interação registrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <div className="space-y-5">
      <div><h3 className="mb-2 font-bold text-ink">Sinais desta conta</h3><SignalsPanel contactId={contactId} /></div>

      <section className="card space-y-3 p-4" aria-label="Cadências">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-ink">Cadências de contato</h3><p className="text-xs text-muted">A próxima tarefa nasce sozinha 3 dias antes, contando da última conclusão.</p></div><Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setNewCad({ title: '', type: 'ligacao', everyDays: 30, startOn: today(), stakeholderId: '', ownerId: me?.user.id ?? '' })}>Nova cadência</Button></div>
        {!cad.data?.items.length ? <p className="text-sm text-muted">Nenhuma cadência. Combine um ritmo de contato com a conta ou com quem decide.</p> : (
          <ul className="divide-y divide-line">{cad.data.items.map((c) => (
            <li key={c.id} className={clsx('flex flex-wrap items-center gap-3 py-2.5 text-sm', !c.active && 'opacity-60')}>
              <div className="min-w-[220px] flex-1"><b className="text-ink">{c.title}</b>{c.personName && <span className="text-muted"> · {c.personName}</span>}<span className="block text-xs text-muted">{CADENCE_TYPE_LABELS[c.type]} a cada {c.everyDays} dia(s) · {c.ownerName} · {c.doneCount} feita(s){c.lastDoneOn && ` · última em ${fmtDate(c.lastDoneOn)}`}</span></div>
              <span className="text-xs">{!c.active ? 'Pausada' : c.openTaskId ? <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setTask(c.openTaskId)}>Tarefa para {fmtDate(c.openDueOn!)}</button> : <>Próxima em {fmtDate(c.nextDueOn)}</>}</span>
              <Button size="sm" variant="ghost" loading={pause.isPending && pause.variables?.id === c.id} onClick={() => pause.mutate(c)}>{c.active ? 'Pausar' : 'Retomar'}</Button>
            </li>
          ))}</ul>
        )}
      </section>

      <section className="card space-y-3 p-4" aria-label="Interações">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h3 className="font-bold text-ink">Interações</h3><p className="text-xs text-muted">Atividades concluídas, e-mails enviados, pesquisas respondidas e visitas — tudo num lugar só.</p></div>
          <div className="flex flex-wrap items-end gap-2">
            <FormField label="Com quem" htmlFor="it-w"><Select id="it-w" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Toda a conta</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormField>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setLog({ type: 'ligacao', at: isoToLocalInput(new Date().toISOString()), summary: '', stakeholderIds: who ? [who] : [] })}>Registrar interação</Button>
          </div>
        </div>
        {inter.isLoading ? <LoadingRows rows={3} /> : !inter.data?.items.length ? <p className="text-sm text-muted">Nenhuma interação registrada{who ? ' com esta pessoa' : ''}.</p> : (
          <ol className="relative space-y-3 border-l-2 border-line pl-5">{inter.data.items.map((i) => { const Icon = KIND_ICON[i.kind] ?? BellRing; return (
            <li key={i.id} className="relative text-sm">
              <span className="absolute -left-[31px] top-0.5 flex h-5 w-5 items-center justify-center rounded-circle bg-primary-soft text-primary"><Icon className="h-3 w-3" aria-hidden /></span>
              <p><b className="text-ink">{i.title}</b>{!!i.people.length && <span className="text-muted"> · com {i.people.join(', ')}</span>}</p>
              {i.text && <p className="whitespace-pre-line text-text">{i.text}</p>}
              <p className="text-xs text-muted">{fmtDateTime(i.at)}{i.by && ` · ${i.by}`} · {i.source === 'gmail' ? 'Gmail' : i.source}{i.activityId && <> · <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setTask(i.activityId)}>abrir</button></>}</p>
            </li>
          ); })}</ol>
        )}
      </section>

      <Modal open={!!newCad} onClose={() => setNewCad(null)} title="Nova cadência" footer={<><Button variant="secondary" onClick={() => setNewCad(null)}>Cancelar</Button><Button variant="primary" disabled={!newCad || newCad.title.trim().length < 3} loading={mkCad.isPending} onClick={() => mkCad.mutate()}>Criar cadência</Button></>}>
        {newCad && (
          <div className="space-y-3">
            <FormField label="Nome" htmlFor="cd-t" hint="Ex.: ligação mensal com a decisora"><Input id="cd-t" value={newCad.title} onChange={(e) => setNewCad({ ...newCad, title: e.target.value })} /></FormField>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Tipo" htmlFor="cd-k"><Select id="cd-k" value={newCad.type} onChange={(e) => setNewCad({ ...newCad, type: e.target.value as CadenceType })}>{CADENCE_TYPES.map((t) => <option key={t} value={t}>{CADENCE_TYPE_LABELS[t]}</option>)}</Select></FormField>
              <FormField label="A cada (dias)" htmlFor="cd-e"><Input id="cd-e" type="number" min={1} max={365} value={newCad.everyDays} onChange={(e) => setNewCad({ ...newCad, everyDays: Number(e.target.value) })} /></FormField>
              <FormField label="Começa em" htmlFor="cd-s"><Input id="cd-s" type="date" value={newCad.startOn} onChange={(e) => setNewCad({ ...newCad, startOn: e.target.value })} /></FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Com quem (opcional)" htmlFor="cd-p"><Select id="cd-p" value={newCad.stakeholderId} onChange={(e) => setNewCad({ ...newCad, stakeholderId: e.target.value })}><option value="">A conta</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormField>
              <FormField label="Responsável" htmlFor="cd-o"><Select id="cd-o" value={newCad.ownerId} onChange={(e) => setNewCad({ ...newCad, ownerId: e.target.value })}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!log} onClose={() => setLog(null)} title="Registrar interação" footer={<><Button variant="secondary" onClick={() => setLog(null)}>Cancelar</Button><Button variant="primary" disabled={!log || log.summary.trim().length < 10} loading={mkLog.isPending} onClick={() => mkLog.mutate()}>Registrar</Button></>}>
        {log && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Tipo" htmlFor="lg-k"><Select id="lg-k" value={log.type} onChange={(e) => setLog({ ...log, type: e.target.value })}>{(['ligacao', 'reuniao', 'visita', 'email', 'whatsapp'] as const).map((t) => <option key={t} value={t}>{CADENCE_TYPE_LABELS[t]}</option>)}</Select></FormField>
              <FormField label="Quando" htmlFor="lg-a"><Input id="lg-a" type="datetime-local" value={log.at} onChange={(e) => setLog({ ...log, at: e.target.value })} /></FormField>
            </div>
            {!!active.length && <fieldset><legend className="mb-1 text-sm font-semibold text-ink">Com quem</legend><div className="flex flex-wrap gap-x-4 gap-y-1">{active.map((p) => <label key={p.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={log.stakeholderIds.includes(p.id)} onChange={(e) => setLog({ ...log, stakeholderIds: e.target.checked ? [...log.stakeholderIds, p.id] : log.stakeholderIds.filter((x) => x !== p.id) })} />{p.name}</label>)}</div></fieldset>}
            <FormField label="O que foi conversado" htmlFor="lg-s" required><Textarea id="lg-s" rows={4} value={log.summary} onChange={(e) => setLog({ ...log, summary: e.target.value })} /></FormField>
          </div>
        )}
      </Modal>
      <TaskDrawer id={task} onClose={() => setTask(null)} onOpen={setTask} />
    </div>
  );
}
