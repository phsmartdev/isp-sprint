import { expect, test } from '@playwright/test';

/** Configurações → Modelos → E-mails: editar o modelo do convite de usuário com pré-visualização. Dados fictícios. */
test('edita o modelo do convite de usuário com pré-visualização', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  await page.goto('/settings/modelos?aba=emails');
  const sec = page.getByRole('region', { name: 'Modelos de e-mail do sistema' });
  await sec.getByRole('listitem').filter({ hasText: 'Convite de usuário' }).getByRole('button', { name: 'Editar' }).click();
  const dr = page.getByRole('dialog', { name: 'Modelo: Convite de usuário' });
  const frame = dr.frameLocator('iframe[title="Pré-visualização do e-mail"]');
  await expect(frame.getByText('Exemplo-1234')).toBeVisible();
  await expect(frame.getByText('Seu acesso ao RevOps está pronto')).toBeVisible();
  await dr.getByLabel('Texto do e-mail').fill('Olá, ');
  await dr.getByRole('button', { name: '{{usuario.nome}}' }).click();
  await dr.getByLabel('Texto do e-mail').press('End');
  await dr.getByLabel('Texto do e-mail').pressSequentially('! Texto fictício de boas-vindas.');
  await expect(frame.getByText('Olá, Maria Exemplo! Texto fictício de boas-vindas.')).toBeVisible();
  await dr.getByRole('button', { name: 'Voltar ao texto padrão' }).click();
  await expect(frame.getByText(/Você foi cadastrado no RevOps/)).toBeVisible();
  await page.setViewportSize({ width: 1400, height: 1100 });
  await dr.locator('iframe').screenshot({ path: 'test-results/email-convite-preview.png' });
});
