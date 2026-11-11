import { expect, test, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

/** Pessoas & Cultura · Etapa 2: publicar com foto e menção, reagir, comentar e responder, salvar, rascunho, editar e excluir. */
const SHOTS = process.env.E2E_SHOTS;
function png(w: number, h: number, rgb: [number, number, number]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => rgb[i % 3]!)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const login = async (page: Page, email: string) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
};

test('feed: publicar, reagir, comentar, responder, salvar, rascunho, editar e excluir', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await login(page, 'carlos@yepnet.test');
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  const me = await (await page.request.get('/api/v1/me')).json();
  for (const g of [{ subjectType: 'equipe', subjectId: lk.teams.find((t: { name: string }) => t.name === 'Residencial').id }, { subjectType: 'usuario', subjectId: me.user.id }]) {
    expect((await page.request.post('/api/v1/admin/modules/pessoas_cultura/grants', { data: { ...g, effect: 'liberar', reason: 'Piloto do RH' } })).status()).toBe(201);
  }
  const tag = Date.now().toString(36);
  await page.goto('/pessoas');
  await page.getByRole('button', { name: 'Compartilhe algo com os colegas…' }).click();
  const editor = page.getByRole('region', { name: 'Nova publicação' });
  await editor.getByLabel('Texto da publicação').pressSequentially(`Inauguramos a nova sala ${tag}! Obrigado @Luc`);
  await page.getByRole('option', { name: /Lucas Lima/ }).click();
  await editor.getByLabel('Escolher fotos, vídeos ou anexos').setInputFiles({ name: 'sala.png', mimeType: 'image/png', buffer: png(120, 80, [40, 120, 200]) });
  await expect(editor.getByRole('img', { name: 'sala.png' })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Publicar' })).toBeEnabled();
  await editor.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText('Publicado!')).toBeVisible();
  const card = page.getByRole('article').filter({ hasText: `Inauguramos a nova sala ${tag}` });
  await expect(card.getByRole('img', { name: /^sala\./ })).toBeVisible();
  await expect(card.locator('mark')).toHaveText('@Lucas Lima');

  // rascunho: salva, não aparece no feed, publica depois
  await page.getByRole('button', { name: 'Compartilhe algo com os colegas…' }).click();
  await page.getByRole('region', { name: 'Nova publicação' }).getByLabel('Texto da publicação').fill(`Rascunho ${tag}`);
  await page.getByRole('region', { name: 'Nova publicação' }).getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText('Rascunho salvo')).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: `Rascunho ${tag}` })).toHaveCount(0);

  // Lucas (time liberado) reage, comenta; Carlos responde
  const ctx = await browser.newContext();
  const l = await ctx.newPage();
  await login(l, 'lucas@yepnet.test');
  await l.goto('/pessoas');
  const lc = l.getByRole('article').filter({ hasText: `Inauguramos a nova sala ${tag}` });
  await lc.getByRole('button', { name: 'Escolher reação' }).click();
  await lc.getByRole('button', { name: 'Celebrar' }).click();
  await expect(lc.getByRole('button', { name: /Celebrar/ }).first()).toHaveAttribute('aria-pressed', 'true');
  await lc.getByRole('link', { name: 'Comentar' }).click();
  await l.getByLabel('Escrever comentário').fill('Ficou ótima!');
  await l.getByRole('button', { name: 'Comentar', exact: true }).click();
  await expect(l.getByRole('region', { name: 'Comentários' })).toContainText('Ficou ótima!');
  await ctx.close();

  await page.reload();
  await expect(card.getByText('Ver 1 comentário')).toBeVisible();
  await card.getByRole('link', { name: 'Comentar' }).click();
  await page.getByRole('button', { name: 'Responder' }).first().click();
  await page.getByLabel('Responder comentário').fill('Obrigado, Lucas!');
  await page.getByRole('button', { name: 'Responder', exact: true }).last().click();
  await expect(page.getByRole('region', { name: 'Comentários' })).toContainText('Obrigado, Lucas!');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pessoas-publicacao.png`, fullPage: true });

  // salvar, editar e excluir a própria
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Publicação salva')).toBeVisible();
  await page.goto('/pessoas/salvos');
  await expect(page.getByRole('article').filter({ hasText: `Inauguramos a nova sala ${tag}` })).toBeVisible();
  await page.goto('/pessoas');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pessoas-feed.png` });
  await card.getByRole('button', { name: 'Ações da publicação' }).click();
  await card.getByRole('menuitem', { name: 'Editar' }).click();
  await page.getByRole('region', { name: 'Editar publicação' }).getByLabel('Texto da publicação').fill(`Inauguramos a nova sala ${tag} (editado)`);
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Publicação atualizada')).toBeVisible();
  const edited = page.getByRole('article').filter({ hasText: `${tag} (editado)` });
  await expect(edited).toContainText('editada');
  await edited.getByRole('button', { name: 'Ações da publicação' }).click();
  await edited.getByRole('menuitem', { name: 'Excluir' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(page.getByText('Publicação excluída')).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: tag })).toHaveCount(0);

  // rascunho continua e é publicado
  await page.getByRole('button', { name: 'Compartilhe algo com os colegas…' }).click();
  await page.getByRole('button', { name: /^Rascunhos \(/ }).click();
  await page.getByRole('dialog', { name: 'Rascunhos' }).getByRole('button', { name: 'Continuar' }).first().click();
  await page.getByRole('region', { name: 'Editar publicação' }).getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByRole('article').filter({ hasText: `Rascunho ${tag}` })).toBeVisible();
});
