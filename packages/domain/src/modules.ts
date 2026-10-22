/**
 * Etapa 1 — particionamento modular (22/10/2026).
 *
 * Sete módulos de negócio sobre os módulos técnicos de acesso (`MODULES`). A fundação (autenticação, usuários,
 * cadastros compartilhados, configurações…) não é módulo de negócio e está sempre ligada.
 *
 * Acesso efetivo = o MENOR entre:
 *   1. o módulo de negócio ligado para a empresa (teto) e liberado para a pessoa (equipe / exceção individual);
 *   2. o nível do perfil no módulo técnico (matriz de segurança, como sempre);
 *   3. a funcionalidade ligada na empresa;
 *   4. as ações sensíveis do perfil (exportar, ver financeiro…).
 * Nada aqui amplia acesso: a exceção individual só libera o MÓDULO, o nível continua o do perfil.
 */
import type { AccessLevel, Module } from './access';

export const BUSINESS_MODULES = ['crm', 'marketing', 'produto', 'gestao_time', 'contratos', 'projetos', 'relatorios'] as const;
export type BusinessModule = (typeof BUSINESS_MODULES)[number];
export const BUSINESS_MODULE_LABELS: Record<BusinessModule, string> = {
  crm: 'CRM', marketing: 'Marketing', produto: 'Produto', gestao_time: 'Gestão de Time', contratos: 'Contratos', projetos: 'Projetos', relatorios: 'Relatórios',
};
export const BUSINESS_MODULE_HINTS: Record<BusinessModule, string> = {
  crm: 'Oportunidades, propostas, aprovações, contas, atividades, Sucesso do Cliente e e-mail.',
  marketing: 'Leads, ABM e campanhas.',
  produto: 'Catálogo de planos e produtos para consulta (o cadastro do catálogo é compartilhado e continua disponível para CRM e Contratos).',
  gestao_time: 'Metas, indicadores, apuração, intervenções e rituais.',
  contratos: 'Contratos, processos por setor, renovações, reajustes, atas e modelos.',
  projetos: 'Projetos, marcos e o quadro de tarefas.',
  relatorios: 'Relatórios e Inteligência; cada seção depende do módulo de origem estar ligado.',
};

/** Dono de negócio de cada módulo técnico. 'fundacao' = cadastro ou serviço compartilhado, nunca desligado. */
export const MODULE_OWNER: Record<Module, BusinessModule | 'fundacao'> = {
  inicio: 'fundacao', configuracoes: 'fundacao',
  clientes: 'fundacao', // contas e pessoas: cadastro compartilhado (Contratos usa sem o CRM)
  atividades: 'fundacao', // agenda e tarefas são compartilhadas (processos de contrato, projetos, CRM)
  oportunidades: 'crm', email: 'crm',
  leads: 'marketing', campanhas: 'marketing',
  contratos: 'contratos', projetos: 'projetos',
  desempenho: 'gestao_time', resultados: 'gestao_time',
  relatorios: 'relatorios', inteligencia: 'relatorios',
};

// ------------------------------------------------------------------ funcionalidades
export type FeatureDef = {
  key: string; module: BusinessModule; label: string;
  /** módulos de negócio que também precisam estar ligados */ requires?: BusinessModule[];
  /** a pessoa precisa de nível em PELO MENOS UM destes módulos técnicos (para telas que moram num cadastro compartilhado) */ needs?: Module[];
};
export const FEATURES = [
  { key: 'crm.oportunidades', module: 'crm', label: 'Oportunidades, propostas e aprovações' },
  { key: 'crm.contas', module: 'crm', label: 'Lista e ficha de contas', needs: ['oportunidades'] },
  { key: 'crm.atividades', module: 'crm', label: 'Agenda de atividades comerciais', needs: ['oportunidades'] },
  { key: 'crm.sucesso_cliente', module: 'crm', label: 'Sucesso do Cliente (jornadas, kickoff, pesquisas)', needs: ['oportunidades'] },
  { key: 'crm.email', module: 'crm', label: 'E-mail corporativo' },
  { key: 'marketing.leads', module: 'marketing', label: 'Leads' },
  { key: 'marketing.abm', module: 'marketing', label: 'ABM', needs: ['leads', 'campanhas'] },
  { key: 'marketing.campanhas', module: 'marketing', label: 'Campanhas' },
  { key: 'produto.catalogo', module: 'produto', label: 'Página de catálogo', needs: ['oportunidades', 'contratos'] },
  { key: 'gestao_time.desempenho', module: 'gestao_time', label: 'Metas e indicadores' },
  { key: 'gestao_time.times', module: 'gestao_time', label: 'Apuração, intervenções e rituais' },
  { key: 'contratos.contratos', module: 'contratos', label: 'Contratos' },
  { key: 'contratos.atas', module: 'contratos', label: 'Atas de registro de preços' },
  { key: 'contratos.modelos', module: 'contratos', label: 'Modelos de contrato' },
  { key: 'projetos.projetos', module: 'projetos', label: 'Projetos e marcos' },
  { key: 'projetos.tarefas', module: 'projetos', label: 'Quadro de tarefas' },
  { key: 'relatorios.comercial', module: 'relatorios', label: 'Relatórios e inteligência comercial', requires: ['crm'] },
  { key: 'relatorios.contratos', module: 'relatorios', label: 'Inteligência de contratos', requires: ['contratos'] },
] as const satisfies readonly FeatureDef[];
export type FeatureKey = (typeof FEATURES)[number]['key'];
export const featureDef = (k: FeatureKey): FeatureDef => FEATURES.find((f) => f.key === k)!;

/**
 * Regras de rota → funcionalidade, para o que mora num módulo técnico compartilhado ou de outro dono.
 * Avaliadas em ordem; a primeira que casa vale. `methods` vazio = todos. Padrões com `:id` como na definição da rota.
 * Rotas que não casam ficam só com a checagem do módulo técnico (cujo dono já desliga o que for preciso).
 */
export const ROUTE_FEATURE_RULES: { prefix: string; exact?: boolean; methods?: string[]; feature: FeatureKey | null }[] = [
  // compartilhados que ficam na fundação mesmo começando com um prefixo de módulo
  { prefix: '/abm/settings', feature: null },
  { prefix: '/catalog/plans', feature: null },
  // Marketing
  { prefix: '/leads', feature: 'marketing.leads' },
  { prefix: '/campaigns', feature: 'marketing.campanhas' },
  { prefix: '/abm', feature: 'marketing.abm' },
  { prefix: '/accounts/:id/cadences', feature: 'marketing.abm' },
  { prefix: '/accounts/:id/coverage', feature: 'marketing.abm' },
  { prefix: '/accounts/:id/plays', feature: 'marketing.abm' },
  { prefix: '/accounts/:id/play-runs', feature: 'marketing.abm' },
  { prefix: '/play-runs', feature: 'marketing.abm' },
  // CRM dentro de módulos técnicos compartilhados
  { prefix: '/cs', feature: 'crm.sucesso_cliente' },
  { prefix: '/surveys', feature: 'crm.sucesso_cliente' },
  { prefix: '/survey-invites', feature: 'crm.sucesso_cliente' },
  { prefix: '/survey-updates', feature: 'crm.sucesso_cliente' },
  { prefix: '/accounts/:id/surveys', feature: 'crm.sucesso_cliente' },
  { prefix: '/accounts/:id/emails', feature: 'crm.email' },
  { prefix: '/mail', feature: 'crm.email' },
  { prefix: '/activities', exact: true, methods: ['GET'], feature: 'crm.atividades' },
  { prefix: '/activities/calendar', feature: 'crm.atividades' },
  { prefix: '/customers', exact: true, methods: ['GET'], feature: 'crm.contas' },
  // Projetos: o quadro e a criação avulsa; a tarefa em si é compartilhada (processos de contrato, CRM)
  { prefix: '/tasks', exact: true, feature: 'projetos.tarefas' },
  { prefix: '/task-templates', feature: 'projetos.tarefas' },
  { prefix: '/projects', feature: 'projetos.projetos' },
  // Contratos
  { prefix: '/arps', feature: 'contratos.atas' },
  { prefix: '/arp-', feature: 'contratos.atas' },
  { prefix: '/contract-templates', feature: 'contratos.modelos' },
  // Relatórios: cada seção exige o módulo de origem
  { prefix: '/intelligence/contracts', feature: 'relatorios.contratos' },
  { prefix: '/intelligence', feature: 'relatorios.comercial' },
  { prefix: '/reports', feature: 'relatorios.comercial' },
];

export function routeFeature(method: string, url: string): FeatureKey | null {
  for (const r of ROUTE_FEATURE_RULES) {
    if (r.methods && !r.methods.includes(method.toUpperCase())) continue;
    const hit = r.exact ? url === r.prefix : url === r.prefix || url.startsWith(r.prefix.endsWith('-') ? r.prefix : `${r.prefix}/`) || (r.prefix.endsWith('-') && url.startsWith(r.prefix));
    if (hit) return r.feature;
  }
  return null;
}

// ------------------------------------------------------------------ ativação
export const RELEASE_MODES = ['todos', 'liberados'] as const;
export type ReleaseMode = (typeof RELEASE_MODES)[number];
export const RELEASE_MODE_LABELS: Record<ReleaseMode, string> = { todos: 'Todos os perfis com acesso', liberados: 'Só equipes e pessoas liberadas' };
export type TenantModule = { module: BusinessModule; enabled: boolean; mode: ReleaseMode; disabledFeatures: string[] };
export type ModuleGrant = { module: BusinessModule; subjectType: 'equipe' | 'usuario'; subjectId: string; effect: 'liberar' | 'bloquear'; validUntil: string | null };

/** Sem configuração gravada = módulo ligado para todos (comportamento anterior à Etapa 1). */
export const defaultTenantModule = (module: BusinessModule): TenantModule => ({ module, enabled: true, mode: 'todos', disabledFeatures: [] });

export type ModuleDecision = { enabled: boolean; reason: 'empresa_desligou' | 'pessoa_bloqueada' | 'pessoa_liberada' | 'equipe_bloqueada' | 'equipe_liberada' | 'todos' | 'nao_liberado' };

/** Decide se o módulo está ligado para a pessoa. A exceção individual vence a da equipe; bloqueio vence liberação no mesmo nível. */
export function moduleDecision(t: TenantModule, grants: ModuleGrant[], user: { id: string; teamIds: string[] }, today: string): ModuleDecision {
  if (!t.enabled) return { enabled: false, reason: 'empresa_desligou' };
  const live = grants.filter((g) => g.module === t.module && (!g.validUntil || g.validUntil >= today));
  const mine = live.filter((g) => g.subjectType === 'usuario' && g.subjectId === user.id);
  if (mine.some((g) => g.effect === 'bloquear')) return { enabled: false, reason: 'pessoa_bloqueada' };
  if (mine.some((g) => g.effect === 'liberar')) return { enabled: true, reason: 'pessoa_liberada' };
  const teams = live.filter((g) => g.subjectType === 'equipe' && user.teamIds.includes(g.subjectId));
  if (teams.some((g) => g.effect === 'bloquear')) return { enabled: false, reason: 'equipe_bloqueada' };
  if (teams.some((g) => g.effect === 'liberar')) return { enabled: true, reason: 'equipe_liberada' };
  return t.mode === 'todos' ? { enabled: true, reason: 'todos' } : { enabled: false, reason: 'nao_liberado' };
}

/** Zera o nível dos módulos técnicos cujo dono de negócio está desligado para a pessoa. */
export function gateAccess(access: Record<Module, AccessLevel>, enabled: Record<BusinessModule, boolean>): Record<Module, AccessLevel> {
  return Object.fromEntries(Object.entries(access).map(([m, l]) => {
    const owner = MODULE_OWNER[m as Module];
    return [m, owner === 'fundacao' || enabled[owner] ? l : 'nenhum'];
  })) as Record<Module, AccessLevel>;
}

/** Funcionalidade disponível: módulo dela ligado, módulos exigidos ligados, não desligada pela empresa e, se a tela mora num cadastro compartilhado, a pessoa tem nível num dos módulos técnicos dela. */
export function featureOn(key: FeatureKey, enabled: Record<BusinessModule, boolean>, disabledFeatures: string[], access?: Record<Module, AccessLevel>) {
  const f = featureDef(key);
  const needOk = !f.needs || !access || f.needs.some((m) => access[m] && access[m] !== 'nenhum');
  return enabled[f.module] && (f.requires ?? []).every((m) => enabled[m]) && !disabledFeatures.includes(key) && needOk;
}

export function grantErrors(g: { effect: string; reason: string; validUntil: string | null }, today: string) {
  const e: string[] = [];
  if (g.reason.trim().length < 10) e.push('Explique o motivo (pelo menos 10 caracteres).');
  if (g.validUntil && g.validUntil < today) e.push('A validade não pode estar no passado.');
  return e;
}

// ------------------------------------------------------------------ ações sensíveis
export const SENSITIVE_ACTIONS = ['ver_financeiro', 'exportar', 'validar_contrato', 'editar_valores_contrato', 'arquivar'] as const;
export type SensitiveAction = (typeof SENSITIVE_ACTIONS)[number];
export const SENSITIVE_ACTION_LABELS: Record<SensitiveAction, string> = {
  ver_financeiro: 'Ver valores financeiros (R$, faturamento, margem, comissão)',
  exportar: 'Exportar planilhas (CSV)',
  validar_contrato: 'Validar cadastro de contrato',
  editar_valores_contrato: 'Alterar valores de contrato',
  arquivar: 'Arquivar e excluir registros',
};

/** Padrão por perfil. Os perfis anteriores à Etapa 1 mantêm tudo (nenhuma mudança de comportamento). */
export const DEFAULT_ACTIONS: Record<string, Record<SensitiveAction, boolean>> = {
  vendedor: { ver_financeiro: true, exportar: true, validar_contrato: true, editar_valores_contrato: true, arquivar: true },
  supervisor: { ver_financeiro: true, exportar: true, validar_contrato: true, editar_valores_contrato: true, arquivar: true },
  gerencia: { ver_financeiro: true, exportar: true, validar_contrato: true, editar_valores_contrato: true, arquivar: true },
  gestao_contratos: { ver_financeiro: true, exportar: true, validar_contrato: true, editar_valores_contrato: true, arquivar: true },
  implantacao: { ver_financeiro: false, exportar: false, validar_contrato: false, editar_valores_contrato: false, arquivar: false },
};
/** Vários perfis: vale a permissão se QUALQUER perfil permitir (mesma regra do maior nível na matriz). */
export function mergeActions(rows: { action: string; allowed: boolean }[]): Record<SensitiveAction, boolean> {
  return Object.fromEntries(SENSITIVE_ACTIONS.map((a) => [a, rows.some((r) => r.action === a && r.allowed)])) as Record<SensitiveAction, boolean>;
}

/** Campos monetários que somem da resposta para quem não pode ver financeiro. */
export const isMoneyKey = (k: string) => /(Cents|_cents)$/.test(k) || ['ltv', 'cac', 'margin', 'marginPct', 'payback', 'commission'].includes(k);
export function redactMoney<T>(v: T): T {
  if (Array.isArray(v)) return v.map(redactMoney) as T;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, isMoneyKey(k) && (typeof x === 'number' || typeof x === 'string') ? null : redactMoney(x)])) as T;
  }
  return v;
}

