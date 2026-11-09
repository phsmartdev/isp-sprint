/**
 * Gestão de Times → Gamificação colaborativa, por nível de competência.
 * - Pontos: tarefas da jornada (com bônus de pontualidade e de aderência), parte nos negócios ganhos e eventos de negócio.
 * - Nota proporcional à responsabilidade: atingimento da meta de pontos do nível (teto), + crédito extra por atividade acima
 *   da alçada (teto próprio). Assim um assistente e um analista que cumprem o próprio escopo ficam no mesmo patamar.
 * - Composição por nível: próprio, média do time, dispersão do time (time nivelado = nota cheia) e resultado da área.
 * - Dispersão (coeficiente de variação dos atingimentos do time) é indicador da liderança: alta = problema.
 * Sem ranking: só o primeiro lugar do ano é reconhecido. Todos os números vêm da regra aprovada; nada fixo no cálculo.
 */
import { supportSettingsErrors, type SupportSettings } from './supportRequests';
import { certificateSettingsErrors, type CertificateSettings } from './certificates';

import { scoreJourneyErrors, type ScoreJourney } from './scoreJourneys';
import { performanceWeightsErrors, type PerformanceBands, type PerformanceWeights } from './hierarchyPerformance';

export type CompetencyLevel = {
  key: string; name: string;
  /** ordem de responsabilidade (1 = menor); define a alçada e o crédito extra */
  rank: number;
  /** meta de pontos do mês do nível (base do atingimento) */
  expectedMonthlyPoints: number;
  /** o nível pontua tarefas próprias (gerência não pontua: fica só com o coletivo) */
  scoresTasks: boolean;
  /** composição da nota (soma 100%), em bp */
  weights: { ownBp: number; teamBp: number; dispersionBp: number; areaBp: number };
};
export type GamificationBonuses = {
  /** tarefa da jornada concluída até o prazo */
  onTimeBp: number;
  /** tarefa qualificada como aprovada pela gerência (não obrigatória) */
  adherenceBp: number;
  /** atividade acima da alçada: bônus por nível acima */
  extraPerLevelBp: number;
  /** teto do crédito extra na nota do mês, em pontos percentuais (bp: 3000 = 30 p.p.) */
  extraCapBp: number;
  /** teto do atingimento regular (bp: 13000 = 130%) */
  scoreCapBp: number;
};

export type GamificationSettings = {
  /** Pedido de Apoio: pontos de quem apoia (multiplicador) e de quem pede; sem isto, apoio não pontua */
  support?: SupportSettings;
  /** certificados de cursos complementares na área (pontos extras depois de validados) */
  certificates?: CertificateSettings;
  /** jornadas de pontuação: tarefas por etapa do funil, com peso e alçada, e o peso do negócio ganho */
  journeys: ScoreJourney[];
  /** times que participam (vazio = todos os times ativos) */
  teamIds: string[];
  /** pontos por tipo de evento de negócio (chave do catálogo de eventos) */
  points: Record<string, number>;
  /** multiplicador do crédito de participação (ajuda na venda de colega), em bp: 10000 = igual ao direto */
  participationMultiplierBp: number;
  /** níveis de competência e quem está em cada um (sem cadastro: o padrão; quem lidera time: o padrão da liderança) */
  competencyLevels: CompetencyLevel[];
  assignments: Record<string, string>;
  defaultLevelKey: string;
  defaultLeadLevelKey: string;
  bonuses: GamificationBonuses;
  /** dispersão (CV) a partir da qual vira atenção / problema, em bp */
  dispersionYellowBp: number;
  dispersionRedBp: number;
  /** faixas pela nota do ano (nota mínima em %, crescente) */
  levels: { name: string; minPoints: number }[];
  /** performance por nível hierárquico: pesos de atividade e metas (individual, time, área, empresa) por nível de competência */
  performanceWeights: Record<string, PerformanceWeights>;
  /** faixas da performance (verde a partir de, amarelo a partir de), em bp de % */
  performanceBands: PerformanceBands;
};

export const CREDIT_KINDS_COUNTED = ['direto', 'participacao'] as const;
const KEY = /^[a-z0-9_]{1,30}$/;

export function gamificationSettingsErrors(s: GamificationSettings): string[] {
  const e: string[] = [...supportSettingsErrors(s.support), ...certificateSettingsErrors(s.certificates)];
  const bp = (v: number, max = 10_000) => Number.isInteger(v) && v >= 0 && v <= max;
  for (const [k, v] of Object.entries(s.points)) if (!Number.isInteger(v) || v < 0 || v > 10_000) e.push(`Pontos inválidos em ${k}.`);
  if (!Object.values(s.points).some((v) => v > 0) && !(s.journeys ?? []).length) e.push('Defina pontos para pelo menos um tipo de evento ou uma jornada.');
  if (!bp(s.participationMultiplierBp, 50_000)) e.push('Multiplicador de participação inválido.');
  const lv = s.competencyLevels ?? [];
  if (!lv.length) e.push('Cadastre pelo menos um nível de competência.');
  const keys = new Set<string>();
  for (const l of lv) {
    if (!KEY.test(l.key) || keys.has(l.key)) e.push(`Nível "${l.name}": chave inválida ou repetida.`);
    keys.add(l.key);
    if (!l.name.trim()) e.push('Todo nível de competência precisa de nome.');
    if (!Number.isInteger(l.rank) || l.rank < 1 || l.rank > 20) e.push(`Nível "${l.name}": ordem inválida.`);
    if (!Number.isInteger(l.expectedMonthlyPoints) || l.expectedMonthlyPoints < 0 || l.expectedMonthlyPoints > 100_000 || (l.scoresTasks && l.expectedMonthlyPoints === 0)) e.push(`Nível "${l.name}": meta de pontos do mês inválida.`);
    const w = l.weights;
    if (!w || ![w.ownBp, w.teamBp, w.dispersionBp, w.areaBp].every((x) => bp(x)) || w.ownBp + w.teamBp + w.dispersionBp + w.areaBp !== 10_000) e.push(`Nível "${l.name}": próprio + time + dispersão + área devem somar 100%.`);
    if (!l.scoresTasks && w && w.ownBp > 0) e.push(`Nível "${l.name}": quem não pontua tarefas não pode ter peso no próprio.`);
  }
  if (!keys.has(s.defaultLevelKey)) e.push('Nível padrão inválido.');
  if (!keys.has(s.defaultLeadLevelKey)) e.push('Nível padrão da liderança inválido.');
  for (const [u, k] of Object.entries(s.assignments ?? {})) if (!keys.has(k)) e.push(`Pessoa ${u.slice(0, 8)}: nível inexistente.`);
  const b = s.bonuses;
  if (!b || !bp(b.onTimeBp) || !bp(b.adherenceBp) || !bp(b.extraPerLevelBp) || !bp(b.extraCapBp) || !bp(b.scoreCapBp, 30_000) || b.scoreCapBp < 10_000) e.push('Bônus e tetos inválidos (o teto do atingimento é de pelo menos 100%).');
  if (!bp(s.dispersionYellowBp) || !bp(s.dispersionRedBp) || s.dispersionRedBp <= s.dispersionYellowBp) e.push('A faixa vermelha de dispersão deve ser maior que a amarela.');
  if (!s.levels.length) e.push('Cadastre pelo menos uma faixa.');
  for (let i = 1; i < s.levels.length; i++) if (s.levels[i]!.minPoints <= s.levels[i - 1]!.minPoints) e.push('As faixas devem ter mínimos crescentes.');
  if (s.levels.some((l) => !l.name.trim())) e.push('Toda faixa precisa de nome.');
  e.push(...scoreJourneyErrors(s.journeys ?? []));
  e.push(...performanceWeightsErrors(s.performanceWeights ?? {}, Object.fromEntries(lv.map((l) => [l.key, l.name])), s.performanceBands ?? { greenBp: 0, yellowBp: 0 }));
  for (const l of lv) if (!(s.performanceWeights ?? {})[l.key]) e.push(`Performance: defina os pesos de ${l.name}.`);
  for (const j of s.journeys ?? []) for (const c of j.components) if (c.level && !keys.has(c.level)) e.push(`Jornada "${j.name}": alçada inexistente em "${c.name}".`);
  return e;
}

/** Crédito agregado: soma de participação (bp) por pessoa, tipo e tipo de crédito, no período. */
export type CreditSum = { userId: string; type: string; kind: string; shareBp: number };
/** Pontos das jornadas por pessoa: regulares ou crédito extra (acima da alçada). */
export type ExtraPoints = { userId: string; points: number; extra?: boolean };
export type PersonPoints = { userId: string; direct: number; participation: number; journey: number; extra: number; points: number };

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Pontos brutos por pessoa: eventos (participação com multiplicador) e jornadas (regulares e extra). */
export function individualPoints(credits: CreditSum[], st: GamificationSettings, journey: ExtraPoints[] = []): Map<string, PersonPoints> {
  const out = new Map<string, { direct: number; participation: number; journey: number; extra: number }>();
  const get = (u: string) => out.get(u) ?? { direct: 0, participation: 0, journey: 0, extra: 0 };
  for (const x of journey) { const cur = get(x.userId); if (x.extra) cur.extra += x.points; else cur.journey += x.points; out.set(x.userId, cur); }
  for (const c of credits) {
    const pts = st.points[c.type] ?? 0;
    if (!pts || !(CREDIT_KINDS_COUNTED as readonly string[]).includes(c.kind)) continue;
    const cur = get(c.userId);
    if (c.kind === 'direto') cur.direct += (pts * c.shareBp) / 10_000;
    else cur.participation += (pts * c.shareBp * st.participationMultiplierBp) / 10_000 / 10_000;
    out.set(c.userId, cur);
  }
  return new Map([...out].map(([u, v]) => [u, { userId: u, direct: round1(v.direct), participation: round1(v.participation), journey: round1(v.journey), extra: round1(v.extra), points: round1(v.direct + v.participation + v.journey + v.extra) }]));
}

export type DispersionTone = 'verde' | 'amarelo' | 'vermelho' | 'sem_dados';
/** Coeficiente de variação (desvio-padrão populacional / média) dos atingimentos. */
export function dispersion(values: number[], st: Pick<GamificationSettings, 'dispersionYellowBp' | 'dispersionRedBp'>): { cv: number | null; tone: DispersionTone; min: number; max: number } {
  if (values.length < 2) return { cv: null, tone: 'sem_dados', min: values[0] ?? 0, max: values[0] ?? 0 };
  const mean = values.reduce((t, v) => t + v, 0) / values.length;
  const min = Math.min(...values), max = Math.max(...values);
  if (mean === 0) return { cv: null, tone: 'sem_dados', min, max };
  const sd = Math.sqrt(values.reduce((t, v) => t + (v - mean) ** 2, 0) / values.length);
  const cv = sd / mean;
  const tone: DispersionTone = cv * 10_000 >= st.dispersionRedBp ? 'vermelho' : cv * 10_000 >= st.dispersionYellowBp ? 'amarelo' : 'verde';
  return { cv, tone, min, max };
}
/** Nota da dispersão (para quem lidera): time nivelado = 100; chega a 0 na faixa vermelha. Sem dados = 100. */
export const dispersionScore = (cv: number | null, st: Pick<GamificationSettings, 'dispersionRedBp'>) => (cv == null ? 100 : Math.max(0, 1 - (cv * 10_000) / st.dispersionRedBp) * 100);

/** Nível de competência da pessoa: o cadastrado; sem cadastro, o padrão (da liderança, se lidera time). */
export function levelFor(st: GamificationSettings, userId: string, isLead: boolean): CompetencyLevel {
  const key = st.assignments?.[userId] ?? (isLead ? st.defaultLeadLevelKey : st.defaultLevelKey);
  return st.competencyLevels.find((l) => l.key === key) ?? st.competencyLevels[0]!;
}

export type MemberResult = PersonPoints & {
  levelKey: string; levelName: string; lead: boolean;
  /** pontos esperados no período (meta do nível × meses) */
  expected: number;
  /** atingimento regular e crédito extra, em % (com tetos) */
  attainment: number; extraAttainment: number;
  /** próprio = atingimento + extra (%) */
  own: number;
  teamAverage: number; dispersionScore: number; area: number;
  score: number;
};
export type TeamBoard = { teamId: string; points: number; average: number; dispersion: ReturnType<typeof dispersion>; members: MemberResult[] };

/**
 * Placar por time e nota de cada pessoa no período (`months` = quantos meses o período cobre, para a meta do nível).
 * Quem não pontua tarefas (gerência) fica fora da média e da dispersão do time; quem está em mais de um time usa a média dos times.
 */
export function teamBoards(args: { teams: { id: string; memberIds: string[]; leadIds?: string[] }[]; credits: CreditSum[]; settings: GamificationSettings; extra?: ExtraPoints[]; months?: number }) {
  const st = args.settings;
  const months = args.months ?? 1;
  const ind = individualPoints(args.credits, st, args.extra);
  const leads = new Set(args.teams.flatMap((t) => t.leadIds ?? []));
  const teamsOf = new Map<string, string[]>();
  for (const t of args.teams) for (const u of t.memberIds) teamsOf.set(u, [...(teamsOf.get(u) ?? []), t.id]);
  const base = new Map<string, Omit<MemberResult, 'teamAverage' | 'dispersionScore' | 'area' | 'score'> & { level: CompetencyLevel }>();
  for (const u of teamsOf.keys()) {
    const p = ind.get(u) ?? { userId: u, direct: 0, participation: 0, journey: 0, extra: 0, points: 0 };
    const level = levelFor(st, u, leads.has(u));
    const expected = level.expectedMonthlyPoints * months;
    const regular = p.direct + p.participation + p.journey;
    const attainment = level.scoresTasks && expected > 0 ? Math.min(st.bonuses.scoreCapBp / 10_000, regular / expected) * 100 : 0;
    const extraAttainment = level.scoresTasks && expected > 0 ? Math.min(st.bonuses.extraCapBp / 10_000, p.extra / expected) * 100 : 0;
    base.set(u, { ...p, level, levelKey: level.key, levelName: level.name, lead: leads.has(u), expected, attainment: round1(attainment), extraAttainment: round1(extraAttainment), own: round1(attainment + extraAttainment) });
  }
  const scoring = (u: string) => base.get(u)!.level.scoresTasks;
  const teamStats = new Map<string, { average: number; disp: ReturnType<typeof dispersion> }>();
  for (const t of args.teams) {
    const vals = t.memberIds.filter(scoring).map((u) => base.get(u)!.own);
    teamStats.set(t.id, { average: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0, disp: dispersion(vals, st) });
  }
  const allVals = [...base.keys()].filter(scoring).map((u) => base.get(u)!.own);
  const area = allVals.length ? allVals.reduce((a, b) => a + b, 0) / allVals.length : 0;
  const result = (u: string): MemberResult => {
    const b = base.get(u)!;
    const ts = teamsOf.get(u) ?? [];
    const ta = ts.length ? ts.reduce((s, t) => s + teamStats.get(t)!.average, 0) / ts.length : 0;
    const ds = ts.length ? ts.reduce((s, t) => s + dispersionScore(teamStats.get(t)!.disp.cv, st), 0) / ts.length : 100;
    const w = b.level.weights;
    const score = (b.own * w.ownBp + ta * w.teamBp + ds * w.dispersionBp + area * w.areaBp) / 10_000;
    const { level: _l, ...rest } = b;
    return { ...rest, teamAverage: round1(ta), dispersionScore: round1(ds), area: round1(area), score: round1(score) };
  };
  const boards: TeamBoard[] = args.teams.map((t) => {
    const members = t.memberIds.map(result);
    const s = teamStats.get(t.id)!;
    return { teamId: t.id, points: round1(members.reduce((a, m) => a + m.points, 0)), average: round1(s.average), dispersion: s.disp, members };
  });
  const people = [...teamsOf.keys()].map(result).sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  return { boards, people, area: round1(area) };
}

/** Faixa pela nota do ano. */
export const levelOf = (score: number, st: GamificationSettings) => [...st.levels].reverse().find((l) => score >= l.minPoints) ?? null;

/** Badge Ouro (medalha de ouro): a maior nota do ano; empate = todos os empatados. Sem ranking além disso. */
export const goldMedalists = <T extends { userId: string; score: number }>(people: T[]) => {
  const best = Math.max(0, ...people.map((p) => p.score));
  return best > 0 ? people.filter((p) => p.score === best).map((p) => p.userId) : [];
};
