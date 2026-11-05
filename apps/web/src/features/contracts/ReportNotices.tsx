/** Relatório mensal na ficha do contrato: o que foi combinado e o que já foi enviado (inclusão na rotina e lembretes). */
import { useQuery } from '@tanstack/react-query';
import { REPORT_CHANNEL_LABELS, REPORT_MESSAGE_LABELS, SECTOR_LABELS, nextReportDue, type ReportChannel, type ReportMessageKind, type ReportTerms } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { Chip, LoadingRows } from '../../components/ui/primitives';

export function ReportTermsText({ t }: { t: ReportTerms | null | undefined }) {
  const lookups = useLookups();
  if (!t?.required) return <>Não exige</>;
  const who = lookups.data?.users.find((u) => u.id === t.validatorId)?.name;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      Setor {t.sector ? SECTOR_LABELS[t.sector] : '—'} · até o dia {t.dueDay ?? '—'}
      <span className="block text-sm text-muted">Valida: {who ?? '—'} · {t.alertDaysBefore != null ? `alerta ${t.alertDaysBefore} dia(s) antes` : 'sem alerta antes'}{t.dueDay ? ` · próximo ${fmtDate(nextReportDue(t.dueDay, today))}` : ''}</span>
    </>
  );
}

type Row = { id: string; event: string; recipientName: string; channel: ReportChannel; toAddress: string | null; status: string; error: string | null; sentAt: string; openedAt: string | null; openCount: number };
const STATUS: Record<string, { label: string; tone: 'green' | 'red' | 'yellow' | 'neutral' }> = {
  enviado: { label: 'Enviado', tone: 'green' }, falhou: { label: 'Falhou', tone: 'red' }, nao_configurado: { label: 'Canal não configurado', tone: 'yellow' }, sem_contato: { label: 'Sem contato', tone: 'neutral' },
};

export function ReportNotices({ contractId }: { contractId: string }) {
  const q = useQuery({ queryKey: ['contract-report-notices', contractId], queryFn: () => api<{ items: Row[] }>(`/contracts/${contractId}/report-notices`) });
  if (q.isLoading) return <LoadingRows rows={2} />;
  const items = q.data?.items ?? [];
  return (
    <section aria-label="Relatório mensal: envios">
      <h2 className="mb-2 font-bold text-ink">Relatório mensal: avisos enviados</h2>
      {!items.length ? <p className="text-sm text-muted">Nenhum aviso de relatório mensal enviado.</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs text-muted"><tr><th className="py-2 pr-3 font-medium">Quando</th><th className="py-2 pr-3 font-medium">Mensagem</th><th className="py-2 pr-3 font-medium">Para</th><th className="py-2 pr-3 font-medium">Canal</th><th className="py-2 font-medium">Situação</th></tr></thead>
          <tbody>{items.map((n) => (
            <tr key={n.id} className="border-t border-line align-top">
              <td className="py-2 pr-3 whitespace-nowrap">{fmtDateTime(n.sentAt)}</td>
              <td className="py-2 pr-3">{REPORT_MESSAGE_LABELS[n.event.replace('relatorio_', '') as ReportMessageKind] ?? n.event}</td>
              <td className="py-2 pr-3">{n.recipientName}{n.toAddress && <span className="block text-xs text-muted">{n.toAddress}</span>}</td>
              <td className="py-2 pr-3">{REPORT_CHANNEL_LABELS[n.channel] ?? n.channel}</td>
              <td className="py-2"><Chip tone={STATUS[n.status]?.tone ?? 'neutral'}>{STATUS[n.status]?.label ?? n.status}</Chip>{n.openedAt && <span className="block text-xs text-muted">Aberto {fmtDateTime(n.openedAt)} ({n.openCount}x)</span>}{n.error && <span className="block text-xs text-danger">{n.error}</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
