/** ABM Fase 5 — plays: biblioteca versionada, sugestões justificadas (sem mexer em avaliações humanas), execução como tarefas. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';
import { finishTask } from './analysisContent';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
const today = new Date().toISOString().slice(0, 10);
type Play = { id: string; name: string; templateKey: string | null; currentVersion: number; rowVersion: number; definition: { steps: unknown[]; successCriteria: string; audience: Record<string, unknown> } };
let plays: Play[];
const byKey = (k: string) => plays.find((p) => p.templateKey === k)!;
let contactId: string, abmId: string, decisor: string;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, rafael] = (await Promise.all(['carlos', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const a = ok(await lucas.post('/abm/new-account', { name: `Prefeitura Fictícia Plays ${stamp}`, nature: 'publica', segment: 'governamental', reason: 'Programa de cidades conectadas' }), 201).json();
  contactId = a.contactId; abmId = a.id;
});
afterAll(async () => ctx.close());

describe('plays do ABM', () => {
  it('biblioteca com os 9 modelos; só a liderança monta e edita; edição da definição gera versão', async () => {
    const lib = ok(await lucas.get('/abm/plays')).json();
    plays = lib.items;
    expect(plays.filter((p) => p.templateKey)).toHaveLength(9);
    expect(lib.canManage).toBe(false);
    ok(await lucas.get('/abm/plays')); // idempotente: não duplica modelos
    expect(ok(await lucas.get('/abm/plays')).json().items.filter((p: Play) => p.templateKey)).toHaveLength(9);

    const body = { name: `Play próprio ${stamp}`, category: 'outro', objective: 'Teste', definition: { successCriteria: 'Reunião feita com o gestor', audience: { target: 'conta', commercial: ['identificada'] }, steps: [{ key: 'a', title: 'Ligar para o gestor', type: 'ligacao', dayOffset: 0, assignee: 'executor', instructions: '' }] } };
    expect((await lucas.post('/abm/plays', body)).statusCode).toBe(403);
    expect((await carlos.post('/abm/plays', { ...body, definition: { ...body.definition, successCriteria: '' } })).statusCode).toBe(422);
    const id = ok(await carlos.post('/abm/plays', body), 201).json().id;
    expect((await carlos.post('/abm/plays', body)).statusCode).toBe(422); // nome repetido
    let p = ok(await carlos.get(`/abm/plays/${id}`)).json();
    const v2 = { ...body, rowVersion: p.rowVersion, note: 'Inclui reunião', definition: { ...body.definition, steps: [...body.definition.steps, { key: 'b', title: 'Reunião com o gestor', type: 'reuniao', dayOffset: 5, assignee: 'responsavel_conta', instructions: 'Levar casos' }] } };
    expect(ok(await carlos.put(`/abm/plays/${id}`, v2)).json().version).toBe(2);
    p = ok(await carlos.get(`/abm/plays/${id}`)).json();
    expect(ok(await carlos.put(`/abm/plays/${id}`, { ...v2, rowVersion: p.rowVersion, objective: 'Só o texto mudou' })).json().version).toBe(2);
    expect((await carlos.put(`/abm/plays/${id}`, { ...v2, rowVersion: p.rowVersion })).statusCode).toBe(409);
    expect(ok(await carlos.get(`/abm/plays/${id}`)).json().versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    ok(await carlos.post(`/abm/plays/${id}/active`, { active: false }));
  });

  it('sugestões com motivos; usam a influência avaliada pela equipe e não a alteram', async () => {
    decisor = ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'Helena Fictícia' }, title: 'Secretária', roles: ['decisor'], interest: 'alto' }), 201).json().id;
    let d = ok(await lucas.get(`/accounts/${contactId}/plays`)).json();
    const keys = (x: typeof d) => x.suggestions.map((s: { playName: string; stakeholderName: string | null }) => `${s.playName}:${s.stakeholderName ?? ''}`);
    expect(keys(d)).toContain('Abertura de conta:');
    expect(keys(d)).toContain('Relacionamento institucional:');
    expect(keys(d)).toContain('Mapeamento de decisores:');
    expect(keys(d)).not.toContain('Aproximação de decisor:Helena Fictícia'); // influência ainda não avaliada
    expect(keys(d).some((k: string) => k.startsWith(`Play próprio ${stamp}`))).toBe(false); // desativado
    ok(await lucas.post(`/stakeholders/${decisor}/influence`, { contextType: 'conta', contextKey: '', level: 'alto', justification: 'Assina os empenhos da secretaria' }));
    d = ok(await lucas.get(`/accounts/${contactId}/plays`)).json();
    const s = d.suggestions.find((x: { playName: string }) => x.playName === 'Aproximação de decisor');
    expect(s.stakeholderId).toBe(decisor);
    expect(s.reasons.join(' ')).toMatch(/avaliada pela equipe/);
    const before = ok(await lucas.get(`/stakeholders/${decisor}`)).json();
    expect(before.influence).toBe('alto');
    expect(before.influenceHistory).toHaveLength(1);
  });

  it('aplicar cria as tarefas com prazo e responsável; não duplica; encerrar exige etapas resolvidas', async () => {
    const open = byKey('abertura_conta');
    const runId = ok(await lucas.post(`/accounts/${contactId}/play-runs`, { playId: open.id, startOn: today, reason: 'Conta nova no programa', fromSuggestion: true }), 201).json().id;
    expect((await lucas.post(`/accounts/${contactId}/play-runs`, { playId: open.id, startOn: today, reason: 'De novo' })).statusCode).toBe(422);
    expect((await lucas.post(`/accounts/${contactId}/play-runs`, { playId: byKey('aproximacao_decisor').id, startOn: today, reason: 'Sem pessoa' })).statusCode).toBe(422);
    let d = ok(await lucas.get(`/accounts/${contactId}/plays`)).json();
    expect(d.suggestions.some((x: { playName: string }) => x.playName === 'Abertura de conta')).toBe(false);
    const run = d.runs.find((r: { id: string }) => r.id === runId);
    expect(run.steps).toHaveLength(5);
    expect(run.progress).toMatchObject({ total: 5, done: 0, canConclude: false });
    expect(run.steps[0].dueOn).toBe(today);
    const tasks = ok(await lucas.get(`/tasks/${run.steps[0].activityId}`)).json();
    expect(JSON.stringify(tasks)).toMatch(/Play: Abertura de conta/);
    expect((await lucas.post(`/play-runs/${runId}/conclude`, { outcome: 'Reunião feita com a secretária', successAchieved: true })).statusCode).toBe(422);
    for (const st of run.steps) await finishTask(lucas, st.activityId);
    ok(await lucas.post(`/play-runs/${runId}/conclude`, { outcome: 'Reunião feita com a secretária', successAchieved: true }));
    expect((await lucas.post(`/play-runs/${runId}/cancel`, { reason: 'Não faz mais sentido' })).statusCode).toBe(422);
    // play para a pessoa: etapas, cancelamento cancela as tarefas abertas
    const p2 = ok(await lucas.post(`/accounts/${contactId}/play-runs`, { playId: byKey('aproximacao_decisor').id, stakeholderId: decisor, startOn: today, reason: 'Decisora distante' }), 201).json().id;
    d = ok(await lucas.get(`/accounts/${contactId}/plays`)).json();
    expect(d.runs.find((r: { id: string }) => r.id === p2).steps[0].title).toMatch(/— Helena Fictícia$/);
    expect(ok(await lucas.post(`/play-runs/${p2}/cancel`, { reason: 'Secretária trocada na reforma' })).json().tasksCanceled).toBe(4);
    d = ok(await lucas.get(`/accounts/${contactId}/plays`)).json();
    expect(d.runs.find((r: { id: string }) => r.id === p2).steps.every((x: { stepStatus: string }) => x.stepStatus === 'cancelada')).toBe(true);
    const h = ok(await lucas.get(`/abm/${abmId}/360`)).json();
    expect(JSON.stringify(h)).toMatch(/play_iniciado|Play/);
    // fora da carteira
    expect((await rafael.get(`/accounts/${contactId}/plays`)).statusCode).toBe(404);
    expect(ok(await rafael.get('/abm/play-runs?status=concluido')).json().items.some((r: { id: string }) => r.id === runId)).toBe(false);
    expect(ok(await carlos.get('/abm/play-runs?status=concluido')).json().items.some((r: { id: string }) => r.id === runId)).toBe(true);
  });
});
