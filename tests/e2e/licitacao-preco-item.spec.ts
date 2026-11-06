import { expect, test } from '@playwright/test';

/** Licitação: resultado por item (nosso unitário final e o da vencedora) e histórico em Inteligência → Preços por item. */
const SHOTS = process.env.E2E_SHOTS;
test('registrar resultado por item e ver no histórico de preços', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  const p = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial') ?? lk.pipelines[0];
  const tag = Date.now().toString(36);
  const cr = await page.request.post('/api/v1/opportunities', { data: { newContact: { name: `Órgão Preço E2E ${tag}`, segment: 'governamental' }, pipelineId: p.id, saleKind: 'licitacao', branchId: lk.branches[0].id, custom: { tipo_disputa: 'Aberta', lance_inicial: 1000, lance_minimo: 800, orgao_contratante: `Prefeitura Fictícia ${tag}` } } });
  expect(cr.status(), await cr.text()).toBe(201);
  const o = await cr.json();
  const it = (description: string, bid: number) => ({ description, unit: 'un', qtyMilli: 10_000, unitCents: 15_000, bidUnitCents: bid });
  const pi = await page.request.put(`/api/v1/opportunities/${o.id}/items`, { data: { rowVersion: o.rowVersion, items: [it(`Link dedicado ${tag}`, 12_000), it(`Roteador ${tag}`, 5_000)] } });
  expect(pi.status(), await pi.text()).toBe(200);
  const v = (await pi.json()).rowVersion;
  expect((await page.request.put(`/api/v1/opportunities/${o.id}/bid-participants`, { data: { rowVersion: v, items: [{ company: 'Nós', isUs: true, bidCents: 170_000 }, { company: 'Rede Alfa Fictícia', bidCents: 150_000, winner: true }] } })).status()).toBe(200);

  await page.goto(`/opportunities/${o.id}?aba=pregao`);
  const box = page.getByRole('region', { name: 'Resultado por item' });
  await expect(box).toContainText(`Link dedicado ${tag}`);
  await box.getByRole('button', { name: 'Registrar resultado' }).click();
  // a vencedora do pregão já vem sugerida; o nosso final vem do lance
  await expect(box.getByLabel(`Empresa vencedora de Link dedicado ${tag}`)).toHaveValue('Rede Alfa Fictícia');
  await expect(box.getByLabel(`Nosso preço unitário final de Link dedicado ${tag}`)).toHaveValue('120,00');
  await box.getByLabel(`Nosso preço unitário final de Link dedicado ${tag}`).fill('110,00');
  await box.getByLabel(`Preço unitário da vencedora de Link dedicado ${tag}`).fill('100,00');
  await box.getByLabel(`Nós vencemos Roteador ${tag}`).check();
  await box.getByLabel(`Nosso preço unitário final de Roteador ${tag}`).fill('48,00');
  await box.getByRole('button', { name: 'Salvar resultado' }).click();
  await expect(page.getByText('Resultado por item salvo')).toBeVisible();
  const row = box.getByRole('row', { name: new RegExp(`Link dedicado ${tag}`) });
  await expect(row).toContainText('Rede Alfa Fictícia');
  await expect(row).toContainText('R$ 100,00');
  await expect(row).toContainText('+10');
  if (SHOTS) await box.screenshot({ path: `${SHOTS}/resultado-por-item.png` });

  await page.goto('/intelligence?v=precos');
  const sec = page.getByRole('region', { name: 'Preços por item nas licitações' });
  await sec.getByLabel('Buscar item, órgão ou vencedora').fill(tag);
  await expect(sec.getByRole('row')).toHaveCount(3);
  const r1 = sec.getByRole('row', { name: new RegExp(`Link dedicado ${tag}`) });
  await expect(r1).toContainText('R$ 120,00');
  await expect(r1).toContainText('R$ 110,00');
  await expect(r1).toContainText('Rede Alfa Fictícia');
  await expect(r1).toContainText('R$ 100,00');
  const r2 = sec.getByRole('row', { name: new RegExp(`Roteador ${tag}`) });
  await expect(r2).toContainText('Nós');
  await expect(r2).toContainText('R$ 48,00');
  const dl = page.waitForEvent('download');
  await sec.getByRole('button', { name: 'Exportar CSV' }).click();
  expect((await dl).suggestedFilename()).toMatch(/^precos-por-item-licitacoes-/);
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/precos-por-item.png` });
});
