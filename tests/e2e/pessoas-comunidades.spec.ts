import { expect, test, type Page } from '@playwright/test';

/** Pessoas & Cultura · Etapa 3: criar comunidade privada, pedir participação, aprovar, publicar nela e fixar. */
const SHOTS = process.env.E2E_SHOTS;
const login = async (page: Page, email: string) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
};

test('comunidade privada: criar, pedir, aprovar, publicar e fixar', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await login(page, 'ana@yepnet.test');
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  // a gerência libera o piloto para o time Residencial (Ana, Lucas)
  const g = await browser.newContext();
  const gp = await g.newPage();
  await login(gp, 'carlos@yepnet.test');
  expect((await gp.request.post('/api/v1/admin/modules/pessoas_cultura/grants', { data: { subjectType: 'equipe', subjectId: lk.teams.find((t: { name: string }) => t.name === 'Residencial').id, effect: 'liberar', reason: 'Piloto do RH' } })).status()).toBe(201);
  await g.close();
  const tag = Date.now().toString(36);
  await page.goto('/pessoas/comunidades');
  await page.getByRole('button', { name: 'Criar comunidade' }).click();
  const form = page.getByRole('form', { name: 'Nova comunidade' });
  await form.getByLabel('Nome').fill(`Liderança ${tag}`);
  await form.getByLabel('Categoria').fill('Gestão');
  await form.getByLabel('Descrição').fill('Troca entre líderes de equipe.');
  await form.getByLabel('Regras da comunidade').fill('Tudo aqui fica entre os membros.');
  await form.getByRole('radio', { name: /Privada/ }).check();
  await form.getByRole('button', { name: 'Criar comunidade' }).click();
  await expect(page.getByText('Comunidade criada')).toBeVisible();
  await expect(page.getByRole('heading', { name: `Liderança ${tag}` })).toBeVisible();
  const url = page.url();

  // Lucas vê a comunidade na lista, mas não o conteúdo; pede para participar
  const lctx = await browser.newContext();
  const l = await lctx.newPage();
  await login(l, 'lucas@yepnet.test');
  await l.goto('/pessoas/comunidades');
  await l.getByLabel('Buscar comunidades').fill(tag);
  await l.getByRole('button', { name: 'Pedir para participar' }).click();
  await expect(l.getByText('Pedido enviado à moderação')).toBeVisible();
  await l.goto(url);
  await expect(l.getByText('Seu pedido está com a moderação.', { exact: false })).toBeVisible();

  // Ana aprova, publica e fixa
  await page.reload();
  await page.getByRole('button', { name: /^Pedidos \(1\)/ }).click();
  await page.getByRole('button', { name: 'Aprovar' }).click();
  await expect(page.getByText('Participação aprovada')).toBeVisible();
  await page.getByRole('button', { name: 'Publicações' }).click();
  await page.getByRole('button', { name: 'Compartilhe algo com os colegas…' }).click();
  await page.getByLabel('Texto da publicação').fill(`Pauta da reunião ${tag}`);
  await page.getByRole('button', { name: 'Publicar' }).click();
  const card = page.getByRole('article').filter({ hasText: `Pauta da reunião ${tag}` });
  await card.getByRole('button', { name: 'Ações da publicação' }).click();
  await card.getByRole('menuitem', { name: 'Fixar no topo' }).click();
  await expect(page.getByText('Publicação fixada no topo')).toBeVisible();
  await expect(card.getByText('Fixada')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pessoas-comunidade.png` });

  // Lucas agora lê e vê no feed do Meu Espaço
  await l.reload();
  await expect(l.getByRole('article').filter({ hasText: `Pauta da reunião ${tag}` })).toBeVisible();
  await l.goto('/pessoas');
  await expect(l.getByRole('article').filter({ hasText: `Pauta da reunião ${tag}` })).toBeVisible();
  await lctx.close();
  await page.goto('/pessoas/comunidades');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pessoas-comunidades.png` });
});
