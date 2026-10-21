/**
 * Controle de acesso por MÓDULO e NÍVEL (decisão de 17/10/2026).
 *
 * - Próprio  → o usuário vê e trabalha só a própria carteira (padrão do vendedor).
 * - Equipe   → vê os times que LIDERA, somados; nunca outros times (padrão da supervisão).
 * - Total    → vê 100% da empresa (padrão da gerência, que também administra Configurações).
 * - Sem acesso → o módulo some do menu e a API recusa.
 *
 * Os níveis valem por PERFIL (sem exceção por usuário) e são editáveis pela gerência
 * em Configurações → Segurança. O servidor é a única autoridade.
 */

export const MODULES = ['inicio', 'leads', 'oportunidades', 'clientes', 'atividades', 'relatorios', 'campanhas', 'contratos', 'projetos', 'desempenho', 'resultados', 'inteligencia', 'configuracoes'] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_LABELS: Record<Module, string> = {
  inicio: 'Início',
  leads: 'Leads',
  oportunidades: 'Oportunidades',
  clientes: 'Contas',
  atividades: 'Atividades',
  relatorios: 'Relatórios',
  campanhas: 'Campanhas',
  contratos: 'Gestão de Contratos',
  projetos: 'Projetos e tarefas',
  desempenho: 'Desempenho',
  resultados: 'Gestão de Times',
  inteligencia: 'Inteligência',
  configuracoes: 'Configurações',
};

export const ACCESS_LEVELS = ['nenhum', 'proprio', 'equipe', 'total'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export const LEVEL_LABELS: Record<AccessLevel, string> = { nenhum: 'Sem acesso', proprio: 'Próprio', equipe: 'Equipe', total: 'Total' };
export const LEVEL_RANK: Record<AccessLevel, number> = { nenhum: 0, proprio: 1, equipe: 2, total: 3 };

/** Configurações não tem "carteira": só faz sentido sem acesso ou total. */
export function allowedLevels(m: Module): readonly AccessLevel[] {
  return m === 'configuracoes' ? ['nenhum', 'total'] : ACCESS_LEVELS;
}

export const PROFILE_KEYS = ['vendedor', 'supervisor', 'gerencia'] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];
export const PROFILE_LABELS: Record<ProfileKey, string> = { vendedor: 'Vendedor', supervisor: 'Supervisor', gerencia: 'Gerência' };

export const DEFAULT_ACCESS: Record<ProfileKey, Record<Module, AccessLevel>> = {
  vendedor: { inicio: 'proprio', leads: 'proprio', oportunidades: 'proprio', clientes: 'proprio', atividades: 'proprio', relatorios: 'proprio', campanhas: 'nenhum', contratos: 'proprio', projetos: 'proprio', desempenho: 'proprio', resultados: 'proprio', inteligencia: 'nenhum', configuracoes: 'nenhum' },
  supervisor: { inicio: 'equipe', leads: 'equipe', oportunidades: 'equipe', clientes: 'equipe', atividades: 'equipe', relatorios: 'equipe', campanhas: 'equipe', contratos: 'equipe', projetos: 'equipe', desempenho: 'equipe', resultados: 'equipe', inteligencia: 'equipe', configuracoes: 'nenhum' },
  gerencia: { inicio: 'total', leads: 'total', oportunidades: 'total', clientes: 'total', atividades: 'total', relatorios: 'total', campanhas: 'total', contratos: 'total', projetos: 'total', desempenho: 'total', resultados: 'total', inteligencia: 'total', configuracoes: 'total' },
};

export function atLeast(level: AccessLevel | undefined, min: AccessLevel) {
  return LEVEL_RANK[level ?? 'nenhum'] >= LEVEL_RANK[min];
}

/** Um usuário pode ter mais de um perfil: vale o maior nível de cada módulo. */
export function mergeLevels(levels: AccessLevel[]): AccessLevel {
  return levels.reduce<AccessLevel>((best, l) => (LEVEL_RANK[l] > LEVEL_RANK[best] ? l : best), 'nenhum');
}

export function isModule(v: string): v is Module {
  return (MODULES as readonly string[]).includes(v);
}
export function isLevel(v: string): v is AccessLevel {
  return (ACCESS_LEVELS as readonly string[]).includes(v);
}
