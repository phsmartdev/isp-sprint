/** Gestão de Resultados: estrutura, perspectivas por responsabilidade explícita (não por cargo), escopo e sem ciclos. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, ana: Client, lucas: Client, rafael: Client, mariana: Client;
const ok = <T extends { statusCode: number; body: string }>(r: T, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
let users: { id: string; email: string }[];
const uid = (n: string) => users.find((u) => u.email === `${n}@yepnet.test`)!.id;
let teams: { id: string; name: string }[];

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, ana, lucas, rafael, mariana] = (await Promise.all(['carlos', 'ana', 'lucas', 'rafael', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as Client[] as [Client, Client, Client, Client, Client];
  users = (await carlos.get('/admin/users')).json().users;
  teams = (await carlos.get('/meta/lookups')).json().teams;
});
afterAll(async () => ctx.close());

describe('Gestão de Resultados — estrutura e escopo', () => {
  let dir: string, area: string;
  it('monta diretoria → área, vincula times, recusa ciclo e substituto igual ao responsável', async () => {
    dir = ok(await carlos.post('/results/org/units', { name: 'Diretoria Comercial', kind: 'diretoria', responsibleId: uid('carlos') }), 201).json().id;
    area = ok(await carlos.post('/results/org/units', { name: 'Vendas Varejo', kind: 'area', parentId: dir, responsibleId: uid('mariana'), substituteId: uid('ana') }), 201).json().id;
    expect((await carlos.post('/results/org/units', { name: 'X', kind: 'area', responsibleId: uid('ana'), substituteId: uid('ana') })).statusCode).toBe(422);
    const org = ok(await carlos.get('/results/org')).json();
    const d = org.units.find((u: { id: string }) => u.id === dir);
    expect((await carlos.patch(`/results/org/units/${dir}`, { rowVersion: d.rowVersion, parentId: area })).statusCode).toBe(422);
    const res = teams.find((t) => t.name === 'Residencial')!;
    ok(await carlos.patch(`/results/org/teams/${res.id}`, { orgUnitId: area, substituteLeadId: uid('lucas') }));
    expect((await ana.get('/results/org')).statusCode).toBe(403);
    expect(ok(await carlos.get('/results/org')).json().events.length).toBeGreaterThanOrEqual(3);
  });

  it('perspectiva vem da responsabilidade: vendedora responsável pela área vira Gestão; líder substituto vira Liderança', async () => {
    // Mariana é vendedora (perfil), mas responde pela área: perspectiva Gestão com escopo da área
    const m = ok(await mariana.get('/results/scope')).json();
    expect(m.perspectives.map((p: { key: string }) => p.key)).toEqual(['gestao']);
    expect(m.teams.map((t: { name: string }) => t.name)).toEqual(['Residencial']);
    // Lucas é líder substituto do Residencial
    const l = ok(await lucas.get('/results/scope')).json();
    expect(l.roles).toEqual([expect.objectContaining({ perspective: 'lideranca', substitute: true })]);
    // Rafael não responde por nada: só a própria visão
    const r = ok(await rafael.get('/results/scope')).json();
    expect(r.perspectives).toEqual([]);
    expect(r.people).toBe(1);
    // Total vê as três perspectivas
    expect(ok(await carlos.get('/results/scope')).json().perspectives).toHaveLength(3);
    // escopo protegido
    expect((await mariana.get('/results/overview?perspective=diretoria')).statusCode).toBe(403);
    const other = teams.find((t) => t.name === 'Empresarial')!;
    expect((await mariana.get(`/results/overview?teamId=${other.id}`)).statusCode).toBe(403);
    ok(await mariana.get(`/results/overview?unitId=${area}`));
  });
});
