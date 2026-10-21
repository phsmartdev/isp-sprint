/**
 * Sucesso do Cliente: regras puras e versionáveis (jornada, Tier, IPC, saúde, criticidade, prioridade, cadência e cobertura).
 * Nada aqui inventa dado: critério sem informação fica `null` e aparece como pendente/indisponível.
 */

// ------------------------------------------------------------------ configuração (versionada no banco)
export const CS_LEVELS = ['baixa', 'moderada', 'alta', 'critica'] as const;
export type CsLevel = (typeof CS_LEVELS)[number];
export const CS_LEVEL_LABELS: Record<CsLevel, string> = { baixa: 'Baixa', moderada: 'Moderada', alta: 'Alta', critica: 'Crítica' };
export const TIERS = ['small', 'middle', 'large'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABELS: Record<Tier, string> = { small: 'Small (pequena)', middle: 'Middle (média)', large: 'Large (grande)' };
export const JOURNEY_PHASES = ['onboarding', 'adocao', 'renovacao'] as const;
export type JourneyPhase = (typeof JOURNEY_PHASES)[number];
export const JOURNEY_PHASE_LABELS: Record<JourneyPhase, string> = { onboarding: 'Onboarding', adocao: 'Adoção', renovacao: 'Renovação' };
export const CS_ACTIVITY_KINDS = ['contato', 'visita', 'reuniao', 'revisao', 'pesquisa', 'contratual'] as const;
export type CsActivityKind = (typeof CS_ACTIVITY_KINDS)[number];
export const CS_ACTIVITY_LABELS: Record<CsActivityKind, string> = { contato: 'Contato', visita: 'Visita', reuniao: 'Reunião', revisao: 'Revisão', pesquisa: 'Pesquisa', contratual: 'Acompanhamento contratual' };

/** Marco do modelo de jornada. `anchor` = início da jornada ou fim da vigência do contrato (renovação usa a data real). */
export type MilestoneTpl = { key: string; phase: JourneyPhase; title: string; anchor: 'inicio' | 'fim_contrato'; offsetDays: number; task: boolean; owner: 'csm' | 'comercial' | 'implantacao' };
export type JourneyTpl = { key: string; name: string; appliesTo: { billingType?: string | null; kind?: 'publico' | 'privado' | null; minAcvCents?: number | null }; milestones: MilestoneTpl[] };
export type IpcLevel = 'baixo' | 'medio' | 'alto';
export const IPC_CRITERIA = ['tamanho', 'potencial', 'segmento', 'criticidade', 'tempo', 'relacionamento', 'maturidade'] as const;
export type IpcCriterion = (typeof IPC_CRITERIA)[number];
export const IPC_LABELS: Record<IpcCriterion, string> = {
  tamanho: 'Tamanho da conta', potencial: 'Potencial de receita adicional', segmento: 'Segmento / setor de atuação', criticidade: 'Necessidade / criticidade do serviço',
  tempo: 'Tempo de relacionamento', relacionamento: 'Grau de relacionamento / acesso', maturidade: 'Maturidade da conta',
};
export const IPC_LEVEL_TEXT: Record<IpcCriterion, Record<IpcLevel, string>> = {
  tamanho: { baixo: 'Small', medio: 'Middle', alto: 'Large' },
  potencial: { baixo: 'Baixo', medio: 'Médio', alto: 'Alto' },
  segmento: { baixo: 'Baixa aderência', medio: 'Média aderência', alto: 'Alta aderência' },
  criticidade: { baixo: 'Baixa', medio: 'Média', alto: 'Alta' },
  tempo: { baixo: 'Menos de 6 meses', medio: '6 a 24 meses', alto: 'Mais de 24 meses' },
  relacionamento: { baixo: 'Restrito', medio: 'Intermediário', alto: 'Alto' },
  maturidade: { baixo: 'Baixa', medio: 'Intermediária', alto: 'Alta' },
};
/** Critérios calculados pelo sistema quando há dado confiável; os demais são avaliação humana. */
export const IPC_OBJECTIVE: IpcCriterion[] = ['tamanho', 'tempo'];
export const HEALTH_FACTORS = ['consumo', 'inadimplencia', 'satisfacao', 'ocorrencias', 'entregas', 'risco', 'relacionamento'] as const;
export type HealthFactor = (typeof HEALTH_FACTORS)[number];
export const HEALTH_LABELS: Record<HealthFactor, string> = { consumo: 'Consumo', inadimplencia: 'Inadimplência', satisfacao: 'Satisfação', ocorrencias: 'Ocorrências', entregas: 'Cumprimento de entregas', risco: 'Risco de cancelamento', relacionamento: 'Histórico de relacionamento' };
export const CRIT_FACTORS = ['saude', 'tier', 'ipc', 'classe', 'consumo', 'inadimplencia', 'satisfacao', 'vencimento', 'risco', 'ocorrencias', 'acompanhamento'] as const;
export type CritFactor = (typeof CRIT_FACTORS)[number];
export const CRIT_LABELS: Record<CritFactor, string> = { saude: 'Saúde', tier: 'Tier', ipc: 'Score IPC', classe: 'Classe estratégica', consumo: 'Consumo', inadimplencia: 'Inadimplência', satisfacao: 'Satisfação', vencimento: 'Vencimento contratual', risco: 'Risco de cancelamento', ocorrencias: 'Ocorrências', acompanhamento: 'Acompanhamento em atraso' };
export type CadencePolicy = { key: string; name: string; when: { criticality?: CsLevel | null; tier?: Tier | null; classKey?: string | null; billingType?: string | null; segment?: string | null; csmId?: string | null }; contactDays: number | null; visitDays: number | null; reviewDays: number | null };
export const PRECEDENCE = ['manual_ate_revisao', 'manual_prevalece', 'maior'] as const;
export type Precedence = (typeof PRECEDENCE)[number];
export const PRECEDENCE_LABELS: Record<Precedence, string> = { manual_ate_revisao: 'Manual vale até a data de revisão; depois volta a calculada', manual_prevalece: 'Manual sempre prevalece', maior: 'Vale a mais alta entre calculada e manual' };

export type CsConfig = {
  trigger: { pipelineKey: string; stageKey: string; createOnContractValidation: boolean; notifyEmails: boolean; defaultCsmId: string | null; customerType: 'todos' | 'novo' | 'base'; billingTypes: string[]; kinds: string[] };
  journeyTemplates: JourneyTpl[];
  tierBands: { middleFromCents: number; largeFromCents: number };
  ipcRevisionDays: number;
  /** pontos por nível; tamanho e potencial seguem a especificação (10/20/30 e 10/15/20) */
  ipcPoints: Record<IpcCriterion, Record<IpcLevel, number>>;
  healthWeights: Record<HealthFactor, number>;
  healthMinCoverage: number;
  critWeights: Record<CritFactor, number>;
  critThresholds: { moderada: number; alta: number; critica: number };
  critStrategicClasses: string[];
  precedence: Precedence;
  coverageWeights: Record<CsLevel, number>;
  onTimeToleranceDays: number;
  cadence: CadencePolicy[];
  cadenceHorizonDays: number;
  effortMinutes: Record<CsActivityKind, number>;
  csmCapacityHoursMonth: number;
  alerts: { noContactDays: number; renewalDays: number; consumptionHighPct: number; consumptionLowPct: number; satisfactionDrop: number; escalateAfterDays: number; staleDataDays: number; disabled: string[]; escalateEmails: string[] };
  visitTypes: string[];
  surveyKinds: string[];
  scorecard: { operacional: number; comercial: number; qualidade: number; risco: number };
};

const ms = (key: string, phase: JourneyPhase, title: string, offsetDays: number, owner: MilestoneTpl['owner'] = 'csm', anchor: MilestoneTpl['anchor'] = 'inicio', task = true): MilestoneTpl => ({ key, phase, title, anchor, offsetDays, task, owner });
const BASE_MILESTONES: MilestoneTpl[] = [
  ms('boas_vindas', 'onboarding', 'Boas-vindas', 1),
  ms('kickoff', 'onboarding', 'Reunião de kickoff', 7),
  ms('planejamento', 'onboarding', 'Planejamento', 10),
  ms('implantacao', 'onboarding', 'Implantação e entrega do serviço', 20, 'implantacao'),
  ms('d30', 'onboarding', 'Acompanhamento de 30 dias', 30),
  ms('d60', 'onboarding', 'Acompanhamento de 60 dias', 60),
  ms('d90', 'onboarding', 'Acompanhamento de 90 dias', 90),
  ms('uso', 'adocao', 'Avaliação da utilização dos serviços', 120),
  ms('pesquisa', 'adocao', 'Pesquisa de satisfação', 150),
  ms('qbr1', 'adocao', 'Análise trimestral (QBR)', 180),
  ms('melhorias', 'adocao', 'Oportunidades de melhoria', 200, 'csm', 'inicio', false),
  ms('expansao', 'adocao', 'Upgrades e cross-sell', 240, 'comercial'),
  ms('aval_contrato', 'renovacao', 'Avaliação contratual', -150, 'csm', 'fim_contrato'),
  ms('escopo', 'renovacao', 'Revisão de escopo', -130, 'csm', 'fim_contrato'),
  ms('consumo', 'renovacao', 'Análise de consumo', -120, 'csm', 'fim_contrato'),
  ms('satisfacao_ren', 'renovacao', 'Análise de satisfação', -110, 'csm', 'fim_contrato'),
  ms('plano_ren', 'renovacao', 'Planejamento de renovação', -90, 'csm', 'fim_contrato'),
  ms('proposta_ren', 'renovacao', 'Proposta de renovação', -60, 'comercial', 'fim_contrato'),
  ms('formalizacao_ren', 'renovacao', 'Formalização', -30, 'comercial', 'fim_contrato'),
];

export const DEFAULT_CS_CONFIG: CsConfig = {
  trigger: { pipelineKey: 'sucesso_cliente', stageKey: 'planejamento', createOnContractValidation: true, notifyEmails: true, defaultCsmId: null, customerType: 'todos', billingTypes: [], kinds: [] },
  journeyTemplates: [
    { key: 'simples', name: 'Contrato simples', appliesTo: {}, milestones: BASE_MILESTONES.filter((m) => !['qbr1', 'escopo'].includes(m.key)) },
    { key: 'corporativo', name: 'Contrato corporativo', appliesTo: { kind: 'privado', minAcvCents: 12_000_000 }, milestones: BASE_MILESTONES },
    { key: 'publico', name: 'Contrato público', appliesTo: { kind: 'publico' }, milestones: [...BASE_MILESTONES.map((m) => (m.key === 'proposta_ren' ? { ...m, title: 'Ofício e minuta do aditivo de renovação' } : m)), ms('publicacao_ren', 'renovacao', 'Publicação do extrato do aditivo', -10, 'comercial', 'fim_contrato')] },
    { key: 'projeto', name: 'Projeto complexo', appliesTo: { minAcvCents: 50_000_000 }, milestones: [...BASE_MILESTONES, ms('cronograma', 'onboarding', 'Validação do cronograma do projeto', 12), ms('aceite', 'onboarding', 'Termo de aceite da entrega', 45, 'implantacao')] },
  ],
  tierBands: { middleFromCents: 12_000_001, largeFromCents: 50_000_001 },
  ipcRevisionDays: 90,
  ipcPoints: {
    tamanho: { baixo: 10, medio: 20, alto: 30 }, potencial: { baixo: 10, medio: 15, alto: 20 }, segmento: { baixo: 0, medio: 5, alto: 10 }, criticidade: { baixo: 0, medio: 5, alto: 10 },
    tempo: { baixo: 0, medio: 5, alto: 10 }, relacionamento: { baixo: 0, medio: 5, alto: 10 }, maturidade: { baixo: 0, medio: 5, alto: 10 },
  },
  healthWeights: { consumo: 15, inadimplencia: 20, satisfacao: 20, ocorrencias: 10, entregas: 10, risco: 15, relacionamento: 10 },
  healthMinCoverage: 0.5,
  critWeights: { saude: 25, tier: 10, ipc: 10, classe: 10, consumo: 8, inadimplencia: 8, satisfacao: 8, vencimento: 8, risco: 15, ocorrencias: 6, acompanhamento: 10 },
  critThresholds: { moderada: 25, alta: 45, critica: 65 },
  critStrategicClasses: ['Reputação', 'Aposta Estratégica'],
  precedence: 'manual_ate_revisao',
  coverageWeights: { baixa: 1, moderada: 2, alta: 3, critica: 4 },
  onTimeToleranceDays: 2,
  cadence: [
    { key: 'critica', name: 'Criticidade crítica', when: { criticality: 'critica' }, contactDays: 7, visitDays: null, reviewDays: 30 },
    { key: 'alta', name: 'Criticidade alta', when: { criticality: 'alta' }, contactDays: 15, visitDays: 30, reviewDays: 90 },
    { key: 'moderada', name: 'Criticidade moderada', when: { criticality: 'moderada' }, contactDays: 30, visitDays: 90, reviewDays: 90 },
    { key: 'baixa', name: 'Criticidade baixa', when: { criticality: 'baixa' }, contactDays: 90, visitDays: null, reviewDays: null },
  ],
  cadenceHorizonDays: 90,
  effortMinutes: { contato: 20, visita: 180, reuniao: 60, revisao: 90, pesquisa: 15, contratual: 45 },
  csmCapacityHoursMonth: 80,
  alerts: { noContactDays: 45, renewalDays: 120, consumptionHighPct: 85, consumptionLowPct: 30, satisfactionDrop: 2, escalateAfterDays: 7, staleDataDays: 30, disabled: [], escalateEmails: [] },
  visitTypes: ['Relacionamento', 'Técnica', 'Executiva', 'Recuperação'],
  surveyKinds: ['nps', 'csat', 'experiencia'],
  scorecard: { operacional: 40, comercial: 25, qualidade: 20, risco: 15 },
};

/** Valida a configuração (limites que impedem cálculo absurdo). */
export function validateCsConfig(c: CsConfig): string[] {
  const e: string[] = [];
  if (!(c.tierBands.middleFromCents > 0 && c.tierBands.largeFromCents > c.tierBands.middleFromCents)) e.push('Faixas de Tier: a de Large deve começar acima da de Middle.');
  const t = c.critThresholds;
  if (!(t.moderada > 0 && t.alta > t.moderada && t.critica > t.alta && t.critica <= 100)) e.push('Limites de criticidade devem crescer (moderada < alta < crítica ≤ 100).');
  if (Object.values(c.healthWeights).some((w) => w < 0) || Object.values(c.critWeights).some((w) => w < 0)) e.push('Pesos não podem ser negativos.');
  if (Object.values(c.coverageWeights).some((w) => w <= 0)) e.push('Pesos de cobertura devem ser maiores que zero.');
  if (!c.journeyTemplates.length) e.push('Cadastre ao menos um modelo de jornada.');
  for (const j of c.journeyTemplates) if (new Set(j.milestones.map((m) => m.key)).size !== j.milestones.length) e.push(`Modelo ${j.name}: marcos com chave repetida.`);
  const p = c.ipcPoints;
  const max = IPC_CRITERIA.reduce((s, k) => s + Math.max(...Object.values(p[k])), 0);
  const min = IPC_CRITERIA.reduce((s, k) => s + Math.min(...Object.values(p[k])), 0);
  if (max !== 100 || min !== 20) e.push(`Pontos do IPC devem somar de 20 a 100 (hoje ${min} a ${max}).`);
  return e;
}

// ------------------------------------------------------------------ ACV e Tier
/** ACV de um contrato: mensal × 12 quando recorrente; senão valor global anualizado pela vigência. */
export function contractAcv(c: { monthlyCents: number | null; totalCents: number | null; startAt: string | null; endAt: string | null }) {
  if (c.monthlyCents && c.monthlyCents > 0) return c.monthlyCents * 12;
  if (!c.totalCents) return 0;
  const days = c.startAt && c.endAt ? Math.max(1, (Date.parse(c.endAt) - Date.parse(c.startAt)) / 86_400_000) : 365;
  return Math.round(c.totalCents * Math.min(1, 365 / days));
}
export function tierOf(acvCents: number, b: CsConfig['tierBands']): Tier {
  return acvCents >= b.largeFromCents ? 'large' : acvCents >= b.middleFromCents ? 'middle' : 'small';
}

// ------------------------------------------------------------------ IPC
export type IpcInput = Partial<Record<IpcCriterion, IpcLevel | null>>;
export function ipcScore(input: IpcInput, cfg: CsConfig) {
  const parts = IPC_CRITERIA.map((k) => ({ key: k, level: input[k] ?? null, points: input[k] ? cfg.ipcPoints[k][input[k]!] : null }));
  const pending = parts.filter((p) => p.level === null).map((p) => p.key);
  const total = pending.length ? null : parts.reduce((s, p) => s + (p.points ?? 0), 0);
  return { parts, pending, total, partial: parts.reduce((s, p) => s + (p.points ?? 0), 0), complete: !pending.length };
}
export const tierToIpc = (t: Tier): IpcLevel => (t === 'large' ? 'alto' : t === 'middle' ? 'medio' : 'baixo');
export const monthsToIpc = (m: number): IpcLevel => (m > 24 ? 'alto' : m >= 6 ? 'medio' : 'baixo');

// ------------------------------------------------------------------ saúde
/** Cada fator vem de 0 (péssimo) a 100 (ótimo) ou null (sem dado). Média ponderada só do que existe. */
export function healthScore(f: Partial<Record<HealthFactor, number | null>>, cfg: CsConfig) {
  let w = 0, sum = 0;
  const totalW = HEALTH_FACTORS.reduce((s, k) => s + cfg.healthWeights[k], 0) || 1;
  const parts = HEALTH_FACTORS.map((k) => ({ key: k, value: f[k] ?? null, weight: cfg.healthWeights[k] }));
  for (const p of parts) if (p.value !== null && p.weight > 0) { w += p.weight; sum += p.value * p.weight; }
  const coverage = w / totalW;
  const score = w && coverage >= cfg.healthMinCoverage ? Math.round(sum / w) : null;
  return { score, coverage, parts, label: score === null ? 'Dados insuficientes' : score >= 75 ? 'Saudável' : score >= 50 ? 'Atenção' : 'Em risco' };
}

// ------------------------------------------------------------------ criticidade e prioridade
export type CritInput = {
  health: number | null; tier: Tier | null; ipc: number | null; classKey: string | null; consumptionPct: number | null; overdueCents: number | null;
  satisfaction: number | null; daysToEnd: number | null; churnRisk: 'baixo' | 'medio' | 'alto' | null; openOccurrences: number; daysOverdueFollowUp: number;
};
/** Pontos de pressão 0..1 por fator (1 = exige mais atenção), multiplicados pelos pesos; resultado 0..100 com os motivos. */
export function criticality(i: CritInput, cfg: CsConfig) {
  const r: { key: CritFactor; pressure: number; reason: string }[] = [];
  const add = (key: CritFactor, pressure: number, reason: string) => { if (pressure > 0) r.push({ key, pressure: Math.min(1, pressure), reason }); };
  if (i.health !== null) add('saude', (100 - i.health) / 100, `saúde em ${i.health}`);
  if (i.tier) add('tier', i.tier === 'large' ? 1 : i.tier === 'middle' ? 0.5 : 0, `Tier ${i.tier}`);
  if (i.ipc !== null) add('ipc', Math.max(0, (i.ipc - 20) / 80), `IPC ${i.ipc}`);
  if (i.classKey && cfg.critStrategicClasses.includes(i.classKey)) add('classe', 1, `classe ${i.classKey}`);
  if (i.consumptionPct !== null) add('consumo', i.consumptionPct >= cfg.alerts.consumptionHighPct ? 1 : i.consumptionPct <= cfg.alerts.consumptionLowPct ? 0.6 : 0, i.consumptionPct >= cfg.alerts.consumptionHighPct ? `consumo em ${Math.round(i.consumptionPct)}%` : `baixo consumo (${Math.round(i.consumptionPct)}%)`);
  if (i.overdueCents !== null && i.overdueCents > 0) add('inadimplencia', 1, 'títulos vencidos');
  if (i.satisfaction !== null) add('satisfacao', (100 - i.satisfaction) / 100, `satisfação ${i.satisfaction}/100`);
  if (i.daysToEnd !== null && i.daysToEnd <= cfg.alerts.renewalDays) add('vencimento', i.daysToEnd <= 30 ? 1 : 0.6, i.daysToEnd < 0 ? 'contrato vencido' : `vence em ${i.daysToEnd} dias`);
  if (i.churnRisk) add('risco', i.churnRisk === 'alto' ? 1 : i.churnRisk === 'medio' ? 0.5 : 0, `risco de cancelamento ${i.churnRisk}`);
  if (i.openOccurrences) add('ocorrencias', i.openOccurrences >= 3 ? 1 : i.openOccurrences / 3, `${i.openOccurrences} ocorrência(s) aberta(s)`);
  if (i.daysOverdueFollowUp > 0) add('acompanhamento', i.daysOverdueFollowUp >= 30 ? 1 : i.daysOverdueFollowUp / 30, `acompanhamento atrasado há ${i.daysOverdueFollowUp} dia(s)`);
  const totalW = CRIT_FACTORS.reduce((s, k) => s + cfg.critWeights[k], 0) || 1;
  const points = Math.round((r.reduce((s, x) => s + x.pressure * cfg.critWeights[x.key], 0) / totalW) * 100);
  const t = cfg.critThresholds;
  const level: CsLevel = points >= t.critica ? 'critica' : points >= t.alta ? 'alta' : points >= t.moderada ? 'moderada' : 'baixa';
  const reasons = [...r].sort((a, b) => b.pressure * cfg.critWeights[b.key] - a.pressure * cfg.critWeights[a.key]).map((x) => ({ key: x.key, reason: x.reason, points: Math.round((x.pressure * cfg.critWeights[x.key] * 100) / totalW) })).filter((x) => x.points > 0);
  return { points, level, reasons };
}
const RANK: Record<CsLevel, number> = { baixa: 0, moderada: 1, alta: 2, critica: 3 };
export function effectivePriority(calculated: CsLevel, manual: { level: CsLevel; reviewAt: string | null } | null, rule: Precedence, today: string): { level: CsLevel; source: 'calculada' | 'manual' } {
  if (!manual) return { level: calculated, source: 'calculada' };
  if (rule === 'maior') return RANK[manual.level] > RANK[calculated] ? { level: manual.level, source: 'manual' } : { level: calculated, source: 'calculada' };
  if (rule === 'manual_ate_revisao' && manual.reviewAt && manual.reviewAt < today) return { level: calculated, source: 'calculada' };
  return { level: manual.level, source: 'manual' };
}
export const levelRank = (l: CsLevel) => RANK[l];

// ------------------------------------------------------------------ cadência
export function policyFor(acc: { criticality: CsLevel; tier: Tier | null; classKey: string | null; billingType: string | null; segment: string | null; csmId: string | null }, cfg: CsConfig) {
  const specificity = (p: CadencePolicy) => Object.values(p.when).filter((v) => v !== null && v !== undefined && v !== '').length;
  const match = (p: CadencePolicy) => (Object.entries(p.when) as [keyof CadencePolicy['when'], string | null | undefined][]).every(([k, v]) => v === null || v === undefined || v === '' || (k === 'criticality' ? acc.criticality === v : (acc as Record<string, unknown>)[k] === v));
  return [...cfg.cadence].filter(match).sort((a, b) => specificity(b) - specificity(a))[0] ?? null;
}
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Datas previstas no horizonte, a partir da última execução (ou de hoje). */
export function cadenceDates(lastDone: string | null, everyDays: number | null, today: string, horizonDays: number) {
  if (!everyDays || everyDays <= 0) return [];
  const out: string[] = [];
  let d = lastDone ? addDays(lastDone, everyDays) : today;
  if (d < today) d = today;
  const end = addDays(today, horizonDays);
  while (d <= end && out.length < 60) { out.push(d); d = addDays(d, everyDays); }
  return out;
}

// ------------------------------------------------------------------ cobertura
export type FollowUp = { plannedAt: string; completedAt: string | null; validated: boolean; weight: number; cadence: boolean };
/** Cobertura simples e ponderada: só conta o realizado e validado até a data prevista + tolerância. Extras ficam separados. */
export function coverage(items: FollowUp[], toleranceDays: number) {
  const planned = items.filter((i) => i.cadence);
  const onTime = planned.filter((i) => i.validated && i.completedAt && i.completedAt.slice(0, 10) <= addDays(i.plannedAt, toleranceDays));
  const extra = items.filter((i) => !i.cadence && i.validated && i.completedAt).length;
  const w = (xs: FollowUp[]) => xs.reduce((s, x) => s + x.weight, 0);
  return {
    planned: planned.length, onTime: onTime.length, extra,
    simple: planned.length ? Math.min(1, onTime.length / planned.length) : null,
    weighted: w(planned) ? Math.min(1, w(onTime) / w(planned)) : null,
  };
}

/** Tipos de alerta (chave → rótulo) para configurar quais ficam ligados. */
export const CS_ALERT_KEYS: Record<string, string> = {
  sem_contato: 'Conta sem contato', visita_atrasada: 'Visita atrasada', pesquisa_pendente: 'Pesquisa pendente', queda_satisfacao: 'Queda de satisfação', estrategica_sem_acompanhamento: 'Conta estratégica sem acompanhamento',
  vencimento: 'Vencimento próximo', renovacao_sem_plano: 'Renovação sem planejamento', consumo_limite: 'Consumo próximo do limite', esgotamento: 'Esgotamento antecipado', baixo_consumo: 'Baixo consumo', medicao_pendente: 'Medição pendente',
  upgrade_identificado: 'Upgrade identificado', expansao_sem_acao: 'Potencial de expansão sem ação', negociacao_sem_acompanhamento: 'Negociação sem acompanhamento', mudanca_ipc: 'Mudança relevante no IPC',
  aumento_criticidade: 'Aumento de criticidade', queda_saude: 'Queda de saúde', ocorrencia_relevante: 'Ocorrência relevante', risco_cancelamento: 'Risco de cancelamento', ipc_revisao: 'Revisão do IPC', satisfacao_desatualizada: 'Satisfação desatualizada',
};
