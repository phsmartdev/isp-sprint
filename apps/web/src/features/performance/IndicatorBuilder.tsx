/** Construtor de indicadores: origem nos eventos, filtros de lista fechada, fórmula validada, teste e versões. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  BUSINESS_EVENT_TYPES, FILTER_FIELDS, INDICATOR_CALCS, INDICATOR_CALC_LABELS, INDICATOR_CATEGORIES, INDICATOR_CATEGORY_LABELS, INDICATOR_UNITS, INDICATOR_UNIT_LABELS,
  NUMERIC_FIELDS, PERIOD_LABELS, parseFormula, validateIndicator,
  type FilterField, type IndicatorDef, type Measure, type NumericField, type Source,
} from '@isp/domain';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useLookups } from '../../lib/hooks';
import { Button, Chip, EmptyState, FormField, Input, LoadingRows, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Drawer, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { fmtIndicator } from './format';

export type IndicatorRow = { id: string; key: string; active: boolean; currentVersion: number; def: IndicatorDef; versionNote: string | null; versionAt: string };
type ListResp = { items: IndicatorRow[]; suggestions: (IndicatorDef & { key: string })[]; canEdit: boolean };
const MEASURE_LABELS: Record<Measure, string> = { contagem: 'Quantidade de eventos', soma_valor: 'Soma do valor', media_valor: 'Média do valor', media_campo: 'Média de um campo' };
const CREDIT_LABELS = { direto: 'Resultado (pela parte de cada um)', participacao: 'Participação', gestao: 'Gestão da equipe', qualquer: 'Qualquer crédito' } as const;
const blankSource = (): Source => ({ event: 'negociacao_ganha', measure: 'contagem' });
const blankDef = (): IndicatorDef => ({ name: '', category: 'comercial', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: blankSource() });

export function IndicatorsAdmin() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['performance', 'indicators'], queryFn: () => api<ListResp>('/performance/indicators') });
  const [edit, setEdit] = useState<IndicatorRow | 'new' | null>(null);
  const sug = useMutation({
    mutationFn: (keys: string[]) => api<{ created: number }>('/performance/indicators/suggested', { method: 'POST', body: { keys } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['performance'] }); toast({ tone: 'success', message: `${r.created} indicador(es) criado(s)` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const toggle = useMutation({ mutationFn: (i: IndicatorRow) => api(`/performance/indicators/${i.id}`, { method: 'PATCH', body: { active: !i.active } }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['performance'] }) });
  if (q.isLoading) return <div className="card"><LoadingRows rows={5} /></div>;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div><h2 className="text-lg font-bold text-ink">Indicadores</h2><p className="text-sm text-muted">Calculados sobre os eventos de negócio válidos. Mudar a definição cria uma versão nova; resultados já fechados guardam a versão da época.</p></div>
          {d.canEdit && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Novo indicador</Button>}
        </div>
        {!d.items.length ? <div className="border-t border-line"><EmptyState title="Nenhum indicador ainda" description="Comece pelas sugestões abaixo ou crie o seu." /></div> : (
          <ul className="divide-y divide-line border-t border-line">
            {d.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{i.def.name} {!i.active && <Chip tone="neutral">Inativo</Chip>}</p><p className="text-xs text-muted">{INDICATOR_CATEGORY_LABELS[i.def.category]} · {INDICATOR_CALC_LABELS[i.def.calc]} · {PERIOD_LABELS[i.def.period]} · {i.def.direction === 'maior' ? 'maior é melhor' : 'menor é melhor'} · v{i.currentVersion}{i.def.target != null ? ` · meta padrão ${fmtIndicator(i.def.target, i.def.unit)}` : ''}</p></div>
                {d.canEdit && <><Button size="sm" variant="secondary" onClick={() => setEdit(i)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => toggle.mutate(i)}>{i.active ? 'Desativar' : 'Ativar'}</Button></>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {d.canEdit && !!d.suggestions.length && (
        <section className="card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold text-ink">Sugestões</h2><Button size="sm" variant="secondary" loading={sug.isPending} onClick={() => sug.mutate(d.suggestions.map((x) => x.key))}>Criar todas</Button></div>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">{d.suggestions.map((x) => <li key={x.key} className="flex items-start justify-between gap-3 rounded-md border border-line p-3"><span><span className="block text-sm font-semibold text-ink">{x.name}</span><span className="text-xs text-muted">{x.description ?? `${INDICATOR_CATEGORY_LABELS[x.category]} · ${INDICATOR_CALC_LABELS[x.calc]}`}</span></span><Button size="sm" variant="ghost" onClick={() => sug.mutate([x.key])}>Criar</Button></li>)}</ul>
        </section>
      )}
      <IndicatorEditor row={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function SourceEditor({ value, onChange, label }: { value: Source; onChange: (s: Source) => void; label: string }) {
  const set = (p: Partial<Source>) => onChange({ ...value, ...p });
  const filters = value.filters ?? [];
  return (
    <fieldset className="space-y-2 rounded-md border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink">{label}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Evento" htmlFor={`${label}-ev`}><Select id={`${label}-ev`} value={value.event} onChange={(e) => set({ event: e.target.value })}>{BUSINESS_EVENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select></FormField>
        <FormField label="Medida" htmlFor={`${label}-me`}><Select id={`${label}-me`} value={value.measure} onChange={(e) => set({ measure: e.target.value as Measure, field: e.target.value === 'media_campo' ? value.field ?? 'minutesToComplete' : undefined })}>{Object.entries(MEASURE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField>
        {value.measure === 'media_campo' && <FormField label="Campo" htmlFor={`${label}-fi`}><Select id={`${label}-fi`} value={value.field} onChange={(e) => set({ field: e.target.value as NumericField })}>{Object.entries(NUMERIC_FIELDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField>}
        <FormField label="Crédito considerado" htmlFor={`${label}-cr`}><Select id={`${label}-cr`} value={value.credit ?? 'direto'} onChange={(e) => set({ credit: e.target.value as Source['credit'] })}>{Object.entries(CREDIT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></FormField>
      </div>
      {filters.map((f, i) => {
        const def = FILTER_FIELDS[f.field];
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select aria-label={`Filtro ${i + 1}`} className="w-auto" value={f.field} onChange={(e) => { const nf = e.target.value as FilterField; set({ filters: filters.map((x, k) => (k === i ? { field: nf, op: 'eq', value: FILTER_FIELDS[nf].type === 'bool' ? true : '' } : x)) }); }}>{Object.entries(FILTER_FIELDS).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</Select>
            <Select aria-label={`Operador ${i + 1}`} className="w-auto" value={f.op} onChange={(e) => set({ filters: filters.map((x, k) => (k === i ? { ...x, op: e.target.value as 'eq' | 'ne' } : x)) })}><option value="eq">é</option><option value="ne">não é</option></Select>
            {def.type === 'bool'
              ? <Select aria-label={`Valor ${i + 1}`} className="w-auto" value={String(f.value)} onChange={(e) => set({ filters: filters.map((x, k) => (k === i ? { ...x, value: e.target.value === 'true' } : x)) })}><option value="true">Sim</option><option value="false">Não</option></Select>
              : <Input aria-label={`Valor ${i + 1}`} className="w-40" value={String(f.value)} onChange={(e) => set({ filters: filters.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} />}
            <button type="button" className="rounded p-1.5 text-muted hover:text-danger" aria-label={`Retirar filtro ${i + 1}`} onClick={() => set({ filters: filters.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></button>
          </div>
        );
      })}
      {filters.length < 8 && <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => set({ filters: [...filters, { field: 'onTime', op: 'eq', value: true }] })}>Adicionar filtro</button>}
    </fieldset>
  );
}

function IndicatorEditor({ row, onClose }: { row: IndicatorRow | 'new' | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const users = useLookups().data?.users ?? [];
  const [d, setD] = useState<IndicatorDef>(blankDef);
  const [note, setNote] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const [who, setWho] = useState('');
  const k = row === 'new' ? 'new' : row?.id ?? null;
  if (k !== key) { setKey(k); setD(row && row !== 'new' ? structuredClone(row.def) : blankDef()); setNote(''); }
  const set = (p: Partial<IndicatorDef>) => setD({ ...d, ...p });
  const errs = validateIndicator(d);
  const two = ['percentual', 'taxa', 'razao'].includes(d.calc);
  const vars = Object.entries(d.vars ?? {});
  const formula = d.calc === 'formula' ? parseFormula(d.expr ?? '', vars.map(([n]) => n)) : null;
  const preview = useMutation({
    mutationFn: () => api<{ value: number | null; status: string; sample: number; range: { from: string; to: string } }>('/performance/indicators/preview', { method: 'POST', body: { def: d, ...(who ? { userId: who } : { empresa: true }) } }),
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const save = useMutation({
    mutationFn: () => (row === 'new' ? api('/performance/indicators', { method: 'POST', body: { def: d, note: note || undefined } }) : api(`/performance/indicators/${row!.id}`, { method: 'PUT', body: { def: d, note } })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['performance'] }); onClose(); toast({ tone: 'success', message: row === 'new' ? 'Indicador criado' : 'Nova versão salva' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const versions = useQuery({ queryKey: ['performance', 'indicator-versions', k], enabled: !!row && row !== 'new', queryFn: () => api<{ items: { version: number; note: string | null; createdAt: string; by: string | null }[] }>(`/performance/indicators/${(row as IndicatorRow).id}/versions`) });
  const calcChange = (calc: IndicatorDef['calc']) => {
    const base = d.base ?? d.numerator ?? blankSource();
    if (['percentual', 'taxa', 'razao'].includes(calc)) set({ calc, numerator: d.numerator ?? base, denominator: d.denominator ?? base, base: undefined, vars: undefined, unit: calc === 'razao' ? 'indice' : 'percentual' });
    else if (calc === 'formula') set({ calc, vars: d.vars ?? { a: base }, expr: d.expr ?? 'a', base: undefined, numerator: undefined, denominator: undefined });
    else set({ calc, base, numerator: undefined, denominator: undefined, vars: undefined, unit: calc === 'valor' ? 'reais' : calc === 'tempo' ? 'horas' : d.unit, ...(calc === 'tempo' ? { direction: 'menor' as const } : {}) });
  };
  return (
    <Drawer open={!!row} onClose={onClose} title={row === 'new' ? 'Novo indicador' : 'Editar indicador'} width="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!!errs.length || (row !== 'new' && note.trim().length < 3)} loading={save.isPending} onClick={() => save.mutate()}>{row === 'new' ? 'Criar indicador' : 'Salvar nova versão'}</Button></>}>
      <div className="space-y-4">
        <FormField label="Nome" htmlFor="ind-name" required><Input id="ind-name" value={d.name} onChange={(e) => set({ name: e.target.value })} /></FormField>
        <FormField label="Descrição" htmlFor="ind-desc"><Textarea id="ind-desc" rows={2} value={d.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined })} /></FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Categoria" htmlFor="ind-cat"><Select id="ind-cat" value={d.category} onChange={(e) => set({ category: e.target.value as IndicatorDef['category'] })}>{INDICATOR_CATEGORIES.map((c) => <option key={c} value={c}>{INDICATOR_CATEGORY_LABELS[c]}</option>)}</Select></FormField>
          <FormField label="Cálculo" htmlFor="ind-calc"><Select id="ind-calc" value={d.calc} onChange={(e) => calcChange(e.target.value as IndicatorDef['calc'])}>{INDICATOR_CALCS.map((c) => <option key={c} value={c}>{INDICATOR_CALC_LABELS[c]}</option>)}</Select></FormField>
          <FormField label="Unidade" htmlFor="ind-unit"><Select id="ind-unit" value={d.unit} onChange={(e) => set({ unit: e.target.value as IndicatorDef['unit'] })}>{INDICATOR_UNITS.map((u) => <option key={u} value={u}>{INDICATOR_UNIT_LABELS[u]}</option>)}</Select></FormField>
          <FormField label="Direção desejada" htmlFor="ind-dir"><Select id="ind-dir" value={d.direction} onChange={(e) => set({ direction: e.target.value as 'maior' | 'menor' })}><option value="maior">Maior é melhor</option><option value="menor">Menor é melhor</option></Select></FormField>
          <FormField label="Período" htmlFor="ind-per"><Select id="ind-per" value={d.period} onChange={(e) => set({ period: e.target.value as IndicatorDef['period'] })}>{(['semana', 'mes', 'trimestre', 'ano'] as const).map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}</Select></FormField>
          <FormField label="Meta padrão" htmlFor="ind-tgt"><Input id="ind-tgt" inputMode="decimal" value={d.target ?? ''} onChange={(e) => set({ target: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })} /></FormField>
          <FormField label="Peso padrão" htmlFor="ind-w"><Input id="ind-w" inputMode="numeric" value={d.weight ?? ''} onChange={(e) => set({ weight: e.target.value === '' ? undefined : Number(e.target.value) })} /></FormField>
          <FormField label="Amostra mínima" htmlFor="ind-min" hint="Abaixo disso: incompleto"><Input id="ind-min" inputMode="numeric" value={d.minSample ?? ''} onChange={(e) => set({ minSample: e.target.value === '' ? undefined : Number(e.target.value) })} /></FormField>
        </div>
        {two ? (<><SourceEditor label="Parte (numerador)" value={d.numerator!} onChange={(x) => set({ numerator: x })} /><SourceEditor label="Total (denominador)" value={d.denominator!} onChange={(x) => set({ denominator: x })} /></>)
          : d.calc === 'formula' ? (
            <div className="space-y-3">
              {vars.map(([n, src]) => (
                <div key={n} className="space-y-1">
                  <div className="flex items-center gap-2"><Input aria-label="Nome da variável" className="w-40" value={n} onChange={(e) => { const nn = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); set({ vars: Object.fromEntries(vars.map(([k2, v]) => [k2 === n ? nn : k2, v])) }); }} />{vars.length > 1 && <button type="button" className="text-sm text-danger" onClick={() => set({ vars: Object.fromEntries(vars.filter(([k2]) => k2 !== n)) })}>Retirar</button>}</div>
                  <SourceEditor label={`Variável ${n}`} value={src} onChange={(x) => set({ vars: { ...d.vars, [n]: x } })} />
                </div>
              ))}
              <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => { let i = vars.length; while (d.vars?.[`v${i}`]) i++; set({ vars: { ...d.vars, [`v${i}`]: blankSource() } }); }}>Adicionar variável</button>
              <FormField label="Fórmula" htmlFor="ind-expr" hint="Use as variáveis, + − × ÷, parênteses e min, max, abs, round. Separe argumentos com ';'."><Input id="ind-expr" value={d.expr ?? ''} onChange={(e) => set({ expr: e.target.value })} /></FormField>
              {formula && (formula.ok ? <p className="text-sm text-success">Fórmula válida.</p> : <p className="text-sm text-danger">{formula.error}</p>)}
            </div>
          ) : <SourceEditor label="Origem" value={d.base!} onChange={(x) => set({ base: x })} />}
        {!!errs.length && <Notice tone="warning">{errs.join(' ')}</Notice>}
        <section className="flex flex-wrap items-end gap-2 rounded-md bg-surface-2 p-3">
          <FormField label="Testar para" htmlFor="ind-who"><Select id="ind-who" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Empresa toda</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></FormField>
          <Button variant="secondary" disabled={!!errs.length} loading={preview.isPending} onClick={() => preview.mutate()}>Testar no período atual</Button>
          {preview.data && <p className="text-sm">Resultado: <span className="num font-semibold text-ink">{preview.data.value === null ? '—' : fmtIndicator(preview.data.value, d.unit)}</span> · {STATUS_TEXT[preview.data.status] ?? preview.data.status} · {preview.data.sample} evento(s)</p>}
        </section>
        {row !== 'new' && <FormField label="O que mudou nesta versão" htmlFor="ind-note" required><Input id="ind-note" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>}
        {!!versions.data?.items.length && <section><h3 className="mb-1 font-bold text-ink">Versões</h3><ul className="space-y-1 text-sm">{versions.data.items.map((v) => <li key={v.version}><span className="font-semibold text-ink">v{v.version}</span> · {fmtDateTime(v.createdAt)} · {v.by ?? '—'} — {v.note}</li>)}</ul></section>}
      </div>
    </Drawer>
  );
}

export const STATUS_TEXT: Record<string, string> = { ok: 'calculado', incompleto: 'amostra pequena (incompleto)', indisponivel: 'sem dados de origem (indisponível)', sem_base: 'sem base para calcular', sem_meta: 'sem meta definida' };
