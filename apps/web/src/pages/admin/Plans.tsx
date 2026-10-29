/** Configurações → Planos: serviço na fatura, produtos com valor unitário e comissão por venda ativa e receptiva. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { SEGMENTS, SEGMENT_LABELS, toCents, type Segment } from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { Button, Chip, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';

type Commission = { kind: 'percent' | 'fixo'; value: number } | null;
type Product = { name: string; qty: number; unitPriceCents: number; commissionAtiva: Commission; commissionReceptiva: Commission; partnerId?: string | null; partnerCostCents?: number | null };
type Plan = { id: string; name: string; line: string | null; segment: Segment; priceCents: number; speedMbps: number | null; invoiceServiceName: string | null; products: Product[]; partnerCosts: Record<string, number>; active: boolean; sourceSystem: string; fiscalDocCode?: string | null };

/** Linha do formulário: valores digitados como texto ("79,90", "50"). */
type ProductRow = { name: string; qty: string; unit: string; aKind: 'percent' | 'fixo' | ''; aValue: string; rKind: 'percent' | 'fixo' | ''; rValue: string; partnerId: string; partnerCost: string };
const dec = (n: number) => (n / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
const toRow = (p: Product): ProductRow => ({
  name: p.name, qty: String(p.qty), unit: dec(p.unitPriceCents),
  aKind: p.commissionAtiva?.kind ?? '', aValue: p.commissionAtiva ? dec(p.commissionAtiva.value) : '',
  rKind: p.commissionReceptiva?.kind ?? '', rValue: p.commissionReceptiva ? dec(p.commissionReceptiva.value) : '',
  partnerId: p.partnerId ?? '', partnerCost: p.partnerCostCents != null ? dec(p.partnerCostCents) : '',
});
/** Percentual e reais usam 2 casas: "50" → 5000 pontos-base; "10,00" → 1000 centavos. */
const commissionOf = (kind: ProductRow['aKind'], v: string): Commission => (kind && toCents(v) !== null ? { kind, value: toCents(v)! } : null);
const rowUnit = (r: ProductRow) => toCents(r.unit) ?? 0;
const rowQty = (r: ProductRow) => Math.max(1, Math.round(Number(r.qty) || 1));

function CommissionInput({ kind, value, onKind, onValue, label, id }: { kind: ProductRow['aKind']; value: string; onKind: (k: ProductRow['aKind']) => void; onValue: (v: string) => void; label: string; id: string }) {
  return (
    <div className="flex items-center gap-1">
      <Select aria-label={`${label}: forma`} id={id} className="h-9 w-[92px] px-2" value={kind} onChange={(e) => onKind(e.target.value as ProductRow['aKind'])}>
        <option value="">Sem</option><option value="percent">%</option><option value="fixo">R$</option>
      </Select>
      <Input aria-label={`${label}: valor`} inputMode="decimal" className="h-9 w-20" disabled={!kind} value={value} onChange={(e) => onValue(e.target.value)} placeholder={kind === 'percent' ? '50' : '10,00'} />
    </div>
  );
}

export function AdminPlans() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api<{ items: Plan[] }>('/admin/plans') });
  const docsQ = useQuery({ queryKey: ['admin', 'fiscal-docs'], queryFn: () => api<{ items: { code: string; name: string; active: boolean }[] }>('/admin/fiscal-docs') });
  /** Mesmo código em várias filiais/tipos de venda: o item usa o documento daquele código na filial da oportunidade. */
  const docCodes = [...new Map((docsQ.data?.items ?? []).filter((d) => d.active).map((d) => [d.code, d.name])).entries()];
  const [editing, setEditing] = useState<Plan | 'new' | null>(() => (new URLSearchParams(location.search).get('novo') ? 'new' : null));
  const empty = { name: '', line: '', segment: 'residencial' as Segment, price: '', speed: '', invoice: '', doc: '', active: true, products: [] as ProductRow[] };
  const [form, setForm] = useState(empty);
  const open = (p: Plan | 'new') => {
    setEditing(p);
    setForm(p === 'new' ? empty : { name: p.name, line: p.line ?? '', segment: p.segment, price: dec(p.priceCents), speed: p.speedMbps ? String(p.speedMbps) : '', invoice: p.invoiceServiceName ?? '', doc: p.fiscalDocCode ?? '', active: p.active, products: (p.products ?? []).map(toRow) });
  };
  const setRow = (i: number, v: Partial<ProductRow>) => setForm((f) => ({ ...f, products: f.products.map((r, j) => (j === i ? { ...r, ...v } : r)) }));
  const total = form.products.reduce((a, r) => a + rowUnit(r) * rowQty(r), 0);
  const hasProducts = form.products.length > 0;

  const m = useMutation({
    mutationFn: () => {
      for (const r of form.products) {
        if (r.name.trim().length < 2) throw new Error('Dê um nome a cada produto.');
        if (toCents(r.unit) === null) throw new Error(`Valor unitário inválido em “${r.name}”. Use o formato 79,90.`);
        if ((r.aKind && toCents(r.aValue) === null) || (r.rKind && toCents(r.rValue) === null)) throw new Error(`Comissão inválida em “${r.name}”.`);
      }
      const products: Product[] = form.products.map((r) => ({ name: r.name.trim(), qty: rowQty(r), unitPriceCents: rowUnit(r), commissionAtiva: commissionOf(r.aKind, r.aValue), commissionReceptiva: commissionOf(r.rKind, r.rValue), partnerId: r.partnerId || null, partnerCostCents: r.partnerId && r.partnerCost.trim() ? toCents(r.partnerCost) : null }));
      const priceCents = hasProducts ? total : toCents(form.price);
      if (priceCents === null) throw new Error('Informe o preço no formato 99,90 ou cadastre os produtos.');
      const body = { name: form.name, line: form.line || null, segment: form.segment, priceCents, speedMbps: form.speed ? Number(form.speed) : null, invoiceServiceName: form.invoice.trim() || null, fiscalDocCode: form.doc || null, products, active: form.active };
      return editing === 'new' ? api('/admin/plans', { method: 'POST', body }) : api(`/admin/plans/${(editing as Plan).id}`, { method: 'PATCH', body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin'] }); qc.invalidateQueries({ queryKey: ['lookups'] }); setEditing(null); toast({ tone: 'success', message: 'Plano salvo' }); },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message }),
  });

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
        <div><h2 className="text-lg font-bold text-ink">Planos e produtos</h2><p className="text-sm text-muted">O preço daqui é o valor usado nas oportunidades. Com produtos cadastrados, a mensalidade é a soma deles e a comissão sai de cada produto.</p></div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => open('new')}>Cadastrar plano</Button>
      </div>
      {q.isLoading ? <LoadingRows /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Plano', 'Serviço na fatura', 'Segmento', 'Velocidade', 'Produtos', 'Mensalidade', 'Situação', ''].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {q.data?.items.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-5 py-3"><span className="font-semibold text-ink">{p.name}</span>{p.line && <span className="block text-xs text-muted">{p.line}</span>}</td>
                  <td className="px-5 py-3 text-text">{p.invoiceServiceName ?? <span className="text-muted">—</span>}</td>
                  <td className="px-5 py-3 text-text">{SEGMENT_LABELS[p.segment]}</td>
                  <td className="num px-5 py-3 text-text">{p.speedMbps ? `${p.speedMbps} Mbps` : <span className="text-warning">Informe</span>}</td>
                  <td className="px-5 py-3 text-text">{p.products?.length ? `${p.products.length} produto(s)` : <span className="text-muted">—</span>}</td>
                  <td className="num px-5 py-3 text-ink">{fmtBRL(p.priceCents)}</td>
                  <td className="px-5 py-3"><Chip tone={p.active ? 'green' : 'neutral'}>{p.active ? 'Ativo' : 'Inativo'}</Chip></td>
                  <td className="px-5 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => open(p)}>Editar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Cadastrar plano' : 'Editar plano'} size="xl" footer={<><Button onClick={() => setEditing(null)}>Cancelar</Button><Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>Salvar</Button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Nome" htmlFor="pl-name" required><Input id="pl-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: 350 Mega" data-autofocus /></FormField>
            <FormField label="Nome do serviço na fatura" htmlFor="pl-inv" hint="Como aparece na fatura do cliente"><Input id="pl-inv" value={form.invoice} onChange={(e) => setForm({ ...form, invoice: e.target.value })} placeholder="Ex.: SCM - Internet 350M" /></FormField>
            <FormField label="Linha" htmlFor="pl-line"><Input id="pl-line" value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })} placeholder="Ex.: Yep Mais" /></FormField>
            <FormField label="Segmento" htmlFor="pl-seg"><Select id="pl-seg" value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value as Segment })}>{SEGMENTS.map((s) => <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>)}</Select></FormField>
            <FormField label="Velocidade (Mbps)" htmlFor="pl-speed" hint="Usada nas regras de viabilidade"><Input id="pl-speed" type="number" min={1} value={form.speed} onChange={(e) => setForm({ ...form, speed: e.target.value })} placeholder="350" /></FormField>
            <FormField label="Preço mensal (R$)" htmlFor="pl-price" required={!hasProducts} hint={hasProducts ? 'Soma dos produtos' : undefined}>
              <Input id="pl-price" inputMode="decimal" disabled={hasProducts} value={hasProducts ? dec(total) : form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="99,90" />
            </FormField>
            <FormField label="Documento fiscal padrão" htmlFor="pl-doc" hint="Já vem marcado no item da oportunidade e define os tributos. Cadastre em Filiais e documentos fiscais.">
              <Select id="pl-doc" value={form.doc} onChange={(e) => setForm({ ...form, doc: e.target.value })}>
                <option value="">Nenhum (escolher na oportunidade)</option>
                {form.doc && !docCodes.some(([c]) => c === form.doc) && <option value={form.doc}>{form.doc} (inativo)</option>}
                {docCodes.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}
              </Select>
            </FormField>
          </div>

          <fieldset className="rounded-md border border-line p-3">
            <legend className="px-1 text-sm font-semibold text-ink">Produtos do plano</legend>
            <p className="mb-2 text-xs text-muted">Tudo que compõe o plano (internet, ponto extra, TV, telefone…). Comissão em % do valor do produto ou em R$ por unidade, separada para venda ativa e receptiva.</p>
            {hasProducts && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-xs text-muted"><tr><th className="py-1 pr-2 font-medium">Produto</th><th className="py-1 pr-2 font-medium">Qtd.</th><th className="py-1 pr-2 font-medium">Valor unitário (R$)</th><th className="py-1 pr-2 font-medium">Comissão ativa</th><th className="py-1 pr-2 font-medium">Comissão receptiva</th><th /></tr></thead>
                  <tbody>
                    {form.products.map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="py-2 pr-2"><Input aria-label={`Produto ${i + 1}`} className="h-9 min-w-[180px]" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="Ex.: Internet 350 Mega" /></td>
                        <td className="py-2 pr-2"><Input aria-label={`Quantidade do produto ${i + 1}`} type="number" min={1} className="h-9 w-16" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} /></td>
                        <td className="py-2 pr-2"><Input aria-label={`Valor unitário do produto ${i + 1}`} inputMode="decimal" className="h-9 w-24" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} placeholder="79,90" /></td>
                        <td className="py-2 pr-2"><CommissionInput id={`pl-a-${i}`} label={`Comissão ativa do produto ${i + 1}`} kind={r.aKind} value={r.aValue} onKind={(k) => setRow(i, { aKind: k })} onValue={(v) => setRow(i, { aValue: v })} /></td>
                        <td className="py-2 pr-2"><CommissionInput id={`pl-r-${i}`} label={`Comissão receptiva do produto ${i + 1}`} kind={r.rKind} value={r.rValue} onKind={(k) => setRow(i, { rKind: k })} onValue={(v) => setRow(i, { rValue: v })} /></td>
                        <td className="py-2"><Button size="sm" variant="ghost" aria-label={`Remover produto ${i + 1}`} onClick={() => setForm((f) => ({ ...f, products: f.products.filter((_, j) => j !== i) }))} icon={<Trash2 className="h-4 w-4 text-danger" />} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t border-line font-semibold"><td className="py-2 text-ink" colSpan={2}>Mensalidade</td><td className="num py-2 text-ink">{fmtBRL(total)}</td><td colSpan={3} /></tr></tfoot>
                </table>
              </div>
            )}
            <Button size="sm" className="mt-2" icon={<Plus className="h-4 w-4" />} disabled={form.products.length >= 30} onClick={() => setForm((f) => ({ ...f, products: [...f.products, { name: f.products.length ? '' : f.name, qty: '1', unit: f.products.length ? '' : f.price, aKind: '', aValue: '', rKind: '', rValue: '', partnerId: '', partnerCost: '' }] }))}>Adicionar produto</Button>
          </fieldset>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Ativo (aparece para novas oportunidades)</label>
        </div>
      </Modal>
    </section>
  );
}

