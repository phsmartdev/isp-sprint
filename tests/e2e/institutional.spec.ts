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
  await expect(deck.getByRole('region', { name: 'Selos e certificações' })).toContainText('Personalização');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/institucional-1.png' });
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/playbooks$/);
});
