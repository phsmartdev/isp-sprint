/** Roteiros dos tipos de tarefa: só administração edita; versões append-only; chegam ao time pelas lookups. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let admin: Client, lucas: Client;
beforeAll(async () => { ctx = await makeApp(); admin = await login(ctx.app, 'carlos@yepnet.test'); lucas = await login(ctx.app, 'lucas@yepnet.test'); });
afterAll(async () => ctx.close());

describe('Roteiros dos tipos de tarefa', () => {
  it('salva versões, vale a última, vendedor só lê pelas lookups', async () => {
    expect((await lucas.put('/admin/activity-scripts', { type: 'ligacao', script: 'x' })).statusCode).toBe(403);
    let r = await admin.put('/admin/activity-scripts', { type: 'ligacao', script: '1. Apresente-se' });
    expect(r.statusCode, r.body).toBe(200);
    r = await admin.put('/admin/activity-scripts', { type: 'ligacao', script: '1. Apresente-se\n2. Confirme o interesse' });
    const lig = r.json().items.find((i: { type: string }) => i.type === 'ligacao');
    expect(lig.script).toMatch(/Confirme o interesse/);
    expect(lig.updatedByName).toBeTruthy();
    const lk = (await lucas.get('/meta/lookups')).json();
    expect(lk.activityScripts.ligacao).toMatch(/Confirme o interesse/);
    expect(lk.activityScripts.reuniao).toBeUndefined();
  });
});
