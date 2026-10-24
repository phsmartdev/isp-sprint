/**
 * Aba principal da Inteligência: o painel dos indicadores (o mesmo da TV da diretoria),
 * a ficha de cada KPI, o lançamento do resultado e a importação das fichas (.xlsx).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Monitor, PenLine } from 'lucide-react';
import { INDICATOR_UNIT_LABELS, KPI_AGGREGATION_LABELS, type IndicatorDef } from '@isp/domain';
import { api } from '../../lib/api';
import { fileToBase64 } from '../../lib/files';
import { fmtDateTime } from '../../lib/format';
import { Button, ErrorState, FormField, Input, LoadingRows, Select, Textarea } from '../../components/ui/primitives';
import { Drawer, Modal, useToast } from '../../components/ui/overlay';
import { errMsg } from '../contracts/shared';
import { KpiCalc } from './KpiCalc';
import { KpiBoard, ST_LABEL, kpiText, monthName, useKpis, type KpiData, type KpiItem } from './KpiBoard';

export function KpiPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const year = new Date().getFullYear();
  const [y, setY] = useState(year);
  const q = useKpis(y);
  const [open, setOpen] = useState<KpiItem | null>(null);
  const [entry, setEntry] = useState<KpiItem | 'escolher' | null>(null);
  const [importing, setImporting] = useState(false);
  const demo = useMutation({
    mutationFn: (what: 'load' | 'clear') => api<{ cleared?: number; created?: number; entries?: number }>(what === 'load' ? '/intelligence/kpis/demo' : '/intelligence/kpis/demo/clear', { method: 'POST' }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['kpis'] }); toast({ tone: 'success', message: r.cleared !== undefined ? `${r.cleared} resultado(s) de demonstração retirado(s)` : `${r.created} ficha(s) e ${r.entries} resultado(s) de exemplo` }); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  if (q.isLoading) return <div className="card"><LoadingRows rows={8} /></div>;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const paused = d.items.filter((i) => i.def.sheet!.paused);
  const current = open ? d.items.find((i) => i.id === open.id) ?? open : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Ano" className="h-10 w-auto" value={String(y)} onChange={(e) => setY(Number(e.target.value))}>{[year - 1, year, year + 1].map((v) => <option key={v} value={v}>{v}</option>)}</Select>
        <p className="text-sm text-muted">Clique num indicador para ver a ficha e lançar o resultado.</p>
        <span className="flex-1" />
        {d.canEnter && d.items.length > 0 && <Button variant="outline" icon={<PenLine className="h-4 w-4" />} onClick={() => setEntry('escolher')}>Lançar resultado</Button>}
        {d.canImport && <Button variant="outline" icon={<FileUp className="h-4 w-4" />} onClick={() => setImporting(true)}>Importar fichas (.xlsx)</Button>}
        <a href="/painel/indicadores" target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover"><Monitor className="h-4 w-4" aria-hidden />Abrir painel da TV</a>
      </div>
      {d.demoEntries > 0 && (
        <div className="flex flex-wrap items-center gap-3 border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-[#9A4B07]">
          <span className="flex-1">Os resultados no painel são <b>fictícios, de demonstração</b> ({d.demoEntries} lançamento(s)). Ao lançar o resultado real de um período, ele substitui o de demonstração.</span>
          {d.canEnter && <Button size="sm" variant="outline" loading={demo.isPending} onClick={() => demo.mutate('clear')}>Tirar dados de demonstração</Button>}
        </div>
      )}
      {!d.items.length && d.canImport && (
        <div className="card flex flex-wrap items-center gap-3 p-4 text-sm"><span className="flex-1 text-text">Comece pelas fichas dos indicadores da área (com resultados de exemplo) ou importe o seu formulário .xlsx.</span><Button size="sm" variant="primary" loading={demo.isPending} onClick={() => demo.mutate('load')}>Carregar fichas com exemplo</Button></div>
      )}
      <KpiBoard d={d} updatedAt={q.dataUpdatedAt} error={q.isError} onOpen={setOpen} />
      {paused.length > 0 && (
        <section className="card p-4" aria-label="Indicadores pausados">
          <h3 className="text-sm font-bold text-ink">Pausados ({paused.length})</h3>
          <p className="text-xs text-muted">Têm ficha, mas ficam fora do painel e do placar.</p>
          <ul className="mt-2 flex flex-wrap gap-2">{paused.map((i) => <li key={i.id}><button type="button" className="border border-line px-3 py-1.5 text-sm text-text hover:bg-surface-2" onClick={() => setOpen(i)}>{i.def.name}</button></li>)}</ul>
        </section>
      )}
      {current && <KpiDrawer it={current} d={d} onClose={() => setOpen(null)} onEnter={() => setEntry(current)} />}
      {entry && <EntryDialog d={d} initial={entry === 'escolher' ? null : entry} onClose={() => setEntry(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return <div className="grid grid-cols-[150px_1fr] gap-3 border-b border-line py-2 text-sm last:border-0"><dt className="text-muted">{label}</dt><dd className="whitespace-pre-line text-text">{children}</dd></div>;
}

function KpiDrawer({ it, d, onClose, onEnter }: { it: KpiItem; d: KpiData; onClose: () => void; onEnter: () => void }) {
  const sh = it.def.sheet!;
  const hist = useQuery({ queryKey: ['kpi-entries', it.id], queryFn: () => api<{ items: { id: string; period: string; value: number; note: string | null; createdAt: string; supersededAt: string | null; by: string | null }[] }>(`/intelligence/kpis/${it.id}/entries`) });
  const u = it.def.unit;
  const limit = it.def.direction === 'menor' ? (sh.maxDesirable != null ? `Teto aceitável ${kpiText(sh.maxDesirable, u)}` : null) : sh.minOfTarget != null ? `Mínimo aceitável ${Math.round(sh.minOfTarget * 100)}% da meta` : sh.minAcceptable != null ? `Mínimo aceitável ${kpiText(sh.minAcceptable, u)}` : null;
  return (
    <Drawer open onClose={onClose} title={it.def.name} width="lg" footer={d.canEnter ? <Button variant="primary" icon={<PenLine className="h-4 w-4" />} onClick={onEnter}>Lançar resultado</Button> : undefined}>
      <div className="space-y-5">
        <section aria-label="Metas e resultados">
          <h3 className="mb-2 text-md font-bold text-ink">Metas de {d.year} e resultado</h3>
          <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm">
            <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 text-left font-medium">Período</th><th className="px-3 py-2 text-right font-medium">Meta</th><th className="px-3 py-2 text-right font-medium">Resultado</th><th className="px-3 py-2 text-left font-medium">Situação</th></tr></thead>
            <tbody>
              {it.quarters.map((q) => (
                <tr key={q.q} className="border-t border-line">
                  <td className="px-3 py-2 font-semibold text-ink">{q.q}º trimestre{q.months && <span className="block text-xs font-normal text-muted">{q.months.map((m) => `${monthName(m.period)} ${kpiText(m.value, u)}`).join(' · ')}</span>}</td>
                  <td className="num px-3 py-2 text-right">{it.def.direction === 'menor' ? '≤ ' : ''}{kpiText(q.target, u)}</td>
                  <td className="num px-3 py-2 text-right font-semibold">{kpiText(q.value, u)}</td>
                  <td className="px-3 py-2">{q.phase === 'futuro' ? <span className="text-muted">A começar</span> : ST_LABEL[q.status]}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line-strong bg-surface-2/60"><td className="px-3 py-2 font-bold text-ink">Ano</td><td className="num px-3 py-2 text-right font-semibold">{it.def.direction === 'menor' ? '≤ ' : ''}{kpiText(it.annual.target, u)}</td><td className="num px-3 py-2 text-right font-bold">{kpiText(it.annual.value, u)}</td><td className="px-3 py-2">{ST_LABEL[it.annual.status]}</td></tr>
            </tbody>
          </table></div>
          <p className="mt-2 text-xs text-muted">{[limit, `Trimestre e ano: ${KPI_AGGREGATION_LABELS[sh.aggregation].toLowerCase()}`, it.def.direction === 'menor' ? 'Quanto menor, melhor' : 'Quanto maior, melhor'].filter(Boolean).join(' · ')}</p>
        </section>
        <KpiCalc id={it.id} />
        <section aria-label="Ficha do indicador">
          <h3 className="mb-1 text-md font-bold text-ink">Ficha do indicador</h3>
          <dl>
            <Row label="Área">{sh.area}</Row>
            <Row label="Objetivo">{sh.objective}</Row>
            <Row label="Descrição">{it.def.description}</Row>
            <Row label="Fórmula">{sh.formulaText}</Row>
            <Row label="Unidade">{INDICATOR_UNIT_LABELS[u]}</Row>
            <Row label="Fonte na ficha original">{sh.sourceSystem}</Row>
            <Row label="Resultado no painel">{it.source === 'crm' ? 'Calculado do CRM (veja Como é calculado)' : 'Lançado na tela'}</Row>
            <Row label="Medição">{it.def.period === 'mes' ? 'Mensal' : 'Trimestral'}</Row>
            <Row label="Revisão">{sh.reviewFreq}</Row>
            <Row label="Responsável">{sh.owner}</Row>
            <Row label="Coleta dos dados">{sh.collector}</Row>
            <Row label="Objetivo estratégico">{sh.strategicObjective}</Row>
            <Row label="Processo">{sh.process}</Row>
            <Row label="Impacto esperado">{sh.impact}</Row>
            <Row label="KPIs relacionados">{sh.related}</Row>
            <Row label="Público do relatório">{sh.audience}</Row>
            <Row label="Início">{sh.startDate ? new Date(`${sh.startDate}T12:00:00Z`).toLocaleDateString('pt-BR') : null}</Row>
            <Row label="Observações">{sh.notes}</Row>
          </dl>
        </section>
        <section aria-label="Lançamentos">
          <h3 className="mb-1 text-md font-bold text-ink">Lançamentos</h3>
          {hist.isLoading ? <LoadingRows rows={2} /> : !hist.data?.items.length ? <p className="text-sm text-muted">Nenhum resultado lançado ainda.</p> : (
            <ul className="divide-y divide-line text-sm">{hist.data.items.map((e) => (
              <li key={e.id} className={e.supersededAt ? 'py-2 text-muted line-through decoration-faint' : 'py-2'}>
                <b className="num">{/^\d{4}-\d{2}$/.test(e.period) ? monthName(e.period) : e.period.replace('-T', ' · ') + 'º tri'}</b> · <span className="num">{kpiText(e.value, u)}</span>
                <span className="block text-xs text-muted">{e.by ?? '—'} em {fmtDateTime(e.createdAt)}{e.note ? ` · ${e.note}` : ''}{e.supersededAt ? ' · substituído' : ''}</span>
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function periodsFor(it: KpiItem, year: number, today: string) {
  const out: { value: string; label: string }[] = [];
  if (it.def.period === 'mes') for (let m = 1; m <= 12; m++) { const p = `${year}-${String(m).padStart(2, '0')}`; if (`${p}-01` <= today) out.push({ value: p, label: monthName(p) }); }
  else for (let q = 1; q <= 4; q++) { const start = `${year}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`; if (start <= today) out.push({ value: `${year}-T${q}`, label: `${q}º trimestre de ${year}` }); }
  return out.reverse();
}

function EntryDialog({ d, initial, onClose }: { d: KpiData; initial: KpiItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [id, setId] = useState(initial?.id ?? d.items.find((i) => !i.def.sheet!.paused)?.id ?? '');
  const it = d.items.find((i) => i.id === id) ?? null;
  const options = useMemo(() => (it ? periodsFor(it, d.year, d.today) : []), [it, d.year, d.today]);
  const [period, setPeriod] = useState('');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const per = period || options[0]?.value || '';
  const n = Number(value.replace(/\./g, '').replace(',', '.'));
  const save = useMutation({
    mutationFn: () => api(`/intelligence/kpis/${id}/entries`, { method: 'POST', body: { period: per, value: n, note: note.trim() || null } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['kpis'] }); void qc.invalidateQueries({ queryKey: ['kpi-entries', id] }); toast({ tone: 'success', message: 'Resultado lançado' }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const unit = it ? INDICATOR_UNIT_LABELS[it.def.unit] : '';
  return (
    <Modal open onClose={onClose} title="Lançar resultado" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={save.isPending} disabled={!id || !per || value.trim() === '' || !Number.isFinite(n)} onClick={() => save.mutate()}>Lançar resultado</Button></>}>
      <div className="space-y-3">
        <FormField label="Indicador" htmlFor="ke-kpi"><Select id="ke-kpi" value={id} onChange={(e) => { setId(e.target.value); setPeriod(''); }}>{d.items.map((i) => <option key={i.id} value={i.id}>{i.def.name}{i.def.sheet!.paused ? ' (pausado)' : ''}</option>)}</Select></FormField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={it?.def.period === 'trimestre' ? 'Trimestre' : 'Mês'} htmlFor="ke-period"><Select id="ke-period" value={per} onChange={(e) => setPeriod(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
          <FormField label={`Resultado (${unit})`} htmlFor="ke-value" hint={it?.def.unit === 'percentual' ? 'Ex.: 42,5 para 42,5%' : undefined}><Input id="ke-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.,-]/g, ''))} /></FormField>
        </div>
        <FormField label="Observação" htmlFor="ke-note" hint="Opcional. Se já houver resultado nesse período, este substitui e o anterior fica no histórico."><Textarea id="ke-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}

type Preview = { key: string; sheetName: string; def: IndicatorDef; warnings: string[]; action: 'criar' | 'atualizar' };
function ImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [items, setItems] = useState<Preview[] | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const read = useMutation({
    mutationFn: async (f: File) => api<{ items: Preview[] }>('/intelligence/kpis/import/preview', { method: 'POST', body: { filename: f.name, data: await fileToBase64(f) } }),
    onSuccess: (r) => { setItems(r.items); setSkip(new Set()); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const save = useMutation({
    mutationFn: () => api<{ created: number; updated: number }>('/intelligence/kpis/import', { method: 'POST', body: { items: items!.filter((i) => !skip.has(i.key)).map((i) => ({ key: i.key, def: i.def })) } }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['kpis'] }); toast({ tone: 'success', message: `${r.created} indicador(es) criado(s), ${r.updated} atualizado(s)` }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const patch = (key: string, p: Partial<IndicatorDef>, sp: Partial<NonNullable<IndicatorDef['sheet']>> = {}) => setItems(items!.map((i) => (i.key === key ? { ...i, def: { ...i.def, ...p, sheet: { ...i.def.sheet!, ...sp } } } : i)));
  return (
    <Modal open onClose={onClose} title="Importar fichas de KPI" size="xl" footer={<><Button onClick={onClose}>Cancelar</Button>{items && <Button variant="primary" loading={save.isPending} disabled={!items.some((i) => !skip.has(i.key))} onClick={() => save.mutate()}>Salvar {items.filter((i) => !skip.has(i.key)).length} indicador(es)</Button>}</>}>
      <div className="space-y-3">
        <p className="text-sm text-text">Envie o <b>Formulário de criação de indicadores (KPI)</b> em .xlsx, com uma aba por indicador. Abas com "Pausar" no nome entram como pausadas. Reimportar uma ficha cria uma nova versão do mesmo indicador.</p>
        <label className="inline-flex cursor-pointer items-center gap-2 border border-primary/60 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary-soft">
          <FileUp className="h-4 w-4" aria-hidden />{read.isPending ? 'Lendo…' : items ? 'Escolher outro arquivo' : 'Escolher arquivo .xlsx'}
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) read.mutate(f); e.target.value = ''; }} />
        </label>
        {items && (
          <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">Indicadores encontrados no arquivo</caption>
            <thead className="bg-surface-2 text-xs text-muted"><tr>{['', 'Indicador', 'Principal', 'Meta anual', '1T · 2T · 3T · 4T', 'Melhor quando', 'Medição', 'Situação'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>{items.map((i) => {
              const u = i.def.unit;
              return (
                <tr key={i.key} className="border-t border-line align-top">
                  <td className="px-3 py-2"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Importar ${i.def.name}`} checked={!skip.has(i.key)} onChange={(e) => { const n = new Set(skip); if (e.target.checked) n.delete(i.key); else n.add(i.key); setSkip(n); }} /></td>
                  <td className="px-3 py-2"><b className="text-ink">{i.def.name}</b><span className="block text-xs text-muted">{i.def.sheet!.area ?? '—'} · {i.action === 'criar' ? 'novo' : 'nova versão'}</span>{i.warnings.map((w) => <span key={w} className="block text-xs text-[#C2610C]">{w}</span>)}</td>
                  <td className="px-3 py-2"><input type="radio" name="kpi-main" className="h-4 w-4 accent-primary" aria-label={`${i.def.name} é o indicador principal`} checked={!!i.def.sheet!.main} onChange={() => setItems(items.map((x) => ({ ...x, def: { ...x.def, sheet: { ...x.def.sheet!, main: x.key === i.key } } })))} /></td>
                  <td className="num px-3 py-2">{kpiText(i.def.target ?? null, u)}</td>
                  <td className="num px-3 py-2">{i.def.sheet!.quarterTargets.map((t) => kpiText(t, u)).join(' · ')}</td>
                  <td className="px-3 py-2"><Select aria-label={`Sentido de ${i.def.name}`} className="h-9 w-auto" value={i.def.direction} onChange={(e) => patch(i.key, { direction: e.target.value as 'maior' | 'menor' })}><option value="maior">Maior</option><option value="menor">Menor</option></Select></td>
                  <td className="px-3 py-2">{i.def.period === 'mes' ? 'Mensal' : 'Trimestral'}</td>
                  <td className="px-3 py-2"><Select aria-label={`Situação de ${i.def.name}`} className="h-9 w-auto" value={i.def.sheet!.paused ? 'pausado' : 'ativo'} onChange={(e) => patch(i.key, {}, { paused: e.target.value === 'pausado' })}><option value="ativo">No painel</option><option value="pausado">Pausado</option></Select></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        {items && <p className="text-xs text-muted">Confira o sentido: em concentração e prazo, quanto menor, melhor. A régua e o farol do painel seguem essa escolha.</p>}
      </div>
    </Modal>
  );
}
