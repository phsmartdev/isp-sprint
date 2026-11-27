import { expect, test } from '@playwright/test';

/** Início: o card "Oportunidades abertas" soma todos os funis; o funil mostra um por vez, com seletor e o resto escrito. */
test('funil do Início bate com o card de abertas e troca de funil', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  for (const q of ['', '?from=2026-10-01&to=2026-10-31']) {
    const h = await (await page.request.get(`/api/v1/home${q}`)).json();
    const ab = h.kpis.find((k: { key: string }) => k.key === 'abertas');
    expect(h.pipelines.reduce((t: number, p: { open: number }) => t + p.open, 0)).toBe(ab.value);
    expect(h.pipeline.reduce((t: number, s: { count: number }) => t + s.count, 0)).toBe(h.pipelines.find((p: { id: string }) => p.id === h.pipelineId).open);
  }
  await page.goto('/');
  const card = page.getByRole('region', { name: /Funil/ });
  const sel = card.getByRole('combobox', { name: 'Funil' });
  await expect(sel).toBeVisible();
  await expect(card).toContainText('O card “Oportunidades abertas” soma todos os funis');
  const opt = await sel.locator('option', { hasText: 'Corporativo' }).getAttribute('value');
  await sel.selectOption(opt!);
  await expect(page).toHaveURL(/funil=/);
  await expect(card.getByRole('list', { name: 'Funil de oportunidades' })).toBeVisible();
  await expect(card).toContainText('Também abertas em Residencial');
});
