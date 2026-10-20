import { expect, test } from '@playwright/test';
test('gerência cria campo de cliente e preenche na ficha', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  await page.goto('/settings/fields');
  await page.getByRole('button', { name: 'Adicionar campo' }).click();
  const name = page.getByLabel('Nome do campo').last();
  await name.click();
  for (const ch of 'Time do coração') { await page.keyboard.type(ch); await page.waitForTimeout(40); }
  await expect(name).toBeFocused();
  await page.getByRole('button', { name: 'Salvar campos' }).click();
  await expect(page.getByText('Campos de cliente salvos')).toBeVisible();
  await page.getByRole('tab', { name: 'Negociações' }).click();
  await expect(page.getByLabel('Jornada')).toBeVisible();
  await page.screenshot({ path: 'test-results/custom-fields-admin.png', fullPage: true });
  await page.goto('/customers');
  await page.locator('tbody tr').first().click();
  const f = page.getByLabel('Time do coração');
  await f.fill('Confiança');
  await page.getByRole('button', { name: 'Salvar campos' }).click();
  await expect(page.getByText('Campos salvos')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Time do coração')).toHaveValue('Confiança');
  await page.screenshot({ path: 'test-results/custom-fields-customer.png', fullPage: true });
});
