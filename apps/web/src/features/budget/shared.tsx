/** Recursos e Orçamento: tipos, cabeçalho do módulo, seletores e indicadores visuais compartilhados. */
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Wallet } from 'lucide-react';
import { EXECUTION_BAND_INFO, type ExecutionBand } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { Select } from '../../components/ui/primitives';
import { PageHeader } from '../../components/layout/PageHeader';

export type Account = { id: string; parentId: string | null; code: string; name: string; nature: 'despesa' | 'receita'; description: string | null; active: boolean; leaf: boolean; level: number; path: string };
export type CostCenter = { id: string; code: string; name: string; leaderId: string | null; leaderName: string | null; memberIds: string[]; memberNames: string[]; active: boolean };
export type Supplier = { id: string; name: string; document: string | null; category: string | null; email: string | null; phone: string | null; notes: string | null; active: boolean };
export type Structure = { admin: boolean; accounts: Account[]; costCenters: CostCenter[]; suppliers: Supplier[]; users: { id: string; name: string }[] };
export type Totals = { approved: number; pending: number; draft: number; adjusted: number; adjustPending: number; realized: number; planned: number; available: number; pct: number | null; over: boolean; band: ExecutionBand | null };

export const useStructure = () => useQuery({ queryKey: ['budget', 'structure'], queryFn: () => api<Structure>('/budget/structure'), staleTime: 30_000 });
export const errMsg = (e: unknown) => (e as { detail?: string; message?: string })?.detail ?? (e as Error)?.message ?? 'Não foi possível concluir.';

/** Despesa sempre negativa (−), como no plano de contas. */
export const neg = (cents: number) => (cents ? `−${fmtBRL(Math.abs(cents))}` : fmtBRL(0));

const BAND_TONE: Record<ExecutionBand, { bar: string; text: string; chip: string }> = {
  subexecucao: { bar: 'bg-sky', text: 'text-[#1F7DB8]', chip: 'bg-sky-soft text-[#1F7DB8]' },
  adequada: { bar: 'bg-success', text: 'text-[#15803D]', chip: 'bg-success-soft text-[#15803D]' },
  risco: { bar: 'bg-warning', text: 'text-[#C2610C]', chip: 'bg-warning-soft text-[#C2610C]' },
  excedente: { bar: 'bg-danger', text: 'text-danger', chip: 'bg-danger-soft text-danger' },
};
export function BandChip({ band }: { band: ExecutionBand | null }) {
  if (!band) return <span className="text-xs text-muted">Sem planejado</span>;
  return <span className={clsx('inline-flex whitespace-nowrap px-2 py-0.5 text-xs font-semibold', BAND_TONE[band].chip)} title={EXECUTION_BAND_INFO[band].action}>{EXECUTION_BAND_INFO[band].label}</span>;
}
/** Barra de execução: preenchimento até 100% e marca da meta adequada (90%). */
export function ExecBar({ t, wide }: { t: Pick<Totals, 'pct' | 'over' | 'band'>; wide?: boolean }) {
  const pct = t.over ? 100 : Math.min(100, t.pct ?? 0);
  return (
    <div className={clsx('flex items-center gap-2', wide ? 'min-w-[180px]' : 'min-w-[120px]')}>
      <div className="relative h-2 flex-1 bg-surface-2" aria-hidden>
        <div className={clsx('h-full', t.band ? BAND_TONE[t.band].bar : 'bg-line-strong')} style={{ width: `${pct}%` }} />
        <span className="absolute -top-0.5 h-3 w-px bg-ink/40" style={{ left: '90%' }} />
      </div>
      <span className={clsx('w-12 text-right text-xs font-semibold tabular-nums', t.band ? BAND_TONE[t.band].text : 'text-muted')}>{t.over ? '>100%' : t.pct === null ? '—' : `${Math.round(t.pct)}%`}</span>
    </div>
  );
}

export function QuarterPicker({ year, quarter, onChange }: { year: number; quarter: number; onChange: (y: number, q: number) => void }) {
  const y0 = new Date().getFullYear();
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Trimestre">
      <Select aria-label="Ano" className="h-11 w-auto" value={year} onChange={(e) => onChange(Number(e.target.value), quarter)}>{[y0 - 1, y0, y0 + 1].map((y) => <option key={y} value={y}>{y}</option>)}</Select>
      <Select aria-label="Trimestre" className="h-11 w-auto" value={quarter} onChange={(e) => onChange(year, Number(e.target.value))}>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q}º trimestre</option>)}</Select>
    </div>
  );
}

export function CcSelect({ value, onChange, list, all = true, label = 'Centro de custo', className }: { value: string; onChange: (v: string) => void; list: CostCenter[]; all?: boolean; label?: string; className?: string }) {
  return (
    <Select aria-label={label} className={clsx('h-11 w-auto', className)} value={value} onChange={(e) => onChange(e.target.value)}>
      {all && <option value="">Todos os centros de custo</option>}
      {list.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
    </Select>
  );
}
/** Só subcategorias (analíticas) recebem planejamento e gasto; o rótulo mostra o caminho. */
export function AccountSelect({ value, onChange, accounts, id, required }: { value: string; onChange: (v: string) => void; accounts: Account[]; id?: string; required?: boolean }) {
  return (
    <Select id={id} required={required} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Escolha a subcategoria</option>
      {accounts.filter((a) => a.leaf && a.active).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.path.split(' › ').slice(1).join(' › ') || a.name}</option>)}
    </Select>
  );
}

const NAV = [
  { to: '/orcamento', label: 'Planejamento orçamentário', end: true },
  { to: '/orcamento/ferramentas', label: 'Ferramentas e equipamentos' },
  { to: '/orcamento/softwares', label: 'Softwares e licenças' },
  { to: '/orcamento/contratos', label: 'Contratos e assinaturas' },
  { to: '/orcamento/compras', label: 'Compras e fornecedores' },
  { to: '/orcamento/indicadores', label: 'Custos e indicadores' },
];
/** Cabeçalho comum das telas do módulo, com a navegação entre as seções. */
export function BudgetShell({ subtitle, actions, children }: { subtitle: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="w-full">
      <PageHeader icon={<Wallet className="h-9 w-9" strokeWidth={2.2} />} title="Recursos e Orçamento" subtitle={subtitle} actions={actions} />
      <nav aria-label="Seções de Recursos e Orçamento" className="scroll-thin mb-5 overflow-x-auto border-b border-line">
        <ul className="flex min-w-max gap-6">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} end={n.end} className={({ isActive }) => clsx('-mb-px block border-b-2 pb-3 pt-1 text-md font-semibold', isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}>{n.label}</NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'danger' | 'muted' }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={clsx('mt-0.5 text-xl font-bold tabular-nums', tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-muted">{sub}</dd>}
    </div>
  );
}
