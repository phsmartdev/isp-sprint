import { expect, test, type Page } from '@playwright/test';

/** Funcionalidade 03 — E-mail corporativo contra o Google SIMULADO (porta 3399, só em teste). */
const FAKE = 'http://127.0.0.1:3399';
const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

test('E-mail corporativo: configura domínio, caixa e fila; conecta pelo Google; responde e a conversa muda de situação', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const stamp = Date.now().toString(36);
  const box = `comercial-${stamp}@yepnet.test`;

  await page.goto('/settings/gmail');
  await expect(page.getByRole('region', { name: 'Integração com o Google' }).getByText('Google simulado (teste)')).toBeVisible();
  await page.getByLabel('Domínios da empresa').fill('yepnet.test');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Configuração salva')).toBeVisible();
  await page.getByLabel('Endereço', { exact: true }).fill(box);
  await page.getByLabel('Nome exibido').fill('Comercial Yepnet');
  await page.getByRole('button', { name: 'Cadastrar caixa' }).click();
  await expect(page.getByText('Caixa cadastrada. Agora conecte com o Google.')).toBeVisible();
  await page.getByRole('button', { name: 'Nova fila' }).click();
  const qd = page.getByRole('dialog', { name: 'Nova fila' });
  await qd.getByLabel('Nome da fila').fill(`Comercial ${stamp}`);
  await qd.getByLabel('Caixa').selectOption({ label: 'Comercial Yepnet' });
  await qd.getByLabel('Prazo de 1ª resposta (horas)').fill('4');
  await qd.getByLabel('Carlos Silva').check();
  await qd.getByRole('button', { name: 'Criar fila' }).click();
  await expect(page.getByText('Fila criada')).toBeVisible();

  // chega um e-mail na caixa (no Google simulado) antes da conexão
  await page.request.post(`${FAKE}/__test/deliver`, { data: { to: box, from: 'Compras <compras@prefeitura-ficticia.test>', subject: `Cotação ${stamp}`, text: 'Precisamos de 300 Mbps na sede.' } });

  await page.goto('/email/caixas');
  await page.getByRole('article', { name: `Caixa ${box}` }).getByRole('button', { name: 'Conectar com o Google' }).click();
  await expect(page.getByText('Caixa conectada. As mensagens dos últimos dias já foram trazidas.')).toBeVisible();
  await expect(page.getByRole('article', { name: `Caixa ${box}` }).getByText('Conectada', { exact: true })).toBeVisible();
  await shot(page, 'email-caixas');

  await page.goto('/email?view=minhas');
  await page.getByRole('button', { name: new RegExp(`Cotação ${stamp}`) }).click();
  const conv = page.getByRole('region', { name: 'Conversa', exact: true });
  await expect(conv.getByRole('heading', { name: `Cotação ${stamp}` })).toBeVisible();
  await expect(conv.getByText(/No prazo · até/)).toBeVisible();
  await expect(conv.getByText('Precisamos de 300 Mbps na sede.')).toBeVisible();
  await conv.getByLabel('Resposta').fill('Olá! Enviamos a proposta hoje à tarde.');
  await conv.getByRole('button', { name: 'Responder', exact: true }).click();
  await expect(page.getByText('Resposta enviada', { exact: true })).toBeVisible();
  await expect(conv.getByText('Aguardando cliente').first()).toBeVisible();
  await expect(conv.getByText('Respondida no prazo')).toBeVisible();
  await expect(conv.getByText('Olá! Enviamos a proposta hoje à tarde.')).toBeVisible();
  const sent = await (await page.request.get(`${FAKE}/__test/sent`)).json();
  expect(sent.sent.some((x: { from: string; parsed: { text: string } }) => x.from === box && x.parsed.text.includes('Enviamos a proposta'))).toBe(true);
  await shot(page, 'email-conversa');

  // e-mail vira negociação: anexo do e-mail e resposta pela mesma conversa
  await conv.getByRole('button', { name: 'Transformar em negociação' }).click();
  const td = page.getByRole('dialog', { name: 'Transformar e-mail em negociação' });
  await td.getByLabel('Nova conta').check();
  await td.getByLabel('Nome do cliente').fill(`Prefeitura Fictícia ${stamp}`);
  await td.getByLabel('Tipo de venda').selectOption({ label: 'Venda Consultiva' });
  await td.getByRole('button', { name: 'Criar negociação' }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  await page.getByRole('tab', { name: /^Anexos/ }).click();
  await expect(page.getByText(`E-mail de origem - Cotação ${stamp}.eml`)).toBeVisible();
  // cópia do original: abre na negociação, com o anexo de dentro do e-mail
  await page.getByRole('button', { name: 'Ver e-mail', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: `Cotação ${stamp}` });
  await expect(viewer.frameLocator('iframe[title="Conteúdo do e-mail"]').getByText('Precisamos de 300 Mbps na sede.')).toBeVisible();
  await expect(viewer.getByRole('link', { name: /pedido\.txt/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'E-mail' }).click();
  const origin = page.getByRole('region', { name: 'E-mail de origem' });
  await expect(origin.getByText('Precisamos de 300 Mbps na sede.')).toBeVisible();
  await origin.getByLabel('Resposta ao e-mail de origem').fill('Segue a proposta em anexo no portal.');
  await origin.getByRole('button', { name: 'Responder e-mail' }).click();
  await expect(page.getByText('Resposta enviada pelo e-mail de origem')).toBeVisible();
  const sent2 = await (await page.request.get(`${FAKE}/__test/sent`)).json();
  expect(sent2.sent.some((x: { from: string; parsed: { text: string } }) => x.from === box && x.parsed.text.includes('Segue a proposta em anexo no portal'))).toBe(true);
  await page.goBack(); await page.goBack();

  // celular: lista e conversa uma de cada vez, sem rolagem horizontal
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/email?view=todas&status=todas');
  await page.getByRole('button', { name: new RegExp(`Cotação ${stamp}`) }).click();
  await expect(page.getByRole('button', { name: 'Conversas' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('E-mail: vendedor fora da fila não vê a caixa compartilhada nem a configuração', async ({ page }) => {
  await login(page, 'rafael@yepnet.test');
  await page.goto('/email?view=todas&status=todas');
  await expect(page.getByRole('heading', { name: 'E-mail', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Cotação / })).toHaveCount(0);
  const r = await page.request.get('/api/v1/mail/rules');
  expect(r.status()).toBe(403);
});

test('Gmail pessoal: pelo perfil, conecta o Gmail particular e só a pessoa vê a caixa', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await page.goto('/settings/profile');
  await page.getByRole('region', { name: 'Meu Gmail' }).getByRole('link', { name: 'Conectar meu Gmail' }).click();
  await expect(page).toHaveURL(/\/email\/caixas/);
  const addr = `lucas.${Date.now().toString(36)}@gmail.test`;
  await page.getByLabel('Endereço do Gmail particular').fill(addr);
  await page.getByRole('button', { name: 'Conectar Gmail particular' }).click();
  await expect(page.getByText('Caixa conectada. As mensagens dos últimos dias já foram trazidas.')).toBeVisible();
  const card = page.getByRole('article', { name: `Caixa ${addr}` });
  await expect(card.getByRole('heading', { name: 'Meu Gmail particular' })).toBeVisible();
  await expect(card.getByText('Conectada', { exact: true })).toBeVisible();
});
