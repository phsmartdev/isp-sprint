/** Configurações → Modelos → E-mails: assunto e texto dos e-mails do sistema, com pré-visualização (nada é enviado). */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { Button, Chip, ErrorState, FormField, Input, LoadingRows, Notice, Textarea } from '../../components/ui/primitives';
import { Drawer, useToast } from '../../components/ui/overlay';

type Tpl = { assunto: string; corpo: string };
type Item = Tpl & { key: string; label: string; variables: string[]; default: Tpl; accessBox: boolean };
type Preview = { subject: string; text: string; html: string | null };
const errMsg = (e: unknown) => (e instanceof ApiError ? e.problem.detail ?? e.message : (e as Error).message);

function Editor({ item, onClose }: { item: Item; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<Tpl>({ assunto: item.assunto, corpo: item.corpo });
  const body = useRef<HTMLTextAreaElement>(null);
  const live = useDebounced(f, 400);
  const preview = useQuery({ queryKey: ['admin', 'email-templates', 'preview', item.key, live], queryFn: () => api<Preview>(`/admin/email-templates/${item.key}/preview`, { method: 'POST', body: live }), enabled: live.assunto.trim().length > 0 && live.corpo.trim().length > 0, placeholderData: (p) => p, retry: false });
  const save = useMutation({
    mutationFn: () => api<{ changed: boolean; version: number }>(`/admin/email-templates/${item.key}`, { method: 'PUT', body: f }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['admin', 'email-templates'] }); toast({ tone: 'success', message: r.changed ? `Modelo salvo (versão ${r.version} do modelo de instrução)` : 'Nada mudou' }); onClose(); },
  });
  const insert = (v: string) => {
    const el = body.current, tag = `{{${v}}}`;
    if (!el) return setF((x) => ({ ...x, corpo: x.corpo + tag }));
    const a = el.selectionStart ?? f.corpo.length, b = el.selectionEnd ?? a;
    setF((x) => ({ ...x, corpo: x.corpo.slice(0, a) + tag + x.corpo.slice(b) }));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length); });
  };
  const isDefault = f.assunto === item.default.assunto && f.corpo === item.default.corpo;
  return (
    <Drawer open onClose={onClose} title={`Modelo: ${item.label}`} width="lg" footer={<>
      {save.isError && <p role="alert" className="mr-auto text-sm text-danger">{errMsg(save.error)}</p>}
      <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      <Button variant="primary" loading={save.isPending} disabled={!f.assunto.trim() || !f.corpo.trim()} onClick={() => save.mutate()}>Salvar modelo</Button>
    </>}>
      <div className="space-y-4">
        <FormField label="Assunto" htmlFor="et-subject"><Input id="et-subject" value={f.assunto} maxLength={200} onChange={(e) => setF({ ...f, assunto: e.target.value })} /></FormField>
        <FormField label="Texto do e-mail" htmlFor="et-body" hint={item.accessBox ? 'O link, o usuário e a senha temporária entram sozinhos num quadro logo abaixo do texto, com o botão de acesso.' : 'Linha em branco separa os parágrafos.'}>
          <Textarea id="et-body" ref={body} rows={12} value={f.corpo} maxLength={5000} onChange={(e) => setF({ ...f, corpo: e.target.value })} />
        </FormField>
        <div>
          <p className="mb-1.5 text-sm text-muted">Inserir no texto:</p>
          <div className="flex flex-wrap gap-1.5">{item.variables.map((v) => <button key={v} type="button" className="border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-ink hover:border-primary" onClick={() => insert(v)}>{`{{${v}}}`}</button>)}</div>
        </div>
        {!isDefault && <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setF(item.default)}>Voltar ao texto padrão</button>}
        <section aria-label="Pré-visualização" className="border-t border-line pt-4">
          <h3 className="mb-1 font-bold text-ink">Pré-visualização</h3>
          <p className="mb-2 text-xs text-muted">Com dados fictícios e a sua assinatura. Nada é enviado.</p>
          {preview.isError ? <Notice tone="warning">{errMsg(preview.error)}</Notice> : !preview.data ? <LoadingRows /> : (
            <>
              <p className="mb-2 text-sm"><span className="text-muted">Assunto: </span><b className="text-ink">{preview.data.subject}</b></p>
              {preview.data.html
                ? <iframe title="Pré-visualização do e-mail" sandbox="" srcDoc={preview.data.html} className="h-[640px] w-full border border-line bg-white" />
                : <pre className="whitespace-pre-wrap border border-line bg-surface-2 p-3 font-sans text-sm text-text">{preview.data.text}</pre>}
            </>
          )}
        </section>
      </div>
    </Drawer>
  );
}

export function SystemEmailTemplates() {
  const q = useQuery({ queryKey: ['admin', 'email-templates'], queryFn: () => api<{ version: number; items: Item[] }>('/admin/email-templates') });
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (open && q.data && !q.data.items.some((i) => i.key === open)) setOpen(null); }, [open, q.data]);
  const item = q.data?.items.find((i) => i.key === open);
  return (
    <section className="card overflow-hidden" aria-label="Modelos de e-mail do sistema">
      <div className="px-5 pb-3 pt-4"><h2 className="text-lg font-bold text-ink">Modelos de e-mail do sistema</h2><p className="text-sm text-muted">Assunto e texto de cada e-mail automático. Cada mudança salva vira uma nova versão do modelo de instrução; a anterior fica no histórico.</p></div>
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <ul className="divide-y divide-line border-t border-line">
          {q.data!.items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <span className="min-w-0"><span className="flex items-center gap-2 font-semibold text-ink">{i.label}{i.assunto === i.default.assunto && i.corpo === i.default.corpo ? <Chip tone="neutral">Padrão</Chip> : <Chip tone="blue">Editado</Chip>}</span><span className="block truncate text-sm text-muted">{i.assunto}</span></span>
              <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setOpen(i.key)}>Editar</Button>
            </li>
          ))}
        </ul>
      )}
      {item && <Editor key={item.key} item={item} onClose={() => setOpen(null)} />}
    </section>
  );
}
