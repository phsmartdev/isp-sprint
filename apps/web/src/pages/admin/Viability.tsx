/**
 * Configurações → Viabilidade: parâmetros do motor financeiro (aba Viabilidade econômica da oportunidade)
 * e o catálogo de custos com preço por vigência.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toCents } from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fmtBRL, fmtDate, fmtDateTime } from '../../lib/format';
import { Button, Chip, FormField, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';

const dec = (n: number | null | undefined) => (n === null || n === undefined ? '' : (n / 100).toFixed(2).replace('.', ',').replace(/,00$/, ''));
const numOrNull = (s: string) => (s.trim() === '' ? null : toCents(s));
const intOrNull = (s: string) => (s.trim() === '' ? null : Math.max(0, Math.round(Number(s))));
const errMsg = (e: unknown) => (e instanceof ApiError ? [e.problem.detail ?? e.message, ...(e.problem.errors ?? []).map((x) => `${x.path}: ${x.message}`)].join(' ') : (e as Error).message);

function NumInput({ id, value, onChange, label, suffix, int }: { id: string; value: number | null; onChange: (v: number | null) => void; label: string; suffix?: string; int?: boolean }) {
  const show = (v: number | null) => (v === null ? '' : int ? String(v) : dec(v));
  const [s, setS] = useState(show(value));
  useEffect(() => setS(show(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span className="flex items-center gap-1.5">
      <Input id={id} aria-label={label} inputMode="decimal" className="w-24" value={s} onChange={(e) => setS(e.target.value)} onBlur={() => onChange(int ? intOrNull(s) : numOrNull(s))} />
      {suffix && <span className="text-xs text-muted">{suffix}</span>}
    </span>
  );
}

const ECON_KEYS = ['marginTargetBp', 'tmaMonthlyBp', 'commissionBp', 'lossPrivateBp', 'lossPublicBp', 'contingencyCapexBp', 'contingencyOpexBp', 'overheadBp', 'incomeTaxBp'] as const;
type EconKey = (typeof ECON_KEYS)[number];
type EconForm = Record<EconKey, number | null> & { paybackMaxPrivate: number | null; paybackMaxPublic: number | null; blockOutsidePolicy: boolean; validFrom: string };
type EconVersion = Record<EconKey, number | undefined> & { paybackMaxPrivate: number; paybackMaxPublic: number; blockOutsidePolicy: boolean };
type EconData = { current: (EconVersion & { id: string; validFrom: string }) | null; versions: { id: string; validFrom: string; createdAt: string; createdByName: string | null; values: EconVersion }[]; today: string };

/** Campos em grupos, na ordem em que o cálculo os usa. */
type Field = { key: EconKey | 'paybackMaxPrivate' | 'paybackMaxPublic'; label: string; hint: string; months?: boolean };
const GROUPS: { title: string; desc: string; fields: Field[] }[] = [
  { title: 'Deduções da receita', desc: 'Saem do preço antes da margem de contribuição. Os tributos vêm do documento fiscal de cada item.', fields: [
    { key: 'commissionBp', label: 'Comissão padrão', hint: 'Sobre o preço; o vendedor pode ajustar na oportunidade' },
    { key: 'lossPrivateBp', label: 'Glosa, setor privado', hint: 'Inadimplência, glosas e descontos esperados' },
    { key: 'lossPublicBp', label: 'Glosa, setor público', hint: 'Conta governamental, natureza pública ou licitação' },
  ] },
  { title: 'Contingências', desc: 'Folga somada aos custos informados na oportunidade.', fields: [
    { key: 'contingencyCapexBp', label: 'Sobre o investimento', hint: 'Somada ao investimento inicial (CAPEX)' },
    { key: 'contingencyOpexBp', label: 'Sobre os custos mensais', hint: 'Somada aos custos operacionais (OPEX)' },
  ] },
  { title: 'Margem operacional e líquida', desc: 'Da margem de contribuição saem a amortização do investimento na vigência e as despesas fixas; do resultado positivo, o IR/CSLL.', fields: [
    { key: 'overheadBp', label: 'Despesas fixas rateadas', hint: 'Estrutura e administrativo, em % da receita' },
    { key: 'incomeTaxBp', label: 'IR/CSLL', hint: 'Sobre a margem operacional positiva' },
  ] },
  { title: 'Custo do dinheiro', desc: 'Corrige o investimento no preço mínimo e desconta o payback.', fields: [
    { key: 'tmaMonthlyBp', label: 'TMA mensal', hint: 'Taxa mínima de atratividade, ao mês' },
  ] },
  { title: 'Política de aprovação', desc: 'Abaixo da margem mínima ou com payback descontado acima do limite, a venda sai da política.', fields: [
    { key: 'marginTargetBp', label: 'Margem de contribuição mínima', hint: 'Sobre o preço' },
    { key: 'paybackMaxPrivate', label: 'Payback máximo, privado', hint: 'Payback descontado', months: true },
    { key: 'paybackMaxPublic', label: 'Payback máximo, público', hint: 'Payback descontado', months: true },
  ] },
];

/** TMA é ao mês: mostra o equivalente anual e avisa valores que costumam ser digitados como anuais. */
const tmaHint = (bp: number | null, base: string) => {
  if (bp == null) return base;
  const annual = ((1 + bp / 10_000) ** 12 - 1) * 100;
  const a = `${annual.toLocaleString('pt-BR', { maximumFractionDigits: annual >= 100 ? 0 : 1 })}% ao ano`;
  return bp > 500 ? `Atenção: ${(bp / 100).toLocaleString('pt-BR')}% AO MÊS equivale a ${a}. Se o número é anual, informe o mensal (ex.: 18% ao ano ≈ 1,39% ao mês).` : `Equivale a ${a}.`;
};

function Group({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-md border border-line p-4">
      <legend className="px-1 text-sm font-bold text-ink">{title}</legend>
      <p className="mb-3 text-xs text-muted">{desc}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Motor financeiro da aba Viabilidade econômica: parâmetros publicados com data de vigência; o histórico fica guardado. */
function EconEngine() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'viability-econ'], queryFn: () => api<EconData>('/admin/viability/econ') });
  const [e, setE] = useState<EconForm | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    const c = q.data.current;
    setE({ ...(Object.fromEntries(ECON_KEYS.map((k) => [k, c?.[k] ?? null])) as Record<EconKey, number | null>), paybackMaxPrivate: c?.paybackMaxPrivate ?? null, paybackMaxPublic: c?.paybackMaxPublic ?? null, blockOutsidePolicy: c?.blockOutsidePolicy ?? true, validFrom: q.data.today });
    setDirty(false);
  }, [q.data]);
  const m = useMutation({
    mutationFn: () => api('/admin/viability/econ', { method: 'POST', body: e }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'viability-econ'] }); qc.invalidateQueries({ queryKey: ['economics'] }); toast({ tone: 'success', message: 'Parâmetros publicados' }); },
    onError: (err) => toast({ tone: 'error', message: errMsg(err) }),
  });
  if (!e || !q.data) return <section className="card p-5"><LoadingRows /></section>;
  const set = (v: Partial<EconForm>) => { setE({ ...e, ...v }); setDirty(true); };
  const missing = GROUPS.flatMap((g) => g.fields).filter((f) => e[f.key] == null).map((f) => f.label);
  const cur = q.data.current;
  const p2 = (v: number | undefined) => (v == null ? '—' : `${(v / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-md font-bold text-ink">Motor financeiro</h3>
          <p className="max-w-3xl text-sm text-muted">Parâmetros da aba Viabilidade econômica. Cada publicação vale a partir da data escolhida; cálculos já salvos não mudam.</p>
        </div>
        {cur ? <Chip tone="green">Em vigor desde {fmtDate(cur.validFrom)}</Chip> : <Chip tone="orange">Nada publicado</Chip>}
      </div>
      {!cur && <div className="mt-3"><Notice tone="warning">A viabilidade econômica não calcula até você preencher e publicar.</Notice></div>}

      <p className="mt-4 rounded-md bg-surface-2 px-3 py-2 text-xs text-text" aria-label="Como o cálculo usa os parâmetros">
        Receita − tributos − comissão − glosa − custos mensais = <b>margem de contribuição</b> − amortização do investimento − despesas fixas = <b>margem operacional</b> − IR/CSLL = <b>margem líquida</b>
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {GROUPS.map((g) => (
          <Group key={g.title} title={g.title} desc={g.desc}>
            {g.fields.map((f) => (
              <FormField key={f.key} label={f.label} htmlFor={`ec-${f.key}`} hint={f.key === 'tmaMonthlyBp' ? tmaHint(e.tmaMonthlyBp, f.hint) : f.hint}>
                <NumInput id={`ec-${f.key}`} label={f.label} int={f.months} value={e[f.key]} suffix={f.months ? 'meses' : '%'} onChange={(v) => set({ [f.key]: v } as Partial<EconForm>)} />
              </FormField>
            ))}
            {g.title === 'Política de aprovação' && (
              <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={e.blockOutsidePolicy} onChange={(ev) => set({ blockOutsidePolicy: ev.target.checked })} />Bloquear o pedido de aprovação quando a venda estiver fora da política ou inviável</label>
            )}
          </Group>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-4">
        <FormField label="Vale a partir de" htmlFor="ec-from" hint="Hoje ou uma data futura"><Input id="ec-from" type="date" className="w-[170px]" min={q.data.today} value={e.validFrom} onChange={(ev) => set({ validFrom: ev.target.value })} /></FormField>
        <div className="flex flex-wrap items-center gap-3">
          {missing.length > 0 && <span className="max-w-md text-xs text-[#C2610C]">Falta: {missing.join(', ')} (0 é um valor válido).</span>}
          <Button variant="primary" loading={m.isPending} disabled={!dirty || missing.length > 0} onClick={() => m.mutate()}>Publicar parâmetros</Button>
        </div>
      </div>

      {!!q.data.versions.length && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-semibold text-ink">Histórico de publicações ({q.data.versions.length})</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[960px] text-xs">
              <thead className="text-muted"><tr>{['Vigência', 'Margem mín.', 'TMA', 'Comissão', 'Glosa priv./púb.', 'Contingência inv./mensal', 'Desp. fixas', 'IR/CSLL', 'Payback priv./púb.', 'Publicado por'].map((h) => <th key={h} className="py-1 pr-3 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody>{q.data.versions.map((v) => (
                <tr key={v.id} className="border-t border-line">
                  <td className="py-1 pr-3">{fmtDate(v.validFrom)}{cur?.id === v.id ? ' (em vigor)' : ''}</td>
                  <td className="num py-1 pr-3">{p2(v.values.marginTargetBp)}</td>
                  <td className="num py-1 pr-3">{p2(v.values.tmaMonthlyBp)}</td>
                  <td className="num py-1 pr-3">{p2(v.values.commissionBp)}</td>
                  <td className="num py-1 pr-3">{p2(v.values.lossPrivateBp)} / {p2(v.values.lossPublicBp)}</td>
                  <td className="num py-1 pr-3">{p2(v.values.contingencyCapexBp)} / {p2(v.values.contingencyOpexBp)}</td>
                  <td className="num py-1 pr-3">{p2(v.values.overheadBp)}</td>
                  <td className="num py-1 pr-3">{p2(v.values.incomeTaxBp)}</td>
                  <td className="num py-1 pr-3">{v.values.paybackMaxPrivate} / {v.values.paybackMaxPublic} meses</td>
                  <td className="py-1 pr-3">{v.createdByName ?? '—'} · {fmtDateTime(v.createdAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

type CostItem = { id: string | null; name: string; kind: 'investimento' | 'mensal'; unit: string; active: boolean; unitCents?: number | null; priceFrom?: string | null; prices?: { id: string; unitCents: number; validFrom: string; createdAt: string; createdByName: string | null }[] };

/** Catálogo de custos: itens de investimento e mensais com preço de custo por vigência (o histórico fica guardado). */
function CostCatalog() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['admin', 'cost-items'], queryFn: () => api<{ items: CostItem[]; today: string }>('/admin/cost-items') });
  const [rows, setRows] = useState<CostItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [price, setPrice] = useState<Record<string, { value: string; from: string }>>({});
  useEffect(() => { if (q.data) { setRows(q.data.items); setDirty(false); } }, [q.data]);
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['admin', 'cost-items'] }); qc.invalidateQueries({ queryKey: ['cost-items'] }); toast({ tone: 'success', message: msg }); };
  const save = useMutation({
    mutationFn: () => api('/admin/cost-items', { method: 'PUT', body: { items: rows.filter((r) => r.name.trim()).map(({ id, name, kind, unit, active }) => ({ id, name: name.trim(), kind, unit: unit.trim() || 'un', active })) } }),
    onSuccess: () => done('Catálogo salvo'), onError: (err) => toast({ tone: 'error', message: errMsg(err) }),
  });
  const publish = useMutation({
    mutationFn: (id: string) => { const p = price[id]!; const c = numOrNull(p.value); if (c == null) throw new Error('Informe o preço no formato 1.250,00.'); return api(`/admin/cost-items/${id}/prices`, { method: 'POST', body: { unitCents: c, validFrom: p.from } }); },
    onSuccess: (_r, id) => { setPrice((x) => { const y = { ...x }; delete y[id]; return y; }); done('Preço publicado'); }, onError: (err) => toast({ tone: 'error', message: errMsg(err) }),
  });
  if (!q.data) return <section className="card p-5"><LoadingRows /></section>;
  const set = (i: number, v: Partial<CostItem>) => { setRows(rows.map((r, j) => (j === i ? { ...r, ...v } : r))); setDirty(true); };
  return (
    <section className="card p-5">
      <h3 className="text-md font-bold text-ink">Catálogo de custos</h3>
      <p className="mb-3 max-w-3xl text-sm text-muted">Materiais, equipamentos e serviços que entram no investimento ou nos custos mensais da viabilidade. Na oportunidade, o vendedor escolhe pelo nome e o preço vigente vem junto; se ele mudar o valor, a linha fica marcada como alterada. Preço novo vale a partir da data escolhida.</p>
      {!!rows.length && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-xs text-muted"><tr>{['Item', 'Tipo', 'Unidade', 'Preço vigente', 'Novo preço', 'Ativo'].map((h) => <th key={h} className="py-1 pr-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.id ?? `n${i}`} className="border-t border-line align-middle">
                <td className="py-1.5 pr-2"><Input aria-label={`Item ${i + 1}`} className="h-9 min-w-[200px]" value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Ex.: Roteador corporativo" /></td>
                <td className="py-1.5 pr-2"><Select aria-label={`Tipo do item ${i + 1}`} className="h-9 w-[140px]" value={r.kind} onChange={(e) => set(i, { kind: e.target.value as CostItem['kind'] })}><option value="investimento">Investimento</option><option value="mensal">Mensal</option></Select></td>
                <td className="py-1.5 pr-2"><Input aria-label={`Unidade do item ${i + 1}`} className="h-9 w-[80px]" value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} /></td>
                <td className="num py-1.5 pr-2" title={(r.prices ?? []).map((p) => `${fmtDate(p.validFrom)}: ${fmtBRL(p.unitCents)} (${p.createdByName ?? '—'})`).join('\n') || undefined}>{r.unitCents != null ? <>{fmtBRL(r.unitCents)}<span className="block text-2xs text-muted">desde {fmtDate(r.priceFrom)}{(r.prices?.length ?? 0) > 1 ? ` · ${r.prices!.length} preços` : ''}</span></> : <span className="text-[#C2610C]">sem preço</span>}</td>
                <td className="py-1.5 pr-2">{r.id ? (
                  <span className="flex items-center gap-1">
                    <Input aria-label={`Novo preço do item ${i + 1}`} inputMode="decimal" className="h-9 w-[110px]" placeholder="0,00" value={price[r.id]?.value ?? ''} onChange={(e) => setPrice({ ...price, [r.id!]: { value: e.target.value, from: price[r.id!]?.from ?? q.data!.today } })} />
                    <Input aria-label={`Vigência do novo preço do item ${i + 1}`} type="date" min={q.data.today} className="h-9 w-[150px]" value={price[r.id]?.from ?? q.data.today} onChange={(e) => setPrice({ ...price, [r.id!]: { value: price[r.id!]?.value ?? '', from: e.target.value } })} />
                    <Button size="sm" disabled={!price[r.id]?.value?.trim()} loading={publish.isPending && publish.variables === r.id} onClick={() => publish.mutate(r.id!)}>Publicar</Button>
                  </span>
                ) : <span className="text-xs text-muted">salve o item primeiro</span>}</td>
                <td className="py-1.5"><input type="checkbox" aria-label={`Item ${i + 1} ativo`} className="h-4 w-4 accent-primary" checked={r.active} onChange={(e) => set(i, { active: e.target.checked })} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex flex-wrap justify-between gap-2">
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setRows([...rows, { id: null, name: '', kind: 'investimento', unit: 'un', active: true }]); setDirty(true); }}>Adicionar item</Button>
        <Button size="sm" variant="primary" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Salvar itens</Button>
      </div>
    </section>
  );
}

export function AdminViability() {
  return (
    <div className="space-y-4">
      <EconEngine />
      <CostCatalog />
    </div>
  );
}
