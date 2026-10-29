/**
 * Controle de Empenhos — fase 2: projeções (PF07), reajuste com demonstrativo e retroativo (PF08), virada de exercício
 * guiada (RN10), regras do contrato (fontes de receita e rateio, RN09; parâmetros dos alertas, PF06) e aditivo de item.
 */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarClock, Plus, TrendingUp } from 'lucide-react';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Button, Chip, EmptyState, FormField, Input, Notice, Select, Textarea } from '../../components/ui/primitives';
import { Modal, useToast } from '../../components/ui/overlay';
import { LineChart } from '../../components/charts/charts';
import { errMsg } from './shared';
import { downloadCsv, money, monthLabel, monthShort, parseNum, price, qty, useRefresh, type Data, type Line, type Pendencia } from './commitmentShared';

const compact = (v4: number) => {
  const v = v4 / 10_000;
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
};
const CURVE = { contracted: '#677680', committed: '#3885D3', executed: '#F59E0B', invoiced: '#16A34A' };

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'danger' | 'warn' }) {
  return (
    <div className="border border-line p-3">
      <dt className="text-xs font-semibold uppercase text-muted">{label}</dt>
      <dd className={clsx('num mt-0.5 text-xl font-bold', tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-[#C2610C]' : 'text-ink')}>{value}</dd>
      <dd className="mt-0.5 text-xs text-muted">{hint}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ projeções (PF07)
const STATUS_LABEL = { esgota_antes: 'Acaba antes do fim', sobra: 'Vai sobrar', ok: 'No ritmo', sem_base: 'Sem média mensal' } as const;
const STATUS_TONE = { esgota_antes: 'red', sobra: 'yellow', ok: 'green', sem_base: 'neutral' } as const;
const BASIS_LABEL = { media: 'Média das medições mensais', franquia: 'Franquia cadastrada', sem_base: 'Sob demanda' } as const;

export function ProjectionsTab({ d, contractId }: { d: Data; contractId: string }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const p = d.projection;
  const lineOf = (id: string) => d.lines.find((l) => l.id === id)!;
  const setWindow = useMutation({ mutationFn: (n: number) => api(`/contracts/${contractId}/commitment-control/settings`, { method: 'POST', body: { windowMonths: n } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Janela da média alterada' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const order = { esgota_antes: 0, sobra: 1, ok: 2, sem_base: 3 };
  const lines = [...p.lines].sort((a, b) => order[a.status] - order[b.status] || a.itemNumber.localeCompare(b.itemNumber, 'pt-BR', { numeric: true }));
  const exhaust = p.lines.filter((x) => x.status === 'esgota_antes').length;
  const curve = d.curve;
  const [allItems, setAllItems] = useState(false);
  const noBasis = lines.filter((x) => x.status === 'sem_base').length;
  const shownLines = allItems ? lines : lines.filter((x) => x.status !== 'sem_base');
  return (
    <div className="space-y-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-text">Projeção pelo consumo médio das medições <b>mensais</b> dos últimos {p.window.months} meses ({monthShort(p.window.from)} a {monthShort(p.window.to)}). Medições avulsas não entram na média. Projeção a partir de {monthLabel(p.from)}.</p>
        {d.canManage && <label className="flex items-center gap-2 text-xs text-muted">Média dos últimos<Select aria-label="Meses da média" className="h-8 w-20" value={String(d.settings.windowMonths)} onChange={(e) => setWindow.mutate(Number(e.target.value))}>{[3, 6, 12].map((n) => <option key={n} value={n}>{n}</option>)}</Select>meses</label>}
      </div>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Acabam antes do fim" value={`${exhaust} item(ns)`} hint={exhaust ? `Faltam ${money(p.shortV4)} até o fim da vigência: avalie aditivo` : 'Nenhum item esgota antes do fim'} tone={exhaust ? 'danger' : undefined} />
        <Stat label="Sobra no fim da vigência" value={money(p.leftoverV4)} hint="Subexecução prevista (informação para renegociar ou renovar)" tone={p.leftoverV4 > 0 ? 'warn' : undefined} />
        <Stat label="A faturar agora" value={money(p.toInvoiceV4)} hint="Medido e ainda sem nota fiscal" tone={p.toInvoiceV4 > 0 ? 'warn' : undefined} />
        <Stat label="Na pipeline" value={money(p.pipelineV4)} hint="Reservado por oportunidades em andamento" />
      </dl>

      {curve.length > 1 && (
        <section aria-labelledby="pj-curve">
          <h3 id="pj-curve" className="mb-1 text-sm font-bold text-ink">Contratado × empenhado × executado × faturado</h3>
          <p className="mb-2 text-xs text-muted">A distância entre as linhas é onde mora o risco: executado acima do empenhado é consumo sem cobertura; executado acima do faturado é dinheiro a receber.</p>
          <LineChart ariaLabel="Curva acumulada do contrato" categories={curve.map((c) => monthShort(c.competence))} tooltipTitle={(i) => monthLabel(curve[i]!.competence)} format={compact}
            series={[
              { key: 'ct', label: 'Contratado', color: CURVE.contracted, values: curve.map((c) => c.contractedV4), dashed: true },
              { key: 'em', label: 'Empenhado', color: CURVE.committed, values: curve.map((c) => c.committedV4) },
              { key: 'ex', label: 'Executado', color: CURVE.executed, values: curve.map((c) => c.executedV4) },
              { key: 'fa', label: 'Faturado', color: CURVE.invoiced, values: curve.map((c) => c.invoicedV4) },
            ]} />
          <ul className="mt-1 flex flex-wrap gap-4 text-xs text-text">{[['Contratado', CURVE.contracted], ['Empenhado', CURVE.committed], ['Executado', CURVE.executed], ['Faturado', CURVE.invoiced]].map(([l, c]) => <li key={l} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} aria-hidden />{l}</li>)}</ul>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <section aria-labelledby="pj-years">
          <h3 id="pj-years" className="mb-1 text-sm font-bold text-ink">Empenho necessário por exercício</h3>
          <p className="mb-2 text-xs text-muted">Empenho só vale no seu ano (RN10): cada exercício da vigência precisa de NE própria, inclusive o segundo empenho parcial de contrato iniciado no meio do ano.</p>
          {!p.years.length ? <p className="text-sm text-muted">Sem data de fim da vigência no contrato.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1">Exercício</th><th className="py-1 text-right">Meses</th><th className="py-1 text-right">Consumo previsto</th><th className="py-1 text-right">Já empenhado</th><th className="py-1 text-right">A empenhar</th></tr></thead>
              <tbody>{p.years.map((y) => (
                <tr key={y.year} className="border-t border-line">
                  <td className="py-1.5 font-semibold">{y.year}</td><td className="num py-1.5 text-right">{y.months}</td>
                  <td className="num py-1.5 text-right">{money(y.projectedV4)}</td><td className="num py-1.5 text-right">{money(y.coveredV4)}</td>
                  <td className={clsx('num py-1.5 text-right font-semibold', y.needV4 > 0 ? 'text-[#C2610C]' : 'text-muted')}>{money(y.needV4)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {p.noBasisV4 > 0 && <p className="mt-2 text-xs text-muted">Além disso, {money(p.noBasisV4)} de itens sob demanda (instalações, migrações) sem média mensal: empenhe conforme os pedidos.</p>}
        </section>
        <section aria-labelledby="pj-fc">
          <h3 id="pj-fc" className="mb-1 text-sm font-bold text-ink">Previsão de faturamento</h3>
          <p className="mb-2 text-xs text-muted">Recorrentes pela média (ou franquia), até o saldo do item acabar. Para o fluxo de caixa do financeiro.</p>
          <table className="w-full text-sm">
            <tbody>
              {p.toInvoiceV4 > 0 && <tr className="border-b border-line"><td className="py-1.5">Já executado, aguardando nota</td><td className="num py-1.5 text-right font-semibold text-[#C2610C]">{money(p.toInvoiceV4)}</td></tr>}
              {p.forecast.map((f) => <tr key={f.competence} className="border-b border-line"><td className="py-1.5 capitalize">{monthLabel(f.competence)}</td><td className="num py-1.5 text-right">{money(f.recurringV4)}</td></tr>)}
              {p.pipelineV4 > 0 && <tr><td className="py-1.5 text-muted">Pipeline (sem data prevista)</td><td className="num py-1.5 text-right text-[#7C3AED]">{money(p.pipelineV4)}</td></tr>}
            </tbody>
          </table>
        </section>
      </div>

      {!!p.commitments.length && (
        <section aria-labelledby="pj-ne">
          <h3 id="pj-ne" className="mb-1 text-sm font-bold text-ink">Até quando os empenhos do ano cobrem</h3>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{p.commitments.map((c) => (
            <li key={c.commitmentId} className={clsx('flex items-center justify-between gap-2 border px-3 py-2 text-sm', c.shortBeforeYearEnd ? 'border-danger/40 bg-danger-soft/40' : 'border-line')}>
              <span className="font-semibold">{c.number}</span>
              <span>{c.coversUntil ? <>cobre até <b className="capitalize">{monthLabel(c.coversUntil)}</b></> : 'sem item com média'}</span>
            </li>
          ))}</ul>
        </section>
      )}

      <section aria-labelledby="pj-items">
        <h3 id="pj-items" className="mb-1 text-sm font-bold text-ink">Por item</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold text-muted">
              <th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5">Especificação</th><th className="px-2 py-1.5">Base</th><th className="px-2 py-1.5 text-right">Consumo/mês</th><th className="px-2 py-1.5 text-right">Avulso/mês</th><th className="px-2 py-1.5 text-right">Saldo</th><th className="px-2 py-1.5">Acaba em</th><th className="px-2 py-1.5 text-right">No fim da vigência</th><th className="px-2 py-1.5">Situação</th>
            </tr></thead>
            <tbody>{shownLines.map((x) => { const l = lineOf(x.lineId); return (
              <tr key={x.lineId} className="border-b border-line last:border-0">
                <td className="px-2 py-1.5 font-semibold">{x.itemNumber}</td>
                <td className="max-w-[280px] px-2 py-1.5"><span className="line-clamp-1" title={l.description}>{l.description}</span></td>
                <td className="px-2 py-1.5 text-xs text-muted">{BASIS_LABEL[x.basis]}</td>
                <td className="num px-2 py-1.5 text-right">{x.rate4 ? `${qty(x.rate4)} ${l.unit}` : '—'}</td>
                <td className="num px-2 py-1.5 text-right text-muted">{x.avgAvulso4 ? qty(x.avgAvulso4) : '—'}</td>
                <td className="num px-2 py-1.5 text-right">{qty(x.remaining4)}</td>
                <td className="px-2 py-1.5 capitalize">{x.exhaustCompetence ? monthLabel(x.exhaustCompetence) : '—'}</td>
                <td className={clsx('num px-2 py-1.5 text-right', x.leftoverAtEnd4 != null && x.leftoverAtEnd4 < 0 && 'font-semibold text-danger')}>{x.leftoverAtEnd4 == null ? '—' : x.leftoverAtEnd4 < 0 ? `falta ${qty(-x.leftoverAtEnd4)}` : `sobra ${qty(x.leftoverAtEnd4)}`}</td>
                <td className="px-2 py-1.5"><Chip tone={STATUS_TONE[x.status]}>{STATUS_LABEL[x.status]}</Chip></td>
              </tr>
            ); })}</tbody>
          </table>
        </div>
        {noBasis > 0 && <button type="button" className="mt-2 text-xs font-semibold text-primary hover:underline" onClick={() => setAllItems(!allItems)}>{allItems ? 'Esconder' : 'Mostrar'} {noBasis} item(ns) sob demanda, sem média mensal</button>}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ reajustes (PF08)
export function AdjustmentsTab({ d, contractId }: { d: Data; contractId: string }) {
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState<string | null>(d.adjustments.at(-1)?.id ?? null);
  const lineOf = (id: string) => d.lines.find((l) => l.id === id);
  const mOf = (id: string) => d.measurements.find((m) => m.id === id);
  const exportDemo = (a: Data['adjustments'][number]) => downloadCsv(`reajuste-${a.indexName}-${a.startCompetence}.csv`, [
    ['Demonstrativo de reajuste', `${a.indexName} ${a.inputText}${a.mode === 'percentual' ? '%' : ''}`, `a partir de ${a.startCompetence}`, `data-base ${a.baseDate}`],
    [],
    ['Item', 'Especificação', 'Unidade', 'Preço anterior', 'Preço reajustado', 'Diferença'],
    ...a.prices.map((p) => { const l = lineOf(p.lineId); return [l?.itemNumber ?? '', l?.description ?? '', l?.unit ?? '', p.previousPrice4 / 10_000, p.price4 / 10_000, (p.price4 - p.previousPrice4) / 10_000]; }),
    [],
    ['Retroativo por medição faturada'],
    ['Medição', 'Competência', 'Item', 'Qtde', 'Preço faturado', 'Preço reajustado', 'Diferença (R$)', 'Situação', 'NF complementar'],
    ...a.retros.flatMap((r) => r.items.map((i) => [mOf(r.measurementId)?.title ?? '', mOf(r.measurementId)?.competence ?? '', lineOf(i.lineId)?.itemNumber ?? '', i.qty4 / 10_000, i.oldPrice4 / 10_000, i.newPrice4 / 10_000, i.diffV4 / 10_000, r.status === 'faturado' ? 'Faturado' : 'A faturar', r.invoiceNumber])),
  ]);
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted">O reajuste gera a nova tabela de preços (a anterior fica no histórico), as medições ainda não faturadas passam ao preço novo e o que já foi faturado vira retroativo a cobrar em NF complementar.</p>
        {d.canManage && <Button size="sm" variant="primary" icon={<TrendingUp className="h-4 w-4" />} onClick={() => setOpen(true)}>Registrar reajuste</Button>}
      </div>
      {!d.adjustments.length ? <EmptyState title="Nenhum reajuste" description="Quando sair o índice (IPCA, IST…), registre aqui com a data-base e a competência de início." /> : (
        <ul className="space-y-3">{[...d.adjustments].reverse().map((a) => {
          const pend = a.retros.filter((r) => r.status === 'pendente').reduce((s, r) => s + r.diffV4, 0);
          const total = a.retros.reduce((s, r) => s + r.diffV4, 0);
          return (
            <li key={a.id} className="border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-ink">{a.indexName} · {a.pct >= 0 ? '+' : ''}{a.pct.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%</p>
                  <p className="text-xs text-muted">A partir de {monthLabel(a.startCompetence)} · data-base {fmtDate(a.baseDate)} · registrado em {fmtDateTime(a.createdAt)}{a.note ? ` · ${a.note}` : ''}</p>
                </div>
                <div className="text-right text-sm">
                  <p>Retroativo: <b className="num">{money(total)}</b></p>
                  {pend > 0 ? <Chip tone="yellow">{money(pend)} a faturar</Chip> : total > 0 ? <Chip tone="green">Faturado</Chip> : <Chip>Sem retroativo</Chip>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setShow(show === a.id ? null : a.id)}>{show === a.id ? 'Esconder demonstrativo' : 'Ver demonstrativo'}</button>
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => exportDemo(a)}>Exportar demonstrativo (planilha)</button>
                {!!a.repriced.length && <span className="text-muted">{a.repriced.length} item(ns) de medição em aberto passaram ao preço novo</span>}
              </div>
              {show === a.id && (
                <div className="mt-3 grid gap-4 xl:grid-cols-2">
                  <div className="max-h-80 overflow-auto border border-line">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted"><tr><th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5 text-right">Anterior</th><th className="px-2 py-1.5 text-right">Reajustado</th></tr></thead>
                      <tbody>{a.prices.map((p) => <tr key={p.id} className="border-t border-line"><td className="px-2 py-1.5"><b>{lineOf(p.lineId)?.itemNumber}</b> <span className="text-muted">{lineOf(p.lineId)?.description.slice(0, 50)}</span></td><td className="num px-2 py-1.5 text-right">{price(p.previousPrice4)}</td><td className="num px-2 py-1.5 text-right font-semibold">{price(p.price4)}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <div className="max-h-80 overflow-auto border border-line">
                    {!a.retros.length ? <p className="p-3 text-sm text-muted">Nenhuma medição faturada a partir de {monthLabel(a.startCompetence)}: sem retroativo.</p> : (
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted"><tr><th className="px-2 py-1.5">Medição faturada</th><th className="px-2 py-1.5 text-right">Retroativo</th><th className="px-2 py-1.5">Situação</th></tr></thead>
                        <tbody>{a.retros.map((r) => <tr key={r.id} className="border-t border-line"><td className="px-2 py-1.5">{mOf(r.measurementId)?.title}<span className="block text-2xs text-muted">{r.items.length} item(ns) · {monthLabel(mOf(r.measurementId)?.competence ?? a.startCompetence)}</span></td><td className="num px-2 py-1.5 text-right font-semibold">{money(r.diffV4)}</td><td className="px-2 py-1.5">{r.status === 'faturado' ? <Chip tone="green">NF {r.invoiceNumber}</Chip> : <Chip tone="yellow">A faturar</Chip>}</td></tr>)}</tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}</ul>
      )}
      {open && <AdjustmentModal d={d} contractId={contractId} onClose={() => setOpen(false)} />}
    </div>
  );
}

type Preview = { pct: number; table: { lineId: string; oldPrice4: number; newPrice4: number }[]; retro: { measurementId: string; title: string; competence: string; diffV4: number }[]; repriced: number; retroTotalV4: number };
function AdjustmentModal({ d, contractId, onClose }: { d: Data; contractId: string; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const last = d.adjustments.at(-1);
  const [v, setV] = useState({ indexName: 'IPCA', mode: 'percentual' as 'percentual' | 'fator', index: '', baseDate: d.contract.startAt ?? d.today, startCompetence: d.today.slice(0, 7), note: '' });
  const [pv, setPv] = useState<{ key: string; data: Preview } | null>(null);
  const key = JSON.stringify({ ...v, note: '' });
  const body = { indexName: v.indexName.trim(), mode: v.mode, index: v.index.trim(), baseDate: v.baseDate, startCompetence: v.startCompetence };
  const preview = useMutation({ mutationFn: () => api<Preview>(`/contracts/${contractId}/commitment-control/adjustments/preview`, { method: 'POST', body }), onSuccess: (r) => setPv({ key, data: r }), onError: (e) => { setPv(null); toast({ tone: 'error', message: errMsg(e) }); } });
  const save = useMutation({ mutationFn: () => api<{ retroTotalV4: number }>(`/contracts/${contractId}/commitment-control/adjustments`, { method: 'POST', body: { ...body, note: v.note.trim() || null } }), onSuccess: (r) => { refresh(); toast({ tone: 'success', message: r.retroTotalV4 ? `Reajuste registrado. ${money(r.retroTotalV4)} de retroativo foram para Pendências.` : 'Reajuste registrado' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const ready = pv && pv.key === key;
  const lineOf = (id: string) => d.lines.find((l) => l.id === id);
  const sum = (k: 'oldPrice4' | 'newPrice4') => (pv?.data.table ?? []).reduce((a, t) => { const l = lineOf(t.lineId); return a + (l ? Math.round(((l.balance.contracted4 - l.balance.executed4 - l.balance.pending4) * t[k]) / 10_000) : 0); }, 0);
  return (
    <Modal open onClose={onClose} size="xl" title="Registrar reajuste"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button disabled={!v.index.trim() || !v.indexName.trim()} loading={preview.isPending} onClick={() => preview.mutate()}>Simular</Button><Button variant="primary" disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>Registrar reajuste</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Índice" htmlFor="aj-n" hint="Ex.: IPCA, IST, INPC"><Input id="aj-n" value={v.indexName} onChange={(e) => setV({ ...v, indexName: e.target.value })} /></FormField>
        <FormField label="Como veio o índice" htmlFor="aj-m"><Select id="aj-m" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as typeof v.mode })}><option value="percentual">Percentual (ex.: 4,3215%)</option><option value="fator">Fator (ex.: 1,0432)</option></Select></FormField>
        <FormField label={v.mode === 'percentual' ? 'Percentual (%)' : 'Fator'} htmlFor="aj-i" hint="Até 4 casas decimais"><Input id="aj-i" inputMode="decimal" value={v.index} onChange={(e) => setV({ ...v, index: e.target.value })} placeholder={v.mode === 'percentual' ? '4,3215' : '1,0432'} /></FormField>
        <FormField label="Data-base" htmlFor="aj-b"><Input id="aj-b" type="date" value={v.baseDate} onChange={(e) => setV({ ...v, baseDate: e.target.value })} /></FormField>
        <FormField label="Vale a partir da competência" htmlFor="aj-s" hint={last ? `Depois de ${monthShort(last.startCompetence)} (último reajuste)` : 'Medições desta competência em diante usam o preço novo'}><Input id="aj-s" type="month" value={v.startCompetence} onChange={(e) => setV({ ...v, startCompetence: e.target.value })} /></FormField>
        <FormField label="Observação" htmlFor="aj-o" hint="Ex.: nº do apostilamento"><Input id="aj-o" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></FormField>
      </div>
      {!ready ? <p className="mt-3 text-sm text-muted">Clique em <b>Simular</b> para ver a tabela reajustada e o retroativo antes de registrar.</p> : (
        <div className="mt-4 space-y-3">
          <Notice tone="info">{pv.data.pct >= 0 ? '+' : ''}{pv.data.pct.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}% em {pv.data.table.length} item(ns). Saldo do contrato: {money(sum('oldPrice4'))} → <b>{money(sum('newPrice4'))}</b>. {pv.data.repriced ? `${pv.data.repriced} item(ns) de medições em aberto passam ao preço novo. ` : ''}{pv.data.retroTotalV4 ? `Retroativo de ${money(pv.data.retroTotalV4)} em ${pv.data.retro.length} medição(ões) faturada(s).` : 'Sem retroativo.'}</Notice>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="max-h-64 overflow-auto border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted"><tr><th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5 text-right">Anterior</th><th className="px-2 py-1.5 text-right">Reajustado</th></tr></thead>
                <tbody>{pv.data.table.map((t) => <tr key={t.lineId} className="border-t border-line"><td className="px-2 py-1.5"><b>{lineOf(t.lineId)?.itemNumber}</b> <span className="text-muted">{lineOf(t.lineId)?.description.slice(0, 40)}</span></td><td className="num px-2 py-1.5 text-right">{price(t.oldPrice4)}</td><td className="num px-2 py-1.5 text-right font-semibold">{price(t.newPrice4)}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="max-h-64 overflow-auto border border-line">
              {!pv.data.retro.length ? <p className="p-3 text-sm text-muted">Nenhuma medição faturada a partir de {monthLabel(v.startCompetence)}.</p> : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted"><tr><th className="px-2 py-1.5">Medição faturada</th><th className="px-2 py-1.5 text-right">Retroativo</th></tr></thead>
                  <tbody>{pv.data.retro.map((r) => <tr key={r.measurementId} className="border-t border-line"><td className="px-2 py-1.5">{r.title}<span className="block text-2xs capitalize text-muted">{monthLabel(r.competence)}</span></td><td className="num px-2 py-1.5 text-right font-semibold">{money(r.diffV4)}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Retroativos selecionados nas pendências → uma NF complementar. */
export function RetroInvoiceModal({ contractId, items, onClose }: { contractId: string; items: Pendencia[]; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const total = items.reduce((a, p) => a + p.valueV4, 0);
  const [v, setV] = useState({ invoiceNumber: '', invoiceDate: new Date().toISOString().slice(0, 10), value: (Math.round(total / 100) / 100).toFixed(2).replace('.', ',') });
  const save = useMutation({ mutationFn: () => api(`/contracts/${contractId}/commitment-control/retros/invoice`, { method: 'POST', body: { ids: items.map((p) => p.retroId), invoiceNumber: v.invoiceNumber.trim(), invoiceDate: v.invoiceDate, invoiceCents: Math.round((parseNum(v.value) ?? 0) * 100) } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Retroativo faturado' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  return (
    <Modal open onClose={onClose} title="NF complementar do retroativo" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!v.invoiceNumber.trim()} loading={save.isPending} onClick={() => save.mutate()}>Registrar nota</Button></>}>
      <ul className="mb-3 space-y-1 text-sm">{items.map((p) => <li key={p.retroId} className="flex justify-between gap-2"><span>{p.title}</span><b className="num">{money(p.valueV4)}</b></li>)}</ul>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Nº da NF" htmlFor="rt-n"><Input id="rt-n" value={v.invoiceNumber} onChange={(e) => setV({ ...v, invoiceNumber: e.target.value })} /></FormField>
        <FormField label="Data" htmlFor="rt-d"><Input id="rt-d" type="date" value={v.invoiceDate} onChange={(e) => setV({ ...v, invoiceDate: e.target.value })} /></FormField>
        <FormField label="Valor (R$)" htmlFor="rt-v"><Input id="rt-v" inputMode="decimal" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ virada de exercício (RN10)
export function RolloverModal({ d, contractId, onClose }: { d: Data; contractId: string; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const thisYear = Number(d.today.slice(0, 4));
  const years = [...new Set(d.commitments.filter((c) => !c.cancelledAt && c.balanceV4 > 0 && c.fiscalYear <= thisYear).map((c) => c.fiscalYear))].sort();
  const [year, setYear] = useState(years[0] ?? thisYear);
  const [source, setSource] = useState('');
  const nes = d.commitments.filter((c) => !c.cancelledAt && c.fiscalYear === year && (!source || c.sourceId === source));
  const rows = nes.flatMap((c) => c.items.filter((i) => i.balance4 > 0).map((i) => ({ c, i, line: d.lines.find((l) => l.id === i.lineId)! })));
  const [sel, setSel] = useState<Record<string, string>>({});
  const value = (id: string, def: number) => sel[id] ?? String(def / 10_000).replace('.', ',');
  const picked = rows.map((r) => ({ ...r, q: parseNum(value(r.i.id, r.i.balance4)) ?? 0 })).filter((r) => r.q > 0 && sel[r.i.id] !== '');
  const suppressedV4 = picked.reduce((a, r) => a + Math.round(r.q * r.line.price4), 0);
  const byLine = useMemo(() => { const m = new Map<string, number>(); for (const r of picked) m.set(r.line.id, (m.get(r.line.id) ?? 0) + r.q); return m; }, [picked]);
  const [next, setNext] = useState<'nova' | 'vincular' | 'depois'>('nova');
  const [ne, setNe] = useState({ number: `${year + 1}NE`, issuedOn: `${year + 1}-01-02`, sourceId: '' });
  const [codes, setCodes] = useState<Record<string, string>>({});
  const later = d.commitments.filter((c) => !c.cancelledAt && c.fiscalYear > year);
  const [link, setLink] = useState(later[0]?.id ?? '');
  const [occurredOn, setOccurredOn] = useState(`${year}-12-31`);
  const [reason, setReason] = useState(`Virada do exercício ${year}: supressão do saldo não utilizado e reempenho no exercício seguinte (RN10).`);
  const save = useMutation({
    mutationFn: () => api<{ suppressedV4: number }>(`/contracts/${contractId}/commitment-control/rollover`, { method: 'POST', body: {
      year, occurredOn, reason, items: picked.map((r) => ({ commitmentItemId: r.i.id, qty: r.q })),
      ...(next === 'nova' ? { newCommitment: { number: ne.number.trim().toUpperCase(), issuedOn: ne.issuedOn, sourceId: (ne.sourceId || source) || null, items: [...byLine].map(([lineId, q]) => ({ lineId, qty: q, code: codes[lineId] || null })) } } : next === 'vincular' && link ? { linkCommitmentId: link } : {}),
    } }),
    onSuccess: (r) => { refresh(); toast({ tone: 'success', message: `Virada registrada: ${money(r.suppressedV4)} suprimidos${next === 'depois' ? '. Vincule a NE nova quando chegar.' : ' e reempenhados.'}` }); onClose(); },
    onError: (e) => toast({ tone: 'error', message: errMsg(e) }),
  });
  const needSource = d.settings.allocation === 'rateio';
  return (
    <Modal open onClose={onClose} size="xl" title="Virada de exercício"
      footer={<><span className="mr-auto text-sm">Suprimir <b className="num">{money(suppressedV4)}</b> de {new Set(picked.map((r) => r.c.id)).size} NE(s)</span><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!picked.length || reason.trim().length < 5 || (next === 'nova' && (!/NE\d+/i.test(ne.number) || (needSource && !(ne.sourceId || source)))) || (next === 'vincular' && !link)} loading={save.isPending} onClick={() => save.mutate()}>Registrar virada</Button></>}>
      <Notice tone="info">Empenho só vale no seu ano. O saldo que sobrou nas NEs de {year} é suprimido (movimentação formal) e reempenhado na NE de {year + 1}, que fica ligada à antiga.</Notice>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <FormField label="Exercício" htmlFor="vr-y"><Select id="vr-y" value={String(year)} onChange={(e) => { const y = Number(e.target.value); setYear(y); setSel({}); setOccurredOn(`${y}-12-31`); setNe({ ...ne, number: `${y + 1}NE`, issuedOn: `${y + 1}-01-02` }); }}>{(years.length ? years : [thisYear]).map((y) => <option key={y} value={y}>{y}</option>)}</Select></FormField>
        {!!d.sources.length && <FormField label="Fonte" htmlFor="vr-s"><Select id="vr-s" value={source} onChange={(e) => { setSource(e.target.value); setSel({}); }}><option value="">Todas</option>{d.sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>}
        <FormField label="Data da supressão" htmlFor="vr-d"><Input id="vr-d" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} /></FormField>
      </div>
      {year === thisYear && Number(d.today.slice(5, 7)) < 12 && <Notice tone="warning">Ainda há meses de {year} pela frente: suprima só o saldo que não será usado até 31/12. O que for suprimido deixa de cobrir medições deste ano.</Notice>}
      <FormField label="Justificativa" htmlFor="vr-r" className="mt-2"><Input id="vr-r" value={reason} onChange={(e) => setReason(e.target.value)} /></FormField>
      <h3 className="mb-1 mt-4 text-sm font-bold text-ink">1. Saldo a suprimir</h3>
      {!rows.length ? <p className="text-sm text-muted">Nenhuma NE de {year} com saldo{source ? ' nesta fonte' : ''}.</p> : (
        <div className="max-h-[32vh] overflow-auto border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted"><tr><th className="px-2 py-1.5">NE</th><th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5 text-right">Saldo</th><th className="w-32 px-2 py-1.5 text-right">Suprimir</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.i.id} className="border-t border-line">
                <td className="px-2 py-1.5 font-semibold">{r.c.number}{r.c.sourceName && <span className="block text-2xs font-normal text-muted">{r.c.sourceName}</span>}</td>
                <td className="max-w-[300px] px-2 py-1.5"><b>{r.line.itemNumber}</b> <span className="line-clamp-1 text-muted">{r.line.description}</span></td>
                <td className="num px-2 py-1.5 text-right">{qty(r.i.balance4)} {r.line.unit}</td>
                <td className="px-2 py-1.5"><Input aria-label={`Suprimir ${r.c.number} item ${r.line.itemNumber}`} inputMode="decimal" className="num h-8 text-right" value={value(r.i.id, r.i.balance4)} onChange={(e) => setSel({ ...sel, [r.i.id]: e.target.value })} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <h3 className="mb-1 mt-4 text-sm font-bold text-ink">2. NE de {year + 1}</h3>
      <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="NE do ano seguinte">
        {([['nova', 'Registrar agora'], ['vincular', 'Já está registrada'], ['depois', 'Ainda não chegou']] as const).map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="radio" name="vr-next" checked={next === k} onChange={() => setNext(k)} disabled={k === 'vincular' && !later.length} />{l}</label>)}
      </div>
      {next === 'nova' && (
        <div className="mt-2 space-y-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Nº da NE nova" htmlFor="vr-n"><Input id="vr-n" value={ne.number} onChange={(e) => setNe({ ...ne, number: e.target.value })} /></FormField>
            <FormField label="Emissão" htmlFor="vr-e"><Input id="vr-e" type="date" value={ne.issuedOn} onChange={(e) => setNe({ ...ne, issuedOn: e.target.value })} /></FormField>
            {!!d.sources.length && !source && <FormField label={needSource ? 'Fonte (obrigatória no rateio)' : 'Fonte'} htmlFor="vr-ns"><Select id="vr-ns" value={ne.sourceId} onChange={(e) => setNe({ ...ne, sourceId: e.target.value })}><option value="">—</option>{d.sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></FormField>}
          </div>
          <p className="text-xs text-muted">A NE nova reempenha a mesma quantidade suprimida de cada um dos {byLine.size} item(ns), no valor de {money(suppressedV4)}.</p>
          {!!byLine.size && (
            <details className="text-xs">
              <summary className="cursor-pointer font-semibold text-primary">Códigos dos itens na NE nova (opcional)</summary>
              <div className="mt-1 max-h-48 overflow-auto border border-line">
                <table className="w-full text-sm"><tbody>{[...byLine].map(([id, q]) => { const l = d.lines.find((x) => x.id === id)!; return (
                  <tr key={id} className="border-t border-line first:border-0"><td className="px-2 py-1"><b>{l.itemNumber}</b> <span className="text-muted">{l.description.slice(0, 60)}</span></td><td className="num px-2 py-1 text-right">{q.toLocaleString('pt-BR')} {l.unit}</td><td className="w-40 px-2 py-1"><Input aria-label={`Código na NE item ${l.itemNumber}`} className="h-8" placeholder="460233-1" value={codes[id] ?? ''} onChange={(e) => setCodes({ ...codes, [id]: e.target.value })} /></td></tr>
                ); })}</tbody></table>
              </div>
            </details>
          )}
        </div>
      )}
      {next === 'vincular' && <FormField label="NE que reempenha" htmlFor="vr-l" className="mt-2"><Select id="vr-l" value={link} onChange={(e) => setLink(e.target.value)}>{later.map((c) => <option key={c.id} value={c.id}>{c.number} · {money(c.valueV4)}</option>)}</Select></FormField>}
      {next === 'depois' && <p className="mt-2 text-sm text-muted">A supressão fica registrada e a aba Empenhos avisa para vincular a NE de {year + 1} quando ela chegar.</p>}
    </Modal>
  );
}

/** Supressões da virada ainda sem NE nova: vincular quando chegar. */
export function RolloverLinkNotice({ d, contractId }: { d: Data; contractId: string }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const open = d.commitments.filter((c) => c.items.some((i) => i.moves.some((m) => m.kind === 'supressao' && !m.linkedCommitmentId)));
  const years = [...new Set(open.map((c) => c.fiscalYear))];
  const [pick, setPick] = useState<Record<number, string>>({});
  const save = useMutation({ mutationFn: (y: number) => api(`/contracts/${contractId}/commitment-control/rollover/link`, { method: 'POST', body: { year: y, commitmentId: pick[y] } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'NE nova vinculada à virada' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  if (!years.length || !d.canManage) return null;
  return (
    <div className="space-y-2">{years.map((y) => {
      const later = d.commitments.filter((c) => !c.cancelledAt && c.fiscalYear > y);
      return (
        <div key={y} className="flex flex-wrap items-center gap-2 border border-warning/40 bg-warning-soft/40 px-3 py-2 text-sm">
          <CalendarClock className="h-4 w-4 text-[#C2610C]" aria-hidden />
          <span className="flex-1">Saldo de {y} suprimido em {open.filter((c) => c.fiscalYear === y).map((c) => c.number).join(', ')} sem a NE nova vinculada.</span>
          {later.length ? <>
            <Select aria-label={`NE que reempenha ${y}`} className="h-8 w-52" value={pick[y] ?? ''} onChange={(e) => setPick({ ...pick, [y]: e.target.value })}><option value="">Escolha a NE de {y + 1}…</option>{later.map((c) => <option key={c.id} value={c.id}>{c.number}</option>)}</Select>
            <Button size="sm" disabled={!pick[y]} loading={save.isPending} onClick={() => save.mutate(y)}>Vincular</Button>
          </> : <span className="text-xs text-muted">Registre a NE de {y + 1} e volte aqui.</span>}
        </div>
      );
    })}</div>
  );
}

// ------------------------------------------------------------------ aditivo de quantidade do item (PF08.1)
export function LineMoveModal({ contractId, line, onClose }: { contractId: string; line: Line; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const [v, setV] = useState({ kind: 'acrescimo' as 'acrescimo' | 'supressao', qty: '', effectiveOn: new Date().toISOString().slice(0, 10), reference: '', reason: '' });
  const save = useMutation({ mutationFn: () => api(`/contracts/${contractId}/lines/${line.id}/moves`, { method: 'POST', body: { kind: v.kind, qty: parseNum(v.qty), effectiveOn: v.effectiveOn, reference: v.reference.trim() || null, reason: v.reason.trim() } }), onSuccess: () => { refresh(); toast({ tone: 'success', message: 'Aditivo registrado' }); onClose(); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const n = parseNum(v.qty) ?? 0;
  const after = line.qty4 + (v.kind === 'acrescimo' ? 1 : -1) * Math.round(n * 10_000);
  return (
    <Modal open onClose={onClose} title={`Aditivo · item ${line.itemNumber}`} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!n || v.reason.trim().length < 5} loading={save.isPending} onClick={() => save.mutate()}>Registrar</Button></>}>
      <p className="mb-3 text-sm text-muted">{line.description}. Hoje: {qty(line.qty4)} {line.unit}{n ? <> → <b>{qty(after)} {line.unit}</b></> : ''}.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Tipo" htmlFor="lm-k"><Select id="lm-k" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })}><option value="acrescimo">Acréscimo</option><option value="supressao">Supressão</option></Select></FormField>
        <FormField label={`Quantidade (${line.unit})`} htmlFor="lm-q"><Input id="lm-q" inputMode="decimal" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} /></FormField>
        <FormField label="Vale a partir de" htmlFor="lm-d"><Input id="lm-d" type="date" value={v.effectiveOn} onChange={(e) => setV({ ...v, effectiveOn: e.target.value })} /></FormField>
        <FormField label="Termo" htmlFor="lm-r" hint="Ex.: 1º termo aditivo"><Input id="lm-r" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></FormField>
        <FormField label="Justificativa" htmlFor="lm-j" className="sm:col-span-2"><Textarea id="lm-j" rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ regras do contrato
export function RulesPanel({ d, contractId }: { d: Data; contractId: string }) {
  const toast = useToast();
  const refresh = useRefresh(contractId);
  const st = d.settings;
  const post = (body: Record<string, unknown>, msg = 'Regra salva') => api(`/contracts/${contractId}/commitment-control/settings`, { method: 'POST', body }).then(() => { refresh(); toast({ tone: 'success', message: msg }); });
  const settings = useMutation({ mutationFn: (b: Record<string, unknown>) => post(b), onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const [mode, setMode] = useState(st.allocation);
  const [confirm, setConfirm] = useState(false);
  const [alerts, setAlerts] = useState({ agingDays: String(st.agingDays), toCommitPct: st.toCommitPct == null ? '' : String(st.toCommitPct) });
  const [srcName, setSrcName] = useState('');
  const addSource = useMutation({ mutationFn: () => api(`/contracts/${contractId}/commitment-control/sources`, { method: 'POST', body: { name: srcName.trim() } }), onSuccess: () => { refresh(); setSrcName(''); toast({ tone: 'success', message: 'Fonte cadastrada' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const current = d.shareVersions.find((v) => v.validFrom <= d.today.slice(0, 7)) ?? null;
  const [shareForm, setShareForm] = useState<null | { validFrom: string; definedBy: 'cliente' | 'bk'; note: string; pct: Record<string, string> }>(null);
  const shareSum = shareForm ? Object.values(shareForm.pct).reduce((a, x) => a + (parseNum(x) ?? 0), 0) : 0;
  const saveShares = useMutation({ mutationFn: () => api(`/contracts/${contractId}/commitment-control/shares`, { method: 'POST', body: { validFrom: shareForm!.validFrom, definedBy: shareForm!.definedBy, note: shareForm!.note.trim() || null, shares: d.sources.map((x) => ({ sourceId: x.id, pct: parseNum(shareForm!.pct[x.id] ?? '') ?? 0 })) } }), onSuccess: () => { refresh(); setShareForm(null); toast({ tone: 'success', message: 'Proporção registrada' }); }, onError: (e) => toast({ tone: 'error', message: errMsg(e) }) });
  const nameOf = (id: string) => d.sources.find((x) => x.id === id)?.name ?? '—';
  const pctText = (ppm: number) => `${(ppm / 10_000).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
  return (
    <section className="card p-4" aria-labelledby="rules-h">
      <h2 id="rules-h" className="font-bold text-ink">Regras do contrato</h2>
      <div className="mt-3 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4 text-sm">
          <div>
            <p className="font-semibold text-ink">Medição sem empenho</p>
            <p className="text-xs text-muted">Padrão: registra e abre pendência "aguardando empenho", porque a execução contínua não para.</p>
            <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={st.commitmentBlock} disabled={settings.isPending} onChange={(e) => settings.mutate({ commitmentBlock: e.target.checked })} />Bloquear medição sem empenho</label>
          </div>
          <div>
            <p className="font-semibold text-ink">De qual empenho sai o consumo</p>
            <div className="mt-1 space-y-1" role="radiogroup" aria-label="Ordem de baixa">
              <label className="flex items-start gap-2"><input type="radio" className="mt-1" name="alloc" checked={mode === 'fifo'} onChange={() => setMode('fifo')} /><span><b>Do mais antigo para o mais novo</b> (FIFO, padrão)</span></label>
              <label className="flex items-start gap-2"><input type="radio" className="mt-1" name="alloc" checked={mode === 'rateio'} onChange={() => setMode('rateio')} disabled={d.sources.length < 2} /><span><b>Rateio pelas fontes de receita</b>: cada fonte paga a sua parte, pela proporção vigente{d.sources.length < 2 ? ' (cadastre duas fontes)' : ''}</span></label>
            </div>
            {st.allocationConfirmedAt && <p className="mt-1 text-xs text-muted">Regra atual: {st.allocation === 'rateio' ? 'rateio' : 'FIFO'}, confirmada por {st.allocationConfirmedBy ?? '—'} em {fmtDateTime(st.allocationConfirmedAt)}.</p>}
            {mode !== st.allocation && (
              <div className="mt-2 border border-warning/40 bg-warning-soft/40 p-2">
                <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />Confirmo a mudança da ordem de baixa deste contrato{mode === 'rateio' ? ', conforme a proporção acordada com o cliente' : ''}. Vale para as próximas medições; as já registradas não mudam.</label>
                <Button size="sm" className="mt-2" disabled={!confirm} loading={settings.isPending} onClick={() => settings.mutate({ allocation: { mode, confirm: true } })}>Salvar ordem de baixa</Button>
              </div>
            )}
          </div>
          <div>
            <p className="font-semibold text-ink">Alertas</p>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <FormField label="Avisar medição sem nota após (dias)" htmlFor="rl-a"><Input id="rl-a" inputMode="numeric" value={alerts.agingDays} onChange={(e) => setAlerts({ ...alerts, agingDays: e.target.value })} /></FormField>
              <FormField label="Avisar quando o sem empenho passar de (%)" htmlFor="rl-p" hint="Em branco: só informa"><Input id="rl-p" inputMode="numeric" value={alerts.toCommitPct} onChange={(e) => setAlerts({ ...alerts, toCommitPct: e.target.value })} /></FormField>
            </div>
            <Button size="sm" className="mt-1" loading={settings.isPending} disabled={!Number(alerts.agingDays)} onClick={() => settings.mutate({ agingDays: Math.round(Number(alerts.agingDays)), toCommitPct: alerts.toCommitPct.trim() === '' ? null : Math.round(Number(alerts.toCommitPct)) })}>Salvar alertas</Button>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-semibold text-ink">Fontes de receita do cliente</p>
            <p className="text-xs text-muted">Quando o órgão paga com mais de uma fonte (ex.: educação estadual e municipal), cada fonte emite os seus empenhos.</p>
            <div className="mt-1 flex flex-wrap gap-1.5">{d.sources.length ? d.sources.map((x) => <Chip key={x.id} tone="blue">{x.name}</Chip>) : <span className="text-xs text-muted">Nenhuma fonte cadastrada.</span>}</div>
            <div className="mt-2 flex gap-2"><Input aria-label="Nova fonte de receita" className="h-9" placeholder="Ex.: Educação municipal" value={srcName} onChange={(e) => setSrcName(e.target.value)} /><Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={srcName.trim().length < 2} loading={addSource.isPending} onClick={() => addSource.mutate()}>Adicionar</Button></div>
          </div>
          {d.sources.length >= 2 && (
            <div>
              <p className="font-semibold text-ink">Proporção entre as fontes</p>
              {current ? <p className="text-xs text-text">Vigente (v{current.version}, desde {monthShort(current.validFrom)}, {current.definedBy === 'cliente' ? 'definida pelo cliente' : 'sugestão da BK'}): {current.shares.map((x) => `${nameOf(x.sourceId)} ${pctText(x.ppm)}`).join(' · ')}</p> : <p className="text-xs text-[#C2610C]">Nenhuma proporção registrada.</p>}
              {d.shareVersions.length > 1 && <details className="mt-1 text-xs"><summary className="cursor-pointer text-primary">Histórico ({d.shareVersions.length} versões)</summary><ul className="mt-1 space-y-0.5">{d.shareVersions.map((v) => <li key={v.id}>v{v.version} · desde {monthShort(v.validFrom)} · {v.definedBy === 'cliente' ? 'cliente' : 'BK'} · {v.shares.map((x) => `${nameOf(x.sourceId)} ${pctText(x.ppm)}`).join(', ')}{v.note ? ` — ${v.note}` : ''}</li>)}</ul></details>}
              {!shareForm ? d.canManage && <Button size="sm" variant="ghost" className="mt-1" onClick={() => setShareForm({ validFrom: d.today.slice(0, 7), definedBy: 'cliente', note: '', pct: Object.fromEntries(d.sources.map((x) => [x.id, current ? String((current.shares.find((y) => y.sourceId === x.id)?.ppm ?? 0) / 10_000).replace('.', ',') : ''])) })}>Nova proporção</Button> : (
                <div className="mt-2 space-y-2 border border-line p-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <FormField label="Vale a partir de" htmlFor="sh-f"><Input id="sh-f" type="month" value={shareForm.validFrom} onChange={(e) => setShareForm({ ...shareForm, validFrom: e.target.value })} /></FormField>
                    <FormField label="Quem definiu" htmlFor="sh-b"><Select id="sh-b" value={shareForm.definedBy} onChange={(e) => setShareForm({ ...shareForm, definedBy: e.target.value as 'cliente' | 'bk' })}><option value="cliente">Cliente</option><option value="bk">Sugestão da BK</option></Select></FormField>
                    {d.sources.map((x) => <FormField key={x.id} label={`${x.name} (%)`} htmlFor={`sh-${x.id}`}><Input id={`sh-${x.id}`} inputMode="decimal" value={shareForm.pct[x.id] ?? ''} onChange={(e) => setShareForm({ ...shareForm, pct: { ...shareForm.pct, [x.id]: e.target.value } })} /></FormField>)}
                  </div>
                  <FormField label="Observação" htmlFor="sh-n"><Input id="sh-n" value={shareForm.note} onChange={(e) => setShareForm({ ...shareForm, note: e.target.value })} placeholder="Ex.: ofício nº 12/2026" /></FormField>
                  <div className="flex items-center gap-2"><span className={clsx('text-xs', Math.abs(shareSum - 100) > 0.00001 ? 'text-danger' : 'text-success')}>Soma: {shareSum.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%</span><span className="flex-1" /><Button size="sm" variant="ghost" onClick={() => setShareForm(null)}>Cancelar</Button><Button size="sm" variant="primary" disabled={Math.abs(shareSum - 100) > 0.00001} loading={saveShares.isPending} onClick={() => saveShares.mutate()}>Registrar</Button></div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
