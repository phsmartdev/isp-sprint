import { forwardRef, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, CircleHelp, Info, Loader2 } from 'lucide-react';
import { fmtBRL, fmtInt, fmtPct } from '../../lib/format';
import type { Kpi } from '../../lib/types';
import { FitText } from './FitText';

// ------------------------------------------------------------------ Button
type Variant = 'primary' | 'outline' | 'secondary' | 'ghost' | 'danger';
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode };

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover border border-transparent shadow-sm',
  outline: 'bg-surface text-primary border border-primary/60 hover:bg-primary-soft',
  secondary: 'bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-ink border border-transparent hover:bg-surface-2',
  danger: 'bg-danger text-white border border-transparent hover:opacity-90',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'h-8 px-3 text-sm' : size === 'lg' ? 'h-12 px-6 text-md' : 'h-10 px-4 text-base',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ------------------------------------------------------------------ Form
export function FormField({ label, error, hint, children, required, htmlFor, className }: { label: string; error?: string; hint?: string; children: ReactNode; required?: boolean; htmlFor: string; className?: string }) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
        {required && <span className="text-danger" aria-hidden> *</span>}
      </label>
      {children}
      {error ? <p id={`${htmlFor}-error`} role="alert" className="text-sm text-danger">{error}</p> : hint ? <p id={`${htmlFor}-hint`} className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} aria-describedby={invalid && rest.id ? `${rest.id}-error` : undefined} className={clsx('field-input h-10', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={clsx('field-input h-10 pr-8 text-muted', className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={clsx('field-input min-h-[80px] resize-y', className)} {...rest} />;
});

export function ChipGroup<T extends string>({ legend, options, value, onChange, labels, disabled }: { legend: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void; labels: Record<T, string>; disabled?: boolean }) {
  const id = useId();
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1.5 text-sm font-semibold text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = value.includes(o);
          return (
            <label key={o} htmlFor={`${id}-${o}`} className={clsx('cursor-pointer rounded-full border px-3 py-1 text-sm font-medium transition-colors', checked ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface text-text hover:border-line-strong')}>
              <input id={`${id}-${o}`} type="checkbox" className="sr-only" checked={checked} onChange={() => onChange(checked ? value.filter((x) => x !== o) : [...value, o])} />
              {labels[o]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// ------------------------------------------------------------------ Chips
export type Tone = 'neutral' | 'blue' | 'sky' | 'green' | 'orange' | 'purple' | 'red' | 'yellow';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  blue: 'bg-primary-soft text-primary',
  sky: 'bg-sky-soft text-[#1F7DB8]',
  green: 'bg-success-soft text-[#15803D]',
  orange: 'bg-warning-soft text-[#C2610C]',
  purple: 'bg-purple-soft text-purple',
  red: 'bg-danger-soft text-danger',
  yellow: 'bg-[#FFF6D6] text-[#9A6B00]',
};
export function Chip({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-semibold', tones[tone], className)}>{children}</span>;
}

// ------------------------------------------------------------------ Avatar
const AV_COLORS = ['bg-primary-soft text-primary', 'bg-success-soft text-[#15803D]', 'bg-purple-soft text-purple', 'bg-warning-soft text-[#C2610C]', 'bg-danger-soft text-danger', 'bg-sky-soft text-[#1F7DB8]'];
export const initials = (name?: string | null) => (name ?? '?').split(/\s+/).filter((p) => p.length > 2 || /^[A-ZÁ-Ú]/.test(p)).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';

/** Foto do usuário (se enviada) ou iniciais coloridas. */
export function Avatar({ name, userId, hasPhoto, size = 36, className, tone }: { name?: string | null; userId?: string | null; hasPhoto?: boolean; size?: number; className?: string; tone?: number }) {
  const [failed, setFailed] = useState(false);
  const color = AV_COLORS[(tone ?? [...(name ?? '')].reduce((a, c) => a + c.charCodeAt(0), 0)) % AV_COLORS.length];
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };
  if (hasPhoto && userId && !failed) {
    return <img src={`/api/v1/users/${userId}/avatar`} alt="" onError={() => setFailed(true)} style={style} className={clsx('shrink-0 rounded-circle object-cover', className)} />;
  }
  return (
    <span aria-hidden style={style} className={clsx('inline-flex shrink-0 items-center justify-center rounded-circle font-bold', color, className)}>
      {initials(name)}
    </span>
  );
}

// ------------------------------------------------------------------ KPI
type KpiTone = 'blue' | 'purple' | 'green' | 'orange' | 'yellow';
const kpiTone: Record<KpiTone, string> = {
  blue: 'bg-primary-soft text-primary',
  purple: 'bg-purple-soft text-purple',
  green: 'bg-success-soft text-success',
  orange: 'bg-warning-soft text-[#F59E0B]',
  yellow: 'bg-[#FFF3CC] text-[#E5A100]',
};

export function formatKpi(k: Pick<Kpi, 'unit' | 'value'>) {
  if (k.value === null || k.value === undefined) return 'N/D';
  if (k.unit === 'brl_cents') return fmtBRL(k.value);
  if (k.unit === 'ratio') return fmtPct(k.value);
  if (k.unit === 'days') return `${k.value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
  return fmtInt(k.value);
}

export function Delta({ k, compact }: { k: Pick<Kpi, 'delta' | 'deltaAbs' | 'lowerIsBetter'>; compact?: boolean }) {
  const d = k.delta ?? null;
  const abs = k.deltaAbs ?? null;
  if (d === null && abs === null) return <span className="text-2xs text-faint" title="Sem base comparável">—</span>;
  const v = d ?? abs!;
  const up = v > 0;
  const good = v === 0 ? null : up !== !!k.lowerIsBetter;
  const label = d !== null ? `${Math.abs(Math.round(d * 100))}%` : `${Math.abs(abs!)}`;
  return (
    <span className={clsx('inline-flex items-center gap-0.5 text-sm font-semibold', good === null ? 'text-muted' : good ? 'text-success' : 'text-danger', compact && 'text-xs')}>
      {up ? <ArrowUp className="h-3.5 w-3.5" aria-hidden /> : v < 0 ? <ArrowDown className="h-3.5 w-3.5" aria-hidden /> : null}
      <span className="sr-only">{up ? 'aumento de' : 'redução de'}</span>
      {label}
    </span>
  );
}

export function KpiCard({ k, icon, tone, compare = 'vs. mês anterior', layout = 'side' }: { k: Kpi; icon: ReactNode; tone: KpiTone; compare?: string; layout?: 'side' | 'stack' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card group relative flex items-center gap-3.5 p-4">
      <span className={clsx('flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-circle', kpiTone[tone])}>{icon}</span>
      <div className="min-w-0 flex-1">
        <FitText className="num whitespace-nowrap text-xl font-extrabold leading-tight text-ink">{formatKpi(k)}</FitText>
        <p className="text-sm leading-snug text-muted">{k.label}</p>
        {(k.delta !== null || (k.deltaAbs ?? null) !== null) ? (
          <p className={clsx('mt-0.5 flex flex-wrap items-center gap-x-1', layout === 'stack' && 'mt-1')}><Delta k={k} compact /><span className="text-2xs text-faint">{compare}</span></p>
        ) : (
          <p className="mt-0.5 text-2xs text-faint" title="Sem base comparável no período anterior">sem comparação</p>
        )}
      </div>
      <button className="absolute right-1.5 top-1.5 rounded-sm p-0.5 text-faint opacity-0 hover:text-ink focus:opacity-100 group-hover:opacity-100" aria-label={`Como é calculado: ${k.label}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
      {open && <div role="note" className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-line bg-surface p-3 text-xs text-muted shadow-overlay">{k.formula}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Estados
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton h-4', className)} aria-hidden />;
}
export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" role="status" aria-label="Carregando">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className={i % 2 ? 'w-4/5' : 'w-full'} />)}
    </div>
  );
}
export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <p className="text-md font-bold text-ink">{title}</p>
      {description && <p className="max-w-md text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Não foi possível carregar.';
  const rid = (error as { problem?: { requestId?: string } })?.problem?.requestId;
  const diag = (error as { problem?: { diagnostic?: string } })?.problem?.diagnostic;
  return (
    <div role="alert" className="m-4 flex items-start gap-3 rounded-md border border-danger/30 bg-danger-soft p-4 text-danger">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold">{msg}</p>
        {rid && <p className="mt-1 text-xs opacity-80">Código da requisição: {rid}</p>}
        {diag && <p className="mt-1 break-all font-mono text-xs opacity-80">Detalhe técnico: {diag}</p>}
      </div>
      {onRetry && <Button size="sm" onClick={onRetry}>Tentar novamente</Button>}
    </div>
  );
}
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning'; children: ReactNode }) {
  return (
    <div className={clsx('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', tone === 'warning' ? 'border-warning/30 bg-warning-soft text-[#9A4B07]' : 'border-primary/20 bg-primary-soft text-[#1E40AF]')}>
      {tone === 'warning' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <div>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ Tabs (WAI-ARIA)
export function Tabs<T extends string>({ tabs, value, onChange, label, className }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={clsx('scroll-thin flex gap-6 overflow-x-auto border-b border-line', className)}>
      {tabs.map((t, i) => (
        <button
          key={t.key}
          role="tab"
          id={`tab-${t.key}`}
          aria-selected={value === t.key}
          tabIndex={value === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
              onChange(next.key);
              document.getElementById(`tab-${next.key}`)?.focus();
            }
          }}
          className={clsx('-mb-px whitespace-nowrap border-b-2 px-1 pb-3 pt-1 text-md font-medium transition-colors', value === t.key ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-ink')}
        >
          {t.label}
          {t.count !== undefined && <span className="num"> ({t.count})</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Paginação numerada
export function Pagination({ page, pageSize, total, onPage, onPageSize, noun, sizes = [8, 10, 25, 50] }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize?: (s: number) => void; noun: string; sizes?: number[] }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const list: (number | '…')[] = [];
  const push = (n: number | '…') => list[list.length - 1] !== n && list.push(n);
  for (let i = 1; i <= pages; i++) {
    if (i <= 5 || i === pages || Math.abs(i - page) <= 1) push(i);
    else push('…');
  }
  const btn = 'num flex h-9 min-w-9 items-center justify-center rounded-sm border px-2 text-sm';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <span className="num text-sm text-muted">
        {total === 0 ? `Nenhum ${noun}` : `Mostrando ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total} ${noun}`}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Paginação" className="flex items-center gap-1.5">
          <button className={clsx(btn, 'border-line bg-surface text-muted disabled:opacity-40')} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button>
          {list.map((n, i) =>
            n === '…' ? (
              <span key={`e${i}`} className={clsx(btn, 'border-line bg-surface text-muted')}>…</span>
            ) : (
              <button key={n} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)} className={clsx(btn, n === page ? 'border-primary bg-primary font-semibold text-white' : 'border-line bg-surface text-text hover:border-line-strong')}>{n}</button>
            ),
          )}
          <button className={clsx(btn, 'border-line bg-surface text-muted disabled:opacity-40')} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></button>
        </nav>
        {onPageSize && (
          <select aria-label="Itens por página" className="field-input h-9 w-auto pr-8 text-sm" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {sizes.map((s) => <option key={s} value={s}>{s} por página</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

export function SaveStatus({ state, onRetry }: { state: 'idle' | 'saving' | 'saved' | 'error'; onRetry?: () => void }) {
  if (state === 'idle') return null;
  return (
    <span role="status" aria-live="polite" className={clsx('inline-flex items-center gap-1.5 text-sm', state === 'error' ? 'text-danger' : 'text-muted')}>
      {state === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Salvando…</>}
      {state === 'saved' && <>Salvo</>}
      {state === 'error' && <>Falha ao salvar — <button className="underline" onClick={onRetry}>tentar novamente</button></>}
    </span>
  );
}

export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Trilha de navegação" className="mb-1">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
            {it.to ? <Link className="hover:text-ink hover:underline" to={it.to}>{it.label}</Link> : <span aria-current="page">{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Card com título de seção (padrão dos designs). */
export function Section({ title, action, children, className, bodyClass }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={clsx('card flex flex-col', className)}>
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <h2 className="text-md font-bold text-ink">{title}</h2>
        {action}
      </div>
      <div className={clsx('flex-1 px-5 pb-4', bodyClass)}>{children}</div>
    </section>
  );
}
