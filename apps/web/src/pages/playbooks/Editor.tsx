/**
 * Central de Playbooks — criação e editor visual por blocos (para a liderança): informações obrigatórias, público,
 * revisão, blocos (arrastar para reordenar), arquivos, fluxograma, checklist e árvore de decisão; salvamento automático
 * com controle de concorrência; prévia; envio para aprovação.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Background, Controls, MarkerType, ReactFlow, ReactFlowProvider, addEdge, useEdgesState, useNodesState, type Connection, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowDown, ArrowUp, ChevronLeft, Copy, Eye, GripVertical, Plus, Send, Trash2, Upload } from 'lucide-react';
import {
  BLOCK_LABELS, BLOCK_TYPES, CALLOUT_KINDS, CALLOUT_LABELS, PLAYBOOK_TYPES, PLAYBOOK_TYPE_LABELS, REVIEW_PERIODS, REVIEW_PERIOD_LABELS, VERSION_STATUS_LABELS, VISIBILITIES, VISIBILITY_LABELS,
  PROFILE_KEYS, PROFILE_LABELS, contentErrors, type Block, type BlockType, type DecisionNode, type FlowNode,
} from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';
import { BlockView } from '../../features/playbooks/blocks';
import { usePbSetup, type Setup } from './Library';
import type { ReaderData } from './Reader';

export type Meta = {
  title: string; description: string; keywords: string[]; type: (typeof PLAYBOOK_TYPES)[number]; criticality: 'baixa' | 'media' | 'alta';
  ownerTeamId: string | null; costCenterId: string | null; maintainerId: string | null; visibility: (typeof VISIBILITIES)[number];
  teamIds: string[]; costCenterIds: string[]; profiles: string[]; userIds: string[]; reviewPeriod: (typeof REVIEW_PERIODS)[number]; reviewCustomDays: number | null;
  nextReviewOn: string | null; requiresAck: boolean; contexts: string[];
};
const BLANK: Meta = { title: '', description: '', keywords: [], type: 'procedimento', criticality: 'media', ownerTeamId: null, costCenterId: null, maintainerId: null, visibility: 'corporativo', teamIds: [], costCenterIds: [], profiles: [], userIds: [], reviewPeriod: 'anual', reviewCustomDays: null, nextReviewOn: null, requiresAck: false, contexts: [] };
const CONTEXTS: [string, string][] = [['crm:licitacao', 'CRM · Licitação'], ['crm:adesao_ata', 'CRM · Adesão à Ata'], ['crm:consumo_contrato', 'CRM · Consumo de Contrato'], ['crm:venda_consultiva', 'CRM · Venda Consultiva'], ['contratos:cadastro', 'Contratos · Cadastro'], ['contratos:renovacao', 'Contratos · Renovação'], ['contratos:faturamento', 'Contratos · Faturamento'], ['contratos:encerramento', 'Contratos · Encerramento'], ['projetos', 'Projetos'], ['marketing', 'Marketing'], ['gestao_times', 'Gestão de Times']];
const uid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function Multi({ label, options, value, onChange }: { label: string; options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset><legend className="mb-1 text-sm font-semibold text-ink">{label}</legend>
      <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">{options.map((o) => { const on = value.includes(o.id); return <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])} className={clsx('border px-2.5 py-1 text-xs font-semibold', on ? 'border-primary bg-primary text-white' : 'border-line text-ink hover:border-primary')}>{o.label}</button>; })}</div>
    </fieldset>
  );
}

/** Informações obrigatórias e público. */
export function MetaForm({ m, set, setup, compact }: { m: Meta; set: (m: Meta) => void; setup: Setup; compact?: boolean }) {
  const f = <K extends keyof Meta>(k: K, v: Meta[K]) => set({ ...m, [k]: v });
  return (
    <div className={clsx('grid gap-4', compact ? '!flex flex-col' : 'md:grid-cols-2')}>
      <FormField label="Título" htmlFor="pm-t" required className="md:col-span-2"><Input id="pm-t" value={m.title} onChange={(e) => f('title', e.target.value)} placeholder="Ex.: Venda Consultiva" /></FormField>
      <FormField label="Descrição" htmlFor="pm-d" required className="md:col-span-2"><Textarea id="pm-d" rows={2} value={m.description} onChange={(e) => f('description', e.target.value)} /></FormField>
      <FormField label="Tipo de playbook" htmlFor="pm-ty" required><Select id="pm-ty" value={m.type} onChange={(e) => f('type', e.target.value as Meta['type'])}>{PLAYBOOK_TYPES.map((t) => <option key={t} value={t}>{PLAYBOOK_TYPE_LABELS[t]}</option>)}</Select></FormField>
      <FormField label="Criticidade" htmlFor="pm-c" hint="Alta passa sempre por Gerência e Diretoria"><Select id="pm-c" value={m.criticality} onChange={(e) => f('criticality', e.target.value as Meta['criticality'])}><option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option></Select></FormField>
      <FormField label="Time dono" htmlFor="pm-ot" required><Select id="pm-ot" value={m.ownerTeamId ?? ''} onChange={(e) => { const t = e.target.value || null; set({ ...m, ownerTeamId: t, costCenterId: m.costCenterId ?? setup.costCenters.find((c) => c.teamId === t)?.id ?? null }); }}><option value="">Escolha</option>{setup.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FormField>
      <FormField label="Centro de custo responsável" htmlFor="pm-cc" required><Select id="pm-cc" value={m.costCenterId ?? ''} onChange={(e) => f('costCenterId', e.target.value || null)}><option value="">Escolha</option>{setup.costCenters.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select></FormField>
      <FormField label="Responsável pela manutenção" htmlFor="pm-mt" required><Select id="pm-mt" value={m.maintainerId ?? ''} onChange={(e) => f('maintainerId', e.target.value || null)}><option value="">Escolha</option>{setup.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
      <FormField label="Palavras-chave" htmlFor="pm-k" hint="separe por vírgula"><Input id="pm-k" value={m.keywords.join(', ')} onChange={(e) => f('keywords', e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20))} /></FormField>
      <fieldset className="space-y-3 border border-line p-4 md:col-span-2"><legend className="px-1 text-sm font-semibold text-ink">Público autorizado</legend>
        <div className="flex flex-wrap gap-2">{VISIBILITIES.map((v) => <button key={v} type="button" aria-pressed={m.visibility === v} onClick={() => f('visibility', v)} className={clsx('border px-3 py-1.5 text-sm font-semibold', m.visibility === v ? 'border-navy bg-navy text-white' : 'border-line hover:border-primary')}>{VISIBILITY_LABELS[v]}</button>)}</div>
        <p className="text-xs text-muted">{m.visibility === 'corporativo' ? 'Todos da empresa.' : m.visibility === 'compartilhado' ? 'Quem é dos times ou centros de custo escolhidos (e pessoas incluídas).' : 'Só os perfis ou pessoas escolhidos.'}</p>
        {m.visibility === 'compartilhado' && <><Multi label="Times" options={setup.teams.map((t) => ({ id: t.id, label: t.name }))} value={m.teamIds} onChange={(v) => f('teamIds', v)} /><Multi label="Centros de custo" options={setup.costCenters.map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))} value={m.costCenterIds} onChange={(v) => f('costCenterIds', v)} /></>}
        {m.visibility === 'restrito' && <Multi label="Perfis" options={PROFILE_KEYS.map((p) => ({ id: p, label: PROFILE_LABELS[p] }))} value={m.profiles} onChange={(v) => f('profiles', v)} />}
        {m.visibility !== 'corporativo' && <Multi label="Pessoas específicas" options={setup.users.map((u) => ({ id: u.id, label: u.name }))} value={m.userIds} onChange={(v) => f('userIds', v)} />}
      </fieldset>
      <FormField label="Periodicidade de revisão" htmlFor="pm-rp" required><Select id="pm-rp" value={m.reviewPeriod} onChange={(e) => f('reviewPeriod', e.target.value as Meta['reviewPeriod'])}>{REVIEW_PERIODS.map((r) => <option key={r} value={r}>{REVIEW_PERIOD_LABELS[r]}</option>)}</Select></FormField>
      {m.reviewPeriod === 'personalizada' ? <FormField label="A cada (dias)" htmlFor="pm-rd" required><Input id="pm-rd" inputMode="numeric" value={m.reviewCustomDays ?? ''} onChange={(e) => f('reviewCustomDays', Number(e.target.value.replace(/\D/g, '')) || null)} /></FormField>
        : <FormField label="Próxima revisão prevista" htmlFor="pm-nr" hint="Em branco: calculada pela periodicidade na publicação"><Input id="pm-nr" type="date" value={m.nextReviewOn ?? ''} onChange={(e) => f('nextReviewOn', e.target.value || null)} /></FormField>}
      <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={m.requiresAck} onChange={(e) => f('requiresAck', e.target.checked)} />Leitura obrigatória: pedir confirmação de ciência</label>
      <div className="md:col-span-2"><Multi label="Onde este playbook se aplica no ISP Sprint" options={CONTEXTS.map(([id, label]) => ({ id, label }))} value={m.contexts} onChange={(v) => f('contexts', v)} /></div>
    </div>
  );
}
export const metaMissing = (m: Meta) => [!m.title.trim() && 'título', !m.description.trim() && 'descrição', !m.ownerTeamId && 'time dono', !m.costCenterId && 'centro de custo', !m.maintainerId && 'responsável'].filter(Boolean) as string[];

// ------------------------------------------------------------------ criar
export function PlaybookNewPage() {
  const setup = usePbSetup();
  const nav = useNavigate();
  const toast = useToast();
  const [cat, setCat] = useState('');
  const [tpl, setTpl] = useState('');
  const [m, setM] = useState<Meta>(BLANK);
  const save = useMutation({ mutationFn: () => api<{ id: string }>('/playbooks/new', { method: 'POST', body: { categoryId: cat, meta: m, templateId: tpl || null } }), onSuccess: (r) => nav(`/playbooks/${r.id}/editar`), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (setup.isLoading) return <LoadingRows rows={6} />;
  if (setup.isError) return <ErrorState error={setup.error} onRetry={() => setup.refetch()} />;
  const s = setup.data!;
  if (!s.can.create) return <p className="text-muted">Quem cria playbooks é a liderança, a Gerência e a Diretoria.</p>;
  const miss = [...(!cat ? ['categoria'] : []), ...metaMissing(m)];
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/playbooks" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="h-4 w-4" />Playbooks</Link>
      <h1 className="font-display text-3xl font-bold text-ink">Novo playbook</h1>
      <section className="grid gap-4 md:grid-cols-2">
        <FormField label="Categoria" htmlFor="pn-c" required hint="Define o prefixo do código e quem aprova"><Select id="pn-c" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Escolha</option>{s.categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.prefix})</option>)}</Select></FormField>
        <FormField label="Começar de um modelo" htmlFor="pn-t"><Select id="pn-t" value={tpl} onChange={(e) => { setTpl(e.target.value); const t = s.templates.find((x) => x.id === e.target.value); if (t) setM({ ...m, type: t.type as Meta['type'] }); }}><option value="">Em branco</option>{s.templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.system ? '' : ' (da empresa)'}</option>)}</Select></FormField>
      </section>
      <MetaForm m={m} set={setM} setup={s} />
      <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
        {!!miss.length && <p className="text-sm text-muted">Falta: {miss.join(', ')}</p>}
        <Button variant="primary" disabled={!!miss.length} loading={save.isPending} onClick={() => save.mutate()}>Criar e editar o conteúdo</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ editor de blocos
function newBlock(t: BlockType): Block {
  const id = uid();
  switch (t) {
    case 'heading': return { id, type: 'heading', level: 1, text: '' };
    case 'text': return { id, type: 'text', text: '' };
    case 'callout': return { id, type: 'callout', kind: 'importante', text: '' };
    case 'steps': return { id, type: 'steps', items: [{ title: '' }] };
    case 'checklist': return { id, type: 'checklist', mode: 'aprendizagem', title: '', items: [{ id: 'i1', text: '' }] };
    case 'table': return { id, type: 'table', header: true, rows: [['Coluna 1', 'Coluna 2'], ['', '']] };
    case 'faq': return { id, type: 'faq', items: [{ q: '', a: '' }] };
    case 'image': case 'pdf': case 'file': return { id, type: t, fileId: '', name: '' };
    case 'video': return { id, type: 'video', url: '' };
    case 'link': return { id, type: 'link', url: 'https://', label: '' };
    case 'feature': return { id, type: 'feature', path: '/', label: '' };
    case 'flow': return { id, type: 'flow', title: '', nodes: [{ id: 'n1', kind: 'inicio', label: 'Início', x: 0, y: 0 }, { id: 'n2', kind: 'fim', label: 'Fim', x: 0, y: 160 }], edges: [{ id: 'e1', from: 'n1', to: 'n2' }] };
    case 'decision': return { id, type: 'decision', title: '', start: 'q1', nodes: [{ id: 'q1', question: '', options: [{ label: 'Sim', next: null, result: '' }, { label: 'Não', next: null, result: '' }] }] };
    case 'divider': return { id, type: 'divider' };
    case 'gamification_calc': return { id, type: 'gamification_calc', title: 'Calculadora de meta' };
    case 'gamification_rule': return { id, type: 'gamification_rule', title: 'Regra vigente' };
  }
}

function FileField({ playbookId, b, set }: { playbookId: string; b: Extract<Block, { type: 'image' | 'pdf' | 'file' }>; set: (b: Block) => void }) {
  const toast = useToast();
  const up = useMutation({
    mutationFn: async (f: File) => { const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(f); }); return api<{ id: string; name: string }>(`/playbooks/${playbookId}/files`, { method: 'POST', body: { name: f.name, data } }); },
    onSuccess: (r) => set({ ...b, fileId: r.id, name: r.name }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const accept = b.type === 'image' ? '.png,.jpg,.jpeg' : b.type === 'pdf' ? '.pdf' : '.pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx,.doc,.xls';
  return (
    <div className="space-y-2">
      <label className="inline-flex cursor-pointer items-center gap-2 border border-line px-3 py-2 text-sm font-semibold hover:border-primary"><Upload className="h-4 w-4" />{up.isPending ? 'Enviando…' : b.fileId ? `Trocar (${b.name})` : 'Enviar arquivo'}<input type="file" accept={accept} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) up.mutate(f); e.target.value = ''; }} /></label>
      <Input aria-label="Legenda" placeholder="Legenda (opcional)" value={b.caption ?? ''} onChange={(e) => set({ ...b, caption: e.target.value })} />
    </div>
  );
}

/** Editor visual do fluxograma: arraste as etapas, ligue pelos pontos; nome, tipo e orientação de cada etapa. */
function FlowEditor({ b, set }: { b: Extract<Block, { type: 'flow' }>; set: (b: Block) => void }) {
  const toNode = (n: FlowNode): Node => ({ id: n.id, position: { x: n.x, y: n.y }, data: { label: n.label || '(sem nome)' }, style: { border: `2px solid ${n.kind === 'decisao' ? '#B45309' : n.kind === 'fim' ? '#2D3339' : '#2F5986'}`, borderRadius: n.kind === 'inicio' || n.kind === 'fim' ? 999 : 0, width: 170, fontSize: 12, fontWeight: 600 } });
  const [nodes, setNodes, onNodesChange] = useNodesState(b.nodes.map(toNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(b.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, label: e.label, markerEnd: { type: MarkerType.ArrowClosed } })));
  const [sel, setSel] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const push = useCallback((ns: Node[], es: Edge[], meta = b.nodes) => set({ ...b, nodes: meta.filter((m) => ns.some((n) => n.id === m.id)).map((m) => { const n = ns.find((x) => x.id === m.id)!; return { ...m, x: Math.round(n.position.x), y: Math.round(n.position.y) }; }), edges: es.map((e) => ({ id: e.id, from: e.source, to: e.target, label: typeof e.label === 'string' ? e.label : undefined })) }), [b, set]);
  const cur = b.nodes.find((n) => n.id === sel);
  const edge = b.edges.find((e) => e.id === selEdge);
  const upd = (p: Partial<FlowNode>) => { const meta = b.nodes.map((n) => (n.id === sel ? { ...n, ...p } : n)); setNodes((ns) => ns.map((n) => (n.id === sel ? toNode(meta.find((m) => m.id === sel)!) && { ...n, ...toNode(meta.find((m) => m.id === sel)!), position: n.position } : n))); set({ ...b, nodes: meta }); };
  const add = (kind: FlowNode['kind']) => { const id = `n${Date.now().toString(36)}`; const n: FlowNode = { id, kind, label: kind === 'decisao' ? 'Decisão?' : 'Nova etapa', x: 40, y: 40 + b.nodes.length * 20 }; setNodes((ns) => [...ns, toNode(n)]); set({ ...b, nodes: [...b.nodes, n] }); setSel(id); };
  return (
    <div className="space-y-2">
      <Input aria-label="Título do fluxograma" placeholder="Título do fluxograma" value={b.title ?? ''} onChange={(e) => set({ ...b, title: e.target.value })} />
      <div className="flex flex-wrap gap-2">{(['etapa', 'decisao', 'inicio', 'fim'] as const).map((k) => <Button key={k} size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => add(k)}>{({ etapa: 'Etapa', decisao: 'Decisão', inicio: 'Início', fim: 'Fim' })[k]}</Button>)}</div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="h-[380px] border border-line" aria-label="Editor do fluxograma">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={(c) => { onNodesChange(c); }} onEdgesChange={onEdgesChange}
            onNodeDragStop={(_e, n) => push(nodes.map((x) => (x.id === n.id ? n : x)), edges)}
            onConnect={(c: Connection) => { const es = addEdge({ ...c, id: `e${Date.now().toString(36)}`, markerEnd: { type: MarkerType.ArrowClosed } }, edges); setEdges(es); push(nodes, es); }}
            onNodeClick={(_e, n) => { setSel(n.id); setSelEdge(null); }} onEdgeClick={(_e, e) => { setSelEdge(e.id); setSel(null); }} fitView proOptions={{ hideAttribution: true }}>
            <Background gap={18} color="#E5E7EB" /><Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="space-y-2 border border-line p-3 text-sm">
          {cur ? (<>
            <FormField label="Nome" htmlFor="fl-l"><Input id="fl-l" value={cur.label} onChange={(e) => upd({ label: e.target.value })} /></FormField>
            <FormField label="Tipo" htmlFor="fl-k"><Select id="fl-k" value={cur.kind} onChange={(e) => upd({ kind: e.target.value as FlowNode['kind'] })}><option value="inicio">Início</option><option value="etapa">Etapa</option><option value="decisao">Decisão</option><option value="fim">Fim</option></Select></FormField>
            <FormField label="Orientação da etapa" htmlFor="fl-g"><Textarea id="fl-g" rows={4} value={cur.guidance ?? ''} onChange={(e) => upd({ guidance: e.target.value })} /></FormField>
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => { const ns = nodes.filter((n) => n.id !== sel); const es = edges.filter((e) => e.source !== sel && e.target !== sel); setNodes(ns); setEdges(es); push(ns, es, b.nodes.filter((n) => n.id !== sel)); setSel(null); }}>Tirar etapa</Button>
          </>) : edge ? (<>
            <FormField label="Texto da ligação (ex.: Sim, Não, condição)" htmlFor="fl-e"><Input id="fl-e" value={edge.label ?? ''} onChange={(e) => { const es = edges.map((x) => (x.id === selEdge ? { ...x, label: e.target.value } : x)); setEdges(es); push(nodes, es); }} /></FormField>
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => { const es = edges.filter((x) => x.id !== selEdge); setEdges(es); push(nodes, es); setSelEdge(null); }}>Tirar ligação</Button>
          </>) : <p className="text-muted">Clique numa etapa ou ligação para editar. Ligue as etapas arrastando de um ponto até outro.</p>}
        </div>
      </div>
    </div>
  );
}

function DecisionEditor({ b, set }: { b: Extract<Block, { type: 'decision' }>; set: (b: Block) => void }) {
  const setNode = (i: number, n: DecisionNode) => set({ ...b, nodes: b.nodes.map((x, k) => (k === i ? n : x)) });
  return (
    <div className="space-y-3">
      <Input aria-label="Título da árvore" placeholder="Título (opcional)" value={b.title ?? ''} onChange={(e) => set({ ...b, title: e.target.value })} />
      {b.nodes.map((n, i) => (
        <div key={n.id} className="space-y-2 border border-line p-3">
          <div className="flex items-center gap-2"><span className="num text-xs font-semibold text-muted">{n.id === b.start ? 'Pergunta inicial' : `Pergunta ${i + 1}`}</span>{n.id !== b.start && <button type="button" className="ml-auto text-xs text-muted hover:text-danger" onClick={() => set({ ...b, nodes: b.nodes.filter((x) => x.id !== n.id).map((x) => ({ ...x, options: x.options.map((o) => (o.next === n.id ? { ...o, next: null } : o)) })) })}>Tirar</button>}</div>
          <Input aria-label={`Pergunta ${i + 1}`} placeholder="Pergunta" value={n.question} onChange={(e) => setNode(i, { ...n, question: e.target.value })} />
          {n.options.map((o, k) => (
            <div key={k} className="grid gap-2 sm:grid-cols-[140px_200px_minmax(0,1fr)_auto]">
              <Input aria-label={`Opção ${k + 1} da pergunta ${i + 1}`} placeholder="Opção" value={o.label} onChange={(e) => setNode(i, { ...n, options: n.options.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} />
              <Select aria-label="Leva a" value={o.next ?? ''} onChange={(e) => setNode(i, { ...n, options: n.options.map((x, j) => (j === k ? { ...x, next: e.target.value || null } : x)) })}><option value="">Resultado</option>{b.nodes.filter((x) => x.id !== n.id).map((x) => <option key={x.id} value={x.id}>→ {x.question || x.id}</option>)}</Select>
              {o.next ? <span /> : <Input aria-label="Resultado" placeholder="O que fazer" value={o.result ?? ''} onChange={(e) => setNode(i, { ...n, options: n.options.map((x, j) => (j === k ? { ...x, result: e.target.value } : x)) })} />}
              <button type="button" aria-label="Tirar opção" className="text-muted hover:text-danger" onClick={() => setNode(i, { ...n, options: n.options.filter((_, j) => j !== k) })}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setNode(i, { ...n, options: [...n.options, { label: '', next: null, result: '' }] })}>Opção</Button>
        </div>
      ))}
      <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set({ ...b, nodes: [...b.nodes, { id: `q${Date.now().toString(36)}`, question: '', options: [{ label: '', next: null, result: '' }] }] })}>Nova pergunta</Button>
    </div>
  );
}

function ListEditor<T>({ items, set, render, blank, addLabel }: { items: T[]; set: (x: T[]) => void; render: (x: T, upd: (v: T) => void, i: number) => ReactNode; blank: () => T; addLabel: string }) {
  return (
    <div className="space-y-2">
      {items.map((x, i) => <div key={i} className="flex items-start gap-2"><div className="flex-1">{render(x, (v) => set(items.map((y, k) => (k === i ? v : y))), i)}</div><button type="button" aria-label="Tirar" className="mt-2 text-muted hover:text-danger" onClick={() => set(items.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button></div>)}
      <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set([...items, blank()])}>{addLabel}</Button>
    </div>
  );
}

function BlockForm({ b, set, playbookId }: { b: Block; set: (b: Block) => void; playbookId: string }) {
  switch (b.type) {
    case 'heading': return <div className="flex gap-2"><Select aria-label="Nível" className="w-40" value={String(b.level)} onChange={(e) => set({ ...b, level: Number(e.target.value) as 1 | 2 })}><option value="1">Seção (índice)</option><option value="2">Subtítulo</option></Select><Input aria-label="Título" className="flex-1 font-semibold" value={b.text} onChange={(e) => set({ ...b, text: e.target.value })} /></div>;
    case 'text': return <><Textarea aria-label="Texto" rows={4} value={b.text} onChange={(e) => set({ ...b, text: e.target.value })} /><p className="mt-1 text-xs text-muted">**negrito**, *itálico*, [texto](https://…) ou [texto](/tela do sistema), listas começando com “- ”.</p></>;
    case 'callout': return <div className="space-y-2"><Select aria-label="Tipo de destaque" value={b.kind} onChange={(e) => set({ ...b, kind: e.target.value as typeof b.kind })}>{CALLOUT_KINDS.map((k) => <option key={k} value={k}>{CALLOUT_LABELS[k]}</option>)}</Select><Input aria-label="Título do destaque" placeholder="Título (opcional)" value={b.title ?? ''} onChange={(e) => set({ ...b, title: e.target.value })} /><Textarea aria-label="Texto do destaque" rows={3} value={b.text} onChange={(e) => set({ ...b, text: e.target.value })} /></div>;
    case 'steps': return <ListEditor items={b.items} set={(items) => set({ ...b, items })} blank={(): { title: string; text?: string } => ({ title: '' })} addLabel="Etapa" render={(x, u, i) => <div className="space-y-1"><Input aria-label={`Etapa ${i + 1}`} placeholder={`Etapa ${i + 1}`} value={x.title} onChange={(e) => u({ ...x, title: e.target.value })} /><Input aria-label={`Detalhe da etapa ${i + 1}`} placeholder="Detalhe (opcional)" value={x.text ?? ''} onChange={(e) => u({ ...x, text: e.target.value })} /></div>} />;
    case 'checklist': return <div className="space-y-2"><div className="flex gap-2"><Select aria-label="Tipo de checklist" className="w-64" value={b.mode} onChange={(e) => set({ ...b, mode: e.target.value as typeof b.mode })}><option value="aprendizagem">De aprendizagem (individual)</option><option value="operacional">Operacional (guia de execução)</option></Select><Input aria-label="Título do checklist" placeholder="Título" value={b.title ?? ''} onChange={(e) => set({ ...b, title: e.target.value })} /></div>
      <ListEditor items={b.items} set={(items) => set({ ...b, items })} blank={() => ({ id: `i${Date.now().toString(36)}`, text: '' })} addLabel="Item" render={(x, u, i) => <Input aria-label={`Item ${i + 1}`} value={x.text} onChange={(e) => u({ ...x, text: e.target.value })} />} /></div>;
    case 'table': return <div className="space-y-2 overflow-x-auto"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={b.header} onChange={(e) => set({ ...b, header: e.target.checked })} />Primeira linha é cabeçalho</label>
      <table className="text-sm"><tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="p-0.5"><Input aria-label={`Célula ${i + 1}-${j + 1}`} className={clsx('h-8 min-w-[120px]', b.header && i === 0 && 'font-semibold')} value={c} onChange={(e) => set({ ...b, rows: b.rows.map((rr, k) => (k === i ? rr.map((cc, l) => (l === j ? e.target.value : cc)) : rr)) })} /></td>)}<td><button type="button" aria-label="Tirar linha" className="text-muted hover:text-danger" onClick={() => set({ ...b, rows: b.rows.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table>
      <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => set({ ...b, rows: [...b.rows, b.rows[0]!.map(() => '')] })}>+ Linha</Button><Button size="sm" variant="ghost" disabled={(b.rows[0]?.length ?? 0) >= 12} onClick={() => set({ ...b, rows: b.rows.map((r) => [...r, '']) })}>+ Coluna</Button><Button size="sm" variant="ghost" disabled={(b.rows[0]?.length ?? 0) <= 1} onClick={() => set({ ...b, rows: b.rows.map((r) => r.slice(0, -1)) })}>− Coluna</Button></div></div>;
    case 'faq': return <ListEditor items={b.items} set={(items) => set({ ...b, items })} blank={() => ({ q: '', a: '' })} addLabel="Pergunta" render={(x, u, i) => <div className="space-y-1"><Input aria-label={`Pergunta ${i + 1}`} placeholder="Pergunta" value={x.q} onChange={(e) => u({ ...x, q: e.target.value })} /><Textarea aria-label={`Resposta ${i + 1}`} rows={2} placeholder="Resposta" value={x.a} onChange={(e) => u({ ...x, a: e.target.value })} /></div>} />;
    case 'image': case 'pdf': case 'file': return <FileField playbookId={playbookId} b={b} set={set} />;
    case 'video': return <div className="space-y-2"><Input aria-label="Link do vídeo" placeholder="https://www.youtube.com/watch?v=… ou https://vimeo.com/…" value={b.url} onChange={(e) => set({ ...b, url: e.target.value })} /><Input aria-label="Legenda do vídeo" placeholder="Legenda (opcional)" value={b.caption ?? ''} onChange={(e) => set({ ...b, caption: e.target.value })} /></div>;
    case 'link': return <div className="grid gap-2 sm:grid-cols-2"><Input aria-label="Texto do link" placeholder="Texto" value={b.label} onChange={(e) => set({ ...b, label: e.target.value })} /><Input aria-label="Endereço" placeholder="https://" value={b.url} onChange={(e) => set({ ...b, url: e.target.value })} /></div>;
    case 'feature': return <div className="grid gap-2 sm:grid-cols-2"><Input aria-label="Texto do botão" placeholder="Ex.: Abrir oportunidades" value={b.label} onChange={(e) => set({ ...b, label: e.target.value })} /><Input aria-label="Tela do ISP Sprint" placeholder="/opportunities" value={b.path} onChange={(e) => set({ ...b, path: e.target.value })} /></div>;
    case 'flow': return <ReactFlowProvider><FlowEditor b={b} set={set} /></ReactFlowProvider>;
    case 'decision': return <DecisionEditor b={b} set={set} />;
    case 'divider': return <hr className="border-line" />;
    case 'gamification_calc': case 'gamification_rule': return <div className="space-y-1"><Input aria-label="Título do bloco" placeholder="Título" value={b.title ?? ''} onChange={(e) => set({ ...b, title: e.target.value })} /><p className="text-xs text-muted">Interativo na leitura: mostra e calcula com a regra de gamificação aprovada no momento em que a pessoa lê (muda sozinho quando a regra muda).</p></div>;
  }
}

export function PlaybookEditorPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const setup = usePbSetup();
  const pb = useQuery({ queryKey: ['playbooks', 'one', id, 'editor'], queryFn: async () => { const base = await api<ReaderData>(`/playbooks/${id}?view=0`); return base.openVersion ? api<ReaderData>(`/playbooks/${id}?versionId=${base.openVersion.id}&view=0`) : base; } });
  const [meta, setMeta] = useState<Meta | null>(null);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [row, setRow] = useState(0);
  const [state, setState] = useState<'salvo' | 'pendente' | 'salvando' | 'erro' | 'conflito'>('salvo');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [submit, setSubmit] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const v = pb.data?.version;
  const editable = v?.status === 'rascunho' && pb.data?.can.edit;
  useEffect(() => { if (v && pb.data) { setMeta({ ...BLANK, ...(v.meta as Partial<Meta>) }); setBlocks(pb.data.content.blocks); setRow(v.rowVersion); } }, [v?.id, v?.rowVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const timer = useRef<number>();
  const doSave = useCallback(async (m: Meta, bs: Block[], rv: number) => {
    setState('salvando');
    try { const r = await api<{ rowVersion: number; updatedAt: string }>(`/playbook-versions/${v!.id}`, { method: 'PUT', body: { rowVersion: rv, meta: m, content: { blocks: bs } } }); setRow(r.rowVersion); setSavedAt(r.updatedAt); setState('salvo'); return r.rowVersion; }
    catch (e) { const msg = errMsg(e); setState(/Outra pessoa/.test(msg) ? 'conflito' : 'erro'); if (!/Outra pessoa/.test(msg)) toast({ tone: 'error', message: msg }); return null; }
  }, [v, toast]);
  // salvamento automático (só quando o conteúdo está íntegro, para não gravar blocos pela metade)
  const errors = useMemo(() => (blocks ? contentErrors({ blocks }) : []), [blocks]);
  useEffect(() => {
    if (!editable || !meta || !blocks || state === 'conflito') return;
    if (state !== 'pendente') return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { if (!contentErrors({ blocks }).length) void doSave(meta, blocks, row); }, 1200);
    return () => window.clearTimeout(timer.current);
  }, [meta, blocks, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (m: Meta | null, bs: Block[] | null) => { if (m) setMeta(m); if (bs) setBlocks(bs); setState('pendente'); };
  const draft = useMutation({ mutationFn: () => api(`/playbooks/${id}/drafts`, { method: 'POST', body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['playbooks', 'one', id] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const reopen = useMutation({ mutationFn: () => api(`/playbook-versions/${v!.id}/reopen`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['playbooks'] }), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const discard = useMutation({ mutationFn: () => api(`/playbook-versions/${v!.id}/discard`, { method: 'POST' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playbooks'] }); nav(`/playbooks/${id}`); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const saveTpl = useMutation({ mutationFn: (name: string) => api('/playbooks/templates', { method: 'POST', body: { versionId: v!.id, name } }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playbooks', 'setup'] }); toast({ tone: 'success', message: 'Modelo salvo' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const dup = useMutation({ mutationFn: () => api<{ id: string }>('/playbooks/new', { method: 'POST', body: { categoryId: (pb.data!.playbook.category!.id), meta: { ...meta!, title: `${meta!.title} (cópia)` }, duplicateOf: id } }), onSuccess: (r) => nav(`/playbooks/${r.id}/editar`), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (pb.isLoading || setup.isLoading) return <LoadingRows rows={8} />;
  if (pb.isError || !pb.data) return <ErrorState error={pb.error} onRetry={() => pb.refetch()} />;
  const d = pb.data;
  if (!d.can.edit) return <p className="text-muted">Você não edita este playbook.</p>;
  if (!v || v.live) return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={`/playbooks/${id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="h-4 w-4" />{d.playbook.title}</Link>
      <h1 className="font-display text-2xl font-bold text-ink">Nenhuma versão em elaboração</h1>
      <p className="text-text">Abra a próxima versão a partir da vigente. A vigente continua valendo até a nova ser aprovada.</p>
      <Button variant="primary" loading={draft.isPending} onClick={() => draft.mutate()}>Abrir nova versão</Button>
    </div>
  );
  if (!meta || !blocks) return <LoadingRows rows={6} />;
  const setB = (i: number, b: Block) => change(null, blocks.map((x, k) => (k === i ? b : x)));
  const move = (from: number, to: number) => { if (to < 0 || to >= blocks.length || from === to) return; const n = [...blocks]; const [x] = n.splice(from, 1); n.splice(to, 0, x!); change(null, n); };
  const insert = (at: number, t: BlockType) => { const n = [...blocks]; n.splice(at, 0, newBlock(t)); change(null, n); setAdding(null); };
  const miss = metaMissing(meta);
  const AddMenu = ({ at }: { at: number }) => adding === at ? (
    <div className="flex flex-wrap gap-1.5 border border-dashed border-primary bg-primary-soft/40 p-2" role="menu" aria-label="Escolha o bloco">{BLOCK_TYPES.map((t) => <button key={t} role="menuitem" type="button" onClick={() => insert(at, t)} className="border border-line bg-surface px-2.5 py-1 text-xs font-semibold hover:border-primary">{BLOCK_LABELS[t]}</button>)}<button type="button" className="px-2 text-xs text-muted" onClick={() => setAdding(null)}>Cancelar</button></div>
  ) : <button type="button" aria-label="Inserir bloco aqui" onClick={() => setAdding(at)} className="group flex w-full items-center gap-2 py-1 text-xs text-muted hover:text-primary"><span className="h-px flex-1 bg-line group-hover:bg-primary" /><Plus className="h-3.5 w-3.5" /><span className="h-px flex-1 bg-line group-hover:bg-primary" /></button>;
  return (
    <div className="mx-auto max-w-6xl">
      <div className="sticky top-16 z-20 -mx-4 mb-6 flex flex-wrap items-center gap-3 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Link to={`/playbooks/${id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="h-4 w-4" />Sair</Link>
        <div className="min-w-0 flex-1"><p className="num text-xs font-semibold text-muted">{d.playbook.code} · versão {v.number} · {VERSION_STATUS_LABELS[v.status]}</p><p className="truncate font-display text-lg font-bold text-ink">{meta.title || 'Sem título'}</p></div>
        <span role="status" className={clsx('text-xs', state === 'conflito' || state === 'erro' ? 'font-semibold text-danger' : 'text-muted')}>
          {state === 'salvando' ? 'Salvando…' : state === 'pendente' ? (errors.length ? 'Complete os blocos para salvar' : 'Alterações não salvas') : state === 'conflito' ? 'Outra pessoa salvou antes — recarregue' : state === 'erro' ? 'Não salvou' : savedAt ? `Salvo ${fmtDateTime(savedAt)}` : 'Salvo'}
        </span>
        {state === 'conflito' && <Button size="sm" onClick={() => { setState('salvo'); void pb.refetch(); }}>Recarregar</Button>}
        <Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={() => setPreview(!preview)}>{preview ? 'Editar' : 'Prévia'}</Button>
        {editable ? <Button size="sm" variant="primary" icon={<Send className="h-4 w-4" />} disabled={!!miss.length || !!errors.length || !blocks.length || state === 'salvando'} onClick={async () => { if (state === 'pendente' && !(await doSave(meta, blocks, row))) return; setSubmit(true); }}>Enviar para aprovação</Button>
          : ['revisao_gerencia', 'homologacao_diretoria', 'aprovada'].includes(v.status) && <Button size="sm" loading={reopen.isPending} onClick={() => reopen.mutate()}>Voltar para rascunho</Button>}
      </div>
      {!editable && <p className="mb-4 border-l-4 border-primary bg-primary-soft px-4 py-3 text-sm">Esta versão está em <b>{VERSION_STATUS_LABELS[v.status]}</b> e não pode ser alterada. Para mudar, volte para rascunho: as aprovações já dadas caem e o fluxo recomeça.</p>}
      {!!errors.length && state === 'pendente' && <ul className="mb-4 border-l-4 border-[#B45309] bg-[#FFF7E6] px-4 py-2 text-sm text-ink">{errors.slice(0, 4).map((e) => <li key={e}>{e}</li>)}</ul>}
      {preview ? (
        <article className="mx-auto max-w-3xl space-y-5 border border-line bg-surface p-8" aria-label="Prévia">{blocks.map((b) => <BlockView key={b.id} b={b} />)}</article>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-label="Conteúdo" className={clsx(!editable && 'pointer-events-none opacity-70')}>
            <AddMenu at={0} />
            {blocks.map((b, i) => (
              <div key={b.id}>
                <div draggable={editable} onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }}
                  className={clsx('group border bg-surface p-4', drag === i ? 'border-primary opacity-60' : 'border-line')} aria-label={`Bloco ${i + 1}: ${BLOCK_LABELS[b.type]}`}>
                  <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                    <GripVertical className="h-4 w-4 cursor-grab" aria-hidden /><span className="font-semibold">{BLOCK_LABELS[b.type]}</span>
                    <span className="ml-auto flex gap-1">
                      <button type="button" aria-label="Subir bloco" className="p-1 hover:text-ink" onClick={() => move(i, i - 1)}><ArrowUp className="h-4 w-4" /></button>
                      <button type="button" aria-label="Descer bloco" className="p-1 hover:text-ink" onClick={() => move(i, i + 1)}><ArrowDown className="h-4 w-4" /></button>
                      <button type="button" aria-label="Duplicar bloco" className="p-1 hover:text-ink" onClick={() => { const n = [...blocks]; n.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(b)), id: uid() }); change(null, n); }}><Copy className="h-4 w-4" /></button>
                      <button type="button" aria-label="Tirar bloco" className="p-1 hover:text-danger" onClick={() => change(null, blocks.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>
                    </span>
                  </div>
                  <BlockForm b={b} set={(x) => setB(i, x)} playbookId={id} />
                </div>
                <AddMenu at={i + 1} />
              </div>
            ))}
          </section>
          <aside className="space-y-4">
            <details open className="border border-line bg-surface p-4"><summary className="cursor-pointer font-semibold text-ink">Informações do playbook</summary><div className={clsx('mt-3', !editable && 'pointer-events-none opacity-70')}><MetaForm compact m={meta} set={(m) => change(m, null)} setup={setup.data!} /></div>{!!miss.length && <p className="mt-2 text-xs text-danger">Falta: {miss.join(', ')}</p>}</details>
            <div className="space-y-2 border border-line bg-surface p-4 text-sm">
              <Button size="sm" variant="ghost" icon={<Copy className="h-4 w-4" />} loading={dup.isPending} onClick={() => dup.mutate()}>Duplicar como novo playbook</Button>
              <Button size="sm" variant="ghost" onClick={() => { const n = window.prompt('Nome do modelo'); if (n && n.trim().length >= 3) saveTpl.mutate(n.trim()); }}>Salvar como modelo</Button>
              {v.status === 'rascunho' && <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} loading={discard.isPending} onClick={() => { if (window.confirm('Descartar este rascunho? Ele fica no histórico como descartado.')) discard.mutate(); }}>Descartar rascunho</Button>}
            </div>
          </aside>
        </div>
      )}
      {submit && <SubmitModal versionId={v.id} live={!!d.currentVersionId} onClose={() => setSubmit(false)} onDone={() => nav(`/playbooks/${id}?versao=${v.id}`)} />}
    </div>
  );
}

function SubmitModal({ versionId, live, onClose, onDone }: { versionId: string; live: boolean; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ changeSummary: live ? '' : 'Primeira versão', relevant: false, effectiveFrom: '' });
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({ mutationFn: () => api<{ stages: string[] }>(`/playbook-versions/${versionId}/submit`, { method: 'POST', body: { changeSummary: v.changeSummary, relevant: v.relevant, effectiveFrom: v.effectiveFrom || null } }), onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['playbooks'] }); toast({ tone: 'success', message: `Enviado à ${r.stages[0] === 'gerencia' ? 'Gerência' : 'Diretoria'}` }); onDone(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <Modal open onClose={onClose} title="Enviar para aprovação" footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={v.changeSummary.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()}>Enviar</Button></>}>
      <div className="space-y-3">
        <FormField label="O que mudou (justificativa)" htmlFor="sb-s" required><Textarea id="sb-s" rows={3} value={v.changeSummary} onChange={(e) => setV({ ...v, changeSummary: e.target.value })} /></FormField>
        {live && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={v.relevant} onChange={(e) => setV({ ...v, relevant: e.target.checked })} /><span><b>Mudança relevante</b><span className="block text-xs text-muted">Sobe a versão principal (ex.: 2.3 → 3.0) e pede nova ciência a quem recebe.</span></span></label>}
        <FormField label="Vigência sugerida a partir de" htmlFor="sb-e" hint="Em branco: assim que aprovado. A Diretoria confirma a data."><Input id="sb-e" type="date" value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} /></FormField>
        <p className="text-xs text-muted">Depois do envio o conteúdo trava. Se precisar mudar, volte para rascunho: as aprovações caem e o fluxo recomeça.</p>
      </div>
    </Modal>
  );
}
