import { expect, test } from '@playwright/test';

/** Comentário formatado no histórico; cartão do funil mostra a tarefa aberta; título da negociação em destaque. */
const SHOTS = process.env.E2E_SHOTS;
test('histórico com formatação, tarefa no cartão e título em destaque', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('lucas@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  const tag = Date.now().toString(36);
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  const p = lk.pipelines.find((x: { key: string }) => x.key === 'empresarial');
  const cr = await page.request.post('/api/v1/opportunities', { data: { newContact: { name: `Conselho Regional ${tag}`, segment: 'governamental' }, title: `Edital ${tag} - Link 500 Mbps`, pipelineId: p.id, saleKind: 'venda_consultiva', branchId: lk.branches[0].id } });
  expect(cr.status(), await cr.text()).toBe(201);
  const o = await cr.json();
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const t = await page.request.post('/api/v1/activities', { data: { type: 'tarefa', title: `Enviar documentação ${tag}`, dueAt: due, opportunityId: o.id } });
  expect(t.status(), await t.text()).toBe(201);

  // título da negociação em destaque, a conta embaixo
  await page.goto(`/opportunities/${o.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Edital ${tag} - Link 500 Mbps`);
  await expect(page.locator('h1 + p')).toContainText(`Conselho Regional ${tag}`);

  // comentário com negrito, itálico, tamanho, lista e link
  const box = page.getByLabel('Comentário', { exact: true });
  await box.fill('Resumo da sessão');
  await box.selectText();
  await page.getByLabel('Tamanho da fonte').selectOption('h2');
  await box.press('End');
  await box.press('Enter');
  await box.pressSequentially('Prazo ');
  await box.press('Control+b');
  await box.pressSequentially('sexta');
  await box.press('ArrowRight'); await box.press('ArrowRight');
  await box.pressSequentially(' e documento ');
  await page.getByRole('button', { name: 'Itálico' }).click();
  await box.pressSequentially('assinado');
  await box.press('End');
  await box.press('Enter');
  await box.pressSequentially('Certidão\nAtestado');
  await box.press('Shift+ArrowUp');
  await page.getByRole('button', { name: 'Lista com marcadores' }).click();
  await box.press('Control+End');
  await box.press('Enter');
  await page.getByRole('button', { name: 'Inserir link' }).click();
  await page.getByLabel('Endereço do link').fill('portal.exemplo.gov.br/edital');
  await page.getByLabel('Texto que aparece').fill('Edital no portal');
  await page.getByRole('button', { name: 'Inserir', exact: true }).click();
  await expect(box).toHaveValue('## Resumo da sessão\nPrazo **sexta** e documento _assinado_\n- Certidão\n- Atestado\n[Edital no portal](https://portal.exemplo.gov.br/edital)');
  await expect(page.getByLabel('Pré-visualização do comentário').locator('strong')).toHaveText('sexta');
  await page.getByRole('button', { name: 'Comentar' }).click();
  await expect(page.getByText('Comentário registrado')).toBeVisible();
  const item = page.locator('ol li').filter({ hasText: 'comentou' }).first();
  await expect(item.locator('strong')).toHaveText('sexta');
  await expect(item.locator('em')).toHaveText('assinado');
  await expect(item.locator('ul li')).toHaveText(['Certidão', 'Atestado']);
  await expect(item.getByRole('link', { name: 'Edital no portal' })).toHaveAttribute('href', 'https://portal.exemplo.gov.br/edital');
  await expect(item.locator('p.text-base')).toHaveText('Resumo da sessão');
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/historico.png` });

  // cartão do funil mostra a tarefa aberta (não "Sem tarefa")
  await page.goto(`/opportunities?view=kanban&pipelineId=${p.id}`);
  const card = page.locator('li').filter({ hasText: `Edital ${tag} - Link 500 Mbps` }).first();
  await expect(card).toContainText(`Enviar documentação ${tag}`);
  await expect(card).not.toContainText('Sem tarefa');
  if (SHOTS) await card.screenshot({ path: `${SHOTS}/cartao.png` });
});
