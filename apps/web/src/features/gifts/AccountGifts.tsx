/** Ficha da conta → Brindes: quanto foi gasto com a conta (por kit, item e stakeholder) e os envios. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import { Button, EmptyState, ErrorState, LoadingRows } from '../../components/ui/primitives';
import { Link } from 'react-router-dom';
import { CONCESSION_KIND_LABELS, CONCESSION_STATE_LABELS, OUTCOME_LABELS, type ConcessionKind, type ConcessionState, type Outcome } from '@isp/domain';
import { SendModal, type GiftsData } from '../../pages/Gifts';

type Row = { key: string; name: string; qty: number; totalCents: number };
type Delivery = { id: string; occurredOn: string; kitName: string | null; categoryName: string | null; kits: number; items: { itemId: string; name: string; qty: number; unitCostCents: number }[]; totalCents: number; stakeholders: { id: string; name: string }[]; note: string | null; by: string | null; cancelled: boolean; cancelReason: string | null };
type Concession = { id: string; code: string; kind: ConcessionKind; description: string; eventName: string | null; state: ConcessionState; on: string; shareCents: number; totalCents: number; exception: boolean; outcome: Outcome; justification: string; requesterName: string; executorName: string | null; approverName: string | null };
export type AccountGiftsData = { consolidated: { totalCents: number; kits: number; deliveries: number; byKit: Row[]; byItem: Row[]; byStakeholder: Row[] }; deliveries: Delivery[]; concessions?: Concession[]; concessionSummary?: { executed: number; investedCents: number; yearExecuted: number; yearInvestedCents: number; exceptions: number; lastOn: string | null; byGroup: { brindes: number; apoios: number; patrocinios: number; outros: number } } };

const List = ({ title, rows, qty }: { title: string; rows: Row[]; qty: string }) => (
  <div className="border border-line p-4">
    <p className="mb-2 text-sm font-semibold text-ink">{title}</p>
    {!rows.length ? <p className="text-sm text-muted">—</p> : <ul className="space-y-1 text-sm">{rows.map((r) => <li key={r.key} className="flex justify-between gap-3"><span>{r.name} <span className="text-muted">· {r.qty} {qty}</span></span>{r.totalCents > 0 && <span className="num font-semibold">{fmtBRL(r.totalCents)}</span>}</li>)}</ul>}
  </div>
);

export function AccountGifts({ contactId, name }: { contactId: string; name: string }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['account-gifts', contactId], queryFn: () => api<AccountGiftsData>(`/accounts/${contactId}/brindes`) });
  const [sending, setSending] = useState(false);
  const canSend = can('campanhas', 'equipe');
  const gifts = useQuery({ queryKey: ['brindes'], enabled: sending, queryFn: () => api<GiftsData>('/brindes') });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { consolidated: c, deliveries, concessions = [], concessionSummary: cs } = q.data!;
  return (
    <div className="space-y-4">
      {cs && (
        <section aria-label="Concessões da conta" className="border border-line p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Concessões (brindes, apoios e patrocínios)</p>
            <Link className="text-sm font-semibold text-primary hover:underline" to="/brindes?t=compliance">Nova solicitação em Brindes → Compliance</Link>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {[['No ano', `${cs.yearExecuted} · ${fmtBRL(cs.yearInvestedCents)}`], ['Acumulado', `${cs.executed} · ${fmtBRL(cs.investedCents)}`], ['Brindes e kits', cs.byGroup.brindes], ['Apoios', cs.byGroup.apoios], ['Patrocínios', cs.byGroup.patrocinios], ['Exceções autorizadas', cs.exceptions], ['Última', cs.lastOn ? fmtDate(cs.lastOn) : '—']].map(([k, v]) => <div key={String(k)} className="flex gap-1.5"><dt className="text-muted">{k}</dt><dd className="num font-semibold text-ink">{v}</dd></div>)}
          </dl>
          {concessions.length > 0 && (
            <table className="mt-3 w-full text-left text-sm" aria-label="Concessões registradas na conta">
              <thead className="text-xs text-muted"><tr>{['Data', 'Concessão', 'Tipo', 'Valor na conta', 'Aprovou', 'Situação'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>{concessions.map((x) => (
                <tr key={x.id} className={`border-t border-line ${x.state === 'cancelado' ? 'opacity-50' : ''}`}>
                  <td className="num px-2 py-1.5">{fmtDate(x.on)}</td>
                  <td className="px-2 py-1.5"><Link className="font-semibold text-ink hover:underline" to={`/brindes?t=compliance&id=${x.id}`}>{x.code}</Link> · {x.description}{x.eventName && <span className="block text-xs text-muted">{x.eventName}</span>}</td>
                  <td className="px-2 py-1.5">{CONCESSION_KIND_LABELS[x.kind]}</td>
                  <td className="num px-2 py-1.5 font-semibold">{fmtBRL(x.shareCents)}{x.shareCents !== x.totalCents && <span className="block text-xs font-normal text-muted">de {fmtBRL(x.totalCents)}</span>}</td>
                  <td className="px-2 py-1.5">{x.approverName ?? '—'}</td>
                  <td className="px-2 py-1.5">{CONCESSION_STATE_LABELS[x.state]}<span className={`block text-xs ${x.exception ? 'text-[#C2610C]' : 'text-muted'}`}>{x.exception ? 'exceção autorizada' : OUTCOME_LABELS[x.outcome]}</span></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-8">
          <div><p className="text-sm text-muted">Gasto com brindes</p><p className="num text-2xl font-bold text-ink">{fmtBRL(c.totalCents)}</p></div>
          <div><p className="text-sm text-muted">Kits</p><p className="num text-2xl font-bold text-ink">{c.kits}</p></div>
          <div><p className="text-sm text-muted">Envios</p><p className="num text-2xl font-bold text-ink">{c.deliveries}</p></div>
        </div>
        {canSend && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setSending(true)}>Registrar envio</Button>}
      </div>
      {!deliveries.length ? <EmptyState title="Nenhum brinde enviado para esta conta" description={canSend ? 'Registre o kit enviado e quem recebeu.' : 'O Marketing registra os envios em Brindes.'} /> : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <List title="Por kit" rows={c.byKit} qty="kit(s)" />
            <List title="Por item" rows={c.byItem} qty="un." />
            <List title="Quem recebeu" rows={c.byStakeholder} qty="kit(s)" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Envios de brindes da conta">
              <thead className="text-xs text-muted"><tr>{['Data', 'Kit', 'Itens', 'Valor', 'Quem recebeu', 'Registrado por'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>{deliveries.map((d) => (
                <tr key={d.id} className={`border-t border-line ${d.cancelled ? 'opacity-50' : ''}`}>
                  <td className="num px-2 py-1.5">{fmtDate(d.occurredOn)}</td>
                  <td className="px-2 py-1.5">{d.kitName ? `${d.kits}× ${d.kitName}` : 'Itens avulsos'}{d.categoryName && <span className="block text-xs text-muted">{d.categoryName}</span>}{d.cancelled && <span className="block text-xs text-danger">cancelado: {d.cancelReason}</span>}</td>
                  <td className="px-2 py-1.5">{d.items.map((i) => `${i.qty}× ${i.name} (${fmtBRL(i.unitCostCents)})`).join(', ')}</td>
                  <td className="num px-2 py-1.5 font-semibold">{fmtBRL(d.totalCents)}</td>
                  <td className="px-2 py-1.5">{d.stakeholders.map((p) => p.name).join(', ') || '—'}</td>
                  <td className="px-2 py-1.5 text-muted">{d.by ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {sending && gifts.data && <SendModal d={gifts.data} account={{ id: contactId, name }} onClose={() => setSending(false)} />}
    </div>
  );
}

/** Na ficha do stakeholder: brindes que a pessoa recebeu. */
export function StakeholderGifts({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['account-gifts', 'stakeholder', id], queryFn: () => api<{ deliveries: Delivery[]; totalKits: number }>(`/stakeholders/${id}/brindes`) });
  const live = q.data?.deliveries.filter((d) => !d.cancelled) ?? [];
  if (!live.length) return null;
  return (
    <section aria-label="Brindes recebidos" className="border border-line p-4">
      <p className="mb-1 text-sm font-semibold text-ink">Brindes recebidos <span className="font-normal text-muted">· {q.data!.totalKits} kit(s)</span></p>
      <ul className="space-y-0.5 text-sm">{live.map((d) => <li key={d.id}><span className="num text-muted">{fmtDate(d.occurredOn)}</span> · {d.kitName ? `${d.kits}× ${d.kitName}` : d.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</li>)}</ul>
    </section>
  );
}
