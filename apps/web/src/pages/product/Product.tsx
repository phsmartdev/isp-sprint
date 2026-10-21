/** Produto: catálogo de planos e produtos para consulta de toda a equipe (edição em Configuração → Planos e produtos). */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { useAuth } from '../../auth/AuthProvider';
import { Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { PageHeader } from '../../components/layout/PageHeader';
import { FitText } from '../../components/ui/FitText';

type Plan = { id: string; name: string; line: string | null; segment: string; priceCents: number; speedMbps: number | null; products: { name: string; qty: number; unitPriceCents: number }[]; active: boolean; sourceSystem: string };
const SEG: Record<string, string> = { residencial: 'Residencial', empresarial: 'Empresarial', condominio: 'Condomínio', governo: 'Governo' };

export function ProductPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['catalog', 'plans'], queryFn: () => api<{ items: Plan[] }>('/catalog/plans') });
  const [f, setF] = useState({ q: '', segment: '', line: '' });
  const items = q.data?.items ?? [];
  const lines = useMemo(() => [...new Set(items.map((p) => p.line).filter(Boolean) as string[])].sort(), [items]);
  const shown = items.filter((p) => (!f.segment || p.segment === f.segment) && (!f.line || p.line === f.line) && (!f.q || p.name.toLowerCase().includes(f.q.toLowerCase())));
  return (
    <div>
      <PageHeader icon={<Package />} title="Produto" subtitle="Planos e produtos em vigor, para consultar preço, velocidade e o que cada oferta inclui." actions={can('configuracoes', 'total') ? <Link to="/settings/plans" className="text-sm font-semibold text-primary hover:underline">Editar catálogo</Link> : undefined} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Buscar" htmlFor="pd-q"><Input id="pd-q" className="w-60" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></FormField>
        <FormField label="Segmento" htmlFor="pd-s"><Select id="pd-s" value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })}><option value="">Todos</option>{[...new Set(items.map((p) => p.segment))].map((s) => <option key={s} value={s}>{SEG[s] ?? s}</option>)}</Select></FormField>
        {!!lines.length && <FormField label="Linha" htmlFor="pd-l"><Select id="pd-l" value={f.line} onChange={(e) => setF({ ...f, line: e.target.value })}><option value="">Todas</option>{lines.map((l) => <option key={l} value={l}>{l}</option>)}</Select></FormField>}
      </div>
      {q.isLoading ? <LoadingRows rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !shown.length ? <section className="card"><EmptyState title="Nenhum plano com esses filtros" /></section> : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <li key={p.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2"><h2 className="font-bold text-ink">{p.name}</h2><Chip tone="blue">{SEG[p.segment] ?? p.segment}</Chip></div>
              {p.line && <p className="text-xs text-muted">{p.line}</p>}
              <FitText className="num mt-2 text-2xl font-bold text-ink">{fmtBRL(p.priceCents)}<span className="text-sm font-normal text-muted">/mês</span></FitText>
              {p.speedMbps !== null && <p className="text-sm">{p.speedMbps >= 1000 ? `${p.speedMbps / 1000} Gbps` : `${p.speedMbps} Mbps`}</p>}
              {!!p.products.length && <ul className="mt-2 space-y-0.5 border-t border-line pt-2 text-sm">{p.products.map((x, i) => <li key={i} className="flex justify-between gap-2"><span>{x.qty > 1 ? `${x.qty}× ` : ''}{x.name}</span><span className="num text-muted">{fmtBRL(x.unitPriceCents)}</span></li>)}</ul>}
              {p.sourceSystem !== 'crm' && <p className="mt-2 text-xs text-muted">Origem: {p.sourceSystem}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
