/**
 * Planejamento orçamentário → Fechamento: competência a competência (aberto → conferência → validação → fechado,
 * reabertura excepcional), demonstrativo por centro, relatório mensal por e-mail e a política do orçamento.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDateTime } from '../../lib/format';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, Select, type Tone } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from './shared';

type Month = { month: string; status: string; label: string; closedAt: string | null; reopenReason: string | null };
type Center = { id: string; code: string; name: string; approved: number; revised: number; committed: number; realized: number; paid: number; balance: number; deviation: number; deviationPct: number | null; excess: number; overdueCents: number; charges: number; economy: number };
type Detail = {
  closing: { status: string; label: string; live: boolean; closedAt: string | null; reopenReason: string | null };
  snapshot: { centers: Center[]; total: Center & { overdueCount: number; latePayments: number; guardianUsed: number; pendingApproval: number }; performance: { wins: number; resultCents: number; efficiency: number | null } };
  dispatches: { id: string; name: string; email: string; role: string; status: string; attempts: number; lastError: string | null; sentAt: string | null }[];
  events: { summary: string; at: string; actor: string | null }[];
  can: { conduct: boolean; validate: boolean; reopen: boolean; next: string[] };
};
const TONE: Record<string, Tone> = { aberto: 'neutral', em_conferencia: 'blue', aguardando_validacao: 'orange', fechado: 'green', reaberto: 'red' };
const NEXT_LABEL: Record<string, string> = { em_conferencia: 'Iniciar conferência', aguardando_validacao: 'Enviar para validação', fechado: 'Validar e fechar', aberto: 'Voltar para aberto', reaberto: 'Reabrir excepcionalmente' };
const ROLE: Record<string, string> = { responsavel: 'Responsável', gestor: 'Gestor', diretoria: 'Diretoria', financeiro: 'Financeiro' };
const DSTATUS: Record<string, string> = { aguardando_aprovacao: 'Aguardando aprovação', aprovado: 'Aprovado', enviado: 'Enviado', falhou: 'Falhou', cancelado: 'Cancelado' };
const mLabel = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long' }).replace(/^./, (c) => c.toUpperCase());

export function ClosingPanel({ year }: { year: number }) {
  const list = useQuery({ queryKey: ['budget', 'closings', year], queryFn: () => api<{ items: Month[] }>(`/budget/closings${qs({ year })}`) });
  const now = new Date();
  const [month, setMonth] = useState(year === now.getFullYear() ? `${year}-${String(Math.max(1, now.getMonth())).padStart(2, '0')}` : `${year}-12`);
  if (list.isLoading) return <div className="card"><LoadingRows /></div>;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <div className="space-y-5">
      <section className="card grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4 lg:grid-cols-6" aria-label="Competências do ano">
        {list.data!.items.map((m) => (
          <button key={m.month} type="button" aria-pressed={m.month === month} onClick={() => setMonth(m.month)} className={clsx('bg-surface px-3 py-2.5 text-left', m.month === month && 'outline outline-2 -outline-offset-2 outline-primary')}>
            <span className="block text-sm font-semibold text-ink">{mLabel(m.month)}</span>
            <Chip tone={TONE[m.status] ?? 'neutral'}>{m.label}</Chip>
          </button>
        ))}
      </section>
      <MonthDetail month={month} />
      <PolicyPanel />
    </div>
  );
}

function MonthDetail({ month }: { month: string }) {
  const q = useQuery({ queryKey: ['budget', 'closing', month], queryFn: () => api<Detail>(`/budget/closings/${month}`) });
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const act = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) => api<Record<string, number>>(url, { method: 'POST', body: body ?? {} }),
    onSuccess: (r, v) => { void qc.invalidateQueries({ queryKey: ['budget'] }); toast({ tone: 'success', message: v.url.endsWith('/send') ? `Relatório: ${r.sent ?? 0} enviado(s), ${r.failed ?? 0} com falha` : v.url.endsWith('/prepare') ? `${r.created ?? 0} relatório(s) preparado(s)` : 'Situação atualizada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!, t = d.snapshot.total;
  const pending = d.dispatches.filter((x) => ['aguardando_aprovacao', 'aprovado', 'falhou'].includes(x.status));
  return (
    <>
      <section className="card p-4" aria-label="Fechamento da competência">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">Fechamento de {mLabel(month)} de {month.slice(0, 4)}</h2>
            <p className="text-sm text-muted">{d.closing.live ? 'Números ao vivo: mudam até o fechamento.' : `Fotografia gravada no fechamento (${fmtDateTime(d.closing.closedAt)}). Alteração retroativa só com reabertura.`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={TONE[d.closing.status] ?? 'neutral'}>{d.closing.label}</Chip>
            {d.can.next.filter((n) => n !== 'reaberto' && (n === 'fechado' ? d.can.validate : d.can.conduct)).map((n) => <Button key={n} size="sm" variant={n === 'fechado' ? 'primary' : 'secondary'} loading={act.isPending} onClick={() => act.mutate({ url: `/budget/closings/${month}/transition`, body: { to: n } })}>{NEXT_LABEL[n]}</Button>)}
          </div>
        </div>
        {d.closing.reopenReason && d.closing.status === 'reaberto' && <Notice tone="warning">Reaberto: {d.closing.reopenReason}</Notice>}
        <dl className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4 lg:grid-cols-8">
          {([['Aprovado', t.approved], ['Revisado', t.revised], ['Comprometido', t.committed], ['Realizado', t.realized], ['Pago', t.paid], ['Saldo', t.balance], ['Desvio', t.deviation], ['Economia', t.economy], ['Excedentes', t.excess], ['Guardião consumido', t.guardianUsed], ['Vencidos em aberto', t.overdueCents], ['Juros e multas', t.charges], ['Aguardando aprovação', t.pendingApproval], ['Resultado (vendas)', d.snapshot.performance.resultCents]] as const).map(([k, v]) => (
            <div key={k} className="bg-surface px-3 py-2"><dt className="text-xs text-muted">{k}</dt><dd className={clsx('num font-bold', k === 'Desvio' && v > 0 ? 'text-danger' : 'text-ink')}>{fmtBRL(v)}</dd></div>
          ))}
          <div className="bg-surface px-3 py-2"><dt className="text-xs text-muted">Pagos com atraso</dt><dd className="num font-bold text-ink">{t.latePayments}</dd></div>
          <div className="bg-surface px-3 py-2"><dt className="text-xs text-muted">Eficiência</dt><dd className="num font-bold text-ink">{d.snapshot.performance.efficiency === null ? '—' : `R$ ${d.snapshot.performance.efficiency.toLocaleString('pt-BR')} por real`}</dd></div>
        </dl>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted"><tr>{['Centro', 'Aprovado', 'Comprometido', 'Realizado', 'Pago', 'Saldo', 'Desvio', 'Vencidos'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{!d.snapshot.centers.some((c) => c.approved || c.realized || c.committed || c.paid) && <tr><td colSpan={8} className="px-3 py-4 text-center text-muted">Nenhum valor aprovado, comprometido, realizado ou pago nesta competência.</td></tr>}{d.snapshot.centers.filter((c) => c.approved || c.realized || c.committed || c.paid).map((c) => (
              <tr key={c.id} className="border-t border-line"><td className="px-3 py-2"><b className="text-ink">{c.code}</b> <span className="text-muted">{c.name}</span></td>{[c.approved, c.committed, c.realized, c.paid, c.balance].map((v, i) => <td key={i} className="num px-3 py-2">{fmtBRL(v)}</td>)}<td className={clsx('num px-3 py-2', c.deviation > 0 && 'text-danger')}>{fmtBRL(c.deviation)}{c.deviationPct !== null ? ` (${c.deviationPct.toLocaleString('pt-BR')}%)` : ''}</td><td className="num px-3 py-2">{fmtBRL(c.overdueCents)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        {d.can.reopen && d.closing.status === 'fechado' && (
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <FormField label="Justificativa da reabertura" htmlFor="cl-r" className="min-w-[280px] flex-1"><Input id="cl-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: nota fiscal chegou depois do fechamento" /></FormField>
            <Button variant="danger" disabled={reason.trim().length < 10} onClick={() => act.mutate({ url: `/budget/closings/${month}/transition`, body: { to: 'reaberto', reason } })}>Reabrir excepcionalmente</Button>
          </div>
        )}
      </section>
      {d.closing.status === 'fechado' && (d.can.conduct || d.can.validate) && (
        <section className="card p-4" aria-label="Relatório mensal por e-mail">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="font-display text-base font-bold text-ink">Relatório mensal por e-mail</h2><p className="text-sm text-muted">Cada destinatário recebe só os centros que pode ver: responsável, gestor, Diretoria (consolidado) e Financeiro.</p></div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => act.mutate({ url: `/budget/closings/${month}/reports/prepare`, body: { regenerate: d.dispatches.length > 0 } })}>{d.dispatches.length ? 'Gerar de novo' : 'Preparar relatório'}</Button>
              {pending.length > 0 && <Button size="sm" variant="primary" loading={act.isPending} onClick={() => act.mutate({ url: `/budget/closings/${month}/reports/send` })}>Aprovar e enviar ({pending.length})</Button>}
            </div>
          </div>
          {d.dispatches.length ? (
            <ul className="divide-y divide-line text-sm">{d.dispatches.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><b className="text-ink">{x.name}</b> <span className="text-muted">{x.email} · {ROLE[x.role]}</span>{x.lastError && <span className="block text-xs text-danger">{x.lastError}</span>}</span>
                <span className="flex items-center gap-2"><Chip tone={x.status === 'enviado' ? 'green' : x.status === 'falhou' ? 'red' : 'neutral'}>{DSTATUS[x.status]}{x.attempts > 1 ? ` · ${x.attempts} tentativas` : ''}</Chip>
                  <a className="font-semibold text-primary hover:underline" href={`/api/v1/budget/reports/${x.id}/preview`} target="_blank" rel="noreferrer">Pré-visualizar</a>
                  {x.status !== 'cancelado' && <Button size="sm" variant="ghost" onClick={() => act.mutate({ url: `/budget/closings/${month}/reports/send`, body: { ids: [x.id] } })}>{x.status === 'enviado' ? 'Reenviar' : 'Enviar'}</Button>}</span>
              </li>
            ))}</ul>
          ) : <p className="text-sm text-muted">Nenhum relatório preparado.</p>}
        </section>
      )}
      {d.events.length > 0 && (
        <section className="card p-4" aria-label="Histórico do fechamento"><h2 className="mb-2 text-sm font-semibold text-ink">Histórico</h2><ul className="space-y-1 text-sm">{d.events.map((e, i) => <li key={i}><span className="text-xs text-muted">{fmtDateTime(e.at)} · {e.actor}</span> {e.summary}</li>)}</ul></section>
      )}
    </>
  );
}

type Policy = { alertPct: number | null; blockPct: number | null; reserveMode: string; globalReserveCents: number | null; reportAutoSend: boolean; reportRequireApproval: boolean; version: number; canEdit: boolean; centers: { id: string; code: string; name: string; alertPct: number | null; blockPct: number | null; guardianReserveCents: number | null }[] };
const toCents = (v: string) => { const n = Number(String(v).replace(/\./g, '').replace(',', '.')); return v.trim() && Number.isFinite(n) ? Math.round(n * 100) : null; };
const num = (v: string) => (v.trim() ? Number(v) : null);

function PolicyPanel() {
  const q = useQuery({ queryKey: ['budget', 'policy'], queryFn: () => api<Policy>('/budget/policy') });
  const [v, setV] = useState<Record<string, string | boolean> | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const p = q.data;
  const cur = v ?? (p ? { alert: p.alertPct?.toString() ?? '', block: p.blockPct?.toString() ?? '', mode: p.reserveMode, global: p.globalReserveCents !== null ? (p.globalReserveCents / 100).toFixed(2).replace('.', ',') : '', auto: p.reportAutoSend, approval: p.reportRequireApproval, ...Object.fromEntries(p.centers.map((c) => [`r:${c.id}`, c.guardianReserveCents !== null ? (c.guardianReserveCents / 100).toFixed(2).replace('.', ',') : ''])) } : null);
  const save = useMutation({
    mutationFn: () => api('/budget/policy', { method: 'PUT', body: { alertPct: num(String(cur!.alert)), blockPct: num(String(cur!.block)), reserveMode: cur!.mode, globalReserveCents: toCents(String(cur!.global)), reportAutoSend: !!cur!.auto, reportRequireApproval: !!cur!.approval, centers: p!.centers.map((c) => ({ id: c.id, alertPct: c.alertPct, blockPct: c.blockPct, guardianReserveCents: toCents(String(cur![`r:${c.id}`] ?? '')) })) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['budget'] }); setV(null); toast({ tone: 'success', message: 'Política do orçamento salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (!p || !cur || !p.canEdit) return null;
  const set = (k: string, x: string | boolean) => setV({ ...cur, [k]: x });
  return (
    <section className="card space-y-3 p-4" aria-label="Política do orçamento">
      <div><h2 className="font-display text-base font-bold text-ink">Política do orçamento</h2><p className="text-sm text-muted">Definida pela Diretoria. Campo vazio = sem regra: o sistema não presume percentuais nem reserva.</p></div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <FormField label="Alerta em (% do autorizado)" htmlFor="po-a"><Input id="po-a" inputMode="numeric" value={String(cur.alert)} onChange={(e) => set('alert', e.target.value.replace(/\D/g, ''))} /></FormField>
        <FormField label="Bloqueio em (%)" htmlFor="po-b"><Input id="po-b" inputMode="numeric" value={String(cur.block)} onChange={(e) => set('block', e.target.value.replace(/\D/g, ''))} /></FormField>
        <FormField label="Reserva do Budget Guardião" htmlFor="po-m"><Select id="po-m" value={String(cur.mode)} onChange={(e) => set('mode', e.target.value)}><option value="nenhuma">Sem reserva</option><option value="global">Global</option><option value="centro">Por centro de custos</option><option value="hibrida">Híbrida (centro, depois global)</option></Select></FormField>
        {(cur.mode === 'global' || cur.mode === 'hibrida') && <FormField label="Reserva global (R$)" htmlFor="po-g"><Input id="po-g" value={String(cur.global)} onChange={(e) => set('global', e.target.value)} /></FormField>}
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={!!cur.auto} onChange={(e) => set('auto', e.target.checked)} /> Relatório automático ao fechar</label>
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={!!cur.approval} onChange={(e) => set('approval', e.target.checked)} /> Aprovar antes de enviar</label>
      </div>
      {(cur.mode === 'centro' || cur.mode === 'hibrida') && (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">{p.centers.map((c) => <FormField key={c.id} label={`Reserva ${c.code} (R$)`} htmlFor={`po-${c.id}`}><Input id={`po-${c.id}`} value={String(cur[`r:${c.id}`] ?? '')} onChange={(e) => set(`r:${c.id}`, e.target.value)} /></FormField>)}</div>
      )}
      <Button variant="primary" loading={save.isPending} disabled={!v} onClick={() => save.mutate()}>Salvar política</Button>
    </section>
  );
}
