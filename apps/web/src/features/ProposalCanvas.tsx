/** Desenha uma página do modelo de proposta: a arte de fundo e os campos variáveis por cima. */
import { useRef, type PointerEvent as RPointerEvent } from 'react';
import clsx from 'clsx';

export type PField = { id: string; page: number; x: number; y: number; w: number; size: number; color: string; align: 'left' | 'center' | 'right'; bold: boolean; strike?: boolean; text: string };
export type PPage = { id: string; position: number; width: number; height: number };

export const fillVars = (text: string, vars: Record<string, string>, showKeys = false) =>
  text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => vars[k] ?? (showKeys ? `{{${k}}}` : ''));

export function ProposalCanvas({ templateId, page, index, fields, values, selectedId, onSelect, onMove, onPlace, showKeys }: {
  templateId: string; page: PPage; index: number; fields: PField[]; values: Record<string, string>;
  selectedId?: string | null; onSelect?: (id: string | null) => void; onMove?: (id: string, x: number, y: number) => void; onPlace?: (x: number, y: number) => void; showKeys?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const pct = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };
  const editable = !!onMove;
  return (
    <div
      ref={ref}
      className={clsx('relative w-full select-none overflow-hidden bg-surface-2 [container-type:inline-size]', onPlace && 'cursor-crosshair')}
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
      onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.bg) { if (onPlace) { const p = pct(e); onPlace(p.x, p.y); } else onSelect?.(null); } }}
      onPointerMove={(e) => { if (!drag.current || !onMove) return; const p = pct(e); onMove(drag.current.id, Math.max(0, Math.min(99, p.x - drag.current.dx)), Math.max(0, Math.min(99, p.y - drag.current.dy))); }}
      onPointerUp={() => { drag.current = null; }}
      onPointerLeave={() => { drag.current = null; }}
    >
      <img data-bg="1" src={`/api/v1/proposal-templates/${templateId}/pages/${page.id}/image`} alt={`Página ${index + 1} do modelo`} className="absolute inset-0 h-full w-full" draggable={false} />
      {fields.filter((f) => f.page === index).map((f) => (
        <div
          key={f.id}
          role={editable ? 'button' : undefined}
          tabIndex={editable ? 0 : undefined}
          aria-label={editable ? `Campo: ${f.text.slice(0, 40)}` : undefined}
          className={clsx('absolute whitespace-pre-wrap break-words leading-[1.25]', editable && 'cursor-move rounded-none outline-dashed outline-1 outline-white/60 hover:outline-lime', selectedId === f.id && 'outline-2 !outline-lime')}
          style={{ left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, fontSize: `${f.size / 10}cqw`, color: f.color, textAlign: f.align, fontWeight: f.bold ? 700 : 400, textDecoration: f.strike ? 'line-through' : undefined, fontFamily: 'Helvetica, Arial, sans-serif' }}
          onPointerDown={(e) => { if (!editable) return; e.stopPropagation(); onSelect?.(f.id); const p = pct(e); drag.current = { id: f.id, dx: p.x - f.x, dy: p.y - f.y }; (e.currentTarget as HTMLElement).setPointerCapture?.((e as RPointerEvent).pointerId); }}
        >
          {fillVars(f.text, values, showKeys) || (editable ? <span className="opacity-60">(vazio)</span> : null)}
        </div>
      ))}
    </div>
  );
}
