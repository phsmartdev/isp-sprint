/** Configurações → Modelos de proposta: arte do Canva como fundo, campos variáveis posicionados por clique. */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Trash2, Upload } from 'lucide-react';
import { SEGMENTS, SEGMENT_LABELS, type Segment } from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fileToBase64 } from '../../lib/files';
import { Button, Chip, EmptyState, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { ProposalCanvas, type PField, type PPage } from '../../features/ProposalCanvas';

type Variable = { key: string; label: string; type: 'texto' | 'texto_longo' | 'moeda'; default: string };
type Template = { id: string; name: string; segments: Segment[]; fields: PField[]; variables: Variable[]; active: boolean; pages: PPage[] };
type Data = { items: Template[]; systemVariables: { key: string; label: string }[] };

const SAMPLE: Record<string, string> = {
  'cliente.nome': 'EMPRESA EXEMPLO LTDA', 'cliente.documento': '00.000.000/0001-00', 'cliente.telefone': '(79) 99999-0000', 'cliente.email': 'contato@exemplo.com', 'cliente.endereco': 'Rua Exemplo, 100 · Centro · Aracaju',
  'plano.nome': 'Link Dedicado 300Mbps', 'plano.servico_fatura': 'Link Dedicado 300Mbps', 'plano.velocidade': '300 Mbps', 'plano.valor': 'R$ 729,90', 'plano.valor_numero': '729,90', 'plano.produtos': '• Link Dedicado 300Mbps',
  'oportunidade.taxa_ativacao': 'R$ 0,00', 'oportunidade.titulo': 'Link dedicado escritório', 'vendedor.nome': 'Vendedor Exemplo', 'vendedor.email': 'vendas@exemplo.com', 'empresa.nome': 'Yepnet', 'data.hoje': new Date().toLocaleDateString('pt-BR'),
};
const newId = () => Math.random().toString(36).slice(2, 10);
const errMsg = (e: unknown) => (e instanceof ApiError ? [e.problem.detail ?? e.message, ...(e.problem.errors ?? []).map((x) => x.message)].join(' ') : (e as Error).message);

function Editor({ template, systemVariables, onClose }: { template: Template; systemVariables: Data['systemVariables']; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [t, setT] = useState(template);
  const [pageIdx, setPageIdx] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const update = (v: Partial<Template>) => { setT((x) => ({ ...x, ...v })); setDirty(true); };
  const field = t.fields.find((f) => f.id === sel) ?? null;
  const setField = (v: Partial<PField>) => update({ fields: t.fields.map((f) => (f.id === sel ? { ...f, ...v } : f)) });
  const values = { ...SAMPLE, ...Object.fromEntries(t.variables.map((v) => [v.key, v.default || `[${v.label}]`])) };
  const allVars = [...systemVariables, ...t.variables.map((v) => ({ key: v.key, label: `${v.label} (sua variável)` }))];

  const save = useMutation({
    mutationFn: () => api(`/admin/proposal-templates/${t.id}`, { method: 'PUT', body: { name: t.name, segments: t.segments, fields: t.fields, variables: t.variables, active: t.active } }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ['admin', 'proposal-templates'] }); toast({ tone: 'success', message: 'Modelo salvo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const upload = useMutation({
    mutationFn: async (f: File) => api<PPage>(`/admin/proposal-templates/${t.id}/pages`, { method: 'POST', body: { data: await fileToBase64(f) } }),
    onSuccess: (p) => { setT((x) => ({ ...x, pages: [...x.pages, p] })); setPageIdx(t.pages.length); qc.invalidateQueries({ queryKey: ['admin', 'proposal-templates'] }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const delPage = useMutation({
    mutationFn: (p: PPage) => api(`/admin/proposal-templates/${t.id}/pages/${p.id}`, { method: 'DELETE' }),
    onSuccess: (_r, p) => {
      setT((x) => ({ ...x, pages: x.pages.filter((y) => y.id !== p.id).map((y, i) => ({ ...y, position: i })), fields: x.fields.filter((f) => f.page !== p.position).map((f) => (f.page > p.position ? { ...f, page: f.page - 1 } : f)) }));
      setDirty(true); setPageIdx(0);
    },
  });
  const page = t.pages[pageIdx];

  return (
    <Modal open onClose={() => { if (!dirty || confirm('Sair sem salvar as alterações?')) onClose(); }} title={`Modelo: ${t.name}`} size="xl" footer={<><Button onClick={onClose}>Fechar</Button><Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Salvar modelo</Button></>}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {t.pages.map((p, i) => <Button key={p.id} size="sm" variant={i === pageIdx ? 'primary' : 'secondary'} onClick={() => { setPageIdx(i); setSel(null); }}>Página {i + 1}</Button>)}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
            <Button size="sm" icon={<Upload className="h-4 w-4" />} loading={upload.isPending} onClick={() => fileRef.current?.click()}>Enviar página (PNG/JPG)</Button>
            {page && <Button size="sm" variant="ghost" onClick={() => { if (confirm('Remover esta página e os campos dela?')) delPage.mutate(page); }} icon={<Trash2 className="h-4 w-4 text-danger" />}>Remover página</Button>}
          </div>
          {!page ? (
            <EmptyState title="Envie a arte do modelo" description="No Canva: Compartilhar → Baixar → PNG (todas as páginas). Envie cada página aqui, na ordem." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={placing ? 'primary' : 'secondary'} icon={<Plus className="h-4 w-4" />} onClick={() => setPlacing((x) => !x)}>{placing ? 'Clique na arte onde o campo começa…' : 'Adicionar campo'}</Button>
                <span className="text-xs text-muted">Arraste os campos para posicionar. A prévia usa valores de exemplo.</span>
              </div>
              <div className="mx-auto max-w-[620px] rounded-md border border-line">
                <ProposalCanvas
                  templateId={t.id} page={page} index={pageIdx} fields={t.fields} values={values} selectedId={sel}
                  onSelect={setSel}
                  onMove={(id, x, y) => update({ fields: t.fields.map((f) => (f.id === id ? { ...f, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } : f)) })}
                  onPlace={placing ? (x, y) => { const f: PField = { id: newId(), page: pageIdx, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, w: 35, size: 22, color: '#FFFFFF', align: 'left', bold: false, text: '{{cliente.nome}}' }; update({ fields: [...t.fields, f] }); setSel(f.id); setPlacing(false); } : undefined}
                />
              </div>
            </>
          )}
        </div>

        <div className="space-y-4">
          <FormField label="Nome do modelo" htmlFor="pt-name"><Input id="pt-name" value={t.name} onChange={(e) => update({ name: e.target.value })} /></FormField>
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-ink">Usado para</legend>
            <div className="flex flex-wrap gap-3">{SEGMENTS.map((sg) => <label key={sg} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={t.segments.includes(sg)} onChange={(e) => update({ segments: e.target.checked ? [...t.segments, sg] : t.segments.filter((x) => x !== sg) })} />{SEGMENT_LABELS[sg]}</label>)}</div>
          </fieldset>

          {field ? (
            <fieldset className="space-y-2 rounded-md border border-primary/40 bg-primary-soft/40 p-3">
              <legend className="px-1 text-sm font-semibold text-ink">Campo selecionado</legend>
              <FormField label="Texto (use variáveis)" htmlFor="pf-text"><Textarea id="pf-text" className="min-h-[80px] font-mono text-xs" value={field.text} onChange={(e) => setField({ text: e.target.value })} /></FormField>
              <Select aria-label="Inserir variável" value="" onChange={(e) => { if (e.target.value) setField({ text: `${field.text}{{${e.target.value}}}` }); }}>
                <option value="">+ Inserir variável…</option>
                {allVars.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </Select>
              <div className="grid grid-cols-3 gap-2">
                <FormField label="Tamanho" htmlFor="pf-size"><Input id="pf-size" type="number" min={5} max={200} value={field.size} onChange={(e) => setField({ size: Number(e.target.value) || 22 })} /></FormField>
                <FormField label="Largura %" htmlFor="pf-w"><Input id="pf-w" type="number" min={1} max={100} value={field.w} onChange={(e) => setField({ w: Number(e.target.value) || 30 })} /></FormField>
                <FormField label="Cor" htmlFor="pf-color"><input id="pf-color" type="color" className="h-10 w-full cursor-pointer rounded border border-line" value={field.color} onChange={(e) => setField({ color: e.target.value.toUpperCase() })} /></FormField>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Select aria-label="Alinhamento" className="h-9 w-auto" value={field.align} onChange={(e) => setField({ align: e.target.value as PField['align'] })}><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></Select>
                <label className="flex items-center gap-1"><input type="checkbox" checked={field.bold} onChange={(e) => setField({ bold: e.target.checked })} />Negrito</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!field.strike} onChange={(e) => setField({ strike: e.target.checked })} />Riscado</label>
              </div>
              <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4 text-danger" />} onClick={() => { update({ fields: t.fields.filter((f) => f.id !== sel) }); setSel(null); }}>Remover campo</Button>
            </fieldset>
          ) : <p className="rounded-md bg-surface-2 p-3 text-sm text-muted">Selecione um campo na arte para editar, ou use “Adicionar campo”.</p>}

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold text-ink">Suas variáveis</legend>
            <p className="text-xs text-muted">O vendedor preenche ao gerar a proposta. Use no texto como {'{{chave}}'}.</p>
            {t.variables.map((v, i) => (
              <div key={i} className="space-y-1 rounded-md border border-line p-2">
                <div className="flex gap-1">
                  <Input aria-label="Nome da variável" className="h-9" value={v.label} onChange={(e) => update({ variables: t.variables.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Ex.: Vigência contratual" />
                  <Button size="sm" variant="ghost" aria-label="Remover variável" onClick={() => update({ variables: t.variables.filter((_, j) => j !== i) })} icon={<Trash2 className="h-4 w-4 text-danger" />} />
                </div>
                <div className="flex gap-1">
                  <Input aria-label="Chave" className="h-9 font-mono text-xs" value={v.key} onChange={(e) => update({ variables: t.variables.map((x, j) => (j === i ? { ...x, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') } : x)) })} placeholder="vigencia" />
                  <Select aria-label="Tipo" className="h-9 w-auto" value={v.type} onChange={(e) => update({ variables: t.variables.map((x, j) => (j === i ? { ...x, type: e.target.value as Variable['type'] } : x)) })}><option value="texto">Texto</option><option value="texto_longo">Texto longo</option><option value="moeda">Valor</option></Select>
                </div>
                <Input aria-label="Valor padrão" className="h-9" value={v.default} onChange={(e) => update({ variables: t.variables.map((x, j) => (j === i ? { ...x, default: e.target.value } : x)) })} placeholder="Valor padrão (opcional)" />
              </div>
            ))}
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => update({ variables: [...t.variables, { key: `var_${t.variables.length + 1}`, label: '', type: 'texto', default: '' }] })}>Nova variável</Button>
          </fieldset>
        </div>
      </div>
    </Modal>
  );
}

export function AdminProposalTemplates() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'proposal-templates'], queryFn: () => api<Data>('/admin/proposal-templates') });
  const [editing, setEditing] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/admin/proposal-templates', { method: 'POST', body: { name: 'Yepempresa', segments: ['empresarial'], variables: [
      { key: 'servico_adicional', label: 'Serviço adicional', type: 'texto', default: '' },
      { key: 'vigencia', label: 'Vigência contratual', type: 'texto', default: '36 meses' },
      { key: 'beneficios', label: 'Benefícios contratuais', type: 'texto_longo', default: '• Valor fixo, com reajuste.' },
      { key: 'preco_de', label: 'Preço "De" (riscado)', type: 'moeda', default: '' },
      { key: 'validade', label: 'Validade da proposta', type: 'texto', default: '15 dias' },
    ] } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['admin', 'proposal-templates'] }).then(() => setEditing(r.id)); toast({ tone: 'success', message: 'Modelo criado. Envie as páginas da arte.' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const current = q.data!.items.find((t) => t.id === editing);
  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Modelos de proposta</h2>
          <p className="max-w-3xl text-sm text-muted">Use a arte do Canva como fundo e marque onde entram os dados: nome e CNPJ do cliente, plano, valor, taxa de ativação e as variáveis que você criar (vigência, benefícios…). Na oportunidade, “Gerar proposta” cria o PDF e anexa como proposta.</p>
        </div>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} loading={create.isPending} onClick={() => create.mutate()}>Novo modelo</Button>
      </div>
      {!q.data!.items.length ? <EmptyState title="Nenhum modelo" description="Crie o modelo Yepempresa para as propostas PJ." /> : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data!.items.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 rounded-md border border-line p-4">
              <div>
                <p className="flex items-center gap-2 font-bold text-ink"><FileText className="h-4 w-4 text-primary" />{t.name}</p>
                <p className="text-sm text-muted">{t.segments.length ? t.segments.map((s) => SEGMENT_LABELS[s]).join(', ') : 'Todos os tipos'} · {t.pages.length} página(s) · {t.fields.length} campo(s)</p>
                {!t.pages.length && <Chip tone="yellow" className="mt-1">Falta enviar a arte</Chip>}
              </div>
              <Button size="sm" onClick={() => setEditing(t.id)}>Editar</Button>
            </li>
          ))}
        </ul>
      )}
      {current && <Editor key={current.id} template={current} systemVariables={q.data!.systemVariables} onClose={() => setEditing(null)} />}
    </section>
  );
}
