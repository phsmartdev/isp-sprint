import { expect, test, type Page } from '@playwright/test';

/** Marketing → Brindes → Compliance: política carregada, operação solicita, gestão decide, execução, conta e prestação de contas. */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('compliance de brindes: solicitar, avaliar, decidir, executar e prestar contas', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const st = Date.now().toString(36);
  await login(page, 'carlos@yepnet.test');
  const item = (await (await page.request.post('/api/v1/brindes/itens', { data: { name: `Caderno E2E ${st}`, unitCostCents: 60_00, initialStock: 20 } })).json()).id;
  const kitName = `Kit E2E ${st}`;
  expect((await page.request.post('/api/v1/brindes/kits', { data: { name: kitName, items: [{ itemId: item, qty: 2 }] } })).status()).toBe(201);
  await page.goto('/brindes?t=compliance');
  await page.getByRole('button', { name: 'Diretrizes' }).click();
  const rules = page.getByRole('dialog', { name: 'Diretrizes de compliance' });
  await rules.getByRole('button', { name: 'Carregar diretrizes da política' }).click();
  await expect(rules).toContainText('Categoria A (relacionamento estratégico)');
  await rules.getByRole('button', { name: 'Fechar' }).first().click().catch(() => page.keyboard.press('Escape'));

  // operação comercial (sem Marketing) solicita pela mesma tela
  await login(page, 'lucas@yepnet.test');
  const acc = (await (await page.request.post('/api/v1/contacts', { data: { name: `Conta Compliance ${st}`, segment: 'empresarial', phone: '79999992001' } })).json()).id;
  await page.goto('/brindes?t=compliance');
  await page.getByRole('button', { name: 'Nova solicitação' }).click();
  const form = page.getByRole('dialog', { name: 'Nova solicitação de concessão' });
  await form.getByLabel('Descrição').fill('Kit de fim de ano fictício');
  await form.getByLabel('Justificativa institucional ou comercial').fill('Relacionamento com a conta no encerramento do ano');
  await form.getByLabel('Buscar conta').fill(`Conta Compliance ${st}`);
  await form.getByRole('button', { name: `Conta Compliance ${st}` }).click();
  const kitOpt = await form.getByLabel('Kit', { exact: true }).locator('option', { hasText: kitName }).getAttribute('value');
  await form.getByLabel('Kit', { exact: true }).selectOption(kitOpt!);
  await form.getByLabel('Categoria do kit (política)').selectOption('D');
  // R$ 120 por kit na categoria D (até R$ 80) → exceção explicada
  const ev = form.getByRole('complementary', { name: 'Avaliação automática' });
  await expect(ev).toContainText('Fora do recomendado');
  await expect(ev).toContainText('Categoria D');
  await form.getByLabel('Categoria do kit (política)').selectOption('C');
  await expect(ev).toContainText('Dentro das diretrizes');
  await page.screenshot({ path: 'test-results/compliance-solicitacao.png' });
  await form.getByRole('button', { name: 'Enviar para avaliação' }).click();
  const drawer = page.getByRole('dialog', { name: /GC-\d{4}-\d{4} · Kit de fim de ano fictício/ });
  await expect(drawer).toContainText('Solicitado');
  await expect(drawer).toContainText('Só a Gestão comercial e a Diretoria');
  const url = page.url();

  // gestão decide (quem solicitou não decide)
  await login(page, 'carlos@yepnet.test');
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ''));
  const d2 = page.getByRole('dialog', { name: /GC-\d{4}-\d{4}/ });
  await d2.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await d2.getByLabel('Fundamentação da decisão').fill('Dentro da política, categoria C');
  await d2.getByRole('button', { name: 'Registrar decisão' }).click();
  await expect(d2).toContainText('Aprovado');
  await d2.getByRole('button', { name: 'Reservar materiais' }).click();
  await expect(d2).toContainText('Reservado');
  await d2.getByRole('button', { name: 'Confirmar execução' }).click();
  await expect(d2).toContainText('Executado');
  await expect(d2).toContainText('saída de estoque');
  await page.screenshot({ path: 'test-results/compliance-painel.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Pendências de controle' })).toContainText('sem comprovante');
  await page.screenshot({ path: 'test-results/compliance-tela.png', fullPage: true });

  // registrado na conta
  await page.goto(`/customers/${acc}?t=brindes`);
  await expect(page.getByRole('table', { name: 'Concessões registradas na conta' })).toContainText('Kit de fim de ano fictício');

  // prestação de contas
  await page.goto('/brindes?t=compliance');
  await page.getByRole('button', { name: 'Prestação de contas' }).click();
  const rep = page.getByRole('dialog', { name: 'Prestação de Contas' });
  await rep.getByLabel('Análise executiva da gestão').fill('Período de teste fictício.');
  const dl = page.waitForEvent('download');
  await rep.getByRole('button', { name: 'Gerar PDF' }).click();
  expect((await dl).suggestedFilename()).toMatch(/^Prestacao-de-Contas-PC-\d{4}-\d{3}-v\d+\.pdf$/);

  // limpa as diretrizes da empresa de teste
  const all = (await (await page.request.get('/api/v1/brindes/compliance/diretrizes')).json()).rules as { ruleKey: string; version: number; name: string; param: string; controlType: string; limitValue: number | null; natures: string[]; kitCategories: string[] }[];
  for (const r of all.filter((x) => x.ruleKey.startsWith('politica-'))) {
    if (all.some((x) => x.ruleKey === r.ruleKey && x.version > r.version)) continue;
    await page.request.post('/api/v1/brindes/compliance/diretrizes', { data: { ruleKey: r.ruleKey, name: r.name, param: r.param, controlType: r.controlType, limitValue: r.limitValue, natures: r.natures, kitCategories: r.kitCategories, validFrom: '2020-01-01', active: false, changeNote: 'Encerrada ao fim do teste' } });
  }
});
