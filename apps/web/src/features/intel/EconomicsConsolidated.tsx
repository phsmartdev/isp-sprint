/** Inteligência → Viabilidade econômica: fluxo de caixa consolidado das oportunidades com viabilidade salva. */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ECON_VERDICT_LABELS, type EconVerdict } from '@isp/domain';
import { api, qs } from '../../lib/api';
import { fmtBRL } from '../../lib/format';
import { useUrlState } from '../../lib/hooks';
import { Chip, ErrorState, LoadingRows } from '../../components/ui/primitives';
import { CashflowChart } from '../../components/charts/Cashflow';
import { monthYear } from '../../pages/Reports';

type Item = { id: string; code: number; title: string; account: string; won: boolean; startMonth: string; verdict: EconVerdict; mode: 'recorrente' | 'pontual'; investmentCents: number; contributionCents: number | null; npvCents: number | null; paybackMonths: number | null; months: number };
type Data = {
  flow: { months: string[]; inflow: number[]; outflow: number[]; net: number[]; cumulative: number[] };
  totals: { n: number; investmentCents: number; npvCents: number; resultCents: number; lowestCents: number; breakEvenMonth: string | null };
  items: Item[];
};
const STATUS = [{ key: 'todas', label: 'Todas' }, { key: 'ganhas', label: 'Ganhas' }, { key: 'andamento', label: 'Em andamento' }] as const;
const VERDICT_TONE: Record<EconVerdict, 'green' | 'yellow' | 'red' | 'neutral'> = { viavel: 'green', abaixo_recomendado: 'yellow', fora_politica: 'red', abaixo_minimo: 'red', inviavel: 'red', sem_preco: 'neutral' };
const money = (v: number) => (v < 0 ? `− ${fmtBRL(-v)}` : fmtBRL(Math.abs(v)));

function Tile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'bad' }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx('num mt-0.5 text-xl font-bold', tone === 'bad' ? 'text-danger' : 'text-ink')}>{value}</p>
      <p className="text-2xs text-muted">{hint}</p>
    </div>
  );
}

export function EconomicsConsolidated() {
  const [f, setF] = useUrlState({ eco: 'todas' });
  const q = useQuery({ queryKey: ['intel-economics', f.eco], queryFn: () => api<Data>(`/intelligence/economics${qs({ status: f.eco })}`) });
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Fluxo de caixa das vendas</h2>
          <p className="max-w-3xl text-sm text-muted">Soma das oportunidades com viabilidade econômica salva. As ganhas começam no mês do fechamento; as em andamento, neste mês. Perdidas ficam de fora.</p>
        </div>
        <div className="flex border border-line" role="radiogroup" aria-label="Situação das oportunidades">
          {STATUS.map((s) => (
            <button key={s.key} type="button" role="radio" aria-checked={f.eco === s.key} onClick={() => setF({ eco: s.key })} className={clsx('h-9 px-3 text-sm', f.eco === s.key ? 'bg-primary font-semibold text-white' : 'text-text hover:bg-surface-2')}>{s.label}</button>
          ))}
        </div>
      </div>
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!d ? <div className="card"><LoadingRows rows={6} /></div> : !d.totals.n ? (
        <div className="card p-6 text-sm text-muted">Nenhuma oportunidade com viabilidade econômica salva nesta seleção. Preencha a aba Viabilidade econômica na oportunidade e salve.</div>
      ) : (
        <>
          <section aria-label="Resumo" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Investimento" value={fmtBRL(d.totals.investmentCents)} hint={`${d.totals.n} oportunidade(s)`} />
            <Tile label="Maior necessidade de caixa" value={money(d.totals.lowestCents)} hint="Ponto mais baixo do saldo acumulado" tone={d.totals.lowestCents < 0 ? 'bad' : undefined} />
            <Tile label="Retorno do investimento" value={d.totals.breakEvenMonth ? monthYear(d.totals.breakEvenMonth) : d.totals.lowestCents < 0 ? 'Não volta no prazo' : 'Imediato'} hint="Mês em que o acumulado volta a ser positivo" tone={!d.totals.breakEvenMonth && d.totals.lowestCents < 0 ? 'bad' : undefined} />
            <Tile label="Resultado no fim dos contratos" value={money(d.totals.resultCents)} hint={`Em valor de hoje (VPL): ${money(d.totals.npvCents)}`} tone={d.totals.resultCents < 0 ? 'bad' : undefined} />
          </section>
          <section className="card p-5" aria-labelledby="h-eco-flow">
            <h3 id="h-eco-flow" className="mb-3 text-md font-bold text-ink">Entradas, saídas e saldo acumulado por mês</h3>
            <CashflowChart labels={d.flow.months.map(monthYear)} inflow={d.flow.inflow} outflow={d.flow.outflow} cumulative={d.flow.cumulative} ariaLabel="Fluxo de caixa consolidado por mês" height={260} />
          </section>
          <section className="card overflow-hidden" aria-labelledby="h-eco-opps">
            <h3 id="h-eco-opps" className="px-5 pb-2 pt-4 text-md font-bold text-ink">Oportunidades</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-surface-2 text-xs text-muted"><tr>{['Oportunidade', 'Situação', 'Início', 'Investimento', 'Sobra', 'Payback', 'VPL', 'Viabilidade'].map((h, i) => <th key={h} className={clsx('px-4 py-2 font-medium', i >= 3 && i <= 6 && 'text-right')}>{h}</th>)}</tr></thead>
                <tbody>
                  {d.items.map((i) => (
                    <tr key={i.id} className="border-t border-line">
                      <td className="px-4 py-2.5"><Link to={`/opportunities/${i.id}?aba=viabilidade`} className="font-semibold text-primary hover:underline">{i.title}</Link><span className="block text-xs text-muted">OP-{i.code} · {i.account}</span></td>
                      <td className="px-4 py-2.5">{i.won ? 'Ganha' : 'Em andamento'}</td>
                      <td className="px-4 py-2.5">{monthYear(i.startMonth)}</td>
                      <td className="num px-4 py-2.5 text-right">{fmtBRL(i.investmentCents)}</td>
                      <td className="num px-4 py-2.5 text-right">{i.contributionCents == null ? '—' : `${money(i.contributionCents)}${i.mode === 'recorrente' ? '/mês' : ''}`}</td>
                      <td className="num px-4 py-2.5 text-right">{i.paybackMonths == null ? '—' : i.paybackMonths === 0 ? 'imediato' : `${i.paybackMonths.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} meses`}</td>
                      <td className={clsx('num px-4 py-2.5 text-right', (i.npvCents ?? 0) < 0 && 'text-danger')}>{i.npvCents == null ? '—' : money(i.npvCents)}</td>
                      <td className="px-4 py-2.5"><Chip tone={VERDICT_TONE[i.verdict]}>{ECON_VERDICT_LABELS[i.verdict]}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
