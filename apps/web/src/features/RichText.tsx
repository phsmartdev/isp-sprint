/**
 * Formatação leve dos comentários do histórico, guardada no próprio texto (sem HTML, nada é executado):
 *   **negrito**  _itálico_  [texto](https://link)  links soltos  "# " título  "## " grande  "- " lista  "1. " lista numerada
 * A barra insere as marcações no campo; o histórico mostra o texto já formatado.
 */
import { useState, type ReactNode, type RefObject } from 'react';
import clsx from 'clsx';
import { Bold, Italic, Link2, List, ListOrdered } from 'lucide-react';
import { WithMentions } from './MentionInput';

// ------------------------------------------------------------------ exibição
const INLINE = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)|\*\*(.+?)\*\*|(^|[\s(])_(\S(?:.*?\S)?)_(?=[\s).,!?:;]|$)|(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])/g;
const safeHref = (u: string) => (/^(https?:\/\/|mailto:)/i.test(u) ? u : null);

function Inline({ text, names, mine }: { text: string; names: string[]; mine?: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  const plain = (s: string) => s && out.push(<WithMentions key={k++} text={s} names={names} mine={mine} />);
  for (const m of text.matchAll(INLINE)) {
    const at = m.index!;
    if (m[4] !== undefined) {
      // itálico: o caractere antes do "_" faz parte do texto comum
      plain(text.slice(last, at) + m[4]);
      out.push(<em key={k++}><Inline text={m[5]!} names={names} mine={mine} /></em>);
    } else {
      plain(text.slice(last, at));
      if (m[1] !== undefined) {
        const href = safeHref(m[2]!);
        out.push(href ? <a key={k++} href={href} target="_blank" rel="noopener noreferrer nofollow" className="link break-all">{m[1]}</a> : m[0]);
      } else if (m[3] !== undefined) out.push(<strong key={k++} className="font-bold"><Inline text={m[3]} names={names} mine={mine} /></strong>);
      else out.push(<a key={k++} href={m[6]!} target="_blank" rel="noopener noreferrer nofollow" className="link break-all">{m[6]}</a>);
    }
    last = at + m[0].length;
  }
  plain(text.slice(last));
  return <>{out}</>;
}

type Block = { kind: 'p' | 'h1' | 'h2' | 'blank'; text: string } | { kind: 'ul' | 'ol'; items: string[] };
function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const line of text.split('\n')) {
    const ul = /^\s*[-*•] +(.*)$/.exec(line);
    const ol = /^\s*\d+[.)] +(.*)$/.exec(line);
    const prev = out[out.length - 1];
    if (ul) { if (prev?.kind === 'ul') prev.items.push(ul[1]!); else out.push({ kind: 'ul', items: [ul[1]!] }); continue; }
    if (ol) { if (prev?.kind === 'ol') prev.items.push(ol[1]!); else out.push({ kind: 'ol', items: [ol[1]!] }); continue; }
    if (/^## /.test(line)) out.push({ kind: 'h2', text: line.slice(3) });
    else if (/^# /.test(line)) out.push({ kind: 'h1', text: line.slice(2) });
    else out.push({ kind: line.trim() ? 'p' : 'blank', text: line });
  }
  return out;
}

/** Comentário formatado, com as menções destacadas. */
export function RichText({ text, names = [], mine, className }: { text: string; names?: string[]; mine?: string; className?: string }) {
  return (
    <div className={clsx('space-y-0.5 break-words text-sm text-ink', className)}>
      {blocks(text).map((b, i) => {
        if (b.kind === 'ul' || b.kind === 'ol') {
          const L = b.kind;
          return <L key={i} className={clsx('my-1 space-y-0.5 pl-5', L === 'ul' ? 'list-disc' : 'list-decimal')}>{b.items.map((it, j) => <li key={j}><Inline text={it} names={names} mine={mine} /></li>)}</L>;
        }
        if (b.kind === 'blank') return <div key={i} className="h-2" aria-hidden />;
        if (b.kind === 'h1') return <p key={i} className="pt-1 text-lg font-bold leading-snug"><Inline text={b.text} names={names} mine={mine} /></p>;
        if (b.kind === 'h2') return <p key={i} className="pt-0.5 text-base font-semibold leading-snug"><Inline text={b.text} names={names} mine={mine} /></p>;
        return <p key={i}><Inline text={(b as { text: string }).text} names={names} mine={mine} /></p>;
      })}
    </div>
  );
}

/** Tem alguma marcação? (para mostrar a pré-visualização só quando faz diferença) */
export const hasFormatting = (t: string) => /\*\*.+?\*\*|(^|[\s(])_\S|\[[^\]]+\]\(|^(#{1,2} |\s*[-*•] |\s*\d+[.)] )/m.test(t);

// ------------------------------------------------------------------ edição
type Edit = { value: string; start: number; end: number };

function apply(ta: HTMLTextAreaElement, onChange: (v: string) => void, fn: (e: Edit) => Edit) {
  const r = fn({ value: ta.value, start: ta.selectionStart, end: ta.selectionEnd });
  onChange(r.value);
  requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(r.start, r.end); });
}

/** Envolve a seleção (ou um texto de exemplo) com a marcação; se já estiver marcada, tira. */
const wrap = (mark: string, sample: string) => ({ value, start, end }: Edit): Edit => {
  const sel = value.slice(start, end);
  if (value.slice(start - mark.length, start) === mark && value.slice(end, end + mark.length) === mark) {
    return { value: value.slice(0, start - mark.length) + sel + value.slice(end + mark.length), start: start - mark.length, end: end - mark.length };
  }
  const inner = sel || sample;
  return { value: value.slice(0, start) + mark + inner + mark + value.slice(end), start: start + mark.length, end: start + mark.length + inner.length };
};

/** Aplica um prefixo às linhas da seleção (lista, tamanho); "" tira os prefixos de tamanho. */
const lines = (kind: 'ul' | 'ol' | 'h1' | 'h2' | 'normal') => ({ value, start, end }: Edit): Edit => {
  const a = value.lastIndexOf('\n', start - 1) + 1;
  const bIdx = value.indexOf('\n', end);
  const b = bIdx === -1 ? value.length : bIdx;
  const chunk = value.slice(a, b).split('\n');
  const isList = (l: string) => (kind === 'ul' ? /^\s*[-*•] /.test(l) : /^\s*\d+[.)] /.test(l));
  const allList = (kind === 'ul' || kind === 'ol') && chunk.every((l) => !l.trim() || isList(l));
  const next = chunk.map((l, i) => {
    const bare = l.replace(/^#{1,2} /, '');
    if (kind === 'ul') return allList ? l.replace(/^\s*[-*•] /, '') : `- ${l.replace(/^\s*\d+[.)] /, '')}`;
    if (kind === 'ol') return allList ? l.replace(/^\s*\d+[.)] /, '') : `${i + 1}. ${l.replace(/^\s*[-*•] /, '')}`;
    return kind === 'h1' ? `# ${bare}` : kind === 'h2' ? `## ${bare}` : bare;
  }).join('\n');
  return { value: value.slice(0, a) + next + value.slice(b), start: a, end: a + next.length };
};

const btn = 'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-sm px-2 text-sm text-text hover:bg-surface-2 hover:text-ink disabled:opacity-50';

/** Barra de formatação ligada a um campo de texto. */
export function FormatToolbar({ target, onChange, disabled }: { target: RefObject<HTMLTextAreaElement | null>; onChange: (v: string) => void; disabled?: boolean }) {
  const [linking, setLinking] = useState<{ url: string; label: string; start: number; end: number } | null>(null);
  const run = (fn: (e: Edit) => Edit) => { const ta = target.current; if (ta) apply(ta, onChange, fn); };
  const openLink = () => {
    const ta = target.current;
    if (!ta) return;
    setLinking({ url: '', label: ta.value.slice(ta.selectionStart, ta.selectionEnd), start: ta.selectionStart, end: ta.selectionEnd });
  };
  const insertLink = () => {
    const ta = target.current;
    if (!ta || !linking) return;
    let url = linking.url.trim();
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url)) url = url.includes('@') && !url.includes('/') ? `mailto:${url}` : `https://${url}`;
    const label = linking.label.trim().replace(/[[\]]/g, '') || url.replace(/^mailto:/, '');
    const md = `[${label}](${url})`;
    const { start, end } = linking;
    onChange(ta.value.slice(0, start) + md + ta.value.slice(end));
    setLinking(null);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + md.length, start + md.length); });
  };
  return (
    <div className="mb-1.5">
      <div role="toolbar" aria-label="Formatação do comentário" className="flex flex-wrap items-center gap-0.5 rounded-sm border border-line bg-surface px-1 py-0.5">
        <button type="button" className={btn} disabled={disabled} onClick={() => run(wrap('**', 'negrito'))} aria-label="Negrito" title="Negrito (Ctrl+B)"><Bold className="h-4 w-4" /></button>
        <button type="button" className={btn} disabled={disabled} onClick={() => run(wrap('_', 'itálico'))} aria-label="Itálico" title="Itálico (Ctrl+I)"><Italic className="h-4 w-4" /></button>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <select aria-label="Tamanho da fonte" title="Tamanho da fonte" disabled={disabled} className="h-8 rounded-sm border-0 bg-transparent px-1 text-sm text-text hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-focus/40" value=""
          onChange={(e) => { const v = e.target.value as 'normal' | 'h2' | 'h1'; if (v) run(lines(v)); }}>
          <option value="" disabled>Tamanho</option>
          <option value="normal">Normal</option>
          <option value="h2">Grande</option>
          <option value="h1">Título</option>
        </select>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button type="button" className={btn} disabled={disabled} onClick={() => run(lines('ul'))} aria-label="Lista com marcadores" title="Lista com marcadores"><List className="h-4 w-4" /></button>
        <button type="button" className={btn} disabled={disabled} onClick={() => run(lines('ol'))} aria-label="Lista numerada" title="Lista numerada"><ListOrdered className="h-4 w-4" /></button>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button type="button" className={btn} disabled={disabled} onClick={openLink} aria-label="Inserir link" title="Inserir link" aria-expanded={!!linking}><Link2 className="h-4 w-4" /><span className="hidden sm:inline">Link</span></button>
      </div>
      {linking && (
        <div className="mt-1.5 flex flex-wrap items-end gap-2 rounded-sm border border-line bg-surface p-2">
          <label className="flex min-w-[200px] flex-1 flex-col gap-0.5 text-xs font-semibold text-ink">Endereço do link
            <input autoFocus className="h-8 rounded-sm border border-line px-2 text-sm font-normal focus:border-primary focus:outline-none" placeholder="https://…" value={linking.url}
              onChange={(e) => setLinking({ ...linking, url: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); insertLink(); } if (e.key === 'Escape') setLinking(null); }} />
          </label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-0.5 text-xs font-semibold text-ink">Texto que aparece
            <input className="h-8 rounded-sm border border-line px-2 text-sm font-normal focus:border-primary focus:outline-none" placeholder="Em branco: o próprio endereço" value={linking.label}
              onChange={(e) => setLinking({ ...linking, label: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); insertLink(); } if (e.key === 'Escape') setLinking(null); }} />
          </label>
          <button type="button" className="h-8 rounded-sm bg-primary px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={!linking.url.trim()} onClick={insertLink}>Inserir</button>
          <button type="button" className="h-8 px-2 text-sm text-muted hover:text-ink" onClick={() => setLinking(null)}>Cancelar</button>
        </div>
      )}
    </div>
  );
}

/** Atalhos Ctrl+B e Ctrl+I no campo. */
export function formatShortcut(e: React.KeyboardEvent<HTMLTextAreaElement>, onChange: (v: string) => void) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const k = e.key.toLowerCase();
  if (k !== 'b' && k !== 'i') return false;
  e.preventDefault();
  apply(e.currentTarget, onChange, k === 'b' ? wrap('**', 'negrito') : wrap('_', 'itálico'));
  return true;
}

/** O comentário sem as marcações (para resumos de uma ou duas linhas). */
export const plainText = (s: string) => s
  .replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, '$1')
  .replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/(^|[\s(])_(\S(?:.*?\S)?)_(?=[\s).,!?:;]|$)/gm, '$1$2')
  .replace(/^#{1,2} /gm, '')
  .replace(/^\s*[-*•] /gm, '• ');
