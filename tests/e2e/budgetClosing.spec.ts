import { expect, test } from '@playwright/test';

test('fechamento mensal: competências, conferência e política', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.request.post('/api/v1/budget/setup');
  await page.goto('/orcamento?t=fechamento&y=2025');
  await expect(page.getByRole('region', { name: 'Competências do ano' })).toBeVisible();
  await page.getByRole('button', { name: /Março/ }).click();
  const sec = page.getByRole('region', { name: 'Fechamento da competência' });
  await expect(sec.getByRole('heading', { name: /Fechamento de Março de 2025/ })).toBeVisible();
  const start = sec.getByRole('button', { name: 'Iniciar conferência' });
  if (await start.isVisible()) { await start.click(); await expect(sec.getByText('Em conferência').first()).toBeVisible(); }
  await page.screenshot({ path: 'test-results/fechamento.png', fullPage: true });
});
