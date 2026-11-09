/**
 * Bloco interativo do playbook: calculadora de meta da gamificação.
 * Lê a regra aprovada no momento da leitura (nada fixo no playbook): quantas tarefas faltam para chegar a uma meta
 * e um plano com várias tarefas. Mesma conta do cálculo oficial (domínio: taskPointsWith).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Calculator, Scale, Target } from 'lucide-react';
import { planSummary, simulateScore, taskPointsWith, unitsNeeded, type GamificationBonuses } from '@isp/domain';
import { api } from '../../lib/api';
import { Input, Select } from '../../components/ui/primitives';

type Rule =
  | { approved: false }
  | {
    approved: true; version: number;
    myLevel: { key: string; name: string; rank: number; expectedMonthlyPoints: number; scoresTasks: boolean };
    levels: { key: string; name: string; rank: number; expectedMonthlyPoints: number; scoresTasks: boolean; weights: { ownBp: number; teamBp: number; dispersionBp: number; areaBp: number } }[];
    dispersionYellowBp: number; dispersionRedBp: number;
    bonuses: GamificationBonuses;
    journeys: { key: string; name: string; wonPoints: number; tasks: { key: string; name: string; points: number; dueDays: number; level: string | null; levelName: string | null; levelRank: number | null }[] }[];
    events: { key: string; label: string; points: number }[];
    participationMultiplierBp: number;
    support: { helperMultiplierBp: number; basePoints: number; requesterPoints: number; monthlyCapPoints: number } | null;
    yearBands: { name: string; minPoints: number }[];
  };

type Option = { id: string; group: string; name: string; points: number; task: boolean; levelRank: number | null; levelName: string | null };
const pct = (bp: number) => `${(bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const n1 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const num = (s: string) => { const v = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) && v >= 0 ? v : 0; };

type Approved = Extract<Rule, { approved: true }>;
function Shell({ title, icon, children }: { title: string; icon: ReactNode; children: (r: Approved) => ReactNode }) {
  const q = useQuery({ queryKey: ['playbooks', 'gamification-rule'], queryFn: () => api<Rule>('/playbooks/gamification-rule'), staleTime: 60_000 });
  return (
    <section aria-label={title} className="border border-line bg-surface">
      <header className="flex items-center gap-3 border-b border-line bg-navy px-5 py-3 text-white">
        {icon}
        <h3 className="font-display text-base font-bold">{title}</h3>
        {q.data?.approved && <span className="ml-auto text-xs text-white/70">regra vigente · versão {q.data.version}</span>}
      </header>
      {q.isLoading ? <p className="p-5 text-sm text-muted">Carregando a regra vigente…</p>
        : q.isError ? <p className="p-5 text-sm text-danger">Não foi possível carregar a regra da gamificação agora.</p>
        : !q.data!.approved ? <p className="p-5 text-sm text-muted">A regra da gamificação ainda não foi aprovada. Este bloco passa a funcionar assim que uma versão for aprovada em Gestão de Times → Gamificação.</p>
        : children(q.data!)}
    </section>
  );
}

export const GamificationCalcBlock = ({ title }: { title?: string }) => <Shell title={title || 'Calculadora de meta'} icon={<Calculator className="h-5 w-5 text-lime" aria-hidden />}>{(r) => <Calc rule={r} />}</Shell>;
export const GamificationRuleBlock = ({ title }: { title?: string }) => <Shell title={title || 'Regra vigente'} icon={<Scale className="h-5 w-5 text-lime" aria-hidden />}>{(r) => <RuleView rule={r} />}</Shell>;

function Calc({ rule }: { rule: Approved }) {
  const me = rule.myLevel;
  const [levelKey, setLevelKey] = useState(me.key);
  const level = rule.levels.find((l) => l.key === levelKey) ?? me;
  const [target, setTarget] = useState(String(me.expectedMonthlyPoints || 100));
  const [current, setCurrent] = useState('0');
  const [onTime, setOnTime] = useState(true);
  const [adherence, setAdherence] = useState(false);
  const options = useMemo<Option[]>(() => [
    ...rule.journeys.flatMap((j) => j.tasks.filter((t) => t.points > 0).map((t) => ({ id: `t:${j.key}:${t.key}`, group: `Jornada · ${j.name}`, name: t.name, points: t.points, task: true, levelRank: t.levelRank, levelName: t.levelName }))),
    ...rule.events.map((e) => ({ id: `e:${e.key}`, group: 'Eventos de negócio', name: e.label, points: e.points, task: false, levelRank: null, levelName: null })),
  ], [rule]);
  const [pick, setPick] = useState(options[0]?.id ?? '');
  const [qty, setQty] = useState<Record<string, string>>({});

  const each = (o: Option) => (o.task ? taskPointsWith(o.points, { onTime, adherence, levelsAbove: o.levelRank && o.levelRank > level.rank ? o.levelRank - level.rank : 0 }, rule.bonuses) : o.points);
  const T = num(target), C = num(current);
  const sel = options.find((o) => o.id === pick);
  const need = sel ? unitsNeeded(T, C, each(sel)) : null;
  const plan = planSummary(options.map((o) => ({ points: each(o), qty: num(qty[o.id] ?? '') })), T, C);
  const groups = [...new Set(options.map((o) => o.group))];
  const cap = (level.expectedMonthlyPoints * rule.bonuses.scoreCapBp) / 10_000;

  if (!options.length) return <p className="p-5 text-sm text-muted">A regra aprovada ainda não tem tarefas de jornada nem eventos com pontos.</p>;
  return (
    <div className="space-y-6 p-5">
      {/* 1. a meta */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm"><span className="font-semibold text-ink">Nível de competência</span>
          <Select aria-label="Nível de competência" value={levelKey} onChange={(e) => setLevelKey(e.target.value)}>{rule.levels.map((l) => <option key={l.key} value={l.key}>{l.name}{l.key === me.key ? ' (o seu)' : ''}</option>)}</Select>
        </label>
        <label className="space-y-1 text-sm"><span className="font-semibold text-ink">Quero chegar a (pontos)</span>
          <Input aria-label="Quero chegar a (pontos)" inputMode="decimal" className="num" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm"><span className="font-semibold text-ink">Já tenho (pontos)</span>
          <Input aria-label="Já tenho (pontos)" inputMode="decimal" className="num" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
      </div>
      {level.scoresTasks ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Atalhos:</span>
          <button type="button" className="border border-line px-3 py-1 font-semibold text-ink hover:border-primary" onClick={() => setTarget(String(level.expectedMonthlyPoints))}>Meta do mês ({n1(level.expectedMonthlyPoints)})</button>
          <button type="button" className="border border-line px-3 py-1 font-semibold text-ink hover:border-primary" onClick={() => setTarget(String(level.expectedMonthlyPoints * 12))}>Meta do ano ({n1(level.expectedMonthlyPoints * 12)})</button>
          <button type="button" className="border border-line px-3 py-1 font-semibold text-ink hover:border-primary" onClick={() => setTarget(String(cap))}>Teto do mês ({n1(cap)})</button>
        </div>
      ) : <p className="border-l-4 border-primary bg-primary-soft px-3 py-2 text-sm text-ink">Este nível não pontua tarefas próprias: a nota vem do time e da área. A calculadora serve para planejar com o time.</p>}

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={onTime} onChange={(e) => setOnTime(e.target.checked)} />Concluir no prazo (+{pct(rule.bonuses.onTimeBp)})</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={adherence} onChange={(e) => setAdherence(e.target.checked)} />Qualificada pela gerência (+{pct(rule.bonuses.adherenceBp)})</label>
      </div>

      {/* 2. uma tarefa só */}
      <div className="space-y-3 border border-line p-4">
        <h4 className="flex items-center gap-2 font-bold text-ink"><Target className="h-4 w-4 text-primary" aria-hidden />Quantas vezes eu preciso fazer…</h4>
        <Select aria-label="Tarefa ou evento" value={pick} onChange={(e) => setPick(e.target.value)}>
          {groups.map((g) => <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map((o) => <option key={o.id} value={o.id}>{o.name} · {n1(o.points)} pts</option>)}</optgroup>)}
        </Select>
        {sel && need !== null && (
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2" aria-live="polite">
            <p><span className="num font-display text-4xl font-bold text-primary" data-testid="calc-need">{need.toLocaleString('pt-BR')}</span> <span className="text-sm text-muted">{need === 1 ? 'vez' : 'vezes'}</span></p>
            <p className="text-sm text-muted">{n1(each(sel))} pontos cada · faltam {n1(Math.max(0, T - C))} pontos</p>
          </div>
        )}
        {sel?.task && sel.levelRank && sel.levelRank > level.rank && <p className="text-xs text-muted">Tarefa de nível acima ({sel.levelName}): conta como crédito extra, +{pct(rule.bonuses.extraPerLevelBp)} por nível, com teto de {pct(rule.bonuses.extraCapBp)} na nota do mês.</p>}
        {!sel?.task && sel && <p className="text-xs text-muted">Eventos não têm bônus de prazo nem de qualificação. Ajudar na venda de um colega rende {n1(rule.participationMultiplierBp / 10_000)}x a sua parte.</p>}
      </div>

      {/* 3. plano com várias tarefas */}
      <div className="space-y-3 border border-line p-4">
        <h4 className="font-bold text-ink">Monte o seu plano</h4>
        <p className="text-sm text-muted">Coloque quantas vezes pretende fazer cada tarefa. O total soma ao que você já tem.</p>
        <div className="max-h-[420px] overflow-y-auto border border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface-2 text-xs font-semibold text-muted"><tr><th className="px-3 py-2">Tarefa ou evento</th><th className="px-3 py-2 text-right">Pontos cada</th><th className="w-28 px-3 py-2">Quantidade</th><th className="px-3 py-2 text-right">Subtotal</th></tr></thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr className="border-t border-line bg-surface-2/60"><th colSpan={4} className="px-3 py-1.5 text-xs font-semibold text-ink">{g}</th></tr>
                {options.filter((o) => o.group === g).map((o) => {
                  const k = num(qty[o.id] ?? '');
                  return (
                    <tr key={o.id} className="border-t border-line">
                      <td className="px-3 py-1.5">{o.name}</td>
                      <td className="num px-3 py-1.5 text-right">{n1(each(o))}</td>
                      <td className="px-3 py-1"><Input aria-label={`Quantidade de ${o.name}`} inputMode="numeric" className="num h-8" value={qty[o.id] ?? ''} placeholder="0" onChange={(e) => setQty({ ...qty, [o.id]: e.target.value.replace(/\D/g, '') })} /></td>
                      <td className="num px-3 py-1.5 text-right">{k ? n1(each(o) * Math.floor(k)) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
        <div aria-label="Resultado do plano" className="space-y-2">
          <div className="h-3 w-full border border-line bg-surface-2"><div className={clsx('h-full', plan.reached ? 'bg-[#15803D]' : 'bg-primary')} style={{ width: `${Math.min(100, plan.pct)}%` }} /></div>
          <p className="text-sm" aria-live="polite">
            <span className="num font-semibold text-ink">{n1(plan.total)}</span> de <span className="num">{n1(T)}</span> pontos ({n1(plan.pct)}%) · {plan.reached ? <strong className="text-[#15803D]">meta alcançada</strong> : <>faltam <strong className="num text-ink">{n1(plan.missing)}</strong></>}
          </p>
        </div>
      </div>

      <p className="text-xs text-muted">
        Calculado com a regra aprovada (versão {rule.version}). Pontos de neg&oacute;cio ganho ({rule.journeys.map((j) => `${j.name}: ${n1(j.wonPoints)}`).join('; ') || 'sem peso'}) são divididos entre quem fez tarefas na oportunidade e não entram na conta acima.
        {' '}Na nota, o atingimento do mês tem teto de {pct(rule.bonuses.scoreCapBp)} da meta do nível{rule.support ? `; pontos de Pedido de Apoio têm teto de ${n1(rule.support.monthlyCapPoints)} por mês` : ''}.
      </p>
    </div>
  );
}

const WEIGHT_PARTS = [['ownBp', 'Próprio', 'bg-primary'], ['teamBp', 'Time', 'bg-[#5B8DB8]'], ['dispersionBp', 'Nivelamento', 'bg-lime'], ['areaBp', 'Área', 'bg-navy']] as const;
const TABS = [['niveis', 'Níveis e nota'], ['pontos', 'Como pontuar'], ['simulador', 'Simular minha nota'], ['lideranca', 'Liderança e faixas']] as const;

function RuleView({ rule }: { rule: Approved }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('niveis');
  return (
    <div>
      <div role="tablist" aria-label="Partes da regra" className="flex flex-wrap border-b border-line">
        {TABS.map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx('border-b-2 px-4 py-2.5 text-sm font-semibold', tab === k ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}>{l}</button>)}
      </div>
      <div role="tabpanel" className="space-y-4 p-5">
        {tab === 'niveis' && <Levels rule={rule} />}
        {tab === 'pontos' && <Points rule={rule} />}
        {tab === 'simulador' && <Simulator rule={rule} />}
        {tab === 'lideranca' && <Leadership rule={rule} />}
      </div>
    </div>
  );
}

function Levels({ rule }: { rule: Approved }) {
  return (
    <>
      <p className="text-sm text-muted">Cada pessoa é medida contra a meta do próprio nível. Quanto mais alto o nível, mais a nota depende do time e da área. Seu nível: <strong className="text-ink">{rule.myLevel.name}</strong>.</p>
      <div className="overflow-x-auto border border-line"><table className="w-full text-left text-sm">
        <thead className="bg-surface-2 text-xs font-semibold text-muted"><tr><th className="px-3 py-2">Nível</th><th className="px-3 py-2 text-right">Meta do mês</th><th className="px-3 py-2">Composição da nota</th></tr></thead>
        <tbody>{rule.levels.map((l) => (
          <tr key={l.key} className={clsx('border-t border-line', l.key === rule.myLevel.key && 'bg-primary-soft')}>
            <td className="px-3 py-2 font-semibold text-ink">{l.name}{l.key === rule.myLevel.key && <span className="ml-2 text-xs font-normal text-primary">você</span>}</td>
            <td className="num px-3 py-2 text-right">{l.scoresTasks ? `${n1(l.expectedMonthlyPoints)} pts` : 'não pontua tarefas'}</td>
            <td className="min-w-[260px] px-3 py-2">
              <div className="flex h-3 w-full" aria-hidden>{WEIGHT_PARTS.map(([k, , c]) => l.weights[k] ? <div key={k} className={c} style={{ width: `${l.weights[k] / 100}%` }} /> : null)}</div>
              <p className="mt-1 text-xs text-muted">{WEIGHT_PARTS.filter(([k]) => l.weights[k]).map(([k, lab]) => `${lab} ${pct(l.weights[k])}`).join(' · ')}</p>
            </td>
          </tr>
        ))}</tbody>
      </table></div>
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        <li className="border-l-4 border-primary pl-3"><strong className="text-ink">Próprio:</strong> pontos do mês ÷ meta do nível (teto de {pct(rule.bonuses.scoreCapBp)}) + crédito extra (teto de {pct(rule.bonuses.extraCapBp)}).</li>
        <li className="border-l-4 border-[#5B8DB8] pl-3"><strong className="text-ink">Time:</strong> média do “próprio” de quem é do time (a gerência não entra na média).</li>
        <li className="border-l-4 border-lime pl-3"><strong className="text-ink">Nivelamento:</strong> 100 com o time nivelado; cai a 0 quando a dispersão chega a {pct(rule.dispersionRedBp)}.</li>
        <li className="border-l-4 border-navy pl-3"><strong className="text-ink">Área:</strong> média do “próprio” de todos os participantes.</li>
      </ul>
    </>
  );
}

function Points({ rule }: { rule: Approved }) {
  const [open, setOpen] = useState<string | null>(rule.journeys[0]?.key ?? null);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {[['No prazo', `+${pct(rule.bonuses.onTimeBp)}`, 'tarefa da jornada concluída até o prazo'], ['Qualificada', `+${pct(rule.bonuses.adherenceBp)}`, 'quando a gerência qualifica a tarefa (opcional; reprovar não tira pontos)'], ['Acima do nível', `+${pct(rule.bonuses.extraPerLevelBp)}`, `por nível acima; vira crédito extra, teto de ${pct(rule.bonuses.extraCapBp)} na nota`]].map(([a, b, c]) => (
          <div key={a} className="border border-line p-3"><p className="text-xs text-muted">{a}</p><p className="num font-display text-2xl font-bold text-primary">{b}</p><p className="text-xs text-muted">{c}</p></div>
        ))}
      </div>
      <h4 className="font-bold text-ink">Jornadas de venda</h4>
      {!rule.journeys.length ? <p className="text-sm text-muted">Nenhuma jornada cadastrada na regra vigente.</p> : (
        <div className="divide-y divide-line border border-line">{rule.journeys.map((j) => (
          <div key={j.key}>
            <button type="button" aria-expanded={open === j.key} onClick={() => setOpen(open === j.key ? null : j.key)} className="flex w-full items-center justify-between px-4 py-3 text-left font-semibold text-ink hover:bg-surface-2"><span>{j.name}</span><span className="text-xs font-normal text-muted">{j.tasks.length} tarefa(s) · ganho: {n1(j.wonPoints)} pts divididos</span></button>
            {open === j.key && <table className="w-full text-left text-sm"><thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-4 py-1.5">Tarefa</th><th className="px-4 py-1.5 text-right">Pontos</th><th className="px-4 py-1.5 text-right">Prazo</th><th className="px-4 py-1.5">Alçada</th></tr></thead>
              <tbody>{j.tasks.map((t) => <tr key={t.key} className="border-t border-line"><td className="px-4 py-1.5">{t.name}</td><td className="num px-4 py-1.5 text-right">{n1(t.points)}</td><td className="num px-4 py-1.5 text-right">{t.dueDays ? `${t.dueDays} dia(s)` : '—'}</td><td className="px-4 py-1.5 text-muted">{t.levelName ?? 'qualquer nível'}</td></tr>)}</tbody></table>}
          </div>
        ))}</div>
      )}
      <h4 className="font-bold text-ink">Eventos de negócio</h4>
      <div className="overflow-x-auto border border-line"><table className="w-full text-left text-sm"><tbody>{rule.events.map((e) => <tr key={e.key} className="border-t border-line first:border-t-0"><td className="px-3 py-1.5">{e.label}</td><td className="num px-3 py-1.5 text-right font-semibold">{n1(e.points)} pts</td></tr>)}</tbody></table></div>
      <p className="text-sm text-muted">Ajudou na venda de um colega? A sua parte vale {n1(rule.participationMultiplierBp / 10_000)}x.{rule.support ? ` Pedido de Apoio: quem ajuda ganha ${n1(rule.support.helperMultiplierBp / 10_000)}x os pontos da tarefa (ou ${n1(rule.support.basePoints)} pts × ${n1(rule.support.helperMultiplierBp / 10_000)} sem tarefa); quem pede ganha ${n1(rule.support.requesterPoints)} pt por apoio confirmado; teto de ${n1(rule.support.monthlyCapPoints)} pts de apoio por mês.` : ''}</p>
    </>
  );
}

function Simulator({ rule }: { rule: Approved }) {
  const [key, setKey] = useState(rule.myLevel.key);
  const l = rule.levels.find((x) => x.key === key) ?? rule.levels[0]!;
  const [v, setV] = useState({ regular: String(l.expectedMonthlyPoints || 100), extra: '0', team: '100', disp: '20', area: '100' });
  const s = simulateScore({ level: l, bonuses: rule.bonuses, dispersionRedBp: rule.dispersionRedBp, regular: num(v.regular), extra: num(v.extra), teamAverage: num(v.team), dispersionPct: l.weights.dispersionBp ? num(v.disp) : null, area: num(v.area) });
  const f = (k: keyof typeof v, label: string, hint: string, show = true) => show && (
    <label className="space-y-1 text-sm"><span className="font-semibold text-ink">{label}</span><Input aria-label={label} inputMode="decimal" className="num" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /><span className="block text-xs text-muted">{hint}</span></label>
  );
  return (
    <>
      <p className="text-sm text-muted">Mude os números e veja a nota do mês com a mesma conta do sistema.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm"><span className="font-semibold text-ink">Nível</span><Select aria-label="Nível para simular" value={key} onChange={(e) => setKey(e.target.value)}>{rule.levels.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</Select></label>
        {f('regular', 'Pontos do mês', `meta do nível: ${n1(l.expectedMonthlyPoints)}`, l.scoresTasks)}
        {f('extra', 'Crédito extra (pontos)', 'tarefas acima do seu nível', l.scoresTasks)}
        {f('team', 'Média do time (%)', 'atingimento médio do time', !!l.weights.teamBp)}
        {f('disp', 'Dispersão do time (%)', `verde abaixo de ${pct(rule.dispersionYellowBp)}`, !!l.weights.dispersionBp)}
        {f('area', 'Resultado da área (%)', 'média de todos os participantes', !!l.weights.areaBp)}
      </div>
      {(() => {
        const cards = ([['Atingimento', s.attainment, l.scoresTasks], ['Crédito extra', s.extraAttainment, l.scoresTasks], ['Próprio', s.own, l.scoresTasks], ['Nivelamento', s.dispersion, !!l.weights.dispersionBp]] as [string, number, boolean][]).filter(([, , show]) => show);
        return cards.length ? <div className="grid gap-px border border-line bg-line" style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }} aria-live="polite">{cards.map(([a, b]) => <div key={a} className="bg-surface p-3"><p className="text-xs text-muted">{a}</p><p className="num text-xl font-bold text-ink">{n1(b)}%</p></div>)}</div> : null;
      })()}
      <div className="flex items-baseline gap-3 border-l-4 border-lime bg-navy px-4 py-3 text-white"><span className="text-sm text-white/75">Nota do mês</span><span className="num font-display text-3xl font-bold" data-testid="sim-score">{n1(s.score)}</span><span className="text-sm text-white/75">{bandOf(rule, s.score)}</span></div>
    </>
  );
}
const bandOf = (rule: Approved, score: number) => { const b = [...rule.yearBands].reverse().find((x) => score >= x.minPoints); return b ? `faixa ${b.name} (se fosse a média do ano)` : ''; };

function Leadership({ rule }: { rule: Approved }) {
  return (
    <>
      <p className="text-sm text-muted">A dispersão mostra o quanto os resultados das pessoas do time estão distantes entre si. Time nivelado é sinal de boa liderança; poucos carregando o resultado é um problema de gestão.</p>
      <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
        <div className="bg-surface p-3"><p className="font-bold text-[#15803D]">Verde</p><p className="text-sm text-muted">abaixo de {pct(rule.dispersionYellowBp)}: time nivelado</p></div>
        <div className="bg-surface p-3"><p className="font-bold text-[#9A6B00]">Amarelo</p><p className="text-sm text-muted">de {pct(rule.dispersionYellowBp)} a {pct(rule.dispersionRedBp)}: gente ficando para trás</p></div>
        <div className="bg-surface p-3"><p className="font-bold text-danger">Vermelho</p><p className="text-sm text-muted">{pct(rule.dispersionRedBp)} ou mais: agir já</p></div>
      </div>
      <h4 className="font-bold text-ink">Faixas do ano</h4>
      <div className="flex flex-wrap gap-px border border-line bg-line">{rule.yearBands.map((b) => <div key={b.name} className="min-w-[120px] flex-1 bg-surface p-3"><p className="font-bold text-ink">{b.name}</p><p className="num text-sm text-muted">a partir de {n1(b.minPoints)}</p></div>)}</div>
      <p className="text-sm text-muted">Todos podem chegar à mesma faixa: ela não depende de ninguém ficar abaixo. Não existe ranking nem pódio; só a maior nota do ano recebe o <strong className="text-ink">Selo BK de Qualidade</strong> (empate: todos os empatados).</p>
    </>
  );
}
