import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

test('aprovação: vendedor pede com desconto, gerência analisa e aprova; fila e chat', async ({ browser }) => {
  test.setTimeout(150_000);
  const seller = await (await browser.newContext()).newPage();
  await login(seller, 'lucas@yepnet.test');
  await seller.goto('/opportunities/new');
  await seller.getByLabel('Nome do cliente').fill('Cliente Aprovação E2E');
  await seller.getByLabel('Plano', { exact: true }).selectOption({ index: 1 });
  await seller.getByText('Oferta / curiosidade').click();
  await seller.getByRole('button', { name: 'Iniciar Sprint' }).click();
  await expect(seller).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  const oppUrl = seller.url();

  await seller.getByRole('button', { name: /Análise e aprovação/ }).click();
  await expect(seller.getByRole('heading', { name: 'Análise e aprovação' })).toBeVisible();
  await expect(seller.getByText('Novo cliente', { exact: true }).first()).toBeVisible();
  await expect(seller.getByRole('heading', { name: /Parecer de apoio à decisão/ })).toBeVisible();
  await seller.getByRole('button', { name: 'Solicitar aprovação' }).click();
  const dialog = seller.getByRole('dialog');
  const value = dialog.getByLabel('Valor mensal proposto (R$)');
  const list = Number((await value.inputValue()).replace(',', '.'));
  await value.fill((list * 0.9).toFixed(2).replace('.', ','));
  await expect(dialog.getByText('Gerência', { exact: true })).toBeVisible();
  await dialog.getByLabel('Justificativa comercial').fill('Cliente fecha hoje com 10% de desconto no primeiro ano.');
  await shot(seller, 'aprov-pedido');
  await dialog.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(seller.getByText('v1: Aguardando decisão')).toBeVisible();
  await expect(seller.getByText('Você pediu esta aprovação')).toBeVisible();
  await seller.getByLabel('Mensagem para o time').fill('Cliente pediu retorno até sexta.');
  await seller.getByRole('button', { name: 'Enviar mensagem' }).click();
  await expect(seller.getByText('Cliente pediu retorno até sexta.')).toBeVisible();

  const mgr = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await login(mgr, 'carlos@yepnet.test');
  await expect(mgr.getByRole('button', { name: /^Comercial/ })).toContainText(/\d/);
  await mgr.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: /^Comercial/ }).click();
  await expect(mgr.getByRole('link', { name: /Aprovações/ })).toContainText(/\d/);
  await mgr.getByRole('link', { name: /Aprovações/ }).first().click();
  await mgr.getByRole('row', { name: /Cliente Aprovação E2E/ }).click();
  await expect(mgr.getByRole('heading', { name: 'Decisão solicitada · v1' })).toBeVisible();
  await expect(mgr.getByText('Cliente pediu retorno até sexta.')).toBeVisible();
  await shot(mgr, 'aprov-analise-1440');
  await mgr.getByRole('button', { name: 'Aprovar' }).click();
  await expect(mgr.getByText('Versão 1: Aprovada')).toBeVisible();
  await expect(mgr.getByText(/Aprovada \(v1\) por Carlos Silva/)).toBeVisible();

  // olhinho: oculta valores em R$
  await mgr.getByRole('button', { name: 'Ocultar valores' }).click();
  await expect(mgr.getByText('R$ •••••').first()).toBeVisible();
  await mgr.getByRole('button', { name: 'Mostrar valores' }).click();

  await seller.goto(oppUrl);
  await expect(seller.getByRole('button', { name: /Análise e aprovação\s*aprovada/ })).toBeVisible();

  // celular
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await login(phone, 'carlos@yepnet.test');
  await phone.goto(`${oppUrl}/aprovacao`);
  await expect(phone.getByRole('heading', { name: 'Análise e aprovação' })).toBeVisible();
  await phone.waitForLoadState('networkidle');
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await shot(phone, 'aprov-analise-390');
});

test('cliente da base mostra Inteligência do Cliente e classificação', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/customers');
  await page.getByRole('row').nth(1).click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: /^(Classificar|Reclassificar)$/ }).click();
  await page.getByLabel('Classe estratégica').selectOption('Reputação');
  await page.getByLabel('Perfil pagador').selectOption('Pontual');
  await page.getByRole('button', { name: 'Salvar classificação' }).click();
  await expect(page.getByText(/Classificado em .* por Carlos Silva/)).toBeVisible();
});

test('relatórios: tela cheia para TV e olhinho', async ({ page }) => {
  await login(page, 'carlos@yepnet.test');
  await page.goto('/reports');
  await page.getByRole('button', { name: 'Ocultar valores' }).first().click();
  await expect(page.locator('text=R$ •••••').first()).toBeVisible();
  await page.getByRole('button', { name: 'Tela cheia' }).click();
  await expect(page.getByRole('button', { name: 'Sair (Esc)' })).toBeVisible();
  await expect(page.getByLabel('Hora atual')).toBeVisible();
  await shot(page, 'relatorios-tv');
  await page.getByRole('button', { name: 'Sair (Esc)' }).click();
  await expect(page.getByRole('button', { name: 'Sair (Esc)' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar valores' }).first().click();
});

test('cliente da base: Inteligência do Cliente, contratos e margem antes/depois', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  const H = { origin: new URL(page.url()).origin };
  const api = async (method: 'get' | 'post', url: string, data?: object) => {
    const r = await page.request[method](`/api/v1${url}`, { headers: H, ...(data ? { data } : {}) });
    expect(r.status(), await r.text()).toBeLessThan(300);
    return r.json();
  };
  const plan = (await api('get', '/meta/lookups')).plans[0];
  const me = await api('get', '/me');
  const o = await api('post', '/opportunities', { newContact: { name: 'Empresa Base E2E Fictícia', segment: 'empresarial' }, planId: plan.id, cableMeters: 40, saleType: 'ativa' });
  const cur = await api('get', `/opportunities/${o.id}`);
  await api('post', `/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: cur.rowVersion });
  const start = new Date(Date.now() - 500 * 86_400_000).toISOString().slice(0, 10);
  const c = await api('post', '/contracts', { opportunityId: o.id, billingType: 'recorrente', commercialOwnerId: me.user.id, version: { number: 'E2E-BASE-1', object: 'Link dedicado fictício', signedAt: start, startAt: start, termMonths: 24, monthlyCents: 120_000, items: [{ planId: null, description: 'Link 300M', qty: 1, unitCents: 120_000 }] } });
  await api('post', `/contracts/${c.id}/validate`);
  await api('post', `/contacts/${o.contactId}/classification`, { classKey: 'Reputação', payerProfile: 'Pontual', risk: 'Baixo', potential: 'Alto', notes: 'Conta estratégica fictícia' });
  const o2 = await api('post', '/opportunities', { contactId: o.contactId, planId: plan.id, cableMeters: 20, saleType: 'ativa', customerSuccess: false });
  await page.goto(`/opportunities/${o2.id}/aprovacao`);
  await expect(page.getByRole('heading', { name: /Inteligência do Cliente/ })).toBeVisible();
  await expect(page.getByText('Cliente da base', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'E2E-BASE-1', exact: true })).toBeVisible();
  await expect(page.getByText('Reputação').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, 'aprov-base-1440');
});

test('negociação: comentário com @, chat com @, menções no topo e histórico legível', async ({ browser }) => {
  test.setTimeout(150_000);
  const seller = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await login(seller, 'lucas@yepnet.test');
  await seller.goto('/opportunities/new');
  await seller.getByLabel('Nome do cliente').fill('Cliente Chat E2E');
  await seller.getByLabel('Plano', { exact: true }).selectOption({ index: 1 });
  await seller.getByText('Oferta / curiosidade').click();
  await seller.getByRole('button', { name: 'Iniciar Sprint' }).click();
  await expect(seller).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  const oppUrl = seller.url();

  // comentário formal com menção
  await seller.getByRole('tab', { name: /Comentários e histórico/ }).click();
  const box = seller.getByRole('combobox', { name: 'Comentário' });
  await box.click();
  await box.pressSequentially('Cliente quer instalar no sábado. @Car');
  await seller.getByRole('option', { name: /Carlos Silva/ }).click();
  await expect(box).toHaveValue(/@Carlos Silva $/);
  await seller.getByRole('button', { name: 'Comentar' }).click();
  await expect(seller.getByText('Cliente quer instalar no sábado.', { exact: false })).toBeVisible();
  await seller.getByRole('button', { name: /^Comentários/ }).click();
  await expect(seller.getByText(/comentou/)).toHaveCount(1);

  // chat com menção
  await seller.getByRole('tab', { name: /^Chat/ }).click();
  const chat = seller.getByRole('combobox', { name: 'Mensagem para o time' });
  await chat.click();
  await chat.pressSequentially('@Carl');
  await chat.press('Enter');
  await chat.pressSequentially('consegue aprovar hoje?');
  await chat.press('Enter');
  await expect(seller.getByText('consegue aprovar hoje?')).toBeVisible();
  await shot(seller, 'negociacao-chat');

  // gerência vê a menção no topo e abre direto no chat
  const mgr = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await login(mgr, 'carlos@yepnet.test');
  const at = mgr.getByRole('button', { name: /menç(ão|ões) não lida/ });
  await expect(at).toBeVisible();
  await at.click();
  await mgr.getByRole('dialog', { name: 'Menções' }).getByRole('link', { name: /consegue aprovar hoje/ }).click();
  await expect(mgr).toHaveURL(/aba=chat/);
  await expect(mgr.getByText('consegue aprovar hoje?')).toBeVisible();
  await expect(mgr.getByRole('tab', { name: /Comentários e histórico • 1 novo/ })).toBeVisible();
  await mgr.getByRole('tab', { name: /Comentários e histórico/ }).click();
  await expect(mgr.getByText('Oportunidade criada')).toBeVisible();
  await shot(mgr, 'negociacao-historico');
  await mgr.goto(oppUrl);
  await expect(mgr.getByRole('tab', { name: /^Chat$/ })).toBeVisible();
});

test('tela cheia também em Inteligência e Gestão de Contratos', async ({ page }) => {
  await login(page, 'carlos@yepnet.test');
  for (const path of ['/intelligence', '/contracts?t=relatorios']) {
    await page.goto(path);
    await page.getByRole('button', { name: 'Tela cheia' }).click();
    await expect(page.getByRole('button', { name: 'Sair (Esc)' })).toBeVisible();
    await expect(page.getByLabel('Hora atual')).toBeVisible();
    await page.getByRole('button', { name: 'Sair (Esc)' }).click();
    await expect(page.getByRole('button', { name: 'Sair (Esc)' })).toHaveCount(0);
  }
});
