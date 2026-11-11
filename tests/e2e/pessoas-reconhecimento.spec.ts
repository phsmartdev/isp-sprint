import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/** Pessoas & Cultura · Etapa 4: comunicado oficial com confirmação de leitura e reconhecimento público com post animado. */
const SHOTS = process.env.E2E_SHOTS;
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';
const psql = (q: string) => execFileSync('psql', [DB, '-Atc', q]).toString().trim();
const login = async (page: Page, email: string) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
};

test('comunicado com ciência e reconhecimento animado no feed', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const tag = Date.now().toString(36);
  // Carlos é do setor Comercial; a gerência libera o piloto e define que esse setor publica comunicados
  const before = psql(`select coalesce(array_to_string(sectors, ','), '') from users where email = 'carlos@yepnet.test'`);
  psql(`update users set sectors = array['comercial'] where email = 'carlos@yepnet.test'`);
  await login(page, 'carlos@yepnet.test');
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  const me = await (await page.request.get('/api/v1/me')).json();
  for (const g of [{ subjectType: 'equipe', subjectId: lk.teams.find((t: { name: string }) => t.name === 'Residencial').id }, { subjectType: 'usuario', subjectId: me.user.id }]) {
    expect((await page.request.post('/api/v1/admin/modules/pessoas_cultura/grants', { data: { ...g, effect: 'liberar', reason: 'Piloto do RH' } })).status()).toBe(201);
  }
  const cfg = await page.request.get('/api/v1/pessoas/config');
  expect(cfg.ok(), await cfg.text()).toBeTruthy();
  const { settings } = await cfg.json();
  const { badgeBaselineAt: _b, ...rest } = settings;
  const put = await page.request.put('/api/v1/pessoas/config', { data: { ...rest, roles: { ...rest.roles, comunicacao: ['comercial'] } } });
  expect(put.ok(), await put.text()).toBeTruthy();

  // Carlos publica um comunicado para todos, pedindo ciência
  await page.goto('/pessoas/admin/comunicados');
  await page.getByRole('button', { name: 'Novo comunicado' }).click();
  const form = page.getByRole('form', { name: 'Novo comunicado' });
  await form.getByLabel('Título').fill(`Nova política de home office ${tag}`);
  await form.getByLabel('Categoria').fill('RH');
  await form.getByLabel('Prioridade').selectOption('importante');
  await form.getByLabel('Conteúdo').fill('A partir de segunda, **dois dias** por semana em casa.');
  await form.getByLabel('Pedir confirmação de leitura').check();
  await form.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Comunicado publicado')).toBeVisible();

  // Ana vê no Meu Espaço, abre e confirma a leitura
  const actx = await browser.newContext();
  const a = await actx.newPage();
  await login(a, 'ana@yepnet.test');
  await a.goto('/pessoas');
  const card = a.getByRole('article', { name: `Comunicado: Nova política de home office ${tag}` });
  await expect(card.getByText('novo')).toBeVisible();
  await card.getByRole('button', { expanded: false }).click();
  await expect(card.getByText('dois dias')).toBeVisible();
  await card.getByRole('button', { name: 'Li e estou ciente' }).click();
  await expect(card.getByText('Leitura confirmada')).toBeVisible();

  // Ana reconhece Lucas publicamente
  await a.getByRole('link', { name: 'Reconhecer colega' }).first().click();
  await expect(a).toHaveURL(/\/pessoas\/reconhecimento/);
  await a.getByRole('form', { name: 'Reconhecer um colega' }).getByPlaceholder('Digite o nome').fill('Lucas');
  await a.getByRole('option', { name: /Lucas/ }).first().click();
  await a.getByText('Colaboração', { exact: true }).click();
  await a.getByRole('form', { name: 'Reconhecer um colega' }).getByLabel(/^Mensagem/).fill(`Valeu pela ajuda na migração do cliente ${tag}!`);
  await a.getByRole('button', { name: 'Reconhecer', exact: true }).click();
  await expect(a.getByText('Reconhecimento publicado no feed! 🎉')).toBeVisible();
  await actx.close();

  // Lucas vê o post comemorativo no feed e no perfil
  const lctx = await browser.newContext();
  const l = await lctx.newPage();
  await login(l, 'lucas@yepnet.test');
  const post = l.getByRole('article').filter({ hasText: `migração do cliente ${tag}` });
  // no e2e todos saem do mesmo IP: se o limite global por IP (600/min) estourar na sequência de testes, espera e recarrega
  await expect(async () => { await l.goto('/pessoas'); await expect(post).toBeVisible({ timeout: 4000 }); }).toPass({ timeout: 75_000, intervals: [5000, 10_000, 15_000] });
  await expect(post.getByText(/^Reconheceu /).first()).toBeVisible();
  await post.scrollIntoViewIfNeeded();
  await expect(post.getByRole('img', { name: /Ana Souza reconheceu Lucas Lima em Colaboração/ })).toBeVisible();
  if (SHOTS) { await l.waitForTimeout(2500); await post.screenshot({ path: `${SHOTS}/pessoas-reconhecimento-post.png` }); }
  await l.goto('/pessoas/perfil/eu');
  await expect(l.getByRole('region', { name: 'Reconhecimentos recebidos' }).getByText(`migração do cliente ${tag}`)).toBeVisible();
  await lctx.close();

  // Carlos vê o alcance: Ana confirmou
  await page.reload();
  const row = page.getByText(`Nova política de home office ${tag}`).first();
  await expect(row).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pessoas-comunicados-admin.png` });
  psql(`update users set sectors = ${before ? `array['${before.split(',').join("','")}']` : "'{}'"} where email = 'carlos@yepnet.test'`);
});
