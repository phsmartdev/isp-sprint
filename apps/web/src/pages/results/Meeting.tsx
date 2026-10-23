/** Reunião de um ritual: pauta automática do escopo, presença, anotações por item, decisões, impedimentos e ata (travada ao encerrar). */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarClock } from 'lucide-react';
import { IMPEDIMENT_STATUS_LABELS, TRAFFIC_LABELS, durationLabel, type ImpedimentStatus } from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { Breadcrumb, Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, SaveStatus, Select, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';
import { fmtAtt } from '../../features/performance/format';
import { MEETING_STATUS_LABEL, MEETING_STATUS_TONE } from './Rituals';

type Auto = {
  goals: { colors: Record<string, number>; offTrack: { id: string; title: string; who: string | null; color: 'vermelho' | 'amarelo'; attainment: number | null; partial: boolean }[] };
  interventions: { id: string; goalTitle: string; kind: string; status: string; ownerName: string | null; dueOn: string; overdue: boolean }[];
  lateActions: { id: string; what: string; taskId: string; ownerName: string | null; due: string; interventionId: string }[];
  impediments: { id: string; title: string; severity: string; status: string; ownerName: string | null; dueOn: string | null; overdue: boolean }[];
  decisions: { id: string; text: string; effectiveOn: string; ownerName: string | null; followUpStatus: string | null }[];
};
type Meeting = {
  id: string; date: string; status: 'agendada' | 'realizada' | 'cancelada'; attendees: string[]; notes: Record<string, string>; minutes: string | null; rowVersion: number; cancelReason: string | null; finalizedAt: string | null; finalizedByName: string | null;
  ritual: { id: string; name: string; agenda: string[]; time: string; durationMin: number; facilitatorId: string; facilitatorName: string; participants: { id: string; name: string | null }[] };
  auto: Auto; previous: { id: string; date: string } | null;
  decisions: { id: string; text: string; rationale: string | null; ownerName: string; followUpTaskId: string | null; status: string }[];
  impediments: { id: string; title: string; severity: string; status: ImpedimentStatus; ownerName: string; dueOn: string | null }[];
  can: { write: boolean; finalize: boolean };
};
const DOT: Record<string, string> = { verde: 'bg-success', amarelo: 'bg-warning', vermelho: 'bg-danger', sem_dado: 'bg-line' };

export function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rituals', 'meeting', id], queryFn: () => api<Meeting>(`/rituals/meetings/${id}`) });
  useEffect(() => { if (id) void api(`/governance/${id}/history`).catch(() => undefined); }, [id]);
  const m = q.data;
  const [f, setF] = useState<{ attendees: string[]; notes: Record<string, string>; minutes: string } | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => { if (m && (f === null || (!dirty && m.rowVersion > (version ?? -1)))) { setF({ attendees: m.attendees, notes: m.notes, minutes: m.minutes ?? '' }); setVersion(m.rowVersion); } }, [m]); // eslint-disable-line react-hooks/exhaustive-deps
  const fRef = useRef(f); fRef.current = f;
  const save = useMutation({
    mutationFn: (v: NonNullable<typeof f>) => api<{ rowVersion: number }>(`/rituals/meetings/${id}`, { method: 'PATCH', body: { rowVersion: version, attendees: v.attendees, notes: v.notes, minutes: v.minutes || null } }),
    onMutate: () => setSaveState('saving'),
    onSuccess: (r, sent) => { setVersion(r.rowVersion); setSaveState('saved'); if (sent === fRef.current) setDirty(false); },
    onError: (e) => { setSaveState('error'); if (e instanceof ApiError && e.status === 409) toast({ tone: 'error', message: 'Outra pessoa alterou a reunião. Recarregue para ver a versão atual.' }); },
  });
  useEffect(() => { if (!dirty || !f || save.isPending || saveState === 'error') return; const t = setTimeout(() => save.mutate(f), 900); return () => clearTimeout(t); }, [f, dirty, save.isPending, saveState]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (fn: (x: NonNullable<typeof f>) => NonNullable<typeof f>) => { setF((x) => (x ? fn(x) : x)); setDirty(true); };
  const refresh = () => void qc.invalidateQueries({ queryKey: ['rituals'] });
  const finalize = useMutation({
    mutationFn: () => api(`/rituals/meetings/${id}/finalize`, { method: 'POST', body: { rowVersion: version } }),
    onSuccess: () => { setDirty(false); refresh(); toast({ tone: 'success', message: 'Ata encerrada e enviada aos participantes' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const [cancelWhy, setCancelWhy] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () => api(`/rituals/meetings/${id}/cancel`, { method: 'POST', body: { reason: cancelWhy } }),
    onSuccess: () => { setCancelWhy(null); refresh(); toast({ tone: 'success', message: 'Reunião cancelada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading || !f) return q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <LoadingRows rows={6} />;
  const d = m!;
  const ro = !d.can.write;
  const people = [{ id: d.ritual.facilitatorId, name: d.ritual.facilitatorName }, ...d.ritual.participants.filter((p) => p.id !== d.ritual.facilitatorId)];
  const a = d.auto;
  return (
    <div>
      <Breadcrumb items={[{ label: 'Rituais', to: '/times/rituais' }, { label: d.ritual.name }]} />
      <PageHeader icon={<CalendarClock />} title={d.ritual.name} subtitle={`${fmtDate(d.date)} às ${d.ritual.time} · ${durationLabel(d.ritual.durationMin)} · conduz ${d.ritual.facilitatorName}`}
        actions={<div className="flex items-center gap-3"><Chip tone={MEETING_STATUS_TONE[d.status]}>{MEETING_STATUS_LABEL[d.status]}</Chip>{!ro && <SaveStatus state={dirty && saveState !== 'saving' && saveState !== 'error' ? 'idle' : saveState} onRetry={() => { setSaveState('idle'); save.mutate(f); }} />}</div>} />
      {d.status === 'realizada' && <Notice tone="info">Ata encerrada por {d.finalizedByName} em {fmtDateTime(d.finalizedAt!)}. A pauta abaixo é a fotografia do momento do encerramento.</Notice>}
      {d.status === 'cancelada' && <Notice tone="warning">Reunião cancelada: {d.cancelReason}</Notice>}
      {d.previous && <p className="mb-3 text-sm"><Link to={`/times/rituais/reunioes/${d.previous.id}`} className="text-primary hover:underline">Ata anterior ({fmtDate(d.previous.date)})</Link></p>}

      <div className="mt-3 grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <section className="card p-4" aria-label="Resultados do escopo">
            <h2 className="mb-2 font-bold text-ink">Resultados</h2>
            <ul className="mb-3 flex flex-wrap gap-2">{(['vermelho', 'amarelo', 'verde', 'sem_dado'] as const).map((c) => <li key={c} className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-sm"><span className={clsx('h-2.5 w-2.5 rounded-circle', DOT[c])} aria-hidden />{TRAFFIC_LABELS[c]} <b className="num">{a.goals.colors[c] ?? 0}</b></li>)}</ul>
            {!a.goals.offTrack.length ? <p className="text-sm text-muted">Nenhuma meta fora da faixa no período.</p> : (
              <ul className="divide-y divide-line">{a.goals.offTrack.map((g) => <li key={g.id} className="flex items-center gap-2 py-2 text-sm"><span className={clsx('h-2.5 w-2.5 shrink-0 rounded-circle', DOT[g.color])} aria-hidden /><Link to={`/desempenho/metas?goal=${g.id}`} className="min-w-0 flex-1 truncate hover:underline">{g.title}</Link><span className="text-xs text-muted">{g.who}</span><span className="num text-xs">{fmtAtt(g.attainment)}{g.partial && ' (parcial)'}</span></li>)}</ul>
            )}
          </section>

          <section className="card p-4" aria-label="Intervenções e ações">
            <h2 className="mb-2 font-bold text-ink">Intervenções abertas</h2>
            {!a.interventions.length ? <p className="text-sm text-muted">Nenhuma intervenção aberta no escopo.</p> : (
              <ul className="divide-y divide-line">{a.interventions.map((i) => <li key={i.id} className="flex items-center gap-2 py-2 text-sm"><Link to={`/times/intervencoes?id=${i.id}`} className="min-w-0 flex-1 truncate hover:underline">{i.goalTitle}</Link><span className="text-xs text-muted">{i.ownerName}</span><span className={clsx('num text-xs', i.overdue && 'font-semibold text-danger')}>{fmtDate(i.dueOn)}</span></li>)}</ul>
            )}
            {!!a.lateActions.length && <><h3 className="mb-1 mt-3 text-sm font-bold text-danger">Ações de plano atrasadas</h3><ul className="space-y-1 text-sm">{a.lateActions.map((x) => <li key={x.id}><Link to={`/tarefas?task=${x.taskId}`} className="hover:underline">{x.what}</Link> <span className="text-xs text-muted">· {x.ownerName} · venceu {fmtDate(x.due)}</span></li>)}</ul></>}
          </section>

          <section className="card space-y-3 p-4" aria-label="Pauta">
            <h2 className="font-bold text-ink">Pauta</h2>
            {d.ritual.agenda.map((item) => (
              <FormField key={item} label={item} htmlFor={`nt-${item}`}><Textarea id={`nt-${item}`} rows={2} readOnly={ro} value={f.notes[item] ?? ''} onChange={(e) => edit((x) => ({ ...x, notes: { ...x.notes, [item]: e.target.value } }))} /></FormField>
            ))}
            <FormField label="Ata (resumo e encaminhamentos)" htmlFor="nt-minutes"><Textarea id="nt-minutes" rows={4} readOnly={ro} value={f.minutes} onChange={(e) => edit((x) => ({ ...x, minutes: e.target.value }))} /></FormField>
          </section>

          <MeetingRecords meeting={d} ro={ro} onChanged={refresh} />
        </div>

        <aside className="space-y-4">
          <section className="card p-4" aria-label="Presença">
            <h2 className="mb-2 font-bold text-ink">Presença</h2>
            <ul className="space-y-1.5">{people.map((p) => <li key={p.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={ro} checked={f.attendees.includes(p.id)} onChange={(e) => edit((x) => ({ ...x, attendees: e.target.checked ? [...x.attendees, p.id] : x.attendees.filter((y) => y !== p.id) }))} />{p.name}</label></li>)}</ul>
          </section>
          <section className="card p-4">
            <h2 className="mb-2 font-bold text-ink">Impedimentos do escopo</h2>
            {!a.impediments.length ? <p className="text-sm text-muted">Nenhum impedimento aberto.</p> : <ul className="space-y-1.5 text-sm">{a.impediments.map((i) => <li key={i.id}><Link to={`/times/decisoes?tab=impedimentos&id=${i.id}`} className="hover:underline">{i.title}</Link><span className={clsx('block text-xs', i.overdue ? 'font-semibold text-danger' : 'text-muted')}>{i.ownerName}{i.dueOn && ` · até ${fmtDate(i.dueOn)}`} · {IMPEDIMENT_STATUS_LABELS[i.status as ImpedimentStatus]}</span></li>)}</ul>}
          </section>
          <section className="card p-4">
            <h2 className="mb-2 font-bold text-ink">Decisões a acompanhar</h2>
            {!a.decisions.length ? <p className="text-sm text-muted">Decisões das reuniões anteriores deste ritual aparecem aqui.</p> : <ul className="space-y-1.5 text-sm">{a.decisions.map((x) => <li key={x.id}>{x.text}<span className="block text-xs text-muted">{fmtDate(x.effectiveOn)}{x.followUpStatus && ` · acompanhamento: ${x.followUpStatus === 'concluida' ? 'concluído' : 'em aberto'}`}</span></li>)}</ul>}
          </section>
          {d.can.finalize && (
            <section className="card space-y-2 p-4">
              <Button variant="primary" className="w-full" disabled={!f.attendees.length || dirty || save.isPending} loading={finalize.isPending} onClick={() => finalize.mutate()}>Encerrar ata</Button>
              <p className="text-xs text-muted">{!f.attendees.length ? 'Marque a presença antes de encerrar.' : 'Depois de encerrada, a ata não muda; a pauta fica registrada como estava.'}</p>
              {cancelWhy === null ? <button type="button" className="text-xs font-semibold text-muted hover:underline" onClick={() => setCancelWhy('')}>Cancelar reunião</button> : (
                <div className="space-y-2"><Input aria-label="Motivo do cancelamento" placeholder="Motivo" value={cancelWhy} onChange={(e) => setCancelWhy(e.target.value)} /><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setCancelWhy(null)}>Voltar</Button><Button size="sm" variant="danger" disabled={cancelWhy.trim().length < 5} loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancelar reunião</Button></div></div>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Decisões e impedimentos registrados nesta reunião, com formulários rápidos. */
function MeetingRecords({ meeting, ro, onChanged }: { meeting: Meeting; ro: boolean; onChanged: () => void }) {
  const toast = useToast();
  const users = useLookups().data?.users ?? [];
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA');
  const [dec, setDec] = useState<{ text: string; rationale: string; follow: boolean; title: string; ownerId: string; dueOn: string } | null>(null);
  const [imp, setImp] = useState<{ title: string; severity: string; ownerId: string; dueOn: string } | null>(null);
  const addDec = useMutation({
    mutationFn: () => api('/decisions', { method: 'POST', body: { text: dec!.text, rationale: dec!.rationale || null, meetingId: meeting.id, followUp: dec!.follow ? { title: dec!.title, ownerId: dec!.ownerId, dueOn: dec!.dueOn } : null } }),
    onSuccess: () => { setDec(null); onChanged(); toast({ tone: 'success', message: 'Decisão registrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const addImp = useMutation({
    mutationFn: () => api('/impediments', { method: 'POST', body: { title: imp!.title, severity: imp!.severity, ownerId: imp!.ownerId, dueOn: imp!.dueOn || null, meetingId: meeting.id } }),
    onSuccess: () => { setImp(null); onChanged(); toast({ tone: 'success', message: 'Impedimento registrado e responsável avisado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section className="card space-y-4 p-4" aria-label="Decisões e impedimentos da reunião">
      <div>
        <div className="mb-1 flex items-center justify-between"><h2 className="font-bold text-ink">Decisões</h2>{!ro && !dec && <Button size="sm" variant="secondary" onClick={() => setDec({ text: '', rationale: '', follow: false, title: '', ownerId: '', dueOn: inDays(7) })}>Registrar decisão</Button>}</div>
        {!meeting.decisions.length && !dec && <p className="text-sm text-muted">Nenhuma decisão registrada nesta reunião.</p>}
        <ul className="space-y-1.5 text-sm">{meeting.decisions.map((x) => <li key={x.id} className={clsx(x.status === 'revogada' && 'text-muted line-through')}>{x.text}{x.rationale && <span className="block text-xs text-muted">{x.rationale}</span>}{x.followUpTaskId && <Link to={`/tarefas?task=${x.followUpTaskId}`} className="block text-xs text-primary hover:underline">Tarefa de acompanhamento</Link>}</li>)}</ul>
        {dec && (
          <div className="mt-2 space-y-2 rounded-md bg-surface-2 p-3">
            <FormField label="Decisão" htmlFor="dc-text" required><Input id="dc-text" value={dec.text} onChange={(e) => setDec({ ...dec, text: e.target.value })} /></FormField>
            <FormField label="Por quê" htmlFor="dc-why"><Input id="dc-why" value={dec.rationale} onChange={(e) => setDec({ ...dec, rationale: e.target.value })} /></FormField>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dec.follow} onChange={(e) => setDec({ ...dec, follow: e.target.checked })} /> Criar tarefa de acompanhamento</label>
            {dec.follow && <div className="grid gap-2 sm:grid-cols-3"><FormField label="Tarefa" htmlFor="dc-t"><Input id="dc-t" value={dec.title} onChange={(e) => setDec({ ...dec, title: e.target.value })} /></FormField><FormField label="Quem" htmlFor="dc-o"><Select id="dc-o" value={dec.ownerId} onChange={(e) => setDec({ ...dec, ownerId: e.target.value })}><option value="">Escolha</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField><FormField label="Até" htmlFor="dc-d"><Input id="dc-d" type="date" value={dec.dueOn} onChange={(e) => setDec({ ...dec, dueOn: e.target.value })} /></FormField></div>}
            <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setDec(null)}>Cancelar</Button><Button size="sm" variant="primary" disabled={dec.text.trim().length < 5 || (dec.follow && (dec.title.trim().length < 3 || !dec.ownerId))} loading={addDec.isPending} onClick={() => addDec.mutate()}>Registrar</Button></div>
          </div>
        )}
      </div>
      <div className="border-t border-line pt-3">
        <div className="mb-1 flex items-center justify-between"><h2 className="font-bold text-ink">Impedimentos levantados</h2>{!ro && !imp && <Button size="sm" variant="secondary" onClick={() => setImp({ title: '', severity: 'media', ownerId: '', dueOn: inDays(7) })}>Registrar impedimento</Button>}</div>
        {!meeting.impediments.length && !imp && <p className="text-sm text-muted">Nenhum impedimento levantado nesta reunião.</p>}
        <ul className="space-y-1.5 text-sm">{meeting.impediments.map((x) => <li key={x.id}><Link to={`/times/decisoes?tab=impedimentos&id=${x.id}`} className="hover:underline">{x.title}</Link><span className="block text-xs text-muted">{x.ownerName} · {IMPEDIMENT_STATUS_LABELS[x.status]}</span></li>)}</ul>
        {imp && (
          <div className="mt-2 space-y-2 rounded-md bg-surface-2 p-3">
            <FormField label="O que está travando" htmlFor="im-title" required><Input id="im-title" value={imp.title} onChange={(e) => setImp({ ...imp, title: e.target.value })} /></FormField>
            <div className="grid gap-2 sm:grid-cols-3">
              <FormField label="Quem remove" htmlFor="im-o" required><Select id="im-o" value={imp.ownerId} onChange={(e) => setImp({ ...imp, ownerId: e.target.value })}><option value="">Escolha</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
              <FormField label="Gravidade" htmlFor="im-s"><Select id="im-s" value={imp.severity} onChange={(e) => setImp({ ...imp, severity: e.target.value })}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></Select></FormField>
              <FormField label="Até" htmlFor="im-d"><Input id="im-d" type="date" value={imp.dueOn} onChange={(e) => setImp({ ...imp, dueOn: e.target.value })} /></FormField>
            </div>
            <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setImp(null)}>Cancelar</Button><Button size="sm" variant="primary" disabled={imp.title.trim().length < 5 || !imp.ownerId} loading={addImp.isPending} onClick={() => addImp.mutate()}>Registrar</Button></div>
          </div>
        )}
      </div>
    </section>
  );
}
