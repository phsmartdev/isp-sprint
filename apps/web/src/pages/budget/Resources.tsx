/** Recursos do comercial: ferramentas e equipamentos, softwares e licenças, contratos e assinaturas, compras e fornecedores. */
import { MASK, moneyHidden } from '../../lib/privacy';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, ShieldCheck } from 'lucide-react';
import {
  ASSET_CATEGORIES, ASSET_CATEGORY_LABELS, ASSET_STATUS, ASSET_STATUS_LABELS, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, PURCHASE_KINDS, PURCHASE_KIND_LABELS, PURCHASE_STATUS_LABELS,
  RESOURCE_KIND_LABELS, RESOURCE_PERIODS, RESOURCE_PERIOD_LABELS, type AssetStatus, type PurchaseStatus, type ResourceKind,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { Button, EmptyState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { AccountSelect, BudgetShell, CcSelect, Stat, errMsg, useStructure, type Structure } from '../../features/budget/shared';

const toCents = (v: string) => Math.round(Number(String(v).replace(/\./g, '').replace(',', '.')) * 100) || 0;
const money = (c: number | null | undefined) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
const Tag = ({ className, children }: { className: string; children: React.ReactNode }) => <span className={clsx('inline-flex whitespace-nowrap px-2 py-0.5 text-xs font-semibold', className)}>{children}</span>;
const ccName = (st: Structure, id: string) => { const c = st.costCenters.find((x) => x.id === id); return c ? `${c.code} · ${c.name}` : '—'; };

function useSave(onDone: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (x: { url: string; method: 'POST' | 'PATCH'; body: unknown }) => api(x.url, { method: x.method, body: x.body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['budget'] }); toast({ tone: 'success', message: 'Salvo' }); onDone(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
}

// ================================================================== ferramentas e equipamentos
type Asset = { id: string; costCenterId: string; accountId: string | null; name: string; tag: string | null; serial: string | null; category: string; holderId: string | null; holderName: string | null; supplierId: string | null; acquiredOn: string; valueCents: number; usefulLifeMonths: number | null; status: AssetStatus; notes: string | null; bookValueCents: number };

function AssetModal({ st, a, onClose }: { st: Structure; a: Partial<Asset>; onClose: () => void }) {
  const [v, setV] = useState({ costCenterId: a.costCenterId ?? '', accountId: a.accountId ?? '', name: a.name ?? '', tag: a.tag ?? '', serial: a.serial ?? '', category: a.category ?? 'outro', holderId: a.holderId ?? '', acquiredOn: a.acquiredOn ?? '', value: money(a.valueCents), life: String(a.usefulLifeMonths ?? ''), status: a.status ?? 'em_uso', notes: a.notes ?? '' });
  const save = useSave(onClose);
  const body = { costCenterId: v.costCenterId, accountId: v.accountId || null, name: v.name, tag: v.tag || null, serial: v.serial || null, category: v.category, holderId: v.holderId || null, acquiredOn: v.acquiredOn, valueCents: toCents(v.value), usefulLifeMonths: v.life ? Number(v.life) : null, status: v.status, notes: v.notes || null };
  return (
    <Modal open onClose={onClose} title={a.id ? a.name! : 'Novo equipamento'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!v.costCenterId || v.name.trim().length < 2 || !v.acquiredOn} loading={save.isPending} onClick={() => save.mutate(a.id ? { url: `/budget/assets/${a.id}`, method: 'PATCH', body } : { url: '/budget/assets', method: 'POST', body })}>Salvar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Nome" htmlFor="as-n" required className="sm:col-span-2"><Input id="as-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Ex.: Notebook 14” do consultor" /></FormField>
        <FormField label="Categoria" htmlFor="as-c"><Select id="as-c" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{ASSET_CATEGORIES.map((x) => <option key={x} value={x}>{ASSET_CATEGORY_LABELS[x]}</option>)}</Select></FormField>
        <FormField label="Situação" htmlFor="as-s"><Select id="as-s" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as AssetStatus })}>{ASSET_STATUS.map((x) => <option key={x} value={x}>{ASSET_STATUS_LABELS[x]}</option>)}</Select></FormField>
        <FormField label="Centro de custo" htmlFor="as-cc" required><CcSelect className="w-full" value={v.costCenterId} onChange={(x) => setV({ ...v, costCenterId: x })} list={st.costCenters} all={false} /></FormField>
        <FormField label="Com quem está" htmlFor="as-h"><Select id="as-h" value={v.holderId} onChange={(e) => setV({ ...v, holderId: e.target.value })}><option value="">Ninguém (estoque)</option>{st.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Patrimônio" htmlFor="as-t"><Input id="as-t" value={v.tag} onChange={(e) => setV({ ...v, tag: e.target.value })} /></FormField>
        <FormField label="Número de série" htmlFor="as-sr"><Input id="as-sr" value={v.serial} onChange={(e) => setV({ ...v, serial: e.target.value })} /></FormField>
        <FormField label="Data da compra" htmlFor="as-d" required><Input id="as-d" type="date" value={v.acquiredOn} onChange={(e) => setV({ ...v, acquiredOn: e.target.value })} /></FormField>
        <FormField label="Valor de compra (R$)" htmlFor="as-v"><Input id="as-v" inputMode="decimal" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></FormField>
        <FormField label="Vida útil (meses)" htmlFor="as-l"><Input id="as-l" inputMode="numeric" value={v.life} onChange={(e) => setV({ ...v, life: e.target.value.replace(/\D/g, '') })} /></FormField>
        <FormField label="Conta (subcategoria)" htmlFor="as-a"><AccountSelect id="as-a" value={v.accountId} onChange={(x) => setV({ ...v, accountId: x })} accounts={st.accounts} /></FormField>
        <FormField label="Observações" htmlFor="as-o" className="sm:col-span-2"><Textarea id="as-o" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

// ================================================================== recursos numa tela só (ferramentas, softwares, contratos e assinaturas)
type ItemType = 'equipamento' | 'software' | 'contrato' | 'assinatura';
const ITEM_TYPE_LABELS: Record<ItemType, string> = { equipamento: 'Ferramenta ou equipamento', software: 'Software ou licença', contrato: 'Contrato de serviço', assinatura: 'Assinatura' };
const TYPE_FILTERS = [['', 'Todos os tipos'], ['equipamento', 'Ferramentas e equipamentos'], ['software', 'Softwares e licenças'], ['contratos', 'Contratos e assinaturas']] as const;

/** Ferramentas, softwares, contratos e assinaturas numa tabela: o tipo é escolhido no lançamento e filtrado na própria tabela. */
export function BudgetToolsPage() {
  const st = useStructure();
  const [f, setF] = useUrlState({ cc: '', tipo: '', s: 'ativo' });
  const assets = useQuery({ queryKey: ['budget', 'assets', f.cc], queryFn: () => api<{ items: Asset[] }>(`/budget/assets${qs({ costCenterId: f.cc || undefined })}`) });
  const soft = useQuery({ queryKey: ['budget', 'resources', 'software', f.cc], queryFn: () => api<{ items: Resource[] }>(`/budget/resources${qs({ kind: 'software', costCenterId: f.cc || undefined })}`) });
  const ctr = useQuery({ queryKey: ['budget', 'resources', 'contratos', f.cc], queryFn: () => api<{ items: Resource[] }>(`/budget/resources${qs({ kind: 'contratos', costCenterId: f.cc || undefined })}`) });
  const [editA, setEditA] = useState<Partial<Asset> | null>(null);
  const [editR, setEditR] = useState<Partial<Resource> | null>(null);
  const [picking, setPicking] = useState(false);
  type Row = { id: string; type: ItemType; name: string; detail: string; cc: string; monthly: number | null; value: string; when: string; whenSub: string | null; soon: boolean; active: boolean; statusLabel: string; pending: string[]; open: () => void };
  const rows: Row[] = [
    ...(assets.data?.items ?? []).map((a): Row => ({ id: a.id, type: 'equipamento', name: a.name, detail: `${ASSET_CATEGORY_LABELS[a.category as keyof typeof ASSET_CATEGORY_LABELS] ?? ''}${a.holderName ? ` · com ${a.holderName}` : ''}${a.tag ? ` · patrimônio ${a.tag}` : ''}`, cc: a.costCenterId, monthly: null, value: fmtBRL(a.valueCents), when: fmtDate(a.acquiredOn), whenSub: 'compra', soon: false, active: a.status !== 'baixado', statusLabel: ASSET_STATUS_LABELS[a.status], pending: [], open: () => setEditA(a) })),
    ...[...(soft.data?.items ?? []), ...(ctr.data?.items ?? [])].map((r): Row => ({ id: r.id, type: r.kind as ItemType, name: r.name, detail: `${r.kind === 'software' ? `${r.seats ? `${r.seats} usuário(s) · ` : ''}${r.vaultRegistered ? 'no Vault' : 'fora do Vault'}` : ''}${r.supplierName ? `${r.kind === 'software' ? ' · ' : ''}${r.supplierName}` : ''}`, cc: r.costCenterId, monthly: r.monthlyBrlCents, value: moneyHidden() ? MASK : `${r.currency === 'USD' ? 'US$ ' : 'R$ '}${(r.amountCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · ${RESOURCE_PERIOD_LABELS[r.period as keyof typeof RESOURCE_PERIOD_LABELS]?.toLowerCase() ?? ''}`, when: fmtDate(r.startOn), whenSub: r.renewalOn ? `renova ${fmtDate(r.renewalOn)}` : null, soon: r.renewsSoon, active: r.status === 'ativo', statusLabel: r.status === 'ativo' ? 'Ativo' : r.status === 'suspenso' ? 'Suspenso' : 'Cancelado', pending: r.pending, open: () => setEditR(r) })),
  ];
  const byType = rows.filter((r) => !f.tipo || (f.tipo === 'contratos' ? r.type === 'contrato' || r.type === 'assinatura' : r.type === f.tipo));
  const items = byType.filter((r) => f.s === '' || (f.s === 'ativo' ? r.active : !r.active)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const live = byType.filter((r) => r.active);
  const loading = assets.isLoading || soft.isLoading || ctr.isLoading || !st.data;
  const start = (t: ItemType) => {
    setPicking(false);
    const cc = f.cc || st.data?.costCenters[0]?.id;
    if (t === 'equipamento') setEditA({ status: 'em_uso', category: 'notebook', acquiredOn: new Date().toISOString().slice(0, 10), usefulLifeMonths: 36, costCenterId: cc });
    else setEditR({ kind: t, currency: 'BRL', period: 'mensal', startOn: new Date().toISOString().slice(0, 10), costCenterId: cc, status: 'ativo' });
  };
  return (
    <BudgetShell subtitle="Ferramentas, equipamentos, softwares, contratos e assinaturas do comercial: custo, responsável, renovação e pendências."
      actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!st.data?.costCenters.length} onClick={() => setPicking(true)}>Novo item</Button>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Tipo" className="h-10 w-auto" value={f.tipo} onChange={(e) => setF({ tipo: e.target.value })}>{TYPE_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        {st.data && <CcSelect value={f.cc} onChange={(cc) => setF({ cc })} list={st.data.costCenters} />}
        <Select aria-label="Situação" className="h-10 w-auto" value={f.s} onChange={(e) => setF({ s: e.target.value })}><option value="ativo">Em uso / ativos</option><option value="inativo">Baixados, suspensos e cancelados</option><option value="">Todos</option></Select>
        <p className="ml-auto text-xs text-muted" aria-label="Resumo dos recursos">
          <b className="text-ink">{live.length}</b> ativos · custo recorrente <b className="text-ink">{fmtBRL(live.reduce((t, r) => t + (r.monthly ?? 0), 0))}</b>/mês · <b className={live.some((r) => r.soon) ? 'text-[#C2610C]' : 'text-ink'}>{live.filter((r) => r.soon).length}</b> renovam em 45 dias · <b className={live.some((r) => r.pending.length) ? 'text-danger' : 'text-ink'}>{live.filter((r) => r.pending.length).length}</b> com pendência
        </p>
      </div>
      <section className="card overflow-x-auto p-0" aria-label="Ferramentas, softwares e contratos">
        {loading ? <LoadingRows /> : !items.length ? <EmptyState title="Nada por aqui" description="Cadastre ferramentas, softwares, contratos e assinaturas para acompanhar custo e renovação e trazer o recorrente para o planejamento." /> : (
          <table className="w-full min-w-[980px] text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted"><th className="px-4 py-2.5 font-semibold">Item</th><th className="px-3 py-2.5 font-semibold">Tipo</th><th className="px-3 py-2.5 font-semibold">Centro de custo</th><th className="px-3 py-2.5 text-right font-semibold">Valor</th><th className="px-3 py-2.5 text-right font-semibold">Por mês (R$)</th><th className="px-3 py-2.5 font-semibold">Início · renovação</th><th className="px-4 py-2.5 font-semibold">Situação</th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className={clsx('cursor-pointer border-b border-line last:border-0 hover:bg-surface-2', !r.active && 'opacity-60')} onClick={r.open}>
                  <td className="px-4 py-2.5"><button type="button" className="text-left font-semibold text-ink hover:text-primary">{r.name}</button>{r.detail && <span className="block text-xs text-muted">{r.detail}</span>}</td>
                  <td className="px-3 py-2.5 text-text">{ITEM_TYPE_LABELS[r.type]}</td>
                  <td className="px-3 py-2.5 text-text">{ccName(st.data!, r.cc)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.value}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.monthly == null ? <span className="text-muted">—</span> : fmtBRL(r.monthly)}</td>
                  <td className="px-3 py-2.5 text-text">{r.when}{r.whenSub && <span className={clsx('block text-xs', r.soon ? 'font-semibold text-[#C2610C]' : 'text-muted')}>{r.whenSub}</span>}</td>
                  <td className="px-4 py-2.5 text-xs">{r.statusLabel}{r.pending.length ? <span className="block text-[#C2610C]">{r.pending.join(' · ')}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {(f.tipo === '' || f.tipo === 'software') && <p className="mt-3 flex items-start gap-2 text-xs text-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />Usuário e senha de software ficam só no cofre de senhas corporativo (Vault); aqui você marca que está registrado lá.</p>}
      <Modal open={picking} onClose={() => setPicking(false)} title="Novo item" size="sm">
        <FormField label="Tipo do lançamento" htmlFor="ni-t">
          <Select id="ni-t" defaultValue="" onChange={(e) => e.target.value && start(e.target.value as ItemType)}>
            <option value="" disabled>Escolha o tipo…</option>
            {(Object.keys(ITEM_TYPE_LABELS) as ItemType[]).map((t) => <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>)}
          </Select>
        </FormField>
      </Modal>
      {editA && st.data && <AssetModal st={st.data} a={editA} onClose={() => setEditA(null)} />}
      {editR && st.data && <ResourceModal st={st.data} r={editR} onClose={() => setEditR(null)} />}
    </BudgetShell>
  );
}

// ================================================================== softwares, licenças, contratos e assinaturas
type Resource = {
  id: string; kind: ResourceKind; costCenterId: string; accountId: string | null; supplierId: string | null; supplierName: string | null; name: string; object: string | null; seats: number | null; currency: 'BRL' | 'USD'; amountCents: number; fxRate: number | null;
  period: string; startOn: string; endOn: string | null; renewalOn: string | null; paymentDay: number | null; paymentMethod: string | null; vaultRegistered: boolean; vaultRef: string | null; ownerId: string | null; ownerName: string | null;
  legalReviewed: boolean; directorSigned: boolean; status: 'ativo' | 'suspenso' | 'cancelado'; reviewOn: string | null; notes: string | null; cancelReason: string | null; monthlyBrlCents: number; pending: string[]; renewsSoon: boolean;
};

function ResourceModal({ st, r, onClose }: { st: Structure; r: Partial<Resource>; onClose: () => void }) {
  const soft = r.kind === 'software';
  const [v, setV] = useState({
    kind: r.kind ?? 'software', costCenterId: r.costCenterId ?? '', accountId: r.accountId ?? '', supplierId: r.supplierId ?? '', name: r.name ?? '', object: r.object ?? '', seats: String(r.seats ?? ''), currency: r.currency ?? 'BRL', amount: money(r.amountCents), fx: r.fxRate ? String(r.fxRate).replace('.', ',') : '',
    period: r.period ?? 'mensal', startOn: r.startOn ?? '', endOn: r.endOn ?? '', renewalOn: r.renewalOn ?? '', paymentDay: String(r.paymentDay ?? ''), paymentMethod: r.paymentMethod ?? '', vaultRegistered: !!r.vaultRegistered, vaultRef: r.vaultRef ?? '', ownerId: r.ownerId ?? '',
    legalReviewed: !!r.legalReviewed, directorSigned: !!r.directorSigned, reviewOn: r.reviewOn ?? '', notes: r.notes ?? '', status: r.status ?? 'ativo', cancelReason: r.cancelReason ?? '',
  });
  const save = useSave(onClose);
  const body = {
    kind: v.kind, costCenterId: v.costCenterId, accountId: v.accountId || null, supplierId: v.supplierId || null, name: v.name, object: v.object || null, seats: v.seats ? Number(v.seats) : null, currency: v.currency, amountCents: toCents(v.amount), fxRate: v.currency === 'USD' && v.fx ? Number(v.fx.replace(',', '.')) : null,
    period: v.period, startOn: v.startOn, endOn: v.endOn || null, renewalOn: v.renewalOn || null, paymentDay: v.paymentDay ? Number(v.paymentDay) : null, paymentMethod: v.paymentMethod || null, vaultRegistered: v.vaultRegistered, vaultRef: v.vaultRef || null, ownerId: v.ownerId || null,
    legalReviewed: v.legalReviewed, directorSigned: v.directorSigned, reviewOn: v.reviewOn || null, notes: v.notes || null, ...(r.id ? { status: v.status, cancelReason: v.status === 'cancelado' ? v.cancelReason || null : null } : {}),
  };
  const ok = v.costCenterId && v.name.trim().length >= 2 && v.startOn && (v.currency !== 'USD' || v.fx) && (!v.vaultRegistered || v.vaultRef.trim()) && (v.status !== 'cancelado' || v.cancelReason.trim().length >= 5);
  return (
    <Modal open onClose={onClose} size="lg" title={r.id ? r.name! : soft ? 'Nova licença' : 'Novo contrato ou assinatura'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!ok} loading={save.isPending} onClick={() => save.mutate(r.id ? { url: `/budget/resources/${r.id}`, method: 'PATCH', body } : { url: '/budget/resources', method: 'POST', body })}>Salvar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={soft ? 'Software' : 'Nome'} htmlFor="rs-n" required className="sm:col-span-2"><Input id="rs-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={soft ? 'Ex.: Plataforma de automação de marketing' : 'Ex.: Agência de conteúdo'} /></FormField>
        {!soft ? <FormField label="Tipo" htmlFor="rs-k"><Select id="rs-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as ResourceKind })}><option value="contrato">Contrato de serviço</option><option value="assinatura">Assinatura</option></Select></FormField> : <FormField label="Usuários" htmlFor="rs-se"><Input id="rs-se" inputMode="numeric" value={v.seats} onChange={(e) => setV({ ...v, seats: e.target.value.replace(/\D/g, '') })} /></FormField>}
        <FormField label="Objeto / para que serve" htmlFor="rs-o" className="sm:col-span-3"><Textarea id="rs-o" rows={2} value={v.object} onChange={(e) => setV({ ...v, object: e.target.value })} /></FormField>
        <FormField label="Centro de custo" htmlFor="rs-cc" required><CcSelect className="w-full" value={v.costCenterId} onChange={(x) => setV({ ...v, costCenterId: x })} list={st.costCenters} all={false} /></FormField>
        <FormField label="Conta (subcategoria)" htmlFor="rs-a"><AccountSelect id="rs-a" value={v.accountId} onChange={(x) => setV({ ...v, accountId: x })} accounts={st.accounts} /></FormField>
        <FormField label="Fornecedor" htmlFor="rs-f"><Select id="rs-f" value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })}><option value="">—</option>{st.suppliers.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>
        <FormField label="Moeda" htmlFor="rs-c"><Select id="rs-c" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value as 'BRL' })}><option value="BRL">Real (R$)</option><option value="USD">Dólar (US$)</option></Select></FormField>
        <FormField label={`Valor (${v.currency === 'USD' ? 'US$' : 'R$'})`} htmlFor="rs-v"><Input id="rs-v" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></FormField>
        <FormField label="Período" htmlFor="rs-p"><Select id="rs-p" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })}>{RESOURCE_PERIODS.map((x) => <option key={x} value={x}>{RESOURCE_PERIOD_LABELS[x]}</option>)}</Select></FormField>
        {v.currency === 'USD' && <FormField label="Cotação usada (R$ por US$)" htmlFor="rs-fx" required><Input id="rs-fx" inputMode="decimal" value={v.fx} onChange={(e) => setV({ ...v, fx: e.target.value })} placeholder="5,40" /></FormField>}
        <FormField label="Data de assinatura" htmlFor="rs-s" required><Input id="rs-s" type="date" value={v.startOn} onChange={(e) => setV({ ...v, startOn: e.target.value })} /></FormField>
        <FormField label="Renovação" htmlFor="rs-r"><Input id="rs-r" type="date" value={v.renewalOn} onChange={(e) => setV({ ...v, renewalOn: e.target.value })} /></FormField>
        <FormField label="Fim (se tiver)" htmlFor="rs-e"><Input id="rs-e" type="date" value={v.endOn} onChange={(e) => setV({ ...v, endOn: e.target.value })} /></FormField>
        <FormField label="Forma de pagamento" htmlFor="rs-pm"><Select id="rs-pm" value={v.paymentMethod} onChange={(e) => setV({ ...v, paymentMethod: e.target.value })}><option value="">—</option>{PAYMENT_METHODS.map((x) => <option key={x} value={x}>{PAYMENT_METHOD_LABELS[x]}</option>)}</Select></FormField>
        <FormField label="Dia do pagamento" htmlFor="rs-pd"><Input id="rs-pd" inputMode="numeric" value={v.paymentDay} onChange={(e) => setV({ ...v, paymentDay: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></FormField>
        <FormField label="Responsável" htmlFor="rs-ow"><Select id="rs-ow" value={v.ownerId} onChange={(e) => setV({ ...v, ownerId: e.target.value })}><option value="">Eu</option>{st.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Avaliar continuidade em" htmlFor="rs-rv" hint="uso e retorno da solução"><Input id="rs-rv" type="date" value={v.reviewOn} onChange={(e) => setV({ ...v, reviewOn: e.target.value })} /></FormField>
        {soft ? (
          <div className="space-y-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={v.vaultRegistered} onChange={(e) => setV({ ...v, vaultRegistered: e.target.checked })} />Usuário e senha registrados no cofre de senhas (Vault)</label>
            {v.vaultRegistered && <Input aria-label="Referência no Vault" value={v.vaultRef} onChange={(e) => setV({ ...v, vaultRef: e.target.value })} placeholder="Referência da entrada no Vault (sem a senha)" />}
          </div>
        ) : (
          <div className="space-y-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={v.legalReviewed} onChange={(e) => setV({ ...v, legalReviewed: e.target.checked })} />Analisado pelo Jurídico</label>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={v.directorSigned} onChange={(e) => setV({ ...v, directorSigned: e.target.checked })} />Assinado pela Diretoria Comercial</label>
          </div>
        )}
        {r.id && <FormField label="Situação" htmlFor="rs-st"><Select id="rs-st" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as 'ativo' })}><option value="ativo">Ativo</option><option value="suspenso">Suspenso</option><option value="cancelado">Cancelado</option></Select></FormField>}
        {v.status === 'cancelado' && <FormField label="Motivo do cancelamento" htmlFor="rs-cr" required className="sm:col-span-2"><Input id="rs-cr" value={v.cancelReason} onChange={(e) => setV({ ...v, cancelReason: e.target.value })} /></FormField>}
        <FormField label="Observações (sem senhas)" htmlFor="rs-nt" className="sm:col-span-3"><Textarea id="rs-nt" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

// ================================================================== compras e fornecedores
type Quote = { supplier: string; amountCents: number; deliveryDays: number | null; note: string | null; chosen: boolean };
type Purchase = { id: string; costCenterId: string; accountId: string | null; title: string; specification: string; kind: 'consumo' | 'especifica'; estimatedCents: number; neededBy: string | null; quotes: Quote[]; status: PurchaseStatus; financeCheck: boolean; legalReview: boolean; directorSigned: boolean; directorRelease: string | null; requesterName: string | null; createdAt: string; pending: string[] };
const PUR_TONE: Record<PurchaseStatus, string> = { solicitado: 'bg-surface-2 text-muted', em_cotacao: 'bg-primary-soft text-primary', aprovado: 'bg-sky-soft text-[#1F7DB8]', comprado: 'bg-success-soft text-[#15803D]', recebido: 'bg-success-soft text-[#15803D]', cancelado: 'bg-surface-2 text-muted' };

export function BudgetPurchasesPage() {
  const st = useStructure();
  const [f, setF] = useUrlState({ cc: '', t: 'compras' });
  const q = useQuery({ queryKey: ['budget', 'purchases', f.cc], enabled: f.t === 'compras', queryFn: () => api<{ items: Purchase[] }>(`/budget/purchases${qs({ costCenterId: f.cc || undefined })}`) });
  const [edit, setEdit] = useState<Partial<Purchase> | null>(null);
  const [sup, setSup] = useState<Partial<Structure['suppliers'][number]> | null>(null);
  const items = q.data?.items ?? [];
  return (
    <BudgetShell subtitle="Pedidos de compra com o caminho da política: Financeiro, cotação de Compras ou negociação, Jurídico e assinatura da Diretoria."
      actions={f.t === 'compras' ? <Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!st.data?.costCenters.length} onClick={() => setEdit({ kind: 'consumo', costCenterId: f.cc || st.data?.costCenters[0]?.id })}>Novo pedido de compra</Button> : <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setSup({ active: true })}>Novo fornecedor</Button>}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex border border-line" role="group" aria-label="Compras ou fornecedores">
          {(['compras', 'fornecedores'] as const).map((t) => <button key={t} type="button" aria-pressed={f.t === t} onClick={() => setF({ t })} className={clsx('px-4 py-2 text-sm font-semibold', f.t === t ? 'bg-primary text-white' : 'bg-surface text-ink')}>{t === 'compras' ? 'Pedidos de compra' : 'Fornecedores'}</button>)}
        </div>
        {f.t === 'compras' && st.data && <CcSelect value={f.cc} onChange={(cc) => setF({ cc })} list={st.data.costCenters} />}
      </div>
      {f.t === 'compras' ? (
        <section className="card p-0" aria-label="Pedidos de compra">
          {q.isLoading || !st.data ? <LoadingRows /> : !items.length ? <EmptyState title="Nenhum pedido de compra" description="Bens de consumo vão para o setor de Compras cotar; compras específicas ou grandes passam por negociação, Jurídico e assinatura da Diretoria." /> : (
            <ul className="divide-y divide-line">
              {items.map((p) => (
                <li key={p.id} className="flex cursor-pointer flex-wrap items-start gap-3 px-4 py-3 hover:bg-surface-2" onClick={() => setEdit(p)}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{p.title}</p>
                    <p className="text-xs text-muted">{ccName(st.data!, p.costCenterId)} · {p.kind === 'consumo' ? 'bem de consumo' : 'compra específica'} · {p.requesterName ?? ''} · {fmtDate(p.createdAt)}{p.quotes.length ? ` · ${p.quotes.length} cotação(ões)` : ''}</p>
                    {p.pending.length > 0 && <p className="mt-0.5 text-xs text-[#C2610C]">Falta: {p.pending.join(' · ')}</p>}
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-ink">{fmtBRL(p.quotes.find((x) => x.chosen)?.amountCents ?? p.estimatedCents)}</span>
                  <Tag className={PUR_TONE[p.status]}>{PURCHASE_STATUS_LABELS[p.status]}</Tag>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="card p-0" aria-label="Fornecedores">
          {!st.data ? <LoadingRows /> : !st.data.suppliers.length ? <EmptyState title="Nenhum fornecedor" /> : (
            <ul className="divide-y divide-line">
              {st.data.suppliers.map((s) => (
                <li key={s.id} className={clsx('flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-surface-2', !s.active && 'opacity-50')} onClick={() => setSup(s)}>
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink">{s.name}</p><p className="text-xs text-muted">{[s.document, s.category, s.email, s.phone].filter(Boolean).join(' · ') || '—'}</p></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {edit && st.data && <PurchaseModal st={st.data} p={edit} onClose={() => setEdit(null)} />}
      {sup && <SupplierModal s={sup} onClose={() => setSup(null)} />}
    </BudgetShell>
  );
}

function PurchaseModal({ st, p, onClose }: { st: Structure; p: Partial<Purchase>; onClose: () => void }) {
  const [v, setV] = useState({ costCenterId: p.costCenterId ?? '', accountId: p.accountId ?? '', title: p.title ?? '', specification: p.specification ?? '', kind: p.kind ?? 'consumo', estimated: money(p.estimatedCents), neededBy: p.neededBy ?? '', status: p.status ?? 'solicitado', financeCheck: !!p.financeCheck, legalReview: !!p.legalReview, directorSigned: !!p.directorSigned, directorRelease: p.directorRelease ?? '' });
  const [quotes, setQuotes] = useState<Quote[]>(p.quotes ?? []);
  const [nq, setNq] = useState({ supplier: '', amount: '', days: '' });
  const save = useSave(onClose);
  const isNew = !p.id;
  const body = isNew
    ? { costCenterId: v.costCenterId, accountId: v.accountId || null, title: v.title, specification: v.specification, kind: v.kind, estimatedCents: toCents(v.estimated), neededBy: v.neededBy || null }
    : { status: v.status, quotes, financeCheck: v.financeCheck, legalReview: v.legalReview, directorSigned: v.directorSigned, directorRelease: v.directorRelease || null, specification: v.specification, estimatedCents: toCents(v.estimated) || undefined };
  return (
    <Modal open onClose={onClose} size="lg" title={isNew ? 'Novo pedido de compra' : p.title!} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={isNew ? !v.costCenterId || v.title.trim().length < 3 || v.specification.trim().length < 10 || toCents(v.estimated) <= 0 : false} loading={save.isPending} onClick={() => save.mutate(isNew ? { url: '/budget/purchases', method: 'POST', body } : { url: `/budget/purchases/${p.id}`, method: 'PATCH', body })}>Salvar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {isNew && <FormField label="O que comprar" htmlFor="pc-t" required className="sm:col-span-2"><Input id="pc-t" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></FormField>}
        {isNew && <FormField label="Tipo de compra" htmlFor="pc-k" className="sm:col-span-2"><Select id="pc-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as 'consumo' })}>{PURCHASE_KINDS.map((k) => <option key={k} value={k}>{PURCHASE_KIND_LABELS[k]}</option>)}</Select></FormField>}
        <FormField label="Especificação completa" htmlFor="pc-s" required className="sm:col-span-2" hint="Quantidade, modelo, padrão de qualidade, prazo — o que Compras precisa para cotar"><Textarea id="pc-s" rows={3} value={v.specification} onChange={(e) => setV({ ...v, specification: e.target.value })} /></FormField>
        {isNew && <FormField label="Centro de custo" htmlFor="pc-cc" required><CcSelect className="w-full" value={v.costCenterId} onChange={(x) => setV({ ...v, costCenterId: x })} list={st.costCenters} all={false} /></FormField>}
        {isNew && <FormField label="Conta (subcategoria)" htmlFor="pc-a"><AccountSelect id="pc-a" value={v.accountId} onChange={(x) => setV({ ...v, accountId: x })} accounts={st.accounts} /></FormField>}
        <FormField label="Valor estimado (R$)" htmlFor="pc-e" required><Input id="pc-e" inputMode="decimal" value={v.estimated} onChange={(e) => setV({ ...v, estimated: e.target.value })} /></FormField>
        {isNew ? <FormField label="Preciso até" htmlFor="pc-n"><Input id="pc-n" type="date" value={v.neededBy} onChange={(e) => setV({ ...v, neededBy: e.target.value })} /></FormField> : (
          <FormField label="Situação" htmlFor="pc-st"><Select id="pc-st" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as PurchaseStatus })}>{Object.entries(PURCHASE_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField>
        )}
        {!isNew && (
          <>
            <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-sm font-semibold text-ink">Cotações</legend>
              {quotes.length > 0 && <ul className="mb-2 divide-y divide-line border border-line">{quotes.map((x, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input type="radio" name="chosen" aria-label={`Escolher ${x.supplier}`} className="h-4 w-4 accent-[rgb(var(--primary))]" checked={x.chosen} onChange={() => setQuotes(quotes.map((q, j) => ({ ...q, chosen: j === i })))} />
                  <span className="flex-1 text-ink">{x.supplier}{x.deliveryDays !== null ? <span className="text-muted"> · {x.deliveryDays} dia(s)</span> : null}</span>
                  <span className="tabular-nums">{fmtBRL(x.amountCents)}</span>
                  <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => setQuotes(quotes.filter((_, j) => j !== i))}>Tirar</button>
                </li>
              ))}</ul>}
              <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2">
                <Input aria-label="Fornecedor da cotação" placeholder="Fornecedor" value={nq.supplier} onChange={(e) => setNq({ ...nq, supplier: e.target.value })} list="sup-list" />
                <Input aria-label="Valor da cotação" inputMode="decimal" placeholder="Valor" value={nq.amount} onChange={(e) => setNq({ ...nq, amount: e.target.value })} />
                <Input aria-label="Prazo de entrega (dias)" inputMode="numeric" placeholder="Prazo (dias)" value={nq.days} onChange={(e) => setNq({ ...nq, days: e.target.value.replace(/\D/g, '') })} />
                <Button variant="outline" disabled={nq.supplier.trim().length < 2 || toCents(nq.amount) <= 0} onClick={() => { setQuotes([...quotes, { supplier: nq.supplier.trim(), amountCents: toCents(nq.amount), deliveryDays: nq.days ? Number(nq.days) : null, note: null, chosen: !quotes.length }]); setNq({ supplier: '', amount: '', days: '' }); }}>Incluir</Button>
                <datalist id="sup-list">{st.suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
              </div>
            </fieldset>
            <div className="space-y-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={v.financeCheck} onChange={(e) => setV({ ...v, financeCheck: e.target.checked })} />Checagem prévia com o Financeiro feita</label>
              {p.kind === 'especifica' && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={v.legalReview} onChange={(e) => setV({ ...v, legalReview: e.target.checked })} />Contrato ou termo analisado pelo Jurídico</label>}
              {p.kind === 'especifica' && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={v.directorSigned} disabled={!st.admin} onChange={(e) => setV({ ...v, directorSigned: e.target.checked })} />Assinado pela Diretoria Comercial{!st.admin ? ' (só a Diretoria marca)' : ''}</label>}
              {p.kind === 'especifica' && !v.directorSigned && <Input aria-label="Liberação por escrito" placeholder="Ou: liberação formal por escrito (e-mail/WhatsApp de quem, quando)" value={v.directorRelease} onChange={(e) => setV({ ...v, directorRelease: e.target.value })} />}
            </div>
            {p.pending && p.pending.length > 0 && <p className="text-xs text-[#C2610C] sm:col-span-2">Para marcar como comprado falta: {p.pending.join(' · ')}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}

function SupplierModal({ s, onClose }: { s: Partial<Structure['suppliers'][number]>; onClose: () => void }) {
  const [v, setV] = useState({ name: s.name ?? '', document: s.document ?? '', category: s.category ?? '', email: s.email ?? '', phone: s.phone ?? '', notes: s.notes ?? '', active: s.active ?? true });
  const save = useSave(onClose);
  const body = { name: v.name, document: v.document || null, category: v.category || null, email: v.email || null, phone: v.phone || null, notes: v.notes || null, active: v.active };
  return (
    <Modal open onClose={onClose} title={s.id ? s.name! : 'Novo fornecedor'} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={v.name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate(s.id ? { url: `/budget/suppliers/${s.id}`, method: 'PATCH', body } : { url: '/budget/suppliers', method: 'POST', body })}>Salvar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Nome" htmlFor="sp-n" required className="sm:col-span-2"><Input id="sp-n" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></FormField>
        <FormField label="CNPJ" htmlFor="sp-d"><Input id="sp-d" value={v.document} onChange={(e) => setV({ ...v, document: e.target.value })} /></FormField>
        <FormField label="Categoria" htmlFor="sp-c"><Input id="sp-c" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} placeholder="Ex.: Software, Gráfica, Agência" /></FormField>
        <FormField label="E-mail" htmlFor="sp-e"><Input id="sp-e" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></FormField>
        <FormField label="Telefone" htmlFor="sp-p"><Input id="sp-p" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></FormField>
        <FormField label="Observações" htmlFor="sp-o" className="sm:col-span-2"><Textarea id="sp-o" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></FormField>
        {s.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Fornecedor ativo</label>}
      </div>
    </Modal>
  );
}
