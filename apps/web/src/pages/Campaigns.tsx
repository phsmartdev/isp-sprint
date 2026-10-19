/** Campanhas: concepção, vigência, orçamento, gastos e resultado (leads, vendas e ROI). */
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Megaphone, Plus, Trash2 } from 'lucide-react';
import { CAMPAIGN_CHANNELS } from '@isp/shared';
import { STAGE_LABELS, toCents, type OpportunityStage } from '@isp/domain';
import { api, ApiError } from '../lib/api';
import { fmtBRL, fmtDate, fmtInt } from '../lib/format';
import { useLookups } from '../lib/hooks';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/layout/PageHeader';
import { Breadcrumb, Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Tabs, Textarea } from '../components/ui/primitives';
import { Drawer, useToast } from '../components/ui/overlay';

type Metrics = { leads: number; leadsConverted: number; opportunities: number; open: number; won: number; lost: number; mrrCents: number; ltvCents: number; marginCents: number; commissionCents: number; spentCents: number };
type Result = { investmentCents: number; basis: 'gastos' | 'orcamento' | null; roi: number | null; cplCents: number | null; cacCents: number | null; paybackMonths: number | null; winRate: number | null; budgetUsed: number | null };
type Campaign = {
  id: string; name: string; objective: string | null; audience: string | null; offer: string | null; message: string | null; channels: string[]; notes: string | null;
  ownerId: string | null; sourceId: string | null; startsOn: string | null; endsOn: string | null; budgetCents: number | null; targetLeads: number | null; targetSales: number | null; active: boolean;
  status: 'planejada' | 'ativa' | 'encerrada'; metrics: Metrics; result: Result;
};
type Detail = Campaign & {
  costs: { id: string; spentOn: string; category: string; description: string; amountCents: number; createdByName: string | null }[];
  opportunities: { id: string; code: number; stage: string; contactName: string; ownerName: string; valueCents: number | null; wonAt: string | null; planName: string | null; ltvCents: number | null }[];
};

const STATUS = { planejada: { label: 'Planejada', tone: 'blue' as const }, ativa: { label: 'Em vigência', tone: 'green' as const }, encerrada: { label: 'Encerrada', tone: 'neutral' as const } };
const COST_CATEGORIES = ['Mídia paga', 'Produção', 'Impressos', 'Brindes', 'Evento', 'Comissão extra', 'Outros'];
const pct = (r: number | null) => (r == null ? '—' : `${(r * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`);
const dateOnly = (v: string | null) => (v ? v.slice(0, 10) : '');
const dec = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
const errMsg = (e: unknown) => (e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message);

function RoiBadge({ roi }: { roi: number | null }) {
  if (roi == null) return <span className="text-sm text-muted">ROI —</span>;
  return <span className={clsx('num text-lg font-extrabold', roi >= 0 ? 'text-success' : 'text-danger')}>ROI {roi >= 0 ? '+' : ''}{pct(roi)}</span>;
}

function Progress({ value, target, label }: { value: number; target: number | null; label: string }) {
  if (!target) return <p className="text-sm text-text"><span className="num font-semibold text-ink">{fmtInt(value)}</span> {label}</p>;
  const r = Math.min(1, value / target);
  return (
    <div>
      <p className="mb-1 text-sm text-text"><span className="num font-semibold text-ink">{fmtInt(value)}</span> de {fmtInt(target)} {label}</p>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className={clsx('h-full', r >= 1 ? 'bg-success' : 'bg-primary')} style={{ width: `${r * 100}%` }} /></div>
    </div>
  );
}

// =================================================================== formulário

function CampaignForm({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const lookups = useLookups();
  const [f, setF] = useState({
    name: campaign?.name ?? '', objective: campaign?.objective ?? '', audience: campaign?.audience ?? '', offer: campaign?.offer ?? '', message: campaign?.message ?? '',
    channels: campaign?.channels ?? [], notes: campaign?.notes ?? '', ownerId: campaign?.ownerId ?? '', sourceId: campaign?.sourceId ?? '',
    startsOn: dateOnly(campaign?.startsOn ?? null), endsOn: dateOnly(campaign?.endsOn ?? null), budget: dec(campaign?.budgetCents ?? null),
    targetLeads: campaign?.targetLeads?.toString() ?? '', targetSales: campaign?.targetSales?.toString() ?? '', active: campaign?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (v: Partial<typeof f>) => setF((x) => ({ ...x, ...v }));
  const save = useMutation({
    mutationFn: () => {
      if (f.budget.trim() && toCents(f.budget) === null) throw new Error('Orçamento no formato 5.000,00');
      const body = {
        name: f.name, objective: f.objective || null, audience: f.audience || null, offer: f.offer || null, message: f.message || null, channels: f.channels, notes: f.notes || null,
        ownerId: f.ownerId || null, sourceId: f.sourceId || null, startsOn: f.startsOn || null, endsOn: f.endsOn || null, budgetCents: f.budget.trim() ? toCents(f.budget) : null,
        targetLeads: f.targetLeads ? Number(f.targetLeads) : null, targetSales: f.targetSales ? Number(f.targetSales) : null, active: f.active,
      };
      return campaign ? api(`/campaigns/${campaign.id}`, { method: 'PATCH', body }) : api('/campaigns', { method: 'POST', body });
    },
    onSuccess: () => { for (const k of ['campaigns', 'campaign', 'lookups']) qc.invalidateQueries({ queryKey: [k] }); toast({ tone: 'success', message: 'Campanha salva' }); onClose(); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); toast({ tone: 'error', message: errMsg(e) }); },
  });
  return (
    <Drawer open onClose={onClose} title={campaign ? 'Editar campanha' : 'Nova campanha'} width="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={f.name.trim().length < 2} onClick={() => save.mutate()}>Salvar campanha</Button></>}>
      <div className="space-y-5">
        <FormField label="Nome da campanha" htmlFor="cp-name" required error={errors.name}><Input id="cp-name" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: Fibra no condomínio — Novembro" data-autofocus /></FormField>
        <fieldset className="space-y-3 rounded-md border border-line p-4">
          <legend className="px-1 text-sm font-semibold text-ink">Concepção</legend>
          <FormField label="Objetivo" htmlFor="cp-obj" hint="O que a campanha precisa entregar"><Textarea id="cp-obj" value={f.objective} onChange={(e) => set({ objective: e.target.value })} placeholder="Ex.: vender 40 planos de 500 Mega nos condomínios da Zona Sul" /></FormField>
          <FormField label="Público-alvo" htmlFor="cp-aud"><Textarea id="cp-aud" value={f.audience} onChange={(e) => set({ audience: e.target.value })} placeholder="Ex.: moradores de condomínios cabeados, famílias que trabalham de casa" /></FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Oferta" htmlFor="cp-offer"><Textarea id="cp-offer" value={f.offer} onChange={(e) => set({ offer: e.target.value })} placeholder="Ex.: instalação grátis e 1º mês pela metade" /></FormField>
            <FormField label="Mensagem principal" htmlFor="cp-msg"><Textarea id="cp-msg" value={f.message} onChange={(e) => set({ message: e.target.value })} placeholder="Ex.: Internet que aguenta a família toda" /></FormField>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-ink">Canais</legend>
            <div className="flex flex-wrap gap-2">
              {CAMPAIGN_CHANNELS.map((c) => {
                const on = f.channels.includes(c);
                return <button key={c} type="button" aria-pressed={on} onClick={() => set({ channels: on ? f.channels.filter((x) => x !== c) : [...f.channels, c] })} className={clsx('rounded-full border px-3 py-1 text-sm', on ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line hover:border-line-strong')}>{c}</button>;
              })}
            </div>
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Responsável" htmlFor="cp-owner"><Select id="cp-owner" value={f.ownerId} onChange={(e) => set({ ownerId: e.target.value })}><option value="">Ninguém</option>{lookups.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
            <FormField label="Canal de entrada dos leads" htmlFor="cp-src"><Select id="cp-src" value={f.sourceId} onChange={(e) => set({ sourceId: e.target.value })}><option value="">Vários</option>{lookups.data?.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></FormField>
          </div>
        </fieldset>
        <fieldset className="grid grid-cols-1 gap-3 rounded-md border border-line p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-ink">Vigência, orçamento e metas</legend>
          <FormField label="Início" htmlFor="cp-start"><Input id="cp-start" type="date" value={f.startsOn} onChange={(e) => set({ startsOn: e.target.value })} /></FormField>
          <FormField label="Fim" htmlFor="cp-end" error={errors.endsOn}><Input id="cp-end" type="date" value={f.endsOn} onChange={(e) => set({ endsOn: e.target.value })} /></FormField>
          <FormField label="Orçamento total (R$)" htmlFor="cp-budget"><Input id="cp-budget" inputMode="decimal" value={f.budget} onChange={(e) => set({ budget: e.target.value })} placeholder="5.000,00" /></FormField>
          <div />
          <FormField label="Meta de leads" htmlFor="cp-tl"><Input id="cp-tl" type="number" min={0} value={f.targetLeads} onChange={(e) => set({ targetLeads: e.target.value })} /></FormField>
          <FormField label="Meta de vendas" htmlFor="cp-ts"><Input id="cp-ts" type="number" min={0} value={f.targetSales} onChange={(e) => set({ targetSales: e.target.value })} /></FormField>
        </fieldset>
        <FormField label="Observações" htmlFor="cp-notes"><Textarea id="cp-notes" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></FormField>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />Ativa (aparece para escolher em leads e oportunidades)</label>
      </div>
    </Drawer>
  );
}

// =================================================================== lista

export function CampaignsPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['campaigns'], queryFn: () => api<{ items: Campaign[] }>('/campaigns') });
  const [creating, setCreating] = useState(false);
  const canEdit = can('campanhas', 'equipe');
  return (
    <div className="w-full">
      <PageHeader icon={<Megaphone className="h-9 w-9" strokeWidth={2.2} />} title="Campanhas" subtitle="Da concepção ao resultado: vigência, orçamento, gastos, vendas e ROI."
        actions={canEdit ? <Button variant="primary" size="lg" icon={<Plus className="h-5 w-5" />} onClick={() => setCreating(true)}>Nova campanha</Button> : undefined} />
      {q.isLoading ? <div className="card"><LoadingRows /></div> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.items.length ? (
        <div className="card"><EmptyState title="Nenhuma campanha" description="Crie a primeira campanha com objetivo, vigência e orçamento. Depois, escolha a campanha nos leads e oportunidades para medir o resultado." action={canEdit ? <Button variant="primary" onClick={() => setCreating(true)}>Nova campanha</Button> : undefined} /></div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {q.data!.items.map((c) => (
            <li key={c.id}>
              <Link to={`/campaigns/${c.id}`} className="card block h-full p-5 hover:shadow-overlay">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h2 className="text-md font-bold text-ink">{c.name}</h2>
                  <Chip tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Chip>
                </div>
                <p className="mb-3 text-sm text-muted">{c.startsOn || c.endsOn ? `${fmtDate(c.startsOn) || '—'} a ${fmtDate(c.endsOn) || '—'}` : 'Sem vigência definida'}{c.channels.length ? ` · ${c.channels.join(', ')}` : ''}</p>
                <dl className="mb-3 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-xs text-muted">Leads</dt><dd className="num font-semibold text-ink">{fmtInt(c.metrics.leads)}</dd></div>
                  <div><dt className="text-xs text-muted">Vendas</dt><dd className="num font-semibold text-ink">{fmtInt(c.metrics.won)}</dd></div>
                  <div><dt className="text-xs text-muted">Receita/mês</dt><dd className="num font-semibold text-ink">{fmtBRL(c.metrics.mrrCents)}</dd></div>
                  <div><dt className="text-xs text-muted">Orçamento</dt><dd className="num font-semibold text-ink">{fmtBRL(c.budgetCents)}</dd></div>
                  <div><dt className="text-xs text-muted">Gasto</dt><dd className="num font-semibold text-ink">{fmtBRL(c.metrics.spentCents)}</dd></div>
                  <div><dt className="text-xs text-muted">CAC</dt><dd className="num font-semibold text-ink">{fmtBRL(c.result.cacCents)}</dd></div>
                </dl>
                <RoiBadge roi={c.result.roi} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <CampaignForm campaign={null} onClose={() => setCreating(false)} />}
    </div>
  );
}

// =================================================================== detalhe

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <div className="card min-w-0 p-4"><p className="text-sm text-muted">{label}</p><p className="num break-words text-lg font-extrabold text-ink sm:text-xl">{value}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>;
}

export function CampaignDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = can('campanhas', 'equipe');
  const q = useQuery({ queryKey: ['campaign', id], queryFn: () => api<Detail>(`/campaigns/${id}`) });
  const [tab, setTab] = useState<'resultado' | 'concepcao' | 'gastos' | 'vendas'>('resultado');
  const [editing, setEditing] = useState(false);
  const [cost, setCost] = useState({ spentOn: new Date().toISOString().slice(0, 10), category: COST_CATEGORIES[0]!, description: '', amount: '' });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['campaign', id] }); qc.invalidateQueries({ queryKey: ['campaigns'] }); };
  const addCost = useMutation({
    mutationFn: () => { const amountCents = toCents(cost.amount); if (!amountCents) throw new Error('Valor no formato 1.200,00'); return api(`/campaigns/${id}/costs`, { method: 'POST', body: { spentOn: cost.spentOn, category: cost.category, description: cost.description, amountCents } }); },
    onSuccess: () => { setCost((c) => ({ ...c, description: '', amount: '' })); refresh(); toast({ tone: 'success', message: 'Gasto lançado' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const delCost = useMutation({ mutationFn: (costId: string) => api(`/campaigns/${id}/costs/${costId}`, { method: 'DELETE' }), onSuccess: refresh });

  if (q.isLoading) return <div className="card"><LoadingRows rows={8} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;
  const m = c.metrics, r = c.result;
  return (
    <div className="w-full">
      <Breadcrumb items={[{ label: 'Campanhas', to: '/campaigns' }, { label: c.name }]} />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-extrabold text-ink">{c.name}<Chip tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Chip></h1>
          <p className="text-sm text-muted">{c.startsOn || c.endsOn ? `Vigência: ${fmtDate(c.startsOn) || '—'} a ${fmtDate(c.endsOn) || '—'}` : 'Sem vigência definida'}{c.channels.length ? ` · ${c.channels.join(', ')}` : ''}</p>
        </div>
        <div className="flex items-center gap-3"><RoiBadge roi={r.roi} />{canEdit && <Button onClick={() => setEditing(true)}>Editar campanha</Button>}</div>
      </div>
      <Tabs label="Partes da campanha" className="mb-4" value={tab} onChange={setTab} tabs={[{ key: 'resultado', label: 'Resultado' }, { key: 'concepcao', label: 'Concepção' }, { key: 'gastos', label: 'Orçamento e gastos', count: c.costs.length }, { key: 'vendas', label: 'Oportunidades', count: c.opportunities.length }]} />

      {tab === 'resultado' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 2xl:grid-cols-8">
            <Metric label="Investimento" value={fmtBRL(r.investmentCents)} hint={r.basis === 'gastos' ? 'Gastos lançados' : r.basis === 'orcamento' ? 'Orçamento (sem gastos lançados)' : 'Informe orçamento ou gastos'} />
            <Metric label="Retorno (LTV)" value={fmtBRL(m.ltvCents)} hint="Margem × vida média das vendas" />
            <Metric label="ROI" value={pct(r.roi)} hint="(retorno − investimento) ÷ investimento" />
            <Metric label="Receita mensal" value={fmtBRL(m.mrrCents)} hint="Mensalidades vendidas" />
            <Metric label="Custo por lead" value={fmtBRL(r.cplCents)} />
            <Metric label="CAC da campanha" value={fmtBRL(r.cacCents)} hint="Investimento ÷ vendas" />
            <Metric label="Payback" value={r.paybackMonths == null ? '—' : `${String(r.paybackMonths).replace('.', ',')} meses`} hint="Investimento ÷ margem mensal" />
            <Metric label="Taxa de ganho" value={pct(r.winRate)} />
          </div>
          <section className="card grid grid-cols-1 gap-5 p-5 md:grid-cols-3">
            <Progress value={m.leads} target={c.targetLeads} label="leads" />
            <Progress value={m.won} target={c.targetSales} label="vendas fechadas" />
            <div>
              <p className="mb-1 text-sm text-text"><span className="num font-semibold text-ink">{fmtBRL(m.spentCents)}</span> gastos de {fmtBRL(c.budgetCents)} de orçamento</p>
              {c.budgetCents ? <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className={clsx('h-full', (r.budgetUsed ?? 0) > 1 ? 'bg-danger' : 'bg-primary')} style={{ width: `${Math.min(100, (r.budgetUsed ?? 0) * 100)}%` }} /></div> : null}
            </div>
          </section>
          <section className="card p-5">
            <h2 className="mb-2 text-md font-bold text-ink">Funil da campanha</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              {[['Leads', m.leads], ['Leads convertidos', m.leadsConverted], ['Oportunidades', m.opportunities], ['Vendas fechadas', m.won], ['Perdidas', m.lost]].map(([l, v]) => <div key={l as string}><dt className="text-muted">{l}</dt><dd className="num text-lg font-bold text-ink">{fmtInt(v as number)}</dd></div>)}
            </dl>
            <p className="mt-3 text-xs text-muted">Contam os leads e as oportunidades em que a campanha foi escolhida. O retorno usa o LTV calculado na viabilidade de cada venda (sem viabilidade, 12 mensalidades).</p>
          </section>
        </div>
      )}

      {tab === 'concepcao' && (
        <section className="card grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
          {[['Objetivo', c.objective], ['Público-alvo', c.audience], ['Oferta', c.offer], ['Mensagem principal', c.message], ['Observações', c.notes]].map(([l, v]) => (
            <div key={l as string}><h3 className="mb-1 text-sm font-semibold text-muted">{l}</h3><p className="whitespace-pre-wrap text-text">{(v as string) || '—'}</p></div>
          ))}
          <div><h3 className="mb-1 text-sm font-semibold text-muted">Canais</h3><p className="text-text">{c.channels.join(', ') || '—'}</p></div>
        </section>
      )}

      {tab === 'gastos' && (
        <section className="card overflow-hidden">
          <div className="px-5 pb-3 pt-4"><h2 className="text-md font-bold text-ink">Gastos realizados</h2><p className="text-sm text-muted">Orçamento: {fmtBRL(c.budgetCents)} · Gasto: {fmtBRL(m.spentCents)} · Saldo: {c.budgetCents != null ? fmtBRL(c.budgetCents - m.spentCents) : '—'}</p></div>
          {canEdit && (
            <form className="grid grid-cols-1 gap-2 border-y border-line bg-surface-2 px-5 py-3 sm:grid-cols-[150px_170px_minmax(0,1fr)_140px_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); addCost.mutate(); }}>
              <FormField label="Data" htmlFor="cc-date"><Input id="cc-date" type="date" value={cost.spentOn} onChange={(e) => setCost({ ...cost, spentOn: e.target.value })} /></FormField>
              <FormField label="Categoria" htmlFor="cc-cat"><Select id="cc-cat" value={cost.category} onChange={(e) => setCost({ ...cost, category: e.target.value })}>{COST_CATEGORIES.map((x) => <option key={x}>{x}</option>)}</Select></FormField>
              <FormField label="Descrição" htmlFor="cc-desc"><Input id="cc-desc" value={cost.description} onChange={(e) => setCost({ ...cost, description: e.target.value })} placeholder="Ex.: impulsionamento Instagram" /></FormField>
              <FormField label="Valor (R$)" htmlFor="cc-val"><Input id="cc-val" inputMode="decimal" value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} placeholder="1.200,00" /></FormField>
              <Button type="submit" variant="primary" loading={addCost.isPending} disabled={cost.description.trim().length < 2 || !cost.amount}>Lançar</Button>
            </form>
          )}
          {!c.costs.length ? <p className="px-5 py-4 text-sm text-muted">Nenhum gasto lançado. Enquanto não houver, o ROI usa o orçamento previsto.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-muted"><tr>{['Data', 'Categoria', 'Descrição', 'Valor', 'Lançado por', ''].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>{c.costs.map((x) => (
                  <tr key={x.id} className="border-t border-line">
                    <td className="num px-5 py-2">{fmtDate(x.spentOn)}</td><td className="px-5 py-2">{x.category}</td><td className="px-5 py-2 text-ink">{x.description}</td><td className="num px-5 py-2 font-semibold text-ink">{fmtBRL(x.amountCents)}</td><td className="px-5 py-2 text-muted">{x.createdByName ?? '—'}</td>
                    <td className="px-5 py-2 text-right">{canEdit && <Button size="sm" variant="ghost" aria-label="Remover gasto" onClick={() => { if (confirm('Remover este gasto?')) delCost.mutate(x.id); }} icon={<Trash2 className="h-4 w-4 text-danger" />} />}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'vendas' && (
        <section className="card overflow-hidden">
          {!c.opportunities.length ? <EmptyState title="Nenhuma oportunidade ligada" description="Escolha esta campanha no cadastro do lead ou da oportunidade para medir o resultado." /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-surface-2 text-xs text-muted"><tr>{['Oportunidade', 'Cliente', 'Etapa', 'Plano', 'Mensalidade', 'LTV', 'Responsável'].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>{c.opportunities.map((o) => (
                  <tr key={o.id} className="border-t border-line">
                    <td className="px-5 py-2"><Link className="link" to={`/opportunities/${o.id}`}>OP-{o.code}</Link></td>
                    <td className="px-5 py-2 text-ink">{o.contactName}</td>
                    <td className="px-5 py-2"><Chip tone={o.stage === 'ganha' ? 'green' : o.stage === 'perdida' ? 'red' : 'neutral'}>{STAGE_LABELS[o.stage as OpportunityStage] ?? o.stage}</Chip></td>
                    <td className="px-5 py-2">{o.planName ?? '—'}</td>
                    <td className="num px-5 py-2">{fmtBRL(o.valueCents)}</td>
                    <td className="num px-5 py-2">{o.stage === 'ganha' ? fmtBRL(o.ltvCents ?? (o.valueCents ?? 0) * 12) : '—'}</td>
                    <td className="px-5 py-2 text-muted">{o.ownerName}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {editing && <CampaignForm campaign={c} onClose={() => setEditing(false)} />}
    </div>
  );
}
