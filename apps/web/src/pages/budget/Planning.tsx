/** Planejamento orçamentário: trimestre por centro de custo, itens, aprovação da Diretoria, gastos, Budget Guardião, revisão mensal e estrutura. */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Download, FileUp, Plus, Send, ShieldAlert, Undo2, X } from 'lucide-react';
import { ITEM_TYPES, ITEM_TYPE_LABELS, LINE_STATUS_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PLAN_STATUS_LABELS, monthsOfQuarter, parentCode, type LineStatus, type PlanStatus } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { fileToBase64 } from '../../lib/files';
import { Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Tabs, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { BudgetLaunches } from './Launches';
import { AccountSelect, BandChip, BudgetShell, ExecBar, QuarterPicker, Stat, errMsg, neg, useStructure, type Account, type CostCenter, type Structure, type Totals } from '../../features/budget/shared';

type Line = { id: string; accountId: string; what: string; how: string | null; month: string; amountCents: number; itemType: string; status: LineStatus; decisionNote: string | null; supplierId: string | null; resourceId: string | null };
type Adjustment = { id: string; accountId: string; month: string; deltaCents: number; justification: string; pct: number | null; status: 'registrado' | 'pendente' | 'aprovado' | 'recusado'; decisionNote: string | null; createdAt: string };
type Expense = { id: string; accountId: string; lineId: string | null; occurredOn: string; description: string; amountCents: number; paymentMethod: string | null; docName: string | null; status: 'valido' | 'cancelado'; cancelReason: string | null };
type AccRow = Totals & { accountId: string; byMonth: (Totals & { month: string })[] };
type Plan = { costCenter: CostCenter; plan: { id: string; status: PlanStatus; note: string | null }; months: string[]; lines: Line[]; adjustments: Adjustment[]; expenses: Expense[]; accounts: AccRow[]; total: Totals; canEdit: boolean; admin: boolean; label: string };
type QuarterData = { label: string; months: string[]; items: (Totals & { costCenter: { id: string; code: string; name: string }; planStatus: PlanStatus; pendingAdjustments: number })[]; total: Totals; admin: boolean };

const now = new Date();
const curQ = Math.ceil((now.getMonth() + 1) / 3);
const monthName = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
const toCents = (v: string) => Math.round(Number(v.replace(/\./g, '').replace(',', '.')) * 100);
const PLAN_TONE: Record<PlanStatus, string> = { rascunho: 'bg-surface-2 text-muted', em_aprovacao: 'bg-warning-soft text-[#C2610C]', aprovado: 'bg-success-soft text-[#15803D]', devolvido: 'bg-danger-soft text-danger' };
const LINE_TONE: Record<LineStatus, string> = { rascunho: 'bg-surface-2 text-muted', em_aprovacao: 'bg-warning-soft text-[#C2610C]', aprovado: 'bg-success-soft text-[#15803D]', recusado: 'bg-danger-soft text-danger' };
const Tag = ({ className, children }: { className: string; children: React.ReactNode }) => <span className={clsx('inline-flex whitespace-nowrap px-2 py-0.5 text-xs font-semibold', className)}>{children}</span>;

export function BudgetPlanningPage() {
  const [f, setF] = useUrlState({ y: String(now.getFullYear()), q: String(curQ), cc: '', t: 'lancamentos' });
  const st = useStructure();
  const year = Number(f.y), quarter = Number(f.q);
  const qc = useQueryClient();
  const toast = useToast();
  const setup = useMutation({ mutationFn: () => api('/budget/setup', { method: 'POST' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); toast({ tone: 'success', message: 'Estrutura criada' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const tabs = [{ key: 'lancamentos', label: 'Lançamentos' }, { key: 'visao', label: 'Visão por centro' }, { key: 'centro', label: 'Centro de custo' }, ...(st.data?.admin ? [{ key: 'estrutura', label: 'Plano de contas e centros' }] : []), { key: 'historico', label: 'Histórico' }];
  return (
    <BudgetShell subtitle="Custos e investimentos do trimestre: lance, acompanhe e dê baixa em cada item." actions={<QuarterPicker year={year} quarter={quarter} onChange={(y, q) => setF({ y: String(y), q: String(q) })} />}>
      {st.isLoading ? <div className="card"><LoadingRows /></div> : st.isError ? <ErrorState error={st.error} onRetry={() => st.refetch()} /> : !st.data!.accounts.length || !st.data!.costCenters.length ? (
        <div className="card">
          <EmptyState title={st.data!.admin ? 'Comece pela estrutura do orçamento' : 'Você ainda não é responsável por um centro de custo'}
            description={st.data!.admin ? 'Crie o plano de contas sugerido pela política (Comunicação, Ferramentas, Viagens, Serviços, Eventos) e os centros Marketing, Comercial, Sucesso do Cliente, YepNet e Produto. Depois ajuste à vontade.' : 'A Diretoria define o líder de cada centro de custo em Planejamento orçamentário → Plano de contas e centros.'}
            action={st.data!.admin ? <Button variant="primary" loading={setup.isPending} onClick={() => setup.mutate()}>Criar estrutura sugerida</Button> : undefined} />
        </div>
      ) : (
        <>
          <Tabs label="Planejamento" className="mb-5" value={f.t} onChange={(t) => setF({ t })} tabs={tabs} />
          {f.t === 'lancamentos' && <BudgetLaunches st={st.data!} year={year} quarter={quarter} />}
          {f.t === 'visao' && <Overview year={year} quarter={quarter} onOpen={(cc) => setF({ cc, t: 'centro' })} />}
          {f.t === 'centro' && <CostCenterPlan st={st.data!} year={year} quarter={quarter} cc={f.cc || st.data!.costCenters.find((c) => c.active)?.id || ''} onCc={(cc) => setF({ cc })} />}
          {f.t === 'estrutura' && st.data!.admin && <StructureAdmin st={st.data!} />}
          {f.t === 'historico' && <History />}
        </>
      )}
    </BudgetShell>
  );
}

// ------------------------------------------------------------------ visão do trimestre
function Overview({ year, quarter, onOpen }: { year: number; quarter: number; onOpen: (cc: string) => void }) {
  const q = useQuery({ queryKey: ['budget', 'quarter', year, quarter], queryFn: () => api<QuarterData>(`/budget/quarter${qs({ year, quarter })}`) });
  if (q.isLoading || !q.data) return <div className="card"><LoadingRows /></div>;
  const d = q.data;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-5" aria-label="Resumo do trimestre">
        <Stat label="Planejado aprovado" value={neg(d.total.planned)} sub={d.total.adjusted ? `inclui ${neg(d.total.adjusted).replace('−', d.total.adjusted > 0 ? '+' : '−')} do Budget Guardião` : 'valor aprovado pela Diretoria'} />
        <Stat label="Realizado" value={neg(d.total.realized)} />
        <Stat label="Disponível" value={fmtBRL(d.total.available)} tone={d.total.available < 0 ? 'danger' : undefined} />
        <Stat label="Execução" value={d.total.over ? '>100%' : d.total.pct === null ? '—' : `${Math.round(d.total.pct)}%`} sub={<BandChip band={d.total.band} />} />
        <Stat label="Aguardando a Diretoria" value={neg(d.total.pending)} sub={`${d.items.reduce((t, i) => t + i.pendingAdjustments, 0)} ajuste(s) do Guardião acima de 15%`} />
      </dl>
      <section className="card overflow-x-auto p-0" aria-label={`Centros de custo no ${d.label}`}>
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted">
            <th className="px-4 py-2.5 font-semibold">Centro de custo</th><th className="px-3 py-2.5 font-semibold">Planejamento</th><th className="px-3 py-2.5 text-right font-semibold">Planejado</th><th className="px-3 py-2.5 text-right font-semibold">Realizado</th>
            <th className="px-3 py-2.5 font-semibold">% execução</th><th className="px-3 py-2.5 text-right font-semibold">Disponível</th><th className="px-4 py-2.5 font-semibold">Faixa</th>
          </tr></thead>
          <tbody>
            {d.items.map((i) => (
              <tr key={i.costCenter.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => onOpen(i.costCenter.id)}>
                <td className="px-4 py-3"><button type="button" className="text-left font-semibold text-ink hover:text-primary" onClick={(e) => { e.stopPropagation(); onOpen(i.costCenter.id); }}>{i.costCenter.code} · {i.costCenter.name}</button></td>
                <td className="px-3 py-3"><Tag className={PLAN_TONE[i.planStatus]}>{PLAN_STATUS_LABELS[i.planStatus]}</Tag>{i.pending > 0 && <span className="ml-2 text-xs text-muted">{neg(i.pending)} em aprovação</span>}</td>
                <td className="px-3 py-3 text-right tabular-nums">{neg(i.planned)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{neg(i.realized)}</td>
                <td className="px-3 py-3"><ExecBar t={i} /></td>
                <td className={clsx('px-3 py-3 text-right tabular-nums', i.available < 0 && 'text-danger')}>{fmtBRL(i.available)}</td>
                <td className="px-4 py-3"><BandChip band={i.band} />{i.pendingAdjustments > 0 && <span className="ml-2 text-xs font-semibold text-[#C2610C]">{i.pendingAdjustments} Guardião</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-muted">Faixas da política: abaixo de 50% subexecução (avaliar replanejamento) · 50 a 90% adequada · acima de 90% risco de estouro (avaliar Budget Guardião) · acima de 100% só com Budget Guardião.</p>
    </div>
  );
}

// ------------------------------------------------------------------ centro de custo
function CostCenterPlan({ st, year, quarter, cc, onCc }: { st: Structure; year: number; quarter: number; cc: string; onCc: (v: string) => void }) {
  const q = useQuery({ queryKey: ['budget', 'plan', cc, year, quarter], enabled: !!cc, queryFn: () => api<Plan>(`/budget/plan${qs({ year, quarter, costCenterId: cc })}`) });
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => qc.invalidateQueries({ queryKey: ['budget'] });
  const [line, setLine] = useState<Line | 'new' | null>(null);
  const [expense, setExpense] = useState<Line | 'new' | null>(null);
  const [guardian, setGuardian] = useState(false);
  const [decide, setDecide] = useState<{ decision: 'aprovar' | 'recusar' | 'devolver'; ids: string[] } | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const act = useMutation({
    mutationFn: (x: { url: string; body?: unknown; method?: string }) => api(x.url, { method: x.method ?? 'POST', body: x.body }),
    onSuccess: () => { refresh(); setSel([]); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const ccs = st.costCenters.filter((c) => c.active);
  const accName = useMemo(() => new Map(st.accounts.map((a) => [a.id, a])), [st.accounts]);
  if (!cc) return <div className="card"><EmptyState title="Nenhum centro de custo" /></div>;
  if (q.isLoading || !q.data) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const pendingLines = d.lines.filter((l) => l.status === 'em_aprovacao');
  const draft = d.lines.filter((l) => l.status === 'rascunho' || l.status === 'recusado');
  const locked = d.plan.status === 'em_aprovacao' || d.plan.status === 'aprovado';
  const rowsByCode = d.accounts.map((r) => ({ ...r, a: accName.get(r.accountId)! })).filter((r) => r.a).sort((a, b) => a.a.code.localeCompare(b.a.code, 'pt-BR', { numeric: true }));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Centro de custo" className="h-11 w-auto" value={cc} onChange={(e) => onCc(e.target.value)}>{ccs.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select>
        <Tag className={PLAN_TONE[d.plan.status]}>{PLAN_STATUS_LABELS[d.plan.status]}</Tag>
        <span className="text-sm text-muted">Líder: {d.costCenter.leaderId ? st.users.find((u) => u.id === d.costCenter.leaderId)?.name : 'não definido'}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {d.canEdit && !locked && <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setLine('new')}>Planejar item</Button>}
          {d.canEdit && !locked && <Button variant="outline" onClick={() => act.mutate({ url: '/budget/plan/import-resources', body: { costCenterId: cc, year, quarter } }, { onSuccess: (r) => toast({ tone: 'success', message: `${(r as { created: number }).created} item(ns) recorrente(s) trazido(s)` }) })}>Trazer licenças e contratos</Button>}
          {d.canEdit && draft.length > 0 && d.plan.status !== 'em_aprovacao' && <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate({ url: '/budget/plan/submit', body: { costCenterId: cc, year, quarter } }, { onSuccess: () => toast({ tone: 'success', message: 'Planejamento enviado à Diretoria' }) })}>Enviar à Diretoria ({draft.length})</Button>}
          {d.canEdit && d.total.approved > 0 && <Button variant="outline" icon={<ShieldAlert className="h-4 w-4" />} onClick={() => setGuardian(true)}>Budget Guardião</Button>}
          {d.canEdit && d.total.approved > 0 && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setExpense('new')}>Lançar gasto</Button>}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-5" aria-label="Resumo do centro de custo">
        <Stat label="Planejado aprovado" value={neg(d.total.planned)} sub={d.total.adjusted ? `Guardião: ${d.total.adjusted > 0 ? '+' : '−'}${fmtBRL(Math.abs(d.total.adjusted))}` : d.label} />
        <Stat label="Realizado" value={neg(d.total.realized)} />
        <Stat label="Disponível" value={fmtBRL(d.total.available)} tone={d.total.available < 0 ? 'danger' : undefined} />
        <Stat label="Execução" value={d.total.over ? '>100%' : d.total.pct === null ? '—' : `${Math.round(d.total.pct)}%`} sub={<BandChip band={d.total.band} />} />
        <Stat label="Em planejamento / aprovação" value={neg(d.total.draft + d.total.pending)} sub={`${draft.length} rascunho(s) · ${pendingLines.length} com a Diretoria`} />
      </dl>

      {d.admin && pendingLines.length > 0 && (
        <section className="border border-warning/40 bg-warning-soft/40 p-4" aria-label="Aprovação da Diretoria">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink"><strong>{pendingLines.length} item(ns)</strong> aguardando a Diretoria · {neg(pendingLines.reduce((t, l) => t + l.amountCents, 0))}. Aprove o total do centro ou marque itens na lista.</p>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="primary" icon={<Check className="h-4 w-4" />} onClick={() => setDecide({ decision: 'aprovar', ids: sel })}>{sel.length ? `Aprovar ${sel.length} selecionado(s)` : 'Aprovar o total do centro'}</Button>
              <Button variant="outline" icon={<X className="h-4 w-4" />} onClick={() => setDecide({ decision: 'recusar', ids: sel })}>{sel.length ? 'Recusar selecionados' : 'Recusar todos'}</Button>
              <Button variant="outline" icon={<Undo2 className="h-4 w-4" />} onClick={() => setDecide({ decision: 'devolver', ids: sel })}>Devolver para ajuste</Button>
            </div>
          </div>
        </section>
      )}

      <section className="card overflow-x-auto p-0" aria-label="Orçado por conta">
        <header className="flex items-baseline justify-between border-b border-line px-4 py-3"><h2 className="text-md font-bold text-ink">Orçado × realizado por conta</h2><span className="text-xs text-muted">Despesas em negativo (−)</span></header>
        {!rowsByCode.length ? <p className="px-4 py-6 text-sm text-muted">Nada planejado neste trimestre.</p> : (
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted">
              <th className="px-4 py-2 font-semibold">Conta</th>
              {d.months.map((m) => <th key={m} className="px-3 py-2 text-right font-semibold">{monthName(m)}</th>)}
              <th className="px-3 py-2 text-right font-semibold">Planejado</th><th className="px-3 py-2 text-right font-semibold">Realizado</th><th className="px-3 py-2 font-semibold">% execução</th><th className="px-4 py-2 font-semibold">Faixa</th>
            </tr></thead>
            <tbody>
              {rowsByCode.map((r) => (
                <tr key={r.accountId} className={clsx('border-b border-line last:border-0', !r.a.leaf && 'bg-surface-2/60 font-semibold')}>
                  <td className="px-4 py-2" style={{ paddingLeft: `${16 + (r.a.level - 1) * 16}px` }}><span className="tabular-nums text-muted">{r.a.code}</span> <span className="text-ink">{r.a.name}</span></td>
                  {r.byMonth.map((m) => <td key={m.month} className="px-3 py-2 text-right tabular-nums text-text" title={`Planejado ${neg(m.planned)} · realizado ${neg(m.realized)}`}>{m.planned || m.realized ? <>{neg(m.realized)}<span className="block text-2xs text-muted">de {neg(m.planned)}</span></> : '—'}</td>)}
                  <td className="px-3 py-2 text-right tabular-nums">{neg(r.planned)}{(r.pending > 0 || r.draft > 0) && <span className="block text-2xs font-normal text-muted">+{fmtBRL(r.pending + r.draft)} não aprovado</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{neg(r.realized)}</td>
                  <td className="px-3 py-2"><ExecBar t={r} /></td>
                  <td className="px-4 py-2"><BandChip band={r.band} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card p-0" aria-label="Itens planejados">
        <header className="flex items-baseline justify-between border-b border-line px-4 py-3"><h2 className="text-md font-bold text-ink">Itens planejados</h2><span className="text-xs text-muted">O quê, como e quando</span></header>
        {!d.lines.length ? <p className="px-4 py-6 text-sm text-muted">{d.canEdit ? 'Use “Planejar item” para montar o trimestre.' : 'Sem itens.'}</p> : (
          <ul className="divide-y divide-line">
            {d.lines.map((l) => {
              const a = accName.get(l.accountId);
              const spent = d.expenses.filter((e) => e.lineId === l.id && e.status === 'valido').reduce((t, e) => t + e.amountCents, 0);
              return (
                <li key={l.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  {d.admin && l.status === 'em_aprovacao' && <input type="checkbox" aria-label={`Selecionar ${l.what}`} className="mt-1 h-4 w-4 accent-[rgb(var(--primary))]" checked={sel.includes(l.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{l.what} <span className="font-normal text-muted">· {ITEM_TYPE_LABELS[l.itemType as keyof typeof ITEM_TYPE_LABELS] ?? l.itemType}</span></p>
                    <p className="text-xs text-muted">{a ? `${a.code} ${a.path.split(' › ').slice(1).join(' › ')}` : ''} · {monthName(l.month)}/{l.month.slice(0, 4)}{l.how ? ` · ${l.how}` : ''}</p>
                    {l.decisionNote && <p className="mt-0.5 text-xs text-[#C2610C]">Diretoria: {l.decisionNote}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-ink">{neg(l.amountCents)}</p>
                    {l.status === 'aprovado' && <p className="text-xs tabular-nums text-muted">gasto {neg(spent)}</p>}
                  </div>
                  <Tag className={LINE_TONE[l.status]}>{LINE_STATUS_LABELS[l.status]}</Tag>
                  <div className="flex gap-1">
                    {d.canEdit && (l.status === 'rascunho' || l.status === 'recusado') && <Button size="sm" variant="ghost" onClick={() => setLine(l)}>Editar</Button>}
                    {d.canEdit && (l.status === 'rascunho' || l.status === 'recusado') && <Button size="sm" variant="ghost" onClick={() => act.mutate({ url: `/budget/plan/lines/${l.id}`, method: 'DELETE' })}>Retirar</Button>}
                    {d.canEdit && l.status === 'aprovado' && <Button size="sm" variant="ghost" onClick={() => setExpense(l)}>Lançar gasto</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Expenses d={d} accName={accName} onCancel={(id, reason) => act.mutate({ url: `/budget/expenses/${id}/cancel`, body: { reason } })} />
        <Guardian d={d} accName={accName} onDecide={(id, approve, note) => act.mutate({ url: `/budget/adjustments/${id}/decide`, body: { approve, note } })} />
      </div>
      <Review cc={cc} months={d.months} canEdit={d.canEdit} />

      {line && <LineModal st={st} cc={cc} months={monthsOfQuarter(year, quarter)} line={line === 'new' ? null : line} onClose={() => setLine(null)} onDone={refresh} />}
      {expense && <ExpenseModal st={st} d={d} line={expense === 'new' ? null : expense} onClose={() => setExpense(null)} onDone={refresh} />}
      {guardian && <GuardianModal st={st} d={d} onClose={() => setGuardian(false)} onDone={refresh} />}
      {decide && <DecideModal decide={decide} planId={d.plan.id} onClose={() => setDecide(null)} onDone={() => { refresh(); setSel([]); }} />}
    </div>
  );
}

/** Pede um motivo (cancelamento, recusa) num diálogo da própria ferramenta. */
function ReasonModal({ title, label, min = 5, onClose, onConfirm }: { title: string; label: string; min?: number; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [v, setV] = useState('');
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose}>Voltar</Button><Button variant="primary" disabled={v.trim().length < min} onClick={() => { onConfirm(v.trim()); onClose(); }}>Confirmar</Button></>}>
      <FormField label={label} htmlFor="rs-v" required><Textarea id="rs-v" rows={3} value={v} onChange={(e) => setV(e.target.value)} /></FormField>
    </Modal>
  );
}

function Expenses({ d, accName, onCancel }: { d: Plan; accName: Map<string, Account>; onCancel: (id: string, reason: string) => void }) {
  const [cancel, setCancel] = useState<Expense | null>(null);
  return (
    <section className="card p-0" aria-label="Gastos realizados">
      <header className="border-b border-line px-4 py-3"><h2 className="text-md font-bold text-ink">Gastos realizados</h2></header>
      {!d.expenses.length ? <p className="px-4 py-6 text-sm text-muted">Nenhum gasto no trimestre.</p> : (
        <ul className="divide-y divide-line">
          {d.expenses.map((e) => (
            <li key={e.id} className={clsx('flex items-start gap-3 px-4 py-2.5', e.status === 'cancelado' && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className={clsx('text-sm text-ink', e.status === 'cancelado' && 'line-through')}>{e.description}</p>
                <p className="text-xs text-muted">{fmtDate(e.occurredOn)} · {accName.get(e.accountId)?.code} {accName.get(e.accountId)?.name}{e.paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[e.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS]}` : ''}{e.status === 'cancelado' ? ` · cancelado: ${e.cancelReason}` : ''}</p>
              </div>
              {e.docName && <a className="text-primary" href={`/api/v1/budget/expenses/${e.id}/document`} title={`Comprovante: ${e.docName}`} aria-label={`Baixar comprovante de ${e.description}`}><Download className="h-4 w-4" /></a>}
              <span className="text-sm font-semibold tabular-nums text-ink">{neg(e.amountCents)}</span>
              {d.canEdit && e.status === 'valido' && <button type="button" className="text-xs font-semibold text-muted hover:text-danger" onClick={() => setCancel(e)}>Cancelar</button>}
            </li>
          ))}
        </ul>
      )}
      {cancel && <ReasonModal title={`Cancelar gasto · ${cancel.description}`} label="Motivo do cancelamento" onClose={() => setCancel(null)} onConfirm={(r) => onCancel(cancel.id, r)} />}
    </section>
  );
}

const ADJ_LABEL = { registrado: 'Registrado (até 15%)', pendente: 'Aguardando a Diretoria', aprovado: 'Aprovado', recusado: 'Recusado' } as const;
const ADJ_TONE = { registrado: 'bg-primary-soft text-primary', pendente: 'bg-warning-soft text-[#C2610C]', aprovado: 'bg-success-soft text-[#15803D]', recusado: 'bg-danger-soft text-danger' } as const;
function Guardian({ d, accName, onDecide }: { d: Plan; accName: Map<string, Account>; onDecide: (id: string, approve: boolean, note: string | null) => void }) {
  const [refuse, setRefuse] = useState<string | null>(null);
  return (
    <section className="card p-0" aria-label="Budget Guardião">
      <header className="border-b border-line px-4 py-3"><h2 className="text-md font-bold text-ink">Budget Guardião</h2><p className="text-xs text-muted">Ajustes no trimestre: até 15% do centro com justificativa; acima, Diretoria. Tudo é reportado.</p></header>
      {!d.adjustments.length ? <p className="px-4 py-6 text-sm text-muted">Nenhum ajuste no trimestre.</p> : (
        <ul className="divide-y divide-line">
          {d.adjustments.map((a) => (
            <li key={a.id} className="px-4 py-2.5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{a.deltaCents > 0 ? 'Acréscimo' : 'Redução'} em {accName.get(a.accountId)?.code} {accName.get(a.accountId)?.name}</p>
                  <p className="text-xs text-muted">{a.justification}{a.pct !== null ? ` · ${a.pct.toFixed(1).replace('.', ',')}% acumulado no trimestre` : ''}{a.decisionNote ? ` · Diretoria: ${a.decisionNote}` : ''}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-ink">{a.deltaCents > 0 ? '+' : '−'}{fmtBRL(Math.abs(a.deltaCents))}</span>
                <Tag className={ADJ_TONE[a.status]}>{ADJ_LABEL[a.status]}</Tag>
              </div>
              {d.admin && a.status === 'pendente' && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => onDecide(a.id, true, null)}>Aprovar</Button>
                  <Button size="sm" variant="outline" onClick={() => setRefuse(a.id)}>Recusar</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {refuse && <ReasonModal title="Recusar ajuste do Budget Guardião" label="Motivo para o líder" min={3} onClose={() => setRefuse(null)} onConfirm={(n) => onDecide(refuse, false, n)} />}
    </section>
  );
}

type ReviewData = { items: { accountId: string; code: string; name: string; planned: number; realized: number; deviationPct: number | null; needsJustification: boolean; justification: string | null }[]; pending: number };
function Review({ cc, months, canEdit }: { cc: string; months: string[]; canEdit: boolean }) {
  const cur = now.toISOString().slice(0, 7);
  const [m, setM] = useState(months.includes(cur) ? cur : months[0]!);
  const q = useQuery({ queryKey: ['budget', 'review', cc, m], queryFn: () => api<ReviewData>(`/budget/review${qs({ costCenterId: cc, month: m })}`) });
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<{ accountId: string; name: string } | null>(null);
  const [text, setText] = useState('');
  const save = useMutation({ mutationFn: () => api('/budget/reviews', { method: 'POST', body: { costCenterId: cc, month: m, accountId: edit!.accountId, justification: text } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); setEdit(null); setText(''); toast({ tone: 'success', message: 'Justificativa registrada' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <section className="card p-0" aria-label="Revisão mensal">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="mr-auto"><h2 className="text-md font-bold text-ink">Revisão mensal</h2><p className="text-xs text-muted">Desvio acima de 15% por categoria precisa de justificativa (relatório até o 5º dia útil do mês seguinte).</p></div>
        <Select aria-label="Mês da revisão" className="h-10 w-auto" value={m} onChange={(e) => setM(e.target.value)}>{months.map((x) => <option key={x} value={x}>{monthName(x)}/{x.slice(0, 4)}</option>)}</Select>
      </header>
      {!q.data ? <LoadingRows rows={3} /> : !q.data.items.length ? <p className="px-4 py-6 text-sm text-muted">Nada planejado ou gasto no mês.</p> : (
        <ul className="divide-y divide-line">
          {q.data.items.map((i) => (
            <li key={i.accountId} className="flex flex-wrap items-start gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{i.code} {i.name}</p>
                <p className="text-xs text-muted">Planejado {neg(i.planned)} · realizado {neg(i.realized)} · desvio {i.deviationPct === null ? 'sem planejado' : `${i.deviationPct > 0 ? '+' : ''}${i.deviationPct.toFixed(1).replace('.', ',')}%`}</p>
                {i.justification && <p className="mt-0.5 text-xs text-text">Justificativa: {i.justification}</p>}
              </div>
              {i.needsJustification && !i.justification ? <Tag className="bg-warning-soft text-[#C2610C]">Justificar desvio</Tag> : i.needsJustification ? <Tag className="bg-primary-soft text-primary">Justificado</Tag> : <Tag className="bg-success-soft text-[#15803D]">Dentro de 15%</Tag>}
              {canEdit && i.needsJustification && <Button size="sm" variant="ghost" onClick={() => { setEdit({ accountId: i.accountId, name: `${i.code} ${i.name}` }); setText(i.justification ?? ''); }}>{i.justification ? 'Atualizar' : 'Justificar'}</Button>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Justificar desvio · ${edit?.name ?? ''}`} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" disabled={text.trim().length < 10} loading={save.isPending} onClick={() => save.mutate()}>Registrar justificativa</Button></>}>
        <FormField label="O que causou o desvio e o que será feito" htmlFor="rv-j" required><Textarea id="rv-j" rows={4} value={text} onChange={(e) => setText(e.target.value)} /></FormField>
      </Modal>
    </section>
  );
}

// ------------------------------------------------------------------ diálogos
function LineModal({ st, cc, months, line, onClose, onDone }: { st: Structure; cc: string; months: string[]; line: Line | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ accountId: line?.accountId ?? '', what: line?.what ?? '', how: line?.how ?? '', month: line?.month ?? months[0]!, amount: line ? (line.amountCents / 100).toFixed(2).replace('.', ',') : '', itemType: line?.itemType ?? 'outro', supplierId: line?.supplierId ?? '' });
  const save = useMutation({
    mutationFn: () => {
      const body = { accountId: v.accountId, what: v.what, how: v.how || null, month: v.month, amountCents: toCents(v.amount), itemType: v.itemType, supplierId: v.supplierId || null };
      return line ? api(`/budget/plan/lines/${line.id}`, { method: 'PATCH', body }) : api('/budget/plan/lines', { method: 'POST', body: { ...body, costCenterId: cc } });
    },
    onSuccess: () => { onDone(); onClose(); toast({ tone: 'success', message: line ? 'Item alterado' : 'Item planejado' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const valid = v.accountId && v.what.trim().length >= 3 && toCents(v.amount) > 0;
  return (
    <Modal open onClose={onClose} title={line ? 'Editar item planejado' : 'Planejar item'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="O quê" htmlFor="ln-what" required className="sm:col-span-2"><Input id="ln-what" value={v.what} onChange={(e) => setV({ ...v, what: e.target.value })} placeholder="Ex.: Campanha de mídia paga no LinkedIn" /></FormField>
        <FormField label="Como" htmlFor="ln-how" className="sm:col-span-2" hint="Fornecedor, formato, quantidade, critério de compra"><Textarea id="ln-how" rows={2} value={v.how} onChange={(e) => setV({ ...v, how: e.target.value })} /></FormField>
        <FormField label="Conta (subcategoria)" htmlFor="ln-acc" required className="sm:col-span-2"><AccountSelect id="ln-acc" value={v.accountId} onChange={(x) => setV({ ...v, accountId: x })} accounts={st.accounts} /></FormField>
        <FormField label="Quando (mês)" htmlFor="ln-m" required><Select id="ln-m" value={v.month} onChange={(e) => setV({ ...v, month: e.target.value })}>{months.map((m) => <option key={m} value={m}>{monthName(m)}/{m.slice(0, 4)}</option>)}</Select></FormField>
        <FormField label="Valor (R$)" htmlFor="ln-v" required><Input id="ln-v" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="0,00" /></FormField>
        <FormField label="Tipo" htmlFor="ln-t"><Select id="ln-t" value={v.itemType} onChange={(e) => setV({ ...v, itemType: e.target.value })}>{ITEM_TYPES.map((t) => <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>)}</Select></FormField>
        <FormField label="Fornecedor" htmlFor="ln-s"><Select id="ln-s" value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })}><option value="">—</option>{st.suppliers.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
      </div>
    </Modal>
  );
}

function ExpenseModal({ st, d, line, onClose, onDone }: { st: Structure; d: Plan; line: Line | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ accountId: line?.accountId ?? '', lineId: line?.id ?? '', occurredOn: now.toISOString().slice(0, 10), description: line?.what ?? '', amount: '', paymentMethod: 'cartao_corporativo', supplierId: line?.supplierId ?? '', financeCheck: false });
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => api<{ availableAfter: number }>('/budget/expenses', { method: 'POST', body: { costCenterId: d.costCenter.id, accountId: v.accountId, lineId: v.lineId || null, occurredOn: v.occurredOn, description: v.description, amountCents: toCents(v.amount), paymentMethod: v.paymentMethod || null, supplierId: v.supplierId || null, financeCheck: v.financeCheck, doc: file ? { name: file.name, data: await fileToBase64(file) } : null } }),
    onSuccess: (r) => { onDone(); onClose(); toast({ tone: 'success', message: `Gasto lançado · disponível na conta ${fmtBRL(r.availableAfter)}` }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const approved = d.lines.filter((l) => l.status === 'aprovado');
  const avail = d.accounts.find((a) => a.accountId === v.accountId)?.available;
  return (
    <Modal open onClose={onClose} title="Lançar gasto" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!v.accountId || !v.description.trim() || toCents(v.amount) <= 0 || !v.financeCheck} loading={save.isPending} onClick={() => save.mutate()}>Lançar gasto</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Item planejado" htmlFor="ex-l" className="sm:col-span-2" hint="Opcional: ligue o gasto ao item aprovado"><Select id="ex-l" value={v.lineId} onChange={(e) => { const l = approved.find((x) => x.id === e.target.value); setV({ ...v, lineId: e.target.value, accountId: l?.accountId ?? v.accountId, description: v.description || l?.what || '' }); }}><option value="">Sem item específico</option>{approved.map((l) => <option key={l.id} value={l.id}>{l.what} · {monthName(l.month)} · {neg(l.amountCents)}</option>)}</Select></FormField>
        <FormField label="Conta (subcategoria)" htmlFor="ex-acc" required className="sm:col-span-2" hint={avail !== undefined ? `Disponível no trimestre: ${fmtBRL(avail)}` : undefined}><AccountSelect id="ex-acc" value={v.accountId} onChange={(x) => setV({ ...v, accountId: x, lineId: '' })} accounts={st.accounts} /></FormField>
        <FormField label="Descrição" htmlFor="ex-d" required className="sm:col-span-2"><Input id="ex-d" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></FormField>
        <FormField label="Data" htmlFor="ex-dt" required><Input id="ex-dt" type="date" value={v.occurredOn} onChange={(e) => setV({ ...v, occurredOn: e.target.value })} /></FormField>
        <FormField label="Valor (R$)" htmlFor="ex-v" required><Input id="ex-v" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="0,00" /></FormField>
        <FormField label="Forma de pagamento" htmlFor="ex-p"><Select id="ex-p" value={v.paymentMethod} onChange={(e) => setV({ ...v, paymentMethod: e.target.value })}>{PAYMENT_METHODS.map((p) => <option key={p} value={p}>{PAYMENT_METHOD_LABELS[p]}</option>)}</Select></FormField>
        <FormField label="Fornecedor" htmlFor="ex-s"><Select id="ex-s" value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })}><option value="">—</option>{st.suppliers.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
        <FormField label="Comprovante (PDF, PNG ou JPG)" htmlFor="ex-f" className="sm:col-span-2">
          <label className="flex cursor-pointer items-center gap-2 border border-dashed border-line px-3 py-2.5 text-sm text-muted hover:border-primary"><FileUp className="h-4 w-4" aria-hidden />{file ? file.name : 'Escolher arquivo'}<input id="ex-f" type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        </FormField>
        <label className="flex items-start gap-2 text-sm text-ink sm:col-span-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]" checked={v.financeCheck} onChange={(e) => setV({ ...v, financeCheck: e.target.checked })} />Fiz a checagem prévia com o Financeiro (disponibilidade de recursos e data de pagamento)</label>
      </div>
    </Modal>
  );
}

function GuardianModal({ st, d, onClose, onDone }: { st: Structure; d: Plan; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ accountId: '', month: d.months.includes(now.toISOString().slice(0, 7)) ? now.toISOString().slice(0, 7) : d.months[0]!, kind: 'mais', amount: '', justification: '' });
  const delta = (v.kind === 'mais' ? 1 : -1) * toCents(v.amount || '0');
  const prevAbs = d.adjustments.filter((a) => a.status !== 'recusado').reduce((t, a) => t + Math.abs(a.deltaCents), 0);
  const pct = d.total.approved ? ((prevAbs + Math.abs(delta)) / d.total.approved) * 100 : null;
  const save = useMutation({
    mutationFn: () => api<{ status: string }>('/budget/adjustments', { method: 'POST', body: { costCenterId: d.costCenter.id, accountId: v.accountId, month: v.month, deltaCents: delta, justification: v.justification } }),
    onSuccess: (r) => { onDone(); onClose(); toast({ tone: 'success', message: r.status === 'pendente' ? 'Ajuste enviado à Diretoria (acima de 15%)' : 'Ajuste registrado e reportado à Diretoria' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} title="Budget Guardião" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!v.accountId || !delta || v.justification.trim().length < 15} loading={save.isPending} onClick={() => save.mutate()}>{pct !== null && pct > 15 && !d.admin ? 'Enviar à Diretoria' : 'Registrar ajuste'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Conta (subcategoria)" htmlFor="gd-acc" required className="sm:col-span-2"><AccountSelect id="gd-acc" value={v.accountId} onChange={(x) => setV({ ...v, accountId: x })} accounts={st.accounts} /></FormField>
        <FormField label="Ajuste" htmlFor="gd-k"><Select id="gd-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="mais">Acrescentar</option><option value="menos">Reduzir</option></Select></FormField>
        <FormField label="Valor (R$)" htmlFor="gd-v" required><Input id="gd-v" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></FormField>
        <FormField label="Mês" htmlFor="gd-m"><Select id="gd-m" value={v.month} onChange={(e) => setV({ ...v, month: e.target.value })}>{d.months.map((m) => <option key={m} value={m}>{monthName(m)}/{m.slice(0, 4)}</option>)}</Select></FormField>
        <div className="self-end pb-2 text-sm">{pct !== null && delta !== 0 && <span className={pct > 15 ? 'font-semibold text-[#C2610C]' : 'text-muted'}>{pct.toFixed(1).replace('.', ',')}% do trimestre (acumulado) · {pct > 15 ? 'precisa da Diretoria' : 'dentro dos 15%'}</span>}</div>
        <FormField label="Justificativa formal" htmlFor="gd-j" required className="sm:col-span-2"><Textarea id="gd-j" rows={3} value={v.justification} onChange={(e) => setV({ ...v, justification: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

function DecideModal({ decide, planId, onClose, onDone }: { decide: { decision: 'aprovar' | 'recusar' | 'devolver'; ids: string[] }; planId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const save = useMutation({ mutationFn: () => api('/budget/plan/decide', { method: 'POST', body: { planId, lineIds: decide.ids, decision: decide.decision, note: note || null } }), onSuccess: () => { onDone(); onClose(); toast({ tone: 'success', message: decide.decision === 'aprovar' ? 'Aprovado' : decide.decision === 'recusar' ? 'Recusado' : 'Devolvido ao líder' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const title = decide.decision === 'aprovar' ? (decide.ids.length ? `Aprovar ${decide.ids.length} item(ns)` : 'Aprovar o total do centro de custo') : decide.decision === 'recusar' ? 'Recusar' : 'Devolver para ajuste';
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={decide.decision !== 'aprovar' && note.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>{decide.decision === 'aprovar' ? 'Aprovar' : decide.decision === 'recusar' ? 'Recusar' : 'Devolver'}</Button></>}>
      <FormField label={decide.decision === 'aprovar' ? 'Observação (opcional)' : 'Motivo para o líder'} htmlFor="dc-n" required={decide.decision !== 'aprovar'}><Textarea id="dc-n" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
    </Modal>
  );
}

// ------------------------------------------------------------------ estrutura (Diretoria)
function StructureAdmin({ st }: { st: Structure }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [acc, setAcc] = useState<{ parentId: string | null; code: string; name: string } | null>(null);
  const [cc, setCc] = useState<(Partial<CostCenter> & { isNew?: boolean }) | null>(null);
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['budget'] }); toast({ tone: 'success', message: msg }); };
  const saveAcc = useMutation({ mutationFn: () => api('/budget/accounts', { method: 'POST', body: acc }), onSuccess: () => { setAcc(null); done('Conta criada'); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const toggleAcc = useMutation({ mutationFn: (a: Account) => api(`/budget/accounts/${a.id}`, { method: 'PATCH', body: { active: !a.active } }), onSuccess: () => done('Conta atualizada'), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const saveCc = useMutation({
    mutationFn: () => (cc!.isNew ? api('/budget/cost-centers', { method: 'POST', body: { code: cc!.code, name: cc!.name, leaderId: cc!.leaderId || null, memberIds: cc!.memberIds ?? [] } }) : api(`/budget/cost-centers/${cc!.id}`, { method: 'PATCH', body: { name: cc!.name, leaderId: cc!.leaderId || null, memberIds: cc!.memberIds ?? [], active: cc!.active } })),
    onSuccess: () => { setCc(null); done('Centro de custo salvo'); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  /** Próximo código livre abaixo da conta-mãe (3.2 → 3.2.04). */
  const nextCode = (parent: Account | null) => {
    if (!parent) { const tops = st.accounts.filter((a) => !a.parentId).map((a) => Number(a.code)); return String((Math.max(0, ...tops) || 2) + 1); }
    const kids = st.accounts.filter((a) => a.parentId === parent.id).map((a) => Number(a.code.split('.').pop()));
    const n = (Math.max(0, ...kids) || 0) + 1;
    return `${parent.code}.${parent.level >= 2 ? String(n).padStart(2, '0') : n}`;
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
      <section className="card p-0" aria-label="Plano de contas">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div><h2 className="text-md font-bold text-ink">Plano de contas</h2><p className="text-xs text-muted">Categoria › subcategoria. Planejamento e gastos só nas subcategorias. Despesa aparece negativa.</p></div>
          <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setAcc({ parentId: null, code: nextCode(null), name: '' })}>Conta de 1º nível</Button>
        </header>
        <ul className="divide-y divide-line">
          {st.accounts.map((a) => (
            <li key={a.id} className={clsx('flex items-center gap-3 px-4 py-2', !a.active && 'opacity-50')} style={{ paddingLeft: `${16 + (a.level - 1) * 20}px` }}>
              <span className="w-16 shrink-0 text-sm tabular-nums text-muted">{a.code}</span>
              <span className={clsx('min-w-0 flex-1 truncate text-sm', a.leaf ? 'text-ink' : 'font-semibold text-ink')}>{a.name}</span>
              <span className="text-xs text-muted">{a.leaf ? 'subcategoria' : a.level === 1 ? 'grupo' : 'categoria'}</span>
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setAcc({ parentId: a.id, code: nextCode(a), name: '' })}>+ conta abaixo</button>
              <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => toggleAcc.mutate(a)}>{a.active ? 'Desativar' : 'Reativar'}</button>
            </li>
          ))}
        </ul>
      </section>
      <section className="card p-0" aria-label="Centros de custo">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div><h2 className="text-md font-bold text-ink">Centros de custo</h2><p className="text-xs text-muted">O líder planeja e consome; você pode indicar outras pessoas.</p></div>
          <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setCc({ isNew: true, code: '', name: '', leaderId: null, memberIds: [], active: true })}>Novo centro</Button>
        </header>
        <ul className="divide-y divide-line">
          {st.costCenters.map((c) => (
            <li key={c.id} className={clsx('flex items-center gap-3 px-4 py-2.5', !c.active && 'opacity-50')}>
              <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink">{c.code} · {c.name}</p><p className="text-xs text-muted">Líder: {c.leaderName ?? 'não definido'}{c.memberNames.length ? ` · também consomem: ${c.memberNames.join(', ')}` : ''}</p></div>
              <Button size="sm" variant="ghost" onClick={() => setCc({ ...c })}>Editar</Button>
            </li>
          ))}
        </ul>
      </section>
      {acc && (
        <Modal open onClose={() => setAcc(null)} title={acc.parentId ? `Nova conta abaixo de ${st.accounts.find((a) => a.id === acc.parentId)?.code}` : 'Nova conta de 1º nível'} footer={<><Button variant="ghost" onClick={() => setAcc(null)}>Cancelar</Button><Button variant="primary" disabled={!acc.code || acc.name.trim().length < 2} loading={saveAcc.isPending} onClick={() => saveAcc.mutate()}>Criar conta</Button></>}>
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <FormField label="Código" htmlFor="ac-c" required hint={acc.parentId ? `Começa com ${parentCode(acc.code) ?? ''}.` : undefined}><Input id="ac-c" value={acc.code} onChange={(e) => setAcc({ ...acc, code: e.target.value })} /></FormField>
            <FormField label="Nome" htmlFor="ac-n" required><Input id="ac-n" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} placeholder="Ex.: Plataforma de CRM" /></FormField>
          </div>
        </Modal>
      )}
      {cc && (
        <Modal open onClose={() => setCc(null)} title={cc.isNew ? 'Novo centro de custo' : `Centro ${cc.code}`} footer={<><Button variant="ghost" onClick={() => setCc(null)}>Cancelar</Button><Button variant="primary" disabled={!cc.code || !cc.name} loading={saveCc.isPending} onClick={() => saveCc.mutate()}>Salvar</Button></>}>
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <FormField label="Código" htmlFor="cc-c" required><Input id="cc-c" disabled={!cc.isNew} value={cc.code ?? ''} onChange={(e) => setCc({ ...cc, code: e.target.value })} /></FormField>
            <FormField label="Nome" htmlFor="cc-n" required><Input id="cc-n" value={cc.name ?? ''} onChange={(e) => setCc({ ...cc, name: e.target.value })} /></FormField>
            <FormField label="Líder" htmlFor="cc-l" className="sm:col-span-2"><Select id="cc-l" value={cc.leaderId ?? ''} onChange={(e) => setCc({ ...cc, leaderId: e.target.value || null })}><option value="">Sem líder</option>{st.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
            <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-sm font-semibold text-ink">Também podem consumir o orçamento</legend>
              <div className="grid grid-cols-2 gap-1">{st.users.filter((u) => u.id !== cc.leaderId).map((u) => <label key={u.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={(cc.memberIds ?? []).includes(u.id)} onChange={(e) => setCc({ ...cc, memberIds: e.target.checked ? [...(cc.memberIds ?? []), u.id] : (cc.memberIds ?? []).filter((x) => x !== u.id) })} />{u.name}</label>)}</div>
            </fieldset>
            {!cc.isNew && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={!!cc.active} onChange={(e) => setCc({ ...cc, active: e.target.checked })} />Centro ativo</label>}
          </div>
        </Modal>
      )}
    </div>
  );
}

function History() {
  const q = useQuery({ queryKey: ['budget', 'events'], queryFn: () => api<{ items: { id: string; summary: string; createdAt: string; actor: string | null; action: string }[] }>('/budget/events?limit=200') });
  if (!q.data) return <div className="card"><LoadingRows /></div>;
  return (
    <section className="card p-0" aria-label="Histórico do orçamento">
      <header className="border-b border-line px-4 py-3"><h2 className="text-md font-bold text-ink">Histórico</h2><p className="text-xs text-muted">Planejamento, decisões da Diretoria, Budget Guardião, gastos e revisões — registro permanente, reportado à Diretoria.</p></header>
      {!q.data.items.length ? <p className="px-4 py-6 text-sm text-muted">Nada registrado ainda.</p> : (
        <ol className="divide-y divide-line">{q.data.items.map((e) => <li key={e.id} className="px-4 py-2.5"><p className="text-sm text-ink">{e.summary}</p><p className="text-xs text-muted">{fmtDateTime(e.createdAt)} · {e.actor ?? 'Sistema'}</p></li>)}</ol>
      )}
    </section>
  );
}
