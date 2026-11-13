/**
 * Brindes → Planejamento e orçamento: cada brinde planejado é um lançamento do orçamento (um controle só).
 * O planejado entra no orçamento; a restrição da aprovação aparece aqui; a compra registra a economia ou pede
 * nova autorização; o recebimento entra no estoque sem gerar outra despesa.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { APPROVAL_STATE_LABELS, EXECUTION_STATE_LABELS, type ApprovalState, type ExecutionState } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { AccountSelect, errMsg, useStructure } from './shared';

type Plan = {
  lineId: string; code: string; itemName: string; month: string; costCenter: { id: string; code: string } | null; destination: string | null; approvalState: ApprovalState; executionState: ExecutionState;
  plannedQty: string; unitCents: number | null; approvedQty: string | null; purchasedQty: string | null; contractedUnitCents: number | null; receivedQty: number; stock: number; distributedQtyYear: number;
  figures: { planned: number; approved: number; committed: number; realized: number; economy: number }; restricted: boolean; limitCents: number | null;
};
const toCents = (v: string) => { const n = Number(String(v).replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && v !== '' ? Math.round(n * 100) : 0; };
const TH = 'px-3 py-2.5 font-medium';
const TD = 'px-3 py-2.5';

export function GiftPlanning({ items, suppliers }: { items: { id: string; name: string; unitCostCents: number; active: boolean }[]; suppliers: { id: string; name: string }[] }) {
  const year = new Date().getFullYear();
  const q = useQuery({ queryKey: ['brindes', 'planos', year], queryFn: () => api<{ plans: Plan[] }>(`/brindes/planos${qs({ year })}`) });
  const [creating, setCreating] = useState(false);
  const [buy, setBuy] = useState<Plan | null>(null);
  const [receive, setReceive] = useState<Plan | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const submit = useMutation({ mutationFn: (id: string) => api(`/budget/lines/${id}/submit`, { method: 'POST', body: {} }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['brindes'] }); toast({ tone: 'success', message: 'Enviado para aprovação' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const plans = q.data!.plans;
  return (
    <section className="card overflow-x-auto" aria-label="Planejamento de brindes">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <p className="max-w-3xl text-sm text-muted">Cada brinde planejado vira um lançamento do orçamento do centro de custo. O que a Diretoria aprovar (ou cortar) aparece aqui; a compra e o recebimento usam o mesmo lançamento, sem despesa duplicada. Detalhes completos na <Link className="font-semibold text-primary hover:underline" to="/orcamento?t=central">Central do orçamento</Link>.</p>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!items.length} onClick={() => setCreating(true)}>Planejar brinde</Button>
      </div>
      {!plans.length ? <EmptyState title={`Nenhum brinde planejado em ${year}`} description="Planeje a quantidade e o custo previsto: o valor entra no orçamento para aprovação." /> : (
        <table className="w-full min-w-[1000px] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted"><tr>{['Brinde', 'Centro', 'Planejado', 'Aprovado', 'Comprado', 'Recebido', 'Estoque', 'Distribuído no ano', 'Situação', ''].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
          <tbody>{plans.map((p) => (
            <tr key={p.lineId} className="border-t border-line align-top">
              <td className={TD}><span className="text-xs text-muted">{p.code}</span><span className="block font-semibold text-ink">{p.itemName}</span>{p.destination && <span className="block text-xs text-muted">{p.destination}</span>}</td>
              <td className={TD}>{p.costCenter?.code}<span className="block text-xs text-muted">{p.month}</span></td>
              <td className={`${TD} num`}>{p.plannedQty} × {fmtBRL(p.unitCents ?? 0)}<span className="block font-semibold text-ink">{fmtBRL(p.figures.planned)}</span></td>
              <td className={`${TD} num`}>{p.figures.approved ? <><span className={p.restricted ? 'font-semibold text-[#C2610C]' : 'font-semibold text-ink'}>{fmtBRL(p.figures.approved)}</span>{p.approvedQty && <span className="block text-xs text-muted">{p.approvedQty} un.</span>}{p.restricted && <span className="block text-xs text-[#C2610C]">Aprovado abaixo do pedido</span>}</> : '—'}</td>
              <td className={`${TD} num`}>{p.purchasedQty ? <>{p.purchasedQty} × {fmtBRL(p.contractedUnitCents ?? 0)}<span className="block font-semibold text-ink">{fmtBRL(p.figures.committed)}</span>{p.figures.economy > 0 && <span className="block text-xs text-[#15803D]">Economia {fmtBRL(p.figures.economy)}</span>}</> : '—'}</td>
              <td className={`${TD} num`}>{p.receivedQty || '—'}</td>
              <td className={`${TD} num`}>{p.stock}</td>
              <td className={`${TD} num`}>{p.distributedQtyYear}</td>
              <td className={TD}><Chip tone={p.approvalState === 'rejeitado' ? 'red' : p.approvalState.startsWith('aprovado') ? 'green' : 'neutral'}>{APPROVAL_STATE_LABELS[p.approvalState]}</Chip><span className="mt-1 block text-xs text-muted">{EXECUTION_STATE_LABELS[p.executionState]}</span></td>
              <td className={`${TD} whitespace-nowrap text-right`}>
                {(p.approvalState === 'planejado' || p.approvalState === 'em_revisao' || p.approvalState === 'rejeitado') && <Button size="sm" variant="outline" loading={submit.isPending} onClick={() => submit.mutate(p.lineId)}>Enviar para aprovação</Button>}
                {p.approvalState.startsWith('aprovado') && !p.purchasedQty && <Button size="sm" variant="outline" onClick={() => setBuy(p)}>Registrar compra</Button>}
                {p.purchasedQty && p.receivedQty < Number(p.purchasedQty) && <Button size="sm" variant="outline" onClick={() => setReceive(p)}>Receber no estoque</Button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {creating && <NewPlan items={items} onClose={() => setCreating(false)} />}
      {buy && <BuyModal p={buy} suppliers={suppliers} onClose={() => setBuy(null)} />}
      {receive && <ReceiveModal p={receive} onClose={() => setReceive(null)} />}
    </section>
  );
}

function useAct(onDone: () => void, msg: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({ mutationFn: ({ url, body }: { url: string; body: unknown }) => api(url, { method: 'POST', body }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['brindes'] }); void qc.invalidateQueries({ queryKey: ['budget'] }); toast({ tone: 'success', message: msg }); onDone(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
}

function NewPlan({ items, onClose }: { items: { id: string; name: string; unitCostCents: number; active: boolean }[]; onClose: () => void }) {
  const st = useStructure();
  const dest = useQuery({ queryKey: ['brindes', 'destinos'], queryFn: () => api<{ campaigns: { id: string; name: string }[] }>('/brindes/destinos') });
  const ccs = st.data?.costCenters.filter((c) => c.active && (st.data!.admin || c.myRole === 'dono')) ?? [];
  const giftAcc = st.data?.accounts.find((a) => a.code === '3.1.03' && a.leaf)?.id ?? '';
  const m = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [v, setV] = useState({ itemId: '', costCenterId: '', accountId: '', qty: '', unit: '', month: m, campaignId: '', destination: '', justification: '' });
  const act = useAct(onClose, 'Brinde planejado: o valor já está no orçamento');
  const item = items.find((i) => i.id === v.itemId);
  const cc = v.costCenterId || ccs[0]?.id || '';
  const acc = v.accountId || giftAcc;
  const total = (Number(v.qty) || 0) * toCents(v.unit || '');
  return (
    <Modal open onClose={onClose} size="lg" title="Planejar brinde" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={act.isPending} disabled={!v.itemId || !cc || !acc || !Number(v.qty) || !toCents(v.unit)} onClick={() => act.mutate({ url: '/brindes/planos', body: { itemId: v.itemId, costCenterId: cc, accountId: acc, qty: Number(v.qty), unitCostCents: toCents(v.unit), month: v.month, campaignId: v.campaignId || null, destination: v.destination || null, justification: v.justification || null } })}>Planejar</Button></>}>
      {st.isLoading ? <LoadingRows rows={3} /> : !ccs.length ? <Notice tone="warning">Você não é Dono do orçamento de nenhum centro de custo. Quem planeja é o dono do centro (Recursos e Orçamento).</Notice> : (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Brinde" htmlFor="gp-i" required><Select id="gp-i" value={v.itemId} onChange={(e) => { const it = items.find((x) => x.id === e.target.value); setV({ ...v, itemId: e.target.value, unit: it ? (it.unitCostCents / 100).toFixed(2).replace('.', ',') : v.unit }); }}><option value="">Escolha</option>{items.filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></FormField>
          <FormField label="Centro de custos" htmlFor="gp-c" required><Select id="gp-c" value={cc} onChange={(e) => setV({ ...v, costCenterId: e.target.value })}>{ccs.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select></FormField>
          <FormField label="Conta do orçamento" htmlFor="gp-a" required><AccountSelect id="gp-a" value={acc} onChange={(x) => setV({ ...v, accountId: x })} accounts={st.data!.accounts} /></FormField>
          <FormField label="Competência" htmlFor="gp-m"><Input id="gp-m" type="month" value={v.month} onChange={(e) => setV({ ...v, month: e.target.value })} /></FormField>
          <FormField label="Quantidade planejada" htmlFor="gp-q" required><Input id="gp-q" inputMode="numeric" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value.replace(/\D/g, '') })} /></FormField>
          <FormField label="Custo unitário previsto (R$)" htmlFor="gp-u" required hint={item ? `Custo médio atual: ${fmtBRL(item.unitCostCents)}` : undefined}><Input id="gp-u" inputMode="decimal" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} /></FormField>
          <FormField label="Campanha" htmlFor="gp-cp"><Select id="gp-cp" value={v.campaignId} onChange={(e) => setV({ ...v, campaignId: e.target.value })}><option value="">Nenhuma</option>{dest.data?.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FormField>
          <FormField label="Destinação" htmlFor="gp-d"><Input id="gp-d" value={v.destination} onChange={(e) => setV({ ...v, destination: e.target.value })} placeholder="Ex.: contas ABM do evento de fim de ano" /></FormField>
          <FormField label="Justificativa" htmlFor="gp-j" className="sm:col-span-2"><Textarea id="gp-j" rows={2} value={v.justification} onChange={(e) => setV({ ...v, justification: e.target.value })} /></FormField>
          <p className="text-sm text-muted sm:col-span-2">Total previsto: <b className="num text-ink">{fmtBRL(total)}</b> — entra no orçamento como lançamento planejado.</p>
        </div>
      )}
    </Modal>
  );
}

function BuyModal({ p, suppliers, onClose }: { p: Plan; suppliers: { id: string; name: string }[]; onClose: () => void }) {
  const [v, setV] = useState({ qty: p.approvedQty ?? p.plannedQty, unit: '', supplierId: '', poNumber: '' });
  const act = useAct(onClose, 'Compra registrada');
  const total = (Number(v.qty) || 0) * toCents(v.unit || '');
  const ceiling = p.limitCents ?? p.figures.approved;
  return (
    <Modal open onClose={onClose} title={`Registrar compra · ${p.itemName}`} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={act.isPending} disabled={!Number(v.qty) || !toCents(v.unit)} onClick={() => act.mutate({ url: `/brindes/planos/${p.lineId}/compra`, body: { qty: Number(v.qty), unitCostCents: toCents(v.unit), supplierId: v.supplierId || null, poNumber: v.poNumber || null } })}>Registrar compra</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Quantidade comprada" htmlFor="gb-q"><Input id="gb-q" inputMode="numeric" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value.replace(/\D/g, '') })} /></FormField>
        <FormField label="Preço por unidade (R$)" htmlFor="gb-u"><Input id="gb-u" inputMode="decimal" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} /></FormField>
        <FormField label="Fornecedor" htmlFor="gb-s"><Select id="gb-s" value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })}><option value="">O do item</option>{suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
        <FormField label="Pedido de compra" htmlFor="gb-p"><Input id="gb-p" value={v.poNumber} onChange={(e) => setV({ ...v, poNumber: e.target.value })} /></FormField>
      </div>
      <p className="mt-3 text-sm text-muted">Total <b className="num text-ink">{fmtBRL(total)}</b> · autorizado <b className="num text-ink">{fmtBRL(ceiling)}</b>{total > ceiling ? <span className="block text-danger">Passa do autorizado: peça nova autorização pelo Budget Guardião na Central do orçamento.</span> : total ? <span className="block text-[#15803D]">Economia de {fmtBRL(ceiling - total)} sobre o autorizado.</span> : null}</p>
    </Modal>
  );
}

function ReceiveModal({ p, onClose }: { p: Plan; onClose: () => void }) {
  const left = Number(p.purchasedQty) - p.receivedQty;
  const [qty, setQty] = useState(String(left));
  const act = useAct(onClose, 'Recebido no estoque');
  return (
    <Modal open onClose={onClose} size="sm" title={`Receber · ${p.itemName}`} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={act.isPending} disabled={!Number(qty) || Number(qty) > left} onClick={() => act.mutate({ url: `/brindes/planos/${p.lineId}/recebimento`, body: { qty: Number(qty) } })}>Receber</Button></>}>
      <FormField label={`Quantidade recebida (faltam ${left})`} htmlFor="gr-q"><Input id="gr-q" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} /></FormField>
      <p className="mt-2 text-sm text-muted">Entra no estoque pelo preço da compra. Não gera despesa nova: a despesa é a do lançamento no orçamento.</p>
    </Modal>
  );
}
