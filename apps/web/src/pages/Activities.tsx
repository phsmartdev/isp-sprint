import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowRight, CalendarCheck, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, FileText, Phone, Plus, Search, Users, CheckSquare } from 'lucide-react';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_LABELS, type ActivityType } from '@isp/domain';
import { api, qs } from '../lib/api';
import { fmtDayHeading, fmtRelativeShort, getTimezone, localDayKey } from '../lib/format';
import { useDebounced, useLookups, useUrlState } from '../lib/hooks';
import type { Activity, Paged } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { Button, EmptyState, ErrorState, Input, LoadingRows, Select, Tabs } from '../components/ui/primitives';
import { Modal } from '../components/ui/overlay';
import { PageHeader } from '../components/layout/PageHeader';
import { ActivityComposer } from '../features/ActivityComposer';
import { ActivityRow, TYPE_ICON } from '../features/ActivityRow';

type ListResp = Paged<Activity> & { counts: { overdue: number; today: number; open: number }; typeCounts: Record<ActivityType, number> };
type CalResp = { days: { day: string; types: ActivityType[] }[]; upcoming: Activity[]; week: Record<ActivityType, number> };

const DOT: Record<ActivityType, string> = { tarefa: 'bg-[#2F5986]', ligacao: 'bg-[#22A447]', reuniao: 'bg-[#7C3AED]', email: 'bg-[#F59E0B]', whatsapp: 'bg-[#4ADE80]', visita: 'bg-[#A78BFA]' };
const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoDay(d); };
const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: getTimezone() });

function MonthCalendar({ month, selected, days, onPick, onMonth }: { month: string; selected: string; days: CalResp['days']; onPick: (d: string) => void; onMonth: (m: string) => void }) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(y, m - 1, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const cells = Array.from({ length: 35 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const label = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const shift = (n: number) => { const d = new Date(y, m - 1 + n, 1); onMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); };
  const today = todayIso();
  return (
    <section className="card p-5" aria-label="Calendário">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold capitalize text-ink">{label.replace(' de ', ' de ')}</h2>
        <div className="flex gap-1">
          <button className="rounded-sm p-1 text-ink hover:bg-surface-2" aria-label="Mês anterior" onClick={() => shift(-1)}><ChevronLeft className="h-5 w-5" /></button>
          <button className="rounded-sm p-1 text-ink hover:bg-surface-2" aria-label="Próximo mês" onClick={() => shift(1)}><ChevronRight className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-xs text-muted">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => <span key={d} className="pb-2">{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {cells.map((d) => {
          const k = isoDay(d);
          const info = days.find((x) => x.day === k);
          const inMonth = d.getMonth() === m - 1;
          return (
            <button key={k} onClick={() => onPick(k)} aria-pressed={k === selected} aria-label={`${d.getDate()}${info ? `, ${info.types.length} tipo(s) de atividade` : ''}`} className="flex flex-col items-center gap-0.5 py-1">
              <span className={clsx('num flex h-8 w-8 items-center justify-center rounded-circle text-sm', k === selected ? 'bg-primary font-bold text-white' : k === today ? 'font-bold text-primary' : inMonth ? 'text-ink' : 'text-faint')}>{d.getDate()}</span>
              <span className="flex h-1.5 gap-0.5">{(info?.types ?? []).slice(0, 3).map((t) => <span key={t} className={clsx('h-1.5 w-1.5 rounded-circle', DOT[t])} />)}</span>
            </button>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {(['tarefa', 'ligacao', 'reuniao', 'email', 'whatsapp'] as ActivityType[]).map((t) => <li key={t} className="flex items-center gap-1.5"><span className={clsx('h-2 w-2 rounded-circle', DOT[t])} />{ACTIVITY_TYPE_LABELS[t]}</li>)}
      </ul>
    </section>
  );
}

export function ActivitiesPage() {
  const { can } = useAuth();
  const lookups = useLookups();
  const team = can('atividades', 'equipe');
  const [f, setF] = useUrlState({ type: '', status: 'todas', ownerId: '', day: '', q: '' });
  const day = f.day || todayIso();
  const [search, setSearch] = useState(f.q);
  const dq = useDebounced(search);
  useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [month, setMonth] = useState(day.slice(0, 7));
  useEffect(() => setMonth(day.slice(0, 7)), [day]);
  const [creating, setCreating] = useState(false);
  const scope = team ? 'equipe' : 'minhas';

  const q = useQuery({
    queryKey: ['activities', 'agenda', f, day, scope],
    placeholderData: keepPreviousData,
    queryFn: () => api<ListResp>(`/activities${qs({ scope, status: f.status, type: f.type, ownerId: f.ownerId, q: f.q, from: day, days: 2, pageSize: 100 })}`),
  });
  const cal = useQuery({ queryKey: ['activities', 'calendar', month, scope], queryFn: () => api<CalResp>(`/activities/calendar${qs({ month, scope })}`) });
  const groups = useMemo(() => {
    const items = q.data?.items ?? [];
    return [day, addDays(day, 1)].map((d) => ({ day: d, items: items.filter((a) => a.dueAt && localDayKey(a.dueAt) === d) }));
  }, [q.data, day]);
  const tc = q.data?.typeCounts;
  const total = tc ? Object.values(tc).reduce((a, b) => a + b, 0) : undefined;
  const dayLabel = new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="w-full">
      <PageHeader
        icon={<CalendarCheck className="h-9 w-9" strokeWidth={2.2} />}
        title="Atividades"
        subtitle="Organize suas tarefas e mantenha o foco nas suas vendas."
        actions={<Button variant="primary" size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => setCreating(true)}>Nova atividade</Button>}
      />
      <Tabs<string>
        label="Tipos de atividade"
        className="mb-5"
        value={f.type}
        onChange={(t) => setF({ type: t })}
        tabs={[
          { key: '', label: 'Todas', count: total },
          { key: 'tarefa', label: 'Tarefas', count: tc?.tarefa },
          { key: 'ligacao', label: 'Ligações', count: tc?.ligacao },
          { key: 'reuniao', label: 'Reuniões', count: tc?.reuniao },
          { key: 'email', label: 'E-mails', count: tc?.email },
          { key: 'whatsapp', label: 'WhatsApp', count: tc?.whatsapp },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3" role="search">
        <div className="relative min-w-[220px] flex-1 lg:max-w-[280px]">
          <label htmlFor="act-q" className="sr-only">Buscar atividades</label>
          <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted" aria-hidden />
          <Input id="act-q" className="h-12 pl-10" placeholder="Buscar atividades..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select aria-label="Tipo" className="h-12 w-auto min-w-[170px]" value={f.type} onChange={(e) => setF({ type: e.target.value })}>
          <option value="">Todos os tipos</option>
          {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{ACTIVITY_TYPE_LABELS[t]}</option>)}
        </Select>
        <Select aria-label="Status" className="h-12 w-auto min-w-[170px]" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
          <option value="todas">Todos os status</option>
          <option value="abertas">Pendentes</option>
          <option value="atrasadas">Atrasadas</option>
          <option value="concluidas">Concluídas</option>
        </Select>
        {team && (
          <Select aria-label="Responsável" className="h-12 w-auto min-w-[200px]" value={f.ownerId} onChange={(e) => setF({ ownerId: e.target.value })}>
            <option value="">Todos os responsáveis</option>
            {lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
        <label className="relative flex h-12 min-w-[240px] flex-1 cursor-pointer items-center gap-3 rounded-md border border-line bg-surface px-4 text-md text-text lg:max-w-[290px]">
          <CalendarDays className="h-5 w-5 text-ink" aria-hidden />
          <span className="flex-1">{day === todayIso() ? `Hoje, ${dayLabel}` : dayLabel}</span>
          <ChevronDown className="h-4 w-4" aria-hidden />
          <input type="date" aria-label="Escolher dia" className="absolute inset-0 cursor-pointer opacity-0" value={day} onChange={(e) => e.target.value && setF({ day: e.target.value })} />
        </label>
        <div className="flex">
          <button className="flex h-12 w-11 items-center justify-center rounded-l-md border border-line bg-surface text-ink hover:bg-surface-2" aria-label="Dia anterior" onClick={() => setF({ day: addDays(day, -1) })}><ChevronLeft className="h-5 w-5" /></button>
          <button className="flex h-12 w-11 items-center justify-center rounded-r-md border border-l-0 border-line bg-surface text-ink hover:bg-surface-2" aria-label="Próximo dia" onClick={() => setF({ day: addDays(day, 1) })}><ChevronRight className="h-5 w-5" /></button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          {q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : groups.map((g) => (
            <section key={g.day} className="card px-5 py-4" aria-label={fmtDayHeading(new Date(`${g.day}T12:00:00`))}>
              <h2 className="mb-1 text-lg font-bold text-ink">{fmtDayHeading(new Date(`${g.day}T12:00:00`))}</h2>
              {g.items.length === 0 ? <EmptyState title="Nenhuma atividade neste dia" /> : <ul className="divide-y divide-line">{g.items.map((a) => <ActivityRow key={a.id} a={a} showOwner={team} />)}</ul>}
            </section>
          ))}
        </div>
        <div className="space-y-4">
          <MonthCalendar month={month} selected={day} days={cal.data?.days ?? []} onPick={(d) => setF({ day: d })} onMonth={setMonth} />
          <section className="card p-5" aria-labelledby="h-next">
            <div className="mb-2 flex items-center justify-between">
              <h2 id="h-next" className="text-lg font-bold text-ink">Próximas atividades</h2>
              <button className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline" onClick={() => setF({ day: addDays(todayIso(), 1), status: 'abertas' })}>Ver todas <ArrowRight className="h-4 w-4" /></button>
            </div>
            {!cal.data ? <LoadingRows rows={3} /> : cal.data.upcoming.length === 0 ? <p className="py-4 text-sm text-muted">Nada agendado para os próximos dias.</p> : (
              <ul className="divide-y divide-line">
                {cal.data.upcoming.map((a) => (
                  <li key={a.id} className="grid grid-cols-[22px_110px_24px_1fr] items-center gap-2.5 py-3 text-sm">
                    <Clock3 className="h-[18px] w-[18px] text-primary" aria-hidden />
                    <span className="text-muted">{fmtRelativeShort(a.dueAt)}</span>
                    <span aria-hidden className="[&>svg]:h-[18px] [&>svg]:w-[18px]">{TYPE_ICON[a.type]}</span>
                    <span className="min-w-0"><span className="block truncate font-semibold text-ink">{a.title}</span><span className="block truncate text-xs text-muted">{a.contactName ?? ''}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card p-5" aria-labelledby="h-week">
            <h2 id="h-week" className="mb-3 text-lg font-bold text-ink">Resumo da semana</h2>
            <ul className="grid grid-cols-4 gap-2">
              {([
                { t: 'tarefa', label: 'Tarefas', icon: <CheckSquare className="h-5 w-5" />, tone: 'bg-primary text-white' },
                { t: 'ligacao', label: 'Ligações', icon: <Phone className="h-5 w-5" />, tone: 'bg-success-soft text-success' },
                { t: 'reuniao', label: 'Reuniões', icon: <Users className="h-5 w-5" />, tone: 'bg-purple-soft text-purple' },
                { t: 'email', label: 'E-mails', icon: <FileText className="h-5 w-5" />, tone: 'bg-warning-soft text-[#F59E0B]' },
              ] as const).map((x) => (
                <li key={x.t} className="flex flex-col items-center rounded-md border border-line p-2.5 text-center">
                  <span className="flex items-center gap-1.5"><span className={clsx('flex h-8 w-8 items-center justify-center rounded-sm', x.tone)}>{x.icon}</span><span className="num text-xl font-extrabold text-ink">{cal.data?.week[x.t] ?? '—'}</span></span>
                  <span className="mt-1 text-xs text-muted">{x.label}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Nova atividade" footer={<><Button onClick={() => setCreating(false)}>Cancelar</Button><Button variant="primary" type="submit" form="new-activity">Agendar</Button></>}>
        <ActivityComposer formId="new-activity" hideSubmit defaultType="tarefa" onDone={() => setCreating(false)} />
      </Modal>
    </div>
  );
}
