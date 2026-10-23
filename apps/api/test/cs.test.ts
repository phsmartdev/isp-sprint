/** Sucesso do Cliente: jornada automática, kickoff, Tier, IPC, classe, saúde, criticidade, prioridade, cadência, cobertura, alertas e painéis. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, mariana: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const today = new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
let contactId: string, contractId: string, csOppId: string, journeyId: string, marianaId: string;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, mariana] = (await Promise.all(['carlos', 'lucas', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const users = (await carlos.get('/admin/users')).json().users as { id: string; email: string }[];
  marianaId = users.find((u) => u.email === 'mariana@yepnet.test')!.id;
  ok(await carlos.patch(`/admin/users/${marianaId}`, { sectors: ['sucesso_cliente'] }));
  mariana = await login(ctx.app, 'mariana@yepnet.test');
});
afterAll(async () => ctx.close());

describe('jornada automática e kickoff', () => {
  it('contrato validado entra no funil Sucesso do Cliente; a etapa Planejamento inicia a jornada uma vez só', async () => {
    const plan = (await carlos.get('/meta/lookups')).json().plans[0];
    const o = ok(await lucas.post('/opportunities', { newContact: { name: 'Hospital Fictício CS', segment: 'empresarial' }, planId: plan.id, cableMeters: 50, saleType: 'ativa' }), 201).json();
    contactId = o.contactId;
    ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
    contractId = ok(await carlos.post('/contracts', { opportunityId: o.id, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { number: 'CS-1', object: 'Conectividade hospitalar fictícia', signedAt: addDays(today, -400), startAt: addDays(today, -400), termMonths: 24, monthlyCents: 1_500_000, items: [{ planId: null, description: 'Link dedicado 1 Gbps', qty: 1, unitCents: 1_500_000 }] } }), 201).json().id;
    ok(await carlos.post(`/contracts/${contractId}/validate`));
    const [cs] = (await ctx.db.execute(sql`select o.id, o.stage, o.row_version from opportunities o join pipelines p on p.id = o.pipeline_id where p.key = 'sucesso_cliente' and o.duplicated_from_id = ${o.id}`)).rows as { id: string; stage: string; row_version: number }[];
    expect(cs!.stage).toBe('acionado');
    csOppId = cs!.id;
    ok(await carlos.patch(`/cs/accounts/${contactId}`, { csmId: marianaId, justification: 'Carteira hospitalar' }));
    ok(await carlos.post(`/opportunities/${csOppId}/transition`, { toStage: 'planejamento', rowVersion: cs!.row_version }));
    const js = ok(await carlos.get(`/cs/journeys?contractId=${contractId}`)).json().items;
    expect(js).toHaveLength(1);
    journeyId = js[0].id;
    expect(js[0]).toMatchObject({ csmId: marianaId, status: 'ativa' });
    // volta e entra de novo na etapa: sem duplicar
    const rv = (await carlos.get(`/opportunities/${csOppId}`)).json().rowVersion;
    ok(await carlos.post(`/opportunities/${csOppId}/transition`, { toStage: 'acionado', rowVersion: rv, reason: 'teste' }));
    ok(await carlos.post(`/opportunities/${csOppId}/transition`, { toStage: 'planejamento', rowVersion: rv + 1 }));
    expect(ok(await carlos.get(`/cs/journeys?contractId=${contractId}`)).json().items).toHaveLength(1);
  });

  it('marcos com datas (renovação pela vigência real), tarefas do onboarding e kickoff com pendências sinalizadas', async () => {
    const j = ok(await mariana.get(`/cs/journeys/${journeyId}`)).json();
    const keys = j.milestones.map((m: { key: string }) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['boas_vindas', 'kickoff', 'd30', 'd60', 'd90', 'formalizacao_ren']));
    const ren = j.milestones.find((m: { key: string }) => m.key === 'formalizacao_ren');
    expect(ren.plannedAt).toBe(addDays(j.contract.endAt, -30)); // ancorado no fim real da vigência
    expect(j.milestones.find((m: { key: string }) => m.key === 'kickoff').activityId).toBeTruthy();
    const slides = j.presentation.slides as { key: string; body: string; pending: string[] }[];
    expect(slides[0]!.body).toContain('Hospital Fictício CS');
    expect(slides.find((x) => x.key === 'sla')!.pending.length).toBeGreaterThan(0); // SLA não cadastrado: pendente, não inventado
    ok(await mariana.post(`/cs/journeys/${journeyId}/presentation`, { slides: slides.map((x) => (x.key === 'sla' ? { ...x, body: 'Disponibilidade 99,7% (revisado pelo CSM)', pending: [] } : x)), note: 'SLA revisado' }), 201);
    const after = ok(await mariana.get(`/cs/journeys/${journeyId}`)).json();
    expect(after.versions).toHaveLength(2);
    // dado oficial do contrato não muda
    expect((await carlos.get(`/contracts/${contractId}`)).json().current.object).toBe('Conectividade hospitalar fictícia');
    const share = ok(await mariana.post(`/cs/journeys/${journeyId}/share`, {})).json();
    const pub = ok(await ctx.app.inject({ method: 'GET', url: `/api/v1/public/kickoff/${share.url.split('/k/')[1]}` }));
    expect(pub.json().slides.every((x: { pending: string[] }) => x.pending.length === 0)).toBe(true);
    ok(await mariana.post(`/cs/journeys/${journeyId}/kickoff`, { at: new Date().toISOString(), participants: 'Diretoria do hospital, CSM', notes: 'Cronograma validado com o cliente.' }));
    expect(ok(await mariana.get(`/cs/journeys/${journeyId}`)).json().milestones.find((m: { key: string }) => m.key === 'kickoff').doneAt).toBeTruthy();
  });
});

describe('inteligência da conta', () => {
  it('Tier pelo ACV consolidado e histórico preservado', async () => {
    const a = ok(await mariana.get(`/cs/accounts/${contactId}`)).json();
    expect(a.snapshot.acvCents).toBe(18_000_000);
    expect(a.snapshot.tier).toBe('middle');
    expect(a.history.some((h: { kind: string; level: string }) => h.kind === 'tier' && h.level === 'middle')).toBe(true);
    expect(a.snapshot.financial.available).toBe(false); // sem IXC: inadimplência indisponível, não "adimplente"
  });
  it('IPC: objetivos calculados, qualitativos avaliados; incompleto não tem total', async () => {
    ok(await mariana.post(`/cs/accounts/${contactId}/ipc`, { levels: { potencial: 'alto', segmento: 'alto' }, justification: 'Avaliação inicial parcial' }));
    let a = ok(await mariana.get(`/cs/accounts/${contactId}`)).json();
    expect(a.snapshot.ipc.total).toBeNull();
    expect(a.snapshot.ipc.pending).toEqual(expect.arrayContaining(['criticidade', 'relacionamento', 'maturidade']));
    ok(await mariana.post(`/cs/accounts/${contactId}/ipc`, { levels: { potencial: 'alto', segmento: 'alto', criticidade: 'alto', relacionamento: 'medio', maturidade: 'medio', tamanho: 'baixo' }, justification: 'Avaliação trimestral completa', evidence: 'Reunião com diretoria' }));
    a = ok(await mariana.get(`/cs/accounts/${contactId}`)).json();
    // tamanho é objetivo (Middle = 20) e não é sobrescrito; tempo > 24 meses? 400 dias → 6–24 meses = 5
    expect(a.snapshot.ipc.total).toBe(20 + 20 + 10 + 10 + 5 + 5 + 5);
    expect(a.ipcHistory).toHaveLength(2);
  });
  it('Classe Estratégica independente do IPC e só pela liderança', async () => {
    ok(await mariana.post(`/contacts/${contactId}/classification`, { classKey: 'Reputação' }), 403);
    ok(await carlos.post(`/contacts/${contactId}/classification`, { classKey: 'Reputação', notes: 'Hospital de referência' }), 201);
    ok(await mariana.post('/cs/recompute', { contactId }));
    const a = ok(await mariana.get(`/cs/accounts/${contactId}`)).json();
    expect(a.snapshot.classKey).toBe('Reputação');
    expect(a.snapshot.ipc.total).toBe(75);
  });
  it('saúde com dados reais, criticidade explicada e prioridade manual separada', async () => {
    ok(await mariana.post(`/cs/accounts/${contactId}/surveys`, { kind: 'nps', score: 9, scale: 10, respondedAt: today }), 201);
    let a = ok(await mariana.get(`/cs/accounts/${contactId}`)).json();
    expect(a.snapshot.health.parts.find((p: { key: string }) => p.key === 'inadimplencia').value).toBeNull();
    expect(a.snapshot.health.parts.find((p: { key: string }) => p.key === 'satisfacao').value).toBe(90);
    const calc = a.snapshot.criticality.level;
    ok(await mariana.post(`/cs/accounts/${contactId}/priority`, { level: 'critica', reason: 'Diretoria pediu atenção máxima', reviewAt: null }), 422);
    ok(await mariana.post(`/cs/accounts/${contactId}/priority`, { level: 'critica', reason: 'Diretoria pediu atenção máxima', reviewAt: addDays(today, 30) }));
    a = ok(await mariana.get(`/cs/accounts/${contactId}`)).json();
    expect(a.snapshot.criticality.level).toBe(calc); // calculada preservada
    expect(a.snapshot.effective).toEqual({ level: 'critica', source: 'manual' });
    expect(a.reason).toContain('prioridade manual');
    await expect(ctx.db.execute(sql`update cs_assessments set level = 'x'`)).rejects.toThrow(/append-only/);
  });
});

describe('cadência, cobertura, alertas e painéis', () => {
  it('cadência gera acompanhamentos sem duplicar e preserva concluídos', async () => {
    ok(await mariana.post('/cs/recompute', { contactId }));
    const n1 = Number(((await ctx.db.execute(sql`select count(*)::int n from activities where contact_id = ${contactId} and cs_cadence_key is not null and deleted_at is null`)).rows[0] as { n: number }).n);
    expect(n1).toBeGreaterThan(5); // crítica: contato semanal no horizonte
    ok(await mariana.post('/cs/recompute', { contactId }));
    const n2 = Number(((await ctx.db.execute(sql`select count(*)::int n from activities where contact_id = ${contactId} and cs_cadence_key is not null and deleted_at is null`)).rows[0] as { n: number }).n);
    expect(n2).toBe(n1);
  });
  it('cobertura só conta o realizado com resultado; extras ficam à parte', async () => {
    const [first] = (await ctx.db.execute(sql`select id, row_version from activities where contact_id = ${contactId} and cs_kind = 'contato' and cs_cadence_key is not null and deleted_at is null order by cs_planned_at limit 1`)).rows as { id: string; row_version: number }[];
    // concluir sem resultado não vale como execução
    ok(await mariana.patch(`/activities/${first!.id}`, { completed: true, rowVersion: first!.row_version }));
    let p = ok(await mariana.get(`/cs/portfolio?from=${today}&to=${addDays(today, 1)}`)).json();
    let acc = p.accounts.find((x: { contactId: string }) => x.contactId === contactId);
    expect(acc.coverage.onTime).toBe(0);
    // concluída sem resultado: o resultado pode ser registrado depois, e aí passa a contar
    ok(await mariana.post(`/cs/accounts/${contactId}/followups`, { activityId: first!.id, kind: 'contato', result: 'Ligação registrada depois com o resultado.' }), 201);
    p = ok(await mariana.get(`/cs/portfolio?from=${today}&to=${addDays(today, 1)}`)).json();
    acc = p.accounts.find((x: { contactId: string }) => x.contactId === contactId);
    expect(acc.coverage.onTime).toBe(1);
  });
  it('registrar resultado conta no prazo; ação extra não infla o cumprimento', async () => {
    const [next] = (await ctx.db.execute(sql`select id from activities where contact_id = ${contactId} and cs_kind = 'contato' and cs_cadence_key is not null and completed_at is null and deleted_at is null order by cs_planned_at limit 1`)).rows as { id: string }[];
    ok(await mariana.post(`/cs/accounts/${contactId}/followups`, { activityId: next!.id, kind: 'contato', result: 'Ligação com a diretoria: tudo funcionando.' }), 201);
    ok(await mariana.post(`/cs/accounts/${contactId}/followups`, { kind: 'contato', result: 'Contato extra por WhatsApp.' }), 201);
    const c = ok(await carlos.get(`/cs/coverage?from=${addDays(today, -1)}&to=${addDays(today, 30)}&groupBy=csm`)).json();
    const g = c.groups.find((x: { key: string }) => x.key === 'Mariana Costa' || x.key.startsWith('Mariana'));
    expect(g.extra).toBeGreaterThanOrEqual(1);
    expect(g.simple).toBeLessThanOrEqual(1);
    expect(g.onTime).toBeGreaterThanOrEqual(1);
    expect(g.weighted).not.toBeNull();
  });
  it('visita: realizada exige resumo e gera tarefas dos próximos passos', async () => {
    const v = ok(await mariana.post(`/cs/accounts/${contactId}/visits`, { type: 'Relacionamento', objective: 'Revisar a operação com a diretoria', plannedAt: new Date(Date.now() - 3600_000).toISOString(), contractIds: [contractId] }), 201).json();
    ok(await mariana.patch(`/cs/visits/${v.id}`, { status: 'realizada', summary: 'curto' }), 422);
    ok(await mariana.patch(`/cs/visits/${v.id}`, { status: 'realizada', summary: 'Visita com a diretoria; satisfação alta e pedido de mais um link.', opportunities: 'Segundo link para a unidade nova', nextSteps: [{ title: 'Enviar proposta do segundo link', dueAt: addDays(today, 5) }] }));
    const t = await ctx.db.execute(sql`select count(*)::int n from activities where contact_id = ${contactId} and title = 'Enviar proposta do segundo link'`);
    expect((t.rows[0] as { n: number }).n).toBe(1);
  });
  it('alertas preventivos, contas que precisam de atenção com motivo e painel gerencial', async () => {
    ok(await carlos.post('/cs/recompute', {}));
    const a = ok(await mariana.get(`/cs/accounts/${contactId}`)).json();
    expect(a.alerts.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining(['upgrade_identificado']));
    const p = ok(await mariana.get('/cs/portfolio')).json();
    expect(p.accounts[0].reason.length).toBeGreaterThan(5);
    expect(p.priorities.length).toBeGreaterThan(0);
    expect(p.criticalLate).toHaveProperty('ofCritical');
    ok(await lucas.get('/cs/team'), 403);
    const team = ok(await carlos.get('/cs/team')).json();
    const m = team.csms.find((x: { csmId: string }) => x.csmId === marianaId);
    expect(m.capacity.demandHours).toBeGreaterThan(0);
    expect(m.scorecard).toHaveProperty('operacional');
    expect(m.gamification.points).toBeGreaterThan(0);
  });
  it('configuração versionada recusa regra inválida', async () => {
    const cfg = ok(await carlos.get('/cs/config')).json();
    ok(await carlos.post('/cs/config', { config: { critThresholds: { moderada: 50, alta: 40, critica: 60 } }, note: 'Teste inválido' }), 422);
    ok(await carlos.post('/cs/config', { config: { coverageWeights: { baixa: 1, moderada: 2, alta: 4, critica: 6 } }, note: 'Pesos de cobertura revistos' }), 201);
    expect(ok(await carlos.get('/cs/config')).json().version).toBe(cfg.version + 1);
    ok(await mariana.post('/cs/config', { config: {}, note: 'sem permissão' }), 403);
  });
});
