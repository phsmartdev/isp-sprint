import { expect, test, type Page } from '@playwright/test';

/** Topo: comentário com @ no contrato vira pedido de apoio; "Apoiei" no menu de apoio; "Limpar" do sino. Dados fictícios. */
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('comentário com @ no contrato, Apoiei no topo e Limpar do sino', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, 'carlos@yepnet.test');
  const list = await (await page.request.get('/api/v1/contracts?pageSize=50')).json();
  const c = list.items.find((x: { stage: string }) => x.stage === 'vigente');
  await page.goto(`/contracts/${c.id}`);
  await page.getByRole('tab', { name: 'Comentários e apoio' }).click();
  const sec = page.getByRole('region', { name: 'Comentários e apoio' });
  const box = sec.getByLabel('Comentário');
  await box.click();
  await box.pressSequentially('@Ana');
  await page.getByRole('option', { name: /Ana/ }).first().click();
  await box.pressSequentially(' pode revisar a cláusula fictícia de teste?');
  await sec.getByRole('button', { name: 'Enviar pedido de apoio' }).click();
  await expect(page.getByText('Pedido de apoio enviado')).toBeVisible();
  await expect(sec.getByText('pode revisar a cláusula fictícia de teste?')).toBeVisible();

  // Ana: o pedido aparece no menu de apoio do topo e sai com "Apoiei"
  await page.context().clearCookies();
  await login(page, 'ana@yepnet.test');
  await page.getByRole('button', { name: /^Apoio/ }).click();
  const quick = page.getByRole('list', { name: 'Pedidos para você' });
  const item = quick.getByRole('listitem').filter({ hasText: 'cláusula fictícia de teste' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Apoiei' }).click();
  await expect(page.getByText('Apoio registrado: falta quem pediu confirmar')).toBeVisible();
  await expect(item).toHaveCount(0);

  // sino: Limpar esvazia o painel
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Notificações/ }).click();
  const bell = page.getByRole('dialog', { name: 'Notificações' });
  await bell.getByRole('button', { name: 'Limpar' }).click();
  await expect(bell.getByText('Nada novo.', { exact: false })).toBeVisible();
});
