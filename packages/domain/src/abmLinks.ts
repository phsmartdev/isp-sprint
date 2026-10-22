/**
 * ABM Fase 8 — vínculos das pessoas da conta (stakeholders) com oportunidades, contratos e leads, cada um com o papel
 * que a pessoa tem naquele registro. Não cria cadastro: liga registros que já existem.
 */
export const LINK_ENTITIES = ['oportunidade', 'contrato', 'lead'] as const;
export type LinkEntity = (typeof LINK_ENTITIES)[number];
export const LINK_ENTITY_LABELS: Record<LinkEntity, string> = { oportunidade: 'Oportunidade', contrato: 'Contrato', lead: 'Lead' };
export const ENTITY_LINK_ROLES = {
  oportunidade: ['decisor', 'influenciador', 'avaliador_tecnico', 'aprovador_financeiro', 'patrocinador', 'usuario', 'bloqueador', 'contato_principal'],
  contrato: ['gestor_contrato', 'fiscal_contrato', 'aprovador_financeiro', 'patrocinador', 'usuario', 'contato_principal'],
  lead: ['contato_origem', 'indicou', 'contato_principal'],
} as const satisfies Record<LinkEntity, readonly string[]>;
export type EntityLinkRole = (typeof ENTITY_LINK_ROLES)[LinkEntity][number];
export const ENTITY_LINK_ROLE_LABELS: Record<EntityLinkRole, string> = {
  decisor: 'Decisor', influenciador: 'Influenciador', avaliador_tecnico: 'Avaliador técnico', aprovador_financeiro: 'Aprovador financeiro', patrocinador: 'Patrocinador', usuario: 'Usuário',
  bloqueador: 'Bloqueador', contato_principal: 'Contato principal', gestor_contrato: 'Gestor do contrato', fiscal_contrato: 'Fiscal do contrato', contato_origem: 'Contato de origem', indicou: 'Indicou',
};
/** Erro do vínculo (null = válido): o papel precisa existir para o tipo de registro e a pessoa precisa ser da mesma conta. */
export function entityLinkError(v: { entity: LinkEntity; role: string; stakeholderContactId: string; entityContactId: string; stakeholderActive: boolean }) {
  if (!(ENTITY_LINK_ROLES[v.entity] as readonly string[]).includes(v.role)) return `Papel inválido para ${LINK_ENTITY_LABELS[v.entity].toLowerCase()}.`;
  if (v.stakeholderContactId !== v.entityContactId) return 'A pessoa precisa estar mapeada na mesma conta do registro.';
  if (!v.stakeholderActive) return 'Esta pessoa está inativa na conta.';
  return null;
}
/** Identificadores externos da conta (ERP/IXC, importação) — exibidos, nunca alterados pelo ABM. */
export function externalIdsOf(contact: { sourceSystem: string; externalId: string | null }, customerIds: { system: string; externalId: string }[]) {
  const out = new Map<string, { system: string; externalId: string }>();
  if (contact.sourceSystem !== 'crm' && contact.externalId) out.set(`${contact.sourceSystem}:${contact.externalId}`, { system: contact.sourceSystem, externalId: contact.externalId });
  for (const c of customerIds) out.set(`${c.system}:${c.externalId}`, c);
  return [...out.values()];
}
