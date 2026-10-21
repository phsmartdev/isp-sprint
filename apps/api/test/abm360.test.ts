/** ABM Fase 3 — Conta 360: objetivos, estrutura organizacional, dados da organização e histórico unificado. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let lucas: Client, rafael: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let abmId: string;
const stamp = Date.now().toString(36);

beforeAll(async () => {
  ctx = await makeApp();
  [lucas, rafael] = (await Promise.all(['lucas', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client];
  abmId = ok(await lucas.post('/abm/new-account', { name: `Secretaria Fictícia de Saúde ${stamp}`, nature: 'publica', segment: 'governamental', city: 'Aracaju', reason: 'Edital previsto de conectividade das unidades' }), 201).json().id;
});
afterAll(async () => ctx.close());

describe('Conta 360 ABM', () => {
  it('cabeçalho estratégico com dados reais e escopo do responsável', async () => {
    const d = ok(await lucas.get(`/abm/${abmId}/360`)).json();
    expect(d.abm).toMatchObject({ id: abmId, status: 'candidata' });
    expect(d.organization).toMatchObject({ nature: 'publica', segment: 'governamental' });
    expect(d.objectives).toEqual([]);
    expect(d.history.some((h: { source: string; type: string }) => h.source === 'abm' && h.type === 'criada')).toBe(true);
    expect((await rafael.get(`/abm/${abmId}/360`)).statusCode).toBe(404);
  });

  it('objetivos: cria, acompanha e só encerra com resultado; tudo no histórico', async () => {
    const o = ok(await lucas.post(`/abm/${abmId}/objectives`, { kind: 'identificar_decisores', title: 'Mapear quem decide a contratação de conectividade', dueOn: '2026-12-15', successCriteria: 'Secretário e diretor de TI identificados' }), 201).json();
    ok(await lucas.patch(`/abm/objectives/${o.id}`, { rowVersion: o.rowVersion, status: 'em_andamento' }));
    expect((await lucas.patch(`/abm/objectives/${o.id}`, { rowVersion: o.rowVersion + 1, status: 'atingido', result: 'ok' })).statusCode).toBe(422);
    ok(await lucas.patch(`/abm/objectives/${o.id}`, { rowVersion: o.rowVersion + 1, status: 'atingido', result: 'Reunião com o secretário e o diretor de TI realizada' }));
    expect((await lucas.patch(`/abm/objectives/${o.id}`, { rowVersion: o.rowVersion + 2, status: 'planejado' })).statusCode).toBe(422);
    const d = ok(await lucas.get(`/abm/${abmId}/360`)).json();
    expect(d.objectives[0]).toMatchObject({ status: 'atingido', result: 'Reunião com o secretário e o diretor de TI realizada' });
    expect(d.history.map((h: { type: string }) => h.type)).toEqual(expect.arrayContaining(['objetivo_criado', 'objetivo_situacao']));
  });

  it('estrutura organizacional: hierarquia explícita, sem ciclos, desativar sem apagar', async () => {
    const sec = ok(await lucas.post(`/abm/${abmId}/units`, { name: 'Gabinete do Secretário', kind: 'diretoria' }), 201).json();
    const ti = ok(await lucas.post(`/abm/${abmId}/units`, { name: 'Coordenação de TI', kind: 'departamento', parentId: sec.id }), 201).json();
    expect((await lucas.patch(`/abm/units/${sec.id}`, { abmId, rowVersion: sec.rowVersion, parentId: ti.id })).statusCode).toBe(422);
    ok(await lucas.patch(`/abm/units/${ti.id}`, { abmId, rowVersion: ti.rowVersion, active: false }));
    const d = ok(await lucas.get(`/abm/${abmId}/360`)).json();
    expect(d.units.map((u: { name: string; depth: number; active: boolean }) => `${u.depth}:${u.name}:${u.active}`)).toEqual(['0:Gabinete do Secretário:true', '1:Coordenação de TI:false']);
  });

  it('dados da organização completados aos poucos; CNPJ duplicado recusado; histórico', async () => {
    let d = ok(await lucas.get(`/abm/${abmId}/360`)).json();
    ok(await lucas.patch(`/abm/${abmId}/organization`, { rowVersion: d.organization.rowVersion, document: '13.012.345/0001-07', email: 'contato@ficticia.gov.example' }));
    d = ok(await lucas.get(`/abm/${abmId}/360`)).json();
    expect(d.organization.document).toBe('13.012.345/0001-07');
    const other = ok(await lucas.post('/abm/new-account', { name: `Outra entidade ${stamp}`, reason: 'Teste de duplicidade de CNPJ' }), 201).json();
    const od = ok(await lucas.get(`/abm/${other.id}/360`)).json();
    expect((await lucas.patch(`/abm/${other.id}/organization`, { rowVersion: od.organization.rowVersion, document: '13012345000107' })).statusCode).toBe(422);
    expect((await lucas.patch(`/abm/${abmId}/organization`, { rowVersion: d.organization.rowVersion - 1, city: 'Lagarto' })).statusCode).toBe(409);
    expect(d.history.some((h: { type: string }) => h.type === 'organizacao')).toBe(true);
  });
});
