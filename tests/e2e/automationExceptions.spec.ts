import { expect, test, type Page } from '@playwright/test';

/** Automação da jornada com exceção por tipo de venda e gatilho de retorno de chamado. */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('automação: venda fechada com exceção de consumo de contrato; retorno de chamado por origem', async ({ page }) => {
  test.setTimeout(120_000);
  const st = Date.now().toString(36);
  await login(page, 'carlos@yepnet.test');
  const j = await (await page.request.post('/api/v1/admin/journeys', { data: { name: `Exceções ${st}`, description: null, segments: [], copyFromId: null } })).json();
  await page.goto('/settings/journeys');
  await page.getByRole('listitem').filter({ hasText: `Exceções ${st}` }).getByRole('button', { name: 'Configurar' }).click();
  await page.getByRole('tab', { name: /Automações/ }).click();
  await page.getByRole('button', { name: 'Nova automação' }).click();
  const dlg = page.getByRole('dialog', { name: 'Nova automação' });
  await dlg.getByLabel('Nome').fill('Fechada → CS');
  await dlg.getByLabel('Gatilho').selectOption({ label: 'Venda fechada' });
  await dlg.getByLabel('Ação 1').selectOption({ label: 'Criar tarefa' });
  await dlg.getByLabel('Título da tarefa').fill('Boas-vindas CS');
  await dlg.getByRole('button', { name: 'Adicionar exceção' }).click();
  await dlg.getByLabel('Exceção 1: Consumo de Contrato').check();
  await page.screenshot({ path: 'test-results/automacao-excecao.png', fullPage: true });
  await dlg.getByRole('button', { name: 'Salvar automação' }).click();
  await expect(page.getByText(/1 exceção\(ões\)/)).toBeVisible();

  await page.getByRole('button', { name: 'Nova automação' }).click();
  const d2 = page.getByRole('dialog', { name: 'Nova automação' });
  await d2.getByLabel('Nome').fill('Retorno do GLPI');
  await d2.getByLabel('Gatilho').selectOption({ label: 'Retorno de chamado (GLPI, IXC ou e-mail)' });
  await d2.getByLabel('Origem do retorno').selectOption({ label: 'Chamado do GLPI' });
  await d2.getByLabel('Ação 1').selectOption({ label: 'Criar tarefa' });
  await d2.getByLabel('Título da tarefa').fill('Dar retorno ao cliente');
  await d2.getByRole('button', { name: 'Salvar automação' }).click();
  await expect(page.getByText(/Quando houver retorno: chamado do glpi/)).toBeVisible();
  const autos = (await (await page.request.get('/api/v1/admin/journeys')).json()).items.find((x: { id: string }) => x.id === j.id).automations;
  expect(autos.find((a: { nome: string }) => a.nome === 'Fechada → CS').gatilho.excecoes).toEqual([{ campo: 'tipo_venda', valores: ['consumo_contrato'], valor: null }]);
});
