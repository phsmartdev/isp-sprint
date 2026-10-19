/** Novo contrato: a partir da oportunidade fechada (dados do CRM) ou escolhendo o cliente. */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileSignature, Search } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { useAuth } from '../../auth/AuthProvider';
import { Breadcrumb, Button, EmptyState, ErrorState, Input, LoadingRows, Notice } from '../../components/ui/primitives';
import { ContractForm, formFrom, payloadOf, type FormState } from '../../features/contracts/ContractForm';
import { errMsg, type Version } from '../../features/contracts/shared';

type Prefill = {
  opportunity: { id: string; code: number; title: string; stage: string };
  client: { name: string; document: string | null; segment: string; email: string | null; phone: string | null };
  existingContractId: string | null; won: boolean;
  suggestion: { kind: 'publico' | 'privado'; legalRegime: 'privado' | 'lei_14133'; commercialOwnerId: string; version: Partial<Version> };
};
type Contact = { id: string; name: string; phone: string | null; email: string | null; segment: string };

export function NewContractPage() {
  const nav = useNavigate();
  const { me } = useAuth();
  const [params] = useSearchParams();
  const oppId = params.get('opportunityId');
  const pre = useQuery({ queryKey: ['contract-prefill', oppId], enabled: !!oppId, queryFn: () => api<Prefill>(`/contracts/prefill${qs({ opportunityId: oppId })}`) });
  const [f, setF] = useState<FormState>(() => formFrom({ commercialOwnerId: me?.user.id }, { termMonths: 12, items: [] }));
  const [contact, setContact] = useState<Contact | null>(null);
  const [search, setSearch] = useState('');
  const dq = useDebounced(search, 300);
  const found = useQuery({ queryKey: ['contacts-search', dq], enabled: !oppId && dq.length >= 2, queryFn: () => api<{ items: Contact[] }>(`/contacts${qs({ q: dq })}`) });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (pre.data) setF(formFrom({ kind: pre.data.suggestion.kind, legalRegime: pre.data.suggestion.legalRegime, commercialOwnerId: pre.data.suggestion.commercialOwnerId }, pre.data.suggestion.version)); }, [pre.data]);
  const create = useMutation({
    mutationFn: () => { const p = payloadOf(f); return api<{ id: string }>('/contracts', { method: 'POST', body: { ...p.header, initialBalanceCents: p.initialBalanceCents, opportunityId: oppId, contactId: oppId ? null : contact?.id ?? null, version: p.version } }); },
    onSuccess: (r) => nav(`/contracts/${r.id}`),
    onError: (e) => { setError(errMsg(e)); window.scrollTo({ top: 0, behavior: 'smooth' }); },
  });
  if (oppId && pre.isLoading) return <div className="card"><LoadingRows rows={8} /></div>;
  if (oppId && pre.isError) return <ErrorState error={pre.error} onRetry={() => pre.refetch()} />;
  const p = pre.data;
  return (
    <div className="mx-auto w-full max-w-5xl">
      <Breadcrumb items={[{ label: 'Gestão de Contratos', to: '/contracts' }, { label: 'Novo contrato' }]} />
      <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-ink">Novo contrato</h1>
      <p className="mb-4 text-md text-muted">O cliente vem do cadastro do CRM. Depois de salvar, valide o cadastro para iniciar ERP, provisionamento e implantação.</p>
      {error && <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {p && (
        <div className="mb-4 space-y-2">
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div><p className="text-sm text-muted">Oportunidade de origem</p><p className="font-semibold text-ink"><Link className="link" to={`/opportunities/${p.opportunity.id}`}>OP-{p.opportunity.code}</Link> · {p.client.name}{p.client.document ? ` · ${p.client.document}` : ''}</p><p className="text-sm text-text">{[p.client.email, p.client.phone].filter(Boolean).join(' · ')}</p></div>
          </div>
          {p.existingContractId && <Notice tone="warning">Esta oportunidade já tem contrato. <Link className="link" to={`/contracts/${p.existingContractId}`}>Abrir contrato</Link></Notice>}
          {!p.won && <Notice tone="warning">A oportunidade ainda não está como venda fechada. O contrato é cadastrado depois da conclusão com o contrato assinado.</Notice>}
        </div>
      )}
      {!oppId && (
        <section className="card mb-4 p-4">
          <h2 className="mb-2 font-bold text-ink">Cliente</h2>
          {contact ? (
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-ink">{contact.name}<span className="font-normal text-muted">{contact.phone ? ` · ${contact.phone}` : ''}{contact.email ? ` · ${contact.email}` : ''}</span></p><Button size="sm" onClick={() => setContact(null)}>Trocar</Button></div>
          ) : (
            <>
              <div className="relative max-w-md"><label htmlFor="nc-q" className="sr-only">Buscar cliente</label><Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted" aria-hidden /><Input id="nc-q" className="h-12 pl-10" placeholder="Nome, telefone ou e-mail do cliente" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
              {found.data && (found.data.items.length ? (
                <ul className="mt-2 max-w-md divide-y divide-line rounded-md border border-line">{found.data.items.map((c) => <li key={c.id}><button className="w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => { setContact(c); if (c.segment === 'governamental') setF((x) => ({ ...x, kind: 'publico', legalRegime: 'lei_14133' })); }}><span className="font-semibold text-ink">{c.name}</span><span className="block text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(' · ')}</span></button></li>)}</ul>
              ) : <div className="mt-2 max-w-md"><EmptyState title="Nenhum cliente encontrado" description="Cadastre o cliente em Clientes ou parta da oportunidade fechada." /></div>)}
            </>
          )}
        </section>
      )}
      <ContractForm value={f} onChange={(x) => setF((cur) => ({ ...cur, ...x }))} />
      <div className="sticky bottom-0 mt-4 flex justify-end gap-2 border-t border-line bg-bg/95 py-3 backdrop-blur">
        <Button onClick={() => nav(-1)}>Cancelar</Button>
        <Button variant="primary" size="lg" icon={<FileSignature className="h-5 w-5" />} loading={create.isPending} disabled={(!oppId && !contact) || !!p?.existingContractId || (p && !p.won) || !f.number.trim() || !f.object.trim() || !f.commercialOwnerId} onClick={() => { setError(null); create.mutate(); }}>Cadastrar contrato</Button>
      </div>
    </div>
  );
}
