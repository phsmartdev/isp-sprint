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

test('GESTÃO DE RESULTADOS: estrutura organizacional e perspectivas por responsabilidade', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/resultados');
  await page.getByRole('button', { name: 'Nova unidade' }).click();
  let d = page.getByRole('dialog', { name: 'Nova unidade' });
  await d.getByLabel('Nome').fill('Diretoria Comercial E2E');
  await d.getByLabel('Tipo').selectOption('diretoria');
  await d.getByLabel('Responsável').selectOption({ label: 'Carlos Silva' });
  await d.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Diretoria Comercial E2E', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Nova unidade' }).click();
  d = page.getByRole('dialog', { name: 'Nova unidade' });
  await d.getByLabel('Nome').fill('Área Empresarial E2E');
  await d.getByLabel('Unidade superior').selectOption({ label: 'Diretoria Comercial E2E' });
  await d.getByLabel('Responsável').selectOption({ label: 'Ana Souza' });
  await d.getByLabel('Alçada para aprovar (R$)').fill('50.000,00');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Área Empresarial E2E', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Unidade do time Empresarial').selectOption({ label: 'Área Empresarial E2E' });
  await expect(page.getByText('Time atualizado')).toBeVisible();
  await shot(page, 'gr-estrutura');

  await page.getByRole('link', { name: 'GESTÃO DE RESULTADOS', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'GESTÃO DE RESULTADOS' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Diretoria' })).toBeVisible();
  await expect(page.getByText('Estamos alcançando os objetivos do negócio?')).toBeVisible();
  await page.getByRole('tab', { name: 'Gestão' }).click();
  await expect(page.getByText('As equipes e os processos estão entregando o resultado esperado?')).toBeVisible();
  await shot(page, 'gr-perspectivas');
});
