/** ABM Fase 4 — stakeholders: pessoa única, classificações independentes, influência manual auditada por contexto, aprovação, mapa. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
let contactId: string, abmId: string, sec: string, ti: string;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas, rafael] = (await Promise.all(['carlos', 'ana', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  const a = ok(await lucas.post('/abm/new-account', { name: `Prefeitura Fictícia Stake ${stamp}`, segment: 'governamental', reason: 'Programa de cidades conectadas' }), 201).json();
  contactId = a.contactId; abmId = a.id;
  const u = ok(await lucas.post(`/abm/${abmId}/units`, { name: 'Secretaria de Saúde', kind: 'secretaria' }), 201).json();
  ok(await lucas.post(`/abm/${abmId}/units`, { name: 'TI', kind: 'departamento', parentId: u.id }), 201);
});
afterAll(async () => ctx.close());

describe('stakeholders', () => {
  it('pessoa nova vira stakeholder com influência "não avaliado"; mesmo e-mail reaproveita a pessoa em outra conta; sem duplicar na mesma conta', async () => {
    const units = ok(await lucas.get(`/accounts/${contactId}/stakeholders`)).json().units;
    sec = ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'Maria Fictícia', email: `maria.${stamp}@exemplo.test` }, title: 'Secretária de Saúde', unitId: units[0].id, roles: ['decisor', 'patrocinador'], interest: 'alto', priority: 'critica' }), 201).json().id;
    ti = ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'João Fictício' }, title: 'Coordenador de TI', roles: ['avaliador_tecnico'], interest: 'medio' }), 201).json().id;
    const l = ok(await lucas.get(`/accounts/${contactId}/stakeholders`)).json();
    expect(l.items.find((x: { id: string }) => x.id === sec)).toMatchObject({ influence: 'nao_avaliado', stance: 'desconhecido', roles: ['decisor', 'patrocinador'] });
    // mesma pessoa (mesmo e-mail) em outra conta: reaproveita
    const other = ok(await lucas.post('/abm/new-account', { name: `Consórcio Fictício ${stamp}`, reason: 'Consórcio intermunicipal de saúde' }), 201).json();
    const st2 = ok(await lucas.post(`/accounts/${other.contactId}/stakeholders`, { person: { name: 'Maria F.', email: `MARIA.${stamp}@exemplo.test` }, title: 'Conselheira' }), 201).json();
    expect(st2.personId).toBe(l.items.find((x: { id: string }) => x.id === sec).personId);
    expect((await lucas.post(`/accounts/${contactId}/stakeholders`, { personId: st2.personId })).statusCode).toBe(422);
    const found = ok(await lucas.get(`/people/search?q=${encodeURIComponent(`maria.${stamp}`)}`)).json().items;
    expect(found[0].accounts).toHaveLength(2);
    expect((await rafael.get(`/accounts/${contactId}/stakeholders`)).statusCode).toBe(404);
  });

  it('influência só por avaliação manual com justificativa; não muda por edição comum; auditoria e contexto', async () => {
    let st = ok(await lucas.get(`/stakeholders/${sec}`)).json();
    // edição comum não aceita influência (campo desconhecido é recusado)
    expect((await lucas.patch(`/stakeholders/${sec}`, { rowVersion: st.rowVersion, influence: 'muito_alto' })).statusCode).toBe(422);
    ok(await lucas.patch(`/stakeholders/${sec}`, { rowVersion: st.rowVersion, stance: 'favoravel', relationshipStrength: 'moderado' }));
    expect((await lucas.post(`/stakeholders/${sec}/influence`, { level: 'muito_alto', justification: 'curta' })).statusCode).toBe(422);
    ok(await lucas.post(`/stakeholders/${sec}/influence`, { level: 'muito_alto', justification: 'Assina as autorizações de despesa da secretaria', evidence: 'Portaria de delegação' }));
    // contexto: oportunidade exige id; avaliação contextual não sobrescreve a da conta
    expect((await lucas.post(`/stakeholders/${sec}/influence`, { contextType: 'oportunidade', level: 'baixo', justification: 'Nesta compra quem decide é a TI' })).statusCode).toBe(422);
    const units = ok(await lucas.get(`/accounts/${contactId}/stakeholders`)).json().units;
    ok(await lucas.post(`/stakeholders/${sec}/influence`, { contextType: 'unidade', contextKey: units[1].id, contextLabel: 'TI', level: 'baixo', justification: 'Na TI a palavra técnica é do coordenador' }));
    st = ok(await lucas.get(`/stakeholders/${sec}`)).json();
    expect(st).toMatchObject({ influence: 'muito_alto', stance: 'favoravel' });
    expect(st.influenceContexts).toEqual([expect.objectContaining({ contextType: 'unidade', level: 'baixo' })]);
    expect(st.influenceHistory.map((h: { fromLevel: string; toLevel: string; justification: string }) => `${h.fromLevel}>${h.toLevel}`)).toEqual(['nao_avaliado>baixo', 'nao_avaliado>muito_alto']);
    expect(st.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['incluido', 'alterado']));
    // auditoria é imutável no banco
    await expect(ctx.db.execute(sql`update stakeholder_influence_history set to_level = 'baixo' where stakeholder_id = ${sec}::uuid`)).rejects.toThrow(/append-only/);
  });

  it('política: quem não pode editar não avalia; com aprovação, vira pedido que outra pessoa decide', async () => {
    const s0 = ok(await carlos.get('/abm/settings')).json();
    ok(await carlos.put('/abm/settings', { influence: { view: 'proprio', edit: 'equipe', requireApproval: true, labels: s0.influence.labels }, note: 'Influência só pela liderança, com aprovação' }));
    expect((await lucas.post(`/stakeholders/${ti}/influence`, { level: 'alto', justification: 'Define a especificação técnica' })).statusCode).toBe(403);
    const r = ok(await ana.post(`/stakeholders/${ti}/influence`, { level: 'alto', justification: 'Define a especificação técnica do edital' })).json();
    expect(r.status).toBe('pendente');
    expect(ok(await ana.get(`/stakeholders/${ti}`)).json().influence).toBe('nao_avaliado');
    expect((await ana.post(`/influence-requests/${r.requestId}/decide`, { approve: true })).statusCode).toBe(403);
    ok(await carlos.post(`/influence-requests/${r.requestId}/decide`, { approve: true, note: 'De acordo' }));
    const st = ok(await ana.get(`/stakeholders/${ti}`)).json();
    expect(st.influence).toBe('alto');
    expect(st.influenceHistory[0]).toMatchObject({ toLevel: 'alto', approvedByName: expect.any(String) });
    ok(await carlos.put('/abm/settings', { influence: { view: 'proprio', edit: 'proprio', requireApproval: false, labels: s0.influence.labels }, note: 'Volta ao padrão' }));
  });

  it('mapa de influência × interesse com não avaliados à parte, filtro por departamento e CSV; relações registradas', async () => {
    const extra = ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'Pedro Fictício' }, title: 'Assessor', interest: 'baixo' }), 201).json().id;
    const m = ok(await lucas.get(`/accounts/${contactId}/influence-map`)).json();
    expect(m.points.find((p: { id: string }) => p.id === sec)).toMatchObject({ quadrant: 'gerenciar_de_perto' });
    expect(m.points.find((p: { id: string }) => p.id === ti)).toMatchObject({ quadrant: 'gerenciar_de_perto' });
    expect(m.outside.map((p: { id: string }) => p.id)).toContain(extra);
    const csv = await lucas.get(`/accounts/${contactId}/influence-map?format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Maria Fictícia');
    ok(await lucas.post(`/accounts/${contactId}/relations`, { fromId: ti, toId: sec, kind: 'reporta_a' }), 201);
    expect((await lucas.post(`/accounts/${contactId}/relations`, { fromId: ti, toId: sec, kind: 'reporta_a' })).statusCode).toBe(422);
    expect((await lucas.post(`/accounts/${contactId}/relations`, { fromId: ti, toId: ti, kind: 'aliado' })).statusCode).toBe(422);
    const st = ok(await lucas.get(`/stakeholders/${sec}`)).json();
    expect(st.relations[0]).toMatchObject({ kind: 'reporta_a', otherName: 'João Fictício', direction: 'entrada' });
    const g = ok(await lucas.get('/abm/stakeholders?role=decisor')).json();
    expect(g.items.some((x: { id: string }) => x.id === sec)).toBe(true);
  });
});
