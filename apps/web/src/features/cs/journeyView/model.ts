/**
 * Jornada do cliente (visualização em montanha): modelo e ADAPTADOR dos dados reais do CRM.
 * Regras: nada é inventado. Etapa = etapa registrada do card da conta no funil Sucesso do Cliente; saúde = Health Score já
 * calculado (mesmas faixas do HealthBadge: ≥ 75 saudável, ≥ 50 atenção, abaixo risco); risco = alertas e ocorrências abertos.
 * Sem dado → null, e a interface mostra "Dado não disponível". A visualização é só de consulta.
 */
import type { JourneyPhase } from '@isp/domain';

export const MICRO = [
  { key: 'analise', name: 'Análise da Demanda', macro: 0, goal: 'Entender a necessidade do cliente e o escopo contratado.', match: /an[aá]lise.*demanda/i },
  { key: 'planejamento', name: 'Planejamento', macro: 0, goal: 'Planejar a implantação, prazos, responsáveis e expectativas.', match: /planejamento/i },
  { key: 'entrega', name: 'Entrega', macro: 0, goal: 'Acompanhar a entrega do serviço até a operação.', match: /entrega/i },
  { key: 'alinhamento', name: 'Alinhamento CS', macro: 0, goal: 'Consolidar a primeira experiência e alinhar o acompanhamento.', match: /alinhamento/i },
  { key: 'adocao', name: 'Adoção e Engajamento', macro: 1, goal: 'Garantir o uso da solução e o engajamento do cliente.', match: /ado[cç][aã]o|engajamento/i },
  { key: 'consolidacao', name: 'Consolidação de Valor', macro: 1, goal: 'Evidenciar o valor entregue e fortalecer a relação.', match: /consolida/i },
  { key: 'expansao', name: 'Expansão', macro: 2, goal: 'Avaliar continuidade, renovação e oportunidades de crescimento.', match: /expans/i },
] as const;
export const MACRO = [
  { key: 'onboarding', name: 'Onboarding', ref: '90 dias (referência do playbook)' },
  { key: 'ongoing', name: 'Ongoing', ref: '180 dias (referência do playbook)' },
  { key: 'expansao', name: 'Expansão', ref: 'idealmente nos 90 dias antes da renovação' },
] as const;

/** Marco do modelo de jornada → microetapa onde ele aparece na cena (agrupamento visual; não altera a etapa da conta). */
const MILESTONE_MICRO: Record<string, number> = { boas_vindas: 0, kickoff: 0, planejamento: 1, cronograma: 1, implantacao: 2, aceite: 2, d30: 3, d60: 3, d90: 3, uso: 4, pesquisa: 4, qbr1: 5, melhorias: 5, expansao: 6 };
export const microOfMilestone = (key: string, phase: JourneyPhase) => MILESTONE_MICRO[key] ?? (phase === 'renovacao' ? 6 : phase === 'adocao' ? 4 : 0);

export type HealthState = 'saudavel' | 'atencao' | 'risco' | 'sem_dados';
export const healthState = (score: number | null): HealthState => (score === null ? 'sem_dados' : score >= 75 ? 'saudavel' : score >= 50 ? 'atencao' : 'risco');
export const HEALTH_TEXT: Record<HealthState, string> = { saudavel: 'Saudável', atencao: 'Atenção', risco: 'Em risco', sem_dados: 'Dado não disponível' };

export type JMilestone = { id: string; title: string; micro: number; contract: string | null; plannedAt: string | null; doneAt: string | null; owner: string | null; notes: string | null };
export type JEvent = { at: string; kind: 'inicio' | 'etapa' | 'marco' | 'reuniao' | 'visita' | 'contato' | 'feedback' | 'saude' | 'ocorrencia' | 'renovacao' | 'expansao' | 'contrato'; title: string; detail?: string; who?: string | null; micro?: number | null; score?: number | null };
export type JRisk = { title: string; level: 'atencao' | 'risco'; source: string; since: string | null };
export type JExpansion = { title: string; state: 'identificada' | 'avaliacao' | 'renovacao' | 'contratada' | 'novo_ciclo'; at: string | null; valueCents?: number | null };
export const EXP_TEXT: Record<JExpansion['state'], string> = { identificada: 'Oportunidade identificada', avaliacao: 'Oportunidade em avaliação', renovacao: 'Renovação em andamento', contratada: 'Expansão contratada', novo_ciclo: 'Novo ciclo iniciado' };

export type JModel = {
  demo: boolean;
  account: { id: string; name: string; csm: string | null; since: string | null; relationshipMonths: number | null; contracts: { number: string; endAt: string | null }[]; renewalAt: string | null; daysToEnd: number | null };
  stage: { name: string | null; micro: number | null; enteredAt: string | null; unmatched: boolean };
  /** entradas registradas em cada microetapa (histórico do funil); vazio quando não houver registro */
  stageHistory: { micro: number | null; name: string; at: string; who: string | null }[];
  health: { score: number | null; label: string | null; at: string | null; parts: { key: string; value: number | null }[]; history: { at: string; score: number | null }[] };
  nps: { score: number; scale: number; at: string; kind: string } | null;
  adoption: { text: string } | null;
  nextInteraction: { title: string; at: string } | null;
  tasks: { title: string; at: string | null; owner: string | null; late: boolean; micro: number | null }[];
  risks: JRisk[];
  milestones: JMilestone[];
  expansion: JExpansion[];
  events: JEvent[];
};

const day = (x: string | null | undefined) => (x ? x.slice(0, 10) : null);
const microOfStageName = (name: string | null | undefined) => { if (!name) return null; const i = MICRO.findIndex((m) => m.match.test(name)); return i < 0 ? null : i; };

type A360 = {
  contact: { id: string; name: string }; csm: { name: string } | null;
  snapshot: { relationshipMonths: number | null; daysToEnd: number | null; health: { score: number | null; label: string; parts: { key: string; value: number | null }[] }; computedAt: string; nextContactAt: string | null; contracts: { number: string; stage: string; startAt: string | null; endAt: string | null; consumption: null | { share: number | null } }[] } | null;
  alerts: { key: string; level: string; text: string; category: string; firstSeenAt: string }[];
  plans: { kind: string; title: string; severity: string | null; status: string; createdAt: string; ownerName: string | null; dueAt: string | null }[];
  visits: { type: string; objective: string; plannedAt: string; doneAt: string | null; status: string; csmName: string | null; summary: string | null }[];
  surveys: { kind: string; score: number; scale: number; respondedAt: string; comment: string | null }[];
  history: { kind: string; score: number | null; level: string | null; createdAt: string; actorName: string | null }[];
  followUps: { title: string; kind: string | null; dueAt: string | null; plannedAt: string | null; completedAt: string | null; ownerName: string | null }[];
};
type J3D = {
  card: { stage: string; stageName: string; stageChangedAt: string; createdAt: string } | null;
  stageEvents: { type: string; toName: string | null; at: string; actor: string | null }[];
  journeys: { id: string; startedAt: string; number: string | null; endAt: string | null; status: string }[];
  milestones: { id: string; journeyId: string; phase: JourneyPhase; key: string; title: string; plannedAt: string | null; doneAt: string | null; notes: string | null; ownerName: string | null }[];
  opportunities: { title: string; stage: string; stageName: string; firstStage: boolean; valueCents: number | null; wonAt: string | null; createdAt: string }[];
};

/** Adaptador: dados reais (visão 360° + jornada 3D) → modelo da cena. */
export function adapt(a: A360, j: J3D): JModel {
  const today = new Date().toISOString().slice(0, 10);
  const sn = a.snapshot;
  const contractOf = new Map(j.journeys.map((x) => [x.id, x.number]));
  const milestones: JMilestone[] = j.milestones.map((m) => ({ id: m.id, title: m.title, micro: microOfMilestone(m.key, m.phase), contract: contractOf.get(m.journeyId) ?? null, plannedAt: m.plannedAt, doneAt: day(m.doneAt), owner: m.ownerName, notes: m.notes }));
  const stageHistory = j.stageEvents.filter((e) => e.toName).map((e) => ({ micro: microOfStageName(e.toName), name: e.toName!, at: day(e.at)!, who: e.actor }));
  const micro = microOfStageName(j.card?.stageName);
  const since = [j.journeys[0]?.startedAt, day(j.card?.createdAt)].filter(Boolean).sort()[0] ?? null;
  const ends = j.journeys.map((x) => x.endAt).filter((x): x is string => !!x && x >= today).sort();
  const risks: JRisk[] = [
    ...a.alerts.map((x) => ({ title: x.text, level: (x.level === 'alta' || x.level === 'critica' ? 'risco' : 'atencao') as JRisk['level'], source: 'Alerta do Sucesso do Cliente', since: day(x.firstSeenAt) })),
    ...a.plans.filter((p) => p.status === 'aberto').map((p) => ({ title: p.title, level: (p.severity === 'alta' || p.severity === 'critica' ? 'risco' : 'atencao') as JRisk['level'], source: p.kind === 'ocorrencia' ? 'Ocorrência aberta' : 'Plano de ação aberto', since: day(p.createdAt) })),
  ];
  const expansion: JExpansion[] = [
    ...j.opportunities.filter((o) => !['ganha', 'perdida'].includes(o.stage)).map((o) => ({ title: o.title, state: (o.firstStage ? 'identificada' : 'avaliacao') as JExpansion['state'], at: day(o.createdAt), valueCents: o.valueCents })),
    ...(sn?.contracts ?? []).filter((c) => c.stage === 'renovacao').map((c) => ({ title: `Contrato ${c.number}`, state: 'renovacao' as const, at: null })),
    ...j.opportunities.filter((o) => o.stage === 'ganha' && o.wonAt && since && day(o.wonAt)! >= since).map((o) => ({ title: o.title, state: 'contratada' as const, at: day(o.wonAt), valueCents: o.valueCents })),
    ...j.journeys.slice(1).map((x) => ({ title: `Nova jornada${x.number ? ` · contrato ${x.number}` : ''}`, state: 'novo_ciclo' as const, at: x.startedAt })),
  ];
  const tasks = [
    ...a.followUps.filter((f) => !f.completedAt).map((f) => { const at = day(f.plannedAt ?? f.dueAt); return { title: f.title, at, owner: f.ownerName, late: !!at && at < today, micro: null }; }),
    ...milestones.filter((m) => !m.doneAt).map((m) => ({ title: m.title, at: m.plannedAt, owner: m.owner, late: !!m.plannedAt && m.plannedAt < today, micro: m.micro })),
  ].sort((x, y) => (x.at ?? '9999').localeCompare(y.at ?? '9999'));
  const next = tasks.find((t) => t.at && t.at >= today) ?? null;
  const nps = a.surveys.find((x) => x.kind === 'nps') ?? null;
  const cons = (sn?.contracts ?? []).map((c) => c.consumption?.share).filter((x): x is number => typeof x === 'number');
  const events: JEvent[] = [
    ...(since ? [{ at: since, kind: 'inicio' as const, title: 'Início do relacionamento acompanhado' }] : []),
    ...stageHistory.map((h) => ({ at: h.at, kind: 'etapa' as const, title: `Entrada em ${h.name}`, who: h.who, micro: h.micro })),
    ...milestones.filter((m) => m.doneAt).map((m) => ({ at: m.doneAt!, kind: 'marco' as const, title: m.title, who: m.owner, micro: m.micro, detail: m.contract ? `Contrato ${m.contract}` : undefined })),
    ...a.visits.filter((v) => v.doneAt).map((v) => ({ at: day(v.doneAt)!, kind: 'visita' as const, title: `Visita ${v.type.toLowerCase()}`, detail: v.summary ?? v.objective, who: v.csmName })),
    ...a.followUps.filter((f) => f.completedAt).map((f) => ({ at: day(f.completedAt)!, kind: (f.kind === 'reuniao' ? 'reuniao' : 'contato') as JEvent['kind'], title: f.title, who: f.ownerName })),
    ...a.surveys.map((x) => ({ at: x.respondedAt, kind: 'feedback' as const, title: `${x.kind.toUpperCase()} ${x.score}/${x.scale}`, detail: x.comment ?? undefined, score: x.score })),
    ...a.history.filter((h) => h.kind === 'saude').map((h) => ({ at: day(h.createdAt)!, kind: 'saude' as const, title: `Health Score ${h.score ?? '—'}`, score: h.score })),
    ...a.plans.filter((p) => p.kind === 'ocorrencia').map((p) => ({ at: day(p.createdAt)!, kind: 'ocorrencia' as const, title: p.title, who: p.ownerName })),
    ...expansion.filter((x) => x.at && (x.state === 'contratada' || x.state === 'novo_ciclo')).map((x) => ({ at: x.at!, kind: 'expansao' as const, title: `${EXP_TEXT[x.state]}: ${x.title}` })),
  ].sort((x, y) => x.at.localeCompare(y.at));
  return {
    demo: false,
    account: { id: a.contact.id, name: a.contact.name, csm: a.csm?.name ?? null, since, relationshipMonths: sn?.relationshipMonths ?? null, contracts: j.journeys.filter((x) => x.number).map((x) => ({ number: x.number!, endAt: x.endAt })), renewalAt: ends[0] ?? null, daysToEnd: sn?.daysToEnd ?? null },
    stage: { name: j.card?.stageName ?? null, micro, enteredAt: day(j.card?.stageChangedAt), unmatched: !!j.card && micro === null },
    stageHistory,
    health: { score: sn?.health.score ?? null, label: sn?.health.label ?? null, at: day(sn?.computedAt), parts: sn?.health.parts ?? [], history: a.history.filter((h) => h.kind === 'saude').map((h) => ({ at: day(h.createdAt)!, score: h.score })).reverse() },
    nps: nps ? { score: nps.score, scale: nps.scale, at: nps.respondedAt, kind: nps.kind } : null,
    adoption: cons.length ? { text: `Consumo do contrato: ${Math.round((cons.reduce((s, x) => s + x, 0) / cons.length) * 100)}% do crédito` } : null,
    nextInteraction: next ? { title: next.title, at: next.at! } : null,
    tasks, risks, milestones, expansion, events,
  };
}

/** Estado conhecido numa data (linha do tempo): só o que foi REGISTRADO até ali; nada é reconstruído. */
export function stateAt(m: JModel, date: string | null) {
  if (!date) return { micro: m.stage.micro, healthScore: m.health.score, doneIds: new Set(m.milestones.filter((x) => x.doneAt).map((x) => x.id)), knownStage: m.stage.name, historical: false };
  const entries = m.stageHistory.filter((h) => h.at <= date);
  const last = entries[entries.length - 1];
  const hs = m.health.history.filter((h) => h.at <= date);
  return {
    micro: last ? last.micro : null,
    healthScore: hs.length ? hs[hs.length - 1]!.score : null,
    doneIds: new Set(m.milestones.filter((x) => x.doneAt && x.doneAt <= date).map((x) => x.id)),
    knownStage: last ? last.name : null,
    historical: true,
  };
}

// ------------------------------------------------------------------ modo demonstrativo (dados fictícios, nunca gravados)
const addD = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
export const DEMO_SCENARIOS = [
  { key: 'onboarding', label: 'Onboarding saudável', micro: 2, score: 82 },
  { key: 'ongoing_risco', label: 'Ongoing com risco', micro: 4, score: 58 },
  { key: 'expansao', label: 'Expansão e renovação', micro: 6, score: 88 },
] as const;
export function demoModel(key: (typeof DEMO_SCENARIOS)[number]['key']): JModel {
  const sc = DEMO_SCENARIOS.find((x) => x.key === key)!;
  const today = new Date().toISOString().slice(0, 10);
  const start = addD(today, sc.micro <= 3 ? -48 : sc.micro <= 5 ? -210 : -320);
  const span = Math.max(1, (Date.parse(today) - Date.parse(start)) / 864e5);
  const at = (f: number) => addD(start, Math.round(span * f));
  const stepsAt = MICRO.slice(0, sc.micro + 1).map((_, i) => at((i / (sc.micro + 1)) * 0.95));
  const ms: [string, number, number][] = [['Boas-vindas', 0, 0.02], ['Reunião de kickoff', 0, 0.06], ['Planejamento', 1, 0.15], ['Implantação e entrega do serviço', 2, 0.3], ['Acompanhamento de 30 dias', 3, 0.45], ['Acompanhamento de 90 dias', 3, 0.6], ['Avaliação da utilização dos serviços', 4, 0.7], ['Pesquisa de satisfação', 4, 0.78], ['Análise trimestral (QBR)', 5, 0.86], ['Upgrades e cross-sell', 6, 0.93]];
  const milestones: JMilestone[] = ms.map(([title, micro, f], i) => {
    const done = micro < sc.micro || (micro === sc.micro && i % 2 === 0);
    return { id: `demo-m${i}`, title, micro, contract: 'DEMO-001', plannedAt: done ? at(f) : addD(today, micro === sc.micro ? -3 + i : 10 + i * 6), doneAt: done ? at(f) : null, owner: i === 3 ? 'Equipe de Implantação (fictícia)' : 'CSM Demonstração', notes: done ? 'Registro fictício para teste.' : null };
  });
  const hist = [0.2, 0.45, 0.7, 0.92].map((f, i) => ({ at: at(f), score: Math.max(30, Math.min(95, sc.score + [6, -4, 3, 0][i]!)) }));
  const risks: JRisk[] = [{ title: sc.key === 'ongoing_risco' ? 'Queda na satisfação e acompanhamento atrasado (fictício)' : 'Chamado recorrente de instabilidade em uma unidade (fictício)', level: sc.key === 'ongoing_risco' ? 'risco' : 'atencao', source: 'Alerta do Sucesso do Cliente (demonstração)', since: addD(today, -9) }];
  const expansion: JExpansion[] = sc.key === 'expansao'
    ? [{ title: 'Ampliação de links para novas unidades (fictício)', state: 'avaliacao', at: addD(today, -20), valueCents: 1_500_000 }, { title: 'Contrato DEMO-001', state: 'renovacao', at: null }, { title: 'Wi-Fi gerenciado (fictício)', state: 'contratada', at: addD(today, -40), valueCents: 800_000 }]
    : [{ title: 'Wi-Fi gerenciado para o anexo (fictício)', state: 'identificada', at: addD(today, -12), valueCents: 600_000 }];
  const stageHistory = stepsAt.map((d, i) => ({ micro: i, name: MICRO[i]!.name, at: d, who: 'CSM Demonstração' }));
  const tasks = [...milestones.filter((m) => !m.doneAt).map((m) => ({ title: m.title, at: m.plannedAt, owner: m.owner, late: !!m.plannedAt && m.plannedAt < today, micro: m.micro })), { title: 'Contato de acompanhamento (fictício)', at: addD(today, 4), owner: 'CSM Demonstração', late: false, micro: null }].sort((x, y) => (x.at ?? '').localeCompare(y.at ?? ''));
  const events = ([
    { at: start, kind: 'inicio', title: 'Início do relacionamento acompanhado' },
    ...stageHistory.map((h) => ({ at: h.at, kind: 'etapa' as const, title: `Entrada em ${h.name}`, who: h.who, micro: h.micro })),
    ...milestones.filter((m) => m.doneAt).map((m) => ({ at: m.doneAt!, kind: 'marco' as const, title: m.title, who: m.owner, micro: m.micro })),
    { at: at(0.35), kind: 'reuniao', title: 'Reunião de alinhamento (fictícia)', who: 'CSM Demonstração' },
    { at: at(0.55), kind: 'visita', title: 'Visita de relacionamento (fictícia)', who: 'CSM Demonstração' },
    { at: at(0.8), kind: 'feedback', title: 'NPS 9/10 (fictício)', score: 9 },
    ...hist.map((h) => ({ at: h.at, kind: 'saude' as const, title: `Health Score ${h.score}`, score: h.score })),
    { at: addD(today, -9), kind: 'ocorrencia', title: risks[0]!.title },
  ] as JEvent[]).sort((x, y) => x.at.localeCompare(y.at));
  return {
    demo: true,
    account: { id: 'demo', name: 'Conta Demonstração Ltda.', csm: 'CSM Demonstração', since: start, relationshipMonths: Math.round(span / 30), contracts: [{ number: 'DEMO-001', endAt: addD(today, sc.key === 'expansao' ? 75 : 400) }], renewalAt: addD(today, sc.key === 'expansao' ? 75 : 400), daysToEnd: sc.key === 'expansao' ? 75 : 400 },
    stage: { name: MICRO[sc.micro]!.name, micro: sc.micro, enteredAt: stepsAt[sc.micro]!, unmatched: false },
    stageHistory,
    health: { score: sc.score, label: healthState(sc.score) === 'saudavel' ? 'Saudável' : 'Atenção', at: today, parts: [{ key: 'satisfacao', value: sc.key === 'ongoing_risco' ? 55 : 90 }, { key: 'entregas', value: 80 }, { key: 'consumo', value: null }], history: hist },
    nps: { score: sc.key === 'ongoing_risco' ? 6 : 9, scale: 10, at: at(0.8), kind: 'nps' },
    adoption: { text: 'Consumo do contrato: 72% do crédito (fictício)' },
    nextInteraction: tasks.find((t) => t.at && t.at >= today) ? { title: tasks.find((t) => t.at && t.at >= today)!.title, at: tasks.find((t) => t.at && t.at >= today)!.at! } : null,
    tasks, risks, milestones, expansion, events,
  };
}
