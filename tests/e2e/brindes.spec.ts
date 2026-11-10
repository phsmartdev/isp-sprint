import { expect, test } from '@playwright/test';

/** Marketing → Brindes: item, kit com categoria, envio para a conta e stakeholder, total na ficha da conta e no stakeholder. */
test('brindes: estoque, kit, envio e quanto gastamos com a conta', async ({ page }) => {
  const stamp = Date.now().toString(36);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  const acc = await (await page.request.post('/api/v1/abm/new-account', { data: { name: `Prefeitura Fictícia Brinde ${stamp}`, segment: 'governamental', reason: 'Teste de brindes' } })).json();
  await page.request.post(`/api/v1/accounts/${acc.contactId}/stakeholders`, { data: { person: { name: `Maria Fictícia ${stamp}` }, title: 'Secretária' } });

  await page.getByRole('button', { name: 'Marketing' }).click();
  await page.getByRole('link', { name: 'Brindes' }).click();
  await expect(page.getByRole('heading', { name: 'Brindes' })).toBeVisible();

  // item com fornecedor novo e estoque inicial
  await page.getByRole('button', { name: 'Novo item' }).click();
  await page.locator('#gi-n').fill(`Caneca ${stamp}`);
  await page.locator('#gi-s').selectOption('+');
  await page.getByLabel('Nome do fornecedor').fill(`Gráfica Fictícia ${stamp}`);
  await page.getByRole('button', { name: 'Incluir' }).click();
  await page.locator('#gi-c').fill('25,00');
  await page.locator('#gi-i').fill('10');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('table', { name: 'Estoque de brindes' })).toContainText(`Caneca ${stamp}`);

  // kit com categoria
  await page.getByRole('tab', { name: 'Kits' }).click();
  await page.getByRole('button', { name: 'Nova categoria' }).click();
  await page.locator('#gc-n').fill(`Executivo ${stamp}`);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByRole('button', { name: 'Novo kit' }).click();
  await page.locator('#gk-n').fill(`Kit diretoria ${stamp}`);
  await page.locator('#gk-c').selectOption({ label: `Executivo ${stamp}` });
  await page.getByLabel('Item do kit 1').selectOption({ label: `Caneca ${stamp} · R$ 25,00 · estoque 10` });
  await page.getByLabel('Quantidade 1').fill('2');
  await expect(page.getByText('Custo do kit: R$ 50,00')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('table', { name: 'Kits de brindes' })).toContainText('R$ 50,00');

  // envio pela ficha da conta
  await page.goto(`/customers/${acc.contactId}?t=brindes`);
  await page.getByRole('button', { name: 'Registrar envio' }).click();
  await page.locator('#gs-k').selectOption({ label: `Kit diretoria ${stamp} · R$ 50,00 · dá para 5` });
  await page.locator('#gs-q').fill('2');
  await page.getByLabel(new RegExp(`Maria Fictícia ${stamp}`)).check();
  await expect(page.getByText('Valor do envio: R$ 100,00')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar envio' }).click();
  await expect(page.getByText('Gasto com brindes')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Envios de brindes da conta' })).toContainText(`Maria Fictícia ${stamp}`);
  await expect(page.locator('main')).toContainText('R$ 100,00');
  await page.screenshot({ path: 'test-results/brindes-conta.png', fullPage: true });

  // estoque baixou e consumo mostra a conta
  await page.goto('/brindes?t=consumo');
  await expect(page.getByRole('table', { name: 'Gasto com brindes por conta' })).toContainText(`Prefeitura Fictícia Brinde ${stamp}`);
  await page.screenshot({ path: 'test-results/brindes-consumo.png', fullPage: true });
  await page.goto('/brindes');
  await expect(page.getByRole('table', { name: 'Estoque de brindes' }).getByRole('row', { name: new RegExp(`Caneca ${stamp}`) })).toContainText('6');
});
