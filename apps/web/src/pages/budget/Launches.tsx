/**
 * Recursos e Orçamento → Lançamentos (tela principal): todos os custos e investimentos do trimestre, com o executado.
 * Lança um item novo, e clicar no item abre o detalhe para dar baixa (pagamento com comprovante).
 * Supervisão lança e dá baixa, mas não exclui nem altera valor (a API confere).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Download, FileUp, Plus, Search, Send, Trash2, X } from 'lucide-react';
import { ITEM_TYPES, ITEM_TYPE_LABELS, LINE_STATUS_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, monthsOfQuarter, type LineStatus } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { fileToBase64 } from '../../lib/files';
import { Button, EmptyState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { AccountSelect, errMsg, type Structure } from '../../features/budget/shared';

type Baixa = { id: string; occurredOn: string; description: string; amountCents: number; paymentMethod: string | null; docName: string | null; status: 'valido' | 'cancelado'; cancelReason: string | null; createdBy: string | null };
type Paid = 'pago' | 'parcial' | 'aberto';
type Item = { id: string; planId: string; costCenterId: string; accountId: string; what: string; how: string | null; month: string; amountCents: number; itemType: string; supplierId: string | null; status: LineStatus; decisionNote: string | null; costCenter: { id: string; code: string; name: string }; executedCents: number; paid: Paid; baixas: Baixa[] };
type Data = {
  label: string; months: string[]; items: Item[];
  totals: { planned: number; executed: number; deviation: number; unlinkedCents: number; unlinkedCount: number };
  drafts: { costCenterId: string; code: string; name: string; count: number; cents: number }[];
  costCenters: { id: string; code: string; name: string }[];
  can: { create: boolean; delete: boolean; editAmount: boolean; cancelBaixa: boolean; approve: boolean };
};

const monthShort = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').replace(/^./, (c) => c.toUpperCase());
const toCents = (v: string) => { const n = Number(v.replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const money = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const isInvestment = (t: string) => t === 'ativo';
const pctOf = (i: Pick<Item, 'amountCents' | 'executedCents'>) => (i.amountCents ? (i.executedCents / i.amountCents) * 100 : 0);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

const PAID: Record<Paid, { label: string; cls: string }> = {
  pago: { label: 'Pago', cls: 'bg-success-soft text-[#15803D]' },
  parcial: { label: 'Parcial', cls: 'bg-warning-soft text-[#C2610C]' },
  aberto: { label: 'Em aberto', cls: 'bg-surface-2 text-muted' },
};
const STATUS: Record<LineStatus, string> = { rascunho: 'bg-surface-2 text-muted', em_aprovacao: 'bg-warning-soft text-[#C2610C]', aprovado: 'bg-primary-soft text-primary', recusado: 'bg-danger-soft text-danger' };
const Pill = ({ className, children }: { className: string; children: React.ReactNode }) => <span className={clsx('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}>{children}</span>;

/** % executado com a cor da faixa: acima de 100% em vermelho. */
function ExecPill({ pct }: { pct: number }) {
  const cls = pct > 100 ? 'bg-danger text-white' : pct >= 100 ? 'bg-success text-white' : pct > 0 ? 'bg-primary text-white' : 'bg-surface-2 text-muted';
  return <span className={clsx('inline-flex min-w-[58px] justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums', cls)}>{pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>;
}

export function BudgetLaunches({ st, year, quarter }: { st: Structure; year: number; quarter: number }) {
  const q = useQuery({ queryKey: ['budget', 'items', year, quarter], queryFn: () => api<Data>(`/budget/items${qs({ year, quarter })}`) });
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [cc, setCc] = useState('');
  const [month, setMonth] = useState('');
  const [sit, setSit] = useState('');
  const [open, setOpen] = useState<{ id: string; baixa: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const accById = useMemo(() => new Map(st.accounts.map((a) => [a.id, a])), [st.accounts]);
  const submit = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await api('/budget/plan/submit', { method: 'POST', body: { costCenterId: id, year, quarter } }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); toast({ tone: 'success', message: 'Enviado à Diretoria' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (!q.data) return <div className="card"><LoadingRows /></div>;
  const d = q.data;
  const term = search.trim().toLowerCase();
  const rows = d.items.filter((i) => (!cc || i.costCenterId === cc) && (!month || i.month === month)
    && (!sit || (sit === i.status) || (i.status === 'aprovado' && sit === i.paid))
    && (!term || [i.what, i.how, accById.get(i.accountId)?.path, i.costCenter.name].some((x) => x?.toLowerCase().includes(term))));
  const sum = (list: Item[], k: 'amountCents' | 'executedCents') => list.filter((i) => i.status !== 'recusado').reduce((a, i) => a + i[k], 0);
  const filtered = rows.length !== d.items.length;
  const planned = filtered ? sum(rows, 'amountCents') : d.totals.planned, executed = filtered ? sum(rows, 'executedCents') : d.totals.executed;
  const deviation = planned - executed;
  const usage = planned ? Math.min(100, (executed / planned) * 100) : 0;
  const current = open ? d.items.find((i) => i.id === open.id) ?? null : null;
  return (
    <div className="space-y-4">
      {/* resumo do trimestre */}
      <section className="card p-5" aria-label={`Resumo do ${d.label}`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <dl className="flex flex-wrap gap-x-10 gap-y-3">
            <div><dt className="text-xs font-semibold uppercase text-muted">Planejado</dt><dd className="text-2xl font-bold tabular-nums text-ink">{fmtBRL(planned)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">Executado</dt><dd className="text-2xl font-bold tabular-nums text-ink">{fmtBRL(executed)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase text-muted">{deviation < 0 ? 'Acima do planejado' : 'Saldo'}</dt><dd className={clsx('text-2xl font-bold tabular-nums', deviation < 0 ? 'text-danger' : 'text-[#15803D]')}>{deviation < 0 ? '−' : ''}{fmtBRL(Math.abs(deviation))}</dd></div>
          </dl>
          {d.can.create && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Novo lançamento</Button>}
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden><div className={clsx('h-full rounded-full', deviation < 0 ? 'bg-danger' : 'bg-primary')} style={{ width: `${usage}%` }} /></div>
        <p className="mt-1.5 text-xs text-muted">{d.label}{filtered ? ' · filtrado' : ''} · {planned ? `${((executed / planned) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% executado` : 'nada planejado'}{!filtered && d.totals.unlinkedCount ? ` · inclui ${fmtBRL(d.totals.unlinkedCents)} em ${d.totals.unlinkedCount} gasto(s) sem item` : ''}</p>
      </section>

      {d.drafts.length > 0 && (
        <section className="flex flex-wrap items-center gap-3 border border-warning/40 bg-warning-soft/40 px-4 py-3" aria-label="Rascunhos">
          <p className="text-sm text-ink"><strong>{d.drafts.reduce((a, x) => a + x.count, 0)} lançamento(s) em rascunho</strong> ({fmtBRL(d.drafts.reduce((a, x) => a + x.cents, 0))}) em {d.drafts.map((x) => x.code).join(', ')}. A baixa fica liberada depois da aprovação da Diretoria.</p>
          <Button className="ml-auto" size="sm" variant="primary" icon={<Send className="h-4 w-4" />} loading={submit.isPending} onClick={() => submit.mutate(d.drafts.map((x) => x.costCenterId))}>Enviar à Diretoria</Button>
        </section>
      )}

      {/* filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Buscar lançamento" className="pl-9" placeholder="Buscar item, conta ou centro…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {d.costCenters.length > 1 && <Select aria-label="Centro de custo" className="w-auto" value={cc} onChange={(e) => setCc(e.target.value)}><option value="">Todos os centros</option>{d.costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select>}
        <div className="flex border border-line" role="group" aria-label="Mês">
          {['', ...d.months].map((m) => <button key={m || 'todos'} type="button" aria-pressed={month === m} onClick={() => setMonth(m)} className={clsx('px-3 py-2 text-sm font-semibold', month === m ? 'bg-primary text-white' : 'text-ink hover:bg-surface-2')}>{m ? monthShort(m) : 'Trimestre'}</button>)}
        </div>
        <Select aria-label="Situação" className="w-auto" value={sit} onChange={(e) => setSit(e.target.value)}>
          <option value="">Todas as situações</option><option value="aberto">Em aberto</option><option value="parcial">Pago em parte</option><option value="pago">Pago</option><option value="em_aprovacao">Aguardando a Diretoria</option><option value="rascunho">Rascunho</option><option value="recusado">Recusado</option>
        </Select>
      </div>

      {/* lançamentos */}
      <section className="card overflow-x-auto p-0" aria-label="Lançamentos do trimestre">
        {!rows.length ? <EmptyState title={d.items.length ? 'Nada com esses filtros' : 'Nenhum lançamento no trimestre'} description={d.items.length ? 'Limpe a busca ou mude o mês.' : d.can.create ? 'Use “Novo lançamento” para incluir um custo ou investimento.' : undefined} /> : (
          <table className="w-full min-w-[980px] text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold text-muted">
              <th className="px-4 py-2.5">Mês</th><th className="px-3 py-2.5">Centro</th><th className="px-3 py-2.5">Conta</th><th className="px-3 py-2.5">Item</th>
              <th className="px-3 py-2.5 text-right">Planejado</th><th className="px-3 py-2.5 text-right">Executado</th><th className="px-3 py-2.5 text-center">% exec.</th><th className="px-3 py-2.5">Situação</th><th className="px-4 py-2.5 text-right"><span className="sr-only">Ação</span></th>
            </tr></thead>
            <tbody>{rows.map((i) => {
              const a = accById.get(i.accountId);
              const parts = a?.path.split(' › ') ?? [];
              const canPay = i.status === 'aprovado' && i.paid !== 'pago';
              return (
                <tr key={i.id} className={clsx('cursor-pointer border-b border-line last:border-0 hover:bg-surface-2', i.status === 'recusado' && 'opacity-60')} onClick={() => setOpen({ id: i.id, baixa: false })}>
                  <td className="px-4 py-3 font-semibold text-ink">{monthShort(i.month)}</td>
                  <td className="px-3 py-3 text-text">{i.costCenter.name}</td>
                  <td className="max-w-[220px] px-3 py-3"><p className="truncate text-text" title={a?.path}>{parts.at(-1) ?? '—'}</p>{parts.length > 2 && <p className="truncate text-2xs text-muted">{parts.at(-2)}</p>}</td>
                  <td className="max-w-[280px] px-3 py-3">
                    <button type="button" className="block max-w-full truncate text-left font-semibold text-ink hover:text-primary" title={i.what} onClick={(e) => { e.stopPropagation(); setOpen({ id: i.id, baixa: false }); }}>{i.what}</button>
                    <span className={clsx('mt-0.5 inline-block text-2xs font-semibold', isInvestment(i.itemType) ? 'text-purple' : 'text-muted')}>{isInvestment(i.itemType) ? 'Investimento' : 'Custo'} · {ITEM_TYPE_LABELS[i.itemType as keyof typeof ITEM_TYPE_LABELS] ?? i.itemType}</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink">{fmtBRL(i.amountCents)}</td>
                  <td className={clsx('px-3 py-3 text-right tabular-nums', i.executedCents > i.amountCents ? 'font-semibold text-danger' : 'text-ink')}>{fmtBRL(i.executedCents)}</td>
                  <td className="px-3 py-3 text-center"><ExecPill pct={pctOf(i)} /></td>
                  <td className="px-3 py-3">{i.status === 'aprovado' ? <Pill className={PAID[i.paid].cls}>{PAID[i.paid].label}</Pill> : <Pill className={STATUS[i.status]}>{i.status === 'em_aprovacao' ? 'Com a Diretoria' : LINE_STATUS_LABELS[i.status]}</Pill>}</td>
                  <td className="px-4 py-3 text-right">{canPay && <Button size="sm" variant="outline" icon={<Check className="h-4 w-4" />} onClick={(e) => { e.stopPropagation(); setOpen({ id: i.id, baixa: true }); }}>Dar baixa</Button>}</td>
                </tr>
              );
            })}</tbody>
            <tfoot><tr className="border-t border-line-strong bg-surface-2 font-semibold"><td colSpan={4} className="px-4 py-2.5 text-ink">{rows.length} lançamento(s)</td><td className="px-3 py-2.5 text-right tabular-nums text-ink">{fmtBRL(sum(rows, 'amountCents'))}</td><td className="px-3 py-2.5 text-right tabular-nums text-ink">{fmtBRL(sum(rows, 'executedCents'))}</td><td colSpan={3} /></tr></tfoot>
          </table>
        )}
      </section>

      {current && <ItemPanel key={current.id} item={current} st={st} can={d.can} year={year} quarter={quarter} focusBaixa={open!.baixa} onClose={() => setOpen(null)} />}
      {creating && <NewLaunch st={st} d={d} year={year} quarter={quarter} onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Detalhe do item: números, baixas, dar baixa e, conforme o status e o perfil, editar, excluir, enviar ou decidir. */
function ItemPanel({ item: i, st, can, year, quarter, focusBaixa, onClose }: { item: Item; st: Structure; can: Data['can']; year: number; quarter: number; focusBaixa: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['budget'] }); toast({ tone: 'success', message: msg }); };
  const fail = (e: unknown) => toast({ tone: 'error', message: errMsg(e) });
  const left = Math.max(0, i.amountCents - i.executedCents);
  const canPay = i.status === 'aprovado';
  const [b, setB] = useState({ amount: left ? money(left) : '', occurredOn: today(), paymentMethod: 'boleto', supplierId: i.supplierId ?? '', financeCheck: false });
  const [file, setFile] = useState<File | null>(null);
  const [editing, setEditing] = useState(false);
  const [e, setE] = useState({ what: i.what, how: i.how ?? '', amount: money(i.amountCents), month: i.month, accountId: i.accountId, itemType: i.itemType });
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [refuse, setRefuse] = useState(false);
  const a = st.accounts.find((x) => x.id === i.accountId);
  const pay = useMutation({
    mutationFn: async () => api('/budget/expenses', { method: 'POST', body: { costCenterId: i.costCenterId, accountId: i.accountId, lineId: i.id, occurredOn: b.occurredOn, description: i.what, amountCents: toCents(b.amount), paymentMethod: b.paymentMethod, supplierId: b.supplierId || null, financeCheck: b.financeCheck, doc: file ? { name: file.name, data: await fileToBase64(file) } : null } }),
    onSuccess: () => { done('Baixa registrada'); setFile(null); setB((x) => ({ ...x, amount: '', financeCheck: false })); }, onError: fail,
  });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/budget/expenses/${id}/cancel`, { method: 'POST', body: { reason } }), onSuccess: () => { done('Baixa cancelada'); setCancelId(null); setReason(''); }, onError: fail });
  const save = useMutation({
    mutationFn: () => api(`/budget/plan/lines/${i.id}`, { method: 'PATCH', body: { what: e.what, how: e.how || null, month: e.month, accountId: e.accountId, itemType: e.itemType, ...(can.editAmount ? { amountCents: toCents(e.amount) } : {}) } }),
    onSuccess: () => { done('Lançamento alterado'); setEditing(false); }, onError: fail,
  });
  const remove = useMutation({ mutationFn: () => api(`/budget/plan/lines/${i.id}`, { method: 'DELETE' }), onSuccess: () => { done('Lançamento excluído'); onClose(); }, onError: fail });
  const submit = useMutation({ mutationFn: () => api('/budget/plan/submit', { method: 'POST', body: { costCenterId: i.costCenterId, year, quarter } }), onSuccess: () => done('Enviado à Diretoria'), onError: fail });
  const decide = useMutation({ mutationFn: (decision: 'aprovar' | 'recusar') => api('/budget/plan/decide', { method: 'POST', body: { planId: i.planId, lineIds: [i.id], decision, note: decision === 'recusar' ? reason : null } }), onSuccess: (_r, dc) => { done(dc === 'aprovar' ? 'Aprovado' : 'Recusado'); setRefuse(false); setReason(''); }, onError: fail });
  const draft = i.status === 'rascunho' || i.status === 'recusado';
  const pct = pctOf(i);
  return (
    <Modal open onClose={onClose} size="lg" title={i.what}
      footer={draft ? <>
        {can.delete && <Button variant="ghost" icon={<Trash2 className="h-4 w-4 text-danger" />} loading={remove.isPending} onClick={() => { if (confirm(`Excluir “${i.what}”?`)) remove.mutate(); }}>Excluir</Button>}
        {!editing && <Button onClick={() => setEditing(true)}>Editar</Button>}
        <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={submit.isPending} onClick={() => submit.mutate()}>Enviar à Diretoria</Button>
      </> : <Button onClick={onClose}>Fechar</Button>}>
      <div className="space-y-5">
        <p className="-mt-2 text-sm text-muted">{i.costCenter.code} · {i.costCenter.name} · {a?.path.split(' › ').slice(1).join(' › ') || a?.name} · {monthShort(i.month)}/{i.month.slice(0, 4)} · {isInvestment(i.itemType) ? 'Investimento' : 'Custo'}{i.how ? ` · ${i.how}` : ''}</p>

        <div className="grid grid-cols-3 gap-px border border-line bg-line">
          {[['Planejado', fmtBRL(i.amountCents), 'text-ink'], ['Executado', fmtBRL(i.executedCents), i.executedCents > i.amountCents ? 'text-danger' : 'text-ink'], [i.executedCents > i.amountCents ? 'Acima' : 'Falta pagar', fmtBRL(Math.abs(i.amountCents - i.executedCents)), i.executedCents > i.amountCents ? 'text-danger' : 'text-ink']].map(([l, v, c]) => (
            <div key={l} className="bg-surface px-4 py-3"><p className="text-xs text-muted">{l}</p><p className={clsx('text-lg font-bold tabular-nums', c)}>{v}</p></div>
          ))}
        </div>
        <div className="flex items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><div className={clsx('h-full rounded-full', pct > 100 ? 'bg-danger' : pct >= 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${Math.min(100, pct)}%` }} /></div><ExecPill pct={pct} /></div>

        {/* status e decisões */}
        {i.status !== 'aprovado' && (
          <div className={clsx('border px-4 py-3 text-sm', i.status === 'recusado' ? 'border-danger/40 bg-danger-soft/40' : 'border-warning/40 bg-warning-soft/40')}>
            <p className="text-ink"><strong>{LINE_STATUS_LABELS[i.status]}.</strong> {i.status === 'em_aprovacao' ? 'A Diretoria está avaliando; a baixa fica liberada depois da aprovação.' : i.status === 'recusado' ? `Diretoria: ${i.decisionNote ?? 'sem observação'}. Ajuste e envie de novo.` : 'Envie à Diretoria para aprovar; depois disso, dê baixa aqui.'}</p>
            {i.status === 'em_aprovacao' && can.approve && (
              refuse ? (
                <div className="mt-2 space-y-2">
                  <Textarea aria-label="Motivo da recusa" rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Motivo para o líder do centro" />
                  <div className="flex gap-2"><Button size="sm" onClick={() => setRefuse(false)}>Voltar</Button><Button size="sm" variant="primary" disabled={reason.trim().length < 3} loading={decide.isPending} onClick={() => decide.mutate('recusar')}>Recusar</Button></div>
                </div>
              ) : (
                <div className="mt-2 flex gap-2"><Button size="sm" variant="primary" icon={<Check className="h-4 w-4" />} loading={decide.isPending} onClick={() => decide.mutate('aprovar')}>Aprovar</Button><Button size="sm" icon={<X className="h-4 w-4" />} onClick={() => setRefuse(true)}>Recusar</Button></div>
              )
            )}
          </div>
        )}

        {editing && (
          <section className="space-y-3 border border-line p-4" aria-label="Editar lançamento">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Item" htmlFor="it-w" className="sm:col-span-2"><Input id="it-w" value={e.what} onChange={(ev) => setE({ ...e, what: ev.target.value })} /></FormField>
              <FormField label="Conta (subcategoria)" htmlFor="it-a" className="sm:col-span-2"><AccountSelect id="it-a" value={e.accountId} onChange={(x) => setE({ ...e, accountId: x })} accounts={st.accounts} /></FormField>
              <FormField label="Mês" htmlFor="it-m"><Select id="it-m" value={e.month} onChange={(ev) => setE({ ...e, month: ev.target.value })}>{monthsOfQuarter(Number(i.month.slice(0, 4)), Math.ceil(Number(i.month.slice(5)) / 3)).map((m) => <option key={m} value={m}>{monthShort(m)}/{m.slice(0, 4)}</option>)}</Select></FormField>
              <FormField label="Valor (R$)" htmlFor="it-v" hint={can.editAmount ? undefined : 'A supervisão não altera valor'}><Input id="it-v" inputMode="decimal" disabled={!can.editAmount} value={e.amount} onChange={(ev) => setE({ ...e, amount: ev.target.value })} /></FormField>
              <FormField label="Tipo" htmlFor="it-t"><Select id="it-t" value={e.itemType} onChange={(ev) => setE({ ...e, itemType: ev.target.value })}>{ITEM_TYPES.map((t) => <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>)}</Select></FormField>
              <FormField label="Como" htmlFor="it-h" className="sm:col-span-2"><Input id="it-h" value={e.how} onChange={(ev) => setE({ ...e, how: ev.target.value })} /></FormField>
            </div>
            <div className="flex justify-end gap-2"><Button size="sm" onClick={() => setEditing(false)}>Cancelar</Button><Button size="sm" variant="primary" disabled={e.what.trim().length < 3 || !e.accountId || toCents(e.amount) <= 0} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></div>
          </section>
        )}

        {/* dar baixa */}
        {canPay && (
          <section className="border border-primary/30 bg-primary/5 p-4" aria-label="Dar baixa">
            <h3 className="mb-3 text-sm font-bold text-ink">Dar baixa{left ? <span className="ml-2 font-normal text-muted">falta {fmtBRL(left)}</span> : <span className="ml-2 font-normal text-muted">item já pago; baixa extra usa o saldo da conta</span>}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Valor pago (R$)" htmlFor="bx-v"><Input id="bx-v" inputMode="decimal" autoFocus={focusBaixa} value={b.amount} onChange={(ev) => setB({ ...b, amount: ev.target.value })} placeholder="0,00" /></FormField>
              <FormField label="Data do pagamento" htmlFor="bx-d"><Input id="bx-d" type="date" value={b.occurredOn} onChange={(ev) => setB({ ...b, occurredOn: ev.target.value })} /></FormField>
              <FormField label="Forma de pagamento" htmlFor="bx-p"><Select id="bx-p" value={b.paymentMethod} onChange={(ev) => setB({ ...b, paymentMethod: ev.target.value })}>{PAYMENT_METHODS.map((p) => <option key={p} value={p}>{PAYMENT_METHOD_LABELS[p]}</option>)}</Select></FormField>
              <FormField label="Fornecedor" htmlFor="bx-s"><Select id="bx-s" value={b.supplierId} onChange={(ev) => setB({ ...b, supplierId: ev.target.value })}><option value="">—</option>{st.suppliers.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
              <FormField label="Comprovante" htmlFor="bx-f" className="sm:col-span-2">
                <label className="flex h-10 cursor-pointer items-center gap-2 border border-dashed border-line bg-surface px-3 text-sm text-muted hover:border-primary"><FileUp className="h-4 w-4" aria-hidden /><span className="truncate">{file ? file.name : 'PDF, PNG ou JPG (opcional)'}</span><input id="bx-f" type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} /></label>
              </FormField>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-start gap-2 text-sm text-ink"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]" checked={b.financeCheck} onChange={(ev) => setB({ ...b, financeCheck: ev.target.checked })} />Conferi com o Financeiro (recurso e data de pagamento)</label>
              <Button variant="primary" icon={<Check className="h-4 w-4" />} disabled={toCents(b.amount) <= 0 || !b.financeCheck} loading={pay.isPending} onClick={() => pay.mutate()}>Confirmar baixa</Button>
            </div>
          </section>
        )}

        {/* baixas */}
        <section aria-label="Baixas do item">
          <h3 className="mb-2 text-sm font-bold text-ink">Baixas ({i.baixas.length})</h3>
          {!i.baixas.length ? <p className="text-sm text-muted">Nenhuma baixa ainda.</p> : (
            <ul className="divide-y divide-line border border-line">
              {i.baixas.map((x) => (
                <li key={x.id} className={clsx('px-3 py-2.5', x.status === 'cancelado' && 'opacity-60')}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className={clsx('text-sm text-ink', x.status === 'cancelado' && 'line-through')}>{fmtDate(x.occurredOn)} · {x.paymentMethod ? PAYMENT_METHOD_LABELS[x.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] : 'sem forma'}</p>
                      <p className="text-xs text-muted">{x.createdBy ?? 'Sistema'}{x.status === 'cancelado' ? ` · cancelada: ${x.cancelReason}` : ''}</p>
                    </div>
                    {x.docName && <a className="text-primary" href={`/api/v1/budget/expenses/${x.id}/document`} title={`Comprovante: ${x.docName}`} aria-label={`Baixar comprovante de ${fmtDate(x.occurredOn)}`}><Download className="h-4 w-4" /></a>}
                    <span className="text-sm font-semibold tabular-nums text-ink">{fmtBRL(x.amountCents)}</span>
                    {can.cancelBaixa && x.status === 'valido' && <button type="button" className="text-xs font-semibold text-muted hover:text-danger" onClick={() => setCancelId(x.id)}>Cancelar</button>}
                  </div>
                  {cancelId === x.id && (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <Input aria-label="Motivo do cancelamento" className="min-w-[240px] flex-1" value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Motivo (obrigatório)" />
                      <Button size="sm" onClick={() => setCancelId(null)}>Voltar</Button>
                      <Button size="sm" variant="primary" disabled={reason.trim().length < 5} loading={cancel.isPending} onClick={() => cancel.mutate(x.id)}>Cancelar baixa</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

/** Novo custo ou investimento: entra como rascunho do trimestre do centro de custo. */
function NewLaunch({ st, d, year, quarter, onClose }: { st: Structure; d: Data; year: number; quarter: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const months = monthsOfQuarter(year, quarter);
  const cur = today().slice(0, 7);
  const [v, setV] = useState({ costCenterId: d.costCenters[0]?.id ?? '', kind: 'custo' as 'custo' | 'investimento', what: '', accountId: '', month: months.includes(cur) ? cur : months[0]!, amount: '', itemType: 'servico', supplierId: '', how: '' });
  const save = useMutation({
    mutationFn: () => api('/budget/plan/lines', { method: 'POST', body: { costCenterId: v.costCenterId, accountId: v.accountId, what: v.what, how: v.how || null, month: v.month, amountCents: toCents(v.amount), itemType: v.itemType, supplierId: v.supplierId || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); toast({ tone: 'success', message: 'Lançado como rascunho. Envie à Diretoria para liberar a baixa.' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const kinds = v.kind === 'investimento' ? ITEM_TYPES.filter((t) => t === 'ativo' || t === 'software') : ITEM_TYPES.filter((t) => t !== 'ativo');
  const valid = v.costCenterId && v.accountId && v.what.trim().length >= 3 && toCents(v.amount) > 0;
  return (
    <Modal open onClose={onClose} title="Novo lançamento" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Lançar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex border border-line sm:col-span-2" role="radiogroup" aria-label="Natureza">
          {(['custo', 'investimento'] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={v.kind === k} onClick={() => setV({ ...v, kind: k, itemType: k === 'investimento' ? 'ativo' : 'servico' })} className={clsx('flex-1 px-3 py-2.5 text-sm font-semibold', v.kind === k ? 'bg-primary text-white' : 'text-ink hover:bg-surface-2')}>{k === 'custo' ? 'Custo' : 'Investimento'}</button>)}
        </div>
        <FormField label="Item" htmlFor="nl-w" required className="sm:col-span-2"><Input id="nl-w" value={v.what} onChange={(e) => setV({ ...v, what: e.target.value })} placeholder={v.kind === 'custo' ? 'Ex.: RD Marketing' : 'Ex.: Notebook para o time'} /></FormField>
        {d.costCenters.length > 1 && <FormField label="Centro de custo" htmlFor="nl-cc" required className="sm:col-span-2"><Select id="nl-cc" value={v.costCenterId} onChange={(e) => setV({ ...v, costCenterId: e.target.value })}>{d.costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select></FormField>}
        <FormField label="Conta (subcategoria)" htmlFor="nl-a" required className="sm:col-span-2"><AccountSelect id="nl-a" value={v.accountId} onChange={(x) => setV({ ...v, accountId: x })} accounts={st.accounts} /></FormField>
        <FormField label="Mês" htmlFor="nl-m" required><Select id="nl-m" value={v.month} onChange={(e) => setV({ ...v, month: e.target.value })}>{months.map((m) => <option key={m} value={m}>{monthShort(m)}/{m.slice(0, 4)}</option>)}</Select></FormField>
        <FormField label="Valor (R$)" htmlFor="nl-v" required><Input id="nl-v" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="0,00" /></FormField>
        <FormField label="Tipo" htmlFor="nl-t"><Select id="nl-t" value={v.itemType} onChange={(e) => setV({ ...v, itemType: e.target.value })}>{kinds.map((t) => <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>)}</Select></FormField>
        <FormField label="Fornecedor" htmlFor="nl-s"><Select id="nl-s" value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })}><option value="">—</option>{st.suppliers.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
        <FormField label="Como (opcional)" htmlFor="nl-h" className="sm:col-span-2" hint="Formato, quantidade, critério de compra"><Input id="nl-h" value={v.how} onChange={(e) => setV({ ...v, how: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}
