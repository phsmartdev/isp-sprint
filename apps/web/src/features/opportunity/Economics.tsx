/**
 * Viabilidade econômica da oportunidade (motor financeiro): custos da venda e da entrega, condições comerciais
 * e o resultado na hora — preço mínimo, recomendado, margem, payback, VPL e TIR — numa leitura rápida para o time.
 * O cálculo da tela usa o mesmo motor do servidor; ao salvar, o servidor recalcula e guarda a fotografia auditável.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Calculator, ChevronDown, ClipboardPaste, FileSpreadsheet, Maximize2, Plus, Trash2 } from 'lucide-react';
import {
  COST_IMPACTS, COST_IMPACT_LABELS, DEAL_KINDS, DEAL_KIND_LABELS, ECON_LOT_LABELS, ECON_VERDICT_LABELS, econCompare, isMonthlyKind, isOneTimeKind, lotOfKind, type EconLot, type DealKind, costLineTotal, costQty, econDre, econMemory, parseCostTable, econHeadline, emptyEconInput, financeEngine, parseMoney,
  buildModel, type FinOverride, type FiscalArgs, type CostImpact, type EconInput, type EconItem, type EconResult, type EconSettings, type EconVerdict,
} from '@isp/domain';
import { TAX_REGIME_LABELS, type TaxRegime } from '@isp/shared';
import { api } from '../../lib/api';
import { fmtBRL, fmtDateTime } from '../../lib/format';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { CashflowChart, flowSeries } from '../../components/charts/Cashflow';
import { errMsg } from '../contracts/shared';

type Data = {
  settings: EconSettings | null; items: EconItem[]; publicSector: boolean; input: EconInput; saved: { updatedAt: string } | null;
  /** fórmulas publicadas no Financial Studio (a prévia usa o mesmo modelo do servidor) */
  modelOverrides?: FinOverride[];
  /** resultado SALVO (consultar não recalcula); stale = produtos, tributos ou parâmetros mudaram desde então */
  result: EconResult | null; stale: boolean; editable: boolean;
  emitter: { name: string; cnpj: string | null; taxRegime: string | null; city: string | null; state: string | null; ibgeCode?: string | null } | null;
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
type Line = { key: string; description: string; qty: string; unit: string; measure?: string | null; impact?: CostImpact | null; costItemId?: string | null; kind?: DealKind | null };
type CatalogItem = { id: string; name: string; kind: 'investimento' | 'mensal'; unit: string; impact?: CostImpact | null; unitCents: number | null };

const TONE: Record<EconVerdict, { bar: string; chip: 'green' | 'blue' | 'orange' | 'red' | 'neutral' }> = {
  viavel: { bar: 'border-success bg-success-soft', chip: 'green' }, abaixo_recomendado: { bar: 'border-primary bg-primary-soft', chip: 'blue' },
  fora_politica: { bar: 'border-warning bg-warning-soft', chip: 'orange' }, abaixo_minimo: { bar: 'border-danger bg-danger-soft', chip: 'red' },
  inviavel: { bar: 'border-danger bg-danger-soft', chip: 'red' }, sem_preco: { bar: 'border-line bg-surface-2', chip: 'neutral' },
};
const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`);
const months = (v: number | null | undefined) => (v == null ? 'não se paga' : v === 0 ? 'imediato' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`);
const bpText = (bp: number | null) => (bp == null ? '' : (bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const parseBp = (t: string): number | null => { if (!t.trim()) return null; const n = Number(t.replace(',', '.')); return Number.isFinite(n) && n >= 0 && n < 100 ? Math.round(n * 100) : NaN; };
const money = (c: number | null) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
let seq = 0;
/** Quantidade sem separador de milhar ("8400", "2,5"): o ponto seria lido como decimal. */
const qtyText = (milli: number) => (milli / 1000).toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 3 });
const toLines = (l: EconInput['capex']): Line[] => l.map((x) => ({ key: `l${++seq}`, description: x.description, qty: qtyText(x.qtyMilli), unit: money(x.unitCents), measure: x.unit ?? null, impact: x.impact ?? null, costItemId: x.costItemId ?? null, kind: x.kind ?? null }));
const fromLines = (l: Line[]) => l.filter((x) => x.description.trim() || x.unit.trim()).map((x) => ({ description: x.description.trim(), qtyMilli: costQty(x.qty) ?? 0, unitCents: parseMoney(x.unit) ?? -1, unit: x.measure ?? null, impact: x.impact ?? null, costItemId: x.costItemId ?? null, kind: x.kind ?? null }));

/** Régua do preço: onde o preço proposto fica em relação ao mínimo e ao recomendado. */
/** Contribuição → operacional → líquida, em % da receita e R$ do período. */
function MarginChain({ m, per, compact }: { m: NonNullable<NonNullable<EconResult['kpi']>['margins']>; per: string; compact?: boolean }) {
  const steps = [
    { label: 'Margem de contribuição', cents: null as number | null, pct: m.contributionPct, hint: 'depois de tributos, despesas variáveis e custos (no preço sugerido = a margem escolhida)' },
    { label: 'Margem operacional', cents: m.operatingCents, pct: m.operatingPct, hint: `− amortização ${fmtBRL(m.amortizationCents)} · − despesas fixas ${fmtBRL(m.overheadCents)}` },
    { label: 'Margem líquida', cents: m.netCents, pct: m.netPct, hint: `− IR/CSLL ${fmtBRL(m.incomeTaxCents)}` },
  ];
  return (
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
          <p className="mt-1 text-xs text-text">Margem {pct(m, 1)}{c.engine.markupPct != null && !r.deal ? ` · markup efetivo ${pct(c.engine.markupPct, 1)}` : ''}</p>
          <p className="mt-1 text-2xs text-muted">custos ÷ (1 − tributos {pct(r.rates.a * 100, 2)} − desp. variáveis {pct(r.rates.c * 100, 2)} − margem {pct(m, 1)}){r.deal ? ', por cesta' : ''}</p>
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
              <p className="text-xs text-text">Margem {pct(d.marginPct, 1)} · VPL {fmtBRL(d.npvCents)}{d.paybackMonths != null ? ` · payback ${months(d.paybackMonths)}` : ''}</p>
              {diff != null && diff !== 0 && <p className="mt-1 text-2xs text-muted">{fmtBRL(Math.abs(diff))}{per} {diff > 0 ? 'acima' : 'abaixo'} do sugerido</p>}
            </>
          ) : (
            <>
              <p className="mt-1 text-xs font-semibold text-ink">Nenhum preço proposto</p>
              <p className="mt-1 text-sm text-text">A aprovação usa o <b>preço sugerido</b>: <span className={clsx('font-bold', tone.text)}>{ECON_VERDICT_LABELS[d.verdict]}</span>.</p>
              <p className="mt-1 text-2xs text-muted">Para avaliar outro valor, informe o preço no passo 1 ou lance os valores dos produtos.</p>
            </>
          )}
        </section>
      </div>
      {cmp && <LegacyCompare r={r} legacy={legacy} />}
    </div>
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
      {!compact && <p className="mt-1 text-2xs text-muted">Cada cesta usa o maior tributo entre os documentos dos seus produtos (Produtos = NF-e de mercadoria; Serviços = os demais documentos — regra provisória). O proposto é dividido entre as cestas na proporção dos produtos (ou do sugerido).</p>}
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
  const rc = r.recommendation;
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
      {rc && (
        <div className="mt-3 border border-line p-3 text-xs" aria-label="Recomendação pela margem líquida alvo">
          <p className="text-sm font-semibold text-ink">Recomendação pela margem líquida alvo de {pct(rc.netTargetPct, 2)}</p>
          {rc.contributionPct == null ? (
            <p className="mt-1 text-muted">Informe despesas fixas e IR/CSLL em Configurações → Viabilidade para calcular a margem recomendada.</p>
          ) : (
            <>
              <p className="mt-1 text-text">
                Margem de contribuição recomendada <b className="num text-ink">{pct(rc.contributionPct, 2)}</b>
                {rc.priceCents != null ? <> · preço <b className="num text-ink">{fmtBRL(rc.priceCents)}{rec ? '/mês' : ''}</b>{rc.oneTimePriceCents != null && <> + <b className="num text-ink">{fmtBRL(rc.oneTimePriceCents)}</b> no pagamento único</>}</> : <span className="text-danger"> · não cabe no markup com os tributos e despesas variáveis</span>}
              </p>
              <p className="mt-0.5 font-mono text-2xs text-muted">
                {pct(rc.netTargetPct, 2)} ÷ (1 − {pct(rc.params.incomeTaxPct ?? 0, 2)}) = {pct(rc.operatingNeededPct ?? 0, 2)} + fixas {pct(rc.params.overheadPct ?? 0, 2)} + glosa {pct(rc.params.glosaPct, 2)} + inadimplência {pct(rc.params.badDebtPct, 2)}
              </p>
            </>
          )}
        </div>
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
        <li key={s.key} className={clsx('border border-line', s.key === 'historico' && 'border-dashed')}>
          <div className="flex items-start gap-2.5 border-b border-line bg-surface-2 px-3 py-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center bg-primary text-2xs font-bold text-white" aria-hidden>{n + 1}</span>
            <div><p className="text-sm font-bold text-ink">{s.title}</p><p className="text-2xs text-muted">{s.desc}</p></div>
          </div>
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
        </li>
      ))}
    </ol>
  );
}

/** Leitura rápida do resultado: veredito, uma frase e quatro números. Detalhes só para quem abrir. */
export function EconomicsResult({ r, compact = false, settings }: { r: EconResult; compact?: boolean; settings?: EconSettings | null }) {
  const [open, setOpen] = useState(false);
  const per = r.mode === 'recorrente' ? '/mês' : '';
  const k = r.kpi;
  return (
    <div>
      <div className={clsx('border-l-4 p-3', TONE[r.verdict].bar)}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-md font-bold text-ink">{ECON_VERDICT_LABELS[r.verdict]}</p>
          {r.decision && <Badge dot={r.decision.basis === 'proposto' ? DEC[r.verdict].dot : SUG.dot}>decisão no preço {r.decision.basis}</Badge>}
          {r.withReservations && <Chip tone="yellow">Calculável com ressalvas</Chip>}
        </div>
        <p className="mt-1 text-sm text-text">{econHeadline(r, fmtBRL)}</p>
        {r.fiscal && (
          <p className="mt-1 text-xs text-muted" aria-label="Envelope fiscal da simulação">
            {r.fiscal.envelope
              ? <>Envelope fiscal {r.fiscal.envelope.year} ({r.fiscal.regime === 'reforma' ? 'Reforma Tributária' : 'regime atual'}) · {r.fiscal.envelope.municipality ?? `IBGE ${r.fiscal.ibgeCode}`} · tributos da nota {r.fiscal.basket.map((b) => `${b.kind} ${pct(b.bp / 100, 2)}`).join(' · ')} · IRPJ/CSLL {pct((r.fiscal.profitTaxBp ?? 0) / 100, 2)}{r.fiscal.retentions.length ? ' · retenções fora do cálculo' : ''}</>
              : <>Vigência fiscal {r.fiscal.year} sem envelope: tributos dos documentos fiscais e IR/CSLL dos parâmetros.</>}
          </p>
        )}
      </div>
      <PriceBasis r={r} per={per} settings={settings} compact={compact} />
      {r.deal?.cells && <CellsTable r={r} compact={compact} />}
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge dot={r.decision ? SUG.dot : 'bg-line-strong'}>{r.decision ? 'Indicadores no preço sugerido' : 'Indicadores'}</Badge>
      </div>
      <dl className={clsx('mt-1.5 grid gap-2', compact ? 'grid-cols-[repeat(auto-fit,minmax(140px,1fr))]' : 'grid-cols-[repeat(auto-fit,minmax(150px,1fr))]')}>
        <div className="min-w-0 border-l-2 border-primary/60 bg-surface-2 p-2.5 [overflow-wrap:break-word]"><dt className="text-xs text-muted">Margem de contribuição</dt><dd className={clsx('num font-bold', k && k.marginPct < (r.rates.mMin ?? r.rates.m) * 100 - 1e-6 ? 'text-[#C2610C]' : 'text-ink')}>{pct(k?.marginPct)}</dd><dd className="text-2xs text-muted">piso {pct((r.rates.mMin ?? r.rates.m) * 100, 0)}</dd></div>
        {(() => { const c = econCompare(r, { oneTimeX100: settings?.legacyOneTimeX100, recurringX100: settings?.legacyRecurringX100 }); return (
          <div className="min-w-0 border-l-2 border-primary/60 bg-surface-2 p-2.5 [overflow-wrap:break-word]" title="(preço sugerido − custo) ÷ custo"><dt className="text-xs text-muted">Markup efetivo</dt><dd className="num font-bold text-ink">{r.deal ? '—' : pct(c.engine.markupPct, 1)}</dd><dd className="text-2xs text-muted">{r.deal ? 'por cesta no comparativo' : `sobre ${c.baseLabel}`}</dd></div>
        ); })()}
        <div className="min-w-0 border-l-2 border-primary/60 bg-surface-2 p-2.5 [overflow-wrap:break-word]"><dt className="text-xs text-muted">Payback descontado</dt><dd className="num font-bold text-ink">{k ? months(k.paybackMonths) : '—'}</dd><dd className="text-2xs text-muted">limite {r.term.Dalvo} meses · {r.publicSector ? 'público' : 'privado'}{k?.simplePaybackMonths != null ? ` · simples ${months(k.simplePaybackMonths)}` : ''}</dd></div>
        <div className="min-w-0 border-l-2 border-primary/60 bg-surface-2 p-2.5 [overflow-wrap:break-word]"><dt className="text-xs text-muted">Ganho no contrato (VPL)</dt><dd className={clsx('num font-bold', k && k.npvCents < 0 ? 'text-danger' : 'text-ink')}>{fmtBRL(k?.npvCents ?? null)}</dd><dd className="text-2xs text-muted">TIR {k?.irrAnnual == null ? '—' : k.irrAnnual > 10 ? 'acima de 1.000%' : pct(k.irrAnnual * 100)} ao ano</dd></div>
      </dl>
      {k?.margins && <MarginChain m={k.margins} per={per} compact={compact} />}
      <PriceRuler r={r} />
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-2 flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
        <ChevronDown className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />Memória de cálculo
      </button>
      {open && (
        <div className="mt-2 space-y-3 text-sm">
          <Memory r={r} settings={settings} />
          {k && r.priceCents != null && <Dre r={r} />}
          <p className="text-2xs text-muted">Motor {r.engineVersion ?? 'anterior'}. Tributo fixo contado uma vez por documento fiscal (fatura).</p>
          {!!r.items.length && (
            <table className="w-full text-xs">
              <thead className="text-muted"><tr><th className="py-1 text-left font-medium">Produto</th><th className="py-1 text-left font-medium">Documento fiscal</th><th className="py-1 text-right font-medium">Peso na receita</th><th className="py-1 text-right font-medium">Tributos</th></tr></thead>
              <tbody>{r.items.map((i, n) => <tr key={n} className="border-t border-line"><td className="py-1">{i.description}</td><td className={clsx('py-1', i.pending && 'text-[#C2610C]')}>{i.doc ?? 'sem documento'}{i.docVersion ? ` · tributos v${i.docVersion}` : ''}</td><td className="num py-1 text-right">{pct(i.weight * 100)}</td><td className="num py-1 text-right">{pct(i.percentBp / 100, 2)}{i.fixedCents ? ` + ${fmtBRL(i.fixedCents)}` : ''}</td></tr>)}</tbody>
            </table>
          )}
          {!!r.warnings.length && <ul className="list-disc space-y-0.5 pl-5 text-xs text-[#C2610C]">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

/** Bloco numerado do formulário: passo, título, explicação curta e o total do bloco à direita. */
function Step({ n, title, hint, total, children }: { n: number; title: string; hint: string; total?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-line p-4" aria-labelledby={`ec-step-${n}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 gap-2.5">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-white" aria-hidden>{n}</span>
          <div className="min-w-0">
            <h3 id={`ec-step-${n}`} className="text-sm font-semibold text-ink">{title}</h3>
            <p className="text-xs text-muted">{hint}</p>
          </div>
        </div>
        {total && <span className="num text-sm text-muted">{total}</span>}
      </div>
      {children}
    </section>
  );
}

const linesTotal = (lines: Line[]) => fromLines(lines).reduce((t, l) => t + (l.unitCents >= 0 && l.qtyMilli > 0 ? costLineTotal(l) : 0), 0);

/** Linhas de custo; o nome puxa do catálogo (preço vigente) e a linha mostra se veio do catálogo ou foi alterada. */
/** Catálogo pela chave Descrição + Unidade (sem unidade, o primeiro com a descrição). */
const findCat = (catalog: CatalogItem[], name: string, unit?: string | null) => {
  const n = name.trim().toLowerCase(), u = (unit ?? '').trim().toLowerCase();
  return catalog.find((c) => c.name.toLowerCase() === n && (!u || c.unit.toLowerCase() === u)) ?? (u ? undefined : catalog.find((c) => c.name.toLowerCase() === n));
};

/** Custos da planilha; `impacts` liga a coluna "Impacta o quê?"; `onOther` recebe as linhas coladas da outra frequência. */
function CostLines({ title, example, lines, setLines, disabled, catalog, impacts, frequency, onOther, kinds = [] }: { title: string; example: string; lines: Line[]; setLines: (l: Line[]) => void; disabled: boolean; catalog: CatalogItem[]; impacts?: boolean; frequency: 'unico' | 'mensal'; onOther?: (l: Line[]) => void; /** tipos de negociação dos produtos: com mais de um, cada custo diz de qual sai */ kinds?: DealKind[] }) {
  const set = (k: string, p: Partial<Line>) => setLines(lines.map((x) => (x.key === k ? { ...x, ...p } : x)));
  const listId = `cat-${title.replace(/\W/g, '')}`;
  // auto-preenchimento: descrição + unidade já conhecidas trazem o impacto e o preço da última cotação
  const fill = (l: Line, p: Partial<Line>) => {
    const next = { ...l, ...p };
    const hit = findCat(catalog, next.description, next.measure);
    set(l.key, { ...p, costItemId: hit?.id ?? null, ...(hit && l.costItemId !== hit.id ? { ...(hit.unitCents != null ? { unit: money(hit.unitCents) } : {}), ...(hit.impact && !next.impact ? { impact: hit.impact } : {}), ...(!next.measure ? { measure: hit.unit } : {}) } : {}) });
  };
  const onName = (l: Line, v: string) => fill(l, { description: v });
  const kindSel = (l: Line, i: number, cls: string) => kinds.length > 1 ? (
    <select aria-label={`${title}: de qual tipo sai ${i + 1}`} disabled={disabled} value={l.kind ?? ''} onChange={(e) => set(l.key, { kind: (e.target.value || null) as DealKind | null })} className={clsx('field-input', cls)} title="De qual tipo de negociação este custo é deduzido; comum = rateado pela receita">
      <option value="">Comum (rateado)</option>
      {kinds.map((k) => <option key={k} value={k}>{k === 'venda' || k === 'servico' ? `Mover para o ${ECON_LOT_LABELS[lotOfKind(k)]}` : `Sai da ${DEAL_KIND_LABELS[k].toLowerCase()}`}</option>)}
    </select>
  ) : null;
  const impactSel = (l: Line, i: number, cls: string) => impacts ? (
    <select aria-label={`${title}: impacta o quê ${i + 1}`} disabled={disabled} value={l.impact ?? ''} onChange={(e) => set(l.key, { impact: (e.target.value || null) as CostImpact | null })}
      className={clsx('field-input', cls, !l.impact && l.description.trim() && !l.costItemId && 'border-warning text-[#C2610C]')}>
      <option value="">Impacta o quê?</option>
      {COST_IMPACTS.filter((x) => x !== 'operacional').map((x) => <option key={x} value={x}>{COST_IMPACT_LABELS[x]}</option>)}
    </select>
  ) : null;
  const origin = (l: Line) => { const c = l.costItemId ? catalog.find((x) => x.id === l.costItemId) : null; return !c ? null : c.unitCents === parseMoney(l.unit) ? 'catálogo' : 'alterado'; };
  const add = () => setLines([...lines, { key: `l${++seq}`, description: '', qty: '1', unit: '' }]);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [view, setView] = useState<'tabela' | 'lista'>(() => { try { return localStorage.getItem('econ-cost-view') === 'lista' ? 'lista' : 'tabela'; } catch { return 'tabela'; } });
  const pickView = (v: 'tabela' | 'lista') => { setView(v); try { localStorage.setItem('econ-cost-view', v); } catch { /* sem armazenamento: vale só nesta tela */ } };
  const lineTotal = (l: Line) => { const one = fromLines([l])[0]; return one && one.unitCents >= 0 && one.qtyMilli > 0 ? costLineTotal(one) : null; };
  const nameInput = (l: Line, i: number, cls: string, overlay = true) => (
    <span className="relative block min-w-0">
      <Input aria-label={`${title}: descrição ${i + 1}`} title={l.description || undefined} className={clsx(cls, overlay && origin(l) && 'pr-[68px]')} list={listId} placeholder={catalog.length ? `${example} — ou escolha do catálogo` : example} value={l.description} disabled={disabled} onChange={(e) => onName(l, e.target.value)} />
      {overlay && origin(l) && <span className={clsx('pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 px-1 text-2xs font-semibold', origin(l) === 'catálogo' ? 'text-success' : 'text-[#C2610C]')}>{origin(l)}</span>}
    </span>
  );
  const originTag = (l: Line) => origin(l) && <span className={clsx('block text-2xs font-semibold', origin(l) === 'catálogo' ? 'text-success' : 'text-[#C2610C]')}>{origin(l)}</span>;
  const [wide, setWide] = useState(false);
  // tabela: na coluna da oportunidade cabe sem rolar (colunas fixas); "Ampliar" abre a mesma tabela larga
  const costTable = (big: boolean) => (
    <div className={clsx('border border-line', big && 'overflow-x-auto')}>
      <table className={clsx('w-full text-sm', big ? 'min-w-[820px]' : 'table-fixed')}>
        <colgroup><col className={big ? 'w-10' : 'w-5'} /><col /><col className={big ? 'w-[90px]' : 'w-[42px]'} /><col className={big ? 'w-[120px]' : 'w-[56px]'} /><col className={big ? 'w-[140px]' : 'w-[68px]'} /><col className={big ? 'w-[150px]' : 'w-[88px]'} /><col className="w-8" /></colgroup>
        <thead className="bg-surface-2 text-2xs uppercase text-muted">
          <tr><th className="px-1.5 py-1.5 text-left font-semibold">{big ? 'Item' : '#'}</th><th className="px-1.5 py-1.5 text-left font-semibold">Descrição</th><th className="px-1.5 py-1.5 text-left font-semibold">{big ? 'Unidade' : 'Un.'}</th><th className="px-1.5 py-1.5 text-right font-semibold">{big ? 'Quantidade' : 'Qtd.'}</th><th className="px-1.5 py-1.5 text-right font-semibold">{big ? 'Valor unitário' : 'Unit.'}</th><th className="px-1.5 py-1.5 text-right font-semibold">{big ? 'Valor total' : 'Total'}</th><th /></tr>
        </thead>
        <tbody>{lines.map((l, i) => {
          const tot = lineTotal(l);
          const cell = clsx('h-8 w-full', !big && 'px-1.5 text-xs');
          return (
            <tr key={l.key} className="border-t border-line">
              <td className="num px-1.5 py-1 text-xs text-muted">{i + 1}</td>
              <td className="px-0.5 py-1">{nameInput(l, i, cell, big)}{impacts && <div className="mt-0.5">{impactSel(l, i, 'h-7 w-full px-1 text-2xs')}</div>}{kinds.length > 1 && <div className="mt-0.5">{kindSel(l, i, 'h-7 w-full px-1 text-2xs')}</div>}{!big && originTag(l)}</td>
              <td className="px-0.5 py-1 align-top"><Input aria-label={`${title}: unidade ${i + 1}`} className={cell} placeholder="un" value={l.measure ?? ''} disabled={disabled} onChange={(e) => fill(l, { measure: e.target.value.slice(0, 12) || null })} /></td>
              <td className="px-0.5 py-1"><Input aria-label={`${title}: quantidade ${i + 1}`} inputMode="decimal" className={clsx(cell, 'num text-right')} value={l.qty} disabled={disabled} onChange={(e) => set(l.key, { qty: e.target.value })} /></td>
              <td className="px-0.5 py-1"><Input aria-label={`${title}: valor ${i + 1}`} inputMode="decimal" className={clsx(cell, 'num text-right')} placeholder="0,00" value={l.unit} disabled={disabled} onChange={(e) => set(l.key, { unit: e.target.value })} /></td>
              <td className={clsx('num truncate px-1.5 py-1 text-right text-text', !big && 'text-xs')} title={tot != null ? fmtBRL(tot) : undefined}>{tot != null ? fmtBRL(tot) : '—'}</td>
              <td className="py-1">{removeBtn(l, i)}</td>
            </tr>
          );
        })}</tbody>
        <tfoot><tr className="border-t border-line-strong bg-surface-2 font-semibold"><td colSpan={5} className="px-1.5 py-1.5 text-right text-ink">Total</td><td className={clsx('num px-1.5 py-1.5 text-right text-ink', !big && 'text-xs')}>{fmtBRL(lines.reduce((s, l) => s + (lineTotal(l) ?? 0), 0))}</td><td /></tr></tfoot>
      </table>
    </div>
  );
  const removeBtn = (l: Line, i: number) => (!disabled ? <button type="button" className="p-1.5 text-muted hover:text-danger" aria-label={`Remover ${title} ${i + 1}`} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></button> : <span />);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  // tabela colada ou importada: entra no fim (as linhas vazias saem); nome igual ao do catálogo liga a linha ao item
  const addTable = (table: (string | number | null)[][], from: string) => {
    const r = parseCostTable(table);
    if (r.missing.length) { setMsg({ text: `${from}: não encontrei as colunas ${r.missing.join(', ')}. Use os títulos Descrição, Quantidade e Valor unitário (Unidade e Valor total são opcionais).`, bad: true }); return; }
    const toLine = (x: (typeof r.lines)[number]): Line => {
      const hit = findCat(catalog, x.description, x.unit);
      return { key: `l${++seq}`, description: x.description, qty: qtyText(x.qtyMilli), unit: money(x.unitCents), measure: x.unit ?? hit?.unit ?? null, impact: x.impact && x.impact !== 'operacional' ? x.impact : hit?.impact ?? null, costItemId: hit?.id ?? null };
    };
    // a coluna Frequência manda: o que é da outra frequência vai para a outra lista
    const mine = r.lines.filter((x) => !x.frequency || x.frequency === frequency || !onOther), other = r.lines.filter((x) => x.frequency && x.frequency !== frequency && onOther);
    const added = mine.map(toLine);
    setLines([...lines.filter((x) => x.description.trim() || x.unit.trim()), ...added]);
    if (other.length) onOther!(other.map(toLine));
    setMsg({ text: `${from}: ${added.length} custo(s) incluído(s)${other.length ? ` e ${other.length} enviado(s) para ${frequency === 'unico' ? 'os custos mensais' : 'o investimento'}` : ''}, total ${fmtBRL(mine.reduce((t, x) => t + costLineTotal(x), 0))}${r.errors.length ? `; ${r.errors.length} linha(s) ignorada(s): ${r.errors.slice(0, 4).map((e) => `linha ${e.row} (${e.message})`).join('; ')}` : ''}. Confira e salve.`, bad: r.errors.length > 0 });
  };
  const onFile = async (f: File) => {
    try {
      if (/\.xlsx?$/i.test(f.name)) {
        const { default: readXlsx } = await import('read-excel-file');
        addTable((await readXlsx(f)) as (string | number | null)[][], f.name);
      } else {
        const text = await f.text();
        const line0 = text.split('\n')[0] ?? '';
        const sep = text.includes('\t') ? '\t' : line0.split(';').length > line0.split(',').length ? ';' : ',';
        addTable(text.split(/\r?\n/).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, ''))), f.name);
      }
    } catch { setMsg({ text: `Não foi possível ler ${f.name}. Use Excel (.xlsx) ou CSV.`, bad: true }); }
  };
  // descrição em linha inteira; quantidade, valor e total embaixo (cabe na coluna do meio da oportunidade)
  const cols = 'grid grid-cols-[110px_130px_minmax(0,1fr)_28px] items-center gap-1.5';
  return (
    <div>
      {lines.length > 0 && (
        <>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-2xs font-medium text-muted">{view === 'tabela' ? `${lines.length} custo(s)` : 'Cada custo: descrição; embaixo, quantidade × valor unitário = total'}</p>
            <div className="flex items-center gap-1.5">
            {view === 'tabela' && <button type="button" className="inline-flex items-center gap-1 px-1.5 py-1 text-2xs font-semibold text-primary hover:underline" onClick={() => setWide(true)}><Maximize2 className="h-3.5 w-3.5" aria-hidden />Ampliar</button>}
            <div className="flex border border-line text-2xs font-semibold" role="group" aria-label={`Ver ${title.toLowerCase()} como`}>
              {(['tabela', 'lista'] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => pickView(v)} className={clsx('px-2 py-1', view === v ? 'bg-primary text-white' : 'text-ink hover:bg-surface-2')}>{v === 'tabela' ? 'Tabela' : 'Lista'}</button>)}
            </div>
            </div>
          </div>
          {view === 'tabela' ? costTable(false) : (
          <ul className="space-y-1.5">{lines.map((l, i) => {
            const tot = lineTotal(l);
            return (
              <li key={l.key} className={clsx(cols, 'border-l-2 border-line pl-2')}>
                <span className="col-span-4 block min-w-0">{nameInput(l, i, 'h-9 w-full')}</span>
                {impacts && <span className="col-span-4 block">{impactSel(l, i, 'h-8 w-full text-xs')}</span>}
                {kinds.length > 1 && <span className="col-span-4 block">{kindSel(l, i, 'h-8 w-full text-xs')}</span>}
                <span className="flex items-center gap-1"><Input aria-label={`${title}: quantidade ${i + 1}`} inputMode="decimal" className="num h-9 min-w-0" value={l.qty} disabled={disabled} onChange={(e) => set(l.key, { qty: e.target.value })} />{l.measure && <span className="shrink-0 text-2xs text-muted">{l.measure}</span>}</span>
                <Input aria-label={`${title}: valor ${i + 1}`} inputMode="decimal" className="num h-9" placeholder="0,00" value={l.unit} disabled={disabled} onChange={(e) => set(l.key, { unit: e.target.value })} />
                <span className="num text-right text-sm text-text">{tot != null ? fmtBRL(tot) : '—'}</span>
                {removeBtn(l, i)}
              </li>
            );
          })}</ul>
          )}
        </>
      )}
      <datalist id={listId}>{catalog.map((c) => <option key={c.id} value={c.name}>{c.unitCents != null ? `${fmtBRL(c.unitCents)} / ${c.unit}` : 'sem preço'}</option>)}</datalist>
      {!disabled && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={add}>{lines.length ? 'Adicionar outro' : `Adicionar ${title.toLowerCase()}`}</Button>
          <Button size="sm" variant="ghost" icon={<ClipboardPaste className="h-4 w-4" />} onClick={() => setPasting(true)}>Colar do Excel</Button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 px-2 text-sm font-semibold text-ink hover:bg-surface-2">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />Importar planilha
            <input type="file" accept=".xlsx,.xls,.csv,.txt" className="sr-only" aria-label={`Importar planilha: ${title}`} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
          </label>
        </div>
      )}
      {msg && <p className={clsx('mt-1 text-xs', msg.bad ? 'text-[#C2610C]' : 'text-success')}>{msg.text}</p>}
      <Modal open={wide} onClose={() => setWide(false)} title={title} size="xl" footer={<Button variant="primary" onClick={() => setWide(false)}>Fechar</Button>}>
        {costTable(true)}
        <p className="mt-2 text-xs text-muted">As mudanças valem na viabilidade; salve depois de fechar.</p>
      </Modal>
      <Modal open={pasting} onClose={() => setPasting(false)} title={`Colar do Excel: ${title.toLowerCase()}`} size="lg"
        footer={<><Button onClick={() => setPasting(false)}>Cancelar</Button><Button variant="primary" disabled={!pasteText.trim()} onClick={() => { addTable(pasteText.split(/\r?\n/).map((l) => l.split('\t')), 'Colado'); setPasting(false); setPasteText(''); }}>Incluir itens</Button></>}>
        <p className="mb-2 text-sm text-muted">Copie as linhas da planilha (com ou sem a linha de títulos) e cole aqui. Colunas aceitas: Item, Descrição, Unidade, Quantidade, Valor unitário (ou Custo unit.), Valor total, Frequência do custo (Único ou Mensal) e Impacta o quê? (Material/Equipamento, Serviço/Mão de obra, Custo operacional, Despesa de entrega, Taxa fixa de venda). Sem valor unitário, ele vem do total ÷ quantidade. Item já usado (mesma descrição e unidade) vem classificado.</p>
        <textarea aria-label="Itens colados" rows={10} className="field-input w-full font-mono text-xs" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'ITEM\tDESCRIÇÃO\tUNIDADE\tQUANTIDADE\tVALOR UNITÁRIO\tVALOR TOTAL\n1\tCabo 01FO\tm\t8400\tR$ 1,50\tR$ 12.600,00'} data-autofocus />
      </Modal>
    </div>
  );
}

const exportHref = (oppId: string, runId: string, format: 'pdf' | 'csv') => `/api/v1/opportunities/${oppId}/economics/runs/${runId}/export?format=${format}`;
const emitterLine = (e: NonNullable<Data['emitter']>) => [e.name, e.cnpj ? `CNPJ ${e.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}` : null, e.taxRegime ? TAX_REGIME_LABELS[e.taxRegime as TaxRegime] ?? e.taxRegime : null, e.city ? `${e.city}${e.state ? `/${e.state}` : ''}` : null].filter(Boolean).join(' · ');

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

export function EconomicsTab({ oppId }: { oppId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['economics', oppId], queryFn: () => api<Data>(`/opportunities/${oppId}/economics`) });
  const catQ = useQuery({ queryKey: ['cost-items'], queryFn: () => api<{ items: CatalogItem[] }>('/cost-items'), staleTime: 60_000, enabled: q.data?.financeHidden === false });
  const catalog = catQ.data?.items ?? [];
  const [f, setF] = useState<{ mode: EconInput['mode']; term: string; receive: string; capex: Line[]; extra: string; opex: Line[]; commission: string; loss: string; margin: string; payback: string; price: string; salePrice: string; fiscalYear: string; ibge: string } | null>(null);
  // formulário como estava no último salvo: diferente disso, o resultado na tela é só simulação
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    if (q.data?.input && !f) {
      const i = q.data.input;
      const init = { mode: i.mode, term: String(i.termMonths), receive: String(i.receiveMonth), capex: toLines(i.capex), extra: i.extraInitialCents ? money(i.extraInitialCents) : '', opex: toLines(i.opex), commission: bpText(i.variableBp ?? null), loss: bpText(i.lossBp), margin: bpText(i.marginTargetBp), payback: i.paybackMonths ? String(i.paybackMonths) : '', price: money(i.priceCents), salePrice: money(i.salePriceCents ?? null), fiscalYear: i.fiscalYear ? String(i.fiscalYear) : '', ibge: i.municipalityIbge ?? '' };
      setF(init);
      setBase(formKey(init));
    }
  }, [q.data, f]);
  const input = useMemo<EconInput | null>(() => (f ? {
    ...emptyEconInput(), mode: f.mode, termMonths: Number(f.term) || 0, receiveMonth: Number(f.receive) || 0,
    capex: fromLines(f.capex), extraInitialCents: parseMoney(f.extra) ?? -1, opex: fromLines(f.opex),
    commissionBp: null, variableBp: parseBp(f.commission), lossBp: parseBp(f.loss), marginTargetBp: parseBp(f.margin), paybackMonths: f.payback ? Number(f.payback) : null, priceCents: f.price.trim() ? parseMoney(f.price) : null,
    salePriceCents: f.salePrice.trim() ? parseMoney(f.salePrice) : null,
    fiscalYear: f.fiscalYear.length === 4 ? Number(f.fiscalYear) : null, municipalityIbge: f.ibge.length === 7 ? f.ibge : null,
  } : null), [f]);
  const invalid = !input || [input.variableBp ?? null, input.lossBp, input.marginTargetBp].some((v) => Number.isNaN(v)) || input.extraInitialCents < 0 || [...input.capex, ...input.opex].some((l) => l.unitCents < 0 || l.qtyMilli <= 0 || l.description.length < 2) || (input.mode === 'recorrente' && (input.termMonths < 1 || input.termMonths > 240));
  const liveModel = useMemo(() => { try { return buildModel(q.data?.modelOverrides ?? []); } catch { return undefined; } }, [q.data?.modelOverrides]);
  const live = useMemo(() => (q.data?.settings && input && !invalid ? financeEngine({ input, items: q.data.items, settings: q.data.settings, publicSector: q.data.publicSector, model: liveModel, fiscal: q.data.fiscal }) : null), [q.data, input, invalid, liveModel]);
  const save = useMutation({
    mutationFn: () => api<{ result: EconResult }>(`/opportunities/${oppId}/economics`, { method: 'PUT', body: input }),
    onSuccess: () => { if (f) setBase(formKey(f)); void qc.invalidateQueries({ queryKey: ['economics', oppId] }); toast({ tone: 'success', message: 'Viabilidade econômica salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.data?.financeHidden) return <HiddenEconomics d={q.data} />;
  if (q.isLoading || !f) return <LoadingRows rows={5} />;
  const d = q.data!;
  if (!d.settings) return <div className="space-y-3"><h2 className="flex items-center gap-2 text-md font-bold text-ink"><Calculator className="h-5 w-5 text-primary" aria-hidden />Viabilidade econômica</h2><Notice tone="warning">A empresa ainda não informou os parâmetros da viabilidade (margem mínima, TMA, glosa, contingências e payback). Quem administra preenche em Configurações → Viabilidade.</Notice></div>;
  const st = d.settings;
  // salvo e sem mudanças no formulário = o cálculo oficial; senão, a simulação ao vivo
  const official = !!d.saved && !!d.result && formKey(f) === base;
  const shownResult = official ? d.result : live;
  const dis = !d.editable;
  const set = (p: Partial<NonNullable<typeof f>>) => setF({ ...f, ...p });
  // tipos de negociação vêm dos produtos (aba Produtos); sem produtos vale a escolha abaixo
  const kindOf = (i: EconItem): DealKind => i.kind ?? (f.mode === 'pontual' ? 'venda' : 'recorrencia');
  const kinds = DEAL_KINDS.filter((k) => d.items.some((i) => kindOf(i) === k));
  const mixed = kinds.some(isOneTimeKind) && kinds.some(isMonthlyKind);
  const derivedMode: EconInput['mode'] | null = !d.items.length || mixed ? null : kinds.some(isOneTimeKind) ? 'pontual' : 'recorrente';
  if (derivedMode && f.mode !== derivedMode) queueMicrotask(() => setF((x) => (x && x.mode !== derivedMode ? { ...x, mode: derivedMode } : x)));
  if (mixed && f.mode !== 'recorrente') queueMicrotask(() => setF((x) => (x && x.mode !== 'recorrente' ? { ...x, mode: 'recorrente' } : x)));
  const saleTotal = d.items.filter((i) => isOneTimeKind(kindOf(i))).reduce((t, i) => t + i.revenueCents, 0);
  const itemsTotal = d.items.filter((i) => (mixed ? isMonthlyKind(kindOf(i)) : true)).reduce((t, i) => t + i.revenueCents, 0);
  const capexTotal = linesTotal(f.capex);
  const opexTotal = linesTotal(f.opex);
  const customized = [f.commission, f.loss].some((v) => v.trim() !== '');
  const teto = d.publicSector ? st.paybackMaxPublic : st.paybackMaxPrivate;
  const mPiso = st.marginTargetBp, mTeto = st.marginMaxBp ?? null, mSug = st.marginSuggestedBp ?? st.marginTargetBp;
  const mNow = parseBp(f.margin) ?? mSug;
  const mOut = f.margin.trim() !== '' && !Number.isNaN(mNow) && (mNow < mPiso || (mTeto != null && mNow > mTeto));
  const tmaText = st.tmaAnnualBp != null ? `TMA de ${bpText(st.tmaAnnualBp)}% ao ano` : `TMA de ${bpText(st.tmaMonthlyBp)}% ao mês`;
  const shown = (v: string, def: number) => (v.trim() ? v : bpText(def));
  const segLoss = d.publicSector ? st.lossPublicBp : st.lossPrivateBp;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-md font-bold text-ink"><Calculator className="h-5 w-5 text-primary" aria-hidden />Viabilidade econômica</h2>
          <p className="max-w-2xl text-sm text-muted">Preencha os passos abaixo; o resultado se atualiza na hora. Os tributos saem do documento fiscal de cada produto (aba Produtos).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {official ? <Chip tone="green">Salvo em {fmtDateTime(d.saved!.updatedAt)}</Chip> : <Chip tone="yellow">Simulação — ainda não salva</Chip>}
          {official && <><a className="text-xs font-semibold text-primary hover:underline" href={exportHref(oppId, 'ultimo', 'pdf')}>PDF</a><a className="text-xs font-semibold text-primary hover:underline" href={exportHref(oppId, 'ultimo', 'csv')}>CSV</a></>}
        </div>
      </div>
      <p className="text-xs text-muted">{d.emitter ? <>Emitente: {emitterLine(d.emitter)}{(!d.emitter.cnpj || !d.emitter.taxRegime) && <span className="text-[#C2610C]"> · complete CNPJ e regime em Configurações → Filiais e documentos fiscais</span>}</> : <span className="text-[#C2610C]">Oportunidade sem filial: escolha a filial para usar os documentos fiscais dela.</span>}</p>

      <DecisionBar oppId={oppId} d={d} canSubmit={official && !d.stale && d.editable && d.result?.priceSource !== 'sugerido'} />
      {official && d.stale && <Notice tone="warning">Produtos, tributos ou parâmetros mudaram depois que esta viabilidade foi salva. O resultado abaixo é o salvo; confira e salve de novo, porque o pedido de aprovação exige o cálculo atualizado.</Notice>}
      {shownResult ? <EconomicsResult r={shownResult} settings={d.settings} /> : <Notice tone="warning">Confira os campos destacados para ver o resultado.</Notice>}
      {shownResult && shownResult.cashflow.length > 1 && shownResult.cashflow.some((v) => v !== 0) && (
        <section className="border border-line p-4" aria-labelledby="ec-flow">
          <h3 id="ec-flow" className="text-sm font-semibold text-ink">Fluxo de caixa</h3>
          <p className="mb-3 text-xs text-muted">Início = investimento; depois, o que sobra a cada mês. A linha mostra quanto já voltou para o caixa.</p>
          <CashflowChart labels={shownResult.cashflow.map((_, i) => (i === 0 ? 'Início' : `M${i}`))} {...flowSeries(shownResult.cashflow)} ariaLabel="Fluxo de caixa mensal da oportunidade" height={220} />
        </section>
      )}

      <div className="space-y-3">
        <Step n={1} title="A venda" hint="Como o cliente paga e por quanto tempo. O preço em branco usa o total dos produtos.">
          <div className="space-y-3">
            {d.items.length ? (
              <div>
                <p className="mb-1 text-sm font-medium text-ink">Tipo de negociação (dos produtos)</p>
                <div className="flex flex-wrap gap-1.5">{kinds.map((k) => <Chip key={k} tone={k === 'venda' ? 'blue' : 'green'}>{ECON_LOT_LABELS[lotOfKind(k)]}: {DEAL_KIND_LABELS[k]}{isOneTimeKind(k) ? ' · pagamento único' : ' · mensal'}</Chip>)}</div>
                <p className="mt-1 text-xs text-muted">{mixed ? 'Pagamento único e mensalidades na mesma negociação: um resultado só, com o fluxo de caixa de tudo junto. Cada investimento sai do seu lote (Venda ou Serviço).' : 'Para mudar, ajuste o tipo de cada produto na aba Produtos.'}</p>
              </div>
            ) : (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-ink">Tipo de receita</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup">
                {(['recorrente', 'pontual'] as const).map((m) => (
                  <label key={m} className={clsx('flex h-10 cursor-pointer items-center gap-2 border px-3 text-sm', f.mode === m ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line')}>
                    <input type="radio" className="accent-primary" checked={f.mode === m} disabled={dis} onChange={() => set({ mode: m })} />{m === 'recorrente' ? 'Mensal (contrato)' : 'Pagamento único'}
                  </label>
                ))}
              </div>
            </fieldset>
            )}
            <div className="grid grid-cols-2 gap-3">
            {mixed && <FormField label="Venda: recebe no mês" htmlFor="ec-rec" hint="0 = à vista"><Input id="ec-rec" inputMode="numeric" value={f.receive} disabled={dis} onChange={(e) => set({ receive: e.target.value.replace(/\D/g, '') })} /></FormField>}
            {mixed && <FormField label="Preço do pagamento único (R$: venda + serviço único)" htmlFor="ec-sale" hint={`Produtos de pagamento único: ${fmtBRL(saleTotal)}`}><><Input id="ec-sale" inputMode="decimal" placeholder={money(saleTotal)} value={f.salePrice} disabled={dis} onChange={(e) => set({ salePrice: e.target.value })} />{shownResult?.suggestedOneTimeCents != null && !dis && <button type="button" className="mt-1 block text-xs font-semibold text-primary hover:underline" onClick={() => set({ salePrice: money(shownResult.suggestedOneTimeCents!) })}>Usar o preço sugerido ({fmtBRL(shownResult.suggestedOneTimeCents)})</button>}</></FormField>}
            {f.mode === 'recorrente'
              ? <FormField label="Vigência (meses)" htmlFor="ec-term"><Input id="ec-term" inputMode="numeric" value={f.term} disabled={dis} onChange={(e) => set({ term: e.target.value.replace(/\D/g, '') })} /></FormField>
              : <FormField label="Recebe no mês" htmlFor="ec-rec" hint="0 = à vista"><Input id="ec-rec" inputMode="numeric" value={f.receive} disabled={dis} onChange={(e) => set({ receive: e.target.value.replace(/\D/g, '') })} /></FormField>}
            {f.mode === 'recorrente' && (
              <FormField label="Payback (meses)" htmlFor="ec-pb" hint={`Sugestão: ${teto} meses (teto do setor ${d.publicSector ? 'público' : 'privado'}). O investimento é diluído nesse prazo e toda a análise muda junto; acima do teto, o retorno real decide a alçada.`}>
                <>
                  <Input id="ec-pb" inputMode="numeric" placeholder={String(teto)} value={f.payback} disabled={dis} invalid={!!f.payback && Number(f.payback) < 1} onChange={(e) => set({ payback: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                </>
              </FormField>
            )}
            <FormField label="Vigência fiscal (ano)" htmlFor="ec-fy" hint={`Chave do envelope fiscal: até 2026 regime atual (PIS/COFINS); de 2027 em diante Reforma Tributária (CBS/IBS). Em branco = ${d.fiscal?.today.slice(0, 4) ?? 'ano corrente'}.`}>
              <Input id="ec-fy" inputMode="numeric" placeholder={d.fiscal?.today.slice(0, 4) ?? ''} value={f.fiscalYear} disabled={dis} invalid={!!f.fiscalYear && f.fiscalYear.length !== 4} onChange={(e) => set({ fiscalYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </FormField>
            <FormField label="Município do envelope (IBGE)" htmlFor="ec-ibge" hint={d.fiscal?.defaultIbge ? `Em branco = o da filial emitente (${d.fiscal.defaultIbge}).` : 'A filial emitente está sem código IBGE (Configurações → Filiais).'}>
              <Input id="ec-ibge" inputMode="numeric" placeholder={d.fiscal?.defaultIbge ?? ''} value={f.ibge} disabled={dis} invalid={!!f.ibge && f.ibge.length !== 7} onChange={(e) => set({ ibge: e.target.value.replace(/\D/g, '').slice(0, 7) })} />
            </FormField>
            <FormField label="Margem de contribuição (%)" htmlFor="ec-mar" error={mOut ? `Fora dos limites: o cálculo usa ${bpText(Math.min(Math.max(mNow, mPiso), mTeto ?? 10_000))}%.` : undefined} hint={`Piso ${bpText(mPiso)}%${mTeto != null ? ` · teto ${bpText(mTeto)}%` : ''} · sugestão ${bpText(mSug)}%. Em branco vale a sugestão.`}>
              <Input id="ec-mar" inputMode="decimal" placeholder={bpText(mSug)} value={f.margin} disabled={dis} invalid={Number.isNaN(parseBp(f.margin)) || mOut} onChange={(e) => set({ margin: e.target.value.replace(/[^\d,.]/g, '').slice(0, 6) })} />
            </FormField>
            <FormField label={mixed ? 'Preço por mês (R$, recorrência + locação)' : f.mode === 'recorrente' ? 'Preço por mês (R$)' : 'Preço (R$)'} htmlFor="ec-price" hint={`${mixed ? 'Produtos mensais' : 'Total dos produtos'}: ${fmtBRL(itemsTotal)}`}><><Input id="ec-price" inputMode="decimal" placeholder={money(itemsTotal)} value={f.price} disabled={dis} onChange={(e) => set({ price: e.target.value })} />{(shownResult?.suggestedCents ?? shownResult?.suggestedMinCents) != null && !dis && <button type="button" className="mt-1 block text-xs font-semibold text-primary hover:underline" onClick={() => set({ price: money((shownResult!.suggestedCents ?? shownResult!.suggestedMinCents)!) })}>Usar o preço sugerido ({fmtBRL(shownResult!.suggestedCents ?? shownResult!.suggestedMinCents)})</button>}</></FormField>
            </div>
          </div>
        </Step>

        <Step n={2} title="Investimento para começar" hint="Pago uma vez, antes de faturar: equipamentos, obra, instalação, projeto, frete." total={<>Total <b className="text-ink">{fmtBRL(capexTotal + Math.max(0, parseMoney(f.extra) ?? 0))}</b></>}>
          {(() => {
            // passo 2 em lotes: Venda (patrimonial) e Serviço; linhas antigas sem lote ficam num bloco à parte (rateadas)
            const inLot = (l: Line, lot: EconLot) => !!l.kind && lotOfKind(l.kind) === lot;
            const byLot = (lot: EconLot | null) => f.capex.filter((l) => (lot ? inLot(l, lot) : !l.kind));
            const put = (lot: EconLot | null, lines: Line[]) => {
              const stamped = lines.map((l) => ({ ...l, kind: lot === 'venda' ? 'venda' as DealKind : lot === 'servico' ? (l.kind && lotOfKind(l.kind) === 'servico' ? l.kind : 'servico' as DealKind) : null }));
              set({ capex: [...(lot === 'venda' ? stamped : byLot('venda')), ...(lot === 'servico' ? stamped : byLot('servico')), ...(lot === null ? stamped : byLot(null))] });
            };
            const toOpex = f.mode === 'recorrente' ? (l: Line[]) => setF((x) => (x ? { ...x, opex: [...x.opex.filter((y) => y.description.trim() || y.unit.trim()), ...l.map((y) => ({ ...y, impact: null, kind: null }))] } : x)) : undefined;
            const legacy = byLot(null);
            const sub = (lot: EconLot) => linesTotal(byLot(lot));
            return (
              <div className="space-y-4">
                <div>
                  <p className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-ink">{ECON_LOT_LABELS.venda} <span className="text-xs font-normal text-muted">equipamentos e materiais (NF-e): entram no preço da cesta de produtos · {fmtBRL(sub('venda'))}</span></p>
                  <CostLines title="Investimento da Cesta de Produtos" example="Ex.: roteador, equipamento" lines={byLot('venda')} setLines={(l) => put('venda', l)} disabled={dis} catalog={catalog.filter((c) => c.kind === 'investimento')} impacts frequency="unico" onOther={toOpex} />
                </div>
                <div>
                  <p className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-ink">{ECON_LOT_LABELS.servico} <span className="text-xs font-normal text-muted">obra, instalação, projeto: entram no preço da cesta de serviços · {fmtBRL(sub('servico'))}</span></p>
                  <CostLines title="Investimento da Cesta de Serviços" example="Ex.: obra, instalação, projeto" lines={byLot('servico')} setLines={(l) => put('servico', l)} disabled={dis} catalog={catalog.filter((c) => c.kind === 'investimento')} impacts frequency="unico" onOther={toOpex} />
                </div>
                {!!legacy.length && (
                  <div>
                    <p className="mb-1 text-sm font-semibold text-ink">Sem lote <span className="text-xs font-normal text-muted">(lançados antes dos lotes: rateados pela receita) · {fmtBRL(linesTotal(legacy))}</span></p>
                    <CostLines title="Investimento sem lote" example="" lines={legacy} setLines={(l) => put(null, l)} disabled={dis} catalog={catalog.filter((c) => c.kind === 'investimento')} impacts kinds={['venda', 'servico']} frequency="unico" onOther={toOpex} />
                  </div>
                )}
              </div>
            );
          })()}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <label htmlFor="ec-extra" className="text-sm text-text" title="Despesa variável em R$: entra no preço, fora do investimento e sem contingência">Outras despesas de entrega e taxas (valor único)</label>
            <Input id="ec-extra" inputMode="decimal" placeholder="0,00" className="num h-9 w-[140px]" value={f.extra} disabled={dis} invalid={(parseMoney(f.extra) ?? 0) < 0} onChange={(e) => set({ extra: e.target.value })} />
          </div>
        </Step>

        {f.mode === 'recorrente' && (
          <Step n={3} title="Custos mensais para manter o serviço" hint="Todo mês enquanto o contrato durar: trânsito, link de terceiro, licenças, suporte." total={<>Total <b className="text-ink">{fmtBRL(opexTotal)}</b>/mês</>}>
            <CostLines title="Custo mensal" example="Ex.: link de terceiro, licença" lines={f.opex} setLines={(l) => set({ opex: l })} disabled={dis} catalog={catalog.filter((c) => c.kind === 'mensal')} kinds={kinds.filter(isMonthlyKind)} frequency="mensal" onOther={(l) => setF((x) => (x ? { ...x, capex: [...x.capex.filter((y) => y.description.trim() || y.unit.trim()), ...l] } : x))} />
          </Step>
        )}

        <details className="border border-line p-4" open={customized}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2.5">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-xs font-bold text-muted" aria-hidden>{f.mode === 'recorrente' ? 4 : 3}</span>
              <span><span className="block text-sm font-semibold text-ink">Ajustes da negociação <span className="font-normal text-muted">(opcional)</span></span><span className="block text-xs text-muted">Despesas variáveis {shown(f.commission, st.variableExpenseBp ?? 0)}% · glosa {shown(f.loss, segLoss)}% (só no fluxo de caixa){customized ? '' : ' — padrão da empresa'}</span></span>
            </span>
            <span className="text-xs font-semibold text-primary">Alterar</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Despesas variáveis (%)" htmlFor="ec-com" hint="Sobre o preço, no divisor do markup (sem comissão)"><Input id="ec-com" inputMode="decimal" placeholder={bpText(st.variableExpenseBp ?? 0)} value={f.commission} disabled={dis} invalid={Number.isNaN(parseBp(f.commission))} onChange={(e) => set({ commission: e.target.value })} /></FormField>
            <FormField label="Perda / glosa (%)" htmlFor="ec-loss" hint="Fora do preço: entra só no fluxo de caixa e na margem operacional"><Input id="ec-loss" inputMode="decimal" placeholder={bpText(segLoss)} value={f.loss} disabled={dis} invalid={Number.isNaN(parseBp(f.loss))} onChange={(e) => set({ loss: e.target.value })} /></FormField>
          </div>
          <p className="mt-2 text-xs text-muted">Em branco vale o padrão da empresa. {tmaText}{st.badDebtBp != null ? ` · inadimplência ${bpText(st.badDebtBp)}%` : ''}{st.inflationAnnualBp != null ? ` · reajuste ${bpText(st.inflationAnnualBp)}% ao ano` : ''}{st.horizonMaxMonths != null ? ` · projeção até ${st.horizonMaxMonths} meses` : ''} · payback máximo de {teto} meses (esta conta é do setor {d.publicSector ? 'público' : 'privado'}).</p>
        </details>
      </div>

      {d.editable && <div className="flex justify-end"><Button variant="primary" disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>Salvar viabilidade econômica</Button></div>}
      {!!d.history.length && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-ink">Histórico de cálculos ({d.history.length})</summary>
          <ul className="mt-2 divide-y divide-line">{d.history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>{fmtDateTime(h.createdAt)} · {h.actorName ?? 'sistema'}{h.reason === 'ganha' ? ' · fechamento' : ''}</span>
              <span className="flex flex-wrap items-center gap-2 text-muted">
                {ECON_VERDICT_LABELS[h.verdict]} · {fmtBRL(h.priceCents)}
                {h.sha256 ? <span title={`SHA-256 ${h.sha256} · motor ${h.engineVersion ?? ''}`} className="text-2xs text-success">assinado {h.sha256.slice(0, 8)}</span> : <span className="text-2xs">anterior à assinatura</span>}
                <a className="text-xs font-semibold text-primary hover:underline" href={exportHref(oppId, h.id, 'pdf')}>PDF</a>
                <a className="text-xs font-semibold text-primary hover:underline" href={exportHref(oppId, h.id, 'csv')}>CSV</a>
              </span>
            </li>
          ))}</ul>
        </details>
      )}
    </div>
  );
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
