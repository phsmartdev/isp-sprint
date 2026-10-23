import { expect, test, type Page } from '@playwright/test';

/** Chamados no GLPI a partir da negociação, contra o GLPI 11 simulado (porta 3398). Desliga a integração ao final. */
const SHOTS = process.env.E2E_SHOTS;
const GLPI = 'http://127.0.0.1:3398';
const API = 'http://127.0.0.1:3334/api/v1';
const SECRET = 'segredo-webhook-e2e';
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page, 'carlos@yepnet.test');
  await page.request.put('/api/v1/admin/integrations/glpi', { headers: { origin: new URL(page.url()).origin }, data: { enabled: false, config: {}, secrets: {} } });
  await page.close();
});

test('GLPI: configura, abre chamado da negociação, recebe acompanhamento e solução pelo webhook e responde', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');

  // gerência configura a integração pela tela
  await page.goto('/settings/integrations');
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'GLPI (chamados)' }) }).last();
  await card.getByLabel('Endereço do GLPI').fill(GLPI);
  await card.getByLabel('ID do cliente OAuth').fill('isp-sprint');
  await card.getByLabel('Segredo do cliente OAuth').fill('glpi-secret');
  await card.getByLabel('Usuário de integração', { exact: true }).fill('integracao');
  await card.getByLabel('Senha do usuário de integração').fill('Integra@2026');
  await card.getByLabel('Segredo do webhook').fill(SECRET);
  await card.getByRole('checkbox').first().check();
  await card.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('GLPI (chamados): salvo')).toBeVisible();
  await card.getByRole('button', { name: 'Testar conexão' }).click();
  await expect(page.getByText(/GLPI: Conectado\. O usuário de integração enxerga 3 entidade/)).toBeVisible();
  const hookUrl = (await card.locator('code').innerText()).trim();
  const token = hookUrl.split('/').pop()!;

  // vendedor abre o chamado na negociação
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx.newPage();
  await login(p2, 'lucas@yepnet.test');
  const opps = await (await p2.request.get('/api/v1/opportunities?scope=minhas&pageSize=1')).json();
  await p2.goto(`/opportunities/${opps.items[0].id}?aba=chamados`);
  await expect(p2.getByRole('tab', { name: /Chamados GLPI/ })).toHaveAttribute('aria-selected', 'true');
  await p2.getByRole('button', { name: 'Abrir chamado no GLPI' }).click();
  const dlg = p2.getByRole('dialog', { name: 'Abrir chamado no GLPI' });
  await dlg.getByLabel('Buscar entidade').fill('hospital');
  await expect(dlg.getByLabel('Entidade do cliente').locator('option')).toHaveCount(2);
  await dlg.getByLabel('Entidade do cliente').selectOption({ label: 'Raiz > Clientes > Hospital São Lucas' });
  await dlg.getByLabel('Categoria').selectOption({ label: 'Rede > Link dedicado' });
  await dlg.getByLabel('Grupo técnico').selectOption({ label: 'NOC' });
  await dlg.getByLabel('Urgência').selectOption({ label: 'Alta' });
  await dlg.getByLabel('Título').fill('Viabilidade de link dedicado no hospital');
  await expect(dlg.getByRole('button', { name: 'Abrir chamado' })).toBeDisabled();
  await dlg.getByLabel('Descrição').fill('Cliente quer 300 Mb com redundância no prédio novo.');
  await dlg.getByRole('button', { name: 'Abrir chamado' }).click();
  await expect(p2.getByText(/Chamado #\d+ aberto no GLPI/)).toBeVisible();
  const ticket = p2.getByRole('listitem', { name: /^Chamado \d+$/ }).first();
  await expect(ticket).toContainText('Viabilidade de link dedicado no hospital');
  await expect(ticket).toContainText('Raiz > Clientes > Hospital São Lucas');
  const glpiId = Number((await ticket.getAttribute('aria-label'))!.replace('Chamado ', ''));

  // técnico responde e soluciona no GLPI; o GLPI avisa pelo webhook assinado
  for (const a of [{ kind: 'followup', text: 'Visita técnica marcada para segunda às 9h.' }, { kind: 'solution', text: 'Viável: 300 Mb com rota dupla pelo POP Centro.' }]) {
    const r = await (await p2.request.post(`${GLPI}/__test/tickets/${glpiId}`, { data: { ...a, hook: { url: `${API}/hooks/glpi/${token}`, secret: SECRET } } })).json();
    expect(r.hookStatus).toBe(200);
  }
  await p2.reload();
  const t2 = p2.getByRole('listitem', { name: `Chamado ${glpiId}` });
  await expect(t2).toContainText('Solucionado');
  await expect(t2.getByRole('list', { name: `Retornos do chamado ${glpiId}` })).toContainText('Visita técnica marcada para segunda às 9h.');
  await expect(t2).toContainText('Viável: 300 Mb com rota dupla pelo POP Centro.');
  await t2.getByLabel('Responder no chamado').fill('Cliente aprovou, pode seguir com a proposta.');
  await t2.getByRole('button', { name: 'Enviar ao GLPI' }).click();
  await expect(p2.getByText('Acompanhamento enviado ao GLPI')).toBeVisible();
  await expect(t2).toContainText('Cliente aprovou, pode seguir com a proposta.');
  await shot(p2, 'glpi-chamado');

  // tarefa para dar retorno ao cliente
  const acts = await (await p2.request.get('/api/v1/activities?status=abertas&pageSize=50')).json();
  expect(acts.items.some((a: { title: string }) => a.title === `Dar retorno ao cliente: chamado GLPI #${glpiId} solucionado`)).toBe(true);

  await p2.setViewportSize({ width: 390, height: 844 });
  await p2.reload();
  await expect(p2.getByRole('listitem', { name: `Chamado ${glpiId}` })).toBeVisible();
  expect(await p2.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await shot(p2, 'glpi-mobile');
  await ctx.close();
});
