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
  await page.locator('[data-testid="org-team"][aria-label="Time Residencial"]').getByRole('button', { name: /^Residencial/ }).click();
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

test('organograma: gestão funcional atrela setores e pessoas; o grupo só aparece solto na edição; marca BKT | RevOps', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1700, height: 1100 });
  await login(page, 'carlos@yepnet.test');
  const d = await (await page.request.get('/api/v1/admin/org-chart')).json() as { people: { id: string; name: string }[]; teams: { id: string; name: string; directorIds: string[]; managers: { userId: string; kind: string }[]; leadIds: string[]; memberIds: string[]; participantIds: string[] }[] };
  const id = (n: string) => d.people.find((p) => p.name.startsWith(n))!.id;
  const res = d.teams.find((t) => t.name === 'Residencial')!;
  await page.request.put(`/api/v1/admin/org-chart/teams/${res.id}`, { data: { directorIds: [id('Carlos')], managers: [{ userId: id('Carlos'), kind: 'hierarquico_funcional' }], leadIds: res.leadIds, memberIds: res.memberIds, participantIds: res.participantIds } });
  await page.goto('/settings/users?visao=organograma');
  await expect(page.getByLabel('BKT RevOps')).toBeVisible();
  await page.locator('[data-testid="org-team"][aria-label="Time Empresarial"]').getByRole('button', { name: /^Rafael Mendes/ }).click();
  const f = page.getByRole('complementary', { name: 'Acesso de Rafael Mendes' }).getByRole('form', { name: 'Gestão funcional' });
  await f.getByRole('group', { name: 'Setores (times inteiros)' }).getByRole('button', { name: 'Residencial' }).click();
  await f.getByRole('group', { name: 'Pessoas avulsas' }).getByRole('button', { name: 'Mariana Costa' }).click();
  await f.getByLabel('Nome do grupo de pessoas').fill('Negócios E2E');
  await f.getByRole('button', { name: 'Salvar gestão funcional' }).click();
  await expect(page.getByText('Gestão funcional atualizada')).toBeVisible();
  const dir = page.getByRole('region', { name: 'Diretoria de Carlos Silva' });
  const fb = dir.getByLabel('Gestão funcional de Rafael Mendes');
  await expect(fb.getByLabel('Time Residencial (gestão funcional)')).toBeVisible();
  await expect(fb.getByLabel('Time Negócios E2E (gestão funcional)')).toContainText('Mariana Costa');
  // o grupo não aparece solto fora da edição; na edição, aparece
  await expect(page.locator('[data-testid="org-team"][aria-label="Time Negócios E2E"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ajustar estrutura' }).click();
  await expect(page.locator('[data-testid="org-team"][aria-label="Time Negócios E2E"]')).toBeVisible();
  await page.getByRole('button', { name: 'Concluir ajustes' }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/organograma-funcional.png` });
  // desfaz
  const after = await (await page.request.get('/api/v1/admin/org-chart')).json() as { teams: { id: string; name: string }[] };
  await page.request.put(`/api/v1/admin/org-chart/functional/${id('Rafael')}`, { data: { teamIds: [], userIds: [] } });
  await page.request.delete(`/api/v1/admin/teams/${after.teams.find((t) => t.name === 'Negócios E2E')!.id}`);
  await page.request.put(`/api/v1/admin/org-chart/teams/${res.id}`, { data: { directorIds: res.directorIds, managers: res.managers, leadIds: res.leadIds, memberIds: res.memberIds, participantIds: res.participantIds } });
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

test('organograma: exportar em PNG e PDF o desenho inteiro, com a faixa da marca e sem botões', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/users?visao=organograma');
  await expect(page.getByRole('heading', { name: 'Organograma de acessos' })).toBeVisible();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar organograma em PNG' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/^organograma-crm-\d{4}-\d{2}-\d{2}\.png$/);
  const path = await file.path();
  const fs = await import('node:fs');
  const buf = fs.readFileSync(path);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  expect(w).toBeGreaterThanOrEqual(960);
  expect(h).toBeGreaterThan(400);
  // não pode sair em branco: a faixa da marca (escura) no topo e cartões (claros) no desenho
  const px = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
    const top = g.getImageData(40, 40, 1, 1).data;
    const all = g.getImageData(0, 0, c.width, c.height).data; const colors = new Set<number>();
    for (let i = 0; i < all.length; i += 4 * 97) colors.add((all[i]! << 16) | (all[i + 1]! << 8) | all[i + 2]!);
    return { top: [top[0], top[1], top[2]], colors: colors.size };
  }, buf.toString('base64'));
  expect(px.top[0]! + px.top[1]! + px.top[2]!).toBeLessThan(330);
  expect(px.colors).toBeGreaterThan(20);
  await expect(page.getByText('Organograma exportado em PNG')).toBeVisible();
  // a tela não muda: zoom e botões continuam lá, a cópia fora da tela foi removida
  await expect(page.locator('[aria-hidden="true"][style*="-100000px"]')).toHaveCount(0);
  if (SHOTS) fs.copyFileSync(path, `${SHOTS}/organograma-export.png`);
  // PDF: uma página com o mesmo desenho
  const dl2 = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar organograma em PDF' }).click();
  const pdf = await dl2;
  expect(pdf.suggestedFilename()).toMatch(/^organograma-crm-\d{4}-\d{2}-\d{2}\.pdf$/);
  const pb = fs.readFileSync(await pdf.path());
  expect(pb.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pb.length).toBeGreaterThan(20_000); // a imagem do desenho está embutida
  await expect(page.getByText('Organograma exportado em PDF')).toBeVisible();
  if (SHOTS) fs.copyFileSync(await pdf.path(), `${SHOTS}/organograma-export.pdf`);
});
