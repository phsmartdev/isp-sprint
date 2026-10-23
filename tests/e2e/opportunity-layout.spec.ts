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
  // seções com Salvar: depois de salva, leitura compacta com Editar
  await deal.getByRole('button', { name: 'Editar Dados do deal' }).click();
  await expect(deal.getByLabel('Nome do deal')).toBeVisible();
  await deal.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(deal.getByLabel('Nome do deal')).toHaveCount(0);
  await expect(deal.getByRole('button', { name: 'Editar Dados do deal' })).toBeVisible();
  // contatos da negociação: vários, sem depender do ABM
  const contatos = page.getByRole('region', { name: 'Contatos' });
  await contatos.getByRole('button', { name: 'Adicionar' }).click();
  const dlg = page.getByRole('dialog', { name: 'Adicionar contato' });
  if (await dlg.getByLabel('Outra pessoa').count()) await dlg.getByLabel('Outra pessoa').check();
  const who = `Contato E2E ${Date.now().toString(36)}`;
  await dlg.locator('#oc-name').fill(who);
  await dlg.getByLabel('Cargo').fill('Gerente de TI');
  await dlg.getByRole('button', { name: 'Adicionar contato' }).click();
  await expect(contatos).toContainText(who);
  await expect(contatos.getByLabel(`Papel de ${who}`)).toBeVisible();
  // botões: pedir aprovação antes de fechar ou perder
  const bar = page.getByRole('button', { name: /^Pedir aprovação/ });
  await expect(bar).toBeVisible();
  const order = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '').filter((t) => /^(Pedir aprovação|Venda fechada|Venda perdida)/.test(t)).map((t) => t.split(/\s/)[0] + ' ' + t.split(/\s/)[1]));
  expect(order.slice(0, 3)).toEqual(['Pedir aprovação', 'Venda fechada', 'Venda perdida']);
  const conta = page.getByRole('region', { name: 'Conta', exact: true });
  await expect(conta).toContainText(opp.contactName);

  const tabs = page.getByRole('tablist', { name: 'Acompanhamento' }).getByRole('tab');
  const names = (await tabs.allTextContents()).map((t) => t.replace(/\s*\(\d+\)|\s*•.*$/g, '').trim());
  expect(names).toEqual(['Histórico', 'Produtos', 'Projetos', 'Tarefas', 'Anexos', 'Chamados']);
  await expect(page.getByRole('tab', { name: /^Histórico/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Chat da negociação' })).toBeVisible();
  // produtos e serviços ficam na aba ao lado do histórico
  await page.getByRole('tab', { name: /^Produtos/ }).click();
  await expect(page.getByRole('region', { name: 'Produtos e serviços' })).toBeVisible();
  await page.getByRole('tab', { name: /^Histórico/ }).click();
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
  await expect(page.getByRole('dialog', { name: `Conta: ${opp.contactName}` }).getByRole('region', { name: 'Pessoas e ABM' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/opportunities/${opp.id}`);
  await expect(page.getByRole('tab', { name: 'Deal e conta' })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('tab', { name: /Viabilidade e chat/ }).click();
  await expect(page.getByRole('region', { name: 'Chat da negociação' })).toBeVisible();
  await shot(page, 'oportunidade-mobile');
});
