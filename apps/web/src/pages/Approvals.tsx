/** Fila de aprovações: o que cabe na minha alçada e os pedidos que eu fiz. */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fmtBRL, fmtDateTime } from '../lib/format';
import { useUrlState } from '../lib/hooks';
import { Chip, EmptyState, ErrorState, LoadingRows, Tabs, type Tone } from '../components/ui/primitives';
import { PageHeader } from '../components/layout/PageHeader';
import { pct } from '../features/approval/Panels';
import { ECON_VERDICT_LABELS, type EconVerdict } from '@isp/domain';

type Item = { id: string; oppId: string; version: number; code: number; title: string; contactName: string; requesterName: string; negotiationLabel: string; proposedMonthlyCents: number; discountBp: number; requiredLabel: string; exceptional: boolean; createdAt: string; status: string; canDecide: boolean };
const TONE: Record<string, Tone> = { pendente: 'yellow', aprovada: 'green', reprovada: 'red', correcao: 'orange' };
const LABEL: Record<string, string> = { pendente: 'Aguardando decisão', aprovada: 'Aprovada', reprovada: 'Reprovada', correcao: 'Correção solicitada' };

export const useApprovalCount = () => useQuery({ queryKey: ['approvals', 'pendentes'], queryFn: () => api<{ items: Item[]; toDecide: number; myLevelLabel: string }>('/approvals?status=pendentes'), refetchInterval: 60_000 });

type EconPending = { opportunityId: string; code: number; title: string; account: string; submittedAt: string; submittedByName: string | null; verdict: EconVerdict; priceCents: number | null; mode: 'recorrente' | 'pontual'; paybackMonths: number | null; marginPct: number | null; mine: boolean };

/** Viabilidades econômicas enviadas para a gestão decidir (só aparece para quem pode aprovar). */
function EconomicsQueue() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['econ-pending'], queryFn: () => api<{ items: EconPending[] }>('/economics/pending'), refetchInterval: 60_000 });
  if (!q.data?.items.length) return null;
  return (
    <section className="card mb-4 overflow-x-auto" aria-labelledby="h-econ-q">
      <h2 id="h-econ-q" className="px-4 pb-2 pt-4 text-md font-bold text-ink">Viabilidades econômicas aguardando decisão ({q.data.items.length})</h2>
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="bg-surface-2 text-xs text-muted"><tr>{['Oportunidade', 'Cliente', 'Preço', 'Margem', 'Payback descontado', 'Resultado', 'Enviada por'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {q.data.items.map((r) => (
            <tr key={r.opportunityId} className="cursor-pointer border-t border-line hover:bg-surface-2/60" onClick={() => nav(`/opportunities/${r.opportunityId}?aba=viabilidade`)}>
              <td className="px-4 py-2.5"><span className="font-semibold text-ink">OP-{r.code}</span><span className="block text-xs text-muted">{r.title}</span></td>
              <td className="px-4 py-2.5 text-ink">{r.account}</td>
              <td className="num px-4 py-2.5 text-ink">{fmtBRL(r.priceCents)}{r.mode === 'recorrente' ? '/mês' : ''}</td>
              <td className="num px-4 py-2.5 text-ink">{r.marginPct == null ? '—' : `${r.marginPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</td>
              <td className="num px-4 py-2.5 text-ink">{r.paybackMonths == null ? '—' : `${r.paybackMonths.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`}</td>
              <td className="px-4 py-2.5"><Chip tone={r.verdict === 'viavel' ? 'green' : 'red'}>{ECON_VERDICT_LABELS[r.verdict]}</Chip></td>
              <td className="px-4 py-2.5 text-text">{r.submittedByName ?? '—'}{r.mine && <Chip className="ml-1">você enviou</Chip>}<span className="block text-xs text-muted">{fmtDateTime(r.submittedAt)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ApprovalsPage() {
  const nav = useNavigate();
  const [f, setF] = useUrlState({ status: 'pendentes' });
  const q = useQuery({ queryKey: ['approvals', f.status], queryFn: () => api<{ items: Item[]; toDecide: number; myLevelLabel: string }>(`/approvals${qs({ status: f.status })}`) });
  return (
    <div className="w-full">
      <PageHeader icon={<Scale className="h-9 w-9" strokeWidth={2.4} />} title="Aprovações" subtitle={q.data ? `Sua alçada: ${q.data.myLevelLabel}. ${q.data.toDecide} pedido(s) aguardando você.` : 'Negociações aguardando decisão.'} />
      <EconomicsQueue />
      <Tabs label="Situação" className="mb-4" value={f.status} onChange={(s) => setF({ status: s })} tabs={[{ key: 'pendentes', label: 'Pendentes' }, { key: 'todas', label: 'Todas' }]} />
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!q.data ? <div className="card"><LoadingRows /></div> : q.data.items.length === 0 ? <div className="card"><EmptyState title={f.status === 'pendentes' ? 'Nada aguardando decisão' : 'Nenhum pedido de aprovação'} description="Os pedidos aparecem aqui quando um vendedor solicita aprovação na oportunidade." /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Oportunidade', 'Cliente', 'Tipo', 'Valor proposto', 'Desconto', 'Alçada', 'Pedido por', 'Situação'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {q.data.items.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-surface-2/60" onClick={() => nav(`/opportunities/${r.oppId}/aprovacao`)}>
                  <td className="px-4 py-2.5"><span className="font-semibold text-ink">OP-{r.code}</span> <span className="text-xs text-muted">v{r.version}</span></td>
                  <td className="px-4 py-2.5 text-ink">{r.contactName}</td>
                  <td className="px-4 py-2.5 text-text">{r.negotiationLabel}</td>
                  <td className="num px-4 py-2.5 text-ink">{fmtBRL(r.proposedMonthlyCents)}/mês</td>
                  <td className="num px-4 py-2.5 text-ink">{pct(r.discountBp)}</td>
                  <td className="px-4 py-2.5">{r.requiredLabel}{r.exceptional && <Chip tone="red" className="ml-1">excepcional</Chip>}</td>
                  <td className="px-4 py-2.5 text-text">{r.requesterName}<span className="block text-xs text-muted">{fmtDateTime(r.createdAt)}</span></td>
                  <td className="px-4 py-2.5"><Chip tone={TONE[r.status] ?? 'neutral'}>{r.canDecide ? 'Aguardando você' : LABEL[r.status] ?? r.status}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
