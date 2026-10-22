/** ABM Fase 6 — sinais (detecção, estados, resolução automática, supressão), cadências que geram tarefas e histórico único de interações. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { generateAbmCadences, syncAbmSignals } from '../src/services/abmFollowup';
import { finishTask } from './analysisContent';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
const today = new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
let contactId: string, abmId: string, dec: string, tenantId: string;
type Sig = { id: string; kind: string; key: string; status: string; severity: string; contactId: string; title: string };
const signals = async (c: Client, status = 'abertos') => (ok(await c.get(`/abm/signals?status=${status}&contactId=${contactId}`)).json().items as Sig[]);
const sync = () => syncAbmSignals(ctx.db, tenantId, today);

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, rafael] = (await Promise.all(['carlos', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  tenantId = lucas.me.tenant.id;
  const a = ok(await lucas.post('/abm/new-account', { name: `Prefeitura Fictícia Sinais ${stamp}`, reason: 'Teste de acompanhamento', priority: 'critica' }), 201).json();
  contactId = a.contactId; abmId = a.id;
  await ctx.db.execute(sql`update abm_accounts set created_at = now() - interval '40 days' where id = ${abmId}`);
  dec = ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'Decisora Fictícia Sinal' }, roles: ['decisor'] }), 201).json().id;
  const st = ok(await lucas.get(`/stakeholders/${dec}`)).json();
  ok(await lucas.patch(`/stakeholders/${dec}`, { rowVersion: st.rowVersion, nextInteractionOn: addDays(today, -5) }));
  ok(await lucas.post(`/abm/${abmId}/objectives`, { kind: 'identificar_decisores', title: 'Mapear quem decide', dueOn: addDays(today, -2) }), 201);
});
afterAll(async () => ctx.close());

describe('acompanhamento do ABM', () => {
  it('detecta sinais com chave estável, sem duplicar; escopo da carteira', async () => {
    await sync(); await sync();
    const s = await signals(lucas);
    const kinds = s.map((x) => x.kind).sort();
    expect(kinds).toEqual(expect.arrayContaining(['interacao_pessoa_vencida', 'objetivo_vencido', 'sem_contato']));
    expect(s.filter((x) => x.kind === 'sem_contato')).toHaveLength(1);
    expect(s.find((x) => x.kind === 'interacao_pessoa_vencida')!.severity).toBe('alta');
    expect(s.find((x) => x.kind === 'sem_contato')!.severity).toBe('alta');
    expect((await rafael.get(`/abm/signals?contactId=${contactId}`)).statusCode).toBe(404);
    expect(ok(await rafael.get('/abm/signals')).json().items.some((x: Sig) => x.contactId === contactId)).toBe(false);
  });

  it('estados: tratar exige o que foi feito; descartado não volta logo; tarefa a partir do sinal', async () => {
    const s = await signals(lucas);
    const obj = s.find((x) => x.kind === 'objetivo_vencido')!;
    expect((await lucas.post(`/abm/signals/${obj.id}/transition`, { to: 'tratado', note: 'ok' })).statusCode).toBe(422);
    ok(await lucas.post(`/abm/signals/${obj.id}/transition`, { to: 'descartado', note: 'Objetivo será revisto no planejamento anual' }));
    await sync();
    expect((await signals(lucas)).some((x) => x.kind === 'objetivo_vencido')).toBe(false);
    const pessoa = s.find((x) => x.kind === 'interacao_pessoa_vencida')!;
    const t = ok(await lucas.post(`/abm/signals/${pessoa.id}/task`, { title: 'Ligar para a decisora', dueOn: addDays(today, 1) }), 201).json();
    const row = (await ctx.db.execute(sql`select stakeholder_ids, category from activities where id = ${t.taskId}`)).rows[0] as { stakeholder_ids: string[]; category: string };
    expect(row).toEqual({ stakeholder_ids: [dec], category: 'Sinal ABM' });
    expect((await signals(lucas)).find((x) => x.id === pessoa.id)!.status).toBe('em_analise');
    const det = ok(await lucas.get(`/abm/signals/${pessoa.id}`)).json();
    expect(det.events.map((e: { type: string }) => e.type)).toEqual(['tarefa_criada', 'detectado']);
  });

  it('interação registrada resolve "sem contato" sozinho; próxima interação em dia resolve a da pessoa; sinal manual fica', async () => {
    expect((await lucas.post(`/accounts/${contactId}/interactions`, { type: 'ligacao', at: new Date(Date.now() + 86_400_000 * 2).toISOString(), summary: 'Ligação com a decisora sobre o projeto' })).statusCode).toBe(422);
    ok(await lucas.post(`/accounts/${contactId}/interactions`, { type: 'ligacao', at: new Date().toISOString(), summary: 'Ligação com a decisora sobre o projeto', stakeholderIds: [dec] }), 201);
    const st = ok(await lucas.get(`/stakeholders/${dec}`)).json();
    ok(await lucas.patch(`/stakeholders/${dec}`, { rowVersion: st.rowVersion, nextInteractionOn: addDays(today, 20) }));
    const man = ok(await lucas.post('/abm/signals', { contactId, title: 'Secretário de Saúde foi substituído', severity: 'alta' }), 201).json().id;
    await sync();
    const open = await signals(lucas);
    expect(open.some((x) => x.kind === 'sem_contato' || x.kind === 'interacao_pessoa_vencida')).toBe(false);
    expect(open.map((x) => x.id)).toContain(man);
    const closed = await signals(lucas, 'encerrados');
    expect(closed.find((x) => x.kind === 'sem_contato')!.status).toBe('resolvido');
    // histórico único: a interação aparece com a pessoa; filtro por pessoa
    const all = ok(await lucas.get(`/accounts/${contactId}/interactions`)).json().items;
    expect(all[0]).toMatchObject({ source: 'atividade', kind: 'ligacao', people: ['Decisora Fictícia Sinal'], text: 'Ligação com a decisora sobre o projeto' });
    expect(ok(await lucas.get(`/accounts/${contactId}/interactions?stakeholderId=${dec}`)).json().items).toHaveLength(1);
    expect((await rafael.get(`/accounts/${contactId}/interactions`)).statusCode).toBe(404);
  });

  it('cadência gera a próxima tarefa sem duplicar; concluir agenda a seguinte no prazo; pausar para', async () => {
    expect((await lucas.post(`/accounts/${contactId}/cadences`, { title: 'x', type: 'ligacao', everyDays: 30, startOn: today })).statusCode).toBe(422);
    const c = ok(await lucas.post(`/accounts/${contactId}/cadences`, { title: 'Ligação mensal', type: 'ligacao', everyDays: 30, startOn: today, stakeholderId: dec }), 201).json();
    expect(c.tasksCreated).toBe(1);
    await generateAbmCadences(ctx.db, tenantId, today, 'America/Bahia');
    let list = ok(await lucas.get(`/accounts/${contactId}/cadences`)).json().items;
    expect(list[0]).toMatchObject({ title: 'Ligação mensal', personName: 'Decisora Fictícia Sinal', openDueOn: today, doneCount: 0 });
    await finishTask(lucas, list[0].openTaskId);
    await generateAbmCadences(ctx.db, tenantId, today, 'America/Bahia');
    list = ok(await lucas.get(`/accounts/${contactId}/cadences`)).json().items;
    expect(list[0]).toMatchObject({ openTaskId: null, doneCount: 1, nextDueOn: addDays(today, 30) });
    // 27 dias depois, a próxima tarefa nasce (antecedência de 3 dias)
    await generateAbmCadences(ctx.db, tenantId, addDays(today, 27), 'America/Bahia');
    list = ok(await lucas.get(`/accounts/${contactId}/cadences`)).json().items;
    expect(list[0].openDueOn).toBe(addDays(today, 30));
    ok(await lucas.patch(`/abm/cadences/${list[0].id}`, { rowVersion: list[0].rowVersion, active: false }));
    expect((await ctx.db.execute(sql`select count(*)::int as n from abm_cadence_tasks where cadence_id = ${list[0].id}`)).rows[0]).toEqual({ n: 2 });
    expect(ok(await carlos.get(`/accounts/${contactId}/cadences`)).json().items[0].active).toBe(false);
  });
});
