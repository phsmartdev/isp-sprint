/**
 * Mapa único de Configurações: grupos por assunto, usados no menu lateral, nas abas do topo e na Visão geral.
 * `admin` = exige Configurações (Total); `match` = outros caminhos que pertencem à mesma página.
 */
export type SettingsItem = { to: string; label: string; desc: string; admin: boolean; keywords?: string };
export type SettingsGroup = { key: string; label: string; desc: string; items: SettingsItem[] };

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { key: 'geral', label: 'Geral', desc: 'Seu perfil, a visão geral e a identidade visual.', items: [
    { to: '/settings', label: 'Visão geral', desc: 'Resumo da plataforma e atalhos para todas as configurações.', admin: true },
    { to: '/settings/profile', label: 'Meu perfil', desc: 'Seus dados, foto, senha e preferências.', admin: false, keywords: 'senha foto tema' },
    { to: '/settings/branding', label: 'Personalização', desc: 'Logo, cores e identidade visual aplicadas em todo o sistema.', admin: true, keywords: 'marca logo cores' },
  ] },
  { key: 'acesso', label: 'Acesso e segurança', desc: 'Quem entra, o que pode ver e o registro do que foi feito.', items: [
    { to: '/settings/users', label: 'Usuários', desc: 'Cadastro de pessoas, perfis, equipes e setores.', admin: true, keywords: 'perfil equipe setor csm' },
    { to: '/settings/modulos', label: 'Módulos e liberação', desc: 'Módulos ligados, liberação por equipe ou pessoa e ações sensíveis.', admin: true, keywords: 'permissões financeiro exportar aprovar viabilidade contratos' },
    { to: '/settings/security', label: 'Segurança', desc: 'Nível de acesso por módulo e perfil, sessões e senha.', admin: true, keywords: 'matriz acesso' },
    { to: '/settings/logs', label: 'Logs do sistema', desc: 'Auditoria de todas as ações na plataforma.', admin: true, keywords: 'auditoria' },
  ] },
  { key: 'vendas', label: 'Vendas e funil', desc: 'Como a oportunidade nasce, anda e é aprovada.', items: [
    { to: '/settings/journeys', label: 'Jornadas e automações', desc: 'Funis, etapas, quem trabalha em cada um e automações.', admin: true, keywords: 'pipeline etapas funil' },
    { to: '/settings/sources', label: 'Canais de entrada', desc: 'Por onde o cliente chega: WhatsApp, site, telefone.', admin: true, keywords: 'origem lead' },
    { to: '/settings/fields', label: 'Campos personalizados', desc: 'Campos extras em contas, oportunidades e contratos.', admin: true },
    { to: '/settings/approvals', label: 'Aprovações e alçadas', desc: 'Quem aprova desconto e condição especial, e até quanto.', admin: true, keywords: 'desconto alçada' },
    { to: '/settings/modelos', label: 'Modelos', desc: 'Propostas, contratos, timbrado das filiais, instrução e e-mails automáticos.', admin: true, keywords: 'proposta contrato timbrado papel logo filial email alerta instrução playbook' },
  ] },
  { key: 'ofertas', label: 'Ofertas e viabilidade', desc: 'O que se vende, por quanto, de onde e com qual custo.', items: [
    { to: '/settings/plans', label: 'Planos e produtos', desc: 'Planos, produtos, comissão e documento fiscal padrão.', admin: true, keywords: 'preço produto' },
    { to: '/settings/viability', label: 'Viabilidade', desc: 'Motor financeiro e catálogo de custos.', admin: true, keywords: 'tma margem payback custo capex opex comissão contingência despesas ir csll' },
    { to: '/settings/filiais', label: 'Filiais e documentos fiscais', desc: 'Emitentes (CNPJ, regime), tipos fiscais e tributos.', admin: true, keywords: 'cnpj imposto tributo nota fiscal' },
    { to: '/settings/area', label: 'Área de atendimento', desc: 'Regiões e condomínios atendidos.', admin: true, keywords: 'cobertura condomínio' },
  ] },
  { key: 'times', label: 'Relacionamento e times', desc: 'Pós-venda, marketing de contas e gestão das equipes.', items: [
    { to: '/settings/customer-success', label: 'Sucesso do Cliente', desc: 'Jornadas de pós-venda, tiers e pesquisas.', admin: true, keywords: 'cs csm tier ipc' },
    { to: '/settings/abm', label: 'ABM', desc: 'Contas-alvo, cadências e jogadas.', admin: true },
    { to: '/settings/desempenho', label: 'Gestão de desempenho', desc: 'Metas e indicadores.', admin: true, keywords: 'meta kpi' },
    { to: '/settings/resultados', label: 'Gestão de Times', desc: 'Apuração, intervenções e rituais.', admin: true },
  ] },
  { key: 'integracoes', label: 'Integrações e dados', desc: 'Sistemas conectados e a base de dados.', items: [
    { to: '/settings/integrations', label: 'Integrações', desc: 'IXC, GLPI, WhatsApp e outros sistemas.', admin: true, keywords: 'ixc glpi api' },
    { to: '/settings/gmail', label: 'E-mail corporativo (Gmail)', desc: 'Conta Google para enviar e receber pelo sistema.', admin: true, keywords: 'google' },
    { to: '/settings/data', label: 'Base de dados', desc: 'Importação, exportação e limpeza de dados.', admin: true, keywords: 'importar exportar' },
  ] },
];

const pathOf = (to: string) => to.split('?')[0]!;

/** Grupo e item da página aberta (o mais específico que casar com o caminho). */
export function settingsLocate(pathname: string) {
  let best: { group: SettingsGroup; item: SettingsItem } | null = null;
  for (const group of SETTINGS_GROUPS) for (const item of group.items) {
    const p = pathOf(item.to);
    const hit = p === '/settings' ? pathname === '/settings' : pathname === p || pathname.startsWith(`${p}/`);
    if (hit && (!best || p.length > pathOf(best.item.to).length)) best = { group, item };
  }
  return best;
}

/** Itens que a pessoa vê (sem Configurações Total, só o próprio perfil). */
export const visibleGroups = (isAdmin: boolean) =>
  SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => isAdmin || !i.admin) })).filter((g) => g.items.length);

/** Busca por nome, descrição ou palavra-chave, sem acento. */
export function settingsSearch(groups: SettingsGroup[], q: string) {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return groups;
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => { const t = norm(`${i.label} ${i.desc} ${i.keywords ?? ''} ${g.label}`); return terms.every((x) => t.includes(x)); }) })).filter((g) => g.items.length);
}
