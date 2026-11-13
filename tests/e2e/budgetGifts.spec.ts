import { expect, test, type Page } from '@playwright/test';

/** Brindes → Planejamento e orçamento: o plano vira lançamento do orçamento e aparece nas duas telas. */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('planejar brinde gera o lançamento no orçamento', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const stamp = Date.now().toString(36);
  await page.request.post('/api/v1/budget/setup');
  expect((await page.request.post('/api/v1/brindes/itens', { data: { name: `Caneca fictícia ${stamp}`, unitCostCents: 2500, initialStock: 0 } })).status()).toBe(201);
  await page.goto('/brindes?t=planejamento');
  await page.getByRole('button', { name: 'Planejar brinde' }).click();
  const dlg = page.getByRole('dialog', { name: 'Planejar brinde' });
  const it = dlg.getByLabel('Brinde');
  await it.selectOption((await it.locator('option', { hasText: `Caneca fictícia ${stamp}` }).getAttribute('value'))!);
  await dlg.getByLabel('Quantidade planejada').fill('1000');
  await expect(dlg.getByText('R$ 25.000,00')).toBeVisible();
  await dlg.getByLabel('Destinação').fill('Contas ABM do evento');
  await dlg.getByRole('button', { name: 'Planejar' }).click();
  const table = page.getByRole('region', { name: 'Planejamento de brindes' });
  await expect(table.getByText(`Caneca fictícia ${stamp}`)).toBeVisible();
  await expect(table.getByRole('button', { name: 'Enviar para aprovação' }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/brindes-planejamento.png' });
  await page.goto('/orcamento?t=central');
  await expect(page.getByRole('region', { name: 'Lançamentos do orçamento' }).getByText(`Brinde: Caneca fictícia ${stamp}`)).toBeVisible();
  await page.goto('/brindes?t=envios');
  await page.getByRole('button', { name: 'Registrar envio' }).click();
  await page.getByRole('dialog').getByLabel('Destinação').selectOption('evento');
  await expect(page.getByRole('dialog').getByLabel('Conta (opcional)')).toBeVisible();
});
