/** Pessoas & Gestão · F1 — feedback situacional: direção pelo vínculo vigente, SBI, ciência, mediação do RH e sigilo. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { syncReportingLines } from '../src/services/people/reporting';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client, rafael: Client, mariana: Client, outro: Client;
let tenantId = '';
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const SBI = { situation: 'Na reunião de pipeline de terça com o cliente Alfa', behavior: 'Você apresentou os números sem consultar a planilha atualizada', impact: 'O cliente questionou a previsão e precisamos refazer a proposta', guidance: 'Revisar os dados antes das reuniões', nextSteps: 'Combinar uma checagem 30 minutos antes' };
// "hoje" no fuso do servidor de teste (São Paulo): em UTC já pode ser amanhã, e data futura é recusada
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const sync = () => syncReportingLines(ctx.db, tenantId, { force: true });
const team = async (name: string) => ((await ctx.db.execute(sql`select id from teams where tenant_id = ${tenantId} and name = ${name}`)).rows[0] as { id: string }).id;

beforeAll(async () => {
  ctx = await makeApp();
  await ctx.db.execute(sql`delete from module_grants where module = 'pessoas_cultura'`);
  for (const e of ['carlos', 'lucas', 'ana', 'rafael', 'mariana']) {
    await ctx.db.execute(sql`insert into module_grants (tenant_id, module, subject_type, subject_id, effect, reason) select tenant_id, 'pessoas_cultura', 'usuario', id, 'liberar', 'teste desenvolvimento' from users where email = ${`${e}@yepnet.test`}`);
  }
  await ctx.db.execute(sql`insert into module_grants (tenant_id, module, subject_type, subject_id, effect, reason) select tenant_id, 'pessoas_cultura', 'usuario', id, 'liberar', 'teste' from users where email = 'vendedor@outro.test'`);
  tenantId = ((await ctx.db.execute(sql`select tenant_id from users where email = 'carlos@yepnet.test'`)).rows[0] as { tenant_id: string }).tenant_id;
  // RH = setor "rh" (Mariana); Carlos gere o time Residencial (é a liderança da Ana)
  await ctx.db.execute(sql`delete from people_settings`);
  await ctx.db.execute(sql`insert into people_settings (tenant_id, settings) values (${tenantId}, ${JSON.stringify({ roles: { comunicacao: [], pessoasCultura: ['rh'], moderacao: [] } })}::jsonb)`);
  await ctx.db.execute(sql`update users set sectors = '{rh}' where email = 'mariana@yepnet.test'`);
  await ctx.db.execute(sql`update teams set manager_ids = array[(select id from users where email = 'carlos@yepnet.test')] where tenant_id = ${tenantId} and name = 'Residencial'`);
  await ctx.db.execute(sql`delete from reporting_lines`);
  await ctx.db.execute(sql`delete from dev_policies`);
  [carlos, lucas, ana, rafael, mariana, outro] = (await Promise.all(['carlos', 'lucas', 'ana', 'rafael', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)).concat(login(ctx.app, 'vendedor@outro.test')))) as Client[] as [Client, Client, Client, Client, Client, Client];
  await sync();
});
afterAll(async () => {
  await ctx.db.execute(sql`update teams set manager_ids = '{}' where tenant_id = ${tenantId} and name in ('Residencial', 'Governo')`);
  await ctx.db.execute(sql`delete from team_memberships where team_id = (select id from teams where tenant_id = ${tenantId} and name = 'Governo') and user_id in (select id from users where email in ('lucas@yepnet.test', 'carlos@yepnet.test'))`);
  await ctx.db.execute(sql`insert into team_memberships (team_id, user_id, is_lead) select t.id, u.id, false from teams t, users u where t.tenant_id = ${tenantId} and t.name = 'Residencial' and u.email = 'lucas@yepnet.test' on conflict do nothing`);
  await ctx.db.execute(sql`update users set sectors = '{}' where email = 'mariana@yepnet.test'`);
  await ctx.db.execute(sql`delete from module_grants where module = 'pessoas_cultura'`);
  await ctx.db.execute(sql`delete from people_settings`);
  await ctx.db.execute(sql`delete from dev_policies`);
  await ctx.db.execute(sql`delete from reporting_lines`);
  await ctx.close();
});

describe('Pessoas & Gestão · vínculo de liderança', () => {
  it('derivado dos times: liderados, liderança do líder e vigência', async () => {
    const a = ok(await ana.get('/pessoas/desenvolvimento/contexto')).json();
    expect(a.reports.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['Lucas Lima', 'Rafael Mendes']));
    expect(a.managers.map((p: { name: string }) => p.name)).toEqual(['Carlos Silva']);
    expect(ok(await lucas.get('/pessoas/desenvolvimento/contexto')).json().managers.map((p: { name: string }) => p.name)).toEqual(['Ana Souza']);
  });
});

describe('Pessoas & Gestão · feedback descendente', () => {
  let id = '';
  it('SBI obrigatório no envio; só para liderado; ninguém acima lê', async () => {
    expect((await lucas.post('/pessoas/desenvolvimento/feedbacks', { recipientId: rafael.me.user.id, modality: 'orientacao', occurredOn: today, ...SBI, send: true })).statusCode).toBe(422);
    expect((await ana.post('/pessoas/desenvolvimento/feedbacks', { recipientId: lucas.me.user.id, modality: 'orientacao', occurredOn: today, situation: 'curto', behavior: 'curto', impact: 'curto', send: true })).statusCode).toBe(422);
    const draft = ok(await ana.post('/pessoas/desenvolvimento/feedbacks', { recipientId: lucas.me.user.id, modality: 'orientacao', occurredOn: today, situation: 'rascunho', behavior: '', impact: '' }), 201).json();
    expect(draft).toMatchObject({ direction: 'descendente', status: 'rascunho' });
    expect((await lucas.get(`/pessoas/desenvolvimento/feedbacks/${draft.id}`)).statusCode).toBe(404); // rascunho é só de quem escreve
    ok(await ana.patch(`/pessoas/desenvolvimento/feedbacks/${draft.id}`, { recipientId: lucas.me.user.id, modality: 'orientacao', occurredOn: today, ...SBI, send: true }));
    id = draft.id;
    expect((await ana.patch(`/pessoas/desenvolvimento/feedbacks/${id}`, { recipientId: lucas.me.user.id, modality: 'orientacao', occurredOn: today, ...SBI })).statusCode).toBe(422); // enviado não se edita
    const rec = ok(await lucas.get('/pessoas/desenvolvimento/feedbacks?caixa=recebidos')).json().items;
    expect(rec[0]).toMatchObject({ id, direction: 'descendente', sender: { name: 'Ana Souza' }, behavior: SBI.behavior, status: 'enviado', myRole: 'destinatario' });
    expect(ok(await lucas.get('/pessoas/contadores')).json().feedbacks).toBe(1);
    expect((await carlos.get(`/pessoas/desenvolvimento/feedbacks/${id}`)).statusCode).toBe(404); // gestor de gestores não lê conteúdo
    expect((await mariana.get(`/pessoas/desenvolvimento/feedbacks/${id}`)).statusCode).toBe(404); // RH não lê descendente
    expect((await outro.get(`/pessoas/desenvolvimento/feedbacks/${id}`)).statusCode).toBe(404); // outra empresa
  });
  it('ciência não é concordância: manifestação registrada, quem enviou é avisado; uma vez só', async () => {
    ok(await lucas.post(`/pessoas/desenvolvimento/feedbacks/${id}/ciencia`, { response: 'Discordo em parte: a planilha estava desatualizada no sistema.' }));
    expect((await lucas.post(`/pessoas/desenvolvimento/feedbacks/${id}/ciencia`, { response: 'de novo' })).statusCode).toBe(422);
    const f = ok(await ana.get(`/pessoas/desenvolvimento/feedbacks/${id}`)).json();
    expect(f).toMatchObject({ status: 'ciente', response: 'Discordo em parte: a planilha estava desatualizada no sistema.' });
    expect(f.history.map((h: { type: string }) => h.type)).toEqual(['criado', 'enviado', 'ciencia', 'manifestacao']);
    const n = ok(await ana.get('/pessoas/notificacoes')).json().items;
    expect(n.some((x: { event: string; title: string; body: string | null }) => x.event === 'feedback_ciencia' && !x.title.includes('planilha'))).toBe(true);
    const ev = (await ctx.db.execute(sql`select type, payload::text as p from domain_events where entity_id = ${id} order by occurred_at`)).rows as { type: string; p: string }[];
    expect(ev.map((e) => e.type)).toEqual(['feedback.sent', 'feedback.acknowledged']);
    expect(ev.some((e) => e.p.includes('planilha') || e.p.includes('reunião'))).toBe(false); // eventos sem conteúdo
  });
});

describe('Pessoas & Gestão · feedback ascendente', () => {
  it('confidencial: vai ao RH; a liderança recebe só a síntese, sem saber quem enviou', async () => {
    expect((await lucas.post('/pessoas/desenvolvimento/feedbacks', { recipientId: ana.me.user.id, modality: 'alinhamento', mode: 'identificado', occurredOn: today, ...SBI, send: true })).statusCode).toBe(422); // política padrão: só confidencial
    const f = ok(await lucas.post('/pessoas/desenvolvimento/feedbacks', { recipientId: ana.me.user.id, modality: 'alinhamento', mode: 'confidencial', occurredOn: today, ...SBI, send: true }), 201).json();
    expect(f).toMatchObject({ direction: 'ascendente', mode: 'confidencial', status: 'em_mediacao' });
    expect((await ana.get(`/pessoas/desenvolvimento/feedbacks/${f.id}`)).statusCode).toBe(404);
    expect(ok(await ana.get('/pessoas/desenvolvimento/feedbacks?caixa=recebidos')).json().items.some((x: { id: string }) => x.id === f.id)).toBe(false);
    expect((await ana.get('/pessoas/desenvolvimento/feedbacks?caixa=mediacao')).statusCode).toBe(403);
    expect((await carlos.get(`/pessoas/desenvolvimento/feedbacks/${f.id}`)).statusCode).toBe(404);
    const q = ok(await mariana.get('/pessoas/desenvolvimento/feedbacks?caixa=mediacao')).json().items;
    expect(q.find((x: { id: string }) => x.id === f.id)).toMatchObject({ myRole: 'rh', sender: { name: 'Lucas Lima' }, behavior: SBI.behavior });
    expect(ok(await mariana.get('/pessoas/notificacoes')).json().items.some((n: { event: string }) => n.event === 'feedback_mediacao')).toBe(true);
    expect((await mariana.post(`/pessoas/desenvolvimento/feedbacks/${f.id}/mediacao`, { action: 'repassar', note: 'Conversei com quem enviou.' })).statusCode).toBe(422);
    ok(await mariana.post(`/pessoas/desenvolvimento/feedbacks/${f.id}/mediacao`, { action: 'repassar', synthesis: 'O time pede alinhamento prévio dos números antes das reuniões com clientes.', note: 'Conversei com quem enviou; autorizou repassar a síntese.' }));
    const seen = ok(await ana.get(`/pessoas/desenvolvimento/feedbacks/${f.id}`)).json();
    expect(seen).toMatchObject({ myRole: 'destinatario', sender: null, situation: null, behavior: null, synthesis: 'O time pede alinhamento prévio dos números antes das reuniões com clientes.', history: [], mediationNote: null });
    expect(JSON.stringify(seen)).not.toContain('Lucas');
    ok(await ana.post(`/pessoas/desenvolvimento/feedbacks/${f.id}/ciencia`, {}));
    const mine = ok(await lucas.get(`/pessoas/desenvolvimento/feedbacks/${f.id}`)).json();
    expect(mine).toMatchObject({ myRole: 'remetente', status: 'repassado', behavior: SBI.behavior });
    expect(ok(await lucas.get('/pessoas/notificacoes')).json().items.some((n: { event: string }) => n.event === 'feedback_mediacao')).toBe(true);
  });
  it('política versionada (RH): libera o identificado; a anterior fica no histórico', async () => {
    expect((await carlos.put('/pessoas/desenvolvimento/politica', { config: { feedback: { ascendingModes: ['confidencial', 'identificado'] } }, note: 'Libera identificado' })).statusCode).toBe(403);
    expect(ok(await mariana.put('/pessoas/desenvolvimento/politica', { config: { feedback: { ascendingModes: ['confidencial', 'identificado'] } }, note: 'Libera identificado' })).json().version).toBe(1);
    const f = ok(await lucas.post('/pessoas/desenvolvimento/feedbacks', { recipientId: ana.me.user.id, modality: 'reconhecimento', mode: 'identificado', occurredOn: today, ...SBI, send: true }), 201).json();
    expect(ok(await ana.get(`/pessoas/desenvolvimento/feedbacks/${f.id}`)).json()).toMatchObject({ sender: { name: 'Lucas Lima' }, mode: 'identificado' });
    const pol = ok(await mariana.get('/pessoas/desenvolvimento/politica')).json();
    expect(pol.versions.map((v: { version: number }) => v.version)).toEqual([1]);
    const row = (await ctx.db.execute(sql`select policy_version from people_feedbacks where id = ${f.id}`)).rows[0] as { policy_version: number };
    expect(row.policy_version).toBe(1);
  });
});

describe('Pessoas & Gestão · ficha do colaborador', () => {
  it('a própria pessoa, a liderança direta e o RH abrem; feedback só em números; consulta auditada', async () => {
    const list = ok(await ana.get('/pessoas/desenvolvimento/pessoas')).json().items.map((p: { name: string; relation: string }) => `${p.name}:${p.relation}`);
    expect(list).toEqual(expect.arrayContaining(['Ana Souza:eu', 'Lucas Lima:liderado']));
    const ficha = ok(await ana.get(`/pessoas/desenvolvimento/pessoas/${lucas.me.user.id}`)).json();
    expect(ficha).toMatchObject({ relation: 'liderado', person: { name: 'Lucas Lima' }, leadership: { current: [{ name: 'Ana Souza' }] } });
    expect(ficha.feedback.received).toBeGreaterThanOrEqual(1);
    // vale para qualquer área: indicadores da função (scorecard) e contribuições de todos os módulos
    expect(ficha.scorecards).toHaveProperty('cards');
    expect(Array.isArray(ficha.contributions)).toBe(true);
    expect(ficha.timeline.some((e: { kind: string }) => e.kind === 'feedback')).toBe(true);
    expect(JSON.stringify(ficha)).not.toContain(SBI.behavior); // nada de conteúdo
    expect((await lucas.get(`/pessoas/desenvolvimento/pessoas/${ana.me.user.id}`)).statusCode).toBe(403); // liderado não abre a da liderança
    expect((await rafael.get(`/pessoas/desenvolvimento/pessoas/${lucas.me.user.id}`)).statusCode).toBe(403);
    expect(ok(await mariana.get(`/pessoas/desenvolvimento/pessoas/${lucas.me.user.id}`)).json().relation).toBe('rh');
    expect(ok(await mariana.get('/pessoas/desenvolvimento/pessoas')).json().items.length).toBeGreaterThanOrEqual(5);
    expect(ok(await lucas.get(`/pessoas/desenvolvimento/pessoas/${lucas.me.user.id}`)).json().relation).toBe('eu');
    expect((await outro.get(`/pessoas/desenvolvimento/pessoas/${lucas.me.user.id}`)).statusCode).toBe(403);
    const logs = (await ctx.db.execute(sql`select count(*)::int as n from audit_logs where action = 'dev.record.view' and entity_id = ${lucas.me.user.id}`)).rows[0] as { n: number };
    expect(logs.n).toBeGreaterThanOrEqual(2);
  });
});

describe('Pessoas & Gestão · troca de liderança', () => {
  it('a nova liderança não enxerga o que foi registrado antes; a antiga deixa de poder registrar', async () => {
    const before = ok(await ana.post('/pessoas/desenvolvimento/feedbacks', { recipientId: lucas.me.user.id, modality: 'reconhecimento', occurredOn: today, ...SBI, send: true }), 201).json();
    // Lucas passa para o time Governo, liderado pelo Carlos
    const gov = await team('Governo');
    await ctx.db.execute(sql`delete from team_memberships where team_id = ${await team('Residencial')} and user_id = ${lucas.me.user.id}`);
    await ctx.db.execute(sql`insert into team_memberships (team_id, user_id, is_lead) values (${gov}, ${lucas.me.user.id}, false), (${gov}, ${carlos.me.user.id}, true) on conflict do nothing`);
    expect(await sync()).toMatchObject({ opened: expect.any(Number), closed: expect.any(Number) });
    const lines = (await ctx.db.execute(sql`select (select name from users where id = manager_id) as m, valid_to is null as open from reporting_lines where user_id = ${lucas.me.user.id} order by valid_from`)).rows as { m: string; open: boolean }[];
    expect(lines).toEqual(expect.arrayContaining([{ m: 'Ana Souza', open: false }, { m: 'Carlos Silva', open: true }]));
    expect((await ana.post('/pessoas/desenvolvimento/feedbacks', { recipientId: lucas.me.user.id, modality: 'orientacao', occurredOn: today, ...SBI, send: true })).statusCode).toBe(422);
    expect((await carlos.get(`/pessoas/desenvolvimento/feedbacks/${before.id}`)).statusCode).toBe(404);
    expect(ok(await lucas.get(`/pessoas/desenvolvimento/feedbacks/${before.id}`)).json().sender.name).toBe('Ana Souza'); // a pessoa continua com o histórico dela
  });
});
