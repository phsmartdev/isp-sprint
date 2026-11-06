/**
 * ABM Fase 4 — Stakeholders. Pessoa única (pode estar em várias organizações) + vínculo com a conta (dados próprios).
 * PODER DE INFLUÊNCIA: sempre manual, por pessoa autorizada, com justificativa e histórico; por contexto (conta, unidade,
 * oportunidade, projeto, processo). Nenhuma automação, importação, sincronização ou IA define ou altera esse valor.
 */

export const STAKEHOLDER_ROLES = ['decisor', 'influenciador', 'avaliador_tecnico', 'usuario', 'aprovador_financeiro', 'patrocinador', 'responsavel_contratacao', 'fiscal_contrato', 'gestor_tecnico', 'gestor_politico', 'bloqueador'] as const;
export type StakeholderRole = (typeof STAKEHOLDER_ROLES)[number];
export const STAKEHOLDER_ROLE_LABELS: Record<StakeholderRole, string> = {
  decisor: 'Decisor', influenciador: 'Influenciador', avaliador_tecnico: 'Avaliador técnico', usuario: 'Usuário', aprovador_financeiro: 'Aprovador financeiro', patrocinador: 'Patrocinador',
  responsavel_contratacao: 'Responsável por contratação', fiscal_contrato: 'Fiscal de contrato', gestor_tecnico: 'Gestor técnico', gestor_politico: 'Gestor político-institucional', bloqueador: 'Bloqueador',
};

// ---------------------------------------------------------------- influência (manual)
export const INFLUENCE_LEVELS = ['muito_alto', 'alto', 'medio', 'baixo', 'muito_baixo', 'nao_avaliado'] as const;
export type InfluenceLevel = (typeof INFLUENCE_LEVELS)[number];
export const DEFAULT_INFLUENCE_LABELS: Record<InfluenceLevel, string> = { muito_alto: 'Muito alto', alto: 'Alto', medio: 'Médio', baixo: 'Baixo', muito_baixo: 'Muito baixo', nao_avaliado: 'Não avaliado' };
/** 5 = muito alto … 1 = muito baixo; não avaliado não tem posição. */
export const influenceRank = (l: InfluenceLevel): number | null => (l === 'nao_avaliado' ? null : 5 - INFLUENCE_LEVELS.indexOf(l));
export const INFLUENCE_CONTEXTS = ['conta', 'unidade', 'oportunidade', 'projeto', 'processo'] as const;
export type InfluenceContext = (typeof INFLUENCE_CONTEXTS)[number];
export const INFLUENCE_CONTEXT_LABELS: Record<InfluenceContext, string> = { conta: 'Conta', unidade: 'Unidade / departamento', oportunidade: 'Oportunidade', projeto: 'Projeto', processo: 'Processo decisório' };
/** Origem de quem tenta mudar a influência: só "manual" é aceita. */
export type ChangeOrigin = 'manual' | 'automacao' | 'importacao' | 'sincronizacao' | 'ia' | 'pesquisa';
export function influenceChangeError(input: { origin: ChangeOrigin; to: InfluenceLevel; from: InfluenceLevel; justification?: string | null; contextType: InfluenceContext; contextId?: string | null }) {
  if (input.origin !== 'manual') return 'O poder de influência só pode ser definido manualmente por uma pessoa autorizada.';
  if (input.from === input.to) return 'A classificação já é esta.';
  if ((input.justification ?? '').trim().length < 10) return 'Explique a avaliação (justificativa com pelo menos 10 caracteres).';
  if (input.contextType !== 'conta' && !input.contextId) return 'Indique a qual unidade, oportunidade, projeto ou processo esta avaliação se refere.';
  return null;
}

// ---------------------------------------------------------------- demais dimensões (independentes da influência)
export const STANCES = ['defensor', 'favoravel', 'neutro', 'resistente', 'opositor', 'desconhecido'] as const;
export type Stance = (typeof STANCES)[number];
export const STANCE_LABELS: Record<Stance, string> = { defensor: 'Defensor', favoravel: 'Favorável', neutro: 'Neutro', resistente: 'Resistente', opositor: 'Opositor', desconhecido: 'Desconhecido' };
export const INTERESTS = ['alto', 'medio', 'baixo', 'desconhecido'] as const;
export type Interest = (typeof INTERESTS)[number];
export const INTEREST_LABELS: Record<Interest, string> = { alto: 'Alto', medio: 'Médio', baixo: 'Baixo', desconhecido: 'Desconhecido' };
export const RELATIONSHIP_STRENGTHS = ['forte', 'moderado', 'fraco', 'inexistente', 'nao_avaliado'] as const;
export type RelationshipStrength = (typeof RELATIONSHIP_STRENGTHS)[number];
export const RELATIONSHIP_LABELS: Record<RelationshipStrength, string> = { forte: 'Forte', moderado: 'Moderado', fraco: 'Fraco', inexistente: 'Inexistente', nao_avaliado: 'Não avaliado' };
export const STAKEHOLDER_ACCESS = ['direto', 'indireto', 'sem_acesso', 'nao_avaliado'] as const;
export type StakeholderAccess = (typeof STAKEHOLDER_ACCESS)[number];
export const STAKEHOLDER_ACCESS_LABELS: Record<StakeholderAccess, string> = { direto: 'Direto', indireto: 'Indireto', sem_acesso: 'Sem acesso', nao_avaliado: 'Não avaliado' };
export const PARTICIPATIONS = ['ativo', 'ocasional', 'inativo', 'nao_avaliado'] as const;
export type Participation = (typeof PARTICIPATIONS)[number];
export const PARTICIPATION_LABELS: Record<Participation, string> = { ativo: 'Ativo', ocasional: 'Ocasional', inativo: 'Inativo', nao_avaliado: 'Não avaliado' };
export const STAKEHOLDER_PRIORITIES = ['critica', 'alta', 'media', 'baixa'] as const;
export type StakeholderPriority = (typeof STAKEHOLDER_PRIORITIES)[number];

// ---------------------------------------------------------------- mapa de influência
export type Quadrant = 'gerenciar_de_perto' | 'manter_satisfeito' | 'manter_informado' | 'monitorar';
export const QUADRANT_LABELS: Record<Quadrant, { title: string; hint: string }> = {
  gerenciar_de_perto: { title: 'Gerenciar de perto', hint: 'Alta influência e alto interesse' },
  manter_satisfeito: { title: 'Manter satisfeitos', hint: 'Alta influência e baixo interesse' },
  manter_informado: { title: 'Manter informados', hint: 'Baixa influência e alto interesse' },
  monitorar: { title: 'Monitorar', hint: 'Baixa influência e baixo interesse' },
};
/**
 * Quadrante pela influência (manual) e pelo interesse. Alta influência = médio, alto ou muito alto (rank ≥ 3);
 * alto interesse = alto ou médio. Sem avaliação de influência, ou interesse desconhecido, fica fora da matriz.
 */
export function quadrantOf(influence: InfluenceLevel, interest: Interest): Quadrant | null {
  const r = influenceRank(influence);
  if (r === null || interest === 'desconhecido') return null;
  const hiInf = r >= 3;
  const hiInt = interest === 'alto' || interest === 'medio';
  return hiInf ? (hiInt ? 'gerenciar_de_perto' : 'manter_satisfeito') : hiInt ? 'manter_informado' : 'monitorar';
}

/** Configuração de quem vê/edita a influência (nível mínimo no módulo Contas) e se a mudança precisa de aprovação. */
export type InfluencePolicy = { view: 'proprio' | 'equipe' | 'total'; edit: 'proprio' | 'equipe' | 'total'; requireApproval: boolean; labels: Record<InfluenceLevel, string> };
export const DEFAULT_INFLUENCE_POLICY: InfluencePolicy = { view: 'proprio', edit: 'proprio', requireApproval: false, labels: { ...DEFAULT_INFLUENCE_LABELS } };
export function validateInfluencePolicy(p: InfluencePolicy) {
  const e: string[] = [];
  const order = ['proprio', 'equipe', 'total'];
  if (order.indexOf(p.edit) < order.indexOf(p.view)) e.push('Quem edita precisa também poder ver: o nível para editar não pode ser menor que o para ver.');
  for (const l of INFLUENCE_LEVELS) if (!(p.labels[l] ?? '').trim()) e.push(`Dê um nome ao nível "${DEFAULT_INFLUENCE_LABELS[l]}".`);
  return e;
}

// ---------------------------------------------------------------- análise de stakeholders (influência × autoridade)
/**
 * Classificação do papel na jornada de compra:
 * IA = tem influência e autoridade · INA = influência sem autoridade · NIA = autoridade sem influência · NINA = nenhuma das duas.
 * Escolhida pela pessoa que mapeia a conta (o sistema só sugere a partir dos papéis e da influência avaliada).
 */
export const POWER_CLASSES = ['ia', 'ina', 'nia', 'nina', 'nao_avaliado'] as const;
export type PowerClass = (typeof POWER_CLASSES)[number];
export const POWER_CLASS_LABELS: Record<PowerClass, string> = { ia: 'IA', ina: 'INA', nia: 'NIA', nina: 'NINA', nao_avaliado: 'Não classificado' };
export const POWER_CLASS_DESC: Record<PowerClass, string> = {
  ia: 'Influência e autoridade', ina: 'Influência, mas sem autoridade', nia: 'Autoridade, mas sem influência', nina: 'Sem influência e sem autoridade', nao_avaliado: 'Ainda não classificado',
};
/** Papéis que dão autoridade formal na decisão (decide, aprova, contrata ou patrocina). */
export const AUTHORITY_ROLES: readonly StakeholderRole[] = ['decisor', 'aprovador_financeiro', 'responsavel_contratacao', 'patrocinador', 'gestor_politico'];
/** Sugestão (nunca grava sozinha): autoridade pelos papéis; influência pela avaliação manual (médio ou mais). */
export function suggestPowerClass(roles: readonly StakeholderRole[], influence: InfluenceLevel | null | undefined): PowerClass | null {
  if (!influence || influence === 'nao_avaliado') return null;
  const inf = influence === 'muito_alto' || influence === 'alto' || influence === 'medio';
  const aut = roles.some((r) => AUTHORITY_ROLES.includes(r));
  return inf ? (aut ? 'ia' : 'ina') : aut ? 'nia' : 'nina';
}

export const INNOVATION_OPENNESS = ['alta', 'media', 'baixa', 'nao_avaliado'] as const;
export type InnovationOpenness = (typeof INNOVATION_OPENNESS)[number];
export const INNOVATION_LABELS: Record<InnovationOpenness, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa', nao_avaliado: 'Não avaliada' };

/** Fontes usadas para traçar o perfil. */
export const PROFILE_SOURCE_KINDS = ['linkedin', 'imprensa', 'site_oficial', 'diario_oficial', 'outro'] as const;
export type ProfileSourceKind = (typeof PROFILE_SOURCE_KINDS)[number];
export const PROFILE_SOURCE_LABELS: Record<ProfileSourceKind, string> = { linkedin: 'LinkedIn', imprensa: 'Imprensa', site_oficial: 'Site oficial', diario_oficial: 'Diário oficial', outro: 'Outra fonte' };
export type ProfileSource = { kind: ProfileSourceKind; url: string | null; note: string | null; at?: string | null };

/**
 * Organograma: árvore pelo "reporta a" de cada pessoa (só entre pessoas ativas da mesma conta). Quem não reporta a
 * ninguém do mapa vira raiz; um ciclo é quebrado na primeira pessoa encontrada. Agentes ocultos ficam fora da árvore.
 */
export type OrgNode<T> = { item: T; children: OrgNode<T>[] };
export function buildOrgChart<T extends { id: string; reportsToId: string | null; hiddenAgent?: boolean; active?: boolean; name: string }>(items: readonly T[]) {
  const visible = items.filter((i) => i.active !== false && !i.hiddenAgent);
  const byId = new Map(visible.map((i) => [i.id, i]));
  const parentOf = (i: T) => (i.reportsToId && byId.has(i.reportsToId) && i.reportsToId !== i.id ? i.reportsToId : null);
  // quebra ciclos: sobe a cadeia; se voltar para si mesmo, vira raiz
  const cyclic = new Set<string>();
  for (const i of visible) {
    const seen = new Set<string>([i.id]);
    let p = parentOf(i);
    while (p) { if (seen.has(p)) { cyclic.add(i.id); break; } seen.add(p); p = parentOf(byId.get(p)!); }
  }
  const nodes = new Map(visible.map((i) => [i.id, { item: i, children: [] as OrgNode<T>[] }]));
  const roots: OrgNode<T>[] = [];
  for (const i of visible) {
    const p = cyclic.has(i.id) ? null : parentOf(i);
    if (p) nodes.get(p)!.children.push(nodes.get(i.id)!); else roots.push(nodes.get(i.id)!);
  }
  const sort = (ns: OrgNode<T>[]) => { ns.sort((a, b) => a.item.name.localeCompare(b.item.name, 'pt-BR')); ns.forEach((n) => sort(n.children)); };
  sort(roots);
  return { roots, hidden: items.filter((i) => i.active !== false && i.hiddenAgent), cyclic: [...cyclic] };
}
/** reportsTo válido: mesma conta, não a si mesmo e sem criar ciclo. Retorna o erro ou null. */
export function reportsToError(id: string, reportsToId: string | null, items: readonly { id: string; reportsToId: string | null }[]): string | null {
  if (!reportsToId) return null;
  if (reportsToId === id) return 'A pessoa não pode reportar a si mesma.';
  const byId = new Map(items.map((i) => [i.id, i]));
  if (!byId.has(reportsToId)) return 'Quem recebe o reporte não é stakeholder desta conta.';
  let p: string | null = reportsToId; const seen = new Set<string>();
  while (p) { if (p === id) return 'Isso cria um ciclo no organograma (a pessoa acabaria reportando a si mesma).'; if (seen.has(p)) break; seen.add(p); p = byId.get(p)?.reportsToId ?? null; }
  return null;
}
