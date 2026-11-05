/**
 * Configurações → Viabilidade → Envelope fiscal por vigência (Reforma Tributária). Cada chave é filial (emitente) +
 * município IBGE + ano. A tela carrega só os campos do regime da chave escolhida: até 2026 o regime atual (PIS, COFINS,
 * ICMS, ISS, FECOEP, DAS); de 2027 em diante CBS e IBS no lugar de PIS/COFINS.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toCents } from '@isp/domain';
import { api, ApiError } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Button, Chip, FormField, Input, LoadingRows, Notice, Select } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';

type Schema = { year: number; regime: 'tradicional' | 'reforma'; regimeLabel: string; reformFirstYear: number; kinds: { key: string; label: string }[]; taxes: { key: string; label: string }[]; profitTax: { key: string; label: string }; retentions: { key: string; label: string }[] };
type Values = { taxes: Record<string, Record<string, number | null>>; profitTaxBp: number | null; retentions: Record<string, number | null>; note?: string | null };
type Env = { id: string; branchId: string; branchName: string; ibgeCode: string; municipality: string | null; year: number; regime: string; values: Values; createdAt: string; createdByName: string | null; current: boolean };
type Branch = { id: string; name: string; active: boolean; ibgeCode: string | null; city: string | null; state: string | null };

const pct = (bp: number | null | undefined) => (bp == null ? '' : (bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false }));
const toBp = (s: string) => (s.trim() === '' ? null : toCents(s));
const errMsg = (e: unknown) => (e instanceof ApiError ? [e.problem.detail ?? e.message, ...(e.problem.errors ?? []).map((x) => `${x.path}: ${x.message}`)].join(' ') : (e as Error).message);
const empty = (): Values => ({ taxes: {}, profitTaxBp: null, retentions: {}, note: null });

function Pct({ id, label, value, onChange }: { id: string; label: string; value: number | null | undefined; onChange: (v: number | null) => void }) {
  const [s, setS] = useState(pct(value));
  useEffect(() => setS(pct(value)), [value]);
  return <Input id={id} aria-label={label} inputMode="decimal" className="w-20 text-right" value={s} onChange={(e) => setS(e.target.value)} onBlur={() => onChange(toBp(s))} />;
}

export function FiscalEnvelopes() {
  const qc = useQueryClient();
  const toast = useToast();
  const thisYear = new Date().getFullYear();
  const branches = useQuery({ queryKey: ['admin', 'sales-branches'], queryFn: () => api<{ items: Branch[] }>('/admin/sales-branches') });
  const list = useQuery({ queryKey: ['admin', 'fiscal-envelopes'], queryFn: () => api<{ items: Env[] }>('/admin/viability/envelopes') });
  const [branchId, setBranchId] = useState('');
  const [ibge, setIbge] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [year, setYear] = useState(thisYear);
  const [v, setV] = useState<Values>(empty());
  const schema = useQuery({ queryKey: ['admin', 'fiscal-envelopes', 'schema', year], queryFn: () => api<Schema>(`/admin/viability/envelopes/schema?year=${year}`), enabled: year >= 2020 && year <= 2100 });
  const br = branches.data?.items.find((b) => b.id === branchId);
  useEffect(() => { if (!branchId && branches.data?.items.length) setBranchId(branches.data.items.find((b) => b.active)?.id ?? ''); }, [branches.data, branchId]);
  useEffect(() => { if (br) { setIbge(br.ibgeCode ?? ''); setMunicipality(br.city ? `${br.city}${br.state ? `/${br.state}` : ''}` : ''); } }, [br?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // a chave escolhida carrega o envelope vigente dela (ou começa vazio)
  const cur = useMemo(() => list.data?.items.find((e) => e.current && e.branchId === branchId && e.ibgeCode === ibge && e.year === year) ?? null, [list.data, branchId, ibge, year]);
  useEffect(() => { setV(cur ? { ...empty(), ...cur.values, retentions: cur.values.retentions ?? {} } : empty()); }, [cur?.id, branchId, ibge, year]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: () => {
      const allowed = new Set(schema.data!.taxes.map((t) => t.key));
      // só os campos do regime da chave ativa vão no payload
      const taxes = Object.fromEntries(Object.entries(v.taxes).map(([k, t]) => [k, Object.fromEntries(Object.entries(t).filter(([c, x]) => allowed.has(c) && x != null))]));
      return api('/admin/viability/envelopes', { method: 'POST', body: { branchId, ibgeCode: ibge, municipality: municipality || null, year, values: { taxes, profitTaxBp: v.profitTaxBp, retentions: v.retentions, note: v.note ?? null } } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'fiscal-envelopes'] }); qc.invalidateQueries({ queryKey: ['economics'] }); toast({ tone: 'success', message: `Envelope fiscal ${year} publicado` }); },
    onError: (err) => toast({ tone: 'error', message: errMsg(err) }),
  });
  if (!branches.data || !list.data) return <section className="card p-5"><LoadingRows /></section>;
  const sc = schema.data;
  const sum = (kind: string) => sc ? sc.taxes.reduce((t, x) => t + (v.taxes[kind]?.[x.key] ?? 0), 0) : 0;
  const setTax = (kind: string, code: string, bp: number | null) => setV({ ...v, taxes: { ...v.taxes, [kind]: { ...(v.taxes[kind] ?? {}), [code]: bp } } });
  const validKey = !!branchId && /^\d{7}$/.test(ibge) && year >= 2020 && year <= 2100;
  const currents = list.data.items.filter((e) => e.current);
  return (
    <section className="card p-5" aria-labelledby="env-title">
      <h3 id="env-title" className="text-md font-bold text-ink">Envelope fiscal por vigência</h3>
      <p className="max-w-3xl text-sm text-muted">
        Tributos da nota, alíquota efetiva sobre o lucro e retenções de cada filial e município, por ano. A simulação usa o envelope da vigência escolhida;
        de {sc?.reformFirstYear ?? 2027} em diante (Reforma Tributária) CBS e IBS entram no lugar de PIS e COFINS.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <FormField label="Filial (emitente)" htmlFor="env-branch"><Select id="env-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>{branches.data.items.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active ? '' : ' (desativada)'}</option>)}</Select></FormField>
        <FormField label="Município (IBGE)" htmlFor="env-ibge" hint={br && !br.ibgeCode ? 'A filial está sem código IBGE: preencha em Filiais' : '7 dígitos'}><Input id="env-ibge" inputMode="numeric" maxLength={7} className="w-28" value={ibge} onChange={(e) => setIbge(e.target.value.replace(/\D/g, ''))} /></FormField>
        <FormField label="Nome do município" htmlFor="env-mun"><Input id="env-mun" className="w-48" value={municipality} onChange={(e) => setMunicipality(e.target.value)} /></FormField>
        <FormField label="Vigência (ano)" htmlFor="env-year"><Input id="env-year" type="number" min={2020} max={2100} className="w-24" value={year} onChange={(e) => setYear(Number(e.target.value))} /></FormField>
        {sc && <Chip tone={sc.regime === 'reforma' ? 'blue' : 'neutral'}>{sc.regimeLabel}</Chip>}
        {cur ? <Chip tone="green">Publicado em {fmtDateTime(cur.createdAt)}</Chip> : validKey && <Chip tone="orange">Chave sem envelope</Chip>}
      </div>

      {sc && (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
          <fieldset className="border border-line p-4">
            <legend className="px-1 text-sm font-bold text-ink">1 · Tributos da nota (divisor do markup)</legend>
            <p className="mb-3 text-xs text-muted">A carga da cesta de cada produto é a soma da coluna do tipo do documento fiscal dele.</p>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead className="text-2xs text-muted"><tr><th className="py-1 pr-3 text-left font-medium">Tributo</th>{sc.kinds.map((k) => <th key={k.key} className="py-1 pr-3 text-right font-medium">{k.label}</th>)}</tr></thead>
                <tbody>
                  {sc.taxes.map((t) => (
                    <tr key={t.key} className="border-t border-line">
                      <td className="py-1 pr-3">{t.label}</td>
                      {sc.kinds.map((k) => <td key={k.key} className="py-1 pr-3 text-right"><span className="inline-flex items-center gap-1"><Pct id={`env-${k.key}-${t.key}`} label={`${t.label} em ${k.label}`} value={v.taxes[k.key]?.[t.key]} onChange={(x) => setTax(k.key, t.key, x)} /><span className="text-xs text-muted">%</span></span></td>)}
                    </tr>
                  ))}
                  <tr className="border-t border-line font-semibold text-ink"><td className="py-1 pr-3">Carga da nota</td>{sc.kinds.map((k) => <td key={k.key} className="num py-1 pr-3 text-right">{pct(sum(k.key)) || '0'}%</td>)}</tr>
                </tbody>
              </table>
            </div>
          </fieldset>
          <div className="space-y-4">
            <fieldset className="border border-line p-4">
              <legend className="px-1 text-sm font-bold text-ink">2 · DRE de viabilidade</legend>
              <FormField label={sc.profitTax.label} htmlFor="env-profit" hint="Sobre a margem operacional positiva: presunção do Lucro Presumido, partilha do Simples ou Lucro Real. Usada na DRE e na margem recomendada.">
                <span className="inline-flex items-center gap-1"><Pct id="env-profit" label={sc.profitTax.label} value={v.profitTaxBp} onChange={(x) => setV({ ...v, profitTaxBp: x })} /><span className="text-xs text-muted">%</span></span>
              </FormField>
            </fieldset>
            <fieldset className="border border-dashed border-line p-4">
              <legend className="px-1 text-sm font-bold text-ink">3 · Retenções na fonte</legend>
              <p className="mb-3 text-xs text-muted">Só para o contas a receber e a compensação. Não entram no preço nem na DRE de viabilidade.</p>
              <div className="space-y-2">
                {sc.retentions.map((r) => (
                  <label key={r.key} className="flex items-center justify-between gap-3 text-sm">{r.label}<span className="inline-flex items-center gap-1"><Pct id={`env-ret-${r.key}`} label={r.label} value={v.retentions[r.key]} onChange={(x) => setV({ ...v, retentions: { ...v.retentions, [r.key]: x } })} /><span className="text-xs text-muted">%</span></span></label>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
        {!validKey && <span className="text-xs text-[#C2610C]">Escolha a filial, o município (IBGE com 7 dígitos) e o ano.</span>}
        <Button variant="primary" loading={m.isPending} disabled={!validKey || !sc} onClick={() => m.mutate()}>Publicar envelope {year}</Button>
      </div>

      {currents.length > 0 ? (
        <details className="mt-4 text-sm" open>
          <summary className="cursor-pointer font-semibold text-ink">Envelopes vigentes ({currents.length}) · histórico com {list.data.items.length} publicações</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="text-muted"><tr>{['Filial', 'Município', 'Vigência', 'Carga da nota por tipo', 'IRPJ/CSLL', 'Retenções', 'Publicado'].map((h) => <th key={h} className="py-1 pr-3 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody>{list.data.items.map((e) => (
                <tr key={e.id} className={`border-t border-line ${e.current ? '' : 'text-muted'}`}>
                  <td className="py-1 pr-3">{e.branchName}</td>
                  <td className="py-1 pr-3">{e.municipality ?? ''} {e.ibgeCode}</td>
                  <td className="py-1 pr-3">{e.year} · {e.regime === 'reforma' ? 'Reforma' : 'atual'}{e.current ? '' : ' (substituído)'}</td>
                  <td className="num py-1 pr-3">{Object.entries(e.values.taxes ?? {}).map(([k, t]) => `${k} ${pct(Object.values(t).reduce<number>((s2, x) => s2 + (x ?? 0), 0))}%`).join(' · ') || '—'}</td>
                  <td className="num py-1 pr-3">{e.values.profitTaxBp == null ? '—' : `${pct(e.values.profitTaxBp)}%`}</td>
                  <td className="num py-1 pr-3">{Object.entries(e.values.retentions ?? {}).filter(([, x]) => x).map(([k, x]) => `${k} ${pct(x)}%`).join(' · ') || '—'}</td>
                  <td className="py-1 pr-3">{e.createdByName ?? '—'} · {fmtDateTime(e.createdAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      ) : <div className="mt-4"><Notice tone="info">Sem envelope publicado: a simulação usa os tributos dos documentos fiscais e o IR/CSLL dos parâmetros acima.</Notice></div>}
    </section>
  );
}
