/** Itens e saldos da ata: registrado, reservado, contratado, executado e disponível, por item e por órgão. */
import { Fragment, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, History, Pencil, Plus, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtBRL, fmtDateTime } from '../../lib/format';
import { Button, EmptyState, FormField, Input, LoadingRows, Notice, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { AgencyChip, BalanceBar, QtyInput, Table, errMsg, itemLabel, parseMoney, parseQty, qty, useArpRefresh, type ArpDetail, type ItemView } from './shared';

function NewItem({ arp, open, onClose }: { arp: ArpDetail; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const blank = { itemNumber: '', lot: '', code: '', description: '', specification: '', unit: '', qty: '', price: '', brandModel: '' };
  const [f, setF] = useState(blank);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const parts = arp.agencies.filter((g) => g.kind === 'participante');
  const m = useMutation({
    mutationFn: () => api(`/arps/${arp.id}/items`, { method: 'POST', body: {
      itemNumber: f.itemNumber, lot: f.lot || null, code: f.code || null, description: f.description, specification: f.specification || null, unit: f.unit, brandModel: f.brandModel || null,
      registeredMilli: parseQty(f.qty), unitCents: parseMoney(f.price),
      allocations: Object.entries(alloc).map(([agencyId, v]) => ({ agencyId, qtyMilli: parseQty(v) ?? 0 })).filter((x) => x.qtyMilli > 0),
    } }),
    onSuccess: () => { refresh(); setF(blank); setAlloc({}); onClose(); toast({ tone: 'success', message: 'Item cadastrado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const ok = f.itemNumber.trim() && f.description.trim().length >= 2 && f.unit.trim() && parseQty(f.qty) && parseMoney(f.price);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <Modal open={open} onClose={onClose} title="Novo item da ata" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ok} loading={m.isPending} onClick={() => m.mutate()}>Cadastrar item</Button></>}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <FormField label="Lote" htmlFor="ni-lot"><Input id="ni-lot" value={f.lot} onChange={(e) => set({ lot: e.target.value })} /></FormField>
        <FormField label="Item" htmlFor="ni-num" required><Input id="ni-num" value={f.itemNumber} onChange={(e) => set({ itemNumber: e.target.value })} /></FormField>
        <FormField label="Código" htmlFor="ni-code"><Input id="ni-code" value={f.code} onChange={(e) => set({ code: e.target.value })} /></FormField>
        <FormField label="Unidade" htmlFor="ni-unit" required><Input id="ni-unit" value={f.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="mês, un, km" /></FormField>
        <FormField label="Descrição" htmlFor="ni-desc" required className="col-span-2 sm:col-span-4"><Input id="ni-desc" value={f.description} onChange={(e) => set({ description: e.target.value })} /></FormField>
        <FormField label="Especificação" htmlFor="ni-spec" className="col-span-2 sm:col-span-4"><Textarea id="ni-spec" rows={2} value={f.specification} onChange={(e) => set({ specification: e.target.value })} /></FormField>
        <FormField label="Quantidade registrada" htmlFor="ni-qty" required><Input id="ni-qty" inputMode="decimal" value={f.qty} onChange={(e) => set({ qty: e.target.value })} /></FormField>
        <FormField label="Valor unitário (R$)" htmlFor="ni-price" required><Input id="ni-price" inputMode="decimal" value={f.price} onChange={(e) => set({ price: e.target.value })} placeholder="1.500,00" /></FormField>
        <FormField label="Marca/modelo" htmlFor="ni-brand" className="col-span-2"><Input id="ni-brand" value={f.brandModel} onChange={(e) => set({ brandModel: e.target.value })} /></FormField>
      </div>
      {!!parts.length && (
        <fieldset className="mt-5 space-y-2">
          <legend className="text-sm font-semibold text-ink">Distribuição entre participantes</legend>
          <p className="text-xs text-muted">O que não for distribuído fica com o gerenciador.</p>
          {parts.map((g) => <div key={g.id} className="flex items-center justify-between gap-3"><span className="text-sm">{g.name}</span><QtyInput label={`Quantidade de ${g.name}`} value={alloc[g.id] ?? ''} onChange={(v) => setAlloc({ ...alloc, [g.id]: v })} unit={f.unit} /></div>)}
        </fieldset>
      )}
    </Modal>
  );
}

function EditItem({ arp, item, onClose }: { arp: ArpDetail; item: ItemView | null; onClose: () => void }) {
  const toast = useToast();
  const refresh = useArpRefresh(arp.id);
  const [f, setF] = useState<{ code: string; description: string; specification: string; unit: string; brandModel: string; notes: string; reason: string } | null>(null);
  const cur = f ?? (item ? { code: item.code ?? '', description: item.description, specification: item.specification ?? '', unit: item.unit, brandModel: item.brandModel ?? '', notes: item.notes ?? '', reason: '' } : null);
  const m = useMutation({
    mutationFn: () => api(`/arps/${arp.id}/items/${item!.id}`, { method: 'PATCH', body: { code: cur!.code || null, description: cur!.description, specification: cur!.specification || null, unit: cur!.unit, brandModel: cur!.brandModel || null, notes: cur!.notes || null, reason: cur!.reason } }),
    onSuccess: () => { refresh(); setF(null); onClose(); toast({ tone: 'success', message: 'Item corrigido' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const set = (p: Partial<NonNullable<typeof cur>>) => setF({ ...cur!, ...p });
  return (
    <Modal open={!!item} onClose={() => { setF(null); onClose(); }} title={item ? `Corrigir ${itemLabel(item)}` : ''} size="lg" footer={<><Button variant="secondary" onClick={() => { setF(null); onClose(); }}>Cancelar</Button><Button variant="primary" disabled={(cur?.reason.trim().length ?? 0) < 5} loading={m.isPending} onClick={() => m.mutate()}>Salvar correção</Button></>}>
      {cur && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Notice>Quantidade e preço registrados não mudam por edição. Use Conversões e remanejamentos (alteração de preço ou cancelamento), com documento e aprovação.</Notice>
          <span />
          <FormField label="Descrição" htmlFor="ei-desc" className="sm:col-span-2"><Input id="ei-desc" value={cur.description} onChange={(e) => set({ description: e.target.value })} /></FormField>
          <FormField label="Especificação" htmlFor="ei-spec" className="sm:col-span-2"><Textarea id="ei-spec" rows={2} value={cur.specification} onChange={(e) => set({ specification: e.target.value })} /></FormField>
          <FormField label="Código" htmlFor="ei-code"><Input id="ei-code" value={cur.code} onChange={(e) => set({ code: e.target.value })} /></FormField>
          <FormField label="Unidade" htmlFor="ei-unit"><Input id="ei-unit" value={cur.unit} onChange={(e) => set({ unit: e.target.value })} /></FormField>
          <FormField label="Marca/modelo" htmlFor="ei-brand"><Input id="ei-brand" value={cur.brandModel} onChange={(e) => set({ brandModel: e.target.value })} /></FormField>
          <FormField label="Observações" htmlFor="ei-notes"><Input id="ei-notes" value={cur.notes} onChange={(e) => set({ notes: e.target.value })} /></FormField>
          <FormField label="Motivo da correção" htmlFor="ei-reason" required className="sm:col-span-2"><Textarea id="ei-reason" rows={2} value={cur.reason} onChange={(e) => set({ reason: e.target.value })} /></FormField>
        </div>
      )}
    </Modal>
  );
}

const FIELD_LABEL: Record<string, string> = { code: 'Código', description: 'Descrição', specification: 'Especificação', unit: 'Unidade', brandModel: 'Marca/modelo', notes: 'Observações', registeredMilli: 'Quantidade', unitCents: 'Preço unitário' };
function ItemHistory({ arpId, item, onClose }: { arpId: string; item: ItemView | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['arp', arpId, 'item-changes', item?.id], enabled: !!item, queryFn: () => api<{ items: { id: string; field: string; fromValue: string; toValue: string; reason: string; origin: string; createdAt: string; actorName: string | null }[] }>(`/arps/${arpId}/items/${item!.id}/changes`) });
  const show = (f: string, v: string) => (f === 'unitCents' ? fmtBRL(Number(v)) : f === 'registeredMilli' ? qty(Number(v)) : v || '(vazio)');
  return (
    <Modal open={!!item} onClose={onClose} title={item ? `Histórico do ${itemLabel(item).toLowerCase()}` : ''} size="lg">
      {q.isLoading ? <LoadingRows rows={3} /> : !q.data?.items.length ? <p className="text-sm text-muted">Nenhuma alteração desde o cadastro.</p> : (
        <ul className="space-y-3">{q.data.items.map((c) => <li key={c.id} className="rounded-md border border-line p-3 text-sm"><p className="font-semibold text-ink">{FIELD_LABEL[c.field] ?? c.field}: {show(c.field, c.fromValue)} → {show(c.field, c.toValue)}</p><p className="text-muted">{c.reason} · {c.origin === 'importacao' ? 'importação' : c.origin === 'operacao' ? 'operação formal' : 'correção cadastral'} · {c.actorName ?? '—'} · {fmtDateTime(c.createdAt)}</p></li>)}</ul>
      )}
    </Modal>
  );
}

export function ItemsPanel({ arp, onImport }: { arp: ArpDetail; onImport: () => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ItemView | null>(null);
  const [hist, setHist] = useState<ItemView | null>(null);
  const agency = new Map(arp.agencies.map((g) => [g.id, g]));
  const toggle = (id: string) => { const n = new Set(open); n.has(id) ? n.delete(id) : n.add(id); setOpen(n); };
  const t = arp.totals;
  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[['Registrado', t.registeredValueCents], ['Contratado', t.contractedValueCents], ['Reservado', t.reservedValueCents], ['Saldo disponível', t.availableValueCents], ['Adesões autorizadas', t.adhesionValueCents]].map(([l, v]) => (
          <li key={l as string} className="card p-4"><p className="text-sm text-muted">{l}</p><p className="num mt-1 text-lg font-bold text-ink">{fmtBRL(v as number)}</p></li>
        ))}
      </ul>
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h2 className="text-lg font-bold text-ink">Itens e saldos</h2>
            <p className="flex flex-wrap items-center gap-3 text-xs text-muted"><span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-primary" />Contratado</span><span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-lime" />Reservado</span><span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-surface-2 ring-1 ring-line" />Disponível</span></p>
          </div>
          {arp.can.manage && (
            <div className="flex gap-2">
              <Button variant="outline" icon={<Upload className="h-4 w-4" />} onClick={onImport}>Importar planilha</Button>
              {arp.status === 'rascunho' && <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Novo item</Button>}
            </div>
          )}
        </div>
        {!arp.items.length ? (
          <div className="border-t border-line"><EmptyState title="Nenhum item ainda" description="Importe a planilha da ata (Excel ou CSV) ou cadastre os itens um a um." action={arp.can.manage ? <Button variant="primary" icon={<Upload className="h-4 w-4" />} onClick={onImport}>Importar planilha</Button> : undefined} /></div>
        ) : (
          <Table head={['', 'Item', 'Descrição', 'Unid.', 'Preço unit.', 'Registrada', 'Reservada', 'Contratada', 'Executada', 'Disponível', 'Uso', '']} min={1180}>
            {arp.items.map((i) => (
              <Fragment key={i.id}>
                <tr className="border-t border-line">
                  <td className="w-8 px-2 py-3">{!!i.byAgency.length && <button type="button" aria-expanded={open.has(i.id)} aria-label={`Saldos por órgão do ${itemLabel(i)}`} className="rounded p-1 hover:bg-surface-2" onClick={() => toggle(i.id)}>{open.has(i.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button>}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-semibold text-ink">{i.lot ? `${i.lot}/` : ''}{i.itemNumber}{i.code && <span className="block text-xs font-normal text-muted">{i.code}</span>}</td>
                  <td className="max-w-[300px] px-3 py-3"><span className="line-clamp-2">{i.description}</span>{i.brandModel && <span className="block text-xs text-muted">{i.brandModel}</span>}</td>
                  <td className="px-3 py-3">{i.unit}</td>
                  <td className="num px-3 py-3">{fmtBRL(i.unitCents)}</td>
                  <td className="num px-3 py-3">{qty(i.registeredMilli)}{i.registeredMilli !== i.originalMilli && <span className="block text-xs text-muted">original {qty(i.originalMilli)}</span>}</td>
                  <td className="num px-3 py-3">{qty(i.reservedMilli)}</td>
                  <td className="num px-3 py-3">{qty(i.contractedMilli)}</td>
                  <td className="num px-3 py-3">{qty(i.executedMilli)}</td>
                  <td className="num px-3 py-3 font-semibold">{qty(i.availableMilli)}<span className="block text-xs font-normal text-muted">{fmtBRL(Math.max(0, i.availableValueCents))}</span></td>
                  <td className="px-3 py-3"><BalanceBar registered={i.registeredMilli} contracted={i.contractedMilli} reserved={i.reservedMilli} label={`${itemLabel(i)}: ${qty(i.contractedMilli)} contratado, ${qty(i.reservedMilli)} reservado de ${qty(i.registeredMilli)}`} /></td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <button type="button" className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Histórico do ${itemLabel(i)}`} onClick={() => setHist(i)}><History className="h-4 w-4" /></button>
                    {arp.can.manage && <button type="button" className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={`Corrigir ${itemLabel(i)}`} onClick={() => setEditing(i)}><Pencil className="h-4 w-4" /></button>}
                  </td>
                </tr>
                {open.has(i.id) && i.byAgency.map((b) => { const g = agency.get(b.agencyId); return (
                  <tr key={b.agencyId} className="bg-surface-2/50 text-xs">
                    <td />
                    <td className="px-3 py-2" colSpan={3}><span className="mr-2 text-ink">{g?.name}</span>{g && <AgencyChip kind={g.kind} />}</td>
                    <td className="px-3 py-2 text-muted">{g?.kind === 'nao_participante' ? 'adesão' : 'cota'}</td>
                    <td className="num px-3 py-2">{qty(b.quota)}</td>
                    <td className="num px-3 py-2">{qty(b.reserved)}</td>
                    <td className="num px-3 py-2">{qty(b.contracted)}</td>
                    <td className="num px-3 py-2">{qty(b.executed)}</td>
                    <td className="num px-3 py-2 font-semibold">{qty(b.available)}</td>
                    <td className="px-3 py-2"><BalanceBar registered={b.quota} contracted={b.contracted} reserved={b.reserved} label={`${g?.name}: ${qty(b.available)} disponível`} /></td>
                    <td />
                  </tr>
                ); })}
              </Fragment>
            ))}
          </Table>
        )}
      </section>
      <NewItem arp={arp} open={adding} onClose={() => setAdding(false)} />
      <EditItem arp={arp} item={editing} onClose={() => setEditing(null)} />
      <ItemHistory arpId={arp.id} item={hist} onClose={() => setHist(null)} />
    </div>
  );
}
