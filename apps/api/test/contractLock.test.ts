/** Contrato validado: dados contratuais só por aditivo; campo vazio pode ser completado (ex.: data-base do reajuste). Dados fictícios. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { login, makeApp, type Client } from './helpers';

let ctx: Awaited<ReturnType<typeof makeApp>>;
let carlos: Client;
beforeAll(async () => { ctx = await makeApp(); carlos = await login(ctx.app, 'carlos@yepnet.test'); });
afterAll(async () => ctx.close());

it('data-base vazia: preenche sem aditivo, alerta de reajuste passa a valer; depois de preenchida, trava', async () => {
  const c = (await carlos.get('/contracts?pageSize=100')).json().items.find((x: { stage: string }) => ['vigente', 'implantacao', 'renovacao', 'reajuste'].includes(x.stage));
  expect(c, 'precisa de um contrato validado na seed').toBeTruthy();
  // simula contrato antigo sem data-base (a tabela de versões é só INSERT: libera só neste banco de teste)
  await ctx.app.db.execute(sql`alter table contract_versions disable trigger contract_versions_append_only`);
  await ctx.app.db.execute(sql`update contract_versions set adjustment_base_date = null where contract_id = ${c.id} and version = (select current_version from contracts where id = ${c.id})`);
  await ctx.app.db.execute(sql`alter table contract_versions enable trigger contract_versions_append_only`);

  const base = `${new Date().getFullYear() - 1}-${new Date(Date.now() + 10 * 86400000).toISOString().slice(5, 10)}`;
  const fill = await carlos.put(`/contracts/${c.id}`, { version: { adjustmentBaseDate: base }, reason: 'Data-base que faltou no cadastro' });
  expect(fill.statusCode).toBe(200);
  expect((await carlos.get(`/contracts/${c.id}`)).json().current.adjustmentBaseDate).toBe(base);

  const change = await carlos.put(`/contracts/${c.id}`, { version: { adjustmentBaseDate: '2020-01-01' }, reason: 'teste' });
  expect(change.statusCode).toBe(422);
  expect(change.json().detail).toContain('data-base do reajuste só muda por aditivo');

  // aniversário em 10 dias, dentro do prazo padrão de 30 dias: o monitoramento abre o alerta de reajuste
  await carlos.post('/contracts/alerts/run');
  const alerts = (await carlos.get(`/contracts/alerts?contractId=${c.id}`)).json().items as { kind: string }[];
  expect(alerts.some((a) => a.kind === 'reajuste')).toBe(true);
});
