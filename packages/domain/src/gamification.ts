/**
 * Gestão de Times → Gamificação colaborativa do time comercial.
 * - Pontos vêm dos eventos de negócio válidos e creditados (Desempenho): pontos do tipo × participação no crédito.
 * - Ajudar vale mais: o crédito de participação (quem ajudou na venda do colega) tem multiplicador próprio.
 * - O time pesa na nota de cada pessoa, com pesos por hierarquia: nota = individual × peso próprio + média do time × peso do time
 *   (ex.: liderança pesa mais o time). A regra só vale depois de aprovada.
 * - Dispersão (coeficiente de variação das notas individuais do time) é indicador da liderança: alta = problema.
 * Todos os números (pontos, pesos, faixas, níveis) vêm das configurações; nada fixo no cálculo.
 */

export type GamificationSettings = {
  /** times que participam (vazio = todos os times ativos) */
  teamIds: string[];
  /** pontos por tipo de evento de negócio (chave do catálogo de eventos) */
  points: Record<string, number>;
  /** multiplicador do crédito de participação (ajuda na venda de colega), em bp: 10000 = igual ao direto */
  participationMultiplierBp: number;
  /** pesos da nota por hierarquia (próprio + time = 100%), em bp */
  hierarchyWeights: Record<GamificationRole, { ownBp: number; teamBp: number }>;
  /** dispersão (CV) a partir da qual vira atenção / problema, em bp */
  dispersionYellowBp: number;
  dispersionRedBp: number;
  /** níveis pela nota no ano (ordem crescente de mínimo) */
  levels: { name: string; minPoints: number }[];
};

export const GAMIFICATION_ROLES = ['colaborador', 'lideranca'] as const;
export type GamificationRole = (typeof GAMIFICATION_ROLES)[number];
export const GAMIFICATION_ROLE_LABELS: Record<GamificationRole, string> = { colaborador: 'Colaborador', lideranca: 'Liderança (líder ou substituto de time)' };

export const CREDIT_KINDS_COUNTED = ['direto', 'participacao'] as const;

export function gamificationSettingsErrors(s: GamificationSettings): string[] {
  const e: string[] = [];
  const bp = (v: number) => Number.isInteger(v) && v >= 0 && v <= 10_000;
  for (const [k, v] of Object.entries(s.points)) if (!Number.isInteger(v) || v < 0 || v > 10_000) e.push(`Pontos inválidos em ${k}.`);
  if (!Object.values(s.points).some((v) => v > 0)) e.push('Defina pontos para pelo menos um tipo de evento.');
  if (!Number.isInteger(s.participationMultiplierBp) || s.participationMultiplierBp < 0 || s.participationMultiplierBp > 50_000) e.push('Multiplicador de participação inválido.');
  for (const r of GAMIFICATION_ROLES) {
    const w = s.hierarchyWeights?.[r];
    if (!w || !bp(w.ownBp) || !bp(w.teamBp) || w.ownBp + w.teamBp !== 10_000) e.push(`Pesos de ${GAMIFICATION_ROLE_LABELS[r]}: próprio + time devem somar 100%.`);
  }
  if (!bp(s.dispersionYellowBp) || !bp(s.dispersionRedBp) || s.dispersionRedBp <= s.dispersionYellowBp) e.push('A faixa vermelha de dispersão deve ser maior que a amarela.');
  if (!s.levels.length) e.push('Cadastre pelo menos um nível.');
  for (let i = 1; i < s.levels.length; i++) if (s.levels[i]!.minPoints <= s.levels[i - 1]!.minPoints) e.push('Os níveis devem ter mínimos crescentes.');
  if (s.levels.some((l) => !l.name.trim())) e.push('Todo nível precisa de nome.');
  return e;
}

/** Crédito agregado: soma de participação (bp) por pessoa, tipo e tipo de crédito, no período. */
export type CreditSum = { userId: string; type: string; kind: string; shareBp: number };

export type PersonPoints = { userId: string; direct: number; participation: number; own: number };

/** Pontos individuais: tipo × participação (bp/10000); participação com o multiplicador. Arredonda no fim, por pessoa. */
export function individualPoints(credits: CreditSum[], st: GamificationSettings): Map<string, PersonPoints> {
  const out = new Map<string, { direct: number; participation: number }>();
  for (const c of credits) {
    const pts = st.points[c.type] ?? 0;
    if (!pts || !(CREDIT_KINDS_COUNTED as readonly string[]).includes(c.kind)) continue;
    const cur = out.get(c.userId) ?? { direct: 0, participation: 0 };
    if (c.kind === 'direto') cur.direct += (pts * c.shareBp) / 10_000;
    else cur.participation += (pts * c.shareBp * st.participationMultiplierBp) / 10_000 / 10_000;
    out.set(c.userId, cur);
  }
  return new Map([...out].map(([u, v]) => [u, { userId: u, direct: round1(v.direct), participation: round1(v.participation), own: round1(v.direct + v.participation) }]));
}
const round1 = (n: number) => Math.round(n * 10) / 10;

export type DispersionTone = 'verde' | 'amarelo' | 'vermelho' | 'sem_dados';
/** Coeficiente de variação (desvio-padrão populacional / média) das notas individuais. */
export function dispersion(values: number[], st: GamificationSettings): { cv: number | null; tone: DispersionTone; min: number; max: number } {
  if (values.length < 2) return { cv: null, tone: 'sem_dados', min: values[0] ?? 0, max: values[0] ?? 0 };
  const mean = values.reduce((t, v) => t + v, 0) / values.length;
  const min = Math.min(...values), max = Math.max(...values);
  if (mean === 0) return { cv: null, tone: 'sem_dados', min, max };
  const sd = Math.sqrt(values.reduce((t, v) => t + (v - mean) ** 2, 0) / values.length);
  const cv = sd / mean;
  const tone: DispersionTone = cv * 10_000 >= st.dispersionRedBp ? 'vermelho' : cv * 10_000 >= st.dispersionYellowBp ? 'amarelo' : 'verde';
  return { cv, tone, min, max };
}

export type TeamBoard = {
  teamId: string; points: number; average: number;
  dispersion: ReturnType<typeof dispersion>;
  members: (PersonPoints & { teamAverage: number; score: number })[];
};

/**
 * Placar por time e nota de cada pessoa. Quem está em mais de um time participante usa a média das médias dos times.
 * Sem eventos no período a pessoa entra com zero (conta na média e na dispersão do time).
 */
export function teamBoards(args: { teams: { id: string; memberIds: string[]; leadIds?: string[] }[]; credits: CreditSum[]; settings: GamificationSettings }) {
  const st = args.settings;
  const ind = individualPoints(args.credits, st);
  const pp = (u: string): PersonPoints => ind.get(u) ?? { userId: u, direct: 0, participation: 0, own: 0 };
  const avgOf = new Map<string, number>();
  for (const t of args.teams) avgOf.set(t.id, t.memberIds.length ? t.memberIds.reduce((s, u) => s + pp(u).own, 0) / t.memberIds.length : 0);
  const teamsOf = new Map<string, string[]>();
  for (const t of args.teams) for (const u of t.memberIds) teamsOf.set(u, [...(teamsOf.get(u) ?? []), t.id]);
  const leads = new Set(args.teams.flatMap((t) => t.leadIds ?? []));
  const roleOf = (u: string): GamificationRole => (leads.has(u) ? 'lideranca' : 'colaborador');
  const scoreOf = (u: string) => {
    const ts = teamsOf.get(u) ?? [];
    const ta = ts.length ? ts.reduce((s, t) => s + avgOf.get(t)!, 0) / ts.length : 0;
    const role = roleOf(u);
    const w = st.hierarchyWeights[role];
    return { role, teamAverage: round1(ta), score: round1((pp(u).own * w.ownBp + ta * w.teamBp) / 10_000) };
  };
  const boards: TeamBoard[] = args.teams.map((t) => {
    const members = t.memberIds.map((u) => ({ ...pp(u), ...scoreOf(u) })).sort((a, b) => b.score - a.score || b.own - a.own);
    return { teamId: t.id, points: round1(members.reduce((s, m) => s + m.own, 0)), average: round1(avgOf.get(t.id)!), dispersion: dispersion(members.map((m) => m.own), st), members };
  });
  const people = [...teamsOf.keys()].map((u) => ({ ...pp(u), ...scoreOf(u) })).sort((a, b) => b.score - a.score || b.own - a.own || a.userId.localeCompare(b.userId));
  return { boards: boards.sort((a, b) => b.average - a.average), people };
}

/** Pódio: os três primeiros pela nota (com pontos). Empate na nota: mesmo lugar. */
export function podium<T extends { score: number }>(people: T[]): (T & { place: number })[] {
  const top = people.filter((p) => p.score > 0).slice(0, 3);
  let place = 0, last: number | null = null;
  return top.map((p, i) => { if (p.score !== last) { place = i + 1; last = p.score; } return { ...p, place }; });
}

/** Nível pela nota do ano. */
export const levelOf = (score: number, st: GamificationSettings) => [...st.levels].reverse().find((l) => score >= l.minPoints) ?? null;

/** Selo BK de Qualidade (medalha de ouro): a maior nota do ano; empate = todos os empatados. */
export const goldMedalists = <T extends { userId: string; score: number }>(people: T[]) => {
  const best = Math.max(0, ...people.map((p) => p.score));
  return best > 0 ? people.filter((p) => p.score === best).map((p) => p.userId) : [];
};
