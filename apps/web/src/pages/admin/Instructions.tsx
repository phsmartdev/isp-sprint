/**
 * Configurações → Modelo de instrução: exporta a inteligência do negócio (jornadas, roteiro,
 * regras dos insights e modelos de e-mail) em JSON, recebe uma versão adaptada, mostra a prévia
 * e só aplica quando a gerência ativar. Versões antigas ficam guardadas.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileJson, Upload } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';

type Version = { id: string; version: number; status: 'rascunho' | 'ativa' | 'arquivada'; changes: string[]; notes: string | null; createdAt: string; createdByName: string | null; activatedAt: string | null; activatedByName: string | null };
type ListData = { active: { id: string; version: number; journeys: number; stages: number; questions: number; objections: number }; versions: Version[] };
type UploadResult = { id: string; version: number; changes: string[]; blockers: string[] };

const STATUS: Record<Version['status'], { label: string; tone: 'green' | 'yellow' | 'neutral' }> = { ativa: { label: 'Ativa', tone: 'green' }, rascunho: { label: 'Rascunho', tone: 'yellow' }, arquivada: { label: 'Arquivada', tone: 'neutral' } };
const exportUrl = (version?: number) => `/api/v1/admin/instructions/export${version ? `?version=${version}` : ''}`;

export function AdminInstructions() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'instructions'], queryFn: () => api<ListData>('/admin/instructions') });
  const fileRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<(UploadResult & { draft?: Version }) | null>(null);
  const [issues, setIssues] = useState<{ title: string; items: { path: string; message: string }[] } | null>(null);
  const done = () => { for (const k of ['admin', 'lookups', 'pipeline', 'playbook', 'intelligence', 'home']) qc.invalidateQueries({ queryKey: [k] }); };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 1_900_000) throw new Error('Arquivo grande demais (máx. 1,9 MB).');
      let content: unknown;
      try { content = JSON.parse(await file.text()); } catch { throw new Error('O arquivo não é um JSON válido. Exporte o modelo, edite e envie o mesmo formato.'); }
      return api<UploadResult>('/admin/instructions', { method: 'POST', body: { content, notes: notes.trim() || null } });
    },
    onSuccess: (r) => { setNotes(''); setPreview(r); done(); },
    onError: (e) => {
      if (e instanceof ApiError && e.problem.errors?.length) setIssues({ title: e.problem.detail ?? e.message, items: e.problem.errors });
      else toast({ tone: 'error', message: (e as Error).message });
    },
    onSettled: () => { if (fileRef.current) fileRef.current.value = ''; },
  });
  const activate = useMutation({
    mutationFn: (id: string) => api<{ version: number }>(`/admin/instructions/${id}/activate`, { method: 'POST' }),
    onSuccess: (r) => { setPreview(null); done(); toast({ tone: 'success', message: `Versão ${r.version} ativada` }); },
    onError: (e) => {
      if (e instanceof ApiError && e.problem.errors?.length) setIssues({ title: e.problem.detail ?? e.message, items: e.problem.errors });
      else toast({ tone: 'error', message: (e as Error).message });
    },
  });
  const discard = useMutation({
    mutationFn: (id: string) => api(`/admin/instructions/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setPreview(null); done(); toast({ tone: 'success', message: 'Rascunho descartado' }); },
    onError: (e) => toast({ tone: 'error', message: (e as Error).message }),
  });

  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { active, versions } = q.data!;

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="text-lg font-bold text-ink">Modelo de instrução da inteligência do negócio</h2>
        <p className="mb-4 max-w-3xl text-sm text-muted">Um arquivo com o seu playbook: jornadas e etapas (com exigências, campos e automações), o roteiro do Sprint (perguntas e dicas por etapa), objeções, regras dos insights e os modelos de e-mail. Exporte, adapte e envie de volta. Nada muda até você ativar a nova versão.</p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-line p-4">
            <p className="mb-1 flex items-center gap-2 font-bold text-ink"><Download className="h-5 w-5 text-primary" aria-hidden />1. Exportar o modelo atual</p>
            <p className="mb-3 text-sm text-muted">Versão {active.version} ativa: {active.journeys} jornada(s), {active.stages} etapas, {active.questions} perguntas do roteiro e {active.objections} objeções. O arquivo traz instruções de preenchimento no campo “_leia_me”.</p>
            <a className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 font-semibold text-white hover:bg-primary-hover" href={exportUrl()} download><FileJson className="h-4 w-4" aria-hidden />Baixar modelo (JSON)</a>
          </div>
          <div className="rounded-md border border-line p-4">
            <p className="mb-1 flex items-center gap-2 font-bold text-ink"><Upload className="h-5 w-5 text-primary" aria-hidden />2. Enviar a versão adaptada</p>
            <p className="mb-3 text-sm text-muted">O sistema valida o arquivo, mostra o que vai mudar e guarda como rascunho.</p>
            <FormField label="O que mudou (opcional)" htmlFor="in-notes"><Input id="in-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: novo roteiro para condomínios" /></FormField>
            <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" id="in-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} />
            <Button className="mt-3" variant="primary" icon={<Upload className="h-4 w-4" />} loading={upload.isPending} onClick={() => fileRef.current?.click()}>Escolher arquivo e ver prévia</Button>
          </div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="px-5 pb-3 pt-4"><h2 className="text-lg font-bold text-ink">Versões</h2><p className="text-sm text-muted">Você pode reativar uma versão anterior a qualquer momento. Rascunhos não afetam o time.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['Versão', 'Situação', 'Enviada', 'Ativada', 'O que muda', ''].map((h) => <th key={h} className="px-5 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t border-line align-top">
                  <td className="num px-5 py-3 font-bold text-ink">v{v.version}</td>
                  <td className="px-5 py-3"><Chip tone={STATUS[v.status].tone}>{STATUS[v.status].label}</Chip></td>
                  <td className="px-5 py-3 text-text"><span className="num">{fmtDateTime(v.createdAt)}</span>{v.createdByName && <span className="block text-xs text-muted">{v.createdByName}</span>}</td>
                  <td className="px-5 py-3 text-text">{v.activatedAt ? <><span className="num">{fmtDateTime(v.activatedAt)}</span>{v.activatedByName && <span className="block text-xs text-muted">{v.activatedByName}</span>}</> : '—'}</td>
                  <td className="max-w-md px-5 py-3 text-text">
                    {v.notes && <p className="font-medium text-ink">{v.notes}</p>}
                    <p className="text-xs text-muted">{v.changes.slice(0, 3).join(' ')}{v.changes.length > 3 ? ` (+${v.changes.length - 3})` : ''}</p>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    <a className="link mr-3 text-sm" href={exportUrl(v.version)} download>Baixar</a>
                    {v.status !== 'ativa' && <Button size="sm" variant={v.status === 'rascunho' ? 'primary' : 'secondary'} loading={activate.isPending && activate.variables === v.id} onClick={() => { if (confirm(`Ativar a versão ${v.version}? Jornadas, roteiro, insights e e-mails passam a seguir esta versão.`)) activate.mutate(v.id); }}>Ativar</Button>}
                    {v.status === 'rascunho' && <Button size="sm" variant="ghost" className="ml-1" onClick={() => discard.mutate(v.id)}>Descartar</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={`Prévia da versão ${preview?.version ?? ''}`} size="lg" footer={<>
        <Button onClick={() => setPreview(null)}>Deixar como rascunho</Button>
        <Button variant="primary" disabled={!!preview?.blockers.length} loading={activate.isPending} onClick={() => preview && activate.mutate(preview.id)}>Ativar agora</Button>
      </>}>
        {preview && (
          <div className="space-y-3">
            {preview.blockers.length > 0 && (
              <Notice tone="warning">
                <p className="font-semibold">Não dá para ativar ainda:</p>
                <ul className="list-disc pl-5">{preview.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                <p>Mova ou encerre essas oportunidades, ou mantenha as etapas no arquivo.</p>
              </Notice>
            )}
            <p className="text-sm font-semibold text-ink">{preview.changes.length ? 'O que muda ao ativar:' : 'Nenhuma diferença em relação à versão ativa.'}</p>
            <ul className="max-h-80 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-text">{preview.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        )}
      </Modal>

      <Modal open={!!issues} onClose={() => setIssues(null)} title="O arquivo precisa de ajustes" size="lg" footer={<Button variant="primary" onClick={() => setIssues(null)}>Entendi</Button>}>
        {issues && (
          <div className="space-y-3">
            <p className="text-sm text-text">{issues.title}</p>
            <ul className="max-h-96 space-y-1 overflow-y-auto text-sm">
              {issues.items.map((i, k) => <li key={k} className="rounded bg-surface-2 px-3 py-1.5"><code className="text-xs text-primary">{i.path}</code> <span className="text-text">{i.message}</span></li>)}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}
