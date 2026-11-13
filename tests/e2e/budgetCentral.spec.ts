import { expect, test, type Page } from '@playwright/test';

/** Central do orçamento: tela única com indicadores, DRE, painel do lançamento, aprovação e execução. */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('central do orçamento: planejar, enviar e ver no painel sem sair da tela', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/orcamento');
  const setup = page.getByRole('button', { name: 'Criar estrutura sugerida' });
  await expect(setup.or(page.getByRole('region', { name: 'Indicadores do orçamento' }))).toBeVisible();
  if (await setup.isVisible()) await setup.click();
  await expect(page.getByRole('region', { name: 'Indicadores do orçamento' })).toBeVisible();
  await page.getByRole('button', { name: 'Novo lançamento' }).click();
  const dlg = page.getByRole('dialog', { name: 'Novo lançamento' });
  const accSel = dlg.getByLabel('Conta e subconta');
  const val = await accSel.locator('option', { hasText: '3.1.03' }).getAttribute('value');
  await accSel.selectOption(val!);
  await dlg.getByLabel('Descrição').fill('Brindes para evento de clientes');
  await dlg.getByLabel('Justificativa').fill('Evento anual com as contas estratégicas');
  await dlg.getByLabel('Quantidade').fill('500');
  await dlg.getByLabel('Valor unitário (R$)').fill('40,00');
  await expect(dlg.getByLabel('Total calculado')).toHaveValue(/20\.000,00/);
  await dlg.getByRole('button', { name: 'Criar lançamento' }).click();
  const panel = page.getByRole('dialog', { name: /ORC-\d{4}-\d{4}/ });
  await expect(panel.getByRole('tab', { name: 'Planejamento' })).toBeVisible();
  await page.screenshot({ path: 'test-results/orc-painel.png' });
  await panel.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(panel.getByText('Enviado para aprovação').first()).toBeVisible();
  await panel.getByRole('tab', { name: 'Resultado' }).click();
  await expect(panel.getByText('Comprometido, realizado e pago são estágios')).toBeVisible();
  await page.keyboard.press('Escape');
  const table = page.getByRole('region', { name: 'Lançamentos do orçamento' });
  await expect(table.getByText('Brindes para evento de clientes').first()).toBeVisible();
  await expect(table.getByRole('button', { name: /3\.1 Comunicação/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/orc-central.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/orc-central-390.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
