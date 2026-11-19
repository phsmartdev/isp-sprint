/**
 * Viabilidade econômica da oportunidade (motor financeiro): custos da venda e da entrega, condições comerciais
 * e o resultado na hora — preço mínimo, recomendado, margem, payback, VPL e TIR — numa leitura rápida para o time.
 * O cálculo da tela usa o mesmo motor do servidor; ao salvar, o servidor recalcula e guarda a fotografia auditável.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Calculator, ChevronDown, Eye, EyeOff, Maximize2 } from 'lucide-react';
import {
  econInputErrors, econPaybackErrors, econPaybackLimit, econTargetErrors, econBasketViews, type EconBasketView, type EconCostProfile, defaultCostProfile, type CostProfile, DEAL_KINDS, DEAL_KIND_LABELS, ECON_LOT_LABELS, ECON_VERDICT_LABELS, econCompare, isMonthlyKind, isOneTimeKind, lotOfKind, type EconLot, type DealKind, costQty, econDre, econMemory, econHeadline, emptyEconInput, financeEngine, parseMoney,
  buildModel, b2gFromEconomics, contractMargins, type FinOverride, type FiscalArgs, type CostImpact, type EconInput, type EconItem, type EconResult, type EconSettings, type EconVerdict, type B2gResult,
} from '@isp/domain';
import { TAX_REGIME_LABELS, type TaxRegime } from '@isp/shared';
import { api } from '../../lib/api';
import { fmtBRL, fmtDateTime } from '../../lib/format';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { CashflowChart, flowSeries } from '../../components/charts/Cashflow';
import { errMsg } from '../contracts/shared';
import { BasketPanel, BusinessOverview, ItemValuesModal } from './BasketEconomics';
import { basketName, parseRate, rateText, type BasketForm } from './basketPresentation';
import { B2gPanel, emptyB2gForm, type B2gForm } from './B2gPanel';

type Data = {
  settings: EconSettings | null; items: EconItem[]; publicSector: boolean; input: EconInput; saved: { updatedAt: string } | null;
  /** fórmulas publicadas no Financial Studio (a prévia usa o mesmo modelo do servidor) */
  modelOverrides?: FinOverride[];
  /** resultado SALVO (consultar não recalcula); stale = produtos, tributos ou parâmetros mudaram desde então */
  result: EconResult | null; stale: boolean; editable: boolean;
  emitter: { name: string; cnpj: string | null; taxRegime: string | null; city: string | null; state: string | null} | null;
  /** envelope fiscal por vigência (a prévia escolhe a chave ativa como o servidor) */
  fiscal?: FiscalArgs;
  /** parâmetros vigentes; null = a empresa ainda não informou em Configurações → Viabilidade */
  settingsVersion: { id: string; validFrom: string } | null;
  status: EconStatus; canDecide: boolean; decisions: { id: string; snapshotId: string; action: 'enviada' | 'aprovada' | 'devolvida'; reason: string | null; actorName: string | null; createdAt: string }[];
  /** sem "ver financeiro" a API manda só o veredito */
  financeHidden: boolean; history: { id: string; reason: string; createdAt: string; actorName: string | null; verdict: EconVerdict; priceCents: number | null; engineVersion: string | null; sha256: string | null }[];
};
type EconStatus = 'rascunho' | 'calculada' | 'em_decisao' | 'aprovada' | 'devolvida';
/** Linha do formulário: `unit` = valor unitário digitado; `measure` = unidade de medida (m, und, hh…). */
type Line = { category?: EconInput['capex'][number]['category']; key: string; description: string; qty: string; unit: string; measure?: string | null; impact?: CostImpact | null; costItemId?: string | null; kind?: DealKind | null };

const TONE: Record<EconVerdict, { bar: string; chip: 'green' | 'blue' | 'orange' | 'red' | 'neutral' }> = {
  viavel: { bar: 'border-success bg-success-soft', chip: 'green' }, abaixo_recomendado: { bar: 'border-primary bg-primary-soft', chip: 'blue' },
  fora_politica: { bar: 'border-warning bg-warning-soft', chip: 'orange' }, abaixo_minimo: { bar: 'border-danger bg-danger-soft', chip: 'red' },
  inviavel: { bar: 'border-danger bg-danger-soft', chip: 'red' }, sem_preco: { bar: 'border-line bg-surface-2', chip: 'neutral' },
  abaixo_faixa: { bar: 'border-danger bg-danger-soft', chip: 'red' }, acima_faixa: { bar: 'border-warning bg-warning-soft', chip: 'orange' },
  aguardando_sugerido: { bar: 'border-line bg-surface-2', chip: 'neutral' }, sem_margem_liquida: { bar: 'border-line bg-surface-2', chip: 'neutral' },
};
const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`);
const months = (v: number | null | undefined) => (v == null ? 'não se paga' : v === 0 ? 'imediato' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`);
const bpText = (bp: number | null | undefined) => (bp == null ? '' : (bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const parseBp = (t: string): number | null => { if (!t.trim()) return null; const n = Number(t.replace(',', '.')); return Number.isFinite(n) && n >= 0 && n < 100 ? Math.round(n * 100) : NaN; };
const money = (c: number | null) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
let seq = 0;
/** Quantidade sem separador de milhar ("8400", "2,5"): o ponto seria lido como decimal. */
const qtyText = (milli: number) => (milli / 1000).toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 3 });
const toLines = (l: EconInput['capex']): Line[] => l.map((x) => ({ key: `l${++seq}`, description: x.description, qty: qtyText(x.qtyMilli), unit: money(x.unitCents), category: x.category, measure: x.unit ?? null, impact: x.impact ?? null, costItemId: x.costItemId ?? null, kind: x.kind ?? null }));
const fromLines = (l: Line[]) => l.filter((x) => x.description.trim() || x.unit.trim()).map((x) => ({ description: x.description.trim(), qtyMilli: costQty(x.qty) ?? 0, unitCents: parseMoney(x.unit) ?? -1, category: x.category, unit: x.measure ?? null, impact: x.impact ?? null, costItemId: x.costItemId ?? null, kind: x.kind ?? null }));

/** Recolher não apaga os campos: o formulário continua montado com seus valores. */
function EyeToggle({ open, onToggle, label, controls }: { open: boolean; onToggle: () => void; label: string; controls: string }) {
  const Icon = open ? EyeOff : Eye;
  return <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={controls} aria-label={`${open ? 'Recolher' : 'Mostrar'} ${label}`} title={`${open ? 'Recolher' : 'Mostrar'} ${label}`} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-primary"><Icon className="h-4 w-4" aria-hidden /></button>;
}

function Disclosure({ title, hint, total, children, defaultOpen = false, index }: { title: string; hint?: string; total?: ReactNode; children: ReactNode; defaultOpen?: boolean; index?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return <section className="border border-line p-3 sm:p-4" aria-label={title}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 items-start gap-2">
        {index != null && <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center bg-primary text-2xs font-bold text-white" aria-hidden>{index}</span>}
        <div><div className="flex items-center gap-1"><h3 className="text-sm font-semibold text-ink">{title}</h3><EyeToggle open={open} onToggle={() => setOpen(!open)} label={title} controls={id} /></div>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
      </div>
      {total && <div className="num text-sm text-muted">{total}</div>}
    </div>
    <div id={id} hidden={!open} className="mt-3">{children}</div>
  </section>;
}

/** Régua do preço: onde o preço proposto fica em relação ao mínimo e ao recomendado. */
/** Contribuição → operacional → líquida, em % da receita e R$ do período. */
function MarginChain({ m, per, compact, contract, firstMonthNetPct }: { m: NonNullable<NonNullable<EconResult['kpi']>['margins']>; per: string; compact?: boolean; /** margens do contrato inteiro (meses) */ contract?: number; firstMonthNetPct?: number | null }) {
  const steps = [
    { label: 'Margem de contribuição', cents: null as number | null, pct: m.contributionPct, hint: contract ? 'na vigência: receita menos tributos, despesas variáveis e custos mensais, antes da amortização' : 'depois de tributos, despesas variáveis e custos (no preço sugerido = a margem escolhida)' },
    { label: 'Margem operacional', cents: m.operatingCents, pct: m.operatingPct, hint: `− amortização ${fmtBRL(m.amortizationCents)} · − despesas fixas ${fmtBRL(m.overheadCents)}` },
    { label: contract ? `Margem líquida do contrato (${contract} meses)` : 'Margem líquida', cents: m.netCents, pct: m.netPct, hint: `− IR/CSLL ${fmtBRL(m.incomeTaxCents)}${contract && firstMonthNetPct != null ? ` · no 1º mês ${firstMonthNetPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% (a amortização pesa nos meses do payback)` : ''}` },
  ];
  return (
    <>
    {contract ? <p className="mt-2 text-2xs font-bold uppercase tracking-wide text-muted">Margens no contrato inteiro · {contract} meses</p> : null}
    <ol className="mt-2 grid grid-cols-1 gap-1.5" aria-label="Cadeia de margens">
      {steps.map((s) => (
        <li key={s.label} className="flex items-center justify-between gap-3 border border-line px-2.5 py-2">
          <div className="min-w-0">
            <p className="text-xs text-muted">{s.label}</p>
            {!compact && s.pct != null && <p className="text-2xs text-muted">{s.hint}</p>}
          </div>
          {s.pct == null ? <p className="text-sm text-[#C2610C]">Parâmetro não informado</p> : (
            <p className={clsx('num shrink-0 text-right font-bold', s.pct < 0 ? 'text-danger' : 'text-ink')}>{s.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%{s.cents != null && <span className="ml-1.5 text-xs font-normal text-muted">{fmtBRL(s.cents)}{per}</span>}</p>
          )}
        </li>
      ))}
    </ol>
    </>
  );
}

/** Cores que ligam cada preço ao que ele governa: azul = sugerido (indicadores); a cor da decisão = proposto (aprovação). */
const SUG = { dot: 'bg-primary', border: 'border-primary/60', soft: 'bg-primary/5', text: 'text-primary' };
const DEC: Record<EconVerdict, { dot: string; border: string; soft: string; text: string }> = {
  viavel: { dot: 'bg-success', border: 'border-success/60', soft: 'bg-success-soft/40', text: 'text-[#15803D]' },
  abaixo_recomendado: { dot: 'bg-warning', border: 'border-warning/60', soft: 'bg-warning-soft/40', text: 'text-[#C2610C]' },
  fora_politica: { dot: 'bg-warning', border: 'border-warning/60', soft: 'bg-warning-soft/40', text: 'text-[#C2610C]' },
  abaixo_minimo: { dot: 'bg-danger', border: 'border-danger/60', soft: 'bg-danger-soft/40', text: 'text-danger' },
  inviavel: { dot: 'bg-danger', border: 'border-danger/60', soft: 'bg-danger-soft/40', text: 'text-danger' },
  sem_preco: { dot: 'bg-line-strong', border: 'border-line', soft: 'bg-surface-2', text: 'text-muted' },
  abaixo_faixa: { dot: 'bg-danger', border: 'border-danger/60', soft: 'bg-danger-soft/40', text: 'text-danger' },
  acima_faixa: { dot: 'bg-warning', border: 'border-warning/60', soft: 'bg-warning-soft/40', text: 'text-[#C2610C]' },
  aguardando_sugerido: { dot: 'bg-line-strong', border: 'border-line', soft: 'bg-surface-2', text: 'text-muted' },
  sem_margem_liquida: { dot: 'bg-line-strong', border: 'border-line', soft: 'bg-surface-2', text: 'text-muted' },
};
const Badge = ({ dot, children }: { dot: string; children: ReactNode }) => <span className="inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wide text-muted"><span className={clsx('h-2.5 w-2.5 rounded-full', dot)} aria-hidden />{children}</span>;

/**
 * Os dois preços lado a lado. Sugerido = o que o motor calcula (custos ÷ (1 − tributos − despesas variáveis − margem));
 * todos os quadros de indicadores usam ele. Proposto = o que vai na proposta (digitado ou o total dos produtos); a
 * decisão de aprovação vale para ele. Sem proposto, a aprovação usa o sugerido.
 */
/** Valor em destaque: diminui quando o número é longo (milhões) para caber no cartão em telas menores. */
const bigCls = (cents: number | null | undefined) => { const n = fmtBRL(cents ?? null).length; return n > 16 ? 'text-md' : n > 13 ? 'text-lg' : 'text-xl'; };

function PriceBasis({ r, per, settings, compact }: { r: EconResult; per: string; settings?: EconSettings | null; compact?: boolean }) {
  const [cmp, setCmp] = useState(false);
  const d = r.decision;
  if (!d) return null;
  const sug = r.suggestedCents ?? r.priceCents;
  const one = r.suggestedOneTimeCents ?? null;
  const legacy = { oneTimeX100: settings?.legacyOneTimeX100, recurringX100: settings?.legacyRecurringX100 };
  const c = econCompare(r, legacy);
  const proposed = d.basis === 'proposto';
  const tone = DEC[d.verdict];
  const diff = proposed && d.priceCents != null && sug != null ? d.priceCents - sug : null;
  const m = r.rates.m * 100;
  return (
    <div className="mt-3">
      <div className={clsx('grid gap-2', !compact && 'grid-cols-[repeat(auto-fit,minmax(230px,1fr))]')}>
        <section className={clsx('min-w-0 border-2 p-3', SUG.border, SUG.soft)} aria-label="Preço sugerido">
          <Badge dot={SUG.dot}>Base dos indicadores</Badge>
          <p className="mt-1 text-xs font-semibold text-ink">Preço sugerido pelo motor</p>
          <p className={clsx('num flex min-w-0 flex-wrap items-baseline font-bold text-ink whitespace-nowrap', bigCls(sug))}><span>{fmtBRL(sug)}</span><span className="whitespace-normal text-xs font-normal text-muted">{per}</span></p>
          {one != null && <p className="num text-sm font-semibold text-ink">+ {fmtBRL(one)} <span className="text-xs font-normal text-muted">pagamento único</span></p>}
          <p className="mt-1 text-xs text-text">{r.deal && new Set(r.deal.cells.map((cell) => cell.result?.targetNetMarginPct).filter((n) => n != null)).size > 1 ? 'Margens líquidas definidas por cesta' : r.pricingBasis === 'net_margin' ? `Margem líquida esperada ${pct(r.targetNetMarginPct, 1)}` : `Margem ${pct(m, 1)}`}{c.engine.markupPct != null && !r.deal ? ` · markup efetivo ${pct(c.engine.markupPct, 1)}` : ''}</p>
          <p className="mt-1 text-2xs text-muted">{r.pricingBasis === 'net_margin' ? 'Preço resolvido pela margem líquida do contrato. A contribuição é calculada por cesta.' : <>custos ÷ (1 − tributos {pct(r.rates.a * 100, 2)} − desp. variáveis {pct(r.rates.c * 100, 2)} − margem {pct(m, 1)}){r.deal ? ', por cesta' : ''}</>}</p>
          <button type="button" className={clsx('mt-2 text-xs font-semibold hover:underline', SUG.text)} aria-expanded={cmp} onClick={() => setCmp((v) => !v)}>{cmp ? 'Fechar comparativo' : 'Comparar com o modelo antigo'}</button>
        </section>
        <section className={clsx('min-w-0 border-2 p-3', proposed ? [tone.border, tone.soft] : 'border-dashed border-line bg-surface-2')} aria-label="Preço proposto">
          <Badge dot={proposed ? tone.dot : 'bg-line-strong'}>Base da aprovação</Badge>
          {proposed ? (
            <>
              <p className="mt-1 text-xs font-semibold text-ink">Preço proposto {d.source === 'itens' ? '(total dos produtos)' : '(digitado na negociação)'}</p>
              <p className={clsx('num flex min-w-0 flex-wrap items-baseline font-bold text-ink whitespace-nowrap', bigCls(d.priceCents))}><span>{fmtBRL(d.priceCents)}</span><span className="whitespace-normal text-xs font-normal text-muted">{per}</span></p>
              {d.oneTimeCents != null && <p className="num text-sm font-semibold text-ink">+ {fmtBRL(d.oneTimeCents)} <span className="text-xs font-normal text-muted">pagamento único</span></p>}
              <p className={clsx('mt-1 text-sm font-bold', tone.text)}>{ECON_VERDICT_LABELS[d.verdict]}</p>
              {d.verdict !== 'aguardando_sugerido' && <p className="text-xs text-text">{d.contractNetMarginPct != null ? <>Margem líquida do contrato <b>{pct(d.netMarginPct, 1)}</b>{d.netMarginRange ? ` (faixa ${pct(d.netMarginRange.minPct, 1)} a ${pct(d.netMarginRange.maxPct, 1)})` : ''}{d.paybackNetMarginPct != null ? <span className="block text-2xs text-muted">nos meses do payback {pct(d.paybackNetMarginPct, 1)} (só referência)</span> : null}</> : d.netMarginPct != null ? <>Margem líquida <b>{pct(d.netMarginPct, 1)}</b>{d.netMarginRange ? ` (faixa ${pct(d.netMarginRange.minPct, 1)} a ${pct(d.netMarginRange.maxPct, 1)})` : ''}</> : <>Margem {pct(d.marginPct, 1)}</>}</p>}
              {diff != null && diff !== 0 && <p className="mt-1 text-2xs text-muted">{fmtBRL(Math.abs(diff))}{per} {diff > 0 ? 'acima' : 'abaixo'} do sugerido</p>}
            </>
          ) : (
            <>
              <p className="mt-1 text-xs font-semibold text-ink">Nenhum preço proposto</p>
              <p className="mt-1 text-sm text-text">A aprovação usa o <b>preço sugerido</b>: <span className={clsx('font-bold', tone.text)}>{ECON_VERDICT_LABELS[d.verdict]}</span>{d.contractNetMarginPct != null && d.verdict !== 'aguardando_sugerido' ? <>, margem líquida do contrato <b>{pct(d.netMarginPct, 1)}</b>{d.netMarginRange ? ` (faixa ${pct(d.netMarginRange.minPct, 1)} a ${pct(d.netMarginRange.maxPct, 1)})` : ''}</> : null}{d.contractNetMarginPct == null && d.netMarginPct != null && d.verdict !== 'aguardando_sugerido' ? <>, margem líquida <b>{pct(d.netMarginPct, 1)}</b>{d.netMarginRange ? ` (faixa ${pct(d.netMarginRange.minPct, 1)} a ${pct(d.netMarginRange.maxPct, 1)})` : ''}</> : null}.</p>
              <p className="mt-1 text-2xs text-muted">Para avaliar outro valor, informe o preço em A venda ou lance os valores dos produtos.</p>
            </>
          )}
        </section>
      </div>
      {cmp && <LegacyCompare r={r} legacy={legacy} />}
    </div>
  );
}

/**
 * Target seeking: o preço que entrega a margem líquida pedida (na mensalidade, no contrato inteiro), com IR/CSLL, despesas fixas, glosa e
 * inadimplência dos parâmetros (IR/CSLL da empresa no ano, quando cadastrado). Faixa viável: da mínima à máxima.
 */
function TargetSeek({ r, per }: { r: EconResult; per: string }) {
  const rc = r.recommendation;
  if (!rc) return null;
  const pts = rc.range ? [{ k: 'Margem líquida mínima', p: rc.range.min }, { k: 'Margem líquida máxima', p: rc.range.max }] : [{ k: 'Margem líquida alvo', p: { netPct: rc.netTargetPct, operatingPct: rc.operatingNeededPct, contributionPct: rc.contributionPct, priceCents: rc.priceCents, oneTimePriceCents: rc.oneTimePriceCents } }];
  const prm = rc.params ?? { incomeTaxPct: null, overheadPct: null, glosaPct: 0, badDebtPct: 0 };
  const ir = prm.incomeTaxPct;
  return (
    <section className="mt-3 border-2 border-primary/50 bg-primary/5 p-3" aria-label="Preço pela margem líquida (target seeking)">
      <p className="text-sm font-bold text-ink">{rc.range ? 'Faixa de preço viável pela margem líquida' : 'Preço pela margem líquida alvo'}</p>
      <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
        {pts.map(({ k, p }) => (
          <div key={k} className="min-w-0 border-l-4 border-primary bg-surface p-2.5">
            <p className="text-xs text-muted">{k} {pct(p.netPct, 2)}</p>
            <p className="num flex flex-wrap items-baseline whitespace-nowrap text-lg font-bold text-ink"><span>{p.priceCents == null ? 'não cabe no markup' : fmtBRL(p.priceCents)}</span>{p.priceCents != null && <span className="text-xs font-normal text-muted">{per}</span>}</p>
            {p.oneTimePriceCents != null && <p className="num text-xs text-ink">+ {fmtBRL(p.oneTimePriceCents)} no pagamento único</p>}
            <p className="text-2xs text-muted">{r.mode === 'recorrente' ? 'no contrato: ' : ''}margem de contribuição {pct(p.contributionPct, 2)} · operacional {pct(p.operatingPct, 2)}</p>
          </div>
        ))}
      </div>
      {r.mode === 'recorrente' ? <p className="mt-2 text-2xs text-muted">Na mensalidade, o preço é o que entrega a margem líquida no contrato inteiro ({r.term.N} meses): o investimento pesa só nos meses do payback e o IR/CSLL ({pct(ir, 2)}) incide mês a mês sobre a margem operacional positiva. Despesas fixas ({pct(prm.overheadPct, 2)}), glosa ({pct(prm.glosaPct, 2)}) e inadimplência ({pct(prm.badDebtPct, 2)}) saem de cada mensalidade.</p> : <p className="mt-2 font-mono text-2xs text-muted">MO = margem líquida ÷ (1 − IR/CSLL {pct(ir, 2)}) · MC = MO + despesas fixas {pct(prm.overheadPct, 2)} + glosa {pct(prm.glosaPct, 2)} + inadimplência {pct(prm.badDebtPct, 2)} · preço = custos ÷ (1 − tributos − desp. variáveis − MC)</p>}
      {rc.range && <p className="mt-1 text-2xs text-muted">Viável entre os dois preços: abaixo do primeiro a margem líquida fica abaixo da mínima; acima do segundo, acima da máxima.</p>}
    </section>
  );
}

/** Comparativo rápido com o modelo antigo (mensal: custo × 3,2 · único: custo × 2,5). Só informativo. */
function LegacyCompare({ r, legacy }: { r: EconResult; legacy: { oneTimeX100?: number | null; recurringX100?: number | null } }) {
  const parts = r.deal ? r.deal.cells.map((c) => ({ k: `${ECON_LOT_LABELS[c.lot]} · ${c.ritmo === 'unico' ? 'pagamento único' : 'mensal'}`, res: c.result })) : [{ k: '', res: r }];
  return (
    <div className="mt-2 space-y-3 border border-line p-3">
      {parts.map(({ k, res }) => {
        const c = econCompare(res, legacy);
        const per = res.mode === 'recorrente' ? '/mês' : '';
        const col = (x: typeof c.engine) => [x.priceCents == null ? '—' : `${fmtBRL(x.priceCents)}${per}`, pct(x.markupPct, 1), pct(x.grossMarginPct, 1), pct(x.effectiveMarginPct, 1)];
        const rows = ['Preço', 'Markup efetivo', 'Margem contrib. bruta', 'Margem contrib. efetiva'];
        const eng = col(c.engine), old = col(c.legacy);
        return (
          <div key={k || 'unico'}>
            {k && <p className="mb-1 text-xs font-semibold text-ink">{k}</p>}
            {c.baseCents <= 0 ? <p className="text-xs text-muted">Sem custo para comparar.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-2xs uppercase text-muted"><tr><th className="py-1" /><th className="py-1 pl-2 text-right">Sugerido</th><th className="whitespace-nowrap py-1 pl-2 text-right">Antigo ×{(c.legacy.factor ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</th></tr></thead>
                <tbody>{rows.map((label, i) => (
                  <tr key={label} className="border-t border-line"><td className="py-1.5 text-xs text-text">{label}</td><td className="num whitespace-nowrap py-1.5 pl-2 text-right font-semibold text-ink">{eng[i]}</td><td className="num whitespace-nowrap py-1.5 pl-2 text-right">{old[i]}</td></tr>
                ))}</tbody>
              </table></div>
            )}
            <p className="mt-1 text-2xs text-muted">Base: {c.baseLabel} {fmtBRL(c.baseCents)}{per}. Markup = (preço − base) ÷ base · margem bruta = 1 − base ÷ preço · efetiva = bruta − tributos {pct(c.taxesPct, 2)} − desp. variáveis {pct(c.variablePct, 2)}.</p>
          </div>
        );
      })}
      <p className="text-2xs text-muted">Só comparação: o modelo antigo não entra na decisão.</p>
    </div>
  );
}

/** Lote com mais de uma cesta ou ritmo: o preço de cada célula pelo markup e o que soma no preço do lote. */
function CellsTable({ r, compact }: { r: EconResult; compact?: boolean }) {
  const d = r.deal!;
  return (
    <section className="mt-3 border border-line p-3" aria-label="Preço por cesta">
      <p className="text-xs font-semibold text-ink">Preço por cesta <span className="font-normal text-muted">(somado no preço do lote)</span></p>
      <div className="mt-1 overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-left text-2xs uppercase text-muted"><tr><th className="py-1">Cesta</th>{!compact && <th className="py-1">Documento (teto)</th>}{!compact && <th className="py-1 text-right">Custo</th>}<th className="py-1 text-right">Sugerido</th>{d.proposed && <th className="py-1 text-right">Proposto</th>}</tr></thead>
        <tbody>{d.cells.map((c) => {
          const u = c.ritmo === 'unico' ? ' (único)' : '/mês';
          return (
            <tr key={c.key} className="border-t border-line align-top">
              <td className="py-1.5"><span className="font-semibold text-ink">{ECON_LOT_LABELS[c.lot]}</span><span className="block text-2xs text-muted">{c.ritmo === 'unico' ? 'pagamento único' : 'mensal'} · {c.kinds.map((k) => DEAL_KIND_LABELS[k].toLowerCase()).join(', ')}</span></td>
              {!compact && <td className={clsx('py-1.5 text-xs', c.pending ? 'text-[#C2610C]' : 'text-text')}>{c.doc ?? 'sem documento'}<span className="block text-2xs text-muted">{pct(c.taxPct, 2)}</span></td>}
              {!compact && <td className="num py-1.5 text-right">{fmtBRL(c.costCents)}<span className="text-2xs text-muted">{u}</span>{c.divisor != null && <span className="block text-2xs text-muted">÷ {pct(c.divisor * 100, 1)}</span>}</td>}
              <td className="num py-1.5 text-right font-semibold text-ink">{fmtBRL(c.suggestedCents)}<span className="text-2xs font-normal text-muted">{u}</span></td>
              {d.proposed && <td className="num py-1.5 text-right">{fmtBRL(c.proposedCents)}<span className="text-2xs text-muted">{u}</span></td>}
            </tr>
          );
        })}</tbody>
      </table></div>
      {!compact && <p className="mt-1 text-2xs text-muted">Cada cesta usa o maior tributo entre os documentos dos seus produtos (Fornecimento = NF-e de mercadoria; Implantação = os demais documentos). O proposto é dividido entre as cestas na proporção dos produtos (ou do sugerido).</p>}
      {!compact && <div className="mt-3 space-y-2" aria-label="Memórias de cálculo por cesta">
        <p className="text-xs text-muted">O rateio usa a receita de pagamento único ou a mensalidade × vigência; custos sem cesta são distribuídos entre todas as cestas. Sem valores de receita, vale o número de produtos. Os custos abaixo já incluem esse rateio. Abra a memória para conferir as entradas, o investimento, a parcela mensal, os tributos, o divisor e os preços calculados pelo motor.</p>
        {d.cells.map((c) => {
          const title = `Memória de cálculo · ${ECON_LOT_LABELS[c.lot]} · ${c.ritmo === 'unico' ? 'pagamento único' : 'mensal'}`;
          return <details key={c.key} className="border border-line p-3" aria-label={title}>
            <summary className="cursor-pointer text-xs font-semibold text-primary">{title}</summary>
            <div className="mt-3">
              {c.result ? <Memory r={c.result} /> : <p className="text-xs text-muted">Esta fotografia não tem o detalhamento da cesta. Salve um novo cálculo para gerar sua memória.</p>}
            </div>
          </details>;
        })}
      </div>}
    </section>
  );
}

function PriceRuler({ r }: { r: EconResult }) {
  const min = r.floor.minCents, sug = r.suggestedCents ?? r.recommendedCents;
  const p = r.decision?.basis === 'proposto' ? r.decision.priceCents : null;
  if (min == null || sug == null || sug <= 0) return null; // sem custos não há régua para mostrar
  const top = Math.max(sug, p ?? 0, min) * 1.15 || 1;
  const pc = (v: number) => Math.min(100, (v / top) * 100);
  const at = (v: number) => `${pc(v)}%`;
  return (
    <div className="mt-3" aria-label="Preço proposto comparado ao mínimo e ao sugerido">
      <div className="relative h-2.5 bg-surface-2">
        <div className="absolute inset-y-0 left-0 bg-danger/25" style={{ width: at(min) }} />
        <div className="absolute inset-y-0 bg-warning/20" style={{ left: at(min), width: `calc(${at(sug)} - ${at(min)})` }} />
        <div className="absolute inset-y-0 right-0 bg-success/25" style={{ left: at(sug) }} />
        <div className="absolute -top-1 w-1 bg-primary" style={{ left: at(sug), height: 18 }} title={`Sugerido ${fmtBRL(sug)}`} />
        {p != null && <div className="absolute -top-1 w-1 bg-ink" style={{ left: at(p), height: 18 }} title={`Proposto ${fmtBRL(p)}`} />}
      </div>
      <div className="mt-1.5 flex flex-wrap justify-end gap-x-4 gap-y-0.5 text-2xs text-muted">
        <span className="flex items-center gap-1"><span className="h-2 w-2 bg-danger/40" aria-hidden />Mínimo (margem no piso) <b className="num text-ink">{fmtBRL(min)}</b></span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-1 bg-primary" aria-hidden />Sugerido <b className="num text-ink">{fmtBRL(sug)}</b></span>
        {p != null && <span className="flex items-center gap-1"><span className="h-2.5 w-1 bg-ink" aria-hidden />Proposto <b className="num text-ink">{fmtBRL(p)}</b></span>}
      </div>
    </div>
  );
}

/**
 * Desdobramento financeiro da oportunidade: o que entra (+), o que sai (−) e os resultados (=). Na recorrente, o mês do
 * período de amortização (1..D), o mês depois do payback (D+1..N, sem amortização) e o contrato (soma exata dos meses).
 * O % de cada resultado é sobre a receita da própria coluna (mesma conta da exportação).
 */
function Dre({ r }: { r: EconResult }) {
  const rec = r.mode === 'recorrente', N = rec ? r.term.N : 1, D = r.term.D;
  const k = r.kpi!;
  const rows = econDre(r, fmtBRL);
  const after = rec && !!r.statement?.after;
  const from = r.statement?.afterFrom ?? D + 1;
  const money = (v: number) => (v < 0 ? `− ${fmtBRL(-v)}` : fmtBRL(Math.abs(v)));
  const signCls = { '+': 'text-[rgb(var(--chart-in))]', '−': 'text-[rgb(var(--chart-out))]', '=': 'text-muted' };
  const cell = (v: number | null | undefined, p: number | null | undefined, tone?: boolean) => (
    <td className={clsx('num py-1 pr-1 text-right align-top', tone && v != null && (v < 0 ? 'text-danger' : 'text-success'))}>
      {v == null ? <span className="text-muted">—</span> : money(v)}
      {p != null && <span className="block text-2xs font-normal text-muted">{pct(p, 2)}</span>}
    </td>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <caption className="mb-1 text-left text-xs font-semibold text-muted">Desdobramento financeiro</caption>
        <thead className="text-2xs text-muted"><tr>
          <th className="w-6" /><th className="py-1 text-left font-medium" />
          {rec && <th className="py-1 pr-1 text-right font-medium">{after ? `Por mês (1–${D}, com amortização)` : 'Por mês'}</th>}
          {after && <th className="py-1 pr-1 text-right font-medium">Por mês ({from}–{N}, sem amortização)</th>}
          <th className="py-1 pr-1 text-right font-medium">{rec ? `No contrato (${N} meses)` : 'Na venda'}</th>
        </tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={clsx(row.sign === '=' && 'border-t border-line', row.strong && 'font-semibold text-ink', row.tone && 'bg-surface-2')}>
              <td className={clsx('py-1 pl-1 text-center align-top font-bold', signCls[row.sign])} aria-label={row.sign === '+' ? 'soma' : row.sign === '−' ? 'dedução' : 'resultado'}>{row.sign}</td>
              <td className="py-1 align-top">{row.label}{row.note && <span className="block text-2xs font-normal text-muted">{row.note}</span>}</td>
              {rec && cell(row.month, row.pct?.month, row.tone)}
              {after && cell(row.after, row.pct?.after, row.tone)}
              {cell(row.total, row.pct?.total, row.tone)}
            </tr>
          ))}
        </tbody>
      </table>
      {k.npvCents != null && <p className="mt-1 text-xs text-muted">Em valor de hoje, descontando a TMA de {pct(r.rates.r * 100, 2)} ao mês, o resultado é <b className="num text-ink">{money(k.npvCents)}</b> (VPL).</p>}
      {rec && after && (r.investmentCents ?? 0) > 0 && (
        <p className="mt-1 text-xs text-muted">
          O investimento é devolvido com a TMA em {D} {D === 1 ? 'mês' : 'meses'} (parcela da anuidade). O payback de caixa
          {k.paybackMonths == null ? ' não fecha no prazo' : <> é <b className="num text-ink">{k.paybackMonths.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses</b></>}: sai antes de {D} porque a margem de contribuição também entra no caixa.
        </p>
      )}
    </div>
  );
}

/** Memória de cálculo em passos: cada linha com a fórmula e os números que entraram nela (mesma função do CSV e do PDF). */
function Memory({ r, settings }: { r: EconResult; settings?: EconSettings | null }) {
  const steps = econMemory(r, fmtBRL, { legacy: { oneTimeX100: settings?.legacyOneTimeX100, recurringX100: settings?.legacyRecurringX100 } });
  return (
    <ol className="space-y-3" aria-label="Memória de cálculo">
      {steps.map((s, n) => (
        <li key={s.key}>
          <Disclosure title={s.title} hint={s.desc} index={n + 1} defaultOpen={s.key === 'decisao'}>
          <dl className="divide-y divide-line">
            {s.rows.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-3 px-3 py-1.5">
                <dt className="min-w-0">
                  <span className={clsx('text-sm', row.strong ? 'font-semibold text-ink' : 'text-text')}>{row.label}</span>
                  {row.formula && <span className="block break-words font-mono text-2xs text-muted">{row.formula}</span>}
                </dt>
                <dd className={clsx('num shrink-0 text-right text-sm', row.strong && 'font-semibold', row.ok === true ? 'text-success' : row.ok === false ? 'text-danger' : 'text-ink')}>{row.value}</dd>
              </div>
            ))}
          </dl>
          {s.note && <p className="border-t border-line bg-warning-soft/40 px-3 py-2 text-xs text-ink">{s.note}</p>}
          </Disclosure>
        </li>
      ))}
    </ol>
  );
}

/** Leitura rápida do resultado: veredito, uma frase e quatro números. Detalhes só para quem abrir. */
function CalculationBanner({ r }: { r: EconResult }) {
  return (
<div className={clsx('border-l-4 p-3', TONE[r.verdict].bar)}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-md font-bold text-ink">{ECON_VERDICT_LABELS[r.verdict]}</p>
          {r.fiscal && <span className="inline-flex items-center border-2 border-primary bg-primary/10 px-2 py-0.5 text-sm font-bold text-primary" aria-label={`Resultado gerado com a vigência fiscal ${r.fiscal.year}`}>Vigência fiscal {r.fiscal.year} · {r.fiscal.regime === 'reforma' ? 'Reforma Tributária' : 'regime atual'}</span>}
          {r.decision && <Badge dot={r.decision.basis === 'proposto' ? DEC[r.verdict].dot : SUG.dot}>decisão no preço {r.decision.basis}</Badge>}
          {r.withReservations && <Chip tone="yellow">Calculável com ressalvas</Chip>}
        </div>
        <p className="mt-1 text-sm text-text">{econHeadline(r, fmtBRL)}</p>
        {r.fiscal && (
          <p className="mt-1 text-xs text-muted" aria-label="Envelope fiscal da simulação">
            Tributos da nota {(r.fiscal.docs ?? []).map((x) => `${x.name} ${pct(x.percentBp / 100, 2)}${x.fromYear != null && x.fromYear !== r.fiscal!.year ? ` (de ${x.fromYear})` : x.fromYear == null ? ' (cadastro atual)' : ''}`).join(' · ') || 'sem documento fiscal'} · IRPJ/CSLL {r.fiscal.profitTaxBp == null ? '—' : pct(r.fiscal.profitTaxBp / 100, 2)}{r.fiscal.profitTaxSource === 'envelope' ? ` (empresa, ${r.fiscal.envelope?.year})` : ' (parâmetros)'}{r.fiscal.retentions?.length ? ` · retenções na fonte (${r.fiscal.retentions.map((x) => x.label.split(' ')[0]).join(', ')}) fora do cálculo` : ''}
          </p>
        )}
      </div>
  );
}

function AdvancedCalculation({ r, settings, open, onClose, title = 'Cálculo avançado' }: { r: EconResult; settings?: EconSettings | null; open: boolean; onClose: () => void; title?: string }) {
  return <Modal open={open} onClose={onClose} title={title} size="xl" footer={<Button variant="primary" onClick={onClose}>Fechar</Button>}>
    <div className="space-y-3">
      <CalculationBanner r={r} />
      <Memory r={r} settings={settings} />
      {r.kpi && r.priceCents != null && <Disclosure title="Desdobramento financeiro" defaultOpen><Dre r={r} /></Disclosure>}
      {r.recommendation && <Disclosure title="Faixa de preço viável"><TargetSeek r={r} per={r.mode === 'recorrente' ? '/mês' : ''} /></Disclosure>}
      {r.deal?.cells && <Disclosure title="Preço por cesta"><CellsTable r={r} /></Disclosure>}
      <Disclosure title="Documentos fiscais e avisos">
          <p className="text-2xs text-muted">Motor {r.engineVersion ?? 'anterior'}. Tributo fixo contado uma vez por documento fiscal (fatura).</p>
          {!!r.items.length && (
            <table className="w-full text-xs">
              <thead className="text-muted"><tr><th className="py-1 text-left font-medium">Produto</th><th className="py-1 text-left font-medium">Documento fiscal</th><th className="py-1 text-right font-medium">Peso na receita</th><th className="py-1 text-right font-medium">Tributos</th></tr></thead>
              <tbody>{r.items.map((i, n) => <tr key={n} className="border-t border-line"><td className="py-1">{i.description}</td><td className={clsx('py-1', i.pending && 'text-[#C2610C]')}>{i.doc ?? 'sem documento'}{i.docVersion ? ` · tributos v${i.docVersion}` : ''}</td><td className="num py-1 text-right">{pct(i.weight * 100)}</td><td className="num py-1 text-right">{pct(i.percentBp / 100, 2)}{i.fixedCents ? ` + ${fmtBRL(i.fixedCents)}` : ''}</td></tr>)}</tbody>
            </table>
          )}
          {!!r.warnings.length && <ul className="list-disc space-y-0.5 pl-5 text-xs text-[#C2610C]">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      </Disclosure>
    </div>
  </Modal>;
}

function BasicCalculation({ r, onAdvanced }: { r: EconResult; onAdvanced: () => void }) {
  const steps = econMemory(r, fmtBRL);
  const rows = steps.flatMap((s) => s.rows).filter((row) => ['Investimento inicial (I)', 'Custos mensais (O)', 'Tributos sobre o preço (a)'].includes(row.label));
  const price = steps.flatMap((s) => s.rows).find((row) => row.label === 'Preço sugerido');
  return <section className="space-y-3" aria-label="Cálculo básico">
    <dl className="divide-y divide-line text-sm">
      {rows.map((row) => <div key={row.label} className="flex items-start justify-between gap-3 py-2"><dt><span className="font-semibold text-ink">{row.label}</span>{row.formula && <span className="block font-mono text-2xs text-muted">{row.formula}</span>}</dt><dd className="num shrink-0 font-semibold text-ink">{row.value}</dd></div>)}
      <div className="flex items-start justify-between gap-3 py-2"><dt className="min-w-0"><span className="font-semibold text-ink">Preço sugerido</span><span className="block text-2xs text-muted">{r.deal ? 'Soma das cestas, separada em pagamento único e mensalidade.' : price?.formula}</span></dt><dd className="num shrink-0 text-right font-bold text-primary">{fmtBRL(r.suggestedCents ?? r.recommendedCents)}{r.mode === 'recorrente' ? '/mês' : ''}{r.suggestedOneTimeCents != null && <span className="block text-xs">+ {fmtBRL(r.suggestedOneTimeCents)} único</span>}</dd></div>
    </dl>
    <div className="flex justify-end"><Button variant="primary" onClick={onAdvanced}>Ver cálculo avançado</Button></div>
  </section>;
}

function ProductTotals({ r, profiles }: { r: B2gResult | null | undefined; profiles: CostProfile[] }) {
  if (!r) return null;
  const g = r.global;
  const baskets = r.baskets?.filter((b) => profiles.includes(b.profile)) ?? [];
  const facts = r.blocked.length ? [['Custo global do contrato', fmtBRL(g.costCents)]] : [['Valor global', fmtBRL(g.priceCents)], ['Custo global do contrato', fmtBRL(g.costCents)], ['Markup efetivo (resultado)', g.markup == null ? '—' : `${g.markup.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×`], ['Margem líquida', `${fmtBRL(g.netCents)} · ${pct(g.netPct)}`], ['Piso global', fmtBRL(g.floorCents)], ['Desconto máximo', pct(g.maxDiscountPct)]];
  return <div className="space-y-3">
    {!!baskets.length && <dl className={clsx('grid gap-2', baskets.length === 2 ? 'sm:grid-cols-2' : baskets.length === 3 && 'sm:grid-cols-3')} aria-label="Custos totais por cesta">{baskets.map((b) => <div key={b.profile} className="border border-line p-3 text-xs"><dt className="font-semibold text-ink">{b.profile === 'fornecimento' ? 'Fornecimento' : b.profile === 'instalacao' ? 'Serviço de Instalação (Sem recorrência)' : 'Serviço Fornecimento + Instalação'}</dt><dd className="num mt-1 font-bold text-ink">{fmtBRL(b.costCents)}</dd>{b.baseCents != null && <dd className="mt-1 text-2xs text-muted">Base {fmtBRL(b.baseCents)} + contingência {fmtBRL(b.contingencyCents ?? 0)}{b.serviceInvestmentCents ? ` + inferência custo de serviço (${((b.serviceCostBp ?? 3500) / 100).toLocaleString('pt-BR')}%) ${fmtBRL(b.serviceInvestmentCents)}` : ''}{b.serviceMonthlyCents ? ` + inferência custo de serviço (${((b.serviceCostBp ?? 3500) / 100).toLocaleString('pt-BR')}%) ${fmtBRL(b.serviceMonthlyCents)}/mês` : ''}{b.variableFixedCents ? ` + entrega/taxas ${fmtBRL(b.variableFixedCents)}` : ''}</dd>}<dd className="mt-1 text-2xs text-muted">Investimento {fmtBRL(b.investmentCents)}{b.monthlyCostCents > 0 ? ` + ${fmtBRL(b.monthlyCostCents)}/mês durante a vigência` : ''}</dd></div>)}</dl>}
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 bg-surface-2 p-3 text-xs sm:grid-cols-3" aria-label="Resumo dos preços por produto">{facts.map(([label, value]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="num font-semibold text-ink">{value}</dd></div>)}</dl>
  </div>;
}

export function EconomicsResult({ r, compact = false, settings }: { r: EconResult; compact?: boolean; settings?: EconSettings | null }) {
  const [open, setOpen] = useState(false);
  const per = r.mode === 'recorrente' ? '/mês' : '';
  const k = r.kpi;
  return (
    <div>
      <PriceBasis r={r} per={per} settings={settings} compact={compact} />
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge dot={r.decision ? SUG.dot : 'bg-line-strong'}>{r.decision ? 'Indicadores no preço sugerido' : 'Indicadores'}</Badge>
      </div>
      <dl className={clsx('mt-1.5 grid gap-2', compact ? 'grid-cols-[repeat(auto-fit,minmax(140px,1fr))]' : 'grid-cols-[repeat(auto-fit,minmax(150px,1fr))]')}>
        <div className="min-w-0 border-l-2 border-primary/60 bg-surface-2 p-2.5 [overflow-wrap:break-word]"><dt className="text-xs text-muted">Margem de contribuição{r.mode === 'recorrente' ? ' (1º mês)' : ''}</dt><dd className={clsx('num font-bold', k && k.marginPct < (r.rates.mMin ?? r.rates.m) * 100 - 1e-6 ? 'text-[#C2610C]' : 'text-ink')}>{pct(k?.marginPct)}</dd><dd className="text-2xs text-muted">piso {pct((r.rates.mMin ?? r.rates.m) * 100, 0)}</dd></div>
        {(() => { const c = econCompare(r, { oneTimeX100: settings?.legacyOneTimeX100, recurringX100: settings?.legacyRecurringX100 }); return (
          <div className="min-w-0 border-l-2 border-primary/60 bg-surface-2 p-2.5 [overflow-wrap:break-word]" title="(preço sugerido − custo) ÷ custo"><dt className="text-xs text-muted">Markup efetivo</dt><dd className="num font-bold text-ink">{r.deal ? '—' : pct(c.engine.markupPct, 1)}</dd><dd className="text-2xs text-muted">{r.deal ? 'por cesta no comparativo' : `sobre ${c.baseLabel}`}</dd></div>
        ); })()}
        <div className="min-w-0 border-l-2 border-primary/60 bg-surface-2 p-2.5 [overflow-wrap:break-word]"><dt className="text-xs text-muted">Payback do investimento</dt><dd className="num font-bold text-ink">{k ? months(k.investmentPaybackMonths !== undefined ? k.investmentPaybackMonths : k.paybackMonths) : '—'}</dd><dd className="text-2xs text-muted">contado do 1º faturamento · pedido {r.term.D} meses{k?.investmentPaybackMonths !== undefined && k?.paybackMonths != null ? ` · de caixa ${months(k.paybackMonths)}` : ''}</dd></div>
        <div className="min-w-0 border-l-2 border-primary/60 bg-surface-2 p-2.5 [overflow-wrap:break-word]"><dt className="text-xs text-muted">Ganho no contrato (VPL)</dt><dd className={clsx('num font-bold', k && k.npvCents < 0 ? 'text-danger' : 'text-ink')}>{fmtBRL(k?.npvCents ?? null)}</dd><dd className="text-2xs text-muted">TIR {k?.irrAnnual == null ? '—' : k.irrAnnual > 10 ? 'acima de 1.000%' : pct(k.irrAnnual * 100)} ao ano</dd></div>
      </dl>
      {k?.margins && (() => { const cm = contractMargins(r); return cm ? <MarginChain m={cm} per="" compact={compact} contract={cm.months} firstMonthNetPct={k.margins.netPct} /> : <MarginChain m={k.margins} per={per} compact={compact} />; })()}
      <PriceRuler r={r} />
      <button type="button" onClick={() => setOpen(true)} className="mt-3 text-xs font-semibold text-primary hover:underline">Ver cálculo avançado</button>
      <AdvancedCalculation r={r} settings={settings} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

const exportHref = (oppId: string, runId: string, format: 'pdf' | 'csv') => `/api/v1/opportunities/${oppId}/economics/runs/${runId}/export?format=${format}`;
const emitterLine = (e: NonNullable<Data['emitter']>) => [e.name, e.cnpj ? `CNPJ ${e.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}` : null, e.taxRegime ? TAX_REGIME_LABELS[e.taxRegime as TaxRegime] ?? e.taxRegime : null, e.city ? `${e.city}${e.state ? `/${e.state}` : ''}` : null].filter(Boolean).join(' · ');

/** B2G: formulário ⇄ entrada salva (percentuais em pontos-base; peso em fração; lance em centavos) */
const b2gFormOf = (b: EconInput['b2g']): B2gForm => ({
  ...emptyB2gForm(), mode: b?.mode ?? 'A', overhead: bpText(b?.overheadBp ?? null), netTarget: bpText(b?.netTargetBp ?? null),
  mcForn: bpText(b?.contributionBp?.fornecimento ?? null), mcImpl: bpText(b?.contributionBp?.implantacao ?? null), mcInst: bpText(b?.contributionBp?.instalacao ?? null), solvePb: !!b?.solvePayback,
  weights: Object.fromEntries(Object.entries(b?.weights ?? {}).map(([k, v]) => [k, (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })])),
  bids: Object.fromEntries(Object.entries(b?.bids ?? {}).map(([k, v]) => [k, money(v)])),
});
const b2gInputOf = (b: B2gForm): NonNullable<EconInput['b2g']> => {
  const ok = (v: number | null) => (v == null || Number.isNaN(v) ? null : v);
  const weights: Record<string, number> = {}, bids: Record<string, number> = {};
  for (const [k, v] of Object.entries(b.weights)) { const n = Number(v.replace(',', '.')); if (v.trim() && Number.isFinite(n) && n >= 0 && n <= 100) weights[k] = n / 100; }
  for (const [k, v] of Object.entries(b.bids)) { const n = parseMoney(v); if (n != null && n >= 0) bids[k] = n; }
  return { mode: b.mode, overheadBp: ok(parseBp(b.overhead)), netTargetBp: ok(parseBp(b.netTarget)), contributionBp: { fornecimento: ok(parseBp(b.mcForn)), implantacao: ok(parseBp(b.mcImpl)), instalacao: ok(parseBp(b.mcInst)) }, solvePayback: b.solvePb, weights, bids };
};
const formKey = (f: object) => JSON.stringify(f, (k, v) => (k === 'key' ? undefined : v));

/** Veredito sem números, para quem não vê valores financeiros. */
function HiddenVerdict({ r }: { r: Pick<EconResult, 'verdict' | 'withReservations'> }) {
  return (
    <div className={clsx('border-l-4 p-3', TONE[r.verdict].bar)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-md font-bold text-ink">{ECON_VERDICT_LABELS[r.verdict]}</p>
        {r.withReservations && <Chip tone="yellow">Calculável com ressalvas</Chip>}
      </div>
      <p className="mt-1 text-sm text-muted">Valores ocultos para o seu perfil.</p>
    </div>
  );
}

function HiddenEconomics({ d }: { d: Data }) {
  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-md font-bold text-ink"><Calculator className="h-5 w-5 text-primary" aria-hidden />Viabilidade econômica</h2>
      {d.result ? <HiddenVerdict r={d.result} /> : <Notice tone="info">Ainda não preenchida.</Notice>}
      <p className="text-sm text-muted">Seu perfil não vê valores financeiros: custos, preço, margem e fluxo de caixa ficam com quem tem essa permissão, que também é quem preenche a viabilidade.</p>
    </div>
  );
}

const STATUS_LOOK: Record<EconStatus, { label: string; tone: 'neutral' | 'blue' | 'yellow' | 'green' | 'red' }> = {
  rascunho: { label: 'Não salva', tone: 'neutral' }, calculada: { label: 'Calculada', tone: 'blue' }, em_decisao: { label: 'Em decisão da gestão', tone: 'yellow' },
  aprovada: { label: 'Aprovada pela gestão', tone: 'green' }, devolvida: { label: 'Devolvida', tone: 'red' },
};
const ACTION_LABEL = { enviada: 'Enviada para decisão', aprovada: 'Aprovada', devolvida: 'Devolvida' } as const;

/** Situação da decisão: enviar (quem preenche), aprovar ou devolver com motivo (gestão e diretoria) e o histórico. */
function DecisionBar({ oppId, d, canSubmit }: { oppId: string; d: Data; canSubmit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState<string | null>(null);
  const done = (msg: string) => { setReason(null); void qc.invalidateQueries({ queryKey: ['economics', oppId] }); void qc.invalidateQueries({ queryKey: ['econ-pending'] }); toast({ tone: 'success', message: msg }); };
  const submit = useMutation({ mutationFn: () => api<{ status: string; autoApproved?: boolean }>(`/opportunities/${oppId}/economics/submit`, { method: 'POST', body: {} }), onSuccess: (r) => done(r.autoApproved ? 'Aprovada automaticamente: VPL positivo, TIR acima da TMA, margem e payback na política' : 'Fora das regras automáticas: enviada para a alçada superior'), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const decide = useMutation({
    mutationFn: (body: { decision: 'aprovar' | 'devolver'; reason?: string }) => api(`/opportunities/${oppId}/economics/decision`, { method: 'POST', body }),
    onSuccess: (_r, v) => done(v.decision === 'aprovar' ? 'Viabilidade aprovada' : 'Viabilidade devolvida'), onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const look = STATUS_LOOK[d.status];
  const lastReturn = d.status === 'devolvida' ? d.decisions.find((x) => x.action === 'devolvida') : undefined;
  return (
    <section className="border border-line p-3" aria-label="Decisão da viabilidade">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">Decisão:</span><Chip tone={look.tone}>{look.label}</Chip></div>
        <div className="flex flex-wrap gap-2">
          {(d.status === 'calculada' || d.status === 'devolvida') && <Button size="sm" variant="primary" disabled={!canSubmit} loading={submit.isPending} title={canSubmit ? undefined : d.result?.priceSource === 'sugerido' ? 'Defina o preço (nos produtos ou no campo Preço) antes de enviar' : 'Salve o cálculo atualizado antes de enviar'} onClick={() => submit.mutate()}>Enviar para decisão da gestão</Button>}
          {d.canDecide && reason === null && <><Button size="sm" variant="primary" loading={decide.isPending} onClick={() => decide.mutate({ decision: 'aprovar' })}>Aprovar</Button><Button size="sm" onClick={() => setReason('')}>Devolver</Button></>}
        </div>
      </div>
      {lastReturn?.reason && <p className="mt-2 text-sm text-text">Motivo da devolução ({lastReturn.actorName ?? 'gestão'}): {lastReturn.reason}</p>}
      {reason !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input aria-label="Motivo da devolução" className="h-9 min-w-[240px] flex-1" placeholder="O que precisa mudar?" value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
          <Button size="sm" variant="primary" disabled={reason.trim().length < 5} loading={decide.isPending} onClick={() => decide.mutate({ decision: 'devolver', reason: reason.trim() })}>Devolver</Button>
          <Button size="sm" variant="ghost" onClick={() => setReason(null)}>Cancelar</Button>
        </div>
      )}
      {!!d.decisions.length && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted">Histórico de decisões ({d.decisions.length})</summary>
          <ul className="mt-1 divide-y divide-line">{d.decisions.map((x) => <li key={x.id} className="flex flex-wrap justify-between gap-2 py-1"><span>{fmtDateTime(x.createdAt)} · {x.actorName ?? 'sistema'} · {ACTION_LABEL[x.action]}{x.reason ? ` — ${x.reason}` : ''}</span></li>)}</ul>
        </details>
      )}
    </section>
  );
}

export function EconomicsTab({ oppId, onProducts }: { oppId: string; onProducts?: () => void }) {
  const qc = useQueryClient(), toast = useToast();
  const q = useQuery({ queryKey: ['economics', oppId], queryFn: () => api<Data>('/opportunities/' + oppId + '/economics') });
  type GlobalForm = { source: EconInput; version: string | null; baskets: Record<EconCostProfile, BasketForm>; variable: string; loss: string; year: string };
  const [form, setForm] = useState<GlobalForm | null>(null);
  const [advancedProfile, setAdvancedProfile] = useState<EconCostProfile | null>(null);
  const [itemsProfile, setItemsProfile] = useState<EconCostProfile | null>(null);
  const profiles = useMemo(() => [...new Set((q.data?.items ?? []).map((i) => defaultCostProfile(i.kind ?? (q.data?.input?.mode === 'pontual' ? 'venda' : 'recorrencia'))))], [q.data?.items, q.data?.input?.mode]);
  const model = useMemo(() => { try { return buildModel(q.data?.modelOverrides ?? []); } catch { return undefined; } }, [q.data?.modelOverrides]);
  useEffect(() => {
    const d = q.data;
    if (form || !d?.input || d.financeHidden) return;
    const i = d.input, st = d.settings;
    let legacy: EconBasketView[] = [];
    if (st && (i.priceCents != null || i.salePriceCents != null)) {
      const r = financeEngine({ input: i, items: d.items, settings: st, publicSector: d.publicSector, fiscal: d.fiscal, model });
      legacy = econBasketViews(i, d.items, st, r);
    }
    const mixed = profiles.includes('implantacao');
    const baskets = Object.fromEntries((['fornecimento', 'instalacao', 'implantacao'] as const).map((profile) => {
      const own = i.baskets?.[profile];
      const oldPrice = profile === 'implantacao' ? i.priceCents : mixed ? i.salePriceCents : i.priceCents;
      const inheritedPrice = oldPrice != null ? legacy.find((v) => v.profile === profile)?.result.decision?.priceCents : null;
      return [profile, { margin: rateText(own?.netTargetBp ?? i.b2g?.netTargetBp ?? st?.netMarginTargetBp), payback: st ? String(Math.min(own?.paybackMonths ?? i.paybackMonths ?? econPaybackLimit(i, st, d.publicSector), econPaybackLimit(i, st, d.publicSector))) : '', price: money(own?.priceCents ?? inheritedPrice ?? null) }];
    })) as Record<EconCostProfile, BasketForm>;
    setForm({ source: { ...i, pricingMode: 'global', priceCents: null, salePriceCents: null, paybackMonths: null, b2g: { ...i.b2g, netTargetBp: null } }, version: d.saved?.updatedAt ?? null, baskets, variable: rateText(i.variableBp), loss: rateText(i.lossBp), year: i.fiscalYear ? String(i.fiscalYear) : '' });
  }, [q.data, form, model, profiles]);
  const input = useMemo<EconInput | null>(() => {
    if (!form) return null;
    const baskets = { ...form.source.baskets };
    for (const profile of profiles) {
      const f = form.baskets[profile];
      baskets[profile] = { ...baskets[profile], netTargetBp: f.margin.trim() ? parseRate(f.margin) : q.data?.settings?.netMarginTargetBp ?? null, paybackMonths: profile === 'implantacao' && f.payback.trim() ? Number(f.payback) : null, priceCents: f.price.trim() ? parseMoney(f.price) ?? -1 : null };
    }
    return { ...form.source, baskets, pricingMode: 'global', variableBp: parseRate(form.variable), lossBp: parseRate(form.loss), fiscalYear: form.year.trim() ? Number(form.year) : null };
  }, [form, profiles, q.data?.settings?.netMarginTargetBp]);
  const errors = useMemo(() => input ? [...econInputErrors(input), ...(q.data?.settings ?  [...econTargetErrors(input, q.data.settings), ...econPaybackErrors(input, q.data.settings, q.data.publicSector)] : []), ...(form?.year && (form.year.length !== 4 || Number(form.year) < 2020 || Number(form.year) > 2100) ? ['Confira a vigência fiscal.'] : [])] : [], [input, q.data?.settings, q.data?.publicSector, form?.year]);
  const [debounced, setDebounced] = useState<EconInput | null>(null);
  useEffect(() => { const timer = setTimeout(() => setDebounced(input), 400); return () => clearTimeout(timer); }, [input]);
  const pending = JSON.stringify(debounced) !== JSON.stringify(input);
  const live = useMemo(() => {
    if (!debounced || !q.data?.settings || q.data.settings.netMarginTargetBp == null || errors.length || !model) return null;
    try { return financeEngine({ input: debounced, items: q.data.items, settings: q.data.settings, publicSector: q.data.publicSector, fiscal: q.data.fiscal, model }); } catch { return null; }
  }, [debounced, q.data, model, errors]);
  const [lastValid, setLastValid] = useState<EconResult | null>(null);
  useEffect(() => { if (live) setLastValid(live); }, [live]);
  const inputKey = (value: unknown) => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
  const official = !!q.data?.saved && q.data.input?.pricingMode === 'global' && !q.data.stale && inputKey(input) === inputKey(q.data.input);
  const result = official ? q.data?.result ?? live : live ?? lastValid;
  const views = useMemo(() => result && input && q.data?.settings ? econBasketViews(input, q.data.items, q.data.settings, result) : [], [result, input, q.data]);
  const b2g = useMemo(() => {
    if (!result || !input || !q.data?.settings || errors.length) return null;
    try { return b2gFromEconomics({ input, items: q.data.items, settings: q.data.settings, publicSector: q.data.publicSector, fiscal: q.data.fiscal }, result.fiscal?.profitTaxBp ?? null, result); } catch { return null; }
  }, [result, input, q.data, errors]);
  const save = useMutation({
    mutationFn: (draft: { input: EconInput; version: string | null }) => api('/opportunities/' + oppId + '/economics', { method: 'PUT', body: { ...draft.input, economicsUpdatedAt: draft.version } }),
    onSuccess: async () => { await qc.refetchQueries({ queryKey: ['economics', oppId] }); setForm(null); toast({ tone: 'success', message: 'Viabilidade econômica salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.data?.financeHidden) return <HiddenEconomics d={q.data} />;
  if (!q.data || !form || !input) return <LoadingRows rows={5} />;
  const d = q.data, st = d.settings;
  if (!st) return <Notice tone="warning">Configure os parâmetros em Configurações → Viabilidade para calcular a negociação.</Notice>;
  const editable = d.editable && !save.isPending;
  const outdated = form.version !== (d.saved?.updatedAt ?? null);
  const canSave = editable && errors.length === 0 && st.netMarginTargetBp != null && !outdated && profiles.length > 0;
  const setBasket = (profile: EconCostProfile, patch: Partial<BasketForm>) => setForm((f) => f ? { ...f, baskets: { ...f.baskets, [profile]: { ...f.baskets[profile], ...patch } } } : f);
  const activeAdvanced = views.find((v) => v.profile === advancedProfile);
  const activeItems = views.find((v) => v.profile === itemsProfile) ?? null;
  const targetOf = (profile: EconCostProfile) => input.baskets?.[profile]?.netTargetBp ?? st.netMarginTargetBp;
  const targetInvalid = (profile: EconCostProfile) => {
    const n = targetOf(profile);
    return n != null && (!Number.isFinite(n) || (st.netMarginMinBp != null && n < st.netMarginMinBp) || (st.netMarginMaxBp != null && n > st.netMarginMaxBp));
  };
  return <div className="space-y-4" aria-label="Viabilidade global">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-md font-bold text-ink"><Calculator className="h-5 w-5 text-primary" />Viabilidade econômica</h2><p className="mt-1 text-sm text-muted">Precificação global por cesta. Os custos vêm de Produtos e serviços; ajuste a margem líquida e o payback de cada cesta.</p></div><div className="flex flex-wrap gap-2"><Chip tone={official ? 'green' : 'yellow'}>{official ? 'Salvo' : pending ? 'Recalculando…' : 'Simulação — ainda não salva'}</Chip>{result && !errors.length && <Chip tone={TONE[result.verdict].chip}>{ECON_VERDICT_LABELS[result.verdict]}</Chip>}</div></div>
    {onProducts && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={onProducts}>Editar produtos e custos</button>}
    {d.stale && <Notice tone="warning">Produtos, tributos ou parâmetros mudaram desde o último cálculo salvo. Confira e salve novamente antes de pedir aprovação.</Notice>}
    {outdated && <Notice tone="warning"><p>Outro cálculo foi salvo depois que esta tela foi aberta. Recarregue os valores para preservar as alterações recentes.</p><Button size="sm" onClick={() => setForm(null)}>Recarregar cálculo</Button></Notice>}
    <DecisionBar oppId={oppId} d={d} canSubmit={official && !d.stale && d.editable && !errors.length && views.length > 0 && views.every((v) => v.result.decision?.basis === 'proposto') && !result?.withReservations} />
    {!!d.history.length && <details className="text-xs"><summary className="cursor-pointer font-semibold text-ink">Histórico de cálculos ({d.history.length})</summary><ul className="mt-2 divide-y divide-line">{d.history.map((h) => <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{fmtDateTime(h.createdAt)} · {h.actorName ?? 'sistema'} · {ECON_VERDICT_LABELS[h.verdict]}</span><span className="flex gap-3"><a className="text-primary" href={exportHref(oppId, h.id, 'pdf')}>PDF</a><a className="text-primary" href={exportHref(oppId, h.id, 'csv')}>CSV</a>{h.sha256 && <span className="text-success" title={h.sha256}>assinado {h.sha256.slice(0, 8)}</span>}</span></li>)}</ul></details>}
    {st.netMarginTargetBp == null && <Notice tone="warning">Configure a margem líquida esperada em Configurações → Viabilidade para calcular os preços.</Notice>}
    {!profiles.length && <Notice tone="info">Adicione os produtos e custos em Produtos e serviços. Os blocos aparecem conforme os perfis dos itens.</Notice>}
    <div className="grid items-start gap-4 lg:grid-cols-2">{views.map((view, index) => <BasketPanel key={view.profile} view={view} form={form.baskets[view.profile]} input={input} settings={st} index={index} disabled={!editable} pending={pending} invalid={errors.length > 0} targetInvalid={targetInvalid(view.profile)} onChange={(p) => setBasket(view.profile, p)} onUse={() => setBasket(view.profile, { price: money(view.result.suggestedCents ?? null) })} onAdvanced={() => setAdvancedProfile(view.profile)} onItems={() => setItemsProfile(view.profile)} />)}</div>
    {!views.length && profiles.length > 0 && st.netMarginTargetBp != null && !errors.length && <p className="text-sm text-muted">Calculando os preços das cestas…</p>}
    {!!errors.length && <Notice tone="warning"><p>Confira os parâmetros para calcular e salvar:</p><ul className="list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
    {!errors.length && views.length > 0 && views.every((v) => v.evaluation.statement) && <BusinessOverview views={views} input={input} settings={st} />}
    {activeAdvanced && <AdvancedCalculation r={activeAdvanced.evaluation} settings={{ ...st, netMarginTargetBp: targetOf(activeAdvanced.profile) }} open title={'Cálculo avançado — ' + basketName(activeAdvanced)} onClose={() => setAdvancedProfile(null)} />}
    <ItemValuesModal view={activeItems} items={d.items} result={b2g} onClose={() => setItemsProfile(null)} />
    {d.editable && <div className="flex justify-end"><Button variant="primary" disabled={!canSave} loading={save.isPending} onClick={() => save.mutate({ input, version: form.version })}>Salvar viabilidade</Button></div>}
    {!!result?.warnings.length && <details className="text-xs"><summary className="cursor-pointer font-semibold text-muted">Avisos do cálculo ({result.warnings.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul></details>}
  </div>;
}

/** Painel lateral "Viabilidade da venda": o resultado salvo, em poucas linhas. */
export function EconomicsSummary({ oppId, onOpen }: { oppId: string; onOpen: () => void }) {
  const q = useQuery({ queryKey: ['economics', oppId], queryFn: () => api<Data>(`/opportunities/${oppId}/economics`) });
  const d = q.data;
  const r = d?.result;
  if (!d?.saved || !r) return null;
  return (
    <section className="card p-4" aria-labelledby="econ-sum">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="econ-sum" className="flex items-center gap-2 font-bold text-ink"><Calculator className="h-5 w-5 text-primary" aria-hidden />Viabilidade da venda <Chip tone={STATUS_LOOK[d.status].tone}>{STATUS_LOOK[d.status].label}</Chip></h2>
        <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={onOpen}>Abrir</button>
      </div>
      <p className="mb-2 text-2xs text-muted">Último cálculo salvo ({fmtDateTime(d.saved.updatedAt)}). A aba Viabilidade econômica mostra a simulação ao vivo; salve lá para atualizar este painel.</p>
      {d.stale && <Notice tone="warning">Desatualizada: produtos, tributos, parâmetros ou o motor mudaram depois de salva. Abra e salve de novo.</Notice>}
      {d.financeHidden ? <HiddenVerdict r={r} /> : <EconomicsResult r={r} compact settings={d.settings} />}
    </section>
  );
}
