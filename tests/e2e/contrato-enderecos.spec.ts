import { expect, test } from '@playwright/test';

/** Contrato → endereços de entrega: colar do Excel, importar planilha, nova coluna e leitura na ficha. */
const SHOTS = process.env.E2E_SHOTS;
test('endereços de entrega: colar, importar, coluna extra e ficha', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  const stamp = Date.now().toString(36);
  const today = new Date().toISOString().slice(0, 10);
  const me = await (await page.request.get('/api/v1/auth/me').then((r) => r.ok() ? r : page.request.get('/api/v1/me'))).json();
  const c = await (await page.request.post('/api/v1/contacts', { data: { name: `Cliente Pontos ${stamp}`, segment: 'empresarial', phone: '79999990003' } })).json();
  const plan = (await (await page.request.get('/api/v1/meta/lookups')).json()).plans[0];
  const won = (await (await page.request.post('/api/v1/opportunities', { data: { contactId: c.id, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false } })).json()).id;
  const rv = (await (await page.request.get(`/api/v1/opportunities/${won}`)).json()).rowVersion;
  expect((await page.request.post(`/api/v1/opportunities/${won}/transition`, { data: { toStage: 'ganha', confirm: true, rowVersion: rv } })).status()).toBe(200);
  const cr = await page.request.post('/api/v1/contracts', { data: { opportunityId: won, billingType: 'recorrente', commercialOwnerId: me.user.id, version: { number: `PTS-${stamp}`, object: 'Conectividade fictícia em vários pontos', signedAt: today, startAt: today, termMonths: 12, monthlyCents: 100_000, items: [{ planId: null, description: 'Link', qty: 1, unitCents: 100_000 }] } } });
  expect(cr.status(), await cr.text()).toBe(201);
  const id = (await cr.json()).id;

  await page.goto(`/contracts/${id}`);
  await page.getByRole('button', { name: 'Editar' }).click();
  const drawer = page.getByRole('dialog', { name: /Editar contrato/ });
  const box = drawer.getByRole('region', { name: 'Endereços de entrega' });
  // colar do Excel (com títulos em outra ordem e uma coluna extra)
  await box.getByRole('button', { name: 'Colar do Excel' }).click();
  await page.getByLabel('Endereços colados').fill('Endereço\tBanda/Serviço\tSeq\tContato local\nRua Fictícia A, 10 - Centro\t100 Mbps\t1\tPortaria\nAv. Fictícia B, 200\tLink dedicado 50 Mbps\t2\t');
  await page.getByRole('button', { name: 'Incluir endereços' }).click();
  await expect(box).toContainText('2 endereço(s) incluído(s)');
  await expect(box.getByLabel('Endereço da linha 2', { exact: true })).toHaveValue('Av. Fictícia B, 200');
  await expect(box.getByLabel('Nome da coluna 1', { exact: true })).toHaveValue('Contato local');
  // importar planilha CSV (continua a numeração)
  await box.getByLabel('Importar planilha de endereços de entrega').setInputFiles({ name: 'pontos.csv', mimeType: 'text/csv', buffer: Buffer.from('Endereço;Banda/Serviço\nRua Fictícia C, 5;200 Mbps\n') });
  await expect(box.getByLabel('Sequência da linha 3', { exact: true })).toHaveValue('3');
  // nova coluna criada à mão
  await box.getByRole('button', { name: 'Nova coluna' }).click();
  await box.getByLabel('Nome da coluna 2', { exact: true }).fill('Prazo de ativação');
  await box.getByLabel('Prazo de ativação da linha 3', { exact: true }).fill('30 dias');
  if (SHOTS) await box.screenshot({ path: `${SHOTS}/enderecos-editor.png` });
  await drawer.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText(/Salvo/)).toBeVisible();
  const list = page.getByRole('table', { name: 'Endereços de entrega do contrato' });
  await expect(list.getByRole('row')).toHaveCount(4);
  await expect(list).toContainText('Prazo de ativação');
  await expect(list).toContainText('30 dias');
  await expect(list).toContainText('Portaria');
  if (SHOTS) await list.screenshot({ path: `${SHOTS}/enderecos-ficha.png` });
});
