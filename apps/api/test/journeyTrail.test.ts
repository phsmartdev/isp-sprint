/** Funcionalidade 01 — Trilha Visual: paradas sobre os marcos reais, histórico dos marcos, links com prazo, código e revogação. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const today = new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const pub = (method: 'GET' | 'POST', url: string, payload?: object) => ctx.app.inject({ method, url: `/api/v1${url}`, ...(payload ? { payload } : {}) });
let journeyId: string;
type Stop = { id: string; title: string; status: string; ownerName: string | null; notes: string | null };

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, rafael] = (await Promise.all(['carlos', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const plan = (await carlos.get('/meta/lookups')).json().plans[0];
  const o = ok(await lucas.post('/opportunities', { newContact: { name: `Clínica Fictícia Trilha ${Date.now().toString(36)}`, segment: 'empresarial' }, planId: plan.id, cableMeters: 50, saleType: 'ativa' }), 201).json();
  ok(await carlos.post(`/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await carlos.get(`/opportunities/${o.id}`)).json().rowVersion }));
  const contractId = ok(await carlos.post('/contracts', { opportunityId: o.id, billingType: 'recorrente', commercialOwnerId: lucas.me.user.id, version: { number: `TR-${Date.now().toString(36)}`, object: 'Conectividade fictícia', signedAt: today, startAt: today, termMonths: 12, monthlyCents: 500_000, items: [{ planId: null, description: 'Link 500 Mbps', qty: 1, unitCents: 500_000 }] } }), 201).json().id;
  ok(await carlos.post(`/contracts/${contractId}/validate`));
  const r = await carlos.post('/cs/journeys', { contractId });
  expect([200, 201], r.body).toContain(r.statusCode);
  journeyId = r.json().journeyId ?? r.json().id ?? (await carlos.get(`/cs/journeys?contractId=${contractId}`)).json().items[0].id;
});
afterAll(async () => ctx.close());

describe('trilha visual da jornada', () => {
  it('paradas seguem os marcos; histórico registra conclusão, data, responsável e observação com antes e depois', async () => {
    let t = ok(await carlos.get(`/cs/journeys/${journeyId}/trail`)).json();
    expect(t.total).toBeGreaterThan(3);
    expect(t.stops[0].status).toMatch(/atual|atrasado/);
    const [a, b] = t.stops as Stop[];
    const prevOwner = b!.ownerName;
    const target = prevOwner === 'Carlos Silva' ? lucas : carlos;
    ok(await carlos.patch(`/cs/milestones/${a!.id}`, { done: true, notes: 'Contrato conferido com o cliente' }));
    ok(await carlos.patch(`/cs/milestones/${b!.id}`, { plannedAt: addDays(today, 20), ownerId: target.me.user.id }));
    ok(await carlos.patch(`/cs/milestones/${b!.id}`, { plannedAt: addDays(today, 20) })); // sem mudança: nada novo
    t = ok(await carlos.get(`/cs/journeys/${journeyId}/trail`)).json();
    expect(t.stops[0].status).toBe('concluido');
    expect(t.stops[1].status).toBe('atual');
    expect(t.currentIndex).toBe(1);
    const types = t.events.map((e: { type: string; milestoneId: string }) => `${e.milestoneId === a!.id ? 'a' : 'b'}:${e.type}`).sort();
    expect(types).toEqual(['a:concluido', 'a:observacao', 'b:reprogramado', 'b:responsavel']);
    expect(t.events.find((e: { type: string }) => e.type === 'responsavel')).toMatchObject({ fromName: prevOwner, toName: target.me.user.name });
    ok(await carlos.patch(`/cs/milestones/${a!.id}`, { done: false }));
    expect(ok(await carlos.get(`/cs/journeys/${journeyId}/trail`)).json().events[0].type).toBe('reaberto');
    await expect(ctx.db.execute(sql`update cs_milestone_events set type = 'x' where journey_id = ${journeyId}`)).rejects.toThrow(/append-only/);
  });

  it('link com código: pede o código, bloqueia após 5 erros, mostra só o que o cliente pode ver; revogar corta o acesso', async () => {
    expect((await carlos.post(`/cs/journeys/${journeyId}/links`, { label: 'x', days: 30 })).statusCode).toBe(422);
    expect((await rafael.post(`/cs/journeys/${journeyId}/links`, { label: 'Diretoria', days: 30 })).statusCode).toBe(404);
    const l = ok(await carlos.post(`/cs/journeys/${journeyId}/links`, { label: 'Diretoria da clínica', days: 15, requireCode: true }), 201).json();
    expect(l.code).toMatch(/^\d{6}$/);
    const token = l.url.split('/j/')[1];
    expect(ok(await pub('GET', `/public/journey/${token}`)).json()).toEqual({ needsCode: true, attemptsLeft: 5 });
    expect((await pub('POST', `/public/journey/${token}/unlock`, { code: l.code === '000000' ? '111111' : '000000' })).statusCode).toBe(403);
    const okBody = ok(await pub('POST', `/public/journey/${token}/unlock`, { code: l.code })).json();
    expect(okBody.trail.total).toBeGreaterThan(3);
    expect(okBody.trail.stops[1]).not.toHaveProperty('ownerName');
    expect(okBody.trail.stops.every((x: Stop) => x.notes === null)).toBe(true);
    // 5 erros seguidos bloqueiam, mesmo com o código certo depois
    const wrong = l.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) expect((await pub('POST', `/public/journey/${token}/unlock`, { code: wrong })).statusCode).toBe(403);
    expect((await pub('POST', `/public/journey/${token}/unlock`, { code: wrong })).statusCode).toBe(429);
    expect((await pub('POST', `/public/journey/${token}/unlock`, { code: l.code })).statusCode).toBe(429);
    let t = ok(await carlos.get(`/cs/journeys/${journeyId}/trail`)).json();
    let link = t.links.find((x: { id: string }) => x.id === l.id);
    expect(link).toMatchObject({ state: 'bloqueado', accessCount: 1, requiresCode: true });
    expect(link.events.map((e: { type: string }) => e.type)).toContain('bloqueado');
    // link sem código, com observações; revogar
    const l2 = ok(await carlos.post(`/cs/journeys/${journeyId}/links`, { label: 'Equipe de TI da clínica', days: 7, requireCode: false, showNotes: true }), 201).json();
    expect(l2.code).toBeNull();
    const t2 = l2.url.split('/j/')[1];
    const g = ok(await pub('GET', `/public/journey/${t2}`)).json();
    expect(g.needsCode).toBe(false);
    expect(g.trail.stops.some((x: Stop) => x.notes === 'Contrato conferido com o cliente')).toBe(true);
    expect((await carlos.post(`/cs/journey-links/${l2.id}/revoke`, { reason: 'x' })).statusCode).toBe(422);
    ok(await carlos.post(`/cs/journey-links/${l2.id}/revoke`, { reason: 'Contato saiu da clínica' }));
    expect((await pub('GET', `/public/journey/${t2}`)).statusCode).toBe(404);
    t = ok(await carlos.get(`/cs/journeys/${journeyId}/trail`)).json();
    link = t.links.find((x: { id: string }) => x.id === l2.id);
    expect(link).toMatchObject({ state: 'revogado', revokeReason: 'Contato saiu da clínica', accessCount: 1 });
    // link expirado
    await ctx.db.execute(sql`update cs_journey_links set expires_at = now() - interval '1 minute' where id = ${l.id}`);
    expect((await pub('GET', `/public/journey/${token}`)).statusCode).toBe(404);
    expect((await pub('GET', '/public/journey/token-que-nao-existe-de-jeito-nenhum')).statusCode).toBe(404);
  });
});
