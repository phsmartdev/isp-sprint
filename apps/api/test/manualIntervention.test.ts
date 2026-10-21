/** Intervenção aberta manualmente sobre um indicador, sem depender de meta fora da faixa. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';
import { addAction, completeAnalysis, finishTask } from './analysisContent';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let users: { id: string; email: string }[];
const uid = (n: string) => users.find((u) => u.email === `${n}@yepnet.test`)!.id;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas] = (await Promise.all(['carlos', 'ana', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  users = (await carlos.get('/admin/users')).json().users;
});
afterAll(async () => ctx.close());

describe('intervenção manual', () => {
  it('opções trazem indicadores e o escopo; abre sobre um indicador com motivo; roteiro completo', async () => {
    const opt = ok(await ana.get('/interventions/new-options')).json();
    expect(Array.isArray(opt.indicators)).toBe(true);
    let ind = opt.indicators[0]?.id as string | undefined;
    if (!ind) ind = ok(await carlos.post('/performance/indicators', { def: { name: 'Tarefas concluídas (manual)', category: 'tarefas', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'tarefa_concluida', measure: 'contagem' } } }), 201).json().id;
    const title = `Conversão em queda ${Date.now().toString(36)}`;
    expect((await ana.post('/interventions', { title, reason: 'curto', indicatorId: ind, subjectUserId: uid('lucas') })).statusCode).toBe(422);
    expect((await ana.post('/interventions', { title, reason: 'Tendência de queda nas últimas semanas', indicatorId: ind, subjectUserId: uid('lucas'), teamId: opt.teams[0]?.id ?? '00000000-0000-0000-0000-000000000000' })).statusCode).toBe(422);
    const id = ok(await ana.post('/interventions', { title, reason: 'Tendência de queda nas últimas semanas, antes de virar vermelho', indicatorId: ind, subjectUserId: uid('lucas') }), 201).json().id;
    let d = ok(await ana.get(`/interventions/${id}`)).json();
    expect(d).toMatchObject({ trigger: 'manual', kind: 'plano', status: 'aberta', goal: null, displayTitle: title, ownerId: uid('ana'), competencias: [] });
    expect(d.indicator.months).toHaveLength(6);
    expect(d.indicator.months.at(-1).partial).toBe(true);
    // aparece na lista com o título e o avaliado acompanha
    expect(ok(await ana.get('/interventions')).json().items.some((x: { id: string; goalTitle: string; trigger: string }) => x.id === id && x.goalTitle === title && x.trigger === 'manual')).toBe(true);
    expect((await lucas.get(`/interventions/${id}`)).statusCode).toBe(200);
    // sincronização não dispensa a manual (não tem competência)
    ok(await carlos.post('/interventions/sync'));
    expect(ok(await ana.get(`/interventions/${id}`)).json().status).toBe('aberta');
    // mesmo roteiro: análise → ação 5W2H → plano → conclusão
    await completeAnalysis(ana, id);
    expect(ok(await ana.get(`/interventions/${id}/analysis/pareto-data?source=motivos_perda`)).json()).toHaveProperty('period');
    const a = await addAction(ana, id, uid('lucas'));
    d = ok(await ana.get(`/interventions/${id}`)).json();
    ok(await ana.post(`/interventions/${id}/plan`, { rowVersion: d.rowVersion, diagnosis: d.diagnosis }));
    await finishTask(lucas, a.activityId);
    d = ok(await ana.get(`/interventions/${id}`)).json();
    ok(await ana.post(`/interventions/${id}/conclude`, { rowVersion: d.rowVersion, conclusion: 'Conversão voltou ao patamar anterior' }));
    expect(ok(await ana.get(`/interventions/${id}`)).json().status).toBe('concluida');
  });

  it('empresa toda só pela Diretoria; pessoa fora do escopo é recusada', async () => {
    const r = await lucas.post('/interventions', { title: 'Problema geral da empresa', reason: 'Quero abrir para a empresa toda' });
    expect([403]).toContain(r.statusCode);
    ok(await carlos.post('/interventions', { title: `Empresa ${Date.now().toString(36)}`, reason: 'Diretoria abre para a empresa toda' }), 201);
  });
});
