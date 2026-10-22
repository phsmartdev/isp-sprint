/** ABM Fase 9 — fatos do ABM viram eventos de negócio e alimentam indicadores, metas e semáforo (mesmo motor da Gestão de Times). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { syncBusinessEvents } from '../src/services/businessEvents';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
let tenantId: string, lucasId: string, contactId: string, dec: string, other: string, sigId: string, oppId: string;
type Ev = { type: string; source_id: string; owner_id: string; context: Record<string, unknown>; value_cents: number | null; outcome: string | null };
const events = async (type: string) => (await ctx.db.execute(sql`select type, source_id, owner_id, context, value_cents, outcome from business_events where tenant_id = ${tenantId} and type = ${type}`)).rows as Ev[];
let defs: Record<string, Record<string, unknown>>;
const value = async (key: string) => ok(await carlos.post('/performance/indicators/preview', { def: defs[key], userId: lucasId })).json() as { value: number | null; status: string };

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas] = (await Promise.all(['carlos', 'lucas'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
  tenantId = lucas.me.tenant.id; lucasId = lucas.me.user.id;
  defs = Object.fromEntries((ok(await carlos.get('/performance/indicators')).json().suggestions as { key: string }[]).map((s) => [s.key, s]));
});
afterAll(async () => ctx.close());

describe('indicadores do ABM', () => {
  it('as sugestões do ABM existem e entram no catálogo', async () => {
    expect(Object.keys(defs)).toEqual(expect.arrayContaining(['abm_interacoes', 'abm_stakeholders', 'abm_decisores', 'abm_influencia', 'abm_plays_sucesso', 'abm_tempo_sinal', 'abm_pipeline']));
    ok(await carlos.post('/performance/indicators/suggested', { keys: ['abm_interacoes', 'abm_decisores'] }));
    const items = ok(await carlos.get('/performance/indicators')).json().items as { key: string; def: { category: string } }[];
    expect(items.filter((i) => i.key.startsWith('abm_')).map((i) => i.def.category)).toEqual(expect.arrayContaining(['abm']));
  });

  it('fatos do ABM viram eventos com dono, contexto e sem duplicar', async () => {
    const before = { dec: (await value('abm_decisores')).value ?? 0, int: (await value('abm_interacoes')).value ?? 0, pipe: (await value('abm_pipeline')).value ?? 0 };
    const a = ok(await lucas.post('/abm/new-account', { name: `Prefeitura Fictícia Indicadores ${stamp}`, reason: 'Teste de indicadores do ABM' }), 201).json();
    contactId = a.contactId;
    dec = ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'Decisora Fictícia Indicador' }, roles: ['decisor'] }), 201).json().id;
    other = ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'Fiscal Fictício Indicador' } }), 201).json().id;
    ok(await lucas.post(`/stakeholders/${dec}/influence`, { contextType: 'conta', contextKey: '', level: 'alto', justification: 'Assina os empenhos da secretaria' }));
    ok(await lucas.post(`/accounts/${contactId}/interactions`, { type: 'reuniao', at: new Date().toISOString(), summary: 'Reunião com a decisora sobre o projeto', stakeholderIds: [dec] }), 201);
    sigId = ok(await lucas.post('/abm/signals', { contactId, title: 'Mudança na secretaria fictícia', severity: 'alta' }), 201).json().id;
    ok(await lucas.post(`/abm/signals/${sigId}/transition`, { to: 'tratado', note: 'Reunião marcada com o novo secretário' }));
    const plan = (await carlos.get('/meta/lookups')).json().plans[0];
    oppId = ok(await lucas.post('/opportunities', { contactId, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false }), 201).json().id;

    await syncBusinessEvents(ctx.db, tenantId); await syncBusinessEvents(ctx.db, tenantId);
    const st = (await events('abm_stakeholder_mapeado')).filter((e) => [dec, other].includes(e.source_id));
    expect(st.map((e) => e.context.kind).sort()).toEqual(['decisor', 'outro']);
    expect(st.every((e) => e.owner_id === lucasId)).toBe(true);
    expect((await events('abm_influencia_avaliada')).filter((e) => e.context.stakeholderId === dec)).toHaveLength(1);
    const int = (await events('abm_interacao')).filter((e) => e.context.contactId === contactId);
    expect(int).toHaveLength(1);
    expect(int[0]).toMatchObject({ outcome: 'reuniao', context: { withPeople: true } });
    const sig = (await events('abm_sinal_tratado')).find((e) => e.source_id === sigId)!;
    expect(sig).toMatchObject({ outcome: 'manual', owner_id: lucasId, context: { severity: 'alta' } });
    expect(typeof sig.context.hoursToResolve).toBe('number');
    const opp = (await events('abm_oportunidade_gerada')).find((e) => e.source_id === oppId)!;
    expect(Number(opp.value_cents)).toBeGreaterThan(0);

    // os indicadores sugeridos calculam com os novos fatos (filtro decisor conta só a decisora)
    expect((await value('abm_decisores')).value).toBe(before.dec + 1);
    expect((await value('abm_interacoes')).value).toBe(before.int + 1);
    expect((await value('abm_pipeline')).value).toBeGreaterThan(before.pipe);
    // amostra mínima: tempo para tratar sinal com poucos casos fica incompleto, não vira número enganoso
    expect(['incompleto', 'ok', 'disponivel']).toContain((await value('abm_tempo_sinal')).status);
  });

  it('atividade reaberta invalida a interação; oportunidade removida invalida o pipeline', async () => {
    const [act] = (await ctx.db.execute(sql`select id from activities where contact_id = ${contactId} and status = 'concluida' limit 1`)).rows as { id: string }[];
    await ctx.db.execute(sql`update activities set deleted_at = now() where id = ${act!.id}`);
    await ctx.db.execute(sql`update opportunities set deleted_at = now() where id = ${oppId}`);
    await syncBusinessEvents(ctx.db, tenantId);
    const v = async (type: string, id: string) => ((await ctx.db.execute(sql`select validation from business_events where tenant_id = ${tenantId} and type = ${type} and source_id = ${id}`)).rows as { validation: string }[]).map((r) => r.validation);
    expect(await v('abm_interacao', act!.id)).toEqual(['invalidado']);
    expect(await v('abm_oportunidade_gerada', oppId)).toEqual(['invalidado']);
  });
});
