/** Usuário só visualizador do setor: vê o que o setor vê, mas não recebe tarefas nem conclui etapas. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';
import { usersBySector } from '../src/services/contracts';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
const ok = <R extends { statusCode: number; body: string }>(r: R, code = 200) => { expect(r.statusCode, r.body).toBe(code); return r; };
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

it('participa da operação x só visualiza', async () => {
  const stamp = Date.now().toString(36);
  const ativo = ok(await carlos.post('/admin/users', { name: 'Pessoa Ativa Fictícia', email: `ativo-${stamp}@yepnet.test`, profile: 'operacao', teamIds: [], sectors: ['juridico'] }), 201).json();
  const vis = ok(await carlos.post('/admin/users', { name: 'Pessoa Visualizadora Fictícia', email: `vis-${stamp}@yepnet.test`, profile: 'operacao', teamIds: [], sectors: ['juridico'], sectorViewer: true }), 201).json();
  const tid = (await ctx.db.execute<{ tenant_id: string }>(sql`select tenant_id from users where email = 'carlos@yepnet.test'`)).rows[0]!.tenant_id;
  const holders = (await usersBySector(ctx.db, tid, ['juridico'])).map((u) => u.id);
  expect(holders).toContain(ativo.id);
  expect(holders).not.toContain(vis.id);
  const v = await login(ctx.app, `vis-${stamp}@yepnet.test`, vis.temporaryPassword);
  const me = ok(await v.get('/me')).json();
  expect(me).toMatchObject({ sectors: [], viewSectors: ['juridico'], sectorViewer: true });
  const list = ok(await carlos.get('/admin/users')).json();
  const items = list.users ?? list.items ?? list;
  expect(items.find((u: { id: string }) => u.id === vis.id).sectorViewer).toBe(true);
  // volta a participar
  ok(await carlos.patch(`/admin/users/${vis.id}`, { sectorViewer: false }));
  expect((await usersBySector(ctx.db, tid, ['juridico'])).map((u) => u.id)).toContain(vis.id);
});
