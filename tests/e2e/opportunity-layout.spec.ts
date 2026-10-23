import { expect, test, type Page } from '@playwright/test';

/** Tela da oportunidade em três áreas: deal e conta à esquerda, acompanhamento no centro, viabilidade e chat à direita. */
const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

test('Oportunidade: deal e conta à esquerda, abas na nova ordem, viabilidade e chat à direita, conta completa sob demanda', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  const list = await (await page.request.get('/api/v1/opportunities?pageSize=5')).json();
  const opp = list.items.find((o: { customerId: string | null }) => o.customerId) ?? list.items[0];
  await page.goto(`/opportunities/${opp.id}`);

  const deal = page.getByRole('region', { name: 'Informações do deal' });
  await expect(deal).toContainText('Tipo de venda');
  await expect(deal.getByText('Pendências')).toBeVisible();
  await expect(deal.getByLabel('Próxima ação')).toBeVisible();
  const conta = page.getByRole('region', { name: 'Conta', exact: true });
  await expect(conta).toContainText(opp.contactName);

  const tabs = page.getByRole('tablist', { name: 'Acompanhamento' }).getByRole('tab');
  const names = (await tabs.allTextContents()).map((t) => t.replace(/\s*\(\d+\)|\s*•.*$/g, '').trim());
  expect(names).toEqual(['Histórico', 'Projetos', 'Tarefas', 'Anexos', 'Chamados']);
  await expect(page.getByRole('tab', { name: /^Histórico/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Chat da negociação' })).toBeVisible();
  // sem rolagem horizontal das abas
  const tl = page.getByRole('tablist', { name: 'Acompanhamento' });
  expect(await tl.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await shot(page, 'oportunidade-3-areas');

  await conta.getByRole('button', { name: 'Saiba mais sobre a conta' }).click();
  const drawer = page.getByRole('dialog', { name: `Conta: ${opp.contactName}` });
  await expect(drawer.getByRole('region', { name: 'Relevância da conta' })).toBeVisible();
  await expect(drawer.getByRole('region', { name: 'Oportunidades' })).toContainText(`OP-${opp.code}`);
  await expect(drawer.getByRole('region', { name: 'Contratos' })).toBeVisible();
  await shot(page, 'oportunidade-conta');
  await page.keyboard.press('Escape');

  // endereços antigos continuam funcionando
  await page.goto(`/opportunities/${opp.id}?aba=atividades`);
  await expect(page.getByRole('tab', { name: /^Tarefas/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Retornos e interações' })).toBeVisible();
  await page.goto(`/opportunities/${opp.id}?aba=pessoas`);
  await expect(page.getByRole('region', { name: 'Pessoas e ABM' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/opportunities/${opp.id}`);
  await expect(page.getByRole('tab', { name: 'Deal e conta' })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('tab', { name: /Viabilidade e chat/ }).click();
  await expect(page.getByRole('region', { name: 'Chat da negociação' })).toBeVisible();
  await shot(page, 'oportunidade-mobile');
});
