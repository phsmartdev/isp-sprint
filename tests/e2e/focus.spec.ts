import { expect, test } from '@playwright/test';
test('digitar devagar no cadastro, no roteiro e nas anotações não perde o campo', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('lucas@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  await page.goto('/opportunities/new');
  await page.getByLabel('Nome do cliente').click();
  for (const ch of 'Cliente Foco Teste') { await page.keyboard.type(ch); await page.waitForTimeout(120); }
  await expect(page.getByLabel('Nome do cliente')).toBeFocused();
  await expect(page.getByLabel('Nome do cliente')).toHaveValue('Cliente Foco Teste');
  await page.getByLabel('Tipo de venda').selectOption({ label: 'Venda Consultiva' });
  await page.getByLabel('Filial').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Iniciar Negociação' }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  const deal = page.getByLabel('Nome do deal');
  await deal.fill('');
  await deal.click();
  const text = 'Internet mais rapida para trabalhar de casa';
  for (const ch of text) { await page.keyboard.type(ch); await page.waitForTimeout(90); }
  await expect(deal).toBeFocused();
  await expect(deal).toHaveValue(text);
});

test('sair leva ao login sem erro e a sessão termina', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('button', { name: /^Conta de / }).click();
  await page.getByRole('menuitem', { name: /Sair/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Faça login para continuar')).toHaveCount(0);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
