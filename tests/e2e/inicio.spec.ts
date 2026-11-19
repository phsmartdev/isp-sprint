import { expect, test, type Page } from '@playwright/test';

/**
 * Início estratégico: os 4 números (Oportunidades, R$ Oportunidades, Atividades, Propostas) com a parte da pessoa
 * na meta da empresa do planejamento; sem meta ligada, o card diz isso. Nova oportunidade, tarefas, funil e conquistas.
 */
const SHOTS = process.env.ACADEMIA_SHOTS;
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

test('início: contribuição de cada número para a meta estratégica da empresa', async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 1200 });
  const st = Date.now().toString(36).slice(-5);
  // a Diretoria/Gerência monta um objetivo estratégico com meta da empresa de atividades concluídas
  await login(page, 'carlos@yepnet.test');
  const post = async (url: string, data: unknown) => { const r = await page.request.post(`/api/v1${url}`, { data }); expect(r.status(), await r.text()).toBe(201); return r.json(); };
  // com KPIs principais, o objetivo estratégico é um deles; sem KPIs, cria-se um
  const objs = await (await page.request.get('/api/v1/performance/objectives')).json();
  const kpiObj = objs.items.find((o: { kpi: unknown; status: string }) => o.kpi && o.status === 'ativo');
  const obj = kpiObj ?? await post('/performance/objectives', { title: `Ampliar a carteira ${st}`, level: 'estrategico', periodStart: `${today().slice(0, 7)}-01`, periodEnd: `${today().slice(0, 4)}-12-31` });
  const ind = await post('/performance/indicators', { def: { name: `Atividades concluídas ${st}`, category: 'tarefas', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'tarefa_concluida', measure: 'contagem' } } });
  await post('/performance/goals', { title: `Atividades da empresa ${st}`, scope: 'empresa', indicatorId: ind.id, periodType: 'mes', target: 200, objectiveId: obj.id, consolidation: 'soma' });

  await login(page, 'lucas@yepnet.test');
  await page.goto('/');
  const act = page.getByTestId('kpi-atividades_hoje');
  await expect(act).toContainText('Atividades');
  await expect(act).toContainText('Sua parte na meta da empresa');
  await expect(act).toContainText(kpiObj ? kpiObj.title : `Ampliar a carteira ${st}`);
  await expect(act).toContainText('de 200');
  // os outros números sem meta ligada no planejamento não inventam percentual
  await expect(page.getByTestId('kpi-abertas')).toContainText('Oportunidades');
  await expect(page.getByTestId('kpi-valor')).toContainText('R$ Oportunidades');
  await expect(page.getByTestId('kpi-propostas')).toContainText('Propostas');
  await expect(page.getByRole('region', { name: 'Nova oportunidade' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tarefas de hoje' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Funil de oportunidades' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Minhas conquistas' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/inicio.png`, fullPage: true });
  await page.getByRole('button', { name: 'Nova oportunidade' }).click();
  await expect(page).toHaveURL(/\/opportunities\/new/);
});
