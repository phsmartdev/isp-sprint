/** Formulário de comunidade (criar e editar), com capa enviada como as mídias do feed. */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Button, FormField, Input, Textarea } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { usePeopleMe } from './shared';
import { mediaUrl, uploadMedia, type Community } from './feed/api';

const KINDS = [
  { key: 'publica', label: 'Pública interna', hint: 'Quem usa o módulo vê e participa.' },
  { key: 'privada', label: 'Privada', hint: 'Só membros veem o conteúdo; entra por convite ou pedido aprovado.' },
  { key: 'institucional', label: 'Institucional', hint: 'Todos veem; só responsável e moderadores publicam.' },
] as const;

export function CommunityForm({ initial, canInstitutional, onSaved, onCancel }: { initial?: Community; canInstitutional: boolean; onSaved: (c: Community) => void; onCancel: () => void }) {
  const me = usePeopleMe().data;
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: initial?.name ?? '', description: initial?.description ?? '', rules: initial?.rules ?? '', category: initial?.category ?? '', kind: initial?.kind ?? 'publica' as Community['kind'], coverMediaId: initial?.coverMediaId ?? null as string | null });
  const [uploading, setUploading] = useState(false);
  const save = useMutation({
    mutationFn: () => initial ? api<Community>(`/pessoas/comunidades/${initial.id}`, { method: 'PATCH', body: f }) : api<Community>('/pessoas/comunidades', { method: 'POST', body: f }),
    onSuccess: (c) => { void qc.invalidateQueries({ queryKey: ['pessoas'] }); toast({ tone: 'success', message: initial ? 'Comunidade atualizada' : 'Comunidade criada' }); onSaved(c); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const cover = async (file?: File) => {
    if (!file || !me) return;
    setUploading(true);
    try { const m = await uploadMedia(file, me.limits); if (m.kind !== 'imagem') throw new Error('A capa precisa ser uma imagem.'); setF((x) => ({ ...x, coverMediaId: m.id })); } catch (e) { toast({ tone: 'error', message: errMsg(e) }); } finally { setUploading(false); }
  };
  return (
    <form className="card space-y-3 p-4" aria-label={initial ? 'Editar comunidade' : 'Nova comunidade'} onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <h2 className="text-md font-bold text-ink">{initial ? 'Editar comunidade' : 'Nova comunidade'}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Nome" htmlFor="cf-name" required><Input id="cf-name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
        <FormField label="Categoria" htmlFor="cf-cat" hint="Ex.: Técnica, Cultura, Esporte, Projeto"><Input id="cf-cat" maxLength={60} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></FormField>
      </div>
      <FormField label="Descrição" htmlFor="cf-desc"><Textarea id="cf-desc" rows={2} maxLength={600} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></FormField>
      <FormField label="Regras da comunidade" htmlFor="cf-rules" hint="O que é bem-vindo e o que não é"><Textarea id="cf-rules" rows={3} maxLength={2000} value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} /></FormField>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold text-ink">Privacidade</legend>
        <div className="grid gap-2 sm:grid-cols-3">{KINDS.filter((k) => k.key !== 'institucional' || canInstitutional || initial?.kind === 'institucional').map((k) => (
          <label key={k.key} className={`flex cursor-pointer gap-2 border p-2 text-sm ${f.kind === k.key ? 'border-primary bg-primary-soft' : 'border-line'}`}>
            <input type="radio" name="cf-kind" className="mt-0.5 accent-primary" checked={f.kind === k.key} onChange={() => setF({ ...f, kind: k.key })} />
            <span><span className="block font-semibold text-ink">{k.label}</span><span className="text-xs text-muted">{k.hint}</span></span>
          </label>
        ))}</div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        {f.coverMediaId && <img src={mediaUrl(f.coverMediaId)} alt="Capa da comunidade" className="h-14 w-28 object-cover" />}
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 border border-line px-3 text-sm font-semibold text-ink hover:bg-surface-2">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}{f.coverMediaId ? 'Trocar capa' : 'Imagem de capa'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Imagem de capa" onChange={(e) => { void cover(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancelar</Button>
        <Button type="submit" variant="primary" loading={save.isPending} disabled={uploading || f.name.trim().length < 3}>{initial ? 'Salvar' : 'Criar comunidade'}</Button>
      </div>
    </form>
  );
}

