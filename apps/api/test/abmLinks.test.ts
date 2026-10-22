/** ABM Fase 8 — vínculos de pessoas com oportunidade, contrato e lead; influência por oportunidade (manual); plays na oportunidade; IDs externos preservados. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
const today = new Date().toISOString().slice(0, 10);
let contactId: string, abmId: string, oppId: string, contractId: string, helena: string, joao: string, otherSt: string;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, rafael] = (await Promise.all(['carlos', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const a = ok(await lucas.post('/abm/new-account', { name: `Prefeitura Fictícia Integra ${stamp}`, nature: 'publica', segment: 'governamental', reason: 'Programa de cidades conectadas' }), 201).json();
  contactId = a.contactId; abmId = a.id;
  helena = ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'Helena Fictícia' }, title: 'Secretária', roles: ['decisor'] }), 201).json().id;
  joao = ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'João Fictício' }, title: 'Fiscal' }), 201).json().id;
  const other = ok(await lucas.post('/abm/new-account', { name: `Consórcio Fictício Integra ${stamp}`, reason: 'Outra conta para teste' }), 201).json();
  otherSt = ok(await lucas.post(`/accounts/${other.contactId}/stakeholders`, { person: { name: 'Pessoa de Outra Conta' } }), 201).json().id;
  const plan = (await carlos.get('/meta/lookups')).json().plans[0];
  oppId = ok(await lucas.post('/opportunities', { contactId, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false }), 201).json().id;
  const won = ok(await lucas.post('/opportunities', { contactId, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false }), 201).json().id;
  ok(await carlos.post(`/opportunities/${won}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${won}`)).json().rowVersion }));
  contractId = ok(await carlos.post('/contracts', { opportunityId: won, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { number: `IN-${stamp}`, object: 'Conectividade fictícia', signedAt: today, startAt: today, termMonths: 12, monthlyCents: 100_000, items: [{ planId: null, description: 'Link', qty: 1, unitCents: 100_000 }] } }), 201).json().id;
});
afterAll(async () => ctx.close());

describe('integrações do ABM', () => {
  it('pessoa ligada à oportunidade e ao contrato com o papel de cada um; regras e histórico', async () => {
    const l1 = ok(await lucas.post('/abm/entity-links', { entity: 'oportunidade', entityId: oppId, stakeholderId: helena, role: 'decisor' }), 201).json().id;
    expect((await lucas.post('/abm/entity-links', { entity: 'oportunidade', entityId: oppId, stakeholderId: helena, role: 'decisor' })).statusCode).toBe(422); // já ligada
    expect((await lucas.post('/abm/entity-links', { entity: 'contrato', entityId: contractId, stakeholderId: joao, role: 'bloqueador' })).statusCode).toBe(422); // papel inválido p/ contrato
    expect((await lucas.post('/abm/entity-links', { entity: 'oportunidade', entityId: oppId, stakeholderId: otherSt, role: 'decisor' })).statusCode).toBe(422); // outra conta
    ok(await lucas.post('/abm/entity-links', { entity: 'contrato', entityId: contractId, stakeholderId: joao, role: 'fiscal_contrato' }), 201);
    const d = ok(await lucas.get(`/abm/entity-links?entity=oportunidade&id=${oppId}`)).json();
    expect(d.abm).toMatchObject({ id: abmId, status: 'candidata' });
    expect(d.links).toHaveLength(1);
    expect(d.links[0]).toMatchObject({ name: 'Helena Fictícia', role: 'decisor', influence: 'nao_avaliado', influenceHere: null });
    expect(d.people.map((p: { name: string }) => p.name).sort()).toEqual(['Helena Fictícia', 'João Fictício']);
    // influência na oportunidade: só pela avaliação manual existente (contexto oportunidade)
    ok(await lucas.post(`/stakeholders/${helena}/influence`, { contextType: 'oportunidade', contextKey: oppId, contextLabel: 'OP desta negociação', level: 'muito_alto', justification: 'Assina a homologação desta compra' }));
    const d2 = ok(await lucas.get(`/abm/entity-links?entity=oportunidade&id=${oppId}`)).json();
    expect(d2.links[0]).toMatchObject({ influence: 'nao_avaliado', influenceHere: 'muito_alto' });
    // mudar papel e desfazer com motivo
    ok(await lucas.patch(`/abm/entity-links/${l1}`, { rowVersion: 1, role: 'patrocinador' }));
    expect((await lucas.patch(`/abm/entity-links/${l1}`, { rowVersion: 1, role: 'decisor' })).statusCode).toBe(422);
    let st = ok(await lucas.get(`/stakeholders/${helena}`)).json();
    expect(st.links).toEqual([expect.objectContaining({ entityType: 'oportunidade', role: 'patrocinador', path: `/opportunities/${oppId}` })]);
    expect((await lucas.post(`/abm/entity-links/${l1}/remove`, { reason: 'x' })).statusCode).toBe(422);
    ok(await lucas.post(`/abm/entity-links/${l1}/remove`, { reason: 'Saiu da comissão de compra' }));
    st = ok(await lucas.get(`/stakeholders/${helena}`)).json();
    expect(st.links).toEqual([]);
    expect(st.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['vinculo_incluido', 'vinculo_alterado', 'vinculo_removido']));
    // pode ligar de novo depois de desfeito
    ok(await lucas.post('/abm/entity-links', { entity: 'oportunidade', entityId: oppId, stakeholderId: helena, role: 'decisor' }), 201);
    expect((await rafael.get(`/abm/entity-links?entity=oportunidade&id=${oppId}`)).statusCode).toBe(404);
  });

  it('play ligado à oportunidade: tarefas aparecem nela; oportunidade encerrada é recusada', async () => {
    const plays = ok(await lucas.get('/abm/plays')).json().items as { id: string; templateKey: string }[];
    const pid = plays.find((p) => p.templateKey === 'abertura_conta')!.id;
    const acc = ok(await lucas.get(`/accounts/${contactId}/plays`)).json();
    expect(acc.opportunities.map((o: { id: string }) => o.id)).toContain(oppId);
    const run = ok(await lucas.post(`/accounts/${contactId}/play-runs`, { playId: pid, opportunityId: oppId, startOn: today, reason: 'Preparar a proposta' }), 201).json().id;
    const n = (await ctx.db.execute(sql`select count(*)::int as n from activities a join abm_play_run_steps r on r.activity_id = a.id where r.run_id = ${run} and a.opportunity_id = ${oppId}`)).rows[0] as { n: number };
    expect(n.n).toBe(5);
    const d = ok(await lucas.get(`/abm/entity-links?entity=oportunidade&id=${oppId}`)).json();
    expect(d.plays).toEqual([expect.objectContaining({ id: run, play: 'Abertura de conta', status: 'em_andamento' })]);
    expect(ok(await lucas.get(`/accounts/${contactId}/plays`)).json().runs.find((r: { id: string }) => r.id === run).opportunityLabel).toMatch(/^OP-/);
    const won = (await ctx.db.execute(sql`select opportunity_id from contracts where id = ${contractId}`)).rows[0] as { opportunity_id: string };
    expect((await lucas.post(`/accounts/${contactId}/play-runs`, { playId: plays.find((p) => p.templateKey === 'relacionamento_institucional')!.id, opportunityId: won.opportunity_id, startOn: today, reason: 'Teste' })).statusCode).toBe(422);
  });

  it('IDs externos aparecem e o ABM não os altera', async () => {
    await ctx.db.execute(sql`update contacts set source_system = 'ixc', external_id = ${`IXC-${stamp}`} where id = ${contactId}`);
    expect(ok(await lucas.get(`/accounts/${contactId}/external-ids`)).json()).toEqual({ origin: 'ixc', items: [{ system: 'ixc', externalId: `IXC-${stamp}` }] });
    const d = ok(await lucas.get(`/abm/${abmId}/360`)).json();
    ok(await lucas.patch(`/abm/${abmId}/organization`, { rowVersion: d.organization.rowVersion, city: 'Lagarto', email: 'contato@ficticia.gov.example' }));
    const row = (await ctx.db.execute(sql`select source_system, external_id from contacts where id = ${contactId}`)).rows[0];
    expect(row).toEqual({ source_system: 'ixc', external_id: `IXC-${stamp}` });
  });
});
