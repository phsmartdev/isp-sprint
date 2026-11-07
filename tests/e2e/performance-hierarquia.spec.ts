import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/** Performance por nível hierárquico: atividade + metas com os pesos do nível; a pessoa vê a própria, a liderança o time. */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';
const SHOTS = process.env.E2E_SHOTS;
const psql = (q: string) => execFileSync('psql', [DB, '-Atc', q]).toString().trim();
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('performance por nível: minha, do time e pesos na regra', async ({ page }) => {
  test.setTimeout(150_000);
  psql('delete from gamification_settings;');
  await login(page, 'carlos@yepnet.test');
  const st = await (await page.request.get('/api/v1/times/gamificacao/settings')).json();
  expect((await page.request.post(`/api/v1/times/gamificacao/settings/${st.proposal.version}/decide`, { data: { approve: true } })).status()).toBe(200);

  // metas do mês: individual do Lucas e do time Residencial (a líder cria e aponta)
  await login(page, 'ana@yepnet.test');
  const lucasId = psql(`select id from users where email = 'lucas@yepnet.test'`);
  const resid = psql(`select id from teams where name = 'Residencial' limit 1`);
  for (const [body, value] of [[{ title: `Meta individual E2E ${Date.now()}`, scope: 'individual', userId: lucasId }, 8], [{ title: `Meta do time E2E ${Date.now()}`, scope: 'equipe', teamId: resid }, 11]] as const) {
    const g = await (await page.request.post('/api/v1/performance/goals', { data: { category: 'comercial', manualUnit: 'un', periodType: 'mes', target: 10, ...body } })).json();
    expect((await page.request.post(`/api/v1/performance/goals/${g.id}/checkins`, { data: { value, note: 'Apontamento E2E' } })).status()).toBe(201);
  }
  await page.goto('/times/performance');
  const team = page.getByRole('region', { name: 'Performance do time Residencial' });
  await expect(team.getByRole('table')).toContainText('Lucas');
  await expect(page.getByRole('region', { name: 'Minha performance' })).toContainText('N4 · Liderança');
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/performance-lideranca.png` });

  // a pessoa vê só a própria
  await login(page, 'lucas@yepnet.test');
  await page.getByRole('button', { name: 'Gestão de Times' }).click().catch(() => {});
  await page.goto('/times/performance');
  const mine = page.getByRole('region', { name: 'Minha performance' });
  await expect(mine).toContainText('N2 · Execução');
  await expect(mine).toContainText('Metas individuais');
  await expect(mine).toContainText('Metas do time');
  await expect(mine).toContainText('Atividade (gamificação)');
  await expect(page.getByRole('region', { name: /^Performance do time/ })).toHaveCount(0);
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/performance-minha.png` });

  // pesos por nível ficam na regra (com aprovação)
  await login(page, 'carlos@yepnet.test');
  await page.goto('/times/gamificacao');
  await page.getByRole('button', { name: 'Regra de pontuação' }).click();
  const modal = page.getByRole('dialog', { name: 'Regra de pontuação' });
  await expect(modal.getByLabel('Metas da área: performance de N4 · Liderança (supervisão)')).toHaveValue('25');
});
