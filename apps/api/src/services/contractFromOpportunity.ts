/**
 * Da negociação concluída para o cadastro do contrato: tudo o que a oportunidade já sabe e o contrato usa
 * (objeto do edital, órgão, processo, modalidade, itens com o preço final do pregão, endereços de entrega
 * com os produtos de cada um, contatos técnico e administrativo, campos do tipo de venda e observações).
 * Ao cadastrar, os contatos e os anexos da negociação passam para o contrato.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { contractItemFromOpportunity, EMPTY_ZENITH, documentName, ENTITY_LINK_ROLE_LABELS, type ZenithContract } from '@isp/domain';
import { SALE_TYPE_LABELS, type SaleTypeKey } from '@isp/shared';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import { pipelinesOf } from './instructions';

type Opp = typeof s.opportunities.$inferSelect;
type Person = { name: string; email: string | null; phone: string | null; role: string };

const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v));
const brDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v);
const line = (a: { street?: string | null; number?: string | null; district?: string | null; city?: string | null; cep?: string | null }) =>
  [[a.street, a.number].filter(Boolean).join(', '), a.district, a.city, a.cep ? `CEP ${a.cep}` : null].filter(Boolean).join(' · ');

/** Pessoas ligadas à negociação, com o papel (ordem: contato principal primeiro). */
export async function opportunityPeople(db: DbOrTx, tenantId: string, oppId: string): Promise<Person[]> {
  const rows = await db
    .select({ role: s.stakeholderLinks.role, name: s.people.name, email: s.people.email, phone: s.people.phone, at: s.stakeholderLinks.createdAt })
    .from(s.stakeholderLinks)
    .innerJoin(s.accountStakeholders, eq(s.accountStakeholders.id, s.stakeholderLinks.stakeholderId))
    .innerJoin(s.people, eq(s.people.id, s.accountStakeholders.personId))
    .where(and(eq(s.stakeholderLinks.tenantId, tenantId), eq(s.stakeholderLinks.entityType, 'oportunidade'), eq(s.stakeholderLinks.entityId, oppId), isNull(s.stakeholderLinks.removedAt)))
    .orderBy(asc(s.stakeholderLinks.createdAt));
  return rows.map(({ at: _at, ...p }) => p);
}

/** Itens do contrato a partir dos produtos: no pregão vencido, vale o nosso preço final do item. */
export function contractItemsFromRows(rows: (typeof s.opportunityItems.$inferSelect)[]) {
  return rows.map((r) => contractItemFromOpportunity({ ...r, bidUnitCents: r.winnerIsUs && r.finalUnitCents != null ? r.finalUnitCents : r.bidUnitCents }));
}

export async function contractSuggestionFromOpportunity(db: DbOrTx, tenantId: string, o: Opp, client: { name: string }, people: Person[], items: (typeof s.opportunityItems.$inferSelect)[]) {
  const custom = (o.custom ?? {}) as Record<string, unknown>;
  const c = (k: string) => str(custom[k]);
  const kind = o.saleKind as SaleTypeKey | null;
  const imported: string[] = [];

  // objeto: o do edital/ata/demanda; sem ele, o título da negociação
  const object = c('objeto') ?? c('objeto_item') ?? c('escopo_preliminar') ?? null;
  if (object) imported.push('Objeto');

  // dados do órgão (contrato público)
  const publicTerms = {
    agency: (kind === 'licitacao' ? c('orgao_contratante') : null) ?? client.name,
    processNumber: c('numero_processo')?.slice(0, 80) ?? null,
    modality: (c('modalidade_interna') ?? c('tipo_lancamento') ?? (kind ? SALE_TYPE_LABELS[kind] : null))?.slice(0, 80) ?? null,
    commitmentNote: null, budgetLine: null, extensionMaxMonths: null,
  };
  if (publicTerms.processNumber) imported.push('Número do processo');

  // endereços de entrega, cada um com os produtos que vão para ele
  const extras = await db.select().from(s.opportunityDeliveryAddresses)
    .where(and(eq(s.opportunityDeliveryAddresses.tenantId, tenantId), eq(s.opportunityDeliveryAddresses.opportunityId, o.id)))
    .orderBy(asc(s.opportunityDeliveryAddresses.position), asc(s.opportunityDeliveryAddresses.createdAt));
  const servicesOf = (addrId: string | null) => items.filter((i) => (i.deliveryAddressId ?? null) === addrId).map((i) => i.description.trim()).join('; ').slice(0, 200) || null;
  const principal = line({ street: o.installStreet, number: o.installNumber, district: o.installDistrict, city: o.installCity, cep: o.installCep });
  const rows: { seq: number; address: string; service: string | null; extra: Record<string, string> }[] = [];
  if (principal) rows.push({ seq: 1, address: principal.slice(0, 500), service: servicesOf(null), extra: { Identificação: 'Principal' } });
  for (const a of extras) {
    const addr = line(a);
    if (!addr && !a.label) continue;
    rows.push({ seq: rows.length + 1, address: (addr || a.label!).slice(0, 500), service: servicesOf(a.id), extra: { ...(a.label ? { Identificação: a.label.slice(0, 300) } : {}), ...(a.notes ? { Observação: a.notes.slice(0, 300) } : {}) } });
  }
  const deliveryAddresses = rows.length ? { columns: ['Identificação', ...(rows.some((r) => r.extra['Observação']) ? ['Observação'] : [])], rows } : undefined;
  if (rows.length) imported.push(`${rows.length} endereço(s) de entrega`);

  // contatos: técnico (avaliador técnico/usuário) e administrativo (aprovador financeiro/contato principal/decisor)
  const pick = (...roles: string[]) => roles.map((r) => people.find((p) => p.role === r)).find(Boolean);
  const asContact = (p: Person | undefined) => (p ? { name: p.name, email: p.email, phone: p.phone } : { name: '', email: null, phone: null });
  const tech = pick('avaliador_tecnico', 'usuario', 'contato_principal');
  const admin = pick('aprovador_financeiro', 'contato_principal', 'decisor', 'patrocinador');
  if (tech || admin) imported.push('Contatos técnico e administrativo');

  // tudo o que foi preenchido no tipo de venda (edital, ata, sessão, link…), com os rótulos da jornada
  const pipes = await pipelinesOf(db, tenantId, { includeInactive: true });
  const fields = pipes.find((p) => p.id === o.pipelineId)?.fields ?? [];
  const skip = new Set(['objeto', 'objeto_item']);
  const filled = fields.filter((f) => !skip.has(f.key) && str(custom[f.key]) !== null).map((f) => {
    const v = custom[f.key];
    const shown = f.type === 'moeda' && typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : f.type === 'data' ? brDate(String(v)) : str(v)!;
    return `• ${f.label}: ${shown}`;
  });
  const peopleLines = people.map((p) => `• ${ENTITY_LINK_ROLE_LABELS[p.role as keyof typeof ENTITY_LINK_ROLE_LABELS] ?? p.role}: ${p.name}${p.email ? ` · ${p.email}` : ''}${p.phone ? ` · ${p.phone}` : ''}`);
  const special = [
    `Origem: OP-${o.code}${kind ? ` · ${SALE_TYPE_LABELS[kind]}` : ''} · ${o.title}`,
    ...(filled.length ? ['', 'Dados da negociação:', ...filled] : []),
    ...(peopleLines.length ? ['', 'Contatos da negociação:', ...peopleLines] : []),
    ...(o.notes?.trim() ? ['', 'Observações:', o.notes.trim()] : []),
  ].join('\n').slice(0, 4000);
  if (filled.length) imported.push(`${filled.length} campo(s) do tipo de venda`);

  const zenith: ZenithContract = {
    ...EMPTY_ZENITH,
    alias: client.name.slice(0, 60),
    techContact: asContact(tech),
    adminContact: asContact(admin),
  };
  return { object, publicTerms, deliveryAddresses, zenith, specialConditions: special, imported };
}

/** Ao cadastrar o contrato: as pessoas da negociação e os anexos (proposta, edital…) passam para o contrato. */
export async function carryToContract(tx: DbOrTx, tenantId: string, oppId: string, contractId: string, userId: string, clientName: string) {
  // papéis da negociação → papéis do contrato
  const roleMap: Record<string, string> = { contato_principal: 'contato_principal', aprovador_financeiro: 'aprovador_financeiro', patrocinador: 'patrocinador', usuario: 'usuario', decisor: 'gestor_contrato', avaliador_tecnico: 'usuario', influenciador: 'usuario' };
  const links = await tx.select().from(s.stakeholderLinks)
    .where(and(eq(s.stakeholderLinks.tenantId, tenantId), eq(s.stakeholderLinks.entityType, 'oportunidade'), eq(s.stakeholderLinks.entityId, oppId), isNull(s.stakeholderLinks.removedAt)));
  const toInsert = links.filter((l) => roleMap[l.role]).map((l) => ({ tenantId, stakeholderId: l.stakeholderId, contactId: l.contactId, entityType: 'contrato', entityId: contractId, role: roleMap[l.role]!, notes: l.notes, createdBy: userId }));
  if (toInsert.length) await tx.insert(s.stakeholderLinks).values(toInsert).onConflictDoNothing();
  // anexos: copiados no próprio banco (o arquivo não passa pela memória do servidor)
  const atts = await tx.select({ id: s.opportunityAttachments.id, kind: s.opportunityAttachments.kind, filename: s.opportunityAttachments.filename, createdAt: s.opportunityAttachments.createdAt })
    .from(s.opportunityAttachments)
    .where(and(eq(s.opportunityAttachments.tenantId, tenantId), eq(s.opportunityAttachments.opportunityId, oppId), isNull(s.opportunityAttachments.deletedAt), sql`${s.opportunityAttachments.kind} <> 'email'`));
  for (const a of atts) {
    const category = a.kind === 'proposta' ? 'PROPOSTA' : 'OUTRO';
    const day = a.createdAt.toISOString().slice(0, 10);
    const summary = a.filename.replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 120) || 'Anexo da negociação';
    await tx.execute(sql`
      insert into contract_documents (tenant_id, contract_id, group_id, version, category, name, doc_date, summary, mime, size, sha256, data, uploaded_by)
      select tenant_id, ${contractId}, gen_random_uuid(), 1, ${category}, ${documentName(day, category, clientName, summary)}, ${day}, ${summary}, mime, size_bytes, sha256, data, ${userId}
      from opportunity_attachments where id = ${a.id}`);
  }
  return { people: toInsert.length, documents: atts.length };
}
