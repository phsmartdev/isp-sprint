/**
 * Tempo em cada etapa e conversão do funil, a partir do histórico de mudanças de etapa (append-only).
 *
 * Tempo: soma de todas as passagens pela etapa (quem volta para uma etapa soma de novo); a etapa atual
 * conta até agora. Ganha e perdida não contam tempo.
 * Conversão por coorte: oportunidades criadas no período e até onde chegaram. Quem pulou etapas passou
 * por elas; quem foi ganha passou por todas.
 */
export type StageMove = { at: string; to: string };
export type FunnelStage = { key: string; name: string; kind: string; position: number };
export type StageTime = { key: string; days: number; visits: number; firstAt: string; current: boolean };

const DAY = 86_400_000;
const CLOSED = (k: string) => k === 'ganha' || k === 'perdida';

/** Tempo em cada etapa por onde a oportunidade passou, em dias (fração), na ordem da primeira passagem. */
export function stageTimes(moves: StageMove[], now: string): StageTime[] {
  const ms = [...moves].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const out = new Map<string, StageTime>();
  ms.forEach((m, i) => {
    const next = ms[i + 1];
    const end = next ? next.at : now;
    const span = CLOSED(m.to) ? 0 : Math.max(0, (Date.parse(end) - Date.parse(m.at)) / DAY);
    const cur = out.get(m.to);
    if (cur && ms[i - 1]?.to === m.to) { cur.days += span; return; } // registro repetido da mesma etapa
    if (cur) { cur.days += span; cur.visits += 1; } else out.set(m.to, { key: m.to, days: span, visits: 1, firstAt: m.at, current: false });
  });
  const last = ms[ms.length - 1];
  if (last) out.get(last.to)!.current = true;
  return [...out.values()];
}

export type FunnelOpp = { moves: StageMove[]; stage: string };
export type FunnelRow = {
  key: string; name: string; reached: number; advanced: number; lostHere: number; here: number;
  conversion: number | null; ofTotal: number | null; avgDays: number | null; medianDays: number | null; samples: number;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Conversão de cada etapa para a seguinte, perda por etapa e tempo médio/mediano em cada uma. */
export function funnelConversion(stages: FunnelStage[], opps: FunnelOpp[], now: string) {
  const open = stages.filter((s) => s.kind === 'open').sort((a, b) => a.position - b.position);
  const pos = new Map(open.map((s, i) => [s.key, i]));
  const facts = opps.map((o) => {
    const times = stageTimes(o.moves, now);
    const won = o.stage === 'ganha';
    const lost = o.stage === 'perdida';
    const visited = times.map((t) => pos.get(t.key)).filter((x): x is number => x !== undefined);
    const maxPos = won ? open.length - 1 : visited.length ? Math.max(...visited) : 0;
    // perdida: sai da etapa em que estava antes de perder
    const ms = [...o.moves].sort((a, b) => (a.at < b.at ? -1 : 1)).filter((m) => !CLOSED(m.to));
    const lostAt = lost ? pos.get(ms[ms.length - 1]?.to ?? '') ?? maxPos : null;
    return { times, won, lost, maxPos, lostAt, currentPos: !won && !lost ? pos.get(o.stage) ?? null : null };
  });
  const rows: FunnelRow[] = open.map((s, i) => {
    const reached = facts.filter((f) => f.maxPos >= i).length;
    const advanced = facts.filter((f) => f.won || f.maxPos > i).length;
    const lostHere = facts.filter((f) => f.lostAt === i).length;
    const here = facts.filter((f) => f.currentPos === i).length;
    const days = facts.map((f) => f.times.find((t) => t.key === s.key)?.days).filter((d): d is number => d !== undefined);
    return {
      key: s.key, name: s.name, reached, advanced, lostHere, here,
      conversion: reached ? advanced / reached : null,
      ofTotal: facts.length ? reached / facts.length : null,
      avgDays: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null,
      medianDays: median(days), samples: days.length,
    };
  });
  const total = facts.length;
  const won = facts.filter((f) => f.won).length;
  const lost = facts.filter((f) => f.lost).length;
  const cycles = opps.flatMap((o) => {
    if (o.stage !== 'ganha') return [];
    const ms = [...o.moves].sort((a, b) => (a.at < b.at ? -1 : 1));
    const w = [...ms].reverse().find((m) => m.to === 'ganha');
    return ms[0] && w ? [(Date.parse(w.at) - Date.parse(ms[0].at)) / DAY] : [];
  });
  return {
    rows,
    total, won, lost, open: total - won - lost,
    conversion: total ? won / total : null,
    winRate: won + lost ? won / (won + lost) : null,
    avgCycleDays: cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null,
    medianCycleDays: median(cycles),
  };
}
