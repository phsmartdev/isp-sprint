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
