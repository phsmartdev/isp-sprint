/**
 * Central de Playbooks — leitura dos blocos: texto com formatação simples (sem HTML), destaques, etapas, checklists,
 * tabelas, perguntas frequentes, mídias e arquivos (pelo servidor, com permissão), links, telas do sistema,
 * fluxograma percorrível e árvore de decisão.
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Check, ChevronDown, Download, ExternalLink, FileText, Info, Lightbulb, RotateCcw, Sparkles } from 'lucide-react';
import { ReactFlow, Background, MarkerType, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CALLOUT_LABELS, videoEmbed, type Block, type CalloutKind, type FlowNode } from '@isp/domain';

export const fileUrl = (id: string) => `/api/v1/playbook-files/${id}`;

/** Formatação simples e segura: **negrito**, *itálico*, [texto](https://…) ou [texto](/tela), listas com "- ", parágrafos. Nada vira HTML. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((?:https?:\/\/[^)\s]+|\/[^)\s]*)\))/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={`${key}b${i++}`} className="font-semibold text-ink">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('*')) out.push(<em key={`${key}i${i++}`}>{t.slice(1, -1)}</em>);
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      out.push(href!.startsWith('/')
        ? <Link key={`${key}l${i++}`} to={href!} className="font-semibold text-primary underline-offset-2 hover:underline">{label}</Link>
        : <a key={`${key}l${i++}`} href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">{label}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export function RichText({ text, className }: { text: string; className?: string }) {
  const paras = text.split(/\n{2,}/);
  return (
    <div className={clsx('space-y-3 leading-relaxed', className)}>
      {paras.map((p, k) => {
        const lines = p.split('\n');
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return <ul key={k} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-•]\s+/, ''), `${k}-${j}`)}</li>)}</ul>;
        return <p key={k}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, `${k}-${j}`)}</Fragment>)}</p>;
      })}
    </div>
  );
}

const CALLOUT: Record<CalloutKind, { cls: string; icon: ReactNode }> = {
  atencao: { cls: 'border-[#C2410C] bg-[#FFF4ED] text-[#7C2D12]', icon: <AlertTriangle className="h-5 w-5" /> },
  importante: { cls: 'border-primary bg-primary-soft text-ink', icon: <Info className="h-5 w-5 text-primary" /> },
  exemplo: { cls: 'border-[#15803D] bg-[#F0FDF4] text-[#14532D]', icon: <Sparkles className="h-5 w-5" /> },
  dica: { cls: 'border-[#A16207] bg-[#FEFCE8] text-[#713F12]', icon: <Lightbulb className="h-5 w-5" /> },
};

/** Fluxograma: visão do desenho e modo "percorrer" (escolhe o caminho em cada decisão; mostra a orientação da etapa). */
function FlowBlock({ b }: { b: Extract<Block, { type: 'flow' }> }) {
  const [walk, setWalk] = useState<string[] | null>(null);
  const nodes: Node[] = useMemo(() => b.nodes.map((n) => ({
    id: n.id, position: { x: n.x, y: n.y }, draggable: false, connectable: false,
    data: { label: n.label },
    style: { borderRadius: n.kind === 'decisao' ? 0 : n.kind === 'inicio' || n.kind === 'fim' ? 999 : 0, border: `2px solid ${n.kind === 'decisao' ? '#B45309' : n.kind === 'fim' ? '#2D3339' : '#2F5986'}`, background: walk?.at(-1) === n.id ? '#E8F0F8' : '#fff', fontSize: 13, fontWeight: 600, width: 180, transform: n.kind === 'decisao' ? undefined : undefined },
  })), [b.nodes, walk]);
  const edges: Edge[] = useMemo(() => b.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, label: e.label, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#64748B' }, labelStyle: { fontWeight: 600 } })), [b.edges]);
  const cur = walk ? b.nodes.find((n) => n.id === walk.at(-1)) : null;
  const outs = cur ? b.edges.filter((e) => e.from === cur.id) : [];
  const start = b.nodes.find((n) => n.kind === 'inicio');
  const label = (n: FlowNode) => ({ inicio: 'Início', etapa: 'Etapa', decisao: 'Decisão', fim: 'Fim' })[n.kind];
  return (
    <figure className="border border-line bg-surface">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="font-semibold text-ink">{b.title || 'Fluxograma'}</span>
        {start && <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setWalk(walk ? null : [start.id])}>{walk ? 'Ver o desenho' : 'Percorrer o fluxo'}</button>}
      </figcaption>
      {!walk ? (
        <div className="h-[380px]" aria-label={`Fluxograma ${b.title ?? ''}`}><ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}><Background gap={18} color="#E5E7EB" /></ReactFlow></div>
      ) : cur && (
        <div className="space-y-4 p-5" aria-live="polite">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">{walk.map((id, i) => <li key={i} className="flex items-center gap-1">{i > 0 && <ArrowRight className="h-3 w-3" />}<button type="button" className="hover:underline" onClick={() => setWalk(walk.slice(0, i + 1))}>{b.nodes.find((n) => n.id === id)?.label}</button></li>)}</ol>
          <div className="border-l-4 border-primary pl-4">
            <p className="text-xs font-semibold text-muted">{label(cur)}</p>
            <p className="font-display text-xl font-bold text-ink">{cur.label}</p>
            {cur.guidance && <RichText text={cur.guidance} className="mt-2 text-text" />}
          </div>
          {cur.kind === 'fim' || !outs.length ? (
            <div className="flex items-center gap-3"><span className="inline-flex items-center gap-1 text-sm font-semibold text-[#15803D]"><Check className="h-4 w-4" />Fim do fluxo</span><button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline" onClick={() => setWalk([start!.id])}><RotateCcw className="h-4 w-4" />Recomeçar</button></div>
          ) : (
            <div className="flex flex-wrap gap-2">{outs.map((e) => (
              <button key={e.id} type="button" onClick={() => setWalk([...walk, e.to])} className="inline-flex items-center gap-2 border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:border-primary hover:text-primary">
                {cur.kind === 'decisao' ? (e.label || b.nodes.find((n) => n.id === e.to)?.label) : 'Próxima etapa'}<ArrowRight className="h-4 w-4" />
              </button>
            ))}</div>
          )}
        </div>
      )}
    </figure>
  );
}

/** Árvore de decisão: uma pergunta por vez até o resultado. */
function DecisionBlock({ b }: { b: Extract<Block, { type: 'decision' }> }) {
  const [path, setPath] = useState<{ node: string; choice?: number }[]>([{ node: b.start }]);
  const last = path.at(-1)!;
  const node = b.nodes.find((n) => n.id === last.node);
  const result = last.choice !== undefined ? node?.options[last.choice]?.result : null;
  return (
    <section className="border border-line bg-surface p-5" aria-label={b.title || 'Árvore de decisão'}>
      <p className="mb-3 text-xs font-semibold text-muted">{b.title || 'Árvore de decisão'}</p>
      {path.slice(0, -1).map((p, i) => { const n = b.nodes.find((x) => x.id === p.node); return <p key={i} className="mb-1 text-sm text-muted">{n?.question} <b className="text-ink">{n?.options[p.choice!]?.label}</b></p>; })}
      {result ? (
        <div className="mt-3 border-l-4 border-[#15803D] bg-[#F0FDF4] p-4">
          <p className="text-sm text-muted">{node?.question} <b className="text-ink">{node?.options[last.choice!]?.label}</b></p>
          <RichText text={result} className="mt-1 font-semibold text-[#14532D]" />
        </div>
      ) : node && (
        <div className="mt-2">
          <p className="font-display text-lg font-bold text-ink">{node.question}</p>
          <div className="mt-3 flex flex-wrap gap-2">{node.options.map((o, i) => (
            <button key={i} type="button" className="border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-primary hover:text-primary" onClick={() => {
              const p2 = [...path.slice(0, -1), { node: node.id, choice: i }];
              setPath(o.next ? [...p2, { node: o.next }] : p2);
            }}>{o.label}</button>
          ))}</div>
        </div>
      )}
      {path.length > 1 || result ? <button type="button" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline" onClick={() => setPath([{ node: b.start }])}><RotateCcw className="h-4 w-4" />Recomeçar</button> : null}
    </section>
  );
}

function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="divide-y divide-line border border-line bg-surface">
      {items.map((x, i) => (
        <div key={i}>
          <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-semibold text-ink hover:bg-surface-2">{x.q}<ChevronDown className={clsx('h-4 w-4 shrink-0 transition-transform', open === i && 'rotate-180')} /></button>
          {open === i && <RichText text={x.a} className="px-4 pb-4 text-text" />}
        </div>
      ))}
    </div>
  );
}

/** Um bloco na leitura. `checks`/`onCheck` guardam o checklist de aprendizagem da pessoa (não mexe em dados operacionais). */
export function BlockView({ b, checks = [], onCheck }: { b: Block; checks?: string[]; onCheck?: (key: string, on: boolean) => void }) {
  switch (b.type) {
    case 'heading': return b.level === 1
      ? <h2 id={`s-${b.id}`} className="scroll-mt-24 border-b border-line pb-2 pt-4 font-display text-2xl font-bold text-ink">{b.text}</h2>
      : <h3 id={`s-${b.id}`} className="scroll-mt-24 pt-2 text-lg font-bold text-ink">{b.text}</h3>;
    case 'text': return <RichText text={b.text} className="text-[15px] text-text" />;
    case 'callout': { const c = CALLOUT[b.kind]; return <aside className={clsx('flex gap-3 border-l-4 p-4', c.cls)}><span className="mt-0.5 shrink-0">{c.icon}</span><div><p className="text-sm font-bold">{b.title || CALLOUT_LABELS[b.kind]}</p><RichText text={b.text} className="mt-1 text-[15px]" /></div></aside>; }
    case 'steps': return (
      <ol className="space-y-3">{b.items.map((x, i) => (
        <li key={i} className="flex gap-4"><span className="num flex h-8 w-8 shrink-0 items-center justify-center bg-navy text-sm font-bold text-lime">{i + 1}</span><div className="pt-1"><p className="font-semibold text-ink">{x.title}</p>{x.text && <RichText text={x.text} className="mt-1 text-text" />}</div></li>
      ))}</ol>
    );
    case 'checklist': {
      const done = b.items.filter((x) => checks.includes(`${b.id}:${x.id}`)).length;
      return (
        <section className="border border-line bg-surface p-4" aria-label={b.title || 'Checklist'}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold text-ink">{b.title || 'Checklist'}</p>
            <span className="text-xs text-muted">{b.mode === 'operacional' ? 'Checklist operacional (guia de execução)' : 'Checklist de aprendizagem'} · <span className="num">{done}/{b.items.length}</span></span>
          </div>
          <ul className="space-y-1.5">{b.items.map((x) => {
            const k = `${b.id}:${x.id}`, on = checks.includes(k);
            return <li key={x.id}><label className="flex cursor-pointer items-start gap-3 text-[15px]"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={on} disabled={!onCheck} onChange={(e) => onCheck?.(k, e.target.checked)} /><span className={clsx(on && 'text-muted line-through')}>{x.text}</span></label></li>;
          })}</ul>
        </section>
      );
    }
    case 'table': return (
      <div className="overflow-x-auto border border-line"><table className="w-full text-left text-sm">
        {b.header && b.rows[0] && <thead className="bg-surface-2 text-xs font-semibold text-muted"><tr>{b.rows[0].map((c, i) => <th key={i} className="px-3 py-2">{c}</th>)}</tr></thead>}
        <tbody>{(b.header ? b.rows.slice(1) : b.rows).map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{inline(c, `${i}-${j}`)}</td>)}</tr>)}</tbody>
      </table></div>
    );
    case 'faq': return <Faq items={b.items} />;
    case 'image': return <figure><img src={fileUrl(b.fileId)} alt={b.caption || b.name} className="max-h-[520px] w-auto border border-line" loading="lazy" />{b.caption && <figcaption className="mt-1 text-sm text-muted">{b.caption}</figcaption>}</figure>;
    case 'pdf': return <figure className="border border-line"><iframe title={b.name} src={fileUrl(b.fileId)} className="h-[560px] w-full" sandbox="allow-same-origin allow-downloads" /><figcaption className="flex items-center justify-between border-t border-line px-3 py-2 text-sm"><span>{b.caption || b.name}</span><a href={fileUrl(b.fileId)} target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">Abrir</a></figcaption></figure>;
    case 'file': return <a href={fileUrl(b.fileId)} className="flex items-center gap-3 border border-line bg-surface px-4 py-3 hover:border-primary"><FileText className="h-5 w-5 text-primary" /><span className="flex-1"><span className="block font-semibold text-ink">{b.name}</span>{b.caption && <span className="text-sm text-muted">{b.caption}</span>}</span><Download className="h-4 w-4 text-muted" /></a>;
    case 'video': { const src = videoEmbed(b.url); return src ? <figure><div className="aspect-video w-full border border-line"><iframe title={b.caption || 'Vídeo'} src={src} className="h-full w-full" allow="encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>{b.caption && <figcaption className="mt-1 text-sm text-muted">{b.caption}</figcaption>}</figure> : null; }
    case 'link': return <a href={b.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold text-primary hover:underline">{b.label}<ExternalLink className="h-4 w-4" /></a>;
    case 'feature': return <Link to={b.path} className="inline-flex items-center gap-2 border border-primary px-4 py-2 text-sm font-semibold text-primary hover:bg-primary-soft">{b.label}<ArrowRight className="h-4 w-4" /></Link>;
    case 'flow': return <FlowBlock b={b} />;
    case 'decision': return <DecisionBlock b={b} />;
    case 'divider': return <hr className="border-line" />;
  }
}
