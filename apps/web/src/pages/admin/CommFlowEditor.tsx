/**
 * Editor visual da esteira de comunicação: caixas (passos) ligadas por setas, arrastáveis.
 * Painel à direita edita o passo selecionado. Salvar grava o rascunho; Publicar valida e passa a valer.
 */
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, addEdge, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import clsx from 'clsx';
import { AlertTriangle, Bell, CheckCircle2, Clock, Flag, GitBranch, ListTodo, Play, Plus, Send, Trash2 } from 'lucide-react';
import {
  COMM_CONDITIONS, COMM_CONDITION_LABELS, COMM_NODE_LABELS, COMM_TRIGGERS, COMM_TRIGGER_ANCHOR, COMM_TRIGGER_LABELS, CONTRACT_OWNERS, CONTRACT_OWNER_LABELS,
  PLAYBOOK_ROLES, PLAYBOOK_ROLE_LABELS, validateCommGraph,
  type CommGraph, type CommNodeData, type CommNodeType, type CommRecipient,
} from '@isp/domain';
import { api } from '../../lib/api';
import { Button, FormField, Input, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Flow = { id: string; name: string; description: string | null; graph: CommGraph; rowVersion: number; version: number; active: boolean };
type Tpl = { id: string; name: string; version: number; channels: string[] };
type Actor = { id: string; name: string };

const ICON: Record<CommNodeType, React.ReactNode> = { gatilho: <Play className="h-4 w-4" />, espera: <Clock className="h-4 w-4" />, envio: <Send className="h-4 w-4" />, condicao: <GitBranch className="h-4 w-4" />, tarefa: <ListTodo className="h-4 w-4" />, fim: <Flag className="h-4 w-4" /> };
const TONE: Record<CommNodeType, string> = { gatilho: '#2F5986', espera: '#64748B', envio: '#16A34A', condicao: '#E0A400', tarefa: '#7C3AED', fim: '#334155' };

type NData = CommNodeData & { kind: CommNodeType; summary: string; invalid: boolean };

function summaryOf(type: CommNodeType, d: CommNodeData, tpls: Tpl[]): string {
  if (type === 'gatilho') return d.trigger ? COMM_TRIGGER_LABELS[d.trigger] : 'Escolha o evento';
  if (type === 'espera') return d.mode == null || d.days == null ? 'Defina a espera' : d.mode === 'aguardar' ? `Aguardar ${d.days} dia(s)` : `${d.days} dia(s) ${d.mode === 'antes' ? 'antes' : 'depois'} da data`;
  if (type === 'envio') { const t = tpls.find((x) => x.id === d.templateId); return `${t?.name ?? 'Escolha o template'} · ${(d.channels ?? []).map((c) => (c === 'email' ? 'e-mail' : 'WhatsApp')).join(' + ') || 'sem canal'} · aprova: ${d.approverRole ? PLAYBOOK_ROLE_LABELS[d.approverRole as keyof typeof PLAYBOOK_ROLE_LABELS] ?? d.approverRole : '—'}`; }
  if (type === 'condicao') return d.condition ? COMM_CONDITION_LABELS[d.condition] : 'Escolha a pergunta';
  if (type === 'tarefa') return d.taskTitle ? `${d.taskTitle} · ${d.taskOwner ? CONTRACT_OWNER_LABELS[d.taskOwner] : ''}` : 'Defina a tarefa';
  return 'Encerra a esteira';
}

function StepNode({ data, selected }: NodeProps<Node<NData>>) {
  const k = data.kind;
  return (
    <div className={clsx('w-60 rounded-md border-2 bg-surface shadow-sm', selected ? 'ring-2 ring-primary ring-offset-1' : '', data.invalid && 'border-dashed')} style={{ borderColor: TONE[k] }}>
      {k !== 'gatilho' && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-[#64748B]" />}
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white" style={{ background: TONE[k] }}>{ICON[k]}{data.label || COMM_NODE_LABELS[k]}{data.invalid && <AlertTriangle className="ml-auto h-4 w-4" aria-label="Incompleto" />}</div>
      <p className="px-3 py-2 text-xs leading-snug text-text">{data.summary}</p>
      {k === 'condicao' ? (
        <>
          <Handle id="sim" type="source" position={Position.Right} style={{ top: '40%' }} className="!h-3 !w-3 !bg-[#16A34A]" />
          <span className="absolute -right-8 text-[10px] font-bold text-success" style={{ top: 'calc(40% - 8px)' }}>sim</span>
          <Handle id="nao" type="source" position={Position.Right} style={{ top: '80%' }} className="!h-3 !w-3 !bg-[#DC2626]" />
          <span className="absolute -right-8 text-[10px] font-bold text-danger" style={{ top: 'calc(80% - 8px)' }}>não</span>
        </>
      ) : k !== 'fim' && <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-[#64748B]" />}
    </div>
  );
}
const nodeTypes = { step: StepNode };
const edgeStyle = (handle?: string | null) => ({ markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: handle === 'nao' ? '#DC2626' : handle === 'sim' ? '#16A34A' : '#64748B' }, style: { strokeWidth: 2, stroke: handle === 'nao' ? '#DC2626' : handle === 'sim' ? '#16A34A' : '#64748B' }, label: handle === 'sim' ? 'sim' : handle === 'nao' ? 'não' : undefined });

function toRf(g: CommGraph, tpls: Tpl[]) {
  const invalid = new Set(validateCommGraph(g).map((i) => i.nodeId).filter(Boolean) as string[]);
  const nodes: Node<NData>[] = g.nodes.map((n) => ({ id: n.id, type: 'step', position: { x: n.x, y: n.y }, data: { ...n.data, kind: n.type, summary: summaryOf(n.type, n.data, tpls), invalid: invalid.has(n.id) }, deletable: n.type !== 'gatilho' }));
  const edges: Edge[] = g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.handle ?? undefined, ...edgeStyle(e.handle) }));
  return { nodes, edges };
}
function fromRf(nodes: Node<NData>[], edges: Edge[]): CommGraph {
  return {
    nodes: nodes.map((n) => { const { kind, summary: _s, invalid: _i, ...data } = n.data; return { id: n.id, type: kind, x: Math.round(n.position.x), y: Math.round(n.position.y), data }; }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, handle: (e.sourceHandle as 'sim' | 'nao' | null | undefined) ?? null })),
  };
}

function Inspector({ node, tpls, actors, onChange, onDelete }: { node: Node<NData>; tpls: Tpl[]; actors: Actor[]; onChange: (d: Partial<CommNodeData>) => void; onDelete: () => void }) {
  const d = node.data;
  const k = d.kind;
  const recips = d.recipients ?? [];
  const hasR = (r: CommRecipient) => recips.some((x) => x.kind === r.kind && x.value === r.value);
  const togR = (r: CommRecipient) => onChange({ recipients: hasR(r) ? recips.filter((x) => !(x.kind === r.kind && x.value === r.value)) : [...recips, r] });
  const [extra, setExtra] = useState('');
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2"><p className="flex items-center gap-2 font-bold text-ink" style={{ color: TONE[k] }}>{ICON[k]}{COMM_NODE_LABELS[k]}</p>{k !== 'gatilho' && <Button size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete}>Remover</Button>}</div>
      <FormField label="Nome do passo (opcional)" htmlFor="ins-label"><Input id="ins-label" value={d.label ?? ''} onChange={(e) => onChange({ label: e.target.value })} /></FormField>
      {k === 'gatilho' && (
        <FormField label="Quando a esteira começa" htmlFor="ins-trg" hint={d.trigger ? `A data de referência é a ${COMM_TRIGGER_ANCHOR[d.trigger]} de cada contrato.` : undefined}>
          <Select id="ins-trg" value={d.trigger ?? ''} onChange={(e) => onChange({ trigger: (e.target.value || undefined) as CommNodeData['trigger'] })}><option value="">Escolha o evento</option>{COMM_TRIGGERS.map((t) => <option key={t} value={t}>{COMM_TRIGGER_LABELS[t]}</option>)}</Select>
        </FormField>
      )}
      {k === 'espera' && (
        <div className="grid grid-cols-[100px_1fr] gap-2">
          <FormField label="Dias" htmlFor="ins-days"><Input id="ins-days" inputMode="numeric" value={d.days ?? ''} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); onChange({ days: v === '' ? undefined : Math.min(730, Number(v)) }); }} /></FormField>
          <FormField label="Contados" htmlFor="ins-mode"><Select id="ins-mode" value={d.mode ?? ''} onChange={(e) => onChange({ mode: (e.target.value || undefined) as CommNodeData['mode'] })}><option value="">Escolha</option><option value="antes">antes da data do gatilho</option><option value="depois">depois da data do gatilho</option><option value="aguardar">a partir do passo anterior</option></Select></FormField>
        </div>
      )}
      {k === 'envio' && (
        <>
          <FormField label="Template" htmlFor="ins-tpl" hint="Só templates publicados entram na esteira publicada."><Select id="ins-tpl" value={d.templateId ?? ''} onChange={(e) => onChange({ templateId: e.target.value || null })}><option value="">Escolha</option>{tpls.map((t) => <option key={t.id} value={t.id}>{t.name}{t.version ? ` (v${t.version})` : ' (rascunho)'}</option>)}</Select></FormField>
          <fieldset><legend className="mb-1 text-sm font-medium text-ink">Canais</legend><div className="flex gap-4 text-sm">{(['email', 'whatsapp'] as const).map((c) => <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={(d.channels ?? []).includes(c)} onChange={() => onChange({ channels: (d.channels ?? []).includes(c) ? (d.channels ?? []).filter((x) => x !== c) : [...(d.channels ?? []), c] })} />{c === 'email' ? 'E-mail' : 'WhatsApp'}</label>)}</div></fieldset>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-medium text-ink">Quem recebe</legend>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hasR({ kind: 'cliente', value: '' })} onChange={() => togR({ kind: 'cliente', value: '' })} />Contato do cliente</label>
            <p className="pt-1 text-xs font-semibold text-muted">Responsáveis do contrato</p>
            {CONTRACT_OWNERS.map((o) => <label key={o} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hasR({ kind: 'responsavel', value: o })} onChange={() => togR({ kind: 'responsavel', value: o })} />{CONTRACT_OWNER_LABELS[o]}</label>)}
            <p className="pt-1 text-xs font-semibold text-muted">Papéis do Playbook</p>
            <div className="grid grid-cols-1 gap-1">{PLAYBOOK_ROLES.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hasR({ kind: 'papel', value: r })} onChange={() => togR({ kind: 'papel', value: r })} />{PLAYBOOK_ROLE_LABELS[r]}</label>)}</div>
            {actors.length > 0 && <><p className="pt-1 text-xs font-semibold text-muted">Atores externos</p>{actors.map((a) => <label key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hasR({ kind: 'ator', value: a.id })} onChange={() => togR({ kind: 'ator', value: a.id })} />{a.name}</label>)}</>}
            <p className="pt-1 text-xs font-semibold text-muted">E-mail avulso</p>
            {recips.filter((r) => r.kind === 'email').map((r) => <span key={r.value} className="mr-1 inline-flex items-center gap-1 rounded bg-surface-2 px-2 py-0.5 text-xs">{r.value}<button type="button" aria-label={`Retirar ${r.value}`} onClick={() => togR(r)}>×</button></span>)}
            <div className="flex gap-2"><Input aria-label="E-mail avulso" type="email" placeholder="nome@empresa.com" value={extra} onChange={(e) => setExtra(e.target.value)} /><Button size="sm" disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extra)} onClick={() => { togR({ kind: 'email', value: extra.trim().toLowerCase() }); setExtra(''); }}>Incluir</Button></div>
          </fieldset>
          <FormField label="Quem aprova o envio" htmlFor="ins-appr" hint="Todo envio fica parado até ser aprovado. Sem titular no papel, aprova quem tem Contratos em nível Total."><Select id="ins-appr" value={d.approverRole ?? ''} onChange={(e) => onChange({ approverRole: e.target.value || null })}><option value="">Escolha o papel</option>{PLAYBOOK_ROLES.map((r) => <option key={r} value={r}>{PLAYBOOK_ROLE_LABELS[r]}</option>)}</Select></FormField>
        </>
      )}
      {k === 'condicao' && (
        <FormField label="Pergunta" htmlFor="ins-cond" hint="Ligue a bolinha verde (sim) e a vermelha (não) aos próximos passos."><Select id="ins-cond" value={d.condition ?? ''} onChange={(e) => onChange({ condition: (e.target.value || undefined) as CommNodeData['condition'] })}><option value="">Escolha</option>{COMM_CONDITIONS.map((c) => <option key={c} value={c}>{COMM_CONDITION_LABELS[c]}</option>)}</Select></FormField>
      )}
      {k === 'tarefa' && (
        <>
          <FormField label="Título da tarefa" htmlFor="ins-tt"><Input id="ins-tt" value={d.taskTitle ?? ''} onChange={(e) => onChange({ taskTitle: e.target.value })} /></FormField>
          <div className="grid grid-cols-[1fr_100px] gap-2">
            <FormField label="Para" htmlFor="ins-to"><Select id="ins-to" value={d.taskOwner ?? ''} onChange={(e) => onChange({ taskOwner: (e.target.value || undefined) as CommNodeData['taskOwner'] })}><option value="">Escolha</option>{CONTRACT_OWNERS.map((o) => <option key={o} value={o}>{CONTRACT_OWNER_LABELS[o]}</option>)}</Select></FormField>
            <FormField label="Prazo (dias)" htmlFor="ins-td"><Input id="ins-td" inputMode="numeric" value={d.taskDays ?? ''} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); onChange({ taskDays: v === '' ? undefined : Number(v) }); }} /></FormField>
          </div>
        </>
      )}
    </div>
  );
}

function Editor({ flow, tpls, actors, onBack }: { flow: Flow; tpls: Tpl[]; actors: Actor[]; onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const init = useMemo(() => toRf(flow.graph, tpls), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NData>>(init.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(init.edges);
  const [sel, setSel] = useState<string | null>(null);
  const [name, setName] = useState(flow.name);
  const [rowVersion, setRowVersion] = useState(flow.rowVersion);
  const graph = fromRf(nodes, edges);
  const issues = validateCommGraph(graph);
  const refresh = (g: CommGraph) => { const inv = new Set(validateCommGraph(g).map((i) => i.nodeId).filter(Boolean) as string[]); setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, summary: summaryOf(n.data.kind, n.data, tpls), invalid: inv.has(n.id) } }))); };
  const onConnect = useCallback((c: Connection) => setEdges((es) => {
    // uma saída por bolinha: ligar de novo substitui a seta anterior
    const rest = es.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)));
    return addEdge({ ...c, id: `e-${c.source}-${c.sourceHandle ?? 'out'}-${c.target}`, ...edgeStyle(c.sourceHandle) }, rest);
  }), [setEdges]);
  const add = (type: CommNodeType) => {
    const id = `${type}-${Math.random().toString(36).slice(2, 7)}`;
    const last = nodes.reduce((m, n) => Math.max(m, n.position.x), 0);
    const data: CommNodeData = type === 'envio' ? { channels: ['email'], recipients: [] } : {};
    setNodes((ns) => [...ns, { id, type: 'step', position: { x: last + 300, y: 120 + (ns.length % 3) * 40 }, data: { ...data, kind: type, summary: summaryOf(type, data, tpls), invalid: true } }]);
    setSel(id);
  };
  const patch = (id: string, d: Partial<CommNodeData>) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...d, summary: summaryOf(n.data.kind, { ...n.data, ...d }, tpls) } } : n)));
  const save = useMutation({
    mutationFn: () => api<{ rowVersion: number; issues: { nodeId: string | null; message: string }[] }>(`/comm/flows/${flow.id}`, { method: 'PUT', body: { rowVersion, name, graph } }),
    onSuccess: (r) => { setRowVersion(r.rowVersion); refresh(graph); qc.invalidateQueries({ queryKey: ['comm-flows'] }); toast({ tone: 'success', message: r.issues.length ? `Rascunho salvo com ${r.issues.length} pendência(s)` : 'Rascunho salvo' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const publish = useMutation({
    mutationFn: async () => { const r = await api<{ rowVersion: number }>(`/comm/flows/${flow.id}`, { method: 'PUT', body: { rowVersion, name, graph } }); setRowVersion(r.rowVersion); return api<{ version: number }>(`/comm/flows/${flow.id}/publish`, { method: 'POST' }); },
    onSuccess: (r) => { refresh(graph); qc.invalidateQueries({ queryKey: ['comm-flows'] }); toast({ tone: 'success', message: `Esteira publicada (versão ${r.version}). Ligue-a para começar a rodar.` }); },
    onError: (e) => { refresh(graph); toast({ tone: 'error', message: errMsg(e) }); },
  });
  const selected = nodes.find((n) => n.id === sel) ?? null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2"><Button size="sm" onClick={onBack}>← Esteiras</Button><Input aria-label="Nome da esteira" className="max-w-md font-bold" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="flex flex-wrap gap-2"><Button loading={save.isPending} onClick={() => save.mutate()}>Salvar rascunho</Button><Button variant="primary" loading={publish.isPending} onClick={() => publish.mutate()}>Publicar</Button></div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Adicionar passo:</span>
        {(['espera', 'envio', 'condicao', 'tarefa', 'fim'] as CommNodeType[]).map((t) => <Button key={t} size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => add(t)}><span className="flex items-center gap-1" style={{ color: TONE[t] }}>{ICON[t]}</span>{COMM_NODE_LABELS[t]}</Button>)}
        <span className={clsx('ml-auto flex items-center gap-1 text-xs font-semibold', issues.length ? 'text-[#C2610C]' : 'text-success')}>{issues.length ? <><AlertTriangle className="h-4 w-4" />{issues.length} pendência(s) para publicar</> : <><CheckCircle2 className="h-4 w-4" />Pronta para publicar</>}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="card h-[620px] overflow-hidden p-0" aria-label="Desenho da esteira">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_, n) => setSel(n.id)} onPaneClick={() => setSel(null)} fitView fitViewOptions={{ padding: 0.15, maxZoom: 1, minZoom: 0.75 }} minZoom={0.3} deleteKeyCode={['Delete', 'Backspace']} proOptions={{ hideAttribution: true }}>
            <Background gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside className="card max-h-[620px] overflow-y-auto p-4">
          {selected ? <Inspector key={selected.id} node={selected} tpls={tpls} actors={actors} onChange={(d) => patch(selected.id, d)} onDelete={() => { setNodes((ns) => ns.filter((n) => n.id !== selected.id)); setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id)); setSel(null); }} />
            : (
              <div className="space-y-3 text-sm text-text">
                <p className="font-bold text-ink">Como montar</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Clique no <strong>Gatilho</strong> e escolha o evento (ex.: término da vigência).</li>
                  <li>Adicione passos e <strong>ligue as bolinhas</strong> arrastando de um passo ao outro: a seta mostra a direção.</li>
                  <li>Na <strong>Condição</strong>, a bolinha verde é “sim” e a vermelha é “não”.</li>
                  <li>Todo <strong>envio</strong> fica parado aguardando aprovação de quem você indicar.</li>
                  <li>Salve o rascunho a qualquer momento; <strong>Publicar</strong> confere o desenho.</li>
                </ol>
                {issues.length > 0 && <div><p className="mb-1 font-semibold text-[#C2610C]">Pendências</p><ul className="list-disc space-y-0.5 pl-5 text-xs">{issues.slice(0, 12).map((i, k) => <li key={k}><button type="button" className="text-left hover:underline" onClick={() => i.nodeId && setSel(i.nodeId)}>{i.message}</button></li>)}</ul></div>}
                <p className="flex items-start gap-2 rounded-md bg-surface-2 p-2 text-xs"><Bell className="mt-0.5 h-4 w-4 shrink-0" />A abertura de cada e-mail é rastreada (pixel); quem está fora do sistema recebe um link para responder. A condição “foi aberto?” usa esse rastreio.</p>
              </div>
            )}
        </aside>
      </div>
    </div>
  );
}

export function CommFlowEditor({ flowId, onBack }: { flowId: string; onBack: () => void }) {
  const flows = useQuery({ queryKey: ['comm-flows'], queryFn: () => api<{ items: Flow[] }>('/comm/flows') });
  const tpls = useQuery({ queryKey: ['comm-templates'], queryFn: () => api<{ items: Tpl[] }>('/comm/templates') });
  const pb = useQuery({ queryKey: ['contract-playbook'], queryFn: () => api<{ actors: (Actor & { active: boolean })[] }>('/contract-playbook') });
  const flow = flows.data?.items.find((f) => f.id === flowId);
  if (!flow || !tpls.data || !pb.data) return <div className="card p-6 text-sm text-muted">Carregando…</div>;
  return <ReactFlowProvider><Editor flow={flow} tpls={tpls.data.items} actors={pb.data.actors.filter((a) => a.active)} onBack={onBack} /></ReactFlowProvider>;
}

