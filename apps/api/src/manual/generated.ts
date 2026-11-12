/**
 * Partes do manual geradas do próprio sistema no momento da instalação/atualização:
 * matriz de níveis, ações sensíveis, cargos, módulos e funcionalidades, rito da licitação, badges e a lista da API.
 * Assim a referência não envelhece: muda o código, a próxima atualização do manual muda junto.
 */
import {
  ACCESS_LEVELS, BADGE_KEYS, BID_DEFAULT_MODEL, BUSINESS_MODULES, BUSINESS_MODULE_HINTS, BUSINESS_MODULE_LABELS, DEFAULT_ACCESS, DEFAULT_ACTIONS, DEFAULT_BADGES,
  FEATURES, LEVEL_LABELS, MODULES, MODULE_LABELS, MODULE_OWNER, PROFILE_KEYS, PROFILE_LABELS, SECTOR_ROLES, SECTOR_ROLE_HINTS, SECTOR_ROLE_LABELS,
  SENSITIVE_ACTIONS, SENSITIVE_ACTION_LABELS, badgeSourceLabel, featureDef, type Block, type FeatureKey, type Module,
} from '@isp/domain';

export type RouteInfo = { method: string; url: string; summary: string; tag: string; module?: Module | null; min?: string | null; feature: FeatureKey | null; public?: boolean; anyAuthenticated?: boolean };

type Gen = (id: () => string) => Block[];
const table = (id: () => string, rows: string[][]): Block => ({ id: id(), type: 'table', header: true, rows });
const ownerLabel = (m: Module) => (MODULE_OWNER[m] === 'fundacao' ? 'Fundação (sempre ligado)' : BUSINESS_MODULE_LABELS[MODULE_OWNER[m] as keyof typeof BUSINESS_MODULE_LABELS]);

const matriz: Gen = (id) => {
  const rows = [['Módulo', 'Pertence a', ...PROFILE_KEYS.map((p) => PROFILE_LABELS[p])]];
  for (const m of MODULES) rows.push([MODULE_LABELS[m], ownerLabel(m), ...PROFILE_KEYS.map((p) => LEVEL_LABELS[DEFAULT_ACCESS[p][m]])]);
  return [table(id, rows), { id: id(), type: 'text', text: `Níveis possíveis: ${ACCESS_LEVELS.map((l) => LEVEL_LABELS[l]).join(', ')}. Configurações só aceita Sem acesso ou Total.` }];
};

const acoes: Gen = (id) => [table(id, [['Ação', ...PROFILE_KEYS.map((p) => PROFILE_LABELS[p])], ...SENSITIVE_ACTIONS.map((a) => [SENSITIVE_ACTION_LABELS[a], ...PROFILE_KEYS.map((p) => (DEFAULT_ACTIONS[p]?.[a] ? 'Sim' : 'Não'))])]),
  { id: id(), type: 'text', text: 'Sem **Ver valores financeiros**, a API devolve oculto todo campo em R$ (e margem, LTV, CAC, comissão) em qualquer tela, relatório ou indicador, e as planilhas com valores são recusadas.' }];

const cargos: Gen = (id) => [table(id, [['Cargo', 'O que faz'], ...SECTOR_ROLES.map((r) => [SECTOR_ROLE_LABELS[r], SECTOR_ROLE_HINTS[r]])]),
  { id: id(), type: 'text', text: 'Cargo inicial: Supervisão, Gerência, Diretoria e Administrador começam como **Liderança / gestor**; os demais como **Operador**. A lista de aprovadores é formada só por quem tem cargo Liderança / gestor, dentro da alçada do perfil. Observador não recebe tarefas do setor, não conclui etapas e não aprova.' }];

const funcionalidades: Gen = (id) => {
  const out: Block[] = [];
  for (const b of BUSINESS_MODULES) {
    const fs = FEATURES.filter((f) => f.module === b);
    out.push({ id: id(), type: 'heading', level: 2, text: BUSINESS_MODULE_LABELS[b] });
    out.push({ id: id(), type: 'text', text: BUSINESS_MODULE_HINTS[b] });
    if (fs.length) out.push(table(id, [['Funcionalidade (pode ser desligada)', 'Também exige'], ...fs.map((f) => {
      const d = featureDef(f.key);
      const extra = [...(d.requires ?? []).map((r) => `módulo ${BUSINESS_MODULE_LABELS[r]} ligado`), ...(d.needs?.length ? [`nível em ${d.needs.map((n) => MODULE_LABELS[n]).join(' ou ')}`] : [])];
      return [d.label, extra.join('; ') || '—'];
    })]));
  }
  return out;
};

const etapasLicitacao: Gen = (id) => [{ id: id(), type: 'steps', items: BID_DEFAULT_MODEL.phases.map((p) => ({ title: p.name, text: [('objective' in p && p.objective) || '', `Entregável: ${p.deliverable}.`, `Duração prevista: ${p.durationDays} dia(s).`].filter(Boolean).join(' ') })) }];

const regraGamificacao: Gen = (id) => [
  { id: id(), type: 'gamification_rule', title: 'Regra vigente da gamificação' },
  { id: id(), type: 'gamification_calc', title: 'Quantas tarefas faltam para a minha meta?' },
];

const badges: Gen = (id) => [table(id, [['Badge', 'O que reconhece', 'Soma pontos de'], ...BADGE_KEYS.map((k) => {
  const b = DEFAULT_BADGES.find((x) => x.key === k)!;
  return [b.name, b.description, b.sources.map(badgeSourceLabel).join('; ')];
})]), { id: id(), type: 'text', text: 'As faixas (mínima, média e alta) e as origens que valem são as da **regra aprovada**, na aba Badges do bloco da regra vigente acima; a tabela mostra o ponto de partida sugerido. Cada pessoa acompanha as suas em Meus pontos → Minhas badges.' }];

const levelOf = (r: RouteInfo) => {
  if (r.public) return 'Pública';
  if (r.anyAuthenticated && !r.module) return 'Sessão';
  const base = r.module ? `${MODULE_LABELS[r.module]} ≥ ${LEVEL_LABELS[(r.min as keyof typeof LEVEL_LABELS) ?? 'proprio']}` : 'Sessão';
  return r.feature ? `${base} (${featureDef(r.feature).label.split(' (')[0]})` : base;
};

export function apiBlocks(routes: RouteInfo[]): Gen {
  return (id) => {
    const byTag = new Map<string, RouteInfo[]>();
    for (const r of routes) byTag.set(r.tag, [...(byTag.get(r.tag) ?? []), r]);
    const tags = [...byTag.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const out: Block[] = [{ id: id(), type: 'text', text: `**${routes.length} rotas** em ${tags.length} assuntos.` }];
    for (const t of tags) {
      const rs = byTag.get(t)!.slice().sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
      out.push({ id: id(), type: 'heading', level: 2, text: `${t} (${rs.length})` });
      for (let i = 0; i < rs.length; i += 150) out.push(table(id, [['Método', 'Caminho', 'O que faz', 'Acesso'], ...rs.slice(i, i + 150).map((r) => [r.method, r.url, r.summary, levelOf(r)])]));
    }
    return out;
  };
}

export function generators(routes: RouteInfo[]): Record<string, Gen> {
  return { MATRIZ: matriz, ACOES: acoes, CARGOS: cargos, FUNCIONALIDADES: funcionalidades, ETAPAS_LICITACAO: etapasLicitacao, REGRA_GAMIFICACAO: regraGamificacao, BADGES: badges, API: apiBlocks(routes) };
}
