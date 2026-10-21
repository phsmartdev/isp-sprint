import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

test('Gestão de desempenho: eventos de negócio, regras de atribuição versionadas e exploração com validação', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/desempenho');
  await expect(page.getByRole('heading', { name: 'Eventos e regras de atribuição' })).toBeVisible();
  await page.getByRole('button', { name: 'Reprocessar histórico' }).click();
  await expect(page.getByText(/Reprocessado:/)).toBeVisible();
  await expect(page.getByText('Oportunidade criada', { exact: true })).toBeVisible();
  await expect(page.getByText('Cliente reativado')).toBeVisible();
  await page.getByLabel('Parte do responsável em Negociação ganha').fill('80');
  await page.getByLabel('O que mudou').fill('Pré-venda divide 20% das vendas ganhas');
  await page.getByRole('button', { name: 'Salvar nova versão' }).click();
  await expect(page.getByText(/Versão \d+ em vigor/)).toBeVisible();
  await shot(page, 'perf-eventos');
  await page.getByRole('tab', { name: 'Explorar eventos' }).click();
  await page.getByLabel('Evento').selectOption({ label: 'Oportunidade criada' });
  await page.getByRole('button', { name: 'Oportunidade criada' }).first().click();
  const dr = page.getByRole('dialog', { name: 'Evento de negócio' });
  await expect(dr.getByText('Créditos')).toBeVisible();
  await expect(dr.getByRole('link', { name: 'Abrir registro de origem' })).toBeVisible();
  await shot(page, 'perf-explorar');
});
