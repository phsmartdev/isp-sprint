/**
 * Configurações → Filiais e documentos fiscais (perfil da empresa): as filiais, os tipos fiscais que cada uma emite
 * (venda, prestação de serviço, aluguel) e, dentro de cada tipo, os documentos fiscais com os tributos que geram (base da viabilidade econômica).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { FISCAL_KINDS, FISCAL_KIND_LABELS, TAX_REGIMES, TAX_REGIME_LABELS, type FiscalKind, type TaxRegime } from '@isp/shared';
import { parseMoney } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { Button, Chip, ErrorState, Input, LoadingRows, Select, Tabs } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Row = { id: string | null; name: string; active: boolean; fiscalKinds: FiscalKind[]; cnpj: string | null; taxRegime: TaxRegime | null; city: string | null; state: string | null };
type Tax = { name: string; percent: string; fixed: string; active: boolean; validFrom: string; validTo: string };
type Doc = { key: string; id: string | null; fiscalKind: FiscalKind; code: string; name: string; active: boolean; taxes: Tax[]; version?: number | null; versionAt?: string | null };
type SavedDoc = { id: string; branchId: string; fiscalKind: FiscalKind; code: string; name: string; active: boolean; version?: number | null; versionAt?: string | null; taxesYear?: number | null; taxes: { name: string; percentBp: number; fixedCents: number; active: boolean; validFrom?: string | null; validTo?: string | null }[] };

let seq = 0;
const PLACEHOLDER: Record<FiscalKind, { code: string; name: string }> = { venda: { code: 'NF-e', name: 'Nota fiscal de venda' }, servico: { code: 'NFS-e', name: 'Nota fiscal de serviço' }, locacao: { code: 'FAT-LOC', name: 'Fatura de locação' } };
const fromSaved = (d: SavedDoc): Doc => ({
  key: `d${++seq}`, id: d.id, fiscalKind: d.fiscalKind, code: d.code, name: d.name, active: d.active, version: d.version ?? null, versionAt: d.versionAt ?? null,
  taxes: d.taxes.map((t) => ({ name: t.name, percent: t.percentBp ? (t.percentBp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '', fixed: t.fixedCents ? (t.fixedCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', active: t.active, validFrom: t.validFrom ?? '', validTo: t.validTo ?? '' })),
});
const toBody = (d: Doc) => ({
  id: d.id, fiscalKind: d.fiscalKind, code: d.code.trim(), name: d.name.trim(), active: d.active,
  taxes: d.taxes.filter((t) => t.name.trim()).map((t) => ({ name: t.name.trim(), percentBp: Math.round(Number((t.percent || '0').replace(',', '.')) * 100), fixedCents: parseMoney(t.fixed) ?? 0, active: t.active, validFrom: t.validFrom || null, validTo: t.validTo || null })),
});
const docRate = (d: Doc) => {
  const live = d.taxes.filter((t) => t.active && t.name.trim());
  const pct = live.reduce((s, t) => s + (Number((t.percent || '0').replace(',', '.')) || 0), 0);
  const fixed = live.reduce((s, t) => s + (parseMoney(t.fixed) ?? 0), 0);
  return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%${fixed ? ` + ${fmtBRL(fixed)}` : ''}`;
};

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => THIS_YEAR - 1 + i);
const bpText = (v: number | null | undefined) => (v == null ? '' : (v / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const textBp = (s: string) => (s.trim() === '' ? null : Math.round(Number(s.replace(',', '.')) * 100));

type EnvelopeResp = {
  year: number; regimeLabel: string; retentions: { key: string; label: string }[];
  current: { id: string; year: number; values: { profitTaxBp: number | null; retentions?: Record<string, number>; note?: string | null }; createdAt: string; createdByName: string | null; inherited: boolean } | null;
};

/** DRE e retenções na fonte da empresa no ano (envelope temporal): a alíquota efetiva sobre o lucro entra na DRE e no target seeking; as retenções só informam. */
function BranchEnvelope({ branch, year }: { branch: Row & { id: string }; year: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'fiscal-envelope', branch.id, year], queryFn: () => api<EnvelopeResp>(`/admin/fiscal-docs/${branch.id}/envelope?year=${year}`) });
  const [profit, setProfit] = useState('');
  const [ret, setRet] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  useEffect(() => {
    const v = q.data?.current?.values;
    setProfit(bpText(v?.profitTaxBp));
    setRet(Object.fromEntries(Object.entries(v?.retentions ?? {}).map(([k, x]) => [k, bpText(x)])));
    setNote(q.data?.current && !q.data.current.inherited ? q.data.current.values.note ?? '' : '');
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api(`/admin/fiscal-docs/${branch.id}/envelope`, { method: 'POST', body: { year, profitTaxBp: textBp(profit), retentions: Object.fromEntries(Object.entries(ret).map(([k, v]) => [k, textBp(v)])), note: note.trim() || null } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'fiscal-envelope', branch.id] }); toast({ tone: 'success', message: `${branch.name}: DRE e retenções de ${year} salvas` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const cur = q.data?.current;
  return (
    <section aria-label={`DRE e retenções na fonte de ${branch.name}`} className="border border-line p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-ink">DRE e retenções na fonte</h3>
        {q.data && <Chip tone="blue">Vigência {year} · {q.data.regimeLabel}</Chip>}
      </div>
      {q.isLoading ? <LoadingRows rows={2} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="bg-surface-2 p-3">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-1 text-left font-medium">Item</th><th className="py-1 text-left font-medium">Alíquota %</th><th className="py-1 text-left font-medium">Onde entra</th></tr></thead>
            <tbody>
              <tr className="border-t border-line">
                <td className="py-1 pr-2">Alíquota efetiva sobre o lucro (IRPJ + CSLL)</td>
                <td className="py-1 pr-2"><Input aria-label="Alíquota efetiva sobre o lucro" inputMode="decimal" className="num h-8 w-[90px]" placeholder="0" value={profit} onChange={(e) => setProfit(e.target.value)} /></td>
                <td className="py-1 text-xs text-muted">DRE de viabilidade (meses 1 a D e D+1 a N) e target seeking</td>
              </tr>
              {(q.data?.retentions ?? []).map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="py-1 pr-2">{r.label}</td>
                  <td className="py-1 pr-2"><Input aria-label={`Retenção ${r.label}`} inputMode="decimal" className="num h-8 w-[90px]" placeholder="0" value={ret[r.key] ?? ''} onChange={(e) => setRet({ ...ret, [r.key]: e.target.value })} /></td>
                  <td className="py-1 text-xs text-muted">Retenção na fonte: informativa, não entra no preço nem na DRE</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Input aria-label="Observação da DRE e retenções" className="mt-2 h-9" placeholder="Observação (ex.: presunção do Lucro Presumido)" value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="mt-2 text-xs text-muted">
            {cur ? (cur.inherited ? `Sem cadastro para ${year}: mostrando ${cur.year} (vale até haver um de ${year}). Salve para criar a vigência ${year}.` : `Vigência ${year} salva em ${new Date(cur.createdAt).toLocaleString('pt-BR')}${cur.createdByName ? ` por ${cur.createdByName}` : ''}. Salvar de novo cria nova versão; a anterior fica no histórico.`) : `Sem DRE e retenções para ${year}: a viabilidade usa o IR/CSLL dos parâmetros de viabilidade.`}
          </p>
          <div className="mt-2 flex justify-end"><Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar DRE e retenções de {year}</Button></div>
        </div>
      )}
    </section>
  );
}

function BranchDocs({ branch }: { branch: Row & { id: string } }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [year, setYear] = useState(THIS_YEAR);
  const q = useQuery({ queryKey: ['admin', 'fiscal-docs', year], queryFn: () => api<{ items: SavedDoc[] }>(`/admin/fiscal-docs?year=${year}`) });
  const [docs, setDocs] = useState<Doc[] | null>(null);
  useEffect(() => { if (q.data) setDocs(q.data.items.filter((d) => d.branchId === branch.id).map(fromSaved)); }, [q.data, branch.id]);
  const savedYear = new Map((q.data?.items ?? []).map((d) => [d.id, d.taxesYear ?? null]));
  const kinds = branch.fiscalKinds.length ? branch.fiscalKinds : [...FISCAL_KINDS];
  const save = useMutation({
    mutationFn: () => api(`/admin/fiscal-docs/${branch.id}`, { method: 'PUT', body: { year, items: (docs ?? []).filter((d) => d.code.trim() || d.name.trim()).map(toBody) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'fiscal-docs'] }); void qc.invalidateQueries({ queryKey: ['fiscal-docs'] }); toast({ tone: 'success', message: `${branch.name}: documentos fiscais de ${year} salvos` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const yearSel = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">Vigência fiscal
        <Select aria-label="Ano de vigência fiscal" className="h-9 w-[110px]" value={String(year)} onChange={(e) => { setDocs(null); setYear(Number(e.target.value)); }}>
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </label>
      <span className="text-xs text-muted">Os tributos e a DRE abaixo valem para {year}{year >= 2027 ? ' (Reforma Tributária: CBS/IBS)' : ' (regime atual)'}. A oportunidade escolhe o ano no campo Vigência fiscal.</span>
    </div>
  );
  if (q.isLoading || !docs) return <div className="space-y-4">{yearSel}<LoadingRows rows={3} /></div>;
  const setDoc = (k: string, p: Partial<Doc>) => setDocs(docs.map((d) => (d.key === k ? { ...d, ...p } : d)));
  const setTax = (k: string, i: number, p: Partial<Tax>) => setDocs(docs.map((d) => (d.key === k ? { ...d, taxes: d.taxes.map((t, j) => (j === i ? { ...t, ...p } : t)) } : d)));
  return (
    <div className="space-y-5">
      {yearSel}
      {kinds.map((kind) => {
        const list = docs.filter((d) => d.fiscalKind === kind);
        return (
          <section key={kind} aria-label={`Documentos fiscais em ${FISCAL_KIND_LABELS[kind]}`} className="border border-line p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-ink">{FISCAL_KIND_LABELS[kind]}</h3>
              <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setDocs([...docs, { key: `d${++seq}`, id: null, fiscalKind: kind, code: '', name: '', active: true, taxes: [{ name: '', percent: '', fixed: '', active: true, validFrom: '', validTo: '' }] }])}>Novo documento</Button>
            </div>
            {!list.length && <p className="text-sm text-muted">Nenhum documento fiscal. Sem documento, os itens deste tipo entram na viabilidade sem tributos (com ressalva).</p>}
            <ul className="space-y-4">{list.map((d) => (
              <li key={d.key} className="bg-surface-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input aria-label="Código do documento" className="h-9 w-[120px] uppercase" placeholder={PLACEHOLDER[d.fiscalKind].code} value={d.code} onChange={(e) => setDoc(d.key, { code: e.target.value })} />
                  <Input aria-label="Nome do documento" className="h-9 min-w-[200px] flex-1" placeholder={PLACEHOLDER[d.fiscalKind].name} value={d.name} onChange={(e) => setDoc(d.key, { name: e.target.value })} />
                  <Chip tone="blue">Total {docRate(d)}</Chip>
                  {d.id && savedYear.get(d.id) !== year && <span className="text-xs text-warning">{savedYear.get(d.id) != null ? `mostrando os tributos de ${savedYear.get(d.id)}; salve para criar a vigência ${year}` : `sem tributos por ano: mostrando o cadastro base; salve para criar a vigência ${year}`}</span>}
                  {d.version != null && <span className="text-xs text-muted" title={d.versionAt ? `desde ${new Date(d.versionAt).toLocaleString('pt-BR')}` : undefined}>tributos v{d.version}</span>}
                  <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={d.active} onChange={(e) => setDoc(d.key, { active: e.target.checked })} />Ativo</label>
                </div>
                <table className="mt-2 w-full text-sm">
                  <thead className="text-xs text-muted"><tr><th className="py-1 text-left font-medium">Tributo</th><th className="py-1 text-left font-medium">Alíquota %</th><th className="py-1 text-left font-medium">Valor fixo (R$ por faturamento)</th><th className="py-1 text-left font-medium">Vigência</th><th className="py-1 text-left font-medium">Ativo</th><th /></tr></thead>
                  <tbody>{d.taxes.map((t, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="py-1 pr-2"><Input aria-label="Nome do tributo" className="h-8 min-w-[110px]" placeholder="ISS, PIS, COFINS, ICMS…" value={t.name} onChange={(e) => setTax(d.key, i, { name: e.target.value })} /></td>
                      <td className="py-1 pr-2"><Input aria-label={`Alíquota de ${t.name || 'tributo'}`} inputMode="decimal" className="num h-8 w-[90px]" placeholder="0" value={t.percent} onChange={(e) => setTax(d.key, i, { percent: e.target.value })} /></td>
                      <td className="py-1 pr-2"><Input aria-label={`Valor fixo de ${t.name || 'tributo'}`} inputMode="decimal" className="num h-8 w-[110px]" placeholder="0,00" value={t.fixed} onChange={(e) => setTax(d.key, i, { fixed: e.target.value })} /></td>
                      <td className="py-1 pr-2"><span className="flex flex-wrap items-center gap-1"><Input aria-label={`Início da vigência de ${t.name || 'tributo'}`} type="date" className="h-8 w-[140px]" value={t.validFrom} onChange={(e) => setTax(d.key, i, { validFrom: e.target.value })} /><span className="text-xs text-muted">a</span><Input aria-label={`Fim da vigência de ${t.name || 'tributo'}`} type="date" className="h-8 w-[140px]" value={t.validTo} onChange={(e) => setTax(d.key, i, { validTo: e.target.value })} /></span></td>
                      <td className="py-1 pr-2"><input type="checkbox" aria-label={`${t.name || 'Tributo'} ativo`} className="h-4 w-4 accent-primary" checked={t.active} onChange={(e) => setTax(d.key, i, { active: e.target.checked })} /></td>
                      <td className="py-1"><button type="button" className="p-1 text-muted hover:text-danger" aria-label={`Remover ${t.name || 'tributo'}`} onClick={() => setDoc(d.key, { taxes: d.taxes.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  ))}</tbody>
                </table>
                <Button size="sm" variant="ghost" className="mt-1" icon={<Plus className="h-4 w-4" />} onClick={() => setDoc(d.key, { taxes: [...d.taxes, { name: '', percent: '', fixed: '', active: true, validFrom: '', validTo: '' }] })}>Tributo</Button>
              </li>
            ))}</ul>
          </section>
        );
      })}
      <p className="text-xs text-muted">O código liga o documento ao produto: no cadastro do produto, escolha o código do documento padrão; na oportunidade, o item já vem com o documento da filial. Documento tirado da lista é só desativado (o histórico continua apontando para ele). Cada mudança nos tributos gera uma nova versão; o cálculo salvo guarda a versão que usou.</p>
      <div className="flex justify-end"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar documentos de {branch.name} ({year})</Button></div>
      <BranchEnvelope branch={branch} year={year} />
    </div>
  );
}

export function AdminSalesBranches() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'sales-branches'], queryFn: () => api<{ items: Row[] }>('/admin/sales-branches') });
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState('');
  useEffect(() => { if (q.data) setRows(q.data.items.map((r) => ({ id: r.id, name: r.name, active: r.active, fiscalKinds: r.fiscalKinds ?? [], cnpj: r.cnpj ? r.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : null, taxRegime: r.taxRegime ?? null, city: r.city ?? null, state: r.state ?? null }))); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/admin/sales-branches', { method: 'PUT', body: { items: rows.filter((r) => r.name.trim()) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'sales-branches'] }); void qc.invalidateQueries({ queryKey: ['lookups'] }); toast({ tone: 'success', message: 'Filiais salvas' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const saved = (q.data?.items ?? []).filter((r): r is Row & { id: string } => !!r.id);
  const current = saved.find((b) => b.id === tab) ?? saved[0];
  const patch = (i: number, v: Partial<Row>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const toggleKind = (i: number, k: FiscalKind, on: boolean) => setRows(rows.map((x, j) => (j === i ? { ...x, fiscalKinds: on ? [...x.fiscalKinds, k] : x.fiscalKinds.filter((y) => y !== k) } : x)));
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-ink">Filiais, tipos fiscais e documentos fiscais</h1><p className="text-sm text-muted">Cada filial é um emitente (CNPJ, regime tributário e município), diz quais tipos fiscais opera (venda, prestação de serviço, aluguel) e, em cada tipo, quais documentos fiscais emite e os tributos de cada um. Isso alimenta a viabilidade econômica das oportunidades.</p></div>
      <section className="card p-5" aria-label="Filiais">
        {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <>
            <ul className="divide-y divide-line">
              {rows.map((r, i) => (
                <li key={r.id ?? `novo-${i}`} className="space-y-2 py-3 first:pt-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <Input aria-label={`Nome da filial ${i + 1}`} className="max-w-sm flex-1" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={r.active} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} />Ativa</label>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_200px_minmax(0,1fr)_72px]" role="group" aria-label={`Emitente ${r.name || i + 1}`}>
                    <Input aria-label={`CNPJ da filial ${i + 1}`} placeholder="CNPJ" value={r.cnpj ?? ''} onChange={(e) => patch(i, { cnpj: e.target.value || null })} />
                    <Select aria-label={`Regime tributário da filial ${i + 1}`} value={r.taxRegime ?? ''} onChange={(e) => patch(i, { taxRegime: (e.target.value || null) as TaxRegime | null })}>
                      <option value="">Regime tributário</option>
                      {TAX_REGIMES.map((k) => <option key={k} value={k}>{TAX_REGIME_LABELS[k]}</option>)}
                    </Select>
                    <Input aria-label={`Município da filial ${i + 1}`} placeholder="Município" value={r.city ?? ''} onChange={(e) => patch(i, { city: e.target.value || null })} />
                    <Input aria-label={`UF da filial ${i + 1}`} placeholder="UF" maxLength={2} className="uppercase" value={r.state ?? ''} onChange={(e) => patch(i, { state: e.target.value.toUpperCase() || null })} />
                  </div>
                  <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <legend className="mb-1 text-xs font-semibold text-muted">Tipos fiscais {r.fiscalKinds.length ? '' : '(nenhum marcado = todos)'}</legend>
                    {FISCAL_KINDS.map((k) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" className="h-4 w-4 accent-primary" checked={r.fiscalKinds.includes(k)} onChange={(e) => toggleKind(i, k, e.target.checked)} />{FISCAL_KIND_LABELS[k]}</label>)}
                  </fieldset>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap justify-between gap-2">
              <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setRows([...rows, { id: null, name: '', active: true, fiscalKinds: [], cnpj: null, taxRegime: null, city: null, state: null }])}>Adicionar filial</Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar filiais</Button>
            </div>
          </>
        )}
      </section>
      {current && (
        <section className="card p-5" aria-label="Documentos fiscais">
          <h2 className="text-lg font-bold text-ink">Documentos fiscais</h2>
          <p className="mb-3 text-sm text-muted">Por filial e tipo fiscal. Os tipos aparecem conforme a filial opera (salve as filiais depois de mudar os tipos).</p>
          {saved.length > 1 && <Tabs label="Filial" className="mb-4" value={current.id} onChange={setTab} tabs={saved.map((b) => ({ key: b.id, label: b.name }))} />}
          <BranchDocs key={current.id} branch={current} />
        </section>
      )}
    </div>
  );
}
