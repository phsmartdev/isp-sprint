/** Configurações → Área de atendimento: regiões e os condomínios de cada uma. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Building2, MapPin, Plus } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';

type Region = { id: string; name: string; active: boolean };
type Condo = { id: string; regionId: string; name: string; cep: string | null; street: string | null; number: string | null; district: string | null; city: string | null; blocks: string[]; units: number | null; hasNetwork: boolean; ctoPorts: number | null; portsUsed: number; portsReserved: number; notes: string | null; active: boolean; opportunities: number; won: number };
const errMsg = (e: unknown) => (e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message);

export function AdminArea() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'area'], queryFn: () => api<{ regions: Region[]; condominiums: Condo[] }>('/admin/area') });
  const [regionName, setRegionName] = useState('');
  const [renaming, setRenaming] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Condo | { regionId: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const done = () => { qc.invalidateQueries({ queryKey: ['admin', 'area'] }); qc.invalidateQueries({ queryKey: ['area'] }); };
  const addRegion = useMutation({
    mutationFn: () => api('/admin/regions', { method: 'POST', body: { name: regionName } }),
    onSuccess: () => { setRegionName(''); done(); toast({ tone: 'success', message: 'Região cadastrada' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const patchRegion = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; active?: boolean }) => api(`/admin/regions/${id}`, { method: 'PATCH', body }),
    onSuccess: (_r, v) => { done(); setRenaming((x) => { const y = { ...x }; delete y[v.id]; return y; }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });

  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { regions, condominiums } = q.data!;
  const f = filter.trim().toLowerCase();
  const visible = (c: Condo) => (showInactive || c.active) && (!f || `${c.name} ${c.street ?? ''} ${c.district ?? ''} ${c.cep ?? ''}`.toLowerCase().includes(f));

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="text-lg font-bold text-ink">Área de atendimento</h2>
        <p className="mb-4 max-w-3xl text-sm text-muted">Organize a área em regiões e, dentro delas, os condomínios. No cadastro da oportunidade o vendedor escolhe o condomínio, o bloco e o apartamento; o endereço vem junto. Relatórios mostram vendas por região e condomínio.</p>
        <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (regionName.trim().length >= 2) addRegion.mutate(); }}>
          <Input aria-label="Nova região" className="max-w-xs" value={regionName} onChange={(e) => setRegionName(e.target.value)} placeholder="Ex.: Zona Sul" />
          <Button type="submit" variant="primary" icon={<Plus className="h-4 w-4" />} loading={addRegion.isPending}>Cadastrar região</Button>
          <span className="flex-1" />
          <Input aria-label="Buscar condomínio" className="max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar condomínio, rua ou CEP" />
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Mostrar inativos</label>
        </form>
        {!regions.length && <EmptyState title="Nenhuma região" description="Comece cadastrando a primeira região de atendimento." />}
      </section>

      {regions.filter((r) => showInactive || r.active).map((r) => {
        const condos = condominiums.filter((c) => c.regionId === r.id && visible(c));
        const total = condominiums.filter((c) => c.regionId === r.id && c.active).length;
        return (
          <section key={r.id} className={clsx('card overflow-hidden', !r.active && 'opacity-70')}>
            <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-4">
              <MapPin className="h-5 w-5 text-primary" aria-hidden />
              {renaming[r.id] !== undefined ? (
                <>
                  <Input aria-label="Nome da região" className="max-w-xs" value={renaming[r.id]} onChange={(e) => setRenaming({ ...renaming, [r.id]: e.target.value })} />
                  <Button size="sm" variant="primary" onClick={() => patchRegion.mutate({ id: r.id, name: renaming[r.id] })}>Salvar</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming((x) => { const y = { ...x }; delete y[r.id]; return y; })}>Cancelar</Button>
                </>
              ) : (
                <>
                  <h3 className="text-md font-bold text-ink">{r.name}</h3>
                  <span className="text-sm text-muted">{total} condomínio(s)</span>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming({ ...renaming, [r.id]: r.name })}>Renomear</Button>
                </>
              )}
              <span className="flex-1" />
              <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={r.active} onChange={() => patchRegion.mutate({ id: r.id, active: !r.active })} />Ativa</label>
              <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={!r.active} onClick={() => setEditing({ regionId: r.id })}>Condomínio</Button>
            </div>
            {condos.length === 0 ? <p className="px-5 pb-4 text-sm text-muted">{f ? 'Nenhum condomínio encontrado nesta região.' : 'Nenhum condomínio cadastrado.'}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-surface-2 text-xs text-muted"><tr>{['Condomínio', 'Endereço', 'Blocos', 'Unidades', 'Rede', 'Portas CTO', 'Oportunidades', ''].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {condos.map((c) => (
                      <tr key={c.id} className={clsx('border-t border-line', !c.active && 'text-muted')}>
                        <td className="px-5 py-3 font-semibold text-ink"><span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted" aria-hidden />{c.name}</span>{!c.active && <Chip tone="neutral" className="ml-2">Inativo</Chip>}</td>
                        <td className="px-5 py-3 text-text">{[c.street, c.number].filter(Boolean).join(', ') || '—'}{c.district ? ` · ${c.district}` : ''}{c.cep ? <span className="num block text-xs text-muted">{c.cep}</span> : null}</td>
                        <td className="px-5 py-3 text-text">{c.blocks.length ? c.blocks.join(', ') : '—'}</td>
                        <td className="num px-5 py-3 text-text">{c.units ?? '—'}</td>
                        <td className="px-5 py-3"><Chip tone={c.hasNetwork ? 'green' : 'neutral'}>{c.hasNetwork ? 'Cabeado' : 'A cabear'}</Chip></td>
                        <td className="num px-5 py-3 text-text">{c.ctoPorts == null ? <span className="text-muted">—</span> : <><span className={c.portsUsed >= c.ctoPorts ? 'font-bold text-danger' : 'text-ink'}>{c.portsUsed}/{c.ctoPorts}</span><span className="block text-xs text-muted">{c.portsReserved ? `+${c.portsReserved} reservada(s) · ` : ''}{Math.round((c.portsUsed / Math.max(1, c.ctoPorts)) * 100)}% ocupadas</span></>}</td>
                        <td className="num px-5 py-3 text-text">{c.opportunities}{c.won ? <span className="text-xs text-success"> · {c.won} fechada(s)</span> : null}</td>
                        <td className="px-5 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Editar</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {editing && <CondoForm regions={regions.filter((r) => r.active || r.id === editing.regionId)} condo={'id' in editing ? editing : null} regionId={editing.regionId} onClose={() => setEditing(null)} onSaved={() => { done(); setEditing(null); }} />}
    </div>
  );
}

function CondoForm({ regions, condo, regionId, onClose, onSaved }: { regions: Region[]; condo: Condo | null; regionId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    regionId, name: condo?.name ?? '', cep: condo?.cep ?? '', street: condo?.street ?? '', number: condo?.number ?? '', district: condo?.district ?? '', city: condo?.city ?? '',
    blocks: condo?.blocks.join(', ') ?? '', units: condo?.units === null || condo?.units === undefined ? '' : String(condo.units), hasNetwork: condo?.hasNetwork ?? false, ctoPorts: condo?.ctoPorts == null ? '' : String(condo.ctoPorts), notes: condo?.notes ?? '', active: condo?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [looking, setLooking] = useState(false);
  const set = (v: Partial<typeof form>) => setForm((x) => ({ ...x, ...v }));
  const lookup = async () => {
    const d = form.cep.replace(/\D/g, '');
    if (d.length !== 8) return;
    setLooking(true);
    try {
      const r = await api<{ found: boolean; street?: string | null; district?: string | null; city?: string | null }>(`/meta/cep/${d}`);
      if (r.found) set({ street: form.street || r.street || '', district: form.district || r.district || '', city: form.city || r.city || '' });
    } catch { /* manual */ } finally { setLooking(false); }
  };
  const m = useMutation({
    mutationFn: () => {
      const body = { ...form, cep: form.cep || null, street: form.street || null, number: form.number || null, district: form.district || null, city: form.city || null, notes: form.notes || null, units: form.units === '' ? null : Number(form.units), ctoPorts: form.ctoPorts === '' ? null : Number(form.ctoPorts), blocks: form.blocks.split(',').map((b) => b.trim()).filter(Boolean) };
      return condo ? api(`/admin/condominiums/${condo.id}`, { method: 'PATCH', body }) : api('/admin/condominiums', { method: 'POST', body });
    },
    onSuccess: () => { toast({ tone: 'success', message: 'Condomínio salvo' }); onSaved(); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); toast({ tone: 'error', message: errMsg(e) }); },
  });
  return (
    <Modal open onClose={onClose} title={condo ? 'Editar condomínio' : 'Cadastrar condomínio'} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={m.isPending} disabled={form.name.trim().length < 2} onClick={() => m.mutate()}>Salvar</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Nome" htmlFor="co-name" required error={errors.name} className="sm:col-span-2"><Input id="co-name" value={form.name} onChange={(e) => set({ name: e.target.value })} data-autofocus /></FormField>
        <FormField label="Região" htmlFor="co-reg"><Select id="co-reg" value={form.regionId} onChange={(e) => set({ regionId: e.target.value })}>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></FormField>
        <FormField label="CEP" htmlFor="co-cep" error={errors.cep} hint={looking ? 'Buscando endereço…' : 'Preenche rua, bairro e cidade'}><Input id="co-cep" inputMode="numeric" value={form.cep} onChange={(e) => set({ cep: e.target.value })} onBlur={lookup} placeholder="00000-000" /></FormField>
        <FormField label="Logradouro" htmlFor="co-street"><Input id="co-street" value={form.street} onChange={(e) => set({ street: e.target.value })} /></FormField>
        <FormField label="Número" htmlFor="co-num"><Input id="co-num" value={form.number} onChange={(e) => set({ number: e.target.value })} /></FormField>
        <FormField label="Bairro" htmlFor="co-dist"><Input id="co-dist" value={form.district} onChange={(e) => set({ district: e.target.value })} /></FormField>
        <FormField label="Cidade" htmlFor="co-city"><Input id="co-city" value={form.city} onChange={(e) => set({ city: e.target.value })} /></FormField>
        <FormField label="Blocos (separados por vírgula)" htmlFor="co-blocks" hint="Em branco: o vendedor digita o bloco"><Input id="co-blocks" value={form.blocks} onChange={(e) => set({ blocks: e.target.value })} placeholder="A, B, C" /></FormField>
        <FormField label="Portas na CTO" htmlFor="co-ports" hint={condo ? `${condo.portsUsed} ocupada(s) por vendas fechadas` : 'Cada venda fechada ocupa uma; o cancelamento libera'}><Input id="co-ports" type="number" min={0} value={form.ctoPorts} onChange={(e) => set({ ctoPorts: e.target.value })} placeholder="Ex.: 16" /></FormField>
        <FormField label="Unidades" htmlFor="co-units"><Input id="co-units" type="number" min={0} value={form.units} onChange={(e) => set({ units: e.target.value })} /></FormField>
        <FormField label="Observações" htmlFor="co-notes" className="sm:col-span-2"><Textarea id="co-notes" value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Ex.: síndico libera instalação só pela manhã" /></FormField>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.hasNetwork} onChange={(e) => set({ hasNetwork: e.target.checked })} />Prédio já cabeado (rede interna pronta)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />Ativo</label>
      </div>
    </Modal>
  );
}
