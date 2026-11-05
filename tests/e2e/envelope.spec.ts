import { expect, test, type Page } from '@playwright/test';

/** Envelope fiscal por vigência: a tela carrega só os campos da chave (2026 PIS/COFINS; 2027 CBS/IBS) e a simulação usa a chave escolhida. */
const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('Configurações → Viabilidade: envelope por vigência e simulação 2027', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  expect((await page.request.post('/api/v1/admin/viability/econ', { data: {
    marginTargetBp: 2000, marginSuggestedBp: 3000, marginMaxBp: 9000, tmaAnnualBp: 1956, inflationAnnualBp: 0, horizonMaxMonths: 60, badDebtBp: 100, commissionBp: 0,
    lossPrivateBp: 300, lossPublicBp: 300, contingencyCapexBp: 0, contingencyOpexBp: 0, overheadBp: 2000, incomeTaxBp: 3400, netMarginTargetBp: 4000, variableExpenseBp: 0,
    paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: false, validFrom: today,
  } })).status()).toBe(201);
  const br = (await (await page.request.get('/api/v1/admin/sales-branches')).json()).items;
  expect((await page.request.put('/api/v1/admin/sales-branches', { data: { items: br.map((b: Record<string, unknown>, i: number) => ({ id: b.id, name: b.name, active: b.active, fiscalKinds: b.fiscalKinds, cnpj: b.cnpj, taxRegime: b.taxRegime, city: b.city, state: b.state, ibgeCode: i === 0 ? '2800308' : b.ibgeCode ?? null })) } })).status()).toBe(200);

  await page.goto('/settings/viability');
  const sec = page.getByRole('region', { name: 'Envelope fiscal por vigência' });
  await expect(sec).toBeVisible();
  await sec.getByLabel('Filial (emitente)').selectOption(br[0].id);
  await expect(sec.getByLabel('Município (IBGE)')).toHaveValue('2800308');
  await sec.getByLabel('Vigência (ano)').fill('2026');
  await expect(sec.getByLabel('PIS em Prestação de serviço')).toBeVisible();
  await expect(sec.getByLabel('CBS em Prestação de serviço')).toHaveCount(0);
  await sec.getByLabel('Vigência (ano)').fill('2027');
  await expect(sec.getByText('Reforma Tributária (2027 em diante)')).toBeVisible();
  await expect(sec.getByLabel('PIS em Prestação de serviço')).toHaveCount(0);
  await sec.getByLabel('CBS em Prestação de serviço').fill('8,8');
  await sec.getByLabel('IBS em Prestação de serviço').fill('0,1');
  await sec.getByLabel('ISS em Prestação de serviço').fill('5');
  await sec.getByLabel('Alíquota efetiva sobre o lucro (IRPJ + CSLL)').fill('15');
  await sec.getByLabel('IRRF').fill('1,5');
  await sec.getByLabel('IRRF').blur();
  await expect(sec.getByRole('row', { name: /Carga da nota/ })).toContainText('13,9%');
  await sec.getByRole('button', { name: 'Publicar envelope 2027' }).click();
  await expect(page.getByText('Envelope fiscal 2027 publicado')).toBeVisible();
  await expect(sec.getByRole('table').last()).toContainText('servico 13,9%');
  if (SHOTS) await sec.screenshot({ path: `${SHOTS}/envelope-admin.png` });

  // simulação com a chave 2027 numa oportunidade da filial
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial') ?? lk.pipelines[0];
  const created = await page.request.post('/api/v1/opportunities', { data: { newContact: { name: `Empresa Envelope E2E ${Date.now()}`, segment: 'empresarial' }, pipelineId: corp.id, branchId: br[0].id, saleKind: 'venda_consultiva' } });
  expect(created.status(), await created.text()).toBe(201);
  const opp = await created.json();
  const put = await page.request.put(`/api/v1/opportunities/${opp.id}/economics`, { data: {
    mode: 'recorrente', termMonths: 12, receiveMonth: 0, paybackMonths: 3, capex: [{ description: 'Implantação', impact: 'material', qtyMilli: 1000, unitCents: 1_000_000 }],
    extraInitialCents: 0, opex: [], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null, fiscalYear: 2027,
  } });
  expect(put.status(), await put.text()).toBe(200);
  const res = (await put.json()).result;
  expect(res.fiscal).toMatchObject({ year: 2027, regime: 'reforma', profitTaxBp: 1500 });
  await page.goto(`/opportunities/${opp.id}`);
  const panel = page.locator('section[aria-labelledby="econ-sum"]');
  await expect(panel.getByLabel('Envelope fiscal da simulação')).toContainText('Envelope fiscal 2027 (Reforma Tributária)');
  await expect(panel.getByLabel('Envelope fiscal da simulação')).toContainText('IRPJ/CSLL 15%');
});
