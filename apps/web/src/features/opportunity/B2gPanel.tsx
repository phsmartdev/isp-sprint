/**
 * Viabilidade por produto (licitações e atas): cada produto com o seu preço, margens, piso e faixa de lance.
 * Modo A parte do custo e chega ao preço; Modo B parte do preço do edital (ou do lance) e mostra as margens.
 * Venda única e mensalidade aparecem em blocos separados, e o consolidado soma tudo.
 */
import clsx from 'clsx';
import { COST_PROFILES, COST_PROFILE_LABELS, COST_PROFILE_SHORT, type CostProfile, type B2gBlock, type B2gLine, type B2gResult, type EconSettings } from '@isp/domain';
import { fmtBRL } from '../../lib/format';
import { FormField, Input, Notice } from '../../components/ui/primitives';

export type B2gForm = { mode: 'A' | 'B'; overhead: string; netTarget: string; mcForn: string; mcImpl: string; mcInst: string; solvePb: boolean; weights: Record<string, string>; bids: Record<string, string> };
export const emptyB2gForm = (): B2gForm => ({ mode: 'A', overhead: '', netTarget: '', mcForn: '', mcImpl: '', mcInst: '', solvePb: false, weights: {}, bids: {} });

const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })}%`);
const bpText = (bp: number | null | undefined) => (bp == null ? '' : (bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const money = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const months = (m: number) => `${m.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${m === 1 ? 'mês' : 'meses'}`;
const brl = (c: number | null | undefined) => (c == null ? '—' : c < 0 ? `− ${fmtBRL(-c)}` : fmtBRL(c));
const tone = (v: number | null | undefined, min: number | null) => (v == null ? 'text-muted' : v < 0 ? 'text-danger' : min != null && v < min ? 'text-[#C2610C]' : 'text-ink');

const VERDICT: Record<B2gResult['verdict'], { label: string; cls: string }> = {
  viavel: { label: 'Viável', cls: 'bg-success-soft text-[#15803D]' },
  abaixo_minimo: { label: 'Margem líquida abaixo do mínimo', cls: 'bg-warning-soft text-[#C2610C]' },
  produto_abaixo: { label: 'Algum produto abaixo do mínimo', cls: 'bg-warning-soft text-[#C2610C]' },
  produto_negativo: { label: 'Algum produto com prejuízo', cls: 'bg-danger-soft text-danger' },
  sem_minimo: { label: 'Sem margem líquida mínima configurada', cls: 'bg-surface-2 text-muted' },
  bloqueado: { label: 'Bloqueado: falta documento fiscal', cls: 'bg-danger-soft text-danger' },
};

export function B2gPanel({ r, profiles, f, set, settings, disabled }: { profiles?: CostProfile[]; r: B2gResult | null | undefined; f: B2gForm; set: (p: Partial<B2gForm>) => void; settings: EconSettings; disabled: boolean }) {
  const maxPct = settings.netMarginMaxBp != null ? settings.netMarginMaxBp / 100 : null;
  const minPct = settings.netMarginMinBp != null ? settings.netMarginMinBp / 100 : null;
  return (
    <section className="space-y-4 border border-line p-4" aria-labelledby="b2g-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="b2g-title" className="text-sm font-semibold text-ink">Preço por produto</h3>
          <p className="max-w-2xl text-xs text-muted">Valores preenchidos nos produtos: análise no preço de venda. Valores em branco: análise no preço sugerido. O sugerido fica disponível em ambos os cenários.</p>
        </div>
        <div className="flex rounded-sm border border-line p-0.5 text-sm" role="radiogroup" aria-label="Visualização dos preços">
          {([['A', 'Preços e custos'], ['B', 'Simular lances']] as const).map(([m, l]) => (
            <label key={m} className={clsx('cursor-pointer rounded-sm px-3 py-1.5', f.mode === m ? 'bg-primary-soft font-semibold text-primary' : 'text-muted hover:text-ink')}>
              <input type="radio" className="sr-only" checked={f.mode === m} disabled={disabled} onChange={() => set({ mode: m })} />{l}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FormField label="Despesas fixas rateadas (%)" htmlFor="b2g-oh" hint={`Nos serviços de Instalação e Implantação. Padrão ${bpText(settings.overheadBp ?? 0)}%.`}>
          <Input id="b2g-oh" inputMode="decimal" placeholder={bpText(settings.overheadBp ?? 0)} value={f.overhead} disabled={disabled} onChange={(e) => set({ overhead: e.target.value.replace(/[^\d,.]/g, '').slice(0, 6) })} />
        </FormField>
        <FormField label="Margem líquida esperada (%)" htmlFor="b2g-nt" hint="Parâmetro das Configurações. A contribuição é um resultado do cálculo.">
          <Input id="b2g-nt" value={bpText(settings.netMarginTargetBp)} disabled placeholder="Configure a margem líquida esperada" />
        </FormField>
      </div>

      {!r ? <Notice tone="warning">Confira os campos destacados para ver o preço por produto.</Notice> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className={clsx('rounded-sm px-2.5 py-1 text-xs font-semibold', VERDICT[r.verdict].cls)}>{VERDICT[r.verdict].label}</span>
            {r.global.netPct != null && <span className="text-xs text-muted">Margem líquida do conjunto {pct(r.global.netPct)}{minPct != null ? ` · mínimo ${pct(minPct)}` : ''}</span>}
          </div>
          {!!r.blocked.length && <Notice tone="warning">Sem documento fiscal: {r.blocked.map((b) => b.description).join(', ')}. Escolha o documento na aba Produtos e serviços para liberar o cálculo.</Notice>}
          {!!r.alerts.length && (
            <ul className="space-y-1 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-[#9A4B07]" aria-label="Alertas">
              {r.alerts.map((a) => <li key={a}>{a}</li>)}
            </ul>
          )}
          {!r.baskets && r.unica && <Block title="Venda única (cálculo anterior)" hint="Fotografia preservada" b={r.unica} f={f} set={set} disabled={disabled} minPct={minPct} maxPct={maxPct} />}
          {!r.baskets && r.recorrente && <Block title="Mensalidade (cálculo anterior)" hint="Fotografia preservada" b={r.recorrente} f={f} set={set} disabled={disabled} minPct={minPct} maxPct={maxPct} />}
          {!!r.baskets && COST_PROFILES.filter((p) => !profiles || profiles.includes(p)).map((profile) => {
            const source = profile === 'implantacao' ? r.recorrente : r.unica;
            const lines = source?.lines.filter((l) => l.profile === profile) ?? [];
            if (!source || !lines.length) return null;
            const sum = (field: 'costCents' | 'contributionCents' | 'operatingCents' | 'netCents' | 'overheadCents') => lines.reduce((t, l) => t + (l[field] ?? 0), 0);
            const price = source.revenue === 'recorrente' ? source.priceCents : lines.reduce((t, l) => t + (l.priceCents ?? 0), 0);
            const b = { ...source, lines, priceCents: price, costCents: sum('costCents'), contributionCents: sum('contributionCents'), overheadCents: sum('overheadCents'), operatingCents: sum('operatingCents'), netCents: sum('netCents'), netPct: price > 0 ? sum('netCents') / price * 100 : null, cascade: source.cascade?.filter((c) => c.profile === profile) };
            return <Block key={profile} title={COST_PROFILE_LABELS[profile]} hint={source.revenue === 'recorrente' ? 'Pagamento mensal' : 'Pagamento único'} b={b} f={f} set={set} disabled={disabled} minPct={minPct} maxPct={maxPct} />;
          })}
          {r.unica && r.recorrente && <Consolidated r={r} minPct={minPct} />}
          {!(r.unica && r.recorrente) && r.byDoc.length > 1 && <ByDoc r={r} />}
          {!!r.notes.length && <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </>
      )}
    </section>
  );
}

function Block({ title, hint, b, f, set, disabled, minPct, maxPct }: { title: string; hint: string; b: B2gBlock; f: B2gForm; set: (p: Partial<B2gForm>) => void; disabled: boolean; minPct: number | null; maxPct: number | null }) {
  const known = b.lines.some((l) => l.priceDefined ?? l.estimatedCents > 0);
  const suggested = b.lines.every((l) => l.suggestedCents != null) ? b.lines.reduce((t, l) => t + l.suggestedCents!, 0) : null;
  const rec = b.revenue === 'recorrente', per = rec ? '/mês' : '';
  return (
    <section className="space-y-3" aria-label={`Cesta ${title}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-1.5">
        <p className="text-sm font-semibold text-ink">{title} <span className="font-normal text-muted">· {hint}</span></p>
        <p className="text-xs text-muted">{rec ? <>Mensalidade <b className="num text-ink">{brl(b.monthlyPriceCents ?? null)}/mês</b> · na vigência {brl(b.priceCents)}</> : <>Preço <b className="num text-ink">{brl(b.priceCents)}</b></>} · custo total da cesta <b className="num text-ink">{brl(b.costCents)}</b> · margem líquida <b className={clsx('num', tone(b.netPct, minPct))}>{pct(b.netPct)} · {brl(b.netCents)}</b></p>
      </div>

      <p className="text-xs text-muted">Preço sugerido da cesta <b className="num text-primary">{brl(suggested)}{per}</b> · {known ? 'Margens avaliadas no valor de venda ou lance simulado.' : 'Sem valor de venda: margem líquida apresentada somente para a cesta, no preço sugerido.'}{minPct != null && maxPct != null ? ` Faixa: acima de ${pct(minPct)} e abaixo de ${pct(maxPct)}.` : ''}</p>
      {rec ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Fact k="Custo direto da implantação" v={brl(b.directImplCents)} />
          <Fact k="Despesas fixas (da mensalidade)" v={`${brl(b.lines.reduce((t, l) => t + l.overheadCents, 0))}/mês`} />
          <Fact k="Investimento a recuperar" v={brl(b.investmentCents)} strong />
          <Fact k="Custo mensal" v={`${brl(b.monthlyCostCents)}/mês`} />
          <Fact k="Payback" v={b.paybackMonths != null ? months(b.paybackMonths) : '—'} strong />
          <Fact k="Vigência" v={b.termMonths ? `${b.termMonths} meses` : '—'} />
          <Fact k="Mensalidade" v={`${brl(b.monthlyPriceCents ?? b.priceCents)}/mês`} strong />
          {b.paybackStatus ? <Fact k="Situação" v={b.paybackStatus} /> : null}
        </dl>
      ) : known && !!b.cascade?.length && (
        <div className="grid gap-2 sm:grid-cols-2">
          {b.cascade.map((c) => (
            <p key={c.profile} className="rounded-md bg-surface-2 px-3 py-2 text-sm text-text">
              <b className="text-ink">{COST_PROFILE_SHORT[c.profile]}</b>: contribuição {pct(c.contributionPct)} − despesas fixas {pct(c.overheadPct)} <span className="text-xs text-muted">(sobre o preço)</span> = <b className={tone(c.operatingPct, null)}>operacional {pct(c.operatingPct)}</b>
            </p>
          ))}
        </div>
      )}

      <div className="scroll-thin overflow-x-auto">
        <table className={clsx('w-full text-left text-sm', known ? 'min-w-[1100px]' : 'min-w-[560px]')}>
          <thead className="text-xs text-muted">
            <tr>{['Produto', ...(known ? ['Líquida / negociação'] : []), 'Perfil', rec ? 'Custo na vigência' : 'Custo', 'Peso', ...(known ? ['Valor de venda'] : []), 'Preço sugerido', ...(known || f.mode === 'B' ? [f.mode === 'B' ? 'Lance simulado' : 'Preço avaliado'] : []), ...(known ? ['Contribuição', 'Operacional', 'Piso', 'Desconto máx.', 'Faixa de lance'] : [])].map((h) => <th key={h} className="px-1.5 py-1.5 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>{b.lines.map((l) => <Row key={l.id} l={l} f={f} set={set} disabled={disabled} minPct={minPct} maxPct={maxPct} known={known} per={per} />)}</tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ l, f, set, disabled, minPct, maxPct, known, per }: { l: B2gLine; f: B2gForm; set: (p: Partial<B2gForm>) => void; disabled: boolean; minPct: number | null; maxPct: number | null; known: boolean; per: string }) {
  const wOn = f.weights[l.id] != null;
  return (
    <>
      <tr className="border-t border-line align-middle">
        <td className="min-w-[130px] px-1.5 py-1.5"><span className="font-medium text-ink">{l.description}</span>{l.doc && <span className="block text-2xs text-muted">{l.doc} · {pct(l.taxPct)}</span>}</td>
        {known && <td className={clsx('num px-1.5 py-1.5 font-semibold', tone(l.netPct, minPct))}>{pct(l.netPct)}<ProductAssessment l={l} minPct={minPct} maxPct={maxPct} per={per} /></td>}
        <td className="px-1.5 py-1.5 text-muted">{COST_PROFILE_SHORT[l.profile]}</td>
        <td className="num px-1.5 py-1.5">{brl(l.costCents)}{l.investmentCents != null && <span className="block text-2xs text-muted">invest. {brl(l.investmentCents)}</span>}</td>
        <td className="px-1.5 py-1.5">
          <Input aria-label={`Peso de ${l.description} (%)`} title="Parte do custo da cesta que fica neste produto. Em branco: proporcional ao valor estimado." inputMode="decimal" className={clsx('num h-8 w-[70px]', wOn && 'border-primary')} disabled={disabled}
            placeholder={l.weightPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} value={f.weights[l.id] ?? ''}
            onChange={(e) => { const v = e.target.value.replace(/[^\d,.]/g, '').slice(0, 5); const w = { ...f.weights }; if (v) w[l.id] = v; else delete w[l.id]; set({ weights: w }); }} />
        </td>
        {known && <td className="num px-1.5 py-1.5">{l.priceDefined === false ? 'Não informado' : <>{brl(l.estimatedCents)}{per}</>}</td>}
        <td className="num px-1.5 py-1.5 font-semibold text-primary">{brl(l.suggestedCents)}{per}</td>
        {(known || f.mode === 'B') && <td className="px-1.5 py-1.5">
          {f.mode === 'B' ? (
            <Input aria-label={`Lance de ${l.description}`} inputMode="decimal" className="num h-8 w-[110px]" disabled={disabled} placeholder={money(l.estimatedCents)} value={f.bids[l.id] ?? ''}
              onChange={(e) => { const v = e.target.value.replace(/[^\d,.]/g, ''); const b = { ...f.bids }; if (v) b[l.id] = v; else delete b[l.id]; set({ bids: b }); }} />
          ) : <span className="num font-semibold text-ink">{brl(l.priceCents)}{per}</span>}
          {l.markup != null && <span className="block text-2xs text-muted">markup {l.markup.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×</span>}
        </td>}
        {known && <><td className={clsx('num px-1.5 py-1.5', tone(l.contributionPct, null))}>{pct(l.contributionPct)}</td>
        <td className={clsx('num px-1.5 py-1.5', tone(l.operatingPct, null))}>{pct(l.operatingPct)}{l.overheadCents > 0 && <span className="block text-2xs text-muted">fixas {brl(l.overheadCents)}{per} s/ preço</span>}</td>
        <td className="num px-1.5 py-1.5">{brl(l.floorCents)}{l.floorCents != null && per}</td>
        <td className="num px-1.5 py-1.5">{l.maxDiscountPct == null ? '—' : pct(l.maxDiscountPct)}</td>
        <td className="num whitespace-nowrap px-1.5 py-1.5 text-xs text-muted">{l.bidRange ? `${brl(l.bidRange.from)} a ${brl(l.bidRange.to)}` : '—'}{l.paybackMonths != null && <span className="block">payback {months(l.paybackMonths)}{l.cashPaybackMonths != null ? ` · caixa ${months(l.cashPaybackMonths)}` : ''}</span>}</td></>}
      </tr>
      {known && !!l.alerts.length && <tr><td colSpan={13} className="px-1.5 pb-2 text-xs text-[#C2610C]">{l.alerts.join(' · ')}</td></tr>}
    </>
  );
}

function ProductAssessment({ l, minPct, maxPct, per }: { l: B2gLine; minPct: number | null; maxPct: number | null; per: string }) {
  if (minPct == null || maxPct == null) return <span className="block text-2xs font-normal text-muted">Configure a faixa de margem líquida.</span>;
  if (l.netPct == null || l.priceCents == null) return <span className="block text-2xs font-normal text-muted">Margem não calculada.</span>;
  const low = l.netPct <= minPct, high = l.netPct >= maxPct;
  const room = l.floorCents != null ? Math.max(0, l.priceCents - l.floorCents) : null;
  return <span className="mt-1 block min-w-[160px] text-xs font-normal" aria-label={`Negociação de ${l.description}`}>
    <span className={clsx('block font-semibold', low ? 'text-danger' : high ? 'text-primary' : 'text-success')}>{low ? 'Aumentar preço ou reduzir custo' : high ? 'Reduzir preço: acima da faixa' : 'Manter na faixa'}</span>
    {!low && room != null && l.priceCents > 0 && <span className="mt-0.5 block text-2xs text-muted">Folga até o piso: {brl(room)}{per} · {pct(room / l.priceCents * 100)}</span>}
    {low && l.floorCents != null && <span className="mt-0.5 block text-2xs text-muted">Piso: {brl(l.floorCents)}{per}</span>}
  </span>;
}

function Fact({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div><dt className="text-xs text-muted">{k}</dt><dd className={clsx('num', strong ? 'font-semibold text-ink' : 'text-text')}>{v}</dd></div>;
}

function Consolidated({ r, minPct }: { r: B2gResult; minPct: number | null }) {
  const g = r.global;
  return (
    <div className="space-y-2 rounded-md bg-surface-2 p-3">
      <p className="text-sm font-semibold text-ink">Consolidado <span className="font-normal text-muted">· venda única + mensalidades da vigência</span></p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Fact k="Valor global" v={brl(g.priceCents)} strong />
        <Fact k="Custo total" v={brl(g.costCents)} />
        <Fact k="Markup efetivo (resultado)" v={g.markup != null ? `${g.markup.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×` : '—'} />
        <div><dt className="text-xs text-muted">Margem líquida</dt><dd className={clsx('num font-semibold', tone(g.netPct, minPct))}>{brl(g.netCents)} · {pct(g.netPct)}</dd></div>
        <Fact k="Piso global" v={brl(g.floorCents)} />
        <Fact k="Desconto máximo" v={g.maxDiscountPct == null ? '—' : pct(g.maxDiscountPct)} />
      </dl>
      <ByDoc r={r} />
    </div>
  );
}

function ByDoc({ r }: { r: B2gResult }) {
  if (!r.byDoc.length) return null;
  return <p className="text-xs text-muted">Markup por documento fiscal: {r.byDoc.map((d) => `${d.doc} ${d.markup != null ? `${d.markup.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×` : '—'}`).join(' · ')}</p>;
}
