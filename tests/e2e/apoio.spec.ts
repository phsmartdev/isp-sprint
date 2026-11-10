import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/** Pedido de Apoio: pedir ao time pelo topo, colega assume e atende, quem pediu confirma; pontos em Meus pontos. */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';
const psql = (q: string) => execFileSync('psql', [DB, '-Atc', q]).toString().trim();
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('pedido de apoio: pedir, assumir, atender, confirmar e ver os pontos', async ({ page }) => {
  test.setTimeout(120_000);
  const title = `Revisar proposta ${Date.now().toString(36)}`;
  // regra com Pedido de Apoio aprovada (proposta inicial, aprovada por quem administra)
  psql('delete from gamification_settings');
  await login(page, 'carlos@yepnet.test');
  const st = await (await page.request.get('/api/v1/times/gamificacao/settings')).json();
  expect((await page.request.post(`/api/v1/times/gamificacao/settings/${st.proposal.version}/decide`, { data: { approve: true } })).status()).toBeLessThan(300);

  await login(page, 'lucas@yepnet.test');
  await page.getByRole('button', { name: /^Apoio/ }).click();
  await page.getByRole('menuitem', { name: 'Pedir apoio' }).click();
  const dlg = page.getByRole('dialog', { name: 'Pedir apoio' });
  await dlg.getByLabel('Do que você precisa?').fill(title);
  await dlg.getByLabel('Time').selectOption({ label: 'Residencial (meu time)' });
  await expect(dlg.getByText(/quem apoiar ganha 1,5x os pontos da tarefa/)).toBeVisible();
  await dlg.getByRole('button', { name: 'Pedir apoio' }).click();
  await expect(page.getByText('Pedido enviado ao time')).toBeVisible();

  await login(page, 'ana@yepnet.test');
  await expect(page.getByRole('button', { name: /^Apoio: \d+ esperando por você/ })).toBeVisible();
  await page.goto('/apoio');
  const card = page.getByRole('article', { name: `Pedido de apoio ${title}` });
  await card.getByRole('button', { name: 'Assumir' }).click();
  await card.getByRole('button', { name: 'Marcar como atendido' }).click();
  await page.getByLabel('O que foi feito (opcional)').fill('Revisei os valores e o prazo');
  await page.getByRole('dialog', { name: 'Marcar como atendido' }).getByRole('button', { name: 'Marcar como atendido' }).click();
  await expect(card).toContainText('Atendido');

  await login(page, 'lucas@yepnet.test');
  await page.goto('/apoio');
  const mine = page.getByRole('region', { name: 'Você pediu' }).getByRole('article', { name: `Pedido de apoio ${title}` });
  await mine.getByRole('button', { name: 'Confirmar apoio' }).click();
  await expect(mine).toContainText('Confirmado');
  await page.screenshot({ path: 'test-results/apoio.png', fullPage: true });
  await page.goto('/meus-pontos');
  await expect(page.getByRole('region', { name: 'De onde vieram os pontos' })).toContainText(title);

  await login(page, 'ana@yepnet.test');
  await page.goto('/meus-pontos');
  const origin = page.getByRole('region', { name: 'De onde vieram os pontos' });
  await expect(origin.getByRole('row', { name: new RegExp(title) })).toContainText('Apoio a colega');
  await expect(origin.getByRole('row', { name: new RegExp(title) })).toContainText('+4,5');
});
