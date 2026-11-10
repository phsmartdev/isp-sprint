import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

/** Modelo de e-mail genérico: cabeçalho e rodapé em imagem, assunto = nome com variáveis do contrato, só o corpo para digitar. */
const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('Novo modelo de e-mail: imagens, área da mensagem e assunto com variáveis', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/modelos?aba=emails');
  await page.getByRole('link', { name: 'Abrir modelos de e-mail' }).click();
  await page.getByRole('button', { name: 'Novo modelo de e-mail' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByLabel('Nome do modelo (é o assunto do e-mail)')).toHaveValue('Contrato {{contrato}} · {{cliente}}');
  await expect(dlg.getByLabel('Assunto', { exact: true })).toHaveCount(0);
  await dlg.getByLabel('Arquivo da imagem de cabeçalho').setInputFiles(path.join(__dirname, 'fixtures/email-cabecalho.png'));
  await expect(dlg.getByRole('img', { name: 'Imagem de cabeçalho' })).toBeVisible();
  await dlg.getByLabel('Arquivo da imagem de rodapé').setInputFiles(path.join(__dirname, 'fixtures/email-rodape.png'));
  await expect(dlg.getByRole('img', { name: 'Imagem de rodapé' })).toBeVisible();
  const msg = dlg.getByLabel('Mensagem do e-mail');
  await msg.fill('Prezado(a) ');
  await dlg.getByRole('button', { name: 'Nome de quem recebe' }).click();
  await expect(msg).toHaveValue('Prezado(a) {{destinatario}}');
  await msg.press('End');
  await msg.type(',\n\nSeu contrato vence em breve. Estamos à disposição.');
  await dlg.getByLabel('Altura da área da mensagem').fill('400');
  await expect(msg).toHaveCSS('height', '400px');
  await expect(dlg.getByText('Assunto: Contrato 045/2026 · Cliente Exemplo Ltda')).toBeVisible();
  const frame = dlg.frameLocator('iframe[title="Pré-visualização do e-mail"]');
  await expect(frame.getByText('Prezado(a) Destinatário,')).toBeVisible();
  await expect(frame.locator('img')).toHaveCount(2);
  if (SHOTS) await dlg.screenshot({ path: `${SHOTS}/email-modelo.png` });
  await dlg.getByRole('button', { name: 'Publicar versão' }).click();
  await expect(page.getByText('Publicado (versão 1)')).toBeVisible();
  await dlg.getByRole('button', { name: 'Fechar', exact: true }).last().click();
  await expect(page.getByRole('row', { name: /Contrato \{\{contrato\}\} · \{\{cliente\}\}.*Modelo com imagens/ })).toBeVisible();
});
