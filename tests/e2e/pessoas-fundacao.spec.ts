import { expect, test } from '@playwright/test';

/** Pessoas & Cultura · Etapa 1: liberado para o piloto do RH, Meu Espaço, perfil e configurações; fechado para quem não foi liberado. */
const SHOTS = process.env.E2E_SHOTS;
const login = async (page: import('@playwright/test').Page, email: string) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
};

test('módulo Pessoas & Cultura: piloto liberado, perfil social e configurações', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  // ninguém vê até liberar (se outro teste já liberou nesta base, pula a conferência)
  const before = await (await page.request.get('/api/v1/me')).json();
  if (!before.modules.pessoas_cultura) await expect(page.getByRole('link', { name: 'Pessoas & Cultura' })).toHaveCount(0);
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  const team = lk.teams.find((t: { name: string }) => t.name === 'Governo');
  const me = await (await page.request.get('/api/v1/me')).json();
  for (const g of [{ subjectType: 'equipe', subjectId: team.id }, { subjectType: 'usuario', subjectId: me.user.id }]) {
    const r = await page.request.post('/api/v1/admin/modules/pessoas_cultura/grants', { data: { ...g, effect: 'liberar', reason: 'Piloto do RH' } });
    expect(r.status(), await r.text()).toBe(201);
  }
  await page.reload();
  await page.getByRole('link', { name: 'Pessoas & Cultura' }).click();
  const menu = page.getByRole('navigation', { name: 'Seções de Pessoas & Cultura' });
  await expect(menu.getByRole('link', { name: 'Feed' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Administração' })).toBeVisible();
  if (SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: `${SHOTS}/pessoas-feed-desktop.png` }); }
  await menu.getByRole('link', { name: 'Meu Espaço' }).click();
  await expect(page.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Carlos!$/ })).toBeVisible();

  // colegas e perfil de um colega
  await page.getByLabel('Buscar colegas').fill('Mariana');
  await page.getByRole('region', { name: 'Colegas' }).getByRole('link', { name: /Mariana Costa/ }).click();
  await expect(page.getByRole('heading', { name: 'Mariana Costa' })).toBeVisible();
  await expect(page.getByText('Governo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar perfil' })).toHaveCount(0);

  // meu perfil: completar
  await page.getByRole('navigation', { name: 'Seções de Pessoas & Cultura' }).getByRole('link', { name: 'Meu Espaço' }).click();
  await page.getByRole('region', { name: 'Atalhos' }).getByRole('link', { name: 'Meu perfil' }).click();
  await page.getByRole('button', { name: 'Editar perfil' }).click();
  await page.getByLabel('Bio').fill('Gerente comercial. Gosto de formar times.');
  await page.getByLabel('Interesses profissionais').fill('liderança, vendas consultivas');
  await page.getByLabel('Competências que você compartilha').fill('negociação');
  await page.getByLabel('Mostrar meu e-mail corporativo').check();
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByText('Perfil atualizado')).toBeVisible();
  await expect(page.getByText('Gerente comercial. Gosto de formar times.')).toBeVisible();
  await expect(page.getByText('vendas consultivas')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pessoas-perfil.png`, fullPage: true });

  // configurações: papéis por setor
  await page.getByRole('navigation', { name: 'Seções de Pessoas & Cultura' }).getByRole('link', { name: 'Administração' }).click();
  await page.getByRole('navigation', { name: 'Administração de Pessoas & Cultura' }).getByRole('link', { name: 'Configurações' }).click();
  await expect(page.getByRole('region', { name: 'Papéis do módulo' })).toBeVisible();
  await page.getByLabel('Vídeo (MB)').fill('30');
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByText('Configurações salvas')).toBeVisible();

  // a Mariana (time Governo, liberado) vê o módulo; não vê a administração; vê o e-mail do Carlos
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  await m.goto(page.url().replace(/\/pessoas.*$/, '/login'));
  await m.getByLabel('E-mail').fill('mariana@yepnet.test');
  await m.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await m.getByRole('button', { name: 'Entrar' }).click();
  await m.waitForURL((u) => !u.pathname.startsWith('/login'));
  await m.goto(page.url().replace(/\/pessoas.*$/, '/pessoas/meu-espaco'));
  await expect(m.getByRole('heading', { name: /, Mariana!$/ })).toBeVisible();
  await expect(m.getByRole('navigation', { name: 'Seções de Pessoas & Cultura (celular)' }).getByRole('link', { name: 'Feed' })).toBeVisible();
  await expect(m.getByRole('link', { name: 'Administração' })).toHaveCount(0);
  expect(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  if (SHOTS) await m.screenshot({ path: `${SHOTS}/pessoas-meu-espaco-celular.png`, fullPage: true });
  await m.getByLabel('Buscar colegas').fill('Carlos');
  await m.getByRole('region', { name: 'Colegas' }).getByRole('link', { name: /Carlos Silva/ }).click({ timeout: 15_000 });
  await expect(m.getByRole('link', { name: 'carlos@yepnet.test' })).toBeVisible();
  // quem não foi liberado não abre nem pela URL
  const blocked = await m.request.get('/api/v1/pessoas/config');
  expect(blocked.status()).toBe(403);
  await ctx.close();
  if (SHOTS) { await page.goto(page.url().replace(/\/pessoas.*$/, '/pessoas')); await page.screenshot({ path: `${SHOTS}/pessoas-meu-espaco.png` }); }
});
