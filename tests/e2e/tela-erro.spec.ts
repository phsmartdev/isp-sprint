import { expect, test } from '@playwright/test';

/** Erro de renderização numa tela: aviso com a mensagem e Recarregar; o menu continua (sem tela branca). */
test('erro de renderização mostra aviso com Recarregar, não tela branca', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  const list = await (await page.request.get('/api/v1/opportunities?pageSize=5')).json();
  const id = (list.items ?? list)[0].id as string;
  // a API devolve um objeto quebrado para a oportunidade: a página falha ao renderizar
  await page.route(`**/api/v1/opportunities/${id}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id }) }));
  await page.goto(`/opportunities/${id}`);
  const alert = page.getByRole('alert').filter({ hasText: 'Esta tela encontrou um erro' });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Recarregar' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible(); // o menu continua
});
