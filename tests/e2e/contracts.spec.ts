import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('gestão de contratos: painel, funil, calendário, validação e etapa de implantação', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  await page.getByRole('link', { name: 'Gestão de Contratos' }).first().click();
  await expect(page.getByRole('heading', { name: 'Gestão de Contratos' })).toBeVisible();
  await expect(page.getByText('Contratos ativos')).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-painel.png', fullPage: true });
  await page.getByRole('tab', { name: 'Funil' }).click();
  await expect(page.getByRole('heading', { name: /Cadastro e validação/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-funil.png', fullPage: true });
  await page.getByRole('tab', { name: 'Calendário' }).click();
  await expect(page.getByRole('button', { name: 'Próximo mês' })).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-calendario.png', fullPage: true });
  await page.getByRole('tab', { name: 'Lista' }).click();
  await page.getByLabel('Buscar contratos').fill('CTR-2026-052');
  await page.getByRole('link', { name: 'CTR-2026-052' }).click();
  await expect(page.getByText('Cadastro aguardando validação')).toBeVisible();
  await page.getByRole('button', { name: 'Validar cadastro' }).click();
  await page.getByRole('button', { name: 'Validar e iniciar implantação' }).click();
  await expect(page.getByText('Cadastro validado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ver o contrato' }).click();
  await page.getByRole('tab', { name: /Processos/ }).click();
  const erp = page.locator('li').filter({ hasText: 'Cadastrar/atualizar no ERP' }).first();
  await erp.getByRole('button', { name: 'Registrar' }).click();
  await page.getByLabel('Código/referência no ERP').fill('ERP-E2E-1');
  await page.getByRole('button', { name: 'Concluir etapa' }).click();
  await expect(page.getByText(/Feita por Carlos Silva .* ERP ERP-E2E-1/)).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-ficha.png', fullPage: true });
  await page.getByRole('tab', { name: /Versões/ }).click();
  await expect(page.getByText('v1')).toBeVisible();
  await page.getByRole('tab', { name: 'Linha do tempo' }).click();
  await expect(page.getByText('Cadastro validado', { exact: true })).toBeVisible();
});

test('oportunidade fechada: cadastrar contrato com os dados do CRM', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/opportunities?view=lista&status=encerradas');
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  // procura uma venda fechada ainda sem contrato
  let found = false;
  for (let i = 0; i < 15 && !found; i++) {
    await page.goto('/opportunities?view=lista&status=encerradas');
    await rows.nth(i).click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
    const btn = page.getByRole('button', { name: 'Cadastrar contrato' });
    if (await btn.isVisible().catch(() => false)) { await btn.click(); found = true; }
  }
  expect(found).toBe(true);
  await expect(page.getByRole('heading', { name: 'Novo contrato' })).toBeVisible();
  await expect(page.getByText('Oportunidade de origem')).toBeVisible();
  await page.getByLabel('Número do contrato').fill('CT-E2E-900');
  await page.getByLabel('Início da vigência').fill('2026-11-01');
  await expect(page.getByLabel('Término da vigência')).toHaveValue('2027-10-31');
  await page.screenshot({ path: 'test-results/contracts-novo.png', fullPage: true });
  await page.getByRole('button', { name: 'Cadastrar contrato' }).click();
  await expect(page.getByRole('heading', { name: 'Contrato CT-E2E-900' })).toBeVisible();
  await page.goto('/intelligence?v=contratos');
  await expect(page.getByText('Receita mensal contratada')).toBeVisible();
  await expect(page.getByText('Aguardando ERP').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-intel.png', fullPage: true });
});
