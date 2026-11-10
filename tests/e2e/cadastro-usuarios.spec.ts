import { expect, test } from '@playwright/test';

/** Cadastro de usuários: 5 perfis, setores editáveis (criar, renomear, excluir), marcação de CSM e exclusão de time. */
test('perfis, setores, CSM e times no cadastro de usuários', async ({ page }) => {
  test.setTimeout(120_000);
  const st = Date.now().toString(36);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  await page.goto('/settings/users');
  await page.getByRole('button', { name: 'Novo usuário' }).click();
  const dr = page.getByRole('dialog', { name: 'Novo usuário' });
  await expect(dr.getByLabel('Perfil de acesso').locator('option')).toHaveText(['Administrador', 'Diretoria', 'Gerência', 'Supervisão', 'Operação']);

  // setores: criar, renomear e marcar
  await dr.getByRole('button', { name: 'Editar setores' }).click();
  const sm = page.getByRole('dialog', { name: 'Setores da Gestão de Contratos' });
  await sm.getByLabel('Novo setor').fill(`Compras ${st}`);
  await sm.getByRole('button', { name: 'Criar' }).click();
  await expect(sm.getByText(`Compras ${st}`)).toBeVisible();
  await expect(sm.getByRole('listitem').filter({ hasText: 'Financeiro' }).getByRole('button', { name: 'Excluir' })).toBeDisabled();
  await sm.getByRole('listitem').filter({ hasText: `Compras ${st}` }).getByRole('button', { name: 'Editar' }).click();
  await sm.getByLabel(`Novo nome do setor Compras ${st}`).fill(`Suprimentos ${st}`);
  await sm.getByRole('button', { name: 'Salvar' }).click();
  await expect(sm.getByText(`Suprimentos ${st}`)).toBeVisible();
  await expect(page.getByText('Confira os dados informados.')).toHaveCount(0);
  await sm.getByRole('button', { name: 'Fechar' }).last().click();

  await dr.getByLabel('Nome').fill(`Pessoa CSM ${st}`);
  await dr.getByLabel('E-mail').fill(`csm-${st}@yepnet.test`);
  await dr.getByLabel('Perfil de acesso').selectOption({ label: 'Operação' });
  await dr.getByLabel(`Suprimentos ${st}`).check();
  await dr.getByLabel(/É CSM/).check();
  await page.screenshot({ path: 'test-results/cadastro-usuario.png', fullPage: true });
  await page.getByRole('button', { name: /^(Salvar|Criar usuário|Cadastrar)/ }).last().click();
  await expect(page.getByRole('row', { name: new RegExp(`Pessoa CSM ${st}`) })).toContainText(`Suprimentos ${st}`);
  await expect(page.getByRole('row', { name: new RegExp(`Pessoa CSM ${st}`) })).toContainText('CSM');

  // excluir time
  const r = await page.request.post('/api/v1/admin/teams', { data: { name: `Time E2E ${st}` } });
  expect(r.status()).toBe(201);
  await page.reload();
  const row = page.getByRole('listitem').filter({ hasText: `Time E2E ${st}` });
  await row.getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('dialog', { name: `Excluir o time Time E2E ${st}?` }).getByRole('button', { name: 'Excluir time' }).click();
  await expect(page.getByText('Time excluído')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: `Time E2E ${st}` })).toHaveCount(0);
});
