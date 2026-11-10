import { expect, test } from '@playwright/test';

/** Venda fechada: confete, foto e nome de quem vendeu e os pontos que a oportunidade rendeu. */
const SHOTS = process.env.E2E_SHOTS;
test('comemoração da venda fechada mostra quem vendeu, os pontos e o confete', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('lucas@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  const p = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
  const cr = await page.request.post('/api/v1/opportunities', { data: { newContact: { name: `Cliente Comemoração ${Date.now().toString(36)}`, segment: 'empresarial' }, pipelineId: p.id, saleKind: 'venda_consultiva', branchId: lk.branches[0].id } });
  expect(cr.status(), await cr.text()).toBe(201);
  const o = await cr.json();
  expect((await page.request.put(`/api/v1/opportunities/${o.id}/items`, { data: { rowVersion: o.rowVersion, items: [{ description: 'Link dedicado 100 Mb', unit: 'un', qtyMilli: 1000, unitCents: 120_000 }] } })).status()).toBe(200);

  await page.goto(`/opportunities/${o.id}`);
  await page.getByRole('button', { name: 'Venda fechada' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Marcar venda fechada' }).click();
  const card = page.getByRole('status', { name: 'Venda fechada' });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('confetti').locator('span').first()).toBeAttached();
  await expect(card.getByTestId('celebration-name')).toHaveText('Parabéns, Lucas Lima!');
  const pts = card.getByTestId('celebration-points');
  if (await pts.count()) await expect(pts).toContainText(/Você ganhou [\d,]+ pontos? nesta oportunidade/);
  await page.waitForTimeout(1500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/comemoracao.png` });
  // continua na tela alguns segundos e fecha no clique
  await page.waitForTimeout(3000);
  await expect(card).toBeVisible();
  await card.click({ position: { x: 5, y: 5 } });
  await expect(card).toHaveCount(0);
});
