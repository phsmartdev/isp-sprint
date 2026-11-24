import { expect, test, type Page } from '@playwright/test';
import zlib from 'node:zlib';

/** Cadastro do usuário com foto; assinatura de e-mail em imagem (a mesma da caixa do Gmail). */
function png(w: number, h: number, rgb: [number, number, number]) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('novo usuário com foto no cadastro', async ({ page }) => {
  const st = Date.now().toString(36).slice(-6);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/users');
  await page.getByRole('button', { name: 'Novo usuário' }).click();
  await page.getByLabel('Foto do perfil').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png(64, 64, [47, 89, 134]) });
  await expect(page.getByRole('button', { name: 'Trocar foto', exact: true })).toBeVisible();
  await page.locator('#uf-name').fill(`Pessoa Foto ${st}`);
  await page.locator('#uf-email').fill(`foto.${st}@exemplo.test`);
  await page.getByRole('button', { name: 'Cadastrar' }).click();
  await expect(page.getByRole('dialog', { name: 'Senha temporária' })).toBeVisible();
  const users = (await (await page.request.get('/api/v1/admin/users')).json()).users as { email: string; hasAvatar: boolean; id: string }[];
  const u = users.find((x) => x.email === `foto.${st}@exemplo.test`)!;
  expect(u.hasAvatar).toBe(true);
  expect((await page.request.get(`/api/v1/users/${u.id}/avatar`)).headers()['content-type']).toBe('image/png');
});

test('assinatura em imagem: envia, ajusta a largura e tira', async ({ page }) => {
  await login(page, 'carlos@yepnet.test');
  await page.goto('/email/caixas');
  const sig = page.locator('section[aria-label="Minha assinatura"]');
  await sig.getByLabel('Imagem da assinatura').setInputFiles({ name: 'assinatura.png', mimeType: 'image/png', buffer: png(420, 90, [45, 51, 57]) });
  await expect(sig.getByAltText('Prévia da assinatura')).toBeVisible();
  await expect(sig.getByText('420 px')).toBeVisible();
  await sig.getByRole('button', { name: 'Salvar imagem' }).click();
  await expect(page.getByText('Imagem da assinatura salva')).toBeVisible();
  const s1 = await (await page.request.get('/api/v1/mail/signature')).json();
  expect(s1).toMatchObject({ hasImage: true, imageWidth: 420 });
  await page.reload();
  await expect(sig.getByAltText('Prévia da assinatura')).toBeVisible();
  await sig.getByLabel('Largura').fill('300');
  await sig.getByRole('button', { name: 'Salvar imagem' }).click();
  await expect.poll(async () => (await (await page.request.get('/api/v1/mail/signature')).json()).imageWidth).toBe(300);
  await sig.getByRole('button', { name: 'Tirar imagem' }).click();
  await expect(sig.getByAltText('Prévia da assinatura')).toHaveCount(0);
  expect((await (await page.request.get('/api/v1/mail/signature')).json()).hasImage).toBe(false);
});
