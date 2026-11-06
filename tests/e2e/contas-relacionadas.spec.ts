import { expect, test, type Page } from '@playwright/test';

/** CRM → ficha do cliente: Stakeholders e Contas relacionadas (sugestão por pessoa em comum, registro, mapa do grupo); ABM → Relações. */
const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('contas relacionadas e stakeholders na ficha do CRM', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, 'lucas@yepnet.test');
  const stamp = Date.now().toString(36);
  const mk = async (name: string) => {
    let r = await page.request.post('/api/v1/abm/new-account', { data: { name, segment: 'governamental', reason: 'Teste de relações' } });
    if (r.status() === 422) { const j = await r.json(); r = await page.request.post('/api/v1/abm/new-account', { data: { name, segment: 'governamental', reason: 'Teste de relações', ignoreDuplicates: { ids: (j.duplicates ?? []).map((d: { id: string }) => d.id), justification: 'Outra organização do mesmo grupo' } } }); }
    expect(r.status(), await r.text()).toBe(201);
    return r.json();
  };
  const pref = await mk(`Prefeitura Mapa ${stamp}`);
  const sme = await mk(`Secretaria Mapa ${stamp}`);
  const cons = await mk(`Consórcio Mapa ${stamp}`);
  const p = await (await page.request.post(`/api/v1/accounts/${sme.contactId}/stakeholders`, { data: { person: { name: 'Pessoa em Comum Fictícia', email: `comum.${stamp}@exemplo.test` }, title: 'Secretária' } })).json();
  await page.request.post(`/api/v1/accounts/${cons.contactId}/stakeholders`, { data: { personId: p.personId, title: 'Conselheira' } });

  await page.goto(`/customers/${sme.contactId}?t=relacoes`);
  const panel = page.getByRole('region', { name: 'Contas relacionadas' });
  const sug = panel.getByRole('region', { name: 'Relações sugeridas' });
  await expect(sug).toContainText(`Consórcio Mapa ${stamp}`);
  await expect(sug).toContainText('Pessoas em comum: Pessoa em Comum Fictícia');
  await sug.getByRole('button', { name: 'Relacionar' }).first().click();
  let dlg = page.getByRole('dialog', { name: 'Relacionar com outra conta' });
  await dlg.getByLabel('Tipo de relação').selectOption('membro');
  await dlg.getByRole('button', { name: 'Registrar relação' }).click();
  await expect(page.getByText('Relação registrada')).toBeVisible();

  await panel.getByRole('button', { name: 'Relacionar conta' }).click();
  dlg = page.getByRole('dialog', { name: 'Relacionar com outra conta' });
  await dlg.getByLabel('Procurar a outra conta').fill(`Prefeitura Mapa ${stamp}`);
  await dlg.getByRole('button', { name: new RegExp(`Prefeitura Mapa ${stamp}`) }).click();
  await dlg.getByLabel('Tipo de relação').selectOption('orgao_superior');
  await dlg.getByText('é vinculada/subordinada a').click();
  await dlg.getByRole('button', { name: 'Registrar relação' }).click();
  await expect(panel.getByText(`Esta conta é vinculada/subordinada a Prefeitura Mapa ${stamp}`)).toBeVisible();
  const tree = panel.getByRole('tree', { name: 'Hierarquia entre as contas' });
  await expect(tree).toContainText(`Prefeitura Mapa ${stamp}`);
  await expect(tree).toContainText(`Secretaria Mapa ${stamp}`);
  await expect(panel.getByLabel('Outras relações entre as contas')).toContainText('é membro de');
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/contas-relacionadas.png` });

  await page.getByRole('tab', { name: 'Stakeholders' }).click();
  await expect(page.getByRole('region', { name: 'Stakeholders da conta' })).toContainText('Pessoa em Comum Fictícia');

  await page.goto('/abm?tab=relacoes');
  await expect(page.getByRole('tree', { name: 'Hierarquia entre as contas' }).filter({ hasText: `Prefeitura Mapa ${stamp}` })).toBeVisible();
  void pref;
});
