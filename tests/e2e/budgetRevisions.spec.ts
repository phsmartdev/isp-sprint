import { expect, test } from '@playwright/test';

test('revisões e projeção: projeção com cenário e pedido de revisão', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.request.post('/api/v1/budget/setup');
  await page.goto('/orcamento?t=revisoes');
  const proj = page.getByRole('region', { name: 'Projeção até o fim do exercício' });
  await expect(proj).toBeVisible();
  await proj.getByLabel(/Cenário nos meses à frente/).fill('10');
  await expect(proj.getByText(/Cenário nos meses à frente: \+10%/)).toBeVisible();
  await page.getByRole('button', { name: 'Nova revisão ou remanejamento' }).click();
  await expect(page.getByRole('dialog', { name: 'Nova revisão ou remanejamento' }).getByLabel('Tipo')).toBeVisible();
  await page.screenshot({ path: 'test-results/revisoes.png' });
});
