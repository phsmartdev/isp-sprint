import { expect, test, type Page } from '@playwright/test';

/** Stakeholders na conta: escolher a conta na aba do ABM, ver por setor (com IA/INA/NIA/NINA e agente oculto) e o organograma. */
const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('ABM → Stakeholders: conta escolhida, análise por setor e organograma', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, 'lucas@yepnet.test');
  const stamp = Date.now().toString(36);
  const acc = await (await page.request.post('/api/v1/abm/new-account', { data: { name: `Secretaria Fictícia ${stamp}`, segment: 'governamental', reason: 'Conectividade das escolas' } })).json();
  const u = await (await page.request.post(`/api/v1/abm/${acc.id}/units`, { data: { name: 'Gabinete', kind: 'secretaria' } })).json();
  const ti = await (await page.request.post(`/api/v1/abm/${acc.id}/units`, { data: { name: 'Tecnologia', kind: 'departamento', parentId: u.id } })).json();
  const add = async (name: string, title: string, extra: object) => (await (await page.request.post(`/api/v1/accounts/${acc.contactId}/stakeholders`, { data: { person: { name }, title, ...extra } })).json()).id as string;
  const sec = await add('Secretária Fictícia', 'Secretária de Educação', { unitId: u.id, roles: ['decisor'], powerClass: 'ia' });
  const dir = await add('Diretor Fictício', 'Diretor de Tecnologia', { unitId: ti.id, roles: ['avaliador_tecnico'], powerClass: 'ina', reportsToId: sec });
  await add('Coordenadora Fictícia', 'Coordenadora de Redes', { unitId: ti.id, roles: ['usuario'], powerClass: 'nina', reportsToId: dir });
  await add('Chefe de Compras Fictício', 'Chefe de Compras', { unitId: u.id, roles: ['responsavel_contratacao'], powerClass: 'nia', reportsToId: sec });

  await page.goto('/abm?tab=stakeholders');
  await page.getByLabel('Conta', { exact: true }).selectOption(acc.contactId);
  const panel = page.getByRole('region', { name: 'Stakeholders da conta' });
  await expect(panel.getByRole('region', { name: 'Setor Tecnologia' })).toContainText('Diretor Fictício');
  await expect(panel.getByRole('region', { name: 'Setor Tecnologia' })).toContainText('INA · influência, mas sem autoridade');

  // agente oculto pelo formulário
  await panel.getByRole('button', { name: 'Adicionar stakeholder' }).click();
  const dlg = page.getByRole('dialog', { name: 'Adicionar stakeholder' });
  await dlg.getByLabel('Nome (pessoa nova)').fill('Assessor Fictício');
  await dlg.getByLabel('Cargo').fill('Ex-secretário, conselheiro informal');
  await dlg.getByLabel('Classificação (influência × autoridade)').selectOption('ina');
  await dlg.getByText('Agente oculto', { exact: true }).click();
  await dlg.getByRole('button', { name: 'Adicionar' }).click();
  const drawer = page.getByRole('dialog', { name: 'Stakeholder' });
  await expect(drawer.getByRole('heading', { name: 'Assessor Fictício' })).toBeVisible();
  await drawer.getByLabel('Pontos de resistência').fill('Prefere o fornecedor atual');
  await drawer.getByLabel('Link').fill('https://www.linkedin.com/in/perfil-ficticio');
  await drawer.getByLabel('O que diz').fill('Ex-secretário na gestão anterior');
  await drawer.getByRole('button', { name: 'Adicionar fonte' }).click();
  await drawer.getByRole('button', { name: 'Salvar alterações' }).first().click();
  await expect(page.getByText('Stakeholder atualizado')).toBeVisible();
  await page.keyboard.press('Escape');

  await panel.getByRole('tab', { name: 'Organograma' }).click();
  const chart = panel.getByRole('tree', { name: 'Organograma da conta' });
  await expect(chart.getByRole('button', { name: /Secretária Fictícia/ })).toBeVisible();
  await expect(chart.getByRole('button', { name: /Coordenadora Fictícia/ })).toBeVisible();
  await expect(panel.getByRole('complementary', { name: 'Agentes ocultos' })).toContainText('Assessor Fictício');
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/abm-organograma.png` });
  await panel.getByRole('tab', { name: 'Por setor' }).click();
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/abm-setor.png` });
});
