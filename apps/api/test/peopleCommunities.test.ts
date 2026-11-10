/** Pessoas & Cultura · Etapa 3: comunidades pública, privada e institucional; participação, papéis, fixar, arquivar e privacidade. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client, rafael: Client, mariana: Client, outro: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
const ids = (r: { json: () => { items: { id: string }[] } }) => r.json().items.map((x) => x.id);

beforeAll(async () => {
  ctx = await makeApp();
  await ctx.db.execute(sql`delete from module_grants where module = 'pessoas_cultura'`);
  for (const e of ['carlos', 'lucas', 'ana', 'rafael', 'mariana']) {
    await ctx.db.execute(sql`insert into module_grants (tenant_id, module, subject_type, subject_id, effect, reason) select tenant_id, 'pessoas_cultura', 'usuario', id, 'liberar', 'teste comunidades' from users where email = ${`${e}@yepnet.test`}`);
  }
  await ctx.db.execute(sql`insert into module_grants (tenant_id, module, subject_type, subject_id, effect, reason) select tenant_id, 'pessoas_cultura', 'usuario', id, 'liberar', 'teste' from users where email = 'vendedor@outro.test'`);
  // papel de Pessoas e Cultura pelo setor "administracao" (Carlos); ninguém mais administra
  const t = (await ctx.db.execute(sql`select tenant_id from users where email = 'carlos@yepnet.test'`)).rows[0] as { tenant_id: string };
  await ctx.db.execute(sql`insert into people_settings (tenant_id, settings) values (${t.tenant_id}, ${JSON.stringify({ roles: { pessoasCultura: ['administracao'], comunicacao: [], moderacao: [] } })}::jsonb) on conflict (tenant_id) do update set settings = excluded.settings`);
  await ctx.db.execute(sql`update users set sectors = '{administracao}' where email = 'carlos@yepnet.test'`);
  await ctx.db.execute(sql`update users set sectors = '{}' where email in ('ana@yepnet.test', 'lucas@yepnet.test', 'rafael@yepnet.test', 'mariana@yepnet.test')`);
  [carlos, lucas, ana, rafael, mariana, outro] = (await Promise.all(['carlos', 'lucas', 'ana', 'rafael', 'mariana'].map((n) => login(ctx.app, `${n}@yepnet.test`)).concat(login(ctx.app, 'vendedor@outro.test')))) as [Client, Client, Client, Client, Client, Client];
});
afterAll(async () => {
  await ctx.db.execute(sql`delete from module_grants where module = 'pessoas_cultura'`);
  await ctx.db.execute(sql`delete from people_settings`);
  await ctx.close();
});

describe('Pessoas & Cultura · comunidades', () => {
  let pub = '', priv = '', inst = '';
  it('quem cria: gestor cria pública/privada; colaborador não; institucional só Pessoas e Cultura/Comunicação', async () => {
    expect((await lucas.post('/pessoas/comunidades', { name: 'Fibra e Redes' })).statusCode).toBe(403);
    expect((await ana.post('/pessoas/comunidades', { name: 'Avisos da Empresa', kind: 'institucional' })).statusCode).toBe(403);
    const p = ok(await ana.post('/pessoas/comunidades', { name: 'Fibra e Redes', description: 'Troca técnica', category: 'Técnica', rules: 'Respeito sempre.' }), 201).json();
    expect(p).toMatchObject({ kind: 'publica', myRole: 'responsavel', memberCount: 1, perms: { post: true, manage: true } });
    pub = p.id;
    expect((await carlos.post('/pessoas/comunidades', { name: 'fibra e redes' })).statusCode).toBe(422); // nome repetido
    priv = ok(await ana.post('/pessoas/comunidades', { name: 'Liderança Comercial', kind: 'privada' }), 201).json().id;
    inst = ok(await carlos.post('/pessoas/comunidades', { name: 'Avisos da Empresa', kind: 'institucional' }), 201).json().id;
  });

  it('pública: entra direto; não-membro lê na página mas não recebe no feed; publicar exige ser membro', async () => {
    expect((await lucas.post('/pessoas/posts', { body: 'Oi comunidade', communityId: pub })).statusCode).toBe(403);
    expect(ok(await lucas.post(`/pessoas/comunidades/${pub}/participar`, {})).json().status).toBe('membro');
    const post = ok(await lucas.post('/pessoas/posts', { body: 'Dica de emenda de fibra', communityId: pub }), 201).json();
    expect(post).toMatchObject({ audience: 'comunidade', community: { id: pub, name: 'Fibra e Redes' }, audienceLabel: 'Fibra e Redes' });
    expect(ids(ok(await rafael.get(`/pessoas/feed?comunidade=${pub}`)))).toContain(post.id); // pública: lê
    expect(ids(ok(await rafael.get('/pessoas/feed')))).not.toContain(post.id); // feed: só comunidades em que participa
    expect(ids(ok(await ana.get('/pessoas/feed')))).toContain(post.id);
    ok(await rafael.put(`/pessoas/posts/${post.id}/reacao`, { kind: 'curtir' })); // pública: interage
    expect(ok(await ana.get(`/pessoas/comunidades/${pub}`)).json().memberCount).toBe(2);
  });

  it('privada: pedido aprovado pelo responsável; conteúdo fechado mesmo com o ID; administração não lê sem ser membro', async () => {
    const secret = ok(await ana.post('/pessoas/posts', { body: 'Metas do trimestre (só liderança)', communityId: priv }), 201).json();
    expect((await rafael.get(`/pessoas/feed?comunidade=${priv}`)).statusCode).toBe(403);
    expect((await rafael.get(`/pessoas/posts/${secret.id}`)).statusCode).toBe(404);
    expect((await rafael.post(`/pessoas/posts/${secret.id}/comentarios`, { body: 'x' })).statusCode).toBe(404);
    expect((await rafael.get(`/pessoas/comunidades/${priv}/membros`)).statusCode).toBe(403);
    // Carlos administra o módulo: gerencia participantes, mas não lê o conteúdo
    expect((await carlos.get(`/pessoas/posts/${secret.id}`)).statusCode).toBe(404);
    expect((await carlos.get(`/pessoas/feed?comunidade=${priv}`)).statusCode).toBe(403);
    ok(await carlos.get(`/pessoas/comunidades/${priv}/membros`));
    // a lista mostra a privada (para pedir), mas sem conteúdo
    expect(ok(await rafael.get('/pessoas/comunidades')).json().items.find((c: { id: string }) => c.id === priv)).toMatchObject({ kind: 'privada', myRole: null, perms: { read: false, join: true } });
    expect(ok(await rafael.post(`/pessoas/comunidades/${priv}/participar`, { message: 'Coordeno o time de vendas' })).json().status).toBe('pendente');
    const reqs = ok(await ana.get(`/pessoas/comunidades/${priv}/pedidos`)).json().items;
    expect(reqs).toHaveLength(1);
    expect((await rafael.post(`/pessoas/comunidades-pedidos/${reqs[0].id}/decisao`, { approve: true })).statusCode).toBe(403); // não aprova o próprio
    ok(await ana.post(`/pessoas/comunidades-pedidos/${reqs[0].id}/decisao`, { approve: true }));
    expect(ids(ok(await rafael.get(`/pessoas/feed?comunidade=${priv}`)))).toContain(secret.id);
    expect(ids(ok(await rafael.get('/pessoas/feed')))).toContain(secret.id);
  });

  it('convite: só a pessoa convidada aceita; moderador convida e remove membro, mas não define papéis', async () => {
    ok(await ana.post(`/pessoas/comunidades/${priv}/convites`, { userIds: [mariana.me.user.id, outro.me.user.id] }));
    const inv = ok(await mariana.get('/pessoas/comunidades-convites')).json().items;
    expect(inv.map((x: { community: { id: string } }) => x.community.id)).toEqual([priv]);
    expect(ok(await outro.get('/pessoas/comunidades-convites')).json().items).toEqual([]); // outra empresa: ignorada
    expect((await lucas.post(`/pessoas/comunidades-pedidos/${inv[0].id}/decisao`, { approve: true })).statusCode).toBe(403);
    ok(await mariana.post(`/pessoas/comunidades-pedidos/${inv[0].id}/decisao`, { approve: true }));
    ok(await ana.patch(`/pessoas/comunidades/${priv}/membros/${rafael.me.user.id}`, { role: 'moderador' }));
    rafael = await login(ctx.app, 'rafael@yepnet.test');
    expect((await rafael.patch(`/pessoas/comunidades/${priv}/membros/${mariana.me.user.id}`, { role: 'moderador' })).statusCode).toBe(403);
    ok(await rafael.del(`/pessoas/comunidades/${priv}/membros/${mariana.me.user.id}`), 204);
    expect((await rafael.del(`/pessoas/comunidades/${priv}/membros/${ana.me.user.id}`)).statusCode).toBe(403);
    expect((await ana.post(`/pessoas/comunidades/${priv}/sair`)).statusCode).toBe(422); // único responsável
    expect((await ana.patch(`/pessoas/comunidades/${priv}/membros/${ana.me.user.id}`, { role: 'membro' })).statusCode).toBe(422);
  });

  it('institucional: todos leem e entram; só responsável e moderadores publicam', async () => {
    ok(await lucas.post(`/pessoas/comunidades/${inst}/participar`, {}));
    expect((await lucas.post('/pessoas/posts', { body: 'tentativa', communityId: inst })).statusCode).toBe(403);
    const p = ok(await carlos.post('/pessoas/posts', { body: 'Bem-vindos ao canal oficial', communityId: inst }), 201).json();
    expect(ids(ok(await mariana.get(`/pessoas/feed?comunidade=${inst}`)))).toContain(p.id);
  });

  it('fixar (até 3, só moderação) e arquivar (só leitura, sai da lista)', async () => {
    const posts = [];
    for (let i = 0; i < 4; i++) posts.push(ok(await lucas.post('/pessoas/posts', { body: `Material ${i}`, communityId: pub }), 201).json().id);
    expect((await lucas.put(`/pessoas/posts/${posts[0]}/fixar`, { pinned: true })).statusCode).toBe(403);
    for (let i = 0; i < 3; i++) ok(await ana.put(`/pessoas/posts/${posts[i]}/fixar`, { pinned: true }));
    expect((await ana.put(`/pessoas/posts/${posts[3]}/fixar`, { pinned: true })).statusCode).toBe(422);
    const page = ok(await rafael.get(`/pessoas/feed?comunidade=${pub}`)).json();
    expect(page.pinned.map((x: { id: string }) => x.id)).toEqual([posts[2], posts[1], posts[0]]);
    expect(page.items.map((x: { id: string }) => x.id)).not.toContain(posts[0]);

    expect((await lucas.post(`/pessoas/comunidades/${pub}/arquivo`, { archived: true })).statusCode).toBe(403);
    ok(await ana.post(`/pessoas/comunidades/${pub}/arquivo`, { archived: true }));
    expect(ids(ok(await rafael.get('/pessoas/comunidades')))).not.toContain(pub);
    expect(ids(ok(await rafael.get('/pessoas/comunidades?arquivadas=1')))).toContain(pub);
    expect((await lucas.post('/pessoas/posts', { body: 'depois de arquivada', communityId: pub })).statusCode).toBe(403);
    expect((await rafael.post(`/pessoas/posts/${posts[3]}/comentarios`, { body: 'oi' })).statusCode).toBe(422);
    ok(await rafael.get(`/pessoas/feed?comunidade=${pub}`)); // leitura continua
  });

  it('perfil mostra as comunidades; privada só para quem também é membro', async () => {
    const seenByAna = ok(await ana.get(`/pessoas/perfis/${rafael.me.user.id}`)).json().communities.map((c: { id: string }) => c.id);
    expect(seenByAna).toContain(priv);
    const seenByMariana = ok(await mariana.get(`/pessoas/perfis/${rafael.me.user.id}`)).json().communities.map((c: { id: string }) => c.id);
    expect(seenByMariana).not.toContain(priv);
  });

  it('isolamento: outra empresa não vê nem entra', async () => {
    expect((await outro.get(`/pessoas/comunidades/${inst}`)).statusCode).toBe(404);
    expect((await outro.post(`/pessoas/comunidades/${inst}/participar`, {})).statusCode).toBe(404);
    expect(ok(await outro.get('/pessoas/comunidades')).json().items).toEqual([]);
  });
});
