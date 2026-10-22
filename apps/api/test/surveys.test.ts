/** Funcionalidade 02 — pesquisas por link: construtor, convite pessoal, resposta única, destinos (automático e com revisão), influência intocada, indicadores. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { syncBusinessEvents } from '../src/services/businessEvents';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const pub = (method: 'GET' | 'POST', url: string, payload?: object) => ctx.app.inject({ method, url: `/api/v1${url}`, ...(payload ? { payload } : {}) });
const stamp = Date.now().toString(36);
let contactId: string, stId: string, surveyId: string;

const definition = {
  title: 'Como está a nossa parceria?', intro: 'Três perguntas rápidas.', thanks: 'Obrigado!',
  questions: [
    { key: 'nps', type: 'nps', text: 'De 0 a 10, quanto recomendaria?', required: true, destination: 'cs_nps', mode: 'automatica' },
    { key: 'interesse', type: 'escolha', text: 'Qual seu interesse em ampliar a rede?', required: false, destination: 'stakeholder_interesse', mode: 'automatica', options: [{ key: 'muito', label: 'Muito', maps: 'alto' }, { key: 'pouco', label: 'Pouco', maps: 'baixo' }] },
    { key: 'apoio', type: 'escolha', text: 'Você apoia a proposta de expansão?', required: false, destination: 'stakeholder_posicionamento', mode: 'pendente', options: [{ key: 'sim', label: 'Apoio', maps: 'favoravel' }, { key: 'nao', label: 'Não apoio', maps: 'resistente' }] },
    { key: 'obs', type: 'texto', text: 'Comentários', required: false, destination: 'nenhum', mode: 'automatica' },
  ],
};

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, rafael] = (await Promise.all(['carlos', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const a = ok(await lucas.post('/abm/new-account', { name: `Hospital Fictício Pesquisa ${stamp}`, reason: 'Teste de pesquisas' }), 201).json();
  contactId = a.contactId;
  stId = ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'Bruna Fictícia', email: `bruna.${stamp}@exemplo.test` }, roles: ['decisor'], interest: 'desconhecido' }), 201).json().id;
  ok(await lucas.post(`/stakeholders/${stId}/influence`, { contextType: 'conta', contextKey: '', level: 'alto', justification: 'Avaliação feita pela equipe em reunião' }));
});
afterAll(async () => ctx.close());

describe('pesquisas por link', () => {
  it('construtor: só liderança; influência nunca é destino; edição gera versão', async () => {
    expect((await lucas.post('/surveys', { name: `Pesquisa ${stamp}`, definition })).statusCode).toBe(403);
    const bad = await carlos.post('/surveys', { name: `Ruim ${stamp}`, definition: { ...definition, questions: [{ key: 'inf', type: 'escolha', text: 'Qual seu poder de decisão?', required: true, destination: 'stakeholder_influencia', mode: 'automatica', options: [{ key: 'a', label: 'Alto', maps: 'alto' }, { key: 'b', label: 'Baixo', maps: 'baixo' }] }] } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().detail).toMatch(/poder de influência/);
    const auto = await carlos.post('/surveys', { name: `Ruim2 ${stamp}`, definition: { ...definition, questions: [{ ...definition.questions[2], mode: 'automatica' }] } });
    expect(auto.json().detail).toMatch(/revisão/);
    surveyId = ok(await carlos.post('/surveys', { name: `Pesquisa ${stamp}`, definition }), 201).json().id;
    const d = ok(await carlos.get(`/surveys/${surveyId}`)).json();
    expect(ok(await carlos.put(`/surveys/${surveyId}`, { rowVersion: d.rowVersion, name: d.name, definition: { ...definition, intro: 'Quatro perguntas rápidas.' }, note: 'Texto de abertura' })).json().version).toBe(2);
  });

  it('convite pessoal: página pública sem dados internos; resposta única; NPS na conta; interesse automático; posicionamento só após revisão; influência intocada', async () => {
    expect((await lucas.post(`/surveys/${surveyId}/invites`, { contactId })).statusCode).toBe(422); // pesquisa mexe em pessoa: exige a pessoa
    expect((await rafael.post(`/surveys/${surveyId}/invites`, { contactId, stakeholderId: stId })).statusCode).toBe(404);
    const inv = ok(await lucas.post(`/surveys/${surveyId}/invites`, { contactId, stakeholderId: stId, days: 10 }), 201).json();
    const token = inv.url.split('/p/')[1];
    const page = ok(await pub('GET', `/public/survey/${token}`)).json();
    expect(page).toMatchObject({ title: 'Como está a nossa parceria?', respondentName: 'Bruna Fictícia', intro: 'Quatro perguntas rápidas.' });
    expect(JSON.stringify(page)).not.toMatch(/destination|maps|favoravel|cs_nps/);
    expect((await pub('POST', `/public/survey/${token}`, { answers: { nps: 12 } })).statusCode).toBe(422);
    ok(await pub('POST', `/public/survey/${token}`, { answers: { nps: 9, interesse: 'muito', apoio: 'nao', obs: 'Atendimento ótimo' } }));
    expect((await pub('POST', `/public/survey/${token}`, { answers: { nps: 1 } })).statusCode).toBe(409);
    expect((await pub('GET', `/public/survey/${token}`)).statusCode).toBe(409);

    const nps = (await ctx.db.execute(sql`select kind, score, scale from cs_surveys where contact_id = ${contactId}`)).rows;
    expect(nps).toEqual([{ kind: 'NPS', score: 9, scale: 10 }]);
    let st = ok(await lucas.get(`/stakeholders/${stId}`)).json();
    expect(st).toMatchObject({ interest: 'alto', stance: 'desconhecido', influence: 'alto' });
    expect(st.influenceHistory).toHaveLength(1); // só a avaliação manual
    // revisão: vendedor não decide; liderança aprova e o posicionamento muda com registro
    const pend = ok(await carlos.get('/survey-updates')).json().items.filter((u: { contactId: string }) => u.contactId === contactId);
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ destination: 'stakeholder_posicionamento', value: 'resistente', previous: 'desconhecido', status: 'pendente' });
    expect((await lucas.post(`/survey-updates/${pend[0].id}/decide`, { approve: true })).statusCode).toBe(403);
    expect((await carlos.post(`/survey-updates/${pend[0].id}/decide`, { approve: false, note: 'x' })).statusCode).toBe(422);
    ok(await carlos.post(`/survey-updates/${pend[0].id}/decide`, { approve: true, note: 'Confirmado em ligação' }));
    st = ok(await lucas.get(`/stakeholders/${stId}`)).json();
    expect(st).toMatchObject({ stance: 'resistente', influence: 'alto' });
    expect(st.events.filter((e: { type: string; payload: { via?: string } }) => e.type === 'alterado' && e.payload.via === 'pesquisa')).toHaveLength(2);
    expect((await carlos.post(`/survey-updates/${pend[0].id}/decide`, { approve: true })).statusCode).toBe(422);
  });

  it('indicadores da pesquisa, cancelamento do convite e evento para a Gestão de Times', async () => {
    const inv2 = ok(await lucas.post(`/surveys/${surveyId}/invites`, { contactId, stakeholderId: stId }), 201).json();
    ok(await lucas.post(`/survey-invites/${inv2.id}/cancel`, { reason: 'Enviado em duplicidade' }));
    expect((await pub('GET', `/public/survey/${inv2.url.split('/p/')[1]}`)).statusCode).toBe(404);
    const d = ok(await carlos.get(`/surveys/${surveyId}`)).json();
    expect(d.stats).toMatchObject({ invites: 1, responses: 1, responseRate: 100, nps: 100 });
    expect(d.stats.perQuestion.find((q: { key: string }) => q.key === 'interesse').distribution).toEqual({ muito: 1 });
    expect(d.invites.map((i: { status: string }) => i.status).sort()).toEqual(['cancelado', 'respondido']);
    expect(ok(await lucas.get(`/accounts/${contactId}/surveys`)).json().items[1]).toMatchObject({ status: 'respondido', npsScore: 9, person: 'Bruna Fictícia' });
    await syncBusinessEvents(ctx.db, lucas.me.tenant.id);
    const ev = (await ctx.db.execute(sql`select quantity, outcome from business_events where type = 'pesquisa_respondida' and context->>'contactId' = ${contactId}`)).rows;
    expect(ev).toEqual([{ quantity: 9, outcome: 'promotor' }]);
  });
});
