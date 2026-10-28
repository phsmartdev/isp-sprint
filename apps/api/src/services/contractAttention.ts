/**
 * Central de atenção dos contratos: tudo o que pede ação, de todas as fontes, numa fila só,
 * ordenada por gravidade, atraso, prazo e valor em jogo. Também o resumo diário por e-mail.
 */
import { and, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  ALERT_BASE_LEVEL, ALERT_LABELS, ATTENTION_LEVEL_LABELS, PROCESS_LABELS,
  addDays, annualValueCents, attentionLevel, certificateDue, attentionScore, daysBetween, revenueAtRisk,
  type AlertKind, type AttentionLevel, type ProcessKind,
} from '@isp/domain';
import type { Config } from '../config';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { publicLink } from './alerts';
import { brl, sendAlert, smtpConfig, tenantName } from './email';
import { contractSettingsOf, usersBySector } from './contracts';

export type AttentionSource = 'notificacao' | 'processo' | 'validacao' | 'execucao';
export const SOURCE_LABELS: Record<AttentionSource, string> = { notificacao: 'Notificação', processo: 'Processo atrasado', validacao: 'Validação do cadastro', execucao: 'Execução (SLA, ocorrências, cláusulas, atestados)' };
export type AttentionItem = {
  key: string; source: AttentionSource; kind: string; kindLabel: string; level: AttentionLevel; score: number;
  title: string; detail: string | null; dueAt: string | null; daysLeft: number | null; valueCents: number;
  contractId: string | null; contractCode: number | null; contractNumber: string | null; clientName: string | null;
  ownerId: string | null; ownerName: string | null; commercialOwnerId: string | null; alertId: string | null; href: string;
};

/** Gestão que vê a carteira inteira e recebe o resumo completo. */
export const PORTFOLIO_SECTORS = ['inteligencia_comercial', 'diretoria', 'administracao'] as const;
const VALIDATION_SLA_DAYS = 2;
const PROCESS_ALERT: Record<ProcessKind, AlertKind[]> = { renovacao: ['renovacao'], reajuste: ['reajuste'], encerramento: ['encerramento_90', 'encerramento_30'], implantacao: ['implantacao', 'provisionamento', 'documento_pendente'] };

const v = s.contractVersions;
const commercial = alias(s.users, 'att_commercial');

export async function attentionItems(db: DbOrTx, tenantId: string, scope: SQL, today: string) {
  const contracts = await db
    .select({ id: s.contracts.id, code: s.contracts.code, stage: s.contracts.stage, kind: s.contracts.kind, createdAt: s.contracts.createdAt, commercialOwnerId: s.contracts.commercialOwnerId, ownerName: commercial.name, number: v.number, monthlyCents: v.monthlyCents, totalCents: v.totalCents, termMonths: v.termMonths, clientName: s.contacts.name })
    .from(s.contracts)
    .innerJoin(v, and(eq(v.contractId, s.contracts.id), eq(v.version, s.contracts.currentVersion)))
    .innerJoin(s.contacts, eq(s.contacts.id, s.contracts.contactId))
    .leftJoin(commercial, eq(commercial.id, s.contracts.commercialOwnerId))
    .where(and(scope, sql`${s.contracts.stage} <> 'arquivado'`));
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const ids = contracts.map((c) => c.id);
  const items: AttentionItem[] = [];
  const base = (c: (typeof contracts)[number]) => ({ contractId: c.id, contractCode: c.code, contractNumber: c.number, clientName: c.clientName, commercialOwnerId: c.commercialOwnerId, valueCents: annualValueCents(c) });
  const push = (x: Omit<AttentionItem, 'score' | 'daysLeft' | 'level'> & { base: AttentionLevel }) => {
    const level = attentionLevel(x.base, x.dueAt, today);
    const { base: _b, ...rest } = x;
    items.push({ ...rest, level, daysLeft: x.dueAt ? daysBetween(today, x.dueAt) : null, score: attentionScore(level, x.dueAt, today, x.valueCents) });
  };

  if (ids.length) {
    const resp = alias(s.users, 'att_alert_owner');
    const alerts = await db.select({ id: s.contractAlerts.id, contractId: s.contractAlerts.contractId, kind: s.contractAlerts.kind, dueAt: s.contractAlerts.dueAt, detail: s.contractAlerts.detail, ownerId: s.contractAlerts.ownerId, ownerName: resp.name })
      .from(s.contractAlerts).leftJoin(resp, eq(resp.id, s.contractAlerts.ownerId))
      .where(and(inArray(s.contractAlerts.contractId, ids), eq(s.contractAlerts.status, 'aberto')));
    for (const a of alerts) {
      const c = byId.get(a.contractId)!;
      const kind = a.kind as AlertKind;
      push({
        key: `alerta:${a.id}`, source: 'notificacao', kind, kindLabel: ALERT_LABELS[kind] ?? kind, base: ALERT_BASE_LEVEL[kind] ?? 'media',
        title: `${ALERT_LABELS[kind] ?? kind}: ${c.clientName}`, detail: a.detail || null, dueAt: a.dueAt,
        ownerId: a.ownerId ?? c.commercialOwnerId, ownerName: a.ownerName ?? c.ownerName, alertId: a.id, href: `/contracts/${c.id}?aba=notificacoes`, ...base(c),
      });
    }
    // processos atrasados que não têm notificação aberta do mesmo assunto (sem duplicar a fila)
    const procs = await db.select({ id: s.contractProcesses.id, contractId: s.contractProcesses.contractId, kind: s.contractProcesses.kind, dueAt: s.contractProcesses.dueAt, ownerId: s.contractProcesses.ownerId })
      .from(s.contractProcesses).where(and(inArray(s.contractProcesses.contractId, ids), eq(s.contractProcesses.status, 'aberto'), lt(s.contractProcesses.dueAt, today)));
    for (const p of procs) {
      const kind = p.kind as ProcessKind;
      if (alerts.some((a) => a.contractId === p.contractId && PROCESS_ALERT[kind]?.includes(a.kind as AlertKind))) continue;
      const c = byId.get(p.contractId)!;
      push({
        key: `processo:${p.id}`, source: 'processo', kind: `processo_${kind}`, kindLabel: `${PROCESS_LABELS[kind]} atrasada`, base: kind === 'renovacao' || kind === 'encerramento' ? 'alta' : 'media',
        title: `${PROCESS_LABELS[kind]} atrasada: ${c.clientName}`, detail: 'Etapas do processo em aberto depois do prazo.', dueAt: p.dueAt,
        ownerId: p.ownerId ?? c.commercialOwnerId, ownerName: c.ownerName, alertId: null, href: `/contracts/${c.id}?aba=processos`, ...base(c),
      });
    }
    // execução: ocorrências abertas com prazo de resposta, SLA violado no último mês medido, cláusulas com prazo e atestado a pedir
    const live = contracts.filter((x) => x.stage !== 'cadastro_validacao');
    const liveIds = live.map((x) => x.id);
    if (liveIds.length) {
      const occ = await db.execute<{ id: string; contract_id: string; title: string; kind: string; response_due_at: string | null; owner_id: string | null; owner: string | null; status: string | null }>(sql`
        select o.id, o.contract_id, o.title, o.kind, o.response_due_at, o.owner_id, u.name owner,
               (select x.status from contract_occurrence_updates x where x.occurrence_id = o.id order by x.created_at desc limit 1) status
          from contract_occurrences o left join users u on u.id = o.owner_id where o.contract_id in ${liveIds}`);
      for (const o of occ.rows) {
        const st = o.status ?? 'aberta';
        if (!['aberta', 'defesa_enviada'].includes(st)) continue;
        const c = byId.get(o.contract_id)!;
        const due = o.response_due_at ? String(o.response_due_at).slice(0, 10) : null;
        push({ key: `ocorrencia:${o.id}`, source: 'execucao', kind: 'ocorrencia', kindLabel: st === 'defesa_enviada' ? 'Ocorrência aguardando o órgão' : 'Ocorrência aberta', base: ['multa', 'glosa', 'notificacao_orgao'].includes(o.kind) && st === 'aberta' ? 'alta' : 'media',
          title: `${o.title}: ${c.clientName}`, detail: due ? `Resposta ao órgão até ${due}.` : null, dueAt: due ?? today, ownerId: o.owner_id ?? c.commercialOwnerId, ownerName: o.owner ?? c.ownerName, alertId: null, href: `/contracts/${c.id}?aba=execucao`, ...base(c) });
      }
      const sla = await db.execute<{ contract_id: string; label: string; target: number; unit: string; direction: string; period: string; value: number }>(sql`
        select distinct on (m.sla_id) m.contract_id, s.label, s.target, s.unit, s.direction, m.period, m.value
          from contract_sla_measurements m join contract_slas s on s.id = m.sla_id
         where m.contract_id in ${liveIds} and m.superseded_at is null and s.superseded_at is null order by m.sla_id, m.period desc`);
      for (const m of sla.rows) {
        const ok = m.direction === 'maior' ? Number(m.value) >= Number(m.target) : Number(m.value) <= Number(m.target);
        if (ok) continue;
        const c = byId.get(m.contract_id)!;
        push({ key: `sla:${m.contract_id}:${m.label}:${m.period}`, source: 'execucao', kind: 'sla_violado', kindLabel: 'SLA violado', base: 'alta', title: `SLA ${m.label} violado em ${m.period}: ${c.clientName}`,
          detail: `Realizado ${m.value}${m.unit}, meta ${m.direction === 'maior' ? '≥' : '≤'} ${m.target}${m.unit}. Verifique multa/glosa e o plano de ação.`, dueAt: addDays(today, 7), ownerId: c.commercialOwnerId, ownerName: c.ownerName, alertId: null, href: `/contracts/${c.id}?aba=execucao`, ...base(c) });
      }
      const cl = await db.execute<{ id: string; contract_id: string; title: string; reference: string | null; deadline: string; remind_days: number }>(sql`
        select id, contract_id, title, reference, deadline, remind_days from contract_clauses where contract_id in ${liveIds} and superseded_at is null and deadline is not null and deadline - remind_days <= ${today}::date and deadline >= ${addDays(today, -30)}::date`);
      for (const x of cl.rows) {
        const c = byId.get(x.contract_id)!;
        const due = String(x.deadline).slice(0, 10);
        push({ key: `clausula:${x.id}`, source: 'execucao', kind: 'clausula', kindLabel: 'Prazo de cláusula', base: 'media', title: `${x.reference ? `${x.reference} · ` : ''}${x.title}: ${c.clientName}`, detail: `Prazo da cláusula em ${due}.`, dueAt: due, ownerId: c.commercialOwnerId, ownerName: c.ownerName, alertId: null, href: `/contracts/${c.id}?aba=execucao`, ...base(c) });
      }
      const certs = await db.execute<{ contract_id: string; start_at: string | null; end_at: string | null; received: boolean; requested: boolean }>(sql`
        select c.id contract_id, v.start_at, v.end_at,
               exists (select 1 from technical_certificates t where t.contract_id = c.id and t.status = 'recebido') received,
               exists (select 1 from technical_certificates t where t.contract_id = c.id and t.status = 'solicitado' and t.superseded_at is null) requested
          from contracts c join contract_versions v on v.contract_id = c.id and v.version = c.current_version where c.id in ${liveIds}`);
      for (const r of certs.rows) {
        const due = certificateDue({ startAt: r.start_at ? String(r.start_at).slice(0, 10) : null, endAt: r.end_at ? String(r.end_at).slice(0, 10) : null, hasReceived: r.received, hasRequested: r.requested }, today);
        if (!due) continue;
        const c = byId.get(r.contract_id)!;
        push({ key: `atestado:${c.id}`, source: 'execucao', kind: 'atestado', kindLabel: r.requested ? 'Atestado pedido, sem retorno' : 'Pedir atestado de capacidade técnica', base: due.stage === 'fim' ? 'alta' : 'media',
          title: `Atestado de capacidade técnica: ${c.clientName}`, detail: r.requested ? 'Atestado já pedido ao cliente; cobre o retorno.' : due.stage === 'fim' ? 'Contrato perto do fim sem atestado: peça antes do encerramento.' : 'Metade da vigência cumprida: já dá para pedir o atestado.', dueAt: due.dueAt,
          ownerId: c.commercialOwnerId, ownerName: c.ownerName, alertId: null, href: `/contracts/${c.id}?aba=execucao`, ...base(c) });
      }
    }
    for (const c of contracts.filter((x) => x.stage === 'cadastro_validacao')) {
      const created = c.createdAt.toISOString().slice(0, 10);
      const dueAt = addDays(created, VALIDATION_SLA_DAYS);
      if (dueAt > addDays(today, 1)) continue;
      push({
        key: `validacao:${c.id}`, source: 'validacao', kind: 'validacao', kindLabel: 'Cadastro aguardando validação', base: 'media',
        title: `Cadastro aguardando validação: ${c.clientName}`, detail: `Cadastrado em ${created}. Sem validação o contrato não gera alertas nem entra na carteira.`, dueAt,
        ownerId: c.commercialOwnerId, ownerName: c.ownerName, alertId: null, href: `/contracts/${c.id}`, ...base(c),
      });
    }
  }

  return items.sort((a, b) => b.score - a.score);
}

export function attentionSummary(items: AttentionItem[]) {
  const count = (l: AttentionLevel) => items.filter((x) => x.level === l).length;
  const contracts = new Set(items.filter((x) => x.contractId).map((x) => x.contractId));
  const valueAtStake = [...contracts].reduce((t, id) => t + (items.find((x) => x.contractId === id)?.valueCents ?? 0), 0);
  const bySource = (Object.keys(SOURCE_LABELS) as AttentionSource[]).map((k) => ({ key: k, label: SOURCE_LABELS[k], n: items.filter((x) => x.source === k).length })).filter((x) => x.n);
  return { total: items.length, critica: count('critica'), alta: count('alta'), media: count('media'), overdue: items.filter((x) => (x.daysLeft ?? 0) < 0).length, contracts: contracts.size, valueAtStakeCents: valueAtStake, bySource };
}

/** Receita em risco em 90 dias da empresa (para o resumo diário). */
async function riskOf(db: DbOrTx, tenantId: string, today: string) {
  const rows = await db.select({ id: s.contracts.id, endAt: v.endAt, closureExpected: s.contracts.closureExpected, closureAt: s.contracts.closureAt, monthlyCents: v.monthlyCents, totalCents: v.totalCents, termMonths: v.termMonths })
    .from(s.contracts).innerJoin(v, and(eq(v.contractId, s.contracts.id), eq(v.version, s.contracts.currentVersion)))
    .where(and(eq(s.contracts.tenantId, tenantId), sql`${s.contracts.stage} not in ('arquivado','cadastro_validacao')`));
  const done = await db.select({ contractId: s.contractProcesses.contractId, cycleKey: s.contractProcesses.cycleKey }).from(s.contractProcesses).where(and(eq(s.contractProcesses.tenantId, tenantId), eq(s.contractProcesses.kind, 'renovacao'), eq(s.contractProcesses.status, 'concluido')));
  return revenueAtRisk(rows.map((r) => ({ ...r, renewed: done.some((p) => p.contractId === r.id && p.cycleKey === r.endAt), annualCents: annualValueCents(r) })), today, [90])[0]!;
}

const line = (x: AttentionItem) => `• [${ATTENTION_LEVEL_LABELS[x.level]}] ${x.title}${x.daysLeft === null ? '' : x.daysLeft < 0 ? ` — atrasado ${-x.daysLeft} dia(s)` : x.daysLeft === 0 ? ' — vence hoje' : ` — em ${x.daysLeft} dia(s)`}${x.valueCents ? ` · ${brl(x.valueCents)}/ano` : ''}`;

/**
 * Resumo diário: cada pessoa recebe o que está com ela; a gestão da carteira recebe o quadro geral.
 * Um e-mail por pessoa por dia (controle no banco), só quando há algo para fazer.
 */
export async function sendContractDigests(db: DbOrTx, config: Config, opts: { tenantId?: string; today?: string } = {}) {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const tenants = opts.tenantId ? [{ id: opts.tenantId }] : await db.select({ id: s.tenants.id }).from(s.tenants);
  let sent = 0, skipped = 0;
  for (const t of tenants) {
    const cfg = await contractSettingsOf(db, t.id);
    if (cfg.dailyDigest === false || !(await smtpConfig(db, t.id))) continue;
    const items = await attentionItems(db, t.id, eq(s.contracts.tenantId, t.id), today);
    if (!items.length) continue;
    const managers = await usersBySector(db, t.id, PORTFOLIO_SECTORS);
    const users = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.users).where(and(eq(s.users.tenantId, t.id), eq(s.users.active, true)));
    const risk = await riskOf(db, t.id, today);
    const company = await tenantName(db, t.id);
    for (const u of users) {
      const manager = managers.some((m) => m.id === u.id);
      const mine = items.filter((x) => x.ownerId === u.id || x.commercialOwnerId === u.id);
      const list = manager ? items : mine;
      if (!list.length) continue;
      const [slot] = await db.insert(s.contractDigests).values({ tenantId: t.id, userId: u.id, day: today, items: list.length, status: 'enviando' }).onConflictDoNothing().returning({ id: s.contractDigests.id });
      if (!slot) { skipped++; continue; }
      const sum = attentionSummary(list);
      const top = list.filter((x) => x.level !== 'media').slice(0, 20);
      const rest = list.length - top.length;
      const text = [
        `Olá, ${u.name.split(' ')[0]}.`,
        '',
        manager ? `Central de atenção dos contratos de ${company} hoje:` : 'O que está com você na gestão de contratos hoje:',
        `${sum.critica} crítico(s) · ${sum.alta} alto(s) · ${sum.media} de atenção · ${sum.overdue} atrasado(s).`,
        manager && risk.n ? `Receita em risco em 90 dias: ${brl(risk.monthlyCents)}/mês (${risk.n} contrato(s) sem renovação concluída).` : null,
        '',
        ...(top.length ? top.map(line) : list.slice(0, 10).map(line)),
        rest > 0 && top.length ? `… e mais ${rest} item(ns) de atenção.` : null,
        '',
        `Abrir a central: ${publicLink(config, '/contracts?t=atencao')}`,
      ].filter((x) => x !== null).join('\n');
      const r = await sendAlert(db, { tenantId: t.id, kind: 'resumo_contratos', to: u.email, subject: `Contratos: ${sum.critica ? `${sum.critica} crítico(s), ` : ''}${sum.total} item(ns) pedem ação hoje`, text });
      await db.update(s.contractDigests).set({ status: r?.ok ? 'enviado' : 'falhou' }).where(eq(s.contractDigests.id, slot.id));
      if (r?.ok) sent++;
    }
  }
  return { sent, skipped };
}
