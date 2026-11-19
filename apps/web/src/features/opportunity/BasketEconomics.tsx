import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { CATEGORY_LABELS, basketName, businessCash, businessStatement, categoryCosts, rateText, type BasketForm, type Category } from './basketPresentation';
import { ECON_VERDICT_LABELS, econPaybackLimit, paybackMonths, type B2gResult, type EconBasketView, type EconInput, type EconItem, type EconResult, type EconSettings, type EconStatement } from '@isp/domain';
import { fmtBRL } from '../../lib/format';
import { Button, Chip, FormField, Input, Notice } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/overlay';
import { compactBRL, LineChart } from '../../components/charts/charts';

const pct = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
const months = (n: number | null | undefined) => n == null ? 'Não se paga' : n <= 0 ? 'Imediato' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' meses';
const tone = (v: EconResult['verdict']) => v === 'viavel' ? 'green' as const : v === 'acima_faixa' || v === 'aguardando_sugerido' ? 'orange' as const : 'red' as const;
type PanelProps = { view: EconBasketView; form: BasketForm; input: EconInput; settings: EconSettings; index: number; disabled: boolean; pending: boolean; invalid: boolean; targetInvalid: boolean; onChange: (p: Partial<BasketForm>) => void; onUse: () => void; onAdvanced: () => void; onItems: () => void };
export function BasketPanel({ view, form, input, settings, index, disabled, pending, invalid, targetInvalid, onChange, onUse, onAdvanced, onItems }: PanelProps) {
  const r = view.result, e = view.evaluation, s = e.statement?.month;
  const monthly = e.mode === 'recorrente', name = basketName(view), proposed = r.decision?.basis === 'proposto';
  const paybackLimit = econPaybackLimit(input, settings, r.publicSector);
  const costs = categoryCosts(view, input, settings), N = monthly ? Math.max(1, e.term.N) : 1;
  const net = e.statement?.total.net, revenue = e.statement?.total.revenue ?? 0;
  const row = (label: string, value: number | null | undefined, strong = false, inference = false) => <div key={label} className={clsx('flex items-start justify-between gap-3 border-b border-line px-4 py-1.5 text-xs', strong && 'bg-surface-2 font-bold')}><span>{label}</span><span className="num whitespace-nowrap">{value == null ? '—' : fmtBRL(value)}{value != null && (inference || (s?.revenue ?? 0) > 0) && <small className="ml-2 inline-block min-w-12 text-right font-normal text-muted">{inference ? rateText(e.serviceCostBp ?? settings.serviceCostBp ?? 3500) + '% da base' : pct(value / s!.revenue * 100)}</small>}</span></div>;
  return <section className="min-w-0 border border-line bg-surface" aria-label={'Viabilidade — ' + name}>
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"><span className="grid h-6 w-6 place-items-center bg-ink text-xs font-bold text-white">{index + 1}</span><h3 className="text-sm font-bold text-ink">{name}</h3><span className="bg-primary-soft px-2 py-0.5 text-xs text-primary">{monthly ? e.term.N + ' meses' : e.term.d ? 'Recebe no mês ' + e.term.d : 'À vista'}</span><span className="min-w-0 flex-1 truncate text-xs text-muted">{r.items.map((i) => i.description).join(', ')}</span><Chip tone={tone(r.verdict)}>{ECON_VERDICT_LABELS[r.verdict]}</Chip></div>
    <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
      <FormField label="Margem líquida esperada (%)" htmlFor={'margin-' + view.profile} hint={'No contrato desta cesta. Faixa: ' + rateText(settings.netMarginMinBp) + '% a ' + rateText(settings.netMarginMaxBp) + '% · recomendação ' + rateText(settings.netMarginTargetBp) + '%.'}>
        <Input id={'margin-' + view.profile} aria-label={'Margem líquida de ' + name} inputMode="decimal" value={form.margin} disabled={disabled} invalid={targetInvalid} onChange={(ev) => onChange({ margin: ev.target.value.replace(/[^\d,.]/g, '').slice(0, 6) })} />
      </FormField>
      {monthly ? <FormField label="Payback máximo (meses)" htmlFor={'payback-' + view.profile} hint={'Teto do retorno real. Se exigir preço maior, a margem final poderá subir. Máximo permitido: ' + paybackLimit + ' meses.'}><Input id={'payback-' + view.profile} aria-label={'Payback de ' + name} type="number" min={1} max={paybackLimit} step={1} inputMode="numeric" value={form.payback} disabled={disabled} onChange={(ev) => onChange({ payback: ev.target.value === '' ? '' : String(Math.max(1, Math.min(paybackLimit, Number(ev.target.value)))) })} /></FormField>
      : <div className="text-xs text-muted"><b className="block text-ink">Pagamento</b><p className="mt-1">{e.term.d ? 'Recebimento no mês ' + e.term.d : 'À vista'}</p><p className="mt-1">Pagamento único; não há payback mensal.</p></div>}
      <div className="sm:col-span-2"><FormField label={monthly ? 'Preço da Venda (R$/mês)' : 'Preço da Venda (R$)'} htmlFor={'price-' + view.profile} hint="Em branco: utiliza os valores dos produtos; sem valores, avalia o sugerido."><div className="flex flex-wrap items-center gap-2"><Input className="min-w-0 flex-1" id={'price-' + view.profile} aria-label={'Preço da venda de ' + name} inputMode="decimal" value={form.price} placeholder={proposed && e.priceCents != null ? (e.priceCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : 'Sem preço definido'} disabled={disabled} onChange={(ev) => onChange({ price: ev.target.value })} /><Button size="sm" variant="primary" disabled={disabled || pending || invalid || r.suggestedCents == null} onClick={onUse}>Usar preço sugerido</Button></div></FormField></div>
    </div>
    {targetInvalid && <p className="px-4 pb-2 text-xs text-danger">Informe uma margem dentro dos limites das Configurações.</p>}
    {invalid ? <p className="px-4 py-3 text-xs text-muted">Confira os parâmetros destacados para atualizar o cálculo.</p> : <>
    <div className="flex justify-between gap-3 border-y border-line px-4 py-2 text-sm font-bold text-ink"><span>Preço sugerido</span><span className="num">{fmtBRL(r.suggestedCents)}{monthly ? '/mês' : ''}</span></div>
    {proposed && <div className="flex justify-between gap-3 border-b border-line px-4 py-2 text-xs font-semibold text-primary"><span>As métricas abaixo vêm do preço da venda</span><span className="num">{fmtBRL(e.priceCents)}{monthly ? '/mês' : ''}</span></div>}
    {!proposed && <p className="px-4 py-2 text-2xs text-muted">As métricas abaixo vêm do preço sugerido.</p>}
    {row('(−) Tributos', s?.tax)}
    {(monthly ? ['parceiros', 'despesas_operacionais', 'inferencia'] as Category[] : (Object.keys(CATEGORY_LABELS) as Category[]).filter((c) => c !== 'inferencia' || costs[c] !== 0)).map((c) => row('(−) ' + CATEGORY_LABELS[c], costs[c] / N, false, c === 'inferencia'))}
    <div className="grid gap-2 bg-surface-2 px-4 py-3 text-xs sm:grid-cols-2"><div><span className="text-muted">Margem líquida do contrato</span><b className={clsx('num mt-1 block', (net ?? 0) < 0 ? 'text-danger' : 'text-success')}>{pct(net != null && revenue > 0 ? net / revenue * 100 : null)} · {fmtBRL(net)}</b></div>{monthly && <div><span className="text-muted">Investimento inicial · payback real</span><b className="num mt-1 block">{fmtBRL(e.investmentCents ?? e.initialCents)} · {months(e.kpi?.paybackMonths)}</b><span className="mt-1 block text-2xs text-muted">{proposed ? 'No preço da venda' : 'No preço sugerido'}{proposed && e.priceCents !== r.suggestedCents ? ' · no sugerido: ' + months(r.kpi?.paybackMonths) : ''}</span></div>}</div>
    {r.warnings.filter((w) => w.includes('teto de payback')).map((w) => <p key={w} className="px-4 py-2 text-xs text-[#9A4F08]">{w}</p>)}
    </>}
    <div className="flex flex-wrap gap-2 px-4 py-3"><Button size="sm" disabled={invalid} onClick={onAdvanced}>Cálculo avançado</Button></div>
  </section>;
}
export function BusinessOverview({ views, input, settings }: { views: EconBasketView[]; input: EconInput; settings: EconSettings }) {
  const [monthlyView, setMonthlyView] = useState(false);
  const total = useMemo(() => businessStatement(views), [views]);
  const flows = useMemo(() => businessCash(views), [views]);
  const periods = Math.max(1, ...views.map((v) => v.evaluation.term.N));
  const divisor = monthlyView ? periods : 1;
  const categories = views.map((v) => categoryCosts(v, input, settings));
  const amount = (n: number | null | undefined) => n == null ? '—' : fmtBRL(Math.round(n / divisor));
  const relative = (n: number) => total.revenue > 0 ? pct(n / total.revenue * 100) : '—';
  const metric = (label: string, value: string, signed = false) => <div className="border-r border-line px-3 py-3"><dt className="text-xs text-muted">{label}</dt><dd className={clsx('num mt-1 text-sm font-bold', signed ? (total.net ?? 0) < 0 ? 'text-danger' : 'text-success' : 'text-ink')}>{value}</dd></div>;
  const line = (label: string, get: (s: EconStatement, c: Record<Category, number>, monthly: boolean) => number, strong = false, signed = false) => {
    const values = views.map((v, k) => get(v.evaluation.statement?.total ?? { ...total, revenue: 0, tax: 0, contribution: 0, opex: 0, amortization: 0, risk: 0, commission: 0, overhead: 0, operating: 0, incomeTax: 0, net: 0 }, categories[k]!, v.evaluation.mode === 'recorrente'));
    const sum = values.reduce((a, b) => a + b, 0);
    return <tr key={label} className={clsx('border-t border-line', strong && 'bg-surface-2 font-semibold', signed && ((total.net ?? 0) < 0 ? 'text-danger' : 'text-success'))}><th scope="row" className="px-4 py-2 text-left font-normal">{label}</th>{values.map((n, k) => <td key={views[k]!.profile} className={clsx('num px-3 py-2 text-right', signed && (n < 0 ? 'text-danger' : 'text-success'))}>{amount(n)}</td>)}<td className="num px-3 py-2 text-right font-semibold">{amount(sum)}</td><td className="num px-3 py-2 text-right text-muted">{relative(sum)}</td></tr>;
  };
  return <section className="border border-line bg-surface" aria-label="Visão geral do negócio">
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3"><h3 className="text-sm font-bold text-ink">Visão geral do negócio</h3><span className="text-xs text-muted">Consolidado de {views.map(basketName).join(' + ')}{periods > 1 ? ' · contrato de ' + periods + ' meses' : ''}</span><div className="ml-auto flex border border-line" role="group" aria-label="Período da visão geral"><button type="button" className={clsx('px-3 py-1 text-xs', !monthlyView && 'bg-primary text-white')} aria-pressed={!monthlyView} onClick={() => setMonthlyView(false)}>Contrato inteiro</button>{periods > 1 && <button type="button" className={clsx('px-3 py-1 text-xs', monthlyView && 'bg-primary text-white')} aria-pressed={monthlyView} onClick={() => setMonthlyView(true)}>Por mês</button>}</div></div>
    <dl className="grid border-b border-line sm:grid-cols-3 xl:grid-cols-6">{metric('Receita do contrato', amount(total.revenue))}{metric('Deduções totais', amount(total.revenue - (total.net ?? 0)))}{metric('Margem de contribuição', amount(total.contribution) + ' · ' + relative(total.contribution))}{metric('Investimento inicial das cestas mensais', amount(views.filter((v) => v.evaluation.mode === 'recorrente').reduce((sum, v) => sum + (v.evaluation.investmentCents ?? v.evaluation.initialCents), 0)))}{metric('Resultado líquido (DRE)', amount(total.net) + ' · ' + relative(total.net ?? 0), true)}{metric('Payback de caixa consolidado', months(paybackMonths(flows.cashflow, views[0]?.evaluation.rates.r ?? 0)))}</dl>
    {views.some((v) => v.result.decision?.basis === 'proposto' && v.evaluation.priceCents !== v.result.suggestedCents) && <p className="border-b border-line px-4 py-2 text-xs text-muted">Visão geral calculada com os preços da venda. Alterar margem ou payback recalcula a sugestão; para adotá-la, use “Usar preço sugerido” na cesta.</p>}
    {monthlyView && <p className="px-4 py-2 text-xs text-muted">Média por mês do contrato inteiro. Os pagamentos únicos continuam sendo recebidos uma única vez.</p>}
    <div className="p-4"><p className="mb-2 text-xs text-muted">Caixa acumulado do contrato: receitas, desembolsos e saldo. O investimento é desembolsado no início.</p><LineChart categories={flows.categories} series={[{ key: 'revenue', label: 'Receita acumulada', color: '#305B88', values: flows.revenue }, { key: 'deductions', label: 'Desembolsos acumulados', color: '#C2610C', values: flows.deductions }, { key: 'cash', label: 'Saldo de caixa acumulado', color: '#16803B', values: flows.cash, weight: 2.5 }]} format={(n) => fmtBRL(n)} ariaLabel="Caixa acumulado da negociação" tooltipTitle={(i) => flows.categories[i] ?? ''} axisFormat={compactBRL} height={220} width={1280} /></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[740px] text-xs" aria-label="DRE da negociação"><thead className="bg-surface-2 text-muted"><tr><th className="px-4 py-2 text-left font-medium">DRE da negociação{monthlyView ? ' · média por mês' : ''}</th>{views.map((v) => <th key={v.profile} className="px-3 py-2 text-right font-medium">{basketName(v)}{v.evaluation.mode === 'recorrente' ? ' · ' + v.evaluation.term.N + ' meses' : ''}</th>)}<th className="px-3 py-2 text-right font-medium">Total</th><th className="px-3 py-2 text-right font-medium">% da receita</th></tr></thead><tbody>
      {line('Receita bruta', (s) => s.revenue, true)}
      {line('(−) Tributos sobre o faturamento', (s) => s.tax)}
      {line('(=) Receita após tributos', (s) => s.revenue - s.tax, true)}
      {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => line('(−) ' + CATEGORY_LABELS[c], (_, cats) => cats[c]))}
      {line('(−) Despesas variáveis', (s) => s.commission)}
      {line('(−) Amortização dos investimentos mensais', (s, _, monthly) => monthly ? s.amortization : 0)}
      {line('(=) Margem de contribuição', (s) => s.contribution, true)}
      {line('(−) Glosa e inadimplência', (s) => s.risk)}
      {line('(−) Despesas fixas rateadas', (s) => s.overhead ?? 0)}
      {line('(=) Margem operacional', (s) => s.operating ?? 0, true)}
      {line('(−) IR/CSLL', (s) => s.incomeTax ?? 0)}
      {line('(=) Resultado líquido do contrato', (s) => s.net ?? 0, true, true)}
    </tbody></table></div>
    <p className="px-4 py-3 text-xs text-muted">Margem líquida do contrato: <b>{relative(total.net ?? 0)}</b>. A amortização já foi deduzida na DRE; o investimento inicial não é descontado novamente do resultado.</p>
  </section>;
}
export function ItemValuesModal({ view, items, result, onClose }: { view: EconBasketView | null; items: EconItem[]; result: B2gResult | null; onClose: () => void }) {
  const lines = view ? [...result?.unica?.lines ?? [], ...result?.recorrente?.lines ?? []].filter((l) => l.profile === view.profile) : [];
  const monthly = view?.evaluation.mode === 'recorrente';
  const total = lines.reduce((sum, l) => sum + (l.priceCents ?? 0), 0);
  const rows = lines.map((line) => {
    const index = Number(line.id.replace('global:', '')), item = items[index];
    const quantity = item?.qtyMilli ?? 1000;
    const unit = line.priceCents == null ? null : Math.round(line.priceCents * 1000 / quantity);
    return { line, item, quantity, unit, difference: line.priceCents == null || unit == null ? 0 : line.priceCents - Math.round(unit * quantity / 1000) };
  });
  const rounding = rows.some((r) => r.difference !== 0);
  return <Modal open={view != null} onClose={onClose} title={'Valores por item — ' + (view ? basketName(view) : '')} size="xl" footer={<Button variant="primary" onClick={onClose}>Fechar</Button>}>
    <p className="mb-3 text-sm text-muted">Distribuição do valor global {monthly ? 'mensal ' : ''}da cesta. Os valores cadastrados nos produtos permanecem preservados. O rateio segue os valores informados ou os pesos existentes; sem valores, os pesos são iguais.</p>
    {!!result?.blocked.length && <Notice tone="warning">Complete os documentos fiscais dos produtos para conferir os valores por item.</Notice>}
    <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm" aria-label="Distribuição do preço global por item"><thead className="text-left text-xs text-muted"><tr>{['Produto', 'Quantidade', 'Valor cadastrado', 'Sugerido total', 'Valor global rateado', 'Unitário do rateio', ...(rounding ? ['Ajuste do total'] : [])].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}</tr></thead><tbody>{rows.map(({ line, item, quantity, unit, difference }) => <tr key={line.id} className="border-t border-line"><td className="px-2 py-2">{line.description}</td><td className="num px-2 py-2">{(quantity / 1000).toLocaleString('pt-BR')} {item?.unit ?? ''}</td><td className="num whitespace-nowrap px-2 py-2">{item?.priceDefined === false ? 'Não informado' : fmtBRL(item?.revenueCents)}{monthly && item?.priceDefined !== false ? '/mês' : ''}</td><td className="num whitespace-nowrap px-2 py-2">{fmtBRL(line.suggestedCents)}{monthly ? '/mês' : ''}</td><td className="num whitespace-nowrap px-2 py-2 font-semibold">{fmtBRL(line.priceCents)}{monthly ? '/mês' : ''}</td><td className="num whitespace-nowrap px-2 py-2">{fmtBRL(unit)}{monthly ? '/mês' : ''}</td>{rounding && <td className="num whitespace-nowrap px-2 py-2">{difference === 0 ? '—' : (difference > 0 ? 'Acréscimo ' : 'Desconto ') + fmtBRL(Math.abs(difference))}</td>}</tr>)}</tbody><tfoot><tr className="border-t border-line bg-surface-2 font-bold"><td colSpan={4} className="px-2 py-2">Valor global da cesta</td><td className="num whitespace-nowrap px-2 py-2">{fmtBRL(total)}{monthly ? '/mês' : ''}</td><td />{rounding && <td />}</tr></tfoot></table></div>
    {rounding && <p className="mt-3 text-xs text-[#9A4F08]">Os ajustes de arredondamento indicados compensam as duas casas dos unitários e fazem os totais fecharem o valor global. Esta é uma prévia; os valores não são aplicados automaticamente aos produtos.</p>}
  </Modal>;
}
