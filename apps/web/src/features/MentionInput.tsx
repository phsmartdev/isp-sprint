/**
 * Campo de texto com menções: digite @ e escolha a pessoa (só quem tem acesso à negociação).
 * Guarda os IDs mencionados; ao enviar, só valem os nomes que continuam no texto.
 */
import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { Avatar } from '../components/ui/primitives';

export type Participant = { id: string; name: string; jobTitle: string | null; hasAvatar: boolean };
export const useParticipants = (oppId: string) => useQuery({ queryKey: ['participants', oppId], queryFn: () => api<{ items: Participant[] }>(`/opportunities/${oppId}/participants`), staleTime: 120_000 });

export type MentionHandle = { clear: () => void; focus: () => void };
type Props = {
  oppId: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  /** Enter envia (chat); no comentário, Enter quebra linha e o botão envia. */
  enterSends?: boolean;
  placeholder?: string;
  label: string;
  rows?: number;
  className?: string;
};

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Menções que continuam no texto. */
export function mentionsIn(text: string, picked: Participant[]) {
  return [...new Map(picked.filter((p) => text.includes(`@${p.name}`)).map((p) => [p.id, p])).values()].map((p) => p.id);
}

export const MentionInput = forwardRef<MentionHandle, Props & { picked: Participant[]; onPick: (p: Participant) => void }>(function MentionInput(
  { oppId, value, onChange, onSubmit, enterSends, placeholder, label, rows = 2, className, onPick },
  ref,
) {
  const id = useId();
  const ta = useRef<HTMLTextAreaElement>(null);
  const people = useParticipants(oppId).data?.items ?? [];
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  useImperativeHandle(ref, () => ({ clear: () => onChange(''), focus: () => ta.current?.focus() }));

  const options = useMemo(() => (query === null ? [] : people.filter((p) => norm(p.name).includes(norm(query))).slice(0, 6)), [people, query]);

  function detect(text: string, caret: number) {
    const before = text.slice(0, caret);
    const m = /(?:^|\s)@([\p{L}\p{N} .'-]{0,30})$/u.exec(before);
    setQuery(m ? m[1]! : null);
    setActive(0);
  }
  function choose(p: Participant) {
    const el = ta.current!;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([\p{L}\p{N} .'-]{0,30})$/u, `@${p.name} `);
    const next = before + value.slice(caret);
    onChange(next);
    onPick(p);
    setQuery(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (options.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % options.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(options[active]!); return; }
      if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return; }
    }
    if (enterSends && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit?.(); }
  }
  const listId = `${id}-list`;
  return (
    <div className={clsx('relative min-w-0 flex-1', className)}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <textarea
        id={id}
        ref={ta}
        rows={rows}
        value={value}
        maxLength={2000}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={options.length ? `${listId}-${active}` : undefined}
        className="block w-full resize-none rounded-sm border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-focus/40"
      />
      {options.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Mencionar" className="absolute bottom-full left-0 z-30 mb-1 w-72 max-w-full overflow-hidden rounded-md border border-line bg-surface py-1 shadow-overlay">
          {options.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(p); }}
              onMouseEnter={() => setActive(i)}
              className={clsx('flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm', i === active ? 'bg-primary-soft text-ink' : 'text-text')}
            >
              <Avatar name={p.name} userId={p.id} hasPhoto={p.hasAvatar} size={26} />
              <span className="min-w-0 flex-1 truncate"><span className="font-semibold">{p.name}</span>{p.jobTitle && <span className="text-xs text-muted"> · {p.jobTitle}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

/** Texto com as menções destacadas. */
export function WithMentions({ text, names, mine }: { text: string; names: string[]; mine?: string }) {
  if (!names.length) return <>{text}</>;
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  const parts = text.split(new RegExp(`(@(?:${esc.join('|')}))`, 'g'));
  return (
    <>
      {parts.map((p, i) => (p.startsWith('@') && names.includes(p.slice(1))
        ? <mark key={i} className={clsx('rounded-sm px-0.5 font-semibold', p.slice(1) === mine ? 'bg-[#FFE58A] text-ink' : 'bg-transparent text-inherit underline decoration-2 underline-offset-2')}>{p}</mark>
        : <span key={i}>{p}</span>))}
    </>
  );
}
