/**
 * Negociação por seções (tipos de negócio): Venda, Aluguel e Recorrência.
 * - Aba Produtos e serviços: cada seção com os produtos (item, produto, documento fiscal, medida, qtd., observação)
 *   e os custos da negociação (dedução, descrição, único/mensal, qtd., valor), digitados, colados do Excel ou importados
 *   da planilha da viabilidade técnica.
 * - Aba Viabilidade econômica: por seção, só margem e payback até o preço ideal, com as deduções em lista; embaixo a
 *   visão geral do negócio (indicadores, gráfico acumulado e DRE consolidada).
 * O cálculo da tela usa o mesmo motor do servidor; salvar recalcula no servidor e guarda a fotografia auditável.
 */
import { Fragment, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Calculator, ClipboardPaste, FileSpreadsheet, Plus, Trash2 } from 'lucide-react';
import { FISCAL_KINDS, FISCAL_KIND_LABELS, type FiscalKind } from '@isp/shared';
import {
  COST_CATEGORIES, COST_CATEGORY_LABELS, COST_CATEGORY_SHORT, ECON_VERDICT_LABELS, ITEM_UNITS, ITEM_UNIT_LABELS, SECTION_KINDS, SECTION_KIND_LABELS,
  buildModel, categoryOfImpact, costQty, isMonthlySection, parseCostTable, parseMoney, parseQty, sectionCostTotal, sectionsEngine, sectionsFromLegacy,
  type CostCategory, type CostFrequency, type CostImpact, type DealKind, type DealSection, type EconInput, type EconItem, type EconResult, type EconSettings, type EconVerdict,
  type FinOverride, type FiscalArgs, type ItemUnit, type SectionCost, type SectionKind, type SectionOutcome,
} from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import type { Opportunity } from '../../lib/types';
import { Button, Chip, ErrorState, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { LineChart } from '../../components/charts/charts';
import { errMsg } from '../contracts/shared';

// ------------------------------------------------------------------ tipos e utilitários
type SavedItem = { id: string; description: string; unit: ItemUnit; qtyMilli: number; unitCents: number; discountCents: number; surchargeCents: number; notes: string | null; bidUnitCents: number | null; fiscalDocTypeId?: string | null; dealKind?: DealKind; deliveryAddressId?: string | null; costProfile?: 'fornecimento' | 'implantacao' | null; section?: number };
type ItemsData = { items: SavedItem[]; bid: boolean; rowVersion: number; editable: boolean };
type Doc = { id: string; branchId: string; fiscalKind: FiscalKind; code: string; name: string; rates: { percentBp: number; fixedCents: number; complete: boolean } };
type ProductCat = { id: string; description: string; unit: string; lastUnitCents: number; dealKind: string; fiscalDocTypeId: string | null };
type CostCat = { id: string; name: string; kind: 'investimento' | 'mensal'; unit: string; impact?: CostImpact | null; unitCents: number | null };
export type EconData = {
  settings: EconSettings | null; items: EconItem[]; publicSector: boolean; input: EconInput; saved: { updatedAt: string } | null; modelOverrides?: FinOverride[];
  result: EconResult | null; stale: boolean; editable: boolean; fiscal?: FiscalArgs; financeHidden: boolean;
};
type ItemRow = { key: string; id?: string; description: string; unit: ItemUnit; qty: string; value: string; notes: string; doc: string; kind: DealKind; addr: string | null; prof: 'fornecimento' | 'implantacao' | null; discount: number; surcharge: number; bid: number | null };
type CostRow = { key: string; description: string; qty: string; value: string; measure: string | null; category: CostCategory | ''; frequency: CostFrequency; costItemId: string | null; origin?: 'planilha' };
type SecForm = { key: string; id: string; kind: SectionKind; term: string; receive: string; items: ItemRow[]; costs: CostRow[]; marginTargetBp: number | null; paybackMonths: number | null; priceCents: number | null };

let seq = 0;
const nk = (p: string) => `${p}${++seq}`;
const money = (c: number | null | undefined) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qtyText = (m: number) => (m / 1000).toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 3 });
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const bpText = (bp: number | null | undefined) => (bp == null ? '' : (bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const parseBp = (t: string): number | null => { if (!t.trim()) return null; const n = Number(t.replace(',', '.')); return Number.isFinite(n) && n >= 0 && n < 100 ? Math.round(n * 100) : NaN; };
const monthsText = (v: number | null | undefined) => (v == null ? 'não se paga' : v <= 0 ? 'imediato' : `${Math.ceil(v - 1e-9)} ${Math.ceil(v - 1e-9) === 1 ? 'mês' : 'meses'}`);
const dealKindOf = (k: SectionKind, cur?: DealKind): DealKind => (k === 'venda' ? (cur === 'servico' ? 'servico' : 'venda') : k);
const CAT_TONE: Record<CostCategory, string> = { materia_prima: 'bg-primary-soft text-primary', mao_de_obra: 'bg-surface-2 text-ink', parceiros: 'bg-warning-soft text-[#9A4F08]', despesas_operacionais: 'bg-success-soft text-success' };
const VERDICT_TONE: Record<EconVerdict, 'green' | 'blue' | 'orange' | 'red' | 'neutral'> = { viavel: 'green', abaixo_recomendado: 'blue', fora_politica: 'orange', abaixo_minimo: 'red', inviavel: 'red', sem_preco: 'neutral', abaixo_faixa: 'red', acima_faixa: 'orange', aguardando_sugerido: 'neutral', sem_margem_liquida: 'neutral' };

const itemRow = (i: SavedItem): ItemRow => ({ key: nk('i'), id: i.id, description: i.description, unit: i.unit, qty: qtyText(i.qtyMilli), value: i.unitCents ? money(i.unitCents) : '', notes: i.notes ?? '', doc: i.fiscalDocTypeId ?? '', kind: i.dealKind ?? 'recorrencia', addr: i.deliveryAddressId ?? null, prof: i.costProfile ?? null, discount: i.discountCents, surcharge: i.surchargeCents, bid: i.bidUnitCents });
const costRow = (c: SectionCost): CostRow => ({ key: nk('c'), description: c.description, qty: qtyText(c.qtyMilli), value: money(c.unitCents), measure: c.unit ?? null, category: c.category ?? '', frequency: c.frequency, costItemId: c.costItemId ?? null });
const blankItem = (k: SectionKind, doc = ''): ItemRow => ({ key: nk('i'), description: '', unit: 'un', qty: '1', value: '', notes: '', doc, kind: dealKindOf(k), addr: null, prof: null, discount: 0, surcharge: 0, bid: null });
const blankCost = (k: SectionKind): CostRow => ({ key: nk('c'), description: '', qty: '1', value: '', measure: null, category: '', frequency: k === 'venda' ? 'unico' : 'mensal', costItemId: null });
const newSection = (kind: SectionKind, n: number): SecForm => ({ key: nk('s'), id: `s${Date.now().toString(36)}${n}`, kind, term: '12', receive: '0', items: [], costs: [], marginTargetBp: null, paybackMonths: null, priceCents: null });

/** Formulário → seções do motor (custos vazios saem; sem classificação ficam fora do cálculo). */
const toSections = (fs: SecForm[]): DealSection[] => fs.map((f) => ({
  id: f.id, kind: f.kind, termMonths: Number(f.term) || 12, receiveMonth: Number(f.receive) || 0, marginTargetBp: f.marginTargetBp, paybackMonths: f.paybackMonths, priceCents: f.priceCents,
  costs: f.costs.filter((c) => c.description.trim() || c.value.trim()).map((c) => ({ description: c.description.trim(), qtyMilli: costQty(c.qty) ?? 0, unitCents: parseMoney(c.value) ?? -1, unit: c.measure, category: c.category || null, frequency: f.kind === 'venda' ? 'unico' : c.frequency, costItemId: c.costItemId })),
}));
const itemInputs = (fs: SecForm[]) => fs.flatMap((f, si) => f.items.filter((r) => r.description.trim()).map((r) => ({
  description: r.description.trim(), unit: r.unit, qtyMilli: parseQty(r.qty) ?? 0, unitCents: parseMoney(r.value) ?? 0, discountCents: r.discount, surchargeCents: r.surcharge, notes: r.notes.trim() || null, bidUnitCents: r.bid,
  fiscalDocTypeId: r.doc || null, dealKind: dealKindOf(f.kind, r.kind), deliveryAddressId: r.addr, costProfile: r.prof, section: si,
})));
/** Preço da seção nos produtos (valor da proposta): rateado pelo valor atual; sem valor, pela quantidade. */
export function distributePrice(price: number, rows: { qtyMilli: number; totalCents: number }[]): number[] {
  if (!rows.length) return [];
  const w = rows.map((r) => (rows.some((x) => x.totalCents > 0) ? Math.max(0, r.totalCents) : Math.max(1, r.qtyMilli)));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  let left = price;
  return rows.map((r, k) => {
    const part = k === rows.length - 1 ? left : Math.round((price * w[k]!) / sum);
    left -= part;
    return Math.max(0, Math.round((part * 1000) / Math.max(1, r.qtyMilli)));
  });
}

function useEconBase(oppId: string) {
  const econ = useQuery({ queryKey: ['economics', oppId], queryFn: () => api<EconData>(`/opportunities/${oppId}/economics`) });
  const model = useMemo(() => { try { return buildModel(econ.data?.modelOverrides ?? []); } catch { return undefined; } }, [econ.data?.modelOverrides]);
  return { econ, model };
}
/** Cálculo ao vivo das seções (mesmo motor do servidor). */
function liveResult(d: EconData | undefined, model: ReturnType<typeof buildModel> | undefined, sections: DealSection[], items: EconItem[]): EconResult | null {
  if (!d?.settings || !sections.length) return null;
  try { return sectionsEngine({ input: { ...d.input, capex: [], opex: [], extraInitialCents: 0, sections }, items, settings: d.settings, publicSector: d.publicSector, model, fiscal: d.fiscal }); } catch { return null; }
}

// ------------------------------------------------------------------ aba Produtos e serviços
export function DealSectionsEditor({ opp }: { opp: Opportunity }) {
  const toast = useToast();
  const qc = useQueryClient();
  const itemsQ = useQuery({ queryKey: ['opp-items', opp.id], queryFn: () => api<ItemsData>(`/opportunities/${opp.id}/items`) });
  const { econ, model } = useEconBase(opp.id);
  const docsQ = useQuery({ queryKey: ['fiscal-docs'], queryFn: () => api<{ items: Doc[] }>('/fiscal-docs'), staleTime: 60_000 });
  const prodQ = useQuery({ queryKey: ['product-catalog'], queryFn: () => api<{ items: ProductCat[] }>('/product-catalog'), staleTime: 60_000 });
  const finance = econ.data ? !econ.data.financeHidden : false;
  const costQ = useQuery({ queryKey: ['cost-items'], queryFn: () => api<{ items: CostCat[] }>('/cost-items'), staleTime: 60_000, enabled: finance });
  const plans = useLookups().data?.plans ?? [];
  const docs = (docsQ.data?.items ?? []).filter((d) => !opp.branchId || d.branchId === opp.branchId);
  const products = prodQ.data?.items ?? [];
  const costCat = costQ.data?.items ?? [];
  const [form, setForm] = useState<SecForm[] | null>(null);
  const [base, setBase] = useState('');
  const [values, setValues] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (form || !itemsQ.data || !econ.data) return;
    const saved = itemsQ.data.items;
    const inp = econ.data.input;
    let secs: DealSection[];
    let at: number[];
    if (inp?.sections?.length) { secs = inp.sections; at = saved.map((i) => Math.min(secs.length - 1, i.section ?? 0)); }
    else { const c = sectionsFromLegacy(inp ?? { mode: 'recorrente', termMonths: 12, receiveMonth: 0, capex: [], extraInitialCents: 0, opex: [], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null }, saved.map((i) => ({ kind: i.dealKind ?? 'recorrencia' }))); secs = c.sections; at = c.itemSection; }
    const f = secs.map((s, k) => ({ key: nk('s'), id: s.id, kind: s.kind, term: String(s.termMonths), receive: String(s.receiveMonth), marginTargetBp: s.marginTargetBp, paybackMonths: s.paybackMonths, priceCents: s.priceCents, costs: s.costs.map(costRow), items: saved.filter((_, i) => at[i] === k).map(itemRow) }));
    setForm(f);
    setBase(JSON.stringify(strip(f)));
  }, [itemsQ.data, econ.data, form]);
  const editable = !!itemsQ.data?.editable;
  const dirty = !!form && JSON.stringify(strip(form)) !== base;
  const sections = useMemo(() => (form ? toSections(form) : []), [form]);
  const liveItems = useMemo<EconItem[]>(() => (form ?? []).flatMap((f, si) => f.items.filter((r) => r.description.trim()).map((r) => {
    const d = docs.find((x) => x.id === r.doc);
    return { description: r.description, revenueCents: 0, kind: dealKindOf(f.kind, r.kind), section: si, costProfile: r.prof, doc: d ? { id: d.id, name: `${d.code} · ${d.name}`, percentBp: d.rates.percentBp, fixedCents: d.rates.fixedCents, complete: d.rates.complete, fiscalKind: d.fiscalKind } : null };
  })), [form, docs]);
  const deferred = useDeferredValue({ sections, liveItems });
  const live = useMemo(() => (finance ? liveResult(econ.data, model, deferred.sections, deferred.liveItems) : null), [finance, econ.data, model, deferred]);

  const save = useMutation({
    mutationFn: async () => {
      const fs = form!;
      const items = itemInputs(fs);
      if (items.some((i) => !i.qtyMilli)) throw new Error('Confira a quantidade dos produtos.');
      if (fs.some((f) => f.costs.some((c) => (c.description.trim() || c.value.trim()) && (c.description.trim().length < 2 || parseMoney(c.value) == null || !costQty(c.qty))))) throw new Error('Confira descrição, quantidade e valor dos custos.');
      const o = await api<Opportunity>(`/opportunities/${opp.id}/items`, { method: 'PUT', body: { rowVersion: itemsQ.data!.rowVersion, items } });
      qc.setQueryData(['opportunity', o.id], o);
      let econSaved = false;
      if (finance && econ.data?.settings) {
        const inp = econ.data.input;
        await api(`/opportunities/${opp.id}/economics`, { method: 'PUT', body: { mode: fs.some((f) => isMonthlySection(f.kind)) ? 'recorrente' : 'pontual', termMonths: 12, receiveMonth: 0, capex: [], extraInitialCents: 0, opex: [], commissionBp: null, lossBp: inp.lossBp ?? null, variableBp: inp.variableBp ?? null, marginTargetBp: null, paybackMonths: null, priceCents: null, salePriceCents: null, fiscalYear: inp.fiscalYear ?? null, b2g: null, sections: toSections(fs) } });
        econSaved = true;
      }
      return econSaved;
    },
    onSuccess: (econSaved) => {
      setForm(null);
      void qc.invalidateQueries({ queryKey: ['opp-items', opp.id] }); void qc.invalidateQueries({ queryKey: ['economics', opp.id] }); void qc.invalidateQueries({ queryKey: ['product-catalog'] }); void qc.invalidateQueries({ queryKey: ['cost-items'] }); void qc.invalidateQueries({ queryKey: ['timeline', opp.id] });
      toast({ tone: 'success', message: econSaved ? 'Produtos, custos e viabilidade salvos' : 'Produtos e serviços salvos' });
    },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });

  if (itemsQ.isError) return <ErrorState error={itemsQ.error} onRetry={() => itemsQ.refetch()} />;
  if (econ.isError) return <ErrorState error={econ.error} onRetry={() => econ.refetch()} />;
  if (!form) return <LoadingRows rows={4} />;
  const setSec = (k: string, p: Partial<SecForm>) => setForm(form.map((f) => (f.key === k ? { ...f, ...p } : f)));
  const suggestDoc = (k: SectionKind) => { const want: FiscalKind = k === 'venda' ? 'venda' : k === 'locacao' ? 'locacao' : 'servico'; return [...docs].sort((a, b) => a.code.localeCompare(b.code)).find((d) => d.fiscalKind === want)?.id ?? ''; };
  const docForPlan = (name: string) => { const code = plans.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())?.fiscalDocCode; return code ? docs.find((d) => d.code === code.toUpperCase())?.id ?? '' : ''; };
  const docLabel = (d: Doc) => `${d.code} · ${d.name}`;
  const outcomes = live?.sections ?? [];

  return (
    <section aria-label="Produtos e serviços" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-md font-bold text-ink">Produtos e serviços</h2>
          <p className="max-w-2xl text-sm text-muted">Separe a negociação por tipo de negócio. Em cada um, os produtos e os custos que a viabilidade econômica usa.</p>
        </div>
        {editable && <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Salvar produtos e custos</Button>}
      </div>
      {finance && econ.data && !econ.data.settings && <Notice tone="warning">A empresa ainda não informou os parâmetros da viabilidade (Configurações → Viabilidade): os produtos são salvos, os custos e o cálculo esperam os parâmetros.</Notice>}

      {form.map((f, si) => {
        const out: SectionOutcome | undefined = outcomes[si];
        const monthly = isMonthlySection(f.kind);
        const showValues = !!values[f.key] || f.items.some((r) => !!r.bid);
        const valueTotal = f.items.reduce((t, r) => t + Math.round(((parseQty(r.qty) ?? 0) * (parseMoney(r.value) ?? 0)) / 1000), 0);
        const setItem = (k: string, p: Partial<ItemRow>) => setSec(f.key, { items: f.items.map((r) => (r.key === k ? { ...r, ...p } : r)) });
        return (
          <section key={f.key} className="border border-line bg-surface" aria-label={`Tipo de negócio ${si + 1}`}>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <span className="grid h-6 w-6 place-items-center bg-ink text-xs font-bold text-white" aria-hidden>{si + 1}</span>
              <b className="text-ink">Tipo de negócio</b>
              <div className="flex border border-line-strong" role="radiogroup" aria-label={`Tipo de negócio ${si + 1}`}>
                {SECTION_KINDS.map((k) => <button key={k} type="button" role="radio" aria-checked={f.kind === k} disabled={!editable} onClick={() => setSec(f.key, { kind: k, items: f.items.map((r) => ({ ...r, kind: dealKindOf(k, r.kind) })), costs: k === 'venda' ? f.costs.map((c) => ({ ...c, frequency: 'unico' })) : f.costs })} className={clsx('border-r border-line-strong px-3.5 py-1.5 text-sm last:border-r-0', f.kind === k ? 'bg-primary font-semibold text-white' : 'text-ink hover:bg-surface-2')}>{SECTION_KIND_LABELS[k]}</button>)}
              </div>
              {monthly
                ? <label className="flex items-center gap-1.5 text-sm text-muted">Vigência <Input aria-label={`Vigência em meses ${si + 1}`} inputMode="numeric" className="num h-9 w-[72px]" value={f.term} disabled={!editable} onChange={(e) => setSec(f.key, { term: e.target.value.replace(/\D/g, '').slice(0, 3) })} /> meses</label>
                : <label className="flex items-center gap-1.5 text-sm text-muted">Recebe no mês <Input aria-label={`Recebe no mês ${si + 1}`} inputMode="numeric" className="num h-9 w-[60px]" value={f.receive} disabled={!editable} onChange={(e) => setSec(f.key, { receive: e.target.value.replace(/\D/g, '').slice(0, 2) })} /> (0 = à vista)</label>}
              <span className="flex-1" />
              {editable && form.length > 1 && <button type="button" className="text-sm text-muted hover:text-danger" onClick={() => setForm(form.filter((x) => x.key !== f.key))}>Remover seção</button>}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm" aria-label={`Produtos do tipo de negócio ${si + 1}`}>
                <thead className="bg-surface-2 text-left text-xs text-muted"><tr>{['Item', 'Produto ou serviço', 'Documento fiscal', 'Medida', 'Qtd.', ...(showValues ? ['Valor unitário (proposta)'] : []), 'Observação', ''].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {f.items.map((r, i) => (
                    <tr key={r.key} className="border-t border-line">
                      <td className="w-[56px] px-2 py-1.5"><span className="num grid h-9 place-items-center bg-surface-2 font-semibold text-ink" aria-label={`Item ${i + 1}`}>{i + 1}</span></td>
                      <td className="px-2 py-1.5"><Input aria-label={`Produto ou serviço ${si + 1}.${i + 1}`} list="deal-products" className="h-9 min-w-[220px]" value={r.description} disabled={!editable} onChange={(e) => {
                        const v = e.target.value; const c = products.find((p) => p.description.toLowerCase() === v.trim().toLowerCase());
                        const doc = !r.doc ? c?.fiscalDocTypeId || docForPlan(v) || suggestDoc(f.kind) : '';
                        setItem(r.key, { description: v, ...(doc ? { doc } : {}), ...(c ? { unit: c.unit as ItemUnit } : {}) });
                      }} /></td>
                      <td className="w-[220px] px-2 py-1.5">
                        <Select aria-label={`Documento fiscal ${si + 1}.${i + 1}`} className={clsx('h-9 w-full', !r.doc && 'text-[#C2610C]')} value={r.doc} disabled={!editable} onChange={(e) => setItem(r.key, { doc: e.target.value })} title={r.doc ? undefined : 'Obrigatório: sem documento fiscal a seção fica sem tributos'}>
                          <option value="">Documento fiscal…</option>
                          {FISCAL_KINDS.filter((k) => docs.some((d) => d.fiscalKind === k)).map((k) => <optgroup key={k} label={FISCAL_KIND_LABELS[k]}>{docs.filter((d) => d.fiscalKind === k).map((d) => <option key={d.id} value={d.id}>{docLabel(d)}</option>)}</optgroup>)}
                          {r.doc && !docs.some((d) => d.id === r.doc) && <option value={r.doc}>Documento de outra filial</option>}
                        </Select>
                      </td>
                      <td className="w-[100px] px-2 py-1.5"><Select aria-label={`Medida ${si + 1}.${i + 1}`} className="h-9 w-full" value={r.unit} disabled={!editable} onChange={(e) => setItem(r.key, { unit: e.target.value as ItemUnit })}>{ITEM_UNITS.map((u) => <option key={u} value={u}>{ITEM_UNIT_LABELS[u]}</option>)}</Select></td>
                      <td className="w-[80px] px-2 py-1.5"><Input aria-label={`Quantidade ${si + 1}.${i + 1}`} inputMode="decimal" className="num h-9 w-full" value={r.qty} disabled={!editable} onChange={(e) => setItem(r.key, { qty: e.target.value })} /></td>
                      {showValues && <td className="w-[140px] px-2 py-1.5"><Input aria-label={`Valor unitário ${si + 1}.${i + 1}`} inputMode="decimal" className="num h-9 w-full" placeholder="0,00" value={r.value} disabled={!editable} onChange={(e) => setItem(r.key, { value: e.target.value })} /></td>}
                      <td className="px-2 py-1.5"><Input aria-label={`Observação ${si + 1}.${i + 1}`} className="h-9 min-w-[180px]" value={r.notes} disabled={!editable} onChange={(e) => setItem(r.key, { notes: e.target.value })} /></td>
                      <td className="w-[36px] px-1 py-1.5">{editable && <button type="button" className="p-1.5 text-muted hover:text-danger" aria-label={`Remover produto ${si + 1}.${i + 1}`} onClick={() => setSec(f.key, { items: f.items.filter((x) => x.key !== r.key) })}><Trash2 className="h-4 w-4" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-4 px-4 py-2.5">
              {editable && <button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline" onClick={() => setSec(f.key, { items: [...f.items, blankItem(f.kind, suggestDoc(f.kind))] })}><Plus className="h-4 w-4 border border-primary" aria-hidden />Adicionar produto ou serviço</button>}
              <span className="flex-1" />
              {f.items.length > 0 && <span className="text-xs text-muted">Valor na proposta: <b className="num text-ink">{fmtBRL(valueTotal)}</b>{monthly ? '/mês' : ''}{f.priceCents != null ? ' · preço definido na viabilidade' : ''}</span>}
              {f.items.length > 0 && editable && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setValues({ ...values, [f.key]: !values[f.key] })}>{showValues ? 'Ocultar valores' : 'Editar valores'}</button>}
            </div>

            {finance && <SectionCosts f={f} si={si} editable={editable} catalog={costCat} setCosts={(costs) => setSec(f.key, { costs })} />}

            {finance && out && (
              <div className="flex flex-wrap border-t border-line bg-surface-2">
                <Kpi label={f.priceCents != null ? 'Preço praticado' : 'Preço ideal'} value={out.priceCents != null ? `${fmtBRL(out.priceCents)}${monthly ? '/mês' : ''}` : '—'} />
                <Kpi label="Margem" value={pct(out.contributionPct)} />
                {monthly ? <Kpi label="Payback" value={out.investment.totalCents ? monthsText(out.paybackMonths) : 'sem investimento'} /> : <Kpi label="Pagamento" value={f.receive === '0' || !f.receive ? 'À vista' : `Mês ${f.receive}`} />}
                {monthly && <Kpi label="Investimento (custos únicos)" value={fmtBRL(out.investment.totalCents)} />}
                <span className="ml-auto self-center px-4 py-2 text-xs text-muted">{dirty ? 'Prévia (salve para valer)' : 'Ajuste margem e payback na aba Viabilidade econômica'}</span>
              </div>
            )}
          </section>
        );
      })}

      {editable && form.length < 10 && (
        <button type="button" className="flex w-full items-center justify-center gap-2 border-[1.5px] border-dashed border-line-strong bg-surface py-3.5 font-semibold text-primary hover:bg-primary-soft/40" onClick={() => setForm([...form, newSection(form.some((f) => f.kind === 'venda') ? 'recorrencia' : 'venda', form.length)])}>
          <Plus className="h-4 w-4 border border-primary" aria-hidden />Adicionar novo tipo de venda
        </button>
      )}
      <datalist id="deal-products">{products.map((c) => <option key={c.id} value={c.description} />)}{plans.filter((p) => !products.some((c) => c.description.toLowerCase() === p.name.toLowerCase())).map((p) => <option key={p.id} value={p.name} />)}</datalist>
      {finance && <p className="text-xs text-muted">Na recorrência e no aluguel, custo único (matéria-prima, mão de obra da entrega) vira investimento e só o mensal deduz do preço. Na venda, tudo deduz direto.</p>}
      {dirty && editable && <div className="flex justify-end"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar produtos e custos</Button></div>}
    </section>
  );
}
const strip = (fs: SecForm[]) => fs.map(({ key: _k, items, costs, ...f }) => ({ ...f, items: items.map(({ key: _i, ...r }) => r), costs: costs.map(({ key: _c, origin: _o, ...c }) => c) }));
const Kpi = ({ label, value }: { label: string; value: string }) => <div className="border-r border-line px-4 py-2.5"><small className="block text-2xs text-muted">{label}</small><b className="num text-ink">{value}</b></div>;

/** Custos da seção: dedução, descrição (catálogo), único/mensal, qtd. e valor; colar do Excel ou importar a planilha técnica. */
function SectionCosts({ f, si, editable, catalog, setCosts }: { f: SecForm; si: number; editable: boolean; catalog: CostCat[]; setCosts: (c: CostRow[]) => void }) {
  const monthly = isMonthlySection(f.kind);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const set = (k: string, p: Partial<CostRow>) => setCosts(f.costs.map((c) => (c.key === k ? { ...c, ...p } : c)));
  const findCat = (name: string) => catalog.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const onName = (c: CostRow, v: string) => {
    const hit = findCat(v);
    set(c.key, { description: v, costItemId: hit?.id ?? null, ...(hit && c.costItemId !== hit.id ? { ...(hit.unitCents != null ? { value: money(hit.unitCents) } : {}), ...(!c.category ? { category: hit.kind === 'mensal' ? (hit.impact === 'parceiro' ? 'parceiros' : 'despesas_operacionais') : categoryOfImpact(hit.impact) ?? '' } : {}), ...(monthly ? { frequency: hit.kind === 'mensal' ? 'mensal' : 'unico' } : {}), measure: hit.unit } : {}) });
  };
  const addTable = (table: (string | number | null)[][], from: string) => {
    const r = parseCostTable(table);
    if (r.missing.length) { setMsg({ text: `${from}: não encontrei as colunas ${r.missing.join(', ')}. Use os títulos Descrição, Quantidade e Valor unitário (Unidade, Valor total, Frequência e "Impacta o quê?" são opcionais).`, bad: true }); return; }
    const rows: CostRow[] = r.lines.map((x) => {
      const hit = findCat(x.description);
      const freq: CostFrequency = !monthly ? 'unico' : x.frequency ?? (hit?.kind === 'mensal' ? 'mensal' : 'unico');
      const cat = categoryOfImpact(x.impact && !(x.impact === 'operacional' && freq === 'unico') ? x.impact : hit?.impact ?? (freq === 'mensal' ? 'operacional' : null));
      return { key: nk('c'), description: x.description, qty: qtyText(x.qtyMilli), value: money(x.unitCents), measure: x.unit ?? hit?.unit ?? null, category: cat ?? '', frequency: freq, costItemId: hit?.id ?? null, origin: 'planilha' };
    });
    setCosts([...f.costs.filter((c) => c.description.trim() || c.value.trim()), ...rows]);
    const sum = (fr: CostFrequency) => r.lines.filter((_, k) => rows[k]!.frequency === fr).reduce((t, x) => t + sectionCostTotal(x), 0);
    const loose = rows.filter((x) => !x.category).length;
    setMsg({ text: `${from}: ${rows.length} custo(s) incluído(s): ${fmtBRL(sum('unico'))} únicos${monthly ? ` e ${fmtBRL(sum('mensal'))} mensais` : ''}.${loose ? ` ${loose} sem dedução fica(m) fora do cálculo até ser(em) classificado(s).` : ''}${r.errors.length ? ` ${r.errors.length} linha(s) ignorada(s): ${r.errors.slice(0, 3).map((e) => `linha ${e.row} (${e.message})`).join('; ')}.` : ''} Confira e salve.`, bad: r.errors.length > 0 || loose > 0 });
  };
  const onFile = async (file: File) => {
    try {
      if (/\.xlsx?$/i.test(file.name)) { const { default: readXlsx } = await import('read-excel-file'); addTable((await readXlsx(file)) as (string | number | null)[][], file.name); }
      else { const text = await file.text(); const l0 = text.split('\n')[0] ?? ''; const sep = text.includes('\t') ? '\t' : l0.split(';').length > l0.split(',').length ? ';' : ','; addTable(text.split(/\r?\n/).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, ''))), file.name); }
    } catch { setMsg({ text: `Não foi possível ler ${file.name}. Use Excel (.xlsx) ou CSV.`, bad: true }); }
  };
  const listId = `deal-costs-${si}`;
  return (
    <div className="border-t border-line px-4 pb-3 pt-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-ink">Custos desta negociação</h4>
        <span className="flex-1" />
        {editable && <>
          <Button size="sm" icon={<ClipboardPaste className="h-4 w-4" />} onClick={() => setPasting(true)}>Colar do Excel</Button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-2">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />Importar planilha da viabilidade técnica
            <input type="file" accept=".xlsx,.xls,.csv,.txt" className="sr-only" aria-label={`Importar planilha de custos ${si + 1}`} onChange={(e) => { const x = e.target.files?.[0]; if (x) void onFile(x); e.target.value = ''; }} />
          </label>
        </>}
      </div>
      {msg && <p role="status" className={clsx('mb-2 border-l-[3px] px-2.5 py-1.5 text-xs', msg.bad ? 'border-warning bg-warning-soft text-[#9A4F08]' : 'border-success bg-success-soft text-success')}>{msg.text}</p>}
      {f.costs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" aria-label={`Custos do tipo de negócio ${si + 1}`}>
            <thead className="bg-surface-2 text-left text-xs text-muted"><tr><th className="w-[180px] px-2 py-2 font-medium">Dedução</th><th className="px-2 py-2 font-medium">Descrição</th><th className="w-[120px] px-2 py-2 font-medium">Quando</th><th className="w-[90px] px-2 py-2 font-medium">Qtd.</th><th className="w-[140px] px-2 py-2 text-right font-medium">Valor unitário</th><th className="w-[120px] px-2 py-2 text-right font-medium">Total</th><th className="w-[36px]" /></tr></thead>
            <tbody>{f.costs.map((c, i) => {
              const tot = (costQty(c.qty) ?? 0) && parseMoney(c.value) != null ? sectionCostTotal({ qtyMilli: costQty(c.qty)!, unitCents: parseMoney(c.value)! }) : null;
              const toInv = monthly && c.frequency === 'unico';
              return (
                <tr key={c.key} className="border-t border-line align-top">
                  <td className="px-2 py-1.5">
                    <Select aria-label={`Dedução ${si + 1}.${i + 1}`} className={clsx('h-9 w-full text-xs font-semibold', c.category ? CAT_TONE[c.category] : 'border-warning text-[#C2610C]')} value={c.category} disabled={!editable} onChange={(e) => set(c.key, { category: e.target.value as CostCategory | '' })}>
                      <option value="">Qual dedução?</option>
                      {COST_CATEGORIES.map((k) => <option key={k} value={k}>{COST_CATEGORY_SHORT[k]}</option>)}
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input aria-label={`Descrição do custo ${si + 1}.${i + 1}`} list={listId} className="h-9 w-full" value={c.description} disabled={!editable} onChange={(e) => onName(c, e.target.value)} />
                    {(c.origin || c.costItemId || toInv) && <span className="mt-0.5 block text-2xs text-muted">{[c.origin === 'planilha' ? 'da planilha' : null, c.costItemId ? 'catálogo' : null, !c.category ? 'sem classificação' : null, toInv ? 'único: vai para o investimento' : null].filter(Boolean).join(' · ')}</span>}
                  </td>
                  <td className="px-2 py-1.5">{monthly
                    ? <Select aria-label={`Quando ${si + 1}.${i + 1}`} className="h-9 w-full" value={c.frequency} disabled={!editable} onChange={(e) => set(c.key, { frequency: e.target.value as CostFrequency })}><option value="unico">Único</option><option value="mensal">Mensal</option></Select>
                    : <span className="flex h-9 items-center text-sm text-muted">Único</span>}</td>
                  <td className="px-2 py-1.5"><span className="flex items-center gap-1"><Input aria-label={`Quantidade do custo ${si + 1}.${i + 1}`} inputMode="decimal" className="num h-9 w-full" value={c.qty} disabled={!editable} onChange={(e) => set(c.key, { qty: e.target.value })} />{c.measure && <span className="text-2xs text-muted">{c.measure}</span>}</span></td>
                  <td className="px-2 py-1.5"><Input aria-label={`Valor do custo ${si + 1}.${i + 1}`} inputMode="decimal" className="num h-9 w-full text-right" placeholder="0,00" value={c.value} disabled={!editable} onChange={(e) => set(c.key, { value: e.target.value })} /></td>
                  <td className="num px-2 py-1.5 text-right leading-9 text-ink">{tot == null ? '—' : fmtBRL(tot)}</td>
                  <td className="px-1 py-1.5">{editable && <button type="button" className="p-1.5 text-muted hover:text-danger" aria-label={`Remover custo ${si + 1}.${i + 1}`} onClick={() => setCosts(f.costs.filter((x) => x.key !== c.key))}><Trash2 className="h-4 w-4" /></button>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {editable && <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline" onClick={() => setCosts([...f.costs, blankCost(f.kind)])}><Plus className="h-4 w-4 border border-primary" aria-hidden />Adicionar custo</button>}
      <datalist id={listId}>{catalog.filter((c) => monthly || c.kind === 'investimento').map((c) => <option key={c.id} value={c.name}>{c.unitCents != null ? `${money(c.unitCents)} · ${c.kind === 'mensal' ? 'mensal' : 'único'}` : ''}</option>)}</datalist>
      <Modal open={pasting} onClose={() => setPasting(false)} title="Colar do Excel: custos" size="lg"
        footer={<><Button onClick={() => setPasting(false)}>Cancelar</Button><Button variant="primary" disabled={!pasteText.trim()} onClick={() => { addTable(pasteText.split(/\r?\n/).map((l) => l.split('\t')), 'Colado'); setPasting(false); setPasteText(''); }}>Incluir custos</Button></>}>
        <p className="mb-2 text-sm text-muted">Copie as linhas da planilha (com a linha de títulos) e cole aqui. Obrigatórias: Descrição, Quantidade e Valor unitário. Opcionais: Unidade, Valor total, Frequência (único ou mensal) e "Impacta o quê?".</p>
        <textarea aria-label="Custos colados" rows={10} className="field-input w-full font-mono text-xs" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'DESCRIÇÃO\tUNIDADE\tQUANTIDADE\tVALOR UNITÁRIO\tFREQUÊNCIA\tIMPACTA O QUÊ?\nCabo drop\tm\t300\t1,20\tÚnico\tMaterial'} data-autofocus />
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ aba Viabilidade econômica
export function SectionsEconomics({ oppId, footer }: { oppId: string; footer?: (r: EconResult | null, official: boolean) => ReactNode }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { econ, model } = useEconBase(oppId);
  const itemsQ = useQuery({ queryKey: ['opp-items', oppId], queryFn: () => api<ItemsData>(`/opportunities/${oppId}/items`) });
  const d = econ.data;
  const savedSecs = d?.input?.sections ?? null;
  const [adj, setAdj] = useState<Record<string, { margin: string; payback: string }>>({});
  const [view, setView] = useState<'contrato' | 'mes'>('contrato');
  useEffect(() => { setAdj({}); }, [d?.saved?.updatedAt]);
  const sections = useMemo<DealSection[]>(() => (savedSecs ?? []).map((s) => {
    const a = adj[s.id];
    if (!a) return s;
    const m = parseBp(a.margin);
    return { ...s, marginTargetBp: a.margin.trim() === '' ? null : Number.isNaN(m) ? s.marginTargetBp : m, paybackMonths: a.payback.trim() === '' ? null : Math.max(1, Math.min(240, Number(a.payback) || 1)) };
  }), [savedSecs, adj]);
  const changed = Object.keys(adj).length > 0;
  const deferred = useDeferredValue(sections);
  const live = useMemo(() => (d && !d.financeHidden && changed ? liveResult(d, model, deferred, d.items) : null), [d, model, deferred, changed]);
  const official = !changed && !!d?.result?.sections;
  const r = official ? d!.result : live ?? d?.result ?? null;
  const put = (secs: DealSection[]) => api(`/opportunities/${oppId}/economics`, { method: 'PUT', body: { ...d!.input, capex: [], opex: [], extraInitialCents: 0, b2g: null, sections: secs } });
  const save = useMutation({
    mutationFn: () => put(sections),
    onSuccess: () => { setAdj({}); void qc.invalidateQueries({ queryKey: ['economics', oppId] }); toast({ tone: 'success', message: 'Viabilidade econômica salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  // usar o preço: fixa o preço da seção e grava o valor nos produtos (proposta e contrato usam esse valor)
  const usePrice = useMutation({
    mutationFn: async ({ k, price }: { k: number; price: number | null }) => {
      const secs = sections.map((s, i) => (i === k ? { ...s, priceCents: price } : s));
      if (price != null && itemsQ.data) {
        const all = itemsQ.data.items;
        const mine = all.map((it, idx) => ({ it, idx })).filter((x) => (x.it.section ?? 0) === k);
        const vals = distributePrice(price, mine.map((x) => ({ qtyMilli: x.it.qtyMilli, totalCents: Math.round((x.it.qtyMilli * x.it.unitCents) / 1000) })));
        const items = all.map((it, idx) => { const m = mine.findIndex((x) => x.idx === idx); return { description: it.description, unit: it.unit, qtyMilli: it.qtyMilli, unitCents: m >= 0 ? vals[m]! : it.unitCents, discountCents: m >= 0 ? 0 : it.discountCents, surchargeCents: m >= 0 ? 0 : it.surchargeCents, notes: it.notes, bidUnitCents: it.bidUnitCents, fiscalDocTypeId: it.fiscalDocTypeId ?? null, dealKind: it.dealKind, deliveryAddressId: it.deliveryAddressId ?? null, costProfile: it.costProfile ?? null, section: it.section ?? 0 }; });
        const o = await api<Opportunity>(`/opportunities/${oppId}/items`, { method: 'PUT', body: { rowVersion: itemsQ.data.rowVersion, items } });
        qc.setQueryData(['opportunity', o.id], o);
      }
      await put(secs);
    },
    onSuccess: (_x, v) => { setAdj({}); void qc.invalidateQueries({ queryKey: ['economics', oppId] }); void qc.invalidateQueries({ queryKey: ['opp-items', oppId] }); toast({ tone: 'success', message: v.price != null ? 'Preço aplicado na seção e nos produtos' : 'A seção voltou para o preço ideal' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });

  if (econ.isError) return <ErrorState error={econ.error} onRetry={() => econ.refetch()} />;
  if (!d) return <LoadingRows rows={5} />;
  const head = <h2 className="flex items-center gap-2 text-md font-bold text-ink"><Calculator className="h-5 w-5 text-primary" aria-hidden />Viabilidade econômica</h2>;
  if (!d.settings) return <div className="space-y-3">{head}<Notice tone="warning">A empresa ainda não informou os parâmetros da viabilidade (margem mínima, TMA, contingências e payback). Quem administra preenche em Configurações → Viabilidade.</Notice></div>;
  if (!savedSecs?.length) return <div className="space-y-3">{head}<Notice tone="info">Monte os tipos de negócio na aba Produtos e serviços (produtos e custos de cada um) e salve. Aqui você ajusta margem e payback até o preço ideal.</Notice></div>;
  const st = d.settings;
  const outs = r?.sections ?? [];
  const ov = r?.sectionsOverview;
  const editable = d.editable;
  const teto = d.publicSector ? st.paybackMaxPublic : st.paybackMaxPrivate;
  const mSug = st.marginSuggestedBp ?? st.marginTargetBp;
  const itemNames = (k: number) => (itemsQ.data?.items ?? []).filter((x) => (x.section ?? 0) === k).map((x) => x.description);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>{head}<p className="max-w-2xl text-sm text-muted">Os custos vêm da aba Produtos e serviços. Aqui você só ajusta margem e payback até chegar no preço ideal.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {official ? <Chip tone="green">Salvo</Chip> : changed ? <Chip tone="yellow">Simulação — ainda não salva</Chip> : <Chip tone="yellow">Recalcule salvando</Chip>}
          {r && <Chip tone={VERDICT_TONE[r.verdict]}>{ECON_VERDICT_LABELS[r.verdict]}</Chip>}
        </div>
      </div>
      {official && d.stale && <Notice tone="warning">Produtos, tributos ou parâmetros mudaram depois que esta viabilidade foi salva. Confira e salve de novo: o pedido de aprovação exige o cálculo atualizado.</Notice>}
      {footer?.(r, official)}

      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((s, k) => {
          const o = outs[k];
          const monthly = isMonthlySection(s.kind);
          const a = adj[s.id] ?? { margin: bpText(s.marginTargetBp), payback: s.paybackMonths != null ? String(s.paybackMonths) : '' };
          const setA = (p: Partial<typeof a>) => setAdj({ ...adj, [s.id]: { ...a, ...p } });
          const mNow = parseBp(a.margin);
          const mOut = a.margin.trim() !== '' && mNow != null && !Number.isNaN(mNow) && (mNow < st.marginTargetBp || (st.marginMaxBp != null && mNow > st.marginMaxBp));
          const rev = o?.revenueCents ?? 0;
          const line = (label: string, v: number, muted = false) => <div className={clsx('flex justify-between py-1.5', muted && 'text-muted')}><span>{label}</span><span className="num">{v ? fmtBRL(v) : '—'}<span className="ml-2 inline-block w-[52px] text-right text-xs text-muted">{v && rev ? pct((v / rev) * 100) : ''}</span></span></div>;
          const cats = COST_CATEGORIES.filter((c) => !monthly || (o?.deductions[c] ?? 0) > 0 || c === 'parceiros' || c === 'despesas_operacionais');
          return (
            <section key={s.id} className="border border-line bg-surface" aria-label={`Viabilidade do tipo de negócio ${k + 1}`}>
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                <span className="grid h-6 w-6 place-items-center bg-ink text-xs font-bold text-white" aria-hidden>{k + 1}</span>
                <b className="text-ink">{SECTION_KIND_LABELS[s.kind]}</b>
                <span className="bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">{monthly ? `${s.termMonths} meses` : s.receiveMonth ? `recebe no mês ${s.receiveMonth}` : 'à vista'}</span>
                <span className="min-w-0 truncate text-xs text-muted">{itemNames(k).join(', ') || 'sem produtos'}</span>
                {o && <Chip tone={VERDICT_TONE[o.verdict]} className="ml-auto">{ECON_VERDICT_LABELS[o.verdict]}</Chip>}
              </div>
              <div className="grid grid-cols-1 gap-3 border-b border-line px-4 py-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`m-${s.id}`} className="mb-1 block text-xs font-semibold text-ink">Margem de contribuição (%)</label>
                  <Input id={`m-${s.id}`} inputMode="decimal" placeholder={bpText(mSug)} value={a.margin} disabled={!editable} invalid={mOut || Number.isNaN(parseBp(a.margin))} onChange={(e) => setA({ margin: e.target.value.replace(/[^\d,.]/g, '').slice(0, 6) })} />
                  <small className={clsx('mt-1 block text-2xs', mOut ? 'text-danger' : 'text-muted')}>Piso {bpText(st.marginTargetBp)}%{st.marginMaxBp != null ? ` · teto ${bpText(st.marginMaxBp)}%` : ''} · sugestão {bpText(mSug)}%{mOut ? ' · fora dos limites: o cálculo usa o limite' : ''}</small>
                </div>
                {monthly ? (
                  <div>
                    <label htmlFor={`p-${s.id}`} className="mb-1 block text-xs font-semibold text-ink">Payback máximo (meses)</label>
                    <Input id={`p-${s.id}`} inputMode="numeric" placeholder={String(teto)} value={a.payback} disabled={!editable} onChange={(e) => setA({ payback: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                    <small className="mt-1 block text-2xs text-muted">Teto do setor {d.publicSector ? 'público' : 'privado'}: {teto} meses. Em branco vale o teto.</small>
                  </div>
                ) : (
                  <div><span className="mb-1 block text-xs font-semibold text-ink">Pagamento</span><p className="text-sm text-text">{s.receiveMonth ? `Recebe no mês ${s.receiveMonth}` : 'À vista'}</p><small className="mt-1 block text-2xs text-muted">Venda não tem payback: recebe de uma vez.</small></div>
                )}
              </div>
              {o ? (
                <div className="px-4 py-3 text-sm">
                  <div className="flex justify-between border-b border-line pb-2 text-base font-bold text-ink"><span>{o.priceSource === 'informado' ? 'Preço praticado' : 'Preço ideal'}</span><span className="num">{o.priceCents != null ? `${fmtBRL(o.priceCents)}${monthly ? '/mês' : ''}` : '—'}</span></div>
                  {o.priceSource === 'informado' && o.idealCents != null && <p className="pt-1 text-xs text-muted">Preço ideal hoje: {fmtBRL(o.idealCents)}{monthly ? '/mês' : ''}</p>}
                  {line('(−) Impostos', o.taxCents)}
                  {cats.map((c) => <Fragment key={c}>{line(`(−) ${COST_CATEGORY_LABELS[c]}`, o.deductions[c], !o.deductions[c])}</Fragment>)}
                  <div className="mt-1 flex justify-between border-t border-ink pt-2 font-bold text-success"><span>(=) Margem de contribuição</span><span className="num">{fmtBRL(o.contributionCents)}{monthly ? '/mês' : ''}<span className="ml-2 inline-block w-[52px] text-right text-xs">{pct(o.contributionPct)}</span></span></div>
                  {monthly && o.investment.totalCents > 0 && (
                    <div className="mt-3 grid grid-cols-[2fr_1fr] border border-line bg-surface-2 text-xs">
                      <div className="px-3 py-2"><span className="block text-muted">Investimento da implantação (pago uma vez)</span><b className="num block text-sm text-ink">{fmtBRL(o.investment.totalCents)}</b><span className="text-muted">{COST_CATEGORIES.filter((c) => o.investment.byCategory[c]).map((c) => `${COST_CATEGORY_LABELS[c]} ${fmtBRL(o.investment.byCategory[c])}`).join(' · ')}</span></div>
                      <div className="border-l border-line px-3 py-2"><span className="block text-muted">Payback real</span><b className={clsx('block text-sm', o.paybackOk ? 'text-success' : 'text-danger')}>{monthsText(o.paybackMonths)}</b><span className="text-muted">{o.paybackOk ? `dentro do máximo de ${o.paybackMaxMonths}` : `acima do máximo de ${o.paybackMaxMonths}`}</span></div>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted">{monthly ? 'Só deduz o que é mensal. Matéria-prima e mão de obra da entrega são o investimento, que a margem mensal paga.' : 'Na venda, matéria-prima, mão de obra e despesas deduzem direto do preço.'}{o.unclassified ? ` ${o.unclassified} custo(s) sem dedução fora do cálculo: classifique na aba Produtos e serviços.` : ''}</p>
                  {editable && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      {o.idealCents != null && (o.priceSource !== 'informado' || o.idealCents !== o.priceCents) && <Button size="sm" variant="primary" loading={usePrice.isPending} disabled={changed} title={changed ? 'Salve os ajustes antes de aplicar o preço' : undefined} onClick={() => usePrice.mutate({ k, price: o.idealCents })}>Usar este preço</Button>}
                      {o.priceSource === 'informado' && <button type="button" className="text-xs font-semibold text-primary hover:underline" disabled={usePrice.isPending || changed} onClick={() => usePrice.mutate({ k, price: null })}>Voltar ao preço ideal</button>}
                    </div>
                  )}
                </div>
              ) : <div className="px-4 py-3"><Notice tone="warning">Confira os campos para ver o resultado.</Notice></div>}
            </section>
          );
        })}
      </div>

      {ov && <Overview ov={ov} outs={outs} r={r!} view={view} setView={setView} />}
      {editable && <div className="flex justify-end"><Button variant="primary" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>Salvar viabilidade</Button></div>}
      {!!r?.warnings.length && <details className="text-xs text-muted"><summary className="cursor-pointer font-semibold">Avisos do cálculo ({r.warnings.length})</summary><ul className="mt-1 list-disc pl-5">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul></details>}
    </div>
  );
}

function Overview({ ov, outs, r, view, setView }: { ov: NonNullable<EconResult['sectionsOverview']>; outs: SectionOutcome[]; r: EconResult; view: 'contrato' | 'mes'; setView: (v: 'contrato' | 'mes') => void }) {
  const t = ov.total;
  const div = view === 'mes' ? Math.max(1, ov.months) : 1;
  const v = (x: number) => fmtBRL(Math.round(x / div));
  const deductions = t.tax + COST_CATEGORIES.reduce((a, c) => a + t.costs[c], 0);
  const multi = outs.length > 1;
  const labels = ov.cumulative.revenue.map((_, k) => (k === 0 ? 'Início' : `M${k}`));
  const rows: { label: string; get: (d: typeof t) => number; cls?: string }[] = [
    { label: 'Receita bruta', get: (d) => d.revenue, cls: 'font-semibold text-ink' },
    { label: '(−) Impostos', get: (d) => d.tax },
    { label: '(=) Receita líquida', get: (d) => d.revenue - d.tax, cls: 'bg-surface-2 font-semibold text-ink' },
    ...COST_CATEGORIES.map((c) => ({ label: `(−) ${COST_CATEGORY_LABELS[c]}`, get: (d: typeof t) => d.costs[c] })),
    { label: '(=) Margem de contribuição', get: (d) => d.contribution, cls: 'bg-surface-2 font-semibold text-ink' },
    { label: '(−) Investimento da implantação', get: (d) => d.investment },
    { label: '(=) Resultado do contrato', get: (d) => d.result, cls: 'border-t border-ink font-bold text-success' },
  ];
  return (
    <section className="border border-line bg-surface" aria-label="Visão geral do negócio">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <b className="text-ink">Visão geral do negócio</b>
        <span className="text-xs text-muted">{multi ? `consolidado de ${outs.map((o) => SECTION_KIND_LABELS[o.kind]).join(' + ')}` : SECTION_KIND_LABELS[outs[0]!.kind]} · {ov.months > 1 ? `contrato de ${ov.months} meses` : 'pagamento único'}</span>
        <span className="flex-1" />
        <div className="flex border border-line-strong text-xs" role="group" aria-label="Ver a DRE por">
          {(['contrato', 'mes'] as const).map((k) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={clsx('px-2.5 py-1', view === k ? 'bg-primary font-semibold text-white' : 'text-ink hover:bg-surface-2')}>{k === 'contrato' ? 'Contrato inteiro' : 'Por mês'}</button>)}
        </div>
      </div>
      <div className="grid grid-cols-2 border-b border-line sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label={view === 'mes' ? 'Receita por mês' : 'Receita do contrato'} value={v(t.revenue)} />
        <Kpi label="Deduções" value={v(deductions)} />
        <Kpi label="Margem de contribuição" value={`${v(t.contribution)} · ${pct(t.revenue ? (t.contribution / t.revenue) * 100 : null)}`} />
        <Kpi label="Investimento" value={fmtBRL(t.investment)} />
        <Kpi label="Resultado do contrato" value={`${v(t.result)} · ${pct(t.revenue ? (t.result / t.revenue) * 100 : null)}`} />
        <Kpi label="Payback (caixa)" value={t.investment ? (ov.paybackMonth != null ? `${ov.paybackMonth} ${ov.paybackMonth === 1 ? 'mês' : 'meses'}` : 'não se paga') : '—'} />
      </div>
      {labels.length > 2 && (
        <div className="border-b border-line px-4 pb-1 pt-3">
          <LineChart categories={labels} tooltipTitle={(i) => labels[i]!} height={220} width={1280} ariaLabel="Receita, deduções e resultado acumulados no contrato" format={(x) => fmtBRL(Math.round(x))} axisFormat={(x) => `${Math.round(x / 100_000).toLocaleString('pt-BR')} mil`}
            series={[{ key: 'r', label: 'Receita acumulada', color: '#2F5986', values: ov.cumulative.revenue }, { key: 'd', label: 'Deduções acumuladas', color: '#C2610C', values: ov.cumulative.deductions }, { key: 'res', label: 'Resultado acumulado (começa no investimento)', color: '#1E6B3A', values: ov.cumulative.result, weight: 2.4 }]} />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm" aria-label="DRE da negociação">
          <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-4 py-2 text-left font-medium">DRE da negociação{view === 'mes' ? ' (média por mês)' : ''}</th>{multi && outs.map((o, k) => <th key={o.id} className="px-4 py-2 text-right font-medium">{SECTION_KIND_LABELS[o.kind]} {k + 1}{o.monthly ? ` · ${o.months} meses` : ''}</th>)}<th className="px-4 py-2 text-right font-medium">Total</th><th className="px-4 py-2 text-right font-medium">% da receita</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.label} className={clsx('border-t border-line', row.cls)}>
              <td className="px-4 py-2">{row.label}</td>
              {multi && ov.bySection.map((b, k) => <td key={k} className="num px-4 py-2 text-right">{row.get(b) ? v(row.get(b)) : '—'}</td>)}
              <td className="num px-4 py-2 text-right font-semibold">{row.get(t) ? v(row.get(t)) : "—"}</td>
              <td className="num px-4 py-2 text-right text-muted">{pct(t.revenue ? (row.get(t) / t.revenue) * 100 : null)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="px-4 py-2.5 text-xs text-muted">{ov.netMarginPct != null ? `Margem líquida do contrato (regra de aprovação, depois de despesas fixas, perdas e IR/CSLL): ${pct(ov.netMarginPct)}. ` : ''}Situação: {ECON_VERDICT_LABELS[r.verdict]}.</p>
    </section>
  );
}

/** Painel lateral: o resultado salvo por seção, em poucas linhas. */
export function SectionsSummary({ r }: { r: EconResult }) {
  const ov = r.sectionsOverview;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between"><span className="text-muted">Situação</span><Chip tone={VERDICT_TONE[r.verdict]}>{ECON_VERDICT_LABELS[r.verdict]}</Chip></div>
      <ul className="divide-y divide-line border border-line">{(r.sections ?? []).map((o, k) => (
        <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span><b className="text-ink">{SECTION_KIND_LABELS[o.kind]} {k + 1}</b><span className="block text-2xs text-muted">{o.priceSource === 'informado' ? 'preço praticado' : 'preço ideal'} · margem {pct(o.contributionPct)}{o.monthly && o.investment.totalCents ? ` · payback ${monthsText(o.paybackMonths)}` : ''}</span></span>
          <span className="num font-semibold text-ink">{o.priceCents != null ? fmtBRL(o.priceCents) : '—'}{o.monthly ? '/mês' : ''}</span>
        </li>
      ))}</ul>
      {ov && <p className="text-xs text-muted">Contrato: receita {fmtBRL(ov.total.revenue)} · resultado <b className="text-ink">{fmtBRL(ov.total.result)}</b> ({pct(ov.total.revenue ? (ov.total.result / ov.total.revenue) * 100 : null)}){ov.netMarginPct != null ? ` · margem líquida ${pct(ov.netMarginPct)}` : ''}</p>}
    </div>
  );
}
