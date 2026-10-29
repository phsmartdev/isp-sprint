/**
 * Viabilidade econômica da oportunidade (motor financeiro): custos da venda e da entrega, condições comerciais
 * e o resultado na hora — preço mínimo, recomendado, margem, payback, VPL e TIR — numa leitura rápida para o time.
 * O cálculo da tela usa o mesmo motor do servidor; ao salvar, o servidor recalcula e guarda a fotografia auditável.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Calculator, ChevronDown, Plus, Trash2 } from 'lucide-react';
import {
  ECON_VERDICT_LABELS, costLineTotal, econHeadline, emptyEconInput, financeEngine, parseMoney, parseQty,
  type EconInput, type EconItem, type EconResult, type EconSettings, type EconVerdict,
} from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDateTime } from '../../lib/format';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { CashflowChart, flowSeries } from '../../components/charts/Cashflow';
import { errMsg } from '../contracts/shared';

type Data = {
  settings: EconSettings | null; items: EconItem[]; publicSector: boolean; input: EconInput; saved: { updatedAt: string } | null;
  /** resultado SALVO (consultar não recalcula); stale = produtos, tributos ou parâmetros mudaram desde então */
  result: EconResult | null; stale: boolean; editable: boolean;
  /** parâmetros vigentes; null = a empresa ainda não informou em Configurações → Viabilidade */
  settingsVersion: { id: string; validFrom: string } | null;
  status: EconStatus; canDecide: boolean; decisions: { id: string; snapshotId: string; action: 'enviada' | 'aprovada' | 'devolvida'; reason: string | null; actorName: string | null; createdAt: string }[];
  /** sem "ver financeiro" a API manda só o veredito */
  financeHidden: boolean; history: { id: string; reason: string; createdAt: string; actorName: string | null; verdict: EconVerdict; priceCents: number | null }[];
};
type EconStatus = 'rascunho' | 'calculada' | 'em_decisao' | 'aprovada' | 'devolvida';
type Line = { key: string; description: string; qty: string; unit: string };

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
const toLines = (l: EconInput['capex']): Line[] => l.map((x) => ({ key: `l${++seq}`, description: x.description, qty: (x.qtyMilli / 1000).toLocaleString('pt-BR'), unit: money(x.unitCents) }));
const fromLines = (l: Line[]) => l.filter((x) => x.description.trim() || x.unit.trim()).map((x) => ({ description: x.description.trim(), qtyMilli: parseQty(x.qty) ?? 0, unitCents: parseMoney(x.unit) ?? -1 }));

/** Régua do preço: onde o preço proposto fica em relação ao mínimo e ao recomendado. */
function PriceRuler({ r }: { r: EconResult }) {
  const min = r.floor.minCents, rec = r.recommendedCents, p = r.priceCents;
  if (min == null || rec == null || rec <= 0) return null; // sem custos não há régua para mostrar
  const top = Math.max(rec, p ?? 0, min) * 1.15 || 1;
  const pc = (v: number) => Math.min(100, (v / top) * 100);
  const at = (v: number) => `${pc(v)}%`;
  /** Rótulo não sai da régua: perto das pontas alinha pela borda. */
  const lbl = (v: number) => clsx('absolute whitespace-nowrap', pc(v) < 12 ? 'text-left' : pc(v) > 88 ? '-translate-x-full text-right' : '-translate-x-1/2 text-center');
  const together = pc(rec) - pc(min) < 24;
  return (
    <div className="mt-3" aria-label="Preço proposto comparado ao mínimo e ao recomendado">
      <div className="relative h-2.5 bg-surface-2">
        <div className="absolute inset-y-0 left-0 bg-danger/25" style={{ width: at(min) }} />
        <div className="absolute inset-y-0 bg-primary/20" style={{ left: at(min), width: `calc(${at(rec)} - ${at(min)})` }} />
        <div className="absolute inset-y-0 right-0 bg-success/25" style={{ left: at(rec) }} />
        {p != null && <div className="absolute -top-1 h-4.5 w-1 bg-ink" style={{ left: at(p), height: 18 }} title={`Proposto ${fmtBRL(p)}`} />}
      </div>
      <div className="relative mt-1 h-8 text-2xs text-muted">
        {together ? (
          <span className={lbl(rec)} style={{ left: at(rec) }}>Mínimo <b className="num text-ink">{fmtBRL(min)}</b><br />Margem mínima <b className="num text-ink">{fmtBRL(rec)}</b></span>
        ) : (
          <>
            <span className={lbl(min)} style={{ left: at(min) }}>Mínimo<br /><b className="num text-ink">{fmtBRL(min)}</b></span>
            <span className={lbl(rec)} style={{ left: at(rec) }}>Margem mínima<br /><b className="num text-ink">{fmtBRL(rec)}</b></span>
          </>
        )}
      </div>
    </div>
  );
}

type DreRow = { sign: '+' | '−' | '='; label: string; month: number | null; total: number; strong?: boolean; tone?: boolean; note?: string };

/** DRE da oportunidade: o que entra (+), o que sai (−) e os resultados (=), por mês e no contrato inteiro. */
function Dre({ r }: { r: EconResult }) {
  const k = r.kpi!, P = r.priceCents!;
  const rec = r.mode === 'recorrente', N = rec ? r.term.N : 1;
  const liquid = P - k.taxCents;
  const result = k.contributionCents * N - r.initialCents;
  // resultados salvos antes da contingência não têm as bases separadas
  const opexBase = r.opexBaseCents ?? r.monthlyCostCents, opexCont = r.opexContingencyCents ?? 0;
  const capexBase = r.capexBaseCents ?? r.initialCents, capexCont = r.capexContingencyCents ?? 0;
  const rows: DreRow[] = [
    { sign: '+', label: 'Receita bruta', month: P, total: P * N },
    { sign: '−', label: `Tributos (${pct(r.rates.a * 100, 2)}${r.fixedTaxCents ? ` + ${fmtBRL(r.fixedTaxCents)}` : ''})`, month: -k.taxCents, total: -k.taxCents * N },
    { sign: '=', label: 'Receita líquida', month: liquid, total: liquid * N, strong: true },
    { sign: '−', label: `Comissão (${pct(r.rates.c * 100, 2)})`, month: -k.commissionCents, total: -k.commissionCents * N },
    ...(k.lossCents > 0 ? [{ sign: '−' as const, label: `Perda / glosa (${pct(r.rates.g * 100, 2)})`, month: -k.lossCents, total: -k.lossCents * N }] : []),
    ...(opexBase > 0 ? [{ sign: '−' as const, label: 'Custos operacionais', month: -opexBase, total: -opexBase * N }] : []),
    ...(opexCont > 0 ? [{ sign: '−' as const, label: 'Contingência dos custos mensais', month: -opexCont, total: -opexCont * N }] : []),
    { sign: '=', label: 'Margem de contribuição', month: k.contributionCents, total: k.contributionCents * N, strong: true, note: `${pct(k.marginPct)} da receita` },
    { sign: '−', label: 'Investimento inicial', month: null, total: -capexBase },
    ...(capexCont > 0 ? [{ sign: '−' as const, label: 'Contingência do investimento', month: null, total: -capexCont }] : []),
    { sign: '=', label: rec ? 'Resultado do contrato' : 'Resultado da venda', month: null, total: result, strong: true, tone: true, note: result >= 0 ? 'lucro' : 'prejuízo' },
  ];
  const money = (v: number) => (v < 0 ? `− ${fmtBRL(-v)}` : fmtBRL(Math.abs(v)));
  const signCls = { '+': 'text-[rgb(var(--chart-in))]', '−': 'text-[rgb(var(--chart-out))]', '=': 'text-muted' };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <caption className="mb-1 text-left text-xs font-semibold text-muted">DRE da oportunidade</caption>
        <thead className="text-2xs text-muted"><tr><th className="w-6" /><th className="py-1 text-left font-medium" />{rec && <th className="py-1 text-right font-medium">Por mês</th>}<th className="py-1 text-right font-medium">{rec ? `No contrato (${N} meses)` : 'Na venda'}</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={clsx(row.sign === '=' && 'border-t border-line', row.strong && 'font-semibold text-ink', row.tone && 'bg-surface-2')}>
              <td className={clsx('py-1 pl-1 text-center font-bold', signCls[row.sign])} aria-label={row.sign === '+' ? 'soma' : row.sign === '−' ? 'dedução' : 'resultado'}>{row.sign}</td>
              <td className="py-1">{row.label}{row.note && <span className="ml-1.5 text-2xs font-normal text-muted">{row.note}</span>}</td>
              {rec && <td className="num py-1 text-right">{row.month == null ? <span className="text-muted">—</span> : money(row.month)}</td>}
              <td className={clsx('num py-1 pr-1 text-right', row.tone && (row.total < 0 ? 'text-danger' : 'text-success'))}>{money(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {k.npvCents != null && <p className="mt-1 text-xs text-muted">Em valor de hoje, descontando a TMA de {pct(r.rates.r * 100, 2)} ao mês, o resultado é <b className="num text-ink">{money(k.npvCents)}</b> (VPL).</p>}
    </div>
  );
}

/** Leitura rápida do resultado: veredito, uma frase e quatro números. Detalhes só para quem abrir. */
export function EconomicsResult({ r, compact = false }: { r: EconResult; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const per = r.mode === 'recorrente' ? '/mês' : '';
  const k = r.kpi;
  return (
    <div>
      <div className={clsx('border-l-4 p-3', TONE[r.verdict].bar)}>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-md font-bold text-ink">{ECON_VERDICT_LABELS[r.verdict]}</p>
          {r.withReservations && <Chip tone="yellow">Calculável com ressalvas</Chip>}
        </div>
        <p className="mt-1 text-sm text-text">{econHeadline(r, fmtBRL)}</p>
      </div>
      <dl className={clsx('mt-3 grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4')}>
        <div className="bg-surface-2 p-2.5"><dt className="text-xs text-muted">Preço {r.priceSource === 'informado' ? 'informado' : 'dos produtos'}</dt><dd className="num font-bold text-ink">{fmtBRL(r.priceCents)}<span className="text-xs font-normal text-muted">{per}</span></dd></div>
        <div className="bg-surface-2 p-2.5"><dt className="text-xs text-muted">Margem efetiva</dt><dd className={clsx('num font-bold', k && k.marginPct < r.rates.m * 100 ? 'text-[#C2610C]' : 'text-ink')}>{pct(k?.marginPct)}</dd><dd className="text-2xs text-muted">mínima {pct(r.rates.m * 100, 0)}</dd></div>
        <div className="bg-surface-2 p-2.5"><dt className="text-xs text-muted">Payback descontado</dt><dd className={clsx('num font-bold', (r.paybackOk ?? r.withinPolicy) === false ? 'text-danger' : 'text-ink')}>{months(k?.paybackMonths)}</dd><dd className="text-2xs text-muted">limite {r.term.Dalvo} meses · {r.publicSector ? 'público' : 'privado'}{k?.simplePaybackMonths != null ? ` · simples ${months(k.simplePaybackMonths)}` : ''}</dd></div>
        <div className="bg-surface-2 p-2.5"><dt className="text-xs text-muted">Ganho no contrato (VPL)</dt><dd className={clsx('num font-bold', k && k.npvCents < 0 ? 'text-danger' : 'text-ink')}>{fmtBRL(k?.npvCents ?? null)}</dd><dd className="text-2xs text-muted">TIR {k?.irrAnnual == null ? '—' : k.irrAnnual > 10 ? 'acima de 1.000%' : pct(k.irrAnnual * 100)} ao ano</dd></div>
      </dl>
      <PriceRuler r={r} />
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-2 flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
        <ChevronDown className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />DRE e memória de cálculo
      </button>
      {open && (
        <div className="mt-2 space-y-3 text-sm">
          {k && r.priceCents != null && <Dre r={r} />}
          <p className="text-xs text-muted">Preço mínimo = cobre custos, tributos e o investimento em {r.mode === 'recorrente' ? `${r.term.D} meses` : 'uma venda'}, com a TMA de {pct(r.rates.r * 100, 2)} ao mês (caixa {fmtBRL(r.floor.cashCents)}, econômico {fmtBRL(r.floor.economicCents)}). Preço da margem mínima = entrega {pct(r.rates.m * 100, 0)} de margem sobre a receita; abaixo dele a venda sai da política. Payback descontado pela TMA; tributo fixo contado uma vez por documento fiscal (fatura). Motor {r.engineVersion ?? 'anterior'}.</p>
          {!!r.items.length && (
            <table className="w-full text-xs">
              <thead className="text-muted"><tr><th className="py-1 text-left font-medium">Produto</th><th className="py-1 text-left font-medium">Documento fiscal</th><th className="py-1 text-right font-medium">Peso na receita</th><th className="py-1 text-right font-medium">Tributos</th></tr></thead>
              <tbody>{r.items.map((i, n) => <tr key={n} className="border-t border-line"><td className="py-1">{i.description}</td><td className={clsx('py-1', i.pending && 'text-[#C2610C]')}>{i.doc ?? 'sem documento'}</td><td className="num py-1 text-right">{pct(i.weight * 100)}</td><td className="num py-1 text-right">{pct(i.percentBp / 100, 2)}{i.fixedCents ? ` + ${fmtBRL(i.fixedCents)}` : ''}</td></tr>)}</tbody>
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

function CostLines({ title, example, lines, setLines, disabled }: { title: string; example: string; lines: Line[]; setLines: (l: Line[]) => void; disabled: boolean }) {
  const set = (k: string, p: Partial<Line>) => setLines(lines.map((x) => (x.key === k ? { ...x, ...p } : x)));
  const add = () => setLines([...lines, { key: `l${++seq}`, description: '', qty: '1', unit: '' }]);
  const cols = 'grid grid-cols-[minmax(0,1fr)_64px_120px_28px] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_64px_120px_110px_28px]';
  return (
    <div>
      {lines.length > 0 && (
        <>
          <div className={clsx(cols, 'mb-1 text-2xs font-medium text-muted')}><span>Descrição</span><span>Qtd.</span><span>Valor unitário</span><span className="hidden text-right sm:block">Total</span><span /></div>
          <ul className="space-y-1.5">{lines.map((l, i) => {
            const one = fromLines([l])[0];
            return (
              <li key={l.key} className={cols}>
                <Input aria-label={`${title}: descrição ${i + 1}`} className="h-9" placeholder={example} value={l.description} disabled={disabled} onChange={(e) => set(l.key, { description: e.target.value })} />
                <Input aria-label={`${title}: quantidade ${i + 1}`} inputMode="decimal" className="num h-9" value={l.qty} disabled={disabled} onChange={(e) => set(l.key, { qty: e.target.value })} />
                <Input aria-label={`${title}: valor ${i + 1}`} inputMode="decimal" className="num h-9" placeholder="0,00" value={l.unit} disabled={disabled} onChange={(e) => set(l.key, { unit: e.target.value })} />
                <span className="num hidden text-right text-sm text-text sm:block">{one && one.unitCents >= 0 && one.qtyMilli > 0 ? fmtBRL(costLineTotal(one)) : '—'}</span>
                {!disabled ? <button type="button" className="p-1.5 text-muted hover:text-danger" aria-label={`Remover ${title} ${i + 1}`} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></button> : <span />}
              </li>
            );
          })}</ul>
        </>
      )}
      {!disabled && <Button size="sm" variant="ghost" className="mt-1.5" icon={<Plus className="h-4 w-4" />} onClick={add}>{lines.length ? 'Adicionar outro' : `Adicionar ${title.toLowerCase()}`}</Button>}
    </div>
  );
}

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
  const submit = useMutation({ mutationFn: () => api(`/opportunities/${oppId}/economics/submit`, { method: 'POST', body: {} }), onSuccess: () => done('Enviada para decisão da gestão'), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
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
          {(d.status === 'calculada' || d.status === 'devolvida') && <Button size="sm" variant="primary" disabled={!canSubmit} loading={submit.isPending} title={canSubmit ? undefined : 'Salve o cálculo atualizado antes de enviar'} onClick={() => submit.mutate()}>Enviar para decisão da gestão</Button>}
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
  const [f, setF] = useState<{ mode: EconInput['mode']; term: string; receive: string; capex: Line[]; extra: string; opex: Line[]; commission: string; loss: string; margin: string; price: string } | null>(null);
  // formulário como estava no último salvo: diferente disso, o resultado na tela é só simulação
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    if (q.data?.input && !f) {
      const i = q.data.input;
      const init = { mode: i.mode, term: String(i.termMonths), receive: String(i.receiveMonth), capex: toLines(i.capex), extra: i.extraInitialCents ? money(i.extraInitialCents) : '', opex: toLines(i.opex), commission: bpText(i.commissionBp), loss: bpText(i.lossBp), margin: bpText(i.marginTargetBp), price: money(i.priceCents) };
      setF(init);
      setBase(formKey(init));
    }
  }, [q.data, f]);
  const input = useMemo<EconInput | null>(() => (f ? {
    ...emptyEconInput(), mode: f.mode, termMonths: Number(f.term) || 0, receiveMonth: Number(f.receive) || 0,
    capex: fromLines(f.capex), extraInitialCents: parseMoney(f.extra) ?? -1, opex: fromLines(f.opex),
    commissionBp: parseBp(f.commission), lossBp: parseBp(f.loss), marginTargetBp: parseBp(f.margin), priceCents: f.price.trim() ? parseMoney(f.price) : null,
  } : null), [f]);
  const invalid = !input || [input.commissionBp, input.lossBp, input.marginTargetBp].some((v) => Number.isNaN(v)) || input.extraInitialCents < 0 || [...input.capex, ...input.opex].some((l) => l.unitCents < 0 || l.qtyMilli <= 0 || l.description.length < 2) || (input.mode === 'recorrente' && (input.termMonths < 1 || input.termMonths > 240));
  const live = useMemo(() => (q.data?.settings && input && !invalid ? financeEngine({ input, items: q.data.items, settings: q.data.settings, publicSector: q.data.publicSector }) : null), [q.data, input, invalid]);
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
  const itemsTotal = d.items.reduce((t, i) => t + i.revenueCents, 0);
  const capexTotal = linesTotal(f.capex);
  const opexTotal = linesTotal(f.opex);
  const customized = [f.commission, f.loss, f.margin].some((v) => v.trim() !== '');
  const shown = (v: string, def: number) => (v.trim() ? v : bpText(def));
  const segLoss = d.publicSector ? st.lossPublicBp : st.lossPrivateBp;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-md font-bold text-ink"><Calculator className="h-5 w-5 text-primary" aria-hidden />Viabilidade econômica</h2>
          <p className="max-w-2xl text-sm text-muted">Preencha os passos abaixo; o resultado se atualiza na hora. Os tributos saem do documento fiscal de cada produto (aba Produtos).</p>
        </div>
        {official ? <Chip tone="green">Salvo em {fmtDateTime(d.saved!.updatedAt)}</Chip> : <Chip tone="yellow">Simulação — ainda não salva</Chip>}
      </div>

      <DecisionBar oppId={oppId} d={d} canSubmit={official && !d.stale && d.editable} />
      {official && d.stale && <Notice tone="warning">Produtos, tributos ou parâmetros mudaram depois que esta viabilidade foi salva. O resultado abaixo é o salvo; confira e salve de novo, porque o pedido de aprovação exige o cálculo atualizado.</Notice>}
      {shownResult ? <EconomicsResult r={shownResult} /> : <Notice tone="warning">Confira os campos destacados para ver o resultado.</Notice>}
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
            <div className="grid grid-cols-2 gap-3">
            {f.mode === 'recorrente'
              ? <FormField label="Vigência (meses)" htmlFor="ec-term"><Input id="ec-term" inputMode="numeric" value={f.term} disabled={dis} onChange={(e) => set({ term: e.target.value.replace(/\D/g, '') })} /></FormField>
              : <FormField label="Recebe no mês" htmlFor="ec-rec" hint="0 = à vista"><Input id="ec-rec" inputMode="numeric" value={f.receive} disabled={dis} onChange={(e) => set({ receive: e.target.value.replace(/\D/g, '') })} /></FormField>}
            <FormField label={f.mode === 'recorrente' ? 'Preço por mês (R$)' : 'Preço (R$)'} htmlFor="ec-price" hint={`Total dos produtos: ${fmtBRL(itemsTotal)}`}><Input id="ec-price" inputMode="decimal" placeholder={money(itemsTotal)} value={f.price} disabled={dis} onChange={(e) => set({ price: e.target.value })} /></FormField>
            </div>
          </div>
        </Step>

        <Step n={2} title="Investimento para começar" hint="Pago uma vez, antes de faturar: equipamentos, obra, instalação, projeto, frete." total={<>Total <b className="text-ink">{fmtBRL(capexTotal + Math.max(0, parseMoney(f.extra) ?? 0))}</b></>}>
          <CostLines title="Investimento" example="Ex.: roteador, obra, projeto" lines={f.capex} setLines={(l) => set({ capex: l })} disabled={dis} />
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <label htmlFor="ec-extra" className="text-sm text-text">Frete, mobilização e taxas (valor único)</label>
            <Input id="ec-extra" inputMode="decimal" placeholder="0,00" className="num h-9 w-[140px]" value={f.extra} disabled={dis} invalid={(parseMoney(f.extra) ?? 0) < 0} onChange={(e) => set({ extra: e.target.value })} />
          </div>
        </Step>

        {f.mode === 'recorrente' && (
          <Step n={3} title="Custos mensais para manter o serviço" hint="Todo mês enquanto o contrato durar: trânsito, link de terceiro, licenças, suporte." total={<>Total <b className="text-ink">{fmtBRL(opexTotal)}</b>/mês</>}>
            <CostLines title="Custo mensal" example="Ex.: link de terceiro, licença" lines={f.opex} setLines={(l) => set({ opex: l })} disabled={dis} />
          </Step>
        )}

        <details className="border border-line p-4" open={customized}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2.5">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-xs font-bold text-muted" aria-hidden>{f.mode === 'recorrente' ? 4 : 3}</span>
              <span><span className="block text-sm font-semibold text-ink">Ajustes da negociação <span className="font-normal text-muted">(opcional)</span></span><span className="block text-xs text-muted">Comissão {shown(f.commission, st.commissionBp)}% · glosa {shown(f.loss, segLoss)}% · margem mínima {shown(f.margin, st.marginTargetBp)}%{customized ? '' : ' — padrão da empresa'}</span></span>
            </span>
            <span className="text-xs font-semibold text-primary">Alterar</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Comissão (%)" htmlFor="ec-com" hint="Sobre o preço"><Input id="ec-com" inputMode="decimal" placeholder={bpText(st.commissionBp)} value={f.commission} disabled={dis} invalid={Number.isNaN(parseBp(f.commission))} onChange={(e) => set({ commission: e.target.value })} /></FormField>
            <FormField label="Perda / glosa (%)" htmlFor="ec-loss" hint="Inadimplência, glosas, descontos"><Input id="ec-loss" inputMode="decimal" placeholder={bpText(segLoss)} value={f.loss} disabled={dis} invalid={Number.isNaN(parseBp(f.loss))} onChange={(e) => set({ loss: e.target.value })} /></FormField>
            <FormField label="Margem mínima (%)" htmlFor="ec-mar" hint="Abaixo dela a venda sai da política"><Input id="ec-mar" inputMode="decimal" placeholder={bpText(st.marginTargetBp)} value={f.margin} disabled={dis} invalid={Number.isNaN(parseBp(f.margin))} onChange={(e) => set({ margin: e.target.value })} /></FormField>
          </div>
          <p className="mt-2 text-xs text-muted">Em branco vale o padrão da empresa. TMA de {bpText(st.tmaMonthlyBp)}% ao mês · payback máximo de {d.publicSector ? st.paybackMaxPublic : st.paybackMaxPrivate} meses (esta conta é do setor {d.publicSector ? 'público' : 'privado'}).</p>
        </details>
      </div>

      {d.editable && <div className="flex justify-end"><Button variant="primary" disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>Salvar viabilidade econômica</Button></div>}
      {!!d.history.length && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-ink">Histórico de cálculos ({d.history.length})</summary>
          <ul className="mt-2 divide-y divide-line">{d.history.map((h) => <li key={h.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{fmtDateTime(h.createdAt)} · {h.actorName ?? 'sistema'}{h.reason === 'ganha' ? ' · fechamento' : ''}</span><span className="text-muted">{ECON_VERDICT_LABELS[h.verdict]} · {fmtBRL(h.priceCents)}</span></li>)}</ul>
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
      {d.stale && <Notice tone="warning">Desatualizada: produtos, tributos ou parâmetros mudaram depois de salva.</Notice>}
      {d.financeHidden ? <HiddenVerdict r={r} /> : <EconomicsResult r={r} compact />}
    </section>
  );
}
