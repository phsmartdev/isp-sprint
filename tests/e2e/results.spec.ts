import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

test('Gestão de Times: estrutura organizacional e perspectivas por responsabilidade', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/resultados');
  await page.getByRole('button', { name: 'Nova unidade' }).click();
  let d = page.getByRole('dialog', { name: 'Nova unidade' });
  await d.getByLabel('Nome').fill('Diretoria Comercial E2E');
  await d.getByLabel('Tipo').selectOption('diretoria');
  await d.getByLabel('Responsável').selectOption({ label: 'Carlos Silva' });
  await d.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Diretoria Comercial E2E', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Nova unidade' }).click();
  d = page.getByRole('dialog', { name: 'Nova unidade' });
  await d.getByLabel('Nome').fill('Área Empresarial E2E');
  await d.getByLabel('Unidade superior').selectOption({ label: 'Diretoria Comercial E2E' });
  await d.getByLabel('Responsável').selectOption({ label: 'Ana Souza' });
  await d.getByLabel('Alçada para aprovar (R$)').fill('50.000,00');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Área Empresarial E2E', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Unidade do time Empresarial').selectOption({ label: 'Área Empresarial E2E' });
  await expect(page.getByText('Time atualizado')).toBeVisible();
  await shot(page, 'gr-estrutura');

  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: /^Gestão de Times/ }).click();
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Visão geral', exact: true }).click();
  await expect(page).toHaveURL(/\/times/);
  await expect(page.getByRole('heading', { name: 'Gestão de Times', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Diretoria' })).toBeVisible();
  await expect(page.getByText('Estamos alcançando os objetivos do negócio?')).toBeVisible();
  await page.getByRole('tab', { name: 'Gestão' }).click();
  await expect(page.getByText('As equipes e os processos estão entregando o resultado esperado?')).toBeVisible();
  await shot(page, 'gr-perspectivas');
});

test('Apuração oficial: fechamento, validação e pedido de revisão', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const H = { origin: new URL(page.url()).origin };
  const api = async (method: 'get' | 'post', url: string, data?: object) => { const r = await page.request[method](`/api/v1${url}`, { headers: H, ...(data ? { data } : {}) }); expect(r.status(), await r.text()).toBeLessThan(300); return r.json(); };
  const users = (await api('get', '/admin/users')).users as { id: string; email: string }[];
  const lucas = users.find((u) => u.email === 'lucas@yepnet.test')!.id;
  const ind = (await api('post', '/performance/indicators', { def: { name: 'Tarefas E2E GR', category: 'tarefas', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'tarefa_concluida', measure: 'contagem' } } })).id;
  const past = (await api('post', '/performance/goals', { title: 'Meta fechada de janeiro', scope: 'individual', userId: lucas, indicatorId: ind, periodType: 'personalizado', periodStart: '2026-01-01', periodEnd: '2026-01-31', target: 6 })).id;
  await api('post', '/performance/goals', { title: 'Meta do mês do Lucas', scope: 'individual', userId: lucas, indicatorId: ind, periodType: 'mes', target: 6, recurring: true });
  await page.goto(`/desempenho/metas?goal=${past}`);
  const dr = page.getByRole('dialog', { name: 'Meta' });
  await expect(dr.getByText('Apuração oficial')).toBeVisible();
  await expect(dr.getByText(/Consolidado · v1/)).toBeVisible();
  await dr.getByRole('button', { name: 'Conferir dados de origem' }).click();
  await expect(dr.getByText(/Os dados (de origem não mudaram|mudaram)/)).toBeVisible();
  await dr.getByRole('button', { name: 'Validar apuração' }).click();
  await expect(dr.getByText(/Validado · v2/)).toBeVisible();
  await shot(page, 'gr-apuracao');
  await dr.getByRole('button', { name: 'Fechar' }).click();

  await page.getByRole('button', { name: /^Conta de / }).click();
  await page.getByRole('menuitem', { name: /Sair/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, 'lucas@yepnet.test');
  await page.goto('/desempenho/metas');
  await page.getByRole('button', { name: /Meta do mês do Lucas/ }).click();
  const d2 = page.getByRole('dialog', { name: 'Meta' });
  await d2.getByLabel('Alvo proposto').fill('4');
  await d2.getByLabel('Justificativa').fill('Uma semana de treinamento obrigatório');
  await d2.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.getByText('Pedido de revisão enviado à liderança')).toBeVisible();
});

test('Marketing → ABM e Produto no menu agrupado', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  await nav.getByRole('button', { name: /^Comercial/ }).click();
  await expect(nav.getByRole('link', { name: 'Contas', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: /^Marketing/ }).click();
  await nav.getByRole('link', { name: 'ABM', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ABM', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar conta-alvo' }).first().click();
  const d = page.getByRole('dialog', { name: 'Adicionar conta-alvo' });
  await d.getByLabel(/^Conta/).fill('Mendes');
  const pickBtn = d.getByRole('listitem').first().getByRole('button');
  const picked = ((await pickBtn.textContent()) ?? '').replace(/·.*/, '').trim();
  await pickBtn.click();
  await d.getByLabel('Tier').selectOption('1_1');
  await d.getByLabel(/Por que é alvo/).fill('Conta com potencial para link dedicado (E2E)');
  await d.getByRole('button', { name: 'Adicionar', exact: true }).click();
  // se a conta já era alvo (execução anterior), a API recusa a duplicata; a linha precisa existir de qualquer forma
  await expect(page.getByText(/Conta-alvo adicionada|já está na lista de ABM/).first()).toBeVisible();
  if (await d.isVisible()) await d.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByLabel('Buscar conta').fill(picked);
  await page.getByRole('button', { name: picked, exact: true }).click();
  const dr = page.getByRole('dialog', { name: 'Conta-alvo' });
  await dr.getByLabel('Situação').selectOption('engajando');
  await dr.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Conta-alvo atualizada')).toBeVisible();
  await expect(dr.getByText(/mudou a situação para Engajando|atualizou/).first()).toBeVisible();
  await shot(page, 'abm');

  await page.keyboard.press('Escape');
  await nav.getByRole('link', { name: 'Produto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Produto', level: 1 })).toBeVisible();
  await expect(page.getByText('800 Mega').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Editar catálogo' })).toBeVisible();
  await shot(page, 'produto');
});
