import { Megaphone } from 'lucide-react';
import { useLookups } from '../lib/hooks';
import { PageHeader } from '../components/layout/PageHeader';
import { EmptyState } from '../components/ui/primitives';

export function CampaignsPage() {
  const lookups = useLookups();
  const items = lookups.data?.campaigns ?? [];
  return (
    <div className="w-full">
      <PageHeader icon={<Megaphone className="h-9 w-9" strokeWidth={2.2} />} title="Campanhas" subtitle="Campanhas usadas como origem de leads e oportunidades." />
      <section className="card p-5">
        {items.length === 0 ? (
          <EmptyState title="Nenhuma campanha cadastrada" description="Gestão de campanhas (orçamento, período e resultado) chega numa próxima fase. Hoje a campanha é só um rótulo de origem." />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {items.map((c) => <li key={c.id} className="py-3 font-semibold text-ink">{c.name}</li>)}
            </ul>
            <p className="mt-3 text-sm text-muted">Gestão de campanhas (orçamento, período e resultado) chega numa próxima fase. Hoje a campanha é só um rótulo de origem.</p>
          </>
        )}
      </section>
    </div>
  );
}
