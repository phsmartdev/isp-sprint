/** Orçamento ligado a um projeto ou campanha (lançamentos dos centros que a pessoa vê). Some se não houver acesso. */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { APPROVAL_STATE_LABELS, PAYMENT_FLAG_LABELS, type ApprovalState, type PaymentFlag } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import { LoadingRows } from '../../components/ui/primitives';

type Linked = { totals: Record<'planned' | 'approved' | 'committed' | 'realized' | 'paid' | 'balance', number>; rows: { id: string; code: string; what: string; month: string; costCenter: string; approvalState: ApprovalState; financial: PaymentFlag; planned: number; approved: number; realized: number; paid: number }[] };

export function LinkedBudget({ projectId, campaignId }: { projectId?: string; campaignId?: string }) {
  const { can, feature } = useAuth();
  const enabled = can('orcamento') && feature('orcamento.planejamento');
  const q = useQuery({ queryKey: ['budget', 'linked', projectId, campaignId], enabled, queryFn: () => api<Linked>(`/budget/linked${qs({ projectId, campaignId })}`) });
  if (!enabled) return null;
  if (q.isLoading) return <section className="card p-4"><LoadingRows rows={2} /></section>;
  if (!q.data) return null;
  const t = q.data.totals;
  return (
    <section className="card p-4" aria-label="Orçamento ligado">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-base font-bold text-ink">Orçamento ligado</h2><Link className="text-sm font-semibold text-primary hover:underline" to="/orcamento?t=central">Abrir na Central do orçamento</Link></div>
      <dl className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-6">
        {([['Planejado', t.planned], ['Aprovado', t.approved], ['Comprometido', t.committed], ['Realizado', t.realized], ['Pago', t.paid], ['Saldo', t.balance]] as const).map(([k, v]) => <div key={k} className="bg-surface px-3 py-2"><dt className="text-xs text-muted">{k}</dt><dd className="num font-bold text-ink">{fmtBRL(v)}</dd></div>)}
      </dl>
      {q.data.rows.length ? (
        <ul className="mt-3 divide-y divide-line text-sm">{q.data.rows.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span><span className="text-xs text-muted">{r.code} · {r.costCenter} · {r.month}</span> {r.what}</span><span className="text-xs text-muted">{APPROVAL_STATE_LABELS[r.approvalState]} · {PAYMENT_FLAG_LABELS[r.financial]} · <b className="num text-ink">{fmtBRL(r.approved || r.planned)}</b></span></li>)}</ul>
      ) : <p className="mt-3 text-sm text-muted">Nenhum lançamento do orçamento ligado ainda. Na Central do orçamento, escolha este item no campo {projectId ? 'Projeto' : 'Campanha'} do lançamento.</p>}
    </section>
  );
}
