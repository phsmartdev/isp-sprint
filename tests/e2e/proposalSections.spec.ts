import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

/** Proposta com seções automáticas: serviços (texto + fotos), composição do investimento (aba Produto) e condição. */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const fx = (f: string) => `tests/e2e/fixtures/${f}`;

test('modelo com seções automáticas: configurar, preencher serviços com fotos, prévia e gerar', async ({ page }) => {
  test.setTimeout(150_000);
  const st = Date.now().toString(36);
  await login(page, 'carlos@yepnet.test');
  const bg = `data:image/png;base64,${readFileSync(fx('fundo-proposta.png')).toString('base64')}`;
  const t = await (await page.request.post('/api/v1/admin/proposal-templates', { data: { name: `Seções ${st}`, segments: [], variables: [], fields: [] } })).json();
  for (let i = 0; i < 3; i++) expect((await page.request.post(`/api/v1/admin/proposal-templates/${t.id}/pages`, { data: { data: bg } })).status()).toBe(201);

  // configurar pela tela
  await page.goto('/settings/modelos?aba=propostas');
  await page.getByRole('listitem').filter({ hasText: `Seções ${st}` }).getByRole('button', { name: 'Editar' }).click();
  const ed = page.getByRole('dialog', { name: `Modelo: Seções ${st}` });
  await ed.getByLabel(/Gerar páginas com Serviços propostos/).check();
  await ed.getByLabel('Página de fundo das seções').selectOption({ label: 'Página 2' });
  await ed.getByLabel('Prazo da proposta (dias)').fill('20');
  await ed.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Modelo salvo').last()).toBeVisible();

  const plan = (await (await page.request.get('/api/v1/meta/lookups')).json()).plans[0];
  const o = await (await page.request.post('/api/v1/opportunities', { data: { newContact: { name: `Empresa Seções ${st}`, segment: 'empresarial' }, planId: plan.id } })).json();
  const cur = await (await page.request.get(`/api/v1/opportunities/${o.id}/items`)).json();
  expect((await page.request.put(`/api/v1/opportunities/${o.id}/items`, { data: { rowVersion: cur.rowVersion, items: [{ description: 'Fusão óptica', unit: 'un', qtyMilli: 12_000, unitCents: 7_000, discountCents: 0, surchargeCents: 0 }, { description: 'Equipe instalador + auxiliar', unit: 'h', qtyMilli: 4_000, unitCents: 9_690, discountCents: 0, surchargeCents: 0 }] } })).ok()).toBe(true);

  await page.goto(`/opportunities/${o.id}`);
  await page.getByRole('button', { name: 'Gerar proposta' }).click();
  const dlg = page.getByRole('dialog', { name: 'Gerar proposta' });
  const tplSel = dlg.getByLabel('Modelo');
  if (await tplSel.count()) await tplSel.selectOption({ label: `Seções ${st}` });
  await dlg.getByLabel('SERVIÇOS PROPOSTOS').fill('Recuperação da rede óptica com substituição do trecho rompido.');
  await dlg.getByLabel('Fotos dos serviços').setInputFiles([fx('foto-servico-1.jpg'), fx('foto-servico-2.jpg')]);
  await expect(dlg.getByRole('list', { name: 'Fotos da proposta' }).getByRole('listitem')).toHaveCount(2);
  await expect(dlg).toContainText('2 item(ns) da aba Produto · R$ 1.227,60');
  await expect(dlg.getByLabel(/prazo \(dias\)/)).toHaveValue('20');
  await page.screenshot({ path: 'test-results/proposta-secoes-gerador.png', fullPage: true });

  // a prévia é o mesmo PDF que será anexado
  const body = { templateId: t.id, values: {}, services: { text: 'x', photos: [{ data: readFileSync(fx('foto-servico-1.jpg')).toString('base64'), mime: 'image/jpeg' }] }, validityDays: 20 };
  const prev = await page.request.post(`/api/v1/opportunities/${o.id}/proposal/preview`, { data: body });
  expect(prev.status()).toBe(200);
  expect((await PDFDocument.load(await prev.body())).getPageCount()).toBe(3);

  await dlg.getByRole('button', { name: 'Gerar PDF e anexar' }).click();
  await expect(page.getByText(/Proposta gerada e anexada: PC \d{6}/).last()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // editar ali mesmo, pela aba Anexos: volta com o que foi preenchido
  await page.getByRole('tab', { name: 'Anexos' }).click();
  await page.getByRole('button', { name: 'Editar proposta' }).first().click();
  const ed2 = page.getByRole('dialog', { name: 'Editar proposta' });
  await expect(ed2.getByLabel('SERVIÇOS PROPOSTOS')).toHaveValue('Recuperação da rede óptica com substituição do trecho rompido.');
  await expect(ed2.getByRole('list', { name: 'Fotos da proposta' }).getByRole('listitem')).toHaveCount(2);
  await expect(ed2.getByRole('button', { name: 'Gerar nova versão e anexar' })).toBeVisible();
});
