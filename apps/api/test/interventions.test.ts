/** Gestão de Times — Fase 5: intervenções pela apuração oficial (vermelho, primeiro amarelo, dois amarelos seguidos), sem duplicar, com escalonamento e avisos. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { completeAnalysis } from './analysisContent';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let users: { id: string; email: string }[];
const uid = (n: string) => users.find((u) => u.email === `${n}@yepnet.test`)!.id;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const month = (back: number) => {
  const d = new Date(`${today().slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - back);
  const from = d.toISOString().slice(0, 10); const e = new Date(d); e.setUTCMonth(e.getUTCMonth() + 1); e.setUTCDate(0);
  return { from, to: e.toISOString().slice(0, 10), comp: from.slice(0, 7) };
};
const stamp = Date.now().toString(36);
async function manualGoal(title: string, m: { from: string; to: string }, close = true) {
  const id = ok(await ana.post('/performance/goals', { title: `${title} ${stamp}`, scope: 'individual', userId: uid('lucas'), manualUnit: 'quantidade', periodType: 'personalizado', periodStart: m.from, periodEnd: m.to, target: 10 }), 201).json().id as string;
  if (close) ok(await lucas.get(`/performance/goals/${id}`)); // fecha o período (apuração v1)
  return id;
}
const rectify = (id: string, value: number) => carlos.post(`/results/closings/${id}/rectify`, { reason: 'Valor conferido na planilha de apoio', value, recompute: false });
const sync = async () => ok(await carlos.post('/interventions/sync'));
async function mineFor(goalTitle: string, c: Client = carlos, status = 'todas') {
  return ok(await c.get(`/interventions?status=${status}`)).json().items.filter((i: { goalTitle: string }) => i.goalTitle === `${goalTitle} ${stamp}`);
}

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas] = (await Promise.all(['carlos', 'ana', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  users = (await carlos.get('/admin/users')).json().users;
  // estrutura mínima: uma diretoria no topo, para existir cadeia de escalonamento acima do líder
  const org = ok(await carlos.get('/results/org')).json();
  if (!org.units.some((u: { kind: string; parentId: string | null; active: boolean; responsibleId: string | null }) => u.kind === 'diretoria' && !u.parentId && u.active && u.responsibleId)) {
    ok(await carlos.post('/results/org/units', { name: 'Diretoria Intervenções', kind: 'diretoria', responsibleId: uid('carlos') }), 201);
  }
});
afterAll(async () => ctx.close());

describe('intervenções', () => {
  let g1: string, g2: string;
  it('primeiro amarelo abre revisão simplificada; o segundo amarelo seguido promove a plano sem duplicar', async () => {
    g1 = await manualGoal('Série amarela', month(2), false);
    g2 = await manualGoal('Série amarela', month(1), false);
    // duas competências da mesma série (a rotina mensal faria isso mês a mês)
    await ctx.db.execute(sql`update goals set series_id = ${g1}::uuid where id in (${g1}::uuid, ${g2}::uuid)`);
    for (const id of [g1, g2]) ok(await lucas.get(`/performance/goals/${id}`));
    await sync();
    expect(await mineFor('Série amarela')).toHaveLength(0); // sem dado não abre nada
    ok(await rectify(g1, 8.7)); // 87% → amarelo
    let list = await mineFor('Série amarela');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'revisao', trigger: 'primeiro_amarelo', status: 'aberta', competencias: [month(2).comp] });
    expect(list[0].ownerId).not.toBe(uid('lucas'));
    ok(await rectify(g2, 8.6));
    list = await mineFor('Série amarela');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'plano', trigger: 'amarelos_consecutivos', competencias: [month(2).comp, month(1).comp] });
    ok(await carlos.post('/interventions/sync')); // idempotente
    expect(await mineFor('Série amarela')).toHaveLength(1);
  });

  it('plano: o avaliado não age nem dispensa; registra plano, escalona por atraso e avisa a cadeia; conclui', async () => {
    const [it0] = await mineFor('Série amarela');
    let d = ok(await carlos.get(`/interventions/${it0.id}`)).json();
    const body = { rowVersion: d.rowVersion, diagnosis: 'Queda de produtividade por falta de agenda', actionPlan: 'Bloco diário de prospecção e revisão semanal com a liderança', planDueOn: today() };
    expect((await lucas.post(`/interventions/${it0.id}/plan`, body)).statusCode).toBe(403);
    expect((await lucas.post(`/interventions/${it0.id}/dismiss`, { rowVersion: d.rowVersion, reason: 'Não concordo com a meta' })).statusCode).toBe(403);
    expect((await carlos.post(`/interventions/${it0.id}/conclude`, { rowVersion: d.rowVersion, conclusion: 'Sem plano ainda registrado' })).statusCode).toBe(422);
    expect((await carlos.post(`/interventions/${it0.id}/plan`, body)).statusCode).toBe(422); // sem análise concluída
    await completeAnalysis(carlos, it0.id);
    d = ok(await carlos.get(`/interventions/${it0.id}`)).json();
    body.rowVersion = d.rowVersion;
    expect(d.diagnosis).toContain('Falta de triagem de suporte da carteira');
    expect((await carlos.post(`/interventions/${it0.id}/plan`, { ...body, rowVersion: d.rowVersion + 5 })).statusCode).toBe(409);
    ok(await carlos.post(`/interventions/${it0.id}/plan`, body));
    d = ok(await carlos.get(`/interventions/${it0.id}`)).json();
    expect(d.status).toBe('em_andamento');
    expect(d.chain.length).toBeGreaterThan(0);
    {
      await ctx.db.execute(sql`update interventions set plan_due_on = (current_date - 60) where id = ${it0.id}::uuid`);
      ok(await carlos.post('/interventions/sync'));
      d = ok(await carlos.get(`/interventions/${it0.id}`)).json();
      expect(d.escalationLevel).toBe(d.chain.length);
      expect(d.chain.every((c: { called: boolean }) => c.called)).toBe(true);
      const top = users.find((u) => u.id === d.chain[d.chain.length - 1].id)!;
      const topC = top.email === 'carlos@yepnet.test' ? carlos : await login(ctx.app, top.email);
      const m = ok(await topC.get('/me/mentions')).json().items;
      expect(m.some((x: { kind: string; taskId: string; source: string }) => x.kind === 'intervencao' && x.taskId === it0.id && x.source === 'intervencao_escalada')).toBe(true);
    }
    ok(await carlos.post(`/interventions/${it0.id}/conclude`, { rowVersion: d.rowVersion, conclusion: 'Retomou o ritmo com o bloco diário' }));
    d = ok(await lucas.get(`/interventions/${it0.id}`)).json();
    expect(d).toMatchObject({ status: 'concluida' });
    expect(d.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['aberta', 'promovida', 'plano_registrado', 'concluida']));
    ok(await carlos.post('/interventions/sync'));
    expect((await mineFor('Série amarela')).filter((i: { status: string }) => i.status !== 'concluida')).toHaveLength(0); // competências tratadas não reabrem
  });

  it('vermelho abre plano obrigatório; retificação para verde dispensa automaticamente', async () => {
    const g = await manualGoal('Meta vermelha', month(1));
    ok(await rectify(g, 3));
    let [iv] = await mineFor('Meta vermelha');
    expect(iv).toMatchObject({ kind: 'plano', trigger: 'vermelho', status: 'aberta' });
    const owner = ok(await lucas.get('/me/mentions')).json();
    expect(owner).toHaveProperty('items');
    ok(await rectify(g, 9.5));
    [iv] = await mineFor('Meta vermelha');
    expect(iv.status).toBe('dispensada');
  });

  it('revisão simplificada concluída com "manter"; dispensa manual exige alguém acima do responsável', async () => {
    const g = await manualGoal('Meta revisão', month(1));
    ok(await rectify(g, 8.8));
    const [iv] = await mineFor('Meta revisão');
    const d = ok(await carlos.get(`/interventions/${iv.id}`)).json();
    expect((await carlos.post(`/interventions/${iv.id}/review`, { rowVersion: d.rowVersion, cause: 'curta', decision: 'manter' })).statusCode).toBe(422);
    ok(await carlos.post(`/interventions/${iv.id}/review`, { rowVersion: d.rowVersion, cause: 'Mês com feriados prolongados; ritmo normal na sequência', decision: 'manter' }));
    const [after] = await mineFor('Meta revisão');
    expect(after).toMatchObject({ status: 'concluida' });
    const lucasList = ok(await lucas.get('/interventions?status=todas')).json();
    expect(lucasList.items.some((x: { id: string }) => x.id === iv.id)).toBe(true); // o avaliado acompanha
  });
});
