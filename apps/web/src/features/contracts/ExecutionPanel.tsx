/**
 * Execução do contrato: SLA contratado × realizado, ocorrências e penalidades, fiscal e gestor do órgão,
 * cláusulas críticas com prazo e atestados de capacidade técnica.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Download, Plus } from 'lucide-react';
import {
  CERT_STATUS, CERT_STATUS_LABELS, CLAUSE_KINDS, CLAUSE_LABELS, OCCURRENCE_KINDS, OCCURRENCE_LABELS, OCCURRENCE_STATUS, OCCURRENCE_STATUS_LABELS,
  PENALTY_KINDS, SLA_DEFAULTS, SLA_METRICS, SLA_METRIC_LABELS, allowedDowntimeHours, type OccurrenceKind, type SlaMetric,
} from '@isp/domain';
import { api } from '../../lib/api';
import { fileToBase64 } from '../../lib/files';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { Button, EmptyState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { MoneyInput } from '../DealFields';
import { errMsg, todayIso, type ContractDetail } from './shared';

type Meas = { id: string; period: string; value: number; note: string | null; status: 'cumprido' | 'violado' | 'sem_medicao' };
type Sla = { id: string; metric: SlaMetric; metricLabel: string; label: string; target: number; unit: string; direction: 'maior' | 'menor'; penaltyNote: string | null; measurements: Meas[]; last: { period: string; value: number; status: string } | null };
type Upd = { id: string; status: string; note: string; amountCents: number | null; createdAt: string; by: string | null };
type Occ = { id: string; kind: OccurrenceKind; kindLabel: string; occurredOn: string; title: string; description: string | null; amountCents: number | null; responseDueAt: string | null; reference: string | null; ownerName: string | null; status: string; statusLabel: string; open: boolean; updates: Upd[] };
type Party = { role: string; label: string; person: { name: string; email: string | null; phone: string | null; appointment: string | null; since: string | null } | null; history: number };
type Clause = { id: string; kind: string; kindLabel: string; reference: string | null; title: string; excerpt: string | null; deadline: string | null; remindDays: number; daysLeft: number | null };
type Cert = { id: string; status: string; statusLabel: string; issuer: string | null; issuedOn: string | null; services: string | null; quantities: string | null; note: string | null; filename: string | null; createdAt: string; supersededAt: string | null; by: string | null };
type Data = {
  slas: Sla[]; occurrences: Occ[]; parties: { current: Party[] }; clauses: Clause[]; certificates: Cert[];
  certificateDue: { dueAt: string; stage: 'meio' | 'fim'; requested: boolean } | null;
  summary: { penaltiesCents: number; openOccurrences: number; slaViolations: number }; canManage: boolean; canOperate: boolean;
};
const STATUS_TONE: Record<string, string> = { cumprido: 'bg-success-soft text-success', violado: 'bg-danger-soft text-danger', sem_medicao: 'bg-surface-2 text-faint' };
const monthLabel = (p: string) => new Date(`${p}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');

function Section({ title, sub, action, children, label }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode; label: string }) {
  return (
    <section aria-label={label} className="border-t border-line pt-5 first:border-0 first:pt-0">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-md font-bold text-ink">{title}</h3>{sub && <p className="text-sm text-muted">{sub}</p>}</div>{action}</div>
      {children}
    </section>
  );
}

export function ExecutionPanel({ c }: { c: ContractDetail }) {
  const q = useQuery({ queryKey: ['contract-execution', c.id], queryFn: () => api<Data>(`/contracts/${c.id}/execution`) });
  const [dlg, setDlg] = useState<null | { k: 'sla' } | { k: 'meas'; sla: Sla } | { k: 'occ' } | { k: 'upd'; occ: Occ } | { k: 'party'; role: string; label: string } | { k: 'clause' } | { k: 'cert' }>(null);
  if (q.isLoading || !q.data) return <LoadingRows rows={6} />;
  const d = q.data;
  const add = (label: string, onClick: () => void, show = true) => (show ? <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={onClick}>{label}</Button> : null);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Resumo da execução">
        {[['Penalidades (multas e glosas)', fmtBRL(d.summary.penaltiesCents), d.summary.penaltiesCents ? 'text-danger' : 'text-ink'], ['Ocorrências abertas', String(d.summary.openOccurrences), d.summary.openOccurrences ? 'text-[#C2610C]' : 'text-ink'], ['Meses com SLA violado', String(d.summary.slaViolations), d.summary.slaViolations ? 'text-danger' : 'text-ink']].map(([l, v, tone]) => (
          <div key={l} className="border border-line p-3"><p className="text-xs text-muted">{l}</p><p className={clsx('num text-xl font-extrabold', tone)}>{v}</p></div>
        ))}
      </div>

      <Section label="SLA contratado e realizado" title="SLA contratado × realizado" sub="Meta de cada indicador de serviço e o realizado mês a mês." action={add('Cadastrar SLA', () => setDlg({ k: 'sla' }), d.canManage)}>
        {!d.slas.length ? <EmptyState title="Nenhum SLA cadastrado" description="Cadastre as metas do contrato (disponibilidade, tempo de reparo...) para acompanhar o realizado e as multas." /> : (
          <ul className="space-y-3">{d.slas.map((x) => (
            <li key={x.id} className="border border-line p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">{x.label} <span className="font-normal text-muted">meta {x.direction === 'maior' ? '≥' : '≤'} <span className="num">{x.target.toLocaleString('pt-BR')}{x.unit}</span>{x.metric === 'disponibilidade' ? ` · até ${allowedDowntimeHours(x.target).toLocaleString('pt-BR')} h fora do ar por mês` : ''}</span></span>
                {d.canOperate && <Button size="sm" variant="outline" onClick={() => setDlg({ k: 'meas', sla: x })}>Registrar mês</Button>}
              </div>
              {x.penaltyNote && <p className="mt-1 text-xs text-muted">Penalidade prevista: {x.penaltyNote}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {x.measurements.length ? [...x.measurements].reverse().map((m) => <span key={m.id} title={m.note ?? undefined} className={clsx('num px-2 py-1 text-xs font-semibold', STATUS_TONE[m.status])}>{monthLabel(m.period)} · {m.value.toLocaleString('pt-BR')}{x.unit}</span>) : <span className="text-xs text-muted">Nenhum mês registrado.</span>}
              </div>
            </li>
          ))}</ul>
        )}
      </Section>

      <Section label="Ocorrências e penalidades" title="Ocorrências e penalidades" sub="Falhas, notificações do órgão, advertências, multas e glosas, com o prazo de resposta e o histórico." action={add('Registrar ocorrência', () => setDlg({ k: 'occ' }), d.canOperate)}>
        {!d.occurrences.length ? <p className="text-sm text-muted">Nenhuma ocorrência registrada.</p> : (
          <ul className="space-y-2">{d.occurrences.map((o) => (
            <li key={o.id} className={clsx('border border-line p-3', !o.open && 'bg-surface-2/40')}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">{o.title} <span className="text-xs font-normal text-muted">· {o.kindLabel} · {fmtDate(o.occurredOn)}{o.reference ? ` · ${o.reference}` : ''}</span></span>
                <span className="flex items-center gap-3 text-sm">{o.amountCents ? <b className={clsx('num', o.status === 'revertida' ? 'text-faint line-through' : 'text-danger')}>{fmtBRL(o.amountCents)}</b> : null}<span className={clsx('px-2 py-0.5 text-xs font-semibold', o.open ? 'bg-warning-soft text-[#C2610C]' : 'bg-surface-2 text-muted')}>{o.statusLabel}</span></span>
              </div>
              {o.description && <p className="mt-1 text-sm text-text">{o.description}</p>}
              <p className="mt-1 text-xs text-muted">{o.responseDueAt && o.open ? `Responder até ${fmtDate(o.responseDueAt)} · ` : ''}Com {o.ownerName ?? '—'}</p>
              {o.updates.length > 0 && <ol className="mt-2 space-y-1 border-l-2 border-line pl-3 text-xs text-muted">{o.updates.map((u) => <li key={u.id}><b className="text-text">{OCCURRENCE_STATUS_LABELS[u.status as keyof typeof OCCURRENCE_STATUS_LABELS] ?? u.status}</b> · {u.note} · {u.by ?? '—'} em {fmtDateTime(u.createdAt)}</li>)}</ol>}
              {d.canOperate && <button type="button" className="mt-2 text-xs font-semibold text-primary hover:underline" onClick={() => setDlg({ k: 'upd', occ: o })}>Atualizar situação</button>}
            </li>
          ))}</ul>
        )}
      </Section>

      <Section label="Fiscal e gestor do órgão" title="Fiscal, gestor e preposto" sub="Com quem falar no órgão e quem nos representa. Trocar a pessoa guarda o histórico.">
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">{d.parties.current.map((p) => (
          <li key={p.role} className="flex items-start justify-between gap-3 border border-line p-3">
            <div className="min-w-0 text-sm">
              <p className="text-xs font-semibold text-muted">{p.label}</p>
              {p.person ? <><p className="font-semibold text-ink">{p.person.name}</p><p className="text-xs text-muted">{[p.person.appointment, p.person.email, p.person.phone, p.person.since && `desde ${fmtDate(p.person.since)}`].filter(Boolean).join(' · ')}</p></> : <p className="text-muted">Não informado</p>}
              {p.history > 0 && <p className="text-xs text-faint">{p.history} anterior(es) no histórico</p>}
            </div>
            {d.canOperate && <button type="button" className="shrink-0 text-xs font-semibold text-primary hover:underline" onClick={() => setDlg({ k: 'party', role: p.role, label: p.label })}>{p.person ? 'Trocar' : 'Definir'}</button>}
          </li>
        ))}</ul>
      </Section>

      <Section label="Cláusulas críticas" title="Cláusulas críticas" sub="Obrigações e prazos do contrato que não podem passar; o aviso aparece na Central de atenção." action={add('Registrar cláusula', () => setDlg({ k: 'clause' }), d.canManage)}>
        {!d.clauses.length ? <p className="text-sm text-muted">Nenhuma cláusula crítica registrada.</p> : (
          <ul className="space-y-2">{d.clauses.map((x) => (
            <li key={x.id} className="border border-line p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">{x.reference ? `${x.reference} · ` : ''}{x.title} <span className="text-xs font-normal text-muted">· {x.kindLabel}</span></span>
                {x.deadline && <span className={clsx('text-sm font-semibold', (x.daysLeft ?? 99) < 0 ? 'text-danger' : (x.daysLeft ?? 99) <= x.remindDays ? 'text-[#C2610C]' : 'text-muted')}>Prazo {fmtDate(x.deadline)}{x.daysLeft !== null ? ` (${x.daysLeft < 0 ? `há ${-x.daysLeft} dias` : `em ${x.daysLeft} dias`})` : ''}</span>}
              </div>
              {x.excerpt && <p className="mt-1 whitespace-pre-line text-sm text-text">{x.excerpt}</p>}
              {d.canManage && <RemoveClause c={c} x={x} />}
            </li>
          ))}</ul>
        )}
      </Section>

      <Section label="Atestados de capacidade técnica" title="Atestados de capacidade técnica" sub="Peça o atestado com a execução comprovada: ele vira habilitação técnica nas próximas licitações." action={add('Registrar atestado', () => setDlg({ k: 'cert' }), d.canOperate)}>
        {d.certificateDue && <p className="mb-2 bg-warning-soft px-3 py-2 text-sm text-[#9A4B07]">{d.certificateDue.requested ? 'Atestado pedido e ainda não recebido: cobre o cliente.' : d.certificateDue.stage === 'fim' ? 'Contrato perto do fim e sem atestado: peça antes do encerramento.' : 'Metade da vigência cumprida: já dá para pedir o atestado.'}</p>}
        {!d.certificates.length ? <p className="text-sm text-muted">Nenhum atestado registrado.</p> : (
          <ul className="divide-y divide-line border border-line">{d.certificates.map((x) => (
            <li key={x.id} className={clsx('flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm', x.supersededAt && 'text-faint')}>
              <span><b className={x.supersededAt ? '' : 'text-ink'}>{x.statusLabel}</b>{x.issuer ? ` · ${x.issuer}` : ''}{x.issuedOn ? ` · emitido em ${fmtDate(x.issuedOn)}` : ''}{x.services ? <span className="block text-xs text-muted">{x.services}{x.quantities ? ` · ${x.quantities}` : ''}</span> : null}</span>
              <span className="flex items-center gap-3 text-xs text-muted">{x.by ?? '—'} · {fmtDate(x.createdAt)}{x.filename && <a className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" href={`/api/v1/contracts/certificates/${x.id}/download`}><Download className="h-3.5 w-3.5" />Baixar</a>}</span>
            </li>
          ))}</ul>
        )}
      </Section>

      {dlg && <ExecDialog c={c} dlg={dlg} onClose={() => setDlg(null)} />}
    </div>
  );
}

function RemoveClause({ c, x }: { c: ContractDetail; x: Clause }) {
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api(`/contracts/${c.id}/clauses`, { method: 'POST', body: { kind: x.kind, title: x.title, replaces: x.id, remove: true } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['contract-execution', c.id] }); toast({ tone: 'success', message: 'Cláusula retirada do acompanhamento' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return <button type="button" className="mt-1 text-xs font-semibold text-muted hover:text-danger" disabled={m.isPending} onClick={() => m.mutate()}>Retirar do acompanhamento</button>;
}

type Dlg = { k: 'sla' } | { k: 'meas'; sla: Sla } | { k: 'occ' } | { k: 'upd'; occ: Occ } | { k: 'party'; role: string; label: string } | { k: 'clause' } | { k: 'cert' };
function ExecDialog({ c, dlg, onClose }: { c: ContractDetail; dlg: Dlg; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({ period: todayIso().slice(0, 7), occurredOn: todayIso(), status: dlg.k === 'cert' ? 'solicitado' : dlg.k === 'upd' ? 'defesa_enviada' : '', metric: 'disponibilidade', kind: dlg.k === 'clause' ? 'obrigacao' : 'falha_servico', remindDays: '15' });
  const [money, setMoney] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const num = (v: string | undefined) => (v === undefined || v.trim() === '' ? NaN : Number(v.replace(/\./g, '').replace(',', '.')));
  const cents = money === null ? null : Math.round(money * 100);
  const req = async () => {
    const base = `/contracts/${c.id}`;
    switch (dlg.k) {
      case 'sla': return api(`${base}/slas`, { method: 'POST', body: { metric: f.metric, label: f.label || undefined, target: num(f.target), unit: f.unit || undefined, penaltyNote: f.penaltyNote || null } });
      case 'meas': return api(`${base}/slas/${dlg.sla.id}/measurements`, { method: 'POST', body: { period: f.period, value: num(f.value), note: f.note || null } });
      case 'occ': return api(`${base}/occurrences`, { method: 'POST', body: { kind: f.kind, occurredOn: f.occurredOn, title: f.title, description: f.description || null, amountCents: cents, responseDueAt: f.responseDueAt || null, reference: f.reference || null } });
      case 'upd': return api(`${base}/occurrences/${dlg.occ.id}/updates`, { method: 'POST', body: { status: f.status, note: f.note, amountCents: cents } });
      case 'party': return api(`${base}/parties`, { method: 'POST', body: { role: dlg.role, name: f.name, email: f.email || null, phone: f.phone || null, appointment: f.appointment || null, since: f.since || null } });
      case 'clause': return api(`${base}/clauses`, { method: 'POST', body: { kind: f.kind, reference: f.reference || null, title: f.title, excerpt: f.excerpt || null, deadline: f.deadline || null, remindDays: Number(f.remindDays) || 0 } });
      case 'cert': return api(`${base}/certificates`, { method: 'POST', body: { status: f.status, issuer: f.issuer || null, issuedOn: f.issuedOn || null, services: f.services || null, quantities: f.quantities || null, note: f.note || null, ...(file ? { filename: file.name, data: await fileToBase64(file) } : {}) } });
    }
  };
  const m = useMutation({
    mutationFn: req,
    onSuccess: () => { for (const k of ['contract-execution', 'contracts', 'contract']) void qc.invalidateQueries({ queryKey: [k] }); toast({ tone: 'success', message: 'Registrado' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const title = { sla: 'Cadastrar SLA', meas: `Registrar mês · ${dlg.k === 'meas' ? dlg.sla.label : ''}`, occ: 'Registrar ocorrência', upd: 'Atualizar situação da ocorrência', party: dlg.k === 'party' ? dlg.label : '', clause: 'Registrar cláusula crítica', cert: 'Atestado de capacidade técnica' }[dlg.k];
  const id = (k: string) => `ex-${k}`;
  const txt = (k: string, label: string, props: Record<string, unknown> = {}) => <FormField label={label} htmlFor={id(k)}><Input id={id(k)} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} {...props} /></FormField>;
  const ready = dlg.k === 'sla' ? Number.isFinite(num(f.target)) : dlg.k === 'meas' ? Number.isFinite(num(f.value)) : dlg.k === 'occ' ? (f.title ?? '').trim().length >= 3 && (!PENALTY_KINDS.includes(f.kind as OccurrenceKind) || !!cents) : dlg.k === 'upd' ? (f.note ?? '').trim().length >= 3 : dlg.k === 'party' ? (f.name ?? '').trim().length >= 2 : dlg.k === 'clause' ? (f.title ?? '').trim().length >= 3 : f.status !== 'recebido' || !!file;
  return (
    <Modal open onClose={onClose} title={title} size="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={!ready} onClick={() => m.mutate()}>Salvar</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {dlg.k === 'sla' && <>
          <FormField label="Indicador" htmlFor={id('metric')}><Select id={id('metric')} value={f.metric} onChange={(e) => set('metric', e.target.value)}>{SLA_METRICS.map((x) => <option key={x} value={x}>{SLA_METRIC_LABELS[x]}</option>)}</Select></FormField>
          {txt('target', `Meta (${SLA_DEFAULTS[f.metric as SlaMetric].direction === 'maior' ? 'mínimo' : 'máximo'}, em ${SLA_DEFAULTS[f.metric as SlaMetric].unit || 'unidade'})`, { inputMode: 'decimal', placeholder: f.metric === 'disponibilidade' ? '99,5' : '4' })}
          {txt('label', 'Nome (opcional)')}
          {txt('unit', 'Unidade (opcional)', { placeholder: SLA_DEFAULTS[f.metric as SlaMetric].unit })}
          <div className="sm:col-span-2"><FormField label="Penalidade prevista no contrato" htmlFor={id('penaltyNote')}><Textarea id={id('penaltyNote')} rows={2} value={f.penaltyNote ?? ''} onChange={(e) => set('penaltyNote', e.target.value)} placeholder="Ex.: desconto de 1% da fatura a cada 0,1 p.p. abaixo da meta" /></FormField></div>
        </>}
        {dlg.k === 'meas' && <>
          {txt('period', 'Mês', { type: 'month' })}
          {txt('value', `Realizado (${dlg.sla.unit || 'valor'})`, { inputMode: 'decimal' })}
          <div className="sm:col-span-2">{txt('note', 'Observação (opcional)')}</div>
        </>}
        {dlg.k === 'occ' && <>
          <FormField label="Tipo" htmlFor={id('kind')}><Select id={id('kind')} value={f.kind} onChange={(e) => set('kind', e.target.value)}>{OCCURRENCE_KINDS.map((x) => <option key={x} value={x}>{OCCURRENCE_LABELS[x]}</option>)}</Select></FormField>
          {txt('occurredOn', 'Data', { type: 'date' })}
          <div className="sm:col-span-2">{txt('title', 'Resumo')}</div>
          <FormField label={PENALTY_KINDS.includes(f.kind as OccurrenceKind) ? 'Valor (obrigatório)' : 'Valor (se houver)'} htmlFor={id('amount')}><MoneyInput id={id('amount')} value={money} onChange={setMoney} /></FormField>
          {txt('responseDueAt', 'Prazo para resposta/defesa', { type: 'date' })}
          {txt('reference', 'Referência (ofício, protocolo)')}
          <div className="sm:col-span-2"><FormField label="Descrição" htmlFor={id('description')}><Textarea id={id('description')} rows={3} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} /></FormField></div>
        </>}
        {dlg.k === 'upd' && <>
          <FormField label="Nova situação" htmlFor={id('status')}><Select id={id('status')} value={f.status} onChange={(e) => set('status', e.target.value)}>{OCCURRENCE_STATUS.map((x) => <option key={x} value={x}>{OCCURRENCE_STATUS_LABELS[x]}</option>)}</Select></FormField>
          <FormField label="Valor final (se mudou)" htmlFor={id('amount')}><MoneyInput id={id('amount')} value={money} onChange={setMoney} /></FormField>
          <div className="sm:col-span-2"><FormField label="O que aconteceu" htmlFor={id('note')}><Textarea id={id('note')} rows={3} value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} /></FormField></div>
        </>}
        {dlg.k === 'party' && <>
          {txt('name', 'Nome')}
          {txt('appointment', 'Portaria/designação')}
          {txt('email', 'E-mail', { type: 'email' })}
          {txt('phone', 'Telefone')}
          {txt('since', 'Desde', { type: 'date' })}
        </>}
        {dlg.k === 'clause' && <>
          <FormField label="Tipo" htmlFor={id('kind')}><Select id={id('kind')} value={f.kind} onChange={(e) => set('kind', e.target.value)}>{CLAUSE_KINDS.map((x) => <option key={x} value={x}>{CLAUSE_LABELS[x]}</option>)}</Select></FormField>
          {txt('reference', 'Cláusula (ex.: 7.2)')}
          <div className="sm:col-span-2">{txt('title', 'O que ela exige')}</div>
          {txt('deadline', 'Prazo', { type: 'date' })}
          {txt('remindDays', 'Avisar quantos dias antes', { inputMode: 'numeric' })}
          <div className="sm:col-span-2"><FormField label="Trecho da cláusula" htmlFor={id('excerpt')}><Textarea id={id('excerpt')} rows={3} value={f.excerpt ?? ''} onChange={(e) => set('excerpt', e.target.value)} /></FormField></div>
        </>}
        {dlg.k === 'cert' && <>
          <FormField label="Situação" htmlFor={id('status')}><Select id={id('status')} value={f.status} onChange={(e) => set('status', e.target.value)}>{CERT_STATUS.map((x) => <option key={x} value={x}>{CERT_STATUS_LABELS[x]}</option>)}</Select></FormField>
          {txt('issuer', 'Emitente (órgão/empresa)')}
          {txt('issuedOn', 'Data de emissão', { type: 'date' })}
          {txt('quantities', 'Quantidades atestadas')}
          <div className="sm:col-span-2"><FormField label="Serviços atestados" htmlFor={id('services')}><Textarea id={id('services')} rows={2} value={f.services ?? ''} onChange={(e) => set('services', e.target.value)} placeholder="Ex.: link dedicado 1 Gbps em 12 unidades com SLA 99,5%" /></FormField></div>
          <div className="sm:col-span-2"><FormField label={f.status === 'recebido' ? 'Arquivo do atestado (obrigatório, PDF ou imagem até 4 MB)' : 'Arquivo (opcional)'} htmlFor={id('file')}><input id={id('file')} type="file" accept="application/pdf,image/png,image/jpeg" className="block text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></FormField></div>
        </>}
      </div>
    </Modal>
  );
}

type LibItem = { id: string; issuer: string | null; issuedOn: string | null; services: string | null; quantities: string | null; filename: string | null; contractId: string | null; client: string; number: string | null };
/** Acervo de atestados recebidos: para montar a habilitação técnica de uma licitação. */
export function CertificatesLibrary() {
  const [q, setQ] = useState('');
  const r = useQuery({ queryKey: ['contracts', 'certificates', q], queryFn: () => api<{ items: LibItem[] }>(`/contracts/certificates${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`) });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="Buscar atestados" className="h-11 max-w-md" placeholder="Cliente, emitente ou serviço (ex.: fibra, 1 Gbps)" value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="text-sm text-muted">Atestados de capacidade técnica recebidos, com o arquivo. Registre e peça novos na aba Execução de cada contrato.</p>
      </div>
      {r.isLoading ? <div className="card"><LoadingRows /></div> : !r.data?.items.length ? <div className="card"><EmptyState title="Nenhum atestado recebido" description="Quando um atestado for registrado como recebido num contrato, ele aparece aqui." /></div> : (
        <div className="card overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted"><tr>{['Cliente', 'Emitente', 'Serviços atestados', 'Quantidades', 'Emissão', ''].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>{r.data.items.map((x) => (
            <tr key={x.id} className="border-t border-line align-top">
              <td className="px-4 py-3"><span className="font-semibold text-ink">{x.client}</span>{x.number && <span className="block text-xs text-muted">Contrato {x.number}</span>}</td>
              <td className="px-4 py-3">{x.issuer ?? '—'}</td>
              <td className="px-4 py-3">{x.services ?? '—'}</td>
              <td className="px-4 py-3">{x.quantities ?? '—'}</td>
              <td className="num px-4 py-3">{fmtDate(x.issuedOn)}</td>
              <td className="px-4 py-3">{x.filename && <a className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" href={`/api/v1/contracts/certificates/${x.id}/download`}><Download className="h-4 w-4" />Baixar</a>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
