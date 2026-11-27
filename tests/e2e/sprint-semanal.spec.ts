import { expect, test, type Page } from '@playwright/test';

/** Planejar Semana → abrir a Sprint → encerrar com o comparativo, pela liderança do Comercial. Dados fictícios. */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const monday = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

test('liderança planeja a semana, abre a Sprint e encerra com o comparativo', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 950 });
  const st = Date.now().toString(36);
  // semana distante e única por execução
  const week = monday(new Date(Date.UTC(2050, 0, 3) + (Date.now() % 3000) * 7 * 86_400_000));
  await login(page, 'carlos@yepnet.test');
  const api = page.request;
  const mods = await (await api.get('/api/v1/admin/modules')).json();
  const crm = (mods.items ?? mods.modules ?? []).find((m: { module: string }) => m.module === 'crm');
  const disabled = (crm?.disabledFeatures ?? crm?.config?.disabledFeatures ?? []).filter((f: string) => f !== 'crm.quadro_tarefas');
  expect((await api.put('/api/v1/admin/modules/crm', { data: { enabled: true, mode: 'todos', disabledFeatures: disabled, note: 'Teste: liga o quadro de tarefas' } })).ok()).toBe(true);
  const lk = await (await api.get('/api/v1/meta/lookups')).json();
  const residencial = lk.teams.find((t: { name: string }) => t.name === 'Residencial').id;
  expect((await api.put('/api/v1/quadros/comercial/config', { data: { teamIds: [residencial], wipLimit: 3, wipCountsWaiting: false } })).ok()).toBe(true);

  await login(page, 'lucas@yepnet.test');
  const t = await (await page.request.post('/api/v1/tasks', { data: { title: `Proposta fictícia da semana ${st}` } })).json();

  await login(page, 'ana@yepnet.test');
  const rv = (await (await page.request.get(`/api/v1/tasks/${t.id}`)).json());
  expect((await page.request.patch(`/api/v1/quadros/tarefas/${t.id}/planejamento`, { data: { rowVersion: rv.rowVersion ?? rv.task?.rowVersion, capacityCategory: 'comercial' } })).ok()).toBe(true);

  await page.goto(`/quadro/comercial?week=${week}`);
  const bar = page.getByRole('region', { name: 'Sprint da semana' });
  await expect(bar).toContainText('não planejada');
  await bar.getByRole('button', { name: 'Planejar semana' }).click();
  const dlg = page.getByRole('dialog', { name: /Planejar semana/ });
  await dlg.getByLabel('Objetivo da semana').fill('Fechar propostas fictícias');
  const pend = dlg.locator('li', { hasText: `Proposta fictícia da semana ${st}` });
  await pend.getByRole('button', { name: 'Incluir' }).click();
  await expect(dlg.getByText('Falta: sem esforço')).toBeVisible();
  await dlg.getByLabel(`Esforço de Proposta fictícia da semana ${st}`).fill('3h');
  await expect(dlg.getByRole('complementary', { name: 'Capacidade da semana' })).toContainText('3h');
  // fora da diretriz (100% comercial) e Lucas sem jornada: pede justificativa
  await expect(dlg.getByRole('button', { name: 'Abrir Sprint' })).toBeDisabled();
  await dlg.getByLabel(/Justificativa para abrir/).fill('Semana só de propostas, combinada com a gerência (fictício)');
  await page.screenshot({ path: 'test-results/planejar-semana.png' });
  await dlg.getByRole('button', { name: 'Abrir Sprint' }).click();
  await expect(page.getByText('Sprint aberta: o plano original ficou registrado')).toBeVisible();
  await expect(bar).toContainText('Em andamento');
  await expect(bar).toContainText('Fechar propostas fictícias');

  await bar.getByRole('button', { name: 'Encerrar Sprint' }).click();
  const close = page.getByRole('dialog', { name: 'Encerrar Sprint' });
  await close.getByLabel('Aprendizados e impedimentos (opcional)').fill('Aprendizado fictício');
  await close.getByRole('button', { name: 'Encerrar Sprint' }).click();
  const res = page.getByRole('dialog', { name: 'Resultado da Sprint' });
  await expect(res).toContainText('Plano original');
  await expect(res).toContainText('Não entregues');
  await expect(res).toContainText(`Proposta fictícia da semana ${st}`);
  await page.screenshot({ path: 'test-results/sprint-resultado.png' });
  await res.getByRole('button', { name: 'Fechar' }).first().click();
  await expect(bar).toContainText('Encerrada');
});
