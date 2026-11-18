import { expect, test, type Page } from '@playwright/test';

/** Negociação por seções: tipos de negócio na aba Produtos e serviços e a viabilidade por seção com a visão geral. */
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

test('seções: recorrência e venda, custos importados da viabilidade técnica, preço ideal e visão geral', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const st = Date.now().toString(36);
  // parâmetros e documentos fiscais fictícios
  const econ = await page.request.post('/api/v1/admin/viability/econ', { data: { marginTargetBp: 2000, marginSuggestedBp: 3000, marginMaxBp: 4500, tmaAnnualBp: 0, inflationAnnualBp: 0, horizonMaxMonths: 120, badDebtBp: 0, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, overheadBp: 0, incomeTaxBp: 0, paybackMaxPrivate: 24, paybackMaxPublic: 24, blockOutsidePolicy: false, validFrom: today } });
  expect(econ.status(), await econ.text()).toBe(201);
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  const branch = lk.branches[0].id;
  const cur = (await (await page.request.get('/api/v1/fiscal-docs')).json()).items.filter((d: { branchId: string }) => d.branchId === branch);
  const keep = cur.map((d: { id: string; fiscalKind: string; code: string; name: string; active: boolean; taxes: unknown[] }) => ({ id: d.id, fiscalKind: d.fiscalKind, code: d.code, name: d.name, active: d.active, taxes: d.taxes }));
  const put = await page.request.put(`/api/v1/admin/fiscal-docs/${branch}`, { data: { items: [...keep,
    { id: null, fiscalKind: 'servico', code: `SRV${st}`.slice(0, 12).toUpperCase(), name: 'Serviço fictício E2E', active: true, taxes: [{ name: 'ISS', percentBp: 1200, fixedCents: 0, active: true }] },
    { id: null, fiscalKind: 'venda', code: `NFE${st}`.slice(0, 12).toUpperCase(), name: 'Venda fictícia E2E', active: true, taxes: [{ name: 'ICMS', percentBp: 1800, fixedCents: 0, active: true }] },
  ] } });
  expect(put.status(), await put.text()).toBe(200);
  const corp = lk.pipelines.find((p: { key: string }) => p.key === 'empresarial');
  const o = await (await page.request.post('/api/v1/opportunities', { data: { newContact: { name: `Empresa Seções E2E ${st}`, segment: 'empresarial' }, pipelineId: corp.id, branchId: branch, saleKind: 'venda_consultiva' } })).json();

  await page.goto(`/opportunities/${o.id}?aba=produtos`);
  const s1 = page.getByRole('region', { name: 'Tipo de negócio 1' });
  await s1.getByRole('radio', { name: 'Recorrência' }).click();
  await s1.getByLabel('Vigência em meses 1').fill('36');
  await s1.getByRole('button', { name: 'Adicionar produto ou serviço' }).click();
  await s1.getByLabel('Produto ou serviço 1.1').fill('Link dedicado 200 Mbps');
  await s1.getByLabel('Documento fiscal 1.1').selectOption({ label: `${`SRV${st}`.slice(0, 12).toUpperCase()} · Serviço fictício E2E` });
  await s1.getByLabel('Observação 1.1').fill('Entrega no rack do cliente');
  // custos: importa a planilha da viabilidade técnica (Frequência e "Impacta o quê?" preenchem Quando e Dedução)
  const csv = ['Descrição;Unidade;Quantidade;Valor unitário;Frequência;Impacta o quê?', 'ONU e cabo drop;un;1;850,00;Único;Material', 'Instalação e ativação;un;1;1200,00;Único;Mão de obra', 'Última milha de terceiro;un;1;900,00;Mensal;Parceiro', 'Monitoramento 24h;un;1;120,00;Mensal;Operacional', 'Conector SC/APC;un;10;3,50;Único;'].join('\n');
  await s1.getByLabel('Importar planilha de custos 1').setInputFiles({ name: 'viabilidade-tecnica.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') });
  await expect(s1.getByRole('status')).toContainText('5 custo(s) incluído(s)');
  await expect(s1.getByRole('status')).toContainText('1 sem dedução');
  await expect(s1.getByLabel('Dedução 1.3')).toHaveValue('parceiros');
  await expect(s1.getByLabel('Quando 1.3')).toHaveValue('mensal');
  // prévia ao vivo: preço ideal = (900 + 120) ÷ (1 − 12% − 30%)
  await expect(s1).toContainText('R$ 1.758,63/mês');

  await page.getByRole('button', { name: 'Adicionar novo tipo de venda' }).click();
  const s2 = page.getByRole('region', { name: 'Tipo de negócio 2' });
  await expect(s2.getByRole('radio', { name: 'Venda' })).toHaveAttribute('aria-checked', 'true');
  await s2.getByRole('button', { name: 'Adicionar produto ou serviço' }).click();
  await s2.getByLabel('Produto ou serviço 2.1').fill('Roteador Wi-Fi 6');
  await s2.getByLabel('Documento fiscal 2.1').selectOption({ label: `${`NFE${st}`.slice(0, 12).toUpperCase()} · Venda fictícia E2E` });
  await s2.getByLabel('Quantidade 2.1').fill('2');
  await s2.getByRole('button', { name: 'Adicionar custo' }).click();
  await s2.getByLabel('Dedução 2.1').selectOption('materia_prima');
  await s2.getByLabel('Descrição do custo 2.1').fill('Roteador Wi-Fi 6 (custo)');
  await s2.getByLabel('Quantidade do custo 2.1').fill('2');
  await s2.getByLabel('Valor do custo 2.1').fill('420,00');
  await page.screenshot({ path: 'test-results/secoes-produtos.png', fullPage: true });
  const saved = page.waitForResponse((r) => r.url().includes('/economics') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Salvar produtos e custos' }).first().click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('Produtos, custos e viabilidade salvos')).toBeVisible();

  // viabilidade: só margem e payback; deduções em lista e a visão geral
  await page.getByRole('tab', { name: 'Viabilidade econômica' }).click();
  const v1 = page.getByRole('region', { name: 'Viabilidade do tipo de negócio 1' });
  await expect(v1).toContainText('R$ 1.758,63/mês');
  await expect(v1).toContainText('(−) Parceiros');
  await expect(v1).not.toContainText('(−) Matéria-prima');
  await expect(v1).toContainText('Investimento da implantação');
  await expect(v1).toContainText('R$ 2.050,00');
  const v2 = page.getByRole('region', { name: 'Viabilidade do tipo de negócio 2' });
  await expect(v2).toContainText('(−) Matéria-prima');
  await expect(v2).toContainText('R$ 840,00');
  const geral = page.getByRole('region', { name: 'Visão geral do negócio' });
  await expect(geral).toContainText('Resultado do contrato');
  await expect(geral.getByRole('table', { name: 'DRE da negociação' })).toContainText('(−) Investimento da implantação');
  // ajustar a margem muda o preço ideal na hora
  await v1.getByLabel('Margem de contribuição (%)').fill('35');
  await expect(v1).toContainText(`R$ ${(Math.ceil(102_000 / 0.53) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês`);
  await page.getByRole('button', { name: 'Salvar viabilidade' }).click();
  await expect(page.getByText('Viabilidade econômica salva')).toBeVisible();
  // usar o preço: fixa o preço e grava o valor no produto (proposta)
  await v1.getByRole('button', { name: 'Usar este preço' }).click();
  await expect(page.getByText('Preço aplicado na seção e nos produtos')).toBeVisible();
  await expect(v1).toContainText('Preço praticado');
  await page.screenshot({ path: 'test-results/secoes-viabilidade.png', fullPage: true });
  const items = await (await page.request.get(`/api/v1/opportunities/${o.id}/items`)).json();
  expect(items.items.find((i: { description: string }) => i.description === 'Link dedicado 200 Mbps').unitCents).toBe(Math.ceil(102_000 / 0.53));
});
