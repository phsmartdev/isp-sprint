/**
 * Motor Financeiro → Financial Studio: a diretoria vê, edita, simula e versiona as fórmulas que o motor executa.
 * Área 1 = fórmula (código), área 2 = origem das variáveis, área 3 = resultado e impacto (fixa ao lado).
 * Toda conta é feita pela API com o mesmo modelo do motor; a tela só mostra e manda a expressão.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowRight, CheckCircle2, ChevronRight, CircleAlert, Plus, Redo2, RotateCcw, Search, Undo2 } from 'lucide-react';
import { fmtFin, type FinTraceNode, type FinUnit } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtDateTime, fmtDate } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { Button, Chip, EmptyState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Variable = { code: string; name: string; type: string; unit: FinUnit; module: string; origin: string; source?: string; rule: string };
type Formula = { code: string; name: string; category: string; unit: FinUnit; desc: string; expression: string; defaultExpression: string | null; custom: boolean; version: number; versionId: string | null; validFrom: string | null; refs: string[]; dependents: string[] };
type Catalog = { formulas: Formula[]; variables: Variable[]; categories: { key: string; label: string }[]; functions: { name: string; desc: string; group: string }[]; open: { id: string; code: string; version: number; status: string }[]; modelKey: string; can: { edit: boolean; approve: boolean }; statusLabels: Record<string, string> };
type Value = { code: string; name: string; unit: FinUnit; category: string; before: unknown; after: unknown; beforeText: string; afterText: string; diffAbs: number | null; diffPct: number | null; changed: boolean; impacted: boolean; edited: boolean };
type Viab = { verdict: string; label: string; autoApproval: boolean; priceCents: number | null; npvCents: number | null; paybackMonths: number | null; checks: { label: string; ok: boolean }[] };
type VarValue = Variable & { value: unknown; valueText: string; used: boolean; usedBy: string[] };
type Sim = { issues: { code: string; message: string; level: 'erro' | 'aviso' }[]; affected?: string[]; result?: { values: Value[]; viability: { before: Viab; after: Viab; changed: boolean }; trace: { before: FinTraceNode | null; after: FinTraceNode | null } | null; variables: VarValue[]; warnings: string[] } | null; portfolio?: { total: number; verdictChanged: number; autoChanged: number; items: { id: string; code: number; title: string | null; before: string; after: string; autoBefore: boolean; autoAfter: boolean }[] } | null };
type Version = { id: string; version: number; expression: string; status: string; statusLabel: string; justification: string | null; author: string | null; mine: boolean; createdAt: string; validFrom: string | null; simulation: null | { beforeText: string | null; afterText: string | null; diffAbs: number | null; diffPct: number | null; impacted: { code: string; name: string; beforeText: string; afterText: string }[]; viability: { changed: boolean; before: Viab; after: Viab }; portfolio: { total: number; verdictChanged: number; autoChanged: number } | null }; events: { action: string; note: string | null; actor: string | null; createdAt: string }[] };
type Opp = { id: string; code: number; title: string | null; account: string; verdict: string | null };

const STATUS_TONE: Record<string, 'neutral' | 'blue' | 'yellow' | 'green' | 'purple' | 'red'> = { rascunho: 'neutral', simulada: 'blue', em_validacao: 'yellow', validada: 'purple', aprovada: 'green', publicada: 'green', devolvida: 'red' };
const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
const absText = (v: number | null, unit: FinUnit) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtFin(Math.abs(v), unit)}`);

// ------------------------------------------------------------------ editor de fórmula (realce, autocompletar, desfazer)
function highlight(src: string, known: (id: string) => 'var' | 'formula' | null) {
  const out: ReactNode[] = [];
  const re = /(\d+(?:\.\d+)?%?)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?|(>=|<=|==|!=|[-+*/^><=])|([();,])|(\s+)|(.)/g;
  let m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(src))) {
    const [all, num, id, paren, op, punct, ws] = m;
    if (num) out.push(<span key={k++} className="text-[#B45309]">{num}</span>);
    else if (id) {
      const up = id.toUpperCase();
      if (paren) out.push(<span key={k++} className="font-semibold text-[#7C3AED]">{id}</span>, paren);
      else if (['VERDADEIRO', 'FALSO', 'NULO'].includes(up)) out.push(<span key={k++} className="font-semibold text-[#B45309]">{id}</span>);
      else { const kind = known(id.toLowerCase()); out.push(<span key={k++} className={clsx(kind === 'var' ? 'text-[#1D4ED8]' : kind === 'formula' ? 'text-[#047857]' : 'text-danger underline decoration-wavy')}>{id}</span>); }
    } else if (op) out.push(<span key={k++} className="text-[#BE185D]">{op}</span>);
    else if (punct) out.push(<span key={k++} className="text-muted">{punct}</span>);
    else out.push(ws ?? all);
  }
  return out;
}

function FormulaEditor({ value, onChange, catalog, disabled, inputRef }: { value: string; onChange: (v: string) => void; catalog: Catalog; disabled: boolean; inputRef: React.MutableRefObject<HTMLTextAreaElement | null> }) {
  const [sugg, setSugg] = useState<{ items: { code: string; label: string; kind: string }[]; idx: number; start: number } | null>(null);
  const known = (id: string) => (catalog.variables.some((v) => v.code === id) ? 'var' : catalog.formulas.some((f) => f.code === id) ? 'formula' : null);
  const all = useMemo(() => [
    ...catalog.variables.map((v) => ({ code: v.code, label: v.name, kind: 'variável' })),
    ...catalog.formulas.map((f) => ({ code: f.code, label: f.name, kind: 'fórmula' })),
    ...catalog.functions.map((f) => ({ code: `${f.name}(`, label: f.desc, kind: 'função' })),
  ], [catalog]);
  const update = (v: string, caret: number) => {
    onChange(v);
    const before = v.slice(0, caret);
    const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before);
    if (m && m[0].length >= 2) {
      const w = m[0].toLowerCase();
      const items = all.filter((x) => x.code.toLowerCase().startsWith(w) || x.label.toLowerCase().includes(w)).slice(0, 8);
      setSugg(items.length ? { items, idx: 0, start: caret - m[0].length } : null);
    } else setSugg(null);
  };
  const accept = (code: string) => {
    const el = inputRef.current!;
    const caret = el.selectionStart;
    const start = sugg?.start ?? caret;
    const v = value.slice(0, start) + code + value.slice(caret);
    onChange(v);
    setSugg(null);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + code.length; });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!sugg) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSugg({ ...sugg, idx: (sugg.idx + 1) % sugg.items.length }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSugg({ ...sugg, idx: (sugg.idx - 1 + sugg.items.length) % sugg.items.length }); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(sugg.items[sugg.idx]!.code); }
    else if (e.key === 'Escape') setSugg(null);
  };
  const shared = 'whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-sm leading-6';
  return (
    <div className="relative">
      <div className="relative min-h-[96px] border border-line bg-surface focus-within:border-primary">
        <pre aria-hidden className={clsx(shared, 'pointer-events-none absolute inset-0 m-0 overflow-hidden text-ink')}>{highlight(value, known)}{'\n'}</pre>
        <textarea ref={inputRef} aria-label="Fórmula" spellCheck={false} disabled={disabled} value={value} rows={Math.max(3, value.split('\n').length + 1)}
          onChange={(e) => update(e.target.value, e.target.selectionStart)} onKeyDown={onKey} onBlur={() => setTimeout(() => setSugg(null), 150)}
          className={clsx(shared, 'relative block w-full resize-y bg-transparent text-transparent caret-ink outline-none selection:bg-primary/20')} />
      </div>
      {sugg && (
        <ul role="listbox" aria-label="Sugestões" className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto border border-line bg-surface shadow-overlay">
          {sugg.items.map((x, i) => (
            <li key={x.code} role="option" aria-selected={i === sugg.idx}>
              <button type="button" className={clsx('flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm', i === sugg.idx ? 'bg-primary/10' : 'hover:bg-surface-2')} onMouseDown={(e) => { e.preventDefault(); accept(x.code); }}>
                <span className="font-mono font-semibold text-ink">{x.code}</span><span className="truncate text-xs text-muted">{x.kind} · {x.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Histórico do editor (desfazer/refazer) por fórmula. */
function useHistory(initial: string) {
  const [stack, setStack] = useState<{ list: string[]; i: number }>({ list: [initial], i: 0 });
  const value = stack.list[stack.i]!;
  const set = (v: string) => setStack((s) => (v === s.list[s.i] ? s : { list: [...s.list.slice(0, s.i + 1), v].slice(-100), i: Math.min(s.i + 1, 99) }));
  return { value, set, reset: (v: string) => setStack({ list: [v], i: 0 }), undo: () => setStack((s) => ({ ...s, i: Math.max(0, s.i - 1) })), redo: () => setStack((s) => ({ ...s, i: Math.min(s.list.length - 1, s.i + 1) })), canUndo: stack.i > 0, canRedo: stack.i < stack.list.length - 1 };
}

// ------------------------------------------------------------------ memória expansível
function TraceTree({ node, depth = 0 }: { node: FinTraceNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  const has = !!node.children?.length;
  return (
    <li className={clsx(depth && 'border-l border-line pl-3')}>
      <div className="flex items-start gap-1.5 py-1">
        {has ? <button type="button" aria-label={open ? 'Recolher' : 'Expandir'} className="mt-0.5 text-muted hover:text-ink" onClick={() => setOpen(!open)}><ChevronRight className={clsx('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} /></button> : <span className="w-3.5" />}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline justify-between gap-2 text-xs"><span><span className="font-mono font-semibold text-ink">{node.code}</span> <span className="text-muted">{node.name}</span></span><span className="num font-semibold text-ink">{fmtFin(node.value as never, node.unit)}</span></p>
          {node.kind === 'formula' && <p className="break-words font-mono text-2xs text-muted">{node.expression}</p>}
          {node.memory && <p className="break-words font-mono text-2xs text-text">= {node.memory}</p>}
        </div>
      </div>
      {has && open && <ul className="ml-1.5">{node.children!.map((c) => <TraceTree key={c.code} node={c} depth={depth + 1} />)}</ul>}
    </li>
  );
}

// ------------------------------------------------------------------ página
export function AdminFinancialStudio() {
  const qc = useQueryClient();
  const toast = useToast();
  const cat = useQuery({ queryKey: ['fstudio', 'catalog'], queryFn: () => api<Catalog>('/finance-studio/catalog') });
  const [code, setCode] = useState<string>(() => { try { return localStorage.getItem('fs-code') ?? 'custo_mensal'; } catch { return 'custo_mensal'; } });
  const [oppId, setOppId] = useState<string>(() => { try { return localStorage.getItem('fs-opp') ?? ''; } catch { return ''; } });
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [oppQ, setOppQ] = useState('');
  const opps = useQuery({ queryKey: ['fstudio', 'opps', oppQ], queryFn: () => api<{ items: Opp[] }>(`/finance-studio/opportunities${qs({ q: oppQ || undefined })}`) });
  const versions = useQuery({ queryKey: ['fstudio', 'versions', code], enabled: !!code, queryFn: () => api<{ versions: Version[]; defaultExpression: string | null; today: string }>(`/finance-studio/formulas/${code}/versions`) });
  const formula = cat.data?.formulas.find((f) => f.code === code) ?? null;
  const openVersion = versions.data?.versions.find((v) => v.status !== 'publicada') ?? null;
  const hist = useHistory('');
  const [justification, setJustification] = useState('');
  const [creating, setCreating] = useState(false);
  const [compare, setCompare] = useState<Version | null>(null);
  const [publishing, setPublishing] = useState<Version | null>(null);
  const [returning, setReturning] = useState<Version | null>(null);
  const [note, setNote] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [portfolio, setPortfolio] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { try { localStorage.setItem('fs-code', code); } catch { /* sem armazenamento */ } }, [code]);
  useEffect(() => { try { localStorage.setItem('fs-opp', oppId); } catch { /* sem armazenamento */ } }, [oppId]);
  useEffect(() => { if (!oppId && opps.data?.items[0]) setOppId(opps.data.items[0].id); }, [opps.data, oppId]);
  // ao trocar de fórmula: o editor abre a versão em andamento (se houver) ou a vigente
  useEffect(() => {
    if (!formula || !versions.data) return;
    hist.reset(openVersion && ['rascunho', 'simulada', 'devolvida'].includes(openVersion.status) ? openVersion.expression : openVersion?.expression ?? formula.expression);
    setJustification(openVersion?.justification ?? '');
  }, [code, formula?.expression, versions.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const expr = hist.value;
  const editing = !!formula && expr.trim() !== formula.expression.trim();
  const locked = !!openVersion && !['rascunho', 'simulada', 'devolvida'].includes(openVersion.status);
  const dExpr = useDebounced(expr, 450);
  const sim = useQuery({
    queryKey: ['fstudio', 'sim', code, dExpr, oppId, portfolio],
    enabled: !!formula && !!oppId && !!dExpr.trim(),
    queryFn: () => api<Sim>('/finance-studio/simulate', { method: 'POST', body: { opportunityId: oppId, focus: code, portfolio, changes: dExpr.trim() !== formula!.expression.trim() ? [{ code, expression: dExpr }] : [] } }),
    placeholderData: (p) => p,
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['fstudio'] }); qc.invalidateQueries({ queryKey: ['economics'] }); };
  const fail = (e: unknown) => toast({ tone: 'error', message: errMsg(e) });
  const saveDraft = useMutation({
    mutationFn: async () => (openVersion && ['rascunho', 'simulada', 'devolvida'].includes(openVersion.status)
      ? api(`/finance-studio/versions/${openVersion.id}`, { method: 'PATCH', body: { expression: expr, justification } })
      : api(`/finance-studio/formulas/${code}/versions`, { method: 'POST', body: { expression: expr, justification } })),
    onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Rascunho salvo' }); }, onError: fail,
  });
  const simulateVersion = useMutation({ mutationFn: (id: string) => api(`/finance-studio/versions/${id}/simulate`, { method: 'POST', body: { opportunityId: oppId } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Simulação registrada na versão' }); }, onError: fail });
  const transition = useMutation({
    mutationFn: (x: { id: string; action: string; note?: string; validFrom?: string }) => api(`/finance-studio/versions/${x.id}/transition`, { method: 'POST', body: { action: x.action, note: x.note, validFrom: x.validFrom } }),
    onSuccess: (_r, x) => { refresh(); setPublishing(null); setReturning(null); setNote(''); toast({ tone: 'success', message: ({ enviar: 'Enviada para validação', validar: 'Validada', aprovar: 'Aprovada', publicar: 'Publicada: vale para os próximos cálculos', devolver: 'Devolvida para ajuste' } as Record<string, string>)[x.action] ?? 'Feito' }); },
    onError: fail,
  });
  const restore = useMutation({ mutationFn: (from: string) => api(`/finance-studio/formulas/${code}/versions`, { method: 'POST', body: { restoreFrom: from, justification: from === 'padrao' ? 'Restaura a fórmula padrão do sistema' : 'Restaura uma versão anterior' } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Nova revisão criada a partir da versão escolhida' }); }, onError: fail });

  if (cat.isLoading || !cat.data) return <div className="card p-5"><LoadingRows /></div>;
  if (cat.isError) return <Notice tone="warning">{errMsg(cat.error)}</Notice>;
  const c = cat.data;
  const term = search.trim().toLowerCase();
  const list = c.formulas.filter((f) => (!catFilter || f.category === catFilter) && (!term || [f.code, f.name, f.desc, f.expression].some((x) => x.toLowerCase().includes(term))));
  const s = sim.data;
  const res = s?.result;
  const focusV = res?.values.find((v) => v.code === code);
  const errors = s?.issues.filter((i) => i.level === 'erro') ?? [];
  const warnings = s?.issues.filter((i) => i.level === 'aviso') ?? [];
  // os indicadores de decisão e resultado primeiro; preços e parcelas depois
  const ORDER = ['decisao', 'indicadores', 'margens', 'fluxo', 'tributos', 'despesas', 'custos_operacionais', 'custos_implantacao', 'investimentos', 'receitas', 'precos', 'personalizadas'];
  const impacted = (res?.values.filter((v) => v.impacted && v.changed) ?? []).sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
  const varsUsed = res ? res.variables.filter((v) => (formula && (dExpr.includes(v.code)))) : [];
  const formulaRefs = c.formulas.filter((f) => f.code !== code && new RegExp(`\\b${f.code}\\b`).test(dExpr));
  const insert = (text: string) => {
    const el = editorRef.current;
    if (!el) { hist.set(expr + text); return; }
    const a = el.selectionStart, b = el.selectionEnd;
    const v = expr.slice(0, a) + text + expr.slice(b);
    hist.set(v);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + text.length; });
  };
  const grouped = c.categories.map((g) => ({ ...g, items: list.filter((f) => f.category === g.key) })).filter((g) => g.items.length);

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-end justify-between gap-3 p-4">
        <div>
          <p className="max-w-3xl text-sm text-muted">As fórmulas que o motor financeiro executa. Edite, simule numa oportunidade real e publique com aprovação; os cálculos salvos guardam a versão usada e só mudam quando alguém salva de novo.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Simular na oportunidade" htmlFor="fs-opp">
            <span className="flex gap-1.5">
              <Input aria-label="Buscar oportunidade" className="h-10 w-36" placeholder="Buscar…" value={oppQ} onChange={(e) => setOppQ(e.target.value)} />
              <Select id="fs-opp" className="h-10 w-[300px]" value={oppId} onChange={(e) => setOppId(e.target.value)}>
                {!opps.data?.items.length && <option value="">Nenhuma viabilidade salva</option>}
                {opps.data?.items.map((o) => <option key={o.id} value={o.id}>OP-{o.code} · {o.title ?? o.account}</option>)}
              </Select>
            </span>
          </FormField>
          <Chip tone="neutral" title="Chave do modelo vigente">{c.modelKey}</Chip>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[250px_minmax(0,1fr)_380px]">
        {/* catálogo */}
        <aside className="card self-start p-3" aria-label="Catálogo de cálculos">
          <label className="relative block"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden /><Input aria-label="Buscar fórmula" className="h-9 pl-8" placeholder="Buscar fórmula" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <Select aria-label="Categoria" className="mt-2 h-9" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}><option value="">Todas as categorias</option>{c.categories.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</Select>
          <div className="mt-2 max-h-[70vh] overflow-auto">
            {grouped.map((g) => (
              <div key={g.key} className="mt-2">
                <p className="px-1 text-2xs font-semibold uppercase text-muted">{g.label}</p>
                <ul>{g.items.map((f) => {
                  const op = c.open.find((o) => o.code === f.code);
                  return (
                    <li key={f.code}><button type="button" aria-current={f.code === code} onClick={() => setCode(f.code)} className={clsx('flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm', f.code === code ? 'bg-primary/10 font-semibold text-primary' : 'text-ink hover:bg-surface-2')}>
                      <span className="min-w-0 truncate">{f.name}</span>
                      <span className="flex shrink-0 gap-1">{f.version > 0 && <span className="text-2xs text-success">v{f.version}</span>}{op && <span className="text-2xs text-[#C2610C]" title={c.statusLabels[op.status]}>●</span>}</span>
                    </button></li>
                  );
                })}</ul>
              </div>
            ))}
          </div>
          {c.can.edit && <Button size="sm" className="mt-3 w-full" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Variável ou fórmula nova</Button>}
        </aside>

        {/* área 1 e 2 */}
        <div className="min-w-0 space-y-4">
          {!formula ? <EmptyState title="Escolha uma fórmula no catálogo" /> : (
            <>
              <section className="card p-4" aria-label="Fórmula (código)">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted">1 · Fórmula</p>
                    <h3 className="text-md font-bold text-ink">{formula.name} <span className="font-mono text-sm font-normal text-muted">{formula.code}</span></h3>
                    <p className="text-xs text-muted">{formula.desc} · unidade {formula.unit} · {formula.version ? `versão ${formula.version} publicada${formula.validFrom ? ` em vigor desde ${fmtDate(formula.validFrom)}` : ''}` : 'padrão do sistema'}{formula.custom ? ' · personalizada' : ''}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={<Undo2 className="h-4 w-4" />} disabled={!hist.canUndo || locked} onClick={hist.undo} aria-label="Desfazer" />
                    <Button size="sm" variant="ghost" icon={<Redo2 className="h-4 w-4" />} disabled={!hist.canRedo || locked} onClick={hist.redo} aria-label="Refazer" />
                    <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} disabled={!editing || locked} onClick={() => hist.set(formula.expression)}>Vigente</Button>
                  </div>
                </div>
                {locked && <div className="mt-2"><Notice tone="info">A versão {openVersion!.version} está {c.statusLabels[openVersion!.status]?.toLowerCase()}: a expressão fica travada até ser publicada ou devolvida.</Notice></div>}
                <div className="mt-3"><FormulaEditor value={expr} onChange={hist.set} catalog={c} disabled={!c.can.edit || locked} inputRef={editorRef} /></div>
                <div className="mt-2 flex flex-wrap gap-1" aria-label="Operadores e funções">
                  {['+', '-', '*', '/', '^', '(', ')', '>', '>=', '<', '<=', '=='].map((o) => <button key={o} type="button" disabled={locked} className="min-w-[30px] border border-line px-1.5 py-0.5 font-mono text-xs text-ink hover:bg-surface-2" onClick={() => insert(` ${o} `.replace(' ( ', '(').replace(' ) ', ')'))}>{o}</button>)}
                  {['SE', 'MAX', 'MIN', 'E', 'OU', 'VAZIO', 'ARRED', 'TAXA_MENSAL', 'ANUIDADE'].map((f) => <button key={f} type="button" disabled={locked} title={c.functions.find((x) => x.name === f)?.desc} className="border border-line px-1.5 py-0.5 font-mono text-xs font-semibold text-[#7C3AED] hover:bg-surface-2" onClick={() => insert(`${f}(`)}>{f}()</button>)}
                </div>
                <div className="mt-2 text-xs">
                  {sim.isFetching ? <span className="text-muted">Validando e recalculando…</span>
                    : errors.length ? <ul className="space-y-0.5 text-danger">{errors.map((e) => <li key={e.code + e.message} className="flex gap-1"><CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />{e.code !== code ? `${e.code}: ` : ''}{e.message}</li>)}</ul>
                    : <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Fórmula válida{editing ? ' · alteração em simulação (nada muda até publicar)' : ''}</span>}
                  {warnings.map((w) => <p key={w.message} className="text-[#C2610C]">{w.message}</p>)}
                </div>
                {c.can.edit && !locked && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                    <FormField label="Justificativa" htmlFor="fs-just" className="min-w-[260px] flex-1"><Input id="fs-just" value={justification} placeholder="Por que a fórmula muda" onChange={(e) => setJustification(e.target.value)} /></FormField>
                    <Button variant="primary" disabled={!!errors.length || (!editing && !openVersion)} loading={saveDraft.isPending} onClick={() => saveDraft.mutate()}>{openVersion ? `Salvar na versão ${openVersion.version}` : 'Salvar como nova versão'}</Button>
                  </div>
                )}
              </section>

              <section className="card p-4" aria-label="Origem das variáveis">
                <p className="text-xs font-semibold uppercase text-muted">2 · Origem das variáveis</p>
                {!res ? <p className="mt-2 text-sm text-muted">{oppId ? 'Calculando…' : 'Escolha uma oportunidade com viabilidade salva para ver os valores.'}</p> : (
                  <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
                    {varsUsed.map((v) => (
                      <details key={v.code} className="border border-line p-2.5">
                        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-2">
                          <span className="min-w-0"><span className="font-mono text-sm font-semibold text-[#1D4ED8]">{v.code}</span> <span className="text-xs text-muted">{v.name}</span></span>
                          <span className="num shrink-0 text-sm font-semibold text-ink">{v.valueText}</span>
                        </summary>
                        <dl className="mt-2 space-y-0.5 text-xs">
                          <div><dt className="inline text-muted">Origem: </dt><dd className="inline text-text">{v.module} → {v.origin}</dd></div>
                          {v.source && <div><dt className="inline text-muted">Campo: </dt><dd className="inline font-mono text-text">{v.source}</dd></div>}
                          <div><dt className="inline text-muted">Tipo e unidade: </dt><dd className="inline text-text">{v.type === 'bool' ? 'condição' : v.type === 'serie' ? 'série' : 'número'} · {v.unit}</dd></div>
                          <div><dt className="inline text-muted">Atualização: </dt><dd className="inline text-text">{v.rule}</dd></div>
                          <div><dt className="inline text-muted">Usada em: </dt><dd className="inline font-mono text-text">{v.usedBy.join(', ') || '—'}</dd></div>
                        </dl>
                      </details>
                    ))}
                    {formulaRefs.map((f) => {
                      const val = res.values.find((x) => x.code === f.code);
                      return (
                        <div key={f.code} className="border border-line p-2.5">
                          <p className="flex items-baseline justify-between gap-2"><button type="button" className="font-mono text-sm font-semibold text-[#047857] hover:underline" onClick={() => setCode(f.code)}>{f.code}</button><span className="num text-sm font-semibold text-ink">{val?.beforeText ?? '—'}</span></p>
                          <p className="text-xs text-muted">Fórmula: {f.name} · Motor Financeiro → {c.categories.find((g) => g.key === f.category)?.label}</p>
                          <p className="break-words font-mono text-2xs text-text">{f.expression}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
                {c.can.edit && !locked && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-primary">Inserir variável ou fórmula</summary>
                    <div className="mt-2 grid max-h-64 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">
                      {[...c.variables.filter((v) => v.code !== 'fluxo' || /VPL|TIR|PAYBACK|SOMA/.test(expr)).map((v) => ({ code: v.code, label: v.name, sub: v.module, kind: 'var' as const })), ...c.formulas.filter((f) => f.code !== code).map((f) => ({ code: f.code, label: f.name, sub: 'fórmula', kind: 'formula' as const }))].map((x) => (
                        <button key={x.code} type="button" className="flex items-baseline gap-2 px-2 py-1 text-left text-xs hover:bg-surface-2" onClick={() => insert(x.code)}>
                          <span className={clsx('font-mono font-semibold', x.kind === 'var' ? 'text-[#1D4ED8]' : 'text-[#047857]')}>{x.code}</span><span className="truncate text-muted">{x.label} · {x.sub}</span>
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </section>

              <Versions c={c} code={code} data={versions.data?.versions ?? []} defaultExpression={versions.data?.defaultExpression ?? null}
                onSimulate={(id) => simulateVersion.mutate(id)} simulating={simulateVersion.isPending}
                onTransition={(id, action) => (action === 'publicar' ? setPublishing(versions.data!.versions.find((v) => v.id === id)!) : action === 'devolver' ? setReturning(versions.data!.versions.find((v) => v.id === id)!) : transition.mutate({ id, action }))}
                onRestore={(from) => restore.mutate(from)} onCompare={setCompare} hasOpen={!!openVersion} current={formula.expression} />
            </>
          )}
        </div>

        {/* área 3 */}
        <aside className="self-start xl:sticky xl:top-4" aria-label="Resultado e impacto">
          <section className="card space-y-3 p-4">
            <p className="text-xs font-semibold uppercase text-muted">3 · Resultado e impacto</p>
            {!formula || !res ? <p className="text-sm text-muted">{!oppId ? 'Escolha uma oportunidade com viabilidade salva.' : errors.length ? 'Corrija a fórmula para recalcular.' : 'Calculando…'}</p> : (
              <>
                <div className="border border-line p-3">
                  <p className="text-2xs font-semibold uppercase text-muted">Vigente</p>
                  <p className="break-words font-mono text-xs text-text">{formula.expression}</p>
                  {res.trace?.before?.memory && <p className="mt-1 break-words font-mono text-xs text-muted">= {res.trace.before.memory}</p>}
                  <p className="num mt-1 text-lg font-bold text-ink">{focusV?.beforeText ?? '—'}</p>
                </div>
                {editing && (
                  <div className="border border-primary/40 bg-primary/5 p-3">
                    <p className="text-2xs font-semibold uppercase text-primary">Nova (simulação)</p>
                    <p className="break-words font-mono text-xs text-text">{dExpr}</p>
                    {res.trace?.after?.memory && <p className="mt-1 break-words font-mono text-xs text-muted">= {res.trace.after.memory}</p>}
                    <p className="num mt-1 flex flex-wrap items-baseline gap-2 text-lg font-bold text-ink">{focusV?.afterText ?? '—'}{focusV?.changed && <span className="text-sm font-semibold text-text">{absText(focusV.diffAbs, focusV.unit)} ({pct(focusV.diffPct)})</span>}</p>
                  </div>
                )}
                {res.trace?.[editing ? 'after' : 'before'] && (
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold text-primary">Memória de cálculo completa</summary>
                    <ul className="mt-2 max-h-72 overflow-auto"><TraceTree node={res.trace[editing ? 'after' : 'before']!} /></ul>
                  </details>
                )}
                <div>
                  <p className="mb-1 text-sm font-bold text-ink">Viabilidade</p>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Chip tone={res.viability.before.verdict === 'viavel' ? 'green' : 'yellow'}>{res.viability.before.label}{res.viability.before.autoApproval ? ' · automática' : ''}</Chip>
                    {editing && <><ArrowRight className="h-4 w-4 text-muted" aria-hidden /><Chip tone={res.viability.after.verdict === 'viavel' ? 'green' : 'yellow'}>{res.viability.after.label}{res.viability.after.autoApproval ? ' · automática' : ''}</Chip></>}
                  </div>
                  {editing && res.viability.changed && <p className="mt-1 text-xs font-semibold text-[#C2610C]">A alteração muda a aprovação financeira desta oportunidade.</p>}
                </div>
                {editing && (
                  <div>
                    <p className="mb-1 text-sm font-bold text-ink">Indicadores impactados ({impacted.length})</p>
                    {!impacted.length ? <p className="text-xs text-muted">Nenhum indicador muda nesta oportunidade.</p> : (
                      <div className="max-h-80 overflow-auto"><table className="w-full text-xs">
                        <thead className="sticky top-0 bg-surface text-2xs text-muted"><tr><th className="py-1 text-left font-medium">Indicador</th><th className="py-1 text-right font-medium">Antes</th><th className="py-1 text-right font-medium">Depois</th><th className="py-1 text-right font-medium">Δ</th></tr></thead>
                        <tbody>{impacted.map((v) => (
                          <tr key={v.code} className="border-t border-line">
                            <td className="py-1"><button type="button" className="text-left hover:underline" onClick={() => setCode(v.code)}>{v.name}</button></td>
                            <td className="num py-1 text-right">{v.beforeText}</td><td className="num py-1 text-right font-semibold">{v.afterText}</td>
                            <td className="num py-1 text-right text-text" title={absText(v.diffAbs, v.unit)}>{v.diffPct == null ? (v.afterText !== v.beforeText ? 'mudou' : '—') : pct(v.diffPct)}</td>
                          </tr>
                        ))}</tbody>
                      </table></div>
                    )}
                    <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={portfolio} onChange={(e) => setPortfolio(e.target.checked)} />Simular também na carteira (viabilidades salvas)</label>
                    {s?.portfolio && <p className="mt-1 text-xs text-text">{s.portfolio.total} oportunidade(s): {s.portfolio.verdictChanged} mudam de resultado, {s.portfolio.autoChanged} mudam a aprovação automática.</p>}
                  </div>
                )}
                {res.warnings.length > 0 && <ul className="text-2xs text-[#C2610C]">{res.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
              </>
            )}
          </section>
        </aside>
      </div>

      {creating && <NewFormula c={c} onClose={() => setCreating(false)} onDone={(cd) => { setCreating(false); refresh(); setCode(cd); }} />}
      {compare && (
        <Modal open onClose={() => setCompare(null)} title={`Comparar versão ${compare.version} com a vigente`} size="lg" footer={<Button onClick={() => setCompare(null)}>Fechar</Button>}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div><p className="mb-1 text-xs font-semibold text-muted">Vigente</p><pre className="whitespace-pre-wrap break-words border border-line bg-surface-2 p-2 font-mono text-xs">{formula?.expression}</pre></div>
            <div><p className="mb-1 text-xs font-semibold text-muted">Versão {compare.version} ({compare.statusLabel})</p><pre className="whitespace-pre-wrap break-words border border-line bg-surface-2 p-2 font-mono text-xs">{diffWords(formula?.expression ?? '', compare.expression)}</pre></div>
          </div>
          {compare.simulation && <p className="mt-3 text-sm text-text">Simulação: {compare.simulation.beforeText} → {compare.simulation.afterText} ({pct(compare.simulation.diffPct)}) · {compare.simulation.impacted.length} indicador(es) impactado(s){compare.simulation.viability.changed ? ' · muda a viabilidade' : ''}.</p>}
        </Modal>
      )}
      {publishing && (
        <Modal open onClose={() => setPublishing(null)} title={`Publicar a versão ${publishing.version}`} footer={<><Button onClick={() => setPublishing(null)}>Cancelar</Button><Button variant="primary" loading={transition.isPending} onClick={() => transition.mutate({ id: publishing.id, action: 'publicar', validFrom: validFrom || undefined, note: note || undefined })}>Publicar</Button></>}>
          <p className="mb-3 text-sm text-text">A fórmula passa a valer nos próximos cálculos a partir da data escolhida. Cálculos já salvos ficam como estão e aparecem como desatualizados até alguém salvar de novo.</p>
          <FormField label="Vale a partir de" htmlFor="fs-from"><Input id="fs-from" type="date" min={versions.data?.today} value={validFrom || versions.data?.today || ''} onChange={(e) => setValidFrom(e.target.value)} /></FormField>
          <FormField label="Observação (opcional)" htmlFor="fs-pubnote" className="mt-2"><Input id="fs-pubnote" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
        </Modal>
      )}
      {returning && (
        <Modal open onClose={() => setReturning(null)} title={`Devolver a versão ${returning.version}`} footer={<><Button onClick={() => setReturning(null)}>Cancelar</Button><Button variant="primary" disabled={note.trim().length < 5} loading={transition.isPending} onClick={() => transition.mutate({ id: returning.id, action: 'devolver', note })}>Devolver</Button></>}>
          <FormField label="Motivo para quem criou" htmlFor="fs-ret" required><Textarea id="fs-ret" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
        </Modal>
      )}
    </div>
  );
}

/** Diferença por palavra: o que entrou fica destacado. */
function diffWords(a: string, b: string) {
  const ta = a.split(/(\s+)/), tb = b.split(/(\s+)/);
  const setA = new Set(ta);
  return tb.map((w, i) => (w.trim() && !setA.has(w) ? <mark key={i} className="bg-success-soft text-[#15803D]">{w}</mark> : <span key={i}>{w}</span>));
}

function Versions({ c, code, data, defaultExpression, onSimulate, simulating, onTransition, onRestore, onCompare, hasOpen, current }: {
  c: Catalog; code: string; data: Version[]; defaultExpression: string | null; onSimulate: (id: string) => void; simulating: boolean; onTransition: (id: string, action: string) => void; onRestore: (from: string) => void; onCompare: (v: Version) => void; hasOpen: boolean; current: string;
}) {
  return (
    <section className="card p-4" aria-label="Versões">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted">Versões e governança · {code}</p>
        {c.can.edit && !hasOpen && defaultExpression && defaultExpression !== current && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => onRestore('padrao')}>Restaurar a padrão do sistema</Button>}
      </div>
      <p className="mt-1 text-xs text-muted">Rascunho → simulada → em validação → validada → aprovada → publicada. Quem cria não valida nem aprova; restaurar cria uma nova revisão e o histórico fica.</p>
      {!data.length ? <p className="mt-2 text-sm text-muted">{defaultExpression ? 'Sem versões: vale a fórmula padrão do sistema.' : 'Sem versões.'}</p> : (
        <ol className="mt-3 space-y-2">
          {data.map((v) => (
            <li key={v.id} className="border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink">Versão {v.version} <Chip tone={STATUS_TONE[v.status]}>{v.statusLabel}</Chip>{v.validFrom && v.status === 'publicada' && <span className="text-xs font-normal text-muted">vigência {fmtDate(v.validFrom)}</span>}</p>
                <span className="text-xs text-muted">{v.author ?? '—'} · {fmtDateTime(v.createdAt)}</span>
              </div>
              <p className="mt-1 break-words font-mono text-xs text-text">{v.expression}</p>
              {v.justification && <p className="mt-1 text-xs text-muted">Justificativa: {v.justification}</p>}
              {v.simulation && <p className="mt-1 text-xs text-text">Simulação: {v.simulation.beforeText} → <b>{v.simulation.afterText}</b> ({pct(v.simulation.diffPct)}) · {v.simulation.impacted.length} indicador(es){v.simulation.viability.changed ? ' · muda a viabilidade' : ''}{v.simulation.portfolio ? ` · carteira: ${v.simulation.portfolio.verdictChanged} de ${v.simulation.portfolio.total} mudam de resultado` : ''}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => onCompare(v)}>Comparar</Button>
                {c.can.edit && ['rascunho', 'simulada', 'devolvida'].includes(v.status) && <Button size="sm" loading={simulating} onClick={() => onSimulate(v.id)}>Simular e registrar</Button>}
                {c.can.edit && v.status === 'simulada' && <Button size="sm" variant="primary" onClick={() => onTransition(v.id, 'enviar')}>Enviar para validação</Button>}
                {c.can.edit && v.status === 'em_validacao' && !v.mine && <Button size="sm" variant="primary" onClick={() => onTransition(v.id, 'validar')}>Validar</Button>}
                {c.can.approve && v.status === 'validada' && !v.mine && <Button size="sm" variant="primary" onClick={() => onTransition(v.id, 'aprovar')}>Aprovar</Button>}
                {c.can.approve && v.status === 'aprovada' && <Button size="sm" variant="primary" onClick={() => onTransition(v.id, 'publicar')}>Publicar</Button>}
                {['em_validacao', 'validada', 'aprovada'].includes(v.status) && (c.can.approve || c.can.edit) && <Button size="sm" variant="ghost" onClick={() => onTransition(v.id, 'devolver')}>Devolver</Button>}
                {c.can.edit && !hasOpen && v.status === 'publicada' && v.expression !== current && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={() => onRestore(v.id)}>Restaurar</Button>}
              </div>
              {!!v.events.length && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-muted">Histórico ({v.events.length})</summary>
                  <ul className="mt-1 space-y-0.5 text-xs text-text">{v.events.map((e, i) => <li key={i}>{fmtDateTime(e.createdAt)} · {e.actor ?? 'Sistema'} · <b>{e.action}</b>{e.note ? ` · ${e.note}` : ''}</li>)}</ul>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function NewFormula({ c, onClose, onDone }: { c: Catalog; onClose: () => void; onDone: (code: string) => void }) {
  const toast = useToast();
  const [v, setV] = useState({ code: '', name: '', category: 'personalizadas', unit: 'R$' as string, description: '', expression: '', justification: '' });
  const save = useMutation({ mutationFn: () => api('/finance-studio/formulas', { method: 'POST', body: v }), onSuccess: () => { toast({ tone: 'success', message: 'Criada como rascunho' }); onDone(v.code); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <Modal open onClose={onClose} title="Variável ou fórmula personalizada" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!v.code || v.name.length < 2 || !v.expression.trim()} loading={save.isPending} onClick={() => save.mutate()}>Criar rascunho</Button></>}>
      <p className="mb-3 text-sm text-muted">Um valor fixo (ex.: 2%) vira uma variável; uma expressão vira uma fórmula. Ela passa pelo mesmo fluxo de simulação, validação, aprovação e publicação, e pode ser usada nas outras fórmulas.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Código" htmlFor="nf-code" hint="minúsculas e _ (ex.: taxa_cartao)"><Input id="nf-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></FormField>
        <FormField label="Nome" htmlFor="nf-name"><Input id="nf-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></FormField>
        <FormField label="Categoria" htmlFor="nf-cat"><Select id="nf-cat" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{c.categories.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</Select></FormField>
        <FormField label="Unidade" htmlFor="nf-unit"><Select id="nf-unit" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })}>{['R$', '%', 'meses', 'mês', 'sim/não', 'fator'].map((u) => <option key={u} value={u}>{u}</option>)}</Select></FormField>
        <FormField label="Expressão ou valor" htmlFor="nf-expr" className="sm:col-span-2" hint="Valores em R$ são em centavos nas fórmulas (R$ 10,00 = 1000); taxas em % (2%) ou fração (0.02)"><Input id="nf-expr" className="font-mono" value={v.expression} onChange={(e) => setV({ ...v, expression: e.target.value })} placeholder="2%" /></FormField>
        <FormField label="Origem e descrição" htmlFor="nf-desc" className="sm:col-span-2"><Input id="nf-desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="Ex.: taxa média da maquininha (Financeiro)" /></FormField>
        <FormField label="Justificativa" htmlFor="nf-just" className="sm:col-span-2"><Input id="nf-just" value={v.justification} onChange={(e) => setV({ ...v, justification: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}
