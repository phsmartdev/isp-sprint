import zlib from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('gestão de contratos: painel, funil, calendário, validação e etapa de implantação', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  await page.getByRole('link', { name: 'Gestão de Contratos' }).first().click();
  await expect(page.getByRole('heading', { name: 'Gestão de Contratos' })).toBeVisible();
  await expect(page.getByText('Contratos ativos')).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-painel.png', fullPage: true });
  await page.getByRole('tab', { name: 'Funil' }).click();
  await expect(page.getByRole('heading', { name: /Cadastro e validação/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-funil.png', fullPage: true });
  await page.getByRole('tab', { name: 'Calendário' }).click();
  await expect(page.getByRole('button', { name: 'Próximo mês' })).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-calendario.png', fullPage: true });
  await page.getByRole('tab', { name: 'Lista' }).click();
  await page.getByLabel('Buscar contratos').fill('CTR-2026-052');
  await page.getByRole('link', { name: 'CTR-2026-052' }).click();
  await expect(page.getByText('Cadastro aguardando validação')).toBeVisible();
  await page.getByRole('button', { name: 'Validar cadastro' }).click();
  await page.getByRole('button', { name: 'Validar e iniciar implantação' }).click();
  await expect(page.getByText('Cadastro validado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ver o contrato' }).click();
  await page.getByRole('tab', { name: /Processos/ }).click();
  const erp = page.locator('li').filter({ hasText: 'Cadastrar/atualizar no ERP' }).first();
  await erp.getByRole('button', { name: 'Registrar' }).click();
  await page.getByLabel('Código/referência no ERP').fill('ERP-E2E-1');
  await page.getByRole('button', { name: 'Concluir etapa' }).click();
  await expect(page.getByText(/Feita por Carlos Silva .* ERP ERP-E2E-1/)).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-ficha.png', fullPage: true });
  await page.getByRole('tab', { name: /Versões/ }).click();
  await expect(page.getByText('v1')).toBeVisible();
  await page.getByRole('tab', { name: 'Linha do tempo' }).click();
  await expect(page.getByText('Cadastro validado', { exact: true })).toBeVisible();
});

test('oportunidade fechada: cadastrar contrato com os dados do CRM', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/opportunities?view=lista&status=encerradas');
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  // procura uma venda fechada ainda sem contrato
  let found = false;
  const total = Math.min(15, await rows.count());
  for (let i = 0; i < total && !found; i++) {
    await page.goto('/opportunities?view=lista&status=encerradas');
    await expect(rows.first()).toBeVisible();
    await rows.nth(i).click();
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
    const btn = page.getByRole('button', { name: 'Cadastrar contrato' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (await btn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) { await btn.click(); found = true; }
  }
  expect(found).toBe(true);
  await expect(page.getByRole('heading', { name: 'Novo contrato' })).toBeVisible();
  await expect(page.getByText('Oportunidade de origem')).toBeVisible();
  await page.getByLabel('Número do contrato').fill('CT-E2E-900');
  await page.getByLabel('Início da vigência').fill('2026-11-01');
  await expect(page.getByLabel('Término da vigência')).toHaveValue('2027-10-31');
  await page.screenshot({ path: 'test-results/contracts-novo.png', fullPage: true });
  await page.getByRole('button', { name: 'Cadastrar contrato' }).click();
  await expect(page.getByRole('heading', { name: 'Contrato CT-E2E-900' })).toBeVisible();
  await page.goto('/intelligence?v=contratos');
  await expect(page.getByText('Receita mensal contratada')).toBeVisible();
  await expect(page.getByText('Aguardando ERP').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-intel.png', fullPage: true });
});

test('modelos com timbrado, gerar contrato, saldo de medição, painel por tipo e relatório completo', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/contracts');
  await expect(page.getByText('Faturamento total no período')).toBeVisible();
  for (const t of ['Recorrente', 'Frequente', 'Medição']) await expect(page.getByLabel('Faturamento por tipo de contrato').getByText(t, { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-painel2.png', fullPage: true });
  // modelo .docx
  await page.getByRole('tab', { name: 'Modelos' }).click();
  // modelo com a arte (mesmo editor dos modelos de proposta)
  await expect(page.getByRole('heading', { name: 'Modelos de contrato' })).toBeVisible();
  await page.getByRole('button', { name: 'Novo modelo' }).click();
  await expect(page.getByRole('heading', { name: 'Modelo: Contrato padrão' })).toBeVisible();
  await expect(page.getByLabel('Usado para contratos do tipo')).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-modelo-arte.png', fullPage: true });
  await page.getByRole('button', { name: 'Fechar', exact: true }).last().click();
  await page.getByRole('button', { name: 'Subir modelo' }).click();
  await page.getByLabel('Nome do modelo').fill('Contrato padrão Yepnet');
  await page.locator('#tm-file').setInputFiles('tests/e2e/fixtures/modelo-contrato.docx');
  await page.getByRole('button', { name: 'Salvar modelo' }).click();
  await expect(page.getByText(/Modelo salvo: \d+ campo/)).toBeVisible();
  await page.locator('section').filter({ hasText: 'Modelos em Word (opcional)' }).getByRole('button', { name: 'Editar' }).first().click();
  await expect(page.getByText('{{prazo_instalacao}}', { exact: true })).toBeVisible();
  await page.getByLabel('Rótulo').first().fill('Prazo de instalação');
  await page.getByRole('button', { name: 'Salvar modelo' }).click();
  await page.screenshot({ path: 'test-results/contracts-modelos.png', fullPage: true });
  // gera para um contrato vigente
  await page.getByRole('tab', { name: 'Lista' }).click();
  await page.getByLabel('Buscar contratos').fill('CTR-2025-031');
  await page.getByRole('link', { name: 'CTR-2025-031' }).click();
  await page.getByRole('tab', { name: 'Documentos' }).click();
  await page.getByRole('button', { name: 'Gerar pelo modelo' }).click();
  await page.getByLabel('Modelo', { exact: true }).selectOption({ label: 'Contrato padrão Yepnet (Word)' });
  await page.getByLabel('Prazo de instalação').fill('10 dias úteis');
  await page.getByRole('button', { name: 'Gerar documento' }).click();
  await expect(page.getByText(/Contrato gerado: .* - CONTRATO - /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assinar (ZapSign)' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Assinar (ZapSign)' }).first().click();
  await expect(page.getByRole('heading', { name: 'Enviar para assinatura (ZapSign)' })).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-assinar.png', fullPage: true });
  await page.getByRole('button', { name: 'Cancelar' }).click();
  // medição
  await page.goto('/contracts?t=lista');
  await page.getByLabel('Buscar contratos').fill('ATA-2025-007');
  await page.getByRole('link', { name: 'ATA-2025-007' }).click();
  await page.getByRole('tab', { name: 'Saldo e consumo' }).click();
  await expect(page.getByText('Disponível', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-saldo.png', fullPage: true });
  // relatório completo
  await page.goto('/contracts?t=relatorios');
  await expect(page.getByRole('heading', { name: 'Relatório completo de contratos' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ATA-2025-007' })).toBeVisible();
  await page.screenshot({ path: 'test-results/contracts-relatorio.png', fullPage: true });
});

test('oportunidade de cliente da base pergunta sobre Sucesso do Cliente', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/opportunities/new');
  await page.getByRole('radio', { name: /Cliente da carteira/ }).click();
  await page.locator('#no-search').fill('Sérgio Torres');
  await page.getByRole('list', { name: 'Resultados' }).getByRole('button').filter({ hasText: 'Ativo' }).first().click();
  await expect(page.getByText('Acionar o processo de Sucesso do Cliente?')).toBeVisible();
  await page.getByLabel('Tipo de venda').selectOption({ label: 'Venda Consultiva' });
  await page.getByLabel('Filial').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Iniciar Negociação' }).click();
  await expect(page.getByText('Responda se aciona Sucesso do Cliente')).toBeVisible();
  await page.getByRole('radio', { name: 'Sim, acionar' }).check();
  await page.getByRole('button', { name: 'Iniciar Negociação' }).click();
  await expect(page.getByText(/Sucesso do Cliente acionado/)).toBeVisible();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
});

/** PNG pesado (ruído, sem compressão) para simular uma arte grande exportada do Canva. */
function heavyPng(w: number, h: number) {
  const crc = (b: Buffer) => { const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(b) >>> 0); return c; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); return Buffer.concat([len, td, crc(td)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (x * 7 + y * 13 + ((x * y) % 251)) & 0xff ^ ((Math.random() * 40) | 0); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}

test('arte grande do modelo é reduzida no navegador e cabe no limite de envio da hospedagem', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/contract-templates');
  await page.getByRole('button', { name: 'Novo modelo' }).click();
  const png = heavyPng(1700, 1150);
  expect(png.length).toBeGreaterThan(5_000_000);
  const sizes: number[] = [];
  page.on('request', (r) => { if (r.url().includes('/pages') && r.method() === 'POST') sizes.push(r.postDataBuffer()?.length ?? 0); });
  await page.locator('input[type="file"][accept="image/png,image/jpeg"]').setInputFiles({ name: 'timbrado.png', mimeType: 'image/png', buffer: png });
  await expect.poll(() => sizes.length, { timeout: 20_000 }).toBe(1);
  expect(sizes[0]).toBeLessThan(4_400_000);
  await expect(page.getByText(/Página 1|1 página|página 1/i).first()).toBeVisible({ timeout: 15_000 });
});

test('consumo e empenho: ritmo contra o tempo, esgotamento previsto e empenho com saldo', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  const api = page.request;
  const today = new Date().toISOString().slice(0, 10);
  const shift = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  const lk = await (await api.get('/api/v1/meta/lookups')).json();
  const o = await (await api.post('/api/v1/opportunities', { data: { newContact: { name: `Prefeitura E2E Consumo ${Date.now().toString(36)}`, segment: 'governamental' }, planId: lk.plans[0].id } })).json();
  const cur = await (await api.get(`/api/v1/opportunities/${o.id}`)).json();
  expect((await api.post(`/api/v1/opportunities/${o.id}/transition`, { data: { toStage: 'ganha', confirm: true, rowVersion: cur.rowVersion } })).ok()).toBe(true);
  const me = await (await api.get('/api/v1/me')).json();
  const created = await api.post('/api/v1/contracts', { data: { opportunityId: o.id, billingType: 'medicao', kind: 'publico', legalRegime: 'lei_14133', initialBalanceCents: 1_200_000, commercialOwnerId: me.user.id, version: { number: `E2E-${Date.now().toString(36)}`, object: 'Medição pública', signedAt: shift(-185), startAt: shift(-180), termMonths: 12, monthlyCents: 0, items: [], publicTerms: { agency: 'Prefeitura E2E', processNumber: '1/2026', modality: 'pregao', commitmentNote: null, budgetLine: null, extensionMaxMonths: 120 } } } });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).id;
  expect((await api.post(`/api/v1/contracts/${id}/validate`)).ok()).toBe(true);
  expect((await api.post(`/api/v1/contracts/${id}/ledger`, { data: { kind: 'consumo', amountCents: 900_000, occurredOn: today, description: 'Medição do mês' } })).status()).toBe(201);

  await page.goto(`/contracts/${id}`);
  await page.getByRole('tab', { name: 'Consumo e empenho' }).click();
  const ind = page.getByRole('region', { name: 'Indicador de consumo' });
  await expect(ind).toContainText('75%');
  await expect(ind.getByRole('alert')).toContainText('antes do fim da vigência');
  const emp = page.getByRole('region', { name: 'Empenhos' });
  await emp.getByRole('button', { name: 'Registrar empenho' }).click();
  const dlg = page.getByRole('dialog', { name: 'Registrar empenho' });
  await dlg.getByLabel('Número da nota de empenho').fill('2026NE000777');
  await dlg.getByLabel('Valor (R$)').fill('10.000,00');
  await dlg.getByRole('button', { name: 'Registrar' }).click();
  await expect(emp).toContainText('2026NE000777');
  await expect(emp).toContainText('R$ 10.000,00 de R$ 10.000,00');
});
