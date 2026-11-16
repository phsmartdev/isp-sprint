/**
 * Demonstrativo da governança do orçamento, brindes e patrocínios: tudo o que acontece no período, numa leitura só.
 * - Orçamento: planejado, aprovado, ajustes do Guardião, comprometido, realizado, pago, saldo, por centro, categoria e mês.
 * - Fluxo de aprovação: o que está em rascunho, enviado, questionado, aprovado e rejeitado.
 * - Brindes: planejado no orçamento, estoque, envios às contas e concessões executadas.
 * - Apoios e patrocínios: solicitado, aprovado, executado e pago (Compliance de brindes).
 * - Controles: pontos de atenção com origem (vencidos, desvios sem justificativa, concessões não planejadas, pendências).
 * Só registros do sistema; o escopo é o que a pessoa pode ver (centros de custo e concessões visíveis).
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { monthlyBrlCents } from '@isp/domain';
import type { AuthContext } from '../http/context';
import type { DbOrTx } from '../db/client';
import * as s from '../db/schema';
import { accountsOf, costCentersOf, quarterNumbers, totals, type Row } from './budget';
import { closingSnapshot } from './budgetClosing';
import { complianceData } from '../routes/giftCompliance';

export type GovScope = 'tudo' | 'orcamento' | 'brindes' | 'patrocinios';
const GIFT_KINDS = ['brinde', 'kit', 'material'];
const SPONSOR_KINDS = ['apoio_evento', 'patrocinio_financeiro', 'patrocinio_produto', 'outro'];

const lastDay = (m: string) => { const [y, mo] = m.split('-').map(Number) as [number, number]; return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };

export function periodMonths(year: number, quarter?: number, month?: number) {
  if (month) return [`${year}-${String(month).padStart(2, '0')}`];
  const qs = quarter ? [quarter] : [1, 2, 3, 4];
  return qs.flatMap((q) => [1, 2, 3].map((i) => `${year}-${String((q - 1) * 3 + i).padStart(2, '0')}`));
}

export async function budgetGovernance(db: DbOrTx, auth: AuthContext, q: { year: number; quarter?: number; month?: number; costCenterId?: string; today: string }) {
  const visible = await costCentersOf(db, auth);
  const ccs = q.costCenterId ? visible.filter((c) => c.id === q.costCenterId) : visible;
  const ids = ccs.map((c) => c.id);
  const months = periodMonths(q.year, q.quarter, q.month);
  const from = `${months[0]}-01`, to = lastDay(months.at(-1)!);
  const quarters = [...new Set(months.map((m) => Math.ceil(Number(m.slice(5)) / 3)))];

  // ------------------------------------------------------------------ orçamento (mesma camada de cálculo da Central)
  const rows: Row[] = (await Promise.all(quarters.map((qq) => quarterNumbers(db, auth.tenantId, q.year, qq, ids)))).flatMap((x) => x.rows).filter((r) => months.includes(r.month));
  const accounts = await accountsOf(db, auth.tenantId);
  const topOf = (id: string) => { const a = accounts.find((x) => x.id === id); return a?.parentId ? accounts.find((x) => x.id === a.parentId) ?? a : a; };
  const snaps = await Promise.all(months.map((m) => closingSnapshot(db, auth.tenantId, m, ids)));
  const flow = { committed: 0, paid: 0, overdueCents: 0, overdueCount: 0, latePayments: 0, charges: 0, excess: 0, guardianUsed: 0, economy: 0 };
  // fluxos do mês somam; vencidos em aberto são uma posição (fotografia), não um fluxo: vale a do mês corrente (ou o último do período)
  for (const sn of snaps) for (const k of ['committed', 'paid', 'latePayments', 'charges', 'excess', 'guardianUsed', 'economy'] as const) flow[k] += Number(sn.total[k]) || 0;
  const nowMonth = q.today.slice(0, 7);
  const posSnap = snaps.filter((sn) => sn.month <= nowMonth).at(-1) ?? null;
  flow.overdueCents = posSnap ? posSnap.total.overdueCents : 0;
  flow.overdueCount = posSnap ? posSnap.total.overdueCount : 0;
  const unplanned = snaps.flatMap((sn) => (sn.unplanned ?? []).map((u) => ({ ...u, month: sn.month })));
  const sectors = ccs.map((c) => {
    const rs = rows.filter((r) => r.cc === c.id);
    const cats = new Map<string, Row[]>();
    for (const r of rs) { const k = topOf(r.account)?.id ?? r.account; cats.set(k, [...(cats.get(k) ?? []), r]); }
    const center = snaps.map((sn) => sn.centers.find((x) => x.id === c.id)).filter(Boolean);
    return {
      costCenter: { id: c.id, code: c.code, name: c.name }, ...totals(rs),
      committed: center.reduce((t, x) => t + (x!.committed ?? 0), 0), paid: center.reduce((t, x) => t + (x!.paid ?? 0), 0),
      categories: [...cats].map(([id, list]) => { const a = accounts.find((x) => x.id === id); const t = totals(list); const dev = t.planned ? Math.round(((t.realized - t.planned) / t.planned) * 1000) / 10 : null; return { accountId: id, code: a?.code ?? '', name: a?.name ?? '', ...t, deviationPct: dev, needsJustification: dev !== null && Math.abs(dev) > 15 }; }).sort((x, y) => x.code.localeCompare(y.code)),
    };
  });
  const series = months.map((m) => { const t = totals(rows.filter((r) => r.month === m)); const sn = snaps.find((x) => x.month === m)!; return { month: m, planned: t.planned, realized: t.realized, committed: sn.total.committed, paid: sn.total.paid }; });

  // fluxo de aprovação dos lançamentos do período
  const lines = ids.length ? await db.select({ id: s.budgetLines.id, state: s.budgetLines.approvalState, amount: s.budgetLines.amountCents, approved: s.budgetLines.approvedCents, giftItemId: s.budgetLines.giftItemId, origin: s.budgetLines.origin, contracted: s.budgetLines.contractedCents, supplierId: s.budgetLines.supplierId, costCenterId: s.budgetLines.costCenterId })
    .from(s.budgetLines).where(and(eq(s.budgetLines.tenantId, auth.tenantId), inArray(s.budgetLines.costCenterId, ids), inArray(s.budgetLines.month, months), isNull(s.budgetLines.deletedAt))) : [];
  const STATES = ['rascunho', 'planejado', 'enviado', 'em_analise', 'questionado', 'em_revisao', 'aprovado', 'aprovado_ressalvas', 'rejeitado'];
  const approval = STATES.map((st) => { const ls = lines.filter((l) => l.state === st); return { state: st, count: ls.length, cents: ls.reduce((t, l) => t + (st.startsWith('aprovado') ? l.approved ?? l.amount : l.amount), 0) }; }).filter((x) => x.count);
  const openQuestions = lines.length ? (await db.select({ n: sql<number>`count(*)::int` }).from(s.budgetQuestions).where(and(inArray(s.budgetQuestions.lineId, lines.map((l) => l.id)), eq(s.budgetQuestions.status, 'aberto'))))[0]?.n ?? 0 : 0;
  const guardian = ids.length ? await db.select({ status: s.budgetAdjustments.status, delta: s.budgetAdjustments.deltaCents, kind: s.budgetAdjustments.kind }).from(s.budgetAdjustments).where(and(eq(s.budgetAdjustments.tenantId, auth.tenantId), inArray(s.budgetAdjustments.costCenterId, ids), inArray(s.budgetAdjustments.month, months))) : [];

  // ------------------------------------------------------------------ brindes
  const giftLines = lines.filter((l) => l.giftItemId);
  const items = await db.select({ stock: s.giftItems.stock, unit: s.giftItems.unitCostCents, min: s.giftItems.minStock, active: s.giftItems.active }).from(s.giftItems).where(eq(s.giftItems.tenantId, auth.tenantId));
  const deliveries = await db.select({ total: s.giftDeliveries.totalCents, contactId: s.giftDeliveries.contactId }).from(s.giftDeliveries).where(and(eq(s.giftDeliveries.tenantId, auth.tenantId), gte(s.giftDeliveries.occurredOn, from), lte(s.giftDeliveries.occurredOn, to), isNull(s.giftDeliveries.cancelledAt)));

  // ------------------------------------------------------------------ concessões (Compliance): só as visíveis para a pessoa
  const comp = await complianceData(db, auth, { from, to });
  const crow = comp.rows.filter((r) => !q.costCenterId || r.costCenterId === q.costCenterId);
  const group = (kinds: string[]) => {
    const rs = crow.filter((r) => kinds.includes(r.kind));
    const ex = rs.filter((r) => r.state === 'executado');
    return {
      requested: { count: rs.filter((r) => r.state === 'solicitado' || r.state === 'ajustes').length, cents: rs.filter((r) => r.state === 'solicitado' || r.state === 'ajustes').reduce((t, r) => t + r.estimatedCents, 0) },
      approved: { count: rs.filter((r) => ['aprovado', 'reservado'].includes(r.state)).length, cents: rs.filter((r) => ['aprovado', 'reservado'].includes(r.state)).reduce((t, r) => t + (r.approvedCents ?? r.estimatedCents), 0) },
      executed: { count: ex.length, cents: ex.reduce((t, r) => t + (r.executedCents ?? 0), 0), accounts: new Set(ex.flatMap((r) => r.accounts.map((a) => a.contactId))).size },
      paid: rs.filter((r) => r.paidCents != null).reduce((t, r) => t + (r.paidCents ?? 0), 0),
      exceptions: ex.filter((r) => r.exception).length,
      rejected: rs.filter((r) => r.state === 'rejeitado').length, cancelled: rs.filter((r) => r.state === 'cancelado').length,
      byKind: kinds.map((k) => ({ kind: k, count: ex.filter((r) => r.kind === k).length, cents: ex.filter((r) => r.kind === k).reduce((t, r) => t + (r.executedCents ?? 0), 0) })).filter((x) => x.count),
      top: Object.values(ex.flatMap((r) => r.accounts.map((a) => ({ id: a.contactId, name: a.name, cents: a.shareCents }))).reduce<Record<string, { id: string; name: string; cents: number; n: number }>>((m, a) => { const c = m[a.id] ?? { id: a.id, name: a.name, cents: 0, n: 0 }; c.cents += a.cents; c.n++; m[a.id] = c; return m; }, {})).sort((a, b) => b.cents - a.cents).slice(0, 5),
    };
  };
  const pendByRow = new Set(comp.pendencies.map((p) => p.requestId));

  // ------------------------------------------------------------------ recursos e fornecedores
  const res = ids.length ? await db.select().from(s.resourceContracts).where(and(inArray(s.resourceContracts.costCenterId, ids), eq(s.resourceContracts.status, 'ativo'))) : [];
  const assets = ids.length ? await db.select({ value: s.resourceAssets.valueCents, status: s.resourceAssets.status }).from(s.resourceAssets).where(inArray(s.resourceAssets.costCenterId, ids)) : [];
  const exps = ids.length ? await db.select({ supplierId: s.budgetExpenses.supplierId, amount: s.budgetExpenses.amountCents, lineId: s.budgetExpenses.lineId }).from(s.budgetExpenses).where(and(eq(s.budgetExpenses.tenantId, auth.tenantId), inArray(s.budgetExpenses.costCenterId, ids), eq(s.budgetExpenses.status, 'valido'), gte(s.budgetExpenses.occurredOn, from), lte(s.budgetExpenses.occurredOn, to))) : [];
  const supTotals = new Map<string, number>();
  for (const l of lines.filter((x) => x.supplierId && x.contracted)) supTotals.set(l.supplierId!, (supTotals.get(l.supplierId!) ?? 0) + l.contracted!);
  const lineSet = new Set(lines.map((l) => l.id));
  for (const e of exps.filter((x) => x.supplierId && !(x.lineId && lineSet.has(x.lineId)))) supTotals.set(e.supplierId!, (supTotals.get(e.supplierId!) ?? 0) + e.amount);
  const supNames = supTotals.size ? await db.select({ id: s.suppliers.id, name: s.suppliers.name }).from(s.suppliers).where(inArray(s.suppliers.id, [...supTotals.keys()])) : [];
  const suppliers = [...supTotals].map(([id, cents]) => ({ id, name: supNames.find((x) => x.id === id)?.name ?? 'Fornecedor', cents })).sort((a, b) => b.cents - a.cents).slice(0, 8);

  // ------------------------------------------------------------------ atividade recente (orçamento e concessões)
  const evB = ids.length ? await db.select({ at: s.budgetEvents.createdAt, summary: s.budgetEvents.summary, action: s.budgetEvents.action, entity: s.budgetEvents.entity, actor: s.users.name, cc: s.budgetEvents.costCenterId }).from(s.budgetEvents).leftJoin(s.users, eq(s.users.id, s.budgetEvents.actorId))
    .where(and(eq(s.budgetEvents.tenantId, auth.tenantId), inArray(s.budgetEvents.costCenterId, ids), sql`(${s.budgetEvents.createdAt} at time zone 'America/Sao_Paulo')::date between ${from} and ${to}`)).orderBy(desc(s.budgetEvents.createdAt)).limit(40) : [];
  const evG = crow.length ? await db.select({ at: s.giftRequestEvents.createdAt, text: s.giftRequestEvents.text, type: s.giftRequestEvents.type, actor: s.users.name, code: s.giftRequests.code }).from(s.giftRequestEvents).innerJoin(s.giftRequests, eq(s.giftRequests.id, s.giftRequestEvents.requestId)).leftJoin(s.users, eq(s.users.id, s.giftRequestEvents.actorId))
    .where(and(inArray(s.giftRequestEvents.requestId, crow.map((r) => r.id)), sql`(${s.giftRequestEvents.createdAt} at time zone 'America/Sao_Paulo')::date between ${from} and ${to}`)).orderBy(desc(s.giftRequestEvents.createdAt)).limit(40) : [];
  const ccCode = (id: string | null) => ccs.find((c) => c.id === id)?.code ?? null;
  const activity = [
    ...evB.map((e) => ({ at: e.at.toISOString(), area: 'orcamento' as const, text: e.summary, who: e.actor, ref: ccCode(e.cc) })),
    ...evG.map((e) => ({ at: e.at.toISOString(), area: 'concessao' as const, text: e.text, who: e.actor, ref: e.code })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);

  // ------------------------------------------------------------------ pontos de atenção (cada um com a origem)
  const t = totals(rows);
  const attention: { level: 'alta' | 'media'; area: string; text: string }[] = [];
  if (flow.overdueCount) attention.push({ level: 'alta', area: 'Financeiro', text: `${flow.overdueCount} pagamento(s) vencido(s) em aberto: ${(flow.overdueCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` });
  const needJust = sectors.flatMap((sc) => sc.categories.filter((c) => c.needsJustification).map((c) => `${sc.costCenter.code} · ${c.name} (${c.deviationPct! > 0 ? '+' : ''}${c.deviationPct}%)`));
  if (needJust.length) attention.push({ level: 'media', area: 'Orçamento', text: `Desvio acima de 15% entre realizado e planejado: ${needJust.slice(0, 6).join('; ')}${needJust.length > 6 ? '…' : ''}.` });
  if (unplanned.length) attention.push({ level: 'media', area: 'Orçamento', text: `${unplanned.length} concessão(ões) não planejada(s) lançada(s) no orçamento: ${(unplanned.reduce((x, u) => x + u.amountCents, 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` });
  const waiting = lines.filter((l) => ['enviado', 'em_analise', 'questionado'].includes(l.state));
  if (waiting.length) attention.push({ level: 'media', area: 'Aprovação', text: `${waiting.length} lançamento(s) aguardando decisão${openQuestions ? `, ${openQuestions} questionamento(s) em aberto` : ''}.` });
  const gPending = guardian.filter((g) => g.status === 'pendente');
  if (gPending.length) attention.push({ level: 'media', area: 'Budget Guardião', text: `${gPending.length} pedido(s) de ajuste aguardando a Diretoria.` });
  if (flow.excess) attention.push({ level: 'media', area: 'Budget Guardião', text: `Excedentes autorizados no período: ${(flow.excess / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` });
  if (comp.pendencies.length) attention.push({ level: 'alta', area: 'Compliance', text: `${comp.pendencies.length} pendência(s) de controle nas concessões (${[...new Set(comp.pendencies.map((p) => p.text.split(' (')[0]))].slice(0, 3).join('; ')}).` });
  const exc = crow.filter((r) => r.state === 'executado' && r.exception).length;
  if (exc) attention.push({ level: 'media', area: 'Compliance', text: `${exc} concessão(ões) executada(s) por aprovação excepcional.` });
  const noVault = res.filter((r) => r.kind === 'software' && !r.vaultRegistered).length;
  if (noVault) attention.push({ level: 'media', area: 'Recursos', text: `${noVault} licença(s) de software sem registro no cofre de senhas (Vault).` });
  const lowStock = items.filter((i) => i.active && i.min > 0 && i.stock < i.min).length;
  if (lowStock) attention.push({ level: 'media', area: 'Brindes', text: `${lowStock} brinde(s) abaixo do estoque mínimo.` });
  if (t.over || (t.pct ?? 0) > 100) attention.push({ level: 'alta', area: 'Orçamento', text: 'Realizado acima do planejado no período.' });

  return {
    period: { year: q.year, quarter: q.quarter ?? null, month: q.month ?? null, from, to, months },
    costCenters: visible.map((c) => ({ id: c.id, code: c.code, name: c.name })),
    budget: { ...t, ...flow, pendingApproval: waiting.reduce((x, l) => x + l.amount, 0), openQuestions, guardian: { pending: gPending.length, approvedCents: guardian.filter((g) => g.status === 'aprovado' || g.status === 'registrado').reduce((x, g) => x + g.delta, 0) } },
    approval, series, sectors, unplanned,
    gifts: {
      plannedCents: giftLines.reduce((x, l) => x + l.amount, 0), approvedCents: giftLines.filter((l) => l.state.startsWith('aprovado')).reduce((x, l) => x + (l.approved ?? 0), 0), purchasedCents: giftLines.reduce((x, l) => x + (l.contracted ?? 0), 0),
      stockCents: items.reduce((x, i) => x + i.stock * i.unit, 0), lowStock,
      deliveries: { count: deliveries.length, cents: deliveries.reduce((x, d) => x + d.total, 0), accounts: new Set(deliveries.map((d) => d.contactId).filter(Boolean)).size },
      concessions: group(GIFT_KINDS),
    },
    sponsorships: group(SPONSOR_KINDS),
    compliance: { ...comp.kpis, pendencies: comp.pendencies.length, withPendency: crow.filter((r) => pendByRow.has(r.id)).length },
    resources: { recurring: res.length, monthlyCents: res.reduce((x, r) => x + monthlyBrlCents({ amountCents: r.amountCents, currency: r.currency as 'BRL', fxRate: r.fxRate, period: r.period as 'mensal' }), 0), withoutVault: noVault, assets: assets.filter((a) => a.status !== 'baixado').length, assetsCents: assets.filter((a) => a.status !== 'baixado').reduce((x, a) => x + a.value, 0) },
    suppliers, activity, attention,
  };
}
