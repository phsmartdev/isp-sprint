/** ABM Fase 7 — aba Inteligência (indicadores e cobertura por conta) e cartão de cobertura na Conta 360. */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, CircleAlert } from 'lucide-react';
import {
  ABM_PRIORITIES, ABM_PRIORITY_LABELS, ABM_STATUSES, ABM_STATUS_LABELS, ABM_TIERS, ABM_TIER_LABELS, COMMERCIAL_STATUSES, COMMERCIAL_STATUS_LABELS, COVERAGE_LEVEL_LABELS,
  type AbmPriority, type AbmStatus, type AbmTier, type CommercialStatus, type CoverageLevel,
} from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { useLookups, useUrlState } from '../../lib/hooks';
import { EmptyState, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { FitText } from '../../components/ui/FitText';
import { useAuth } from '../../auth/AuthProvider';
import { CommercialChip, PriorityChip, StatusChip } from './shared';

type Coverage = { score: number; level: CoverageLevel; gaps: string[]; people: number; items?: { key: string; label: string; weight: number; score: number; detail: string; gap: string | null }[] };
type Intel = {
  period: { from: string; to: string };
  accounts: { id: string; contactId: string; name: string; ownerName: string; status: AbmStatus; priority: AbmPriority; tier: AbmTier; commercial: CommercialStatus; lastContactOn: string | null; daysSinceInteraction: number | null; openOpps: number; openValueCents: number; interactions: number; runsOpen: number; coverage: Coverage }[];
  prospeccao: { total: number; byStatus: Record<string, number>; byCommercial: Record<string, number>; newInPeriod: number; noContact30: number } | null;
  stakeholders: { total: number; perAccount: number; decisores: number; accountsWithoutDecisor: number; assessedPct: number | null } | null;
  plays: { running: number; concludedInPeriod: number; successRate: number | null; lateSteps: number; byPlay: { name: string; running: number; concluded: number; succeeded: number }[] } | null;
  relacionamento: { interactionsInPeriod: number; noContact30: number; highInfluence: number | null; highInfluenceClose: number | null } | null;
  comercial: { openOpps: number; openValueCents: number; wonInPeriod: number; wonValueCents: number; activeContracts: number; accountsWithOpp: number } | null;
  pesquisas: { responses: number; nps: number | null } | null;
  cobertura: { avg: number; byLevel: Record<string, number> } | null;
};
const LEVEL_BAR: Record<CoverageLevel, string> = { boa: 'bg-success', parcial: 'bg-warning', baixa: 'bg-danger' };
const LEVEL_TEXT: Record<CoverageLevel, string> = { boa: 'text-success', parcial: 'text-[#9A5B00]', baixa: 'text-danger' };

const Tile = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="card min-w-0 p-4"><p className="text-xs text-muted">{label}</p><FitText className="num whitespace-nowrap font-display text-2xl font-bold text-ink">{value}</FitText>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
);
function Bars<K extends string>({ data, labels, order }: { data: Record<string, number>; labels: Record<K, string>; order: readonly K[] }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
  return <ul className="space-y-1">{order.filter((k) => data[k]).map((k) => <li key={k} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-2 text-sm"><span className="truncate">{labels[k]}</span><span className="h-2 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-primary" style={{ width: `${(data[k]! / total) * 100}%` }} /></span><span className="num text-right text-xs text-muted">{data[k]}</span></li>)}</ul>;
}
const Section = ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title} className="space-y-2"><h3 className="font-bold text-ink">{title}</h3>{children}</section>;

export function AbmIntelligence() {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useUrlState({ from: `${today.slice(0, 7)}-01`, to: today, owner: '', priority: '', tier: '' });
  const users = useLookups().data?.users ?? [];
  const params = { from: f.from || undefined, to: f.to || undefined, owner: f.owner || undefined, priority: f.priority || undefined, tier: f.tier || undefined };
  const q = useQuery({ queryKey: ['abm', 'intel', params], placeholderData: keepPreviousData, queryFn: () => api<Intel>(`/abm/intelligence${qs(params)}`) });
  const d = q.data;
  const { can } = useAuth();
  return (
    <div className="space-y-5">
      {can('desempenho') && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-muted">
          <span>Os números do ABM também viram indicadores com meta e semáforo na Gestão de Times.</span>
          <Link to="/desempenho/metas" className="font-semibold text-primary hover:underline">Ver metas</Link>
          {can('configuracoes', 'total') && <Link to="/settings/desempenho?t=indicadores" className="font-semibold text-primary hover:underline">Criar indicadores do ABM</Link>}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="De" htmlFor="ai-f"><Input id="ai-f" type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} /></FormField>
        <FormField label="Até" htmlFor="ai-t"><Input id="ai-t" type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} /></FormField>
        <FormField label="Responsável" htmlFor="ai-o"><Select id="ai-o" value={f.owner} onChange={(e) => setF({ owner: e.target.value })}><option value="">Todos</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
        <FormField label="Prioridade" htmlFor="ai-p"><Select id="ai-p" value={f.priority} onChange={(e) => setF({ priority: e.target.value })}><option value="">Todas</option>{ABM_PRIORITIES.map((p) => <option key={p} value={p}>{ABM_PRIORITY_LABELS[p]}</option>)}</Select></FormField>
        <FormField label="Tier" htmlFor="ai-tr"><Select id="ai-tr" value={f.tier} onChange={(e) => setF({ tier: e.target.value })}><option value="">Todos</option>{ABM_TIERS.map((t) => <option key={t} value={t}>{ABM_TIER_LABELS[t]}</option>)}</Select></FormField>
      </div>
      {q.isLoading ? <LoadingRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !d?.prospeccao ? <div className="card"><EmptyState title="Nenhuma conta no ABM com estes filtros" description="Inclua contas no ABM ou ajuste os filtros." /></div> : (
        <>
          <Section title="Prospecção">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Tile label="Contas no ABM" value={d.prospeccao.total} /><Tile label="Novas no período" value={d.prospeccao.newInPeriod} /><Tile label="Sem contato há mais de 30 dias" value={d.prospeccao.noContact30} /><Tile label="Com oportunidade aberta" value={d.comercial!.accountsWithOpp} /></div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="card p-4"><p className="mb-2 text-sm font-semibold text-ink">Status ABM</p><Bars data={d.prospeccao.byStatus} labels={ABM_STATUS_LABELS} order={ABM_STATUSES} /></div>
              <div className="card p-4"><p className="mb-2 text-sm font-semibold text-ink">Status comercial</p><Bars data={d.prospeccao.byCommercial} labels={COMMERCIAL_STATUS_LABELS} order={COMMERCIAL_STATUSES} /></div>
            </div>
          </Section>
          <div className="grid gap-5 xl:grid-cols-2">
            <Section title="Stakeholders"><div className="grid grid-cols-2 gap-3"><Tile label="Pessoas mapeadas" value={d.stakeholders!.total} hint={`${d.stakeholders!.perAccount} por conta`} /><Tile label="Decisores mapeados" value={d.stakeholders!.decisores} /><Tile label="Contas sem decisor" value={d.stakeholders!.accountsWithoutDecisor} /><Tile label="Influência avaliada" value={d.stakeholders!.assessedPct === null ? '—' : `${d.stakeholders!.assessedPct}%`} hint="avaliação feita pela equipe" /></div></Section>
            <Section title="Relacionamento"><div className="grid grid-cols-2 gap-3"><Tile label="Interações no período" value={d.relacionamento!.interactionsInPeriod} hint="atividades concluídas nas contas" /><Tile label="Sem contato há mais de 30 dias" value={d.relacionamento!.noContact30} /><Tile label="Pessoas de influência alta" value={d.relacionamento!.highInfluence ?? '—'} /><Tile label="…com relacionamento forte ou moderado" value={d.relacionamento!.highInfluenceClose ?? '—'} /></div></Section>
            <Section title="Plays">
              <div className="grid grid-cols-2 gap-3"><Tile label="Em andamento" value={d.plays!.running} /><Tile label="Concluídos no período" value={d.plays!.concludedInPeriod} /><Tile label="Taxa de sucesso" value={d.plays!.successRate === null ? '—' : `${d.plays!.successRate}%`} /><Tile label="Etapas atrasadas" value={d.plays!.lateSteps} /></div>
              {!!d.plays!.byPlay.length && <div className="card p-4"><ul className="space-y-1 text-sm">{d.plays!.byPlay.map((p) => <li key={p.name} className="flex flex-wrap justify-between gap-2"><span>{p.name}</span><span className="num text-xs text-muted">{p.running} em andamento · {p.concluded} concluído(s){p.concluded ? ` · ${Math.round((p.succeeded / p.concluded) * 100)}% com sucesso` : ''}</span></li>)}</ul></div>}
            </Section>
            <Section title="Comercial e pesquisas"><div className="grid grid-cols-2 gap-3"><Tile label="Pipeline aberto" value={fmtBRL(d.comercial!.openValueCents)} hint={`${d.comercial!.openOpps} oportunidade(s)`} /><Tile label="Ganho no período" value={fmtBRL(d.comercial!.wonValueCents)} hint={`${d.comercial!.wonInPeriod} oportunidade(s)`} /><Tile label="Contratos ativos" value={d.comercial!.activeContracts} /><Tile label="NPS no período" value={d.pesquisas!.nps ?? '—'} hint={`${d.pesquisas!.responses} resposta(s)`} /></div></Section>
          </div>
          <Section title="Cobertura de stakeholders por conta">
            <p className="text-sm text-muted">Média <b className="num text-ink">{d.cobertura!.avg}</b> de 100 · {(['baixa', 'parcial', 'boa'] as CoverageLevel[]).map((l) => `${d.cobertura!.byLevel[l] ?? 0} ${COVERAGE_LEVEL_LABELS[l].toLowerCase()}`).join(' · ')}. Contas com cobertura mais baixa primeiro.</p>
            <div className="card scroll-thin overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-surface-2 text-xs text-muted"><tr>{['Conta', 'Cobertura', 'O que falta', 'Status', 'Último contato', 'Pipeline aberto', 'Plays'].map((h) => <th key={h} className="px-3 py-2.5 font-medium">{h}</th>)}</tr></thead>
                <tbody>{d.accounts.map((a) => (
                  <tr key={a.id} className="border-t border-line align-top">
                    <td className="px-3 py-2.5"><Link className="font-semibold text-primary hover:underline" to={`/abm/contas/${a.id}`}>{a.name}</Link><span className="block text-xs text-muted">{a.ownerName}</span><PriorityChip p={a.priority} /></td>
                    <td className="px-3 py-2.5"><div className="flex w-36 items-center gap-2"><span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><span className={clsx('block h-full rounded-full', LEVEL_BAR[a.coverage.level])} style={{ width: `${a.coverage.score}%` }} /></span><span className={clsx('num text-xs font-bold', LEVEL_TEXT[a.coverage.level])}>{a.coverage.score}</span></div><span className="text-xs text-muted">{a.coverage.people} pessoa(s)</span></td>
                    <td className="max-w-xs px-3 py-2.5 text-xs">{a.coverage.gaps.length ? <ul className="list-disc space-y-0.5 pl-4">{a.coverage.gaps.slice(0, 2).map((g) => <li key={g}>{g}</li>)}{a.coverage.gaps.length > 2 && <li className="text-muted">+{a.coverage.gaps.length - 2}</li>}</ul> : <span className="text-success">Nada pendente</span>}</td>
                    <td className="px-3 py-2.5"><span className="flex flex-col items-start gap-1"><StatusChip s={a.status} /><CommercialChip s={a.commercial} /></span></td>
                    <td className="num px-3 py-2.5">{a.lastContactOn ? fmtDate(a.lastContactOn) : 'nunca'}</td>
                    <td className="num px-3 py-2.5">{a.openOpps ? fmtBRL(a.openValueCents) : '—'}</td>
                    <td className="num px-3 py-2.5">{a.runsOpen}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

/** Cartão de cobertura na Conta 360 (Resumo): nota, cada item e o que falta, com atalho para resolver. */
export function CoverageCard({ contactId, abmId }: { contactId: string; abmId: string }) {
  const q = useQuery({ queryKey: ['abm', 'coverage', contactId], queryFn: () => api<Coverage>(`/accounts/${contactId}/coverage`) });
  const c = q.data;
  if (!c) return null;
  const fix: Record<string, string> = { papeis: 'stakeholders', avaliacao: 'stakeholders', relacionamento: 'plays', defensor: 'plays', departamentos: 'estrutura' };
  return (
    <section className="card p-4 text-sm" aria-label="Cobertura de stakeholders">
      <div className="flex items-baseline justify-between gap-2"><h2 className="font-bold text-ink">Cobertura de stakeholders</h2><span className={clsx('num font-display text-2xl font-bold', LEVEL_TEXT[c.level])}>{c.score}</span></div>
      <div className="my-2 h-2 overflow-hidden rounded-full bg-surface-2"><div className={clsx('h-full rounded-full', LEVEL_BAR[c.level])} style={{ width: `${c.score}%` }} /></div>
      <p className="text-xs text-muted">{COVERAGE_LEVEL_LABELS[c.level]} · calculada a partir do que a equipe registrou</p>
      <ul className="mt-2 space-y-1.5">{(c.items ?? []).map((i) => (
        <li key={i.key} className="flex gap-2">{i.gap ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden /> : <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />}<span><b className="text-ink">{i.label}</b> · {i.detail}{i.gap && <span className="block text-xs text-muted">{i.gap} · <Link className="font-semibold text-primary hover:underline" to={`/abm/contas/${abmId}?t=${fix[i.key] ?? 'stakeholders'}`}>resolver</Link></span>}</span></li>
      ))}</ul>
    </section>
  );
}
