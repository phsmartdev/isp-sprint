/**
 * Inteligência → Concorrentes: quem disputa conosco nos pregões, quanto ganha, contra nós e com que lances;
 * ao abrir um concorrente, cada pregão (lances dele e nossos, posição) e as ações que ele tomou.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { BID_ACTION_LABELS, PARTICIPANT_STATUS_LABELS, type BidActionKind, type ParticipantStatus } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime, fmtPct } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { EmptyState, ErrorState, Input, LoadingRows } from '../../components/ui/primitives';
import { Drawer } from '../../components/ui/overlay';

type Stats = { key: string; name: string; document: string | null; bids: number; lots: number; wins: number; winRate: number | null; ourWinsAgainst: number; theirWinsAgainstUs: number; avgBidCents: number | null; minBidCents: number | null; lastAt: string };
type Side = { bidCents: number | null; rank: number | null; status: ParticipantStatus; winner: boolean };
type Detail = {
  stats: Stats;
  pregoes: { opportunityId: string; code: number; title: string; contactName: string; orgao: string | null; edital: string | null; at: string; lots: { lot: string; participants: number; them: Side; us: Side | null; winner: { company: string; isUs: boolean; bidCents: number | null } | null }[] }[];
  actions: { opportunityId: string; company: string; kind: BidActionKind; lot: string | null; amountCents: number | null; description: string | null; occurredAt: string }[];
  actionsByKind: Partial<Record<BidActionKind, number>>;
};

const cnpj = (d: string | null) => (d && d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : '—');
const side = (x: Side | null) => (!x ? '—' : `${x.bidCents === null ? 'sem lance' : fmtBRL(x.bidCents)}${x.rank ? ` · ${x.rank}º` : x.status !== 'ativo' ? ` · ${PARTICIPANT_STATUS_LABELS[x.status].toLowerCase()}` : ''}`);

export function CompetitorsPanel() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['competitors', dq], queryFn: () => api<{ items: Stats[]; totals: { pregoes: number; competitors: number; ourLots: number; ourWins: number } }>(`/intelligence/competitors${qs({ q: dq || undefined })}`) });
  const t = list.data?.totals;
  return (
    <div className="space-y-4">
      <section aria-label="Resumo dos pregões" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[['Pregões registrados', t?.pregoes], ['Concorrentes', t?.competitors], ['Lotes que disputamos', t?.ourLots], ['Nossa taxa de vitória', t ? (t.ourLots ? fmtPct(t.ourWins / t.ourLots) : '—') : undefined]].map(([label, v]) => (
          <div key={label as string} className="card p-4"><p className="text-sm text-muted">{label}</p><p className="num whitespace-nowrap text-xl font-extrabold text-ink">{v ?? '…'}</p></div>
        ))}
      </section>
      <section className="card p-5" aria-label="Concorrentes">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-bold text-ink">Concorrentes nos pregões</h2><p className="text-sm text-muted">Montado a partir dos participantes registrados em cada licitação. O mesmo CNPJ conta como um concorrente só.</p></div>
          <div className="relative w-full max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden /><Input aria-label="Buscar concorrente" className="pl-9" placeholder="Nome ou CNPJ" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {list.isLoading ? <LoadingRows rows={5} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data!.items.length ? (
          <EmptyState title="Nenhum concorrente ainda" description="Registre os participantes na aba Pregão das oportunidades de licitação." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-xs text-muted"><tr>{['Concorrente', 'CNPJ', 'Pregões juntos', 'Vitórias dele', 'Taxa de vitória', 'Ganhamos dele', 'Perdemos para ele', 'Lance médio', 'Último pregão'].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {list.data!.items.map((c) => (
                  <tr key={c.key} className="border-t border-line hover:bg-surface-2">
                    <td className="px-2 py-2"><button type="button" className="text-left font-semibold text-primary hover:underline" onClick={() => setOpen(c.key)}>{c.name}</button></td>
                    <td className="num px-2 py-2 text-muted">{cnpj(c.document)}</td>
                    <td className="num px-2 py-2">{c.bids}</td>
                    <td className="num px-2 py-2">{c.wins} de {c.lots}</td>
                    <td className="num px-2 py-2 font-semibold">{c.winRate === null ? '—' : fmtPct(c.winRate)}</td>
                    <td className="num px-2 py-2 text-[#15803D]">{c.ourWinsAgainst}</td>
                    <td className="num px-2 py-2 text-danger">{c.theirWinsAgainstUs}</td>
                    <td className="num px-2 py-2">{c.avgBidCents === null ? '—' : fmtBRL(c.avgBidCents)}</td>
                    <td className="num px-2 py-2 text-muted">{fmtDate(c.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <CompetitorDrawer k={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function CompetitorDrawer({ k, onClose }: { k: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['competitor', k], enabled: !!k, queryFn: () => api<Detail>(`/intelligence/competitors/${encodeURIComponent(k!)}`) });
  const d = q.data;
  return (
    <Drawer open={!!k} onClose={onClose} title={d ? `Concorrente: ${d.stats.name}` : 'Concorrente'} width="lg">
      {q.isLoading ? <LoadingRows rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : d && (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {[['CNPJ', cnpj(d.stats.document)], ['Pregões juntos', String(d.stats.bids)], ['Vitórias dele', `${d.stats.wins} de ${d.stats.lots} lote(s)`], ['Taxa de vitória', d.stats.winRate === null ? '—' : fmtPct(d.stats.winRate)], ['Ganhamos dele', String(d.stats.ourWinsAgainst)], ['Perdemos para ele', String(d.stats.theirWinsAgainstUs)], ['Lance médio', d.stats.avgBidCents === null ? '—' : fmtBRL(d.stats.avgBidCents)], ['Menor lance', d.stats.minBidCents === null ? '—' : fmtBRL(d.stats.minBidCents)]].map(([l, v]) => (
              <div key={l} className="border border-line p-3"><dt className="text-xs text-muted">{l}</dt><dd className="num whitespace-nowrap font-bold text-ink">{v}</dd></div>
            ))}
          </dl>
          <section aria-label="Pregões com este concorrente">
            <h3 className="mb-2 text-md font-bold text-ink">Pregões</h3>
            <ul className="space-y-3">
              {d.pregoes.map((p) => (
                <li key={p.opportunityId} className="border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link className="font-semibold text-primary hover:underline" to={`/opportunities/${p.opportunityId}?aba=pregao`}>OP-{p.code} · {p.orgao || p.contactName}</Link>
                    <span className="num text-xs text-muted">{fmtDate(p.at)}{p.edital ? ` · edital ${p.edital}` : ''}</span>
                  </div>
                  <table className="mt-2 w-full text-left text-sm">
                    <thead className="text-xs text-muted"><tr><th className="py-1 font-medium">Lote</th><th className="py-1 font-medium">Ele</th><th className="py-1 font-medium">Nós</th><th className="py-1 font-medium">Vencedora</th></tr></thead>
                    <tbody>
                      {p.lots.map((l) => (
                        <tr key={l.lot} className="border-t border-line">
                          <td className="py-1">{l.lot}</td>
                          <td className="num py-1">{side(l.them)}</td>
                          <td className="num py-1">{side(l.us)}</td>
                          <td className="py-1">{l.winner ? `${l.winner.isUs ? 'Nós' : l.winner.company}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Ações do concorrente nos pregões">
            <h3 className="mb-2 text-md font-bold text-ink">Ações nos pregões</h3>
            {Object.keys(d.actionsByKind).length > 0 && <p className="mb-2 text-sm text-muted">{Object.entries(d.actionsByKind).map(([k, n]) => `${BID_ACTION_LABELS[k as BidActionKind]}: ${n}`).join(' · ')}</p>}
            {!d.actions.length ? <p className="text-sm text-muted">Nenhuma ação registrada para este concorrente.</p> : (
              <ol className="space-y-2">
                {d.actions.map((a, i) => {
                  const p = d.pregoes.find((x) => x.opportunityId === a.opportunityId);
                  return (
                    <li key={i} className="border-l-2 border-primary pl-3 text-sm">
                      <p><span className="font-semibold text-ink">{BID_ACTION_LABELS[a.kind]}</span>{a.amountCents !== null && <span className="num"> · {fmtBRL(a.amountCents)}</span>}{a.lot && <span className="text-muted"> · lote {a.lot}</span>}</p>
                      {a.description && <p className="whitespace-pre-line text-text">{a.description}</p>}
                      <p className="text-xs text-muted">{fmtDateTime(a.occurredAt)}{p ? ` · OP-${p.code}` : ''}</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
