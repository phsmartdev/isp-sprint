/** Relatório: ocupação das portas da CTO por condomínio e os clientes que ocupam cada porta. */
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { EmptyState, ErrorState, LoadingRows } from '../components/ui/primitives';

type Row = { id: string; name: string; regionName: string; ports: number | null; used: number; free: number | null; rate: number | null; clients: { opportunityId: string; code: number; contactName: string; block: string | null; unit: string | null; wonAt: string | null; ownerName: string }[] };
const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)}%`);

export function PortsReport() {
  const q = useQuery({ queryKey: ['reports', 'ports'], queryFn: () => api<{ total: number; used: number; rate: number | null; items: Row[] }>('/reports/ports') });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  if (!d.items.length) return <div className="card"><EmptyState title="Nenhum condomínio cadastrado" description="Cadastre os condomínios e o total de portas da CTO em Configurações → Área de atendimento." /></div>;
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-sm text-muted">Portas cadastradas</p><p className="num text-2xl font-extrabold text-ink">{d.total}</p></div>
        <div className="card p-5"><p className="text-sm text-muted">Portas ocupadas</p><p className="num text-2xl font-extrabold text-ink">{d.used}</p></div>
        <div className="card p-5"><p className="text-sm text-muted">Taxa de ocupação</p><p className="num text-2xl font-extrabold text-ink">{pct(d.rate)}</p><p className="text-xs text-muted">Só condomínios com total de portas informado</p></div>
      </section>
      <section className="card overflow-hidden">
        <div className="px-5 pb-3 pt-4"><h2 className="text-md font-bold text-ink">Portas da CTO por condomínio</h2><p className="text-sm text-muted">Venda fechada ocupa uma porta; cliente cancelado libera. Clique para ver quem ocupa.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Condomínio', 'Região', 'Ocupadas', 'Livres', 'Ocupação', ''].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {d.items.map((r) => (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer border-t border-line hover:bg-surface-2" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="px-5 py-3 font-semibold text-ink">{r.name}</td>
                    <td className="px-5 py-3 text-text">{r.regionName}</td>
                    <td className="num px-5 py-3 text-ink">{r.used}{r.ports != null && <span className="text-muted"> de {r.ports}</span>}</td>
                    <td className={`num px-5 py-3 ${r.free === 0 ? 'font-bold text-danger' : 'text-text'}`}>{r.free ?? '—'}</td>
                    <td className="px-5 py-3">
                      {r.rate == null ? <span className="text-xs text-muted">Informe as portas</span> : (
                        <div className="flex items-center gap-2"><div className="h-2 w-28 overflow-hidden rounded-full bg-surface-2"><div className={`h-full ${r.rate >= 0.9 ? 'bg-danger' : r.rate >= 0.7 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${Math.min(100, r.rate * 100)}%` }} /></div><span className="num text-ink">{pct(r.rate)}</span></div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-sm text-primary">{open === r.id ? 'Ocultar' : `Ver clientes (${r.clients.length})`}</td>
                  </tr>
                  {open === r.id && (
                    <tr className="bg-surface-2/50">
                      <td colSpan={6} className="px-5 py-3">
                        {!r.clients.length ? <p className="text-sm text-muted">Nenhum cliente visível para o seu perfil.</p> : (
                          <ul className="grid grid-cols-1 gap-1 md:grid-cols-2">
                            {r.clients.map((c) => <li key={c.opportunityId} className="text-sm"><Link className="link font-semibold" to={`/opportunities/${c.opportunityId}`}>{c.contactName}</Link> <span className="text-muted">{c.block ? `Bl. ${c.block}` : ''}{c.unit ? ` · Ap. ${c.unit}` : ''} · desde {fmtDate(c.wonAt)} · {c.ownerName}</span></li>)}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
