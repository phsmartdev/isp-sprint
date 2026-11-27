import { expect, test, type Page } from '@playwright/test';

/** Fura-fila: colaborador pede, a liderança decide com a análise de impacto; tocar o comercial pede a gerência. Dados fictícios. */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const monday = (d: Date) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const plus = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('fura-fila: pedido, análise na ordem 10 → 20 → 70 e aprovação gerencial para o comercial', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 950 });
  const st = Date.now().toString(36);
  const week = monday(new Date(Date.UTC(2060, 0, 3) + (Date.now() % 3000) * 7 * 86_400_000));
  await login(page, 'carlos@yepnet.test');
  const mods = await (await page.request.get('/api/v1/admin/modules')).json();
  const crm = (mods.items ?? mods.modules ?? []).find((m: { module: string }) => m.module === 'crm');
  const disabled = (crm?.disabledFeatures ?? crm?.config?.disabledFeatures ?? []).filter((f: string) => f !== 'crm.quadro_tarefas');
  expect((await page.request.put('/api/v1/admin/modules/crm', { data: { enabled: true, mode: 'todos', disabledFeatures: disabled, note: 'Teste: liga o quadro de tarefas' } })).ok()).toBe(true);
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  const residencial = lk.teams.find((t: { name: string }) => t.name === 'Residencial').id;
  const boards = await (await page.request.get('/api/v1/quadros')).json();
  if (!boards.items.find((b: { key: string; teamIds: string[] }) => b.key === 'comercial')?.teamIds.includes(residencial))
    expect((await page.request.put('/api/v1/quadros/comercial/config', { data: { teamIds: [residencial], wipLimit: 3, wipCountsWaiting: false } })).ok()).toBe(true);

  // tarefas do Lucas: hipótese 2h e comercial 4h na Sprint; duas demandas novas fora dela
  await login(page, 'lucas@yepnet.test');
  const mk = async (title: string) => (await (await page.request.post('/api/v1/tasks', { data: { title: `${title} ${st}` } })).json()).id as string;
  const H = await mk('Teste de hipótese fictício'), C = await mk('Proposta fictícia'), F1 = await mk('Urgência fictícia'), F2 = await mk('Urgência grande fictícia');
  const lucasId = (await (await page.request.get('/api/v1/me')).json()).user.id;

  await login(page, 'ana@yepnet.test');
  for (const [id, cat, min] of [[H, 'hipotese', 120], [C, 'comercial', 240], [F1, 'interno', 120], [F2, 'interno', 180]] as const) {
    const t = await (await page.request.get(`/api/v1/tasks/${id}`)).json();
    expect((await page.request.patch(`/api/v1/quadros/tarefas/${id}/planejamento`, { data: { rowVersion: t.rowVersion ?? t.task?.rowVersion, capacityCategory: cat, estimateMinutes: min } })).ok()).toBe(true);
  }
  const saved = await page.request.put('/api/v1/quadros/comercial/planejamento', { data: { week, objective: 'Semana fictícia', items: [H, C].map((activityId, n) => ({ activityId, ownerId: lucasId, estimateMinutes: [120, 240][n], dueOn: plus(week, 4), position: n })) } });
  expect(saved.ok()).toBe(true);
  const sprintId = (await saved.json()).sprintId;
  expect((await page.request.post(`/api/v1/quadros/comercial/sprints/${sprintId}/abrir`, { data: { justification: 'Semana fictícia combinada com a gerência' } })).ok()).toBe(true);

  // colaborador pede pela tela
  await login(page, 'lucas@yepnet.test');
  await page.goto(`/quadro/comercial?week=${week}`);
  await page.getByRole('button', { name: /^Fura-fila( \(\d+\))?$/ }).click();
  const list = page.getByRole('dialog', { name: 'Fura-filas da Sprint' });
  await list.getByRole('button', { name: 'Solicitar fura-fila' }).click();
  const form = page.getByRole('dialog', { name: 'Solicitar fura-fila' });
  await form.getByLabel('Tarefa').selectOption(F1);
  await form.getByLabel('Origem').fill('Cliente fictício');
  await form.getByLabel('Responsável').selectOption(lucasId);
  await form.getByLabel('Prazo necessário').fill(plus(week, 2));
  await form.getByLabel('Esforço estimado').fill('2h');
  await form.getByLabel('Justificativa').fill('Cliente fictício pediu ajuste urgente');
  await form.getByLabel('Motivo da urgência').fill('Instalação marcada');
  await form.getByLabel('Consequência de não fazer').fill('Perde a janela de instalação');
  await form.getByRole('button', { name: 'Solicitar' }).click();
  await expect(page.getByText('Fura-fila solicitado')).toBeVisible();
  const lucasView = page.getByRole('dialog', { name: 'Análise de impacto do fura-fila' });
  await expect(lucasView).toContainText('Aguardando a liderança');
  await expect(lucasView.getByRole('button', { name: 'Autorizar e replanejar' })).toHaveCount(0);

  // a liderança decide: hipótese sai primeiro, comercial intocado
  await login(page, 'ana@yepnet.test');
  await page.goto(`/quadro/comercial?week=${week}`);
  await expect(page.getByRole('region', { name: 'Resumo da Sprint' })).toContainText('1 aguardando');
  await page.getByRole('button', { name: /^Fura-fila( \(\d+\))?$/ }).click();
  await page.getByRole('dialog', { name: 'Fura-filas da Sprint' }).getByRole('button', { name: new RegExp(`Urgência fictícia ${st}`) }).click();
  const an = page.getByRole('dialog', { name: 'Análise de impacto do fura-fila' });
  await expect(an.getByRole('region', { name: 'Atividades impactadas' })).toContainText('1. Testes de hipóteses (10%)');
  await expect(an.getByLabel(`Deslocar Teste de hipótese fictício ${st}`)).toBeChecked();
  await expect(an.getByLabel(`Deslocar Proposta fictícia ${st}`)).not.toBeChecked();
  await expect(an.getByText('Aprovação gerencial obrigatória.')).toHaveCount(0);
  // tentar o comercial no lugar da hipótese quebra a ordem
  await an.getByLabel(`Deslocar Teste de hipótese fictício ${st}`).uncheck();
  await an.getByLabel(`Deslocar Proposta fictícia ${st}`).check();
  await expect(an).toContainText('Ordem de consumo');
  await expect(an.getByText('Aprovação gerencial obrigatória.')).toBeVisible();
  await an.getByLabel(`Deslocar Proposta fictícia ${st}`).uncheck();
  await an.getByLabel(`Deslocar Teste de hipótese fictício ${st}`).check();
  await an.getByLabel(`Novo prazo de Teste de hipótese fictício ${st}`).fill(plus(week, 9));
  await page.screenshot({ path: 'test-results/fura-fila-analise.png' });
  await an.getByRole('button', { name: 'Autorizar e replanejar' }).click();
  await expect(page.getByText('Fura-fila incluído na Sprint')).toBeVisible();
  await expect(page.getByRole('region', { name: 'A fazer' }).locator('article', { hasText: `Urgência fictícia ${st}` })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Backlog' }).locator('article', { hasText: `Teste de hipótese fictício ${st}` })).toBeVisible();

  // segunda demanda: só resta o comercial; a liderança pede aprovação da gerência
  const r2 = await page.request.post(`/api/v1/quadros/comercial/sprints/${sprintId}/fura-filas`, { data: { activityId: F2, origin: 'Cliente fictício', justification: 'Segunda urgência fictícia', urgency: 'Prazo do cliente', consequence: 'Multa contratual fictícia', neededBy: plus(week, 3), estimateMinutes: 180, ownerId: lucasId } });
  expect(r2.ok()).toBe(true);
  await page.goto(`/quadro/comercial?week=${week}&furafila=${(await r2.json()).id}`);
  const an2 = page.getByRole('dialog', { name: 'Análise de impacto do fura-fila' });
  await expect(an2.getByText('Aprovação gerencial obrigatória.')).toBeVisible();
  await expect(an2.getByRole('button', { name: 'Autorizar e replanejar' })).toHaveCount(0);
  await expect(an2.getByRole('button', { name: 'Solicitar aprovação gerencial' })).toBeDisabled();
  await an2.getByLabel(`Novo prazo de Proposta fictícia ${st}`).fill(plus(week, 11));
  await an2.getByLabel('Justificativa da decisão').fill('Prazo renegociado com o cliente fictício');
  await page.screenshot({ path: 'test-results/fura-fila-gerencia.png' });
  await an2.getByRole('button', { name: 'Solicitar aprovação gerencial' }).click();
  await expect(page.getByText('Enviado para aprovação da gerência')).toBeVisible();
  // nada muda enquanto a gerência não aprova
  await expect(page.getByRole('region', { name: 'A fazer' }).locator('article', { hasText: `Proposta fictícia ${st}` })).toBeVisible();
  // encerra a Sprint (um quadro só tem uma Sprint em andamento por vez)
  expect((await page.request.post(`/api/v1/quadros/comercial/sprints/${sprintId}/encerrar`, { data: {} })).ok()).toBe(true);
});
