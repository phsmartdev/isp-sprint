/**
 * Gestão de Times → Férias: calendário de 12 meses por time, sugestão automática sem choque de gozo no mesmo time,
 * ajustes da liderança (datas, dias, confirmar, cancelar), saldos por período aquisitivo e as regras da empresa.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Palmtree, Plus, Settings2, Sparkles } from 'lucide-react';
import { isoAddDays, VACATION_STATUS_LABELS, VACATION_WEEKDAYS, type VacationSettings, type VacationStatus } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { PageHeader } from '../../components/layout/PageHeader';
import { errMsg } from '../../features/contracts/shared';

type Period = { start: string; end: string; concessiveEnd: string; balance: number; expired: boolean };
type Person = { id: string; name: string; teamIds: string[]; admissionDate: string | null; canManage: boolean; periods: Period[] };
type Vac = { id: string; userId: string; periodStart: string; startDate: string; endDate: string; days: number; status: VacationStatus; source: 'automatica' | 'manual'; note: string | null; alertedAt: string | null };
type Data = { today: string; settings: VacationSettings; settingsVersion: number; canConfigure: boolean; teams: { id: string; name: string; leads: string[] }[]; people: Person[]; vacations: Vac[] };
type SuggestResult = { created: number; unplaced: { userId: string; name: string; periodStart: string; days: number; concessiveEnd: string; reason: string }[]; withoutAdmission: { userId: string; name: string }[] };

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const dayIndex = (from: string, iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const SPAN = 365;

export function VacationsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ferias'], queryFn: () => api<Data>('/times/ferias') });
  const [team, setTeam] = useState<string>('');
  const [edit, setEdit] = useState<Vac | null>(null);
  const [adding, setAdding] = useState<Person | null>(null);
  const [admission, setAdmission] = useState<Person | null>(null);
  const [rules, setRules] = useState(false);
  const [result, setResult] = useState<SuggestResult | null>(null);
  const suggest = useMutation({
    mutationFn: () => api<SuggestResult>('/times/ferias/suggest', { method: 'POST', body: { teamId: team || null } }),
    onSuccess: (r) => { setResult(r); void qc.invalidateQueries({ queryKey: ['ferias'] }); toast({ tone: 'success', message: `${r.created} férias sugeridas, sem choque no time` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const d = q.data;
  const from = useMemo(() => (d ? `${d.today.slice(0, 7)}-01` : ''), [d]);
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError || !d) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const names = Object.fromEntries(d.people.map((p) => [p.id, p.name]));
  const teams = team ? d.teams.filter((t) => t.id === team) : d.teams;
  const anyManage = d.people.some((p) => p.canManage);
  const months = Array.from({ length: 12 }, (_, i) => { const [y, m] = from.split('-').map(Number); const dt = new Date(Date.UTC(y!, m! - 1 + i, 1)); return { label: `${MONTHS[dt.getUTCMonth()]}${dt.getUTCMonth() === 0 || i === 0 ? ` ${String(dt.getUTCFullYear()).slice(2)}` : ''}`, at: dayIndex(from, dt.toISOString().slice(0, 10)) }; });
  const todayAt = dayIndex(from, d.today);
  const st = d.settings;
  const expiring = d.people.flatMap((p) => p.periods.filter((x) => !x.expired && x.balance > 0 && x.end < d.today && dayIndex(d.today, x.concessiveEnd) <= 90).map((x) => ({ p, x })));

  return (
    <div>
      <PageHeader icon={<Palmtree />} title="Férias" subtitle={`Sem choque de gozo no mesmo time. Sugestão automática, ajustável pela liderança. Aviso ${st.alertDaysBefore} dias antes para a pessoa e a liderança reverem rotinas e tarefas.`}
        actions={<div className="flex flex-wrap gap-2">
          {d.canConfigure && <Button variant="outline" icon={<Settings2 className="h-4 w-4" />} onClick={() => setRules(true)}>Regras</Button>}
          {anyManage && <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} loading={suggest.isPending} onClick={() => suggest.mutate()}>Sugerir férias automaticamente</Button>}
        </div>} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">Time
          <Select aria-label="Filtrar time" className="h-9 w-[220px]" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Todos os meus times</option>
            {d.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </label>
        <span className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-5 bg-primary" />Programada</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-5 border-2 border-dashed border-primary bg-primary/15" />Sugerida (a confirmar)</span>
          <span>Regras v{d.settingsVersion}: {st.daysPerPeriod} dias, até {st.maxSplits} blocos, um com {st.minMainBlockDays}+ dias, nenhum abaixo de {st.minBlockDays}; não começa em {st.blockedStartWeekdays.map((w) => VACATION_WEEKDAYS[w]).join(' ou ')}.</span>
        </span>
      </div>

      {result && (result.unplaced.length > 0 || result.withoutAdmission.length > 0) && (
        <div className="mb-4 space-y-2">
          {result.unplaced.map((u) => <Notice key={`${u.userId}${u.periodStart}`} tone="warning">{u.name}: {u.days} dias do período de {fmtDate(u.periodStart)} sem janela. {u.reason} Ajuste à mão ou mova férias de colegas.</Notice>)}
          {result.withoutAdmission.length > 0 && <Notice tone="warning">Sem admissão informada (não entram na sugestão): {result.withoutAdmission.map((w) => w.name).join(', ')}.</Notice>}
        </div>
      )}
      {expiring.length > 0 && (
        <section aria-label="Períodos vencendo" className="mb-4 border-l-4 border-[#B45309] bg-[#FFF7E6] p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-ink"><AlertTriangle className="h-4 w-4 text-[#B45309]" />Períodos com saldo e concessivo vencendo em até 90 dias</p>
          <ul className="mt-1 text-muted">{expiring.map(({ p, x }) => <li key={p.id + x.start}>{p.name}: {x.balance} dias do período {fmtDate(x.start)} a {fmtDate(x.end)}, gozo até {fmtDate(x.concessiveEnd)}</li>)}</ul>
        </section>
      )}

      {!teams.length ? <EmptyState title="Nenhum time" description="Você ainda não participa nem lidera um time. Times e líderes ficam em Configurações → Usuários e times." /> : teams.map((t) => {
        const members = d.people.filter((p) => p.teamIds.includes(t.id));
        return (
          <section key={t.id} aria-label={`Férias do time ${t.name}`} className="card mb-4 p-4">
            <h2 className="mb-2 text-lg font-bold text-ink">{t.name}<span className="ml-2 text-sm font-normal text-muted">{t.leads.length ? `Liderança: ${t.leads.map((l) => names[l] ?? '').filter(Boolean).join(', ')}` : 'sem líder definido'}</span></h2>
            <div className="overflow-x-auto">
              <div className="min-w-[960px]">
                <div className="grid grid-cols-[220px_1fr] border-b border-line text-xs text-muted">
                  <span className="py-1">Pessoa</span>
                  <div className="relative h-5">{months.map((m) => <span key={m.at} className="absolute top-0 border-l border-line pl-1" style={{ left: `${(m.at / SPAN) * 100}%` }}>{m.label}</span>)}</div>
                </div>
                {members.map((p) => {
                  const vs = d.vacations.filter((v) => v.userId === p.id);
                  const open = p.periods.filter((x) => x.balance > 0 && !x.expired && x.end < isoAddDays(d.today, SPAN));
                  return (
                    <div key={p.id} className="grid grid-cols-[220px_1fr] items-center border-b border-line py-1.5">
                      <div className="pr-2">
                        <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                        <p className="text-xs text-muted">
                          {p.admissionDate ? <>Admissão {fmtDate(p.admissionDate)}</> : <span className="text-[#B45309]">sem admissão</span>}
                          {p.canManage && <button type="button" className="ml-2 font-semibold text-primary hover:underline" aria-label={`Admissão de ${p.name}`} onClick={() => setAdmission(p)}>{p.admissionDate ? 'alterar' : 'informar'}</button>}
                        </p>
                        {open.length > 0 && <p className="text-xs text-muted">Saldo: {open.map((x) => `${x.balance}d (até ${fmtDate(x.concessiveEnd)})`).join(' · ')}</p>}
                        {p.canManage && p.admissionDate && <button type="button" className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-primary hover:underline" aria-label={`Programar férias de ${p.name}`} onClick={() => setAdding(p)}><Plus className="h-3 w-3" />programar</button>}
                      </div>
                      <div className="relative h-8 bg-surface-2">
                        {months.map((m) => <span key={m.at} className="absolute inset-y-0 border-l border-line/70" style={{ left: `${(m.at / SPAN) * 100}%` }} />)}
                        {todayAt >= 0 && <span className="absolute inset-y-0 w-px bg-danger" style={{ left: `${(todayAt / SPAN) * 100}%` }} title="hoje" />}
                        {vs.map((v) => {
                          const a = Math.max(0, dayIndex(from, v.startDate)), b = Math.min(SPAN, dayIndex(from, v.endDate) + 1);
                          if (b <= 0 || a >= SPAN) return null;
                          return (
                            <button key={v.id} type="button" disabled={!p.canManage && false}
                              aria-label={`Férias de ${p.name}: ${fmtDate(v.startDate)} a ${fmtDate(v.endDate)}, ${VACATION_STATUS_LABELS[v.status]}`}
                              title={`${fmtDate(v.startDate)} a ${fmtDate(v.endDate)} · ${v.days} dias · ${VACATION_STATUS_LABELS[v.status]}`}
                              onClick={() => setEdit(v)}
                              className={clsx('absolute inset-y-1 overflow-hidden whitespace-nowrap px-1 text-left text-2xs font-semibold', v.status === 'programada' ? 'bg-primary text-white' : 'border-2 border-dashed border-primary bg-primary/15 text-primary')}
                              style={{ left: `${(a / SPAN) * 100}%`, width: `${((b - a) / SPAN) * 100}%` }}>
                              {v.days}d
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}

      {edit && <EditVacation v={edit} person={d.people.find((p) => p.id === edit.userId)!} settings={st} onClose={() => setEdit(null)} />}
      {adding && <AddVacation person={adding} today={d.today} onClose={() => setAdding(null)} />}
      {admission && <AdmissionModal person={admission} today={d.today} onClose={() => setAdmission(null)} />}
      {rules && <RulesModal settings={st} onClose={() => setRules(false)} />}
    </div>
  );
}

function useSaved(onClose: () => void, msg: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return { onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ferias'] }); void qc.invalidateQueries({ queryKey: ['ferias-history'] }); toast({ tone: 'success', message: msg }); onClose(); } };
}

function EditVacation({ v, person, settings, onClose }: { v: Vac; person: Person; settings: VacationSettings; onClose: () => void }) {
  const [start, setStart] = useState(v.startDate);
  const [days, setDays] = useState(String(v.days));
  const [err, setErr] = useState<string | null>(null);
  const hist = useQuery({ queryKey: ['ferias-history', v.id], queryFn: () => api<{ items: { type: string; payload: { title?: string }; at: string; by: string | null }[] }>(`/times/ferias/${v.id}/history`) });
  const done = useSaved(onClose, 'Férias atualizadas');
  const save = useMutation({ mutationFn: (status?: VacationStatus) => api(`/times/ferias/${v.id}`, { method: 'PATCH', body: { startDate: start, days: Number(days), ...(status ? { status } : {}) } }), ...done, onError: (e) => setErr(errMsg(e)) });
  const end = start && Number(days) > 0 ? isoAddDays(start, Number(days) - 1) : null;
  return (
    <Drawer open onClose={onClose} title={`Férias de ${person.name}`}
      footer={person.canManage ? <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={() => save.mutate('cancelada')}>Cancelar férias</Button>
        <span className="flex gap-2">
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Salvar</Button>
          {v.status !== 'programada' && <Button variant="primary" onClick={() => save.mutate('programada')} loading={save.isPending}>Confirmar (programar)</Button>}
        </span>
      </div> : undefined}>
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm"><Chip tone={v.status === 'programada' ? 'blue' : 'yellow'}>{VACATION_STATUS_LABELS[v.status]}</Chip>{v.source === 'automatica' && <span className="text-muted">sugestão automática</span>}</p>
        <p className="text-sm text-muted">Período aquisitivo que começa em {fmtDate(v.periodStart)}.</p>
        {err && <p role="alert" className="bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
        {person.canManage ? (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Início" htmlFor="vac-start"><Input id="vac-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
            <FormField label="Dias" htmlFor="vac-days" hint={`Mínimo ${settings.minBlockDays}`}><Input id="vac-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /></FormField>
          </div>
        ) : <p className="text-sm">{fmtDate(v.startDate)} a {fmtDate(v.endDate)} ({v.days} dias). Só a liderança altera.</p>}
        {end && person.canManage && <p className="text-sm text-muted">Volta ao trabalho depois de {fmtDate(end)}.</p>}
        <section aria-label="Histórico das férias">
          <h3 className="mb-1 text-sm font-semibold text-ink">Histórico</h3>
          <ul className="space-y-1 text-xs text-muted">{(hist.data?.items ?? []).map((h, i) => <li key={i}>{fmtDate(h.at)} · {h.by ?? 'Sistema'}: {h.payload.title}</li>)}</ul>
        </section>
      </div>
    </Drawer>
  );
}

function AddVacation({ person, today, onClose }: { person: Person; today: string; onClose: () => void }) {
  const periods = person.periods.filter((x) => x.balance > 0 && !x.expired);
  const [period, setPeriod] = useState(periods[0]?.start ?? '');
  const [start, setStart] = useState(isoAddDays(today, 30));
  const [days, setDays] = useState(String(periods[0]?.balance ?? 30));
  const [status, setStatus] = useState<'programada' | 'sugerida'>('programada');
  const [err, setErr] = useState<string | null>(null);
  const done = useSaved(onClose, 'Férias programadas');
  const save = useMutation({ mutationFn: () => api('/times/ferias', { method: 'POST', body: { userId: person.id, periodStart: period, startDate: start, days: Number(days), status } }), ...done, onError: (e) => setErr(errMsg(e)) });
  return (
    <Modal open onClose={onClose} title={`Programar férias de ${person.name}`} footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Fechar</Button><Button variant="primary" loading={save.isPending} disabled={!period} onClick={() => save.mutate()}>Salvar</Button></div>}>
      <div className="space-y-3">
        {err && <p role="alert" className="bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
        {!periods.length ? <p className="text-sm text-muted">Sem saldo de férias nos períodos abertos.</p> : (
          <>
            <FormField label="Período aquisitivo" htmlFor="vac-period"><Select id="vac-period" value={period} onChange={(e) => setPeriod(e.target.value)}>{periods.map((x) => <option key={x.start} value={x.start}>{fmtDate(x.start)} a {fmtDate(x.end)} · saldo {x.balance} dias · gozo até {fmtDate(x.concessiveEnd)}</option>)}</Select></FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Início" htmlFor="vac-new-start"><Input id="vac-new-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
              <FormField label="Dias" htmlFor="vac-new-days"><Input id="vac-new-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /></FormField>
            </div>
            <FormField label="Situação" htmlFor="vac-new-status"><Select id="vac-new-status" value={status} onChange={(e) => setStatus(e.target.value as 'programada' | 'sugerida')}><option value="programada">Programada (confirmada)</option><option value="sugerida">Sugerida (a confirmar)</option></Select></FormField>
          </>
        )}
      </div>
    </Modal>
  );
}

function AdmissionModal({ person, today, onClose }: { person: Person; today: string; onClose: () => void }) {
  const [date, setDate] = useState(person.admissionDate ?? '');
  const [err, setErr] = useState<string | null>(null);
  const done = useSaved(onClose, 'Admissão salva');
  const save = useMutation({ mutationFn: () => api(`/times/ferias/people/${person.id}/admission`, { method: 'PUT', body: { admissionDate: date } }), ...done, onError: (e) => setErr(errMsg(e)) });
  return (
    <Modal open onClose={onClose} title={`Admissão de ${person.name}`} size="sm" footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Fechar</Button><Button variant="primary" disabled={!date} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></div>}>
      {err && <p role="alert" className="mb-2 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      <FormField label="Data de admissão" htmlFor="vac-adm" hint="Base dos períodos aquisitivos (12 meses) e do prazo de gozo."><Input id="vac-adm" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></FormField>
    </Modal>
  );
}

function RulesModal({ settings, onClose }: { settings: VacationSettings; onClose: () => void }) {
  const [v, setV] = useState(settings);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const done = useSaved(onClose, 'Regras de férias publicadas');
  const save = useMutation({ mutationFn: () => api('/times/ferias/settings', { method: 'POST', body: { ...v, note } }), ...done, onError: (e) => setErr(errMsg(e)) });
  const num = (k: keyof VacationSettings, label: string, hint?: string) => (
    <FormField label={label} htmlFor={`rule-${k}`} hint={hint}><Input id={`rule-${k}`} inputMode="numeric" value={String(v[k])} onChange={(e) => setV({ ...v, [k]: Number(e.target.value.replace(/\D/g, '') || 0) })} /></FormField>
  );
  return (
    <Modal open onClose={onClose} title="Regras de férias" size="lg" footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Fechar</Button><Button variant="primary" disabled={note.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>Publicar nova versão</Button></div>}>
      {err && <p role="alert" className="mb-2 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {num('daysPerPeriod', 'Dias por período aquisitivo')}
        {num('maxSplits', 'Em até quantos blocos')}
        {num('minMainBlockDays', 'Bloco principal mínimo (dias)')}
        {num('minBlockDays', 'Bloco mínimo (dias)')}
        {num('alertDaysBefore', 'Aviso antes do início (dias)', 'Pessoa e liderança revisam rotinas e tarefas do período')}
        <FormField label="Dia preferido para a sugestão começar" htmlFor="rule-pref"><Select id="rule-pref" value={v.preferredStartWeekday} onChange={(e) => setV({ ...v, preferredStartWeekday: Number(e.target.value) })}>{VACATION_WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</Select></FormField>
      </div>
      <fieldset className="mt-3"><legend className="text-sm font-semibold text-ink">Não pode começar em</legend>
        <div className="mt-1 flex flex-wrap gap-3">{VACATION_WEEKDAYS.map((w, i) => <label key={w} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={v.blockedStartWeekdays.includes(i)} onChange={(e) => setV({ ...v, blockedStartWeekdays: e.target.checked ? [...v.blockedStartWeekdays, i].sort() : v.blockedStartWeekdays.filter((x) => x !== i) })} />{w}</label>)}</div>
      </fieldset>
      <FormField className="mt-3" label="Motivo da mudança" htmlFor="rule-note" required><Input id="rule-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: acordo coletivo 2027" /></FormField>
      <p className="mt-2 text-xs text-muted">Cada publicação vira uma nova versão; as anteriores ficam guardadas.</p>
    </Modal>
  );
}
