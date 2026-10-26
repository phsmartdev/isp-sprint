/** Recursos do comercial: ferramentas e equipamentos, softwares e licenças, contratos e assinaturas, compras e fornecedores. */
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
const ASSET_TONE: Record<AssetStatus, string> = { em_uso: 'bg-success-soft text-[#15803D]', estoque: 'bg-primary-soft text-primary', manutencao: 'bg-warning-soft text-[#C2610C]', baixado: 'bg-surface-2 text-muted' };

export function BudgetAssetsPage() {
  const st = useStructure();
  const [f, setF] = useUrlState({ cc: '', s: '' });
  const q = useQuery({ queryKey: ['budget', 'assets', f.cc], queryFn: () => api<{ items: Asset[] }>(`/budget/assets${qs({ costCenterId: f.cc || undefined })}`) });
  const [edit, setEdit] = useState<Partial<Asset> | null>(null);
  const items = (q.data?.items ?? []).filter((a) => !f.s || a.status === f.s);
  const live = items.filter((a) => a.status !== 'baixado');
  return (
    <BudgetShell subtitle="Notebooks, celulares, equipamentos de demonstração e ferramentas do comercial, com responsável e valor." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!st.data?.costCenters.length} onClick={() => setEdit({ status: 'em_uso', category: 'notebook', acquiredOn: new Date().toISOString().slice(0, 10), usefulLifeMonths: 36, costCenterId: f.cc || st.data?.costCenters[0]?.id })}>Novo equipamento</Button>}>
      <div className="mb-4 flex flex-wrap gap-2">
        {st.data && <CcSelect value={f.cc} onChange={(cc) => setF({ cc })} list={st.data.costCenters} />}
        <Select aria-label="Situação" className="h-11 w-auto" value={f.s} onChange={(e) => setF({ s: e.target.value })}><option value="">Todas as situações</option>{ASSET_STATUS.map((x) => <option key={x} value={x}>{ASSET_STATUS_LABELS[x]}</option>)}</Select>
      </div>
      <dl className="mb-4 grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4" aria-label="Resumo dos equipamentos">
        <Stat label="Itens ativos" value={live.length} />
        <Stat label="Valor de compra" value={fmtBRL(live.reduce((t, a) => t + a.valueCents, 0))} />
        <Stat label="Valor contábil hoje" value={fmtBRL(live.reduce((t, a) => t + a.bookValueCents, 0))} sub="depreciação linear pela vida útil" />
        <Stat label="Em manutenção" value={items.filter((a) => a.status === 'manutencao').length} />
      </dl>
      <section className="card overflow-x-auto p-0" aria-label="Equipamentos">
        {q.isLoading || !st.data ? <LoadingRows /> : !items.length ? <EmptyState title="Nenhum equipamento" description="Cadastre o que o comercial usa: quem está com ele, quanto custou e por quanto tempo vale." /> : (
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted"><th className="px-4 py-2.5 font-semibold">Equipamento</th><th className="px-3 py-2.5 font-semibold">Centro de custo</th><th className="px-3 py-2.5 font-semibold">Com quem</th><th className="px-3 py-2.5 font-semibold">Compra</th><th className="px-3 py-2.5 text-right font-semibold">Valor</th><th className="px-3 py-2.5 text-right font-semibold">Contábil</th><th className="px-4 py-2.5 font-semibold">Situação</th></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => setEdit(a)}>
                  <td className="px-4 py-2.5"><button type="button" className="text-left font-semibold text-ink hover:text-primary">{a.name}</button><span className="block text-xs text-muted">{ASSET_CATEGORY_LABELS[a.category as keyof typeof ASSET_CATEGORY_LABELS]}{a.tag ? ` · patrimônio ${a.tag}` : ''}</span></td>
                  <td className="px-3 py-2.5 text-text">{ccName(st.data!, a.costCenterId)}</td>
                  <td className="px-3 py-2.5 text-text">{a.holderName ?? '—'}</td>
                  <td className="px-3 py-2.5 text-text">{fmtDate(a.acquiredOn)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtBRL(a.valueCents)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtBRL(a.bookValueCents)}</td>
                  <td className="px-4 py-2.5"><Tag className={ASSET_TONE[a.status]}>{ASSET_STATUS_LABELS[a.status]}</Tag></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {edit && st.data && <AssetModal st={st.data} a={edit} onClose={() => setEdit(null)} />}
    </BudgetShell>
  );
}

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

// ================================================================== softwares, licenças, contratos e assinaturas
type Resource = {
  id: string; kind: ResourceKind; costCenterId: string; accountId: string | null; supplierId: string | null; supplierName: string | null; name: string; object: string | null; seats: number | null; currency: 'BRL' | 'USD'; amountCents: number; fxRate: number | null;
  period: string; startOn: string; endOn: string | null; renewalOn: string | null; paymentDay: number | null; paymentMethod: string | null; vaultRegistered: boolean; vaultRef: string | null; ownerId: string | null; ownerName: string | null;
  legalReviewed: boolean; directorSigned: boolean; status: 'ativo' | 'suspenso' | 'cancelado'; reviewOn: string | null; notes: string | null; cancelReason: string | null; monthlyBrlCents: number; pending: string[]; renewsSoon: boolean;
};

export function BudgetSoftwarePage() { return <ResourcesPage kind="software" />; }
export function BudgetContractsPage() { return <ResourcesPage kind="contratos" />; }

function ResourcesPage({ kind }: { kind: 'software' | 'contratos' }) {
  const st = useStructure();
  const [f, setF] = useUrlState({ cc: '', s: 'ativo' });
  const q = useQuery({ queryKey: ['budget', 'resources', kind, f.cc], queryFn: () => api<{ items: Resource[] }>(`/budget/resources${qs({ kind, costCenterId: f.cc || undefined })}`) });
  const [edit, setEdit] = useState<Partial<Resource> | null>(null);
  const items = (q.data?.items ?? []).filter((r) => !f.s || r.status === f.s);
  const active = (q.data?.items ?? []).filter((r) => r.status === 'ativo');
  const soft = kind === 'software';
  return (
    <BudgetShell
      subtitle={soft ? 'Licenças recorrentes de cada centro de custo: custo em real ou dólar, assinatura, pagamento e registro no cofre de senhas.' : 'Contratos de serviço e assinaturas com fornecedores e parceiros: valor, vigência, Jurídico e assinatura da Diretoria.'}
      actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!st.data?.costCenters.length} onClick={() => setEdit({ kind: soft ? 'software' : 'contrato', currency: 'BRL', period: 'mensal', startOn: new Date().toISOString().slice(0, 10), costCenterId: f.cc || st.data?.costCenters[0]?.id, status: 'ativo' })}>{soft ? 'Nova licença' : 'Novo contrato ou assinatura'}</Button>}>
      <div className="mb-4 flex flex-wrap gap-2">
        {st.data && <CcSelect value={f.cc} onChange={(cc) => setF({ cc })} list={st.data.costCenters} />}
        <Select aria-label="Situação" className="h-11 w-auto" value={f.s} onChange={(e) => setF({ s: e.target.value })}><option value="ativo">Ativos</option><option value="suspenso">Suspensos</option><option value="cancelado">Cancelados</option><option value="">Todos</option></Select>
      </div>
      <dl className="mb-4 grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4" aria-label={soft ? 'Resumo das licenças' : 'Resumo dos contratos'}>
        <Stat label={soft ? 'Licenças ativas' : 'Ativos'} value={active.length} />
        <Stat label="Custo mensal (R$)" value={fmtBRL(active.reduce((t, r) => t + r.monthlyBrlCents, 0))} sub="dólar pela cotação informada; anual ÷ 12" />
        <Stat label="Renovam em 45 dias" value={active.filter((r) => r.renewsSoon).length} />
        <Stat label="Com pendência" value={active.filter((r) => r.pending.length).length} tone={active.some((r) => r.pending.length) ? 'danger' : undefined} sub={soft ? 'Vault, pagamento, cotação ou revisão' : 'Jurídico, Diretoria ou pagamento'} />
      </dl>
      {soft && <p className="mb-4 flex items-start gap-2 border border-line bg-surface px-4 py-3 text-sm text-text"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />Usuário e senha ficam só no cofre de senhas corporativo (Vault), como pede a política. Aqui você marca que a licença está registrada lá e informa a referência da entrada.</p>}
      <section className="card overflow-x-auto p-0" aria-label={soft ? 'Softwares e licenças' : 'Contratos e assinaturas'}>
        {q.isLoading || !st.data ? <LoadingRows /> : !items.length ? <EmptyState title={soft ? 'Nenhuma licença' : 'Nenhum contrato ou assinatura'} description="Cadastre para acompanhar custo, renovação e trazer o valor recorrente para o planejamento do trimestre." /> : (
          <table className="w-full min-w-[980px] text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted"><th className="px-4 py-2.5 font-semibold">{soft ? 'Software' : 'Contrato / assinatura'}</th><th className="px-3 py-2.5 font-semibold">Centro de custo</th><th className="px-3 py-2.5 text-right font-semibold">Valor</th><th className="px-3 py-2.5 text-right font-semibold">Por mês (R$)</th><th className="px-3 py-2.5 font-semibold">Assinatura · renovação</th><th className="px-3 py-2.5 font-semibold">Pagamento</th><th className="px-4 py-2.5 font-semibold">Pendências</th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className={clsx('cursor-pointer border-b border-line last:border-0 hover:bg-surface-2', r.status !== 'ativo' && 'opacity-60')} onClick={() => setEdit(r)}>
                  <td className="px-4 py-2.5"><button type="button" className="text-left font-semibold text-ink hover:text-primary">{r.name}</button><span className="block text-xs text-muted">{soft ? `${r.seats ? `${r.seats} usuário(s) · ` : ''}${r.vaultRegistered ? 'no Vault' : 'fora do Vault'}` : RESOURCE_KIND_LABELS[r.kind]}{r.supplierName ? ` · ${r.supplierName}` : ''}{r.status !== 'ativo' ? ` · ${r.status}` : ''}</span></td>
                  <td className="px-3 py-2.5 text-text">{ccName(st.data!, r.costCenterId)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.currency === 'USD' ? 'US$ ' : 'R$ '}{(r.amountCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}<span className="block text-xs text-muted">{RESOURCE_PERIOD_LABELS[r.period as keyof typeof RESOURCE_PERIOD_LABELS]}{r.currency === 'USD' && r.fxRate ? ` · US$ 1 = R$ ${r.fxRate.toFixed(2).replace('.', ',')}` : ''}</span></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtBRL(r.monthlyBrlCents)}</td>
                  <td className="px-3 py-2.5 text-text">{fmtDate(r.startOn)}{r.renewalOn ? <span className={clsx('block text-xs', r.renewsSoon ? 'font-semibold text-[#C2610C]' : 'text-muted')}>renova {fmtDate(r.renewalOn)}</span> : null}</td>
                  <td className="px-3 py-2.5 text-text">{r.paymentMethod ? PAYMENT_METHOD_LABELS[r.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] : '—'}{r.paymentDay ? <span className="block text-xs text-muted">dia {r.paymentDay}</span> : null}</td>
                  <td className="px-4 py-2.5">{r.pending.length ? <span className="text-xs text-[#C2610C]">{r.pending.join(' · ')}</span> : <span className="text-xs text-[#15803D]">Em dia</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {edit && st.data && <ResourceModal st={st.data} r={edit} onClose={() => setEdit(null)} />}
    </BudgetShell>
  );
}

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
