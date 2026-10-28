/**
 * Viabilidade econômica da oportunidade (motor financeiro): custos da venda e da entrega, condições comerciais
 * e o resultado na hora — preço mínimo, recomendado, margem, payback, VPL e TIR — numa leitura rápida para o time.
 * O cálculo da tela usa o mesmo motor do servidor; ao salvar, o servidor recalcula e guarda a fotografia auditável.
 */
import { useEffect, useMemo, useState } from 'react';
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
import { errMsg } from '../contracts/shared';

type Data = {
  settings: EconSettings; items: EconItem[]; publicSector: boolean; input: EconInput; saved: { updatedAt: string } | null;
  result: EconResult; editable: boolean; history: { id: string; reason: string; createdAt: string; actorName: string | null; verdict: EconVerdict; priceCents: number | null }[];
};
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
          <span className={lbl(rec)} style={{ left: at(rec) }}>Mínimo <b className="num text-ink">{fmtBRL(min)}</b><br />Recomendado <b className="num text-ink">{fmtBRL(rec)}</b></span>
        ) : (
          <>
            <span className={lbl(min)} style={{ left: at(min) }}>Mínimo<br /><b className="num text-ink">{fmtBRL(min)}</b></span>
            <span className={lbl(rec)} style={{ left: at(rec) }}>Recomendado<br /><b className="num text-ink">{fmtBRL(rec)}</b></span>
          </>
        )}
      </div>
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
        <div className="bg-surface-2 p-2.5"><dt className="text-xs text-muted">Preço {r.priceSource === 'informado' ? 'informado' : r.priceSource === 'itens' ? 'dos produtos' : 'recomendado'}</dt><dd className="num font-bold text-ink">{fmtBRL(r.priceCents)}<span className="text-xs font-normal text-muted">{per}</span></dd></div>
        <div className="bg-surface-2 p-2.5"><dt className="text-xs text-muted">Margem efetiva</dt><dd className={clsx('num font-bold', k && k.marginPct < r.rates.m * 100 ? 'text-[#C2610C]' : 'text-ink')}>{pct(k?.marginPct)}</dd><dd className="text-2xs text-muted">alvo {pct(r.rates.m * 100, 0)}</dd></div>
        <div className="bg-surface-2 p-2.5"><dt className="text-xs text-muted">Payback</dt><dd className={clsx('num font-bold', r.withinPolicy === false ? 'text-danger' : 'text-ink')}>{months(k?.paybackMonths)}</dd><dd className="text-2xs text-muted">limite {r.term.Dalvo} meses · {r.publicSector ? 'público' : 'privado'}</dd></div>
        <div className="bg-surface-2 p-2.5"><dt className="text-xs text-muted">Ganho no contrato (VPL)</dt><dd className={clsx('num font-bold', k && k.npvCents < 0 ? 'text-danger' : 'text-ink')}>{fmtBRL(k?.npvCents ?? null)}</dd><dd className="text-2xs text-muted">TIR {k?.irrAnnual == null ? '—' : pct(k.irrAnnual * 100)} ao ano</dd></div>
      </dl>
      <PriceRuler r={r} />
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-2 flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
        <ChevronDown className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />Como chegamos nesses números
      </button>
      {open && (
        <div className="mt-2 space-y-3 text-sm">
          {k && r.priceCents != null && (
            <table className="w-full max-w-md">
              <caption className="mb-1 text-left text-xs font-semibold text-muted">{r.mode === 'recorrente' ? 'Cada mês' : 'Na venda'}</caption>
              <tbody className="[&_td]:py-0.5">
                <tr><td>Receita</td><td className="num text-right">{fmtBRL(r.priceCents)}</td></tr>
                <tr><td>Tributos ({pct(r.rates.a * 100, 2)}{r.fixedTaxCents ? ` + ${fmtBRL(r.fixedTaxCents)}` : ''})</td><td className="num text-right">−{fmtBRL(k.taxCents)}</td></tr>
                <tr><td>Comissão ({pct(r.rates.c * 100, 2)})</td><td className="num text-right">−{fmtBRL(k.commissionCents)}</td></tr>
                {k.lossCents > 0 && <tr><td>Perda/glosa ({pct(r.rates.g * 100, 2)})</td><td className="num text-right">−{fmtBRL(k.lossCents)}</td></tr>}
                {r.monthlyCostCents > 0 && <tr><td>Custos operacionais</td><td className="num text-right">−{fmtBRL(r.monthlyCostCents)}</td></tr>}
                <tr className="border-t border-line font-semibold"><td>{r.mode === 'recorrente' ? 'Sobra por mês' : 'Sobra antes do investimento'}</td><td className="num text-right">{fmtBRL(k.contributionCents)}</td></tr>
                {r.initialCents > 0 && <tr><td>Investimento inicial</td><td className="num text-right">{fmtBRL(r.initialCents)}</td></tr>}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted">Preço mínimo = cobre custos, tributos e o investimento em {r.mode === 'recorrente' ? `${r.term.D} meses` : 'uma venda'}, com a TMA de {pct(r.rates.r * 100, 2)} ao mês (caixa {fmtBRL(r.floor.cashCents)}, econômico {fmtBRL(r.floor.economicCents)}). Recomendado = entrega a margem alvo de {pct(r.rates.m * 100, 0)} sobre a receita.</p>
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

function CostLines({ title, hint, lines, setLines, perMonth, disabled }: { title: string; hint: string; lines: Line[]; setLines: (l: Line[]) => void; perMonth?: boolean; disabled: boolean }) {
  const total = fromLines(lines).reduce((t, l) => t + (l.unitCents >= 0 && l.qtyMilli > 0 ? costLineTotal(l) : 0), 0);
  const set = (k: string, p: Partial<Line>) => setLines(lines.map((x) => (x.key === k ? { ...x, ...p } : x)));
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-semibold text-ink">{title}</legend>
      <p className="mb-2 text-xs text-muted">{hint}</p>
      {lines.length > 0 && (
        <ul className="space-y-1.5">{lines.map((l, i) => (
          <li key={l.key} className="flex flex-wrap items-center gap-1.5">
            <Input aria-label={`${title}: descrição ${i + 1}`} className="h-9 min-w-[150px] flex-1" placeholder="Ex.: roteador, obra, licença" value={l.description} disabled={disabled} onChange={(e) => set(l.key, { description: e.target.value })} />
            <Input aria-label={`${title}: quantidade ${i + 1}`} inputMode="decimal" className="num h-9 w-[64px]" value={l.qty} disabled={disabled} onChange={(e) => set(l.key, { qty: e.target.value })} />
            <Input aria-label={`${title}: valor ${i + 1}`} inputMode="decimal" className="num h-9 w-[110px]" placeholder="0,00" value={l.unit} disabled={disabled} onChange={(e) => set(l.key, { unit: e.target.value })} />
            {!disabled && <button type="button" className="p-1.5 text-muted hover:text-danger" aria-label={`Remover ${title} ${i + 1}`} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></button>}
          </li>
        ))}</ul>
      )}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {!disabled ? <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setLines([...lines, { key: `l${++seq}`, description: '', qty: '1', unit: '' }])}>Adicionar</Button> : <span />}
        <span className="num text-sm text-muted">Total <b className="text-ink">{fmtBRL(total)}</b>{perMonth ? '/mês' : ''}</span>
      </div>
    </fieldset>
  );
}

export function EconomicsTab({ oppId }: { oppId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['economics', oppId], queryFn: () => api<Data>(`/opportunities/${oppId}/economics`) });
  const [f, setF] = useState<{ mode: EconInput['mode']; term: string; receive: string; capex: Line[]; extra: string; opex: Line[]; commission: string; loss: string; margin: string; price: string } | null>(null);
  useEffect(() => {
    if (q.data && !f) {
      const i = q.data.input;
      setF({ mode: i.mode, term: String(i.termMonths), receive: String(i.receiveMonth), capex: toLines(i.capex), extra: i.extraInitialCents ? money(i.extraInitialCents) : '', opex: toLines(i.opex), commission: bpText(i.commissionBp), loss: bpText(i.lossBp), margin: bpText(i.marginTargetBp), price: money(i.priceCents) });
    }
  }, [q.data, f]);
  const input = useMemo<EconInput | null>(() => (f ? {
    ...emptyEconInput(), mode: f.mode, termMonths: Number(f.term) || 0, receiveMonth: Number(f.receive) || 0,
    capex: fromLines(f.capex), extraInitialCents: parseMoney(f.extra) ?? -1, opex: fromLines(f.opex),
    commissionBp: parseBp(f.commission), lossBp: parseBp(f.loss), marginTargetBp: parseBp(f.margin), priceCents: f.price.trim() ? parseMoney(f.price) : null,
  } : null), [f]);
  const invalid = !input || [input.commissionBp, input.lossBp, input.marginTargetBp].some((v) => Number.isNaN(v)) || input.extraInitialCents < 0 || [...input.capex, ...input.opex].some((l) => l.unitCents < 0 || l.qtyMilli <= 0 || l.description.length < 2) || (input.mode === 'recorrente' && (input.termMonths < 1 || input.termMonths > 240));
  const live = useMemo(() => (q.data && input && !invalid ? financeEngine({ input, items: q.data.items, settings: q.data.settings, publicSector: q.data.publicSector }) : null), [q.data, input, invalid]);
  const save = useMutation({
    mutationFn: () => api<{ result: EconResult }>(`/opportunities/${oppId}/economics`, { method: 'PUT', body: input }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['economics', oppId] }); toast({ tone: 'success', message: 'Viabilidade econômica salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading || !f) return <LoadingRows rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const st = d.settings;
  const dis = !d.editable;
  const set = (p: Partial<NonNullable<typeof f>>) => setF({ ...f, ...p });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-md font-bold text-ink"><Calculator className="h-5 w-5 text-primary" aria-hidden />Viabilidade econômica</h2>
          <p className="max-w-2xl text-sm text-muted">Informe tudo o que a venda e a entrega custam. Os tributos saem do documento fiscal de cada produto (aba Produtos). O resultado aparece abaixo e no painel Viabilidade da venda.</p>
        </div>
        {d.saved && <p className="text-xs text-muted">Salvo em {fmtDateTime(d.saved.updatedAt)}</p>}
      </div>

      {live ? <EconomicsResult r={live} /> : <Notice tone="warning">Confira os campos destacados para ver o resultado.</Notice>}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold text-ink">Tipo de venda</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {(['recorrente', 'pontual'] as const).map((m) => (
                <label key={m} className={clsx('flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm', f.mode === m ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line')}>
                  <input type="radio" className="accent-primary" checked={f.mode === m} disabled={dis} onChange={() => set({ mode: m })} />{m === 'recorrente' ? 'Contrato recorrente' : 'Venda pontual'}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            {f.mode === 'recorrente'
              ? <FormField label="Vigência (meses)" htmlFor="ec-term"><Input id="ec-term" inputMode="numeric" value={f.term} disabled={dis} onChange={(e) => set({ term: e.target.value.replace(/\D/g, '') })} /></FormField>
              : <FormField label="Mês do recebimento" htmlFor="ec-rec" hint="0 = à vista"><Input id="ec-rec" inputMode="numeric" value={f.receive} disabled={dis} onChange={(e) => set({ receive: e.target.value.replace(/\D/g, '') })} /></FormField>}
            <FormField label={`Preço avaliado${f.mode === 'recorrente' ? ' (mês)' : ''}`} htmlFor="ec-price" hint={`Em branco: total dos produtos (${fmtBRL(d.items.reduce((t, i) => t + i.revenueCents, 0))})`}><Input id="ec-price" inputMode="decimal" placeholder="0,00" value={f.price} disabled={dis} onChange={(e) => set({ price: e.target.value })} /></FormField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Comissão %" htmlFor="ec-com"><Input id="ec-com" inputMode="decimal" placeholder={bpText(st.commissionBp)} value={f.commission} disabled={dis} invalid={Number.isNaN(parseBp(f.commission))} onChange={(e) => set({ commission: e.target.value })} /></FormField>
            <FormField label="Perda/glosa %" htmlFor="ec-loss"><Input id="ec-loss" inputMode="decimal" placeholder={bpText(st.lossBp)} value={f.loss} disabled={dis} invalid={Number.isNaN(parseBp(f.loss))} onChange={(e) => set({ loss: e.target.value })} /></FormField>
            <FormField label="Margem alvo %" htmlFor="ec-mar"><Input id="ec-mar" inputMode="decimal" placeholder={bpText(st.marginTargetBp)} value={f.margin} disabled={dis} invalid={Number.isNaN(parseBp(f.margin))} onChange={(e) => set({ margin: e.target.value })} /></FormField>
          </div>
          <p className="text-xs text-muted">Em branco vale o padrão da empresa. TMA de {bpText(st.tmaMonthlyBp)}% ao mês · payback máximo {st.paybackMaxPrivate} meses (privado) e {st.paybackMaxPublic} (público) · esta conta é do setor {d.publicSector ? 'público' : 'privado'}.</p>
        </div>
        <div className="space-y-4">
          <CostLines title="Investimento inicial (CAPEX)" hint="Pago antes de começar: equipamentos, obra, instalação, projeto." lines={f.capex} setLines={(l) => set({ capex: l })} disabled={dis} />
          <FormField label="Outros custos iniciais" htmlFor="ec-extra" hint="Frete, mobilização, taxas (valor único)"><Input id="ec-extra" inputMode="decimal" placeholder="0,00" className="w-[160px]" value={f.extra} disabled={dis} onChange={(e) => set({ extra: e.target.value })} /></FormField>
          {f.mode === 'recorrente' && <CostLines title="Custos mensais (operação)" hint="Todo mês para manter o serviço: trânsito, links de terceiros, licenças, suporte." lines={f.opex} setLines={(l) => set({ opex: l })} perMonth disabled={dis} />}
        </div>
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
  if (!q.data?.saved) return null;
  return (
    <section className="card p-4" aria-labelledby="econ-sum">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="econ-sum" className="flex items-center gap-2 font-bold text-ink"><Calculator className="h-5 w-5 text-primary" aria-hidden />Viabilidade da venda</h2>
        <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={onOpen}>Abrir</button>
      </div>
      <EconomicsResult r={q.data.result} compact />
    </section>
  );
}
