/**
 * Configurações → Modelos → Ofícios: quantos modelos a empresa quiser (texto e posição editáveis, variáveis do
 * contrato), no timbrado de cada filial; e, por filial, quem assina, a imagem da assinatura e o próximo número.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { fileToBase64 } from '../../lib/files';
import { fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select } from '../../components/ui/primitives';
import { ConfirmDialog, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { OfficeEditor, type OfficeBlock, type VarDef } from './OfficeEditor';

type Branch = { id: string; name: string; cnpj: string | null; city: string | null; state: string | null; active: boolean; hasLetterhead: boolean; nextNumber: number; signer: { legalName: string | null; signerName: string | null; signerRole: string | null; hasSignature: boolean } | null };
type Tpl = { id: string; name: string; description: string | null; branchIds: string[]; blocks: OfficeBlock[]; active: boolean; version: number; updatedAt: string };
type Data = { templates: Tpl[]; branches: Branch[]; vars: VarDef[]; defaultBlocks: OfficeBlock[]; year: number };

export function AdminOffices() {
  const q = useQuery({ queryKey: ['admin', 'oficios'], queryFn: () => api<Data>('/admin/oficios') });
  const [editing, setEditing] = useState<Tpl | 'novo' | null>(null);
  if (q.isLoading) return <div className="card"><LoadingRows rows={5} /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  if (editing) return <TemplateEditor data={d} tpl={editing === 'novo' ? null : editing} onClose={() => setEditing(null)} />;
  return (
    <div className="space-y-5">
      <section className="card p-5" aria-label="Modelos de ofício">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-md font-bold text-ink">Modelos de ofício</h2><p className="text-sm text-muted">Emitidos a partir do contrato, no timbrado da filial do contrato, com número sequencial por filial e ano.</p></div>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('novo')}>Novo modelo</Button>
        </div>
        {!d.templates.length ? <EmptyState title="Nenhum modelo ainda" description="Crie o primeiro: ele já começa com o ofício de reajuste, com as variáveis do contrato no lugar." /> : (
          <ul className="divide-y divide-line">{d.templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{t.name} {!t.active && <Chip>Inativo</Chip>}</p><p className="text-xs text-muted">{t.branchIds.length ? d.branches.filter((b) => t.branchIds.includes(b.id)).map((b) => b.name).join(', ') : 'Todas as filiais'} · versão {t.version} · {fmtDateTime(t.updatedAt)}</p></div>
              <Button size="sm" onClick={() => setEditing(t)}>Editar</Button>
            </li>
          ))}</ul>
        )}
      </section>
      <BranchSigners data={d} />
    </div>
  );
}

function TemplateEditor({ data, tpl, onClose }: { data: Data; tpl: Tpl | null; onClose: () => void }) {
  const [name, setName] = useState(tpl?.name ?? 'Ofício de reajuste');
  const [description, setDescription] = useState(tpl?.description ?? '');
  const [branchIds, setBranchIds] = useState<string[]>(tpl?.branchIds ?? []);
  const [active, setActive] = useState(tpl?.active ?? true);
  const [blocks, setBlocks] = useState<OfficeBlock[]>(tpl?.blocks ?? data.defaultBlocks);
  const [previewBranch, setPreviewBranch] = useState<string>(tpl?.branchIds[0] ?? data.branches.find((b) => b.hasLetterhead)?.id ?? data.branches[0]?.id ?? '');
  const [confirmDel, setConfirmDel] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => tpl ? api(`/admin/oficios/${tpl.id}`, { method: 'PATCH', body: { name, description: description || null, branchIds, blocks, active } }) : api('/admin/oficios', { method: 'POST', body: { name, description: description || null, branchIds, blocks } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'oficios'] }); toast({ tone: 'success', message: 'Modelo salvo' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const del = useMutation({ mutationFn: () => api(`/admin/oficios/${tpl!.id}`, { method: 'DELETE' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'oficios'] }); toast({ tone: 'success', message: 'Modelo excluído' }); onClose(); } });
  const preview = useMemo(() => (b: OfficeBlock[]) => api<{ pdf: string; boxes: { id: string; page: number; x: number; y: number; w: number; h: number }[]; pages: number }>('/admin/oficios/previa', { method: 'POST', body: { blocks: b, branchId: previewBranch || null } }), [previewBranch]);
  return (
    <div className="space-y-4">
      <button type="button" className="inline-flex items-center gap-1 text-sm text-primary hover:underline" onClick={onClose}><ArrowLeft className="h-4 w-4" aria-hidden />Modelos de ofício</button>
      <section className="card space-y-3 p-5" aria-label="Dados do modelo">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Nome do modelo" htmlFor="of-name" required><Input id="of-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></FormField>
          <FormField label="Descrição" htmlFor="of-desc"><Input id="of-desc" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: reajuste anual por IPCA" /></FormField>
        </div>
        <fieldset><legend className="mb-1 text-sm font-semibold text-ink">Filiais que usam este modelo</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={!branchIds.length} onChange={() => setBranchIds([])} />Todas</label>
            {data.branches.filter((b) => b.active).map((b) => <label key={b.id} className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={branchIds.includes(b.id)} onChange={() => setBranchIds((x) => (x.includes(b.id) ? x.filter((y) => y !== b.id) : [...x, b.id]))} />{b.name}</label>)}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Prévia no timbrado da filial" htmlFor="of-prev"><Select id="of-prev" className="w-64" value={previewBranch} onChange={(e) => setPreviewBranch(e.target.value)}>{data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.hasLetterhead ? '' : ' (sem timbrado)'}</option>)}</Select></FormField>
          {tpl && <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={active} onChange={(e) => setActive(e.target.checked)} />Ativo</label>}
          <p className="pb-2 text-xs text-muted">A prévia usa valores de exemplo; na emissão entram os dados do contrato.</p>
        </div>
      </section>
      <section className="card p-5" aria-label="Texto e posição"><OfficeEditor blocks={blocks} onChange={setBlocks} preview={preview} varDefs={data.vars} /></section>
      <div className="flex flex-wrap justify-end gap-2">
        {tpl && <Button variant="ghost" onClick={() => setConfirmDel(true)}>Excluir modelo</Button>}
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>Salvar modelo</Button>
      </div>
      <ConfirmDialog open={confirmDel} title="Excluir modelo" tone="danger" confirmLabel="Excluir" loading={del.isPending} onCancel={() => setConfirmDel(false)} onConfirm={() => del.mutate()}><p>Os ofícios já emitidos com este modelo continuam guardados.</p></ConfirmDialog>
    </div>
  );
}

function BranchSigners({ data }: { data: Data }) {
  return (
    <section className="card p-5" aria-label="Assinatura e numeração por filial">
      <h2 className="text-md font-bold text-ink">Assinatura e numeração por filial</h2>
      <p className="mb-3 text-sm text-muted">Quem assina os ofícios de cada filial, a imagem da assinatura (PNG com fundo transparente fica melhor) e o próximo número de {data.year}. O timbrado é o da aba Timbrado das filiais.</p>
      <div className="space-y-3">{data.branches.filter((b) => b.active).map((b) => <BranchRow key={b.id} b={b} year={data.year} />)}</div>
    </section>
  );
}

function BranchRow({ b, year }: { b: Branch; year: number }) {
  const [f, setF] = useState({ legalName: b.signer?.legalName ?? '', signerName: b.signer?.signerName ?? '', signerRole: b.signer?.signerRole ?? '', nextNumber: String(b.nextNumber) });
  useEffect(() => { setF({ legalName: b.signer?.legalName ?? '', signerName: b.signer?.signerName ?? '', signerRole: b.signer?.signerRole ?? '', nextNumber: String(b.nextNumber) }); }, [b]);
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'oficios'] });
  const save = useMutation({ mutationFn: () => api(`/admin/oficios/filiais/${b.id}`, { method: 'PUT', body: { legalName: f.legalName || null, signerName: f.signerName || null, signerRole: f.signerRole || null, nextNumber: Number(f.nextNumber) || 1 } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: `${b.name}: salvo` }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const sig = useMutation({ mutationFn: async (file: File) => api(`/admin/oficios/filiais/${b.id}/assinatura`, { method: 'PUT', body: { data: await fileToBase64(file) } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Assinatura enviada' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const rmSig = useMutation({ mutationFn: () => api(`/admin/oficios/filiais/${b.id}/assinatura`, { method: 'DELETE' }), onSuccess: refresh });
  return (
    <div className="border border-line p-3" aria-label={`Filial ${b.name}`} role="group">
      <p className="mb-2 text-sm font-semibold text-ink">{b.name} <span className="font-normal text-muted">{b.cnpj ? `· CNPJ ${b.cnpj}` : '· sem CNPJ (cadastre em Filiais)'}{b.city ? ` · ${b.city}${b.state ? `/${b.state}` : ''}` : ''}{b.hasLetterhead ? '' : ' · sem timbrado'}</span></p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <FormField label="Razão social" htmlFor={`bs-l-${b.id}`} className="lg:col-span-2"><Input id={`bs-l-${b.id}`} className="h-9" value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} placeholder="Ex.: BKT SOLUÇÕES E TECNOLOGIA LTDA" /></FormField>
        <FormField label="Quem assina" htmlFor={`bs-n-${b.id}`}><Input id={`bs-n-${b.id}`} className="h-9" value={f.signerName} onChange={(e) => setF({ ...f, signerName: e.target.value })} /></FormField>
        <FormField label="Cargo" htmlFor={`bs-r-${b.id}`}><Input id={`bs-r-${b.id}`} className="h-9" value={f.signerRole} onChange={(e) => setF({ ...f, signerRole: e.target.value })} /></FormField>
        <FormField label={`Próximo nº de ${year}`} htmlFor={`bs-x-${b.id}`}><Input id={`bs-x-${b.id}`} type="number" min={1} className="h-9" value={f.nextNumber} onChange={(e) => setF({ ...f, nextNumber: e.target.value })} /></FormField>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center border border-line px-3 text-sm hover:bg-surface-2">{b.signer?.hasSignature ? 'Trocar imagem da assinatura' : 'Enviar imagem da assinatura'}
          <input type="file" accept="image/png,image/jpeg" className="sr-only" aria-label={`Imagem da assinatura de ${b.name}`} onChange={(e) => { const file = e.target.files?.[0]; if (file) sig.mutate(file); e.target.value = ''; }} /></label>
        {b.signer?.hasSignature && <><Chip tone="green">Assinatura cadastrada</Chip><Button size="sm" variant="ghost" onClick={() => rmSig.mutate()}>Remover</Button></>}
        <Button size="sm" variant="primary" className="ml-auto" loading={save.isPending} onClick={() => save.mutate()}>Salvar filial</Button>
      </div>
    </div>
  );
}
