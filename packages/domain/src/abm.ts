/**
 * ABM — Contas Estratégicas (camada sobre as contas existentes; não é um CRM paralelo).
 * Uma organização = um registro de conta (contacts). O ABM acrescenta status ABM, prioridade, objetivo e histórico.
 * O status comercial é derivado dos dados reais (cliente, contratos, oportunidades, interações) — nunca digitado.
 */

export const ABM_STATUSES = ['candidata', 'selecionada', 'em_planejamento', 'ativa', 'em_acompanhamento', 'pausada', 'encerrada'] as const;
export type AbmStatus = (typeof ABM_STATUSES)[number];
export const ABM_STATUS_LABELS: Record<AbmStatus, string> = { candidata: 'Candidata', selecionada: 'Selecionada', em_planejamento: 'Em planejamento', ativa: 'Ativa', em_acompanhamento: 'Em acompanhamento', pausada: 'Pausada', encerrada: 'Encerrada' };
export const ABM_PRIORITIES = ['critica', 'alta', 'media', 'baixa'] as const;
export type AbmPriority = (typeof ABM_PRIORITIES)[number];
export const ABM_PRIORITY_LABELS: Record<AbmPriority, string> = { critica: 'Crítica', alta: 'Alta', media: 'Média', baixa: 'Baixa' };
export const ABM_TIERS = ['1_1', '1_poucos', '1_muitos'] as const;
export type AbmTier = (typeof ABM_TIERS)[number];
export const ABM_TIER_LABELS: Record<AbmTier, string> = { '1_1': '1:1 (estratégica)', '1_poucos': '1:poucos (cluster)', '1_muitos': '1:muitos (escala)' };
export const ABM_ORIGINS = ['indicacao', 'pesquisa_mercado', 'licitacao', 'evento', 'base_existente', 'parceiro', 'inbound', 'outro'] as const;
export type AbmOrigin = (typeof ABM_ORIGINS)[number];
export const ABM_ORIGIN_LABELS: Record<AbmOrigin, string> = { indicacao: 'Indicação', pesquisa_mercado: 'Pesquisa de mercado', licitacao: 'Edital / licitação', evento: 'Evento', base_existente: 'Base existente', parceiro: 'Parceiro', inbound: 'Procurou a empresa', outro: 'Outro' };

/** Transições do status ABM: encerrada só reabre como candidata; pausada volta para onde fizer sentido. */
const FLOW: Record<AbmStatus, AbmStatus[]> = {
  candidata: ['selecionada', 'pausada', 'encerrada'],
  selecionada: ['em_planejamento', 'candidata', 'pausada', 'encerrada'],
  em_planejamento: ['ativa', 'selecionada', 'pausada', 'encerrada'],
  ativa: ['em_acompanhamento', 'em_planejamento', 'pausada', 'encerrada'],
  em_acompanhamento: ['ativa', 'pausada', 'encerrada'],
  pausada: ['candidata', 'selecionada', 'em_planejamento', 'ativa', 'em_acompanhamento', 'encerrada'],
  encerrada: ['candidata'],
};
export function abmTransition(from: AbmStatus, to: AbmStatus, reason?: string | null) {
  if (from === to) return null;
  if (!FLOW[from].includes(to)) return `Não dá para passar de "${ABM_STATUS_LABELS[from]}" para "${ABM_STATUS_LABELS[to]}".`;
  if ((to === 'pausada' || to === 'encerrada') && (reason ?? '').trim().length < 10) return to === 'pausada' ? 'Diga por que a conta está sendo pausada.' : 'Diga por que a conta sai do programa ABM.';
  return null;
}

// ---------------------------------------------------------------- status comercial (derivado)
export const COMMERCIAL_STATUSES = ['identificada', 'prospeccao', 'relacionamento', 'oportunidade', 'cliente_ativo', 'cliente_sem_contrato', 'ex_cliente'] as const;
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number];
export const COMMERCIAL_STATUS_LABELS: Record<CommercialStatus, string> = {
  identificada: 'Conta identificada', prospeccao: 'Em prospecção', relacionamento: 'Em relacionamento', oportunidade: 'Com oportunidade',
  cliente_ativo: 'Cliente ativo', cliente_sem_contrato: 'Cliente sem contrato ativo', ex_cliente: 'Ex-cliente',
};
export type CommercialFacts = {
  /** ciclo de vida do cliente, se a conta já virou cliente */
  customerLifecycle: string | null;
  activeContracts: number;
  endedContracts: number;
  openOpportunities: number;
  /** dias desde a última interação concluída (atividade), null = nunca */
  daysSinceInteraction: number | null;
  /** existe trabalho de prospecção registrado (lead, atividade agendada, play) */
  prospecting: boolean;
};
/** Regra única do status comercial; a ordem importa (cliente ativo vence oportunidade, que vence relacionamento). */
export function commercialStatus(f: CommercialFacts, relationshipDays = 90): CommercialStatus {
  const lc = f.customerLifecycle;
  const isCustomer = !!lc && lc !== 'prospect';
  if (isCustomer && f.activeContracts > 0 && lc !== 'cancelado') return 'cliente_ativo';
  if (isCustomer && (lc === 'ativo' || lc === 'em_implantacao' || lc === 'reativado' || lc === 'inadimplente' || lc === 'suspenso')) return f.activeContracts > 0 ? 'cliente_ativo' : 'cliente_sem_contrato';
  if (lc === 'cancelado' || (f.endedContracts > 0 && f.activeContracts === 0)) return f.openOpportunities > 0 ? 'oportunidade' : 'ex_cliente';
  if (f.openOpportunities > 0) return 'oportunidade';
  if (f.daysSinceInteraction !== null && f.daysSinceInteraction <= relationshipDays) return 'relacionamento';
  if (f.prospecting) return 'prospeccao';
  return 'identificada';
}

// ---------------------------------------------------------------- deduplicação de organizações
const LEGAL = /\b(ltda|me|epp|eireli|mei|s\/?a|sa|cia|s\/s|ss|limitada|companhia)\b\.?/g;
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'para', 'the']);
/** Chave de comparação do nome: sem acento, caixa, pontuação, sufixos societários e palavras vazias. */
export function orgNameTokens(name: string) {
  const n = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(LEGAL, ' ').replace(/[^a-z0-9 ]+/g, ' ');
  return n.split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));
}
/** Semelhança de nomes (0–1): Jaccard dos termos, com bônus quando um nome contém o outro. */
export function orgNameSimilarity(a: string, b: string) {
  const A = new Set(orgNameTokens(a)); const B = new Set(orgNameTokens(b));
  if (!A.size || !B.size) return 0;
  // termos iguais, ou abreviação (um é prefixo do outro, com 4+ letras: "hosp" × "hospital")
  const same = (x: string, y: string) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
  const inter = [...A].filter((x) => [...B].some((y) => same(x, y))).length;
  const jac = inter / new Set([...A, ...B]).size;
  const contain = inter / Math.min(A.size, B.size);
  return Math.min(1, Math.max(jac, contain * 0.85));
}
export const onlyDigits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
/** Raiz do CNPJ (8 primeiros dígitos) — mesma empresa, outra filial. CPF não tem raiz. */
export const cnpjRoot = (doc: string | null | undefined) => { const d = onlyDigits(doc); return d.length === 14 ? d.slice(0, 8) : null; };

export type DedupCandidate = { id: string; name: string; document: string | null; city: string | null };
export type DedupMatch = DedupCandidate & { score: number; reasons: string[] };
/** Possíveis duplicidades de uma nova organização. Só sugere; quem decide é a pessoa (vincular ou criar mesmo assim). */
export function dedupMatches(input: { name: string; document?: string | null; city?: string | null }, rows: DedupCandidate[], threshold = 0.6): DedupMatch[] {
  const doc = onlyDigits(input.document);
  const root = cnpjRoot(input.document);
  const out: DedupMatch[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    let score = 0;
    const rd = onlyDigits(r.document);
    if (doc && rd && doc === rd) { reasons.push('mesmo CNPJ/CPF'); score = 1; }
    else if (root && cnpjRoot(r.document) === root) { reasons.push('mesma raiz de CNPJ (outra unidade da mesma empresa)'); score = Math.max(score, 0.9); }
    const sim = orgNameSimilarity(input.name, r.name);
    if (sim >= threshold) { reasons.push(`nome parecido (${Math.round(sim * 100)}%)`); score = Math.max(score, sim); }
    if (reasons.length && input.city && r.city && input.city.trim().toLowerCase() === r.city.trim().toLowerCase()) { reasons.push('mesma cidade'); score = Math.min(1, score + 0.05); }
    if (reasons.length) out.push({ ...r, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 10);
}
/** Termos para buscar candidatos no banco (os mais distintivos primeiro). */
export const dedupSearchTerms = (name: string) => orgNameTokens(name).filter((t) => t.length >= 3).sort((a, b) => b.length - a.length).slice(0, 3);

// ---------------------------------------------------------------- Fase 3: Conta 360 — objetivos e estrutura organizacional
export const ABM_OBJECTIVE_KINDS = ['abrir_relacionamento', 'conhecer_estrutura', 'identificar_decisores', 'desenvolver_acesso', 'apresentar_solucoes', 'criar_oportunidade', 'expandir_contratos', 'recuperar_relacionamento', 'preparar_renovacao', 'outro'] as const;
export type AbmObjectiveKind = (typeof ABM_OBJECTIVE_KINDS)[number];
export const ABM_OBJECTIVE_KIND_LABELS: Record<AbmObjectiveKind, string> = {
  abrir_relacionamento: 'Abrir relacionamento', conhecer_estrutura: 'Conhecer a estrutura da organização', identificar_decisores: 'Identificar decisores', desenvolver_acesso: 'Desenvolver acesso',
  apresentar_solucoes: 'Apresentar soluções', criar_oportunidade: 'Criar oportunidade', expandir_contratos: 'Expandir contratos', recuperar_relacionamento: 'Recuperar relacionamento', preparar_renovacao: 'Preparar renovação', outro: 'Outro',
};
export const ABM_OBJECTIVE_STATUSES = ['planejado', 'em_andamento', 'atingido', 'nao_atingido', 'cancelado'] as const;
export type AbmObjectiveStatus = (typeof ABM_OBJECTIVE_STATUSES)[number];
export const ABM_OBJECTIVE_STATUS_LABELS: Record<AbmObjectiveStatus, string> = { planejado: 'Planejado', em_andamento: 'Em andamento', atingido: 'Atingido', nao_atingido: 'Não atingido', cancelado: 'Cancelado' };
/** Encerrar um objetivo (atingido, não atingido, cancelado) exige registrar o resultado. */
export function objectiveTransition(from: AbmObjectiveStatus, to: AbmObjectiveStatus, result?: string | null) {
  if (from === to) return null;
  const closed = (s: AbmObjectiveStatus) => s === 'atingido' || s === 'nao_atingido' || s === 'cancelado';
  if (closed(from) && to !== 'em_andamento') return 'Objetivo encerrado só pode ser reaberto (em andamento).';
  if (closed(to) && (result ?? '').trim().length < 10) return 'Registre o resultado (o que aconteceu) para encerrar o objetivo.';
  return null;
}

export const ORG_UNIT_KINDS = ['unidade', 'filial', 'diretoria', 'secretaria', 'departamento', 'setor', 'equipe', 'orgao_relacionado'] as const;
export type OrgUnitKind = (typeof ORG_UNIT_KINDS)[number];
export const ORG_UNIT_KIND_LABELS: Record<OrgUnitKind, string> = { unidade: 'Unidade', filial: 'Filial', diretoria: 'Diretoria', secretaria: 'Secretaria', departamento: 'Departamento', setor: 'Setor', equipe: 'Equipe', orgao_relacionado: 'Órgão relacionado' };
/** O novo pai não pode estar abaixo da própria unidade (evita ciclo na hierarquia). */
export function orgUnitCycle(units: { id: string; parentId: string | null }[], id: string, parentId: string | null) {
  if (!parentId) return false;
  if (parentId === id) return true;
  let cur: string | null = parentId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) { if (cur === id) return true; seen.add(cur); cur = units.find((u) => u.id === cur)?.parentId ?? null; }
  return false;
}
/** Árvore em ordem de exibição (pai antes dos filhos), com profundidade. Unidades com pai inexistente aparecem na raiz. */
export function orgUnitTree<T extends { id: string; parentId: string | null; name: string }>(units: T[]) {
  const ids = new Set(units.map((u) => u.id));
  const kids = (p: string | null) => units.filter((u) => (p === null ? !u.parentId || !ids.has(u.parentId) : u.parentId === p)).sort((a, b) => a.name.localeCompare(b.name));
  const out: (T & { depth: number })[] = [];
  const walk = (p: string | null, d: number) => { for (const u of kids(p)) { out.push({ ...u, depth: d }); if (d < 12) walk(u.id, d + 1); } };
  walk(null, 0);
  return out;
}
