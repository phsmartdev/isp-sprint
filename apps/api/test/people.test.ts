/** Pessoas & Cultura · Etapa 1: módulo liberado por pessoa/equipe, papéis pelo controle de acesso existente, perfil e isolamento. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client, rafael: Client, outro: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

beforeAll(async () => {
  ctx = await makeApp();
  [carlos, lucas, ana, rafael, outro] = await Promise.all(['carlos@yepnet.test', 'lucas@yepnet.test', 'ana@yepnet.test', 'rafael@yepnet.test', 'vendedor@outro.test'].map((e) => login(ctx.app, e)));
});
afterAll(async () => ctx.close());

const relogin = async (e: string) => login(ctx.app, e);
/** cargo atual no cadastro (outros testes podem mudar): o módulo só repete o que está lá */
const titleOf = async (email: string) => ((await ctx.db.execute(sql`select job_title from users where email = ${email}`)).rows[0] as { job_title: string | null }).job_title;

describe('Pessoas & Cultura · fundação', () => {
  it('nasce em teste: ninguém vê até a empresa liberar; libera por equipe ou pessoa', async () => {
    expect((await lucas.get('/pessoas/me')).statusCode).toBe(403);
    const mods = ok(await carlos.get('/admin/modules')).json();
    expect(mods.items.find((m: { key?: string; module?: string }) => (m.key ?? m.module) === 'pessoas_cultura')).toMatchObject({ mode: 'liberados', enabled: true });
    const teams = (await carlos.get('/meta/lookups')).json().teams as { id: string; name: string }[];
    const resid = teams.find((t) => t.name === 'Residencial')!;
    ok(await carlos.post('/admin/modules/pessoas_cultura/grants', { subjectType: 'equipe', subjectId: resid.id, effect: 'liberar', reason: 'Piloto do RH' }), 201);
    ok(await carlos.post('/admin/modules/pessoas_cultura/grants', { subjectType: 'usuario', subjectId: carlos.me.user.id, effect: 'liberar', reason: 'Piloto do RH' }), 201);
    [lucas, ana, carlos, rafael] = await Promise.all(['lucas@yepnet.test', 'ana@yepnet.test', 'carlos@yepnet.test', 'rafael@yepnet.test'].map(relogin));
    const me = ok(await lucas.get('/pessoas/me')).json();
    expect(me.me).toMatchObject({ name: 'Lucas Lima', firstName: 'Lucas', jobTitle: await titleOf('lucas@yepnet.test') });
    expect(me.caps).toEqual({ member: true, communicate: false, administer: false, moderate: false, configure: false });
    expect((await rafael.get('/pessoas/me')).statusCode).toBe(403); // time Empresarial não foi liberado
    // a gerência (sistema) configura os papéis, mas não vira administração do módulo por isso
    expect(ok(await carlos.get('/pessoas/me')).json().caps).toMatchObject({ member: true, administer: false, configure: true });
  });

  it('papéis do módulo vêm dos setores da empresa indicados na configuração', async () => {
    expect((await lucas.put('/pessoas/config', { roles: { pessoasCultura: ['administracao'] } })).statusCode).toBe(403);
    ok(await carlos.put('/pessoas/config', { roles: { pessoasCultura: ['administracao'], comunicacao: ['inteligencia_comercial'], moderacao: [] }, limits: { imageMb: 5, videoMb: 40, mediaPerPost: 6, postChars: 3000 } }));
    const users = (await carlos.get('/admin/users')).json().users as { id: string; email: string }[];
    ok(await carlos.patch(`/admin/users/${users.find((u) => u.email === 'ana@yepnet.test')!.id}`, { sectors: ['administracao'] }));
    ana = await relogin('ana@yepnet.test');
    expect(ok(await ana.get('/pessoas/me')).json().caps).toEqual({ member: true, communicate: true, administer: true, moderate: true, configure: true });
    expect(ok(await ana.get('/pessoas/config')).json().settings.limits.videoMb).toBe(40);
    expect((await carlos.put('/pessoas/config', { limits: { videoMb: 500 } })).statusCode).toBe(422);
  });

  it('perfil: institucional do cadastro e da estrutura; opcionais editáveis; contato só se a pessoa autorizar', async () => {
    const t = (await ctx.db.execute(sql`select tenant_id from users where email = 'lucas@yepnet.test'`)).rows[0] as { tenant_id: string };
    const area = (await ctx.db.execute(sql`insert into org_units (tenant_id, name, kind) values (${t.tenant_id}, 'Área Comercial', 'area') returning id`)).rows[0] as { id: string };
    const unit = (await ctx.db.execute(sql`insert into org_units (tenant_id, name, kind, parent_id) values (${t.tenant_id}, 'Unidade Aracaju', 'unidade', ${area.id}) returning id`)).rows[0] as { id: string };
    await ctx.db.execute(sql`update teams set org_unit_id = ${unit.id} where tenant_id = ${t.tenant_id} and name = 'Residencial'`);
    let p = ok(await ana.get(`/pessoas/perfis/${lucas.me.user.id}`)).json();
    expect(p).toMatchObject({ name: 'Lucas Lima', jobTitle: await titleOf('lucas@yepnet.test'), area: 'Área Comercial', unit: 'Unidade Aracaju', teams: ['Residencial'], self: false, contact: { email: null, phone: null } });
    expect(p.privacy).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(/password|cpf|salary|goal/i);
    ok(await lucas.put('/pessoas/perfil', { bio: 'Consultor focado em empresas.', interests: ['Redes', 'redes', 'Fibra'], skills: ['Negociação'], showEmail: true }));
    p = ok(await ana.get(`/pessoas/perfis/${lucas.me.user.id}`)).json();
    expect(p).toMatchObject({ bio: 'Consultor focado em empresas.', interests: ['redes', 'Fibra'], skills: ['Negociação'], contact: { email: 'lucas@yepnet.test', phone: null } });
    const mine = ok(await lucas.get(`/pessoas/perfis/${lucas.me.user.id}`)).json();
    expect(mine).toMatchObject({ self: true, privacy: { showEmail: true, showPhone: false } });
    expect(ok(await lucas.get('/pessoas/me')).json().profileComplete).toBe(true);
    // cargo, área e unidade não são editáveis pelo perfil social
    expect((await lucas.put('/pessoas/perfil', { bio: 'x'.repeat(601) })).statusCode).toBe(422);
    ok(await lucas.put('/pessoas/perfil', { bio: 'Ok', jobTitle: 'Diretor' } as never));
    expect(ok(await ana.get(`/pessoas/perfis/${lucas.me.user.id}`)).json().jobTitle).toBe(await titleOf('lucas@yepnet.test'));
  });

  it('isolamento: outra empresa não vê perfis nem busca colegas daqui', async () => {
    const t = (await ctx.db.execute(sql`select tenant_id from users where email = 'vendedor@outro.test'`)).rows[0] as { tenant_id: string };
    await ctx.db.execute(sql`insert into module_grants (tenant_id, module, subject_type, subject_id, effect, reason) values (${t.tenant_id}, 'pessoas_cultura', 'usuario', ${outro.me.user.id}, 'liberar', 'teste')`);
    outro = await relogin('vendedor@outro.test');
    ok(await outro.get('/pessoas/me'));
    expect((await outro.get(`/pessoas/perfis/${lucas.me.user.id}`)).statusCode).toBe(404);
    const found = ok(await outro.get('/pessoas/colaboradores?q=Lucas')).json();
    expect(found.items).toEqual([]);
    const here = ok(await ana.get('/pessoas/colaboradores?q=luc')).json();
    expect(here.items.map((x: { name: string }) => x.name)).toContain('Lucas Lima');
    expect(here.items[0]).not.toHaveProperty('email');
  });
});
