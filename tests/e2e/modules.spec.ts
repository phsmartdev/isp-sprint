import { expect, test, type Page } from '@playwright/test';

/** Etapa 1 — módulos de negócio, funcionalidades e ações sensíveis. Restaura a configuração ao final. */
const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page, 'carlos@yepnet.test');
  const H = { origin: new URL(page.url()).origin };
  await page.request.put('/api/v1/admin/modules/contratos', { headers: H, data: { enabled: true, mode: 'todos', disabledFeatures: [], note: 'Restaura após o teste E2E' } });
  await page.close();
});

test('Módulos: desligar Atas some a aba e a rota; perfil Implantação vê só Contratos e Projetos, sem valores', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const H = { origin: new URL(page.url()).origin };

  await page.goto('/settings/modulos');
  const card = page.getByRole('region', { name: 'Módulo Contratos' });
  await card.getByLabel('Atas de registro de preços').uncheck();
  await card.getByLabel('Motivo da alteração').fill('Atas ficam para a segunda onda');
  await card.getByRole('button', { name: 'Salvar Contratos' }).click();
  await expect(page.getByText('Contratos: alteração salva')).toBeVisible();
  await page.goto('/contracts');
  await expect(page.getByRole('tab', { name: 'Painel' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Atas de registro de preços' })).toHaveCount(0);
  expect((await page.request.get('/api/v1/arps')).status()).toBe(403);
  await page.goto('/settings/modulos');
  await page.getByRole('region', { name: 'Módulo Contratos' }).getByLabel('Atas de registro de preços').check();
  await page.getByRole('region', { name: 'Módulo Contratos' }).getByLabel('Motivo da alteração').fill('Atas voltam para a primeira onda');
  await page.getByRole('region', { name: 'Módulo Contratos' }).getByRole('button', { name: 'Salvar Contratos' }).click();
  await expect(page.getByText('Contratos: alteração salva')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ações sensíveis por perfil' }).getByLabel('Ver valores financeiros (R$, faturamento, margem, comissão) para Implantação')).not.toBeChecked();
  await shot(page, 'modulos');

  // perfil Implantação
  const email = `impl-e2e-${Date.now().toString(36)}@yepnet.test`;
  const u = await (await page.request.post('/api/v1/admin/users', { headers: H, data: { name: 'Implantação E2E', email, profile: 'implantacao', sectors: ['implantacao'] } })).json();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx.newPage();
  await login(p2, email, u.temporaryPassword);
  const nav = p2.getByRole('navigation', { name: 'Navegação principal' });
  await expect(nav.getByRole('link', { name: /Gestão de Contratos/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /Projetos/ }).or(nav.getByRole('link', { name: /Projetos/ })).first()).toBeVisible();
  await expect(nav.getByRole('button', { name: /Comercial/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /Sucesso do Cliente/ })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: /Marketing/ })).toHaveCount(0);
  const list = await (await p2.request.get('/api/v1/contracts?pageSize=1')).json();
  await p2.goto(`/contracts/${list.items[0].id}`);
  await expect(p2.getByText('Valor mensal')).toBeVisible();
  await expect(p2.getByText(/R\$\s?\d/)).toHaveCount(0);
  await expect(p2.getByRole('tab', { name: 'Pessoas e ABM' })).toHaveCount(0);
  await p2.goto('/opportunities');
  await expect(p2.getByText('Sem acesso a este módulo')).toBeVisible();
  await p2.setViewportSize({ width: 390, height: 844 });
  await p2.goto('/settings/profile');
  expect(await p2.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await ctx.close();
});
