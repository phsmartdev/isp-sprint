import { expect, test, type Page } from '@playwright/test';

/** Usuários → Organograma de acessos: estrutura, o que cada pessoa vê por módulo e as ações (bloquear/liberar, retirar). */
const SHOTS = process.env.ACADEMIA_SHOTS;
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('organograma: quem vê o quê no CRM, bloquear e retirar a regra pelo painel', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/users');
  await page.getByRole('tab', { name: 'Organograma de acessos' }).click();
  await expect(page.getByRole('heading', { name: 'Organograma de acessos' })).toBeVisible();
  const team = page.getByLabel('Time Residencial', { exact: true });
  const lucas = team.getByRole('button', { name: /^Lucas Lima/ });
  await expect(lucas).toHaveAttribute('aria-label', /Só o próprio/);
  await expect(team.getByRole('button', { name: /^Ana Souza/ })).toHaveAttribute('aria-label', /: Time$/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/organograma.png`, fullPage: true });

  await lucas.click();
  const panel = page.getByRole('complementary', { name: 'Acesso de Lucas Lima' });
  await expect(panel.getByTestId('org-mod-crm')).toContainText('Só o próprio');
  await panel.getByTestId('org-mod-crm').getByRole('button', { name: 'Bloquear' }).click();
  await panel.getByLabel('Motivo para bloquear').fill('Teste E2E do organograma');
  await panel.getByRole('button', { name: 'Bloquear CRM' }).click();
  await expect(page.getByText('Módulo bloqueado')).toBeVisible();
  await expect(lucas).toHaveAttribute('aria-label', /Sem acesso/);
  await expect(panel.getByTestId('org-mod-crm')).toContainText('bloqueado para a pessoa');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/organograma-painel.png`, fullPage: true });
  await panel.getByTestId('org-mod-crm').getByRole('button', { name: 'Retirar regra' }).click();
  await panel.getByLabel('Por que retirar a regra?').fill('Fim do teste E2E do organograma');
  await panel.getByRole('button', { name: 'Retirar regra' }).last().click();
  await expect(lucas).toHaveAttribute('aria-label', /Só o próprio/);

  // painel do time e visão geral
  await page.getByRole('button', { name: /^Residencial/ }).click();
  await expect(page.getByRole('complementary', { name: 'Time Residencial' })).toContainText('Liderança: Ana Souza');
  await page.getByRole('button', { name: 'Visão geral' }).click();
  await expect(lucas).toHaveAttribute('aria-label', /^Lucas Lima, Operação$/);
});

test('organograma: só a administração acessa', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await page.goto('/settings/users?visao=organograma');
  await expect(page.getByRole('heading', { name: 'Organograma de acessos' })).toHaveCount(0);
});
