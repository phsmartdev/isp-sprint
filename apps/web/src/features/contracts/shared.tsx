/** Tipos e peças compartilhadas do módulo Gestão de Contratos. */
import clsx from 'clsx';
import { BILLING_TYPE_LABELS, CONTRACT_STAGE_LABELS, type BillingType, type ContractStage } from '@isp/domain';
import { ApiError } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { Chip } from '../../components/ui/primitives';

export type ContractItem = { planId: string | null; description: string; qty: number; unitCents: number };
export type Guarantee = { type: string; amountCents: number | null; insurer: string | null; policy: string | null; expiresAt: string | null; renewalAt: string | null };
export type PublicTerms = { agency: string | null; processNumber: string | null; modality: string | null; commitmentNote: string | null; budgetLine: string | null; extensionMaxMonths: number | null };
export type Version = {
  id: string; version: number; changeKind: string; reason: string | null; number: string; object: string;
  signedAt: string | null; startAt: string | null; endAt: string | null; termMonths: number | null; activationAt: string | null; billingStartAt: string | null; renewalAt: string | null;
  monthlyCents: number; totalCents: number | null; billingDay: number | null; billingTerms: string | null; items: ContractItem[];
  guarantee: Guarantee | null; publicTerms: PublicTerms | null; adjustmentIndex: string | null; adjustmentBaseDate: string | null; adjustmentRule: string | null; specialConditions: string | null;
  createdAt: string; createdBy: string | null;
};
export type StepState = { doneAt: string; doneBy: string; doneByName: string; note: string | null; value: Record<string, unknown> | null; skipped?: boolean };
export type Process = { id: string; kind: 'implantacao' | 'renovacao' | 'reajuste' | 'encerramento'; cycleKey: string; status: 'aberto' | 'concluido' | 'cancelado'; steps: Record<string, StepState>; data: Record<string, unknown>; dueAt: string | null; outcome: string | null; openedAt: string; closedAt: string | null };
export type Alert = { id: string; kind: string; label: string; cycleKey: string; dueAt: string | null; status: 'aberto' | 'concluido' | 'cancelado'; detail: string | null; emails: { to: string; status: string; error: string | null }[]; activityIds: string[]; createdAt: string; resolvedAt: string | null; resolution: string | null; ownerId: string | null; ownerName?: string | null; number?: string; clientName?: string; code?: number; contractId: string };
export type Pend = { alerts: number; overdue: number; steps: number };
export type ContractRow = {
  id: string; code: number; stage: ContractStage; kind: 'publico' | 'privado'; billingType: BillingType; legalRegime: string; contactId: string; clientName: string; segment: string; opportunityId: string | null;
  ownerId: string; ownerName: string | null; validatedAt: string | null; renewed: boolean; closureExpected: boolean; closureAt: string | null; nextAction: string | null; nextActionAt: string | null;
  number: string; object: string; startAt: string | null; endAt: string | null; monthlyCents: number; totalCents: number | null; termMonths: number | null; daysLeft: number | null; pendencies: Pend; erpRef: string | null;
};
export type ContractDetail = {
  id: string; code: number; stage: ContractStage; kind: 'publico' | 'privado'; billingType: BillingType; legalRegime: 'privado' | 'lei_8666' | 'lei_14133' | 'outro'; contactId: string; customerId: string | null; opportunityId: string | null;
  commercialOwnerId: string; operationalOwnerId: string | null; csmId: string | null; commercialOwnerName: string | null; operationalOwnerName: string | null; csmName: string | null;
  validatedAt: string | null; validatedByName: string | null; erpRef: string | null; renewed: boolean; closureExpected: boolean; closureReason: string | null; closureAt: string | null; legalLimitAt: string | null;
  closedAt: string | null; archivedAt: string | null; archiveLocation: string | null; archiveResponsibleName: string | null; finalNote: string | null; nextAction: string | null; nextActionAt: string | null;
  currentVersion: number; current: Version; versions: Version[];
  contact: { id: string; name: string; document: string | null; email: string | null; phone: string | null; segment: string; city: string | null };
  address: { street: string | null; number: string | null; district: string | null; city: string | null; state: string | null } | null;
  opportunity: { id: string; code: number; title: string; stage: string; handoffStage: string | null } | null;
  processes: Process[]; alerts: Alert[]; daysLeft: number | null; pendencies: Pend;
  permissions: { edit: boolean; manage: boolean; validate: boolean };
};

export const STAGE_TONE: Record<ContractStage, 'neutral' | 'blue' | 'green' | 'orange' | 'purple' | 'red' | 'yellow'> = {
  cadastro_validacao: 'yellow', implantacao: 'purple', vigente: 'green', renovacao: 'blue', reajuste: 'orange', encerramento: 'red', arquivado: 'neutral',
};
export function StageChip({ stage }: { stage: ContractStage }) {
  return <Chip tone={STAGE_TONE[stage]}>{CONTRACT_STAGE_LABELS[stage]}</Chip>;
}
export function DaysLeft({ days, archived }: { days: number | null; archived?: boolean }) {
  if (archived || days === null) return <span className="text-muted">—</span>;
  return <span className={clsx('num font-semibold', days < 0 ? 'text-danger' : days <= 30 ? 'text-danger' : days <= 60 ? 'text-[#C2610C]' : 'text-ink')}>{days < 0 ? `vencido há ${-days} d` : `${days} d`}</span>;
}
export function PendBadge({ p }: { p: Pend }) {
  const n = p.alerts + p.steps;
  if (!n) return <span className="text-sm text-muted">Nenhuma</span>;
  return <span className={clsx('text-sm font-semibold', p.overdue ? 'text-danger' : 'text-ink')}>{p.alerts ? `${p.alerts} alerta(s)` : ''}{p.alerts && p.steps ? ' · ' : ''}{p.steps ? `${p.steps} etapa(s)` : ''}{p.overdue ? ` · ${p.overdue} atrasado(s)` : ''}</span>;
}
export const errMsg = (e: unknown) => (e instanceof ApiError ? [e.problem.detail ?? e.message, ...(e.problem.errors ?? []).map((x) => x.message)].filter((v, i, a) => v && a.indexOf(v) === i).join(' ') : (e as Error).message);
export const dec = (n: number | null | undefined) => (n === null || n === undefined ? '' : (n / 100).toFixed(2).replace('.', ','));
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const KIND_LABEL = { publico: 'Público', privado: 'Privado' } as const;
export const CHANGE_LABEL: Record<string, string> = { cadastro: 'Cadastro', edicao: 'Edição', ativacao: 'Ativação/faturamento', renovacao: 'Renovação', reajuste: 'Reajuste', encerramento: 'Encerramento' };

/** Lista com barra proporcional, quantidade e valor mensal (sem cortar o rótulo). */
export function MoneyRows({ items, colorOf }: { items: { key: string; label: string; n: number; monthlyCents: number }[]; colorOf?: (key: string) => string }) {
  const max = Math.max(1, ...items.map((x) => x.monthlyCents));
  return (
    <ul className="space-y-2.5">
      {items.map((x) => (
        <li key={x.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 text-ink">{x.label} <span className="num text-muted">({x.n})</span></span><span className="num shrink-0 font-semibold text-ink">{fmtBRL(x.monthlyCents)}/mês</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${(x.monthlyCents / max) * 100}%`, background: colorOf?.(x.key) ?? '#2F5986', minWidth: x.n ? 4 : 0 }} /></div>
        </li>
      ))}
    </ul>
  );
}

export const TYPE_TONE: Record<BillingType, 'blue' | 'purple' | 'orange'> = { recorrente: 'blue', frequente: 'purple', medicao: 'orange' };
export const TYPE_COLOR: Record<BillingType, string> = { recorrente: '#2F5986', frequente: '#7C3AED', medicao: '#EA7A0C' };
export function TypeChip({ type }: { type: BillingType }) {
  return <Chip tone={TYPE_TONE[type]}>{BILLING_TYPE_LABELS[type]}</Chip>;
}
