/**
 * Configurações → Modelos → Timbrado: o papel timbrado de cada filial (PNG, JPG ou PDF em A4), usado de fundo
 * nos PDFs gerados pelo sistema (viabilidade econômica), com as margens da área do texto.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileUp, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { compressImage, fileToBase64, fmtBytes, MAX_UPLOAD_BYTES } from '../../lib/files';
import { Button, Chip, EmptyState, FormField, Input, LoadingRows } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';

type Item = { id: string; name: string; active: boolean; letterhead: null | { filename: string; mime: string; topMm: number; bottomMm: number; sideMm: number; updatedAt: string; size: number } };
const errMsg = (e: unknown) => (e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message);
const MIME_LABEL: Record<string, string> = { 'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPG' };

function BranchLetterhead({ b }: { b: Item }) {
  const qc = useQueryClient();
  const toast = useToast();
  const lh = b.letterhead;
  const [m, setM] = useState({ topMm: String(lh?.topMm ?? 35), bottomMm: String(lh?.bottomMm ?? 25), sideMm: String(lh?.sideMm ?? 17) });
  useEffect(() => { setM({ topMm: String(lh?.topMm ?? 35), bottomMm: String(lh?.bottomMm ?? 25), sideMm: String(lh?.sideMm ?? 17) }); }, [lh?.topMm, lh?.bottomMm, lh?.sideMm]);
  const margins = { topMm: Number(m.topMm) || 0, bottomMm: Number(m.bottomMm) || 0, sideMm: Number(m.sideMm) || 0 };
  const dirty = !!lh && (margins.topMm !== lh.topMm || margins.bottomMm !== lh.bottomMm || margins.sideMm !== lh.sideMm);
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['admin', 'letterheads'] }); toast({ tone: 'success', message: msg }); };
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const file = f.type === 'application/pdf' ? f : await compressImage(f);
      if (file.size > MAX_UPLOAD_BYTES) throw new Error(`Arquivo com ${fmtBytes(file.size)}: o limite é ${fmtBytes(MAX_UPLOAD_BYTES)}. Exporte o timbrado com qualidade menor.`);
      return api(`/admin/letterheads/${b.id}`, { method: 'PUT', body: { data: await fileToBase64(file), filename: f.name, ...margins } });
    },
    onSuccess: () => done(`Timbrado da ${b.name} salvo`), onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const save = useMutation({ mutationFn: () => api(`/admin/letterheads/${b.id}`, { method: 'PUT', body: margins }), onSuccess: () => done('Margens salvas'), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const remove = useMutation({ mutationFn: () => api(`/admin/letterheads/${b.id}`, { method: 'DELETE' }), onSuccess: () => done('Timbrado removido'), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const num = (k: keyof typeof m, label: string, hint: string) => (
    <FormField label={label} htmlFor={`lh-${b.id}-${k}`} hint={hint}>
      <span className="flex items-center gap-1.5"><Input id={`lh-${b.id}-${k}`} inputMode="numeric" className="w-20" value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value.replace(/\D/g, '').slice(0, 3) })} /><span className="text-xs text-muted">mm</span></span>
    </FormField>
  );
  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold text-ink">{b.name}{!b.active && <span className="ml-2 text-xs font-normal text-muted">(inativa)</span>}</p>
          {lh ? <p className="text-xs text-muted">{lh.filename} · {MIME_LABEL[lh.mime] ?? lh.mime} · {fmtBytes(lh.size)} · atualizado em {fmtDateTime(lh.updatedAt)}</p> : <p className="text-xs text-muted">Sem timbrado: os PDFs saem em papel branco.</p>}
        </div>
        {lh ? <Chip tone="green">Com timbrado</Chip> : <Chip>Sem timbrado</Chip>}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        {num('topMm', 'Margem de cima', 'Altura do cabeçalho')}
        {num('bottomMm', 'Margem de baixo', 'Altura do rodapé')}
        {num('sideMm', 'Laterais', 'Esquerda e direita')}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 border border-line px-3 text-sm font-semibold text-ink hover:bg-surface-2">
          <FileUp className="h-4 w-4" aria-hidden />{upload.isPending ? 'Enviando…' : lh ? 'Trocar arquivo' : 'Enviar timbrado'}
          <input type="file" accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" className="sr-only" aria-label={`Arquivo do timbrado: ${b.name}`} disabled={upload.isPending} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
        </label>
        {lh && <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Salvar margens</Button>}
        {lh && <a className="inline-flex h-9 items-center gap-1.5 px-2 text-sm font-semibold text-primary hover:underline" href={`/api/v1/admin/letterheads/${b.id}/preview`} target="_blank" rel="noreferrer"><Eye className="h-4 w-4" aria-hidden />Ver prévia</a>}
        {lh && <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4 text-danger" />} loading={remove.isPending} onClick={() => { if (confirm(`Remover o timbrado da ${b.name}?`)) remove.mutate(); }}>Remover</Button>}
      </div>
    </li>
  );
}

export function AdminLetterheads() {
  const q = useQuery({ queryKey: ['admin', 'letterheads'], queryFn: () => api<{ items: Item[] }>('/admin/letterheads') });
  if (!q.data) return <div className="card p-5"><LoadingRows /></div>;
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-muted">Envie o papel timbrado de cada filial: uma página A4 em PDF, PNG ou JPG, com o logo e os dados no cabeçalho e no rodapé. O PDF da viabilidade econômica sai sobre o timbrado da filial da oportunidade, com o texto dentro das margens. Use “Ver prévia” para conferir a área do texto.</p>
      {!q.data.items.length ? <EmptyState title="Nenhuma filial" description="Cadastre as filiais em Filiais e documentos fiscais." /> : (
        <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">{q.data.items.map((b) => <BranchLetterhead key={b.id} b={b} />)}</ul>
      )}
    </div>
  );
}
