/** Certificados de cursos: envio da própria área, validação pela liderança (nunca o próprio) e pontos na gamificação. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { DEFAULT_BADGES } from '@isp/domain';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client, lucas: Client;
beforeAll(async () => { ctx = await makeApp(); [carlos, lucas] = await Promise.all([login(ctx.app, 'carlos@yepnet.test'), login(ctx.app, 'lucas@yepnet.test')]); });
afterAll(async () => ctx.close());

it('envio, validação e pontos', async () => {
  const tenant = ((await ctx.db.execute(sql`select tenant_id from users where id = ${lucas.me.user.id}`)).rows[0] as { tenant_id: string }).tenant_id;
  // regra aprovada com certificados (10 + 0,5/h até 40 h, teto 40)
  await ctx.db.execute(sql`insert into gamification_settings (tenant_id, version, config, note, status, created_by) values (${tenant}, (select coalesce(max(version),0)+1 from gamification_settings where tenant_id = ${tenant}), ${JSON.stringify({ journeys: [], badges: DEFAULT_BADGES, certificates: { pointsPerCertificate: 10, pointsPerHourTenths: 5, maxHoursCounted: 40, monthlyCapPoints: 40 } })}::jsonb, 'teste', 'aprovada', ${carlos.me.user.id})`);
  await ctx.db.execute(sql`update users set sectors = array['comercial'] where id = ${lucas.me.user.id}`);
  const home = (await lucas.get('/times/certificados')).json();
  expect(home.rule.pointsPerCertificate).toBe(10);
  expect(home.areas).toContain('Comercial');
  const pdf = readFileSync(new URL('../../../tests/e2e/fixtures/playbook-ficticio.pdf', import.meta.url)).toString('base64');
  const body = { title: 'Negociação consultiva (fictício)', institution: 'Escola Fictícia', area: 'Comercial', hours: 8, completedOn: '2026-10-01', fileName: 'certificado.pdf', data: pdf };
  expect((await lucas.post('/times/certificados', { ...body, area: 'Jurídico' })).statusCode).toBe(422); // fora das áreas
  const c = await lucas.post('/times/certificados', body);
  expect(c.statusCode, c.body).toBe(201);
  const id = c.json().id;
  expect((await lucas.post(`/times/certificados/${id}/decisao`, { approve: true })).statusCode).toBe(403); // o próprio não valida
  expect((await carlos.post(`/times/certificados/${id}/decisao`, { approve: false })).statusCode).toBe(422); // recusa sem motivo
  const ok = await carlos.post(`/times/certificados/${id}/decisao`, { approve: true });
  expect(ok.statusCode, ok.body).toBe(200);
  const after = (await lucas.get('/times/certificados')).json();
  expect(after.mine.find((x: { id: string }) => x.id === id)).toMatchObject({ status: 'aprovado', points: 14 });
  expect((await lucas.get(`/times/certificados/${id}/arquivo`)).statusCode).toBe(200);
  // aparece em "Meus pontos" do mês da validação
  const meR = await lucas.get('/me/pontos'); expect(meR.statusCode, meR.body).toBe(200); const me = meR.json();
  expect(me.certificates.find((x: { certificateId: string }) => x.certificateId === id).points).toBe(14);
  // badge Crescimento soma os certificados; os outros badges começam sem faixa
  const growth = me.badges.find((b: { key: string }) => b.key === 'crescimento');
  expect(growth.parts.find((x: { source: string }) => x.source === 'certificados').points).toBeGreaterThanOrEqual(14);
  expect(me.badges).toHaveLength(5);
});
