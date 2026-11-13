import { expect, test } from '@playwright/test';

test('inteligência: eficiência orçamentária com fontes e atribuição', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/intelligence?v=eficiencia');
  await expect(page.getByRole('region', { name: 'Indicadores de eficiência' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Fontes dos números' })).toContainText('não é atribuída');
  await page.screenshot({ path: 'test-results/eficiencia.png', fullPage: true });
});
