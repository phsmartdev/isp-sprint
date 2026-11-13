/**
 * Planejamento orçamentário → Revisões e projeção: versões do orçamento (revisão e remanejamento, sem criar dinheiro)
 * e a projeção até o fim do exercício com cenário simples (variação nos meses à frente).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDateTime } from '../../lib/format';
import { LineChart } from '../../components/charts/charts';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from './shared';

type Rev = { id: string; version: number; kind: 'revisao' | 'remanejamento'; status: 'pendente' | 'aprovado' | 'recusado'; justification: string; items: { lineId: string; code: string | null; beforeCents: number; afterCents: number }[]; requestedByName: string | null; decidedByName: string | null; decisionNote: string | null; createdAt: string; needsDirector: boolean; canDecide: boolean };
type Proj = { months: { month: string; approved: number; realized: number; committed: number; projected: number; unplanned: number; future: boolean }[]; totals: { approved: number; realized: number; projected: number; futureCommitments: number; recurringFuture: number; unplannedRecurring: number; risk: number }; notes?: string };
type Line = { id: string; code: string | null; what: string; approved: number; balance: number; approvalState: string };
const toCents = (v: string) => { const n = Number(String(v).replace(/\./g, '').replace(',', '.')); return v.trim() && Number.isFinite(n) ? Math.round(n * 100) : 0; };
const mShort = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');

export function RevisionsPanel({ year }: { year: number }) {
  return <div className="space-y-5"><Projection year={year} /><Revisions year={year} /></div>;
}

function Projection({ year }: { year: number }) {
  const q = useQuery({ queryKey: ['budget', 'projection', year], queryFn: () => api<Proj>(`/budget/projection${qs({ year })}`) });
  const [scenario, setScenario] = useState(0);
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const scen = d.months.map((m) => (m.future ? Math.round(m.projected * (1 + scenario / 100)) : m.projected));
  const scenTotal = scen.reduce((t, x) => t + x, 0);
  return (
    <section className="card p-4" aria-label="Projeção até o fim do exercício">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="font-display text-base font-bold text-ink">Projeção até o fim do exercício</h2><p className="max-w-3xl text-sm text-muted">{d.notes}</p></div>
        <FormField label={`Cenário nos meses à frente: ${scenario > 0 ? '+' : ''}${scenario}%`} htmlFor="pj-s"><input id="pj-s" type="range" min={-30} max={30} step={5} value={scenario} onChange={(e) => setScenario(Number(e.target.value))} className="w-56 accent-primary" /></FormField>
      </div>
      <dl className="mb-3 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4 lg:grid-cols-7">
        {([['Aprovado no ano', d.totals.approved], ['Realizado até agora', d.totals.realized], ['Projeção (cenário)', scenTotal], ['Saldo projetado', d.totals.approved - scenTotal], ['Compromissos a vencer', d.totals.futureCommitments], ['Recorrentes à frente', d.totals.recurringFuture], ['Contratos sem lançamento', d.totals.unplannedRecurring]] as const).map(([k, v]) => (
          <div key={k} className="bg-surface px-3 py-2"><dt className="text-xs text-muted">{k}</dt><dd className={`num font-bold ${k === 'Saldo projetado' && v < 0 ? 'text-danger' : 'text-ink'}`}>{fmtBRL(v)}</dd></div>
        ))}
      </dl>
      {scenTotal > d.totals.approved && <p className="mb-2 text-sm font-semibold text-danger">Risco de excedente: a projeção passa do aprovado em {fmtBRL(scenTotal - d.totals.approved)}.</p>}
      <LineChart categories={d.months.map((m) => mShort(m.month))} ariaLabel="Aprovado, realizado e projeção por mês" format={(v) => fmtBRL(Math.round(v))} tooltipTitle={(i) => d.months[i]!.month}
        series={[{ key: 'a', label: 'Aprovado', color: '#2F5986', values: d.months.map((m) => m.approved) }, { key: 'r', label: 'Realizado', color: '#D4752C', values: d.months.map((m) => m.realized) }, { key: 'p', label: 'Projeção', color: '#8F6BB8', dashed: true, values: scen }]} />
    </section>
  );
}

function Revisions({ year }: { year: number }) {
  const q = useQuery({ queryKey: ['budget', 'revisions', year], queryFn: () => api<{ items: Rev[] }>(`/budget/revisions${qs({ year })}`) });
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const toast = useToast();
  const decide = useMutation({ mutationFn: ({ id, decision }: { id: string; decision: 'aprovar' | 'recusar' }) => api(`/budget/revisions/${id}/decide`, { method: 'POST', body: { decision, note: note[id] || null } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['budget'] }); toast({ tone: 'success', message: 'Decisão registrada' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <section className="card p-4" aria-label="Revisões e remanejamentos">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-display text-base font-bold text-ink">Revisões e remanejamentos</h2><p className="text-sm text-muted">Cada pedido vira uma versão do ano. O valor original de cada lançamento fica preservado; remanejamento não cria dinheiro (o que sai de um entra no outro).</p></div>
        <Button variant="primary" onClick={() => setCreating(true)}>Nova revisão ou remanejamento</Button>
      </div>
      {!q.data!.items.length ? <EmptyState title="Nenhuma revisão no ano" description="Use para remanejar saldo livre entre lançamentos ou revisar valores aprovados." /> : (
        <ul className="divide-y divide-line">{q.data!.items.map((r) => (
          <li key={r.id} className="space-y-1 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><b className="text-ink">v{r.version}</b><Chip tone="blue">{r.kind === 'remanejamento' ? 'Remanejamento' : 'Revisão'}</Chip><Chip tone={r.status === 'aprovado' ? 'green' : r.status === 'recusado' ? 'red' : 'orange'}>{r.status === 'pendente' ? (r.needsDirector ? 'Aguardando a Diretoria' : 'Aguardando decisão') : r.status === 'aprovado' ? 'Aprovado' : 'Recusado'}</Chip><span className="text-xs text-muted">{r.requestedByName} · {fmtDateTime(r.createdAt)}{r.decidedByName ? ` · decidido por ${r.decidedByName}` : ''}</span></div>
            <p className="text-text">{r.justification}</p>
            <ul className="text-xs text-muted">{r.items.map((i) => <li key={i.lineId}>{i.code}: <span className="num">{fmtBRL(i.beforeCents)} → {fmtBRL(i.afterCents)}</span></li>)}</ul>
            {r.decisionNote && <p className="text-xs text-muted">Decisão: {r.decisionNote}</p>}
            {r.canDecide && <div className="flex flex-wrap gap-2 pt-1"><Input aria-label={`Observação da v${r.version}`} className="max-w-xs" placeholder="Observação (obrigatória para recusar)" value={note[r.id] ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} /><Button size="sm" variant="primary" onClick={() => decide.mutate({ id: r.id, decision: 'aprovar' })}>Aprovar</Button><Button size="sm" variant="danger" disabled={!(note[r.id] ?? '').trim()} onClick={() => decide.mutate({ id: r.id, decision: 'recusar' })}>Recusar</Button></div>}
          </li>
        ))}</ul>
      )}
      {creating && <NewRevision year={year} onClose={() => setCreating(false)} />}
    </section>
  );
}

function NewRevision({ year, onClose }: { year: number; onClose: () => void }) {
  const c = useQuery({ queryKey: ['budget', 'central', 'rev-lines', year], queryFn: () => api<{ rows: Line[] }>(`/budget/central${qs({ year })}`) });
  const lines = (c.data?.rows ?? []).filter((r) => r.approvalState === 'aprovado' || r.approvalState === 'aprovado_ressalvas');
  const [v, setV] = useState({ kind: 'remanejamento', from: '', to: '', amount: '', line: '', value: '', justification: '' });
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api('/budget/revisions', { method: 'POST', body: v.kind === 'remanejamento' ? { kind: 'remanejamento', justification: v.justification, moves: [{ fromLineId: v.from, toLineId: v.to, cents: toCents(v.amount) }] } : { kind: 'revisao', justification: v.justification, changes: [{ lineId: v.line, newApprovedCents: toCents(v.value) }] } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['budget'] }); toast({ tone: 'success', message: 'Pedido registrado como nova versão' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const from = lines.find((l) => l.id === v.from);
  const okForm = v.justification.trim().length >= 10 && (v.kind === 'remanejamento' ? v.from && v.to && v.from !== v.to && toCents(v.amount) > 0 : v.line && toCents(v.value) > 0);
  const opt = (l: Line) => <option key={l.id} value={l.id}>{l.code} · {l.what} · aprovado {fmtBRL(l.approved)} · livre {fmtBRL(Math.max(0, l.balance))}</option>;
  return (
    <Modal open onClose={onClose} size="lg" title="Nova revisão ou remanejamento" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={!okForm} onClick={() => save.mutate()}>Pedir</Button></>}>
      {c.isLoading ? <LoadingRows rows={3} /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Tipo" htmlFor="rv-k" className="sm:col-span-2"><Select id="rv-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="remanejamento">Remanejamento (mover saldo livre de um lançamento para outro)</option><option value="revisao">Revisão (novo valor aprovado; aumento só com a Diretoria)</option></Select></FormField>
          {v.kind === 'remanejamento' ? <>
            <FormField label="De (origem)" htmlFor="rv-f" className="sm:col-span-2"><Select id="rv-f" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })}><option value="">Escolha</option>{lines.map(opt)}</Select></FormField>
            <FormField label="Para (destino)" htmlFor="rv-t" className="sm:col-span-2"><Select id="rv-t" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })}><option value="">Escolha</option>{lines.filter((l) => l.id !== v.from).map(opt)}</Select></FormField>
            <FormField label="Valor (R$)" htmlFor="rv-a" hint={from ? `Saldo livre na origem: ${fmtBRL(Math.max(0, from.balance))}` : undefined}><Input id="rv-a" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></FormField>
          </> : <>
            <FormField label="Lançamento" htmlFor="rv-l" className="sm:col-span-2"><Select id="rv-l" value={v.line} onChange={(e) => setV({ ...v, line: e.target.value })}><option value="">Escolha</option>{lines.map(opt)}</Select></FormField>
            <FormField label="Novo valor aprovado (R$)" htmlFor="rv-v"><Input id="rv-v" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></FormField>
          </>}
          <FormField label="Justificativa" htmlFor="rv-j" className="sm:col-span-2"><Textarea id="rv-j" rows={2} value={v.justification} onChange={(e) => setV({ ...v, justification: e.target.value })} /></FormField>
        </div>
      )}
    </Modal>
  );
}
