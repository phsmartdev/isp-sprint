import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('bloco 4: dias em cada etapa na faixa da negociação e conversão por etapa na Inteligência', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  const api = page.request;
  const lk = await (await api.get('/api/v1/meta/lookups')).json();
  const o = await (await api.post('/api/v1/opportunities', { data: { newContact: { name: `Conta E2E Etapas ${Date.now().toString(36)}`, segment: 'residencial' }, planId: lk.plans[0].id } })).json();
  const first = (await (await api.get(`/api/v1/opportunities/${o.id}/stage-times`)).json()).stages[0].key;
  const move = async (toStage: string) => {
    const cur = await (await api.get(`/api/v1/opportunities/${o.id}`)).json();
    const r = await api.post(`/api/v1/opportunities/${o.id}/transition`, { data: { toStage, confirm: true, reason: 'E2E', rowVersion: cur.rowVersion } });
    expect(r.ok(), await r.text()).toBe(true);
  };
  await move('proposta');
  await move(first);
  await move('proposta');

  await page.goto(`/opportunities/${o.id}`);
  const strip = page.getByRole('navigation', { name: 'Etapas do funil' });
  await expect(strip.locator('[aria-current="step"]')).toContainText('total menos de 1 dia');
  await expect(strip.getByRole('button', { name: /concluída em menos de 1 dia/ }).first()).toBeVisible();
  await expect(strip.getByText(/menos de 1 dia · 2×/)).toBeVisible();

  await page.goto('/intelligence?v=comercial');
  const sec = page.getByRole('region', { name: 'Conversão e tempo por etapa' });
  await expect(sec.getByLabel('Resumo do funil')).toContainText('Conversão do funil');
  const table = sec.getByRole('table', { name: 'Conversão por etapa' });
  await expect(table.getByRole('row').filter({ hasText: 'Proposta' })).toBeVisible();
  await sec.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/funil-etapas.png', fullPage: true });
});
