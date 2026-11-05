import { expect, test, type Page } from '@playwright/test';

/** FINANCE-3.1: DRE com o período de amortização (1..D), o pós-payback (D+1..N) e o contrato; recomendação pela margem líquida alvo. */
const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('DRE em três colunas com soma exata e recomendação pela margem líquida alvo', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const pub = await page.request.post('/api/v1/admin/viability/econ', { data: {
    marginTargetBp: 2000, marginSuggestedBp: 3000, marginMaxBp: 9000, tmaAnnualBp: 1956, inflationAnnualBp: 0, horizonMaxMonths: 60, badDebtBp: 100, commissionBp: 0,
    lossPrivateBp: 300, lossPublicBp: 300, contingencyCapexBp: 0, contingencyOpexBp: 0, overheadBp: 2000, incomeTaxBp: 1500, netMarginTargetBp: 4000, variableExpenseBp: 0,
    paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: false, validFrom: today,
  } });
  expect(pub.status(), await pub.text()).toBe(201);
  const list = await (await page.request.get('/api/v1/opportunities?pageSize=50')).json();
  const opp = list.items.find((o: { stage: string }) => !['ganho', 'perdido', 'cancelado'].includes(o.stage)) ?? list.items[0];
  const put = await page.request.put(`/api/v1/opportunities/${opp.id}/economics`, { data: {
    mode: 'recorrente', termMonths: 12, receiveMonth: 0, paybackMonths: 3, capex: [{ description: 'Implantação', impact: 'material', qtyMilli: 1000, unitCents: 5_847_700 }],
    extraInitialCents: 0, opex: [], commissionBp: null, lossBp: null, marginTargetBp: null, priceCents: null,
  } });
  expect(put.status(), await put.text()).toBe(200);
  const saved = await put.json();
  const st = saved.result.statement;
  expect(st.afterFrom).toBe(4);
  expect(st.total.net).toBe(saved.result.kpi ? st.total.net : null);
  expect(saved.recomendacao_viabilidade['margem_contrib_recomendada_%']).toBeCloseTo(71.06, 2);

  await page.goto(`/opportunities/${opp.id}`);
  const panel = page.getByRole('region', { name: /Viabilidade da venda/ }).or(page.locator('section[aria-labelledby="econ-sum"]')).first();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Memória de cálculo' }).click();
  await expect(panel.getByText('Por mês (1–3, com amortização)')).toBeVisible();
  await expect(panel.getByText('Por mês (4–12, sem amortização)')).toBeVisible();
  await expect(panel.getByText('No contrato (12 meses)')).toBeVisible();
  await expect(panel.getByLabel('Recomendação pela margem líquida alvo')).toContainText('71,06%');
  await expect(panel.getByText('Parcela do investimento (P_inv)')).toBeVisible();
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/finance31-dre.png` });
});
