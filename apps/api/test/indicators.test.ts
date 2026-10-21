/** Indicadores (fórmula segura, crédito ponderado, indisponível), objetivos e metas em cascata com governança, scorecards. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let users: { id: string; email: string }[];
const uid = (n: string) => users.find((u) => u.email === `${n}@yepnet.test`)!.id;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
let teams: { id: string; name: string }[];
let indTarefas: string, indTempo: string;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas, rafael] = (await Promise.all(['carlos', 'ana', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  users = (await carlos.get('/admin/users')).json().users;
  teams = (await carlos.get('/meta/lookups')).json().teams;
});
afterAll(async () => ctx.close());

const tarefasDef = { name: 'Tarefas concluídas', category: 'tarefas', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'tarefa_concluida', measure: 'contagem' }, target: 4 };

describe('indicadores', () => {
  it('sugestões, criação validada e fórmula sem execução de código', async () => {
    const l = ok(await carlos.get('/performance/indicators')).json();
    expect(l.suggestions.length).toBeGreaterThan(5);
    ok(await carlos.post('/performance/indicators/suggested', { keys: ['vendas_ganhas', 'conversao', 'tempo_aprovacao'] }));
    expect(ok(await carlos.get('/performance/indicators')).json().items.map((i: { key: string }) => i.key)).toEqual(expect.arrayContaining(['vendas_ganhas', 'conversao']));
    const bad = await carlos.post('/performance/indicators', { def: { ...tarefasDef, calc: 'formula', vars: { a: tarefasDef.base }, expr: 'process.exit()' } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().detail).toMatch(/Fórmula/);
    expect((await lucas.post('/performance/indicators', { def: tarefasDef })).statusCode).toBe(403);
    indTarefas = ok(await carlos.post('/performance/indicators', { def: tarefasDef }), 201).json().id;
    indTempo = ok(await carlos.post('/performance/indicators', { def: { name: 'Tempo de solução', category: 'prazos', calc: 'tempo', unit: 'minutos', direction: 'menor', period: 'mes', base: { event: 'tarefa_concluida', measure: 'media_campo', field: 'minutesToComplete' }, minSample: 50 } }), 201).json().id;
  });

  it('valor com crédito ponderado: tarefa em dupla 50/50 conta meio para cada, inteira para a equipe', async () => {
    const st = ok(await carlos.get('/performance/settings')).json();
    ok(await carlos.put('/performance/settings', { config: { ...st.config, attribution: { ...st.config.attribution, tarefa_concluida: { ownerShareBp: 5000, participants: true, managers: false } } }, note: 'Dupla divide' }));
    const before = ok(await lucas.get(`/performance/indicators/${indTarefas}/value`)).json().value as number;
    const id = ok(await lucas.post('/tasks', { title: 'Tarefa dividida para indicador', dueOn: today(), participants: [uid('rafael')] }), 201).json().id;
    const t = ok(await lucas.get(`/tasks/${id}`)).json();
    ok(await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, status: 'concluida' }));
    ok(await carlos.post('/performance/sync'));
    const v = ok(await lucas.get(`/performance/indicators/${indTarefas}/value`)).json();
    expect(v.value).toBeCloseTo(before + 0.5, 5);
    expect(v.previous.range.to < v.range.from).toBe(true);
    expect(['verde', 'amarelo', 'vermelho']).toContain(v.color);
    const r = ok(await rafael.get(`/performance/indicators/${indTarefas}/value?userId=${uid('rafael')}`)).json();
    expect(r.value).toBeGreaterThanOrEqual(0.5);
    // vendedor não vê outra pessoa; líder vê a equipe
    expect((await rafael.get(`/performance/indicators/${indTarefas}/value?userId=${uid('lucas')}`)).statusCode).toBe(403);
    const team = teams.find((x) => x.name === 'Residencial')!;
    ok(await ana.get(`/performance/indicators/${indTarefas}/value?teamId=${team.id}`));
    // detalhamento até os eventos com o peso
    const ev = ok(await lucas.get(`/performance/indicators/${indTarefas}/events?from=${v.range.from}&to=${v.range.to}`)).json();
    expect(ev.parts[0].items.find((x: { source_id: string }) => x.source_id === id).weight_bp).toBe(5000);
    // amostra pequena = incompleto; tipo sem nenhum evento = indisponível
    expect(ok(await lucas.get(`/performance/indicators/${indTempo}/value`)).json().status).toBe('incompleto');
    ok(await carlos.put('/performance/settings', { config: st.config, note: 'Volta ao padrão' }));
    // tipo sem nenhum evento registrado na empresa = indisponível (não vira zero)
    const empty = ok(await carlos.get('/performance/catalog')).json().types.find((t: { counts: Record<string, number> }) => !t.counts.valido && !t.counts.pendente && !t.counts.invalidado);
    if (empty) {
      const pv = ok(await carlos.post('/performance/indicators/preview', { def: { ...tarefasDef, base: { event: empty.key, measure: 'contagem' } } })).json();
      expect(pv.status).toBe('indisponivel');
    }
  });

  it('nova versão preserva o histórico de definições', async () => {
    ok(await carlos.put(`/performance/indicators/${indTarefas}`, { def: { ...tarefasDef, target: 6 }, note: 'Meta padrão revista' }));
    const v = ok(await carlos.get(`/performance/indicators/${indTarefas}/versions`)).json().items;
    expect(v.map((x: { version: number }) => x.version)).toEqual([2, 1]);
    expect(v[1].def.target).toBe(4);
  });
});

describe('objetivos e metas em cascata', () => {
  let objE: string, objT: string, gEmp: string, gTeam: string, gInd: string;
  it('objetivo estratégico só com visão total; tático precisa de superior acima', async () => {
    const start = `${today().slice(0, 7)}-01`;
    expect((await ana.post('/performance/objectives', { title: 'Aumentar a receita', level: 'estrategico', periodStart: start, periodEnd: '2026-12-31' })).statusCode).toBe(403);
    objE = ok(await carlos.post('/performance/objectives', { title: 'Aumentar a receita comercial', level: 'estrategico', periodStart: start, periodEnd: '2026-12-31', sponsorId: uid('carlos') }), 201).json().id;
    objT = ok(await ana.post('/performance/objectives', { title: 'Elevar a conversão', level: 'tatico', parentId: objE, periodStart: start, periodEnd: '2026-12-31' }), 201).json().id;
    expect((await carlos.post('/performance/objectives', { title: 'Invertido', level: 'estrategico', parentId: objT, periodStart: start, periodEnd: '2026-12-31' })).statusCode).toBe(422);
  });

  it('meta da empresa desdobrada para equipe e pessoa; período e nível respeitados', async () => {
    const team = teams.find((x) => x.name === 'Residencial')!;
    gEmp = ok(await carlos.post('/performance/goals', { title: 'Tarefas da empresa', scope: 'empresa', indicatorId: indTarefas, periodType: 'mes', target: 40, objectiveId: objE, consolidation: 'soma' }), 201).json().id;
    expect((await ana.post('/performance/goals', { title: 'Empresa pela supervisora', scope: 'empresa', indicatorId: indTarefas, periodType: 'mes', target: 1 })).statusCode).toBe(403);
    gTeam = ok(await ana.post('/performance/goals', { title: 'Tarefas do Residencial', scope: 'equipe', teamId: team.id, indicatorId: indTarefas, periodType: 'mes', target: 20, parentGoalId: gEmp, objectiveId: objT }), 201).json().id;
    gInd = ok(await ana.post('/performance/goals', { title: 'Tarefas do Lucas', scope: 'individual', userId: uid('lucas'), indicatorId: indTarefas, periodType: 'mes', target: 4, parentGoalId: gTeam }), 201).json().id;
    expect((await ana.post('/performance/goals', { title: 'Acima da superior', scope: 'empresa', indicatorId: indTarefas, periodType: 'mes', target: 1, parentGoalId: gTeam })).statusCode).toBe(403);
    expect((await carlos.post('/performance/goals', { title: 'Fora do período', scope: 'individual', userId: uid('lucas'), indicatorId: indTarefas, periodType: 'ano', target: 1, parentGoalId: gTeam })).statusCode).toBe(422);
    expect((await lucas.post('/performance/goals', { title: 'Própria', scope: 'individual', userId: uid('lucas'), indicatorId: indTarefas, periodType: 'mes', target: 1 })).statusCode).toBe(403);
    const d = ok(await carlos.get(`/performance/goals/${gEmp}`)).json();
    expect(d.children.map((c: { id: string }) => c.id)).toEqual([gTeam]);
    expect(d.consolidated).not.toBeNull();
    const mine = ok(await lucas.get(`/performance/goals?userId=${uid('lucas')}&current=true`)).json().items.find((x: { id: string }) => x.id === gInd);
    expect(mine.progress).toMatchObject({ indicatorStatus: 'ok', closed: false });
    expect(['verde', 'amarelo', 'vermelho']).toContain(mine.progress.color);
    const objs = ok(await carlos.get('/performance/objectives')).json().items;
    expect(objs.find((o: { id: string }) => o.id === objT).goals.map((g: { id: string }) => g.id)).toContain(gTeam);
  });

  it('governança: depois do início, alterar o alvo exige motivo, não pode ser pela própria pessoa e preserva o original', async () => {
    let g = ok(await lucas.get(`/performance/goals/${gInd}`)).json();
    expect((await lucas.patch(`/performance/goals/${gInd}`, { rowVersion: g.rowVersion, target: 1, reason: 'Quero uma meta menor' })).statusCode).toBe(403);
    expect((await ana.patch(`/performance/goals/${gInd}`, { rowVersion: g.rowVersion, target: 6 })).statusCode).toBe(422);
    ok(await ana.patch(`/performance/goals/${gInd}`, { rowVersion: g.rowVersion, target: 6, reason: 'Nova carteira assumida no mês' }));
    g = ok(await lucas.get(`/performance/goals/${gInd}`)).json();
    expect(g).toMatchObject({ target: 6, originalTarget: 4, version: 2 });
    expect(g.events[0]).toMatchObject({ type: 'revisao', payload: expect.objectContaining({ from: 4, to: 6, original: 4, reason: 'Nova carteira assumida no mês' }) });
  });

  it('meta manual com apontamentos', async () => {
    const id = ok(await ana.post('/performance/goals', { title: 'Visitas a síndicos', scope: 'individual', userId: uid('lucas'), manualUnit: 'visitas', periodType: 'mes', target: 10, category: 'operacional' }), 201).json().id;
    ok(await lucas.post(`/performance/goals/${id}/checkins`, { value: 5, note: 'Cinco visitas na primeira quinzena' }), 201);
    const g = ok(await lucas.get(`/performance/goals/${id}`)).json();
    expect(g.progress).toMatchObject({ value: 5, indicatorStatus: 'manual' });
    expect((await lucas.post(`/performance/goals/${gInd}/checkins`, { value: 1, note: 'não pode' })).statusCode).toBe(422);
  });
});

describe('scorecards', () => {
  it('por perfil, pesos normalizados, sem meta não pontua, composição explícita', async () => {
    const conv = ok(await carlos.get('/performance/indicators')).json().items.find((i: { key: string }) => i.key === 'conversao').id;
    const vend = ok(await carlos.post('/performance/scorecards', { name: 'Vendedor', appliesProfiles: ['vendedor'], def: { items: [{ indicatorId: indTarefas, weight: 30, target: 2 }, { indicatorId: conv, weight: 10 }], cap: 1.2 } }), 201).json().id;
    expect((await carlos.post('/performance/scorecards', { name: 'Vazio', def: { items: [], cap: 1.2 } })).statusCode).toBe(422);
    const r = ok(await lucas.get(`/performance/scorecards/for/${uid('lucas')}`)).json();
    const card = r.cards.find((c: { scorecardId: string }) => c.scorecardId === vend);
    expect(card.items.map((i: { norm: number }) => i.norm)).toEqual([0.75, 0.25]);
    expect(card.score).not.toBeNull();
    expect(r.composite).toBe(card.score);
    // pessoa com duas funções: composição explícita
    const ops = ok(await carlos.post('/performance/scorecards', { name: 'Operações', appliesProfiles: [], def: { items: [{ indicatorId: indTarefas, weight: 1, target: 100 }], cap: 1.2 } }), 201).json().id;
    ok(await carlos.put(`/performance/scorecards/assignments/${uid('lucas')}`, { items: [{ scorecardId: vend, weight: 70 }, { scorecardId: ops, weight: 30 }] }));
    const r2 = ok(await lucas.get(`/performance/scorecards/for/${uid('lucas')}`)).json();
    expect(r2.cards).toHaveLength(2);
    expect(r2.cards.every((c: { source: string }) => c.source === 'atribuido')).toBe(true);
    expect((await rafael.get(`/performance/scorecards/for/${uid('lucas')}`)).statusCode).toBe(403);
  });
});
