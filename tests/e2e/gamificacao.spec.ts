import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';

/** Gamificação colaborativa: pódio animado na Visão geral, dispersão para a liderança e Selo BK de Qualidade na tela de quem tem a maior nota do ano. */
const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('pódio, dispersão e medalha de ouro', async ({ page, browser }) => {
  test.setTimeout(150_000);
  execFileSync('psql', [DB, '-c', 'delete from gamification_settings;']);
  // a regra nasce como proposta: ninguém pontua até a aprovação
  await login(page, 'carlos@yepnet.test');
  await page.goto('/times/gamificacao');
  const banner = page.getByRole('region', { name: 'Regra de pontuação aguardando aprovação' });
  await expect(banner).toContainText('Negociação ganha');
  await expect(page.getByText('A gamificação começa quando a regra de pontuação for aprovada')).toBeVisible();
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/gamificacao-aprovacao.png` });
  await banner.getByRole('button', { name: 'Aprovar regra' }).click();
  await expect(page.getByText('Regra aprovada: a gamificação já vale')).toBeVisible();
  const rank = page.getByRole('region', { name: 'Ranking' });
  await expect(rank.getByRole('listitem').first()).toBeVisible();
  await rank.getByRole('tab', { name: /Ano/ }).click();
  await expect(rank.getByRole('listitem').first()).toBeVisible();
  await page.context().clearCookies();
  await login(page, 'ana@yepnet.test');
  const g = await (await page.request.get('/api/v1/times/gamificacao')).json();
  await page.goto('/times');
  const aside = page.getByRole('complementary', { name: 'Gamificação do time' });
  await expect(aside).toBeVisible();
  if (g.monthBoard.podium.length) await expect(aside.getByRole('list', { name: /Pódio de/ }).getByRole('listitem').first()).toBeVisible();
  // a líder vê a dispersão de cada time
  await expect(aside.getByRole('region', { name: 'Times no mês' })).toContainText(/Time nivelado|Atenção|Problema|Sem dados/);
  await page.waitForTimeout(1500);
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/visao-geral-podio.png` });

  await page.goto('/times/gamificacao');
  await expect(page.getByRole('heading', { name: 'Gamificação', level: 1 })).toBeVisible();
  const team = page.getByRole('region', { name: /^Time / }).first();
  await expect(team.getByRole('status', { name: /Dispersão do time/ })).toBeVisible();
  await page.waitForTimeout(1500);
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/gamificacao.png` });

  // quem tem a maior nota do ano vê a medalha no topo e na tela inicial
  expect(g.gold.length).toBeGreaterThan(0);
  const email = execFileSync('psql', [DB, '-Atc', `select email from users where id = '${g.gold[0].userId}'`]).toString().trim();
  const goldUser = { email };
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await login(p2, goldUser.email);
  await expect(p2.getByRole('img', { name: /Selo BK de Qualidade/ }).first()).toBeVisible();
  await p2.goto('/');
  await expect(p2.getByRole('region', { name: 'Selo BK de Qualidade' })).toContainText('Medalha de ouro');
  await p2.waitForTimeout(800);
  if (SHOTS) await p2.screenshot({ path: `${SHOTS}/selo-home.png` });
  // o liderado não vê a dispersão
  await ctx2.close();
});
