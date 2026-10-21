/** Gestão de Times → Rituais: reuniões de gestão recorrentes por perspectiva, com as próximas reuniões e as atas recentes. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarClock, Plus, X } from 'lucide-react';
import { RITUAL_CADENCE_LABELS, WEEKDAY_LABELS, durationLabel, type RitualCadence } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, type Tone } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';

type Meeting = { id: string; ritualId: string; ritualName: string; date: string; status: 'agendada' | 'realizada' | 'cancelada' };
type Ritual = { id: string; name: string; perspective: 'diretoria' | 'gestao' | 'lideranca'; cadence: RitualCadence; weekday: number; monthDay: number; time: string; durationMin: number; facilitatorName: string; scopeName: string; participants: string[]; agenda: string[]; active: boolean; canManage: boolean; next: Meeting | null; last: Meeting | null };
type Template = { key: string; perspective: Ritual['perspective']; name: string; cadence: RitualCadence; weekday: number; monthDay: number; time: string; durationMin: number; agenda: string[] };
const PERSPECTIVE: Record<Ritual['perspective'], string> = { diretoria: 'Diretoria', gestao: 'Gestão', lideranca: 'Liderança' };
const PERSPECTIVE_TONE: Record<Ritual['perspective'], Tone> = { diretoria: 'blue', gestao: 'sky', lideranca: 'green' };
const STATUS_TONE: Record<Meeting['status'], Tone> = { agendada: 'neutral', realizada: 'green', cancelada: 'orange' };
const STATUS_LABEL: Record<Meeting['status'], string> = { agendada: 'Agendada', realizada: 'Ata encerrada', cancelada: 'Cancelada' };
export const whenLabel = (r: Pick<Ritual, 'cadence' | 'weekday' | 'monthDay' | 'time'>) =>
  r.cadence === 'diaria' ? `Dias úteis, ${r.time}` : r.cadence === 'mensal' ? `Todo dia ${r.monthDay}, ${r.time}` : `${r.cadence === 'quinzenal' ? 'A cada 2 semanas' : 'Toda'} ${WEEKDAY_LABELS[r.weekday]!.toLowerCase()}, ${r.time}`;

export function RitualsPage() {
  const q = useQuery({ queryKey: ['rituals'], queryFn: () => api<{ today: string; templates: Template[]; canCreate: boolean; rituals: Ritual[]; meetings: Meeting[] }>('/rituals') });
  const [creating, setCreating] = useState(false);
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const active = d.rituals.filter((r) => r.active);
  const upcoming = d.meetings.filter((m) => m.status === 'agendada' && m.date >= d.today).slice(0, 8);
  const recent = d.meetings.filter((m) => m.status === 'realizada').reverse().slice(0, 6);
  return (
    <div>
      <PageHeader icon={<CalendarClock />} title="Rituais" subtitle="As reuniões de gestão do time: cadência fixa, pauta montada com os números e ata com decisões e impedimentos." actions={d.canCreate ? <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Novo ritual</Button> : undefined} />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section aria-label="Rituais">
          {!active.length ? (
            <div className="card"><EmptyState title="Nenhum ritual ainda" description="Comece pela reunião que já acontece: a semanal de gestão ou o check-in da equipe. As próximas datas entram na agenda de quem participa." action={d.canCreate ? <Button variant="primary" onClick={() => setCreating(true)}>Criar ritual</Button> : undefined} /></div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {active.map((r) => (
                <li key={r.id} className="card flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2"><h2 className="font-bold text-ink">{r.name}</h2><Chip tone={PERSPECTIVE_TONE[r.perspective]}>{PERSPECTIVE[r.perspective]}</Chip></div>
                  <p className="text-sm">{whenLabel(r)} · {durationLabel(r.durationMin)} · {r.scopeName}</p>
                  <p className="text-xs text-muted">Conduz: {r.facilitatorName} · {r.participants.length} participante(s)</p>
                  <p className="text-xs text-muted">Pauta: {r.agenda.join(' · ')}</p>
                  <div className="mt-auto flex flex-wrap gap-3 border-t border-line pt-2 text-sm">
                    {r.next ? <Link to={`/times/rituais/reunioes/${r.next.id}`} className="font-semibold text-primary hover:underline">Próxima: {fmtDate(r.next.date)}</Link> : <span className="text-muted">Sem próxima data</span>}
                    {r.last && <Link to={`/times/rituais/reunioes/${r.last.id}`} className="text-primary hover:underline">Última ata: {fmtDate(r.last.date)}</Link>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-2 font-bold text-ink">Próximas reuniões</h2>
            {!upcoming.length ? <p className="text-sm text-muted">Nenhuma reunião agendada.</p> : (
              <ul className="divide-y divide-line">{upcoming.map((m) => <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm"><Link to={`/times/rituais/reunioes/${m.id}`} className={clsx('font-semibold hover:underline', m.date === d.today ? 'text-primary' : 'text-ink')}>{m.ritualName}</Link><span className="num text-xs text-muted">{m.date === d.today ? 'hoje' : fmtDate(m.date)}</span></li>)}</ul>
            )}
          </section>
          <section className="card p-4">
            <h2 className="mb-2 font-bold text-ink">Atas recentes</h2>
            {!recent.length ? <p className="text-sm text-muted">As atas encerradas aparecem aqui.</p> : (
              <ul className="divide-y divide-line">{recent.map((m) => <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm"><Link to={`/times/rituais/reunioes/${m.id}`} className="hover:underline">{m.ritualName}</Link><Chip tone={STATUS_TONE[m.status]}>{fmtDate(m.date)}</Chip></li>)}</ul>
            )}
            <Link to="/times/decisoes" className="mt-2 inline-block text-sm font-semibold text-primary hover:underline">Decisões e impedimentos</Link>
          </section>
        </aside>
      </div>
      <NewRitual open={creating} templates={d.templates} onClose={() => setCreating(false)} />
    </div>
  );
}
export { STATUS_LABEL as MEETING_STATUS_LABEL, STATUS_TONE as MEETING_STATUS_TONE };

type Options = { teams: { id: string; name: string }[]; units: { id: string; name: string }[]; owners: { id: string; name: string }[]; canCompany: boolean };
function NewRitual({ open, templates, onClose }: { open: boolean; templates: Template[]; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { me } = useAuth();
  const o = useQuery({ queryKey: ['interventions', 'new-options'], enabled: open, queryFn: () => api<Options>('/interventions/new-options') });
  const blank = { template: '', name: '', perspective: 'gestao' as Ritual['perspective'], scope: 'time' as 'time' | 'unidade' | 'empresa', target: '', cadence: 'semanal' as RitualCadence, weekday: 1, monthDay: 1, time: '09:00', durationMin: 60, participants: [] as string[], agenda: [''] as string[], add: '' };
  const [f, setF] = useState(blank);
  const pick = (key: string) => { const t = templates.find((x) => x.key === key); setF(t ? { ...f, template: key, name: t.name, perspective: t.perspective, cadence: t.cadence, weekday: t.weekday, monthDay: t.monthDay, time: t.time, durationMin: t.durationMin, agenda: [...t.agenda], scope: t.perspective === 'diretoria' ? 'empresa' : t.perspective === 'gestao' ? 'unidade' : 'time', target: '' } : { ...f, template: '' }); };
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/rituals', { method: 'POST', body: {
      name: f.name, perspective: f.perspective, teamId: f.scope === 'time' ? f.target || null : null, orgUnitId: f.scope === 'unidade' ? f.target || null : null,
      cadence: f.cadence, weekday: Number(f.weekday), monthDay: Number(f.monthDay), time: f.time, durationMin: Number(f.durationMin), participants: f.participants, agenda: f.agenda.filter((a) => a.trim()),
    } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['rituals'] }); setF(blank); onClose(); toast({ tone: 'success', message: 'Ritual criado; as próximas reuniões já estão na agenda' }); nav('/times/rituais'); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const d = o.data;
  const people = (d?.owners ?? []).filter((u) => u.id !== me?.user.id);
  const valid = f.name.trim().length >= 3 && f.agenda.some((a) => a.trim()) && f.participants.length > 0 && (f.scope === 'empresa' || !!f.target);
  return (
    <Modal open={open} onClose={onClose} title="Novo ritual" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>Criar ritual</Button></>}>
      {!d ? <LoadingRows rows={4} /> : (
        <div className="space-y-4">
          <FormField label="Começar de um modelo" htmlFor="nr-tpl"><Select id="nr-tpl" value={f.template} onChange={(e) => pick(e.target.value)}><option value="">Em branco</option>{templates.map((t) => <option key={t.key} value={t.key}>{PERSPECTIVE[t.perspective]}: {t.name}</option>)}</Select></FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Nome" htmlFor="nr-name" required><Input id="nr-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
            <FormField label="Perspectiva" htmlFor="nr-persp"><Select id="nr-persp" value={f.perspective} onChange={(e) => setF({ ...f, perspective: e.target.value as Ritual['perspective'] })}><option value="diretoria">Diretoria</option><option value="gestao">Gestão</option><option value="lideranca">Liderança</option></Select></FormField>
            <FormField label="Escopo" htmlFor="nr-scope"><Select id="nr-scope" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as typeof f.scope, target: '' })}><option value="time">Um time</option><option value="unidade">Uma unidade</option>{d.canCompany && <option value="empresa">A empresa toda</option>}</Select></FormField>
            {f.scope !== 'empresa' && <FormField label={f.scope === 'time' ? 'Time' : 'Unidade'} htmlFor="nr-target" required><Select id="nr-target" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}><option value="">Escolha</option>{(f.scope === 'time' ? d.teams : d.units).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>}
            <FormField label="Cadência" htmlFor="nr-cad"><Select id="nr-cad" value={f.cadence} onChange={(e) => setF({ ...f, cadence: e.target.value as RitualCadence })}>{(Object.keys(RITUAL_CADENCE_LABELS) as RitualCadence[]).map((c) => <option key={c} value={c}>{RITUAL_CADENCE_LABELS[c]}</option>)}</Select></FormField>
            {(f.cadence === 'semanal' || f.cadence === 'quinzenal') && <FormField label="Dia da semana" htmlFor="nr-wd"><Select id="nr-wd" value={f.weekday} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>{WEEKDAY_LABELS.map((w, i) => <option key={w} value={i}>{w}</option>)}</Select></FormField>}
            {f.cadence === 'mensal' && <FormField label="Dia do mês" htmlFor="nr-md"><Input id="nr-md" type="number" min={1} max={31} value={f.monthDay} onChange={(e) => setF({ ...f, monthDay: Number(e.target.value) })} /></FormField>}
            <FormField label="Horário" htmlFor="nr-time"><Input id="nr-time" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></FormField>
            <FormField label="Duração (minutos)" htmlFor="nr-dur"><Input id="nr-dur" type="number" min={5} max={480} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} /></FormField>
          </div>
          <FormField label="Participantes" htmlFor="nr-add" required hint="Você conduz e já está incluído">
            <Select id="nr-add" value="" onChange={(e) => e.target.value && setF({ ...f, participants: [...new Set([...f.participants, e.target.value])] })}><option value="">Incluir pessoa…</option>{people.filter((u) => !f.participants.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          </FormField>
          {!!f.participants.length && <ul className="flex flex-wrap gap-2">{f.participants.map((id) => <li key={id} className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1.5 text-sm">{people.find((u) => u.id === id)?.name}<button type="button" aria-label={`Retirar ${people.find((u) => u.id === id)?.name}`} className="rounded-full p-0.5 hover:bg-line" onClick={() => setF({ ...f, participants: f.participants.filter((x) => x !== id) })}><X className="h-3.5 w-3.5" /></button></li>)}</ul>}
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink">Pauta fixa</legend>
            {f.agenda.map((a, i) => <div key={i} className="flex gap-2"><Input aria-label={`Item de pauta ${i + 1}`} value={a} onChange={(e) => setF({ ...f, agenda: f.agenda.map((x, k) => (k === i ? e.target.value : x)) })} /><button type="button" aria-label={`Retirar item ${i + 1}`} className="rounded p-2 text-muted hover:text-danger" onClick={() => setF({ ...f, agenda: f.agenda.filter((_, k) => k !== i) })}><X className="h-4 w-4" /></button></div>)}
            <Button variant="ghost" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setF({ ...f, agenda: [...f.agenda, ''] })}>Incluir item</Button>
            <p className="text-xs text-muted">Além da pauta fixa, cada reunião traz sozinha: metas fora da faixa, intervenções abertas, ações atrasadas, impedimentos e decisões a acompanhar.</p>
          </fieldset>
        </div>
      )}
    </Modal>
  );
}
