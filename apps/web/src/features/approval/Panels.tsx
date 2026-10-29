/** Painéis da análise de aprovação: resumo executivo, parecer, inteligência do cliente, contratos, classificação, margem e históricos. */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, CircleDashed, ExternalLink, FileText, Scale, ShieldCheck, Sparkles, Target, TrendingUp } from 'lucide-react';
import { APPROVAL_LEVELS, APPROVAL_LEVEL_LABELS, BILLING_TYPE_LABELS, CONTRACT_STAGE_LABELS, ECON_VERDICT_LABELS, fmtMonths, type BillingType, type ContractStage } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, Section, Tabs, type Tone } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import type { Analysis, OpinionItem, TimelineItem, ValueKind } from './types';
import { FitText } from '../../components/ui/FitText';

export const pct = (bp: number | null | undefined) => (bp === null || bp === undefined ? '—' : `${(bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const brl = (c: number | null | undefined) => (c === null || c === undefined ? '—' : fmtBRL(c));
const months = (m: number | null | undefined) => (m === null || m === undefined ? '—' : `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`);

const KIND: Record<ValueKind, { label: string; tone: Tone; title: string }> = {
  contratado: { label: 'Contratado', tone: 'blue', title: 'Valor dos contratos e vendas vigentes (não é recebimento).' },
  projetado: { label: 'Projeção', tone: 'purple', title: 'Cálculo para o futuro a partir de parâmetros; não é resultado.' },
  estimado: { label: 'Estimativa', tone: 'orange', title: 'Calculado com custos estimados na venda.' },
  observado: { label: 'Observado', tone: 'green', title: 'Resultado registrado.' },
  indisponivel: { label: 'Aguardando IXC', tone: 'neutral', title: 'Depende da leitura de faturas e baixas do IXC, ainda não integrada.' },
};
export const KindTag = ({ kind, source }: { kind: ValueKind; source?: string }) => <Chip tone={KIND[kind].tone} title={source ? `${KIND[kind].title} Fonte: ${source}` : KIND[kind].title}>{KIND[kind].label}</Chip>;

/** Um número com rótulo, natureza (contratado/projeção/...) e origem. */
export function Fact({ label, value, kind, source, hint, strong }: { label: string; value: ReactNode; kind?: ValueKind; source?: string; hint?: ReactNode; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={clsx('num mt-0.5 flex flex-wrap items-center gap-2 text-ink', strong ? 'text-xl font-extrabold' : 'text-md font-bold')}>
        {strong ? <span className="min-w-0 flex-1"><FitText as="span" className={clsx(kind === 'indisponivel' && 'text-faint')}>{kind === 'indisponivel' ? '—' : value}</FitText></span> : <span className={clsx('min-w-0 break-words', kind === 'indisponivel' && 'text-faint')}>{kind === 'indisponivel' ? '—' : value}</span>}
        {kind && <KindTag kind={kind} source={source} />}
      </dd>
      {hint && <p className="mt-0.5 text-2xs text-muted">{hint}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ resumo executivo

export function ExecutiveSummary({ a }: { a: Analysis }) {
  const e = a.executive;
  const base = a.kind.kind === 'base';
  return (
    <section className="card overflow-hidden" aria-labelledby="exec-h">
      <div className="flex flex-wrap items-center gap-3 bg-navy px-5 py-3 text-white">
        <h2 id="exec-h" className="text-md font-bold">Resumo para o aprovador</h2>
        <span className="rounded-sm bg-white/10 px-2 py-0.5 text-xs font-semibold">{e.kindLabel}</span>
        {e.decisionAsked && <p className="ml-auto text-sm font-semibold text-lime">{e.decisionAsked}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 md:grid-cols-3 2xl:grid-cols-4">
        <Fact label="Cliente" value={e.customer} />
        {base ? (
          <>
            <Fact label="Classe estratégica" value={e.classKey ?? 'Não classificado'} />
            <Fact label="Perfil pagador" value={e.payerProfile ?? 'Não informado'} />
            <Fact label="Tempo de relacionamento" value={e.relationshipMonths === null ? '—' : fmtMonths(e.relationshipMonths)} />
            <Fact label="Total histórico pago" value="—" kind="indisponivel" source={e.totalPaid?.source} />
            <Fact label="Receita mensal atual" value={brl(e.monthlyRevenueCents)} kind="contratado" />
            <Fact label="Contratos ativos" value={e.activeContracts ?? 0} />
          </>
        ) : (
          <>
            <Fact label="Potencial comercial" value={e.potential ?? 'Não classificado'} />
            <Fact label="Margem prevista" value={pct(e.newMarginBp)} kind="estimado" />
            <Fact label="Receita em 12 meses" value={brl(a.projections.revenue12mCents)} kind="projetado" />
            <Fact label="Payback" value={months(e.paybackMonths)} kind="estimado" />
            <Fact label="Viabilidade" value={e.viabilityComplete ? 'Completa' : 'Incompleta'} />
          </>
        )}
        <Fact label="Receita incremental" value={e.incrementalRevenueCents === null ? '—' : `${brl(e.incrementalRevenueCents)}/mês`} kind="projetado" />
        <Fact label="Investimento" value={brl(e.investmentCents)} kind="estimado" />
        {base && <Fact label="Margem antes → depois" value={`${pct(e.marginBeforeBp)} → ${pct(e.marginAfterBp)}`} kind="estimado" />}
        <Fact label="Desconto" value={pct(a.margin.discount.bp)} hint={`Alçada ${APPROVAL_LEVEL_LABELS[a.policy.required.level]}: até ${pct(a.policy.limits.find((l) => l.level === a.policy.required.level)?.maxDiscountBp ?? 0)}${a.policy.required.exceptional ? ' — fora da política' : ''}`} />
        <div className="col-span-2 min-w-0 md:col-span-3 2xl:col-span-2">
          <dt className="text-xs text-muted">Risco identificado</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">{e.risk.length ? e.risk.map((r) => <Chip key={r} className="max-w-full !whitespace-normal" tone="orange">{r}</Chip>) : <span className="text-sm text-muted">Nenhum registrado</span>}</dd>
        </div>
        <div className="col-span-2 min-w-0 md:col-span-3 2xl:col-span-4">
          <dt className="text-xs text-muted">Justificativa comercial</dt>
          <dd className="mt-0.5 text-md text-ink">{e.justification ?? <span className="text-muted">Ainda não há pedido de aprovação.</span>}</dd>
        </div>
      </dl>
    </section>
  );
}

// ------------------------------------------------------------------ parecer

const GROUPS: { key: keyof Omit<Analysis['opinion'], 'summary'>; label: string; icon: ReactNode; tone: string }[] = [
  { key: 'favorable', label: 'Pontos favoráveis', icon: <CheckCircle2 className="h-4 w-4" />, tone: 'text-[#15803D]' },
  { key: 'attention', label: 'Pontos de atenção', icon: <AlertTriangle className="h-4 w-4" />, tone: 'text-[#C2610C]' },
  { key: 'financial', label: 'Impacto financeiro', icon: <TrendingUp className="h-4 w-4" />, tone: 'text-primary' },
  { key: 'strategic', label: 'Impacto estratégico', icon: <Target className="h-4 w-4" />, tone: 'text-purple' },
  { key: 'pending', label: 'Informações pendentes', icon: <CircleDashed className="h-4 w-4" />, tone: 'text-muted' },
  { key: 'authority', label: 'Alçada necessária', icon: <Scale className="h-4 w-4" />, tone: 'text-ink' },
];
export function OpinionPanel({ a }: { a: Analysis }) {
  return (
    <Section title={<span className="inline-flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" aria-hidden />Parecer de apoio à decisão</span>}>
      <p className="mb-4 rounded-md border-l-4 border-l-primary bg-primary-soft/50 px-4 py-3 text-md text-ink">{a.opinion.summary}</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {GROUPS.map((g) => (
          <div key={g.key}>
            <h3 className={clsx('mb-1.5 flex items-center gap-1.5 text-sm font-bold', g.tone)}>{g.icon}{g.label}</h3>
            {a.opinion[g.key].length ? (
              <ul className="space-y-1.5">{a.opinion[g.key].map((it: OpinionItem, i) => <li key={i} className="text-sm text-text">{it.text} <span className="text-2xs text-faint">— {it.source}</span></li>)}</ul>
            ) : <p className="text-sm text-faint">Nada a apontar.</p>}
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">Montado só com os dados desta página; cada item mostra a origem. A decisão é do aprovador com alçada.</p>
    </Section>
  );
}

// ------------------------------------------------------------------ inteligência do cliente (base)

export function CustomerIntelligence({ a }: { a: Analysis }) {
  const i = a.intelligence!;
  return (
    <section className="card overflow-hidden border-2 border-primary/25" aria-labelledby="intel-h">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-primary-soft/60 px-5 py-3">
        <h2 id="intel-h" className="flex items-center gap-2 text-lg font-extrabold text-ink"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden />Inteligência do Cliente</h2>
        <p className="text-xs text-muted">Contratado ≠ faturado ≠ recebido. Recebimentos dependem do IXC.</p>
      </div>
      <div className="space-y-5 p-5">
        <div>
          <h3 className="mb-2 text-sm font-bold text-ink">Histórico financeiro</h3>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-3 xl:grid-cols-4">
            <Fact label="Início do relacionamento" value={fmtDate(i.relationshipStart)} />
            <Fact label="Tempo de relacionamento" value={i.relationshipMonths === null ? '—' : fmtMonths(i.relationshipMonths)} />
            <Fact label="Receita mensal atual" value={brl(i.monthlyRevenueCents.value)} kind="contratado" source={i.monthlyRevenueCents.source} />
            <Fact label="Total efetivamente pago" value="—" kind="indisponivel" source={i.totalPaid.source} />
            <Fact label="Mensalidades pagas" value="—" kind="indisponivel" source={i.paidInstallments.source} />
            <Fact label="Inadimplência atual" value="—" kind="indisponivel" source={i.delinquency.source} hint={i.delinquency.cadastro} />
            <Fact label="Histórico de atrasos" value="—" kind="indisponivel" source={i.lateHistory.source} />
            <Fact label="Pontualidade" value="—" kind="indisponivel" source={i.punctuality.source} />
            <Fact label="LTV realizado" value="—" kind="indisponivel" source={i.ltvRealized.source} />
            <Fact label="LTV projetado" value={i.ltvProjectedCents ? brl(i.ltvProjectedCents.value) : '—'} kind={i.ltvProjectedCents ? 'projetado' : undefined} source={i.ltvProjectedCents?.source} hint={i.ltvProjectedCents ? undefined : 'Sem custos de todos os serviços ou sem vida média'} />
            <Fact label="CAC histórico" value={i.cacHistoricalCents ? brl(i.cacHistoricalCents.value) : '—'} kind={i.cacHistoricalCents ? 'estimado' : undefined} source={i.cacHistoricalCents?.source} />
            <Fact label="Payback do CAC" value={months(i.cacPaybackMonths)} kind={i.cacPaybackMonths !== null ? 'estimado' : undefined} />
            <Fact label="Rentabilidade realizada" value="—" kind="indisponivel" source={i.profitabilityRealized.source} />
            <Fact label="Faturado lançado em Contratos" value={brl(i.billedInCrmCents)} kind="observado" source="Lançamentos de faturamento (frequente/medição) em Gestão de Contratos" />
          </dl>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold text-ink">Serviços que compõem a receita atual</h3>
          {i.services.length === 0 ? <p className="text-sm text-muted">Nenhum serviço recorrente ativo{i.lifecycle === 'cancelado' ? ' (cliente cancelado)' : ''}.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs text-muted"><tr><th className="py-1.5 pr-3 font-medium">Serviço</th><th className="py-1.5 pr-3 font-medium">Origem</th><th className="py-1.5 pr-3 text-right font-medium">Mensal</th><th className="py-1.5 text-right font-medium">Custo estimado</th></tr></thead>
                <tbody>
                  {i.services.map((s) => (
                    <tr key={s.label} className="border-t border-line">
                      <td className="py-2 pr-3">{s.contractId ? <Link className="link" to={`/contracts/${s.contractId}`}>{s.label}</Link> : s.opportunityId ? <Link className="link" to={`/opportunities/${s.opportunityId}`}>{s.label}</Link> : s.label}</td>
                      <td className="py-2 pr-3 text-muted">{{ contrato: 'Contrato', venda: 'Venda sem contrato', cadastro: 'Cadastro (ERP)' }[s.source] ?? s.source}</td>
                      <td className="num py-2 pr-3 text-right text-ink">{brl(s.monthlyCents)}</td>
                      <td className="num py-2 text-right text-ink">{s.monthlyCostCents === null ? <span className="text-faint">sem custo</span> : brl(s.monthlyCostCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {i.nonRecurring.length > 0 && <p className="mt-2 text-xs text-muted">Fora da receita recorrente: {i.nonRecurring.map((n) => `${n.label} (${BILLING_TYPE_LABELS[n.billingType as BillingType] ?? n.billingType})`).join('; ')}.</p>}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold text-ink">Histórico de faturamento</h3>
          {i.billingHistory.length === 0 ? <p className="text-sm text-muted">Sem faturamento lançado no CRM. As faturas mensais virão da integração com o IXC.</p> : (
            <ul className="divide-y divide-line text-sm">{i.billingHistory.slice(0, 12).map((b, k) => <li key={k} className="flex justify-between gap-3 py-1.5"><span className="text-text">{fmtDate(b.occurredOn)} · {b.contract ?? ''} · {b.description}</span><span className="num font-semibold text-ink">{brl(b.amountCents)}</span></li>)}</ul>
          )}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ novo cliente

export function NewCustomerPanel({ a }: { a: Analysis }) {
  const o = a.opportunity;
  const c = a.customer;
  const v = a.economics;
  return (
    <Section title="Novo cliente: dados, potencial e viabilidade">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
          <Fact label="Cliente" value={c?.name ?? o.title} />
          <Fact label="Documento" value={c?.document ?? '—'} />
          <Fact label="Segmento" value={o.segment} />
          <Fact label="Região" value={[o.region, o.condominium, o.city].filter(Boolean).join(' · ') || '—'} />
          <Fact label="Origem" value={o.sourceName ?? o.campaignName ?? o.channel ?? '—'} />
          <Fact label="Lead criado em" value={c?.lead ? fmtDate(c.lead.createdAt) : '—'} hint={c?.lead?.lastInteractionNote ?? undefined} />
          <Fact label="Perfil comercial" value={[o.saleType ? `Venda ${o.saleType}` : null, o.channel].filter(Boolean).join(' · ') || '—'} />
          <Fact label="Produto" value={a.terms.planName ?? '—'} />
        </dl>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
          <Fact label="Mensalidade proposta" value={brl(a.terms.proposedMonthlyCents)} hint={a.terms.listMonthlyCents ? `Tabela: ${brl(a.terms.listMonthlyCents)}` : undefined} />
          <Fact label="Taxa de ativação" value={brl(a.terms.activationFeeCents)} />
          <Fact label="Investimento inicial" value={brl(v?.initialCents)} kind={v ? 'estimado' : undefined} hint="CAPEX com contingência (viabilidade econômica)" />
          <Fact label="Contribuição prevista" value={v?.contributionCents != null ? `${brl(v.contributionCents)}${v.mode === 'recorrente' ? '/mês' : ''}` : '—'} kind={v ? 'estimado' : undefined} hint={v?.marginPct != null ? `Margem de ${v.marginPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : undefined} />
          <Fact label="Payback descontado" value={months(v?.paybackMonths)} kind={v ? 'estimado' : undefined} />
          <Fact label="Receita projetada (12 meses)" value={brl(a.projections.revenue12mCents)} kind="projetado" />
          <Fact label="Receita na vigência" value={brl(a.projections.revenueLifetimeCents)} kind="projetado" hint={a.projections.ltvMonths ? `Vigência de ${a.projections.ltvMonths} meses` : 'Sem vigência na viabilidade econômica'} />
        </dl>
      </div>
      <ViabilityStrip a={a} />
    </Section>
  );
}

export function ViabilityStrip({ a }: { a: Analysis }) {
  const v = a.economics;
  const o = a.opportunity;
  const items: { ok: boolean | null; text: string }[] = [
    { ok: o.coverageStatus === 'elegivel' ? true : o.coverageStatus === 'inelegivel' ? false : null, text: `Cobertura: ${({ nao_consultada: 'não consultada', pendente: 'pendente', elegivel: 'atendida', inelegivel: 'sem cobertura', indeterminada: 'indeterminada' } as Record<string, string>)[o.coverageStatus] ?? o.coverageStatus}` },
    { ok: v ? v.verdict === 'viavel' : null, text: v ? `Viabilidade econômica no preço proposto: ${ECON_VERDICT_LABELS[v.verdict as keyof typeof ECON_VERDICT_LABELS] ?? v.verdict}` : 'Viabilidade econômica não calculada' },
    ...(v?.missing.length ? [{ ok: false, text: `Falta: ${v.missing.join(', ')}` }] : []),
  ];
  return (
    <div className="mt-4 flex flex-wrap gap-2" aria-label="Viabilidade da proposta">
      {items.map((it) => <Chip key={it.text} className="max-w-full !whitespace-normal" tone={it.ok === null ? 'neutral' : it.ok ? 'green' : 'orange'}>{it.text}</Chip>)}
    </div>
  );
}

// ------------------------------------------------------------------ contratos

const STATUS_TONE: Record<string, Tone> = { ativo: 'green', encerrado: 'neutral', em_validacao: 'blue', suspenso: 'orange' };
const STATUS_LABEL: Record<string, string> = { ativo: 'Ativo', encerrado: 'Encerrado', em_validacao: 'Em validação', suspenso: 'Suspenso' };
export function ContractsPanel({ a }: { a: Analysis }) {
  const list = a.contracts ?? [];
  return (
    <Section title={`Contratos e serviços (${list.length})`}>
      {list.length === 0 ? <p className="text-sm text-muted">Nenhum contrato em Gestão de Contratos para este cliente.</p> : (
        <ul className="space-y-3">
          {list.map((c) => (
            <li key={c.id} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/contracts/${c.id}`} className="inline-flex items-center gap-1 font-bold text-primary hover:underline">{c.number}<ExternalLink className="h-3.5 w-3.5" aria-hidden /></Link>
                <span className="min-w-0 flex-1 truncate text-sm text-text">{c.object}</span>
                <Chip tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Chip>
                <Chip>{BILLING_TYPE_LABELS[c.billingType as BillingType] ?? c.billingType}</Chip>
                {c.isThisNegotiation && <Chip tone="purple">Desta negociação</Chip>}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
                <div><dt className="text-2xs text-muted">Mensal</dt><dd className="num font-semibold text-ink">{brl(c.monthlyCents)}</dd></div>
                <div><dt className="text-2xs text-muted">Vigência</dt><dd className="text-ink">{fmtDate(c.startAt)} a {fmtDate(c.endAt)}</dd></div>
                <div><dt className="text-2xs text-muted">Etapa</dt><dd className="text-ink">{CONTRACT_STAGE_LABELS[c.stage as ContractStage] ?? c.stage}</dd></div>
                <div><dt className="text-2xs text-muted">Reajustes / renovações</dt><dd className="text-ink">{c.adjustments.length} / {c.renewals.length}</dd></div>
              </dl>
              {c.items.length > 0 && <p className="mt-1.5 text-xs text-muted">Itens: {c.items.map((i) => `${i.qty}× ${i.description} (${brl(i.unitCents)})`).join('; ')}</p>}
              {c.adjustments.length > 0 && <p className="mt-1 text-xs text-muted">Último reajuste: {fmtDate(c.adjustments.at(-1)!.at)} → {brl(c.adjustments.at(-1)!.monthlyCents)}</p>}
              {c.closure && <p className="mt-1 text-xs text-[#C2610C]">{c.closure.expected ? 'Encerramento previsto' : 'Encerrado'}{c.closure.at ? ` em ${fmtDate(c.closure.at)}` : ''}{c.closure.reason ? ` — ${c.closure.reason}` : ''}</p>}
              {c.pendencies.length > 0 && <p className="mt-1 text-xs text-danger">Pendências: {c.pendencies.join('; ')}</p>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ classificação

const DIM: ['classKey' | 'category' | 'profile' | 'payerProfile' | 'potential' | 'risk', string][] = [
  ['classKey', 'Classe estratégica'], ['category', 'Categoria'], ['profile', 'Perfil do cliente'], ['payerProfile', 'Perfil pagador'], ['potential', 'Potencial comercial'], ['risk', 'Risco'],
];
export function ClassificationPanel({ a }: { a: Analysis }) {
  const toast = useToast();
  const c = a.classification?.current ?? null;
  const ask = useMutation({
    mutationFn: () => api<{ activityId: string }>(`/contacts/${a.customer!.contactId}/classification/request-update`, { method: 'POST', body: { opportunityId: a.opportunity.id } }),
    onSuccess: () => toast({ tone: 'success', message: 'Tarefa de atualização cadastral criada' }),
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <Section
      title="Perfil e classificação estratégica"
      action={<div className="flex flex-wrap gap-2"><Link to={`/customers/${a.customer?.contactId}`} className="text-sm font-semibold text-primary hover:underline">Abrir cadastro</Link></div>}
    >
      {!c ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-line-strong p-4">
          <p className="text-md font-bold text-ink">Não classificado</p>
          <Button size="sm" loading={ask.isPending} onClick={() => ask.mutate()}>Pedir atualização cadastral</Button>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3 md:grid-cols-3">
            {DIM.map(([k, label]) => <Fact key={k} label={label} value={c[k] ?? '—'} />)}
            <Fact label="Segmento" value={a.customer?.segment ?? '—'} />
            <Fact label="Última classificação" value={fmtDate(c.classifiedAt)} />
            <Fact label="Responsável" value={c.classifiedBy ?? '—'} />
          </dl>
          {c.notes && <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-text"><span className="font-semibold">Observações estratégicas:</span> {c.notes}</p>}
          <div className="mt-3"><Button size="sm" variant="ghost" loading={ask.isPending} onClick={() => ask.mutate()}>Pedir atualização cadastral</Button></div>
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ margem e capacidade

export function MarginPanel({ a }: { a: Analysis }) {
  const m = a.margin;
  const base = a.kind.kind === 'base';
  const req = a.policy.required;
  const rows: [string, ReactNode, ReactNode, ReactNode][] = [
    ['Receita mensal', brl(m.current.revenueCents), m.incremental.revenueCents === null ? '—' : `${m.incremental.revenueCents >= 0 ? '+' : ''}${brl(m.incremental.revenueCents)}`, brl(m.after.revenueCents)],
    ['Custo mensal atribuível', m.current.costCents === null ? <span className="text-faint">incompleto</span> : brl(m.current.costCents), m.incremental.costCents === null ? '—' : brl(m.incremental.costCents), '—'],
    ['Margem de contribuição', m.current.marginCents === null ? <span className="text-faint">não calculável</span> : brl(m.current.marginCents), brl(m.incremental.marginCents), m.after.marginCents === null ? <span className="text-faint">não calculável</span> : brl(m.after.marginCents)],
    ['Margem (%)', pct(m.current.marginBp), '', pct(m.after.marginBp)],
  ];
  return (
    <Section title="Margem e capacidade de negociação">
      {!m.reliable && <p className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-[#9A4B00]"><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />A margem não pode ser calculada com segurança. {m.warnings.join(' ')}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="text-xs text-muted"><tr><th className="py-1.5 pr-3 font-medium"></th>{base && <th className="py-1.5 pr-3 text-right font-medium">Atual</th>}<th className="py-1.5 pr-3 text-right font-medium">{base ? 'Incremento da proposta' : 'Proposta'}</th>{base && <th className="py-1.5 text-right font-medium">Depois</th>}</tr></thead>
          <tbody>
            {rows.map(([label, cur, inc, after]) => (
              <tr key={label} className="border-t border-line">
                <th scope="row" className="py-2 pr-3 font-medium text-text">{label}</th>
                {base && <td className="num py-2 pr-3 text-right text-ink">{cur}</td>}
                <td className="num py-2 pr-3 text-right font-semibold text-ink">{label === 'Margem (%)' && !base ? pct(m.after.marginBp) : inc}</td>
                {base && <td className="num py-2 text-right font-semibold text-ink">{after}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 md:grid-cols-4">
        <Fact label="Investimento necessário" value={brl(m.incremental.investmentCents)} kind="estimado" />
        <Fact label="Payback incremental" value={months(m.incremental.paybackMonths)} kind="estimado" />
        {base && <Fact label="Variação de margem" value={m.variation.marginBpPoints === null ? '—' : `${m.variation.marginBpPoints > 0 ? '+' : ''}${(m.variation.marginBpPoints / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`} kind="estimado" />}
        <Fact label="Desconto solicitado" value={pct(m.discount.bp)} hint={m.discount.listCents ? `${brl(m.discount.listCents)} → ${brl(m.discount.proposedCents)}` : undefined} />
      </dl>
      <h3 className="mb-2 mt-5 text-sm font-bold text-ink">Política comercial (alçadas)</h3>
      <ol className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {APPROVAL_LEVELS.map((l) => {
          const lim = a.policy.limits.find((x) => x.level === l);
          const hit = req.level === l;
          return (
            <li key={l} className={clsx('rounded-md border px-3 py-2', hit ? 'border-primary bg-primary-soft' : 'border-line')}>
              <p className="text-xs text-muted">{APPROVAL_LEVEL_LABELS[l]}</p>
              <p className="num text-md font-bold text-ink">até {pct(lim?.maxDiscountBp ?? 0)}</p>
              {lim?.minMarginBp !== null && lim?.minMarginBp !== undefined && <p className="text-2xs text-muted">margem mín. {pct(lim.minMarginBp)}</p>}
              {hit && <p className="text-2xs font-bold text-primary">Alçada necessária{req.exceptional ? ' (excepcional)' : ''}</p>}
            </li>
          );
        })}
      </ol>
      {req.exceptional && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Fora da política comercial: exige aprovação excepcional da Diretoria.</p>}
      <p className="mt-3 text-xs text-muted">O total histórico pago nunca é usado como margem disponível para desconto. Custos atuais vêm da viabilidade calculada em cada venda (estimativa).</p>
    </Section>
  );
}

// ------------------------------------------------------------------ identidade

export function IdentityPanel({ a, onDecided }: { a: Analysis; onDecided: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (v: { otherContactId: string; decision: 'mesmo' | 'diferente' }) => api(`/opportunities/${a.opportunity.id}/approval/identity`, { method: 'POST', body: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approval', a.opportunity.id] }); onDecided(); toast({ tone: 'success', message: 'Decisão registrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const list = a.identity?.candidates ?? [];
  if (!list.length) return null;
  return (
    <Section title={`Cadastros parecidos (${list.length})`}>
      <p className="mb-3 text-sm text-muted">Mesmo CPF/CNPJ, telefone ou e-mail. Só entram na análise os marcados como “mesmo cliente”; nada é unificado sozinho.</p>
      <ul className="divide-y divide-line">
        {list.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <Link to={`/customers/${c.id}`} className="font-semibold text-ink hover:underline">{c.name}</Link>
              <p className="text-xs text-muted">{[c.document, c.phone, c.email, c.city, c.lifecycle].filter(Boolean).join(' · ')} — coincide: {c.match.join(', ') || 'vínculo registrado'}</p>
            </div>
            {c.decision && <Chip tone={c.decision === 'mesmo' ? 'green' : 'neutral'}>{c.decision === 'mesmo' ? 'Mesmo cliente' : 'Outro cliente'}</Chip>}
            <Button size="sm" variant={c.decision === 'mesmo' ? 'outline' : 'secondary'} disabled={decide.isPending} onClick={() => decide.mutate({ otherContactId: c.id, decision: 'mesmo' })}>É o mesmo</Button>
            <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ otherContactId: c.id, decision: 'diferente' })}>Não é</Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ------------------------------------------------------------------ históricos

export function HistoryPanel({ a }: { a: Analysis }) {
  const [tab, setTab] = useState<'negociacao' | 'relacionamento'>('negociacao');
  const items: TimelineItem[] = tab === 'negociacao' ? a.timelines.negotiation : a.timelines.relationship;
  return (
    <Section title="Histórico consolidado">
      <Tabs label="Histórico" className="mb-3" value={tab} onChange={setTab} tabs={[{ key: 'negociacao', label: 'Histórico desta negociação', count: a.timelines.negotiation.length }, { key: 'relacionamento', label: 'Histórico do relacionamento com o cliente', count: a.timelines.relationship.length }]} />
      {items.length === 0 ? <EmptyState title={tab === 'negociacao' ? 'Sem eventos' : 'Sem histórico anterior'} description={tab === 'relacionamento' ? 'Negociações, contratações, renovações, reajustes, cancelamentos e aprovações anteriores aparecem aqui.' : undefined} /> : (
        <ol className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {items.map((it, i) => (
            <li key={i} className="grid grid-cols-[92px_1fr] gap-3 border-l-2 border-line pl-3 text-sm">
              <span className="num text-xs text-muted">{fmtDateTime(it.at)}</span>
              <span>
                {it.link ? <Link to={it.link} className="font-semibold text-ink hover:underline">{it.title}</Link> : <span className="font-semibold text-ink">{it.title}</span>}
                {it.who && <span className="text-xs text-muted"> · {it.who}</span>}
                {it.detail && <span className="block text-xs text-muted">{it.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-xs text-muted">O chat interno da negociação não entra no histórico do cliente.</p>
    </Section>
  );
}

// ------------------------------------------------------------------ documentos e pareceres

export function DocumentsPanel({ a }: { a: Analysis }) {
  const decided = a.requests.filter((r) => r.decision && r.decision.decision !== 'substituida');
  return (
    <Section title="Documentos e pareceres">
      {a.attachments.length === 0 ? <p className="text-sm text-muted">Nenhum documento anexado.</p> : (
        <ul className="mb-4 space-y-1.5">
          {a.attachments.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted" aria-hidden />
              <a className="link" href={`/api/v1/opportunities/${a.opportunity.id}/approval/attachments/${f.id}`}>{f.filename}</a>
              <span className="text-xs text-muted">{f.kind === 'proposta' ? 'Proposta' : 'Anexo'} · {fmtDate(f.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="mb-1.5 text-sm font-bold text-ink">Pareceres e decisões anteriores</h3>
      {decided.length === 0 ? <p className="text-sm text-muted">Nenhum ainda.</p> : (
        <ul className="space-y-2">
          {decided.map((r) => (
            <li key={r.id} className="rounded-md bg-surface-2 px-3 py-2 text-sm">
              <span className="font-semibold text-ink">v{r.version} · {r.decision!.decision === 'aprovada' ? 'Aprovada' : r.decision!.decision === 'reprovada' ? 'Reprovada' : 'Correção solicitada'}</span>
              <span className="text-muted"> por {r.decision!.by} ({r.decision!.level ? APPROVAL_LEVEL_LABELS[r.decision!.level as keyof typeof APPROVAL_LEVEL_LABELS] : '—'}) em {fmtDateTime(r.decision!.at)}</span>
              {r.decision!.comment && <span className="block text-text">{r.decision!.comment}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function DataReference({ a }: { a: Analysis }) {
  return (
    <p className="text-xs text-muted">
      Dados de referência: {a.dataReference.map((d) => `${d.label} — ${d.source}${d.asOf ? ` (${fmtDateTime(d.asOf)})` : ''}`).join(' · ')}. Análise gerada em {fmtDateTime(a.generatedAt)}.
    </p>
  );
}
