/**
 * Editor de ofício: prévia exata em PDF (timbrado da filial + texto) desenhada na tela, com os blocos arrastáveis por
 * cima para ajustar a posição; ao lado, o texto de cada bloco (negrito, sublinhado, itálico e variáveis) e os ajustes
 * finos (posição, largura, alinhamento, fonte, recuo e espaçamento). Usado no modelo e na emissão a partir do contrato.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Italic, Plus, Trash2, Underline } from 'lucide-react';
import { Button, FormField, Input, Select, Textarea } from '../../components/ui/primitives';

export type OfficeBlock = { id: string; kind: 'texto' | 'assinatura'; label?: string; x: number; y: number; w: number; align: 'left' | 'right' | 'center' | 'justify'; size: number; lineGap: number; indent: number; paraGap: number; text: string;
  /** assinatura digitalizada inserida no bloco (PNG/JPG em base64); sem ela, a da filial */
  sigImage?: string | null; sigH?: number; sigDx?: number; sigDy?: number };
export type VarDef = { key: string; label: string; sample: string };
type Box = { id: string; page: number; x: number; y: number; w: number; h: number };
export type PreviewFn = (blocks: OfficeBlock[]) => Promise<{ pdf: string; boxes: Box[]; pages: number }>;

const A4W = 210, A4H = 297;
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Desenha a 1ª página do PDF no canvas (pdf.js, carregado só aqui). */
async function drawPdf(canvas: HTMLCanvasElement, b64: string, cssWidth: number) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: b64ToBytes(b64) }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const ratio = window.devicePixelRatio || 1;
  const vp = page.getViewport({ scale: (cssWidth / base.width) * ratio });
  canvas.width = vp.width; canvas.height = vp.height;
  canvas.style.width = `${cssWidth}px`; canvas.style.height = `${(cssWidth / base.width) * base.height}px`;
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
  await doc.destroy();
}

export function OfficePreview({ blocks, preview, selected, onSelect, onMove, onResize, width = 520, pagesNote = true }: { blocks: OfficeBlock[]; preview: PreviewFn; selected?: string | null; onSelect?: (id: string) => void; onMove?: (id: string, x: number, y: number) => void; onResize?: (id: string, w: number) => void; width?: number; pagesNote?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number } | null>(null);
  const [rsz, setRsz] = useState<{ id: string; w: number } | null>(null);
  const k = width / A4W; // px por mm
  const key = JSON.stringify(blocks);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await preview(blocks);
        if (!alive) return;
        if (canvas.current) await drawPdf(canvas.current, r.pdf, width);
        setBoxes(r.boxes); setPages(r.pages); setErr(null);
      } catch (e) { if (alive) setErr((e as Error).message); } finally { if (alive) setBusy(false); }
    }, 450);
    return () => { alive = false; clearTimeout(t); };
  }, [key, width, preview]); // eslint-disable-line react-hooks/exhaustive-deps
  const onDown = (e: React.PointerEvent, b: Box) => {
    onSelect?.(b.id);
    if (!onMove) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    setDrag({ id: b.id, dx: (e.clientX - r.left) / k - b.x, dy: (e.clientY - r.top) / k - b.y, x: b.x, y: b.y });
  };
  const onMoveP = (e: React.PointerEvent) => {
    if (rsz) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const box = boxes.find((b) => b.id === rsz.id);
      if (box) setRsz({ id: rsz.id, w: Math.round(Math.max(10, Math.min(A4W - box.x, (e.clientX - r.left) / k - box.x)) * 2) / 2 });
      return;
    }
    if (!drag) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const box = boxes.find((b) => b.id === drag.id);
    const x = Math.max(0, Math.min(A4W - (box?.w ?? 10), (e.clientX - r.left) / k - drag.dx));
    const y = Math.max(0, Math.min(A4H - 5, (e.clientY - r.top) / k - drag.dy));
    setDrag({ ...drag, x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 });
  };
  const onUp = () => { if (rsz) { onResize?.(rsz.id, rsz.w); setRsz(null); } if (drag) { onMove?.(drag.id, drag.x, drag.y); setDrag(null); } };
  return (
    <div className="space-y-1">
      <div className="relative select-none border border-line bg-white shadow-sm" style={{ width, height: width * (A4H / A4W) }} onPointerMove={onMoveP} onPointerUp={onUp} aria-label="Prévia do ofício">
        <canvas ref={canvas} className="absolute inset-0" />
        {boxes.map((b) => {
          const pos = drag?.id === b.id ? drag : b;
          return (
            <div key={b.id} role="button" tabIndex={0} aria-label={`Bloco ${blocks.find((x) => x.id === b.id)?.label ?? b.id}`}
              onPointerDown={(e) => onDown(e, b)} onKeyDown={(e) => e.key === 'Enter' && onSelect?.(b.id)}
              className={clsx('absolute border border-dashed transition-colors', onMove ? 'cursor-move' : 'cursor-pointer', selected === b.id ? 'border-primary bg-primary/10' : 'border-transparent hover:border-primary/60 hover:bg-primary/5')}
              style={{ left: pos.x * k, top: pos.y * k, width: (rsz?.id === b.id ? rsz.w : b.w) * k, height: Math.min(b.h, A4H - pos.y) * k }}>
              {/* alça na borda direita: ajusta a largura do bloco */}
              {onResize && selected === b.id && <span role="slider" aria-label="Ajustar largura do bloco" aria-valuenow={b.w} tabIndex={0} className="absolute -right-1.5 top-1/2 h-6 w-3 -translate-y-1/2 cursor-ew-resize rounded-sm border border-primary bg-white"
                onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setRsz({ id: b.id, w: b.w }); }} />}
            </div>
          );
        })}
        {busy && <span className="absolute right-2 top-2 rounded bg-ink/70 px-2 py-0.5 text-2xs text-white">Atualizando…</span>}
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      {pagesNote && pages > 1 && <p className="text-xs text-warning">O texto passou para {pages} páginas: diminua a fonte ou o espaçamento, ou reposicione os blocos.</p>}
    </div>
  );
}

/** Painel de edição: lista de blocos, texto com formatação e variáveis, posição e tipografia do bloco escolhido. */
export function OfficeEditor({ blocks, onChange, preview, varDefs, previewWidth = 520 }: { blocks: OfficeBlock[]; onChange: (b: OfficeBlock[]) => void; preview: PreviewFn; varDefs: VarDef[]; previewWidth?: number }) {
  const [sel, setSel] = useState<string | null>(blocks[0]?.id ?? null);
  const area = useRef<HTMLTextAreaElement>(null);
  const b = blocks.find((x) => x.id === sel) ?? null;
  const set = useCallback((patch: Partial<OfficeBlock>) => onChange(blocks.map((x) => (x.id === sel ? { ...x, ...patch } : x))), [blocks, sel, onChange]);
  /** envolve a seleção com o marcador (ou insere a variável no cursor) */
  const wrap = (open: string, close = open) => {
    const el = area.current;
    if (!el || !b) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const t = b.text.slice(0, s) + open + b.text.slice(s, e) + close + b.text.slice(e);
    set({ text: t });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + open.length, e + open.length); });
  };
  const add = (kind: OfficeBlock['kind']) => {
    const id = `${kind}-${Date.now().toString(36)}`;
    onChange([...blocks, kind === 'assinatura'
      ? { id, kind, label: 'Assinatura', x: 55, y: 230, w: 100, align: 'center', size: 8.5, lineGap: 1.3, indent: 0, paraGap: 0, text: '{{filial.razao_social}}\nCNPJ: {{filial.cnpj}}\n{{assinatura}}\n_{{assinante.nome}}_\n{{assinante.cargo}}' }
      : { id, kind, label: 'Novo texto', x: 20, y: 120, w: 170, align: 'left', size: 11, lineGap: 1.35, indent: 0, paraGap: 2, text: 'Novo texto' }]);
    setSel(id);
  };
  const num = (k: keyof OfficeBlock, label: string, min: number, max: number, step = 0.5) => (
    <FormField label={label} htmlFor={`ob-${k}`}><Input id={`ob-${k}`} type="number" min={min} max={max} step={step} className="h-9" value={String(b![k])} onChange={(e) => set({ [k]: Math.max(min, Math.min(max, Number(e.target.value) || 0)) } as Partial<OfficeBlock>)} /></FormField>
  );
  return (
    <div className="grid gap-4 xl:grid-cols-[auto_minmax(0,1fr)]">
      <div>
        <OfficePreview blocks={blocks} preview={preview} selected={sel} onSelect={setSel} width={previewWidth} onMove={(id, x, y) => onChange(blocks.map((bl) => (bl.id === id ? { ...bl, x, y } : bl)))} onResize={(id, w) => onChange(blocks.map((bl) => (bl.id === id ? { ...bl, w } : bl)))} />
        <p className="mt-1 text-xs text-muted">Arraste um bloco para mudar a posição; a alça na borda direita ajusta a largura. Clique para editar o texto.</p>
      </div>
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {blocks.map((x) => <button key={x.id} type="button" onClick={() => setSel(x.id)} className={clsx('rounded-full border px-3 py-1 text-xs', sel === x.id ? 'border-primary bg-primary text-white' : 'border-line hover:bg-surface-2')}>{x.label ?? x.id}</button>)}
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => add('texto')}>Texto</Button>
          {!blocks.some((x) => x.kind === 'assinatura') && <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => add('assinatura')}>Assinatura</Button>}
        </div>
        {b && (
          <div className="space-y-3 border border-line p-3">
            <div className="flex flex-wrap items-end gap-2">
              <FormField label="Nome do bloco" htmlFor="ob-label" className="flex-1"><Input id="ob-label" className="h-9" maxLength={60} value={b.label ?? ''} onChange={(e) => set({ label: e.target.value })} /></FormField>
              <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} disabled={blocks.length < 2} onClick={() => { onChange(blocks.filter((x) => x.id !== b.id)); setSel(blocks.find((x) => x.id !== b.id)?.id ?? null); }}>Remover</Button>
            </div>
            <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Formatação">
              <button type="button" title="Negrito" aria-label="Negrito" className="rounded-sm p-1.5 hover:bg-surface-2" onClick={() => wrap('**')}><Bold className="h-4 w-4" /></button>
              <button type="button" title="Sublinhado" aria-label="Sublinhado" className="rounded-sm p-1.5 hover:bg-surface-2" onClick={() => wrap('__')}><Underline className="h-4 w-4" /></button>
              <button type="button" title="Itálico" aria-label="Itálico" className="rounded-sm p-1.5 hover:bg-surface-2" onClick={() => wrap('_')}><Italic className="h-4 w-4" /></button>
              <span className="mx-1 h-5 w-px bg-line" />
              {(['left', 'center', 'right', 'justify'] as const).map((a) => {
                const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : a === 'right' ? AlignRight : AlignJustify;
                return <button key={a} type="button" aria-pressed={b.align === a} aria-label={{ left: 'Alinhar à esquerda', center: 'Centralizar', right: 'Alinhar à direita', justify: 'Justificar' }[a]} className={clsx('rounded-sm p-1.5', b.align === a ? 'bg-primary-soft text-primary' : 'hover:bg-surface-2')} onClick={() => set({ align: a })}><Icon className="h-4 w-4" /></button>;
              })}
              <span className="mx-1 h-5 w-px bg-line" />
              <Select aria-label="Inserir variável" className="h-8 w-56" value="" onChange={(e) => { if (e.target.value) wrap(`{{${e.target.value}}}`, ''); }}>
                <option value="">Inserir variável…</option>
                {b.kind === 'assinatura' && <option value="assinatura">Imagem da assinatura</option>}
                {varDefs.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </Select>
            </div>
            <Textarea ref={area} aria-label="Texto do bloco" rows={b.id === 'corpo' || b.text.length > 300 ? 12 : 5} value={b.text} onChange={(e) => set({ text: e.target.value })} className="font-mono text-xs" />
            <p className="text-xs text-muted">Linha em branco separa parágrafos. **negrito**, __sublinhado__, _itálico_. Variáveis entre chaves duplas mudam conforme o contrato.</p>
            {b.kind === 'assinatura' && <SignatureField b={b} set={set} />}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {num('x', 'Esquerda (mm)', 0, 200)}{num('y', 'Topo (mm)', 0, 290)}{num('w', 'Largura (mm)', 10, 210)}{num('size', 'Fonte (pt)', 6, 28)}
              {num('lineGap', 'Entrelinhas', 1, 3, 0.05)}{num('indent', 'Recuo 1ª linha (mm)', 0, 60)}{num('paraGap', 'Entre parágrafos (mm)', 0, 30)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Assinatura digitalizada no próprio bloco (PNG com fundo transparente fica melhor), com tamanho e posição ajustáveis. */
function SignatureField({ b, set }: { b: OfficeBlock; set: (p: Partial<OfficeBlock>) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const pick = async (file: File) => {
    setErr(null);
    if (!/^image\/(png|jpe?g)$/.test(file.type)) { setErr('Envie a assinatura em PNG ou JPG.'); return; }
    if (file.size > 600_000) { setErr('Imagem acima de 600 KB: recorte só a assinatura ou reduza a resolução.'); return; }
    const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); });
    set({ sigImage: data, sigH: b.sigH ?? 13 });
  };
  const n = (k: 'sigH' | 'sigDx' | 'sigDy', label: string, min: number, max: number, def: number) => (
    <FormField label={label} htmlFor={`ob-${k}`}><Input id={`ob-${k}`} type="number" step={0.5} min={min} max={max} className="h-9" value={String(b[k] ?? def)} onChange={(e) => set({ [k]: Math.max(min, Math.min(max, Number(e.target.value) || 0)) } as Partial<OfficeBlock>)} /></FormField>
  );
  return (
    <div className="space-y-2 border border-dashed border-line p-3" role="group" aria-label="Assinatura digitalizada">
      <div className="flex flex-wrap items-center gap-3">
        {b.sigImage ? <img src={b.sigImage} alt="Assinatura digitalizada" className="h-12 max-w-[200px] border border-line bg-white object-contain p-1" /> : <span className="text-xs text-muted">Sem imagem aqui: usa a assinatura cadastrada na filial (se houver).</span>}
        <label className="inline-flex h-8 cursor-pointer items-center border border-line px-3 text-sm hover:bg-surface-2">{b.sigImage ? 'Trocar assinatura' : 'Inserir assinatura digitalizada'}
          <input type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Arquivo da assinatura digitalizada" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ''; }} /></label>
        {b.sigImage && <Button size="sm" variant="ghost" onClick={() => set({ sigImage: null })}>Tirar</Button>}
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      <div className="grid grid-cols-3 gap-2">{n('sigH', 'Altura da assinatura (mm)', 5, 60, 13)}{n('sigDx', 'Deslocar → (mm)', -80, 80, 0)}{n('sigDy', 'Deslocar ↓ (mm)', -40, 40, 0)}</div>
      <p className="text-xs text-muted">A imagem entra na linha {'{{assinatura}}'} do texto. Ajuste a altura e o deslocamento até ficar sobre o nome.</p>
    </div>
  );
}
