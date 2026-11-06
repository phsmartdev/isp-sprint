/** Gamificação colaborativa: pontos dos eventos válidos, peso do time, dispersão só para a liderança, pódio, níveis e Selo BK. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let ana: Client, lucas: Client, rafael: Client, carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const uid = async (email: string) => (await ctx.app.db.execute<{ id: string; tenant_id: string }>(sql`select id, tenant_id from users where email = ${email}`)).rows[0]!;

const AT = new Date('2024-02-15T15:00:00Z');
const pauseSync = () => ctx.app.db.execute(sql`update business_event_sync set last_run_at = now() + interval '1 hour'`);
async function event(email: string, type: string, kind: string, shareBp: number, at = AT) {
  const u = await uid(email);
  const [e] = (await ctx.app.db.execute<{ id: string }>(sql`insert into business_events (tenant_id, type, module, source_type, source_id, owner_id, occurred_at, idem_key, validation)
    values (${u.tenant_id}, ${type}, 'comercial', 'teste_gamificacao', gen_random_uuid(), ${u.id}, ${at.toISOString()}, ${`gam-${Math.random()}`}, 'valido') returning id`)).rows;
  await ctx.app.db.execute(sql`insert into business_event_credits (event_id, user_id, tenant_id, kind, share_bp) values (${e!.id}, ${u.id}, ${u.tenant_id}, ${kind}, ${shareBp})`);
}

beforeAll(async () => {
  ctx = await makeApp();
  ana = await login(ctx.app, 'ana@yepnet.test');
  lucas = await login(ctx.app, 'lucas@yepnet.test');
  rafael = await login(ctx.app, 'rafael@yepnet.test');
  carlos = await login(ctx.app, 'carlos@yepnet.test');
  await ctx.app.db.execute(sql`delete from business_event_credits where event_id in (select id from business_events where source_type = 'teste_gamificacao')`);
  await ctx.app.db.execute(sql`delete from business_events where source_type = 'teste_gamificacao'`);
  await ctx.app.db.execute(sql`delete from gamification_settings`);
  await ctx.app.db.execute(sql`select 1`);
});
afterAll(async () => { await ctx.app.db.execute(sql`update business_event_sync set last_run_at = now() - interval '1 day'`); await ctx.close(); });

describe('Gamificação colaborativa', () => {
  it('placar com pontos de configuração, participação valendo mais e média do time na nota', async () => {
    const st = ok(await carlos.get('/times/gamificacao/settings')).json();
    // nada vale antes da aprovação: a versão 1 é proposta
    expect(st).toMatchObject({ settings: null, version: null, proposal: { version: 1, canDecide: true } });
    expect(ok(await lucas.get('/times/gamificacao')).json()).toMatchObject({ pending: true, monthBoard: null });
    expect(ok(await lucas.get('/me/selo')).json().gold).toBe(false);
    // só o time Residencial participa; pontos de teste
    const resid = st.teams.find((t: { name: string }) => t.name === 'Residencial').id;
    const empres = st.teams.find((t: { name: string }) => t.name === 'Empresarial').id;
    const v2 = ok(await carlos.post('/times/gamificacao/settings', { ...st.proposal.settings, teamIds: [resid, empres], points: { lead_qualificado: 30, proposta_enviada: 5 }, note: 'Teste' }), 201).json();
    expect(v2).toMatchObject({ version: 2, status: 'proposta' });
    // a v1 foi substituída; quem propôs não aprova
    expect((await carlos.post('/times/gamificacao/settings/1/decide', { approve: true })).statusCode).toBe(422);
    expect((await carlos.post('/times/gamificacao/settings/2/decide', { approve: true })).statusCode).toBe(403);
    expect((await lucas.post('/times/gamificacao/settings/2/decide', { approve: true })).statusCode).toBe(403);
    // proposta feita por outra pessoa: a gestão aprova e passa a valer
    await ctx.app.db.execute(sql`update gamification_settings set created_by = (select id from users where email = 'ana@yepnet.test') where version = 2`);
    expect((await carlos.post('/times/gamificacao/settings/2/decide', { approve: false })).statusCode).toBe(422);
    ok(await carlos.post('/times/gamificacao/settings/2/decide', { approve: true, note: 'Ok para começar' }));
    expect(ok(await carlos.get('/times/gamificacao/settings')).json()).toMatchObject({ version: 2, proposal: null });
    await pauseSync();
    await event('lucas@yepnet.test', 'lead_qualificado', 'direto', 10_000);
    await event('lucas@yepnet.test', 'lead_qualificado', 'direto', 10_000);
    await event('ana@yepnet.test', 'lead_qualificado', 'participacao', 5_000);
    await event('rafael@yepnet.test', 'proposta_enviada', 'direto', 10_000);
    await event('rafael@yepnet.test', 'tarefa_concluida', 'direto', 10_000); // tipo sem pontos
    await pauseSync();
    const g = ok(await lucas.get('/times/gamificacao?month=2024-02')).json();
    const mb = g.monthBoard;
    const r = mb.teams.find((t: { name: string }) => t.name === 'Residencial');
    // Residencial: ana 22,5 (30 × 0,5 × 1,5) e lucas 60 → média 41,25
    expect(r.members.map((m: { name: string; own: number }) => m.own).sort()).toEqual([22.5, 60]);
    expect(r.average).toBeCloseTo(41.3, 1);
    // liderado não vê a dispersão
    expect(r.dispersion).toBeNull();
    // liderança pesa mais o time: ana (líder) 20% próprio + 80% média dos times dela
    const anaRow = g.monthBoard.people.find((p: { name: string }) => /Ana/.test(p.name));
    expect(anaRow).toMatchObject({ role: 'lideranca', own: 22.5 });
    expect(anaRow.score).toBeCloseTo(0.2 * 22.5 + 0.8 * anaRow.teamAverage, 0);
    const lucasRow = g.monthBoard.people.find((p: { name: string }) => /Lucas/.test(p.name));
    expect(lucasRow).toMatchObject({ role: 'colaborador', own: 60, hasPhoto: false });
    expect(lucasRow.score).toBeCloseTo(0.5 * 60 + 0.5 * lucasRow.teamAverage, 0);
    expect(mb.podium[0].name).toMatch(/Lucas/);
    // ano 2024: lucas tem a maior nota → medalha de ouro
    expect(g.year).toBe(2024);
    expect(g.gold.map((x: { name: string }) => x.name)).toEqual([expect.stringMatching(/Lucas/)]);
    expect(g.me).toMatchObject({ gold: true, rank: 1 });
  });
  it('dispersão aparece para a liderança e para a gestão', async () => {
    const g = ok(await ana.get('/times/gamificacao?month=2024-02')).json();
    const r = g.monthBoard.teams.find((t: { name: string }) => t.name === 'Residencial');
    expect(r.dispersion.tone).toMatch(/amarelo|vermelho/);
    expect(r.dispersion.cv).toBeGreaterThan(0.3);
    const e = ok(await carlos.get('/times/gamificacao?month=2024-02')).json().monthBoard.teams.find((t: { name: string }) => t.name === 'Empresarial');
    expect(e.dispersion).not.toBeNull();
  });
  it('Selo BK de Qualidade: o mesmo resultado do placar do ano corrente', async () => {
    const g = ok(await lucas.get('/times/gamificacao')).json();
    const selo = ok(await lucas.get('/me/selo')).json();
    expect(selo.gold).toBe(Boolean(g.me?.gold));
    const others = ok(await rafael.get('/me/selo')).json();
    expect(others.gold).toBe(g.gold.some((x: { name: string }) => /Rafael/.test(x.name)));
  });
  it('regras: só quem administra; validação; tipo desconhecido', async () => {
    const st = ok(await carlos.get('/times/gamificacao/settings')).json();
    expect((await lucas.post('/times/gamificacao/settings', { ...st.settings, note: 'Teste lucas' })).statusCode).toBe(403);
    expect((await carlos.post('/times/gamificacao/settings', { ...st.settings, hierarchyWeights: { colaborador: { ownBp: 5_000, teamBp: 5_000 }, lideranca: { ownBp: 5_000, teamBp: 6_000 } }, note: 'teste' })).json().detail).toMatch(/somar 100%/);
    expect((await carlos.post('/times/gamificacao/settings', { ...st.settings, dispersionRedBp: 100, note: 'teste' })).statusCode).toBe(422);
    expect((await carlos.post('/times/gamificacao/settings', { ...st.settings, points: { inventado: 5 }, note: 'teste' })).json().detail).toMatch(/desconhecido/);
  });
});
