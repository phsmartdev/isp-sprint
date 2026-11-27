import { expect, test, type Page } from '@playwright/test';

/** Contas: editar e excluir a conta; contato do stakeholder corrigido no painel; limpar filtros. Dados fictícios. */
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('editar conta, corrigir contato do stakeholder e excluir conta sem vínculos', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'lucas@yepnet.test');
  const stamp = Date.now().toString(36);
  const acc = await (await page.request.post('/api/v1/contacts', { data: { name: `Órgão Editável ${stamp}`, phone: '79 98888-4444', segment: 'empresarial' } })).json();
  await page.request.post(`/api/v1/accounts/${acc.id}/stakeholders`, { data: { person: { name: `Pessoa Sem Contato ${stamp}` }, title: 'Diretora' } });

  await page.goto(`/customers/${acc.id}`);
  await page.getByRole('button', { name: 'Editar conta' }).click();
  const dr = page.getByRole('dialog', { name: 'Editar conta' });
  await dr.getByLabel('Segmento').selectOption('governamental');
  await dr.getByLabel('Natureza').selectOption('publica');
  await dr.getByLabel('E-mail').fill(`orgao.${stamp}@exemplo.test`);
  await dr.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Conta atualizada')).toBeVisible();
  await expect(page.getByText(`orgao.${stamp}@exemplo.test`).first()).toBeVisible();

  await page.goto(`/customers/${acc.id}?t=stakeholders`);
  await page.getByRole('button', { name: `Pessoa Sem Contato ${stamp}` }).click();
  const st = page.getByRole('dialog', { name: 'Stakeholder' });
  await expect(st.getByText('Sem e-mail nem telefone')).toBeVisible();
  await st.getByRole('button', { name: 'Editar contato' }).click();
  await st.getByLabel('E-mail').fill(`pessoa.${stamp}@exemplo.test`);
  await st.getByLabel('Telefone').fill('79 97777-0000');
  await st.getByRole('button', { name: 'Salvar contato' }).click();
  await expect(page.getByText('Contato atualizado')).toBeVisible();
  await expect(st).toContainText(`pessoa.${stamp}@exemplo.test`);

  const other = await (await page.request.post('/api/v1/contacts', { data: { name: `Conta Excluível ${stamp}`, phone: '79 98888-5555', segment: 'residencial' } })).json();
  await page.goto(`/customers/${other.id}`);
  await page.getByRole('button', { name: 'Editar conta' }).click();
  const d2 = page.getByRole('dialog', { name: 'Editar conta' });
  await d2.getByRole('button', { name: 'Excluir conta' }).click();
  await d2.getByRole('button', { name: 'Excluir conta' }).click();
  await expect(page).toHaveURL(/\/customers$/);

  await page.getByRole('combobox', { name: 'Segmento' }).selectOption('governamental');
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByRole('button', { name: 'Limpar filtros' })).toHaveCount(0);
});
