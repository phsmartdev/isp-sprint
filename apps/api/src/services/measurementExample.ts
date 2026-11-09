/**
 * Exemplo de Relatório de Medição (dados fictícios): 1 conta pública com envio obrigatório, 1 contrato por medição
 * com itens numerados (Controle de Empenhos) e 6 medições pelas oportunidades de consumo, com proposta em PDF,
 * envio registrado no mês anterior e consumo no saldo do contrato. Marcado como demonstração
 * (source_system = 'demo_operacao'): sai com "Limpar base". Rodar de novo não duplica.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { prevMonth } from '@isp/domain';
import type { DB } from '../db/client';
import * as s from '../db/schema';
import { OPS_SOURCE } from './opsDemo';
import { ensureProposalNumber } from './proposalNumber';

export const EXAMPLE_EXTERNAL_ID = 'DEMO-MEDICAO-1';
const ACCOUNT = 'Companhia Estadual de Serviços Fictícia';

const LINES = [
  { n: '15', d: 'Projeto executivo, por m de lançamento FO', u: 'M', unit: 'un', price: 450 },
  { n: '22', d: 'Instalação com fornecimento de cabos de backbone AS SM 48FO', u: 'M', unit: 'un', price: 2_508 },
  { n: '23', d: 'Instalação com fornecimento de cabos de acesso DROP SM flat 1FO', u: 'M', unit: 'un', price: 570 },
  { n: '27', d: 'Fusão óptica', u: 'Und', unit: 'un', price: 7_000 },
  { n: '28', d: 'Equipe instalador/reparador + auxiliar', u: 'HH', unit: 'h', price: 9_690 },
  { n: '29', d: 'Analista de redes ou gerente de projetos', u: 'HH', unit: 'h', price: 13_680 },
  { n: '41', d: 'Instalação com fornecimento de CEO até 48FO com suporte p/poste', u: 'Und', unit: 'un', price: 69_000 },
  { n: '48', d: 'Instalação com fornecimento de acoplador óptico SC-APC', u: 'Und', unit: 'un', price: 912 },
  { n: '49', d: 'Instalação com fornecimento de conector de campo SC-APC', u: 'Und', unit: 'un', price: 3_680 },
] as const;
const L = Object.fromEntries(LINES.map((l) => [l.n, l]));

/** 6 medições: dia do envio no mês de referência + itens (nº do contrato, quantidade). */
const JOBS: { day: number; title: string; items: [string, number][] }[] = [
  { day: 5, title: 'Recuperação óptica na unidade Fictícia Atendimento Norte', items: [['27', 12], ['28', 4], ['49', 6]] },
  { day: 6, title: 'Recuperação óptica na unidade Fictícia Centro Cultural', items: [['27', 14], ['28', 3], ['23', 60], ['48', 1]] },
  { day: 13, title: 'Recuperação óptica na unidade Fictícia Posto Sul', items: [['27', 12], ['28', 4], ['23', 40]] },
  { day: 16, title: 'Recuperação óptica no Centro Administrativo Fictício', items: [['15', 56], ['22', 56], ['23', 160], ['27', 40], ['28', 6], ['29', 10], ['41', 1]] },
  { day: 21, title: 'Recuperação óptica na unidade Fictícia Praça Leste', items: [['27', 12], ['28', 2], ['23', 60], ['49', 5]] },
  { day: 27, title: 'Recuperação óptica na unidade Fictícia Terminal Oeste', items: [['27', 12], ['28', 2], ['23', 60], ['49', 4]] },
];

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');

async function proposalPdf(number: string, title: string, sentOn: string, items: { d: string; u: string; q: number; price: number }[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ascii = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  let y = 790;
  const text = (t: string, x: number, size = 10, f = font) => page.drawText(ascii(t), { x, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
  page.drawRectangle({ x: 0, y: 812, width: 595, height: 30, color: rgb(0.184, 0.349, 0.525) });
  page.drawText('PROPOSTA COMERCIAL (EXEMPLO FICTICIO)', { x: 40, y: 822, size: 12, font: bold, color: rgb(1, 1, 1) });
  text(`${number} - ${ACCOUNT}`, 40, 14, bold); y -= 22;
  text(title, 40, 11, bold); y -= 16;
  text(`Data de envio: ${sentOn.split('-').reverse().join('/')}  ·  Contrato por medicao CTR-MED-FICT/2026`, 40); y -= 30;
  text('Descritivo', 40, 9, bold); text('Und', 360, 9, bold); text('Qtd', 400, 9, bold); text('Unitario', 440, 9, bold); text('Total', 510, 9, bold); y -= 14;
  let total = 0;
  for (const i of items) {
    const t = i.q * i.price; total += t;
    text(i.d.slice(0, 62), 40, 8); text(i.u, 360, 8); text(String(i.q), 400, 8); text(brl(i.price), 440, 8); text(brl(t), 510, 8); y -= 13;
  }
  y -= 8; text('VALOR TOTAL', 400, 10, bold); text(brl(total), 510, 10, bold); y -= 40;
  text('Documento ficticio gerado para demonstracao do Relatorio de Medicao.', 40, 8);
  return Buffer.from(await doc.save());
}

export async function loadMeasurementExample(db: DB, tenantId: string, actorId: string, today: string) {
  const [exists] = await db.select({ id: s.contacts.id }).from(s.contacts).where(and(eq(s.contacts.tenantId, tenantId), eq(s.contacts.externalId, EXAMPLE_EXTERNAL_ID), sql`${s.contacts.deletedAt} is null`));
  if (exists) return { contactId: exists.id, created: false };
  const ref = prevMonth(today.slice(0, 7));
  const [pipe] = (await db.execute<{ id: string; won: string }>(sql`select p.id, (select st.key from pipeline_stages st where st.pipeline_id = p.id and st.kind = 'won' order by st.position limit 1) won from pipelines p where p.tenant_id = ${tenantId} and p.active order by p.is_default desc, p.position limit 1`)).rows;
  if (!pipe?.won) throw new Error('Nenhum funil com etapa de ganho para lançar as oportunidades do exemplo.');
  const [branch] = await db.select({ id: s.salesBranches.id }).from(s.salesBranches).where(eq(s.salesBranches.tenantId, tenantId)).limit(1);
  const tz = 'T13:00:00Z';
  return db.transaction(async (tx) => {
    const contactId = randomUUID();
    await tx.insert(s.contacts).values({ id: contactId, tenantId, name: ACCOUNT, document: '12.345.678/0001-95', nature: 'publica', segment: 'governamental', city: 'Cidade Fictícia', ownerId: actorId, email: 'medicao@companhia-ficticia.test', phone: '(00) 3000-0000', sourceSystem: OPS_SOURCE, externalId: EXAMPLE_EXTERNAL_ID, custom: { cnpj: '12.345.678/0001-95' }, createdBy: actorId } as never);
    const contractId = randomUUID();
    const year = ref.slice(0, 4);
    await tx.insert(s.contracts).values({ id: contractId, tenantId, contactId, opportunityId: null, kind: 'publico', legalRegime: 'lei_14133', stage: 'vigente', stageChangedAt: new Date(`${year}-01-20${tz}`), currentVersion: 1, commercialOwnerId: actorId, validatedAt: new Date(`${year}-01-11${tz}`), validatedBy: actorId, billingType: 'medicao', createdBy: actorId } as never);
    await tx.insert(s.contractVersions).values({ tenantId, contractId, version: 1, changeKind: 'cadastro', reason: 'Cadastro inicial (exemplo fictício)', number: 'CTR-MED-FICT/2026', object: 'Manutenção e recuperação de rede óptica (fictício)', signedAt: `${year}-01-10`, startAt: `${year}-01-10`, endAt: `${Number(year) + 1}-01-09`, termMonths: 12, monthlyCents: 0, totalCents: 50_000_000, items: [], publicTerms: { agency: 'Companhia Estadual de Serviços Fictícia', processNumber: `PROC-${year}-0001`, modality: 'Pregão eletrônico', commitmentNote: null, budgetLine: null, extensionMaxMonths: 60 }, createdBy: actorId } as never);
    await tx.insert(s.contractEvents).values({ tenantId, contractId, type: 'cadastro', actorId, summary: 'Contrato CTR-MED-FICT/2026 (Medição) cadastrado: exemplo fictício do Relatório de Medição', payload: { version: 1 } } as never);
    await tx.insert(s.contractLedger).values({ tenantId, contractId, kind: 'credito', amountCents: 50_000_000, occurredOn: `${year}-01-10`, description: 'Saldo contratado (fictício)', createdBy: actorId } as never);
    await tx.insert(s.contractLines).values(LINES.map((l, i) => ({ tenantId, contractId, position: i + 1, itemNumber: l.n, description: l.d, unit: l.u, qty4: 100_000 * 10_000, price4: l.price * 100 })) as never);
    for (const j of JOBS) {
      const sentOn = `${ref}-${String(j.day).padStart(2, '0')}`;
      const items = j.items.map(([n, q]) => ({ ...L[n]!, q }));
      const value = items.reduce((t, i) => t + i.q * i.price, 0);
      const oppId = randomUUID();
      const wonAt = new Date(`${sentOn}T18:00:00Z`);
      const [o] = await tx.insert(s.opportunities).values({ id: oppId, tenantId, contactId, ownerId: actorId, title: j.title, pipelineId: pipe.id, stage: pipe.won, saleKind: 'consumo_contrato', branchId: branch?.id ?? null, valueCents: value, proposalStatus: 'aceita', measurementContractId: contractId, measurementCents: value, stageChangedAt: wonAt, wonAt, createdBy: actorId, createdAt: new Date(`${sentOn}T11:00:00Z`), updatedAt: wonAt } as never).returning({ code: s.opportunities.code });
      await tx.insert(s.opportunityItems).values(items.map((i, k) => ({ tenantId, opportunityId: oppId, position: k, description: i.d, unit: i.unit, qtyMilli: i.q * 1000, unitCents: i.price, dealKind: 'servico', createdBy: actorId })) as never);
      const number = await ensureProposalNumber(tx, tenantId, oppId, sentOn);
      const pdf = await proposalPdf(number, j.title, sentOn, items.map((i) => ({ d: i.d, u: i.u, q: i.q, price: i.price })));
      await tx.insert(s.opportunityAttachments).values({ tenantId, opportunityId: oppId, kind: 'proposta', filename: `${number} - ${ACCOUNT}.pdf`, mime: 'application/pdf', sizeBytes: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'), data: pdf, uploadedBy: actorId, createdAt: new Date(`${sentOn}T12:00:00Z`) } as never);
      await tx.insert(s.opportunityEvents).values([
        { tenantId, opportunityId: oppId, type: 'created', actorId, payload: { saleKind: 'consumo_contrato', example: true }, rowVersion: 1, occurredAt: new Date(`${sentOn}T11:00:00Z`), observedAt: new Date(`${sentOn}T11:00:00Z`) },
        { tenantId, opportunityId: oppId, type: 'email_sent', actorId, payload: { kind: 'proposta', to: 'medicao@companhia-ficticia.test', subject: `Proposta ${number}`, attachment: 'proposta.pdf' }, rowVersion: 1, occurredAt: new Date(`${sentOn}T13:00:00Z`), observedAt: new Date(`${sentOn}T13:00:00Z`) },
        { tenantId, opportunityId: oppId, type: 'stage_changed', actorId, toValue: pipe.won, payload: null, rowVersion: 2, occurredAt: wonAt, observedAt: wonAt },
      ] as never);
      await tx.insert(s.contractLedger).values({ tenantId, contractId, kind: 'consumo', amountCents: value, occurredOn: sentOn, description: `OP-${o!.code} · ${j.title}`, opportunityId: oppId, createdBy: actorId } as never);
      await tx.insert(s.contractEvents).values({ tenantId, contractId, type: 'consumo', actorId, summary: `Consumo de ${brl(value)} pela oportunidade OP-${o!.code} (exemplo fictício).`, payload: { opportunityId: oppId, amountCents: value } } as never);
    }
    await tx.insert(s.measurementReportSettings).values({ tenantId, contactId, enabled: true, dueDay: 5, toAddress: 'medicao@companhia-ficticia.test', updatedBy: actorId });
    return { contactId, created: true };
  });
}
