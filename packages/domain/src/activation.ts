/**
 * Ativação de contas-alvo (ABM): a conta nos reconhece como relevantes quando dá sinais de mão dupla
 * (iniciativa ou resposta DELA), repetidos dentro de uma janela de tempo e, nas estratégicas, com mais de
 * uma pessoa. Ação só nossa não conta. Os parâmetros são sugestão e ficam editáveis na ficha do indicador.
 */
export const ACTIVATION_SIGNALS = ['reuniao_visita', 'pedido_iniciativa', 'play_sucesso', 'pesquisa_reconhecimento', 'resposta_mensagem', 'passo_play', 'pesquisa_resposta'] as const;
export type ActivationSignal = (typeof ACTIVATION_SIGNALS)[number];
export const ACTIVATION_SIGNAL_LABELS: Record<ActivationSignal, string> = {
  reuniao_visita: 'Reunião ou visita realizada com a conta',
  pedido_iniciativa: 'Pedido da conta por iniciativa própria (negociação aberta a partir de e-mail dela)',
  play_sucesso: 'Play encerrado com sucesso',
  pesquisa_reconhecimento: 'Pesquisa de ativação com reconhecimento (nota alta ou "nos consultaria")',
  resposta_mensagem: 'Resposta de alguém da conta (e-mail recebido)',
  passo_play: 'Passo de Play concluído com contato com o cliente',
  pesquisa_resposta: 'Resposta à pesquisa de ativação',
};
export const SIGNAL_STRENGTHS = ['forte', 'medio', 'fraco', 'nao_conta'] as const;
export type SignalStrength = (typeof SIGNAL_STRENGTHS)[number];
export const SIGNAL_STRENGTH_LABELS: Record<SignalStrength, string> = { forte: 'Forte', medio: 'Médio', fraco: 'Fraco', nao_conta: 'Não conta' };
export const ACTIVATION_TIERS = ['1_1', '1_poucos', '1_muitos'] as const;
export type AbmTierKey = (typeof ACTIVATION_TIERS)[number];
export const ABM_TIER_NAMES: Record<AbmTierKey, string> = { '1_1': '1:1 (estratégicas)', '1_poucos': '1:poucos', '1_muitos': '1:muitos' };

export type TierRule = { windowDays: number; minPoints: number; minStrong: number; minPeople: number };
export type ActivationConfig = {
  points: Record<Exclude<SignalStrength, 'nao_conta'>, number>;
  signals: Record<ActivationSignal, SignalStrength>;
  tiers: Record<AbmTierKey, TierRule>;
  survey: { surveyId: string | null; relevanceKey: string | null; minScore: number; recommendKey: string | null };
};

/** Sugestão inicial (ajustável na ficha). */
export const DEFAULT_ACTIVATION: ActivationConfig = {
  points: { forte: 3, medio: 2, fraco: 1 },
  signals: { reuniao_visita: 'forte', pedido_iniciativa: 'forte', play_sucesso: 'forte', pesquisa_reconhecimento: 'forte', resposta_mensagem: 'medio', passo_play: 'medio', pesquisa_resposta: 'medio' },
  tiers: {
    '1_1': { windowDays: 30, minPoints: 6, minStrong: 1, minPeople: 2 },
    '1_poucos': { windowDays: 60, minPoints: 5, minStrong: 1, minPeople: 1 },
    '1_muitos': { windowDays: 90, minPoints: 3, minStrong: 0, minPeople: 1 },
  },
  survey: { surveyId: null, relevanceKey: null, minScore: 4, recommendKey: null },
};
export function activationConfig(c: Partial<ActivationConfig> | null | undefined): ActivationConfig {
  return {
    points: { ...DEFAULT_ACTIVATION.points, ...(c?.points ?? {}) },
    signals: { ...DEFAULT_ACTIVATION.signals, ...(c?.signals ?? {}) },
    tiers: { '1_1': { ...DEFAULT_ACTIVATION.tiers['1_1'], ...(c?.tiers?.['1_1'] ?? {}) }, '1_poucos': { ...DEFAULT_ACTIVATION.tiers['1_poucos'], ...(c?.tiers?.['1_poucos'] ?? {}) }, '1_muitos': { ...DEFAULT_ACTIVATION.tiers['1_muitos'], ...(c?.tiers?.['1_muitos'] ?? {}) } },
    survey: { ...DEFAULT_ACTIVATION.survey, ...(c?.survey ?? {}) },
  };
}
export function validateActivation(c: ActivationConfig): string[] {
  const e: string[] = [];
  for (const t of ACTIVATION_TIERS) {
    const r = c.tiers[t];
    if (!(r.windowDays >= 7 && r.windowDays <= 365)) e.push(`${ABM_TIER_NAMES[t]}: janela entre 7 e 365 dias.`);
    if (!(r.minPoints >= 1 && r.minPoints <= 100)) e.push(`${ABM_TIER_NAMES[t]}: pontos mínimos entre 1 e 100.`);
    if (r.minStrong < 0 || r.minPeople < 1) e.push(`${ABM_TIER_NAMES[t]}: sinais fortes ≥ 0 e pessoas ≥ 1.`);
  }
  for (const k of ['forte', 'medio', 'fraco'] as const) if (!(c.points[k] >= 0 && c.points[k] <= 20)) e.push('Pontos por sinal entre 0 e 20.');
  if (!(c.survey.minScore >= 1 && c.survey.minScore <= 10)) e.push('Nota mínima da pesquisa entre 1 e 10.');
  return e;
}

export type SignalHit = { kind: ActivationSignal; on: string; person: string | null };
export const ACTIVATION_STATES = ['ativada', 'engajada', 'esfriando', 'nao_engajada'] as const;
export type ActivationState = (typeof ACTIVATION_STATES)[number];
export const ACTIVATION_STATE_LABELS: Record<ActivationState, string> = { ativada: 'Ativada', engajada: 'Engajada', esfriando: 'Esfriando', nao_engajada: 'Não engajada' };

const minus = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** Pontos, sinais fortes e pessoas na janela que termina em `at`. */
export function windowScore(hits: SignalHit[], cfg: ActivationConfig, rule: TierRule, at: string) {
  const from = minus(at, rule.windowDays - 1);
  const inWin = hits.filter((h) => h.on >= from && h.on <= at && cfg.signals[h.kind] !== 'nao_conta');
  const points = inWin.reduce((t, h) => t + cfg.points[cfg.signals[h.kind] as 'forte' | 'medio' | 'fraco'], 0);
  const strong = inWin.filter((h) => cfg.signals[h.kind] === 'forte').length;
  const people = new Set(inWin.map((h) => h.person).filter(Boolean)).size || (inWin.length ? 1 : 0);
  const ok = points >= rule.minPoints && strong >= rule.minStrong && people >= rule.minPeople;
  return { points, strong, people, signals: inWin.length, ok };
}

/**
 * Estado da conta em `at`: ativada (bateu a régua do tier), esfriando (era ativada na janela anterior e não
 * está mais), engajada (teve sinal de mão dupla) ou não engajada.
 */
export function activationState(hits: SignalHit[], cfg: ActivationConfig, tier: AbmTierKey, at: string) {
  const rule = cfg.tiers[tier] ?? cfg.tiers['1_muitos'];
  const now = windowScore(hits, cfg, rule, at);
  const before = windowScore(hits, cfg, rule, minus(at, rule.windowDays));
  const state: ActivationState = now.ok ? 'ativada' : before.ok ? 'esfriando' : now.signals ? 'engajada' : 'nao_engajada';
  const last = [...hits].filter((h) => h.on <= at && cfg.signals[h.kind] === 'forte').sort((a, b) => (a.on < b.on ? 1 : -1))[0]?.on ?? null;
  return { state, ...now, rule, lastStrongOn: last };
}
