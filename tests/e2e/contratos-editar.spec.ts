import { expect, test, type Page } from '@playwright/test';

/** Edição de contrato: salva de fato; mudança fora dos dados contratuais não pede motivo nem cria versão. Dados fictícios. */
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('contrato vigente: próxima ação salva direto; dados contratuais travados (só aditivo); faturamento pede motivo e vira versão', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  const list = await (await page.request.get('/api/v1/contracts?pageSize=50')).json();
  const c = list.items.find((x: { stage: string }) => x.stage === 'vigente');
  const before = (await (await page.request.get(`/api/v1/contracts/${c.id}`)).json()).currentVersion;
  await page.goto(`/contracts/${c.id}`);

  await page.getByRole('button', { name: 'Editar', exact: true }).first().click();
  let dr = page.getByRole('dialog', { name: /Editar contrato/ });
  await dr.getByLabel('Próxima ação', { exact: true }).fill('Ligar para o gestor fictício');
  await dr.getByRole('button', { name: 'Salvar' }).click();
  await expect(dr).toBeHidden();
  let after = await (await page.request.get(`/api/v1/contracts/${c.id}`)).json();
  expect(after.nextAction).toBe('Ligar para o gestor fictício');
  expect(after.currentVersion).toBe(before);

  await page.getByRole('button', { name: 'Editar', exact: true }).first().click();
  dr = page.getByRole('dialog', { name: /Editar contrato/ });
  await expect(dr.getByRole('note')).toContainText('só mudam por aditivo');
  await expect(dr.getByLabel('Prazo (meses)')).toBeDisabled();
  await expect(dr.getByLabel('Objeto')).toBeDisabled();
  await dr.getByLabel('Início do faturamento').fill('2026-12-01');
  await dr.getByRole('button', { name: 'Salvar' }).click();
  await expect(dr.getByRole('alert')).toContainText('Informe o motivo da alteração');
  await dr.getByLabel('Motivo da alteração').fill('Prorrogação fictícia de teste');
  await dr.getByRole('button', { name: 'Salvar' }).click();
  await expect(dr).toBeHidden();
  after = await (await page.request.get(`/api/v1/contracts/${c.id}`)).json();
  expect(after.currentVersion).toBe(before + 1);

  // a API também recusa mudar dado contratual de contrato validado
  const put = await page.request.put(`/api/v1/contracts/${c.id}`, { data: { version: { termMonths: 99 }, reason: 'teste' } });
  expect(put.status()).toBe(422);
  expect((await put.json()).detail).toContain('só muda por aditivo');
});
