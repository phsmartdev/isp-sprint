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
  await expect(card).toContainText('Etapa 1 — Identificação e abertura');
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
  await expect(rc).toContainText('Proposta comercial');
  await rc.getByRole('button', { name: /^Aplicar em/ }).click();
  await expect(page.getByText('Prazos recalculados')).toBeVisible();

  // em linha: entregável e critério de aceite
  const tabela = page.getByRole('region', { name: 'Tabela do planejamento' });
  await tabela.getByLabel('Entregável: Análise técnica').fill('Parecer técnico');
  await tabela.getByLabel('Entregável: Análise técnica').blur();
  await expect(tabela.getByText('defina o critério de aceite.')).toBeVisible();
  await tabela.getByLabel('Critério de aceite: Análise técnica').fill('Parecer assinado cobrindo o TR');
  await tabela.getByLabel('Critério de aceite: Análise técnica').blur();
  await expect(tabela.getByText('defina o critério de aceite.')).toHaveCount(0);
  // em lote: duas macrotarefas para Jurídico
  await tabela.getByLabel('Selecionar Análise administrativa').check();
  await tabela.getByLabel('Selecionar Matriz de requisitos').check();
  await page.getByRole('toolbar', { name: 'Ações em lote' }).getByLabel('Área em lote').selectOption('juridico');
  await expect(tabela.getByLabel('Área: Matriz de requisitos')).toHaveValue('juridico');
  await page.screenshot({ path: 'test-results/licitacao-planejamento.png', fullPage: false });

  await page.getByRole('tab', { name: 'Cronograma' }).click();
  await expect(page.getByRole('region', { name: 'Cronograma' })).toContainText('Prazo de envio da proposta');
  await page.getByRole('tab', { name: 'Dependências' }).click();
  const deps = page.getByRole('region', { name: 'Dependências' });
  await deps.getByRole('listitem').filter({ hasText: 'Revisão documental' }).getByRole('button', { name: 'Predecessoras' }).click();
  const dlg = page.getByRole('dialog', { name: 'Predecessoras de "Revisão documental"' });
  await dlg.getByLabel(/Documentação de habilitação/).check();
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await expect(deps.getByRole('listitem').filter({ hasText: 'Revisão documental' })).toContainText('depende de: Documentação de habilitação');
});
