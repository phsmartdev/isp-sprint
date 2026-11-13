import { expect, test } from '@playwright/test';

/** Central de Playbooks → Apresentação institucional: primeira tela (logo, Sergipe, selos). */
test('apresentação institucional: abre pela Central de Playbooks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/playbooks');
  await page.getByRole('link', { name: /Apresentação institucional BKT/ }).click();
  const deck = page.getByRole('region', { name: 'Apresentação institucional' });
  await expect(deck.getByRole('img', { name: /Mapa de Sergipe/ })).toBeVisible();
  await expect(deck).toContainText('Porto da Folha');
  await expect(deck.getByRole('region', { name: 'Selos e certificações' })).toContainText('Enviar selos');
  // envia a imagem dos selos direto da apresentação
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAPAAAAAoCAYAAADAOHfQAAAAl0lEQVR4nO3TQQ3AIADAwDFD6MEQtpmHfUiTOwX9dMy1zwMkvbcDgP8MDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAI+wAJdQJdOHXjIwAAAABJRU5ErkJggg==', 'base64');
  const resp = page.waitForResponse((r) => r.url().includes('/admin/branding/selos_certificacoes') && r.request().method() === 'PUT');
  await deck.locator('input[type=file]').setInputFiles({ name: 'selos.png', mimeType: 'image/png', buffer: png });
  const r = await resp;
  expect(r.status(), await r.text()).toBe(200);
  await expect(page.getByText('Selos e certificações atualizados')).toBeVisible();
  await expect(deck.getByRole('region', { name: 'Selos e certificações' }).locator('img')).toBeVisible();
  await expect(deck.getByRole('button', { name: /tela cheia/i })).toBeVisible();
  await deck.getByRole('button', { name: 'Remover a imagem dos selos' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/institucional-1.png' });
  await deck.getByRole('button', { name: 'Fechar' }).click();
  await expect(page).toHaveURL(/\/playbooks$/);
});
