/**
 * Produtos e serviços da oportunidade: lançar à mão, importar planilha (Excel/CSV) ou colar do Excel.
 * O total vira o valor da oportunidade. Em Licitação, o lance é por item ou global.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, FileSpreadsheet, Package, Plus, Trash2 } from 'lucide-react';
import { ITEM_UNITS, ITEM_UNIT_LABELS, itemTotal, parseItemsTable, parseMoney, parseQty, type BidMode, type ItemInput, type ItemUnit } from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import type { Opportunity } from '../../lib/types';
import { Button, Input, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';

type Saved = { id: string; description: string; unit: ItemUnit; qtyMilli: number; unitCents: number; discountCents: number; surchargeCents: number; notes: string | null; bidUnitCents: number | null };
type Data = { items: Saved[]; bid: boolean; bidMode: BidMode | null; bidGlobalCents: number | null; rowVersion: number; editable: boolean };
type Row = { key: string; description: string; unit: ItemUnit; qty: string; unit$: string; discount: string; surcharge: string; notes: string; bid: string };

const money = (c: number | null | undefined) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const qtyText = (m: number) => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
let seq = 0;
const blank = (): Row => ({ key: `n${++seq}`, description: '', unit: 'un', qty: '1', unit$: '', discount: '', surcharge: '', notes: '', bid: '' });
const fromSaved = (i: Saved | ItemInput): Row => ({ key: `n${++seq}`, description: i.description, unit: i.unit, qty: qtyText(i.qtyMilli), unit$: money(i.unitCents), discount: i.discountCents ? money(i.discountCents) : '', surcharge: i.surchargeCents ? money(i.surchargeCents) : '', notes: i.notes ?? '', bid: i.bidUnitCents != null ? money(i.bidUnitCents) : '' });
const toInput = (r: Row) => ({ description: r.description.trim(), unit: r.unit, qtyMilli: parseQty(r.qty), unitCents: parseMoney(r.unit$), discountCents: parseMoney(r.discount), surchargeCents: parseMoney(r.surcharge), notes: r.notes.trim() || null, bidUnitCents: r.bid.trim() ? parseMoney(r.bid) : null });

export function OpportunityItems({ opp }: { opp: Opportunity }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['opp-items', opp.id], queryFn: () => api<Data>(`/opportunities/${opp.id}/items`) });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [bidMode, setBidMode] = useState<BidMode>('item');
  const [bidGlobal, setBidGlobal] = useState('');
  const [pasting, setPasting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  useEffect(() => {
    if (q.data && rows === null) { setRows(q.data.items.map(fromSaved)); setBidMode(q.data.bidMode ?? 'item'); setBidGlobal(money(q.data.bidGlobalCents)); }
  }, [q.data, rows]);
  const cur = rows ?? [];
  const dirty = useMemo(() => {
    if (!q.data || rows === null) return false;
    const a = JSON.stringify(rows.map((r) => ({ ...r, key: '' })));
    const b = JSON.stringify(q.data.items.map(fromSaved).map((r) => ({ ...r, key: '' })));
    return a !== b || (q.data.bid && (bidMode !== (q.data.bidMode ?? 'item') || bidGlobal !== money(q.data.bidGlobalCents)));
  }, [rows, q.data, bidMode, bidGlobal]);
  const parsed = cur.map(toInput);
  const lineTotal = (i: ReturnType<typeof toInput>) => (i.qtyMilli && i.unitCents != null && i.discountCents != null && i.surchargeCents != null ? itemTotal({ qtyMilli: i.qtyMilli, unitCents: i.unitCents, discountCents: i.discountCents, surchargeCents: i.surchargeCents }) : null);
  const total = parsed.reduce((t, i) => t + (lineTotal(i) ?? 0), 0);
  const discount = parsed.reduce((t, i) => t + (i.discountCents ?? 0), 0);
  const surcharge = parsed.reduce((t, i) => t + (i.surchargeCents ?? 0), 0);
  const bid = !!q.data?.bid;
  const bidTotal = bid ? (bidMode === 'global' ? parseMoney(bidGlobal) : parsed.reduce((t, i) => t + (i.qtyMilli && i.bidUnitCents != null ? Math.round((i.qtyMilli * i.bidUnitCents) / 1000) : 0), 0)) : null;
  const editable = !!q.data?.editable;
  const set = (k: string, patch: Partial<Row>) => setRows(cur.map((r) => (r.key === k ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: () => {
      const bad = parsed.findIndex((i) => !i.description || !i.qtyMilli || i.unitCents == null || i.discountCents == null || i.surchargeCents == null || (i.bidUnitCents === null && cur[parsed.indexOf(i)]!.bid.trim() !== ''));
      if (bad >= 0) throw new Error(`Confira o item ${bad + 1}: produto, quantidade e valores.`);
      return api<Opportunity>(`/opportunities/${opp.id}/items`, { method: 'PUT', body: { rowVersion: opp.rowVersion, items: parsed, ...(bid ? { bidMode, bidGlobalCents: bidMode === 'global' ? parseMoney(bidGlobal) : null } : {}) } });
    },
    onSuccess: (o) => { qc.setQueryData(['opportunity', o.id], o); setRows(null); void qc.invalidateQueries({ queryKey: ['opp-items', opp.id] }); void qc.invalidateQueries({ queryKey: ['timeline', opp.id] }); toast({ tone: 'success', message: 'Produtos e serviços salvos' }); },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError && e.status === 409 ? 'A oportunidade mudou enquanto você editava. Aguarde salvar os outros campos e tente de novo.' : errMsg(e) }),
  });

  const addImported = (table: (string | number | null)[][], from: string) => {
    const r = parseItemsTable(table);
    if (r.missing.length) { setImportMsg(`${from}: faltam as colunas ${r.missing.join(', ')}. A primeira linha precisa ter os títulos (Produto/Serviço, Valor, Medida, Quantidade, Desconto, Acréscimo, Observação${bid ? ', Lance' : ''}).`); return; }
    setRows([...cur.filter((x) => x.description.trim()), ...r.items.map(fromSaved)]);
    setImportMsg(`${from}: ${r.items.length} item(ns) incluído(s)${r.errors.length ? `; ${r.errors.length} linha(s) ignorada(s): ${r.errors.slice(0, 4).map((e) => `linha ${e.row} (${e.message})`).join('; ')}` : ''}. Confira e clique em Salvar.`);
  };
  const onFile = async (f: File) => {
    try {
      if (/\.xlsx?$/i.test(f.name)) {
        const { default: readXlsx } = await import('read-excel-file');
        addImported((await readXlsx(f)) as (string | number | null)[][], f.name);
      } else {
        const text = await f.text();
        const sep = text.includes('\t') ? '\t' : text.split('\n')[0]!.split(';').length > text.split('\n')[0]!.split(',').length ? ';' : ',';
        addImported(text.split(/\r?\n/).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, ''))), f.name);
      }
    } catch { setImportMsg(`Não foi possível ler ${f.name}. Use Excel (.xlsx) ou CSV.`); }
  };

  return (
    <section className="card p-5" aria-label="Produtos e serviços">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-md font-bold text-ink"><Package className="h-5 w-5 text-primary" aria-hidden />Produtos e serviços</h2>
        {editable && (
          <span className="flex flex-wrap gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm border border-line px-3 text-sm font-semibold text-ink hover:bg-surface-2">
              <FileSpreadsheet className="h-4 w-4" aria-hidden />Importar planilha
              <input type="file" accept=".xlsx,.xls,.csv,.txt" className="sr-only" aria-label="Importar planilha de produtos" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
            </label>
            <Button size="sm" icon={<ClipboardPaste className="h-4 w-4" />} onClick={() => setPasting(true)}>Colar do Excel</Button>
            <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setRows([...cur, blank()])}>Adicionar item</Button>
          </span>
        )}
      </div>
      {importMsg && <div className="mb-3"><Notice tone={importMsg.includes('faltam') || importMsg.includes('Não foi') ? 'warning' : 'info'}>{importMsg}</Notice></div>}
      {!cur.length ? (
        <p className="text-sm text-muted">{q.isLoading ? 'Carregando…' : 'Nenhum produto ou serviço lançado. A venda só fecha com os produtos lançados.'}</p>
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-xs text-muted"><tr>{['Produto/Serviço', 'Medida', 'Qtd.', 'Valor', 'Desconto', 'Acréscimo', ...(bid && bidMode === 'item' ? ['Lance (un.)'] : []), 'Total', 'Observação', ''].map((h) => <th key={h} className="px-1.5 py-1.5 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {cur.map((r, i) => {
                const lt = lineTotal(parsed[i]!);
                return (
                  <tr key={r.key} className="border-t border-line align-top">
                    <td className="px-1.5 py-1.5"><Input aria-label={`Produto ou serviço ${i + 1}`} className="h-9 min-w-[180px]" value={r.description} disabled={!editable} onChange={(e) => set(r.key, { description: e.target.value })} /></td>
                    <td className="px-1.5 py-1.5"><Select aria-label={`Medida ${i + 1}`} className="h-9 w-[72px]" value={r.unit} disabled={!editable} onChange={(e) => set(r.key, { unit: e.target.value as ItemUnit })}>{ITEM_UNITS.map((u) => <option key={u} value={u}>{ITEM_UNIT_LABELS[u]}</option>)}</Select></td>
                    <td className="px-1.5 py-1.5"><Input aria-label={`Quantidade ${i + 1}`} inputMode="decimal" className="num h-9 w-[72px]" value={r.qty} disabled={!editable} onChange={(e) => set(r.key, { qty: e.target.value })} /></td>
                    <td className="px-1.5 py-1.5"><Input aria-label={`Valor ${i + 1}`} inputMode="decimal" className="num h-9 w-[104px]" value={r.unit$} disabled={!editable} onChange={(e) => set(r.key, { unit$: e.target.value })} placeholder="0,00" /></td>
                    <td className="px-1.5 py-1.5"><Input aria-label={`Desconto ${i + 1}`} inputMode="decimal" className="num h-9 w-[92px]" value={r.discount} disabled={!editable} onChange={(e) => set(r.key, { discount: e.target.value })} placeholder="0,00" /></td>
                    <td className="px-1.5 py-1.5"><Input aria-label={`Acréscimo ${i + 1}`} inputMode="decimal" className="num h-9 w-[92px]" value={r.surcharge} disabled={!editable} onChange={(e) => set(r.key, { surcharge: e.target.value })} placeholder="0,00" /></td>
                    {bid && bidMode === 'item' && <td className="px-1.5 py-1.5"><Input aria-label={`Lance ${i + 1}`} inputMode="decimal" className="num h-9 w-[100px]" value={r.bid} disabled={!editable} onChange={(e) => set(r.key, { bid: e.target.value })} placeholder="0,00" /></td>}
                    <td className="num whitespace-nowrap px-1.5 py-2.5 font-semibold text-ink">{lt == null ? '—' : fmtBRL(lt)}</td>
                    <td className="px-1.5 py-1.5"><Input aria-label={`Observação ${i + 1}`} className="h-9 min-w-[140px]" value={r.notes} disabled={!editable} onChange={(e) => set(r.key, { notes: e.target.value })} /></td>
                    <td className="px-1.5 py-1.5">{editable && <button type="button" className="rounded-sm p-1.5 text-muted hover:bg-surface-2 hover:text-danger" aria-label={`Remover item ${i + 1}`} onClick={() => setRows(cur.filter((x) => x.key !== r.key))}><Trash2 className="h-4 w-4" /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {bid && editable && (
        <div className="mt-3 flex flex-wrap items-center gap-4 rounded-md bg-surface-2 p-3 text-sm" role="radiogroup" aria-label="Lance da licitação">
          <span className="font-semibold text-ink">Lance</span>
          <label className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={bidMode === 'item'} onChange={() => setBidMode('item')} />Por item</label>
          <label className="flex items-center gap-2"><input type="radio" className="accent-primary" checked={bidMode === 'global'} onChange={() => setBidMode('global')} />Global</label>
          {bidMode === 'global' && <Input aria-label="Lance global" inputMode="decimal" className="num h-9 w-[140px]" value={bidGlobal} onChange={(e) => setBidGlobal(e.target.value)} placeholder="0,00" />}
        </div>
      )}
      <dl className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
        {discount > 0 && <div className="flex gap-2"><dt className="text-muted">Descontos</dt><dd className="num text-ink">−{fmtBRL(discount)}</dd></div>}
        {surcharge > 0 && <div className="flex gap-2"><dt className="text-muted">Acréscimos</dt><dd className="num text-ink">+{fmtBRL(surcharge)}</dd></div>}
        <div className="flex gap-2"><dt className="font-semibold text-ink">Total</dt><dd className="num font-bold text-ink">{fmtBRL(total)}</dd></div>
        {bid && bidTotal != null && bidTotal > 0 && <div className="flex gap-2"><dt className="font-semibold text-ink">Lance</dt><dd className="num font-bold text-ink">{fmtBRL(bidTotal)}{total > 0 ? <span className="ml-1 font-normal text-muted">({((1 - bidTotal / total) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% abaixo)</span> : null}</dd></div>}
      </dl>
      {editable && (dirty || cur.length > 0) && (
        <div className="mt-3 flex justify-end gap-2">
          {dirty && <Button variant="secondary" onClick={() => { setRows(null); setImportMsg(null); }}>Descartar</Button>}
          <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{dirty ? 'Salvar produtos e serviços' : 'Salvo'}</Button>
        </div>
      )}
      <Modal open={pasting} onClose={() => setPasting(false)} title="Colar do Excel"
        footer={<><Button variant="secondary" onClick={() => setPasting(false)}>Cancelar</Button><Button variant="primary" onClick={() => { const ta = document.getElementById('paste-items') as HTMLTextAreaElement | null; if (ta?.value.trim()) addImported(ta.value.split(/\r?\n/).map((l) => l.split('\t')), 'Colado'); setPasting(false); }}>Incluir itens</Button></>}>
        <div className="space-y-2 text-sm">
          <p className="text-muted">Copie as células no Excel, incluindo a linha de títulos (Produto/Serviço, Valor, Medida, Quantidade, Desconto, Acréscimo, Observação{bid ? ', Lance' : ''}), e cole abaixo.</p>
          <Textarea id="paste-items" aria-label="Itens colados" rows={8} />
        </div>
      </Modal>
    </section>
  );
}
