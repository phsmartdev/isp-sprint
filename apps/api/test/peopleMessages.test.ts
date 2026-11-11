/** Pessoas & Cultura: mensagens diretas (privadas), @ do topo só com marcação e institucional, contadores e destaques. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client, ana: Client, rafael: Client;
const startedAt = new Date();
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };

beforeAll(async () => {
  ctx = await makeApp();
  await ctx.db.execute(sql`delete from module_grants where module = 'pessoas_cultura'`);
  for (const e of ['carlos', 'lucas', 'ana']) {
    await ctx.db.execute(sql`insert into module_grants (tenant_id, module, subject_type, subject_id, effect, reason) select tenant_id, 'pessoas_cultura', 'usuario', id, 'liberar', 'teste mensagens' from users where email = ${`${e}@yepnet.test`}`);
  }
  const t = ((await ctx.db.execute(sql`select tenant_id from users where email = 'carlos@yepnet.test'`)).rows[0] as { tenant_id: string }).tenant_id;
  await ctx.db.execute(sql`delete from people_settings`);
  await ctx.db.execute(sql`insert into people_settings (tenant_id, settings) values (${t}, ${JSON.stringify({ roles: { comunicacao: ['administracao'], pessoasCultura: [], moderacao: [] } })}::jsonb)`);
  await ctx.db.execute(sql`update users set sectors = '{administracao}' where email = 'carlos@yepnet.test'`);
  [carlos, lucas, ana, rafael] = (await Promise.all(['carlos', 'lucas', 'ana', 'rafael'].map((n) => login(ctx.app, `${n}@yepnet.test`)))) as [Client, Client, Client, Client];
});
afterAll(async () => {
  await ctx.db.execute(sql`update people_posts set deleted_at = now() where created_at >= ${startedAt} and deleted_at is null`);
  await ctx.db.execute(sql`delete from module_grants where module = 'pessoas_cultura'`);
  await ctx.db.execute(sql`delete from people_settings`);
  await ctx.db.execute(sql`update users set sectors = '{}' where email = 'carlos@yepnet.test'`);
  await ctx.close();
});

describe('Pessoas & Cultura · mensagens diretas', () => {
  it('conversa entre dois colegas: privada, uma só por par, não lidas e apagar a própria', async () => {
    expect((await lucas.post('/pessoas/mensagens/conversas', { userId: rafael.me.user.id })).statusCode).toBe(422); // sem acesso ao módulo
    const { id } = ok(await lucas.post('/pessoas/mensagens/conversas', { userId: ana.me.user.id })).json();
    expect(ok(await ana.post('/pessoas/mensagens/conversas', { userId: lucas.me.user.id })).json().id).toBe(id); // mesma conversa
    ok(await lucas.post(`/pessoas/mensagens/conversas/${id}`, { body: 'Oi Ana, tudo certo para amanhã?' }), 201);
    const m2 = ok(await lucas.post(`/pessoas/mensagens/conversas/${id}`, { body: 'Mensagem errada' }), 201).json();
    expect(ok(await ana.get('/pessoas/contadores')).json().messages).toBe(2);
    const list = ok(await ana.get('/pessoas/mensagens')).json().items;
    expect(list[0]).toMatchObject({ id, with: { name: 'Lucas Lima' }, unread: 2, last: 'Mensagem errada' });
    expect((await carlos.get(`/pessoas/mensagens/conversas/${id}`)).statusCode).toBe(404); // nem a gerência lê
    expect((await ana.del(`/pessoas/mensagens/${m2.id}`)).statusCode).toBe(403);
    ok(await lucas.del(`/pessoas/mensagens/${m2.id}`), 204);
    const conv = ok(await ana.get(`/pessoas/mensagens/conversas/${id}`)).json();
    expect(conv.items.map((m: { body: string }) => m.body)).toEqual(['Oi Ana, tudo certo para amanhã?']);
    expect(ok(await ana.get('/pessoas/contadores')).json().messages).toBe(0);
    expect(ok(await lucas.get(`/pessoas/mensagens/conversas/${id}`)).json().items[0].seen).toBe(true);
  });
});

describe('Pessoas & Cultura · grupos e envio de publicação', () => {
  it('grupo com várias pessoas; publicação enviada aparece para quem pode ver; privada fica indisponível', async () => {
    expect((await carlos.post('/pessoas/mensagens/grupos', { title: 'Time', userIds: [ana.me.user.id] })).statusCode).toBe(422); // mínimo 2
    const g = ok(await carlos.post('/pessoas/mensagens/grupos', { title: 'Time Residencial', userIds: [ana.me.user.id, lucas.me.user.id] }), 201).json();
    const post = ok(await ana.post('/pessoas/posts', { body: 'Bastidores da instalação' }), 201).json();
    expect(ok(await carlos.post(`/pessoas/posts/${post.id}/enviar`, { conversationIds: [g.id], userIds: [lucas.me.user.id], note: 'Olhem isso' })).json().sent).toBe(2);
    const lg = ok(await lucas.get(`/pessoas/mensagens/conversas/${g.id}`)).json();
    expect(lg).toMatchObject({ kind: 'grupo', title: 'Time Residencial' });
    expect(lg.members.map((m: { name: string }) => m.name).sort()).toEqual(['Ana Souza', 'Carlos Silva']);
    expect(lg.items.at(-1)).toMatchObject({ body: 'Olhem isso', author: { name: 'Carlos Silva' }, post: { id: post.id, unavailable: false, excerpt: 'Bastidores da instalação' } });
    const list = ok(await lucas.get('/pessoas/mensagens')).json().items;
    expect(list.find((c: { id: string }) => c.id === g.id)).toMatchObject({ kind: 'grupo', title: 'Time Residencial', last: 'Carlos: Olhem isso' });
    expect(list.some((c: { kind: string; with: { name: string } | null }) => c.kind === 'direta' && c.with?.name === 'Carlos Silva')).toBe(true);
    // comunidade privada da Ana: Carlos não é membro, então não envia; Ana envia para o Carlos e ele vê "indisponível"
    const priv = ok(await ana.post('/pessoas/comunidades', { name: `Privada msg ${Date.now()}`, kind: 'privada' }), 201).json().id;
    const pp = ok(await ana.post('/pessoas/posts', { body: 'Assunto restrito', communityId: priv }), 201).json();
    expect((await carlos.post(`/pessoas/posts/${pp.id}/enviar`, { userIds: [lucas.me.user.id] })).statusCode).toBe(404);
    ok(await ana.post(`/pessoas/posts/${pp.id}/enviar`, { userIds: [carlos.me.user.id] }));
    const dm = ok(await carlos.get('/pessoas/mensagens')).json().items.find((c: { kind: string; with: { name: string } | null }) => c.kind === 'direta' && c.with?.name === 'Ana Souza');
    const conv = ok(await carlos.get(`/pessoas/mensagens/conversas/${dm.id}`)).json();
    expect(conv.items.at(-1).post).toEqual({ id: pp.id, unavailable: true });
    expect(JSON.stringify(conv)).not.toContain('Assunto restrito');
    // sair do grupo
    ok(await lucas.post(`/pessoas/mensagens/conversas/${g.id}/sair`, {}));
    expect((await lucas.get(`/pessoas/mensagens/conversas/${g.id}`)).statusCode).toBe(404);
    await ctx.db.execute(sql`update people_communities set status = 'arquivada' where id = ${priv}`);
  });
});

describe('Pessoas & Cultura · @ do topo e destaques', () => {
  it('@ mostra marcação e publicação institucional; comentário fica só em Notificações', async () => {
    const inst = ok(await carlos.post('/pessoas/posts', { body: 'Comunicado: horário de fim de ano', kind: 'institucional' }), 201).json();
    const mine = ok(await lucas.post('/pessoas/posts', { body: 'Oi @Ana', mentions: [ana.me.user.id] }), 201).json();
    ok(await carlos.post(`/pessoas/posts/${mine.id}/comentarios`, { body: 'Boa!' }), 201);
    const bell = (c: Client) => c.get('/me/mentions').then((r) => ok(r).json().items.filter((i: { kind: string }) => i.kind === 'aviso'));
    const anaBell = await bell(ana);
    expect(anaBell.some((i: { source: string; contactName: string }) => i.source === 'pessoas_institucional' && i.contactName.endsWith(inst.id))).toBe(true);
    expect(anaBell.some((i: { source: string; contactName: string }) => i.source === 'pessoas_mencao' && i.contactName.endsWith(mine.id))).toBe(true);
    expect((await bell(lucas)).some((i: { source: string }) => i.source === 'pessoas_comentario')).toBe(false);
    const all = ok(await lucas.get('/pessoas/notificacoes')).json().items;
    expect(all.some((n: { event: string }) => n.event === 'comentario')).toBe(true);
    expect(ok(await lucas.get('/pessoas/contadores')).json().notifications).toBeGreaterThanOrEqual(1);
    const d = ok(await ana.get('/pessoas/destaques')).json().items;
    expect(d.some((p: { name: string }) => p.name === 'Lucas Lima')).toBe(true);
    // publicação institucional não coloca o autor nos destaques (só publicações comuns das últimas 48 h)
    const common = Number(((await ctx.db.execute(sql`select count(*)::int as n from people_posts p join users u on u.id = p.author_id where u.email = 'carlos@yepnet.test' and p.kind <> 'institucional' and p.status = 'publicado' and p.deleted_at is null and p.published_at > now() - interval '48 hours'`)).rows[0] as { n: number }).n);
    expect(d.some((p: { name: string }) => p.name === 'Carlos Silva')).toBe(common > 0);
  });
});
