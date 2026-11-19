import { expect, test, type Page } from '@playwright/test';

/** Usuários → Organograma de acessos: estrutura, o que cada pessoa vê por módulo e as ações (bloquear/liberar, retirar). */
const SHOTS = process.env.ACADEMIA_SHOTS;
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('organograma: quem vê o quê no CRM, bloquear e retirar a regra pelo painel', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/users');
  await page.getByRole('tab', { name: 'Organograma de acessos' }).click();
  await expect(page.getByRole('heading', { name: 'Organograma de acessos' })).toBeVisible();
  const team = page.locator('[data-testid="org-team"][aria-label="Time Residencial"]');
  const lucas = team.getByRole('button', { name: /^Lucas Lima/ });
  await expect(lucas).toHaveAttribute('aria-label', /Só o próprio/);
  await expect(team.getByRole('button', { name: /^Ana Souza/ })).toHaveAttribute('aria-label', /: Time$/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/organograma.png`, fullPage: true });

  await lucas.click();
  const panel = page.getByRole('complementary', { name: 'Acesso de Lucas Lima' });
  await expect(panel.getByTestId('org-mod-crm')).toContainText('Só o próprio');
  await panel.getByTestId('org-mod-crm').getByRole('button', { name: 'Bloquear' }).click();
  await panel.getByLabel('Motivo para bloquear').fill('Teste E2E do organograma');
  await panel.getByRole('button', { name: 'Bloquear CRM' }).click();
  await expect(page.getByText('Módulo bloqueado')).toBeVisible();
  await expect(lucas).toHaveAttribute('aria-label', /Sem acesso/);
  await expect(panel.getByTestId('org-mod-crm')).toContainText('bloqueado para a pessoa');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/organograma-painel.png`, fullPage: true });
  await panel.getByTestId('org-mod-crm').getByRole('button', { name: 'Retirar regra' }).click();
  await panel.getByLabel('Por que retirar a regra?').fill('Fim do teste E2E do organograma');
  await panel.getByRole('button', { name: 'Retirar regra' }).last().click();
  await expect(lucas).toHaveAttribute('aria-label', /Só o próprio/);

  // painel do time e visão geral
  await page.getByRole('button', { name: /^Residencial/ }).click();
  await expect(page.getByRole('complementary', { name: 'Time Residencial' })).toContainText('Liderança: Ana Souza');
  await page.getByRole('button', { name: 'Visão geral' }).click();
  await expect(lucas).toHaveAttribute('aria-label', /^Lucas Lima, Operação$/);
});

test('organograma: ajustar topo, times (arrastar, incluir, tirar, gestores) e o nível do perfil', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1700, height: 1100 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/users?visao=organograma');
  // topo da estrutura, sem a marca: nome e cargo editáveis
  await page.getByRole('button', { name: 'Editar o topo da estrutura' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Welliton Sá');
  await page.getByLabel('Cargo').fill('Diretoria Executiva');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByTestId('org-top')).toContainText('Welliton Sá');
  await expect(page.getByTestId('org-top')).toContainText('Diretoria Executiva');

  // arrastar o Lucas do Residencial para o Governo
  await page.getByRole('button', { name: 'Ajustar estrutura' }).click();
  const res = page.locator('[data-testid="org-team"][aria-label="Time Residencial"]'), gov = page.locator('[data-testid="org-team"][aria-label="Time Governo"]');
  await res.getByRole('button', { name: /^Lucas Lima/ }).dragTo(gov);
  await expect(page.getByText('Pessoa movida de time')).toBeVisible();
  await expect(gov.getByRole('button', { name: /^Lucas Lima/ })).toBeVisible();
  await expect(res.getByRole('button', { name: /^Lucas Lima/ })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/organograma-ajuste.png`, fullPage: true });

  // pelo painel: tirar do Governo e incluir de volta no Residencial
  await gov.getByRole('button', { name: /^Lucas Lima/ }).click();
  const panel = page.getByRole('complementary', { name: 'Acesso de Lucas Lima' });
  await panel.getByRole('list', { name: 'Times da pessoa' }).getByRole('button', { name: 'Tirar do time' }).click();
  await expect(page.getByRole('region', { name: 'Pessoas sem time' })).toContainText('Lucas Lima');
  await panel.getByLabel('Incluir em outro time').selectOption({ label: 'Residencial' });
  await panel.getByRole('button', { name: 'Incluir', exact: true }).click();
  await expect(res.getByRole('button', { name: /^Lucas Lima/ })).toBeVisible();

  // nível do perfil Operação no CRM: confirma que vale para todo o perfil e reverte
  await panel.getByLabel('Nível do perfil Operação em CRM').selectOption('equipe');
  const dlg = page.getByRole('dialog', { name: 'Mudar o nível do perfil Operação?' });
  await expect(dlg).toContainText('Vale para as');
  await dlg.getByRole('button', { name: 'Mudar para todo o perfil' }).click();
  await expect(res.getByRole('button', { name: /^Lucas Lima/ })).toHaveAttribute('aria-label', /: Time$/);
  await panel.getByLabel('Nível do perfil Operação em CRM').selectOption('proprio');
  await page.getByRole('dialog', { name: 'Mudar o nível do perfil Operação?' }).getByRole('button', { name: 'Mudar para todo o perfil' }).click();
  await expect(res.getByRole('button', { name: /^Lucas Lima/ })).toHaveAttribute('aria-label', /Só o próprio/);

  // gestor do time: Carlos passa a gerir o Governo (o time vai para baixo dele) e depois sai
  await gov.getByRole('button', { name: /^Governo/ }).click();
  const tp = page.getByRole('complementary', { name: 'Time Governo' });
  await tp.getByRole('group', { name: /^Gestão/ }).getByRole('button', { name: 'Carlos Silva' }).click();
  await tp.getByRole('button', { name: 'Salvar time' }).click();
  await expect(page.getByText('Time atualizado')).toBeVisible();
  await expect(page.getByText('Sem gestão hierárquica').first()).toBeVisible(); // outros times seguem sem gestor
  await tp.getByRole('group', { name: /^Gestão/ }).getByRole('button', { name: 'Carlos Silva' }).click();
  await tp.getByRole('button', { name: 'Salvar time' }).click();
  await expect(page.getByText('Time atualizado').first()).toBeVisible();
});

test('organograma: diretoria, gestão hierárquica e funcional, participante fora do desenho e zoom', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/users?visao=organograma');
  // cabe na tela: o zoom já vem ajustado
  const zoom = page.getByTestId('org-zoom');
  await expect(zoom).toHaveText(/%$/);
  const z0 = parseInt((await zoom.textContent())!, 10);
  await page.getByRole('button', { name: 'Aumentar zoom' }).click();
  await expect.poll(async () => parseInt((await zoom.textContent())!, 10)).toBeGreaterThan(z0);
  await page.getByRole('button', { name: 'Ajustar à tela' }).click();
  await expect.poll(async () => parseInt((await zoom.textContent())!, 10)).toBe(z0);

  // Governo: diretoria Carlos; Carlos gestão hierárquica + funcional; Ana só funcional; Lucas participante
  const gov = page.locator('[data-testid="org-team"][aria-label="Time Governo"]');
  await gov.getByRole('button', { name: /^Governo/ }).click();
  const tp = page.getByRole('complementary', { name: 'Time Governo' });
  await tp.getByRole('group', { name: 'Diretoria' }).getByRole('button', { name: 'Carlos Silva' }).click();
  await tp.getByRole('group', { name: /^Gestão/ }).getByRole('button', { name: 'Carlos Silva' }).click();
  await tp.getByRole('group', { name: /^Gestão/ }).getByRole('button', { name: 'Ana Souza' }).click();
  await tp.getByLabel('Tipo de gestão de Ana Souza').selectOption('funcional');
  await tp.getByRole('group', { name: /^Participantes/ }).getByRole('button', { name: 'Lucas Lima' }).click();
  await tp.getByRole('button', { name: 'Salvar time' }).click();
  await expect(page.getByText('Time atualizado')).toBeVisible();

  await expect(page.getByRole('region', { name: 'Diretoria de Carlos Silva' })).toBeVisible();
  await expect(gov.getByLabel('Gestão do time Governo')).toContainText('Hierárq. + funcional: Carlos Silva');
  await expect(gov.getByLabel('Gestão do time Governo')).toContainText('Funcional: Ana Souza');
  // como no desenho: a gestão só funcional (Ana) fica embaixo da mesma diretoria, ao lado da hierárquica, ligada ao time por tracejado
  const dir = page.getByRole('region', { name: 'Diretoria de Carlos Silva' });
  await expect(dir.getByLabel('Gestão funcional de Ana Souza')).toBeVisible();
  // o time é replicado inteiro embaixo da gestão funcional, em outra cor, com a mesma composição
  const replica = dir.getByLabel('Time Governo (gestão funcional)');
  await expect(replica).toBeVisible();
  await expect(replica.getByRole('button', { name: /^Mariana Costa/ })).toBeVisible();
  await expect(replica).toContainText('Réplica do time');
  await expect(page.getByTestId('org-legend')).toContainText('Mesmo time replicado na gestão funcional');
  await expect(page.getByTestId('org-legend')).toContainText('Time na gestão hierárquica');
  await expect(page.getByRole('region', { name: 'Gestão só funcional' })).toHaveCount(0);
  // Lucas colabora: fica fora do desenho do Governo
  await expect(gov.getByRole('button', { name: /^Lucas Lima/ })).toHaveCount(0);
  await expect(gov).toContainText('1 participante(s) colaborando');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/organograma-hierarquia.png` });

  // desfaz
  await tp.getByRole('group', { name: 'Diretoria' }).getByRole('button', { name: 'Carlos Silva' }).click();
  await tp.getByRole('group', { name: /^Gestão/ }).getByRole('button', { name: 'Carlos Silva' }).click();
  await tp.getByRole('group', { name: /^Gestão/ }).getByRole('button', { name: 'Ana Souza' }).click();
  await tp.getByRole('group', { name: /^Participantes/ }).getByRole('button', { name: 'Lucas Lima' }).click();
  await tp.getByRole('button', { name: 'Salvar time' }).click();
  await expect(page.getByText('Time atualizado').first()).toBeVisible();
});

test('organograma: gestão funcional no mesmo nível da hierárquica, com os dois times replicados e participantes abaixo', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1700, height: 1100 });
  await login(page, 'carlos@yepnet.test');
  const d = await (await page.request.get('/api/v1/admin/org-chart')).json() as { people: { id: string; name: string }[]; teams: { id: string; name: string; directorIds: string[]; managers: unknown[]; leadIds: string[]; memberIds: string[]; participantIds: string[] }[] };
  const id = (n: string) => d.people.find((p) => p.name.startsWith(n))!.id;
  const before = d.teams.filter((t) => t.name === 'Residencial' || t.name === 'Empresarial');
  for (const t of before) {
    const extra = t.name === 'Empresarial' ? [id('Mariana')] : [];
    const r = await page.request.put(`/api/v1/admin/org-chart/teams/${t.id}`, { data: { directorIds: [id('Carlos')], managers: [{ userId: id('Carlos'), kind: 'hierarquico_funcional' }, { userId: id('Rafael'), kind: 'funcional' }], leadIds: t.leadIds, memberIds: t.memberIds.filter((x) => !extra.includes(x)), participantIds: [...t.participantIds, ...extra] } });
    expect(r.status(), await r.text()).toBe(200);
  }
  await page.goto('/settings/users?visao=organograma');
  const dir = page.getByRole('region', { name: 'Diretoria de Carlos Silva' });
  const hier = dir.getByTestId('org-person').filter({ has: page.getByText('Gestão', { exact: true }) }).filter({ hasText: 'Carlos Silva' });
  const func = dir.getByTestId('org-person').filter({ has: page.getByText('Gestão funcional', { exact: true }) }).filter({ hasText: 'Rafael Mendes' });
  const yh = (await hier.boundingBox())!.y, yf = (await func.boundingBox())!.y;
  expect(Math.abs(yh - yf)).toBeLessThan(4); // mesmo nível, abaixo da diretoria
  const fb = dir.getByLabel('Gestão funcional de Rafael Mendes');
  await expect(fb.getByLabel('Time Empresarial (gestão funcional)')).toBeVisible();
  await expect(fb.getByLabel('Time Residencial (gestão funcional)')).toBeVisible();
  // participante aparece abaixo, na réplica funcional; no time hierárquico, fica fora do desenho
  await expect(fb.getByLabel('Time Empresarial (gestão funcional)').getByRole('button', { name: /^Mariana Costa/ })).toBeVisible();
  await expect(page.locator('[data-testid="org-team"][aria-label="Time Empresarial"]').getByRole('button', { name: /^Mariana Costa/ })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/organograma-funcional.png` });
  for (const t of before) await page.request.put(`/api/v1/admin/org-chart/teams/${t.id}`, { data: { directorIds: t.directorIds, managers: t.managers, leadIds: t.leadIds, memberIds: t.memberIds, participantIds: t.participantIds } });
});

test('organograma: só a administração acessa', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await page.goto('/settings/users?visao=organograma');
  await expect(page.getByRole('heading', { name: 'Organograma de acessos' })).toHaveCount(0);
  // sem autorização, nem pelo link de consulta
  await page.goto('/times/organograma');
  await expect(page.getByText('Organograma restrito')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Organograma', exact: true })).toHaveCount(0);
});

test('organograma: a Administração autoriza quem vê; a pessoa autorizada só consulta', async ({ page }) => {
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/users?visao=organograma');
  await page.getByRole('button', { name: 'Quem pode ver' }).click();
  const dlg = page.getByRole('dialog', { name: 'Quem pode ver o organograma' });
  await dlg.getByRole('group', { name: 'Pessoas autorizadas' }).getByRole('button', { name: 'Lucas Lima' }).click();
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Quem pode ver o organograma foi atualizado')).toBeVisible();

  await login(page, 'lucas@yepnet.test');
  await page.goto('/times/organograma');
  await expect(page.getByRole('heading', { name: 'Organograma de acessos' })).toBeVisible();
  await expect(page.getByText('Só consulta').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Organograma', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajustar estrutura' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Quem pode ver' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar o topo da estrutura' })).toHaveCount(0);
  await page.locator('[data-testid="org-team"][aria-label="Time Residencial"]').getByRole('button', { name: /^Lucas Lima/ }).click();
  const panel = page.getByRole('complementary', { name: 'Acesso de Lucas Lima' });
  await expect(panel.getByTestId('org-mod-crm')).toContainText('Só o próprio');
  await expect(panel.getByRole('button', { name: 'Bloquear' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Trocar perfil' })).toHaveCount(0);

  // a Administração retira a autorização
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/users?visao=organograma');
  await page.getByRole('button', { name: 'Quem pode ver' }).click();
  await page.getByRole('dialog', { name: 'Quem pode ver o organograma' }).getByRole('group', { name: 'Pessoas autorizadas' }).getByRole('button', { name: 'Lucas Lima' }).click();
  await page.getByRole('dialog', { name: 'Quem pode ver o organograma' }).getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Quem pode ver o organograma foi atualizado')).toBeVisible();
  await login(page, 'lucas@yepnet.test');
  await page.goto('/times/organograma');
  await expect(page.getByText('Organograma restrito')).toBeVisible();
});
