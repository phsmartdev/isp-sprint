import { expect, test, type Page } from '@playwright/test';

/** Envelope fiscal temporal em Configurações → Filiais → Documentos fiscais: seletor de ano, tributos por ano, card de DRE e retenções;
 *  a viabilidade usa o ano da Vigência fiscal, mostra o ano que gerou o resultado, a faixa de margem líquida e o target seeking. */
const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
type Tax = { name: string; percentBp: number; fixedCents: number; active: boolean; validFrom?: string | null; validTo?: string | null };

test('Filiais → Documentos fiscais por ano + DRE e retenções; viabilidade 2027', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  expect((await page.request.post('/api/v1/admin/viability/econ', { data: {
    marginTargetBp: 2000, marginSuggestedBp: 3000, marginMaxBp: 9000, tmaAnnualBp: 1956, inflationAnnualBp: 0, horizonMaxMonths: 60, badDebtBp: 100, commissionBp: 0,
    lossPrivateBp: 300, lossPublicBp: 300, contingencyCapexBp: 0, contingencyOpexBp: 0, overheadBp: 2000, incomeTaxBp: 3400, netMarginTargetBp: null, variableExpenseBp: 0,
    netMarginMinBp: 1200, netMarginMaxBp: 2500, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: false, validFrom: today,
  } })).status()).toBe(201);
  const br = (await (await page.request.get('/api/v1/admin/sales-branches')).json()).items;
  expect(br[0]).not.toHaveProperty('ibgeCode');

  // tributos 2027 (CBS/IBS no lugar de PIS/COFINS) nos documentos da filial; 2026 fica como está
  type D = { id: string | null; branchId?: string; fiscalKind: string; code: string; name: string; active: boolean; taxes: Tax[] };
  const docsOf = async (y: number): Promise<D[]> => (await (await page.request.get(`/api/v1/admin/fiscal-docs?year=${y}`)).json()).items.filter((d: D) => d.branchId === br[0].id);
  let docs = await docsOf(2026);
  if (!docs.some((d) => d.fiscalKind === 'servico')) {
    const strip = (d: D) => ({ id: d.id, fiscalKind: d.fiscalKind, code: d.code, name: d.name, active: d.active, taxes: d.taxes });
    const add = [...docs.map(strip), { id: null, fiscalKind: 'servico', code: 'NFS-E2E', name: 'Nota de serviço E2E', active: true, taxes: [{ name: 'ISS', percentBp: 500, fixedCents: 0, active: true }, { name: 'PIS', percentBp: 65, fixedCents: 0, active: true }, { name: 'COFINS', percentBp: 300, fixedCents: 0, active: true }] }];
    expect((await page.request.put(`/api/v1/admin/fiscal-docs/${br[0].id}`, { data: { year: 2026, items: add } })).status()).toBe(200);
  }
  docs = await docsOf(2027);
  const items = docs.map((d) => ({
    id: d.id, fiscalKind: d.fiscalKind, code: d.code, name: d.name, active: d.active,
    taxes: d.fiscalKind === 'servico' ? [{ name: 'ISS', percentBp: 500, fixedCents: 0, active: true }, { name: 'CBS', percentBp: 880, fixedCents: 0, active: true }, { name: 'IBS', percentBp: 10, fixedCents: 0, active: true }] : d.taxes,
  }));
  const putDocs = await page.request.put(`/api/v1/admin/fiscal-docs/${br[0].id}`, { data: { year: 2027, items } });
  expect(putDocs.status(), await putDocs.text()).toBe(200);

  await page.goto('/settings/filiais');
  const sec = page.getByRole('region', { name: 'Documentos fiscais', exact: true });
  await expect(page.getByLabel('Código IBGE do município da filial 1')).toHaveCount(0);
  await expect(sec.getByLabel('Ano de vigência fiscal')).toHaveValue(String(new Date().getFullYear()));
  await sec.getByLabel('Ano de vigência fiscal').selectOption('2027');
  const serv = sec.getByRole('region', { name: 'Documentos fiscais em Prestação de serviço' });
  await expect(serv.getByLabel('Nome do tributo').nth(1)).toHaveValue('CBS');
  const card = sec.getByRole('region', { name: `DRE e retenções na fonte de ${br[0].name}` });
  await expect(card).toContainText('Vigência 2027');
  await card.getByLabel('Alíquota efetiva sobre o lucro').fill('15');
  await card.getByLabel('Retenção IRRF').fill('1,5');
  await card.getByRole('button', { name: 'Salvar DRE e retenções de 2027' }).click();
  await expect(page.getByText(`${br[0].name}: DRE e retenções de 2027 salvas`)).toBeVisible();
  await expect(card).toContainText('Vigência 2027 salva em');
  if (SHOTS) await sec.screenshot({ path: `${SHOTS}/filiais-envelope.png` });
  // 2026 continua com os tributos do regime atual
  await sec.getByLabel('Ano de vigência fiscal').selectOption('2026');
  await expect(serv.getByLabel('Nome do tributo').nth(1)).not.toHaveValue('CBS');

  // simulação 2027 numa oportunidade da filial
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
  expect(res.fiscal).toMatchObject({ year: 2027, regime: 'reforma', profitTaxBp: 1500, profitTaxSource: 'envelope' });
  expect(res.decision.netMarginRange).toEqual({ minPct: 12, maxPct: 25 });
  expect(res.decision.investmentPaybackMonths).toBeCloseTo(3, 2);
  await page.goto(`/opportunities/${opp.id}`);
  const panel = page.locator('section[aria-labelledby="econ-sum"]');
  await expect(panel.getByLabel('Resultado gerado com a vigência fiscal 2027')).toContainText('Reforma Tributária');
  await expect(panel.getByLabel('Envelope fiscal da simulação')).toContainText('IRPJ/CSLL 15%');
  const ts = panel.getByRole('region', { name: 'Preço pela margem líquida (target seeking)' });
  await expect(ts).toContainText('Faixa de preço viável pela margem líquida');
  await expect(ts).toContainText('Margem líquida mínima 12');
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/viabilidade-2027.png` });
});
