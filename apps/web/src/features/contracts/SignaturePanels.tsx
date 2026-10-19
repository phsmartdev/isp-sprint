/** Modelos de contrato (.docx com timbrado e variáveis), geração do contrato e assinatura pela ZapSign. */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, FileUp, PenLine, RefreshCw } from 'lucide-react';
import { BILLING_TYPES, BILLING_TYPE_LABELS, DOC_TYPES } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { fileToBase64, fmtBytes } from '../../lib/files';
import { Button, Chip, EmptyState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg, type ContractDetail } from './shared';

type Var = { key: string; label: string; type: 'texto' | 'moeda' | 'data' | 'numero'; default: string };
export type Template = { id: string; name: string; description: string | null; billingType: string | null; docType: string; variables: Var[]; detected: string[]; fileName: string; size: number; active: boolean; updatedAt: string };
type ArtTemplate = { id: string; name: string; billingType: string | null; variables: Var[]; pages: number };
type TemplateList = { items: Template[]; art: ArtTemplate[]; systemVariables: { key: string; label: string }[]; itemLoop: string[]; canManage: boolean };
export const useTemplates = () => useQuery({ queryKey: ['contract-templates'], queryFn: () => api<TemplateList>('/contract-templates') });

// ------------------------------------------------------------------ gerar contrato pelo modelo
export function GenerateModal({ c, open, onClose }: { c: ContractDetail; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useTemplates();
  type Opt = { key: string; id: string; source: 'arte' | 'word'; name: string; billingType: string | null; variables: Var[] };
  const list: Opt[] = [
    ...(t.data?.art ?? []).map((x) => ({ key: `a:${x.id}`, id: x.id, source: 'arte' as const, name: x.name, billingType: x.billingType, variables: x.variables })),
    ...(t.data?.items ?? []).filter((x) => x.active).map((x) => ({ key: `w:${x.id}`, id: x.id, source: 'word' as const, name: `${x.name} (Word)`, billingType: x.billingType, variables: x.variables })),
  ];
  const preferred = list.find((x) => x.billingType === c.billingType) ?? list.find((x) => !x.billingType) ?? list[0];
  const [key, setKey] = useState('');
  const tpl = list.find((x) => x.key === (key || preferred?.key));
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const gen = useMutation({
    mutationFn: () => api<{ name: string }>(`/contracts/${c.id}/generate`, { method: 'POST', body: { templateId: tpl!.id, source: tpl!.source, values: Object.fromEntries(tpl!.variables.map((v) => [v.key, values[v.key] ?? v.default])) } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['contract-docs', c.id] }); qc.invalidateQueries({ queryKey: ['contract', c.id] }); toast({ tone: 'success', message: `Contrato gerado: ${r.name}` }); onClose(); },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title="Gerar pelo modelo" size="md" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={gen.isPending} disabled={!tpl} onClick={() => { setError(null); gen.mutate(); }}>Gerar documento</Button></>}>
      {t.isLoading ? <LoadingRows rows={3} /> : !list.length ? <EmptyState title="Nenhum modelo de contrato" description="A gerência cadastra em Configurações → Modelos de contrato (mesmo editor dos modelos de proposta)." /> : (
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <FormField label="Modelo" htmlFor="gm-tpl"><Select id="gm-tpl" value={tpl?.key ?? ''} onChange={(e) => { setKey(e.target.value); setValues({}); }}>{list.map((x) => <option key={x.key} value={x.key}>{x.name}{x.billingType ? ` · ${BILLING_TYPE_LABELS[x.billingType as keyof typeof BILLING_TYPE_LABELS]}` : ''}</option>)}</Select></FormField>
          <p className="text-sm text-muted">Os dados do cliente, do contrato e dos itens entram sozinhos, sobre o timbrado do modelo. {tpl?.source === 'arte' ? 'Gera um PDF.' : 'Gera um Word (.docx).'}</p>
          {tpl?.variables.map((v) => (
            <FormField key={`${tpl.key}-${v.key}`} label={v.label} htmlFor={`gm-${v.key}`} hint={`{{${v.key}}}`}>
              {(values[v.key] ?? v.default).length > 60 ? <Textarea id={`gm-${v.key}`} value={values[v.key] ?? v.default} onChange={(e) => setValues({ ...values, [v.key]: e.target.value })} /> : <Input id={`gm-${v.key}`} value={values[v.key] ?? v.default} onChange={(e) => setValues({ ...values, [v.key]: e.target.value })} />}
            </FormField>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ enviar para assinatura
type Signer = { name: string; email: string; phone: string; authMode: string };
export function SignModal({ c, doc, open, onClose }: { c: ContractDetail; doc: { id: string; name: string } | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [signers, setSigners] = useState<Signer[]>(() => [{ name: c.contact.name, email: c.contact.email ?? '', phone: c.contact.phone ?? '', authMode: 'assinaturaTela' }]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api(`/contracts/${c.id}/documents/${doc!.id}/signature`, { method: 'POST', body: { signers: signers.map((x) => ({ name: x.name, email: x.email || null, phone: x.phone || null, authMode: x.authMode })), message } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract-signatures', c.id] }); qc.invalidateQueries({ queryKey: ['contract', c.id] }); toast({ tone: 'success', message: 'Enviado para assinatura na ZapSign' }); onClose(); },
    onError: (e) => setError(errMsg(e)),
  });
  const set = (i: number, p: Partial<Signer>) => setSigners((x) => x.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <Modal open={open && !!doc} onClose={onClose} title="Enviar para assinatura (ZapSign)" size="md" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={send.isPending} disabled={signers.some((x) => x.name.trim().length < 2 || (!x.email && !x.phone))} onClick={() => { setError(null); send.mutate(); }}>Enviar</Button></>}>
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <p className="text-sm text-muted">Documento: <span className="font-semibold text-ink">{doc?.name}</span>. Cada signatário recebe o link por e-mail; quando todos assinarem, o PDF assinado volta para a ficha.</p>
        {signers.map((sg, i) => (
          <fieldset key={i} className="grid grid-cols-1 gap-2 rounded-md border border-line p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold text-ink">Signatário {i + 1}</legend>
            <FormField label="Nome" htmlFor={`sg-n-${i}`}><Input id={`sg-n-${i}`} value={sg.name} onChange={(e) => set(i, { name: e.target.value })} /></FormField>
            <FormField label="E-mail" htmlFor={`sg-e-${i}`}><Input id={`sg-e-${i}`} type="email" value={sg.email} onChange={(e) => set(i, { email: e.target.value })} /></FormField>
            <FormField label="Celular" htmlFor={`sg-p-${i}`}><Input id={`sg-p-${i}`} inputMode="tel" value={sg.phone} onChange={(e) => set(i, { phone: e.target.value })} /></FormField>
            <FormField label="Autenticação" htmlFor={`sg-a-${i}`}><Select id={`sg-a-${i}`} value={sg.authMode} onChange={(e) => set(i, { authMode: e.target.value })}><option value="assinaturaTela">Assinatura na tela</option><option value="tokenEmail">Código por e-mail</option><option value="assinaturaTela-tokenEmail">Tela + código por e-mail</option><option value="tokenSms">Código por SMS</option><option value="assinaturaTela-tokenSms">Tela + código por SMS</option></Select></FormField>
            {signers.length > 1 && <Button size="sm" variant="ghost" className="sm:col-span-2 justify-self-start" onClick={() => setSigners((x) => x.filter((_, j) => j !== i))}>Remover signatário</Button>}
          </fieldset>
        ))}
        <Button size="sm" onClick={() => setSigners((x) => [...x, { name: '', email: '', phone: '', authMode: 'assinaturaTela' }])} disabled={signers.length >= 10}>Adicionar signatário (ex.: Diretoria, testemunha)</Button>
        <FormField label="Mensagem para os signatários" htmlFor="sg-msg"><Textarea id="sg-msg" value={message} onChange={(e) => setMessage(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}

type Sig = { id: string; documentId: string; documentName: string; status: 'enviado' | 'assinado' | 'recusado' | 'cancelado' | 'erro'; signers: { name: string; email: string | null; signUrl: string | null; status: string; signedAt: string | null }[]; sandbox: boolean; createdAt: string; signedDocumentId: string | null };
export function SignaturesList({ c }: { c: ContractDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['contract-signatures', c.id], queryFn: () => api<{ items: Sig[] }>(`/contracts/${c.id}/signatures`) });
  const sync = useMutation({ mutationFn: (id: string) => api<{ status: string }>(`/contracts/${c.id}/signatures/${id}/sync`, { method: 'POST' }), onSuccess: (r) => { for (const k of ['contract-signatures', 'contract-docs', 'contract']) qc.invalidateQueries({ queryKey: [k] }); toast({ tone: 'success', message: r.status === 'assinado' ? 'Assinado: PDF anexado' : 'Status atualizado' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (!q.data?.items.length) return null;
  const tone = { enviado: 'yellow', assinado: 'green', recusado: 'red', cancelado: 'neutral', erro: 'red' } as const;
  const label = { enviado: 'Aguardando assinaturas', assinado: 'Assinado', recusado: 'Recusado', cancelado: 'Cancelado', erro: 'Erro' };
  return (
    <section aria-labelledby="sig-h" className="rounded-md border border-line p-4">
      <h3 id="sig-h" className="mb-2 font-bold text-ink">Assinaturas eletrônicas</h3>
      <ul className="space-y-3">
        {q.data.items.map((s) => (
          <li key={s.id} className="rounded-md bg-surface-2/60 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><p className="break-words font-semibold text-ink">{s.documentName}</p><p className="text-xs text-muted">Enviado {fmtDateTime(s.createdAt)}{s.sandbox ? ' · sandbox (sem validade jurídica)' : ''}</p></div>
              <div className="flex items-center gap-2"><Chip tone={tone[s.status]}>{label[s.status]}</Chip>{s.status === 'enviado' && <Button size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={sync.isPending && sync.variables === s.id} onClick={() => sync.mutate(s.id)}>Atualizar</Button>}</div>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {s.signers.map((g, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="text-ink">{g.name}</span><span className="text-muted">{g.email}</span>
                  <Chip tone={g.status === 'signed' ? 'green' : 'neutral'}>{g.status === 'signed' ? `Assinou ${g.signedAt ? fmtDateTime(g.signedAt) : ''}` : g.status === 'refused' ? 'Recusou' : 'Pendente'}</Chip>
                  {g.signUrl && g.status !== 'signed' && <button className="link inline-flex items-center gap-1 text-sm" onClick={() => void navigator.clipboard?.writeText(g.signUrl!).then(() => toast({ tone: 'success', message: 'Link copiado' }))}><Copy className="h-3.5 w-3.5" />Copiar link</button>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ cadastro dos modelos
export function TemplatesManager() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useTemplates();
  const fileRef = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState<Template | 'new' | null>(null);
  const [name, setName] = useState('');
  const [btype, setBtype] = useState('');
  const [docType, setDocType] = useState('CONTRATO');
  const [vars, setVars] = useState<Var[]>([]);
  const [active, setActive] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openEdit = (t: Template | 'new') => { setEdit(t); setError(null); setFile(null); setName(t === 'new' ? '' : t.name); setBtype(t === 'new' ? '' : t.billingType ?? ''); setDocType(t === 'new' ? 'CONTRATO' : t.docType); setVars(t === 'new' ? [] : t.variables); setActive(t === 'new' ? true : t.active); };
  const save = useMutation({
    mutationFn: async () => {
      if (file && !file.name.toLowerCase().endsWith('.docx')) throw new Error('Envie o modelo em Word (.docx).');
      if (file && file.size > 6 * 1024 * 1024) throw new Error('Modelo maior que 6 MB.');
      const body = { name, description: null, billingType: btype || null, docType, variables: vars, active, ...(file ? { fileName: file.name, data: await fileToBase64(file) } : {}) };
      if (edit === 'new') { if (!file) throw new Error('Escolha o arquivo .docx do modelo.'); return api<{ variables: Var[]; detected: string[] }>('/contract-templates', { method: 'POST', body }); }
      return api<{ variables: Var[]; detected: string[] }>(`/contract-templates/${(edit as Template).id}`, { method: 'PUT', body });
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['contract-templates'] }); toast({ tone: 'success', message: `Modelo salvo: ${r.detected.length} campo(s) encontrados` }); setEdit(null); },
    onError: (e) => setError(errMsg(e)),
  });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-bold text-ink">Modelos em Word (opcional)</h2><p className="max-w-3xl text-sm text-muted">Alternativa ao modelo com arte: use o Word com o timbrado da empresa (logo e dados no cabeçalho e rodapé) e escreva os campos entre chaves duplas, como {'{{cliente.nome}}'}. Campos que não forem do sistema viram variáveis do modelo, preenchidas na hora de gerar.</p></div>
          {d.canManage && <Button variant="primary" icon={<FileUp className="h-4 w-4" />} onClick={() => openEdit('new')}>Subir modelo</Button>}
        </div>
        {!d.items.length ? <EmptyState title="Nenhum modelo" description="Suba o contrato padrão (.docx) com o timbrado e os campos." /> : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {d.items.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{t.name}</p>
                  <p className="text-sm text-muted">{t.fileName} · {fmtBytes(t.size)} · {t.detected.length} campo(s){t.variables.length ? ` · ${t.variables.length} variável(is) do modelo` : ''}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5"><Chip tone="blue">{t.docType}</Chip>{t.billingType && <Chip tone="purple">{BILLING_TYPE_LABELS[t.billingType as keyof typeof BILLING_TYPE_LABELS]}</Chip>}{!t.active && <Chip>Inativo</Chip>}</div>
                </div>
                <div className="flex gap-2">
                  <a className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line px-3 text-sm font-semibold text-ink hover:bg-surface-2" href={`/api/v1/contract-templates/${t.id}/download`}><Download className="h-4 w-4" />Baixar</a>
                  {d.canManage && <Button size="sm" icon={<PenLine className="h-4 w-4" />} onClick={() => openEdit(t)}>Editar</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card p-5">
        <h3 className="mb-2 font-bold text-ink">Campos que o sistema preenche</h3>
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 xl:grid-cols-3">{d.systemVariables.map((v) => <p key={v.key}><code className="rounded bg-surface-2 px-1 text-xs text-ink">{`{{${v.key}}}`}</code> <span className="text-muted">{v.label}</span></p>)}</div>
        <p className="mt-3 text-sm text-text">Tabela de itens: <code className="rounded bg-surface-2 px-1 text-xs">{'{{#itens}}'} {d.itemLoop.map((k) => `{{${k}}}`).join(' ')} {'{{/itens}}'}</code> — repete a linha para cada produto/serviço.</p>
      </section>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Subir modelo de contrato' : 'Editar modelo'} size="lg" footer={<><Button onClick={() => setEdit(null)}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={name.trim().length < 2} onClick={() => { setError(null); save.mutate(); }}>Salvar modelo</Button></>}>
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormField label="Nome do modelo" htmlFor="tm-name" required className="sm:col-span-3"><Input id="tm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contrato padrão empresarial" /></FormField>
            <FormField label="Tipo de documento" htmlFor="tm-doc"><Select id="tm-doc" value={docType} onChange={(e) => setDocType(e.target.value)}>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></FormField>
            <FormField label="Para contratos do tipo" htmlFor="tm-bt"><Select id="tm-bt" value={btype} onChange={(e) => setBtype(e.target.value)}><option value="">Todos</option>{BILLING_TYPES.map((t) => <option key={t} value={t}>{BILLING_TYPE_LABELS[t]}</option>)}</Select></FormField>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Modelo ativo</label>
          </div>
          <div>
            <input ref={fileRef} type="file" className="sr-only" id="tm-file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button icon={<FileUp className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>{file ? `${file.name} (${fmtBytes(file.size)})` : edit === 'new' ? 'Escolher arquivo .docx' : 'Trocar arquivo .docx'}</Button>
          </div>
          {edit !== 'new' && edit && <p className="text-sm text-muted">Campos encontrados: {edit.detected.map((k) => `{{${k}}}`).join(' ') || 'nenhum'}</p>}
          {vars.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-sm font-semibold text-ink">Variáveis do modelo</legend>
              <ul className="space-y-2">{vars.map((v, i) => (
                <li key={v.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_minmax(0,1fr)_120px_minmax(0,1fr)] sm:items-end">
                  <code className="pb-2 text-xs text-ink">{`{{${v.key}}}`}</code>
                  <FormField label="Rótulo" htmlFor={`tv-l-${i}`}><Input id={`tv-l-${i}`} value={v.label} onChange={(e) => setVars(vars.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></FormField>
                  <FormField label="Tipo" htmlFor={`tv-t-${i}`}><Select id={`tv-t-${i}`} value={v.type} onChange={(e) => setVars(vars.map((x, j) => (j === i ? { ...x, type: e.target.value as Var['type'] } : x)))}><option value="texto">Texto</option><option value="moeda">Valor</option><option value="data">Data</option><option value="numero">Número</option></Select></FormField>
                  <FormField label="Valor padrão" htmlFor={`tv-d-${i}`}><Input id={`tv-d-${i}`} value={v.default} onChange={(e) => setVars(vars.map((x, j) => (j === i ? { ...x, default: e.target.value } : x)))} /></FormField>
                </li>
              ))}</ul>
            </fieldset>
          )}
          {edit === 'new' && <Notice>Depois de salvar, os campos encontrados no arquivo aparecem aqui para você dar rótulo e valor padrão.</Notice>}
        </div>
      </Modal>
    </div>
  );
}
