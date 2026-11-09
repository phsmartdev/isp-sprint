/**
 * Badges da gamificação: Humanização, Excelência, Dinamismo, Crescimento e Compromisso.
 * Cada badge soma os pontos do ano de origens específicas (regra aprovada) e tem faixas por pontos mínimos.
 * Sem ranking: todos podem chegar a todas as faixas.
 */
import { useId } from 'react';
import clsx from 'clsx';
import { BADGE_BASE_SOURCES, BUSINESS_EVENT_TYPES, DEFAULT_BADGES, badgeSourceLabel, type BadgeDef, type BadgeKey, type BadgeProgress } from '@isp/domain';
import { FormField, Input } from '../../components/ui/primitives';
import { fmtPts } from './Gamification';

/** Cor por faixa: sem faixa (cinza), 1ª (azul claro), 2ª (azul BKT), 3ª em diante (grafite com detalhe lima). */
const TIER_FILL = ['#8FA9C4', '#2F5986', '#2D3339', '#2D3339', '#2D3339'];
const LIME = '#B5D334';

const GLYPH: Record<BadgeKey, string> = {
  // coração
  humanizacao: 'M50 76 L28 54 C20 46 22 34 32 31 C39 29 45 32 50 39 C55 32 61 29 68 31 C78 34 80 46 72 54 Z',
  // estrela
  excelencia: 'M50 26 L57 43 L75 44 L61 56 L66 74 L50 64 L34 74 L39 56 L25 44 L43 43 Z',
  // raio
  dinamismo: 'M56 24 L34 54 L48 54 L42 78 L66 46 L52 46 Z',
  // seta subindo
  crescimento: 'M27 70 L45 52 L54 61 L67 46 L67 56 L73 56 L73 34 L51 34 L51 40 L61 40 L54 48 L45 39 L23 61 Z',
  // escudo com visto
  compromisso: 'M50 24 L72 32 L72 50 C72 63 62 72 50 78 C38 72 28 63 28 50 L28 32 Z',
};

export function BadgeIcon({ badgeKey, tierIndex, size = 56, label }: { badgeKey: BadgeKey; tierIndex: number | null; size?: number; label?: string }) {
  const id = useId().replace(/:/g, '');
  const locked = tierIndex === null;
  const fill = locked ? '#E3E7EB' : TIER_FILL[Math.min(tierIndex, TIER_FILL.length - 1)]!;
  const glyph = locked ? '#9AA3AD' : '#FFFFFF';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={label ?? `Badge ${badgeKey}`}>
      <title>{label ?? `Badge ${badgeKey}`}</title>
      <defs><clipPath id={`c${id}`}><polygon points="50,4 90,27 90,73 50,96 10,73 10,27" /></clipPath></defs>
      <polygon points="50,4 90,27 90,73 50,96 10,73 10,27" fill={fill} stroke={locked ? '#C9CED4' : '#1F3D5E'} strokeWidth="3" />
      {!locked && tierIndex >= 2 && <rect x="0" y="86" width="100" height="14" fill={LIME} clipPath={`url(#c${id})`} />}
      <path d={GLYPH[badgeKey]} fill={glyph} />
      {badgeKey === 'compromisso' && <path d="M40 51 L47 58 L61 43" fill="none" stroke={locked ? '#E3E7EB' : fill} strokeWidth="5" strokeLinecap="square" />}
      {!locked && <g>{Array.from({ length: tierIndex + 1 }, (_, i) => <rect key={i} x={50 - (tierIndex + 1) * 5 + i * 10 + 1.5} y="10" width="7" height="5" fill={LIME} />)}</g>}
    </svg>
  );
}

/** Minhas badges do ano: faixa alcançada, quanto falta para a próxima e de onde vieram os pontos. */
export function MyBadges({ badges, year, compact }: { badges: BadgeProgress[]; year: number; compact?: boolean }) {
  if (!badges.length) return null;
  return (
    <section aria-label="Minhas badges" className="card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-ink">Minhas badges em {year}</h2>
        <p className="text-xs text-muted">Pontos do ano em cada dimensão. Todos podem chegar a todas as faixas.</p>
      </div>
      <ul className={clsx('grid gap-3', compact ? 'sm:grid-cols-2 lg:grid-cols-5' : 'sm:grid-cols-2 xl:grid-cols-5')}>
        {badges.map((b) => {
          const top = b.tiers[b.tiers.length - 1]!.minPoints;
          const pct = Math.min(100, (b.points / top) * 100);
          return (
            <li key={b.key} aria-label={`Badge ${b.name}`} className="flex flex-col border border-line p-3">
              <div className="flex items-center gap-3">
                <BadgeIcon badgeKey={b.key} tierIndex={b.tierIndex} size={48} label={`Badge ${b.name}${b.tier ? `: ${b.tier}` : ': ainda sem faixa'}`} />
                <div className="min-w-0">
                  <p className="font-display text-base font-bold leading-tight text-ink">{b.name}</p>
                  <p className={clsx('text-sm font-semibold', b.tier ? 'text-primary' : 'text-muted')}>{b.tier ?? 'Ainda sem faixa'}</p>
                </div>
              </div>
              <p className="mt-2 text-sm"><span className="num font-bold text-ink">{fmtPts(b.points)}</span> <span className="text-muted">pts no ano</span></p>
              <div className="relative mt-1 h-2 bg-line" aria-hidden>
                <div className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${pct}%` }} />
                {b.tiers.map((t) => <span key={t.name} className="absolute inset-y-0 w-0.5 bg-surface" style={{ left: `${(t.minPoints / top) * 100}%` }} />)}
              </div>
              <p className="mt-1 text-xs text-muted">{b.next ? `Faltam ${fmtPts(b.next.missing)} pts para ${b.next.name.toLowerCase()} (${fmtPts(b.next.minPoints)})` : 'Faixa mais alta alcançada'}</p>
              {!compact && <p className="mt-2 text-xs text-muted">{b.description}</p>}
              {b.parts.length > 0 && (
                <details className="mt-auto pt-2 text-xs">
                  <summary className="cursor-pointer font-semibold text-primary">De onde vieram</summary>
                  <ul className="mt-1 space-y-0.5">{b.parts.map((p) => <li key={p.source} className="flex justify-between gap-2"><span className="text-muted">{p.label}</span><span className="num font-semibold">{fmtPts(p.points)}</span></li>)}</ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** As regras de cada badge (o que reconhece, o que soma e as faixas), para leitura. */
export function BadgeRules({ badges }: { badges: BadgeDef[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {badges.map((b) => (
        <article key={b.key} aria-label={`Regra do badge ${b.name}`} className="border border-line p-3 text-sm">
          <div className="flex items-center gap-3">
            <BadgeIcon badgeKey={b.key} tierIndex={1} size={40} label={`Badge ${b.name}`} />
            <h3 className="font-display text-base font-bold text-ink">Badge {b.name}</h3>
          </div>
          <p className="mt-2 text-muted">{b.description}</p>
          <p className="mt-2 font-semibold text-ink">Soma os pontos de</p>
          <ul className="mt-0.5 list-disc pl-4 text-muted">{b.sources.map((s) => <li key={s}>{badgeSourceLabel(s)}</li>)}</ul>
          <p className="mt-2 font-semibold text-ink">Faixas (pontos no ano)</p>
          <ul className="mt-1 space-y-1">
            {b.tiers.map((t, i) => (
              <li key={t.name} className="flex items-center gap-2"><BadgeIcon badgeKey={b.key} tierIndex={i} size={22} label={`${b.name}: ${t.name}`} /><span className="flex-1">{t.name}</span><span className="num font-semibold text-ink">{fmtPts(t.minPoints)}+</span></li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

/** Editor dos badges na proposta da regra: nome, descrição, origens (cada uma num só badge) e faixas. */
export function BadgeRuleEditor<T extends { badges?: BadgeDef[] }>({ v, setV }: { v: T; setV: (x: T) => void }) {
  const on = !!v.badges;
  const list = v.badges ?? DEFAULT_BADGES;
  const setB = (i: number, b: BadgeDef) => setV({ ...v, badges: list.map((x, k) => (k === i ? b : x)) });
  const owner = (src: string) => list.find((b) => b.sources.includes(src));
  const n = (x: string) => Math.round(Number(x.replace(/\D/g, '') || 0));
  const sources = [...BADGE_BASE_SOURCES.map((s) => s.key as string), ...BUSINESS_EVENT_TYPES.map((t) => `evento:${t.key}`)];
  return (
    <fieldset className="mt-4 border border-line p-3">
      <legend className="px-1 text-sm font-semibold text-ink">Badges</legend>
      <label className="mb-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={on} onChange={(e) => setV({ ...v, badges: e.target.checked ? structuredClone(DEFAULT_BADGES) : undefined })} />Usar as badges (Humanização, Excelência, Dinamismo, Crescimento e Compromisso)</label>
      <p className="mb-2 text-xs text-muted">Cada badge soma, no ano, os pontos das origens marcadas; cada origem conta numa badge só. As faixas são pelos pontos mínimos do badge. As badges não mudam a nota.</p>
      {on && list.map((b, i) => (
        <details key={b.key} className="mb-2 border border-line p-2" open={i === 0}>
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink"><BadgeIcon badgeKey={b.key} tierIndex={1} size={24} label={b.name} />Badge {b.name}<span className="ml-auto text-xs font-normal text-muted">{b.sources.length} origens · {b.tiers.map((t) => t.minPoints).join(' / ')} pts</span></summary>
          <div className="mt-2 grid gap-3 md:grid-cols-[200px_minmax(0,1fr)]">
            <FormField label="Nome" htmlFor={`bd-n-${b.key}`}><Input id={`bd-n-${b.key}`} value={b.name} maxLength={40} onChange={(e) => setB(i, { ...b, name: e.target.value })} /></FormField>
            <FormField label="O que reconhece" htmlFor={`bd-d-${b.key}`}><Input id={`bd-d-${b.key}`} value={b.description} maxLength={400} onChange={(e) => setB(i, { ...b, description: e.target.value })} /></FormField>
          </div>
          <p className="mt-2 text-xs font-semibold text-ink">Faixas (pontos mínimos no ano)</p>
          <div className="mt-1 flex flex-wrap items-end gap-2">
            {b.tiers.map((t, k) => (
              <div key={k} className="flex items-end gap-1">
                <FormField label={`Faixa ${k + 1}`} htmlFor={`bd-t-${b.key}-${k}`}><Input id={`bd-t-${b.key}-${k}`} className="w-32" value={t.name} maxLength={30} onChange={(e) => setB(i, { ...b, tiers: b.tiers.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} /></FormField>
                <FormField label="Mínimo" htmlFor={`bd-m-${b.key}-${k}`}><Input id={`bd-m-${b.key}-${k}`} inputMode="numeric" className="num w-20" value={String(t.minPoints)} onChange={(e) => setB(i, { ...b, tiers: b.tiers.map((x, j) => (j === k ? { ...x, minPoints: n(e.target.value) } : x)) })} /></FormField>
                {b.tiers.length > 1 && <button type="button" className="mb-1 text-xs text-danger hover:underline" onClick={() => setB(i, { ...b, tiers: b.tiers.filter((_, j) => j !== k) })}>Tirar</button>}
              </div>
            ))}
            {b.tiers.length < 5 && <button type="button" className="mb-1 text-xs font-semibold text-primary hover:underline" onClick={() => setB(i, { ...b, tiers: [...b.tiers, { name: `Faixa ${b.tiers.length + 1}`, minPoints: (b.tiers[b.tiers.length - 1]?.minPoints ?? 0) * 2 || 10 }] })}>Adicionar faixa</button>}
          </div>
          <p className="mt-2 text-xs font-semibold text-ink">Origens dos pontos</p>
          <div className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
            {sources.map((s) => {
              const o = owner(s);
              const taken = o && o.key !== b.key;
              return (
                <label key={s} className={clsx('flex items-start gap-1.5 text-xs', taken && 'text-muted')}>
                  <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-primary" checked={b.sources.includes(s)} disabled={!!taken}
                    onChange={(e) => setB(i, { ...b, sources: e.target.checked ? [...b.sources, s] : b.sources.filter((x) => x !== s) })} />
                  <span>{badgeSourceLabel(s)}{taken && ` (em ${o!.name})`}</span>
                </label>
              );
            })}
          </div>
        </details>
      ))}
    </fieldset>
  );
}
