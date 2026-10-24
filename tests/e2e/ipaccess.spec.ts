import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('acesso por IP: gerência liga com o próprio IP, não consegue se trancar fora e desliga', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/security');
  const card = page.getByRole('region', { name: 'Acesso por IP' });
  await expect(card.getByText(/Seu IP agora:/)).toBeVisible();
  await card.getByLabel('Restringir o acesso aos IPs da lista').check();
  await card.getByLabel('IP ou faixa').fill('10.0.0.0/8');
  await card.getByLabel('Descrição').fill('Escritório fictício');
  await card.getByRole('button', { name: 'Adicionar' }).click();
  await expect(card.getByText(/ao ligar, você perderia o acesso/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Salvar acesso por IP' })).toBeDisabled();
  await card.getByRole('button', { name: 'Incluir na lista' }).click();
  await card.getByRole('button', { name: 'Salvar acesso por IP' }).click();
  await expect(page.getByText('Acesso por IP ligado')).toBeVisible();
  await page.screenshot({ path: 'test-results/acesso-ip.png', fullPage: true });
  await page.reload();
  await expect(card.getByLabel('Restringir o acesso aos IPs da lista')).toBeChecked();
  await card.getByLabel('Restringir o acesso aos IPs da lista').uncheck();
  await card.getByRole('button', { name: 'Salvar acesso por IP' }).click();
  await expect(page.getByText('Acesso por IP salvo (desligado)')).toBeVisible();
});
