/** Aba Contratos da conta: os contratos do cliente com situação, vigência e valor, ligando para a ficha. */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CONTRACT_STAGE_LABELS } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import { EmptyState, ErrorState, LoadingRows } from '../../components/ui/primitives';
import { DaysLeft, type ContractRow } from './shared';

export function AccountContracts({ contactId }: { contactId: string }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['contracts', 'account', contactId], enabled: can('contratos'), queryFn: () => api<{ items: ContractRow[] }>(`/contracts?contactId=${contactId}&pageSize=100`) });
  if (!can('contratos')) return <EmptyState title="Sem acesso a Contratos" description="Seu perfil não tem acesso à Gestão de Contratos." />;
  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data?.items ?? [];
  if (!items.length) return <EmptyState title="Nenhum contrato desta conta" description="Os contratos aparecem aqui quando são cadastrados na Gestão de Contratos." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs text-muted"><tr><th className="py-2 pr-3 font-medium">Contrato</th><th className="py-2 pr-3 font-medium">Situação</th><th className="py-2 pr-3 font-medium">Vigência</th><th className="py-2 pr-3 font-medium">Dias restantes</th><th className="py-2 text-right font-medium">Valor mensal</th></tr></thead>
        <tbody>{items.map((r) => (
          <tr key={r.id} className="border-t border-line align-top">
            <td className="py-2 pr-3"><Link className="font-semibold text-primary hover:underline" to={`/contracts/${r.id}`}>{r.number}</Link><span className="block max-w-[360px] truncate text-xs text-muted" title={r.object}>CT-{r.code} · {r.object}</span></td>
            <td className="py-2 pr-3">{CONTRACT_STAGE_LABELS[r.stage]}</td>
            <td className="num py-2 pr-3 whitespace-nowrap">{fmtDate(r.startAt)} a {fmtDate(r.endAt)}</td>
            <td className="py-2 pr-3"><DaysLeft days={r.daysLeft} archived={r.stage === 'arquivado'} /></td>
            <td className="num py-2 text-right font-semibold">{fmtBRL(r.monthlyCents)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
