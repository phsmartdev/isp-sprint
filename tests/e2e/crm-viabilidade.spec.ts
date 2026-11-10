import { expect, test, type Page } from '@playwright/test';

/** Viabilidade econômica como opção do módulo CRM: desligada, somem a aba, o painel, a fila e as configurações. */
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('CRM → funcionalidades: desligar e religar a viabilidade econômica', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  const list = await (await page.request.get('/api/v1/opportunities?pageSize=5')).json();
  const opp = list.items[0];

  await page.goto('/settings/modulos');
  let crm = page.getByRole('region', { name: 'Módulo CRM', exact: true });
  const box = crm.getByLabel(/Viabilidade econômica \(motor financeiro/);
  await expect(box).toBeChecked();
  await box.uncheck();
  await crm.getByLabel('Motivo da alteração').fill('Liberar a viabilidade econômica só depois do treinamento');
  const saved = page.waitForResponse((r) => r.url().includes('/admin/modules/crm') && r.request().method() === 'PUT');
  await crm.getByRole('button', { name: 'Salvar CRM' }).click();
  expect((await saved).status()).toBe(200);

  await page.goto(`/opportunities/${opp.id}`);
  await expect(page.getByRole('tab', { name: 'Histórico' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Viabilidade econômica' })).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="econ-sum"]')).toHaveCount(0);
  await page.goto('/settings/viability');
  await expect(page.getByText('Viabilidade econômica desligada')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Financial Studio' })).toHaveCount(0);

  await page.goto('/settings/modulos');
  crm = page.getByRole('region', { name: 'Módulo CRM', exact: true });
  await crm.getByLabel(/Viabilidade econômica \(motor financeiro/).check();
  await crm.getByLabel('Motivo da alteração').fill('Treinamento concluído: viabilidade liberada');
  const saved2 = page.waitForResponse((r) => r.url().includes('/admin/modules/crm') && r.request().method() === 'PUT');
  await crm.getByRole('button', { name: 'Salvar CRM' }).click();
  expect((await saved2).status()).toBe(200);
  await page.goto(`/opportunities/${opp.id}`);
  await expect(page.getByRole('tab', { name: 'Viabilidade econômica' })).toBeVisible();
});
