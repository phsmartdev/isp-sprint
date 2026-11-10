import { expect, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';

/** PNG de cor sólida (w×h), sem depender de arquivo no repositório. */
function png(w: number, h: number, rgb: [number, number, number]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => rgb[i % 3]!)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const SHOTS = process.env.E2E_SHOTS;

test('gerência troca as imagens do login, do banner do Início e do menu, e volta ao padrão', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  await page.goto('/settings/branding');
  for (const [title, color] of [['Fundo da tela de login', [200, 60, 40]], ['Banner do Início', [40, 160, 90]], ['Cartão do menu lateral', [120, 60, 200]]] as const) {
    const box = page.getByRole('region', { name: title });
    await box.getByLabel(`Imagem para ${title}`).setInputFiles({ name: 'arte.png', mimeType: 'image/png', buffer: png(64, 32, color as [number, number, number]) });
    await expect(box.getByRole('img', { name: `Imagem atual: ${title}` })).toBeVisible();
    await expect(box.getByRole('button', { name: 'Voltar à arte padrão' })).toBeVisible();
  }
  if (SHOTS) await page.locator('#settings-page').screenshot({ path: `${SHOTS}/personalizacao.png` });

  // Início: banner e menu usam as imagens enviadas
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Nova oportunidade' }).locator('img[src*="/api/v1/brand/banner_inicio"]')).toBeVisible();
  await expect(page.locator('img[src*="/api/v1/brand/card_sidebar"]')).toBeAttached();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/inicio-banner.png` });

  // login (público): fundo com a imagem enviada
  const ctx = await page.context().browser()!.newContext();
  const anon = await ctx.newPage();
  await anon.goto(page.url().replace(/\/$/, '') + '/login');
  await expect(anon.locator('img[src="/api/v1/public/brand/login_fundo"]')).toBeVisible();
  if (SHOTS) await anon.screenshot({ path: `${SHOTS}/login-imagem.png` });

  // volta ao padrão: hexágonos de novo
  await page.goto('/settings/branding');
  for (const title of ['Fundo da tela de login', 'Banner do Início', 'Cartão do menu lateral']) {
    const box = page.getByRole('region', { name: title });
    await box.getByRole('button', { name: 'Voltar à arte padrão' }).click();
    await expect(box.getByText('Arte padrão')).toBeVisible();
  }
  await anon.reload();
  await expect(anon.locator('img[src="/api/v1/public/brand/login_fundo"]')).toBeHidden();
  await expect(anon.getByRole('heading', { name: 'Boas-vindas' })).toBeVisible();
  await ctx.close();
});
