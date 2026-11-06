/**
 * Relações entre contas (organizações): hierárquicas (matriz/filial, órgão superior/vinculado), de pertencimento
 * (consórcio, associação) e de mercado (parceria, fornecimento, concorrência, influência). Cada relação é registrada
 * por uma pessoa; o sistema só sugere (mesma raiz de CNPJ, pessoas em comum), nunca cria sozinho.
 */
export const ACCOUNT_RELATION_KINDS = ['matriz', 'orgao_superior', 'membro', 'parceira', 'fornecedora', 'concorrente', 'influencia', 'outro'] as const;
export type AccountRelationKind = (typeof ACCOUNT_RELATION_KINDS)[number];
/** Como se lê de cada lado: from → to ("é matriz de") e to → from ("é filial de"). */
export const ACCOUNT_RELATION_LABELS: Record<AccountRelationKind, { out: string; in: string; group: string; symmetric?: boolean; hierarchy?: boolean }> = {
  matriz: { out: 'é matriz/controladora de', in: 'é filial/controlada de', group: 'Grupo econômico', hierarchy: true },
  orgao_superior: { out: 'é órgão superior de', in: 'é vinculada/subordinada a', group: 'Estrutura pública', hierarchy: true },
  membro: { out: 'é membro de', in: 'tem como membro', group: 'Consórcios e associações' },
  parceira: { out: 'é parceira de', in: 'é parceira de', group: 'Parcerias', symmetric: true },
  fornecedora: { out: 'é fornecedora de', in: 'é cliente de', group: 'Fornecimento' },
  concorrente: { out: 'é concorrente de', in: 'é concorrente de', group: 'Concorrência', symmetric: true },
  influencia: { out: 'influencia', in: 'é influenciada por', group: 'Influência' },
  outro: { out: 'se relaciona com', in: 'se relaciona com', group: 'Outras relações', symmetric: true },
};
export const isHierarchy = (k: string) => !!ACCOUNT_RELATION_LABELS[k as AccountRelationKind]?.hierarchy;

export type AccountRel = { id: string; fromId: string; toId: string; kind: AccountRelationKind };

/** Erro ao registrar (nula = pode): não relaciona consigo, não duplica, não cria ciclo na hierarquia, uma só "mãe" por tipo. */
export function accountRelationError(r: { fromId: string; toId: string; kind: AccountRelationKind }, existing: readonly AccountRel[]): string | null {
  if (r.fromId === r.toId) return 'Uma conta não se relaciona com ela mesma.';
  const sym = ACCOUNT_RELATION_LABELS[r.kind].symmetric;
  if (existing.some((e) => e.kind === r.kind && ((e.fromId === r.fromId && e.toId === r.toId) || (sym && e.fromId === r.toId && e.toId === r.fromId)))) return 'Essa relação já está registrada.';
  if (!isHierarchy(r.kind)) return null;
  if (existing.some((e) => e.kind === r.kind && e.toId === r.toId)) return `A conta já tem ${r.kind === 'matriz' ? 'uma matriz/controladora' : 'um órgão superior'} registrado. Remova a relação atual antes.`;
  // ciclo: subir a partir de "from" pela hierarquia do mesmo tipo e não encontrar "to"
  const parent = new Map(existing.filter((e) => e.kind === r.kind).map((e) => [e.toId, e.fromId]));
  let p: string | undefined = r.fromId; const seen = new Set<string>();
  while (p) { if (p === r.toId) return 'Isso cria um ciclo na hierarquia (uma conta acabaria acima dela mesma).'; if (seen.has(p)) break; seen.add(p); p = parent.get(p); }
  return null;
}

/** Componente conectado a partir de uma conta (todas as relações, até `max` contas), para o mapa. */
export function relationComponent(start: string, rels: readonly AccountRel[], max = 80): Set<string> {
  const adj = new Map<string, string[]>();
  for (const r of rels) { adj.set(r.fromId, [...(adj.get(r.fromId) ?? []), r.toId]); adj.set(r.toId, [...(adj.get(r.toId) ?? []), r.fromId]); }
  const seen = new Set([start]); const q = [start];
  while (q.length && seen.size < max) { const c = q.shift()!; for (const n of adj.get(c) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); } }
  return seen;
}

/** Árvore hierárquica (matriz/órgão superior) de um conjunto de contas: raízes e filhos. */
export function hierarchyTree(ids: readonly string[], rels: readonly AccountRel[]) {
  const set = new Set(ids);
  const h = rels.filter((r) => isHierarchy(r.kind) && set.has(r.fromId) && set.has(r.toId));
  const children = new Map<string, { id: string; kind: AccountRelationKind }[]>();
  const hasParent = new Set<string>();
  for (const r of h) { if (hasParent.has(r.toId)) continue; hasParent.add(r.toId); children.set(r.fromId, [...(children.get(r.fromId) ?? []), { id: r.toId, kind: r.kind }]); }
  const roots = ids.filter((i) => !hasParent.has(i) && children.has(i));
  return { roots, children, inTree: new Set([...roots, ...hasParent]) };
}

// ---------------------------------------------------------------- estruturas (macro entidade que reúne contas e contratos)
export const STRUCTURE_KINDS = ['programa', 'projeto', 'rede', 'consorcio', 'convenio', 'grupo_economico', 'outro'] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];
export const STRUCTURE_KIND_LABELS: Record<StructureKind, string> = { programa: 'Programa', projeto: 'Projeto', rede: 'Rede', consorcio: 'Consórcio', convenio: 'Convênio', grupo_economico: 'Grupo econômico', outro: 'Outra' };
export const STRUCTURE_ROLES = ['gestor', 'participante', 'executor', 'financiador', 'parceiro', 'outro'] as const;
export type StructureRole = (typeof STRUCTURE_ROLES)[number];
export const STRUCTURE_ROLE_LABELS: Record<StructureRole, string> = { gestor: 'Órgão gestor / coordenação', participante: 'Participante', executor: 'Executor', financiador: 'Financiador', parceiro: 'Parceiro', outro: 'Outro papel' };
