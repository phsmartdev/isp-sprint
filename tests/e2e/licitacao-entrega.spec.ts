import { expect, test } from '@playwright/test';

/** Licitação: abrir com objeto longo e vários endereços de entrega; ligar produto a endereço. */
const SHOTS = process.env.E2E_SHOTS;
test('licitação com objeto longo, endereços por produto', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('lucas@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  const tag = Date.now().toString(36);

  await page.goto('/opportunities/new');
  await page.locator('#no-pipe').selectOption('licitacao');
  await page.locator('#no-branch').selectOption({ index: 1 });
  await page.locator('#no-name').fill(`Prefeitura Entrega ${tag}`);
  await page.locator('#no-cf-tipo_disputa').selectOption('Aberta');
  await page.locator('#no-cf-lance_inicial').fill('1000');
  await page.locator('#no-cf-lance_minimo').fill('800');
  // objeto do edital costuma passar de 2 mil caracteres
  await page.locator('#no-cf-objeto').fill('Contratação de empresa para prestação de serviço de conectividade. '.repeat(60));
  await page.locator('#no-ad-street').fill('Rua da Prefeitura');
  await page.locator('#no-ad-city').fill('Aracaju');
  await page.getByRole('button', { name: 'Adicionar outro endereço de entrega' }).click();
  await page.getByLabel('Identificação').first().fill(`Escola Municipal ${tag}`);
  await page.getByLabel('Logradouro').nth(2).fill('Rua da Escola');
  if (SHOTS) await page.locator('form').screenshot({ path: `${SHOTS}/nova-licitacao.png` });
  await page.getByRole('button', { name: 'Iniciar Negociação' }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}/);
  const id = page.url().match(/opportunities\/([0-9a-f-]{36})/)![1];

  await page.goto(`/opportunities/${id}?aba=produtos`);
  // a aba Produtos não tem mais o formulário de endereços: só o seletor em cada linha
  await expect(page.getByRole('region', { name: 'Endereços de entrega' })).toHaveCount(0);
  const items = page.getByRole('region', { name: 'Produtos e serviços' });
  await items.getByRole('button', { name: 'Adicionar item' }).click();
  await items.getByLabel('Produto ou serviço 1').fill(`Roteador ${tag}`);
  await items.getByLabel('Valor 1').fill('100,00');
  await items.getByRole('button', { name: 'Adicionar item' }).click();
  await items.getByLabel('Produto ou serviço 2').fill(`Switch ${tag}`);
  await items.getByLabel('Valor 2').fill('50,00');
  await expect(items.getByLabel('Endereço de entrega 1').locator('option')).toHaveText(['1 · Principal — Rua da Prefeitura · Aracaju', `2 · Escola Municipal ${tag} — Rua da Escola`, '+ Novo endereço de entrega…']);
  await items.getByLabel('Endereço de entrega 1').selectOption({ label: `2 · Escola Municipal ${tag} — Rua da Escola` });
  // endereço novo direto da linha do produto
  await items.getByLabel('Endereço de entrega 2').selectOption({ label: '+ Novo endereço de entrega…' });
  const dlg = page.getByRole('dialog', { name: 'Novo endereço de entrega' });
  await dlg.getByLabel('Identificação').fill(`Posto de Saúde ${tag}`);
  await dlg.getByLabel('Logradouro').fill('Rua do Posto');
  await dlg.getByRole('button', { name: 'Cadastrar endereço' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(items.getByLabel('Endereço de entrega 2').locator('option:checked')).toHaveText(`3 · Posto de Saúde ${tag} — Rua do Posto`);
  await items.getByRole('button', { name: 'Salvar produtos e serviços' }).click();
  await expect(page.getByText('Produtos e serviços salvos')).toBeVisible();
  await page.reload();
  const after = page.getByRole('region', { name: 'Produtos e serviços' });
  await expect(after.getByLabel('Endereço de entrega 1').locator('option:checked')).toHaveText(`2 · Escola Municipal ${tag} — Rua da Escola`);
  await expect(after.getByLabel('Endereço de entrega 2').locator('option:checked')).toHaveText(`3 · Posto de Saúde ${tag} — Rua do Posto`);
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/produtos-enderecos.png` });

});
