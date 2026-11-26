import { expect, test, type Page } from '@playwright/test';

/** Dados Planejados contra o GLPI 11 simulado (porta 3398): cadastro do usuário no GLPI, configuração e painel. */
const SHOTS = process.env.ACADEMIA_SHOTS;
const GLPI = 'http://127.0.0.1:3398';
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
/** Data no formato do GLPI (horário de Brasília). */
const glpiDate = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page, 'carlos@yepnet.test');
  const o = { origin: new URL(page.url()).origin };
  const users = (await (await page.request.get('/api/v1/admin/users')).json()).users as { id: string; email: string }[];
  const lucas = users.find((u) => u.email === 'lucas@yepnet.test')!;
  await page.request.patch(`/api/v1/admin/users/${lucas.id}`, { headers: o, data: { glpiUserId: null, glpiGroups: [] } });
  const cfg = await (await page.request.get('/api/v1/admin/dados-planejados')).json();
  await page.request.put('/api/v1/admin/dados-planejados', { headers: o, data: { enabled: false, rootEntityId: 0, managerIds: [], groupLeaders: {}, settings: cfg.settings } });
  await page.request.put('/api/v1/admin/integrations/glpi', { headers: o, data: { enabled: false, config: {}, secrets: {} } });
  await page.close();
});

test('Dados Planejados: liga a pessoa ao GLPI no cadastro, configura o SLA universal e mostra as pendências', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, 'carlos@yepnet.test');
  const o = { origin: new URL(page.url()).origin };
  expect((await page.request.put('/api/v1/admin/integrations/glpi', { headers: o, data: { enabled: true, config: { baseUrl: GLPI, clientId: 'isp-sprint', username: 'integracao' }, secrets: { clientSecret: 'glpi-secret', password: 'Integra@2026' } } })).ok()).toBe(true);
  const st = Date.now().toString(36).slice(-5);
  // no GLPI: um chamado do Lucas aberto há 3 dias (atrasado) e um do grupo, sem responsável
  const old = new Date(Date.now() - 3 * 86_400_000);
  const late = (await (await page.request.post(`${GLPI}/__test/seed`, { data: { name: `Revisão de proposta ${st}`, date: glpiDate(old), team: [{ type: 'Group', id: 21 }, { type: 'User', id: 31 }] } })).json()).id as number;
  // um chamado do NOC (fora do Comercial) que cita o Lucas e pede a aprovação dele
  const ts = glpiDate(new Date(Date.now() - 2 * 3_600_000));
  const noc = (await (await page.request.post(`${GLPI}/__test/seed`, { data: { name: `Troca de equipamento ${st}`, date: ts, team: [{ type: 'Group', id: 11 }], timeline: [
    { type: 'Followup', item: { id: 7001, user: { id: 33, name: 'tecnico.noc' }, content: '<p>Pode confirmar, <span data-user-mention="true" data-user-id="31">@Lucas</span>?</p>', date: ts } },
    { type: 'Validation', item: { id: 7002, requester: { id: 33, name: 'tecnico.noc' }, requested_approver_type: 'User', requested_approver_id: 31, status: 2, submission_date: ts } },
  ] } })).json()).id as number;
  // um chamado que o Lucas abriu para o NOC (visão Requisitados)
  const asked = (await (await page.request.post(`${GLPI}/__test/seed`, { data: { name: `Liberar acesso VPN ${st}`, date: ts, team: [{ type: 'User', id: 31, role: 'requester' }, { type: 'Group', id: 11 }, { type: 'User', id: 33 }] } })).json()).id as number;
  const free = (await (await page.request.post(`${GLPI}/__test/seed`, { data: { name: `Aditivo de contrato ${st}`, date: glpiDate(new Date(Date.now() - 30 * 60_000)), team: [{ type: 'Group', id: 21 }] } })).json()).id as number;

  // cadastro: usuário e grupo do Lucas no GLPI
  await page.goto('/settings/users');
  await page.getByRole('row', { name: /Lucas Lima/ }).getByRole('button', { name: /Editar/ }).first().click();
  const glpi = page.getByRole('group', { name: 'GLPI' });
  await glpi.getByLabel('Buscar usuário no GLPI').fill('lucas');
  await glpi.getByRole('button', { name: 'Buscar' }).first().click();
  await glpi.getByRole('button', { name: /Lucas Lima \(lucas\.lima\)/ }).click();
  await expect(glpi.getByTestId('glpi-user')).toHaveText('Lucas Lima (lucas.lima)');
  await glpi.getByLabel('Buscar grupo no GLPI').fill('comer');
  await glpi.getByLabel('Buscar grupo no GLPI').press('Enter');
  await glpi.getByRole('button', { name: /^Comercial/ }).click();
  await expect(glpi.getByTestId('glpi-group')).toContainText('Comercial');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Usuário atualizado')).toBeVisible();

  // menu: Dados Planejados logo abaixo de Início
  const nav = page.getByRole('navigation').first();
  await nav.getByRole('link', { name: 'Dados Planejados' }).click();
  await expect(page.getByRole('heading', { name: 'Dados Planejados' })).toBeVisible();
  await expect(page.getByText(/O monitoramento está desligado/)).toBeVisible();

  // configuração: liga, SLA universal de 8 h úteis
  await page.getByRole('button', { name: 'Configurar alertas' }).click();
  const drawer = page.getByRole('dialog', { name: 'Configurar alertas' });
  await drawer.getByLabel('Monitorar os chamados do GLPI e mandar os avisos').check();
  await expect(drawer.getByRole('radio', { name: /SLA universal/ })).toBeChecked();
  await drawer.getByLabel('Horas para solucionar').fill('8');
  await drawer.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Configuração salva')).toBeVisible();
  await page.getByRole('button', { name: 'Ler GLPI agora' }).click();
  await expect(page.getByText('GLPI lido e avisos conferidos')).toBeVisible();

  const rows = page.getByTestId('pending-row');
  await expect(rows.filter({ hasText: `#${late}` })).toContainText('Atrasado');
  await expect(rows.filter({ hasText: `#${late}` })).toContainText('lucas.lima');
  await expect(rows.filter({ hasText: `#${free}` })).toContainText('Sem responsável');
  await expect(rows.first()).toContainText(`#${late}`); // atrasados primeiro
  await expect(page.getByRole('alert', { name: 'Alerta' })).toContainText('em atraso');
  await expect(page.getByRole('link', { name: 'Abrir no GLPI' }).first()).toHaveAttribute('href', new RegExp(`ticket\\.form\\.php\\?id=${late}`));
  await expect(page.getByText('SLA universal: 8 h úteis para solucionar', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Nível de serviço por grupo e pessoa' })).toContainText('Comercial');
  // aprovações e menções: indicadores e listas
  await expect(page.getByTestId('approval-row').filter({ hasText: `#${noc}` })).toContainText('Lucas Lima');
  await expect(page.getByTestId('mention-row').filter({ hasText: `#${noc}` })).toContainText('Sem resposta');
  await expect(page.getByTestId('kpi-aprovacoes')).toContainText(/Aprovações pendentes[1-9]/);
  await expect(rows.filter({ hasText: `#${noc}` })).toHaveCount(0);
  await expect(rows.filter({ hasText: `#${asked}` })).toHaveCount(0);
  // visão Requisitados: o que o Comercial abriu, com quem está atendendo
  await page.getByRole('group', { name: 'Visão' }).getByRole('button', { name: 'Requisitados' }).click();
  await expect(page.getByRole('heading', { name: 'Requisitados pelo Comercial' })).toBeVisible();
  await expect(rows.filter({ hasText: `#${asked}` })).toContainText('tecnico.noc');
  await expect(rows.filter({ hasText: `#${late}` })).toHaveCount(0);
  await page.getByRole('group', { name: 'Visão' }).getByRole('button', { name: 'Atribuídos' }).click();
  await expect(page.getByRole('heading', { name: 'Pendências' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dados-planejados.png`, fullPage: true });

  // tela cheia (modo TV): barra com título, período e relógio; as pendências continuam visíveis
  await page.getByRole('button', { name: 'Tela cheia' }).click();
  await expect(page.getByRole('button', { name: 'Sair (Esc)' })).toBeVisible();
  await expect(page.getByLabel('Hora atual')).toBeVisible();
  await expect(rows.filter({ hasText: `#${late}` })).toContainText('Atrasado');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dados-planejados-tv.png` });
  // já entra alternando: Atribuídos → Requisitados a cada 30 s
  await expect(page.getByRole('checkbox', { name: /Alternar abas/ })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Requisitados pelo Comercial' })).toBeVisible({ timeout: 40_000 });
  await expect(rows.filter({ hasText: `#${asked}` })).toContainText('tecnico.noc');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dados-planejados-tv-requisitados.png` });
  await page.getByRole('button', { name: 'Sair (Esc)' }).click();
  await expect(page.getByRole('button', { name: 'Sair (Esc)' })).toHaveCount(0);
});
