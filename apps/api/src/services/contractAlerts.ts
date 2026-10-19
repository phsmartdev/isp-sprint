/**
 * Monitoramento diário dos contratos (chamado pelo agendamento e pelo botão "Rodar agora").
 * Cada alerta existe uma vez por contrato + tipo + ciclo (controle de duplicidade no banco).
 * Nada é encerrado sozinho: o sistema avisa, abre o processo e cria tarefas; pessoas validam.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ALERT_LABELS, addDays, daysBetween, dueAlerts, fillSubject, type AlertKind, type ContractStage, type DueAlert } from '@isp/domain';
import type { Config } from '../config';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { addEvent, contractSettingsOf, contractSummary, createTask, mailTo, openProcess, sectorOwners, setStage, userById, type ContractRow } from './contracts';

type Settings = Awaited<ReturnType<typeof contractSettingsOf>>;
const due = (iso: string) => new Date(`${iso}T12:00:00Z`);
const SYSTEM = null;

async function inputFor(db: DbOrTx, c: ContractRow, today: string) {
  const [v] = await db.select().from(s.contractVersions).where(and(eq(s.contractVersions.contractId, c.id), eq(s.contractVersions.version, c.currentVersion))).limit(1);
  const procs = await db.select().from(s.contractProcesses).where(and(eq(s.contractProcesses.contractId, c.id), eq(s.contractProcesses.status, 'aberto')));
  const impl = await db.select({ steps: s.contractProcesses.steps }).from(s.contractProcesses).where(and(eq(s.contractProcesses.contractId, c.id), eq(s.contractProcesses.kind, 'implantacao'))).orderBy(desc(s.contractProcesses.openedAt)).limit(1);
  const [doc] = await db.select({ id: s.contractDocuments.id }).from(s.contractDocuments).where(and(eq(s.contractDocuments.contractId, c.id), eq(s.contractDocuments.category, 'CONTRATO'), eq(s.contractDocuments.signed, true), sql`${s.contractDocuments.deletedAt} is null`)).limit(1);
  const ren = procs.find((p) => p.kind === 'renovacao');
  const asked = ren && (ren.steps.solicitar_aditivo ?? ren.steps.formalizacao);
  const signaturesOpen = ren && asked && (!ren.steps.assinatura_diretoria || !ren.steps.assinatura_cliente);
  return {
    v: v!,
    input: {
      today,
      stage: c.stage as ContractStage,
      endAt: v!.endAt,
      closureExpected: c.closureExpected,
      closureAt: c.closureAt,
      guaranteeExpiresAt: v!.guarantee?.expiresAt ?? null,
      adjustmentBaseDate: v!.adjustmentBaseDate,
      signedAt: v!.signedAt,
      activationAt: v!.activationAt,
      validatedAt: c.validatedAt ? c.validatedAt.toISOString() : null,
      hasSignedContractDoc: !!doc || !!impl[0]?.steps.documento_assinado,
      provisioningDone: !impl[0] || !!impl[0].steps.provisionamento,
      openSignatureSince: signaturesOpen ? (asked as { doneAt: string }).doneAt : null,
    },
  };
}

/** Executa o que cada alerta pede. Devolve responsável, tarefas e e-mails para o registro do alerta. */
async function act(db: DbOrTx, config: Config, c: ContractRow, a: DueAlert, cfg: Settings, today: string) {
  const sum = await contractSummary(db, c, config);
  const client = sum.contact?.name ?? '';
  const days = daysBetween(today, a.dueAt);
  const when = days >= 0 ? `em ${days} dia(s) (${a.dueAt})` : `há ${-days} dia(s) (${a.dueAt})`;
  const tasks: string[] = [];
  const emails: { to: string; status: string; error: string | null }[] = [];
  let owner: string | null = c.commercialOwnerId;
  let detail = '';
  const taskFor = async (people: { id: string }[], title: string, notes: string, dueAt: string, priority: 'media' | 'alta' = 'media') => {
    for (const p of people.slice(0, 5)) tasks.push(await createTask(db, c, p.id, title, notes, due(dueAt), SYSTEM, priority));
    if (people[0]) owner = owner ?? people[0].id;
  };
  const mailPeople = async (people: { email: string }[], kind: string, subject: string, text: string, cc: string | null = null) => {
    for (const p of people) emails.push(await mailTo(db, c, kind, p.email, subject, text, SYSTEM, { cc }));
  };
  const commercial = await sectorOwners(db, c.tenantId, ['comercial'], [c.commercialOwnerId]);
  const ownerUser = await userById(db, c.tenantId, c.commercialOwnerId);
  const csm = await userById(db, c.tenantId, c.csmId);

  switch (a.kind as AlertKind) {
    case 'renovacao': {
      const { process } = await openProcess(db, c, 'renovacao', a.cycleKey, SYSTEM, { previousEndAt: a.cycleKey, kind: c.kind, legalRegime: c.legalRegime }, a.dueAt);
      if (c.stage === 'vigente' || c.stage === 'reajuste') await setStage(db, c, SYSTEM, 'renovacao', `renovação aberta automaticamente (término ${a.dueAt})`);
      const ic = await sectorOwners(db, c.tenantId, ['inteligencia_comercial'], [c.commercialOwnerId]);
      owner = ic[0]?.id ?? c.commercialOwnerId;
      const legal = c.kind === 'publico' ? `\nContrato público (${c.legalRegime}). Verifique a possibilidade de prorrogação e o regime jurídico; a elegibilidade depende de validação responsável.` : '';
      await taskFor(ic, `Renovação: contrato ${sum.v.number} – ${client}`, `O contrato vence ${when}.${legal}\n\n${sum.text}`, addDays(today, 7), 'alta');
      if (c.kind === 'privado') {
        const people = [ownerUser, csm].filter(Boolean) as { id: string; email: string }[];
        await taskFor(people, `Revisar condições para renovação: ${client}`, `Revisão das condições atuais antes da renovação (vence ${when}).\n\n${sum.text}`, addDays(today, 10));
        await mailPeople(people, 'contrato_renovacao', `Renovação contratual – Contrato ${sum.v.number} – ${client}`, `O contrato abaixo vence ${when}. Revise as condições atuais com o cliente e registre a proposta de continuidade no ISP Sprint.\n\n${sum.text}`);
      }
      detail = `Processo de renovação ${process.id.slice(0, 8)} aberto; vence ${when}.`;
      break;
    }
    case 'reajuste': {
      await openProcess(db, c, 'reajuste', a.cycleKey, SYSTEM, { baseDate: sum.v.adjustmentBaseDate, index: sum.v.adjustmentIndex, rule: sum.v.adjustmentRule, currentCents: sum.v.monthlyCents, anniversary: a.cycleKey }, a.dueAt);
      const fin = await sectorOwners(db, c.tenantId, ['financeiro', 'inteligencia_comercial'], [c.commercialOwnerId]);
      await taskFor(fin, `Reajuste: contrato ${sum.v.number} – ${client}`, `Data-base ${a.cycleKey} (${when}). Índice: ${sum.v.adjustmentIndex ?? 'não informado'}.${sum.v.adjustmentRule ? `\nRegra: ${sum.v.adjustmentRule}` : ''}\n\n${sum.text}`, a.dueAt);
      detail = `Reajuste na data-base ${a.cycleKey}.`;
      break;
    }
    case 'garantia': {
      const people = await sectorOwners(db, c.tenantId, ['financeiro'], [c.commercialOwnerId]);
      await taskFor([...(ownerUser ? [ownerUser] : []), ...people.filter((p) => p.id !== ownerUser?.id)], `Garantia/seguro vencendo: ${client}`, `A garantia (${sum.v.guarantee?.type ?? ''} ${sum.v.guarantee?.policy ?? ''}) vence ${when}. Providencie a renovação.\n\n${sum.text}`, addDays(a.dueAt, -7), 'alta');
      detail = `Garantia vence ${when}.`;
      break;
    }
    case 'encerramento_90': {
      const { process } = await openProcess(db, c, 'encerramento', a.cycleKey, SYSTEM, { reason: c.closureReason, closingAt: a.cycleKey }, a.dueAt);
      if (c.stage !== 'encerramento') await setStage(db, c, SYSTEM, 'encerramento', `encerramento previsto para ${a.cycleKey}`);
      const events = await db.select({ summary: s.contractEvents.summary, at: s.contractEvents.occurredAt }).from(s.contractEvents).where(eq(s.contractEvents.contractId, c.id)).orderBy(desc(s.contractEvents.occurredAt)).limit(8);
      const subject = fillSubject(cfg.closureSubject, sum.v.number, client);
      const body = `Encerramento previsto ${when}.\nMotivo: ${c.closureReason ?? 'não informado'}\n\nProvidências: confirmar com o cliente, planejar desmobilização, faturamento final e baixas no ERP.\n\n${sum.text}\n\nHistórico recente:\n${events.map((e) => `- ${e.at.toISOString().slice(0, 10)}: ${e.summary}`).join('\n')}`;
      const fin = cfg.financeEmail ? [{ email: cfg.financeEmail }] : await sectorOwners(db, c.tenantId, ['financeiro'], []);
      await mailPeople([...commercial, ...fin], 'contrato_encerramento', subject, body);
      const steps = { ...process.steps, aviso_90: { doneAt: new Date().toISOString(), doneBy: 'sistema', doneByName: 'Sistema', note: `Aviso enviado: ${emails.map((e) => `${e.to} (${e.status})`).join(', ') || 'sem destinatários'}`, value: null } };
      await db.update(s.contractProcesses).set({ steps }).where(eq(s.contractProcesses.id, process.id));
      detail = `Aviso de 90 dias a Comercial e Financeiro.`;
      break;
    }
    case 'encerramento_30': {
      const subject = `${fillSubject(cfg.closureSubject, sum.v.number, client)} – atualização (30 dias)`;
      const fin = cfg.financeEmail ? [{ email: cfg.financeEmail }] : await sectorOwners(db, c.tenantId, ['financeiro'], []);
      await mailPeople([...commercial, ...fin], 'contrato_encerramento', subject, `Faltam ${days} dia(s) para o encerramento (${a.dueAt}). Valide com Sucesso do Cliente e conclua a desmobilização e o faturamento final.\n\n${sum.text}`);
      const cs = await sectorOwners(db, c.tenantId, ['sucesso_cliente'], [c.csmId, c.commercialOwnerId]);
      const ops = await sectorOwners(db, c.tenantId, ['implantacao'], [c.operationalOwnerId, c.commercialOwnerId]);
      const finU = await sectorOwners(db, c.tenantId, ['financeiro'], [c.commercialOwnerId]);
      await taskFor(cs, `Validar encerramento com Sucesso do Cliente: ${client}`, sum.text, addDays(today, 5), 'alta');
      await taskFor(ops, `Cancelamento/desmobilização: ${client}`, sum.text, addDays(a.dueAt, -3), 'alta');
      await taskFor(finU, `Faturamento final: ${client}`, sum.text, a.dueAt, 'alta');
      detail = 'Atualização de 30 dias, validação e tarefas de desmobilização e faturamento final.';
      break;
    }
    case 'documento_pendente': {
      await taskFor([...(ownerUser ? [ownerUser] : [])], `Anexar contrato assinado: ${client}`, `Contrato validado sem o documento assinado anexado.\n\n${sum.text}`, a.dueAt);
      detail = 'Contrato assinado ainda não anexado.';
      break;
    }
    case 'assinatura': {
      const dir = await sectorOwners(db, c.tenantId, ['diretoria'], [c.commercialOwnerId]);
      await taskFor(dir, `Assinatura pendente: ${client}`, `Há assinaturas pendentes no aditivo/contrato desde ${a.cycleKey}.\n\n${sum.text}`, today, 'alta');
      detail = 'Assinaturas pendentes além do prazo.';
      break;
    }
    case 'provisionamento': {
      const fin = await sectorOwners(db, c.tenantId, ['financeiro'], [c.commercialOwnerId]);
      await taskFor(fin, `Provisionamento de faturamento pendente: ${client}`, sum.text, today, 'alta');
      detail = 'Provisionamento ainda não confirmado pelo Financeiro.';
      break;
    }
    case 'implantacao': {
      const ops = await sectorOwners(db, c.tenantId, ['implantacao'], [c.operationalOwnerId, c.commercialOwnerId]);
      await taskFor(ops, `Implantação atrasada: ${client}`, `Sem ativação técnica registrada.\n\n${sum.text}`, today, 'alta');
      detail = 'Ativação técnica ainda não registrada.';
      break;
    }
  }
  return { owner, tasks, emails, detail };
}

export async function runContractAlerts(db: DbOrTx, config: Config, opts: { tenantId?: string; today?: string } = {}) {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const list = await db.select().from(s.contracts).where(and(sql`${s.contracts.stage} not in ('arquivado','cadastro_validacao')`, opts.tenantId ? eq(s.contracts.tenantId, opts.tenantId) : undefined)).limit(5000);
  const settings = new Map<string, Settings>();
  let created = 0, resolved = 0;
  for (const c of list) {
    const cfg = settings.get(c.tenantId) ?? (await contractSettingsOf(db, c.tenantId));
    settings.set(c.tenantId, cfg);
    const { input } = await inputFor(db, c, today);
    const wanted = dueAlerts(input, cfg);
    const existing = await db.select().from(s.contractAlerts).where(eq(s.contractAlerts.contractId, c.id));
    for (const a of wanted) {
      if (existing.some((e) => e.kind === a.kind && e.cycleKey === a.cycleKey)) continue;
      // reserva o alerta antes de agir: execução simultânea não duplica
      const [row] = await db.insert(s.contractAlerts).values({ tenantId: c.tenantId, contractId: c.id, kind: a.kind, cycleKey: a.cycleKey, dueAt: a.dueAt }).onConflictDoNothing().returning({ id: s.contractAlerts.id });
      if (!row) continue;
      try {
        const r = await act(db, config, c, a, cfg, today);
        await db.update(s.contractAlerts).set({ ownerId: r.owner, activityIds: r.tasks, emails: r.emails, detail: r.detail }).where(eq(s.contractAlerts.id, row.id));
        await addEvent(db, c.tenantId, c.id, null, 'alerta', `Alerta: ${ALERT_LABELS[a.kind]} — ${r.detail}${r.emails.length ? ` E-mails: ${r.emails.map((e) => `${e.to} (${e.status})`).join(', ')}.` : ''}${r.tasks.length ? ` ${r.tasks.length} tarefa(s) criada(s).` : ''}`, { alertId: row.id, kind: a.kind, cycleKey: a.cycleKey, emails: r.emails, tasks: r.tasks });
        created++;
      } catch (e) {
        await db.update(s.contractAlerts).set({ detail: `Falha ao executar: ${(e as Error).message}`.slice(0, 500) }).where(eq(s.contractAlerts.id, row.id));
      }
    }
    // alertas abertos cuja condição deixou de existir (ex.: renovou, anexou documento, registrou ativação)
    const procs = await db.select({ kind: s.contractProcesses.kind, cycleKey: s.contractProcesses.cycleKey, status: s.contractProcesses.status }).from(s.contractProcesses).where(eq(s.contractProcesses.contractId, c.id));
    const cleared = (e: typeof existing[number]) => {
      switch (e.kind as AlertKind) {
        case 'renovacao': return e.cycleKey !== input.endAt || input.closureExpected;
        case 'reajuste': return procs.some((p) => p.kind === 'reajuste' && p.cycleKey === e.cycleKey && p.status !== 'aberto');
        case 'garantia': return e.cycleKey !== input.guaranteeExpiresAt;
        case 'encerramento_90': case 'encerramento_30': return !input.closureExpected;
        case 'documento_pendente': return input.hasSignedContractDoc;
        case 'provisionamento': return input.provisioningDone;
        case 'implantacao': return !!input.activationAt;
        case 'assinatura': return !input.openSignatureSince;
        default: return false;
      }
    };
    const stale = existing.filter((e) => e.status === 'aberto' && cleared(e));
    if (stale.length) {
      await db.update(s.contractAlerts).set({ status: 'concluido', resolvedAt: new Date(), resolution: 'Condição resolvida (verificação automática)' }).where(inArray(s.contractAlerts.id, stale.map((x) => x.id)));
      for (const x of stale) await addEvent(db, c.tenantId, c.id, null, 'alerta_resolvido', `Alerta resolvido: ${ALERT_LABELS[x.kind as AlertKind] ?? x.kind}`, { alertId: x.id });
      resolved += stale.length;
    }
  }
  return { contractAlerts: created, contractAlertsResolved: resolved };
}
