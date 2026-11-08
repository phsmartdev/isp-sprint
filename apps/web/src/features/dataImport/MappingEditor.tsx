/**
 * Mapeamento visual, lado a lado: à esquerda o campo do ISP Sprint, ao centro a regra (de onde vem e como se
 * transforma), à direita exemplos reais da origem. Sugestões chegam com motivo e confiança e só valem aprovadas.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  MAPPING_KIND_LABELS, TARGET_ENTITIES, TARGET_ENTITY_LABELS, TRANSFORM_LABELS,
  type Condition, type EntityMapping, type EquivalenceTable, type FieldMapping, type ImportConfig, type TargetEntity, type TargetField, type Transform,
} from '@isp/domain';
import { api } from '../../lib/api';
import { Button, Chip, FormField, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { useImportSchema, type DiscoveredField, type RefOpt } from './shared';

const uid = () => Math.random().toString(36).slice(2, 9);
const TRANSFORM_DEFAULTS: Record<Transform['op'], Transform> = {
  trim: { op: 'trim' }, upper: { op: 'upper' }, lower: { op: 'lower' }, digits: { op: 'digits' }, truncate: { op: 'truncate', max: 200 }, default: { op: 'default', value: '' }, null_if: { op: 'null_if', values: ['-', 'n/a'] },
  date: { op: 'date', format: 'dd/mm/yyyy' }, datetime: { op: 'datetime', timezone: 'America/Sao_Paulo' }, cents: { op: 'cents', decimal: ',', unit: 'reais' }, number: { op: 'number', decimal: ',' }, percent: { op: 'percent', decimal: ',' },
  phone: { op: 'phone' }, document: { op: 'document' }, email: { op: 'email' }, boolean: { op: 'boolean', trueValues: ['sim', 'true', '1'] }, equivalence: { op: 'equivalence', table: '' },
};
const OPS: [Condition['op'], string][] = [['eq', 'igual a'], ['neq', 'diferente de'], ['contains', 'contém'], ['in', 'está em (a,b)'], ['empty', 'vazio'], ['not_empty', 'preenchido'], ['true', 'verdadeiro'], ['false', 'falso']];

function TransformEditor({ t, set, tables, onRemove }: { t: Transform; set: (t: Transform) => void; tables: EquivalenceTable[]; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 text-xs">
      <span className="font-semibold">{TRANSFORM_LABELS[t.op]}</span>
      {t.op === 'truncate' && <input aria-label="Tamanho máximo" className="w-12 border border-line px-1" value={t.max} onChange={(e) => set({ ...t, max: Number(e.target.value.replace(/\D/g, '')) || 1 })} />}
      {t.op === 'default' && <input aria-label="Valor padrão" className="w-24 border border-line px-1" value={t.value} onChange={(e) => set({ ...t, value: e.target.value })} />}
      {t.op === 'null_if' && <input aria-label="Valores tratados como vazio" className="w-24 border border-line px-1" value={t.values.join(',')} onChange={(e) => set({ ...t, values: e.target.value.split(',').map((x) => x.trim()) })} />}
      {t.op === 'date' && <select aria-label="Formato da data" className="border border-line" value={t.format} onChange={(e) => set({ ...t, format: e.target.value as typeof t.format })}><option value="dd/mm/yyyy">dd/mm/aaaa</option><option value="iso">aaaa-mm-dd</option><option value="mm/dd/yyyy">mm/dd/aaaa</option></select>}
      {t.op === 'datetime' && <select aria-label="Fuso de origem" className="border border-line" value={t.timezone} onChange={(e) => set({ ...t, timezone: e.target.value })}><option value="America/Sao_Paulo">Brasília</option><option value="America/Bahia">Bahia</option><option value="UTC">UTC</option></select>}
      {(t.op === 'cents' || t.op === 'number' || t.op === 'percent') && <select aria-label="Separador decimal" className="border border-line" value={t.decimal} onChange={(e) => set({ ...t, decimal: e.target.value as ',' | '.' })}><option value=",">vírgula</option><option value=".">ponto</option></select>}
      {t.op === 'cents' && <select aria-label="Unidade" className="border border-line" value={t.unit} onChange={(e) => set({ ...t, unit: e.target.value as 'reais' | 'centavos' })}><option value="reais">em reais</option><option value="centavos">já em centavos</option></select>}
      {t.op === 'boolean' && <input aria-label="Valores verdadeiros" className="w-24 border border-line px-1" value={t.trueValues.join(',')} onChange={(e) => set({ ...t, trueValues: e.target.value.split(',').map((x) => x.trim()) })} />}
      {t.op === 'equivalence' && <select aria-label="Tabela" className="border border-line" value={t.table} onChange={(e) => set({ ...t, table: e.target.value })}><option value="">tabela…</option>{tables.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>}
      <button type="button" aria-label={`Tirar ${TRANSFORM_LABELS[t.op]}`} className="text-muted hover:text-danger" onClick={onRemove}>×</button>
    </span>
  );
}

function SourcePicker({ value, onChange, fields, label }: { value: string; onChange: (v: string) => void; fields: DiscoveredField[]; label: string }) {
  const id = useMemo(() => `src-${uid()}`, []);
  return (<>
    <Input aria-label={label} list={id} className="h-8 text-xs" placeholder="campo da origem" value={value} onChange={(e) => onChange(e.target.value)} />
    <datalist id={id}>{fields.map((f) => <option key={f.path} value={f.path}>{f.samples[0] ? `ex.: ${f.samples[0]}` : '(vazio)'}</option>)}</datalist>
  </>);
}

function FieldRow({ tf, m, set, remove, add, fields, tables, readOnly }: { tf: TargetField; m: FieldMapping | undefined; set: (m: FieldMapping) => void; remove: () => void; add: () => void; fields: DiscoveredField[]; tables: EquivalenceTable[]; readOnly: boolean }) {
  const samples = m?.sources.map((p) => fields.find((f) => f.path === p)).filter(Boolean) as DiscoveredField[] | undefined;
  return (
    <tr className={clsx('border-t border-line align-top', !m && 'bg-surface-2/40')} aria-label={`Campo ${tf.label}`}>
      <td className="w-56 px-3 py-2">
        <p className="font-semibold text-ink">{tf.label}{tf.required && <span className="text-danger"> *</span>}</p>
        <p className="text-[11px] text-muted">{tf.type}{tf.values ? `: ${tf.values.join(', ')}` : ''}{tf.hint ? ` · ${tf.hint}` : ''}</p>
      </td>
      <td className="px-3 py-2">
        {!m ? (readOnly ? <span className="text-xs text-muted">Sem correspondência</span> : <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={add}>Mapear</Button>) : (
          <fieldset disabled={readOnly} className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Select aria-label={`Tipo de correspondência de ${tf.label}`} className="h-8 w-48 text-xs" value={m.kind} onChange={(e) => set({ ...m, kind: e.target.value as FieldMapping['kind'], approved: false })}>{Object.entries(MAPPING_KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
              {m.kind === 'constante' && (tf.values ? <Select aria-label={`Valor fixo de ${tf.label}`} className="h-8 w-48 text-xs" value={m.value ?? ''} onChange={(e) => set({ ...m, value: e.target.value })}><option value="">escolha</option>{tf.values.map((v) => <option key={v} value={v}>{v}</option>)}</Select> : <Input aria-label={`Valor fixo de ${tf.label}`} className="h-8 w-48 text-xs" value={m.value ?? ''} onChange={(e) => set({ ...m, value: e.target.value })} />)}
              {(m.kind === 'direta' || m.kind === 'equivalencia') && <div className="w-72"><SourcePicker label={`Origem de ${tf.label}`} value={m.sources[0] ?? ''} fields={fields} onChange={(v) => set({ ...m, sources: [v] })} /></div>}
              {m.kind === 'equivalencia' && <Select aria-label={`Tabela de ${tf.label}`} className="h-8 w-48 text-xs" value={m.table ?? ''} onChange={(e) => set({ ...m, table: e.target.value })}><option value="">tabela…</option>{tables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select>}
              <button type="button" aria-label={`Tirar mapeamento de ${tf.label}`} className="ml-auto text-muted hover:text-danger" onClick={remove}><Trash2 className="h-4 w-4" /></button>
            </div>
            {m.kind === 'composicao' && (
              <div className="space-y-1">
                {m.sources.map((p, i) => <div key={i} className="flex items-center gap-1"><span className="num w-6 text-xs text-muted">{`{${i}}`}</span><div className="flex-1"><SourcePicker label={`Parte ${i + 1} de ${tf.label}`} value={p} fields={fields} onChange={(v) => set({ ...m, sources: m.sources.map((x, k) => (k === i ? v : x)) })} /></div><button type="button" aria-label="Tirar parte" className="text-muted hover:text-danger" onClick={() => set({ ...m, sources: m.sources.filter((_, k) => k !== i) })}>×</button></div>)}
                <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => set({ ...m, sources: [...m.sources, ''] })}>+ parte</Button><Input aria-label={`Modelo de composição de ${tf.label}`} className="h-8 text-xs" placeholder="{0} - {1}" value={m.template ?? ''} onChange={(e) => set({ ...m, template: e.target.value })} /></div>
              </div>
            )}
            {m.kind === 'condicional' && (
              <div className="space-y-1 rounded-sm border border-line p-2">
                {(m.rules ?? []).map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-1 text-xs">
                    <span>Se</span>
                    <div className="w-44"><SourcePicker label={`Condição ${i + 1} de ${tf.label}`} value={r.when[0]?.path ?? ''} fields={fields} onChange={(v) => set({ ...m, rules: m.rules!.map((x, k) => (k === i ? { ...x, when: [{ ...(x.when[0] ?? { op: 'eq' }), path: v }] } : x)) })} /></div>
                    <select aria-label="Operador" className="h-8 border border-line" value={r.when[0]?.op ?? 'eq'} onChange={(e) => set({ ...m, rules: m.rules!.map((x, k) => (k === i ? { ...x, when: [{ ...(x.when[0] ?? { path: '' }), op: e.target.value as Condition['op'] }] } : x)) })}>{OPS.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>
                    {!['empty', 'not_empty', 'true', 'false'].includes(r.when[0]?.op ?? 'eq') && <input aria-label="Valor da condição" className="h-8 w-28 border border-line px-1" value={r.when[0]?.value ?? ''} onChange={(e) => set({ ...m, rules: m.rules!.map((x, k) => (k === i ? { ...x, when: [{ ...x.when[0]!, value: e.target.value }] } : x)) })} />}
                    <span>então</span>
                    {tf.values ? <select aria-label="Resultado" className="h-8 border border-line" value={r.value ?? ''} onChange={(e) => set({ ...m, rules: m.rules!.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })}><option value="">…</option>{tf.values.map((v) => <option key={v} value={v}>{v}</option>)}</select>
                      : <input aria-label="Resultado" className="h-8 w-32 border border-line px-1" value={r.value ?? ''} onChange={(e) => set({ ...m, rules: m.rules!.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} />}
                    <button type="button" aria-label="Tirar regra" className="text-muted hover:text-danger" onClick={() => set({ ...m, rules: m.rules!.filter((_, k) => k !== i) })}>×</button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-1 text-xs"><Button size="sm" variant="ghost" onClick={() => set({ ...m, rules: [...(m.rules ?? []), { when: [{ path: '', op: 'eq', value: '' }], value: '' }] })}>+ regra</Button><span>Senão:</span>
                  {tf.values ? <select aria-label="Valor padrão da condição" className="h-8 border border-line" value={m.value ?? ''} onChange={(e) => set({ ...m, value: e.target.value })}><option value="">vazio</option>{tf.values.map((v) => <option key={v} value={v}>{v}</option>)}</select> : <input aria-label="Valor padrão da condição" className="h-8 w-32 border border-line px-1" value={m.value ?? ''} onChange={(e) => set({ ...m, value: e.target.value })} />}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1">
              {m.transforms.map((t, i) => <TransformEditor key={i} t={t} tables={tables} set={(x) => set({ ...m, transforms: m.transforms.map((y, k) => (k === i ? x : y)) })} onRemove={() => set({ ...m, transforms: m.transforms.filter((_, k) => k !== i) })} />)}
              <select aria-label={`Adicionar transformação em ${tf.label}`} className="h-7 border border-dashed border-line bg-transparent text-xs text-muted" value="" onChange={(e) => e.target.value && set({ ...m, transforms: [...m.transforms, TRANSFORM_DEFAULTS[e.target.value as Transform['op']]] })}><option value="">+ transformação</option>{Object.entries(TRANSFORM_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </div>
          </fieldset>
        )}
      </td>
      <td className="w-64 px-3 py-2 text-xs">
        {samples?.length ? samples.map((f) => <p key={f.path} className="truncate text-text" title={f.samples.join(' | ')}>{f.samples.slice(0, 2).join(' · ') || '(vazio)'} <span className="text-muted">({f.filled}/{f.total})</span></p>) : m && m.kind !== 'constante' && m.kind !== 'condicional' && m.sources[0] ? <p className="text-[#9A6B00]">Não apareceu na amostra</p> : null}
      </td>
      <td className="w-40 px-3 py-2">
        {m && (
          <div className="space-y-1">
            <label className={clsx('flex items-center gap-1.5 text-xs font-semibold', m.approved ? 'text-[#15803D]' : 'text-[#9A6B00]')}><input type="checkbox" className="h-4 w-4 accent-primary" disabled={readOnly} checked={m.approved} onChange={(e) => set({ ...m, approved: e.target.checked })} aria-label={`Aprovar correspondência de ${tf.label}`} />{m.approved ? 'Aprovada' : 'Aprovar'}</label>
            {m.reason && <p className="text-[11px] text-muted" title={m.reason}><Sparkles className="mr-0.5 inline h-3 w-3" aria-hidden />{Math.round((m.confidence ?? 0) * 100)}% · {m.reason}</p>}
          </div>
        )}
      </td>
    </tr>
  );
}

function TablesEditor({ tables, set, readOnly, refs, connectorId }: { tables: EquivalenceTable[]; set: (t: EquivalenceTable[]) => void; readOnly: boolean; refs: Record<string, RefOpt[]>; connectorId: string | null }) {
  const toast = useToast();
  const load = useMutation({
    mutationFn: async (i: number) => { const t = tables[i]!; const kind = t.refKind === 'etapa' ? 'etapa' : t.refKind === 'usuario' ? 'usuario' : t.refKind === 'origem' ? 'origem' : 'motivo'; return { i, items: (await api<{ items: RefOpt[] }>(`/admin/import/connectors/${connectorId}/references?kind=${kind}`)).items }; },
    onSuccess: ({ i, items }) => { const t = tables[i]!; set(tables.map((x, k) => (k === i ? { ...x, rows: [...t.rows, ...items.filter((it) => !t.rows.some((r) => r.from === it.id)).map((it) => ({ from: it.id, to: null, label: [it.label, it.sub].filter(Boolean).join(' · ') }))] } : x))); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  return (
    <section aria-label="Tabelas de equivalência" className="space-y-3">
      <div className="flex items-center gap-2"><h3 className="font-bold text-ink">Tabelas de equivalência</h3>{!readOnly && <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set([...tables, { key: `tabela_${tables.length + 1}`, label: `Tabela ${tables.length + 1}`, refKind: 'valor', rows: [], fallback: { kind: 'revisar' } }])}>Nova tabela</Button>}</div>
      {!tables.length && <p className="text-sm text-muted">Use para traduzir categorias (etapas, usuários, modalidades) entre os sistemas.</p>}
      {tables.map((t, i) => {
        const opts = t.refKind !== 'valor' ? refs[t.refKind] ?? [] : [];
        const upd = (x: Partial<EquivalenceTable>) => set(tables.map((y, k) => (k === i ? { ...y, ...x } : y)));
        const missing = t.rows.filter((r) => !r.to).length;
        return (
          <fieldset key={i} disabled={readOnly} className="rounded-md border border-line p-3" aria-label={`Tabela ${t.label}`}>
            <div className="mb-2 flex flex-wrap items-end gap-2">
              <FormField label="Nome" htmlFor={`tb-l-${i}`}><Input id={`tb-l-${i}`} className="h-8" value={t.label} onChange={(e) => upd({ label: e.target.value })} /></FormField>
              <FormField label="Chave" htmlFor={`tb-k-${i}`}><Input id={`tb-k-${i}`} className="h-8 w-36" value={t.key} onChange={(e) => upd({ key: e.target.value.replace(/[^\w]/g, '') })} /></FormField>
              <FormField label="Traduz para" htmlFor={`tb-r-${i}`}><Select id={`tb-r-${i}`} className="h-8" value={t.refKind} onChange={(e) => upd({ refKind: e.target.value as EquivalenceTable['refKind'] })}><option value="valor">Valor (texto/categoria)</option><option value="etapa">Jornada e etapa</option><option value="usuario">Usuário</option><option value="origem">Origem</option><option value="filial">Filial</option></Select></FormField>
              <FormField label="Sem equivalência" htmlFor={`tb-f-${i}`}><Select id={`tb-f-${i}`} className="h-8" value={t.fallback.kind} onChange={(e) => upd({ fallback: { ...t.fallback, kind: e.target.value as 'revisar' } })}><option value="revisar">Mandar para revisão</option><option value="vazio">Deixar vazio</option><option value="padrao">Usar valor padrão</option></Select></FormField>
              {t.fallback.kind === 'padrao' && <FormField label="Padrão" htmlFor={`tb-p-${i}`}><Input id={`tb-p-${i}`} className="h-8" value={t.fallback.value ?? ''} onChange={(e) => upd({ fallback: { ...t.fallback, value: e.target.value } })} /></FormField>}
              {connectorId && t.refKind !== 'valor' && t.refKind !== 'filial' && <Button size="sm" variant="ghost" loading={load.isPending && load.variables === i} onClick={() => load.mutate(i)}>Carregar valores da origem</Button>}
              <button type="button" aria-label={`Tirar tabela ${t.label}`} className="ml-auto pb-2 text-muted hover:text-danger" onClick={() => set(tables.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
            {!!missing && <p className="mb-1 text-xs text-[#9A6B00]">{missing} valor(es) sem equivalência.</p>}
            <div className="max-h-72 overflow-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-2 font-medium">Valor na origem</th><th className="py-1 font-medium">No ISP Sprint</th><th /></tr></thead><tbody>
              {t.rows.map((r, j) => (
                <tr key={j} className="border-t border-line">
                  <td className="py-1 pr-2"><Input aria-label="Valor na origem" className="h-8 text-xs" value={r.from} onChange={(e) => upd({ rows: t.rows.map((x, k) => (k === j ? { ...x, from: e.target.value } : x)) })} />{r.label && <span className="text-[11px] text-muted">{r.label}</span>}</td>
                  <td className="py-1">{opts.length ? <Select aria-label={`Equivalente de ${r.label ?? r.from}`} className="h-8 text-xs" value={r.to ?? ''} onChange={(e) => upd({ rows: t.rows.map((x, k) => (k === j ? { ...x, to: e.target.value || null } : x)) })}><option value="">— sem equivalência —</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.label}{o.sub ? ` (${o.sub})` : ''}</option>)}</Select>
                    : <Input aria-label={`Equivalente de ${r.label ?? r.from}`} className="h-8 text-xs" value={r.to ?? ''} onChange={(e) => upd({ rows: t.rows.map((x, k) => (k === j ? { ...x, to: e.target.value || null } : x)) })} />}</td>
                  <td><button type="button" aria-label="Tirar linha" className="px-2 text-muted hover:text-danger" onClick={() => upd({ rows: t.rows.filter((_, k) => k !== j) })}>×</button></td>
                </tr>
              ))}
            </tbody></table></div>
            <Button size="sm" variant="ghost" onClick={() => upd({ rows: [...t.rows, { from: '', to: null }] })}>+ linha</Button>
          </fieldset>
        );
      })}
    </section>
  );
}

const blankEntity = (target: TargetEntity, source: string): EntityMapping => ({ source, target, enabled: true, fields: [], legacy: 'preservar', policy: { onNew: 'criar', onExisting: 'atualizar', emptyValues: 'manter', matchByKey: 'revisar' }, filter: [] });

export function MappingEditor({ config, onChange, connectorId, readOnly = false }: { config: ImportConfig; onChange: (c: ImportConfig) => void; connectorId: string | null; readOnly?: boolean }) {
  const schema = useImportSchema();
  const toast = useToast();
  const disc = useQuery({ queryKey: ['import', 'discover', connectorId], enabled: !!connectorId, queryFn: () => api<{ entities: { key: string; label: string; suggestedTarget: string | null }[]; fields: Record<string, DiscoveredField[]> }>(`/admin/import/connectors/${connectorId}/discover`), staleTime: 300_000, retry: false });
  const [tab, setTab] = useState(0);
  const [all, setAll] = useState(false);
  const suggest = useMutation({ mutationFn: () => api<ImportConfig>('/admin/import/templates/suggest', { method: 'POST', body: { connectorId } }), onSuccess: (c) => { onChange({ ...c, tables: [...config.tables.filter((t) => !c.tables.some((x) => x.key === t.key)), ...c.tables] }); toast({ tone: 'success', message: 'Sugestões carregadas: revise e aprove cada correspondência' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (schema.isLoading) return <LoadingRows rows={6} />;
  const sch = schema.data!.schema;
  const em = config.entities[tab];
  const setEm = (x: EntityMapping) => onChange({ ...config, entities: config.entities.map((e, i) => (i === tab ? x : e)) });
  const fields = em ? disc.data?.fields[em.source] ?? [] : [];
  const pending = config.entities.reduce((a, e) => a + e.fields.filter((f) => !f.approved).length, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && connectorId && <Button size="sm" icon={<Sparkles className="h-4 w-4" />} loading={suggest.isPending} onClick={() => suggest.mutate()}>{config.entities.length ? 'Refazer sugestões a partir da origem' : 'Sugerir a partir da origem'}</Button>}
        {disc.isError && <span className="text-xs text-danger">Não consegui ler a origem: {errMsg(disc.error)}</span>}
        {!!pending && <Chip tone="yellow">{pending} correspondência(s) para aprovar</Chip>}
        <span className="ml-auto text-xs text-muted">Fuso da origem</span>
        <Select aria-label="Fuso da origem" disabled={readOnly} className="h-8 w-40 text-xs" value={config.timezone} onChange={(e) => onChange({ ...config, timezone: e.target.value })}><option value="America/Sao_Paulo">Brasília</option><option value="America/Bahia">Bahia</option><option value="UTC">UTC</option></Select>
      </div>
      <div role="tablist" aria-label="Entidades" className="scroll-thin flex gap-1 overflow-x-auto border-b border-line">
        {config.entities.map((e, i) => (
          <button key={i} role="tab" aria-selected={tab === i} onClick={() => setTab(i)} className={clsx('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold', tab === i ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {e.source} → {TARGET_ENTITY_LABELS[e.target]}{!e.enabled && ' (desligada)'}{e.fields.some((f) => !f.approved) && <span className="ml-1 text-[#9A6B00]">•</span>}
          </button>
        ))}
        {!readOnly && (
          <select aria-label="Adicionar entidade" className="ml-2 border-0 bg-transparent text-sm text-primary" value="" onChange={(e) => { const [src, tgt] = e.target.value.split('|'); if (src && tgt) { onChange({ ...config, entities: [...config.entities, blankEntity(tgt as TargetEntity, src)] }); setTab(config.entities.length); } }}>
            <option value="">+ entidade</option>
            {(disc.data?.entities ?? []).flatMap((x) => TARGET_ENTITIES.map((t) => <option key={`${x.key}|${t}`} value={`${x.key}|${t}`}>{x.label} → {TARGET_ENTITY_LABELS[t]}</option>))}
          </select>
        )}
      </div>
      {!em ? <Notice>Nenhuma entidade no modelo. {connectorId ? 'Peça sugestões a partir da origem ou adicione uma entidade.' : 'Escolha um conector para ler os campos da origem.'}</Notice> : (
        <div className="space-y-3">
          <fieldset disabled={readOnly} className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-surface p-3">
            <label className="flex items-center gap-2 pb-2 text-sm font-semibold"><input type="checkbox" className="h-4 w-4 accent-primary" checked={em.enabled} onChange={(e) => setEm({ ...em, enabled: e.target.checked })} />Importar esta entidade</label>
            <FormField label="Registro novo" htmlFor="pol-new"><Select id="pol-new" className="h-8" value={em.policy.onNew} onChange={(e) => setEm({ ...em, policy: { ...em.policy, onNew: e.target.value as 'criar' } })}><option value="criar">Criar</option><option value="revisar">Revisar antes</option><option value="ignorar">Ignorar</option></Select></FormField>
            <FormField label="Já importado antes" htmlFor="pol-ex"><Select id="pol-ex" className="h-8" value={em.policy.onExisting} onChange={(e) => setEm({ ...em, policy: { ...em.policy, onExisting: e.target.value as 'atualizar' } })}><option value="atualizar">Atualizar</option><option value="ignorar">Ignorar</option><option value="revisar">Revisar</option></Select></FormField>
            <FormField label="Valor vazio na origem" htmlFor="pol-empty"><Select id="pol-empty" className="h-8" value={em.policy.emptyValues} onChange={(e) => setEm({ ...em, policy: { ...em.policy, emptyValues: e.target.value as 'manter' } })}><option value="manter">Não apagar o que existe</option><option value="limpar">Limpar no ISP Sprint</option></Select></FormField>
            <FormField label="Já existe no ISP Sprint (CPF/CNPJ ou e-mail)" htmlFor="pol-key"><Select id="pol-key" className="h-8" value={em.policy.matchByKey} onChange={(e) => setEm({ ...em, policy: { ...em.policy, matchByKey: e.target.value as 'revisar' } })}><option value="revisar">Revisar</option><option value="vincular">Vincular e atualizar</option><option value="desligado">Não procurar</option></Select></FormField>
            <FormField label="Campos sem correspondência" htmlFor="pol-leg"><Select id="pol-leg" className="h-8" value={em.legacy} onChange={(e) => setEm({ ...em, legacy: e.target.value as 'preservar' })}><option value="preservar">Preservar como legado</option><option value="descartar">Não guardar</option></Select></FormField>
            {!readOnly && <button type="button" className="ml-auto pb-2 text-xs text-muted hover:text-danger" onClick={() => { onChange({ ...config, entities: config.entities.filter((_, i) => i !== tab) }); setTab(0); }}>Tirar entidade</button>}
          </fieldset>
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 font-medium">ISP Sprint ({TARGET_ENTITY_LABELS[em.target]})</th><th className="px-3 py-2 font-medium">Regra (origem: {em.source})</th><th className="px-3 py-2 font-medium">Exemplos reais</th><th className="px-3 py-2 font-medium">Aprovação</th></tr></thead>
              <tbody>
                {sch[em.target].filter((tf) => all || tf.required || em.fields.some((f) => f.target === tf.key) || !tf.key.startsWith('custom.')).map((tf) => {
                  const m = em.fields.find((f) => f.target === tf.key);
                  return <FieldRow key={tf.key} tf={tf} m={m} fields={fields} tables={config.tables} readOnly={readOnly}
                    add={() => setEm({ ...em, fields: [...em.fields, { id: uid(), target: tf.key, kind: 'direta', sources: [''], transforms: [], approved: false }] })}
                    set={(x) => setEm({ ...em, fields: em.fields.map((f) => (f.target === tf.key ? x : f)) })}
                    remove={() => setEm({ ...em, fields: em.fields.filter((f) => f.target !== tf.key) })} />;
                })}
              </tbody>
            </table>
          </div>
          {sch[em.target].some((tf) => tf.key.startsWith('custom.') && !em.fields.some((f) => f.target === tf.key)) && <button type="button" className="text-sm text-primary" onClick={() => setAll(!all)}>{all ? 'Esconder campos personalizados sem correspondência' : `Mostrar os ${sch[em.target].filter((tf) => tf.key.startsWith('custom.') && !em.fields.some((f) => f.target === tf.key)).length} campos personalizados sem correspondência`}</button>}
          {!readOnly && !!em.fields.filter((f) => !f.approved).length && <Button size="sm" variant="ghost" icon={<Check className="h-4 w-4" />} onClick={() => setEm({ ...em, fields: em.fields.map((f) => ({ ...f, approved: f.approved || ((f.confidence ?? 0) >= 0.8 && !f.reason?.includes('empate') && !f.reason?.includes('também sugerido')) })) })}>Aprovar só as sugestões sem ambiguidade (≥ 80%)</Button>}
        </div>
      )}
      <TablesEditor tables={config.tables} set={(tables) => onChange({ ...config, tables })} readOnly={readOnly} refs={schema.data!.refs} connectorId={connectorId} />
      <fieldset disabled={readOnly} className="flex flex-wrap gap-3 text-sm">
        <FormField label="Registros por lote" htmlFor="ex-b"><Input id="ex-b" className="h-8 w-24" inputMode="numeric" value={config.execution.batchSize} onChange={(e) => onChange({ ...config, execution: { ...config.execution, batchSize: Math.min(200, Math.max(5, Number(e.target.value.replace(/\D/g, '')) || 5)) } })} /></FormField>
        <FormField label="Grande volume a partir de" htmlFor="ex-l" hint="Acima disso, a importação pede autorização da Diretoria/Administração"><Input id="ex-l" className="h-8 w-28" inputMode="numeric" value={config.execution.largeVolume} onChange={(e) => onChange({ ...config, execution: { ...config.execution, largeVolume: Math.max(10, Number(e.target.value.replace(/\D/g, '')) || 10) } })} /></FormField>
      </fieldset>
    </div>
  );
}
