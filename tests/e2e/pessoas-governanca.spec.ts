import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

/** Pessoas & Cultura · Etapa 5: card no formato do Instagram, denúncia, decisão da moderação, aviso ao autor e painel. */
const SHOTS = process.env.E2E_SHOTS;
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';
const psql = (q: string) => execFileSync('psql', [DB, '-Atc', q]).toString().trim();
/** PNG com degradê vertical (para ver o recorte). */
function png(w: number, h: number, a: [number, number, number], b: [number, number, number]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Array.from({ length: h }, (_, y) => { const k = y / (h - 1); const px = [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * k)); return Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => px[i % 3]!)]); });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const login = async (page: Page, email: string) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
};

test('instagram, denúncia, moderação e painel', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const tag = Date.now().toString(36);
  const before = psql(`select coalesce(array_to_string(sectors, ','), '') from users where email = 'carlos@yepnet.test'`);
  psql(`update users set sectors = array['comercial'] where email = 'carlos@yepnet.test'`);
  await login(page, 'carlos@yepnet.test');
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  const me = await (await page.request.get('/api/v1/me')).json();
  for (const g of [{ subjectType: 'equipe', subjectId: lk.teams.find((t: { name: string }) => t.name === 'Residencial').id }, { subjectType: 'usuario', subjectId: me.user.id }]) {
    expect((await page.request.post('/api/v1/admin/modules/pessoas_cultura/grants', { data: { ...g, effect: 'liberar', reason: 'Piloto do RH' } })).status()).toBe(201);
  }
  const { settings } = await (await page.request.get('/api/v1/pessoas/config')).json();
  const { badgeBaselineAt: _b, ...rest } = settings;
  expect((await page.request.put('/api/v1/pessoas/config', { data: { ...rest, roles: { ...rest.roles, moderacao: ['comercial'] } } })).ok()).toBeTruthy();

  // Ana publica duas fotos: retrato (vira 4:5) e paisagem
  const actx = await browser.newContext();
  const a = await actx.newPage();
  await login(a, 'ana@yepnet.test');
  await a.goto('/pessoas');
  await a.getByRole('button', { name: 'Compartilhe algo com os colegas…' }).click();
  await a.getByLabel('Texto da publicação').fill(`Bastidores da nova loja ${tag} 📸`);
  await a.getByLabel('Escolher fotos, vídeos ou anexos').setInputFiles([
    { name: 'retrato.png', mimeType: 'image/png', buffer: png(900, 1600, [56, 133, 211], [16, 32, 53]) },
    { name: 'paisagem.png', mimeType: 'image/png', buffer: png(1600, 900, [198, 244, 50], [56, 133, 211]) },
  ]);
  await expect(a.getByRole('img', { name: /^paisagem\./ })).toBeVisible();
  await a.getByRole('button', { name: 'Publicar' }).click();
  const card = a.getByRole('article').filter({ hasText: `Bastidores da nova loja ${tag}` });
  await expect(card.getByText('1/2')).toBeVisible();
  const ratio = await card.locator('[aria-roledescription="carrossel"]').evaluate((el) => el.clientWidth / el.clientHeight);
  expect(Math.abs(ratio - 0.8)).toBeLessThan(0.02); // retrato 4:5, como no Instagram
  if (SHOTS) { await a.waitForTimeout(500); await card.screenshot({ path: `${SHOTS}/pessoas-card-instagram.png` }); }

  // Lucas (celular) vê e denuncia
  const lctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const l = await lctx.newPage();
  await login(l, 'lucas@yepnet.test');
  await l.goto('/pessoas');
  const lc = l.getByRole('article').filter({ hasText: `Bastidores da nova loja ${tag}` });
  await lc.scrollIntoViewIfNeeded();
  expect(await l.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  if (SHOTS) await lc.screenshot({ path: `${SHOTS}/pessoas-card-instagram-celular.png` });
  await lc.getByRole('button', { name: 'Ações da publicação' }).click();
  await lc.getByRole('menuitem', { name: 'Denunciar' }).click();
  const dlg = l.getByRole('dialog', { name: 'Denunciar publicação' });
  await dlg.getByLabel('Exposição indevida de informações').check();
  await dlg.getByLabel(/^Detalhes/).fill('Aparece o crachá de um cliente.');
  await dlg.getByRole('button', { name: 'Enviar denúncia' }).click();
  await expect(l.getByText(/Denúncia enviada/)).toBeVisible();
  await lctx.close();

  // Carlos (moderação) assume e decide
  await page.goto('/pessoas/admin/moderacao');
  const item = page.getByRole('listitem', { name: 'Denúncia de Publicação' }).filter({ hasText: `Bastidores da nova loja ${tag}` });
  await expect(item.getByText('Aparece o crachá de um cliente.')).toBeVisible();
  await item.getByRole('button', { name: 'Assumir' }).click();
  await expect(page.getByText('Denúncia assumida')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pessoas-moderacao.png` });
  await item.getByRole('button', { name: 'Decidir' }).click();
  const dd = page.getByRole('dialog', { name: 'Decidir denúncia' });
  await dd.getByLabel('Solicitar edição ao autor').check();
  await dd.getByLabel(/^Justificativa/).fill('Troque a foto: o crachá do cliente aparece.');
  await dd.getByRole('button', { name: 'Registrar decisão' }).click();
  await expect(page.getByText('Decisão registrada')).toBeVisible();

  // Ana recebe o aviso no topo e vê o motivo no perfil
  await a.reload();
  await a.getByRole('button', { name: /menç/ }).click();
  await expect(a.getByRole('dialog', { name: 'Menções' }).getByText('A moderação pediu que você edite sua publicação')).toBeVisible();
  await a.keyboard.press('Escape');
  await a.goto('/pessoas/perfil/eu');
  const own = a.getByRole('article').filter({ hasText: `Bastidores da nova loja ${tag}` });
  await expect(own.getByRole('status')).toContainText('Troque a foto');
  if (SHOTS) await own.screenshot({ path: `${SHOTS}/pessoas-aviso-moderacao.png` });
  await actx.close();

  // painel
  await page.goto('/pessoas/admin/painel');
  await expect(page.getByText('Taxa de adoção')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Gestão de conteúdo' }).getByText(`Bastidores da nova loja ${tag}`)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pessoas-painel.png`, fullPage: true });
  psql(`update users set sectors = ${before ? `array['${before.split(',').join("','")}']` : "'{}'"} where email = 'carlos@yepnet.test'`);
});
