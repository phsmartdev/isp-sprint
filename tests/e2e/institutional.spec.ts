import { expect, test } from '@playwright/test';

/** Apresentação institucional: selos em fila enviados na Personalização (fora da apresentação), tela limpa e layout editável. */
test('apresentação institucional: selos em fila, tela limpa e blocos redimensionáveis', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  // selos enviados na Personalização, um arquivo por selo
  const png = Buffer.from('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', 'base64');
  await page.goto('/settings/branding');
  const sec = page.getByRole('region', { name: 'Selos e certificações' });
  for (const n of ['Selo A', 'Selo B']) {
    await sec.getByLabel('Adicionar selo ou certificação').setInputFiles({ name: `${n}.png`, mimeType: 'image/png', buffer: png });
    await expect(sec.getByRole('img', { name: n })).toBeVisible();
  }
  await page.goto('/playbooks');
  await page.getByRole('link', { name: /Apresentação institucional BKT/ }).click();
  const deck = page.getByRole('region', { name: 'Apresentação institucional' });
  await expect(deck.getByRole('img', { name: /Mapa de Sergipe/ })).toBeVisible();
  const seals = deck.getByRole('region', { name: 'Selos e certificações' });
  await expect(seals.getByRole('img')).toHaveCount(2);
  await expect(seals).not.toContainText('Personalização');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/institucional-1.png' });
  // sai da tela cheia para editar o layout
  await deck.getByRole('button', { name: /sair da tela cheia/i }).click().catch(() => undefined);
  await deck.getByRole('button', { name: /Editar layout/ }).click();
  const texto = deck.locator('[data-block="texto"]');
  const before = await texto.boundingBox();
  await page.mouse.move(before!.x + 40, before!.y + before!.height - 10);
  await page.mouse.down(); await page.mouse.move(before!.x + 40, before!.y + before!.height + 60, { steps: 5 }); await page.mouse.up();
  await deck.getByRole('button', { name: 'Aumentar o texto' }).click();
  await page.screenshot({ path: 'test-results/institucional-edicao.png' });
  await deck.getByRole('button', { name: 'Salvar layout' }).click();
  await expect(page.getByText('Layout salvo')).toBeVisible();
  await page.reload();
  const after = await page.locator('[data-block="texto"]').boundingBox();
  expect(Math.round(after!.y)).toBeGreaterThan(Math.round(before!.y) + 20);
  await page.getByRole('button', { name: /Editar layout/ }).click();
  await page.getByRole('button', { name: 'Restaurar padrão' }).click();
  await expect(page.getByText('Layout salvo')).toBeVisible();
  await page.getByRole('button', { name: 'Fechar' }).click();
  await expect(page).toHaveURL(/\/playbooks$/);
  // limpa os selos de teste
  await page.goto('/settings/branding');
  for (const n of ['Selo A', 'Selo B']) await page.getByRole('button', { name: `Remover ${n}` }).click();
});
