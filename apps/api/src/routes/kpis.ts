/**
 * Indicadores principais da área (Inteligência): fichas de KPI importadas do formulário .xlsx,
 * metas desdobradas por trimestre, resultado informado por competência e farol de atingimento.
 * Os KPIs vivem no mesmo cadastro de indicadores da Gestão de Resultados (sem registro paralelo).
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { SEGMENT_LABELS, contractAcv, aggregate, kpiAttainment, kpiStatus, kpiTarget, parseKpiForm, type IndicatorDef, type KpiStatus } from '@isp/domain';
import { defineRoute, IdParams } from '../http/route';
import { forbidden, notFound, unprocessable } from '../http/errors';
import * as s from '../db/schema';
import { audit } from '../services/audit';
import { allIndicators, indicatorDef, indicatorEntriesOf } from '../services/indicators';
import { level } from '../services/scope';
import { todayLocal } from '../services/projects';
import { excelDate, readXlsx } from '../services/xlsx';
import { clearKpiDemo, loadKpiDemo } from '../services/kpiDemo';
import type { AuthContext } from '../http/context';

const canEnter = (auth: AuthContext) => level(auth, 'configuracoes') === 'total' || level(auth, 'inteligencia') === 'total' || auth.sectors.some((x) => x === 'inteligencia_comercial' || x === 'diretoria');
const canImport = (auth: AuthContext) => level(auth, 'configuracoes') === 'total';
const PERIOD = /^(\d{4})-(0[1-9]|1[0-2]|T[1-4])$/;
const periodStart = (p: string) => { const [, y, m] = p.match(PERIOD)!; return m!.startsWith('T') ? `${y}-${String((Number(m![1]) - 1) * 3 + 1).padStart(2, '0')}-01` : `${y}-${m}-01`; };
const quarterOf = (iso: string) => Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;

export const SheetSchema = z.object({
  area: z.string().max(200).nullable(), objective: z.string().max(2000).nullable(), formulaText: z.string().max(1000).nullable(), sourceSystem: z.string().max(200).nullable(),
  owner: z.string().max(200).nullable(), collector: z.string().max(200).nullable(), tool: z.string().max(200).nullable(), measureFreq: z.enum(['mes', 'trimestre']),
  reviewFreq: z.string().max(100).nullable(), audience: z.string().max(300).nullable(), strategicObjective: z.string().max(1000).nullable(), process: z.string().max(300).nullable(),
  impact: z.string().max(1000).nullable(), related: z.string().max(500).nullable(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), notes: z.string().max(5000).nullable(),
  quarterTargets: z.array(z.number().nullable()).length(4), minAcceptable: z.number().nullable(), minOfTarget: z.number().min(0).max(1).nullable(), maxDesirable: z.number().nullable(),
  aggregation: z.enum(['media', 'ultimo', 'soma']), featured: z.boolean(), paused: z.boolean(), main: z.boolean().optional(),
});
const KpiDefSchema = z.object({
  name: z.string().trim().min(3).max(120), description: z.string().max(1000).optional(), category: z.string().max(40), calc: z.literal('informado'),
  unit: z.enum(['quantidade', 'reais', 'percentual', 'horas', 'dias', 'minutos', 'indice']), direction: z.enum(['maior', 'menor']), period: z.enum(['mes', 'trimestre']),
  target: z.number().nullable(), sheet: SheetSchema,
});

/** Placar de um KPI no ano: meta e resultado de cada trimestre (e dos meses, quando mensal) e do ano. */
function board(def: IndicatorDef, entries: { period: string; periodStart: string; value: number; createdAt: Date; note: string | null }[], year: number, today: string) {
  const curQ = Number(today.slice(0, 4)) === year ? quarterOf(today) : year < Number(today.slice(0, 4)) ? 5 : 0;
  const inYear = entries.filter((e) => e.periodStart.startsWith(`${year}-`));
  const agg = def.sheet?.aggregation ?? 'media';
  const quarters = [1, 2, 3, 4].map((q) => {
    const list = inYear.filter((e) => quarterOf(e.periodStart) === q);
    const value = aggregate(list.map((e) => e.value), agg);
    const target = kpiTarget(def, q);
    const months = def.period === 'mes' ? [0, 1, 2].map((k) => { const m = `${year}-${String((q - 1) * 3 + k + 1).padStart(2, '0')}`; const e = list.find((x) => x.period === m); return { period: m, value: e?.value ?? null, status: kpiStatus(def, e?.value ?? null, target) }; }) : null;
    return { q, target, value, status: kpiStatus(def, value, target) as KpiStatus, attainment: kpiAttainment(def.direction, value, target), months, phase: q < curQ ? 'fechado' : q === curQ ? 'atual' : 'futuro', entries: list.length };
  });
  const value = aggregate(quarters.filter((q) => q.value !== null).map((q) => q.value!), agg === 'soma' ? 'soma' : 'media');
  const last = [...entries].sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null;
  return {
    quarters, current: quarters.find((q) => q.phase === 'atual') ?? null,
    annual: { target: def.target ?? null, value, status: kpiStatus(def, value, def.target ?? null), attainment: kpiAttainment(def.direction, value, def.target ?? null) },
    lastEntryAt: last?.createdAt ?? null, lastPeriod: inYear.at(-1)?.period ?? null,
  };
}

/**
 * Contexto do Booking: contratos fechados no trimestre, negociações em andamento e saúde das contas.
 * Tudo vem do próprio CRM; valores anualizados como no Tier (mensal × 12; global proporcional a 12 meses).
 */
async function bookingContext(db: Parameters<typeof allIndicators>[0], tenantId: string, year: number, quarter: number, today: string) {
  const from = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`;
  const to = quarter === 4 ? `${year}-12-31` : `${year}-${String(quarter * 3 + 1).padStart(2, '0')}-01`;
  const end = quarter === 4 ? to : new Date(Date.parse(`${to}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  // contratos novos: data de assinatura da 1ª versão no trimestre (renovação não é booking novo)
  const signed = await db.execute<{ id: string; kind: string; billing_type: string; segment: string; monthly_cents: string; total_cents: string | null; start_at: string | null; end_at: string | null; signed_at: string; client: string }>(sql`
    select c.id, c.kind, c.billing_type, ct.segment, v.monthly_cents, v.total_cents, v.start_at, v.end_at, f.signed_at, ct.name client
      from contracts c
      join contract_versions v on v.contract_id = c.id and v.version = c.current_version
      join contract_versions f on f.contract_id = c.id and f.version = 1
      join contacts ct on ct.id = c.contact_id
     where c.tenant_id = ${tenantId} and c.validated_at is not null and f.signed_at between ${from} and ${end}`);
  const acvOf = (r: { monthly_cents: string; total_cents: string | null; start_at: string | null; end_at: string | null }) => contractAcv({ monthlyCents: Number(r.monthly_cents), totalCents: r.total_cents === null ? null : Number(r.total_cents), startAt: r.start_at, endAt: r.end_at });
  const amend = await db.execute<{ n: number; cents: string | null }>(sql`
    select count(*)::int n, sum(case when a.monthly_delta_cents > 0 then a.monthly_delta_cents * 12 else a.value_delta_cents end) cents
      from contract_amendments a join contracts c on c.id = a.contract_id
     where c.tenant_id = ${tenantId} and a.kind = 'acrescimo' and a.signed_on between ${from} and ${end}`);
  const bySeg = new Map<string, { key: string; label: string; n: number; cents: number }>();
  for (const r of signed.rows) {
    const key = r.kind === 'publico' ? 'publico' : r.segment;
    const label = r.kind === 'publico' ? 'Público' : SEGMENT_LABELS[r.segment as keyof typeof SEGMENT_LABELS] ?? r.segment;
    const g = bySeg.get(key) ?? { key, label, n: 0, cents: 0 };
    g.n++; g.cents += acvOf(r); bySeg.set(key, g);
  }
  const months = [0, 1, 2].map((k) => { const m = `${year}-${String((quarter - 1) * 3 + k + 1).padStart(2, '0')}`; const rows = signed.rows.filter((r) => r.signed_at.startsWith(m)); return { month: m, n: rows.length, cents: rows.reduce((t, r) => t + acvOf(r), 0) }; });
  const contracts = {
    n: signed.rows.length, acvCents: signed.rows.reduce((t, r) => t + acvOf(r), 0),
    amendments: { n: amend.rows[0]?.n ?? 0, cents: Number(amend.rows[0]?.cents ?? 0) },
    bySegment: [...bySeg.values()].sort((a, b) => b.cents - a.cents), months,
    top: [...signed.rows].sort((a, b) => acvOf(b) - acvOf(a)).slice(0, 3).map((r) => ({ id: r.id, client: r.client, acvCents: acvOf(r), signedAt: r.signed_at })),
  };

  // negociações em andamento (fora do funil de Sucesso do Cliente), por etapa
  const open = await db.execute<{ stage: string; name: string; position: number; n: number; cents: string | null; new_n: number }>(sql`
    with o as (
      select o.id, o.stage, o.pipeline_id, o.created_at,
             case when o.value_cents is null then 0
                  when o.plan_id is not null and not exists (select 1 from opportunity_items i where i.opportunity_id = o.id) then o.value_cents * 12
                  else o.value_cents end acv
        from opportunities o join pipelines p on p.id = o.pipeline_id
       where o.tenant_id = ${tenantId} and o.deleted_at is null and p.key <> 'sucesso_cliente' and o.stage not in ('ganha','perdida'))
    select ps.key stage, ps.name, min(ps.position)::int position, count(o.id)::int n, sum(o.acv) cents, count(o.id) filter (where o.created_at >= ${from}::date)::int new_n
      from o join pipeline_stages ps on ps.pipeline_id = o.pipeline_id and ps.key = o.stage
     group by ps.key, ps.name order by min(ps.position)`);
  const closed = await db.execute<{ won: number; lost: number; won_cents: string | null }>(sql`
    select count(*) filter (where o.stage = 'ganha')::int won, count(*) filter (where o.stage = 'perdida')::int lost,
           sum(case when o.stage = 'ganha' then o.value_cents end) won_cents
      from opportunities o join pipelines p on p.id = o.pipeline_id
     where o.tenant_id = ${tenantId} and o.deleted_at is null and p.key <> 'sucesso_cliente'
       and ((o.stage = 'ganha' and o.won_at >= ${from}::date) or (o.stage = 'perdida' and o.lost_at >= ${from}::date))`);
  const stages = open.rows.map((r) => ({ key: r.stage, name: r.name, n: r.n, cents: Number(r.cents ?? 0), newN: r.new_n }));
  const won = closed.rows[0]?.won ?? 0, lost = closed.rows[0]?.lost ?? 0;
  const pipeline = { n: stages.reduce((t, x) => t + x.n, 0), cents: stages.reduce((t, x) => t + x.cents, 0), newN: stages.reduce((t, x) => t + x.newN, 0), stages, won, lost, winRate: won + lost ? won / (won + lost) : null };

  // saúde das contas (Sucesso do Cliente)
  const acc = await db.select({ snapshot: s.csAccounts.snapshot, name: s.contacts.name, contactId: s.csAccounts.contactId }).from(s.csAccounts).innerJoin(s.contacts, eq(s.contacts.id, s.csAccounts.contactId)).where(eq(s.csAccounts.tenantId, tenantId));
  const bands = [{ key: 'saudavel', label: 'Saudável' }, { key: 'atencao', label: 'Atenção' }, { key: 'risco', label: 'Em risco' }, { key: 'sem_dado', label: 'Dados insuficientes' }] as const;
  const bandOf = (score: number | null) => (score === null ? 'sem_dado' : score >= 75 ? 'saudavel' : score >= 50 ? 'atencao' : 'risco');
  const rows = acc.map((a) => { const sn = a.snapshot as { health?: { score: number | null }; acvCents?: number }; return { contactId: a.contactId, name: a.name, score: sn.health?.score ?? null, acvCents: sn.acvCents ?? 0 }; });
  const health = {
    total: rows.length, acvCents: rows.reduce((t, r) => t + r.acvCents, 0),
    bands: bands.map((b) => { const list = rows.filter((r) => bandOf(r.score) === b.key); return { ...b, n: list.length, acvCents: list.reduce((t, r) => t + r.acvCents, 0) }; }),
    healthyShare: rows.filter((r) => r.score !== null).length ? rows.filter((r) => bandOf(r.score) === 'saudavel').length / rows.filter((r) => r.score !== null).length : null,
    atRisk: rows.filter((r) => bandOf(r.score) === 'risco').sort((a, b) => b.acvCents - a.acvCents).slice(0, 4),
  };
  // booking do ano em R$, mês a mês: contratos novos (1ª assinatura) + aditivos de acréscimo, anualizados
  const yearSigned = await db.execute<{ m: string; monthly_cents: string; total_cents: string | null; start_at: string | null; end_at: string | null }>(sql`
    select to_char(f.signed_at, 'YYYY-MM') m, v.monthly_cents, v.total_cents, v.start_at, v.end_at
      from contracts c join contract_versions v on v.contract_id = c.id and v.version = c.current_version
      join contract_versions f on f.contract_id = c.id and f.version = 1
     where c.tenant_id = ${tenantId} and c.validated_at is not null and f.signed_at between ${`${year}-01-01`} and ${`${year}-12-31`}`);
  const yearAmend = await db.execute<{ m: string; cents: string | null }>(sql`
    select to_char(a.signed_on, 'YYYY-MM') m, sum(case when a.monthly_delta_cents > 0 then a.monthly_delta_cents * 12 else a.value_delta_cents end) cents
      from contract_amendments a join contracts c on c.id = a.contract_id
     where c.tenant_id = ${tenantId} and a.kind = 'acrescimo' and a.signed_on between ${`${year}-01-01`} and ${`${year}-12-31`} group by 1`);
  const bookingMonths = Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, '0')}`;
    const rows = yearSigned.rows.filter((r) => r.m === m);
    const add = Number(yearAmend.rows.find((r) => r.m === m)?.cents ?? 0);
    return { month: m, n: rows.length, contractsCents: rows.reduce((t, r) => t + acvOf(r), 0), amendmentsCents: add, cents: rows.reduce((t, r) => t + acvOf(r), 0) + add };
  });
  return { period: { from, to: end, quarter, year, today }, contracts, pipeline, health, bookingMonths };
}

export const kpiRoutes = [
  defineRoute({
    method: 'POST', url: '/intelligence/kpis/demo', summary: 'Cria as fichas dos indicadores principais que faltam e lança resultados fictícios de demonstração onde não há resultado', tag: 'Inteligência', module: 'inteligencia',
    handler: async ({ app, auth, req }) => {
      if (!canImport(auth)) throw forbidden('Dados de demonstração exigem visão total em Configurações.');
      const r = await app.db.transaction((tx) => loadKpiDemo(tx, auth.tenantId, todayLocal(auth), auth.userId));
      await audit(app.db, req, { action: 'kpi.demo.load', entityType: 'tenant', entityId: auth.tenantId, metadata: r });
      return r;
    },
  }),
  defineRoute({
    method: 'POST', url: '/intelligence/kpis/demo/clear', summary: 'Tira os resultados fictícios de demonstração (ficam no histórico como substituídos)', tag: 'Inteligência', module: 'inteligencia',
    handler: async ({ app, auth, req }) => {
      if (!canEnter(auth)) throw forbidden('Sem permissão para mexer nos resultados dos indicadores.');
      const r = await clearKpiDemo(app.db, auth.tenantId);
      await audit(app.db, req, { action: 'kpi.demo.clear', entityType: 'tenant', entityId: auth.tenantId, metadata: r });
      return r;
    },
  }),
  defineRoute({
    method: 'GET', url: '/intelligence/kpis/context', summary: 'Contexto do Booking no trimestre: contratos fechados, negociações em andamento e saúde das contas', tag: 'Inteligência', module: 'inteligencia',
    query: z.object({ year: z.coerce.number().int().min(2020).max(2100).optional(), quarter: z.coerce.number().int().min(1).max(4).optional() }),
    handler: async ({ app, auth, query }) => {
      const today = todayLocal(auth);
      return bookingContext(app.db, auth.tenantId, query.year ?? Number(today.slice(0, 4)), query.quarter ?? quarterOf(today), today);
    },
  }),
  defineRoute({
    method: 'GET', url: '/intelligence/kpis', summary: 'Indicadores principais: metas desdobradas por trimestre, resultado e farol de atingimento no ano', tag: 'Inteligência', module: 'inteligencia',
    query: z.object({ year: z.coerce.number().int().min(2020).max(2100).optional() }),
    handler: async ({ app, auth, query }) => {
      const today = todayLocal(auth);
      const year = query.year ?? Number(today.slice(0, 4));
      const all = (await allIndicators(app.db, auth.tenantId)).filter((i) => i.active && i.def.calc === 'informado' && i.def.sheet);
      const items = [];
      for (const i of all) {
        const entries = await indicatorEntriesOf(app.db, auth.tenantId, i.id);
        items.push({ id: i.id, key: i.key, version: i.currentVersion, def: i.def, ...board(i.def, entries, year, today) });
      }
      const live = items.filter((i) => !i.def.sheet!.paused);
      const count = (st: KpiStatus) => live.filter((i) => i.current?.status === st).length;
      return {
        year, today, quarter: Number(today.slice(0, 4)) === year ? quarterOf(today) : null, items, canEnter: canEnter(auth), canImport: canImport(auth),
        demoEntries: (await app.db.select({ id: s.indicatorEntries.id }).from(s.indicatorEntries).where(and(eq(s.indicatorEntries.tenantId, auth.tenantId), eq(s.indicatorEntries.source, 'demonstracao'), isNull(s.indicatorEntries.supersededAt)))).length,
        summary: { total: live.length, atingido: count('atingido'), atencao: count('atencao'), abaixo: count('abaixo'), sem_dado: count('sem_dado') },
      };
    },
  }),
  defineRoute({
    method: 'GET', url: '/intelligence/kpis/:id/entries', summary: 'Lançamentos do KPI (vigentes e substituídos), com quem lançou', tag: 'Inteligência', module: 'inteligencia', params: IdParams,
    handler: async ({ app, auth, params }) => {
      const rows = await app.db.select({ id: s.indicatorEntries.id, period: s.indicatorEntries.period, value: s.indicatorEntries.value, note: s.indicatorEntries.note, createdAt: s.indicatorEntries.createdAt, supersededAt: s.indicatorEntries.supersededAt, by: s.users.name })
        .from(s.indicatorEntries).leftJoin(s.users, eq(s.users.id, s.indicatorEntries.createdBy))
        .where(and(eq(s.indicatorEntries.tenantId, auth.tenantId), eq(s.indicatorEntries.indicatorId, params.id))).orderBy(desc(s.indicatorEntries.createdAt)).limit(300);
      return { items: rows };
    },
  }),
  defineRoute({
    method: 'POST', url: '/intelligence/kpis/:id/entries', summary: 'Informa o resultado do KPI numa competência (corrigir grava novo lançamento e guarda o anterior)', tag: 'Inteligência', module: 'inteligencia', params: IdParams,
    body: z.object({ period: z.string().regex(PERIOD, 'Competência no formato aaaa-mm ou aaaa-T1..T4'), value: z.number().finite().min(-1e12).max(1e12), note: z.string().trim().max(500).nullable().optional() }),
    handler: async ({ app, auth, params, body, req, reply }) => {
      if (!canEnter(auth)) throw forbidden('Resultados dos indicadores são lançados por Inteligência Comercial, Diretoria ou quem tem visão total.');
      const d = await indicatorDef(app.db, auth.tenantId, params.id);
      if (!d || d.def.calc !== 'informado') throw notFound('Indicador informado não encontrado.');
      const monthly = /^\d{4}-\d{2}$/.test(body.period);
      if (d.def.period === 'mes' && !monthly) throw unprocessable('Este indicador é medido por mês: informe a competência aaaa-mm.');
      if (d.def.period === 'trimestre' && monthly) throw unprocessable('Este indicador é medido por trimestre: informe aaaa-T1 a aaaa-T4.');
      if (periodStart(body.period) > todayLocal(auth)) throw unprocessable('A competência ainda não começou.');
      const id = await app.db.transaction(async (tx) => {
        const prev = await tx.select({ id: s.indicatorEntries.id }).from(s.indicatorEntries).where(and(eq(s.indicatorEntries.indicatorId, params.id), eq(s.indicatorEntries.period, body.period), isNull(s.indicatorEntries.supersededAt))).for('update');
        const [row] = await tx.insert(s.indicatorEntries).values({ tenantId: auth.tenantId, indicatorId: params.id, period: body.period, periodStart: periodStart(body.period), value: body.value, note: body.note ?? null, createdBy: auth.userId }).returning({ id: s.indicatorEntries.id });
        if (prev.length) await tx.update(s.indicatorEntries).set({ supersededAt: new Date(), supersededBy: row!.id }).where(inArray(s.indicatorEntries.id, prev.map((x) => x.id)));
        return row!.id;
      });
      await audit(app.db, req, { action: 'kpi.entry', entityType: 'indicator', entityId: params.id, metadata: { period: body.period, value: body.value } });
      reply.code(201);
      return { id };
    },
  }),
  defineRoute({
    method: 'POST', url: '/intelligence/kpis/import/preview', summary: 'Lê o formulário de criação de KPI (.xlsx, uma aba por indicador) e mostra o que será criado ou atualizado', tag: 'Inteligência', module: 'inteligencia',
    bodyLimit: 6_000_000,
    body: z.object({ filename: z.string().max(200), data: z.string().min(8).max(5_600_000) }),
    handler: async ({ app, auth, body }) => {
      if (!canImport(auth)) throw forbidden('Importar fichas de KPI exige visão total em Configurações.');
      let sheets;
      try { sheets = readXlsx(Buffer.from(body.data, 'base64')); } catch (e) { throw unprocessable(`Não foi possível ler a planilha: ${(e as Error).message}`); }
      const existing = await allIndicators(app.db, auth.tenantId);
      const items = sheets.map((sh) => {
        const rows = sh.rows.map((r) => { const c = r.filter((x) => x !== null && x !== ''); return typeof c[0] === 'string' && /^data de/i.test(c[0].trim()) && typeof c[1] === 'number' ? [c[0], excelDate(c[1])] : r; });
        const p = parseKpiForm(sh.name, rows);
        if (!p) return null;
        const ex = existing.find((i) => i.key === p.key);
        if (ex?.def.sheet?.main) p.def.sheet!.main = true; // reimportar não tira o indicador principal
        return { ...p, action: ex ? 'atualizar' : 'criar', indicatorId: ex?.id ?? null };
      }).filter(Boolean);
      // a primeira ficha do arquivo é o indicador principal (dá para trocar na prévia)
      const firstLive = items.find((i) => i && !i.def.sheet!.paused);
      if (firstLive && !existing.some((i) => i.def.sheet?.main)) firstLive.def.sheet!.main = true;
      if (!items.length) throw unprocessable('Nenhuma aba no formato do formulário de criação de KPI ("Nome do KPI", "Meta Anual"...).');
      return { items };
    },
  }),
  defineRoute({
    method: 'POST', url: '/intelligence/kpis/import', summary: 'Cria ou atualiza (nova versão) os KPIs conferidos na prévia', tag: 'Inteligência', module: 'inteligencia',
    body: z.object({ items: z.array(z.object({ key: z.string().regex(/^kpi_[a-z0-9_]{1,36}$/), def: KpiDefSchema })).min(1).max(40) }),
    handler: async ({ app, auth, body, req }) => {
      if (!canImport(auth)) throw forbidden('Importar fichas de KPI exige visão total em Configurações.');
      const r = await app.db.transaction(async (tx) => {
        let created = 0, updated = 0;
        for (const it of body.items) {
          const def = it.def as unknown as IndicatorDef;
          const [ex] = await tx.select().from(s.indicators).where(and(eq(s.indicators.tenantId, auth.tenantId), eq(s.indicators.key, it.key))).for('update').limit(1);
          if (ex) {
            const v = ex.currentVersion + 1;
            await tx.insert(s.indicatorVersions).values({ tenantId: auth.tenantId, indicatorId: ex.id, version: v, def, note: 'Ficha do KPI reimportada', createdBy: auth.userId });
            await tx.update(s.indicators).set({ currentVersion: v, active: true }).where(eq(s.indicators.id, ex.id));
            updated++;
          } else {
            const [i] = await tx.insert(s.indicators).values({ tenantId: auth.tenantId, key: it.key, createdBy: auth.userId }).returning({ id: s.indicators.id });
            await tx.insert(s.indicatorVersions).values({ tenantId: auth.tenantId, indicatorId: i!.id, version: 1, def, note: 'Criado pela ficha do KPI', createdBy: auth.userId });
            created++;
          }
        }
        return { created, updated };
      });
      await audit(app.db, req, { action: 'kpi.import', entityType: 'tenant', entityId: auth.tenantId, metadata: r });
      return r;
    },
  }),
];
