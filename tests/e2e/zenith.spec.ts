import { expect, test, type Page } from '@playwright/test';

/** Zenith: o contrato só salva com o cadastro Zenith completo; a aba Zenith mostra cada campo e de onde vem. */
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('cadastro Zenith obrigatório no contrato e espelho dos campos', async ({ page }) => {
  test.setTimeout(150_000);
  const st = Date.now().toString(36);
  await login(page, 'carlos@yepnet.test');
  // listas iguais às do Zenith (configuração)
  expect((await page.request.put('/api/v1/admin/contract-settings/zenith', { data: { holders: ['Empresa Detentora Fictícia'], slaTypes: ['Nenhum SLA definido', 'SLA Fictício'] } })).ok()).toBe(true);
  const c = await (await page.request.post('/api/v1/contacts', { data: { name: `Cliente Zenith ${st}`, segment: 'empresarial', phone: '79999990004' } })).json();
  const plan = (await (await page.request.get('/api/v1/meta/lookups')).json()).plans[0];
  const opp = await (await page.request.post('/api/v1/opportunities', { data: { contactId: c.id, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false } })).json();
  const rv = (await (await page.request.get(`/api/v1/opportunities/${opp.id}`)).json()).rowVersion;
  expect((await page.request.post(`/api/v1/opportunities/${opp.id}/transition`, { data: { toStage: 'ganha', confirm: true, rowVersion: rv } })).ok()).toBe(true);

  await page.goto(`/contracts/new?opportunityId=${opp.id}`);
  await expect(page.getByRole('heading', { name: 'Novo contrato' })).toBeVisible();
  await page.getByLabel('Número do contrato').fill(`ZEN-${st}`);
  await page.getByLabel('Início da vigência').fill('2026-11-01');
  await page.getByRole('button', { name: 'Cadastrar contrato' }).click();
  await expect(page.getByText(/Cadastro Zenith: falta empresa detentora do contrato/)).toBeVisible();

  const z = page.getByRole('group', { name: 'Cadastro Zenith' });
  await expect(z.getByText('Cadastro Zenith').first()).toBeVisible();
  await z.getByLabel('Empresa detentora do contrato').fill('Empresa Detentora Fictícia');
  await z.getByLabel('Alias / apelido').fill('Enlaces corporativos');
  await z.getByLabel('Tipo de SLA').selectOption('SLA Fictício');
  await z.getByLabel('Disponibilidade mensal mínima (%)').fill('99,8');
  await z.getByLabel('Perda de pacote máxima admitida (%)').fill('2');
  await z.getByRole('group', { name: 'Contrato de rede gerenciada' }).getByLabel('Não').check();
  await z.getByRole('group', { name: 'Possuirá IP público' }).getByLabel('Sim').check();
  await z.getByRole('textbox', { name: 'Internet (CDI)' }).fill('3');
  await z.getByRole('textbox', { name: 'MPLS (CDM)' }).fill('0');
  await z.getByRole('textbox', { name: 'Nome' }).first().fill('Técnico Fictício');
  await z.getByRole('textbox', { name: 'Nome' }).nth(1).fill('Administrativo Fictício');
  await z.screenshot({ path: 'test-results/zenith-form.png' });
  await page.getByRole('button', { name: 'Cadastrar contrato' }).click();
  await expect(page.getByRole('heading', { name: `Contrato ZEN-${st}` })).toBeVisible();

  await page.getByRole('tab', { name: 'Zenith' }).click();
  await expect(page.getByText('Falta para o Zenith: CNPJ, ICP (Ideal Customer Profile).')).toBeVisible();
  const row = (label: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name: label, exact: true }) });
  await expect(row('Alias / apelido')).toContainText('cadastro Zenith');
  await expect(row('Número do contrato')).toContainText(`ZEN-${st}`);
  await expect(row('ICP (Ideal Customer Profile)')).toContainText('Score IPC');
  await expect(row('Disponibilidade mensal mínima (%)')).toContainText('99.8');
  await page.screenshot({ path: 'test-results/zenith-aba.png', fullPage: true });
});
