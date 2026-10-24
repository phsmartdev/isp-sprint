/** Operação fictícia: gera histórico coerente (append-only datado) e alimenta receita, funil e contratos. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeApp } from './helpers';
import { hasOpsDemo, loadOpsDemo, OPS_SOURCE } from '../src/services/opsDemo';
import { revenueReport } from '../src/services/revenue';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => { ctx = await makeApp(); });
afterAll(async () => ctx.close());

describe('operação fictícia', () => {
  it('cria contas, negociações com etapas datadas e contratos com versões, sem furar o append-only', async () => {
    const t = (await ctx.db.execute<{ id: string }>(sql`select id from tenants where slug = 'outro'`)).rows[0]!.id;
    const today = new Date().toISOString().slice(0, 10);
    const r = await loadOpsDemo(ctx.db, t, { today, scale: 0.05, seed: 7 });
    expect(r.contacts).toBeGreaterThan(10);
    expect(r.opportunities).toBeGreaterThan(30);
    expect(r.contracts).toBeGreaterThan(10);
    expect(await hasOpsDemo(ctx.db, t)).toBe(true);
    const q = async <T,>(x: ReturnType<typeof sql>) => (await ctx.db.execute(x)).rows as T[];
    // toda negociação começa com o evento de criação e termina na etapa atual
    const bad = await q<{ n: number }>(sql`
      select count(*)::int n from opportunities o join contacts c on c.id = o.contact_id
       where o.tenant_id = ${t} and c.source_system = ${OPS_SOURCE}
         and (select e.to_value from opportunity_events e where e.opportunity_id = o.id order by e.occurred_at desc, e.row_version desc limit 1) <> o.stage`);
    expect(bad[0]!.n).toBe(0);
    // contrato aponta para a versão atual existente; nada no futuro
    const v = await q<{ n: number }>(sql`select count(*)::int n from contracts k where k.tenant_id = ${t} and not exists (select 1 from contract_versions v where v.contract_id = k.id and v.version = k.current_version)`);
    expect(v[0]!.n).toBe(0);
    const fut = await q<{ n: number }>(sql`select (select count(*) from opportunity_events where tenant_id = ${t} and occurred_at > now()) + (select count(*) from contract_events where tenant_id = ${t} and occurred_at > now())::int n`);
    expect(Number(fut[0]!.n)).toBe(0);
    // receita de 2025 existe (base anterior) e a de hoje também
    const rep = await revenueReport(ctx.db, t, Number(today.slice(0, 4)), today);
    expect(rep.totals[Number(today.slice(0, 4)) - 1]).toBeGreaterThan(0);
    expect(rep.months[Number(today.slice(5, 7)) - 1]!.total).toBeGreaterThan(0);
  });
});
