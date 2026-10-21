/** Motor de eventos de negócio: idempotência, invalidação quando a origem é desfeita, atribuição sem dupla contagem, imutabilidade e escopo. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let users: { id: string; email: string }[];
const uid = (n: string) => users.find((u) => u.email === `${n}@yepnet.test`)!.id;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const count = async (where: ReturnType<typeof sql>) => Number(((await ctx.db.execute(sql`select count(*)::int n from business_events where ${where}`)).rows[0] as { n: number }).n);

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas, rafael] = (await Promise.all(['carlos', 'ana', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
  users = (await carlos.get('/admin/users')).json().users;
});
afterAll(async () => ctx.close());

describe('motor de eventos de negócio', () => {
  it('carga histórica a partir das origens e reprocessar não duplica', async () => {
    const first = ok(await carlos.post('/performance/sync')).json();
    const total = await count(sql`true`);
    expect(total).toBeGreaterThan(0);
    expect(first.created).toBeGreaterThanOrEqual(0);
    const again = ok(await carlos.post('/performance/sync')).json();
    expect(again.created).toBe(0);
    expect(await count(sql`true`)).toBe(total);
    const cat = ok(await carlos.get('/performance/catalog')).json();
    expect(cat.types.find((t: { key: string }) => t.key === 'oportunidade_criada').counts.valido).toBeGreaterThan(0);
    expect(cat.unavailable.map((u: { key: string }) => u.key)).toContain('cliente_reativado');
    expect((await lucas.post('/performance/sync')).statusCode).toBe(403);
  });

  it('tarefa concluída vira evento; reabrir invalida com histórico; concluir de novo cria outro', async () => {
    const id = ok(await lucas.post('/tasks', { title: 'Tarefa para o motor de eventos', dueOn: today(), participants: [uid('rafael')] }), 201).json().id;
    let t = ok(await lucas.get(`/tasks/${id}`)).json();
    ok(await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, status: 'concluida' }));
    ok(await carlos.post('/performance/sync'));
    const ev = ok(await lucas.get(`/performance/events?sourceId=${id}`)).json().items;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'tarefa_concluida', validation: 'valido', ownerId: uid('lucas'), context: expect.objectContaining({ onTime: true, selfCreated: true }) });
    // resultado: 100% do responsável; participante recebe participação (sem dupla contagem)
    expect(ev[0].credits.filter((c: { kind: string }) => c.kind === 'direto')).toEqual([expect.objectContaining({ userId: uid('lucas'), shareBp: 10_000 })]);
    expect(ev[0].credits.find((c: { userId: string }) => c.userId === uid('rafael')).kind).toBe('participacao');
    // líder do time recebe crédito de gestão
    expect(ev[0].credits.some((c: { kind: string; userId: string }) => c.kind === 'gestao' && c.userId === uid('ana'))).toBe(true);
    t = ok(await lucas.get(`/tasks/${id}`)).json();
    ok(await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, status: 'em_andamento' }));
    ok(await carlos.post('/performance/sync'));
    const after = ok(await lucas.get(`/performance/events/${ev[0].id}`)).json();
    expect(after.validation).toBe('invalidado');
    expect(after.reviews[0]).toMatchObject({ automatic: true, reason: 'Tarefa reaberta, cancelada ou removida' });
    t = ok(await lucas.get(`/tasks/${id}`)).json();
    ok(await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, status: 'concluida' }));
    ok(await carlos.post('/performance/sync'));
    const all = ok(await lucas.get(`/performance/events?sourceId=${id}`)).json().items;
    expect(all.map((e: { validation: string }) => e.validation).sort()).toEqual(['invalidado', 'valido']);
  });

  it('o fato é imutável no banco; só a validação muda', async () => {
    const [e] = (await ctx.db.execute(sql`select id from business_events limit 1`)).rows as { id: string }[];
    await expect(ctx.db.execute(sql`update business_events set value_cents = 1 where id = ${e!.id}`)).rejects.toThrow(/imutável/);
    await expect(ctx.db.execute(sql`delete from business_events where id = ${e!.id}`)).rejects.toThrow(/não pode ser apagado/);
    await expect(ctx.db.execute(sql`update business_event_credits set share_bp = 1`)).rejects.toThrow(/append-only/);
  });

  it('validação por gestor com motivo; ninguém valida o próprio resultado; escopo por nível', async () => {
    const list = ok(await lucas.get(`/performance/events?userId=${uid('lucas')}&creditKind=direto&validation=valido&pageSize=200`)).json().items;
    const mine = list.find((e: { credits: { userId: string }[] }) => !e.credits.some((c) => c.userId === uid('rafael')));
    expect((await lucas.post(`/performance/events/${mine.id}/review`, { to: 'invalidado', reason: 'Teste do próprio vendedor' })).statusCode).toBe(403);
    expect((await ana.post(`/performance/events/${mine.id}/review`, { to: 'invalidado', reason: 'x' })).statusCode).toBe(422);
    ok(await ana.post(`/performance/events/${mine.id}/review`, { to: 'invalidado', reason: 'Tarefa criada só para pontuar' }));
    const d = ok(await lucas.get(`/performance/events/${mine.id}`)).json();
    expect(d).toMatchObject({ validation: 'invalidado', reviews: [expect.objectContaining({ reason: 'Tarefa criada só para pontuar', automatic: false })] });
    // vendedor de outro time não vê
    expect((await rafael.get(`/performance/events/${mine.id}`)).statusCode).toBe(404);
    // vendedor só vê eventos em que tem crédito
    const r = ok(await rafael.get('/performance/events?pageSize=200')).json();
    expect(r.items.every((e: { credits: { userId: string }[] }) => e.credits.some((c) => c.userId === uid('rafael')))).toBe(true);
  });

  it('configuração versionada: divisão com participantes e tipos que exigem validação', async () => {
    const cur = ok(await carlos.get('/performance/settings')).json();
    const cfg = { ...cur.config, attribution: { ...cur.config.attribution, tarefa_concluida: { ownerShareBp: 6000, participants: true, managers: false } }, validationRequired: ['tarefa_concluida'] };
    expect((await carlos.put('/performance/settings', { config: { ...cfg, attribution: { x: { ownerShareBp: 1, participants: true, managers: true } } }, note: 'inválida' })).statusCode).toBe(422);
    const v = ok(await carlos.put('/performance/settings', { config: cfg, note: 'Tarefas em dupla dividem o resultado' })).json().version;
    expect(v).toBe(cur.version + 1);
    const id = ok(await lucas.post('/tasks', { title: 'Tarefa em dupla', participants: [uid('rafael')] }), 201).json().id;
    const t = ok(await lucas.get(`/tasks/${id}`)).json();
    ok(await lucas.patch(`/tasks/${id}`, { rowVersion: t.rowVersion, status: 'concluida' }));
    ok(await carlos.post('/performance/sync'));
    const e = ok(await lucas.get(`/performance/events?sourceId=${id}`)).json().items[0];
    expect(e).toMatchObject({ validation: 'pendente', ruleVersion: v });
    const direct = e.credits.filter((c: { kind: string }) => c.kind === 'direto');
    expect(direct.map((c: { shareBp: number }) => c.shareBp).sort()).toEqual([4000, 6000]);
    expect(e.credits.some((c: { kind: string }) => c.kind === 'gestao')).toBe(false);
    // volta ao padrão para não afetar outros testes
    ok(await carlos.put('/performance/settings', { config: cur.config, note: 'Volta ao padrão' }));
  });
});
