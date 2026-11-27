import { expect, test, type Page } from '@playwright/test';

/** Projeto com atividades em dois departamentos, dependência entre times com risco e o painel Departamentos. Dados fictícios. */
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const plus = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('atividade de projeto no quadro do time, dependência de outro departamento em risco e o projeto por departamento', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 950 });
  const st = Date.now().toString(36);
  await login(page, 'carlos@yepnet.test');
  const api = page.request;
  const mods = await (await api.get('/api/v1/admin/modules')).json();
  const crm = (mods.items ?? mods.modules ?? []).find((m: { module: string }) => m.module === 'crm');
  const disabled = (crm?.disabledFeatures ?? crm?.config?.disabledFeatures ?? []).filter((f: string) => !['crm.quadro_tarefas', 'crm.quadro_sucesso'].includes(f));
  expect((await api.put('/api/v1/admin/modules/crm', { data: { enabled: true, mode: 'todos', disabledFeatures: disabled, note: 'Teste: liga os quadros' } })).ok()).toBe(true);
  const lk = await (await api.get('/api/v1/meta/lookups')).json();
  const team = (n: string) => lk.teams.find((t: { name: string }) => t.name === n).id;
  const user = (email: string) => lk.users.find((u: { email?: string; name: string }) => u.email === email || u.name === email)?.id;
  const cfg = (await (await api.get('/api/v1/quadros')).json()).items as { key: string; teamIds: string[] }[];
  for (const [key, name] of [['comercial', 'Residencial'], ['sucesso_cliente', 'Empresarial']] as const)
    if (!cfg.find((b) => b.key === key)?.teamIds.includes(team(name)))
      expect((await api.put(`/api/v1/quadros/${key}/config`, { data: { teamIds: [team(name)], wipLimit: 3, wipCountsWaiting: false } })).ok()).toBe(true);
  const lucas = user('Lucas Lima'), rafael = user('Rafael Mendes');
  const p = await api.post('/api/v1/projects', { data: { name: `Planejamento Estratégico fictício ${st}`, startOn: plus(0), members: [{ userId: lucas, role: 'membro' }, { userId: rafael, role: 'membro' }] } });
  expect(p.ok(), await p.text()).toBe(true);
  const pid = (await p.json()).id;
  expect((await api.post(`/api/v1/projects/${pid}/tasks`, { data: { title: `Definir metas de receita ${st}`, ownerId: lucas, dueOn: plus(20) } })).ok()).toBe(true);
  expect((await api.post(`/api/v1/projects/${pid}/tasks`, { data: { title: `Definir estratégia de retenção ${st}`, ownerId: rafael, dueOn: plus(25) } })).ok()).toBe(true);

  // a atividade do projeto aparece sozinha no quadro do Comercial; Lucas liga a dependência ao time de Sucesso do Cliente
  await login(page, 'lucas@yepnet.test');
  await page.goto('/quadro/comercial');
  const card = page.getByRole('region', { name: 'Backlog' }).locator('article', { hasText: `Definir metas de receita ${st}` });
  await expect(card).toBeVisible();
  await card.click();
  const drawer = page.getByRole('dialog').last();
  await drawer.getByLabel('Buscar tarefa da qual esta depende').fill(`retenção ${st}`);
  await drawer.getByRole('button', { name: new RegExp(`Definir estratégia de retenção ${st}.*Sucesso do Cliente`) }).click();
  const deps = drawer.locator('section', { hasText: 'Depende de (só conclui depois destas)' });
  await expect(deps).toContainText('Sucesso do Cliente');
  await expect(deps).toContainText('Em risco');
  await expect(deps).toContainText('O prazo desta não muda sozinho');
  await page.screenshot({ path: 'test-results/dependencia-outro-time.png' });
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Backlog' }).locator('article', { hasText: `Definir metas de receita ${st}` })).toContainText('Dependência em risco');

  // o responsável do projeto acompanha por departamento
  await login(page, 'carlos@yepnet.test');
  await page.goto(`/projetos/${pid}?t=departamentos`);
  await expect(page.getByRole('region', { name: 'Departamento Comercial e Contratos' })).toContainText(`Definir metas de receita ${st}`);
  await expect(page.getByRole('region', { name: 'Departamento Sucesso do Cliente' })).toContainText(`Definir estratégia de retenção ${st}`);
  await expect(page.getByRole('region', { name: 'Departamento Comercial e Contratos' })).toContainText('No backlog do time');
  const depsPanel = page.getByRole('region', { name: 'Dependências entre departamentos' });
  await expect(depsPanel).toContainText(`Definir estratégia de retenção ${st}`);
  await expect(depsPanel).toContainText('Em risco');
  await expect(page.getByRole('region', { name: 'Avanço do projeto' })).toContainText('Avanço pelos entregáveis');
  await page.screenshot({ path: 'test-results/projeto-departamentos.png' });
});
