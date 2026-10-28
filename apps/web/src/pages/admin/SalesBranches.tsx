/**
 * Configurações → Filiais da venda (perfil da empresa): as filiais, os tipos de venda que cada uma aceita e,
 * dentro de cada tipo, os documentos fiscais com os tributos que geram (base da viabilidade econômica).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { SALE_TYPE_KEYS, SALE_TYPE_LABELS, type SaleTypeKey } from '@isp/shared';
import { parseMoney } from '@isp/domain';
import { api } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { Button, Chip, ErrorState, Input, LoadingRows, Tabs } from '../../components/ui/primitives';
import { useToast } from '../../components/ui/overlay';
import { errMsg } from '../../features/contracts/shared';

type Row = { id: string | null; name: string; active: boolean; saleKinds: SaleTypeKey[] };
type Tax = { name: string; percent: string; fixed: string; active: boolean; validFrom: string; validTo: string };
type Doc = { key: string; id: string | null; saleKind: SaleTypeKey; code: string; name: string; active: boolean; taxes: Tax[] };
type SavedDoc = { id: string; branchId: string; saleKind: SaleTypeKey; code: string; name: string; active: boolean; taxes: { name: string; percentBp: number; fixedCents: number; active: boolean; validFrom?: string | null; validTo?: string | null }[] };

let seq = 0;
const fromSaved = (d: SavedDoc): Doc => ({
  key: `d${++seq}`, id: d.id, saleKind: d.saleKind, code: d.code, name: d.name, active: d.active,
  taxes: d.taxes.map((t) => ({ name: t.name, percent: t.percentBp ? (t.percentBp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '', fixed: t.fixedCents ? (t.fixedCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', active: t.active, validFrom: t.validFrom ?? '', validTo: t.validTo ?? '' })),
});
const toBody = (d: Doc) => ({
  id: d.id, saleKind: d.saleKind, code: d.code.trim(), name: d.name.trim(), active: d.active,
  taxes: d.taxes.filter((t) => t.name.trim()).map((t) => ({ name: t.name.trim(), percentBp: Math.round(Number((t.percent || '0').replace(',', '.')) * 100), fixedCents: parseMoney(t.fixed) ?? 0, active: t.active, validFrom: t.validFrom || null, validTo: t.validTo || null })),
});
const docRate = (d: Doc) => {
  const live = d.taxes.filter((t) => t.active && t.name.trim());
  const pct = live.reduce((s, t) => s + (Number((t.percent || '0').replace(',', '.')) || 0), 0);
  const fixed = live.reduce((s, t) => s + (parseMoney(t.fixed) ?? 0), 0);
  return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%${fixed ? ` + ${fmtBRL(fixed)}` : ''}`;
};

function BranchDocs({ branch }: { branch: Row & { id: string } }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'fiscal-docs'], queryFn: () => api<{ items: SavedDoc[] }>('/admin/fiscal-docs') });
  const [docs, setDocs] = useState<Doc[] | null>(null);
  useEffect(() => { if (q.data) setDocs(q.data.items.filter((d) => d.branchId === branch.id).map(fromSaved)); }, [q.data, branch.id]);
  const kinds = branch.saleKinds.length ? branch.saleKinds : [...SALE_TYPE_KEYS];
  const save = useMutation({
    mutationFn: () => api(`/admin/fiscal-docs/${branch.id}`, { method: 'PUT', body: { items: (docs ?? []).filter((d) => d.code.trim() || d.name.trim()).map(toBody) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'fiscal-docs'] }); void qc.invalidateQueries({ queryKey: ['fiscal-docs'] }); toast({ tone: 'success', message: `${branch.name}: documentos fiscais salvos` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading || !docs) return <LoadingRows rows={3} />;
  const setDoc = (k: string, p: Partial<Doc>) => setDocs(docs.map((d) => (d.key === k ? { ...d, ...p } : d)));
  const setTax = (k: string, i: number, p: Partial<Tax>) => setDocs(docs.map((d) => (d.key === k ? { ...d, taxes: d.taxes.map((t, j) => (j === i ? { ...t, ...p } : t)) } : d)));
  return (
    <div className="space-y-5">
      {kinds.map((kind) => {
        const list = docs.filter((d) => d.saleKind === kind);
        return (
          <section key={kind} aria-label={`Documentos fiscais em ${SALE_TYPE_LABELS[kind]}`} className="border border-line p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-ink">{SALE_TYPE_LABELS[kind]}</h3>
              <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setDocs([...docs, { key: `d${++seq}`, id: null, saleKind: kind, code: '', name: '', active: true, taxes: [{ name: '', percent: '', fixed: '', active: true, validFrom: '', validTo: '' }] }])}>Novo documento</Button>
            </div>
            {!list.length && <p className="text-sm text-muted">Nenhum documento fiscal. Sem documento, os itens desta venda entram na viabilidade sem tributos (com ressalva).</p>}
            <ul className="space-y-4">{list.map((d) => (
              <li key={d.key} className="bg-surface-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input aria-label="Código do documento" className="h-9 w-[120px] uppercase" placeholder="NFS-e" value={d.code} onChange={(e) => setDoc(d.key, { code: e.target.value })} />
                  <Input aria-label="Nome do documento" className="h-9 min-w-[200px] flex-1" placeholder="Nota fiscal de serviço" value={d.name} onChange={(e) => setDoc(d.key, { name: e.target.value })} />
                  <Chip tone="blue">Total {docRate(d)}</Chip>
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
      <p className="text-xs text-muted">O código liga o documento ao produto: no cadastro do produto, escolha o código do documento padrão; na oportunidade, o item já vem com o documento da filial e do tipo de venda. Documento tirado da lista é só desativado (o histórico continua apontando para ele).</p>
      <div className="flex justify-end"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar documentos de {branch.name}</Button></div>
    </div>
  );
}

export function AdminSalesBranches() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'sales-branches'], queryFn: () => api<{ items: Row[] }>('/admin/sales-branches') });
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState('');
  useEffect(() => { if (q.data) setRows(q.data.items.map((r) => ({ id: r.id, name: r.name, active: r.active, saleKinds: r.saleKinds ?? [] }))); }, [q.data]);
  const save = useMutation({
    mutationFn: () => api('/admin/sales-branches', { method: 'PUT', body: { items: rows.filter((r) => r.name.trim()) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'sales-branches'] }); void qc.invalidateQueries({ queryKey: ['lookups'] }); toast({ tone: 'success', message: 'Filiais salvas' }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const saved = (q.data?.items ?? []).filter((r): r is Row & { id: string } => !!r.id);
  const current = saved.find((b) => b.id === tab) ?? saved[0];
  const toggleKind = (i: number, k: SaleTypeKey, on: boolean) => setRows(rows.map((x, j) => (j === i ? { ...x, saleKinds: on ? [...x.saleKinds, k] : x.saleKinds.filter((y) => y !== k) } : x)));
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-ink">Filiais, tipos de venda e documentos fiscais</h1><p className="text-sm text-muted">Cada filial diz quais tipos de venda aceita e, em cada tipo, quais documentos fiscais emite e os tributos de cada um. Isso alimenta a viabilidade econômica das oportunidades.</p></div>
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
                  <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <legend className="mb-1 text-xs font-semibold text-muted">Tipos de venda aceitos {r.saleKinds.length ? '' : '(nenhum marcado = todos)'}</legend>
                    {SALE_TYPE_KEYS.map((k) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" className="h-4 w-4 accent-primary" checked={r.saleKinds.includes(k)} onChange={(e) => toggleKind(i, k, e.target.checked)} />{SALE_TYPE_LABELS[k]}</label>)}
                  </fieldset>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap justify-between gap-2">
              <Button variant="outline" icon={<Plus className="h-4 w-4" />} onClick={() => setRows([...rows, { id: null, name: '', active: true, saleKinds: [] }])}>Adicionar filial</Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Salvar filiais</Button>
            </div>
          </>
        )}
      </section>
      {current && (
        <section className="card p-5" aria-label="Documentos fiscais">
          <h2 className="text-lg font-bold text-ink">Documentos fiscais</h2>
          <p className="mb-3 text-sm text-muted">Por filial e tipo de venda. Os tipos aparecem conforme a filial aceita (salve as filiais depois de mudar os tipos).</p>
          {saved.length > 1 && <Tabs label="Filial" className="mb-4" value={current.id} onChange={setTab} tabs={saved.map((b) => ({ key: b.id, label: b.name }))} />}
          <BranchDocs key={current.id} branch={current} />
        </section>
      )}
    </div>
  );
}
