import { expect, test, type Page } from '@playwright/test';

/** Etapa 1 · Fase 2 — frentes da implantação: criar pelo painel, homologar marco, risco e impedimento, painel em Inteligência. */
const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

test('Frentes: cria as frentes, homologa marco, registra risco e impedimento e acompanha no painel', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const initiative = `Implantação E2E ${Date.now().toString(36)}`;

  // Lucas executa a frente Contratos; Carlos (gestor) cria e homologa
  const lctx = await browser.newContext();
  const lucas = await lctx.newPage();
  await login(lucas, 'lucas@yepnet.test');
  const lucasId = (await (await lucas.request.get('/api/v1/me')).json()).user.id as string;

  await login(page, 'carlos@yepnet.test');
  await page.goto('/projetos?v=painel');
  await page.getByRole('button', { name: 'Criar frentes da implantação' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Criar frentes da implantação' });
  await dlg.getByLabel('Iniciativa').fill(initiative);
  await expect(dlg.getByLabel('Frente 4', { exact: true })).toHaveValue('Relatórios');
  await dlg.locator('#fr-o-0').selectOption(lucasId);
  await dlg.getByRole('button', { name: 'Criar 4 frente(s)' }).click();
  await expect(page.getByText('4 frente(s) criada(s)')).toBeVisible();
  const panel = page.getByRole('region', { name: 'Painel das frentes' });
  await expect(panel.getByRole('row')).toHaveCount(5);
  await expect(panel.getByRole('row', { name: /Contratos/ })).toContainText('0 de 6 homologado(s)');
  await expect(panel.getByRole('row', { name: /Contratos/ })).toContainText('Diagnóstico e configuração');
  await shot(page, 'frentes-painel');

  // Lucas conclui o primeiro marco (tarefas + marco)
  const pid = new URL(await panel.getByRole('link', { name: 'Contratos' }).getAttribute('href') ?? '', 'http://x').pathname.split('/').pop()!;
  const d = await (await lucas.request.get(`/api/v1/projects/${pid}`)).json();
  const m1 = d.milestones.find((m: { name: string }) => m.name === 'Diagnóstico e configuração');
  const H = { origin: new URL(lucas.url()).origin };
  for (const t of d.tasks.filter((x: { milestoneId: string }) => x.milestoneId === m1.id)) {
    const cur = await (await lucas.request.get(`/api/v1/tasks/${t.id}`)).json();
    expect((await lucas.request.patch(`/api/v1/tasks/${t.id}`, { headers: H, data: { rowVersion: cur.rowVersion ?? cur.task?.rowVersion, status: 'concluida' } })).status()).toBe(200);
  }
  expect((await lucas.request.patch(`/api/v1/projects/${pid}/milestones/${m1.id}`, { headers: H, data: { completed: true } })).status()).toBe(200);
  await lctx.close();

  // Carlos homologa pela aba Marcos
  await panel.getByRole('link', { name: 'Contratos' }).click();
  await expect(page.getByRole('tab', { name: /Marcos/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Critério de aceite:').first()).toBeVisible();
  await expect(page.getByText('Aguardando homologação')).toBeVisible();
  await page.getByRole('button', { name: 'Homologar', exact: true }).click();
  const hom = page.getByRole('dialog', { name: /Homologar/ });
  await expect(hom.getByRole('button', { name: 'Homologar', exact: true })).toBeDisabled();
  await hom.getByLabel('O que foi conferido').fill('Cadastros, usuários e permissões conferidos com o gestor');
  await hom.getByRole('button', { name: 'Homologar', exact: true }).click();
  await expect(page.getByText('Marco homologado')).toBeVisible();
  await expect(page.getByText(/Homologado em/)).toBeVisible();

  // Riscos e impedimentos
  await page.getByRole('tab', { name: 'Riscos e impedimentos' }).click();
  await page.getByRole('button', { name: 'Novo risco' }).click();
  const rk = page.getByRole('dialog', { name: 'Novo risco' });
  await rk.getByLabel('Risco').fill('Usuários sem tempo para homologar');
  await rk.getByLabel('Probabilidade').selectOption('alta');
  await rk.getByLabel('Impacto').selectOption('alto');
  await expect(rk.getByText('Crítico')).toBeVisible();
  await expect(rk.getByRole('button', { name: 'Salvar risco' })).toBeDisabled();
  await rk.getByLabel(/Plano de mitigação/).fill('Agendar as sessões de homologação com os gestores na primeira semana');
  await rk.getByRole('button', { name: 'Salvar risco' }).click();
  await expect(page.getByRole('region', { name: 'Riscos' }).getByText('Usuários sem tempo para homologar')).toBeVisible();
  await page.getByRole('button', { name: 'Novo impedimento' }).click();
  const im = page.getByRole('dialog', { name: 'Novo impedimento' });
  await im.getByLabel('O que está travando').fill('Setores dos usuários não cadastrados');
  await im.getByLabel('Gravidade').selectOption('alta');
  await im.getByRole('button', { name: 'Registrar impedimento' }).click();
  await expect(page.getByRole('region', { name: 'Impedimentos' }).getByText('Setores dos usuários não cadastrados')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Histórico de homologação' }).getByText('Diagnóstico e configuração')).toBeVisible();
  await shot(page, 'frentes-riscos');

  // Painel em Inteligência reflete homologação, risco e impedimento
  await page.goto(`/intelligence?v=projetos&tag=${encodeURIComponent(initiative)}`);
  const row = page.getByRole('region', { name: 'Painel das frentes' }).getByRole('row', { name: /Contratos/ });
  await expect(row).toContainText('1 de 6 homologado(s)');
  await expect(row).toContainText('Ajustes');
  await expect(row).toContainText('1 aberto(s), 1 alto(s)');
  await expect(page.getByRole('button', { name: 'Criar frentes da implantação' })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/projetos?v=painel&tag=${encodeURIComponent(initiative)}`);
  await expect(page.getByRole('region', { name: 'Painel das frentes' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(page, 'frentes-mobile');
});
