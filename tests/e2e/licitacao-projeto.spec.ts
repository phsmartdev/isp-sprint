import { expect, test } from '@playwright/test';

/** Licitações · L1: o projeto nasce com a oportunidade de licitação e o modelo é versionado (rascunho → aprovação → publicado). */
test('projeto de licitação na oportunidade e modelo versionado', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  const api = page.request;
  const lk = await (await api.get('/api/v1/meta/lookups')).json();
  const p = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
  const tag = Date.now().toString(36);
  const r = await api.post('/api/v1/opportunities', { data: { newContact: { name: `Órgão E2E ${tag}`, segment: 'governamental' }, title: `PE ${tag} – Link dedicado`, pipelineId: p.id, saleKind: 'licitacao', branchId: lk.branches[0].id, custom: { tipo_disputa: 'Aberta', lance_inicial: 1000, lance_minimo: 800, objeto: 'Link dedicado' } } });
  expect(r.status(), await r.text()).toBe(201);
  const o = await r.json();

  await page.goto(`/opportunities/${o.id}?aba=licitacao`);
  const card = page.getByRole('article', { name: `Projeto Licitação · PE ${tag} – Link dedicado` });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Etapa 1 — Cadastrar oportunidade');
  await expect(card).toContainText('Criado com a oportunidade');
  await expect(card.getByRole('progressbar', { name: 'Progresso do projeto' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Tarefas/ })).toHaveText('Tarefas'); // as tarefas do projeto não lotam a negociação
  await page.screenshot({ path: 'test-results/licitacao-projeto.png', fullPage: true });

  // modelo: nova versão, edição, envio, aprovação
  await page.goto('/settings/modelos?aba=licitacao');
  await expect(page.getByRole('heading', { name: 'Rito padrão de licitações' })).toBeVisible();
  const discard = page.getByRole('button', { name: 'Descartar rascunho' });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await page.getByRole('button', { name: 'Nova versão a partir desta' }).click();
  await expect(page.getByText(/criada em rascunho/)).toBeVisible();
  await page.getByLabel('O que muda nesta versão').fill('Visita técnica na etapa 1');
  const etapas = page.getByRole('list', { name: 'Macrotarefas da etapa 1' });
  await page.getByRole('button', { name: 'Adicionar macrotarefa' }).first().click();
  await etapas.getByLabel('Nome da macrotarefa').last().fill('Visita técnica ao órgão');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText('Rascunho salvo')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(page.getByText('Enviado para aprovação')).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar ou devolver' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Aprovar e publicar' }).click();
  await expect(page.getByText(/publicada$/)).toBeVisible();
  await page.screenshot({ path: 'test-results/licitacao-modelo.png', fullPage: true });
});

test('planejamento: marcos do edital, edição em linha e em lote, cronograma e dependências', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  const api = page.request;
  const lk = await (await api.get('/api/v1/meta/lookups')).json();
  const p = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
  const tag = Date.now().toString(36);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const o = await (await api.post('/api/v1/opportunities', { data: { newContact: { name: `Órgão Plano ${tag}`, segment: 'governamental' }, title: `PE ${tag}`, pipelineId: p.id, saleKind: 'licitacao', branchId: lk.branches[0].id, custom: { tipo_disputa: 'Aberta', lance_inicial: 1000, lance_minimo: 800, prazo_proposta: day(30), data_sessao: day(31) } } })).json();
  await page.goto(`/opportunities/${o.id}?aba=licitacao`);
  await page.getByRole('link', { name: 'Planejamento' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Planejamento · Licitação · PE ${tag}`) })).toBeVisible();

  // marcos: valida a proposta com nova data → oferece recalcular
  const marcos = page.getByRole('region', { name: 'Marcos do edital' });
  await marcos.getByLabel('Data: Prazo de envio da proposta').fill(day(40));
  await marcos.getByLabel('Fonte: Prazo de envio da proposta').fill('Edital, item 6.1');
  await marcos.getByLabel('Validada com o edital: Prazo de envio da proposta').check();
  await marcos.getByRole('button', { name: 'Salvar marcos' }).click();
  const rc = page.getByRole('dialog', { name: 'Recalcular prazos pelo edital' });
  await expect(rc).toContainText('Proposta e anexos');
  await rc.getByRole('button', { name: /^Aplicar em/ }).click();
  await expect(page.getByText('Prazos recalculados')).toBeVisible();

  // Gantt: abre primeiro; arrastar a barra move a macrotarefa
  const gantt = page.getByRole('region', { name: 'Gantt do projeto' });
  await expect(gantt).toBeVisible();
  await gantt.getByRole('button', { name: 'Dia' }).click();
  const bar = gantt.getByRole('img', { name: /^Viabilidade técnica:/ });
  await bar.scrollIntoViewIfNeeded();
  const before = await bar.getAttribute('aria-label');
  const bb = (await bar.boundingBox())!;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + 34 * 2, bb.y + bb.height / 2, { steps: 6 });
  const saved = page.waitForResponse((r) => r.url().includes('/licitacao/tarefas') && r.request().method() === 'PATCH');
  await page.mouse.up();
  expect((await saved).status()).toBe(200);
  await expect(bar).not.toHaveAttribute('aria-label', before!);
  await page.screenshot({ path: 'test-results/licitacao-gantt.png', fullPage: false });
  await page.getByRole('tab', { name: 'Tabela' }).click();

  // em linha: entregável e critério de aceite
  const tabela = page.getByRole('region', { name: 'Tabela do planejamento' });
  await tabela.getByLabel('Entregável: Análise técnica').fill('Parecer técnico');
  await tabela.getByLabel('Entregável: Análise técnica').blur();
  await expect(tabela.getByText('defina o critério de aceite.')).toBeVisible();
  await tabela.getByLabel('Critério de aceite: Análise técnica').fill('Parecer assinado cobrindo o TR');
  await tabela.getByLabel('Critério de aceite: Análise técnica').blur();
  await expect(tabela.getByText('defina o critério de aceite.')).toHaveCount(0);
  // em lote: duas macrotarefas para Jurídico
  await tabela.getByLabel('Selecionar Análise administrativa e comercial').check();
  await tabela.getByLabel('Selecionar Envio da oportunidade aos setores').check();
  await page.getByRole('toolbar', { name: 'Ações em lote' }).getByLabel('Área em lote').selectOption('juridico');
  await expect(tabela.getByLabel('Área: Envio da oportunidade aos setores')).toHaveValue('juridico');
  await page.screenshot({ path: 'test-results/licitacao-planejamento.png', fullPage: false });

  await page.getByRole('tab', { name: 'Dependências' }).click();
  const deps = page.getByRole('region', { name: 'Dependências' });
  await deps.getByRole('listitem').filter({ hasText: 'Envio no portal' }).getByRole('button', { name: 'Predecessoras' }).click();
  const dlg = page.getByRole('dialog', { name: 'Predecessoras de "Envio no portal"' });
  await dlg.getByLabel(/Habilitação jurídica e fiscal/).check();
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await expect(deps.getByRole('listitem').filter({ hasText: 'Envio no portal' })).toContainText('depende de: Habilitação jurídica e fiscal');
});

test('RACI e aprovação do plano: analista submete, aprovador decide no sistema', async ({ browser }) => {
  test.setTimeout(150_000);
  const as = async (email: string) => {
    const ctx = await browser.newContext({ baseURL: 'http://localhost:5174', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
    return page;
  };
  const admin = await as('carlos@yepnet.test');
  const me = await (await admin.request.get('/api/v1/me')).json();
  // configuração: áreas e aprovador do plano (pela tela)
  await admin.goto('/settings/modelos?aba=licitacao');
  await admin.getByRole('region', { name: 'Aprovadores por decisão' }).getByLabel('Planejamento').selectOption(me.user.id);
  await expect(admin.getByText('Aprovador salvo')).toBeVisible();

  const analyst = await as('lucas@yepnet.test');
  const lk = await (await analyst.request.get('/api/v1/meta/lookups')).json();
  const p = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
  const tag = Date.now().toString(36);
  const o = await (await analyst.request.post('/api/v1/opportunities', { data: { newContact: { name: `Órgão Aprov ${tag}`, segment: 'governamental' }, title: `PE ${tag}`, pipelineId: p.id, saleKind: 'licitacao', branchId: lk.branches[0].id, custom: { tipo_disputa: 'Aberta', lance_inicial: 1000, lance_minimo: 800 } } })).json();
  const pid = (await (await analyst.request.get(`/api/v1/opportunities/${o.id}/licitacao/projetos`)).json()).items[0].id;
  await analyst.goto(`/licitacoes/projetos/${pid}/planejamento`);
  await analyst.getByRole('button', { name: 'Enviar plano para aprovação' }).click();
  const card = analyst.getByRole('region', { name: 'Aprovação: Planejamento' });
  await card.getByRole('button', { name: 'Submeter' }).click();
  const dlg = analyst.getByRole('dialog', { name: 'Submeter: Planejamento' });
  await dlg.getByLabel('Justificativa').fill('Plano inicial com áreas e prazos do edital');
  await dlg.getByRole('button', { name: /^Enviar para/ }).click();
  await expect(card).toContainText('Aguardando aprovação');
  await expect(card).toContainText(`aguardando ${me.user.name}`);

  await admin.goto(`/licitacoes/projetos/${pid}/planejamento`);
  await admin.getByRole('tab', { name: 'Aprovações' }).click();
  const c2 = admin.getByRole('region', { name: 'Aprovação: Planejamento' });
  await c2.getByRole('button', { name: 'Decidir' }).click();
  const dd = admin.getByRole('dialog', { name: /^Decidir:/ });
  await dd.getByLabel('Parecer').fill('Plano ok');
  await dd.getByRole('button', { name: 'Aprovar' }).click();
  await expect(c2).toContainText('Aprovado');
  await expect(admin.getByText('Plano: Aprovado')).toBeVisible();
  await admin.screenshot({ path: 'test-results/licitacao-aprovacoes.png', fullPage: false });
  await admin.getByRole('tab', { name: 'Matriz RACI' }).click();
  await expect(admin.getByRole('region', { name: 'Matriz RACI' })).toContainText('Análise técnica');
  await admin.request.put('/api/v1/licitacoes/governanca/aprovadores/plano', { data: { approverId: null } });
});
