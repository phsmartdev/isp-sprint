/**
 * Marketing → Brindes: estoque (custo por item, fornecedor, mínimo), kits com categoria (custo = soma dos itens),
 * envios para a conta e os stakeholders que receberam, consumo no período e fornecedores.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Plus, Trash2 } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmtBRL, fmtDate } from '../lib/format';
import { useUrlState } from '../lib/hooks';
import { PageHeader } from '../components/layout/PageHeader';
import { Button, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Tabs } from '../components/ui/primitives';
import { Modal, useToast } from '../components/ui/overlay';
import { errMsg } from '../features/contracts/shared';
import { GiftPlanning } from '../features/budget/GiftPlanning';
import { ComplianceSection } from '../features/gifts/Compliance';
import { useAuth } from '../auth/AuthProvider';

type Item = { id: string; name: string; supplierId: string | null; supplierName: string | null; unitCostCents: number; stock: number; minStock: number; active: boolean; low: boolean };
type Kit = { id: string; name: string; categoryId: string | null; categoryName: string | null; active: boolean; items: { itemId: string; name: string; qty: number; unitCostCents: number; totalCents: number }[]; costCents: number; available: number };
type Supplier = { id: string; name: string; phone: string | null; email: string | null; active: boolean; purchasedQty: number; purchasedCents: number; lastPurchaseAt: string | null; items: string[] };
type Data = { items: Item[]; kits: Kit[]; categories: { id: string; name: string; active: boolean }[]; suppliers: Supplier[] };
type Delivery = { id: string; contactId: string | null; account: string | null; purpose: string; campaign: string | null; eventName: string | null; occurredOn: string; kitName: string | null; categoryName: string | null; kits: number; items: { name: string; qty: number }[]; totalCents: number; recipients: number; by: string | null; cancelled: boolean; cancelReason: string | null };
type Row = { key: string; name: string; qty: number; totalCents: number; deliveries: number };
type Consumo = { totalCents: number; kits: number; deliveries: number; accounts: number; byItem: Row[]; byKit: Row[]; byCategory: Row[]; byAccount: { contactId: string; name: string; deliveries: number; kits: number; totalCents: number }[]; byCampaign?: { campaignId: string; name: string; deliveries: number; totalCents: number }[]; byPurpose?: { key: string; label: string; deliveries: number; totalCents: number }[]; purchases: { supplierId: string | null; name: string; qty: number; totalCents: number }[] };
type Tab = 'planejamento' | 'estoque' | 'kits' | 'envios' | 'consumo' | 'fornecedores' | 'compliance';
const PURPOSES = [['relacionamento', 'Relacionamento com a conta'], ['abm', 'Conta ABM'], ['oportunidade', 'Oportunidade'], ['campanha', 'Campanha'], ['evento', 'Evento'], ['institucional', 'Ação institucional']] as const;

const toCents = (v: string) => Math.round(Number(String(v).replace(/\./g, '').replace(',', '.')) * 100) || 0;
const money = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const monthStart = () => `${new Date().toISOString().slice(0, 8)}01`;
const TH = 'px-3 py-2.5 font-medium';
const TD = 'px-3 py-2.5';

function useSave(onDone?: () => void, msg = 'Salvo') {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (x: { url: string; method?: 'POST' | 'PATCH'; body: unknown }) => api(x.url, { method: x.method ?? 'POST', body: x.body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['brindes'] }); void qc.invalidateQueries({ queryKey: ['account-gifts'] }); toast({ tone: 'success', message: msg }); onDone?.(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
}

const TABS = (low: number): { key: Tab; label: string; count?: number }[] => [
  { key: 'planejamento', label: 'Planejamento e orçamento' }, { key: 'estoque', label: 'Estoque', count: low || undefined }, { key: 'kits', label: 'Kits' }, { key: 'envios', label: 'Envios' }, { key: 'consumo', label: 'Consumo' }, { key: 'fornecedores', label: 'Fornecedores' }, { key: 'compliance', label: 'Compliance' },
];

export function GiftsPage() {
  const { can } = useAuth();
  // quem não tem Marketing (ex.: Operação Comercial) só solicita e acompanha as próprias concessões
  const marketing = can('campanhas');
  const [f, setF] = useUrlState({ t: marketing ? 'estoque' : 'compliance', from: '', to: '' });
  const tab = (marketing ? f.t : 'compliance') as Tab;
  const from = f.from || monthStart(), to = f.to || new Date().toISOString().slice(0, 10);
  const q = useQuery({ queryKey: ['brindes'], enabled: marketing, queryFn: () => api<Data>('/brindes') });
  if (!marketing || tab === 'compliance') return (
    <div className="w-full">
      <PageHeader icon={<Gift />} title="Brindes" subtitle={marketing ? 'Estoque, kits, envios para as contas e quanto foi gasto com cada uma.' : 'Solicitações de brindes, kits, apoios e patrocínios: avaliação das diretrizes, autorização e execução.'} />
      {marketing && <Tabs<Tab> label="Brindes" className="mb-5" value={tab} onChange={(t) => setF({ t })} tabs={TABS(0)} />}
      <ComplianceSection />
    </div>
  );
  const low = q.data?.items.filter((i) => i.low).length ?? 0;
  return (
    <div className="w-full">
      <PageHeader icon={<Gift />} title="Brindes" subtitle="Estoque, kits, envios para as contas e quanto foi gasto com cada uma." />
      <Tabs<Tab> label="Brindes" className="mb-5" value={tab} onChange={(t) => setF({ t })} tabs={TABS(low)} />
      {(tab === 'envios' || tab === 'consumo') && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <FormField label="De" htmlFor="gf-from"><Input id="gf-from" type="date" value={from} onChange={(e) => setF({ from: e.target.value })} /></FormField>
          <FormField label="até" htmlFor="gf-to"><Input id="gf-to" type="date" value={to} onChange={(e) => setF({ to: e.target.value })} /></FormField>
        </div>
      )}
      {q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          {tab === 'planejamento' && <GiftPlanning items={q.data!.items} suppliers={q.data!.suppliers} />}
          {tab === 'estoque' && <Stock d={q.data!} />}
          {tab === 'kits' && <Kits d={q.data!} />}
          {tab === 'envios' && <Deliveries d={q.data!} from={from} to={to} />}
          {tab === 'consumo' && <Consumption from={from} to={to} />}
          {tab === 'fornecedores' && <Suppliers d={q.data!} />}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ estoque
function Stock({ d }: { d: Data }) {
  const [edit, setEdit] = useState<Partial<Item> | null>(null);
  const [move, setMove] = useState<{ item: Item; kind: 'entrada' | 'ajuste' } | null>(null);
  const items = d.items.filter((i) => i.active);
  const value = items.reduce((t, i) => t + i.stock * i.unitCostCents, 0);
  return (
    <section className="card overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <p className="text-sm text-muted">{items.length} itens · valor em estoque <b className="num text-ink">{fmtBRL(value)}</b></p>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({})}>Novo item</Button>
      </div>
      {!d.items.length ? <EmptyState title="Nenhum item" description="Cadastre os brindes (camiseta, caneca, caderno…) com o custo por unidade e o estoque." /> : (
        <table className="w-full text-left text-sm" aria-label="Estoque de brindes">
          <thead className="bg-surface-2 text-xs text-muted"><tr>{['Item', 'Fornecedor', 'Custo por item', 'Estoque', 'Mínimo', 'Valor em estoque', ''].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
          <tbody>{d.items.map((i) => (
            <tr key={i.id} className={`border-t border-line ${i.active ? '' : 'opacity-50'}`}>
              <td className={`${TD} font-semibold text-ink`}>{i.name}{!i.active && <span className="ml-2 text-xs font-normal text-muted">inativo</span>}</td>
              <td className={TD}>{i.supplierName ?? '—'}</td>
              <td className={`${TD} num`}>{fmtBRL(i.unitCostCents)}</td>
              <td className={`${TD} num font-semibold ${i.low ? 'text-danger' : 'text-ink'}`}>{i.stock}{i.low && <span className="ml-2 text-xs font-semibold">repor</span>}</td>
              <td className={`${TD} num`}>{i.minStock}</td>
              <td className={`${TD} num`}>{fmtBRL(i.stock * i.unitCostCents)}</td>
              <td className={`${TD} whitespace-nowrap text-right`}>
                <button className="mr-3 font-semibold text-primary hover:underline" onClick={() => setMove({ item: i, kind: 'entrada' })}>Entrada</button>
                <button className="mr-3 font-semibold text-primary hover:underline" onClick={() => setMove({ item: i, kind: 'ajuste' })}>Ajustar</button>
                <button className="font-semibold text-primary hover:underline" onClick={() => setEdit(i)}>Editar</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {edit && <ItemModal d={d} it={edit} onClose={() => setEdit(null)} />}
      {move && <MoveModal d={d} item={move.item} kind={move.kind} onClose={() => setMove(null)} />}
    </section>
  );
}

function SupplierSelect({ d, value, onChange, id }: { d: Data; value: string; onChange: (v: string) => void; id: string }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const save = useMutation({ mutationFn: () => api<{ id: string }>('/brindes/fornecedores', { method: 'POST', body: { name } }), onSuccess: async (r) => { await qc.invalidateQueries({ queryKey: ['brindes'] }); onChange(r.id); setAdding(false); setName(''); } });
  if (adding) return <div className="flex gap-2"><Input aria-label="Nome do fornecedor" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do fornecedor" /><Button disabled={name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>Incluir</Button></div>;
  return <Select id={id} value={value} onChange={(e) => (e.target.value === '+' ? setAdding(true) : onChange(e.target.value))}><option value="">—</option>{d.suppliers.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="+">+ Novo fornecedor</option></Select>;
}

function ItemModal({ d, it, onClose }: { d: Data; it: Partial<Item>; onClose: () => void }) {
  const [v, setV] = useState({ name: it.name ?? '', supplierId: it.supplierId ?? '', cost: it.unitCostCents ? money(it.unitCostCents) : '', minStock: String(it.minStock ?? 0), initialStock: '0', active: it.active ?? true });
  const save = useSave(onClose);
  const body = { name: v.name, supplierId: v.supplierId || null, unitCostCents: toCents(v.cost), minStock: Number(v.minStock || 0), ...(it.id ? { active: v.active } : { initialStock: Number(v.initialStock || 0) }) };
  return (
    <Modal open onClose={onClose} title={it.id ? it.name! : 'Novo item'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={v.name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate(it.id ? { url: `/brindes/itens/${it.id}`, method: 'PATCH', body } : { url: '/brindes/itens', body })}>Salvar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Item" htmlFor="gi-n" required className="sm:col-span-2"><Input id="gi-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Ex.: Caneca térmica" /></FormField>
        <FormField label="Fornecedor" htmlFor="gi-s"><SupplierSelect id="gi-s" d={d} value={v.supplierId} onChange={(x) => setV((p) => ({ ...p, supplierId: x }))} /></FormField>
        <FormField label="Custo por item (R$)" htmlFor="gi-c"><Input id="gi-c" inputMode="decimal" value={v.cost} onChange={(e) => setV({ ...v, cost: e.target.value })} placeholder="0,00" /></FormField>
        <FormField label="Estoque mínimo" htmlFor="gi-m" hint="abaixo disso, aparece para repor"><Input id="gi-m" inputMode="numeric" value={v.minStock} onChange={(e) => setV({ ...v, minStock: e.target.value.replace(/\D/g, '') })} /></FormField>
        {!it.id ? <FormField label="Estoque inicial" htmlFor="gi-i"><Input id="gi-i" inputMode="numeric" value={v.initialStock} onChange={(e) => setV({ ...v, initialStock: e.target.value.replace(/\D/g, '') })} /></FormField>
          : <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Ativo</label>}
      </div>
    </Modal>
  );
}

function MoveModal({ d, item, kind, onClose }: { d: Data; item: Item; kind: 'entrada' | 'ajuste'; onClose: () => void }) {
  const [v, setV] = useState({ qty: '', cost: money(item.unitCostCents), supplierId: item.supplierId ?? '', note: '' });
  const save = useSave(onClose, kind === 'entrada' ? 'Entrada registrada' : 'Estoque ajustado');
  const qty = Number(v.qty.replace(/[^\d-]/g, '') || 0);
  const ok = kind === 'entrada' ? qty > 0 : qty !== 0 && v.note.trim().length >= 5 && item.stock + qty >= 0;
  const body = kind === 'entrada' ? { kind, qty, unitCostCents: toCents(v.cost), supplierId: v.supplierId || null, note: v.note || null } : { kind, qty, note: v.note };
  return (
    <Modal open onClose={onClose} title={`${kind === 'entrada' ? 'Entrada' : 'Ajuste'}: ${item.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ok} loading={save.isPending} onClick={() => save.mutate({ url: `/brindes/itens/${item.id}/movimento`, body })}>Registrar</Button></>}>
      <p className="mb-3 text-sm text-muted">Estoque atual: <b className="text-ink">{item.stock}</b>{kind === 'entrada' && ' · o custo por item passa a ser a média entre o que já está em estoque e esta compra.'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={kind === 'entrada' ? 'Quantidade comprada' : 'Diferença (+ ou −)'} htmlFor="gm-q" required><Input id="gm-q" inputMode="numeric" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} placeholder={kind === 'ajuste' ? 'Ex.: -2' : ''} /></FormField>
        {kind === 'entrada' && <FormField label="Custo por item nesta compra (R$)" htmlFor="gm-c"><Input id="gm-c" inputMode="decimal" value={v.cost} onChange={(e) => setV({ ...v, cost: e.target.value })} /></FormField>}
        {kind === 'entrada' && <FormField label="Fornecedor" htmlFor="gm-s" className="sm:col-span-2"><SupplierSelect id="gm-s" d={d} value={v.supplierId} onChange={(x) => setV((p) => ({ ...p, supplierId: x }))} /></FormField>}
        <FormField label={kind === 'ajuste' ? 'Motivo' : 'Observação'} htmlFor="gm-n" required={kind === 'ajuste'} className="sm:col-span-2"><Input id="gm-n" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder={kind === 'ajuste' ? 'Ex.: contagem do estoque, item avariado' : 'Ex.: nota fiscal 123'} /></FormField>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ kits
function Kits({ d }: { d: Data }) {
  const [edit, setEdit] = useState<Partial<Kit> | null>(null);
  const [cat, setCat] = useState(false);
  return (
    <section className="card overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <p className="text-sm text-muted">O custo do kit é a soma dos itens pelo custo atual. Categorias: {d.categories.map((c) => c.name).join(', ') || 'nenhuma'}.</p>
        <div className="flex gap-2"><Button onClick={() => setCat(true)}>Nova categoria</Button><Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!d.items.length} onClick={() => setEdit({})}>Novo kit</Button></div>
      </div>
      {!d.kits.length ? <EmptyState title="Nenhum kit" description={d.items.length ? 'Monte um kit com os itens do estoque e escolha a categoria.' : 'Cadastre os itens no Estoque antes de montar os kits.'} /> : (
        <table className="w-full text-left text-sm" aria-label="Kits de brindes">
          <thead className="bg-surface-2 text-xs text-muted"><tr>{['Kit', 'Categoria', 'Itens', 'Custo do kit', 'Dá para montar', ''].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
          <tbody>{d.kits.map((k) => (
            <tr key={k.id} className={`border-t border-line ${k.active ? '' : 'opacity-50'}`}>
              <td className={`${TD} font-semibold text-ink`}>{k.name}</td>
              <td className={TD}>{k.categoryName ?? '—'}</td>
              <td className={TD}>{k.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</td>
              <td className={`${TD} num font-semibold text-ink`}>{fmtBRL(k.costCents)}</td>
              <td className={`${TD} num ${k.available ? '' : 'text-danger'}`}>{k.available}</td>
              <td className={`${TD} text-right`}><button className="font-semibold text-primary hover:underline" onClick={() => setEdit(k)}>Editar</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {edit && <KitModal d={d} k={edit} onClose={() => setEdit(null)} />}
      {cat && <CategoryModal onClose={() => setCat(false)} />}
    </section>
  );
}

function CategoryModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const save = useSave(onClose);
  return (
    <Modal open onClose={onClose} title="Nova categoria de kit" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate({ url: '/brindes/categorias', body: { name } })}>Salvar</Button></>}>
      <FormField label="Categoria" htmlFor="gc-n"><Input id="gc-n" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Executivo, Evento, Boas-vindas" /></FormField>
    </Modal>
  );
}

function Lines({ d, lines, onChange, label }: { d: Data; lines: { itemId: string; qty: number }[]; onChange: (l: { itemId: string; qty: number }[]) => void; label: string }) {
  const items = d.items.filter((i) => i.active);
  return (
    <div>
      {lines.map((l, k) => (
        <div key={k} className="mb-2 flex items-center gap-2">
          <Select aria-label={`${label} ${k + 1}`} className="flex-1" value={l.itemId} onChange={(e) => onChange(lines.map((x, j) => (j === k ? { ...x, itemId: e.target.value } : x)))}><option value="">Escolha o item</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name} · {fmtBRL(i.unitCostCents)} · estoque {i.stock}</option>)}</Select>
          <Input aria-label={`Quantidade ${k + 1}`} className="w-20" inputMode="numeric" value={String(l.qty)} onChange={(e) => onChange(lines.map((x, j) => (j === k ? { ...x, qty: Number(e.target.value.replace(/\D/g, '') || 0) } : x)))} />
          <button type="button" className="p-1 text-muted hover:text-danger" aria-label={`Tirar item ${k + 1}`} onClick={() => onChange(lines.filter((_, j) => j !== k))}><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...lines, { itemId: '', qty: 1 }])}>Adicionar item</Button>
    </div>
  );
}

function KitModal({ d, k, onClose }: { d: Data; k: Partial<Kit>; onClose: () => void }) {
  const [v, setV] = useState({ name: k.name ?? '', categoryId: k.categoryId ?? '', items: k.items?.map((i) => ({ itemId: i.itemId, qty: i.qty })) ?? [{ itemId: '', qty: 1 }], active: k.active ?? true });
  const save = useSave(onClose);
  const lines = v.items.filter((l) => l.itemId && l.qty > 0);
  const cost = lines.reduce((t, l) => t + l.qty * (d.items.find((i) => i.id === l.itemId)?.unitCostCents ?? 0), 0);
  const body = { name: v.name, categoryId: v.categoryId || null, items: lines, ...(k.id ? { active: v.active } : {}) };
  return (
    <Modal open onClose={onClose} size="lg" title={k.id ? k.name! : 'Novo kit'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={v.name.trim().length < 2 || !lines.length} loading={save.isPending} onClick={() => save.mutate(k.id ? { url: `/brindes/kits/${k.id}`, method: 'PATCH', body } : { url: '/brindes/kits', body })}>Salvar</Button></>}>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <FormField label="Kit" htmlFor="gk-n" required><Input id="gk-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Ex.: Kit boas-vindas" /></FormField>
        <FormField label="Categoria" htmlFor="gk-c"><Select id="gk-c" value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}><option value="">—</option>{d.categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FormField>
      </div>
      <p className="mb-2 text-sm font-semibold text-ink">Itens do kit</p>
      <Lines d={d} label="Item do kit" lines={v.items} onChange={(items) => setV({ ...v, items })} />
      <p className="mt-3 text-sm text-muted">Custo do kit: <b className="num text-ink">{fmtBRL(cost)}</b></p>
      {k.id && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Ativo</label>}
    </Modal>
  );
}

// ------------------------------------------------------------------ envios
function Deliveries({ d, from, to }: { d: Data; from: string; to: string }) {
  const q = useQuery({ queryKey: ['brindes', 'envios', from, to], queryFn: () => api<{ items: Delivery[] }>(`/brindes/envios${qs({ from, to })}`) });
  const [send, setSend] = useState(false);
  const [cancel, setCancel] = useState<Delivery | null>(null);
  return (
    <section className="card overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <p className="text-sm text-muted">Cada envio baixa o estoque e entra no total da conta. Cancelar devolve os itens ao estoque.</p>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!d.items.length} onClick={() => setSend(true)}>Registrar envio</Button>
      </div>
      {q.isLoading ? <LoadingRows /> : !q.data?.items.length ? <EmptyState title="Nenhum envio no período" description="Registre o kit enviado para a conta e quem recebeu." /> : (
        <table className="w-full text-left text-sm" aria-label="Envios de brindes">
          <thead className="bg-surface-2 text-xs text-muted"><tr>{['Data', 'Conta', 'Kit', 'Itens', 'Valor', 'Quem recebeu', ''].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
          <tbody>{q.data.items.map((x) => (
            <tr key={x.id} className={`border-t border-line ${x.cancelled ? 'opacity-50' : ''}`}>
              <td className={`${TD} num`}>{fmtDate(x.occurredOn)}</td>
              <td className={TD}>{x.contactId ? <Link className="font-semibold text-ink hover:underline" to={`/customers/${x.contactId}?t=brindes`}>{x.account}</Link> : <span className="text-ink">{x.campaign ?? x.eventName ?? 'Ação institucional'}</span>}<span className="block text-xs text-muted">{PURPOSES.find((p) => p[0] === x.purpose)?.[1]}{x.campaign && x.contactId ? ` · ${x.campaign}` : ''}{x.eventName && x.contactId ? ` · ${x.eventName}` : ''}</span></td>
              <td className={TD}>{x.kitName ? `${x.kits}× ${x.kitName}` : 'Itens avulsos'}{x.categoryName && <span className="block text-xs text-muted">{x.categoryName}</span>}</td>
              <td className={TD}>{x.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</td>
              <td className={`${TD} num font-semibold text-ink`}>{fmtBRL(x.totalCents)}</td>
              <td className={TD}>{x.recipients ? `${x.recipients} pessoa(s)` : '—'}</td>
              <td className={`${TD} text-right`}>{x.cancelled ? <span className="text-xs text-muted" title={x.cancelReason ?? ''}>cancelado</span> : <button className="font-semibold text-primary hover:underline" onClick={() => setCancel(x)}>Cancelar</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {send && <SendModal d={d} onClose={() => setSend(false)} />}
      {cancel && <CancelModal x={cancel} onClose={() => setCancel(null)} />}
    </section>
  );
}

function CancelModal({ x, onClose }: { x: Delivery; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const save = useSave(onClose, 'Envio cancelado; itens de volta ao estoque');
  return (
    <Modal open onClose={onClose} title={`Cancelar envio para ${x.account}`} footer={<><Button variant="ghost" onClick={onClose}>Voltar</Button><Button variant="primary" disabled={reason.trim().length < 5} loading={save.isPending} onClick={() => save.mutate({ url: `/brindes/envios/${x.id}/cancelar`, body: { reason } })}>Cancelar envio</Button></>}>
      <FormField label="Motivo" htmlFor="gx-r"><Input id="gx-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: evento adiado" /></FormField>
    </Modal>
  );
}

export function SendModal({ d, onClose, account }: { d: Data; onClose: () => void; account?: { id: string; name: string } }) {
  const [term, setTerm] = useState('');
  const [acc, setAcc] = useState(account ?? null);
  const [v, setV] = useState({ purpose: 'relacionamento', campaignId: '', opportunityId: '', eventName: '', kitId: '', kits: '1', extra: [] as { itemId: string; qty: number }[], stakeholderIds: [] as string[], occurredOn: new Date().toISOString().slice(0, 10), note: '' });
  const dest = useQuery({ queryKey: ['brindes', 'destinos', acc?.id], queryFn: () => api<{ campaigns: { id: string; name: string }[]; opportunities: { id: string; title: string }[] }>(`/brindes/destinos${qs({ contactId: acc?.id })}`) });
  const accountOptional = ['campanha', 'evento', 'institucional'].includes(v.purpose);
  const found = useQuery({ queryKey: ['contacts-search', term], enabled: !acc && term.trim().length >= 2, queryFn: () => api<{ items: { id: string; name: string }[] }>(`/contacts?q=${encodeURIComponent(term)}`) });
  const people = useQuery({ queryKey: ['stakeholders', 'account', acc?.id], enabled: !!acc, queryFn: () => api<{ items: { id: string; name: string; title: string | null }[] }>(`/accounts/${acc!.id}/stakeholders`) });
  const save = useSave(onClose, 'Envio registrado');
  const kit = d.kits.find((k) => k.id === v.kitId);
  const kits = Number(v.kits || 0);
  const extra = v.extra.filter((l) => l.itemId && l.qty > 0);
  const total = (kit ? kit.costCents * kits : 0) + extra.reduce((t, l) => t + l.qty * (d.items.find((i) => i.id === l.itemId)?.unitCostCents ?? 0), 0);
  const ok = (acc || accountOptional) && ((kit && kits > 0) || extra.length) && (v.purpose !== 'campanha' || v.campaignId) && (v.purpose !== 'oportunidade' || v.opportunityId) && (v.purpose !== 'evento' || v.eventName.trim());
  return (
    <Modal open onClose={onClose} size="lg" title="Registrar envio de brindes" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ok} loading={save.isPending} onClick={() => save.mutate({ url: '/brindes/envios', body: { contactId: acc?.id ?? null, purpose: v.purpose, campaignId: v.campaignId || null, opportunityId: v.opportunityId || null, eventName: v.eventName || null, kitId: v.kitId || null, kits: kit ? kits : 0, extra, stakeholderIds: v.stakeholderIds, occurredOn: v.occurredOn, note: v.note || null } })}>Registrar envio</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Destinação" htmlFor="gs-p"><Select id="gs-p" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })}>{PURPOSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField>
        {v.purpose === 'campanha' || v.campaignId ? <FormField label="Campanha" htmlFor="gs-c" required={v.purpose === 'campanha'}><Select id="gs-c" value={v.campaignId} onChange={(e) => setV({ ...v, campaignId: e.target.value })}><option value="">Escolha</option>{dest.data?.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FormField>
          : v.purpose === 'evento' ? <FormField label="Evento" htmlFor="gs-e" required><Input id="gs-e" value={v.eventName} onChange={(e) => setV({ ...v, eventName: e.target.value })} /></FormField>
          : v.purpose === 'oportunidade' ? <FormField label="Oportunidade" htmlFor="gs-o" required><Select id="gs-o" value={v.opportunityId} onChange={(e) => setV({ ...v, opportunityId: e.target.value })}><option value="">{acc ? 'Escolha' : 'Escolha a conta primeiro'}</option>{dest.data?.opportunities.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</Select></FormField> : <div />}
        <FormField label={accountOptional ? 'Conta (opcional)' : 'Conta'} htmlFor="gs-a" required={!accountOptional} className="sm:col-span-2">
          {acc ? <div className="flex items-center gap-3"><b className="text-ink">{acc.name}</b>{!account && <button className="text-sm font-semibold text-primary hover:underline" onClick={() => { setAcc(null); setV({ ...v, stakeholderIds: [] }); }}>Trocar</button>}</div> : (
            <div>
              <Input id="gs-a" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Digite o nome da conta" />
              {!!found.data?.items.length && <ul className="mt-1 max-h-48 overflow-auto border border-line">{found.data.items.slice(0, 8).map((c) => <li key={c.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => setAcc({ id: c.id, name: c.name })}>{c.name}</button></li>)}</ul>}
            </div>
          )}
        </FormField>
        <FormField label="Kit" htmlFor="gs-k"><Select id="gs-k" value={v.kitId} onChange={(e) => setV({ ...v, kitId: e.target.value })}><option value="">Sem kit (só itens avulsos)</option>{d.kits.filter((k) => k.active).map((k) => <option key={k.id} value={k.id}>{k.name} · {fmtBRL(k.costCents)} · dá para {k.available}</option>)}</Select></FormField>
        {kit && <FormField label="Quantos kits" htmlFor="gs-q"><Input id="gs-q" inputMode="numeric" value={v.kits} onChange={(e) => setV({ ...v, kits: e.target.value.replace(/\D/g, '') })} /></FormField>}
        <div className="sm:col-span-2"><p className="mb-2 text-sm font-semibold text-ink">Itens avulsos <span className="font-normal text-muted">(opcional)</span></p><Lines d={d} label="Item avulso" lines={v.extra} onChange={(x) => setV({ ...v, extra: x })} /></div>
        {acc && (
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-semibold text-ink">Quem recebeu</legend>
            {!people.data?.items.length ? <p className="text-sm text-muted">A conta não tem stakeholders cadastrados. O envio fica só no total da conta.</p> : (
              <div className="grid gap-1 sm:grid-cols-2">{people.data.items.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={v.stakeholderIds.includes(p.id)} onChange={(e) => setV({ ...v, stakeholderIds: e.target.checked ? [...v.stakeholderIds, p.id] : v.stakeholderIds.filter((x) => x !== p.id) })} />{p.name}{p.title && <span className="text-muted">· {p.title}</span>}</label>
              ))}</div>
            )}
          </fieldset>
        )}
        <FormField label="Data do envio" htmlFor="gs-d"><Input id="gs-d" type="date" value={v.occurredOn} onChange={(e) => setV({ ...v, occurredOn: e.target.value })} /></FormField>
        <FormField label="Observação" htmlFor="gs-n"><Input id="gs-n" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Ex.: visita técnica, evento" /></FormField>
      </div>
      <p className="mt-3 text-sm text-muted">Valor do envio: <b className="num text-ink">{fmtBRL(total)}</b></p>
    </Modal>
  );
}

// ------------------------------------------------------------------ consumo e fornecedores
function RowTable({ title, rows, qtyLabel }: { title: string; rows: Row[]; qtyLabel: string }) {
  return (
    <section className="card overflow-x-auto p-5">
      <h3 className="mb-2 font-bold text-ink">{title}</h3>
      {!rows.length ? <p className="text-sm text-muted">Nada no período.</p> : (
        <table className="w-full text-left text-sm"><thead className="text-xs text-muted"><tr><th className="py-1.5 font-medium" /><th className="py-1.5 text-right font-medium">{qtyLabel}</th><th className="py-1.5 text-right font-medium">Valor</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.key} className="border-t border-line"><td className="py-1.5">{r.name}</td><td className="num py-1.5 text-right">{r.qty}</td><td className="num py-1.5 text-right font-semibold">{fmtBRL(r.totalCents)}</td></tr>)}</tbody></table>
      )}
    </section>
  );
}

function Consumption({ from, to }: { from: string; to: string }) {
  const q = useQuery({ queryKey: ['brindes', 'consumo', from, to], queryFn: () => api<Consumo>(`/brindes/consumo${qs({ from, to })}`) });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;
  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Gasto com brindes', fmtBRL(c.totalCents)], ['Kits enviados', String(c.kits)], ['Envios', String(c.deliveries)], ['Contas', String(c.accounts)]].map(([l, v]) => <li key={l} className="card p-4"><p className="text-sm text-muted">{l}</p><p className="num mt-1 text-xl font-bold text-ink">{v}</p></li>)}
      </ul>
      {(c.byPurpose?.length || c.byCampaign?.length) ? (
        <section className="card grid gap-5 p-5 md:grid-cols-2" aria-label="Investimento em relacionamento">
          <div><h3 className="mb-2 font-bold text-ink">Investimento por ação</h3><ul className="divide-y divide-line text-sm">{c.byPurpose?.map((x) => <li key={x.key} className="flex justify-between py-1.5"><span>{x.label} <span className="text-muted">({x.deliveries})</span></span><b className="num">{fmtBRL(x.totalCents)}</b></li>)}</ul></div>
          <div><h3 className="mb-2 font-bold text-ink">Investimento por campanha</h3>{c.byCampaign?.length ? <ul className="divide-y divide-line text-sm">{c.byCampaign.map((x) => <li key={x.campaignId} className="flex justify-between py-1.5"><span>{x.name} <span className="text-muted">({x.deliveries})</span></span><b className="num">{fmtBRL(x.totalCents)}</b></li>)}</ul> : <p className="text-sm text-muted">Nenhum envio ligado a campanha.</p>}</div>
          <p className="text-xs text-muted md:col-span-2">Valores pelo custo do estoque já comprado: distribuir não é despesa nova. A despesa da compra está no orçamento.</p>
        </section>
      ) : null}
      <section className="card overflow-x-auto p-5">
        <h3 className="mb-2 font-bold text-ink">Por conta</h3>
        {!c.byAccount.length ? <p className="text-sm text-muted">Nada no período.</p> : (
          <table className="w-full text-left text-sm" aria-label="Gasto com brindes por conta"><thead className="text-xs text-muted"><tr><th className="py-1.5 font-medium">Conta</th><th className="py-1.5 text-right font-medium">Envios</th><th className="py-1.5 text-right font-medium">Kits</th><th className="py-1.5 text-right font-medium">Valor</th></tr></thead>
            <tbody>{c.byAccount.map((a) => <tr key={a.contactId} className="border-t border-line"><td className="py-1.5"><Link className="font-semibold text-ink hover:underline" to={`/customers/${a.contactId}?t=brindes`}>{a.name}</Link></td><td className="num py-1.5 text-right">{a.deliveries}</td><td className="num py-1.5 text-right">{a.kits}</td><td className="num py-1.5 text-right font-semibold">{fmtBRL(a.totalCents)}</td></tr>)}</tbody></table>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <RowTable title="Por kit" rows={c.byKit} qtyLabel="Kits" />
        <RowTable title="Por categoria" rows={c.byCategory} qtyLabel="Kits" />
        <RowTable title="Por item" rows={c.byItem} qtyLabel="Unidades" />
      </div>
      <section className="card overflow-x-auto p-5">
        <h3 className="mb-2 font-bold text-ink">Compras por fornecedor no período</h3>
        {!c.purchases.length ? <p className="text-sm text-muted">Nenhuma entrada no período.</p> : (
          <table className="w-full text-left text-sm"><thead className="text-xs text-muted"><tr><th className="py-1.5 font-medium">Fornecedor</th><th className="py-1.5 text-right font-medium">Unidades</th><th className="py-1.5 text-right font-medium">Valor</th></tr></thead>
            <tbody>{c.purchases.map((p) => <tr key={p.supplierId ?? 'sem'} className="border-t border-line"><td className="py-1.5">{p.name}</td><td className="num py-1.5 text-right">{p.qty}</td><td className="num py-1.5 text-right font-semibold">{fmtBRL(p.totalCents)}</td></tr>)}</tbody></table>
        )}
      </section>
    </div>
  );
}

function Suppliers({ d }: { d: Data }) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState({ name: '', phone: '', email: '' });
  const save = useSave(() => { setAdding(false); setV({ name: '', phone: '', email: '' }); });
  const rows = d.suppliers.filter((x) => x.purchasedQty || x.items.length);
  return (
    <section className="card overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <p className="text-sm text-muted">Fornecedores de brindes (mesmo cadastro de Recursos e Orçamento).</p>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Novo fornecedor</Button>
      </div>
      {!rows.length ? <EmptyState title="Nenhum fornecedor de brindes" description="Escolha o fornecedor no item ou na entrada de estoque." /> : (
        <table className="w-full text-left text-sm" aria-label="Fornecedores de brindes">
          <thead className="bg-surface-2 text-xs text-muted"><tr>{['Fornecedor', 'Contato', 'Itens', 'Unidades compradas', 'Total comprado', 'Última compra'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.id} className="border-t border-line">
              <td className={`${TD} font-semibold text-ink`}>{x.name}</td>
              <td className={TD}>{[x.phone, x.email].filter(Boolean).join(' · ') || '—'}</td>
              <td className={TD}>{x.items.join(', ') || '—'}</td>
              <td className={`${TD} num`}>{x.purchasedQty}</td>
              <td className={`${TD} num font-semibold`}>{fmtBRL(x.purchasedCents)}</td>
              <td className={`${TD} num`}>{x.lastPurchaseAt ? fmtDate(x.lastPurchaseAt) : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Novo fornecedor" footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancelar</Button><Button variant="primary" disabled={v.name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate({ url: '/brindes/fornecedores', body: { name: v.name, phone: v.phone || null, email: v.email || null } })}>Salvar</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Nome" htmlFor="gf-n" required className="sm:col-span-2"><Input id="gf-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></FormField>
          <FormField label="Telefone" htmlFor="gf-p"><Input id="gf-p" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></FormField>
          <FormField label="E-mail" htmlFor="gf-e"><Input id="gf-e" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></FormField>
        </div>
      </Modal>
    </section>
  );
}

export type { Data as GiftsData };
