import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, FileSpreadsheet, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { FISCAL_KINDS, FISCAL_KIND_LABELS, type FiscalKind } from '@isp/shared';
import {
  globalInputFromSections, buildModel, costLineTotal, costQty, defaultCostProfile, emptyEconInput, financeEngine, isMonthlyKind, itemTotal,
  ITEM_UNITS, ITEM_UNIT_LABELS, lotOfKind, parseCostTable, parseItemsTable, parseMoney, parseQty,
  type BidMode, type CostImpact, type DealKind, type EconInput, type EconItem, type EconResult, type EconSettings,
  type FinOverride, type FiscalArgs, type FiscalTax, type ItemInput, type ItemUnit,
} from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { useLookups } from '../../lib/hooks';
import { fmtBRL } from '../../lib/format';
import type { Opportunity } from '../../lib/types';
import { Button, ErrorState, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { addressLine, NewDeliveryAddressModal, type DeliveryAddress } from './DeliveryAddresses';
import { errMsg } from '../contracts/shared';
import { BUSINESS_KINDS, BUSINESS_LABELS, costDrafts, costsInput, moneyText, quantityText, rowKey, type CostDraft, type Frequency } from './productNegotiation';

type SavedItem = ItemInput & { section?: number; id: string; priceDefined?: boolean; fiscalDocTypeId?: string | null; dealKind?: DealKind; deliveryAddressId?: string | null };
type ItemRow = { section?: number; key: string; description: string; unit: ItemUnit; quantity: string; value: string; discount: string; surcharge: string; notes: string; bid: string; doc: string; kind: DealKind; address: string };
type ItemsData = { items: SavedItem[]; editable: boolean; rowVersion: number; bid: boolean; bidMode: BidMode | null; bidGlobalCents: number | null; deliveryAddresses?: DeliveryAddress[]; principalAddress?: string | null };
type Doc = { version?: number | null; baseTaxes?: FiscalTax[]; taxesByYear?: Record<string, FiscalTax[]>; id: string; branchId: string; fiscalKind: FiscalKind; code: string; name: string; rates: { percentBp: number; fixedCents: number; complete: boolean } };
type Product = { id: string; description: string; unit: ItemUnit; lastUnitCents: number; lastPriceDefined?: boolean; fiscalDocTypeId: string | null; dealKind: DealKind };
type CostCatalog = { id: string; name: string; kind: 'investimento' | 'mensal'; unit: string; unitCents: number | null; impact?: CostImpact | null };
type EconData = { saved?: { updatedAt: string } | null; settings: EconSettings | null; input: EconInput | null; editable: boolean; publicSector: boolean; financeHidden: boolean; modelOverrides?: FinOverride[]; fiscal?: FiscalArgs };
type SaveDraft = { form: Form; rowVersion: number; canSaveCosts: boolean; economicsUpdatedAt: string | null; bid: boolean };
type Form = { extra: string; kinds: DealKind[]; items: ItemRow[]; costs: CostDraft[]; input: EconInput; bidMode: BidMode; bidGlobal: string };
const categoryOptions = [['materia_prima', 'Matéria-prima'], ['mao_de_obra', 'Mão de obra'], ['parceiros', 'Parceiros'], ['despesas_operacionais', 'Desp. operacional']] as const;
const toRow = (i: SavedItem): ItemRow => ({ section: i.section ?? 0, key: rowKey(), description: i.description, unit: i.unit, quantity: quantityText(i.qtyMilli), value: i.priceDefined === false ? '' : moneyText(i.unitCents), discount: moneyText(i.discountCents), surcharge: moneyText(i.surchargeCents), notes: i.notes ?? '', bid: moneyText(i.bidUnitCents), doc: i.fiscalDocTypeId ?? '', kind: i.dealKind ?? 'recorrencia', address: i.deliveryAddressId ?? '' });
const blankItem = (kind: DealKind, doc: string): ItemRow => ({ key: rowKey(), kind, doc, description: '', unit: 'un', quantity: '1', value: '', discount: '', surcharge: '', notes: '', bid: '', address: '' });
const itemInput = (r: ItemRow) => ({ section: r.section ?? 0, description: r.description.trim(), unit: r.unit, qtyMilli: parseQty(r.quantity) ?? 0, unitCents: parseMoney(r.value) ?? -1, priceDefined: r.value.trim() !== '', discountCents: parseMoney(r.discount) ?? -1, surchargeCents: parseMoney(r.surcharge) ?? -1, notes: r.notes.trim() || null, bidUnitCents: r.bid.trim() ? parseMoney(r.bid) : null, fiscalDocTypeId: r.doc || null, dealKind: r.kind, costProfile: defaultCostProfile(r.kind), deliveryAddressId: r.address || null });
const percent = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const formKey = (f: Form) => JSON.stringify({ ...f, items: f.items.map(({ key: _k, ...r }) => r), costs: f.costs.map(({ key: _k, ...r }) => r) });

async function readTable(file: File) {
    if (/\.xlsx?$/i.test(file.name)) { const { default: readXlsx } = await import('read-excel-file'); return await readXlsx(file) as (string | number | null)[][]; }
    const text = await file.text(), first = text.split('\n')[0] ?? '';
    const sep = text.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
    return text.split(/\r?\n/).map((l) => l.split(sep).map((v) => v.replace(/^"|"$/g, '')));
  }

export function DealProducts({ opp }: { opp: Opportunity }) {
  const toast = useToast(), qc = useQueryClient();
  const itemsQ = useQuery({ queryKey: ['opp-items', opp.id], queryFn: () => api<ItemsData>('/opportunities/' + opp.id + '/items') });
  const econQ = useQuery({ queryKey: ['economics', opp.id], queryFn: () => api<EconData>('/opportunities/' + opp.id + '/economics') });
  const docsQ = useQuery({ queryKey: ['fiscal-docs'], queryFn: () => api<{ items: Doc[] }>('/fiscal-docs'), staleTime: 60000 });
  const productQ = useQuery({ queryKey: ['product-catalog'], queryFn: () => api<{ items: Product[] }>('/product-catalog'), staleTime: 60000 });
  const finance = !!econQ.data && !econQ.data.financeHidden;
  const catalogQ = useQuery({ queryKey: ['cost-items'], queryFn: () => api<{ items: CostCatalog[] }>('/cost-items'), enabled: finance, staleTime: 60000 });
  const plans = useLookups().data?.plans ?? [];
  const docs = useMemo(() => (docsQ.data?.items ?? []).filter((d) => !opp.branchId || d.branchId === opp.branchId), [docsQ.data, opp.branchId]);
  const products = productQ.data?.items ?? [];
  const [form, setForm] = useState<Form | null>(null), [base, setBase] = useState('');
  const [values, setValues] = useState<Partial<Record<DealKind, boolean>>>({});
  const [paste, setPaste] = useState<{ kind: DealKind; text: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null), [addressFor, setAddressFor] = useState<string | null>(null);
  const [removeKind, setRemoveKind] = useState<DealKind | null>(null);
  useEffect(() => {
    if (form || !itemsQ.data || !econQ.data) return;
    const original = econQ.data.input ?? emptyEconInput();
    const input = globalInputFromSections(original, itemsQ.data.items.map((i) => ({ kind: i.dealKind, section: i.section, priceDefined: i.priceDefined }))) ?? original;
    const kinds = BUSINESS_KINDS.filter((k) => itemsQ.data!.items.some((i) => (i.dealKind ?? 'recorrencia') === k) || [...input.capex, ...input.opex].some((c) => c.kind === k));
    const initial: Form = { extra: moneyText(input.extraInitialCents), kinds, items: itemsQ.data.items.map(toRow), costs: costDrafts(input, kinds), input, bidMode: itemsQ.data.bidMode ?? 'item', bidGlobal: moneyText(itemsQ.data.bidGlobalCents) };
    setForm(initial); setBase(formKey(initial));
  }, [itemsQ.data, econQ.data, form]);
  const [saving, setSaving] = useState(false);
  const editable = !!itemsQ.data?.editable && !saving;
  const costsEditable = editable && !!econQ.data?.editable && !!econQ.data.settings;
  const dirty = !!form && formKey(form) !== base;
  const parsed = useMemo(() => form?.items.filter((r) => r.description.trim()).map(itemInput) ?? [], [form?.items]);
  const input = useMemo(() => form ? costsInput({ ...form.input, mode: form.kinds.length ? (form.kinds.some(isMonthlyKind) ? 'recorrente' : 'pontual') : form.input.mode, extraInitialCents: parseMoney(form.extra) ?? -1 }, form.costs) : emptyEconInput(), [form]);
  const [calculation, setCalculation] = useState<{ input: EconInput; items: EconItem[] } | null>(null);
  useEffect(() => {
    if (!finance || !form) return;
    const handle = setTimeout(() => setCalculation({ input, items: parsed.map((i) => {
      const d = docsQ.data?.items.find((x) => x.id === i.fiscalDocTypeId);
      return { description: i.description, kind: i.dealKind, priceDefined: i.priceDefined, revenueCents: itemTotal(i), doc: d ? { id: d.id, version: d.version ?? undefined, raw: d.baseTaxes ? { taxes: d.baseTaxes, taxesByYear: d.taxesByYear } : undefined, name: d.code + ' · ' + d.name, percentBp: d.rates.percentBp, fixedCents: d.rates.fixedCents, complete: d.rates.complete, fiscalKind: d.fiscalKind } : null };
    }) }), 500);
    return () => clearTimeout(handle);
  }, [finance, form, input, parsed, docsQ.data]);
  const preview = useMemo<EconResult | null>(() => {
    if (!calculation || !econQ.data?.settings || calculation.items.some((i) => i.revenueCents < 0)) return null;
    try { return financeEngine({ ...calculation, settings: econQ.data.settings, publicSector: econQ.data.publicSector, fiscal: econQ.data.fiscal, model: buildModel(econQ.data.modelOverrides ?? []) }); } catch { return null; }
  }, [calculation, econQ.data]);
  const groupedCosts = useMemo(() => new Map<DealKind | null, CostDraft[]>([...BUSINESS_KINDS, null].map((kind): [DealKind | null, CostDraft[]] => [kind, form?.costs.filter((c) => (c.kind ?? null) === kind) ?? []])), [form?.costs]);
  const updateCosts = useCallback((kind: DealKind | null, fn: (cs: CostDraft[]) => CostDraft[]) => setForm((f) => f ? { ...f, costs: [...f.costs.filter((c) => (c.kind ?? null) !== kind), ...fn(f.costs.filter((c) => (c.kind ?? null) === kind))] } : f), []);
  const save = useMutation({
    onMutate: () => setSaving(true),
    onSettled: () => setSaving(false),
    mutationFn: (draft: SaveDraft) => {
      const form = draft.form;
      const parsed = form.items.filter((r) => r.description.trim()).map(itemInput);
      const input = costsInput({ ...form.input, mode: form.kinds.length ? (form.kinds.some(isMonthlyKind) ? 'recorrente' : 'pontual') : form.input.mode, extraInitialCents: parseMoney(form.extra) ?? -1 }, form.costs);
      if (form.items.some((r) => !r.description.trim()) || parsed.some((i) => i.description.length < 2 || i.qtyMilli <= 0 || i.unitCents < 0 || i.discountCents < 0 || i.surchargeCents < 0)) throw Error('Confira descrição, quantidade e valores dos produtos.');
      if (parsed.some((i) => i.priceDefined) && parsed.some((i) => !i.priceDefined)) throw Error('Informe o valor de todos os produtos ou deixe todos em branco para usar o sugerido.');
      if (input.capex.concat(input.opex).some((c) => c.description.length < 2 || c.qtyMilli <= 0 || c.unitCents < 0)) throw Error('Confira descrição, quantidade e valor dos custos.');
      return api<Opportunity>('/opportunities/' + opp.id + '/items', { method: 'PUT', body: { rowVersion: draft.rowVersion, items: parsed, ...(draft.bid ? { bidMode: form.bidMode, bidGlobalCents: form.bidMode === 'global' ? parseMoney(form.bidGlobal) : null } : {}), ...(draft.canSaveCosts ? { economics: input, economicsUpdatedAt: draft.economicsUpdatedAt } : {}) } });
    },
    onSuccess: async (o, draft) => {
      qc.setQueryData(['opportunity', o.id], o); setBase(formKey(draft.form));
      await Promise.all([['opp-items', opp.id], ['economics', opp.id], ['product-catalog'], ['cost-items'], ['timeline', opp.id]].map((queryKey) => qc.invalidateQueries({ queryKey }))).then(() => setForm(null));
      toast({ tone: 'success', message: econQ.data?.settings && finance ? 'Produtos e custos salvos' : 'Produtos e serviços salvos' });
    },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError && e.status === 409 ? 'A oportunidade mudou. Recarregue os dados antes de salvar.' : errMsg(e) }),
  });
  if (itemsQ.isError || econQ.isError) return <ErrorState error={itemsQ.error ?? econQ.error} onRetry={() => { void itemsQ.refetch(); void econQ.refetch(); }} />;
  if (!form || !itemsQ.data || !econQ.data) return <LoadingRows rows={5} />;
  const patch = (p: Partial<Form>) => setForm({ ...form, ...p });
  const updateItem = (key: string, p: Partial<ItemRow>) => setForm((f) => f ? { ...f, items: f.items.map((r) => r.key === key ? { ...r, ...p } : r) } : f);
  const suggestDoc = (k: DealKind) => [...docs].sort((a, b) => a.code.localeCompare(b.code)).find((d) => d.fiscalKind === (k === 'venda' ? 'venda' : k === 'locacao' ? 'locacao' : 'servico'))?.id ?? '';
  const changeKind = (old: DealKind, kind: DealKind) => {
    if (!isMonthlyKind(kind) && form.costs.some((c) => c.kind === old && c.frequency === 'mensal')) {
      toast({ tone: 'error', message: 'Altere os custos mensais para Único na coluna Quando antes de mudar para pagamento único.' }); return;
    }
    patch({ kinds: form.kinds.map((k) => k === old ? kind : k), items: form.items.map((r) => r.kind === old ? { ...r, kind, doc: r.doc === suggestDoc(old) ? suggestDoc(kind) : r.doc } : r), costs: form.costs.map((c) => c.kind === old ? { ...c, kind } : c) });
  };
  const importProducts = (kind: DealKind, table: (string | number | null)[][]) => {
    const result = parseItemsTable(table);
    if (result.missing.length) { setMessage('Produtos: faltam as colunas ' + result.missing.join(', ') + '.'); return; }
    patch({ items: [...form.items, ...result.items.map((i) => ({ ...toRow(i as SavedItem), kind, doc: suggestDoc(kind) }))] });
    setMessage(result.items.length + ' produto(s) incluído(s).' + (result.errors.length ? ' Linhas ignoradas: ' + result.errors.map((e) => e.row + ': ' + e.message).join('; ') : '') + ' Confira e salve.');
  };
  const saveButton = <Button variant="primary" disabled={!dirty || (finance && costsEditable && !econQ.data.settings)} loading={save.isPending} onClick={() => save.mutate({ form, rowVersion: itemsQ.data!.rowVersion, canSaveCosts: finance && !!econQ.data?.settings && !!econQ.data.editable && !!itemsQ.data?.editable, economicsUpdatedAt: econQ.data?.saved?.updatedAt ?? null, bid: itemsQ.data!.bid })}>Salvar produtos e custos</Button>;
  return <section aria-label="Produtos e serviços" className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-md font-bold text-ink">Produtos e serviços</h2><p className="max-w-2xl text-sm text-muted">Separe a negociação por tipo de negócio. Em cada um, os produtos e os custos usados na viabilidade econômica.</p></div>{editable && saveButton}</div>
    {message && <Notice tone="info">{message}</Notice>}
    {finance && !econQ.data.settings && <Notice tone="warning">Os produtos podem ser salvos. Configure os parâmetros em Configurações → Viabilidade para editar custos e calcular a viabilidade.</Notice>}
    {form.kinds.map((kind, index) => {
      const monthly = isMonthlyKind(kind), rows = form.items.filter((r) => r.kind === kind), showValues = values[kind] ?? itemsQ.data!.bid;
      const result = preview?.deal?.cells.find((c) => c.lot === lotOfKind(kind))?.result ?? (!preview?.deal ? preview : null);
      const total = rows.reduce((sum, r) => { const i = itemInput(r); return sum + (i.unitCents >= 0 ? itemTotal(i) : 0); }, 0);
      return <section key={kind} className="border border-line bg-surface" aria-label={'Negociação ' + BUSINESS_LABELS[kind]}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3"><span className="grid h-6 w-6 place-items-center bg-ink text-xs font-bold text-white">{index + 1}</span><b className="text-sm text-ink">Tipo de negócio</b><div role="radiogroup" aria-label={'Tipo de negócio ' + (index + 1)} className="flex flex-wrap border border-line-strong">{BUSINESS_KINDS.map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} disabled={!editable || (kind !== k && form.kinds.includes(k))} onClick={() => changeKind(kind, k)} className={clsx('border-r border-line-strong px-3 py-1.5 text-sm last:border-r-0 disabled:opacity-50', kind === k ? 'bg-primary font-semibold text-white' : 'text-ink hover:bg-surface-2')}>{BUSINESS_LABELS[k]}</button>)}</div>
          {monthly ? <label className="flex items-center gap-1.5 text-xs text-muted">Vigência <Input aria-label={'Vigência em meses ' + (index + 1)} className="num h-9 w-20" inputMode="numeric" value={form.input.termMonths} disabled={!costsEditable} onChange={(e) => patch({ input: { ...form.input, termMonths: Number(e.target.value) || 0 } })} /> meses<span className="sr-only">Compartilhada entre os itens mensais do contrato.</span></label> : <label className="flex items-center gap-1.5 text-xs text-muted">Recebe no mês <Input aria-label={'Mês de recebimento ' + (index + 1)} className="num h-9 w-16" inputMode="numeric" value={form.input.receiveMonth} disabled={!costsEditable} onChange={(e) => patch({ input: { ...form.input, receiveMonth: Number(e.target.value) || 0 } })} /><span>(0 = à vista)</span></label>}
          <button type="button" disabled={!editable} className="ml-auto text-xs text-muted hover:text-danger" onClick={() => setRemoveKind(kind)}>Remover seção</button>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm" aria-label={'Produtos de ' + BUSINESS_LABELS[kind]}><thead className="bg-surface-2 text-left text-xs text-muted"><tr>{['Item', 'Produto ou serviço', 'Documento fiscal', 'Medida', 'Qtd.', 'Observação', ''].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead><tbody>{rows.map((r, n) => <tr key={r.key} className="border-t border-line">
          <td className="num w-10 px-2 py-2">{n + 1}</td><td className="w-full px-2 py-2"><Input aria-label={'Produto ou serviço ' + (index + 1) + '.' + (n + 1)} list="deal-products" className="h-9 min-w-48" value={r.description} disabled={!editable} onChange={(e) => {
            const v = e.target.value, c = products.find((p) => p.description.trim().toLowerCase() === v.trim().toLowerCase());
            const planCode = plans.find((p) => p.name.toLowerCase() === v.trim().toLowerCase())?.fiscalDocCode;
            updateItem(r.key, { description: v, ...(!r.doc ? { doc: (c?.fiscalDocTypeId && docs.some((d) => d.id === c.fiscalDocTypeId) ? c.fiscalDocTypeId : docs.find((d) => d.code === planCode)?.id) ?? suggestDoc(kind) } : {}), ...(c ? { unit: c.unit, ...(!r.value.trim() ? { value: c.lastPriceDefined === false ? '' : moneyText(c.lastUnitCents) } : {}) } : {}) });
          }} /></td>
          <td className="px-2 py-2"><Select aria-label={'Documento fiscal ' + r.key} value={r.doc} disabled={!editable} className="h-9 w-44" onChange={(e) => updateItem(r.key, { doc: e.target.value })}><option value="">{docs.length ? 'Escolha' : 'Nenhum na filial'}</option>{FISCAL_KINDS.map((k) => <optgroup key={k} label={FISCAL_KIND_LABELS[k]}>{docs.filter((d) => d.fiscalKind === k).map((d) => <option key={d.id} value={d.id}>{d.code + ' · ' + d.name}</option>)}</optgroup>)}{r.doc && !docs.some((d) => d.id === r.doc) && <option value={r.doc}>Documento de outra filial</option>}</Select></td>
          <td className="px-2 py-2"><Select aria-label={'Medida ' + r.key} className="h-9 w-24" value={r.unit} disabled={!editable} onChange={(e) => updateItem(r.key, { unit: e.target.value as ItemUnit })}>{ITEM_UNITS.map((u) => <option key={u} value={u}>{ITEM_UNIT_LABELS[u]}</option>)}</Select></td><td className="px-2 py-2"><Input aria-label={'Quantidade ' + r.key} className="num h-9 w-20" value={r.quantity} disabled={!editable} onChange={(e) => updateItem(r.key, { quantity: e.target.value })} /></td><td className="px-2 py-2"><Input aria-label={'Observação ' + r.key} className="h-9 w-40" value={r.notes} disabled={!editable} onChange={(e) => updateItem(r.key, { notes: e.target.value })} /></td><td className="px-2 py-2"><button type="button" aria-label={'Remover produto ' + r.description} disabled={!editable} onClick={() => patch({ items: form.items.filter((i) => i.key !== r.key) })}><Trash2 className="h-4 w-4 text-muted hover:text-danger" /></button></td>
        </tr>)}</tbody></table></div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">{editable && <><button type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline" onClick={() => patch({ items: [...form.items, blankItem(kind, suggestDoc(kind))] })}><Plus className="h-4 w-4" />Adicionar produto ou serviço</button><button type="button" className="text-xs text-primary" onClick={() => setPaste({ kind, text: '' })}>Colar produtos do Excel</button><label className="cursor-pointer text-xs text-primary">Importar produtos<input type="file" accept=".xlsx,.xls,.csv,.txt" className="sr-only" aria-label={'Importar produtos de ' + BUSINESS_LABELS[kind]} onChange={(e) => { const file = e.target.files?.[0]; if (file) void readTable(file).then((t) => importProducts(kind, t)).catch(() => setMessage('Não foi possível ler a planilha de produtos.')); e.target.value = ''; }} /></label></>}<span className="flex-1" /><span className="text-xs text-muted">Valor na proposta: <b className="num text-ink">{rows.some((r) => r.value.trim()) ? fmtBRL(total) + (monthly ? '/mês' : '') : 'não informado'}</b></span><button type="button" className="text-xs font-semibold text-primary" onClick={() => setValues({ ...values, [kind]: !showValues })}>{showValues ? 'Ocultar valores' : 'Editar valores'}</button></div>
        {showValues && <div className="overflow-x-auto border-t border-line px-4 py-3"><table className="w-full min-w-[800px] text-sm" aria-label={'Valores de ' + BUSINESS_LABELS[kind]}><thead className="text-left text-xs text-muted"><tr>{['Produto', 'Tipo de negócio', 'Valor unitário', 'Desconto', 'Acréscimo', ...(itemsQ.data.bid && form.bidMode === 'item' ? ['Lance unitário'] : []), 'Endereço de entrega'].map((h) => <th key={h} className="px-2 py-1">{h}</th>)}</tr></thead><tbody>{rows.map((r) => <tr key={r.key}><td className="px-2 py-1">{r.description}</td><td className="px-2 py-1"><Select aria-label={'Tipo de negócio de ' + r.description} className="h-9 w-36" value={r.kind} disabled={!editable} onChange={(e) => { const next = e.target.value as DealKind; patch({ kinds: form.kinds.includes(next) ? form.kinds : [...form.kinds, next], items: form.items.map((i) => i.key === r.key ? { ...i, kind: next } : i) }); }}>{BUSINESS_KINDS.map((k) => <option key={k} value={k}>{BUSINESS_LABELS[k]}</option>)}</Select></td>{(['value', 'discount', 'surcharge', ...(itemsQ.data!.bid && form.bidMode === 'item' ? ['bid'] : [])] as ('value' | 'discount' | 'surcharge' | 'bid')[]).map((key) => <td key={key} className="px-2 py-1"><Input aria-label={({ value: 'Valor ', discount: 'Desconto ', surcharge: 'Acréscimo ', bid: 'Lance ' })[key] + r.description} className="num h-9 w-28" inputMode="decimal" placeholder={key === 'value' ? 'Sem valor' : '0,00'} value={r[key]} disabled={!editable} onChange={(e) => updateItem(r.key, { [key]: e.target.value })} /></td>)}<td className="px-2 py-1"><Select aria-label={'Endereço de entrega ' + r.description} className="h-9 w-56" value={r.address} disabled={!editable} onChange={(e) => e.target.value === '__novo__' ? setAddressFor(r.key) : updateItem(r.key, { address: e.target.value })}><option value="">Principal{itemsQ.data!.principalAddress ? ' · ' + itemsQ.data!.principalAddress : ''}</option>{itemsQ.data!.deliveryAddresses?.map((a) => <option key={a.id} value={a.id}>{addressLine(a)}</option>)}<option value="__novo__">+ Novo endereço de entrega…</option></Select></td></tr>)}</tbody></table></div>}
        {finance && rows.length === 0 && form.costs.some((c) => c.kind === kind) && <p className="px-4 py-2 text-xs text-[#C2610C]">Custos preservados sem produtos deste tipo. Adicione um produto ou revise estes custos antes de salvar a análise.</p>}
        {finance && <NegotiationCosts kind={kind} title={'Custos desta negociação'} costs={groupedCosts.get(kind)!} editable={costsEditable} catalog={catalogQ.data?.items ?? []} update={updateCosts} readTable={readTable} />}
        {finance && result && <div className="flex flex-wrap border-t border-line bg-surface-2 text-xs">{monthly && form.kinds.filter(isMonthlyKind).length > 1 && <span className="w-full border-b border-line px-4 py-2 text-muted">Cesta Implantação compartilhada por Recorrência e Aluguel. Os indicadores abaixo são da cesta.</span>}<Fact label="Preço sugerido da cesta" value={result.suggestedCents == null ? '—' : fmtBRL(result.suggestedCents) + (monthly ? '/mês' : '')} /><Fact label="Margem líquida no sugerido" value={percent(result.statement?.total.net != null && result.statement.total.revenue > 0 ? result.statement.total.net / result.statement.total.revenue * 100 : null)} />{monthly && <Fact label="Payback real" value={result.kpi?.paybackMonths == null ? 'Não se paga' : result.kpi.paybackMonths.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' meses'} />}<Fact label="Investimento da cesta" value={fmtBRL(result.investmentCents ?? result.initialCents)} /><span className="ml-auto self-center px-4 py-2 text-muted">Ajuste margem e payback na aba Viabilidade econômica{kind === 'locacao' || kind === 'recorrencia' ? ' · perfil Implantação' : ''}{dirty ? ' · prévia ainda não salva' : ''}</span></div>}
      </section>;
    })}
    {finance && form.costs.some((c) => !c.kind) && <section className="border border-warning p-3" aria-label="Custos anteriores sem tipo definido"><p className="mb-2 text-sm text-muted">Custos anteriores sem tipo definido foram preservados. Escolha a negociação de cada linha para vinculá-los à cesta correta.</p><NegotiationCosts kind={null} title="Custos anteriores sem tipo definido" costs={groupedCosts.get(null)!} editable={costsEditable} catalog={catalogQ.data?.items ?? []} update={updateCosts} readTable={readTable} assign={(key, kind) => patch({ kinds: form.kinds.includes(kind) ? form.kinds : [...form.kinds, kind], costs: form.costs.map((c) => c.key === key ? { ...c, kind } : c) })} /></section>}
    {editable && form.kinds.length < BUSINESS_KINDS.length && <button type="button" className="flex w-full items-center justify-center gap-2 border border-dashed border-line-strong py-3.5 font-semibold text-primary hover:bg-primary-soft" onClick={() => { const kind = BUSINESS_KINDS.find((k) => !form.kinds.includes(k))!; patch({ kinds: [...form.kinds, kind] }); }}><Plus className="h-4 w-4" />Adicionar novo tipo de venda</button>}
    {finance && <details className="border border-line px-4 py-3"><summary className="cursor-pointer text-sm font-semibold text-ink">Outras despesas de entrega e taxas</summary><label className="mt-3 flex items-center gap-3 text-sm">Valor único<Input aria-label="Outras despesas de entrega e taxas" className="num h-9 w-36" inputMode="decimal" value={form.extra} disabled={!costsEditable} onChange={(e) => patch({ extra: e.target.value })} /></label></details>}
    {itemsQ.data.bid && <div className="flex flex-wrap items-center gap-4 border border-line p-3 text-sm" role="radiogroup" aria-label="Lance da licitação"><b>Lance</b>{(['item', 'global'] as const).map((mode) => <label key={mode}><input type="radio" checked={form.bidMode === mode} disabled={!editable} onChange={() => patch({ bidMode: mode })} /> {mode === 'item' ? 'Por item' : 'Global'}</label>)}{form.bidMode === 'global' && <Input aria-label="Lance global" inputMode="decimal" value={form.bidGlobal} disabled={!editable} onChange={(e) => patch({ bidGlobal: e.target.value })} />}</div>}
    <datalist id="deal-products">{products.map((p) => <option key={p.id} value={p.description} />)}{plans.map((p) => <option key={p.id} value={p.name} />)}</datalist>
    {dirty && editable && <div className="flex justify-end gap-2"><Button onClick={() => { setForm(null); setMessage(null); }}>Descartar alterações</Button>{saveButton}</div>}
    <NewDeliveryAddressModal opp={opp} open={addressFor != null} onClose={() => setAddressFor(null)} onCreated={(id) => { if (addressFor) updateItem(addressFor, { address: id }); }} />
    <Modal open={paste != null} onClose={() => setPaste(null)} title="Colar produtos do Excel" footer={<><Button onClick={() => setPaste(null)}>Cancelar</Button><Button variant="primary" onClick={() => { if (paste) importProducts(paste.kind, paste.text.split(/\r?\n/).map((l) => l.split('\t'))); setPaste(null); }}>Incluir produtos</Button></>}><p className="mb-2 text-sm text-muted">Inclua os títulos Descrição, Quantidade e Valor. Deixe todos os valores em branco para usar o preço sugerido.</p><Textarea aria-label="Produtos colados" rows={8} value={paste?.text ?? ''} onChange={(e) => paste && setPaste({ ...paste, text: e.target.value })} /></Modal>
    <Modal open={removeKind != null} onClose={() => setRemoveKind(null)} title="Remover seção" footer={<><Button onClick={() => setRemoveKind(null)}>Cancelar</Button><Button variant="primary" onClick={() => { patch({ kinds: form.kinds.filter((k) => k !== removeKind), items: form.items.filter((r) => r.kind !== removeKind), costs: form.costs.filter((r) => r.kind !== removeKind) }); setRemoveKind(null); }}>Remover produtos e custos da seção</Button></>}><p className="text-sm">Os produtos e custos de {removeKind && BUSINESS_LABELS[removeKind]} serão removidos desta negociação ao salvar. Você pode descartar as alterações antes de salvar.</p></Modal>
  </section>;
}
const Fact = ({ label, value }: { label: string; value: string }) => <div className="border-r border-line px-4 py-2.5"><span className="block text-muted">{label}</span><b className="num text-ink">{value}</b></div>;

const NegotiationCosts = memo(function NegotiationCosts({ kind, title, costs, editable, catalog, update, readTable, assign }: { kind: DealKind | null; title: string; costs: CostDraft[]; editable: boolean; catalog: CostCatalog[]; update: (kind: DealKind | null, fn: (cs: CostDraft[]) => CostDraft[]) => void; readTable: (f: File) => Promise<(string | number | null)[][]>; assign?: (key: string, k: DealKind) => void }) {
  const [pasting, setPasting] = useState(false), [text, setText] = useState(''), [msg, setMsg] = useState('');
  const monthly = !kind || isMonthlyKind(kind);
  const set = (key: string, p: Partial<CostDraft>) => update(kind, (cs) => cs.map((c) => c.key === key ? { ...c, ...p } : c));
  const addTable = (rows: (string | number | null)[][]) => {
    const imported = parseCostTable(rows);
    if (imported.missing.length) { setMsg('Faltam as colunas ' + imported.missing.join(', ')); return; }
    if (!monthly && imported.lines.some((c) => c.frequency === 'mensal')) { setMsg('Esta negociação é de pagamento único. Custos mensais devem ser adicionados em Recorrência ou Aluguel.'); return; }
    update(kind, (cs) => [...cs, ...imported.lines.map(({ frequency: fr, ...c }) => {
      const hit = catalog.find((x) => x.name.toLowerCase() === c.description.toLowerCase());
      const frequency: Frequency = fr ?? (monthly && hit?.kind === 'mensal' ? 'mensal' : 'unico');
      return { ...c, key: rowKey(), quantity: quantityText(c.qtyMilli), value: moneyText(c.unitCents), kind, frequency, unit: c.unit ?? hit?.unit ?? null, costItemId: hit?.id ?? null, impact: c.impact ?? hit?.impact ?? (frequency === 'mensal' ? 'operacional' as const : 'material' as const) };
    })]);
    setMsg(imported.lines.length + ' custo(s) incluído(s). ' + (imported.errors.length ? 'Linhas ignoradas: ' + imported.errors.map((e) => e.row + ': ' + e.message).join('; ') : '') + ' Confira a coluna Quando e salve.');
  };
  return <div className="border-t border-line px-4 pb-3 pt-2.5">
    <div className="mb-2 flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold text-ink">{title}</h4><span className="flex-1" />{editable && <><Button size="sm" icon={<ClipboardPaste className="h-4 w-4" />} onClick={() => setPasting(true)}>Colar do Excel</Button><label className="inline-flex h-8 cursor-pointer items-center gap-1.5 border border-line px-3 text-xs font-semibold text-ink"><FileSpreadsheet className="h-4 w-4" />Importar planilha da viabilidade técnica<input type="file" accept=".xlsx,.xls,.csv,.txt" className="sr-only" aria-label={'Importar custos de ' + (kind ? BUSINESS_LABELS[kind] : 'custos anteriores')} onChange={(e) => { const f = e.target.files?.[0]; if (f) void readTable(f).then(addTable).catch(() => setMsg('Não foi possível ler a planilha.')); e.target.value = ''; }} /></label></>}</div>
    {msg && <p role="status" className="mb-2 text-xs text-muted">{msg}</p>}
    {!!costs.length && <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm" aria-label={'Custos de ' + (kind ? BUSINESS_LABELS[kind] : 'custos anteriores')}><thead className="bg-surface-2 text-left text-xs text-muted"><tr>{['Dedução', 'Descrição', 'Quando', 'Qtd.', 'Valor unitário', 'Total', ...(assign ? ['Negociação'] : []), ''].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead><tbody>{costs.map((c, n) => {
      const category = c.category ?? (c.impact === 'material' ? 'materia_prima' : c.impact === 'servico' ? 'mao_de_obra' : c.impact === 'operacional' ? 'despesas_operacionais' : c.impact ?? '');
      const lineTotal = (costQty(c.quantity) ?? 0) * (parseMoney(c.value) ?? 0) / 1000;
      return <tr key={c.key} className="border-t border-line align-top"><td className="px-2 py-2"><Select aria-label={'Dedução ' + c.key} className={clsx('h-9 w-40 text-xs', category === 'materia_prima' ? 'bg-primary-soft text-primary' : category === 'despesas_operacionais' ? 'bg-success-soft text-success' : category === 'parceiros' && 'bg-warning-soft text-[#9A4F08]')} value={category} disabled={!editable} onChange={(e) => { const category = e.target.value as NonNullable<CostDraft['category']>; set(c.key, { category, impact: category === 'materia_prima' ? 'material' : category === 'mao_de_obra' ? 'servico' : 'operacional' }); }}><option value="">Investimento sem classificação</option>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}{c.impact === 'entrega' && <option value="entrega">Despesa de entrega</option>}{c.impact === 'taxa_venda' && <option value="taxa_venda">Taxa fixa de venda</option>}</Select></td>
        <td className="w-full px-2 py-2"><Input aria-label={'Descrição do custo ' + (n + 1)} list={'costs-' + kind} className="h-9 min-w-48" value={c.description} disabled={!editable} onChange={(e) => { const hit = catalog.find((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase()); set(c.key, { description: e.target.value, costItemId: hit?.id ?? null, ...(hit ? { value: hit.unitCents == null ? c.value : moneyText(hit.unitCents), unit: hit.unit, impact: hit.impact ?? c.impact, category: null, frequency: monthly && hit.kind === 'mensal' ? 'mensal' : 'unico' } : {}) }); }} /><span className="mt-1 block text-2xs text-muted">{c.costItemId ? 'catálogo · ' : ''}{c.frequency === 'mensal' ? 'Repete em cada mês do contrato' : kind && isMonthlyKind(kind) ? 'Valor único: investimento a recuperar' : 'Valor único'}</span></td>
        <td className="px-2 py-2"><Select aria-label={'Quando do custo ' + (n + 1)} className="h-9 w-28" value={c.frequency} disabled={!editable || !monthly} onChange={(e) => set(c.key, { frequency: e.target.value as Frequency })}><option value="unico">Único</option>{monthly && <option value="mensal">Mensal</option>}</Select></td>
        <td className="px-2 py-2"><span className="flex items-center gap-1"><Input aria-label={'Quantidade do custo ' + (n + 1)} inputMode="decimal" className="num h-9 w-20" value={c.quantity} disabled={!editable} onChange={(e) => set(c.key, { quantity: e.target.value })} /><Input aria-label={'Unidade do custo ' + (n + 1)} className="h-9 w-12 border-0 px-1 text-xs" value={c.unit ?? ''} placeholder="un" disabled={!editable} onChange={(e) => set(c.key, { unit: e.target.value.slice(0, 12) })} /></span></td>
        <td className="px-2 py-2"><Input aria-label={'Valor unitário do custo ' + (n + 1)} inputMode="decimal" className="num h-9 w-28" value={c.value} disabled={!editable} onChange={(e) => set(c.key, { value: e.target.value })} /></td><td className="num whitespace-nowrap px-2 py-3 text-right">{fmtBRL(Math.round(lineTotal))}</td>{assign && <td className="px-2 py-2"><Select aria-label={'Negociação do custo ' + (n + 1)} className="h-9 w-36" value="" disabled={!editable} onChange={(e) => assign(c.key, e.target.value as DealKind)}><option value="">Escolha</option>{BUSINESS_KINDS.filter((k) => c.frequency !== 'mensal' || isMonthlyKind(k)).map((k) => <option key={k} value={k}>{BUSINESS_LABELS[k]}</option>)}</Select></td>}<td className="px-2 py-3"><button type="button" aria-label={'Remover custo ' + (n + 1)} disabled={!editable} onClick={() => update(kind, (cs) => cs.filter((x) => x.key !== c.key))}><Trash2 className="h-4 w-4 text-muted hover:text-danger" /></button></td></tr>;
    })}</tbody></table></div>}
    {editable && <button type="button" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline" onClick={() => update(kind, (cs) => [...cs, { key: rowKey(), description: '', quantity: '1', value: '', qtyMilli: 1000, unitCents: 0, unit: 'un', kind, impact: 'material', frequency: 'unico' }])}><Plus className="h-4 w-4" />Adicionar custo</button>}
    <datalist id={'costs-' + kind}>{catalog.map((c) => <option key={c.id} value={c.name}>{c.kind === 'mensal' ? 'Mensal' : 'Único'}</option>)}</datalist>
    <Modal open={pasting} onClose={() => setPasting(false)} title="Colar custos do Excel" footer={<><Button onClick={() => setPasting(false)}>Cancelar</Button><Button variant="primary" onClick={() => { addTable(text.split(/\r?\n/).map((l) => l.split('\t'))); setPasting(false); }}>Incluir custos</Button></>}><p className="mb-2 text-sm text-muted">Inclua os títulos Descrição, Quantidade e Valor unitário. A coluna Frequência é opcional e aceita Único ou Mensal.</p><Textarea aria-label="Custos colados" rows={8} value={text} onChange={(e) => setText(e.target.value)} /></Modal>
  </div>;
});
