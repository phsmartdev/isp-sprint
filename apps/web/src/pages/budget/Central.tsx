/**
 * Central do orçamento: a jornada inteira numa tela (prompt master do Orçamento).
 * Indicadores no topo, filtros, evolução em linhas, tabela hierárquica em DRE e o painel lateral do lançamento
 * (Planejamento, Aprovação, Execução, Financeiro, Auditoria, Resultado). Nada sai desta tela.
 * Os números vêm prontos da API (camada única de cálculo no domínio); a tela não recalcula regra de negócio.
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ChevronDown, ChevronRight, Columns3, Download, FileUp, Plus, Search, ShieldAlert } from 'lucide-react';
import {
  APPROVAL_STATES, APPROVAL_STATE_LABELS, BUDGET_DECISIONS, BUDGET_DECISION_LABELS, BUDGET_PRIORITIES, BUDGET_UNITS, BUDGET_UNIT_LABELS, EXECUTION_STATES, EXECUTION_STATE_LABELS, EXPENSE_TYPES, EXPENSE_TYPE_LABELS,
  PAYMENT_FLAG_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, QUESTION_KINDS, QUESTION_KIND_LABELS, type ApprovalState, type BudgetDecision, type ExecutionState, type PaymentFlag,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { fileToBase64 } from '../../lib/files';
import { LineChart } from '../../components/charts/charts';
import { Button, Chip, type Tone, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Tabs, Textarea } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { AccountSelect, errMsg, type Structure } from '../../features/budget/shared';

// ------------------------------------------------------------------ tipos da API
type Figures = { planned: number; original: number; approved: number; reserved: number; committed: number; realized: number; paid: number; charges: number; consumption: number; balance: number; deviation: number | null; deviationPct: number | null; economy: number; excess: number; pending: number };
type Row = Figures & {
  id: string; code: string | null; what: string; costCenterId: string; accountId: string; month: string; ownerId: string | null; owner: string | null; qty: string; unit: string; unitCents: number | null;
  approvalState: ApprovalState; approvalStage: string | null; executionState: ExecutionState; financial: PaymentFlag; priority: string; expenseType: string; openQuestions: number; limitCents: number | null; targetUnitCents: number | null; canDecide: boolean;
};
type Kpis = { original: number; revised: number; approved: number; requested: number; reserved: number; committed: number; realized: number; paid: number; charges: number; available: number; awaiting: number; excessAuthorized: number; guardianBalance: number | null; projection: number; economy: number; excess: number };
type SeriesPoint = { month: string; original: number; revised: number; approved: number; committed: number; realized: number; paid: number; projection: number };
type Opt = { id: string; name: string };
type CentralData = {
  period: { from: string; to: string }; kpis: Kpis; series: SeriesPoint[]; rows: Row[];
  centers: { id: string; code: string; name: string; authorized: number; consumed: number; alert: 'alerta' | 'bloqueio' | null; canPlan: boolean; canExecute: boolean }[];
  accounts: { id: string; parentId: string | null; code: string; name: string; leaf: boolean; level: number }[];
  options: { costCenters: { id: string; code: string; name: string }[]; users: Opt[]; suppliers: Opt[]; projects: Opt[]; campaigns: Opt[] };
  policy: { alertPct: number | null; blockPct: number | null; reserveMode: string };
  can: { decide: boolean; finance: boolean; admin: boolean; director: boolean };
};

// ------------------------------------------------------------------ apoio
const toCents = (v: string) => { const n = Number(String(v).replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && v !== '' ? Math.round(n * 100) : null; };
const money = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));
const monthShort = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const key = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
const APPROVAL_TONE: Record<ApprovalState, Tone> = { rascunho: 'neutral', planejado: 'neutral', enviado: 'blue', em_analise: 'blue', questionado: 'orange', em_revisao: 'orange', aprovado: 'green', aprovado_ressalvas: 'green', rejeitado: 'red' };
const FIN_TONE = (f: PaymentFlag): Tone => (f === 'vencido' ? 'red' : f === 'pago' || f === 'conciliado' || f === 'pago_em_dia' || f === 'pago_antecipado' ? 'green' : f === 'parcial' || f === 'a_vencer' || f === 'pago_atraso' || f === 'pago_com_juros' ? 'orange' : 'neutral');

type ColKey = 'conta' | 'centro' | 'responsavel' | 'competencia' | 'quantidade' | 'unitario' | 'planejado' | 'aprovado' | 'comprometido' | 'realizado' | 'pago' | 'saldo' | 'desvio' | 'aprovacao' | 'execucao' | 'financeiro';
const COLS: { key: ColKey; label: string; num?: boolean }[] = [
  { key: 'conta', label: 'Conta' }, { key: 'centro', label: 'Centro de custos' }, { key: 'responsavel', label: 'Responsável' }, { key: 'competencia', label: 'Competência' },
  { key: 'quantidade', label: 'Qtd.', num: true }, { key: 'unitario', label: 'Valor unitário', num: true }, { key: 'planejado', label: 'Planejado', num: true }, { key: 'aprovado', label: 'Aprovado', num: true },
  { key: 'comprometido', label: 'Comprometido', num: true }, { key: 'realizado', label: 'Realizado', num: true }, { key: 'pago', label: 'Pago', num: true }, { key: 'saldo', label: 'Saldo', num: true },
  { key: 'desvio', label: 'Desvio', num: true }, { key: 'aprovacao', label: 'Aprovação' }, { key: 'execucao', label: 'Execução' }, { key: 'financeiro', label: 'Financeiro' },
];
const DEFAULT_COLS: ColKey[] = ['centro', 'competencia', 'planejado', 'aprovado', 'comprometido', 'realizado', 'pago', 'saldo', 'desvio', 'aprovacao', 'financeiro'];
const loadCols = (): ColKey[] => { try { const v = JSON.parse(localStorage.getItem('orc-central-cols') ?? 'null'); return Array.isArray(v) ? v : DEFAULT_COLS; } catch { return DEFAULT_COLS; } };

type PanelTab = 'planejamento' | 'aprovacao' | 'execucao' | 'financeiro' | 'auditoria' | 'resultado';

// ------------------------------------------------------------------ tela
export function BudgetCentral({ st, year }: { st: Structure; year: number }) {
  const [f, setF] = useState({ from: `${year}-01`, to: `${year}-12`, costCenterId: '', accountId: '', ownerId: '', projectId: '', campaignId: '', supplierId: '', approval: '', execution: '', financial: '', q: '' });
  const params = { year, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) };
  const q = useQuery({ queryKey: ['budget', 'central', params], queryFn: () => api<CentralData>(`/budget/central${qs(params)}`) });
  const [open, setOpen] = useState<{ id: string; tab: PanelTab } | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [batch, setBatch] = useState(false);
  const [cols, setColsState] = useState<ColKey[]>(loadCols);
  const setCols = (c: ColKey[]) => { setColsState(c); try { localStorage.setItem('orc-central-cols', JSON.stringify(c)); } catch { /* sem armazenamento */ } };
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  return (
    <div className="space-y-5">
      <KpiStrip k={d.kpis} />
      {d.centers.some((c) => c.alert) && (
        <div className="flex flex-wrap gap-2" aria-label="Alertas dos centros de custo">
          {d.centers.filter((c) => c.alert).map((c) => (
            <button key={c.id} type="button" onClick={() => set({ costCenterId: c.id })} className={clsx('inline-flex items-center gap-2 border px-3 py-1.5 text-sm', c.alert === 'bloqueio' ? 'border-danger/40 bg-danger-soft text-danger' : 'border-warning/40 bg-warning-soft text-[#9A4D06]')}>
              {c.alert === 'bloqueio' ? <ShieldAlert className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
              <b>{c.code}</b> {c.alert === 'bloqueio' ? 'no limite de bloqueio' : 'no limite de alerta'}: {fmtBRL(c.consumed)} de {fmtBRL(c.authorized)}
            </button>
          ))}
        </div>
      )}
      <section aria-label="Filtros" className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <FormField label="De" htmlFor="bc-from"><Select id="bc-from" value={f.from} onChange={(e) => set({ from: e.target.value })}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</Select></FormField>
        <FormField label="Até" htmlFor="bc-to"><Select id="bc-to" value={f.to} onChange={(e) => set({ to: e.target.value })}>{months.filter((m) => m >= f.from).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</Select></FormField>
        <FormField label="Centro de custos" htmlFor="bc-cc"><Select id="bc-cc" value={f.costCenterId} onChange={(e) => set({ costCenterId: e.target.value })}><option value="">Todos que vejo</option>{d.options.costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select></FormField>
        <FormField label="Conta" htmlFor="bc-acc"><Select id="bc-acc" value={f.accountId} onChange={(e) => set({ accountId: e.target.value })}><option value="">Todas</option>{d.accounts.map((a) => <option key={a.id} value={a.id}>{' '.repeat((a.level - 1) * 2)}{a.code} {a.name}</option>)}</Select></FormField>
        <FormField label="Responsável" htmlFor="bc-own"><Select id="bc-own" value={f.ownerId} onChange={(e) => set({ ownerId: e.target.value })}><option value="">Todos</option>{d.options.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Buscar" htmlFor="bc-q"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden /><Input id="bc-q" className="pl-9" placeholder="Código ou descrição" value={f.q} onChange={(e) => set({ q: e.target.value })} /></div></FormField>
        <FormField label="Projeto" htmlFor="bc-prj"><Select id="bc-prj" value={f.projectId} onChange={(e) => set({ projectId: e.target.value })}><option value="">Todos</option>{d.options.projects.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Campanha" htmlFor="bc-cmp"><Select id="bc-cmp" value={f.campaignId} onChange={(e) => set({ campaignId: e.target.value })}><option value="">Todas</option>{d.options.campaigns.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Fornecedor" htmlFor="bc-sup"><Select id="bc-sup" value={f.supplierId} onChange={(e) => set({ supplierId: e.target.value })}><option value="">Todos</option>{d.options.suppliers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Aprovação" htmlFor="bc-ap"><Select id="bc-ap" value={f.approval} onChange={(e) => set({ approval: e.target.value })}><option value="">Todas</option>{APPROVAL_STATES.map((s) => <option key={s} value={s}>{APPROVAL_STATE_LABELS[s]}</option>)}</Select></FormField>
        <FormField label="Execução" htmlFor="bc-ex"><Select id="bc-ex" value={f.execution} onChange={(e) => set({ execution: e.target.value })}><option value="">Todas</option>{EXECUTION_STATES.map((s) => <option key={s} value={s}>{EXECUTION_STATE_LABELS[s]}</option>)}</Select></FormField>
        <FormField label="Financeiro" htmlFor="bc-fi"><Select id="bc-fi" value={f.financial} onChange={(e) => set({ financial: e.target.value })}><option value="">Todas</option>{(['sem_titulo', 'a_vencer', 'vencido', 'parcial', 'pago', 'conciliado'] as PaymentFlag[]).map((s) => <option key={s} value={s}>{PAYMENT_FLAG_LABELS[s]}</option>)}</Select></FormField>
      </section>
      <Evolution series={d.series} onPick={(m) => set({ from: m, to: m })} />
      <BudgetTable d={d} st={st} cols={cols} setCols={setCols} selected={selected} setSelected={setSelected} onOpen={(id, tab) => setOpen({ id, tab })} onCreate={() => setCreating(true)} onBatch={() => setBatch(true)} />
      {open && <LinePanel id={open.id} tab={open.tab} onTab={(tab) => setOpen({ ...open, tab })} onClose={() => setOpen(null)} st={st} options={d.options} />}
      {creating && <NewLine st={st} d={d} year={year} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpen({ id, tab: 'planejamento' }); }} />}
      {batch && <BatchDecision rows={d.rows.filter((r) => selected.includes(r.id))} onClose={() => setBatch(false)} onDone={() => { setBatch(false); setSelected([]); }} />}
    </div>
  );
}

function KpiStrip({ k }: { k: Kpis }) {
  const items: { label: string; v: number | null; hint: string; tone?: 'danger' | 'warning' | 'success' }[] = [
    { label: 'Orçamento original', v: k.original, hint: 'Primeira aprovação de cada lançamento' },
    { label: 'Orçamento revisado', v: k.revised, hint: 'Aprovado vigente + Budget Guardião' },
    { label: 'Aprovado', v: k.approved, hint: 'Limite autorizado dos lançamentos' },
    { label: 'Solicitado', v: k.requested, hint: 'Pedido em lançamentos enviados' },
    { label: 'Reservado', v: k.reserved, hint: 'Aprovado ainda sem obrigação' },
    { label: 'Comprometido', v: k.committed, hint: 'Obrigações assumidas' },
    { label: 'Realizado', v: k.realized, hint: 'Despesa reconhecida (competência)' },
    { label: 'Pago', v: k.paid, hint: 'Confirmado pelo Financeiro' },
    { label: 'Saldo disponível', v: k.available, hint: 'Autorizado − consumo − reservas', tone: k.available < 0 ? 'danger' : undefined },
    { label: 'Aguardando aprovação', v: k.awaiting, hint: 'Lançamentos e Guardião pendentes', tone: k.awaiting ? 'warning' : undefined },
    { label: 'Excedente autorizado', v: k.excessAuthorized, hint: 'Budget Guardião no centro' },
    { label: 'Saldo do Guardião', v: k.guardianBalance, hint: k.guardianBalance === null ? 'Reserva não configurada' : 'Reserva extraordinária livre' },
    { label: 'Projeção de encerramento', v: k.projection, hint: 'Consumido + aprovado em aberto', tone: k.projection > k.revised ? 'danger' : undefined },
  ];
  return (
    <section aria-label="Indicadores do orçamento" className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7">
      {items.map((i) => (
        <div key={i.label} className="bg-surface px-3.5 py-3" title={i.hint}>
          <p className="text-xs text-muted">{i.label}</p>
          <p className={clsx('num mt-1 text-lg font-bold', i.tone === 'danger' ? 'text-danger' : i.tone === 'warning' ? 'text-[#C2610C]' : 'text-ink')}>{i.v === null ? '—' : fmtBRL(i.v)}</p>
          <p className="mt-0.5 text-2xs text-faint">{i.hint}</p>
        </div>
      ))}
    </section>
  );
}

const SERIES = [
  { key: 'original', label: 'Original', color: '#7D8791', dashed: true }, { key: 'revised', label: 'Revisado', color: '#2D3339' }, { key: 'approved', label: 'Aprovado', color: '#2F5986' },
  { key: 'committed', label: 'Comprometido', color: '#3885D3' }, { key: 'realized', label: 'Realizado', color: '#D4752C' }, { key: 'paid', label: 'Pago', color: '#16A34A' }, { key: 'projection', label: 'Projeção', color: '#8F6BB8', dashed: true },
] as const;
const PERIODS = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 } as const;

/** Evolução em linhas: custos pela competência, pago pela data do pagamento. Clicar num ponto filtra a tabela. */
function Evolution({ series, onPick }: { series: SeriesPoint[]; onPick: (month: string) => void }) {
  const [on, setOn] = useState<string[]>(['approved', 'committed', 'realized', 'paid', 'projection']);
  const [period, setPeriod] = useState<keyof typeof PERIODS>('mensal');
  const [acc, setAcc] = useState(false);
  const n = PERIODS[period];
  const buckets = useMemo(() => {
    const out: { label: string; months: string[] }[] = [];
    series.forEach((p, i) => { if (i % n === 0) out.push({ label: n === 1 ? monthShort(p.month) : n === 12 ? p.month.slice(0, 4) : `${monthShort(p.month)}–${monthShort(series[Math.min(i + n - 1, series.length - 1)]!.month)}`, months: [] }); out.at(-1)!.months.push(p.month); });
    return out;
  }, [series, n]);
  const values = (k: string) => {
    const v = buckets.map((b) => b.months.reduce((t, m) => t + Number(series.find((p) => p.month === m)?.[k as keyof SeriesPoint] ?? 0), 0));
    return acc ? v.reduce<number[]>((a, x) => [...a, (a.at(-1) ?? 0) + x], []) : v;
  };
  const realized = values('realized'), approved = values('approved');
  const last = realized.length - 1, prev = realized[last - 1] ?? 0, cur = realized[last] ?? 0;
  const total = realized.reduce((t, x) => t + x, 0);
  return (
    <section aria-label="Evolução orçamentária" className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base font-bold text-ink">Evolução orçamentária</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Periodicidade" className="w-36" value={period} onChange={(e) => setPeriod(e.target.value as keyof typeof PERIODS)}>{Object.keys(PERIODS).map((p) => <option key={p} value={p}>{p[0]!.toUpperCase() + p.slice(1)}</option>)}</Select>
          <label className="flex items-center gap-1.5 text-sm text-text"><input type="checkbox" checked={acc} onChange={(e) => setAcc(e.target.checked)} /> Acumulado</label>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Séries">
        {SERIES.map((s) => (
          <button key={s.key} type="button" aria-pressed={on.includes(s.key)} onClick={() => setOn(on.includes(s.key) ? on.filter((x) => x !== s.key) : [...on, s.key])}
            className={clsx('inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold', on.includes(s.key) ? 'border-line-strong bg-surface text-ink' : 'border-line bg-surface-2 text-faint line-through')}>
            <span className="h-2.5 w-2.5" style={{ background: s.color }} />{s.label}
          </button>
        ))}
      </div>
      {series.every((p) => !p.approved && !p.committed && !p.realized && !p.paid && !p.projection && !p.original) ? <p className="py-10 text-center text-sm text-muted">Ainda não há valores aprovados, comprometidos, realizados ou pagos neste período.</p> : <LineChart categories={buckets.map((b) => b.label)} series={SERIES.filter((s) => on.includes(s.key)).map((s) => ({ key: s.key, label: s.label, color: s.color, dashed: 'dashed' in s ? s.dashed : undefined, values: values(s.key) }))}
        format={(v) => fmtBRL(Math.round(v))} ariaLabel="Evolução do orçamento por período" tooltipTitle={(i) => buckets[i]!.label} onPick={n === 1 ? (i) => onPick(buckets[i]!.months[0]!) : undefined} height={230} />}
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted">Variação do último período</dt><dd className="num font-semibold text-ink">{fmtBRL(cur - prev)} {prev ? `(${(((cur - prev) / prev) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : ''}</dd></div>
        <div><dt className="text-xs text-muted">Média do realizado por período</dt><dd className="num font-semibold text-ink">{fmtBRL(Math.round(total / Math.max(1, realized.filter((x) => x).length)))}</dd></div>
        <div><dt className="text-xs text-muted">Desvio (realizado − aprovado)</dt><dd className="num font-semibold text-ink">{fmtBRL(total - approved.reduce((t, x) => t + x, 0))}</dd></div>
        <div><dt className="text-xs text-muted">Tendência</dt><dd className="font-semibold text-ink">{cur > prev ? 'Aumento de custo' : cur < prev ? 'Redução de custo (confira se não é só adiamento de pagamento)' : 'Estável'}</dd></div>
      </dl>
      {n === 1 && <p className="mt-2 text-xs text-faint">Clique num mês para ver na tabela os lançamentos que formam aquele valor.</p>}
    </section>
  );
}

// ------------------------------------------------------------------ tabela em DRE
function BudgetTable({ d, st, cols, setCols, selected, setSelected, onOpen, onCreate, onBatch }: {
  d: CentralData; st: Structure; cols: ColKey[]; setCols: (c: ColKey[]) => void; selected: string[]; setSelected: (s: string[]) => void;
  onOpen: (id: string, tab: PanelTab) => void; onCreate: () => void; onBatch: () => void;
}) {
  const [closed, setClosed] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const accById = new Map(d.accounts.map((a) => [a.id, a]));
  const ccById = new Map(d.options.costCenters.map((c) => [c.id, c]));
  const ancestors = (id: string) => { const out: string[] = []; let a = accById.get(id); while (a?.parentId) { out.unshift(a.parentId); a = accById.get(a.parentId); } return out; };
  // grupos: cada conta-mãe com subtotal; lançamentos ficam sob a subconta
  const groups = useMemo(() => {
    const used = new Set<string>();
    for (const r of d.rows) { used.add(r.accountId); ancestors(r.accountId).forEach((x) => used.add(x)); }
    return d.accounts.filter((a) => used.has(a.id));
  }, [d.rows, d.accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowsOf = (accId: string) => d.rows.filter((r) => r.accountId === accId || ancestors(r.accountId).includes(accId));
  const hidden = (accId: string) => ancestors(accId).some((x) => closed.includes(x));
  const sum = (rs: Row[], k: keyof Figures) => rs.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const show = (c: ColKey) => cols.includes(c);
  const visibleCols = COLS.filter((c) => show(c.key));
  const decidable = d.rows.filter((r) => r.canDecide);
  const csv = () => {
    const head = ['Código', 'Descrição', ...visibleCols.map((c) => c.label)];
    const val = (r: Row, c: ColKey) => ({ conta: accById.get(r.accountId)?.code ?? '', centro: ccById.get(r.costCenterId)?.code ?? '', responsavel: r.owner ?? '', competencia: r.month, quantidade: r.qty, unitario: money(r.unitCents), planejado: money(r.planned), aprovado: money(r.approved), comprometido: money(r.committed), realizado: money(r.realized), pago: money(r.paid), saldo: money(r.balance), desvio: money(r.deviation), aprovacao: APPROVAL_STATE_LABELS[r.approvalState], execucao: EXECUTION_STATE_LABELS[r.executionState], financeiro: PAYMENT_FLAG_LABELS[r.financial] })[c];
    const lines = [head, ...d.rows.map((r) => [r.code ?? '', r.what, ...visibleCols.map((c) => val(r, c.key))])].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
    a.download = `orcamento-${d.period.from}-a-${d.period.to}.csv`;
    a.click();
  };
  const cell = (r: Row, c: ColKey): ReactNode => {
    const btn = (v: ReactNode, tab: PanelTab, label: string) => <button type="button" className="num w-full text-right hover:text-primary hover:underline" aria-label={`${label} de ${r.code}`} onClick={() => onOpen(r.id, tab)}>{v}</button>;
    switch (c) {
      case 'conta': return accById.get(r.accountId)?.code;
      case 'centro': return ccById.get(r.costCenterId)?.code;
      case 'responsavel': return r.owner ?? '—';
      case 'competencia': return monthLabel(r.month);
      case 'quantidade': return `${r.qty} ${r.unit}`;
      case 'unitario': return fmtBRL(r.unitCents ?? 0);
      case 'planejado': return btn(fmtBRL(r.planned), 'planejamento', 'Planejado');
      case 'aprovado': return btn(r.approved ? fmtBRL(r.approved) : '—', 'aprovacao', 'Aprovado');
      case 'comprometido': return btn(r.committed ? fmtBRL(r.committed) : '—', 'execucao', 'Comprometido');
      case 'realizado': return btn(r.realized ? fmtBRL(r.realized) : '—', 'execucao', 'Realizado');
      case 'pago': return btn(r.paid ? fmtBRL(r.paid) : '—', 'financeiro', 'Pago');
      case 'saldo': return <span className={clsx('num', r.balance < 0 && 'font-semibold text-danger')}>{r.approved ? fmtBRL(r.balance) : '—'}</span>;
      case 'desvio': return btn(r.deviation === null ? '—' : <span className={clsx(r.deviation > 0 && 'text-danger')}>{fmtBRL(r.deviation)}{r.deviationPct !== null ? ` (${r.deviationPct.toLocaleString('pt-BR')}%)` : ''}</span>, 'resultado', 'Desvio');
      case 'aprovacao': return <button type="button" onClick={() => onOpen(r.id, 'aprovacao')}><Chip tone={APPROVAL_TONE[r.approvalState]}>{APPROVAL_STATE_LABELS[r.approvalState]}{r.openQuestions ? ` · ${r.openQuestions}?` : ''}</Chip></button>;
      case 'execucao': return <Chip tone="neutral">{EXECUTION_STATE_LABELS[r.executionState]}</Chip>;
      case 'financeiro': return <button type="button" onClick={() => onOpen(r.id, 'financeiro')}><Chip tone={FIN_TONE(r.financial)}>{PAYMENT_FLAG_LABELS[r.financial]}</Chip></button>;
    }
  };
  const subtotal = (rs: Row[], c: ColKey) => {
    const m: Partial<Record<ColKey, keyof Figures>> = { planejado: 'planned', aprovado: 'approved', comprometido: 'committed', realizado: 'realized', pago: 'paid', saldo: 'balance' };
    const k = m[c];
    return k ? <span className="num">{fmtBRL(sum(rs, k))}</span> : null;
  };
  const canCreate = d.centers.some((c) => c.canPlan) && st.accounts.some((a) => a.leaf && a.active);
  return (
    <section aria-label="Lançamentos do orçamento" className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="font-display text-base font-bold text-ink">Lançamentos <span className="text-sm font-normal text-muted">({d.rows.length})</span></h2>
        <div className="relative flex flex-wrap gap-2">
          {decidable.length > 0 && <Button size="sm" variant="outline" disabled={!selected.length} onClick={onBatch}>Decidir selecionados ({selected.length})</Button>}
          <Button size="sm" variant="secondary" icon={<Columns3 className="h-4 w-4" />} aria-expanded={picker} onClick={() => setPicker(!picker)}>Colunas</Button>
          <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={csv}>Exportar</Button>
          {canCreate && <Button size="sm" variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onCreate}>Novo lançamento</Button>}
          {picker && (
            <div className="absolute right-0 top-10 z-20 grid w-64 gap-1 border border-line bg-surface p-3 shadow-overlay" role="group" aria-label="Colunas visíveis">
              {COLS.map((c) => <label key={c.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={show(c.key)} onChange={(e) => setCols(e.target.checked ? [...cols, c.key] : cols.filter((x) => x !== c.key))} /> {c.label}</label>)}
            </div>
          )}
        </div>
      </div>
      {!d.rows.length ? <EmptyState title="Nenhum lançamento neste recorte" description={canCreate ? 'Crie o primeiro lançamento do período ou mude os filtros.' : 'Você ainda não planeja em nenhum centro de custo; mude os filtros para ver o que tem acesso.'} /> : (
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2 text-left text-xs text-muted">
              <tr>
                <th className="sticky left-0 z-10 w-8 bg-surface-2 px-2 py-2">{decidable.length > 0 && <input type="checkbox" aria-label="Selecionar todos os que posso decidir" checked={selected.length === decidable.length} onChange={(e) => setSelected(e.target.checked ? decidable.map((r) => r.id) : [])} />}</th>
                <th className="sticky left-8 z-10 min-w-[280px] bg-surface-2 px-3 py-2 font-medium">Código e descrição</th>
                {visibleCols.map((c) => <th key={c.key} className={clsx('whitespace-nowrap px-3 py-2 font-medium', c.num && 'text-right')}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {groups.map((a) => {
                if (hidden(a.id)) return null;
                const rs = rowsOf(a.id);
                const isClosed = closed.includes(a.id);
                return (
                  <Fragment key={a.id}>
                    <tr className={clsx('border-t border-line', a.level === 1 ? 'bg-navy/[0.06] font-bold text-ink' : 'bg-surface-2/60 font-semibold text-ink')}>
                      <td className="sticky left-0 bg-inherit px-2 py-1.5" />
                      <td className="sticky left-8 bg-inherit px-3 py-1.5" style={{ paddingLeft: 12 + (a.level - 1) * 14 }}>
                        <button type="button" className="inline-flex items-center gap-1" aria-expanded={!isClosed} onClick={() => setClosed(isClosed ? closed.filter((x) => x !== a.id) : [...closed, a.id])}>
                          {isClosed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}{a.code} {a.name}
                        </button>
                      </td>
                      {visibleCols.map((c) => <td key={c.key} className="px-3 py-1.5 text-right">{subtotal(rs, c.key)}</td>)}
                    </tr>
                    {a.leaf && !isClosed && d.rows.filter((r) => r.accountId === a.id).map((r) => (
                      <tr key={r.id} className="border-t border-line hover:bg-primary-soft/40">
                        <td className="sticky left-0 bg-surface px-2 py-1.5">{r.canDecide && <input type="checkbox" aria-label={`Selecionar ${r.code}`} checked={selected.includes(r.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))} />}</td>
                        <td className="sticky left-8 bg-surface px-3 py-1.5" style={{ paddingLeft: 12 + a.level * 14 }}>
                          <button type="button" className="text-left hover:text-primary" onClick={() => onOpen(r.id, 'planejamento')}><span className="mr-2 text-xs text-muted">{r.code}</span><span className="text-ink">{r.what}</span></button>
                        </td>
                        {visibleCols.map((c) => <td key={c.key} className={clsx('whitespace-nowrap px-3 py-1.5', c.num && 'text-right')}>{cell(r, c.key)}</td>)}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ novo lançamento
function NewLine({ st, d, year, onClose, onCreated }: { st: Structure; d: CentralData; year: number; onClose: () => void; onCreated: (id: string) => void }) {
  const ccs = d.centers.filter((c) => c.canPlan);
  const m = new Date().getFullYear() === year ? `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}` : `${year}-01`;
  const [v, setV] = useState({ costCenterId: ccs[0]?.id ?? '', accountId: '', what: '', justification: '', objective: '', qty: '1', unit: 'un', unitPrice: '', month: m, plannedOn: '', priority: 'media', expenseType: 'pontual', recurrenceMonths: '1', ownerId: '', projectId: '', campaignId: '', supplierId: '' });
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const qc = useQueryClient();
  const toast = useToast();
  const unit = toCents(v.unitPrice);
  const qn = Number(v.qty.replace(',', '.'));
  const total = unit && qn > 0 ? Math.round(qn * unit) : null;
  const save = useMutation({
    mutationFn: () => api<{ items: { id: string; code: string }[] }>('/budget/central/lines', { method: 'POST', body: { costCenterId: v.costCenterId, accountId: v.accountId, what: v.what, justification: v.justification || null, objective: v.objective || null, qty: v.qty, unit: v.unit, unitCents: unit, month: v.month, plannedOn: v.plannedOn || null, priority: v.priority, expenseType: v.expenseType, recurrenceMonths: Number(v.recurrenceMonths), ownerId: v.ownerId || null, projectId: v.projectId || null, campaignId: v.campaignId || null, supplierId: v.supplierId || null } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['budget'] }); toast({ tone: 'success', message: r.items.length > 1 ? `${r.items.length} lançamentos criados` : `Lançamento ${r.items[0]!.code} criado` }); onCreated(r.items[0]!.id); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} size="lg" title="Novo lançamento" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={!v.costCenterId || !v.accountId || v.what.trim().length < 3 || !unit} onClick={() => save.mutate()}>Criar lançamento</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Centro de custos" htmlFor="nl-cc" required><Select id="nl-cc" value={v.costCenterId} onChange={(e) => set({ costCenterId: e.target.value })}>{ccs.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select></FormField>
        <FormField label="Conta e subconta" htmlFor="nl-acc" required><AccountSelect id="nl-acc" value={v.accountId} onChange={(x) => set({ accountId: x })} accounts={st.accounts} /></FormField>
        <FormField label="Descrição" htmlFor="nl-what" required className="sm:col-span-2"><Input id="nl-what" value={v.what} onChange={(e) => set({ what: e.target.value })} placeholder="Ex.: Brindes para o evento de clientes" /></FormField>
        <FormField label="Justificativa" htmlFor="nl-just" hint="Obrigatória para enviar à aprovação" className="sm:col-span-2"><Textarea id="nl-just" rows={2} value={v.justification} onChange={(e) => set({ justification: e.target.value })} /></FormField>
        <FormField label="Objetivo da despesa" htmlFor="nl-obj" className="sm:col-span-2"><Input id="nl-obj" value={v.objective} onChange={(e) => set({ objective: e.target.value })} /></FormField>
        <FormField label="Quantidade" htmlFor="nl-qty"><Input id="nl-qty" inputMode="decimal" value={v.qty} onChange={(e) => set({ qty: e.target.value })} /></FormField>
        <FormField label="Unidade" htmlFor="nl-un"><Select id="nl-un" value={v.unit} onChange={(e) => set({ unit: e.target.value })}>{BUDGET_UNITS.map((u) => <option key={u} value={u}>{BUDGET_UNIT_LABELS[u]}</option>)}</Select></FormField>
        <FormField label="Valor unitário (R$)" htmlFor="nl-unit" required><Input id="nl-unit" inputMode="decimal" value={v.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} placeholder="0,00" /></FormField>
        <FormField label="Total calculado" htmlFor="nl-total"><Input id="nl-total" readOnly value={total ? fmtBRL(total) : '—'} /></FormField>
        <FormField label="Competência" htmlFor="nl-month"><Input id="nl-month" type="month" value={v.month} onChange={(e) => set({ month: e.target.value })} /></FormField>
        <FormField label="Data prevista" htmlFor="nl-date"><Input id="nl-date" type="date" value={v.plannedOn} onChange={(e) => set({ plannedOn: e.target.value })} /></FormField>
        <FormField label="Prioridade" htmlFor="nl-pri"><Select id="nl-pri" value={v.priority} onChange={(e) => set({ priority: e.target.value })}>{BUDGET_PRIORITIES.map((p) => <option key={p} value={p}>{{ alta: 'Alta', media: 'Média', baixa: 'Baixa' }[p]}</option>)}</Select></FormField>
        <FormField label="Tipo de despesa" htmlFor="nl-type"><Select id="nl-type" value={v.expenseType} onChange={(e) => set({ expenseType: e.target.value })}>{EXPENSE_TYPES.map((p) => <option key={p} value={p}>{EXPENSE_TYPE_LABELS[p]}</option>)}</Select></FormField>
        <FormField label="Repetir por quantos meses" htmlFor="nl-rec" hint="Recorrente: um lançamento por mês"><Input id="nl-rec" type="number" min={1} max={24} value={v.recurrenceMonths} onChange={(e) => set({ recurrenceMonths: e.target.value })} /></FormField>
        <FormField label="Responsável" htmlFor="nl-own"><Select id="nl-own" value={v.ownerId} onChange={(e) => set({ ownerId: e.target.value })}><option value="">Eu</option>{d.options.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Projeto" htmlFor="nl-prj"><Select id="nl-prj" value={v.projectId} onChange={(e) => set({ projectId: e.target.value })}><option value="">Nenhum</option>{d.options.projects.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Campanha" htmlFor="nl-cmp"><Select id="nl-cmp" value={v.campaignId} onChange={(e) => set({ campaignId: e.target.value })}><option value="">Nenhuma</option>{d.options.campaigns.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Fornecedor previsto" htmlFor="nl-sup"><Select id="nl-sup" value={v.supplierId} onChange={(e) => set({ supplierId: e.target.value })}><option value="">A definir</option>{d.options.suppliers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ aprovação em lote
function BatchDecision({ rows, onClose, onDone }: { rows: Row[]; onClose: () => void; onDone: () => void }) {
  const [items, setItems] = useState(rows.map((r) => ({ lineId: r.id, decision: 'aprovar' as BudgetDecision, note: '' })));
  const [result, setResult] = useState<{ decided: { code: string | null; state: string }[]; blocked: { code: string | null; reason: string }[] } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => api<NonNullable<typeof result>>('/budget/decisions', { method: 'POST', body: { items: items.map((i) => ({ lineId: i.lineId, decision: i.decision, note: i.note || null })) } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['budget'] }); setResult(r); if (!r.blocked.length) { toast({ tone: 'success', message: `${r.decided.length} decisão(ões) registrada(s)` }); onDone(); } },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Modal open onClose={onClose} size="lg" title={`Decidir ${rows.length} lançamento(s)`} footer={<><Button variant="ghost" onClick={result ? onDone : onClose}>{result ? 'Fechar' : 'Cancelar'}</Button>{!result && <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Registrar decisões</Button>}</>}>
      <p className="mb-3 text-sm text-muted">Cada lançamento recebe a sua própria decisão, registrada no histórico dele. Os que têm questionamento obrigatório sem resposta ficam de fora. Para aprovar parcialmente ou com valor-alvo e valor-limite, abra o lançamento.</p>
      {result?.blocked.length ? <Notice tone="warning">Não decididos: {result.blocked.map((b) => `${b.code} (${b.reason})`).join('; ')}</Notice> : null}
      <ul className="divide-y divide-line">
        {rows.map((r, i) => (
          <li key={r.id} className="grid gap-2 py-2 sm:grid-cols-[1fr_200px]">
            <div><p className="text-sm text-ink"><span className="text-xs text-muted">{r.code}</span> {r.what}</p><p className="num text-xs text-muted">{fmtBRL(r.planned)} · {APPROVAL_STATE_LABELS[r.approvalState]}{r.openQuestions ? ' · questionamento aberto' : ''}</p></div>
            <Select aria-label={`Decisão de ${r.code}`} value={items[i]!.decision} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, decision: e.target.value as BudgetDecision } : x)))}>
              {(['aprovar', 'rejeitar', 'revisao'] as BudgetDecision[]).map((x) => <option key={x} value={x}>{BUDGET_DECISION_LABELS[x]}</option>)}
            </Select>
            {items[i]!.decision !== 'aprovar' && <Input className="sm:col-span-2" aria-label={`Motivo para ${r.code}`} placeholder="Motivo (obrigatório)" value={items[i]!.note} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ------------------------------------------------------------------ painel do lançamento
type Panel = {
  line: Record<string, unknown> & { id: string; code: string; what: string; how: string | null; justification: string | null; objective: string | null; accountId: string; month: string; plannedOn: string | null; qty: string; unit: string; unitCents: number | null; amountCents: number; priority: string; expenseType: string; ownerId: string | null; owner: string | null; projectId: string | null; campaignId: string | null; supplierId: string | null; approvalState: ApprovalState; approvalStage: string | null; executionState: ExecutionState; approvedCents: number | null; approvedQty: string | null; limitCents: number | null; targetUnitCents: number | null; conditions: string | null; decisionNote: string | null; decidedByName: string | null; decidedAt: string | null; quoteCents: number | null; negotiatedCents: number | null; contractedCents: number | null; contractedQty: string | null; contractedOn: string | null; poNumber: string | null; deliveredQty: string | null; deliveredOn: string | null; rowVersion: number; createdByName: string | null };
  costCenter: { code: string; name: string }; figures: Figures; financial: PaymentFlag; ceilingCents: number | null;
  questions: { id: string; kind: string; message: string; blocking: boolean; status: 'aberto' | 'respondido' | 'resolvido'; answer: string | null; askedByName: string | null; toUserName: string | null; answeredByName: string | null; createdAt: string; answeredAt: string | null }[];
  events: { id: string; action: string; summary: string; data: { changes?: { field: string; before: unknown; after: unknown }[]; reason?: string | null } | null; at: string; actor: string | null }[];
  documents: { id: string; kind: string; name: string; size: number; at: string }[];
  expenses: { id: string; occurredOn: string; description: string; amountCents: number; status: string }[];
  adjustments: { id: string; deltaCents: number; justification: string; status: string; requestedByName: string | null; decidedByName: string | null; decisionNote: string | null; fromReserve: string | null; createdAt: string }[];
  payables: { id: string; invoiceNumber: string | null; installment: number; installments: number; amountCents: number; competence: string; dueOn: string; flags: PaymentFlag[]; paidCents: number; openCents: number; payments: { id: string; kind: string; paidOn: string; amountCents: number; interestCents: number; fineCents: number; discountCents: number; method: string | null; reason: string | null; reconciledAt: string | null; reversed: boolean; createdByName: string | null }[] }[];
  can: { edit: boolean; submit: boolean; decide: boolean; ask: boolean; answer: boolean; execute: boolean; finance: boolean; guardian: boolean; decideGuardian: boolean };
};

function LinePanel({ id, tab, onTab, onClose, st, options }: { id: string; tab: PanelTab; onTab: (t: PanelTab) => void; onClose: () => void; st: Structure; options: CentralData['options'] }) {
  const q = useQuery({ queryKey: ['budget', 'line', id], queryFn: () => api<Panel>(`/budget/lines/${id}`) });
  const p = q.data;
  return (
    <Drawer open onClose={onClose} width="lg" title={p ? `${p.line.code} · ${p.line.what}` : 'Lançamento'}>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Chip tone={APPROVAL_TONE[p!.line.approvalState]}>{APPROVAL_STATE_LABELS[p!.line.approvalState]}</Chip>
            <Chip tone="neutral">{EXECUTION_STATE_LABELS[p!.line.executionState]}</Chip>
            <Chip tone={FIN_TONE(p!.financial)}>{PAYMENT_FLAG_LABELS[p!.financial]}</Chip>
            <span className="text-muted">{p!.costCenter.code} · {p!.costCenter.name}</span>
          </div>
          <Tabs<PanelTab> label="Seções do lançamento" value={tab} onChange={onTab} tabs={[
            { key: 'planejamento', label: 'Planejamento' }, { key: 'aprovacao', label: 'Aprovação', count: p!.questions.filter((x) => x.status === 'aberto').length || undefined }, { key: 'execucao', label: 'Execução' },
            { key: 'financeiro', label: 'Financeiro' }, { key: 'auditoria', label: 'Auditoria' }, { key: 'resultado', label: 'Resultado' },
          ]} />
          {tab === 'planejamento' && <PlanningTab p={p!} st={st} options={options} />}
          {tab === 'aprovacao' && <ApprovalTab p={p!} />}
          {tab === 'execucao' && <ExecutionTab p={p!} options={options} />}
          {tab === 'financeiro' && <FinanceTab p={p!} />}
          {tab === 'auditoria' && <AuditTab p={p!} />}
          {tab === 'resultado' && <ResultTab p={p!} />}
        </div>
      )}
    </Drawer>
  );
}

function useLineAction<T = unknown>(id: string, done: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: unknown }) => api<T>(path, { method, body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['budget'] }); toast({ tone: 'success', message: done }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
}
const Field = ({ label, children }: { label: string; children: ReactNode }) => <div><dt className="text-xs text-muted">{label}</dt><dd className="text-sm text-ink">{children ?? '—'}</dd></div>;

function PlanningTab({ p, st, options }: { p: Panel; st: Structure; options: CentralData['options'] }) {
  const l = p.line;
  const [v, setV] = useState({ what: l.what, justification: l.justification ?? '', objective: l.objective ?? '', accountId: l.accountId, qty: l.qty, unit: l.unit, unitPrice: money(l.unitCents ?? l.amountCents), month: l.month, plannedOn: l.plannedOn ?? '', priority: l.priority, expenseType: l.expenseType, projectId: l.projectId ?? '', campaignId: l.campaignId ?? '', supplierId: l.supplierId ?? '' });
  const set = (x: Partial<typeof v>) => setV((o) => ({ ...o, ...x }));
  const save = useLineAction(l.id, 'Planejamento salvo');
  const submit = useLineAction(l.id, 'Enviado para aprovação');
  const doc = useLineAction(l.id, 'Documento anexado');
  const ro = !p.can.edit;
  return (
    <div className="space-y-4">
      {ro && <Notice>O planejamento só muda em rascunho, planejado, em revisão ou rejeitado. Depois de aprovado, valor adicional vai pelo Budget Guardião (aba Aprovação).</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Descrição" htmlFor="pl-what" className="sm:col-span-2"><Input id="pl-what" disabled={ro} value={v.what} onChange={(e) => set({ what: e.target.value })} /></FormField>
        <FormField label="Justificativa" htmlFor="pl-just" className="sm:col-span-2"><Textarea id="pl-just" rows={2} disabled={ro} value={v.justification} onChange={(e) => set({ justification: e.target.value })} /></FormField>
        <FormField label="Objetivo da despesa" htmlFor="pl-obj" className="sm:col-span-2"><Input id="pl-obj" disabled={ro} value={v.objective} onChange={(e) => set({ objective: e.target.value })} /></FormField>
        <FormField label="Conta e subconta" htmlFor="pl-acc"><AccountSelect id="pl-acc" value={v.accountId} onChange={(x) => set({ accountId: x })} accounts={st.accounts} /></FormField>
        <FormField label="Competência" htmlFor="pl-m"><Input id="pl-m" type="month" disabled={ro} value={v.month} onChange={(e) => set({ month: e.target.value })} /></FormField>
        <FormField label="Quantidade" htmlFor="pl-q"><Input id="pl-q" disabled={ro} value={v.qty} onChange={(e) => set({ qty: e.target.value })} /></FormField>
        <FormField label="Unidade" htmlFor="pl-u"><Select id="pl-u" disabled={ro} value={v.unit} onChange={(e) => set({ unit: e.target.value })}>{BUDGET_UNITS.map((u) => <option key={u} value={u}>{BUDGET_UNIT_LABELS[u]}</option>)}</Select></FormField>
        <FormField label="Valor unitário (R$)" htmlFor="pl-up"><Input id="pl-up" disabled={ro} value={v.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} /></FormField>
        <FormField label="Total" htmlFor="pl-t"><Input id="pl-t" readOnly value={fmtBRL(l.amountCents)} /></FormField>
        <FormField label="Data prevista" htmlFor="pl-d"><Input id="pl-d" type="date" disabled={ro} value={v.plannedOn} onChange={(e) => set({ plannedOn: e.target.value })} /></FormField>
        <FormField label="Prioridade" htmlFor="pl-p"><Select id="pl-p" disabled={ro} value={v.priority} onChange={(e) => set({ priority: e.target.value })}>{BUDGET_PRIORITIES.map((x) => <option key={x} value={x}>{{ alta: 'Alta', media: 'Média', baixa: 'Baixa' }[x]}</option>)}</Select></FormField>
        <FormField label="Tipo de despesa" htmlFor="pl-e"><Select id="pl-e" disabled={ro} value={v.expenseType} onChange={(e) => set({ expenseType: e.target.value })}>{EXPENSE_TYPES.map((x) => <option key={x} value={x}>{EXPENSE_TYPE_LABELS[x]}</option>)}</Select></FormField>
        <FormField label="Projeto" htmlFor="pl-pr"><Select id="pl-pr" disabled={ro} value={v.projectId} onChange={(e) => set({ projectId: e.target.value })}><option value="">Nenhum</option>{options.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
        <FormField label="Campanha" htmlFor="pl-c"><Select id="pl-c" disabled={ro} value={v.campaignId} onChange={(e) => set({ campaignId: e.target.value })}><option value="">Nenhuma</option>{options.campaigns.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3"><Field label="Responsável">{l.owner}</Field><Field label="Criado por">{l.createdByName}</Field><Field label="Código">{l.code}</Field></dl>
      <div className="flex flex-wrap gap-2">
        {p.can.edit && <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate({ path: `/budget/lines/${l.id}`, method: 'PATCH', body: { rowVersion: l.rowVersion, what: v.what, justification: v.justification || null, objective: v.objective || null, accountId: v.accountId, qty: v.qty, unit: v.unit, unitCents: toCents(v.unitPrice) ?? undefined, month: v.month, plannedOn: v.plannedOn || null, priority: v.priority, expenseType: v.expenseType, projectId: v.projectId || null, campaignId: v.campaignId || null, supplierId: v.supplierId || null } })}>Salvar planejamento</Button>}
        {p.can.submit && <Button variant="primary" loading={submit.isPending} onClick={() => submit.mutate({ path: `/budget/lines/${l.id}/submit`, body: {} })}>Enviar para aprovação</Button>}
      </div>
      <Documents p={p} kinds={['anexo']} onUpload={(kind, file) => doc.mutate({ path: `/budget/lines/${l.id}/documents`, body: { kind, doc: file } })} canUpload={p.can.edit || p.can.execute} />
    </div>
  );
}

function Documents({ p, kinds, onUpload, canUpload }: { p: Panel; kinds: string[]; onUpload: (kind: string, file: { name: string; data: string }) => void; canUpload: boolean }) {
  const [kind, setKind] = useState(kinds[0]!);
  const LABEL: Record<string, string> = { anexo: 'Anexo', cotacao: 'Cotação', pedido: 'Pedido de compra', nota_fiscal: 'Nota fiscal', entrega: 'Comprovação de entrega', comprovante: 'Comprovante', outro: 'Outro' };
  const docs = p.documents.filter((x) => kinds.includes(x.kind));
  return (
    <section aria-label="Documentos" className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">Documentos</h3>
      {docs.length ? <ul className="space-y-1 text-sm">{docs.map((x) => <li key={x.id}><a className="text-primary hover:underline" href={`/api/v1/budget/documents/${x.id}`}>{LABEL[x.kind]}: {x.name}</a> <span className="text-xs text-muted">{fmtDateTime(x.at)}</span></li>)}</ul> : <p className="text-sm text-muted">Nenhum documento.</p>}
      {canUpload && (
        <div className="flex flex-wrap items-end gap-2">
          {kinds.length > 1 && <Select aria-label="Tipo de documento" className="w-48" value={kind} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}</Select>}
          <label className="inline-flex cursor-pointer items-center gap-2 border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-2">
            <FileUp className="h-4 w-4" aria-hidden /> Anexar PDF, PNG ou JPG
            <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onUpload(kind, { name: f.name, data: await fileToBase64(f) }); e.target.value = ''; }} />
          </label>
        </div>
      )}
    </section>
  );
}

function ApprovalTab({ p }: { p: Panel }) {
  const l = p.line;
  const act = useLineAction(l.id, 'Registrado');
  const [ask, setAsk] = useState({ kind: 'valor_unitario', message: '', blocking: true });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dec, setDec] = useState({ decision: 'aprovar' as BudgetDecision, approvedQty: l.qty, approved: money(l.amountCents), target: '', limit: '', conditions: '', note: '' });
  const [g, setG] = useState({ delta: '', justification: '' });
  const [gNote, setGNote] = useState<Record<string, string>>({});
  const approving = dec.decision === 'aprovar' || dec.decision === 'aprovar_parcial' || dec.decision === 'aprovar_condicoes';
  return (
    <div className="space-y-5">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Field label="Valor solicitado">{fmtBRL(l.amountCents)}</Field><Field label="Quantidade solicitada">{l.qty} {l.unit}</Field><Field label="Valor unitário solicitado">{fmtBRL(l.unitCents ?? 0)}</Field>
        <Field label="Valor total aprovado">{l.approvedCents !== null ? fmtBRL(l.approvedCents) : '—'}</Field><Field label="Quantidade aprovada">{l.approvedQty}</Field><Field label="Valor-limite autorizado">{l.limitCents !== null ? fmtBRL(l.limitCents) : '—'}</Field>
        <Field label="Valor-alvo (unitário)">{l.targetUnitCents !== null ? fmtBRL(l.targetUnitCents) : '—'}</Field><Field label="Decisão">{l.decidedByName ? `${l.decidedByName}, ${fmtDateTime(l.decidedAt)}` : '—'}</Field><Field label="Com quem está">{l.approvalStage === 'gerencia' ? 'Gerência' : l.approvalStage === 'diretoria' ? 'Diretoria' : '—'}</Field>
      </dl>
      {l.conditions && <Notice>Condições da aprovação: {l.conditions}</Notice>}
      {l.decisionNote && <p className="text-sm text-text">Observação: {l.decisionNote}</p>}
      <section aria-label="Questionamentos" className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Perguntas e respostas</h3>
        {!p.questions.length && <p className="text-sm text-muted">Nenhum questionamento.</p>}
        {p.questions.map((x) => (
          <div key={x.id} className="border border-line p-3 text-sm">
            <p className="text-xs text-muted">{QUESTION_KIND_LABELS[x.kind as keyof typeof QUESTION_KIND_LABELS]} · {x.askedByName} para {x.toUserName ?? 'o responsável'} · {fmtDateTime(x.createdAt)} · {x.status === 'aberto' ? (x.blocking ? 'aguardando resposta (trava a aprovação)' : 'aguardando resposta') : x.status === 'respondido' ? 'respondido' : 'resolvido'}</p>
            <p className="mt-1 text-ink">{x.message}</p>
            {x.answer && <p className="mt-2 border-l-2 border-primary pl-3 text-text">{x.answer} <span className="text-xs text-muted">— {x.answeredByName}, {fmtDateTime(x.answeredAt)}</span></p>}
            {x.status === 'aberto' && p.can.answer && (
              <div className="mt-2 flex gap-2"><Input aria-label="Sua resposta" value={answers[x.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [x.id]: e.target.value })} placeholder="Responder" /><Button size="sm" variant="primary" disabled={(answers[x.id] ?? '').trim().length < 3} onClick={() => act.mutate({ path: `/budget/questions/${x.id}/answer`, body: { answer: answers[x.id] } })}>Responder</Button></div>
            )}
            {x.status === 'respondido' && p.can.ask && <Button size="sm" variant="ghost" className="mt-1" onClick={() => act.mutate({ path: `/budget/questions/${x.id}/resolve` })}>Dar por resolvido</Button>}
          </div>
        ))}
        {p.can.ask && (
          <div className="grid gap-2 border border-dashed border-line p-3 sm:grid-cols-[180px_1fr]">
            <Select aria-label="Assunto do questionamento" value={ask.kind} onChange={(e) => setAsk({ ...ask, kind: e.target.value })}>{QUESTION_KINDS.map((k) => <option key={k} value={k}>{QUESTION_KIND_LABELS[k]}</option>)}</Select>
            <Input aria-label="Pergunta" placeholder="Pergunte ao responsável" value={ask.message} onChange={(e) => setAsk({ ...ask, message: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ask.blocking} onChange={(e) => setAsk({ ...ask, blocking: e.target.checked })} /> Travar a aprovação até responder</label>
            <Button size="sm" variant="secondary" disabled={ask.message.trim().length < 5} onClick={() => { act.mutate({ path: '/budget/questions', body: { lineId: l.id, kind: ask.kind, message: ask.message, blocking: ask.blocking } }); setAsk({ ...ask, message: '' }); }}>Questionar</Button>
          </div>
        )}
      </section>
      {p.can.decide && (
        <section aria-label="Decisão" className="space-y-3 border border-line p-3">
          <h3 className="text-sm font-semibold text-ink">Decidir</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Decisão" htmlFor="dc-d" className="sm:col-span-2"><Select id="dc-d" value={dec.decision} onChange={(e) => setDec({ ...dec, decision: e.target.value as BudgetDecision })}>{BUDGET_DECISIONS.map((x) => <option key={x} value={x}>{BUDGET_DECISION_LABELS[x]}</option>)}</Select></FormField>
            {approving && <>
              <FormField label="Quantidade aprovada" htmlFor="dc-q"><Input id="dc-q" value={dec.approvedQty} onChange={(e) => setDec({ ...dec, approvedQty: e.target.value })} /></FormField>
              <FormField label="Valor total aprovado (R$)" htmlFor="dc-a"><Input id="dc-a" value={dec.approved} onChange={(e) => setDec({ ...dec, approved: e.target.value })} /></FormField>
              <FormField label="Valor-alvo unitário (R$)" htmlFor="dc-t" hint="Objetivo para negociar"><Input id="dc-t" value={dec.target} onChange={(e) => setDec({ ...dec, target: e.target.value })} /></FormField>
              <FormField label="Valor-limite total (R$)" htmlFor="dc-l" hint="Teto: acima, nova aprovação"><Input id="dc-l" value={dec.limit} onChange={(e) => setDec({ ...dec, limit: e.target.value })} /></FormField>
              <FormField label="Condições" htmlFor="dc-c" className="sm:col-span-2"><Input id="dc-c" value={dec.conditions} onChange={(e) => setDec({ ...dec, conditions: e.target.value })} placeholder="Ex.: negociar com o fornecedor e preservar a qualidade" /></FormField>
            </>}
            <FormField label="Justificativa da decisão" htmlFor="dc-n" className="sm:col-span-2"><Textarea id="dc-n" rows={2} value={dec.note} onChange={(e) => setDec({ ...dec, note: e.target.value })} /></FormField>
          </div>
          <Button variant="primary" loading={act.isPending} onClick={() => act.mutate({ path: '/budget/decisions', body: { items: [{ lineId: l.id, decision: dec.decision, approvedQty: approving ? dec.approvedQty : null, approvedCents: approving ? toCents(dec.approved) : null, targetUnitCents: approving ? toCents(dec.target) : null, limitCents: approving ? toCents(dec.limit) : null, conditions: dec.conditions || null, note: dec.note || null }] } })}>Registrar decisão</Button>
        </section>
      )}
      <section aria-label="Budget Guardião" className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Budget Guardião (valor adicional)</h3>
        {p.adjustments.map((a) => (
          <div key={a.id} className="border border-line p-3 text-sm">
            <p className="text-ink"><b className="num">+{fmtBRL(a.deltaCents)}</b> · {a.status === 'pendente' ? 'aguardando a Diretoria' : a.status === 'aprovado' ? `aprovado${a.fromReserve ? ` (reserva ${a.fromReserve === 'centro' ? 'do centro' : 'global'})` : ''}` : 'recusado'} · {a.requestedByName}</p>
            <p className="text-text">{a.justification}</p>
            {a.decisionNote && <p className="text-xs text-muted">Decisão: {a.decisionNote} ({a.decidedByName})</p>}
            {a.status === 'pendente' && p.can.decideGuardian && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Input aria-label="Observação da Diretoria" className="max-w-xs" placeholder="Observação (obrigatória para recusar)" value={gNote[a.id] ?? ''} onChange={(e) => setGNote({ ...gNote, [a.id]: e.target.value })} />
                <Button size="sm" variant="primary" onClick={() => act.mutate({ path: `/budget/guardian/${a.id}/decide`, body: { decision: 'aprovar', note: gNote[a.id] || null } })}>Autorizar</Button>
                <Button size="sm" variant="danger" disabled={!(gNote[a.id] ?? '').trim()} onClick={() => act.mutate({ path: `/budget/guardian/${a.id}/decide`, body: { decision: 'recusar', note: gNote[a.id] } })}>Recusar</Button>
              </div>
            )}
          </div>
        ))}
        {p.can.guardian && (
          <div className="grid gap-2 border border-dashed border-line p-3 sm:grid-cols-[160px_1fr_auto]">
            <Input aria-label="Valor adicional (R$)" placeholder="Valor (R$)" value={g.delta} onChange={(e) => setG({ ...g, delta: e.target.value })} />
            <Input aria-label="Justificativa do excedente" placeholder="Justificativa (mín. 10 caracteres)" value={g.justification} onChange={(e) => setG({ ...g, justification: e.target.value })} />
            <Button size="sm" variant="secondary" disabled={!toCents(g.delta) || g.justification.trim().length < 10} onClick={() => { act.mutate({ path: `/budget/lines/${l.id}/guardian`, body: { deltaCents: toCents(g.delta), justification: g.justification } }); setG({ delta: '', justification: '' }); }}>Pedir à Diretoria</Button>
          </div>
        )}
      </section>
    </div>
  );
}

function ExecutionTab({ p, options }: { p: Panel; options: CentralData['options'] }) {
  const l = p.line;
  const act = useLineAction(l.id, 'Execução registrada');
  const [v, setV] = useState({ supplierId: (l.supplierId as string | null) ?? '', quote: money(l.quoteCents), negotiated: money(l.negotiatedCents), contracted: money(l.contractedCents), contractedQty: l.contractedQty ?? '', contractedOn: l.contractedOn ?? '', poNumber: l.poNumber ?? '', deliveredQty: l.deliveredQty ?? '', deliveredOn: l.deliveredOn ?? '', executionState: l.executionState });
  const [r, setR] = useState({ occurredOn: todayIso(), description: '', amount: '', invoice: '' });
  const set = (x: Partial<typeof v>) => setV((o) => ({ ...o, ...x }));
  const ro = !p.can.execute;
  return (
    <div className="space-y-4">
      {p.ceilingCents !== null && <Notice>Teto autorizado para executar: <b className="num">{fmtBRL(p.ceilingCents)}</b>{l.targetUnitCents ? ` · alvo ${fmtBRL(l.targetUnitCents)} por unidade` : ''}. Acima disso, peça o Budget Guardião.</Notice>}
      {ro && <Notice>A execução fica liberada para o Dono do orçamento e o Responsável pela execução depois da aprovação.</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Fornecedor" htmlFor="ex-s"><Select id="ex-s" disabled={ro} value={v.supplierId} onChange={(e) => set({ supplierId: e.target.value })}><option value="">A definir</option>{options.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
        <FormField label="Situação da execução" htmlFor="ex-st"><Select id="ex-st" disabled={ro} value={v.executionState} onChange={(e) => set({ executionState: e.target.value as ExecutionState })}>{EXECUTION_STATES.map((x) => <option key={x} value={x}>{EXECUTION_STATE_LABELS[x]}</option>)}</Select></FormField>
        <FormField label="Cotação (R$)" htmlFor="ex-q"><Input id="ex-q" disabled={ro} value={v.quote} onChange={(e) => set({ quote: e.target.value })} /></FormField>
        <FormField label="Valor negociado (R$)" htmlFor="ex-n"><Input id="ex-n" disabled={ro} value={v.negotiated} onChange={(e) => set({ negotiated: e.target.value })} /></FormField>
        <FormField label="Valor contratado (R$)" htmlFor="ex-c" hint="Vira o comprometido"><Input id="ex-c" disabled={ro} value={v.contracted} onChange={(e) => set({ contracted: e.target.value })} /></FormField>
        <FormField label="Pedido de compra" htmlFor="ex-po"><Input id="ex-po" disabled={ro} value={v.poNumber} onChange={(e) => set({ poNumber: e.target.value })} /></FormField>
        <FormField label="Data de contratação" htmlFor="ex-cd"><Input id="ex-cd" type="date" disabled={ro} value={v.contractedOn} onChange={(e) => set({ contractedOn: e.target.value })} /></FormField>
        <FormField label="Quantidade contratada" htmlFor="ex-cq"><Input id="ex-cq" disabled={ro} value={v.contractedQty} onChange={(e) => set({ contractedQty: e.target.value })} /></FormField>
        <FormField label="Quantidade entregue" htmlFor="ex-dq"><Input id="ex-dq" disabled={ro} value={v.deliveredQty} onChange={(e) => set({ deliveredQty: e.target.value })} /></FormField>
        <FormField label="Data de entrega" htmlFor="ex-dd"><Input id="ex-dd" type="date" disabled={ro} value={v.deliveredOn} onChange={(e) => set({ deliveredOn: e.target.value })} /></FormField>
      </div>
      {!ro && <Button variant="primary" loading={act.isPending} onClick={() => act.mutate({ path: `/budget/lines/${l.id}/execution`, body: { rowVersion: l.rowVersion, supplierId: v.supplierId || null, quoteCents: toCents(v.quote), negotiatedCents: toCents(v.negotiated), contractedCents: toCents(v.contracted), contractedQty: v.contractedQty || null, contractedOn: v.contractedOn || null, poNumber: v.poNumber || null, deliveredQty: v.deliveredQty || null, deliveredOn: v.deliveredOn || null, executionState: v.executionState } })}>Salvar execução</Button>}
      <section aria-label="Despesas realizadas" className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Despesa realizada (competência)</h3>
        {p.expenses.length ? <ul className="divide-y divide-line text-sm">{p.expenses.map((e) => <li key={e.id} className="flex justify-between py-1.5"><span className={clsx(e.status === 'cancelado' && 'line-through text-muted')}>{fmtDate(e.occurredOn)} · {e.description}</span><b className="num">{fmtBRL(e.amountCents)}</b></li>)}</ul> : <p className="text-sm text-muted">Nada reconhecido ainda.</p>}
        {!ro && (
          <div className="grid gap-2 border border-dashed border-line p-3 sm:grid-cols-4">
            <Input aria-label="Data" type="date" value={r.occurredOn} onChange={(e) => setR({ ...r, occurredOn: e.target.value })} />
            <Input aria-label="Descrição" placeholder="Descrição" value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} />
            <Input aria-label="Nota fiscal" placeholder="Nº da NF" value={r.invoice} onChange={(e) => setR({ ...r, invoice: e.target.value })} />
            <Input aria-label="Valor (R$)" placeholder="Valor (R$)" value={r.amount} onChange={(e) => setR({ ...r, amount: e.target.value })} />
            <Button size="sm" variant="secondary" className="sm:col-span-4 sm:justify-self-start" disabled={!toCents(r.amount) || r.description.trim().length < 3} onClick={() => { act.mutate({ path: `/budget/lines/${l.id}/realized`, body: { occurredOn: r.occurredOn, description: r.description, amountCents: toCents(r.amount), invoiceNumber: r.invoice || null, idempotencyKey: key() } }); setR({ ...r, description: '', amount: '', invoice: '' }); }}>Reconhecer despesa</Button>
          </div>
        )}
      </section>
      <Documents p={p} kinds={['cotacao', 'pedido', 'nota_fiscal', 'entrega', 'outro']} onUpload={(kind, file) => act.mutate({ path: `/budget/lines/${l.id}/documents`, body: { kind, doc: file } })} canUpload={p.can.execute || p.can.finance} />
    </div>
  );
}

function FinanceTab({ p }: { p: Panel }) {
  const l = p.line;
  const act = useLineAction(l.id, 'Financeiro atualizado');
  const [t, setT] = useState({ invoice: '', amount: money(l.contractedCents ?? p.ceilingCents ?? 0), competence: l.month, firstDueOn: '', installments: '1' });
  const [pay, setPay] = useState<Record<string, { paidOn: string; amount: string; interest: string; fine: string; discount: string; method: string; proof: { name: string; data: string } | null; key: string }>>({});
  const blank = (openCents: number) => ({ paidOn: todayIso(), amount: money(openCents), interest: '', fine: '', discount: '', method: 'boleto', proof: null, key: key() });
  return (
    <div className="space-y-4">
      {!p.can.finance && <Notice>Títulos, pagamentos, estornos e conciliação são registrados pelo setor Financeiro. O registro de execução pelo gestor não confirma pagamento.</Notice>}
      {p.payables.length ? p.payables.map((x) => {
        const f = pay[x.id];
        return (
          <div key={x.id} className="border border-line p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-ink"><b>Parcela {x.installment}/{x.installments}</b>{x.invoiceNumber ? ` · NF ${x.invoiceNumber}` : ''} · vence {fmtDate(x.dueOn)} · competência {x.competence}</p>
              <span className="flex flex-wrap gap-1">{x.flags.map((fl) => <Chip key={fl} tone={FIN_TONE(fl)}>{PAYMENT_FLAG_LABELS[fl]}</Chip>)}</span>
            </div>
            <p className="num mt-1 text-text">Valor {fmtBRL(x.amountCents)} · pago {fmtBRL(x.paidCents)} · em aberto {fmtBRL(x.openCents)}</p>
            {x.payments.length > 0 && (
              <ul className="mt-2 space-y-1">{x.payments.map((y) => (
                <li key={y.id} className="flex flex-wrap items-center justify-between gap-2 bg-surface-2 px-2 py-1">
                  <span>{y.kind === 'estorno' ? 'Estorno' : 'Pagamento'} em {fmtDate(y.paidOn)}: <b className="num">{fmtBRL(y.amountCents)}</b>{y.interestCents + y.fineCents ? ` + juros/multa ${fmtBRL(y.interestCents + y.fineCents)}` : ''}{y.discountCents ? ` − desconto ${fmtBRL(y.discountCents)}` : ''}{y.method ? ` · ${PAYMENT_METHOD_LABELS[y.method as keyof typeof PAYMENT_METHOD_LABELS]}` : ''}{y.reason ? ` · ${y.reason}` : ''} · {y.createdByName}{y.reconciledAt ? ' · conciliado' : ''}</span>
                  {p.can.finance && y.kind === 'pagamento' && !y.reversed && (
                    <span className="flex gap-1">
                      {!y.reconciledAt && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/budget/payments/${y.id}/reconcile` })}>Conciliar</Button>}
                      <Button size="sm" variant="ghost" onClick={() => { const reason = window.prompt('Motivo do estorno'); if (reason && reason.trim().length >= 5) act.mutate({ path: `/budget/payments/${y.id}/reverse`, body: { reason, paidOn: todayIso() } }); }}>Estornar</Button>
                    </span>
                  )}
                </li>
              ))}</ul>
            )}
            {p.can.finance && x.openCents > 0 && !x.flags.includes('cancelado') && (f ? (
              <div className="mt-2 grid gap-2 border border-dashed border-line p-2 sm:grid-cols-3">
                <Input aria-label="Data do pagamento" type="date" value={f.paidOn} onChange={(e) => setPay({ ...pay, [x.id]: { ...f, paidOn: e.target.value } })} />
                <Input aria-label="Valor pago (R$)" value={f.amount} onChange={(e) => setPay({ ...pay, [x.id]: { ...f, amount: e.target.value } })} />
                <Select aria-label="Forma de pagamento" value={f.method} onChange={(e) => setPay({ ...pay, [x.id]: { ...f, method: e.target.value } })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</Select>
                <Input aria-label="Juros (R$)" placeholder="Juros" value={f.interest} onChange={(e) => setPay({ ...pay, [x.id]: { ...f, interest: e.target.value } })} />
                <Input aria-label="Multa (R$)" placeholder="Multa" value={f.fine} onChange={(e) => setPay({ ...pay, [x.id]: { ...f, fine: e.target.value } })} />
                <Input aria-label="Desconto (R$)" placeholder="Desconto" value={f.discount} onChange={(e) => setPay({ ...pay, [x.id]: { ...f, discount: e.target.value } })} />
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary sm:col-span-2"><FileUp className="h-4 w-4" aria-hidden />{f.proof ? f.proof.name : 'Anexar comprovante'}<input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) setPay({ ...pay, [x.id]: { ...f, proof: { name: fl.name, data: await fileToBase64(fl) } } }); }} /></label>
                <Button size="sm" variant="primary" onClick={() => act.mutate({ path: `/budget/payables/${x.id}/payments`, body: { paidOn: f.paidOn, amountCents: toCents(f.amount) ?? 0, interestCents: toCents(f.interest) ?? 0, fineCents: toCents(f.fine) ?? 0, discountCents: toCents(f.discount) ?? 0, method: f.method, proof: f.proof, idempotencyKey: f.key } }, { onSuccess: () => setPay({ ...pay, [x.id]: undefined! }) })}>Registrar baixa</Button>
              </div>
            ) : <Button size="sm" variant="outline" className="mt-2" onClick={() => setPay({ ...pay, [x.id]: blank(x.openCents) })}>Registrar pagamento</Button>)}
          </div>
        );
      }) : <p className="text-sm text-muted">Nenhum título lançado.</p>}
      {p.can.finance && p.ceilingCents !== null && (
        <section aria-label="Novo título" className="grid gap-2 border border-dashed border-line p-3 sm:grid-cols-3">
          <h3 className="text-sm font-semibold text-ink sm:col-span-3">Lançar título (nota fiscal)</h3>
          <Input aria-label="Número da nota fiscal" placeholder="Nº da NF" value={t.invoice} onChange={(e) => setT({ ...t, invoice: e.target.value })} />
          <Input aria-label="Valor devido (R$)" value={t.amount} onChange={(e) => setT({ ...t, amount: e.target.value })} />
          <Input aria-label="Competência" type="month" value={t.competence} onChange={(e) => setT({ ...t, competence: e.target.value })} />
          <Input aria-label="Primeiro vencimento" type="date" value={t.firstDueOn} onChange={(e) => setT({ ...t, firstDueOn: e.target.value })} />
          <Input aria-label="Parcelas" type="number" min={1} max={60} value={t.installments} onChange={(e) => setT({ ...t, installments: e.target.value })} />
          <Button size="sm" variant="secondary" disabled={!toCents(t.amount) || !t.firstDueOn} onClick={() => act.mutate({ path: `/budget/lines/${l.id}/payables`, body: { invoiceNumber: t.invoice || null, amountCents: toCents(t.amount), competence: t.competence, firstDueOn: t.firstDueOn, installments: Number(t.installments), externalId: `manual:${l.id}:${t.invoice || t.firstDueOn}:${toCents(t.amount)}` } })}>Lançar título</Button>
        </section>
      )}
    </div>
  );
}

function AuditTab({ p }: { p: Panel }) {
  return (
    <ol className="space-y-3" aria-label="Linha do tempo do lançamento">
      {p.events.map((e) => (
        <li key={e.id} className="border-l-2 border-primary pl-3 text-sm">
          <p className="text-xs text-muted">{fmtDateTime(e.at)} · {e.actor ?? 'Sistema'}</p>
          <p className="text-ink">{e.summary}</p>
          {e.data?.changes?.length ? (
            <ul className="mt-1 text-xs text-text">{e.data.changes.map((c) => <li key={c.field}><b>{c.field}</b>: {String(c.before ?? '—')} → {String(c.after ?? '—')}</li>)}</ul>
          ) : null}
          {e.data?.reason && <p className="text-xs text-muted">Justificativa: {e.data.reason}</p>}
        </li>
      ))}
    </ol>
  );
}

function ResultTab({ p }: { p: Panel }) {
  const f = p.figures;
  const rows: [string, number | null, string][] = [
    ['Planejado', f.planned, 'Pedido original'], ['Aprovado', f.approved || null, 'Limite autorizado'], ['Contratado', f.committed || null, 'Obrigação assumida'],
    ['Realizado', f.realized || null, 'Despesa reconhecida'], ['Pago', f.paid || null, 'Confirmado pelo Financeiro'], ['Saldo', f.approved ? f.balance : null, 'Aprovado − consumo'],
    ['Economia', f.economy || null, 'Aprovado acima do contratado ou consumido'], ['Excedente', f.excess || null, 'Consumo acima do autorizado'], ['Juros e multa', f.charges || null, 'Separados da despesa'],
  ];
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <tbody>{rows.map(([k, v, h]) => <tr key={k} className="border-b border-line"><th scope="row" className="py-2 text-left font-medium text-ink">{k}<span className="block text-xs font-normal text-muted">{h}</span></th><td className="num py-2 text-right font-semibold text-ink">{v === null ? '—' : fmtBRL(v)}</td></tr>)}</tbody>
      </table>
      <p className="text-sm text-text">Desvio (realizado − aprovado): <b className="num">{f.deviation === null ? '—' : fmtBRL(f.deviation)}</b>{f.deviationPct !== null ? ` (${f.deviationPct.toLocaleString('pt-BR')}%)` : ''}. Comprometido, realizado e pago são estágios da mesma obrigação e não se somam.</p>
    </div>
  );
}
