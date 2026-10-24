/** Contratos: etapas dos processos (implantação, renovação, reajuste, encerramento), ofício, documentos e linha do tempo. */
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  ALERT_LABELS, DOC_TYPES, PROCESS_LABELS, TIMELINE_CATEGORIES, timelineCategory, timelineCritical, upcomingOf, SECTORS, SECTOR_LABELS, adjustedCents, documentName, endFromTerm, fillSubject, fillTemplate,
  type AlertKind, type ProcessKind, type StepDef, type Upcoming,
} from '@isp/domain';
import { defineRoute } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import type { AuthContext } from '../http/context';
import * as s from '../db/schema';
import type { DbOrTx } from '../db/client';
import { audit } from '../services/audit';
import { brl } from '../services/email';
import { buildProposalPdf, safeText, wrap } from '../services/proposals';
import {
  addEvent, assertCanDoStep, contractSettingsOf, contractSummary, currentVersion, hasSector, isAdmin, loadContract, mailTo, newVersion,
  openProcess, pendingRequired, setStage, stepsOf, type ContractRow,
} from '../services/contracts';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const P = z.object({ id: z.string().uuid(), pid: z.string().uuid() });
const StepP = P.extend({ key: z.string().regex(/^[a-z0-9_]{2,40}$/) });
const DocP = z.object({ id: z.string().uuid(), docId: z.string().uuid() });
const today = () => new Date().toISOString().slice(0, 10);
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

async function loadProcess(db: DbOrTx, c: ContractRow, pid: string) {
  const [p] = await db.select().from(s.contractProcesses).where(and(eq(s.contractProcesses.id, pid), eq(s.contractProcesses.contractId, c.id))).limit(1);
  if (!p) throw notFound('Processo não encontrado.');
  return p;
}
type Proc = Awaited<ReturnType<typeof loadProcess>>;

/** Documento exigido pela etapa: da categoria certa, enviado depois que o processo abriu (e assinado quando a etapa pede assinatura). */
async function requiredDoc(db: DbOrTx, c: ContractRow, p: Proc, d: StepDef) {
  const mustSign = ['documento_assinado', 'pdf_assinado', 'formalizacao'].includes(d.key);
  const [doc] = await db.select({ id: s.contractDocuments.id, name: s.contractDocuments.name }).from(s.contractDocuments)
    .where(and(eq(s.contractDocuments.contractId, c.id), eq(s.contractDocuments.category, d.docType!), isNull(s.contractDocuments.deletedAt), sql`${s.contractDocuments.createdAt} >= ${p.openedAt}`, mustSign ? eq(s.contractDocuments.signed, true) : undefined))
    .orderBy(desc(s.contractDocuments.createdAt)).limit(1);
  // contrato assinado pode ter sido anexado antes da implantação abrir
  if (!doc && d.key === 'documento_assinado') {
    const [any] = await db.select({ id: s.contractDocuments.id, name: s.contractDocuments.name }).from(s.contractDocuments).where(and(eq(s.contractDocuments.contractId, c.id), eq(s.contractDocuments.category, 'CONTRATO'), eq(s.contractDocuments.signed, true), isNull(s.contractDocuments.deletedAt))).limit(1);
    return any ?? null;
  }
  return doc ?? null;
}

async function completeStep(db: DbOrTx, auth: AuthContext, c: ContractRow, p: Proc, d: StepDef, state: s.ProcessStepState) {
  const steps = { ...p.steps, [d.key]: state };
  await db.update(s.contractProcesses).set({ steps, rowVersion: sql`${s.contractProcesses.rowVersion} + 1` }).where(eq(s.contractProcesses.id, p.id));
  p.steps = steps;
  await addEvent(db, auth.tenantId, c.id, auth.userId, 'etapa_processo', `${PROCESS_LABELS[p.kind as ProcessKind]}: ${d.label}${state.skipped ? ' (pulada)' : ''}${state.note ? ` — ${state.note}` : ''}`, { processId: p.id, step: d.key, value: state.value });
}

async function closeProcess(db: DbOrTx, auth: AuthContext, c: ContractRow, p: Proc, status: 'concluido' | 'cancelado', outcome: string) {
  await db.update(s.contractProcesses).set({ status, outcome, closedAt: new Date(), closedBy: auth.userId }).where(eq(s.contractProcesses.id, p.id));
  p.status = status;
  await addEvent(db, auth.tenantId, c.id, auth.userId, 'processo_encerrado', `Processo de ${PROCESS_LABELS[p.kind as ProcessKind].toLowerCase()} ${status === 'concluido' ? 'concluído' : 'cancelado'}: ${outcome}`, { processId: p.id });
}

const StepBody = z.object({
  note: z.string().trim().max(2000).optional(),
  skip: z.boolean().default(false),
  value: z.object({
    ref: z.string().trim().min(1).max(80).optional(),
    date: day.optional(),
    decision: z.enum(['sim', 'nao']).optional(),
    documentId: z.string().uuid().optional(),
    // renovação
    startAt: day.optional(), endAt: day.optional(), termMonths: z.number().int().min(1).max(600).optional(),
    monthlyCents: z.number().int().min(0).max(10_000_000_000).optional(), totalCents: z.number().int().min(0).nullable().optional(),
    // reajuste
    index: z.string().trim().min(1).max(60).optional(), pct: z.number().min(-100).max(1000).optional(),
    // arquivamento
    location: z.string().trim().min(2).max(300).optional(), responsibleId: z.string().uuid().optional(),
  }).default({}),
});

export const contractWorkRoutes = [
  defineRoute({
    method: 'POST',
    url: '/contracts/:id/processes',
    summary: 'Abre manualmente um processo (renovação, reajuste ou encerramento) sem mudar a etapa do funil',
    tag: 'Contratos',
    module: 'contratos',
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ kind: z.enum(['renovacao', 'reajuste', 'encerramento']), reason: z.string().trim().min(3).max(500), closureAt: day.optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!c.validatedAt || c.stage === 'arquivado') throw unprocessable('Só contratos validados e não arquivados.');
      if (!(isAdmin(auth) || hasSector(auth, ['inteligencia_comercial', 'administracao', 'diretoria', 'financeiro']) || c.commercialOwnerId === auth.userId)) throw forbidden();
      const cur = await currentVersion(app.db, c);
      const r = await app.db.transaction(async (tx) => {
        if (body.kind === 'encerramento') {
          const at = body.closureAt ?? cur.endAt ?? today();
          await tx.update(s.contracts).set({ closureExpected: true, closureReason: body.reason, closureAt: at }).where(eq(s.contracts.id, c.id));
          return openProcess(tx, c, 'encerramento', at, auth.userId, { reason: body.reason, closingAt: at, manual: true }, at);
        }
        if (body.kind === 'renovacao') return openProcess(tx, c, 'renovacao', cur.endAt ?? today(), auth.userId, { previousEndAt: cur.endAt, reason: body.reason, manual: true }, cur.endAt);
        return openProcess(tx, c, 'reajuste', `manual:${today()}`, auth.userId, { baseDate: cur.adjustmentBaseDate, index: cur.adjustmentIndex, rule: cur.adjustmentRule, currentCents: cur.monthlyCents, reason: body.reason, manual: true });
      });
      if (!r.created) throw unprocessable('Já existe um processo deste tipo para este ciclo.');
      await audit(app.db, req, { action: 'contract.process.open', entityType: 'contract', entityId: c.id, metadata: { kind: body.kind } });
      reply.code(201);
      return { id: r.process.id };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/contracts/:id/processes/:pid/steps/:key',
    summary: 'Conclui uma etapa do processo, com as exigências da etapa (ERP, documento, data, decisão ou valores)',
    tag: 'Contratos',
    module: 'contratos',
    params: StepP,
    body: StepBody,
    handler: async ({ app, auth, params, body, req }) => {
      const c = await loadContract(app.db, auth, params.id);
      const p = await loadProcess(app.db, c, params.pid);
      if (p.status !== 'aberto') throw unprocessable('Este processo já foi encerrado.');
      const defs = stepsOf(p.kind as ProcessKind, c.kind);
      const d = defs.find((x) => x.key === params.key);
      if (!d) throw notFound('Etapa não existe neste processo.');
      if (p.steps[d.key]) throw unprocessable('Esta etapa já foi concluída.');
      await assertCanDoStep(app.db, auth, c, d);
      const val = body.value;
      const note = body.note?.trim() || null;
      const bad = (m: string, path = 'value') => unprocessable(m, [{ path, message: m }]);
      if (body.skip && !d.optional) throw bad('Esta etapa é obrigatória.');
      const state: s.ProcessStepState = { doneAt: new Date().toISOString(), doneBy: auth.userId, doneByName: auth.name, note, value: null, skipped: body.skip || undefined };
      const others = () => defs.filter((x) => x.key !== d.key && !x.optional && !p.steps[x.key]);
      const result: Record<string, unknown> = {};

      await app.db.transaction(async (tx) => {
        if (!body.skip) switch (d.requires) {
          case 'nota': if (!note || note.length < 3) throw bad('Descreva o que foi feito.', 'note'); break;
          case 'erp':
            if (!val.ref) throw bad('Informe o código/referência no ERP.', 'value.ref');
            state.value = { ref: val.ref };
            await tx.update(s.contracts).set({ erpRef: val.ref, updatedAt: new Date() }).where(eq(s.contracts.id, c.id));
            if (c.opportunityId) await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: c.opportunityId, type: 'erp_atualizado', actorId: auth.userId, payload: { contractId: c.id, ref: val.ref, process: p.kind } });
            break;
          case 'documento': {
            const doc = await requiredDoc(tx, c, p, d);
            if (!doc) throw bad(`Anexe antes o documento do tipo ${d.docType}${['documento_assinado', 'pdf_assinado', 'formalizacao'].includes(d.key) ? ' marcado como assinado' : ''}.`);
            state.value = { documentId: doc.id, name: doc.name };
            break;
          }
          case 'data':
            if (!val.date) throw bad('Informe a data.', 'value.date');
            state.value = { date: val.date };
            if (d.key === 'ativacao_tecnica') await newVersion(tx, c, auth.userId, { activationAt: val.date }, 'ativacao', `Ativação técnica em ${val.date}`);
            if (d.key === 'inicio_faturamento') await newVersion(tx, c, auth.userId, { billingStartAt: val.date }, 'ativacao', `Início do faturamento em ${val.date}`);
            if (d.key === 'aplicacao') {
              const calc = p.steps.calculo?.value as { newCents?: number; pct?: number; index?: string } | undefined;
              if (!calc?.newCents) throw bad('Calcule o reajuste antes de aplicar.');
              if ((p.steps.aprovacao?.value as { decision?: string } | undefined)?.decision !== 'sim') throw bad('O reajuste precisa estar aprovado.');
              const cur = await currentVersion(tx, c);
              const factor = calc.newCents / Math.max(1, cur.monthlyCents);
              await newVersion(tx, c, auth.userId, { monthlyCents: calc.newCents, effectiveFrom: /^\d{4}-\d{2}-\d{2}$/.test(p.cycleKey) ? p.cycleKey : val.date, items: cur.items.map((i) => ({ ...i, unitCents: Math.round(i.unitCents * factor) })) }, 'reajuste', `Reajuste ${calc.index ?? ''} ${calc.pct}% aplicado em ${val.date}: ${brl(cur.monthlyCents)} → ${brl(calc.newCents)}`.replace(/\s+/g, ' '));
              result.monthlyCents = calc.newCents;
            }
            break;
          case 'decisao':
            if (!val.decision) throw bad('Registre a decisão.', 'value.decision');
            if (val.decision === 'nao' && (!note || note.length < 3)) throw bad('Explique o motivo.', 'note');
            state.value = { decision: val.decision };
            break;
          case 'valores':
            if (d.key === 'calculo') {
              if (val.pct === undefined || !val.index) throw bad('Informe o índice e o percentual.');
              const currentCents = val.monthlyCents ?? (await currentVersion(tx, c)).monthlyCents;
              const newCents = adjustedCents(currentCents, val.pct);
              state.value = { index: val.index, pct: val.pct, currentCents, newCents };
              await tx.update(s.contractProcesses).set({ data: { ...p.data, index: val.index, pct: val.pct, currentCents, newCents } }).where(eq(s.contractProcesses.id, p.id));
              result.newCents = newCents;
            } else if (d.key === 'nova_vigencia') {
              if (others().length) throw bad(`Conclua antes: ${others().map((x) => x.label).join('; ')}.`);
              const cur = await currentVersion(tx, c);
              const startAt = val.startAt ?? (cur.endAt ? new Date(Date.parse(`${cur.endAt}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : null);
              const endAt = val.endAt ?? (startAt && (val.termMonths ?? cur.termMonths) ? endFromTerm(startAt, (val.termMonths ?? cur.termMonths)!) : null);
              if (!startAt || !endAt || endAt <= startAt) throw bad('Informe o início e o término (ou o prazo) da nova vigência.');
              if (c.legalLimitAt && endAt > c.legalLimitAt) throw bad(`A nova vigência passa do limite total informado (${c.legalLimitAt}). Revise com o responsável.`);
              await newVersion(tx, c, auth.userId, { startAt, endAt, termMonths: val.termMonths ?? cur.termMonths, renewalAt: endAt, monthlyCents: val.monthlyCents ?? cur.monthlyCents, totalCents: val.totalCents === undefined ? cur.totalCents : val.totalCents }, 'renovacao', `Renovação: nova vigência ${startAt} a ${endAt}`);
              state.value = { startAt, endAt, monthlyCents: val.monthlyCents ?? cur.monthlyCents };
              await tx.update(s.contracts).set({ renewed: true, closureExpected: false, closureReason: null, closureAt: null, nextAction: 'Contrato renovado', nextActionAt: null }).where(eq(s.contracts.id, c.id));
              await addEvent(tx, auth.tenantId, c.id, auth.userId, 'renovado', `Contrato Renovado: vigência ${startAt} a ${endAt}. Próximo alerta de renovação programado pela nova data de término.`, { startAt, endAt });
              result.renewed = { startAt, endAt };
            }
            break;
        }
        if (d.key === 'arquivamento') {
          if (others().length) throw bad(`Conclua antes: ${others().map((x) => x.label).join('; ')}.`);
          if ((p.steps.validacao_cs?.value as { decision?: string } | undefined)?.decision !== 'sim') throw bad('O encerramento precisa da validação de Sucesso do Cliente.');
          if (!val.location || !note) throw bad('Informe a nota final e o local de arquivamento.');
          state.value = { location: val.location, responsibleId: val.responsibleId ?? auth.userId };
        }
        await completeStep(tx, auth, c, p, d, state);

        // efeitos das decisões
        if (d.requires === 'decisao' && val.decision === 'nao') {
          if (p.kind === 'renovacao' && (d.key === 'verificar_prorrogacao' || d.key === 'manifestacao_cliente')) {
            const cur = await currentVersion(tx, c);
            await tx.update(s.contracts).set({ closureExpected: true, closureReason: note, closureAt: cur.endAt }).where(eq(s.contracts.id, c.id));
            await closeProcess(tx, auth, c, p, 'concluido', 'nao_renovado');
            await setStage(tx, c, auth.userId, 'vigente', 'sem renovação: encerramento previsto no término');
            await addEvent(tx, auth.tenantId, c.id, auth.userId, 'encerramento_previsto', `Sem renovação (${d.label}): ${note}. Encerramento previsto para ${cur.endAt}; os avisos de 90 e 30 dias seguem automáticos.`, null);
            result.closureExpected = true;
          }
          if (p.kind === 'reajuste' && d.key === 'aprovacao') { await closeProcess(tx, auth, c, p, 'cancelado', `reprovado: ${note}`); if (c.stage === 'reajuste') await setStage(tx, c, auth.userId, 'vigente', 'reajuste reprovado'); }
        }
        // concluiu tudo?
        if (p.status === 'aberto' && !pendingRequired(p, c.kind).length) {
          if (p.kind === 'implantacao') { await closeProcess(tx, auth, c, p, 'concluido', 'implantado'); if (c.stage === 'implantacao') await setStage(tx, c, auth.userId, 'vigente', 'implantação concluída'); }
          if (p.kind === 'renovacao') { await closeProcess(tx, auth, c, p, 'concluido', 'renovado'); await setStage(tx, c, auth.userId, 'vigente', 'Contrato Renovado'); }
          if (p.kind === 'reajuste') { await closeProcess(tx, auth, c, p, 'concluido', 'aplicado'); if (c.stage === 'reajuste') await setStage(tx, c, auth.userId, 'vigente', 'reajuste aplicado'); }
          if (p.kind === 'encerramento') {
            const v = state.value as { location: string; responsibleId: string };
            await tx.update(s.contracts).set({ closedAt: new Date(), archivedAt: new Date(), archiveLocation: v.location, archiveResponsibleId: v.responsibleId, finalNote: note, nextAction: null, nextActionAt: null }).where(eq(s.contracts.id, c.id));
            await tx.update(s.contractDocuments).set({ folder: 'Encerrados' }).where(eq(s.contractDocuments.contractId, c.id));
            await tx.update(s.contractAlerts).set({ status: 'concluido', resolvedAt: new Date(), resolvedBy: auth.userId, resolution: 'Contrato encerrado e arquivado' }).where(and(eq(s.contractAlerts.contractId, c.id), eq(s.contractAlerts.status, 'aberto')));
            for (const o of await tx.select({ id: s.contractProcesses.id }).from(s.contractProcesses).where(and(eq(s.contractProcesses.contractId, c.id), eq(s.contractProcesses.status, 'aberto'), sql`${s.contractProcesses.id} <> ${p.id}`))) {
              await tx.update(s.contractProcesses).set({ status: 'cancelado', outcome: 'contrato encerrado', closedAt: new Date(), closedBy: auth.userId }).where(eq(s.contractProcesses.id, o.id));
            }
            await closeProcess(tx, auth, c, p, 'concluido', 'encerrado');
            await addEvent(tx, auth.tenantId, c.id, auth.userId, 'arquivado', `Contrato encerrado e arquivado em “${v.location}”. Documentos movidos para a pasta Encerrados.`, v);
            await setStage(tx, c, auth.userId, 'arquivado', 'encerramento concluído');
            if (c.opportunityId) await tx.insert(s.opportunityEvents).values({ tenantId: auth.tenantId, opportunityId: c.opportunityId, type: 'contrato_encerrado', actorId: auth.userId, payload: { contractId: c.id } });
          }
        }
      });
      await audit(app.db, req, { action: 'contract.step', entityType: 'contract', entityId: c.id, metadata: { process: p.kind, step: d.key, skipped: body.skip } });
      return { ok: true, processStatus: p.status, ...result };
    },
  }),

  defineRoute({
    method: 'POST',
    url: '/contracts/:id/processes/:pid/cancel',
    summary: 'Cancela um processo aberto (com motivo). Cancelar o encerramento tira o encerramento previsto.',
    tag: 'Contratos',
    module: 'contratos',
    params: P,
    body: z.object({ reason: z.string().trim().min(3).max(500) }),
    handler: async ({ app, auth, params, body, req }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (!(isAdmin(auth) || hasSector(auth, ['inteligencia_comercial', 'administracao', 'diretoria']))) throw forbidden('Cancelar processos é da gestão de contratos.');
      const p = await loadProcess(app.db, c, params.pid);
      if (p.status !== 'aberto') throw unprocessable('Este processo já foi encerrado.');
      await app.db.transaction(async (tx) => {
        await closeProcess(tx, auth, c, p, 'cancelado', body.reason);
        if (p.kind === 'encerramento') { await tx.update(s.contracts).set({ closureExpected: false, closureReason: null, closureAt: null }).where(eq(s.contracts.id, c.id)); if (c.stage === 'encerramento') await setStage(tx, c, auth.userId, 'vigente', 'encerramento cancelado'); }
        if ((p.kind === 'renovacao' && c.stage === 'renovacao') || (p.kind === 'reajuste' && c.stage === 'reajuste')) await setStage(tx, c, auth.userId, 'vigente', `${PROCESS_LABELS[p.kind as ProcessKind].toLowerCase()} cancelado`);
      });
      await audit(app.db, req, { action: 'contract.process.cancel', entityType: 'contract', entityId: c.id, metadata: { kind: p.kind, reason: body.reason } });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ ofício de renovação (contratos públicos)
  defineRoute({
    method: 'POST',
    url: '/contracts/:id/processes/:pid/oficio',
    summary: 'Gera o ofício de renovação pelo modelo institucional e anexa ao contrato (tipo OFICIO)',
    tag: 'Contratos',
    module: 'contratos',
    params: P,
    body: z.object({ oficioNumber: z.string().trim().min(1).max(40), months: z.number().int().min(1).max(120), city: z.string().trim().max(80).default('Aracaju') }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      const p = await loadProcess(app.db, c, params.pid);
      if (p.kind !== 'renovacao' || p.status !== 'aberto') throw unprocessable('O ofício é gerado dentro de um processo de renovação aberto.');
      const d = stepsOf('renovacao', c.kind).find((x) => x.key === 'gerar_oficio');
      if (d) await assertCanDoStep(app.db, auth, c, d);
      const cfg = await contractSettingsOf(app.db, auth.tenantId);
      const sum = await contractSummary(app.db, c, app.config);
      const [addr] = await app.db.select().from(s.addresses).where(eq(s.addresses.contactId, c.contactId)).orderBy(desc(s.addresses.validFrom)).limit(1);
      const vars: Record<string, string> = {
        cidade: body.city, data_extenso: longDate(today()), oficio_numero: body.oficioNumber,
        'cliente.nome': sum.contact?.name ?? '', 'cliente.documento': sum.contact?.document ?? '',
        'cliente.endereco': addr ? [addr.street, addr.number, addr.district, addr.city, addr.state].filter(Boolean).join(', ') : '',
        'contrato.numero': sum.v.number, 'contrato.objeto': sum.v.object, 'contrato.inicio': sum.v.startAt ?? '', 'contrato.termino': sum.v.endAt ?? '',
        'contrato.valor_mensal': brl(sum.v.monthlyCents), 'contrato.valor_global': brl(sum.v.totalCents), 'contrato.orgao': sum.v.publicTerms?.agency ?? '', 'contrato.processo': sum.v.publicTerms?.processNumber ?? '',
        'renovacao.meses': String(body.months), 'responsavel.nome': auth.name, 'empresa.nome': auth.tenantName,
      };
      vars['oficio.corpo'] = fillTemplate(cfg.oficioTemplate, vars);
      let pdf: Buffer | null = null;
      if (cfg.oficioTemplateId) pdf = (await buildProposalPdf(app.db, auth.tenantId, cfg.oficioTemplateId, vars))?.pdf ?? null;
      if (!pdf) {
        const doc = await PDFDocument.create();
        doc.setTitle(`Ofício ${body.oficioNumber} - ${vars['cliente.nome']}`);
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const bold = await doc.embedFont(StandardFonts.HelveticaBold);
        let page = doc.addPage([595.28, 841.89]);
        page.drawText(safeText(bold, auth.tenantName), { x: 56, y: 790, size: 14, font: bold, color: rgb(0.04, 0.12, 0.36) });
        page.drawLine({ start: { x: 56, y: 780 }, end: { x: 539, y: 780 }, thickness: 1, color: rgb(0.04, 0.12, 0.36) });
        let y = 750;
        for (const line of wrap(font, safeText(font, vars['oficio.corpo']), 11, 483)) {
          if (y < 60) { page = doc.addPage([595.28, 841.89]); y = 790; }
          page.drawText(line, { x: 56, y, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
          y -= 16;
        }
        pdf = Buffer.from(await doc.save());
      }
      const name = documentName(today(), 'OFICIO', vars['cliente.nome']!, `RENOVACAO CONTRATO ${sum.v.number}`);
      const [row] = await app.db.transaction(async (tx) => {
        const r = await tx.insert(s.contractDocuments).values({ tenantId: auth.tenantId, contractId: c.id, processId: p.id, groupId: randomUUID(), version: 1, category: 'OFICIO', name, docDate: today(), summary: `Renovação contrato ${sum.v.number}`, mime: 'application/pdf', size: pdf!.length, sha256: createHash('sha256').update(pdf!).digest('hex'), data: pdf!, uploadedBy: auth.userId }).returning({ id: s.contractDocuments.id, name: s.contractDocuments.name });
        await addEvent(tx, auth.tenantId, c.id, auth.userId, 'documento', `Ofício gerado: ${name}`, { documentId: r[0]!.id });
        if (d && !p.steps.gerar_oficio) await completeStep(tx, auth, c, p, d, { doneAt: new Date().toISOString(), doneBy: auth.userId, doneByName: auth.name, note: `Ofício nº ${body.oficioNumber}`, value: { documentId: r[0]!.id, name } });
        return r;
      });
      await audit(app.db, req, { action: 'contract.oficio', entityType: 'contract', entityId: c.id, metadata: { documentId: row!.id } });
      reply.code(201);
      return { id: row!.id, name: row!.name };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/contracts/:id/processes/:pid/oficio/send',
    summary: 'Envia o ofício por e-mail ao cliente com cópia para o endereço de contratos. Só marca como enviado se o e-mail sair.',
    tag: 'Contratos',
    module: 'contratos',
    params: P,
    body: z.object({ to: z.string().trim().email().max(200), message: z.string().trim().max(4000).default(''), documentId: z.string().uuid().optional() }),
    handler: async ({ app, auth, params, body, req }) => {
      const c = await loadContract(app.db, auth, params.id);
      const p = await loadProcess(app.db, c, params.pid);
      if (p.kind !== 'renovacao' || p.status !== 'aberto') throw unprocessable('Envie dentro de um processo de renovação aberto.');
      const d = stepsOf('renovacao', c.kind).find((x) => x.key === 'enviar_oficio');
      if (d) await assertCanDoStep(app.db, auth, c, d);
      const [doc] = await app.db.select().from(s.contractDocuments).where(and(eq(s.contractDocuments.contractId, c.id), eq(s.contractDocuments.category, 'OFICIO'), isNull(s.contractDocuments.deletedAt), body.documentId ? eq(s.contractDocuments.id, body.documentId) : undefined)).orderBy(desc(s.contractDocuments.createdAt)).limit(1);
      if (!doc) throw unprocessable('Gere ou anexe o ofício antes de enviar.');
      const cfg = await contractSettingsOf(app.db, auth.tenantId);
      const sum = await contractSummary(app.db, c, app.config);
      const subject = fillSubject(cfg.renewalSubject, sum.v.number, sum.contact?.name ?? '');
      const text = body.message || `Prezados(as),\n\nEncaminhamos em anexo o ofício referente à renovação do Contrato nº ${sum.v.number}.\n\nAtenciosamente,\n${auth.name}\n${auth.tenantName}`;
      const r = await mailTo(app.db, c, 'contrato_oficio', body.to, subject, text, auth.userId, { cc: cfg.ccEmail, attachments: [{ filename: `${doc.name}.pdf`, content: doc.data, contentType: doc.mime }] });
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'oficio_email', `Ofício para ${body.to} (cópia ${cfg.ccEmail}): ${r.status === 'enviado' ? 'enviado' : `não enviado — ${r.error}`}`, { subject, ...r });
      if (r.status !== 'enviado') throw unprocessable(r.status === 'nao_configurado' ? 'E-mail não configurado (SMTP). Configure em Configurações → E-mail ou envie por fora e registre a etapa com observação.' : `O e-mail não saiu: ${r.error}`);
      if (d && !p.steps.enviar_oficio) await completeStep(app.db, auth, c, p, d, { doneAt: new Date().toISOString(), doneBy: auth.userId, doneByName: auth.name, note: `Enviado para ${body.to} com cópia para ${cfg.ccEmail} — assunto “${subject}”`, value: { to: body.to, cc: cfg.ccEmail, documentId: doc.id } });
      await audit(app.db, req, { action: 'contract.oficio.send', entityType: 'contract', entityId: c.id, metadata: { to: body.to } });
      return { ok: true, subject, cc: cfg.ccEmail };
    },
  }),

  // ------------------------------------------------------------------ documentos
  defineRoute({
    method: 'GET',
    url: '/contracts/:id/documents',
    summary: 'Documentos do contrato (todas as versões), respeitando o acesso por setor',
    tag: 'Contratos',
    module: 'contratos',
    params: z.object({ id: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const rows = await app.db.select({ id: s.contractDocuments.id, groupId: s.contractDocuments.groupId, version: s.contractDocuments.version, category: s.contractDocuments.category, name: s.contractDocuments.name, docDate: s.contractDocuments.docDate, summary: s.contractDocuments.summary, mime: s.contractDocuments.mime, size: s.contractDocuments.size, folder: s.contractDocuments.folder, restrictedTo: s.contractDocuments.restrictedTo, signed: s.contractDocuments.signed, processId: s.contractDocuments.processId, createdAt: s.contractDocuments.createdAt, uploadedBy: s.users.name })
        .from(s.contractDocuments).leftJoin(s.users, eq(s.users.id, s.contractDocuments.uploadedBy))
        .where(and(eq(s.contractDocuments.contractId, c.id), isNull(s.contractDocuments.deletedAt))).orderBy(desc(s.contractDocuments.createdAt));
      return { items: rows.map((r) => ({ ...r, canOpen: canOpenDoc(auth, c, r.restrictedTo), latest: !rows.some((x) => x.groupId === r.groupId && x.version > r.version) })) };
    },
  }),
  defineRoute({
    method: 'POST',
    url: '/contracts/:id/documents',
    summary: 'Envia documento (nome no padrão AAMMDD - TIPO - CLIENTE - RESUMO). Com groupId vira nova versão do mesmo documento.',
    tag: 'Contratos',
    module: 'contratos',
    params: z.object({ id: z.string().uuid() }),
    bodyLimit: 14_000_000,
    body: z.object({
      category: z.enum(DOC_TYPES), docDate: day, summary: z.string().trim().min(2).max(120), mime: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
      data: z.string().min(8).max(13_500_000), signed: z.boolean().default(false), restrictedTo: z.array(z.enum(SECTORS)).max(8).default([]),
      groupId: z.string().uuid().optional(), processId: z.string().uuid().optional(),
    }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      if (c.stage === 'arquivado' && !isAdmin(auth)) throw unprocessable('Contrato arquivado: só a administração inclui documentos.');
      const data = Buffer.from(body.data.replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (!data.length || data.length > 10_000_000) throw unprocessable('Arquivo vazio ou maior que 10 MB.');
      if (body.mime === 'application/pdf' && data.subarray(0, 4).toString() !== '%PDF') throw unprocessable('O arquivo não é um PDF válido.');
      const [contact] = await app.db.select({ name: s.contacts.name }).from(s.contacts).where(eq(s.contacts.id, c.contactId)).limit(1);
      let groupId = body.groupId ?? randomUUID(), version = 1;
      if (body.groupId) {
        const [last] = await app.db.select({ version: s.contractDocuments.version, restrictedTo: s.contractDocuments.restrictedTo }).from(s.contractDocuments).where(and(eq(s.contractDocuments.groupId, body.groupId), eq(s.contractDocuments.contractId, c.id))).orderBy(desc(s.contractDocuments.version)).limit(1);
        if (!last) throw unprocessable('Documento de origem não encontrado.');
        if (!canOpenDoc(auth, c, last.restrictedTo)) throw forbidden('Documento restrito a outro setor.');
        version = last.version + 1;
      }
      if (body.processId) await loadProcess(app.db, c, body.processId);
      const name = documentName(body.docDate, body.category, contact?.name ?? '', body.summary);
      const [row] = await app.db.insert(s.contractDocuments).values({ tenantId: auth.tenantId, contractId: c.id, processId: body.processId ?? null, groupId, version, category: body.category, name, docDate: body.docDate, summary: body.summary, mime: body.mime, size: data.length, sha256: createHash('sha256').update(data).digest('hex'), data, signed: body.signed, restrictedTo: body.restrictedTo, folder: c.stage === 'arquivado' ? 'Encerrados' : 'Ativos', uploadedBy: auth.userId }).returning({ id: s.contractDocuments.id });
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'documento', `Documento ${version > 1 ? `nova versão (v${version}) ` : ''}enviado: ${name}${body.signed ? ' (assinado)' : ''}${body.restrictedTo.length ? ` · restrito a ${body.restrictedTo.map((x) => SECTOR_LABELS[x]).join(', ')}` : ''}`, { documentId: row!.id, category: body.category, version });
      await audit(app.db, req, { action: 'contract.document', entityType: 'contract', entityId: c.id, metadata: { name, version } });
      reply.code(201);
      return { id: row!.id, name, version };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/contracts/:id/documents/:docId/download',
    summary: 'Baixa o documento (registra o acesso na auditoria)',
    tag: 'Contratos',
    module: 'contratos',
    params: DocP,
    handler: async ({ app, auth, params, req, reply }) => {
      const c = await loadContract(app.db, auth, params.id);
      const [d] = await app.db.select().from(s.contractDocuments).where(and(eq(s.contractDocuments.id, params.docId), eq(s.contractDocuments.contractId, c.id), isNull(s.contractDocuments.deletedAt))).limit(1);
      if (!d) throw notFound('Documento não encontrado.');
      if (!canOpenDoc(auth, c, d.restrictedTo)) throw forbidden('Documento restrito a outro setor.');
      await audit(app.db, req, { action: 'contract.document.download', entityType: 'contract', entityId: c.id, metadata: { documentId: d.id } });
      const ext = d.mime === 'application/pdf' ? 'pdf' : d.mime === 'image/png' ? 'png' : d.mime === 'image/jpeg' ? 'jpg' : 'docx';
      return reply.header('content-type', d.mime).header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${d.name}.${ext}`)}`).send(d.data);
    },
  }),
  defineRoute({
    method: 'PATCH',
    url: '/contracts/:id/documents/:docId',
    summary: 'Muda pasta (Ativos/Encerrados), restrição por setor ou marca como assinado',
    tag: 'Contratos',
    module: 'contratos',
    params: DocP,
    body: z.object({ folder: z.enum(['Ativos', 'Encerrados']).optional(), restrictedTo: z.array(z.enum(SECTORS)).max(8).optional(), signed: z.boolean().optional() }),
    handler: async ({ app, auth, params, body }) => {
      const c = await loadContract(app.db, auth, params.id);
      const [d] = await app.db.select().from(s.contractDocuments).where(and(eq(s.contractDocuments.id, params.docId), eq(s.contractDocuments.contractId, c.id), isNull(s.contractDocuments.deletedAt))).limit(1);
      if (!d) throw notFound('Documento não encontrado.');
      if (!(isAdmin(auth) || hasSector(auth, ['administracao', 'inteligencia_comercial', 'juridico']) || d.uploadedBy === auth.userId)) throw forbidden();
      await app.db.update(s.contractDocuments).set(body).where(eq(s.contractDocuments.id, d.id));
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'documento', `Documento ${d.name}: ${[body.folder && `pasta ${body.folder}`, body.restrictedTo && (body.restrictedTo.length ? `restrito a ${body.restrictedTo.map((x) => SECTOR_LABELS[x]).join(', ')}` : 'acesso liberado'), body.signed !== undefined && (body.signed ? 'marcado como assinado' : 'desmarcado como assinado')].filter(Boolean).join('; ')}`, { documentId: d.id });
      return { ok: true };
    },
  }),
  defineRoute({
    method: 'DELETE',
    url: '/contracts/:id/documents/:docId',
    summary: 'Remove o documento da lista (fica guardado e registrado no histórico)',
    tag: 'Contratos',
    module: 'contratos',
    params: DocP,
    handler: async ({ app, auth, params, req }) => {
      const c = await loadContract(app.db, auth, params.id);
      const [d] = await app.db.select({ id: s.contractDocuments.id, name: s.contractDocuments.name, uploadedBy: s.contractDocuments.uploadedBy }).from(s.contractDocuments).where(and(eq(s.contractDocuments.id, params.docId), eq(s.contractDocuments.contractId, c.id), isNull(s.contractDocuments.deletedAt))).limit(1);
      if (!d) throw notFound('Documento não encontrado.');
      if (!(isAdmin(auth) || hasSector(auth, ['administracao']) || d.uploadedBy === auth.userId)) throw forbidden();
      await app.db.update(s.contractDocuments).set({ deletedAt: new Date(), deletedBy: auth.userId }).where(eq(s.contractDocuments.id, d.id));
      await addEvent(app.db, auth.tenantId, c.id, auth.userId, 'documento', `Documento removido da lista: ${d.name}`, { documentId: d.id });
      await audit(app.db, req, { action: 'contract.document.delete', entityType: 'contract', entityId: c.id, metadata: { documentId: d.id } });
      return { ok: true };
    },
  }),

  // ------------------------------------------------------------------ linha do tempo
  defineRoute({
    method: 'GET',
    url: '/contracts/:id/timeline',
    summary: 'Linha do tempo única do contrato: tudo o que aconteceu, por assunto, com críticos em destaque e próximos prazos',
    tag: 'Contratos',
    module: 'contratos',
    params: z.object({ id: z.string().uuid() }),
    handler: async ({ app, auth, params }) => {
      const c = await loadContract(app.db, auth, params.id);
      const today = new Date().toISOString().slice(0, 10);
      const T = auth.tenantId;
      const events = await app.db.select({ id: s.contractEvents.id, type: s.contractEvents.type, summary: s.contractEvents.summary, payload: s.contractEvents.payload, at: s.contractEvents.occurredAt, actor: s.users.name }).from(s.contractEvents).leftJoin(s.users, eq(s.users.id, s.contractEvents.actorId)).where(and(eq(s.contractEvents.tenantId, T), eq(s.contractEvents.contractId, c.id))).orderBy(desc(s.contractEvents.occurredAt)).limit(1000);
      const emails = await app.db.select({ id: s.emailMessages.id, kind: s.emailMessages.kind, to: s.emailMessages.toAddress, cc: s.emailMessages.ccAddress, subject: s.emailMessages.subject, status: s.emailMessages.status, error: s.emailMessages.error, at: s.emailMessages.createdAt }).from(s.emailMessages).where(and(eq(s.emailMessages.tenantId, T), eq(s.emailMessages.contractId, c.id))).orderBy(desc(s.emailMessages.createdAt)).limit(300);
      const tasks = await app.db.select({ id: s.activities.id, title: s.activities.title, dueAt: s.activities.dueAt, completedAt: s.activities.completedAt, createdAt: s.activities.createdAt, owner: s.users.name }).from(s.activities).leftJoin(s.users, eq(s.users.id, s.activities.ownerId)).where(and(eq(s.activities.tenantId, T), eq(s.activities.contractId, c.id), isNull(s.activities.deletedAt))).orderBy(desc(s.activities.createdAt)).limit(300);
      const iso = (d: Date | string | null) => (d ? (typeof d === 'string' ? d : d.toISOString()) : null);
      const items = [
        ...events.map((e) => ({ id: `ev-${e.id}`, at: iso(e.at)!, category: timelineCategory(e.type), type: e.type, title: e.summary, sub: e.actor ?? 'Sistema', critical: timelineCritical(e.type, e.payload) })),
        ...emails.map((e) => ({ id: `em-${e.id}`, at: iso(e.at)!, category: 'emails' as const, type: 'email', title: `E-mail “${e.subject}” para ${e.to}${e.cc ? ` (cópia ${e.cc})` : ''}`, sub: e.status === 'enviado' ? 'Enviado' : e.status === 'ignorado' ? 'Não enviado: SMTP não configurado' : `Falhou: ${e.error ?? ''}`, critical: e.status === 'erro' })),
        ...tasks.map((t) => {
          const late = !t.completedAt && !!t.dueAt && iso(t.dueAt)!.slice(0, 10) < today;
          return { id: `ta-${t.id}`, at: iso(t.completedAt) ?? iso(t.createdAt)!, category: 'tarefas' as const, type: 'tarefa', title: `Tarefa: ${t.title}`, sub: `${t.owner ?? ''}${t.dueAt ? ` · prazo ${iso(t.dueAt)!.slice(0, 10).split('-').reverse().join('/')}` : ''}${t.completedAt ? ' · concluída' : late ? ' · atrasada' : ' · aberta'}`, critical: late };
        }),
      ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      const counts = Object.fromEntries(TIMELINE_CATEGORIES.map((k) => [k, items.filter((x) => x.category === k).length]));

      // próximos prazos do contrato
      const v = await currentVersion(app.db, c);
      const up: Upcoming[] = [];
      if (!c.archivedAt) {
        if (v?.endAt) up.push({ kind: 'termino', on: v.endAt, title: `Término da vigência (versão ${v.version})` });
        if (v?.renewalAt) up.push({ kind: 'renovacao', on: v.renewalAt, title: 'Data de renovação' });
      }
      const alerts = await app.db.select({ kind: s.contractAlerts.kind, dueAt: s.contractAlerts.dueAt }).from(s.contractAlerts).where(and(eq(s.contractAlerts.tenantId, T), eq(s.contractAlerts.contractId, c.id), eq(s.contractAlerts.status, 'aberto')));
      for (const a of alerts) if (a.dueAt) up.push({ kind: 'alerta', on: a.dueAt, title: `Alerta: ${ALERT_LABELS[a.kind as AlertKind] ?? a.kind}` });
      const procs = await app.db.select({ kind: s.contractProcesses.kind, dueAt: s.contractProcesses.dueAt }).from(s.contractProcesses).where(and(eq(s.contractProcesses.tenantId, T), eq(s.contractProcesses.contractId, c.id), eq(s.contractProcesses.status, 'aberto')));
      for (const p of procs) if (p.dueAt) up.push({ kind: 'processo', on: p.dueAt, title: `Processo de ${PROCESS_LABELS[p.kind as ProcessKind]?.toLowerCase() ?? p.kind}` });
      const clauses = await app.db.select({ title: s.contractClauses.title, reference: s.contractClauses.reference, deadline: s.contractClauses.deadline }).from(s.contractClauses).where(and(eq(s.contractClauses.tenantId, T), eq(s.contractClauses.contractId, c.id), isNull(s.contractClauses.supersededAt)));
      for (const k of clauses) if (k.deadline && k.deadline >= today) up.push({ kind: 'clausula', on: k.deadline, title: `${k.reference ? (/^cl[aá]usula/i.test(k.reference) ? k.reference : `Cláusula ${k.reference}`) : 'Cláusula'}: ${k.title}` });
      const occ = await app.db.select({ id: s.contractOccurrences.id, title: s.contractOccurrences.title, due: s.contractOccurrences.responseDueAt, last: sql<string | null>`(select u.status from contract_occurrence_updates u where u.occurrence_id = "contract_occurrences"."id" order by u.created_at desc limit 1)` }).from(s.contractOccurrences).where(and(eq(s.contractOccurrences.tenantId, T), eq(s.contractOccurrences.contractId, c.id)));
      for (const o of occ) if (o.due && (!o.last || o.last === 'aberta' || o.last === 'defesa_enviada')) up.push({ kind: 'ocorrencia', on: o.due, title: `Responder ocorrência: ${o.title}` });
      for (const t of tasks) if (!t.completedAt && t.dueAt) up.push({ kind: 'tarefa', on: iso(t.dueAt)!.slice(0, 10), title: t.title });
      const upcoming = upcomingOf(up, today).slice(0, 12);
      return { items, counts, upcoming, today, events, emails, tasks };
    },
  }),
];

function canOpenDoc(auth: AuthContext, c: ContractRow, restrictedTo: string[]) {
  if (!restrictedTo.length || isAdmin(auth)) return true;
  if (auth.sectors.some((x) => restrictedTo.includes(x))) return true;
  return restrictedTo.includes('comercial') && c.commercialOwnerId === auth.userId;
}

