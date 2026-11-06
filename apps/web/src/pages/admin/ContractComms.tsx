/** Configurações → Comunicação de contratos: esteiras (fluxo com setas) e templates (e-mail institucional e WhatsApp). */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ImagePlus, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { COMM_FORMAT_LABELS, COMM_TRIGGER_LABELS, COMM_VARIABLES, FRAME_HEIGHT, templateIssues, type CommGraph } from '@isp/domain';
import { fileToBase64 } from '../../lib/files';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Notice, Tabs, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { CommFlowEditor } from './CommFlowEditor';
import { ReportMessagesAdmin } from './ReportMessages';

type Fmt = 'texto' | 'html' | 'modelo';
const assetUrl = (id: string) => `/api/v1/comm/assets/${id}`;

/** Imagem de cabeçalho ou rodapé do modelo: enviar, trocar ou remover. */
function ImageSlot({ kind, id, onChange }: { kind: 'cabecalho' | 'rodape'; id: string | null; onChange: (id: string | null) => void }) {
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const label = kind === 'cabecalho' ? 'cabeçalho' : 'rodapé';
  const up = useMutation({
    mutationFn: async (f: File) => api<{ id: string; warning: string | null }>('/comm/assets', { method: 'POST', body: { kind, filename: f.name, data: await fileToBase64(f) } }),
    onSuccess: (r) => { onChange(r.id); if (r.warning) toast({ tone: 'error', message: r.warning }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <div className="group relative" aria-label={`Imagem de ${label}`}>
      {id ? <img src={assetUrl(id)} alt={`Imagem de ${label}`} className="block w-full" /> : (
        <button type="button" onClick={() => ref.current?.click()} className="flex h-20 w-full items-center justify-center gap-2 border-2 border-dashed border-line bg-surface-2 text-sm font-semibold text-muted hover:border-primary hover:text-primary">
          <ImagePlus className="h-5 w-5" aria-hidden />{up.isPending ? 'Enviando…' : `Adicionar imagem de ${label}`}
        </button>
      )}
      {id && (
        <div className="absolute right-2 top-2 flex gap-1">
          <Button size="sm" onClick={() => ref.current?.click()} loading={up.isPending}>Trocar {label}</Button>
          <Button size="sm" icon={<Trash2 className="h-4 w-4" />} aria-label={`Remover ${label}`} onClick={() => onChange(null)} />
        </div>
      )}
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/gif" className="hidden" aria-label={`Arquivo da imagem de ${label}`} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) up.mutate(f); }} />
    </div>
  );
}

type Flow = { id: string; name: string; description: string | null; graph: CommGraph; publishedGraph: CommGraph | null; version: number; active: boolean; publishedAt: string | null; runs: Record<string, number>; draftChanged: boolean };
type Tpl = { id: string; name: string; channels: ('email' | 'whatsapp')[]; subject: string; body: string; whatsapp: string; format: Fmt; layout: boolean; headerAssetId: string | null; footerAssetId: string | null; frameHeight: number; status: string; version: number; rowVersion: number; updatedAt: string };

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

const NEW_MODEL = { name: 'Contrato {{contrato}} · {{cliente}}', format: 'modelo' as Fmt };

function TemplateEditor({ t, onClose, preset }: { t: Tpl | null; onClose: () => void; preset?: typeof NEW_MODEL }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: t?.name ?? preset?.name ?? '', channels: t?.channels ?? ['email'], subject: t?.subject ?? '', body: t?.body ?? '', whatsapp: t?.whatsapp ?? '', format: (t?.format ?? preset?.format ?? 'texto') as Fmt, layout: t?.layout ?? true, headerAssetId: t?.headerAssetId ?? null, footerAssetId: t?.footerAssetId ?? null, frameHeight: t?.frameHeight ?? FRAME_HEIGHT.default });
  const modelo = f.format === 'modelo';
  // onde a variável entra: no nome (assunto do modelo), no corpo ou no WhatsApp
  const [target, setTarget] = useState<'name' | 'subject' | 'body'>('body');
  const nameRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLTextAreaElement>(null);
  // a área do corpo pode ser esticada pelo canto: a altura vira a do e-mail
  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const h = Math.round(el.offsetHeight); if (h >= FRAME_HEIGHT.min && h <= FRAME_HEIGHT.max) setF((x) => (Math.abs(x.frameHeight - h) > 2 ? { ...x, frameHeight: h } : x)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [modelo]);
  const [id, setId] = useState(t?.id ?? null);
  const [rv, setRv] = useState(t?.rowVersion ?? 0);
  const [tab, setTab] = useState<'email' | 'whatsapp'>('email');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState<{ html: string; subject: string; whatsapp: string } | null>(null);
  useEffect(() => {
    const h = setTimeout(() => { void api<{ html: string; subject: string; whatsapp: string }>('/comm/templates/preview', { method: 'POST', body: { name: f.name, subject: f.subject, body: f.body, whatsapp: f.whatsapp, format: f.format, layout: f.layout, headerAssetId: f.headerAssetId, footerAssetId: f.footerAssetId, frameHeight: f.frameHeight } }).then(setPreview).catch(() => undefined); }, 400);
    return () => clearTimeout(h);
  }, [f.name, f.subject, f.body, f.whatsapp, f.format, f.layout, f.headerAssetId, f.footerAssetId, f.frameHeight]);
  const issues = templateIssues(modelo ? { ...f, subject: f.name } : f, f.channels);
  const save = async () => {
    if (!id) { const r = await api<{ id: string }>('/comm/templates', { method: 'POST', body: f }); setId(r.id); const list = await api<{ items: Tpl[] }>('/comm/templates'); setRv(list.items.find((x) => x.id === r.id)!.rowVersion); return r.id; }
    const r = await api<{ rowVersion: number }>(`/comm/templates/${id}`, { method: 'PUT', body: { ...f, rowVersion: rv } }); setRv(r.rowVersion); return id;
  };
  const m = useMutation({ mutationFn: async (action: 'save' | 'publish' | 'test') => { const tid = await save(); if (action === 'publish') return api<{ version: number }>(`/comm/templates/${tid}/publish`, { method: 'POST' }); if (action === 'test') return api<{ to: string }>(`/comm/templates/${tid}/test`, { method: 'POST' }); return null; },
    onSuccess: (r, action) => { qc.invalidateQueries({ queryKey: ['comm-templates'] }); toast({ tone: 'success', message: action === 'publish' ? `Publicado (versão ${(r as { version: number }).version})` : action === 'test' ? `Teste enviado para ${(r as { to: string }).to}` : 'Rascunho salvo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const insert = (k: string) => {
    if (tab === 'whatsapp') { setF((x) => ({ ...x, whatsapp: `${x.whatsapp}{{${k}}}` })); return; }
    if (target === 'name' || target === 'subject') {
      const field = target, el = target === 'name' ? nameRef.current : null; const cur = f[field]; const pos = el?.selectionStart ?? cur.length;
      setF((x) => ({ ...x, [field]: `${x[field].slice(0, pos)}{{${k}}}${x[field].slice(pos)}` }));
      return;
    }
    const el = modelo ? frameRef.current : bodyRef.current; const pos = el?.selectionStart ?? f.body.length;
    setF((x) => ({ ...x, body: `${x.body.slice(0, pos)}{{${k}}}${x.body.slice(pos)}` }));
  };
  return (
    <Modal open onClose={onClose} title={t ? `${modelo ? 'Modelo de e-mail' : 'Template'}: ${t.name}` : modelo ? 'Novo modelo de e-mail' : 'Novo template'} size="xl" footer={<>
      <Button onClick={onClose}>Fechar</Button>
      <Button icon={<Send className="h-4 w-4" />} disabled={!f.channels.includes('email') || f.name.trim().length < 2} loading={m.isPending && m.variables === 'test'} onClick={() => m.mutate('test')}>Enviar teste para mim</Button>
      <Button disabled={f.name.trim().length < 2} loading={m.isPending && m.variables === 'save'} onClick={() => m.mutate('save')}>Salvar rascunho</Button>
      <Button variant="primary" disabled={f.name.trim().length < 2 || issues.length > 0} loading={m.isPending && m.variables === 'publish'} onClick={() => m.mutate('publish')}>Publicar versão</Button>
    </>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <FormField label={modelo ? 'Nome do modelo (é o assunto do e-mail)' : 'Nome do template'} htmlFor="tp-name" hint={modelo ? 'Use as variáveis do contrato: clique no nome e depois na variável. Ex.: Contrato {{contrato}} · {{cliente}}' : undefined}><Input ref={nameRef} id="tp-name" value={f.name} onFocus={() => setTarget('name')} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
          <fieldset><legend className="mb-1 text-sm font-medium text-ink">Canais</legend><div className="flex gap-4 text-sm">{(['email', 'whatsapp'] as const).map((c) => <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={f.channels.includes(c)} onChange={() => setF({ ...f, channels: f.channels.includes(c) ? f.channels.filter((x) => x !== c) : [...f.channels, c] })} />{c === 'email' ? 'E-mail' : 'WhatsApp'}</label>)}</div></fieldset>
          <Tabs<'email' | 'whatsapp'> label="Conteúdo por canal" value={tab} onChange={setTab} tabs={[{ key: 'email', label: 'E-mail' }, { key: 'whatsapp', label: 'WhatsApp' }]} />
          {tab === 'email' ? (
            <>
              {!modelo && <FormField label="Assunto" htmlFor="tp-subj"><Input id="tp-subj" value={f.subject} onFocus={() => setTarget('subject')} onChange={(e) => setF({ ...f, subject: e.target.value })} /></FormField>}
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex overflow-hidden rounded-md border border-line" role="radiogroup" aria-label="Formato do corpo">
                  {(['modelo', 'texto', 'html'] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={f.format === k} onClick={() => setF({ ...f, format: k })} className={clsx('px-3 py-1.5 text-sm font-semibold', f.format === k ? 'bg-primary text-white' : 'bg-surface text-text hover:bg-surface-2')}>{COMM_FORMAT_LABELS[k]}</button>)}
                </div>
                {f.format === 'html' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.layout} onChange={(e) => setF({ ...f, layout: e.target.checked })} />Usar a moldura institucional (cabeçalho e rodapé)</label>}
                {f.format === 'html' && <Button size="sm" onClick={() => insert('link_resposta')}>Inserir link de resposta</Button>}
              </div>
              {modelo ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted">Cabeçalho e rodapé são imagens (largura ideal 600 px). Digite a mensagem na área do meio; estique pelo canto inferior para mudar a altura.</p>
                  <div className="mx-auto w-full max-w-[600px] border border-line bg-white shadow-card" aria-label="Moldura do e-mail">
                    <ImageSlot kind="cabecalho" id={f.headerAssetId} onChange={(id) => setF((x) => ({ ...x, headerAssetId: id }))} />
                    <textarea ref={frameRef} aria-label="Mensagem do e-mail" value={f.body} onFocus={() => setTarget('body')} onChange={(e) => setF({ ...f, body: e.target.value })}
                      placeholder={'Prezado(a) {{destinatario}},\n\nDigite aqui a mensagem do e-mail.\n\nAtenciosamente,\n{{responsavel}}'}
                      style={{ height: f.frameHeight }} className="block w-full resize-y border-0 bg-white px-6 py-6 font-[Arial,Helvetica,sans-serif] text-sm leading-relaxed text-[#334155] outline-none focus:ring-2 focus:ring-inset focus:ring-primary/40" />
                    <ImageSlot kind="rodape" id={f.footerAssetId} onChange={(id) => setF((x) => ({ ...x, footerAssetId: id }))} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <label htmlFor="tp-frame" className="font-semibold">Altura da área da mensagem</label>
                    <Input id="tp-frame" type="number" min={FRAME_HEIGHT.min} max={FRAME_HEIGHT.max} step={20} className="w-24" value={f.frameHeight} onChange={(e) => setF({ ...f, frameHeight: Math.max(FRAME_HEIGHT.min, Math.min(FRAME_HEIGHT.max, Number(e.target.value) || FRAME_HEIGHT.default)) })} />
                    <span>px · **texto** em negrito, linha começando com “- ” vira lista</span>
                  </div>
                </div>
              ) : f.format === 'texto'
                ? <FormField label="Corpo" htmlFor="tp-body" hint="Linha em branco separa parágrafos. **texto** deixa em negrito. Linhas começando com “- ” viram lista. O cabeçalho e o rodapé entram sozinhos; a abertura do e-mail é rastreada e quem está fora do sistema recebe o link para responder."><Textarea ref={bodyRef} id="tp-body" rows={12} value={f.body} onFocus={() => setTarget('body')} onChange={(e) => setF({ ...f, body: e.target.value })} /></FormField>
                : <FormField label="HTML do corpo" htmlFor="tp-body" hint="Use estilos inline (e-mails não leem CSS externo). {{link_resposta}} marca onde vai o link de resposta (só sai para quem está fora do sistema; sem a marca, entra no final). A abertura é rastreada por um pixel invisível. Scripts, formulários e eventos são removidos no envio."><Textarea ref={bodyRef} id="tp-body" rows={16} spellCheck={false} onFocus={() => setTarget('body')} className="font-mono text-xs leading-relaxed" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></FormField>}
            </>
          ) : <FormField label="Mensagem do WhatsApp" htmlFor="tp-wa" hint="*texto* deixa em negrito no WhatsApp. O link de confirmação entra no fim."><Textarea id="tp-wa" rows={10} value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></FormField>}
          <div><p className="mb-1 text-xs font-semibold text-muted">Inserir variável {tab === 'whatsapp' ? 'na mensagem' : target === 'name' ? (modelo ? 'no nome (assunto)' : 'no nome') : target === 'subject' ? 'no assunto' : 'no corpo'}</p><div className="flex flex-wrap gap-1">{COMM_VARIABLES.map(([k, l]) => <button key={k} type="button" title={`{{${k}}}`} className="rounded border border-line px-2 py-0.5 text-xs hover:border-primary" onClick={() => insert(k)}>{l}</button>)}</div></div>
          {issues.length > 0 && <Notice tone="warning">{issues.join(' ')}</Notice>}
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold text-muted">Pré-visualização com dados de exemplo</p>
          {tab === 'email' && preview?.subject && <p className="mb-1 truncate text-sm text-ink" title={preview.subject}><span className="text-muted">Assunto: </span><b>{preview.subject}</b></p>}
          {tab === 'email' ? <iframe title="Pré-visualização do e-mail" className="h-[560px] w-full rounded-md border border-line bg-white" sandbox="" srcDoc={preview?.html ?? ''} />
            : <div className="h-[560px] rounded-md border border-line bg-[#E5DDD5] p-4"><div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-ink shadow-sm">{preview?.whatsapp || 'Escreva a mensagem…'}{'\n\n'}Confirme o recebimento: https://…/r/…</div></div>}
        </div>
      </div>
    </Modal>
  );
}

function Templates() {
  const q = useQuery({ queryKey: ['comm-templates'], queryFn: () => api<{ items: Tpl[] }>('/comm/templates') });
  const [edit, setEdit] = useState<Tpl | 'new' | 'modelo' | null>(null);
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data!.items;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">Templates usados nos envios das esteiras. A esteira usa sempre a última versão publicada; editar o rascunho não muda o que já está publicado.</p>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Novo template</Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('modelo')}>Novo modelo de e-mail</Button>
        </div>
      </div>
      {!items.length ? <EmptyState title="Nenhum template" description="Crie o primeiro e publique para usar nas esteiras." /> : (
        <div className="card overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-4 py-2 font-medium">Nome</th><th className="px-4 py-2 font-medium">Canais</th><th className="px-4 py-2 font-medium">Situação</th><th className="px-4 py-2 font-medium">Alterado</th><th className="px-4 py-2" /></tr></thead>
          <tbody>{items.map((t) => (
            <tr key={t.id} className="border-t border-line">
              <td className="px-4 py-2 font-semibold text-ink">{t.name}{t.format === 'modelo' && <Chip className="ml-2">Modelo com imagens</Chip>}</td>
              <td className="px-4 py-2 text-xs">{t.channels.map((c) => (c === 'email' ? 'E-mail' : 'WhatsApp')).join(' · ')}</td>
              <td className="px-4 py-2"><Chip tone={t.version ? 'green' : 'neutral'}>{t.version ? `Publicado v${t.version}` : 'Rascunho'}</Chip></td>
              <td className="px-4 py-2 text-xs text-muted">{fmtDateTime(t.updatedAt)}</td>
              <td className="px-4 py-2 text-right"><Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(t)}>Editar</Button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {edit && <TemplateEditor t={edit === 'new' || edit === 'modelo' ? null : edit} preset={edit === 'modelo' ? NEW_MODEL : undefined} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function AdminContractComms() {
  const [params, setParams] = useSearchParams();
  const aba = params.get('aba');
  const tab = aba === 'templates' ? 'templates' : aba === 'relatorio' ? 'relatorio' : 'esteiras';
  return (
    <div className="space-y-4">
      <Tabs<'esteiras' | 'templates' | 'relatorio'> label="Comunicação de contratos" value={tab} onChange={(k) => setParams({ aba: k }, { replace: true })} tabs={[{ key: 'esteiras', label: 'Esteiras' }, { key: 'templates', label: 'Templates' }, { key: 'relatorio', label: 'Relatório mensal' }]} />
      <div className={clsx(tab !== 'esteiras' && 'hidden')}>{tab === 'esteiras' && <Flows />}</div>
      {tab === 'templates' && <Templates />}
      {tab === 'relatorio' && <ReportMessagesAdmin />}
    </div>
  );
}
