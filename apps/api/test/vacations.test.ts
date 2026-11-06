/** Gestão de Times → Férias: regras, sugestão sem choque no time, permissão da liderança e aviso antes do gozo. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { isoAddDays } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let ana: Client, lucas: Client, rafael: Client, carlos: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const monday = (from: string) => { let d = from; while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = isoAddDays(d, 1); return d; };

beforeAll(async () => {
  ctx = await makeApp();
  ana = await login(ctx.app, 'ana@yepnet.test');
  lucas = await login(ctx.app, 'lucas@yepnet.test');
  rafael = await login(ctx.app, 'rafael@yepnet.test');
  carlos = await login(ctx.app, 'carlos@yepnet.test');
  await ctx.app.db.execute(sql`delete from vacations`);
  await ctx.app.db.execute(sql`delete from vacation_people`);
});
afterAll(async () => ctx.close());

const idOf = async (c: Client, email: string) => (ok(await c.get('/times/ferias')).json().people as { id: string; name: string }[]).find((p) => p.name)!.id && (await ctx.app.db.execute<{ id: string }>(sql`select id from users where email = ${email}`)).rows[0]!.id;

describe('Férias', () => {
  it('regras de partida (CLT) publicadas como versão; liderança informa admissão; liderado não', async () => {
    const st = ok(await carlos.get('/times/ferias/settings')).json();
    expect(st.settings).toMatchObject({ daysPerPeriod: 30, alertDaysBefore: 30 });
    const lucasId = await idOf(ana, 'lucas@yepnet.test');
    const rafaelId = await idOf(ana, 'rafael@yepnet.test');
    const anaId = await idOf(ana, 'ana@yepnet.test');
    expect((await lucas.put(`/times/ferias/people/${rafaelId}/admission`, { admissionDate: '2024-01-15' })).statusCode).toBe(403);
    ok(await ana.put(`/times/ferias/people/${lucasId}/admission`, { admissionDate: '2024-03-15' }));
    ok(await ana.put(`/times/ferias/people/${rafaelId}/admission`, { admissionDate: '2024-03-15' }));
    // ninguém gerencia as próprias: a da líder é com a gestão (nível Total)
    expect((await ana.put(`/times/ferias/people/${anaId}/admission`, { admissionDate: '2023-06-01' })).statusCode).toBe(403);
    ok(await carlos.put(`/times/ferias/people/${anaId}/admission`, { admissionDate: '2024-01-15' }));
  });
  it('sugestão automática: sem choque com quem divide time; times diferentes podem coincidir', async () => {
    const r = ok(await ana.post('/times/ferias/suggest', {}), 201).json();
    expect(r.created).toBeGreaterThanOrEqual(2);
    const data = ok(await ana.get('/times/ferias')).json();
    const lucasId = await idOf(ana, 'lucas@yepnet.test');
    const rafaelId = await idOf(ana, 'rafael@yepnet.test');
    const vs = data.vacations as { userId: string; startDate: string; endDate: string; status: string; source: string }[];
    const l = vs.filter((v) => v.userId === lucasId), rf = vs.filter((v) => v.userId === rafaelId);
    expect(l[0]).toMatchObject({ status: 'sugerida', source: 'automatica' });
    // lucas e rafael estão em times diferentes: a mesma data é permitida
    expect(l[0]!.startDate).toBe(rf[0]!.startDate);
    // liderado vê o calendário do próprio time, sem gerenciar
    const mine = ok(await lucas.get('/times/ferias')).json();
    expect(mine.people.find((p: { id: string }) => p.id === lucasId).canManage).toBe(false);
    expect(mine.people.some((p: { id: string }) => p.id === rafaelId)).toBe(false);
  });
  it('choque no time é bloqueado; ajustar e confirmar ficam no histórico; liderado não altera', async () => {
    const lucasId = await idOf(ana, 'lucas@yepnet.test');
    const anaId = await idOf(ana, 'ana@yepnet.test');
    const data = ok(await ana.get('/times/ferias')).json();
    const lv = data.vacations.find((v: { userId: string }) => v.userId === lucasId);
    // a líder divide time com o lucas: as férias dela não podem bater com as dele
    const anaPeriod = data.people.find((p: { id: string }) => p.id === anaId).periods.find((p: { balance: number; end: string }) => p.balance > 0 && p.end < lv.startDate);
    const clash = await carlos.post('/times/ferias', { userId: anaId, periodStart: anaPeriod.start, startDate: lv.startDate, days: 15 });
    expect(clash.statusCode).toBe(422);
    expect(clash.json().detail).toMatch(/Choque de férias no time/);
    expect((await lucas.patch(`/times/ferias/${lv.id}`, { status: 'programada' })).statusCode).toBe(403);
    const sexta = isoAddDays(monday(isoAddDays(today, 40)), 4);
    expect((await ana.patch(`/times/ferias/${lv.id}`, { startDate: sexta })).json().detail).toMatch(/não podem começar em sexta/);
    const nova = monday(isoAddDays(today, 50));
    ok(await ana.patch(`/times/ferias/${lv.id}`, { startDate: nova, days: 20, status: 'programada' }));
    const h = ok(await ana.get(`/times/ferias/${lv.id}/history`)).json();
    expect(h.items[0].payload.title).toMatch(/programadas: .* 20 dias/);
    // fracionado: segundo bloco de 10 no mesmo período
    ok(await ana.post('/times/ferias', { userId: lucasId, periodStart: lv.periodStart, startDate: monday(isoAddDays(nova, 40)), days: 10 }), 201);
    expect((await ana.post('/times/ferias', { userId: lucasId, periodStart: lv.periodStart, startDate: monday(isoAddDays(nova, 80)), days: 5 })).json().detail).toMatch(/já há 30 dias/);
  });
  it('aviso N dias antes: pessoa e liderança, uma vez, no sino', async () => {
    const lucasId = await idOf(ana, 'lucas@yepnet.test');
    const [v] = (await ctx.app.db.execute<{ id: string }>(sql`select id from vacations where user_id = ${lucasId} and status = 'programada' order by start_date limit 1`)).rows;
    // traz o início para dentro da janela de aviso
    await ctx.app.db.execute(sql`update vacations set start_date = ${monday(isoAddDays(today, 10))}::date, alerted_at = null where id = ${v!.id}`);
    const m1 = ok(await lucas.get('/me/mentions')).json();
    const al = m1.items.find((i: { source: string; taskId: string }) => i.source === 'ferias_alerta' && i.taskId === v!.id);
    expect(al.title).toMatch(/revise as rotinas e tarefas do período/);
    const mAna = ok(await ana.get('/me/mentions')).json();
    expect(mAna.items.some((i: { source: string; taskId: string }) => i.source === 'ferias_alerta' && i.taskId === v!.id)).toBe(true);
    // não repete
    ok(await lucas.get('/me/mentions'));
    const n = (await ctx.app.db.execute<{ n: number }>(sql`select count(*)::int as n from governance_events where entity = 'ferias' and type = 'alerta' and entity_id = ${v!.id}`)).rows[0]!.n;
    expect(n).toBe(1);
    void rafael;
  });
  it('regras: só quem administra publica; validação', async () => {
    expect((await ana.post('/times/ferias/settings', { daysPerPeriod: 30, maxSplits: 3, minMainBlockDays: 14, minBlockDays: 5, alertDaysBefore: 30, blockedStartWeekdays: [5, 6], preferredStartWeekday: 1, note: 'teste' })).statusCode).toBe(403);
    expect((await carlos.post('/times/ferias/settings', { daysPerPeriod: 30, maxSplits: 3, minMainBlockDays: 3, minBlockDays: 5, alertDaysBefore: 30, blockedStartWeekdays: [5, 6], preferredStartWeekday: 1, note: 'teste' })).statusCode).toBe(422);
    ok(await carlos.post('/times/ferias/settings', { daysPerPeriod: 30, maxSplits: 3, minMainBlockDays: 14, minBlockDays: 5, alertDaysBefore: 45, blockedStartWeekdays: [5, 6], preferredStartWeekday: 1, note: 'Aviso com 45 dias' }), 201);
    expect(ok(await carlos.get('/times/ferias/settings')).json().settings.alertDaysBefore).toBe(45);
    ok(await carlos.post('/times/ferias/settings', { daysPerPeriod: 30, maxSplits: 3, minMainBlockDays: 14, minBlockDays: 5, alertDaysBefore: 30, blockedStartWeekdays: [5, 6], preferredStartWeekday: 1, note: 'Volta a 30 dias' }), 201);
  });
});
