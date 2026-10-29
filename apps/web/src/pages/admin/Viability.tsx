/**
 * Configurações → Viabilidade: parâmetros do motor financeiro (aba Viabilidade econômica da oportunidade)
 * e o catálogo de custos com preço por vigência.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { COST_IMPACTS, COST_IMPACT_LABELS, toCents, type CostImpact } from '@isp/domain';
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

const ECON_KEYS = ['marginTargetBp', 'marginSuggestedBp', 'marginMaxBp', 'tmaAnnualBp', 'inflationAnnualBp', 'badDebtBp', 'commissionBp', 'lossPrivateBp', 'lossPublicBp', 'contingencyCapexBp', 'contingencyOpexBp', 'overheadBp', 'incomeTaxBp', 'legacyOneTimeX100', 'legacyRecurringX100'] as const;
type EconKey = (typeof ECON_KEYS)[number];
type EconForm = Record<EconKey, number | null> & { paybackMaxPrivate: number | null; paybackMaxPublic: number | null; horizonMaxMonths: number | null; blockOutsidePolicy: boolean; validFrom: string };
type EconVersion = Record<EconKey, number | undefined> & { tmaMonthlyBp?: number; paybackMaxPrivate: number; paybackMaxPublic: number; horizonMaxMonths?: number; blockOutsidePolicy: boolean };
type EconData = { current: (EconVersion & { id: string; validFrom: string }) | null; versions: { id: string; validFrom: string; createdAt: string; createdByName: string | null; values: EconVersion }[]; today: string };

/** Campos em grupos, na ordem em que o cálculo os usa. */
type Field = { key: EconKey | 'paybackMaxPrivate' | 'paybackMaxPublic' | 'horizonMaxMonths'; label: string; hint: string; months?: boolean; factor?: boolean; optional?: boolean };
const GROUPS: { title: string; desc: string; fields: Field[] }[] = [
  { title: 'Deduções da receita', desc: 'Saem do preço antes da margem de contribuição. Os tributos vêm do documento fiscal de cada item.', fields: [
    { key: 'commissionBp', label: 'Comissão padrão', hint: 'Sobre o preço; o vendedor pode ajustar na oportunidade' },
    { key: 'lossPrivateBp', label: 'Glosa, setor privado', hint: 'Retenção ou não aceite parcial das faturas (SLA, disputas)' },
    { key: 'lossPublicBp', label: 'Glosa, setor público', hint: 'Conta governamental, natureza pública ou licitação' },
    { key: 'badDebtBp', label: 'Inadimplência', hint: 'Perda ou atraso esperado sobre o faturamento' },
  ] },
  { title: 'Contingências', desc: 'Folga somada aos custos informados na oportunidade.', fields: [
    { key: 'contingencyCapexBp', label: 'Sobre o investimento', hint: 'Somada ao investimento inicial (CAPEX)' },
    { key: 'contingencyOpexBp', label: 'Sobre os custos mensais', hint: 'Somada aos custos operacionais (OPEX)' },
  ] },
  { title: 'Margem operacional e líquida', desc: 'Da margem de contribuição saem glosa, inadimplência e despesas fixas; do resultado positivo, o IR/CSLL (não entra na nota fiscal: fica coberto pela margem).', fields: [
    { key: 'overheadBp', label: 'Despesas fixas rateadas', hint: 'Estrutura e administrativo, em % da receita' },
    { key: 'incomeTaxBp', label: 'IR/CSLL', hint: 'Sobre a margem operacional positiva' },
  ] },
  { title: 'Premissas da projeção de caixa', desc: 'Alimentam o fluxo de caixa: VPL, TIR e payback descontado.', fields: [
    { key: 'tmaAnnualBp', label: 'TMA anual', hint: 'Custo de capital; a mensal é (1 + anual)^(1/12) − 1' },
    { key: 'inflationAnnualBp', label: 'Inflação anual (reajuste)', hint: 'IPCA/IGP-M; a receita sobe a partir do 13º mês' },
    { key: 'horizonMaxMonths', label: 'Prazo máximo de previsão', hint: 'Horizonte da projeção (ex.: 24, 36 ou 60)', months: true },
  ] },
  { title: 'Comparativo com o modelo histórico', desc: 'Opcional. A memória de cálculo mostra o preço pela regra antiga e a margem real que ela deixa. Não entra na decisão.', fields: [
    { key: 'legacyOneTimeX100', label: 'Fator da venda pontual', hint: 'Sobre o investimento (ex.: 2,5)', factor: true, optional: true },
    { key: 'legacyRecurringX100', label: 'Fator da recorrente', hint: 'Sobre o custo mensal (ex.: 3,2)', factor: true, optional: true },
  ] },
  { title: 'Política de aprovação', desc: 'Aprovação automática com VPL positivo, TIR acima da TMA, margem no piso ou acima e payback descontado dentro do teto; senão, alçada superior.', fields: [
    { key: 'marginTargetBp', label: 'Piso da margem de contribuição', hint: 'Abaixo dele, só com a alçada superior' },
    { key: 'marginSuggestedBp', label: 'Sugestão de margem', hint: 'Valor inicial na tela do vendedor' },
    { key: 'marginMaxBp', label: 'Teto da margem', hint: 'Máximo que o vendedor pode escolher' },
    { key: 'paybackMaxPrivate', label: 'Teto de payback, privado', hint: 'O vendedor escolhe até aqui (ex.: 6)', months: true },
    { key: 'paybackMaxPublic', label: 'Teto de payback, público', hint: 'O vendedor escolhe até aqui (ex.: 12 a 18)', months: true },
  ] },
];

/** TMA é ao mês: mostra o equivalente anual e avisa valores que costumam ser digitados como anuais. */
/** TMA é anual: mostra a mensal equivalente e avisa valores que parecem mensais digitados como anuais ou vice-versa. */
const tmaHint = (bp: number | null, base: string) => {
  if (bp == null) return base;
  const m = ((1 + bp / 10_000) ** (1 / 12) - 1) * 100;
  const txt = `Equivale a ${m.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}% ao mês.`;
  return bp > 10_000 ? `Atenção: ${(bp / 100).toLocaleString('pt-BR')}% ao ano é muito alto. ${txt}` : bp > 0 && bp < 300 ? `${txt} Confira: TMA anual costuma ficar acima de 3%.` : txt;
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
    setE({ ...(Object.fromEntries(ECON_KEYS.map((k) => [k, c?.[k] ?? null])) as Record<EconKey, number | null>), paybackMaxPrivate: c?.paybackMaxPrivate ?? null, paybackMaxPublic: c?.paybackMaxPublic ?? null, horizonMaxMonths: c?.horizonMaxMonths ?? null, blockOutsidePolicy: c?.blockOutsidePolicy ?? true, validFrom: q.data.today });
    setDirty(false);
  }, [q.data]);
  const m = useMutation({
    mutationFn: () => api('/admin/viability/econ', { method: 'POST', body: e }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'viability-econ'] }); qc.invalidateQueries({ queryKey: ['economics'] }); toast({ tone: 'success', message: 'Parâmetros publicados' }); },
    onError: (err) => toast({ tone: 'error', message: errMsg(err) }),
  });
  if (!e || !q.data) return <section className="card p-5"><LoadingRows /></section>;
  const set = (v: Partial<EconForm>) => { setE({ ...e, ...v }); setDirty(true); };
  const missing = GROUPS.flatMap((g) => g.fields).filter((f) => !f.optional && e[f.key] == null).map((f) => f.label);
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
        Preço exato = (investimento ÷ payback + custos mensais + tributo fixo) ÷ (1 − tributos − comissão − <b>margem</b>) · margem de contribuição − glosa e inadimplência − despesas fixas = <b>margem operacional</b> − IR/CSLL = <b>margem líquida</b>
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {GROUPS.map((g) => (
          <Group key={g.title} title={g.title} desc={g.desc}>
            {g.fields.map((f) => (
              <FormField key={f.key} label={f.label} htmlFor={`ec-${f.key}`} hint={f.key === 'tmaAnnualBp' ? tmaHint(e.tmaAnnualBp, f.hint) : f.hint}>
                <NumInput id={`ec-${f.key}`} label={f.label} int={f.months} value={e[f.key]} suffix={f.months ? 'meses' : f.factor ? '× o custo' : '%'} onChange={(v) => set({ [f.key]: v } as Partial<EconForm>)} />
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
              <thead className="text-muted"><tr>{['Vigência', 'Margem piso/sug./teto', 'TMA', 'Comissão', 'Glosa priv./púb. · inadimp.', 'Contingência inv./mensal', 'Desp. fixas', 'IR/CSLL', 'Payback priv./púb.', 'Publicado por'].map((h) => <th key={h} className="py-1 pr-3 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody>{q.data.versions.map((v) => (
                <tr key={v.id} className="border-t border-line">
                  <td className="py-1 pr-3">{fmtDate(v.validFrom)}{cur?.id === v.id ? ' (em vigor)' : ''}</td>
                  <td className="num py-1 pr-3">{p2(v.values.marginTargetBp)} / {p2(v.values.marginSuggestedBp)} / {p2(v.values.marginMaxBp)}</td>
                  <td className="num py-1 pr-3">{v.values.tmaAnnualBp != null ? `${p2(v.values.tmaAnnualBp)} a.a.` : `${p2(v.values.tmaMonthlyBp)} a.m.`}</td>
                  <td className="num py-1 pr-3">{p2(v.values.commissionBp)}</td>
                  <td className="num py-1 pr-3">{p2(v.values.lossPrivateBp)} / {p2(v.values.lossPublicBp)} · {p2(v.values.badDebtBp)}</td>
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

type CostItem = { id: string | null; name: string; kind: 'investimento' | 'mensal'; unit: string; impact?: CostImpact | null; active: boolean; unitCents?: number | null; priceFrom?: string | null; prices?: { id: string; unitCents: number; validFrom: string; createdAt: string; createdByName: string | null }[] };

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
    mutationFn: () => api('/admin/cost-items', { method: 'PUT', body: { items: rows.filter((r) => r.name.trim()).map(({ id, name, kind, unit, impact, active }) => ({ id, name: name.trim(), kind, unit: unit.trim() || 'un', impact: kind === 'mensal' ? 'operacional' : impact ?? null, active })) } }),
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
      <p className="mb-3 max-w-3xl text-sm text-muted">Materiais, equipamentos e serviços que entram no investimento ou nos custos mensais da viabilidade. O item é identificado pela descrição + unidade. Na oportunidade, item conhecido já vem com o impacto e o preço da última cotação; item novo entra aqui sozinho quando o vendedor salva, e a nova cotação passa a ser o preço vigente. Mesma descrição com outra unidade é outro item. Preço publicado aqui vale a partir da data escolhida.</p>
      {!!rows.length && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1060px] text-sm">
            <thead className="text-xs text-muted"><tr>{['Item', 'Tipo', 'Unidade', 'Impacta o quê?', 'Preço vigente', 'Novo preço', 'Ativo'].map((h) => <th key={h} className="py-1 pr-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.id ?? `n${i}`} className="border-t border-line align-middle">
                <td className="py-1.5 pr-2"><Input aria-label={`Item ${i + 1}`} className="h-9 min-w-[200px]" value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Ex.: Roteador corporativo" /></td>
                <td className="py-1.5 pr-2"><Select aria-label={`Tipo do item ${i + 1}`} className="h-9 w-[140px]" value={r.kind} onChange={(e) => set(i, { kind: e.target.value as CostItem['kind'] })}><option value="investimento">Investimento</option><option value="mensal">Mensal</option></Select></td>
                <td className="py-1.5 pr-2"><Input aria-label={`Unidade do item ${i + 1}`} className="h-9 w-[80px]" value={r.unit} onChange={(e) => set(i, { unit: e.target.value })} /></td>
                <td className="py-1.5 pr-2">{r.kind === 'mensal' ? <span className="text-xs text-muted">Custo operacional</span> : (
                  <Select aria-label={`Impacto do item ${i + 1}`} className="h-9 w-[170px]" value={r.impact ?? ''} onChange={(e) => set(i, { impact: (e.target.value || null) as CostImpact | null })}>
                    <option value="">A classificar</option>
                    {COST_IMPACTS.filter((x) => x !== 'operacional').map((x) => <option key={x} value={x}>{COST_IMPACT_LABELS[x]}</option>)}
                  </Select>
                )}</td>
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
