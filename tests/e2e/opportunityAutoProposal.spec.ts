import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** Mover para Proposta gera a proposta no modelo padrão da filial (mesmo com a exigência de proposta anexada); excluir negociação. */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';
const psql = (q: string) => execFileSync('psql', [DB, '-Atc', q]).toString().trim();
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('mover para Proposta gera a proposta e excluir negociação', async ({ page }) => {
  test.setTimeout(120_000);
  const st = Date.now().toString(36);
  await login(page, 'carlos@yepnet.test');
  const bg = `data:image/png;base64,${readFileSync('tests/e2e/fixtures/fundo-proposta.png').toString('base64')}`;
  const t = await (await page.request.post('/api/v1/admin/proposal-templates', { data: { name: `Padrão filial ${st}`, segments: [], variables: [], fields: [] } })).json();
  expect((await page.request.post(`/api/v1/admin/proposal-templates/${t.id}/pages`, { data: { data: bg } })).status()).toBe(201);
  const branch = (await (await page.request.get('/api/v1/admin/proposal-templates')).json()).branches[0];
  expect((await page.request.put(`/api/v1/admin/proposal-templates/${t.id}/branches`, { data: { branchIds: [branch.id] } })).status()).toBe(200);
  const plan = (await (await page.request.get('/api/v1/meta/lookups')).json()).plans[0];
  const o = await (await page.request.post('/api/v1/opportunities', { data: { newContact: { name: `Órgão Fictício ${st}`, segment: 'empresarial' }, planId: plan.id, branchId: branch.id } })).json();
  // a etapa Proposta exige proposta anexada (como na jornada do usuário)
  const pipe = psql(`select pipeline_id from opportunities where id = '${o.id}'`);
  const before = psql(`select requirements::text from pipeline_stages where pipeline_id = '${pipe}' and key = 'proposta'`);
  psql(`update pipeline_stages set requirements = coalesce(requirements, '{}'::jsonb) || '{"proposta": true}'::jsonb where pipeline_id = '${pipe}' and key = 'proposta'`);
  try {
    await page.goto(`/opportunities/${o.id}`);
    await page.getByRole('navigation', { name: 'Etapas do funil' }).getByRole('button', { name: /^Proposta/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Mover para Proposta' });
    await expect(dlg).toContainText(`Proposta gerada ao mover, no modelo “Padrão filial ${st}”`);
    await dlg.getByRole('button', { name: 'Mover' }).click();
    await expect(page.getByText(/Proposta gerada no modelo da filial: PC \d{6}/).last()).toBeVisible();
  } finally {
    psql(`update pipeline_stages set requirements = ${before ? `'${before}'::jsonb` : 'requirements - \'proposta\''} where pipeline_id = '${pipe}' and key = 'proposta'`);
    await page.request.put(`/api/v1/admin/proposal-templates/${t.id}/branches`, { data: { branchIds: [] } });
  }

  await page.getByRole('button', { name: 'Excluir negociação' }).click();
  const del = page.getByRole('dialog', { name: 'Excluir negociação' });
  await expect(del.getByRole('button', { name: 'Excluir' })).toBeDisabled();
  await del.getByLabel('Motivo da exclusão').fill('Cadastrada em duplicidade');
  await del.getByRole('button', { name: 'Excluir' }).click();
  await expect(page).toHaveURL(/\/opportunities$/);
  expect((await page.request.get(`/api/v1/opportunities/${o.id}`)).status()).toBe(404);
});
