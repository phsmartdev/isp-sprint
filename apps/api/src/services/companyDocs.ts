/**
 * Habilitação da empresa: certidões e alvarás por filial, com validade.
 * Avisos automáticos em 30, 15 e 7 dias e no vencimento (uma vez por documento e marco): tarefa para Administração
 * e Inteligência Comercial e e-mail, dizendo quantos contratos públicos da filial dependem do documento.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { COMPANY_DOC_LABELS, docStatus, type CompanyDocKind } from '@isp/domain';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { sendAlert } from './email';
import { usersBySector } from './contracts';

export async function currentCompanyDocs(db: DbOrTx, tenantId: string) {
  return db.select({ id: s.companyDocuments.id, branchId: s.companyDocuments.branchId, kind: s.companyDocuments.kind, label: s.companyDocuments.label, number: s.companyDocuments.number, issuedOn: s.companyDocuments.issuedOn, expiresOn: s.companyDocuments.expiresOn, filename: s.companyDocuments.filename, size: s.companyDocuments.size, notes: s.companyDocuments.notes, createdAt: s.companyDocuments.createdAt, createdBy: s.companyDocuments.createdBy })
    .from(s.companyDocuments).where(and(eq(s.companyDocuments.tenantId, tenantId), isNull(s.companyDocuments.supersededAt)));
}

/** Contratos públicos ativos por filial (pela filial da venda de origem); sem filial conta para todas. */
export async function publicContractsByBranch(db: DbOrTx, tenantId: string) {
  const r = await db.execute<{ branch_id: string | null; n: number }>(sql`
    select o.branch_id, count(*)::int n from contracts c left join opportunities o on o.id = c.opportunity_id
     where c.tenant_id = ${tenantId} and c.kind = 'publico' and c.stage not in ('arquivado','encerramento','cadastro_validacao') group by o.branch_id`);
  return r.rows;
}

const THRESHOLD: Record<string, string> = { vence_30: '30', vence_15: '15', vence_7: '7', vencida: 'vencida' };

export async function runCompanyDocAlerts(db: DbOrTx, tenantId: string, today = new Date().toISOString().slice(0, 10)) {
  const docs = await currentCompanyDocs(db, tenantId);
  const branches = await db.select({ id: s.salesBranches.id, name: s.salesBranches.name }).from(s.salesBranches).where(eq(s.salesBranches.tenantId, tenantId));
  const pubs = await publicContractsByBranch(db, tenantId);
  let created = 0;
  for (const d of docs) {
    const st = docStatus(d.expiresOn, today);
    const th = THRESHOLD[st.status];
    if (!th) continue;
    const [row] = await db.insert(s.companyDocAlerts).values({ tenantId, documentId: d.id, threshold: th }).onConflictDoNothing().returning({ id: s.companyDocAlerts.id });
    if (!row) continue;
    created++;
    const branch = d.branchId ? branches.find((b) => b.id === d.branchId)?.name ?? 'filial' : 'todas as filiais';
    const dependent = pubs.filter((p) => !d.branchId || p.branch_id === d.branchId || p.branch_id === null).reduce((t, p) => t + p.n, 0);
    const name = d.label || COMPANY_DOC_LABELS[d.kind as CompanyDocKind] || d.kind;
    const when = st.status === 'vencida' ? `venceu em ${d.expiresOn}` : `vence em ${st.days} dia(s) (${d.expiresOn})`;
    const title = `${st.status === 'vencida' ? 'Certidão vencida' : 'Renovar certidão'}: ${name} – ${branch}`;
    const text = `${name} (${branch}) ${when}.${dependent ? ` ${dependent} contrato(s) público(s) dependem da regularidade para receber.` : ''}\nEmita a nova certidão e cadastre em Gestão de Contratos → Habilitação.`;
    // setores responsáveis; sem ninguém nos setores, quem cadastrou o documento
    let people = await usersBySector(db, tenantId, ['administracao', 'inteligencia_comercial', 'diretoria']);
    if (!people.length && d.createdBy) people = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.users).where(and(eq(s.users.id, d.createdBy), eq(s.users.active, true)));
    const activityIds: string[] = [];
    const emails: { to: string; status: string; error: string | null }[] = [];
    const dueAt = new Date(`${st.status === 'vencida' ? today : d.expiresOn}T12:00:00Z`);
    for (const p of people.slice(0, 5)) {
      const [a] = await db.insert(s.activities).values({ tenantId, type: 'tarefa', title: title.slice(0, 200), notes: text, dueAt, priority: st.status === 'vence_30' ? 'media' : 'alta', ownerId: p.id }).returning({ id: s.activities.id });
      activityIds.push(a!.id);
      const r = await sendAlert(db, { tenantId, kind: 'habilitacao', to: p.email, subject: title, text });
      emails.push({ to: p.email, status: r?.ok ? 'enviado' : r && 'notConfigured' in r && r.notConfigured ? 'nao_configurado' : 'falhou', error: r && !r.ok ? r.error : null });
    }
    await db.update(s.companyDocAlerts).set({ activityIds, emails }).where(eq(s.companyDocAlerts.id, row.id));
  }
  return { created };
}
