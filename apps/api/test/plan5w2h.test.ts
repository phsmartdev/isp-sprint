/** Gestão de Times — Fase 7: plano 5W2H integrado a tarefas e projetos. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';
import { addAction, completeAnalysis, finishTask } from './analysisContent';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let iv: string;
const id = (users: { id: string; email: string }[], n: string) => users.find((u) => u.email === `${n}@yepnet.test`)!.id;
let users: { id: string; email: string }[];
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas] = (await Promise.all(['carlos', 'ana', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  users = (await carlos.get('/admin/users')).json().users;
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  const from = d.toISOString().slice(0, 10); const e = new Date(d); e.setUTCMonth(e.getUTCMonth() + 1); e.setUTCDate(0);
  const title = `Meta 5W2H ${Date.now().toString(36)}`;
  const g = ok(await ana.post('/performance/goals', { title, scope: 'individual', userId: id(users, 'lucas'), manualUnit: 'visitas', periodType: 'personalizado', periodStart: from, periodEnd: e.toISOString().slice(0, 10), target: 10 }), 201).json().id;
  ok(await lucas.get(`/performance/goals/${g}`));
  ok(await carlos.post(`/results/closings/${g}/rectify`, { reason: 'Valor conferido no relatório', value: 1, recompute: false }));
  iv = ok(await carlos.get('/interventions?status=todas')).json().items.find((x: { goalTitle: string }) => x.goalTitle === title).id;
});
afterAll(async () => ctx.close());

describe('plano 5W2H', () => {
  it('ação exige análise concluída e as sete respostas; vira tarefa para quem executa, com aviso', async () => {
    const body = { what: 'Plantão de suporte', why: 'Ataca a falta de triagem', where: 'Central', whenDue: inDays(7), whoId: id(users, 'lucas'), how: 'Escala semanal', howMuchCents: 120000 };
    expect((await carlos.post(`/interventions/${iv}/actions`, body)).statusCode).toBe(422); // sem análise
    await completeAnalysis(carlos, iv);
    expect((await carlos.post(`/interventions/${iv}/actions`, { ...body, whenDue: '2020-01-01' })).statusCode).toBe(422);
    expect((await carlos.post(`/interventions/${iv}/actions`, { ...body, how: 'x' })).statusCode).toBe(422);
    expect((await lucas.post(`/interventions/${iv}/actions`, body)).statusCode).toBe(403);
    ok(await carlos.post(`/interventions/${iv}/actions`, body), 201);
    const d = ok(await carlos.get(`/interventions/${iv}`)).json();
    expect(d.actions).toHaveLength(1);
    expect(d.planCostCents).toBe(120000);
    const task = ok(await lucas.get(`/tasks/${d.actions[0].activityId}`)).json();
    const t = task.task ?? task;
    expect(t.title).toBe('Plano: Plantão de suporte');
    expect(t.notes).toContain('Como: Escala semanal');
    const m = ok(await lucas.get('/me/mentions')).json().items;
    expect(m.some((x: { kind: string; taskId: string; source: string }) => x.kind === 'tarefa' && x.taskId === d.actions[0].activityId && x.source === 'tarefa_atribuida')).toBe(true);
  });

  it('cancelar ação cancela a tarefa (com motivo); ação executada não cancela', async () => {
    const a = await addAction(carlos, iv, id(users, 'ana'), 'Revisão de rota de visitas');
    expect((await carlos.post(`/interventions/${iv}/actions/${a.id}/cancel`, { reason: 'curto' })).statusCode).toBe(422);
    ok(await carlos.post(`/interventions/${iv}/actions/${a.id}/cancel`, { reason: 'Coberto pelo plantão de suporte' }));
    let d = ok(await carlos.get(`/interventions/${iv}`)).json();
    expect(d.actions.find((x: { id: string }) => x.id === a.id)).toMatchObject({ status: 'cancelada', cancelReason: 'Coberto pelo plantão de suporte' });
    const first = d.actions[0];
    await finishTask(lucas, first.activityId);
    expect((await carlos.post(`/interventions/${iv}/actions/${first.id}/cancel`, { reason: 'Tentando cancelar o que já foi feito' })).statusCode).toBe(422);
    d = ok(await carlos.get(`/interventions/${iv}`)).json();
    expect(d.progress).toMatchObject({ total: 2, done: 1, cancelled: 1, open: 0, pct: 1 });
  });

  it('projeto ligado ao plano recebe as novas ações como tarefas; plano registra e conclui', async () => {
    const p = ok(await carlos.post('/projects', { name: `Plano de visitas ${Date.now().toString(36)}`, startOn: inDays(0), members: [{ userId: id(users, 'ana'), role: 'membro' }] }), 201).json().id;
    expect((await lucas.post(`/interventions/${iv}/project`, { projectId: p })).statusCode).toBe(403);
    ok(await carlos.post(`/interventions/${iv}/project`, { projectId: p }));
    const a = await addAction(carlos, iv, id(users, 'ana'), 'Mutirão de visitas');
    let d = ok(await carlos.get(`/interventions/${iv}`)).json();
    expect(d.project.id).toBe(p);
    expect(d.actions.find((x: { id: string }) => x.id === a.id).projectId).toBe(p);
    ok(await carlos.post(`/interventions/${iv}/plan`, { rowVersion: d.rowVersion, diagnosis: d.diagnosis }));
    d = ok(await carlos.get(`/interventions/${iv}`)).json();
    expect(d.status).toBe('em_andamento');
    expect(d.planDueOn).toBe(d.actions.map((x: { dueOn: string }) => x.dueOn).sort().at(-1));
    expect((await carlos.post(`/interventions/${iv}/conclude`, { rowVersion: d.rowVersion, conclusion: 'Plano executado e resultado voltou' })).statusCode).toBe(422);
    await finishTask(ana, a.activityId);
    d = ok(await carlos.get(`/interventions/${iv}`)).json();
    ok(await carlos.post(`/interventions/${iv}/conclude`, { rowVersion: d.rowVersion, conclusion: 'Plano executado e resultado voltou' }));
    expect(ok(await carlos.get(`/interventions/${iv}`)).json().events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['acao_incluida', 'acao_cancelada', 'projeto_ligado', 'concluida']));
  });
});
