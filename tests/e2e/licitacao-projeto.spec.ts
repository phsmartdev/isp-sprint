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
