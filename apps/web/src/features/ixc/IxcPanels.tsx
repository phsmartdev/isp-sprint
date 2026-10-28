/** Abas Financeiro e Atendimentos/OS da conta: dados lidos do IXC na hora (somente leitura). */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { fmtBRL, fmtDate } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import { Chip, EmptyState, ErrorState, LoadingRows } from '../../components/ui/primitives';

type Client = { id: string; name: string; via: 'codigo' | 'documento' } | null;
type Invoice = { id: string; documento: string | null; vencimento: string | null; pagamento: string | null; status: string; statusLabel: string; valorCents: number; abertoCents: number; vencida: boolean; diasAtraso: number };
type Fin = { enabled: false } | { enabled: true; client: null } | { enabled: true; client: NonNullable<Client>; total: number; invoices: Invoice[]; summary: { abertoCents: number; abertas: number; vencidoCents: number; vencidas: number; maiorAtraso: number; recebidoCents: number } };
type Order = { id: string; protocolo: string | null; assunto: string | null; statusLabel: string; prioridade: string | null; abertura: string | null; agenda: string | null; fechamento: string | null; mensagem: string | null; aberta: boolean };
type Os = { enabled: false } | { enabled: true; client: null } | { enabled: true; client: NonNullable<Client>; total: number; orders: Order[]; open: number };

function NotLinked({ enabled }: { enabled: boolean }) {
  const { can } = useAuth();
  if (!enabled) return <EmptyState title="Integração com o IXC desligada" description="Faturas e ordens de serviço aparecem aqui quando a integração com o IXC for ligada." action={can('configuracoes', 'total') ? <Link className="link" to="/settings/integrations">Configurar a integração</Link> : undefined} />;
  return <EmptyState title="Cliente não encontrado no IXC" description="Nenhum cliente do IXC com o mesmo código ou CPF/CNPJ desta conta. Confira o CPF/CNPJ no cadastro." />;
}
const Origin = ({ c }: { c: NonNullable<Client> }) => <p className="mb-3 text-xs text-muted">Cliente {c.id} no IXC · {c.name} · encontrado pelo {c.via === 'codigo' ? 'código do IXC' : 'CPF/CNPJ'} · somente leitura</p>;

export function IxcFinance({ contactId }: { contactId: string }) {
  const q = useQuery({ queryKey: ['ixc', 'financeiro', contactId], queryFn: () => api<Fin>(`/contacts/${contactId}/ixc/financeiro`), staleTime: 60_000 });
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  if (!d.enabled || !d.client) return <NotLinked enabled={d.enabled} />;
  const s = d.summary;
  return (
    <div>
      <Origin c={d.client} />
      <dl className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="border border-line p-3"><dt className="text-sm text-muted">Em aberto</dt><dd className="num text-xl font-extrabold text-ink">{fmtBRL(s.abertoCents)}</dd><dd className="text-xs text-muted">{s.abertas} fatura(s)</dd></div>
        <div className="border border-line p-3"><dt className="text-sm text-muted">Vencido</dt><dd className={`num text-xl font-extrabold ${s.vencidas ? 'text-danger' : 'text-ink'}`}>{fmtBRL(s.vencidoCents)}</dd><dd className="text-xs text-muted">{s.vencidas ? `${s.vencidas} fatura(s) · maior atraso ${s.maiorAtraso} dia(s)` : 'Nada vencido'}</dd></div>
        <div className="border border-line p-3"><dt className="text-sm text-muted">Recebido (faturas abaixo)</dt><dd className="num text-xl font-extrabold text-ink">{fmtBRL(s.recebidoCents)}</dd></div>
      </dl>
      {!d.invoices.length ? <EmptyState title="Nenhuma fatura no IXC" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Vencimento', 'Documento', 'Situação', 'Valor', 'Em aberto', 'Pagamento'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{d.invoices.map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="num px-3 py-2">{fmtDate(i.vencimento)}</td>
                <td className="px-3 py-2">{i.documento ?? `#${i.id}`}</td>
                <td className="px-3 py-2"><Chip tone={i.vencida ? 'red' : i.status === 'R' ? 'green' : i.status === 'C' ? 'neutral' : i.status === 'P' ? 'orange' : 'blue'}>{i.vencida ? `Vencida · ${i.diasAtraso} d` : i.statusLabel}</Chip></td>
                <td className="num px-3 py-2">{fmtBRL(i.valorCents)}</td>
                <td className="num px-3 py-2 font-semibold">{i.abertoCents ? fmtBRL(i.abertoCents) : '—'}</td>
                <td className="num px-3 py-2">{fmtDate(i.pagamento)}</td>
              </tr>
            ))}</tbody>
          </table>
          {d.total > d.invoices.length && <p className="mt-2 text-xs text-muted">Mostrando as {d.invoices.length} faturas mais recentes de {d.total}.</p>}
        </div>
      )}
    </div>
  );
}

export function IxcOrders({ contactId }: { contactId: string }) {
  const q = useQuery({ queryKey: ['ixc', 'atendimentos', contactId], queryFn: () => api<Os>(`/contacts/${contactId}/ixc/atendimentos`), staleTime: 60_000 });
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  if (!d.enabled || !d.client) return <NotLinked enabled={d.enabled} />;
  return (
    <div>
      <Origin c={d.client} />
      <p className="mb-3 text-sm text-ink"><b>{d.open}</b> ordem(ns) de serviço em andamento · {d.total} no total</p>
      {!d.orders.length ? <EmptyState title="Nenhuma ordem de serviço no IXC" /> : (
        <ul className="divide-y divide-line rounded-md border border-line">{d.orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold text-ink">{o.assunto ?? 'Ordem de serviço'} <span className="text-sm font-normal text-muted">· OS {o.id}{o.protocolo ? ` · protocolo ${o.protocolo}` : ''}</span></p>
              {o.mensagem && <p className="line-clamp-2 text-sm text-text">{o.mensagem}</p>}
              <p className="text-xs text-muted">Aberta em {fmtDate(o.abertura)}{o.agenda ? ` · agendada para ${fmtDate(o.agenda)}` : ''}{o.fechamento ? ` · finalizada em ${fmtDate(o.fechamento)}` : ''}</p>
            </div>
            <div className="flex shrink-0 gap-1.5">{o.prioridade && <Chip tone={o.prioridade === 'Crítica' || o.prioridade === 'Alta' ? 'red' : 'neutral'}>{o.prioridade}</Chip>}<Chip tone={o.aberta ? 'orange' : 'green'}>{o.statusLabel}</Chip></div>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
