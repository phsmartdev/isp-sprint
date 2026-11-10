import { expect, test } from '@playwright/test';

/** Licitação: abrir com objeto longo e vários endereços de entrega; ligar produto a endereço; anexo grande (edital) em partes. */
const SHOTS = process.env.E2E_SHOTS;
test('licitação com objeto longo, endereços por produto e edital grande', async ({ page }) => {
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
  const addrs = page.getByRole('region', { name: 'Endereços de entrega' });
  await expect(addrs.locator('#da-main-street')).toHaveValue('Rua da Prefeitura');
  await expect(addrs.getByLabel('Identificação')).toHaveValue(`Escola Municipal ${tag}`);
  const items = page.getByRole('region', { name: 'Produtos e serviços' });
  await items.getByRole('button', { name: 'Adicionar item' }).click();
  await items.getByLabel('Produto ou serviço 1').fill(`Roteador ${tag}`);
  await items.getByLabel('Valor 1').fill('100,00');
  await items.getByLabel('Endereço de entrega 1').selectOption({ label: `2 · Escola Municipal ${tag} — Rua da Escola` });
  await items.getByRole('button', { name: 'Salvar produtos e serviços' }).click();
  await expect(page.getByText('Produtos e serviços salvos')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Produtos e serviços' }).getByLabel('Endereço de entrega 1').locator('option:checked')).toHaveText(`2 · Escola Municipal ${tag} — Rua da Escola`);
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/produtos-enderecos.png` });

  // edital de ~7 MB: vai em partes e volta igual
  const size = 7 * 1024 * 1024;
  const pdf = Buffer.alloc(size, 0x41);
  pdf.write('%PDF-1.4\n', 0, 'latin1');
  await page.goto(`/opportunities/${id}?aba=anexos`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Outro arquivo' }).click();
  await (await chooser).setFiles({ name: 'edital.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByText('Arquivo anexado')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('7,0 MB')).toBeVisible();
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/anexo-grande.png` });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar edital.pdf' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('edital.pdf');
  const fs = await import('node:fs/promises');
  const got = await fs.readFile((await file.path())!);
  expect(got.length).toBe(size);
  expect(got.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
});
