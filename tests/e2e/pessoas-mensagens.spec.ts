import { expect, test, type Page } from '@playwright/test';

/** Pessoas & Gestão: layout do Instagram web (menu lateral), mensagens diretas e o @ do topo com marcação. */
const SHOTS = process.env.E2E_SHOTS;
const login = async (page: Page, email: string) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
};

test('mensagem direta entre colegas e marcação no @', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const tag = Date.now().toString(36);
  await login(page, 'carlos@yepnet.test');
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  const me = await (await page.request.get('/api/v1/me')).json();
  for (const g of [{ subjectType: 'equipe', subjectId: lk.teams.find((t: { name: string }) => t.name === 'Residencial').id }, { subjectType: 'usuario', subjectId: me.user.id }]) {
    expect((await page.request.post('/api/v1/admin/modules/pessoas_cultura/grants', { data: { ...g, effect: 'liberar', reason: 'Piloto do RH' } })).status()).toBe(201);
  }
  // Ana publica marcando o Carlos
  const actx = await browser.newContext();
  const a = await actx.newPage();
  await login(a, 'ana@yepnet.test');
  const lucasId = (await (await a.request.get('/api/v1/pessoas/colaboradores?q=Lucas')).json()).items[0].id;
  await a.request.post('/api/v1/pessoas/posts', { data: { body: `Reunião de time ${tag} com @Carlos`, mentions: [me.user.id] } });

  // Carlos: @ do topo mostra a marcação
  await page.goto('/pessoas');
  await page.getByRole('button', { name: /menç/ }).click();
  await expect(page.getByRole('dialog', { name: 'Menções' }).getByText('Ana mencionou você numa publicação')).toBeVisible();
  await page.keyboard.press('Escape');

  // Carlos manda mensagem para a Ana pelo menu Mensagens
  await page.getByRole('navigation', { name: 'Seções de Pessoas & Gestão' }).getByRole('link', { name: 'Mensagens' }).click();
  await page.getByRole('button', { name: 'Nova mensagem' }).first().click();
  await page.getByRole('dialog', { name: 'Nova mensagem' }).getByLabel('Para', { exact: true }).fill('Ana');
  await page.getByRole('dialog', { name: 'Nova mensagem' }).getByRole('checkbox', { name: 'Ana Souza' }).click();
  await page.getByRole('dialog', { name: 'Nova mensagem' }).getByRole('button', { name: 'Conversar' }).click();
  await page.getByLabel('Escrever mensagem').fill(`Oi Ana, vi seu post ${tag}!`);
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByRole('region', { name: 'Conversa', exact: true }).getByText(`Oi Ana, vi seu post ${tag}!`)).toBeVisible();

  // Ana vê o número no menu, abre e responde
  await a.goto('/pessoas');
  const menu = a.getByRole('navigation', { name: 'Seções de Pessoas & Gestão' });
  await expect(menu.getByRole('link', { name: /Mensagens/ })).toContainText('1');
  await menu.getByRole('link', { name: /Mensagens/ }).click();
  await a.getByRole('region', { name: 'Conversas' }).getByRole('link', { name: /Carlos Silva/ }).click();
  await expect(a.getByRole('region', { name: 'Conversa', exact: true }).getByText(`Oi Ana, vi seu post ${tag}!`)).toBeVisible();
  await a.getByLabel('Escrever mensagem').fill('Obrigada! 😊');
  await a.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByRole('region', { name: 'Conversa', exact: true }).getByText('Obrigada! 😊')).toBeVisible({ timeout: 15_000 }); // chega sozinho para o Carlos
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pessoas-mensagens.png` });

  // avião: Carlos envia a publicação da Ana para o Lucas e um grupo novo recebe também
  await page.getByRole('button', { name: 'Nova mensagem' }).first().click();
  const nd = page.getByRole('dialog', { name: 'Nova mensagem' });
  await nd.getByLabel('Para', { exact: true }).fill('a');
  await nd.getByRole('checkbox', { name: 'Ana Souza' }).click();
  await nd.getByRole('checkbox', { name: 'Lucas Lima' }).click();
  await nd.getByLabel('Nome do grupo').fill(`Time ${tag}`);
  await nd.getByRole('button', { name: 'Criar grupo' }).click();
  await expect(page.getByRole('region', { name: 'Conversa', exact: true }).getByText(`Time ${tag}`)).toBeVisible();
  await page.getByRole('navigation', { name: 'Seções de Pessoas & Gestão' }).getByRole('link', { name: 'Feed', exact: true }).click();
  const post = page.getByRole('article').filter({ hasText: `Reunião de time ${tag}` });
  await post.getByRole('button', { name: 'Enviar por mensagem' }).click();
  const sd = page.getByRole('dialog', { name: 'Enviar' });
  await sd.getByRole('checkbox', { name: `Time ${tag}` }).click();
  await sd.getByLabel('Pesquisar colega ou grupo').fill('Lucas');
  await sd.getByRole('checkbox', { name: 'Lucas Lima' }).click();
  await sd.getByLabel('Escrever um recado').fill('Vejam!');
  await sd.getByRole('button', { name: 'Enviar para 2' }).click();
  await expect(page.getByText('Enviada para 2 conversas')).toBeVisible();
  await page.getByRole('navigation', { name: 'Seções de Pessoas & Gestão' }).getByRole('link', { name: /Mensagens/ }).click();
  await page.getByRole('region', { name: 'Conversas' }).getByRole('link', { name: new RegExp(`Time ${tag}`) }).click();
  const thread = page.getByRole('region', { name: 'Conversa', exact: true });
  await expect(thread.getByRole('link', { name: 'Publicação de Ana Souza' })).toBeVisible();
  await expect(thread.getByText('Vejam!')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pessoas-mensagens-grupo.png` });
  void lucasId;
  await actx.close();

  // celular: barra de ícones embaixo
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  await login(m, 'ana@yepnet.test');
  await m.goto('/pessoas');
  await expect(m.getByRole('navigation', { name: 'Seções de Pessoas & Gestão (celular)' })).toBeVisible();
  expect(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  if (SHOTS) await m.screenshot({ path: `${SHOTS}/pessoas-feed-celular.png` });
  await mctx.close();
});
