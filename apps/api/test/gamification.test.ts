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
    // o liderado vê só a própria nota e a média do time: sem colegas, sem dispersão, sem ranking
    const g = ok(await lucas.get('/times/gamificacao?month=2024-02')).json();
    const r = g.monthBoard.teams.find((t: { name: string }) => t.name === 'Residencial');
    expect(r.average).toBeCloseTo(41.3, 1);
    expect(r.members).toBeNull();
    expect(r.dispersion).toBeNull();
    expect(g.monthBoard).not.toHaveProperty('podium');
    // nível padrão N2 (meta 100 pts/mês): 60 pts = 60% de atingimento; nota = 60% próprio + 40% time
    expect(g.monthBoard.me).toMatchObject({ levelKey: 'n2', points: 60, attainment: 60, own: 60 });
    expect(g.monthBoard.me.score).toBeCloseTo(0.6 * 60 + 0.4 * g.monthBoard.me.teamAverage, 0);
    // a gestão vê o time em detalhe (ferramenta de gestão)
    const gm = ok(await carlos.get('/times/gamificacao?month=2024-02')).json();
    const rm = gm.monthBoard.teams.find((t: { name: string }) => t.name === 'Residencial');
    // Residencial: ana 22,5 (30 × 0,5 × 1,5) e lucas 60 → média 41,25
    expect(rm.members.map((m: { own: number }) => m.own).sort()).toEqual([22.5, 60]);
    // liderança (N4): 30% próprio + 50% time + 20% dispersão do time
    const anaRow = rm.members.find((p: { name: string }) => /Ana/.test(p.name));
    expect(anaRow).toMatchObject({ levelKey: 'n4', lead: true, own: 22.5, hasPhoto: false });
    expect(anaRow.score).toBeCloseTo(0.3 * 22.5 + 0.5 * anaRow.teamAverage + 0.2 * anaRow.dispersionScore, 0);
    // ano 2024: lucas tem a maior nota → só o primeiro lugar recebe o selo
    expect(g.year).toBe(2024);
    expect(g.gold.map((x: { name: string }) => x.name)).toEqual([expect.stringMatching(/Lucas/)]);
    expect(g.me).toMatchObject({ gold: true });
    expect(g.me).not.toHaveProperty('rank');
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
    expect((await carlos.post('/times/gamificacao/settings', { ...st.settings, competencyLevels: st.settings.competencyLevels.map((l: { weights: object }, i: number) => (i === 0 ? { ...l, weights: { ownBp: 5_000, teamBp: 6_000, dispersionBp: 0, areaBp: 0 } } : l)), note: 'teste' })).json().detail).toMatch(/somar 100%/);
    expect((await carlos.post('/times/gamificacao/settings', { ...st.settings, dispersionRedBp: 100, note: 'teste' })).statusCode).toBe(422);
    expect((await carlos.post('/times/gamificacao/settings', { ...st.settings, points: { inventado: 5 }, note: 'teste' })).json().detail).toMatch(/desconhecido/);
  });
});

// ---------------------------------------------------------------- jornadas (mesmo arquivo: a regra é uma só, os testes não podem rodar em paralelo)
const newOpp = async () => {
  const plan = (await carlos.get('/meta/lookups')).json().plans[0];
  const c = ok(await lucas.post('/contacts', { name: `Cliente Jornada ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, segment: 'residencial', phone: '79999990000' }), 201).json();
  return ok(await lucas.post('/opportunities', { contactId: c.id, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false }), 201).json();
};
const tasksOf = async (oppId: string) => (await ctx.app.db.execute<{ id: string; title: string; score_component: string; row_version: number }>(sql`select id, title, score_component, row_version from activities where opportunity_id = ${oppId} and score_component is not null and deleted_at is null order by created_at`)).rows;
const complete = async (c: Client, id: string, done = true) => {
  const rv = (await ctx.app.db.execute<{ row_version: number }>(sql`select row_version from activities where id = ${id}`)).rows[0]!.row_version;
  ok(await c.patch(`/activities/${id}`, { completed: done, rowVersion: rv }));
};

describe('Jornadas de pontuação', () => {
  beforeAll(async () => { await ctx.app.db.execute(sql`delete from gamification_settings`); await ctx.app.db.execute(sql`update business_event_sync set last_run_at = now() - interval '1 day'`); });
  it('fluxo completo: tarefas por etapa, pontos de quem concluiu, ganho dividido, reabrir e excluir tiram pontos', async () => {
    const probe = await newOpp();
    const st = ok(await carlos.get('/times/gamificacao/settings')).json();
    const pipe = st.pipelines.find((p: { id: string }) => p.id === probe.pipelineId);
    expect(pipe.stages.map((x: { key: string }) => x.key)).toContain('qualificacao');
    const JK = `res_${Date.now().toString(36)}`;
    const journeys = [{ key: JK, name: 'Jornada residencial', pipelineId: pipe.id, wonPoints: 36, components: [
      { key: 'cadastro', name: 'Conferir cadastro', stageKey: null, points: 8, dueDays: 1 },
      { key: 'qualificar', name: 'Qualificar necessidade', stageKey: 'qualificacao', points: 10, dueDays: 2 },
    ] }];
    expect((await carlos.post('/times/gamificacao/settings', { ...st.proposal.settings, journeys: [{ ...journeys[0], components: [{ ...journeys[0]!.components[1], stageKey: 'inexistente' }] }], note: 'teste' })).json().detail).toMatch(/etapa inexistente/);
    const v = ok(await carlos.post('/times/gamificacao/settings', { ...st.proposal.settings, journeys, note: 'Jornada residencial' }), 201).json();
    // ainda proposta: nenhuma tarefa nasce
    const before = await newOpp();
    expect(await tasksOf(before.id)).toEqual([]);
    await ctx.app.db.execute(sql`update gamification_settings set created_by = (select id from users where email = 'ana@yepnet.test') where version = ${v.version}`);
    ok(await carlos.post(`/times/gamificacao/settings/${v.version}/decide`, { approve: true }));

    // nasce: tarefa da criação; entra em qualificação: tarefa da etapa
    const o = await newOpp();
    let ts = await tasksOf(o.id);
    expect(ts.map((t) => [t.title, t.score_component])).toEqual([['Conferir cadastro', `${JK}:cadastro`]]);
    const cur = ok(await lucas.get(`/opportunities/${o.id}`)).json();
    ok(await lucas.post(`/opportunities/${o.id}/transition`, { toStage: 'qualificacao', rowVersion: cur.rowVersion }));
    ts = await tasksOf(o.id);
    expect(ts.map((t) => t.score_component)).toEqual([`${JK}:cadastro`, `${JK}:qualificar`]);
    // voltar e entrar de novo não duplica
    // lucas conclui o cadastro; carlos conclui a qualificação
    await complete(lucas, ts[0]!.id);
    await complete(carlos, ts[1]!.id);
    let sc = ok(await lucas.get(`/opportunities/${o.id}/score`)).json();
    expect(sc.journey).toMatchObject({ name: 'Jornada residencial', wonPoints: 36 });
    expect(sc.components.map((c: { points: number; task: { done: boolean } }) => [c.points, c.task.done])).toEqual([[8, true], [10, true]]);
    // concluídas no prazo: +20% (8 → 9,6; 10 → 12)
    expect(sc.earned).toBeCloseTo(21.6, 5);
    expect(sc.components[0].task.bonus).toMatchObject({ onTime: true, adherence: false });

    // ganho: 36 dividido 8/18 e 10/18
    const r = ok(await carlos.get(`/opportunities/${o.id}`)).json();
    ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: r.rowVersion }));
    sc = ok(await lucas.get(`/opportunities/${o.id}/score`)).json();
    expect(sc.winShare.map((w: { points: number }) => w.points).sort((a: number, b: number) => a - b)).toEqual([16, 20]);

    let g = ok(await lucas.get('/times/gamificacao')).json();
    expect(g.monthBoard.me).toMatchObject({ tasks: 9.6, wins: 16 });
    // sem ranking nem pódio para ninguém
    expect(g).not.toHaveProperty('monthBoard.podium');
    expect(g).not.toHaveProperty('monthBoard.people');
    expect(g.me).not.toHaveProperty('rank');
    // o liderado não vê a nota de colegas
    expect(g.monthBoard.teams.every((t: { members: unknown }) => t.members === null)).toBe(true);
    const ga = ok(await ana.get('/times/gamificacao')).json();
    const resid = ga.monthBoard.teams.find((t: { name: string }) => t.name === 'Residencial');
    expect(resid.members.find((m: { name: string }) => /Lucas/.test(m.name))).toMatchObject({ tasks: 9.6, wins: 16 });

    // cada um vê os próprios pontos (qualquer pessoa logada), sem colegas
    const mp = ok(await lucas.get('/me/pontos')).json();
    expect(mp.monthScore).toMatchObject({ tasks: 9.6, wins: 16 });
    expect(mp.items.filter((x: { opportunityId: string }) => x.opportunityId === o.id).map((x: { source: string; points: number }) => [x.source, x.points]).sort()).toEqual([['ganho', 16], ['tarefa', 9.6]]);
    expect(mp).not.toHaveProperty('people');
    const oth = ok(await ana.get('/me/pontos')).json();
    expect(oth.items.some((x: { opportunityId: string; source: string }) => x.opportunityId === o.id && x.source === 'tarefa')).toBe(false);
    // qualificação opcional: quem concluiu não qualifica; a liderança aprova → bônus de aderência (+30%)
    expect((await lucas.post(`/opportunities/${o.id}/score/tasks/${ts[0]!.id}/qualify`, { result: 'aprovada' })).statusCode).toBe(403);
    ok(await ana.post(`/opportunities/${o.id}/score/tasks/${ts[0]!.id}/qualify`, { result: 'aprovada' }));
    expect(ok(await lucas.get('/times/gamificacao')).json().monthBoard.me.tasks).toBeCloseTo(12, 5); // 8 × (1 + 0,2 + 0,3)
    ok(await ana.post(`/opportunities/${o.id}/score/tasks/${ts[0]!.id}/qualify`, { result: 'reprovada' }));
    expect(ok(await lucas.get('/times/gamificacao')).json().monthBoard.me.tasks).toBeCloseTo(9.6, 5); // reprovada não tira pontos
    // reabrir tira os pontos da tarefa e a parte do ganho
    await complete(lucas, ts[0]!.id, false);
    g = ok(await lucas.get('/times/gamificacao')).json();
    expect(g.monthBoard.me).toMatchObject({ tasks: 0, wins: 0 });
    // concluir de novo e excluir: também sai
    await complete(lucas, ts[0]!.id, true);
    expect(ok(await lucas.get('/times/gamificacao')).json().monthBoard.me.tasks).toBe(9.6);
    ok(await carlos.del(`/tasks/${ts[0]!.id}`));
    expect(ok(await lucas.get('/times/gamificacao')).json().monthBoard.me).toMatchObject({ tasks: 0, wins: 0 });
    // recriar à mão a tarefa excluída
    ok(await lucas.post(`/opportunities/${o.id}/score/tasks`, { componentKey: 'cadastro' }), 201);
    expect((await lucas.post(`/opportunities/${o.id}/score/tasks`, { componentKey: 'cadastro' })).statusCode).toBe(422);
  });
});

describe('Meus pontos', () => {
  it('qualquer pessoa vê só os próprios pontos, com a origem de cada um', async () => {
    const r = ok(await lucas.get('/me/pontos')).json();
    if (r.pending) return; // sem regra aprovada, nada a mostrar
    expect(r).toMatchObject({ participates: true });
    expect(r.monthScore).toHaveProperty('score');
    expect(r).not.toHaveProperty('people');
    expect(JSON.stringify(r)).not.toMatch(/Rafael|Mariana/);
    expect(Array.isArray(r.items)).toBe(true);
  });
});
