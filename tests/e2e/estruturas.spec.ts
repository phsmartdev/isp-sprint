import { expect, test, type Page } from '@playwright/test';

/** Estruturas: criar em Modelos, vincular contas (pela conta) e contratos (na estrutura). */
const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('estrutura: criar, vincular conta pela ficha e contrato sugerido', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, 'carlos@yepnet.test');
  const stamp = Date.now().toString(36);
  const list = await (await page.request.get('/api/v1/contracts?pageSize=5&status=ativos')).json();
  const ct = list.items[0];
  test.skip(!ct, 'sem contrato na base');

  await page.goto('/settings/modelos?aba=estruturas');
  const sec = page.getByRole('region', { name: 'Estruturas' });
  await sec.getByRole('button', { name: 'Nova estrutura' }).click();
  const dlg = page.getByRole('dialog', { name: 'Nova estrutura' });
  await dlg.getByLabel('Nome').fill(`Rede Estadual Fictícia ${stamp}`);
  await dlg.getByLabel('Tipo').selectOption('rede');
  await dlg.getByLabel('Descrição').fill('Rede que liga órgãos do estado (dados fictícios)');
  await dlg.getByRole('button', { name: 'Criar estrutura' }).click();
  const drawer = page.getByRole('dialog', { name: 'Estrutura' });
  await expect(drawer.getByRole('heading', { name: `Rede Estadual Fictícia ${stamp}` })).toBeVisible();
  await page.keyboard.press('Escape');

  // na ficha da conta do contrato: vincular à estrutura existente
  await page.goto(`/customers/${ct.contactId}?t=relacoes`);
  const acc = page.getByRole('region', { name: 'Estruturas da conta' });
  await acc.getByLabel('Vincular a uma estrutura').selectOption({ label: `Rede Estadual Fictícia ${stamp} (Rede)` });
  await acc.getByLabel('Papel').selectOption('gestor');
  await acc.getByRole('button', { name: 'Vincular', exact: true }).click();
  await expect(acc.getByRole('button', { name: `Rede Estadual Fictícia ${stamp}`, exact: true })).toBeVisible();
  await expect(acc).toContainText('Órgão gestor / coordenação');

  // abrir a estrutura e vincular o contrato sugerido
  await acc.getByRole('button', { name: `Rede Estadual Fictícia ${stamp}`, exact: true }).click();
  const d2 = page.getByRole('dialog', { name: 'Estrutura' });
  const sug = d2.getByLabel('Contratos das contas ainda fora da estrutura');
  await sug.getByRole('button', { name: 'Vincular' }).first().click();
  await expect(page.getByText('Contrato vinculado')).toBeVisible();
  await expect(d2.getByRole('region', { name: 'Contratos da estrutura' }).getByRole('link', { name: /^CT-/ }).first()).toBeVisible();
  if (SHOTS) await d2.screenshot({ path: `${SHOTS}/estrutura.png` });
});
