import { expect, test, type Page } from '@playwright/test';

/** Configurações → Modelos: um item só, com abas; roteiro do tipo de tarefa aparece ao agendar. */
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('Modelos reúne contratos, propostas, e-mails, instrução e roteiros de tarefa', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/email');
  await expect(page).toHaveURL(/\/settings\/modelos\?aba=emails/);
  await expect(page.getByRole('heading', { name: 'Modelos', level: 1 })).toBeVisible();
  const tabs = (await page.getByRole('tablist', { name: 'Modelos' }).getByRole('tab').allTextContents()).map((t) => t.trim());
  expect(tabs).toEqual(['Contratos', 'Propostas', 'E-mails', 'Instrução', 'Tipos de tarefa']);
  await page.getByRole('tab', { name: 'Tipos de tarefa' }).click();
  await page.getByLabel('Roteiro de ligação').fill('1. Apresente-se\n2. Confirme o interesse');
  await page.getByRole('region', { name: 'Roteiro: Ligação' }).getByRole('button', { name: 'Salvar roteiro' }).click();
  await expect(page.getByText('Roteiro salvo')).toBeVisible();
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Nova atividade' }).click();
  const dlg = page.getByRole('dialog', { name: 'Nova atividade' });
  await dlg.getByLabel('Tipo', { exact: true }).selectOption({ label: 'Ligação' });
  await expect(dlg.getByText('Confirme o interesse')).toBeVisible();
});
