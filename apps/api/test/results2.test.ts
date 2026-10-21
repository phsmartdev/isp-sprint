/** Gestão de Resultados fases 3–4: metas por área com aprovação, pedido de revisão, apuração oficial versionada e série mensal. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client, mariana: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let users: { id: string; email: string }[];
const uid = (n: string) => users.find((u) => u.email === `${n}@yepnet.test`)!.id;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const monthAgo = () => { const d = new Date(`${today()}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); };
let ind: string, area: string;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas, mariana] = (await Promise.all(['carlos', 'ana', 'lucas', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  users = (await carlos.get('/admin/users')).json().users;
  ind = ok(await carlos.post('/performance/indicators', { def: { name: 'Tarefas concluídas GR', category: 'tarefas', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'tarefa_concluida', measure: 'contagem' } } }), 201).json().id;
  const org = ok(await carlos.get('/results/org')).json();
  const dir = org.units.find((u: { kind: string; name: string }) => u.kind === 'diretoria')?.id ?? ok(await carlos.post('/results/org/units', { name: 'Diretoria GR', kind: 'diretoria', responsibleId: uid('carlos') }), 201).json().id;
  area = ok(await carlos.post('/results/org/units', { name: 'Área GR', kind: 'area', parentId: dir, responsibleId: uid('mariana') }), 201).json().id;
});
afterAll(async () => ctx.close());

describe('planejamento', () => {
  it('meta da área nasce como proposta; a instância acima aprova; quem propôs não aprova; empresa só pela Diretoria', async () => {
    const id = ok(await mariana.post('/performance/goals', { title: 'Tarefas da Área GR', scope: 'unidade', orgUnitId: area, indicatorId: ind, periodType: 'mes', target: 30 }), 201).json().id;
    let g = ok(await mariana.get(`/performance/goals/${id}`)).json();
    expect(g.approvalStatus).toBe('proposta');
    expect((await mariana.post(`/performance/goals/${id}/approve`, { approve: true })).statusCode).toBe(403);
    expect((await mariana.post('/performance/goals', { title: 'Empresa pela gestora', scope: 'empresa', indicatorId: ind, periodType: 'mes', target: 1 })).statusCode).toBe(403);
    ok(await carlos.post(`/performance/goals/${id}/approve`, { approve: true, note: 'De acordo' }));
    g = ok(await mariana.get(`/performance/goals/${id}`)).json();
    expect(g.approvalStatus).toBe('aprovada');
    expect(g.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['proposta', 'aprovada']));
  });

  it('pedido de revisão: quem não tem alçada pede com justificativa; a liderança decide; vira nova versão', async () => {
    const id = ok(await ana.post('/performance/goals', { title: 'Tarefas do Lucas GR', scope: 'individual', userId: uid('lucas'), indicatorId: ind, periodType: 'mes', target: 8 }), 201).json().id;
    expect((await lucas.post(`/performance/goals/${id}/revision-requests`, { toTarget: 5, reason: 'curto' })).statusCode).toBe(422);
    const r = ok(await lucas.post(`/performance/goals/${id}/revision-requests`, { toTarget: 5, reason: 'Férias de uma semana no mês' }), 201).json();
    expect((await lucas.post(`/performance/goals/${id}/revision-requests`, { toTarget: 4, reason: 'Outro pedido em cima do primeiro' })).statusCode).toBe(422);
    expect((await lucas.post(`/performance/goal-revisions/${r.id}/decide`, { approve: true })).statusCode).toBe(403);
    expect(ok(await ana.get('/performance/goal-revisions')).json().items.map((x: { id: string }) => x.id)).toContain(r.id);
    ok(await ana.post(`/performance/goal-revisions/${r.id}/decide`, { approve: true, note: 'Ok, férias aprovadas' }));
    const g = ok(await lucas.get(`/performance/goals/${id}`)).json();
    expect(g).toMatchObject({ target: 5, originalTarget: 8, version: 2 });
  });
});

describe('apuração oficial', () => {
  let past: string;
  it('período encerrado gera apuração consolidada (v1) imutável', async () => {
    past = ok(await carlos.post('/performance/goals', { title: 'Tarefas passadas do Lucas', scope: 'individual', userId: uid('lucas'), indicatorId: ind, periodType: 'personalizado', periodStart: '2026-01-01', periodEnd: '2026-01-31', target: 10 }), 201).json().id;
    const g = ok(await lucas.get(`/performance/goals/${past}`)).json();
    expect(g.progress).toMatchObject({ closed: true, closing: { version: 1, status: 'consolidado', competencia: '2026-01' } });
    const h = ok(await ana.get(`/results/closings/${past}`)).json();
    expect(h.competencias).toHaveLength(1);
    const c = h.competencias[0].current;
    expect(c).toMatchObject({ status: 'consolidado', target: 10 });
    // sem dado de origem não vira cor (nem zero): nada é inventado
    if (c.value === null) expect(c).toMatchObject({ color: 'sem_dado', quality: 'sem_dado' });
    else expect(c.color).toBe('vermelho');
    expect((await carlos.patch(`/performance/goals/${past}`, { rowVersion: g.rowVersion, target: 1, reason: 'Tentando mudar depois do fechamento' })).statusCode).toBe(422);
  });

  it('validar e retificar geram novas versões; o avaliado não mexe no próprio resultado', async () => {
    expect((await lucas.post(`/results/closings/${past}/validate`, {})).statusCode).toBe(403);
    ok(await ana.post(`/results/closings/${past}/validate`, { note: 'Conferido' }));
    expect((await ana.post(`/results/closings/${past}/validate`, {})).statusCode).toBe(422);
    const drift = ok(await ana.get(`/results/closings/${past}/drift`)).json();
    expect(drift).toHaveProperty('changed');
    expect((await ana.post(`/results/closings/${past}/rectify`, { reason: 'curto' })).statusCode).toBe(422);
    ok(await ana.post(`/results/closings/${past}/rectify`, { reason: 'Reprocessamento após correção de tarefas' }));
    const h = ok(await ana.get(`/results/closings/${past}`)).json();
    expect(h.competencias[0].versions.map((v: { status: string }) => v.status)).toEqual(['consolidado', 'validado', 'retificado']);
    expect(h.competencias[0].current.version).toBe(3);
  });

  it('meta mensal recorrente: a série ganha a competência do mês e o mês anterior fecha', async () => {
    const id = ok(await ana.post('/performance/goals', { title: 'Série mensal do Lucas', scope: 'individual', userId: uid('lucas'), indicatorId: ind, periodType: 'mes', ref: monthAgo(), target: 3, recurring: true }), 201).json().id;
    expect((await ana.post('/performance/goals', { title: 'Trimestral recorrente', scope: 'individual', userId: uid('lucas'), indicatorId: ind, periodType: 'trimestre', target: 3, recurring: true })).statusCode).toBe(422);
    const cur = ok(await lucas.get(`/performance/goals?userId=${uid('lucas')}&current=true`)).json().items.filter((x: { title: string }) => x.title === 'Série mensal do Lucas');
    expect(cur).toHaveLength(1);
    expect(cur[0].id).not.toBe(id);
    // segunda chamada não duplica
    ok(await lucas.get(`/performance/goals?current=true`));
    const again = ok(await lucas.get(`/performance/goals?userId=${uid('lucas')}&current=true`)).json().items.filter((x: { title: string }) => x.title === 'Série mensal do Lucas');
    expect(again).toHaveLength(1);
    ok(await lucas.get(`/performance/goals/${id}`)); // fecha o mês anterior
    const h = ok(await ana.get(`/results/closings/${cur[0].id}`)).json();
    expect(h.seriesId).toBe(id);
    expect(h.competencias.map((c: { competencia: string }) => c.competencia)).toEqual([monthAgo().slice(0, 7)]);
  });
});
