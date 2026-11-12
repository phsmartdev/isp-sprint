import { expect, test, type Page } from '@playwright/test';

/** Manual do sistema: a gerência instala pela Central de Playbooks e a operação lê os capítulos. */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('manual do sistema: instalar, ler o capítulo de acessos e a referência da API', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/playbooks?aba=configuracoes');
  const panel = page.getByRole('region', { name: 'Manual do sistema' });
  await expect(panel.getByRole('heading', { name: 'Manual do sistema' })).toBeVisible();
  const btn = panel.getByRole('button', { name: /Instalar manual|Atualizar/ });
  if (await btn.isEnabled()) await btn.click();
  await expect(panel.getByText('Atualizado').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/manual-painel.png', fullPage: false });

  await login(page, 'lucas@yepnet.test');
  await page.goto('/playbooks');
  await page.getByRole('textbox', { name: 'Buscar playbooks' }).fill('Perfis, níveis');
  await page.getByText('Perfis, níveis e permissões').first().click();
  await expect(page.getByRole('heading', { name: 'Matriz padrão de níveis' })).toBeVisible();
  await expect(page.getByText('Liderança / gestor').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/manual-acessos.png', fullPage: false });
  await page.goto('/playbooks');
  await page.getByRole('textbox', { name: 'Buscar playbooks' }).fill('Referência da API');
  await page.getByText('Referência da API do RevOps').first().click();
  await expect(page.getByText('/api/v1/opportunities').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/manual-api.png', fullPage: false });
});
