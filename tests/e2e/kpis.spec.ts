import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('indicadores principais: importa as fichas, lança resultados e mostra o painel da diretoria', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/intelligence');
  await expect(page.getByRole('tab', { name: 'Indicadores principais' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Importar fichas (.xlsx)' }).click();
  const dlg = page.getByRole('dialog', { name: 'Importar fichas de KPI' });
  await dlg.locator('input[type="file"]').setInputFiles('tests/e2e/fixtures/kpis-ficticios.xlsx');
  await expect(dlg.getByRole('cell', { name: /^Booking de Contratos Comercial/ })).toBeVisible();
  await expect(dlg.getByLabel('Sentido de Lead Time Viabilidade')).toHaveValue('menor');
  await expect(dlg.getByLabel('Situação de Mix Receita Produto (MRP)')).toHaveValue('pausado');
  await dlg.getByRole('button', { name: /Salvar 8 indicador/ }).click();
  await expect(page.getByText(/8 indicador\(es\) criado/)).toBeVisible();

  // resultados fictícios do ano até o período atual
  const api = page.request;
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1, q = Math.floor((m - 1) / 3) + 1;
  const { items } = await (await api.get('/api/v1/intelligence/kpis')).json();
  const id = (name: string) => items.find((i: { def: { name: string } }) => i.def.name.startsWith(name)).id;
  const monthly: Record<string, number[]> = { 'Booking de Contratos': [22, 31, 38, 52, 61, 58, 44, 49, 53, 41, 0, 0], 'Lead Time Viabilidade': [3.8, 3.1, 2.6, 2.4, 2.1, 1.9, 2.2, 2.0, 1.8, 3.4, 0, 0], 'Ativação de Contas-Alvo': [41, 55, 63, 70, 78, 82, 85, 88, 91, 72, 0, 0] };
  const quarterly: Record<string, number[]> = { 'Win Rate': [28, 33, 37, 31], 'Taxa de Concentração de Receita (TCR)': [18, 16, 14, 22], 'Taxa de Conversão': [31, 36, 38, 26], 'Health Score': [55, 61, 66, 64] };
  for (const [n, vals] of Object.entries(monthly)) for (let k = 1; k <= m; k++) expect((await api.post(`/api/v1/intelligence/kpis/${id(n)}/entries`, { data: { period: `${y}-${String(k).padStart(2, '0')}`, value: vals[k - 1] } })).status()).toBe(201);
  for (const [n, vals] of Object.entries(quarterly)) for (let k = 1; k <= q; k++) expect((await api.post(`/api/v1/intelligence/kpis/${id(n)}/entries`, { data: { period: `${y}-T${k}`, value: vals[k - 1] } })).status()).toBe(201);

  await page.reload();
  const board = page.getByRole('region', { name: 'Painel de indicadores principais' });
  await expect(board.getByRole('button', { name: /Booking de Contratos:/ })).toBeVisible();
  await expect(board.getByRole('button', { name: /Mix Receita Produto/ })).toHaveCount(0); // pausado fica fora
  await expect(page.getByRole('region', { name: 'Indicadores pausados' })).toContainText('Mix Receita Produto (MRP)');
  await page.screenshot({ path: 'test-results/kpis-inteligencia.png', fullPage: true });

  // ficha, histórico e lançamento pela tela
  await expect(board.getByRole('region', { name: 'Evolução de Booking de Contratos' })).toBeVisible();
  await expect(board.getByRole('region', { name: 'Contratos fechados no trimestre' })).toBeVisible();
  const bk = board.getByRole('region', { name: 'Evolução de Booking de Contratos' });
  await expect(bk).toContainText('Crescimento sem reajuste');
  await bk.getByRole('button', { name: 'Ocultar valores' }).click();
  await expect(bk.getByText('R$ •••••').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/kpis-oculto.png' });
  await bk.getByRole('button', { name: 'Mostrar valores' }).click();
  await expect(board.getByRole('region', { name: 'Negociações em andamento' })).toBeVisible();
  await expect(board.getByRole('region', { name: 'Saúde das contas' })).toBeVisible();
  await expect(board.getByRole('region', { name: 'Desdobramento das metas' })).toContainText('Lead Time Viabilidade');
  await board.getByRole('button', { name: /Taxa de Conversão:/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Taxa de Conversão' });
  await expect(drawer.getByText('Objetivo fictício de Taxa de Conversão.')).toBeVisible();
  await drawer.getByRole('button', { name: 'Lançar resultado' }).click();
  const entry = page.getByRole('dialog', { name: 'Lançar resultado' });
  await entry.getByLabel(/Resultado/).fill('33,5');
  await entry.getByRole('button', { name: 'Lançar resultado' }).click();
  await expect(page.getByText('Resultado lançado')).toBeVisible();
  await expect(drawer.getByText('substituído').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/kpis-ficha.png' });

  // painel da TV (Full HD e uma TV menor)
  for (const vp of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const ctx = await browser.newContext({ viewport: vp, storageState: await page.context().storageState() });
    const tv = await ctx.newPage();
    await tv.goto('/painel/indicadores');
    await expect(tv.getByRole('region', { name: 'Painel de indicadores principais' })).toBeVisible();
    await expect(tv.getByRole('region', { name: 'Contratos fechados no trimestre' })).toBeVisible();
    await tv.waitForTimeout(400);
    const over = await tv.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }));
    expect(over.x).toBeLessThanOrEqual(1);
    expect(over.y, 'cabe numa tela').toBeLessThanOrEqual(1);
    await tv.screenshot({ path: `test-results/kpis-tv-${vp.width}.png` });
    if (vp.width === 1920) {
      await expect(tv.getByRole('region', { name: 'Negociações em andamento' })).toBeVisible({ timeout: 25_000 });
      await tv.screenshot({ path: 'test-results/kpis-tv-1920-b.png' });
    }
    if (vp.width === 1920) {
      await expect(tv.getByRole('region', { name: 'O que pede atenção' })).toBeVisible({ timeout: 25_000 });
      await tv.screenshot({ path: 'test-results/kpis-tv-1920-b.png' });
    }
    await ctx.close();
  }
});

test('dados de demonstração dos indicadores: aviso no painel e retirada com um clique', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  expect((await page.request.post('/api/v1/intelligence/kpis/demo')).ok()).toBe(true);
  await page.goto('/intelligence');
  await expect(page.getByText('Resultados de demonstração (fictícios)')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Painel de indicadores principais' }).getByRole('button', { name: /Booking de Contratos:/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/kpis-demo.png', fullPage: true });
  await page.getByRole('button', { name: 'Tirar dados de demonstração' }).click();
  await expect(page.getByText(/resultado\(s\) de demonstração retirado/)).toBeVisible();
  await expect(page.getByText('Resultados de demonstração (fictícios)')).toHaveCount(0);
});
