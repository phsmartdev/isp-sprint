import { expect, test, type Page } from '@playwright/test';

/** Metas e indicadores: os objetivos estratégicos são os KPIs principais; o indicador se liga a um deles na lista. */
const SHOTS = process.env.ACADEMIA_SHOTS;
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('objetivos estratégicos = KPIs; indicador ligado aparece no card do KPI', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const st = Date.now().toString(36).slice(-5);
  await login(page, 'carlos@yepnet.test');
  expect((await page.request.post('/api/v1/intelligence/kpis/demo')).ok()).toBe(true); // fichas dos KPIs principais
  const r = await page.request.post('/api/v1/performance/indicators', { data: { def: { name: `Propostas enviadas ${st}`, category: 'comercial', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'proposta_enviada', measure: 'contagem' } } } });
  expect(r.status(), await r.text()).toBe(201);

  await page.goto('/times/metas?t=objetivos');
  const strategic = page.getByRole('region', { name: 'Objetivos estratégicos' });
  await expect(strategic.getByTestId('kpi-objective').first()).toBeVisible();
  for (const n of ['Booking de Contratos', 'Win Rate', 'Taxa de Conversão', 'Health Score']) await expect(strategic.getByRole('heading', { name: n, exact: true })).toBeVisible();
  await expect(strategic.getByRole('region', { name: 'Objetivo estratégico Win Rate' })).toContainText('No ano');

  // ligar o indicador ao Win Rate
  await page.getByRole('tab', { name: 'Indicadores' }).click();
  await page.getByLabel(`Objetivo de Propostas enviadas ${st}`).selectOption({ label: 'Win Rate' });
  await expect(page.getByText('Indicador ligado ao objetivo')).toBeVisible();

  await page.getByRole('tab', { name: 'Objetivos' }).click();
  const win = page.getByRole('region', { name: 'Objetivo estratégico Win Rate' });
  await expect(win).toContainText(`Propostas enviadas ${st}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/objetivos-kpi.png`, fullPage: true });

  // novo objetivo: estratégico não é opção; tático pede o KPI
  await page.getByRole('button', { name: 'Novo objetivo' }).click();
  const lvl = page.getByLabel('Nível');
  await expect(lvl.locator('option', { hasText: 'Estratégico' })).toHaveCount(0);
  await expect(page.getByLabel('KPI (objetivo estratégico)')).toBeVisible();
});
