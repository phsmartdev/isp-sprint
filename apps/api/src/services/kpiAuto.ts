/**
 * Indicadores principais calculados direto do CRM. Cada um devolve o valor por mês (quando mensal),
 * por trimestre e no ano; período sem dado fica null e o painel usa o resultado informado, se houver.
 *
 * Win Rate: licitações e adesões ganhas ÷ (ganhas + perdidas) com resultado no período.
 * Conversão: das negociações abertas no período, quantas estão ganhas.
 * Health Score: % das contas do Sucesso do Cliente com saúde calculada que estão saudáveis (≥ 75).
 * Lead Time de Viabilidade: média de dias entre criar e concluir as tarefas das categorias escolhidas.
 * Ativação de Contas-Alvo: contas-alvo em andamento com pelo menos uma interação qualificada no período.
 */
import { sql } from 'drizzle-orm';
import { activationConfig, activationState, addDays, addMonths, type AbmTierKey, type ActivationConfig, type ActivationSignal, type IndicatorDef, type SignalHit } from '@isp/domain';
import type { DbOrTx } from '../db/client';

export type Auto = { months: Map<string, number | null>; quarters: Map<number, number | null>; annual?: number | null };
export const KPI_AUTO_KINDS = ['booking', 'win_rate', 'conversao', 'health', 'lead_time', 'abm'] as const;
export type KpiAutoKind = (typeof KPI_AUTO_KINDS)[number];
const BY_KEY: Record<string, KpiAutoKind> = {
  kpi_booking_de_contratos: 'booking', kpi_win_rate: 'win_rate', kpi_taxa_de_conversao: 'conversao',
  kpi_health_score: 'health', kpi_lead_time_viabilidade: 'lead_time', kpi_ativacao_de_contas_alvo: 'abm',
};
export const autoKindOf = (key: string, def: IndicatorDef) => (def.sheet as { auto?: KpiAutoKind } | undefined)?.auto ?? BY_KEY[key] ?? null;

const r1 = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const pct = (a: number, b: number) => (b ? r1((a / b) * 100) : null);
const mStart = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;
const mEnd = (y: number, m: number) => addDays(addMonths(mStart(y, m), 1), -1);
const qStart = (y: number, q: number) => mStart(y, (q - 1) * 3 + 1);
const qEnd = (y: number, q: number) => mEnd(y, q * 3);

function frame(year: number, today: string) {
  const ty = Number(today.slice(0, 4));
  const upToMonth = ty === year ? Number(today.slice(5, 7)) : ty > year ? 12 : 0;
  const upToQ = Math.ceil(upToMonth / 3);
  return { upToMonth, upToQ, ytdEnd: upToMonth ? mEnd(year, upToMonth) : `${year}-01-01` };
}

async function winRate(db: DbOrTx, t: string, year: number, today: string): Promise<Auto> {
  const { upToQ, ytdEnd } = frame(year, today);
  const count = async (from: string, to: string) => {
    const r = await db.execute<{ won: number; lost: number }>(sql`
      select count(*) filter (where o.stage = 'ganha' and o.won_at::date between ${from} and ${to})::int won,
             count(*) filter (where o.stage = 'perdida' and o.lost_at::date between ${from} and ${to})::int lost
        from opportunities o join pipelines p on p.id = o.pipeline_id
       where o.tenant_id = ${t} and o.deleted_at is null and p.key <> 'sucesso_cliente'
         and (o.sale_kind in ('licitacao','adesao_ata') or o.arp_id is not null)`);
    const x = r.rows[0]!;
    return pct(x.won, x.won + x.lost);
  };
  const quarters = new Map<number, number | null>();
  for (let q = 1; q <= 4; q++) quarters.set(q, q <= upToQ ? await count(qStart(year, q), qEnd(year, q)) : null);
  return { months: new Map(), quarters, annual: upToQ ? await count(`${year}-01-01`, ytdEnd) : null };
}

async function conversion(db: DbOrTx, t: string, year: number, today: string): Promise<Auto> {
  const { upToQ, ytdEnd } = frame(year, today);
  const rate = async (from: string, to: string) => {
    const r = await db.execute<{ n: number; won: number }>(sql`
      select count(*)::int n, count(*) filter (where o.stage = 'ganha')::int won
        from opportunities o join pipelines p on p.id = o.pipeline_id
       where o.tenant_id = ${t} and o.deleted_at is null and p.key <> 'sucesso_cliente' and o.created_at::date between ${from} and ${to}`);
    return pct(r.rows[0]!.won, r.rows[0]!.n);
  };
  const quarters = new Map<number, number | null>();
  for (let q = 1; q <= 4; q++) quarters.set(q, q <= upToQ ? await rate(qStart(year, q), qEnd(year, q)) : null);
  return { months: new Map(), quarters, annual: upToQ ? await rate(`${year}-01-01`, ytdEnd) : null };
}

async function health(db: DbOrTx, t: string, year: number, today: string): Promise<Auto> {
  const { upToQ } = frame(year, today);
  const curQ = Number(today.slice(0, 4)) === year ? Math.ceil(Number(today.slice(5, 7)) / 3) : 0;
  const share = (scores: (number | null)[]) => { const k = scores.filter((s): s is number => s !== null); return pct(k.filter((s) => s >= 75).length, k.length); };
  const quarters = new Map<number, number | null>();
  for (let q = 1; q <= 4; q++) {
    if (q > upToQ) { quarters.set(q, null); continue; }
    if (q === curQ) {
      // trimestre atual: a saúde de hoje
      const r = await db.execute<{ score: number | null }>(sql`select (snapshot->'health'->>'score')::numeric score from cs_accounts where tenant_id = ${t}`);
      quarters.set(q, share(r.rows.map((x) => (x.score === null ? null : Number(x.score)))));
    } else {
      // trimestres fechados: a última avaliação de saúde de cada conta até o fim do trimestre
      const r = await db.execute<{ score: number | null }>(sql`
        select distinct on (contact_id) score from cs_assessments
         where tenant_id = ${t} and kind = 'saude' and created_at::date <= ${qEnd(year, q)} order by contact_id, created_at desc`);
      quarters.set(q, r.rows.length ? share(r.rows.map((x) => (x.score === null ? null : Number(x.score)))) : null);
    }
  }
  return { months: new Map(), quarters };
}

async function leadTime(db: DbOrTx, t: string, year: number, today: string, categories: string[]): Promise<Auto> {
  const { upToMonth, upToQ, ytdEnd } = frame(year, today);
  const cats = categories.map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (!cats.length) return { months: new Map(), quarters: new Map() };
  const avg = async (from: string, to: string) => {
    const r = await db.execute<{ d: string | null }>(sql`
      select avg(extract(epoch from (completed_at - created_at)) / 86400) d from activities
       where tenant_id = ${t} and deleted_at is null and completed_at is not null and completed_at::date between ${from} and ${to}
         and lower(coalesce(category, '')) in ${cats}`);
    return r.rows[0]?.d == null ? null : r1(Number(r.rows[0]!.d));
  };
  const months = new Map<string, number | null>();
  for (let m = 1; m <= 12; m++) months.set(`${year}-${String(m).padStart(2, '0')}`, m <= upToMonth ? await avg(mStart(year, m), mEnd(year, m)) : null);
  const quarters = new Map<number, number | null>();
  for (let q = 1; q <= 4; q++) quarters.set(q, q <= upToQ ? await avg(qStart(year, q), qEnd(year, q)) : null);
  return { months, quarters, annual: upToMonth ? await avg(`${year}-01-01`, ytdEnd) : null };
}

/** Sinais de mão dupla de cada conta-alvo (vindos da conta), com a pessoa quando se sabe quem foi. */
export async function activationHits(db: DbOrTx, t: string, from: string, to: string, cfg: ActivationConfig) {
  const hits = new Map<string, SignalHit[]>();
  const add = (contact: string, kind: ActivationSignal, on: string, person: string | null) => { const l = hits.get(contact) ?? []; l.push({ kind, on, person }); hits.set(contact, l); };
  const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  const r1q = await db.execute<{ contact_id: string; d: string; p: string | null }>(sql`select contact_id, completed_at::date d, stakeholder_ids[1]::text p from activities where tenant_id = ${t} and deleted_at is null and contact_id is not null and type in ('reuniao','visita') and completed_at::date between ${from} and ${to}`);
  for (const r of r1q.rows) add(r.contact_id, 'reuniao_visita', day(r.d), r.p);
  const r2 = await db.execute<{ contact_id: string; d: string }>(sql`select contact_id, created_at::date d from opportunities where tenant_id = ${t} and deleted_at is null and origin_mail_thread_id is not null and created_at::date between ${from} and ${to}`);
  for (const r of r2.rows) add(r.contact_id, 'pedido_iniciativa', day(r.d), null);
  const r3 = await db.execute<{ contact_id: string; d: string }>(sql`select contact_id, closed_at::date d from abm_play_runs where tenant_id = ${t} and success_achieved = true and closed_at::date between ${from} and ${to}`);
  for (const r of r3.rows) add(r.contact_id, 'play_sucesso', day(r.d), null);
  const r4 = await db.execute<{ contact_id: string; d: string; p: string }>(sql`select th.contact_id, m.sent_at::date d, lower(m.from_addr) p from mail_messages m join mail_threads th on th.id = m.thread_id where th.tenant_id = ${t} and th.contact_id is not null and m.direction = 'entrada' and m.sent_at::date between ${from} and ${to}`);
  for (const r of r4.rows) add(r.contact_id, 'resposta_mensagem', day(r.d), r.p);
  const r5 = await db.execute<{ contact_id: string; d: string; p: string | null }>(sql`select a.contact_id, a.completed_at::date d, a.stakeholder_ids[1]::text p from abm_play_run_steps st join activities a on a.id = st.activity_id where st.tenant_id = ${t} and a.deleted_at is null and a.contact_id is not null and a.type in ('ligacao','reuniao','visita','whatsapp','email') and a.completed_at::date between ${from} and ${to}`);
  for (const r of r5.rows) add(r.contact_id, 'passo_play', day(r.d), r.p);
  if (cfg.survey.surveyId) {
    const r6 = await db.execute<{ contact_id: string; d: string; p: string | null; answers: Record<string, unknown> }>(sql`select contact_id, created_at::date d, stakeholder_id::text p, answers from survey_responses where tenant_id = ${t} and survey_id = ${cfg.survey.surveyId} and created_at::date between ${from} and ${to}`);
    for (const r of r6.rows) {
      add(r.contact_id, 'pesquisa_resposta', day(r.d), r.p);
      const rel = cfg.survey.relevanceKey ? Number(r.answers[cfg.survey.relevanceKey]) : NaN;
      const rec = cfg.survey.recommendKey ? r.answers[cfg.survey.recommendKey] : undefined;
      if ((Number.isFinite(rel) && rel >= cfg.survey.minScore) || rec === true || rec === 'sim') add(r.contact_id, 'pesquisa_reconhecimento', day(r.d), r.p);
    }
  }
  return hits;
}

/** Contas-alvo em andamento (com o tier) e o estado de ativação de cada uma numa data. */
export async function activationAccounts(db: DbOrTx, t: string, at: string, cfg: ActivationConfig, hits?: Map<string, SignalHit[]>) {
  const base = await db.execute<{ id: string; contact_id: string; tier: string; name: string; owner: string | null }>(sql`
    select a.id, a.contact_id, a.tier, c.name, u.name owner from abm_accounts a join contacts c on c.id = a.contact_id left join users u on u.id = a.owner_id
     where a.tenant_id = ${t} and a.status in ('selecionada','em_planejamento','ativa','em_acompanhamento') and a.created_at::date <= ${at}`);
  const maxWin = Math.max(...Object.values(cfg.tiers).map((r) => r.windowDays)) * 2;
  const h = hits ?? await activationHits(db, t, addDays(at, -maxWin), at, cfg);
  return base.rows.map((a) => ({ abmId: a.id, contactId: a.contact_id, name: a.name, owner: a.owner, tier: a.tier as AbmTierKey, ...activationState(h.get(a.contact_id) ?? [], cfg, a.tier as AbmTierKey, at) }));
}

async function abmActivation(db: DbOrTx, t: string, year: number, today: string, cfg: ActivationConfig): Promise<Auto> {
  const { upToMonth, upToQ } = frame(year, today);
  if (!upToMonth) return { months: new Map(), quarters: new Map() };
  const maxWin = Math.max(...Object.values(cfg.tiers).map((r) => r.windowDays)) * 2;
  const end = upToMonth === Number(today.slice(5, 7)) && Number(today.slice(0, 4)) === year ? today : mEnd(year, upToMonth);
  const hits = await activationHits(db, t, addDays(`${year}-01-01`, -maxWin), end, cfg);
  const rate = async (at: string) => { const l = await activationAccounts(db, t, at, cfg, hits); return l.length ? pct(l.filter((x) => x.state === 'ativada').length, l.length) : null; };
  const cap = (d: string) => (d > today ? today : d);
  const months = new Map<string, number | null>();
  for (let m = 1; m <= 12; m++) months.set(`${year}-${String(m).padStart(2, '0')}`, m <= upToMonth ? await rate(cap(mEnd(year, m))) : null);
  const quarters = new Map<number, number | null>();
  for (let q = 1; q <= 4; q++) quarters.set(q, q <= upToQ ? await rate(cap(qEnd(year, q))) : null);
  return { months, quarters };
}

/** Valores calculados do indicador (null quando ele não é calculado do CRM). */
export async function kpiAuto(db: DbOrTx, tenantId: string, key: string, def: IndicatorDef, year: number, today: string): Promise<{ kind: KpiAutoKind; auto: Auto } | null> {
  const kind = autoKindOf(key, def);
  if (!kind || kind === 'booking') return null;
  const sh = (def.sheet ?? {}) as { taskCategories?: string[]; activation?: Partial<ActivationConfig> };
  const auto = kind === 'win_rate' ? await winRate(db, tenantId, year, today)
    : kind === 'conversao' ? await conversion(db, tenantId, year, today)
    : kind === 'health' ? await health(db, tenantId, year, today)
    : kind === 'lead_time' ? await leadTime(db, tenantId, year, today, sh.taskCategories ?? [])
    : await abmActivation(db, tenantId, year, today, activationConfig(sh.activation));
  return { kind, auto };
}
