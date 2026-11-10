import { expect, test } from '@playwright/test';

/** Ao abrir o sistema os valores em R$ vêm ocultos; o olhinho no topo de qualquer tela mostra/oculta; recarregar volta a ocultar. */
test('valores em R$ ocultos ao abrir; botão no topo de todas as telas', async ({ page }) => {
  // padrão real (o navegador de teste começa com os valores à mostra)
  await page.addInitScript(() => localStorage.setItem('isp.e2e.hideMoney', '1'));
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();

  const top = page.getByRole('banner');
  for (const path of ['/', '/reports', '/contracts', '/opportunities', '/intelligence']) {
    await page.goto(path);
    await expect(top.getByRole('button', { name: 'Mostrar valores' })).toBeVisible();
    await expect(page.getByText(/R\$ ?\d/)).toHaveCount(0);
  }
  await page.goto('/reports');
  await expect(page.getByText('R$ •••••').first()).toBeVisible();
  await top.getByRole('button', { name: 'Mostrar valores' }).click();
  await expect(top.getByRole('button', { name: 'Ocultar valores' })).toBeVisible();
  await expect(page.getByText(/R\$ ?\d/).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/valores-visiveis.png' });
  // trocar de tela mantém a escolha; abrir de novo (recarregar) volta a ocultar
  await page.getByRole('link', { name: 'Inteligência', exact: true }).click();
  await expect(page).toHaveURL(/intelligence/);
  await expect(top.getByRole('button', { name: 'Ocultar valores' })).toBeVisible();
  await page.reload();
  await expect(top.getByRole('button', { name: 'Mostrar valores' })).toBeVisible();
  await page.goto('/reports');
  await expect(page.getByText(/R\$ ?\d/)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/valores-ocultos.png' });
});
