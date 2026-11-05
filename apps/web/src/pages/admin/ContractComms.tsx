/** Configurações → Comunicação de contratos: esteiras (fluxo com setas) e templates (e-mail institucional e WhatsApp). */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Pencil, Plus, Send } from 'lucide-react';
import { COMM_TRIGGER_LABELS, COMM_VARIABLES, templateIssues, type CommGraph } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Tabs, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { CommFlowEditor } from './CommFlowEditor';

type Flow = { id: string; name: string; description: string | null; graph: CommGraph; publishedGraph: CommGraph | null; version: number; active: boolean; publishedAt: string | null; runs: Record<string, number>; draftChanged: boolean };
type Tpl = { id: string; name: string; channels: ('email' | 'whatsapp')[]; subject: string; body: string; whatsapp: string; format: 'texto' | 'html'; layout: boolean; status: string; version: number; rowVersion: number; updatedAt: string };

function NewFlow({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const m = useMutation({ mutationFn: () => api<{ id: string }>('/comm/flows', { method: 'POST', body: { name } }), onSuccess: (r) => onCreated(r.id) });
  return (
    <Modal open onClose={onClose} title="Nova esteira" size="sm" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={name.trim().length < 2} loading={m.isPending} onClick={() => m.mutate()}>Criar e desenhar</Button></>}>
      <FormField label="Nome" htmlFor="nf-name" hint="Ex.: Renovação de contratos privados"><Input id="nf-name" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
    </Modal>
  );
}

function Flows() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const open = params.get('esteira');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['comm-flows'], queryFn: () => api<{ items: Flow[] }>('/comm/flows') });
  const toggle = useMutation({ mutationFn: (f: Flow) => api(`/comm/flows/${f.id}/active`, { method: 'POST', body: { active: !f.active } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['comm-flows'] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const go = (id: string | null) => { const p = new URLSearchParams(params); if (id) p.set('esteira', id); else p.delete('esteira'); setParams(p, { replace: true }); };
  if (open) return <CommFlowEditor flowId={open} onBack={() => go(null)} />;
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data!.items;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">Cada esteira é um fluxo: um gatilho (ex.: término da vigência) e os passos ligados por setas. Envios ficam parados até alguém aprovar. Publicar confere o desenho; só esteiras ligadas rodam.</p>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Nova esteira</Button>
      </div>
      {!items.length ? <EmptyState title="Nenhuma esteira" description="Crie a primeira e desenhe o fluxo." /> : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">{items.map((f) => {
          const trig = (f.publishedGraph ?? f.graph).nodes.find((n) => n.type === 'gatilho')?.data.trigger;
          const steps = (f.publishedGraph ?? f.graph).nodes.length - 1;
          return (
            <div key={f.id} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate font-bold text-ink">{f.name}</p><p className="text-xs text-muted">{trig ? COMM_TRIGGER_LABELS[trig] : 'Gatilho não definido'} · {steps} passo(s)</p></div>
                <Chip tone={f.active ? 'green' : 'neutral'}>{f.active ? 'Ligada' : 'Desligada'}</Chip>
              </div>
              <p className="mt-2 text-xs text-muted">{f.version ? `Versão ${f.version} publicada ${fmtDateTime(f.publishedAt)}` : 'Ainda não publicada'}{f.draftChanged && f.version ? ' · há alterações no rascunho' : ''}</p>
              <p className="text-xs text-muted">Execuções: {f.runs.ativo ?? 0} em andamento · {f.runs.concluido ?? 0} concluídas · {f.runs.cancelado ?? 0} encerradas</p>
              <div className="mt-3 flex gap-2"><Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => go(f.id)}>Desenhar</Button><Button size="sm" disabled={!f.version} loading={toggle.isPending && toggle.variables?.id === f.id} onClick={() => toggle.mutate(f)}>{f.active ? 'Desligar' : 'Ligar'}</Button></div>
            </div>
          );
        })}</div>
      )}
      {creating && <NewFlow onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); qc.invalidateQueries({ queryKey: ['comm-flows'] }); go(id); }} />}
    </div>
  );
}

function TemplateEditor({ t, onClose }: { t: Tpl | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: t?.name ?? '', channels: t?.channels ?? ['email'], subject: t?.subject ?? '', body: t?.body ?? '', whatsapp: t?.whatsapp ?? '', format: (t?.format ?? 'texto') as 'texto' | 'html', layout: t?.layout ?? true });
  const [id, setId] = useState(t?.id ?? null);
  const [rv, setRv] = useState(t?.rowVersion ?? 0);
  const [tab, setTab] = useState<'email' | 'whatsapp'>('email');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState<{ html: string; subject: string; whatsapp: string } | null>(null);
  useEffect(() => {
    const h = setTimeout(() => { void api<{ html: string; subject: string; whatsapp: string }>('/comm/templates/preview', { method: 'POST', body: { subject: f.subject, body: f.body, whatsapp: f.whatsapp, format: f.format, layout: f.layout } }).then(setPreview).catch(() => undefined); }, 400);
    return () => clearTimeout(h);
  }, [f.subject, f.body, f.whatsapp, f.format, f.layout]);
  const issues = templateIssues(f, f.channels);
  const save = async () => {
    if (!id) { const r = await api<{ id: string }>('/comm/templates', { method: 'POST', body: f }); setId(r.id); const list = await api<{ items: Tpl[] }>('/comm/templates'); setRv(list.items.find((x) => x.id === r.id)!.rowVersion); return r.id; }
    const r = await api<{ rowVersion: number }>(`/comm/templates/${id}`, { method: 'PUT', body: { ...f, rowVersion: rv } }); setRv(r.rowVersion); return id;
  };
  const m = useMutation({ mutationFn: async (action: 'save' | 'publish' | 'test') => { const tid = await save(); if (action === 'publish') return api<{ version: number }>(`/comm/templates/${tid}/publish`, { method: 'POST' }); if (action === 'test') return api<{ to: string }>(`/comm/templates/${tid}/test`, { method: 'POST' }); return null; },
    onSuccess: (r, action) => { qc.invalidateQueries({ queryKey: ['comm-templates'] }); toast({ tone: 'success', message: action === 'publish' ? `Publicado (versão ${(r as { version: number }).version})` : action === 'test' ? `Teste enviado para ${(r as { to: string }).to}` : 'Rascunho salvo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const insert = (k: string) => {
    if (tab === 'whatsapp') { setF((x) => ({ ...x, whatsapp: `${x.whatsapp}{{${k}}}` })); return; }
    const el = bodyRef.current; const pos = el?.selectionStart ?? f.body.length;
    setF((x) => ({ ...x, body: `${x.body.slice(0, pos)}{{${k}}}${x.body.slice(pos)}` }));
  };
  return (
    <Modal open onClose={onClose} title={t ? `Template: ${t.name}` : 'Novo template'} size="xl" footer={<>
      <Button onClick={onClose}>Fechar</Button>
      <Button icon={<Send className="h-4 w-4" />} disabled={!f.channels.includes('email') || f.name.trim().length < 2} loading={m.isPending && m.variables === 'test'} onClick={() => m.mutate('test')}>Enviar teste para mim</Button>
      <Button disabled={f.name.trim().length < 2} loading={m.isPending && m.variables === 'save'} onClick={() => m.mutate('save')}>Salvar rascunho</Button>
      <Button variant="primary" disabled={f.name.trim().length < 2 || issues.length > 0} loading={m.isPending && m.variables === 'publish'} onClick={() => m.mutate('publish')}>Publicar versão</Button>
    </>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <FormField label="Nome do template" htmlFor="tp-name"><Input id="tp-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
          <fieldset><legend className="mb-1 text-sm font-medium text-ink">Canais</legend><div className="flex gap-4 text-sm">{(['email', 'whatsapp'] as const).map((c) => <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={f.channels.includes(c)} onChange={() => setF({ ...f, channels: f.channels.includes(c) ? f.channels.filter((x) => x !== c) : [...f.channels, c] })} />{c === 'email' ? 'E-mail' : 'WhatsApp'}</label>)}</div></fieldset>
          <Tabs<'email' | 'whatsapp'> label="Conteúdo por canal" value={tab} onChange={setTab} tabs={[{ key: 'email', label: 'E-mail' }, { key: 'whatsapp', label: 'WhatsApp' }]} />
          {tab === 'email' ? (
            <>
              <FormField label="Assunto" htmlFor="tp-subj"><Input id="tp-subj" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></FormField>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex overflow-hidden rounded-md border border-line" role="radiogroup" aria-label="Formato do corpo">
                  {(['texto', 'html'] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={f.format === k} onClick={() => setF({ ...f, format: k })} className={clsx('px-3 py-1.5 text-sm font-semibold', f.format === k ? 'bg-primary text-white' : 'bg-surface text-text hover:bg-surface-2')}>{k === 'texto' ? 'Texto formatado' : 'HTML'}</button>)}
                </div>
                {f.format === 'html' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.layout} onChange={(e) => setF({ ...f, layout: e.target.checked })} />Usar a moldura institucional (cabeçalho e rodapé)</label>}
                {f.format === 'html' && <Button size="sm" onClick={() => insert('link_resposta')}>Inserir link de resposta</Button>}
              </div>
              {f.format === 'texto'
                ? <FormField label="Corpo" htmlFor="tp-body" hint="Linha em branco separa parágrafos. **texto** deixa em negrito. Linhas começando com “- ” viram lista. O cabeçalho e o rodapé entram sozinhos; a abertura do e-mail é rastreada e quem está fora do sistema recebe o link para responder."><Textarea ref={bodyRef} id="tp-body" rows={12} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></FormField>
                : <FormField label="HTML do corpo" htmlFor="tp-body" hint="Use estilos inline (e-mails não leem CSS externo). {{link_resposta}} marca onde vai o link de resposta (só sai para quem está fora do sistema; sem a marca, entra no final). A abertura é rastreada por um pixel invisível. Scripts, formulários e eventos são removidos no envio."><Textarea ref={bodyRef} id="tp-body" rows={16} spellCheck={false} className="font-mono text-xs leading-relaxed" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></FormField>}
            </>
          ) : <FormField label="Mensagem do WhatsApp" htmlFor="tp-wa" hint="*texto* deixa em negrito no WhatsApp. O link de confirmação entra no fim."><Textarea id="tp-wa" rows={10} value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></FormField>}
          <div><p className="mb-1 text-xs font-semibold text-muted">Inserir variável</p><div className="flex flex-wrap gap-1">{COMM_VARIABLES.map(([k, l]) => <button key={k} type="button" title={`{{${k}}}`} className="rounded border border-line px-2 py-0.5 text-xs hover:border-primary" onClick={() => insert(k)}>{l}</button>)}</div></div>
          {issues.length > 0 && <Notice tone="warning">{issues.join(' ')}</Notice>}
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold text-muted">Pré-visualização com dados de exemplo</p>
          {tab === 'email' ? <iframe title="Pré-visualização do e-mail" className="h-[560px] w-full rounded-md border border-line bg-white" sandbox="" srcDoc={preview?.html ?? ''} />
            : <div className="h-[560px] rounded-md border border-line bg-[#E5DDD5] p-4"><div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-ink shadow-sm">{preview?.whatsapp || 'Escreva a mensagem…'}{'\n\n'}Confirme o recebimento: https://…/r/…</div></div>}
        </div>
      </div>
    </Modal>
  );
}

function Templates() {
  const q = useQuery({ queryKey: ['comm-templates'], queryFn: () => api<{ items: Tpl[] }>('/comm/templates') });
  const [edit, setEdit] = useState<Tpl | 'new' | null>(null);
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data!.items;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">Templates usados nos envios das esteiras. A esteira usa sempre a última versão publicada; editar o rascunho não muda o que já está publicado.</p>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Novo template</Button>
      </div>
      {!items.length ? <EmptyState title="Nenhum template" description="Crie o primeiro e publique para usar nas esteiras." /> : (
        <div className="card overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-4 py-2 font-medium">Nome</th><th className="px-4 py-2 font-medium">Canais</th><th className="px-4 py-2 font-medium">Situação</th><th className="px-4 py-2 font-medium">Alterado</th><th className="px-4 py-2" /></tr></thead>
          <tbody>{items.map((t) => (
            <tr key={t.id} className="border-t border-line">
              <td className="px-4 py-2 font-semibold text-ink">{t.name}</td>
              <td className="px-4 py-2 text-xs">{t.channels.map((c) => (c === 'email' ? 'E-mail' : 'WhatsApp')).join(' · ')}</td>
              <td className="px-4 py-2"><Chip tone={t.version ? 'green' : 'neutral'}>{t.version ? `Publicado v${t.version}` : 'Rascunho'}</Chip></td>
              <td className="px-4 py-2 text-xs text-muted">{fmtDateTime(t.updatedAt)}</td>
              <td className="px-4 py-2 text-right"><Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(t)}>Editar</Button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <TemplateEditor t={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function AdminContractComms() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') === 'templates' ? 'templates' : 'esteiras';
  return (
    <div className="space-y-4">
      <Tabs<'esteiras' | 'templates'> label="Comunicação de contratos" value={tab} onChange={(k) => setParams({ aba: k }, { replace: true })} tabs={[{ key: 'esteiras', label: 'Esteiras' }, { key: 'templates', label: 'Templates' }]} />
      <div className={clsx(tab !== 'esteiras' && 'hidden')}>{tab === 'esteiras' && <Flows />}</div>
      {tab === 'templates' && <Templates />}
    </div>
  );
}
