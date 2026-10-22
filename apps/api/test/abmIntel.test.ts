/** ABM Fase 7 — cobertura de stakeholders (explicada) e indicadores do ABM no escopo de quem consulta. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const stamp = Date.now().toString(36);
const today = new Date().toISOString().slice(0, 10);
let contactId: string, abmId: string;

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, rafael] = (await Promise.all(['carlos', 'lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client];
  const a = ok(await lucas.post('/abm/new-account', { name: `Prefeitura Fictícia Intel ${stamp}`, reason: 'Programa de cidades conectadas', priority: 'critica' }), 201).json();
  contactId = a.contactId; abmId = a.id;
  const u = ok(await lucas.post(`/abm/${abmId}/units`, { name: 'Secretaria de Saúde', kind: 'secretaria' }), 201).json().id;
  ok(await lucas.post(`/abm/${abmId}/units`, { name: 'TI', kind: 'departamento', parentId: u }), 201);
  const dec = ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'Decisora Fictícia' }, roles: ['decisor'], unitId: u }), 201).json().id;
  ok(await lucas.post(`/accounts/${contactId}/stakeholders`, { person: { name: 'Técnico Fictício' }, roles: ['avaliador_tecnico'] }), 201);
  ok(await lucas.post(`/stakeholders/${dec}/influence`, { contextType: 'conta', contextKey: '', level: 'muito_alto', justification: 'Assina os empenhos da secretaria' }));
  const st = ok(await lucas.get(`/stakeholders/${dec}`)).json();
  ok(await lucas.patch(`/stakeholders/${dec}`, { rowVersion: st.rowVersion, relationshipStrength: 'fraco', stance: 'favoravel' }));
});
afterAll(async () => ctx.close());

describe('inteligência e cobertura do ABM', () => {
  it('cobertura explicada a partir do que a equipe registrou', async () => {
    const c = ok(await lucas.get(`/accounts/${contactId}/coverage`)).json();
    const item = (k: string) => c.items.find((i: { key: string }) => i.key === k);
    expect(item('papeis')).toMatchObject({ detail: '2 de 4' });
    expect(item('avaliacao')).toMatchObject({ detail: '1 de 2' });
    expect(item('relacionamento').gap).toMatch(/1 pessoa\(s\) de influência alta sem relacionamento/);
    expect(item('defensor')).toMatchObject({ score: 1 });
    expect(item('departamentos')).toMatchObject({ detail: '1 de 2' });
    expect(c.score).toBeGreaterThan(0);
    expect(c.score).toBeLessThan(70);
    expect((await rafael.get(`/accounts/${contactId}/coverage`)).statusCode).toBe(404);
  });

  it('indicadores no escopo e com filtros', async () => {
    const d = ok(await lucas.get(`/abm/intelligence?from=${today.slice(0, 7)}-01&to=${today}`)).json();
    const acc = d.accounts.find((a: { id: string }) => a.id === abmId);
    expect(acc).toMatchObject({ priority: 'critica', commercial: 'identificada', coverage: expect.objectContaining({ level: expect.any(String) }) });
    expect(d.prospeccao.newInPeriod).toBeGreaterThanOrEqual(1);
    expect(d.stakeholders.decisores).toBeGreaterThanOrEqual(1);
    expect(d.relacionamento.highInfluence).toBeGreaterThanOrEqual(1);
    expect(d.cobertura.avg).toEqual(expect.any(Number));
    const crit = ok(await lucas.get('/abm/intelligence?priority=baixa')).json();
    expect(crit.accounts.some((a: { id: string }) => a.id === abmId)).toBe(false);
    const other = ok(await rafael.get('/abm/intelligence')).json();
    expect((other.accounts ?? []).some((a: { id: string }) => a.id === abmId)).toBe(false);
    expect(ok(await carlos.get('/abm/intelligence')).json().accounts.some((a: { id: string }) => a.id === abmId)).toBe(true);
  });
});
