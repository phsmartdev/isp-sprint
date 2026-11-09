/** Pontos da oportunidade para quem está vendo: só as participações dela (tarefas, parte no ganho, apoio). */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]); });
afterAll(async () => ctx.close());

it('cada um vê só o que ganhou na oportunidade', async () => {
  const plan = (await carlos.get('/meta/lookups')).json().plans[0];
  const o = (await lucas.post('/opportunities', { newContact: { name: 'Conta Pontos Fictícia', segment: 'empresarial' }, planId: plan.id })).json();
  const row = (await ctx.db.execute(sql`select tenant_id, pipeline_id from opportunities where id = ${o.id}`)).rows[0] as { tenant_id: string; pipeline_id: string };
  const cfg = JSON.stringify({ journeys: [{ key: 'pts_teste', name: 'Jornada pontos', pipelineId: row.pipeline_id, wonPoints: 40, components: [{ key: 'diag', name: 'Diagnóstico fictício', stageKey: null, points: 10, dueDays: 3, level: null }] }] });
  await ctx.db.execute(sql`insert into gamification_settings (tenant_id, version, config, note, status, created_by) values (${row.tenant_id}, (select coalesce(max(version),0)+1 from gamification_settings where tenant_id = ${row.tenant_id}), ${cfg}::jsonb, 'teste', 'aprovada', ${carlos.me.user.id})`);
  // tarefa da jornada concluída pelo Lucas no prazo (10 + 20%)
  await ctx.db.execute(sql`insert into activities (tenant_id, type, title, owner_id, due_at, completed_at, completed_by, opportunity_id, contact_id, score_component, created_by)
    select tenant_id, 'tarefa', 'Diagnóstico fictício', ${lucas.me.user.id}, now() + interval '1 day', now(), ${lucas.me.user.id}, id, contact_id, 'pts_teste:diag', ${lucas.me.user.id} from opportunities where id = ${o.id}`);
  const mine = (await lucas.get(`/opportunities/${o.id}/my-points`)).json();
  const other = (await carlos.get(`/opportunities/${o.id}/my-points`)).json();
  expect(mine.enabled).toBe(true);
  expect(other.total).toBe(0);
  if (mine.total === 0) {
    // a referência do componente pode ter outro formato: confere o que a regra espera
    const ref = (await ctx.db.execute(sql`select score_component from activities where opportunity_id = ${o.id}`)).rows[0];
    throw new Error(`sem pontos: ${JSON.stringify(ref)}`);
  }
  expect(mine.parts.tarefas).toBeGreaterThan(0);
});
