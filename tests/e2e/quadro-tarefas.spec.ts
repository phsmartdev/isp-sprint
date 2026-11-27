import { expect, test, type Page } from '@playwright/test';

/** Quadros de Tarefas: cada time tem o seu; tarefa enviada do Comercial ao Sucesso do Cliente; quem enviou acompanha. Dados fictícios. */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('quadro do Comercial, envio ao Sucesso do Cliente e acompanhamento em Enviadas', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 950 });
  const st = Date.now().toString(36);
  await login(page, 'carlos@yepnet.test');
  const api = page.request;
  // liga os submenus do Comercial e do Sucesso do Cliente (Produto continua escondido)
  const mods = await (await api.get('/api/v1/admin/modules')).json();
  const crm = (mods.items ?? mods.modules ?? []).find((m: { module: string }) => m.module === 'crm');
  const disabled = (crm?.disabledFeatures ?? crm?.config?.disabledFeatures ?? []).filter((f: string) => !['crm.quadro_tarefas', 'crm.quadro_sucesso'].includes(f));
  expect((await api.put('/api/v1/admin/modules/crm', { data: { enabled: true, mode: 'todos', disabledFeatures: disabled, note: 'Teste: liga os quadros de tarefas' } })).ok()).toBe(true);
  const lk = await (await api.get('/api/v1/meta/lookups')).json();
  const team = (n: string) => lk.teams.find((t: { name: string }) => t.name === n).id;
  expect((await api.put('/api/v1/quadros/comercial/config', { data: { teamIds: [team('Residencial')], wipLimit: 3, wipCountsWaiting: false } })).ok()).toBe(true);
  expect((await api.put('/api/v1/quadros/sucesso_cliente/config', { data: { teamIds: [team('Empresarial')], wipLimit: 3, wipCountsWaiting: false } })).ok()).toBe(true);

  await login(page, 'lucas@yepnet.test');
  const t = await (await page.request.post('/api/v1/tasks', { data: { title: `Plano de acompanhamento fictício ${st}` } })).json();
  await page.goto('/');
  await page.getByRole('button', { name: 'Comercial', exact: true }).click().catch(() => undefined);
  await page.getByRole('link', { name: 'Quadro de Tarefas' }).first().click();
  await expect(page).toHaveURL(/\/quadro\/comercial/);
  await expect(page.getByRole('link', { name: 'Quadro de Tarefas' }).filter({ hasText: 'Quadro de Tarefas' })).not.toHaveCount(0);
  const backlog = page.getByRole('region', { name: 'Backlog' });
  const card = backlog.locator('article', { hasText: `Plano de acompanhamento fictício ${st}` });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Sem categoria');
  await page.screenshot({ path: 'test-results/quadro-comercial.png' });

  await card.click();
  const plan = page.getByRole('region', { name: 'Planejamento' });
  await expect(plan).toContainText('Origem: Cadastro manual');
  await plan.getByRole('button', { name: 'Enviar para outro time' }).click();
  const dlg = page.getByRole('dialog', { name: 'Enviar para outro time' });
  await dlg.getByLabel('Para qual time').selectOption('sucesso_cliente');
  await dlg.getByLabel('Recado para o time (opcional)').fill('Cliente fictício pediu acompanhamento');
  await dlg.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByText('Tarefa enviada para Sucesso do Cliente')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(backlog.locator('article', { hasText: `fictício ${st}` })).toHaveCount(0);

  await page.getByRole('radio', { name: 'Enviadas a outros times' }).click();
  const sent = page.getByRole('table', { name: 'Tarefas enviadas a outros times' });
  await expect(sent.getByRole('row', { name: new RegExp(`fictício ${st}`) })).toContainText('Sucesso do Cliente');
  await expect(sent.getByRole('row', { name: new RegExp(`fictício ${st}`) })).toContainText('aguardando planejamento');

  // no Sucesso do Cliente, a liderança de lá recebe no backlog
  await login(page, 'ana@yepnet.test');
  await page.goto('/quadro/sucesso_cliente');
  await expect(page.getByRole('region', { name: 'Backlog' }).locator('article', { hasText: `fictício ${st}` })).toBeVisible();
  // Produto continua escondido
  expect((await page.request.get('/api/v1/quadros/produto')).status()).toBe(403);
  void t;
});
