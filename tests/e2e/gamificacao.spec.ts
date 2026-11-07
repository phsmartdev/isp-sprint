import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * Gamificação colaborativa sem ranking nem pódio: jornada com pesos criada na regra, aprovação, tarefa nasce na oportunidade,
 * concluir pontua quem concluiu, a pessoa vê só a própria nota, a liderança vê o time e só o primeiro lugar recebe o Selo BK.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';
const SHOTS = process.env.E2E_SHOTS;
const psql = (q: string) => execFileSync('psql', [DB, '-Atc', q]).toString().trim();
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('jornada com pesos, minha nota sem ranking e selo do primeiro lugar', async ({ page }) => {
  test.setTimeout(180_000);
  psql('delete from gamification_settings;');
  await login(page, 'carlos@yepnet.test');
  await page.goto('/times/gamificacao');
  await expect(page.getByRole('region', { name: 'Regra de pontuação aguardando aprovação' })).toBeVisible();

  // a gestão monta a jornada do funil Residencial: tarefa na criação (8 pts) e ganho (20 pts)
  await page.getByRole('button', { name: 'Regra de pontuação' }).click();
  const modal = page.getByRole('dialog', { name: 'Regra de pontuação' });
  await modal.getByRole('button', { name: 'Adicionar jornada' }).click();
  const pipeSel = modal.getByLabel('Funil').first();
  const resid = await pipeSel.locator('option', { hasText: 'Residencial' }).first().getAttribute('value');
  await pipeSel.selectOption(resid!);
  await modal.getByLabel('Pontos do negócio ganho').first().fill('20');
  await modal.getByRole('button', { name: 'Adicionar tarefa' }).first().click();
  await modal.getByLabel(/^Tarefa 1 da jornada/).fill('Conferir cadastro do cliente');
  await modal.getByLabel(/^Pontos da tarefa 1 da jornada/).fill('8');
  await modal.getByLabel('Motivo da mudança').fill('Jornada residencial com pesos');
  if (SHOTS) await modal.screenshot({ path: `${SHOTS}/regra-jornada.png` });
  await modal.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(page.getByText('Proposta enviada: vale depois de aprovada')).toBeVisible();
  const banner = page.getByRole('region', { name: 'Regra de pontuação aguardando aprovação' });
  await expect(banner).toContainText('Conferir cadastro do cliente 8');
  await expect(banner.getByText('Você propôs esta versão')).toBeVisible();
  // outra pessoa propôs (simulado): a gestão aprova
  psql(`update gamification_settings set created_by = (select id from users where email = 'ana@yepnet.test') where status = 'proposta';`);
  await page.reload();
  await page.getByRole('region', { name: 'Regra de pontuação aguardando aprovação' }).getByRole('button', { name: 'Aprovar regra' }).click();
  await expect(page.getByText('Regra aprovada: a gamificação já vale')).toBeVisible();

  // a tarefa da jornada nasce na oportunidade nova; concluir pontua quem concluiu
  await login(page, 'lucas@yepnet.test');
  const plan = (await (await page.request.get('/api/v1/meta/lookups')).json()).plans[0];
  const c = await (await page.request.post('/api/v1/contacts', { data: { name: `Cliente Jornada E2E ${Date.now().toString(36)}`, segment: 'residencial', phone: '79999990001' } })).json();
  const o = await (await page.request.post('/api/v1/opportunities', { data: { contactId: c.id, planId: plan.id, cableMeters: 30, saleType: 'ativa', customerSuccess: false } })).json();
  await page.goto(`/opportunities/${o.id}?aba=tarefas`);
  const panel = page.getByRole('region', { name: 'Pontos da jornada' });
  await expect(panel).toContainText('Conferir cadastro do cliente');
  await expect(panel).toContainText('+8 pts');
  const taskId = psql(`select id from activities where opportunity_id = '${o.id}' and score_component is not null`);
  const rv = Number(psql(`select row_version from activities where id = '${taskId}'`));
  expect((await page.request.patch(`/api/v1/activities/${taskId}`, { data: { completed: true, rowVersion: rv } })).status()).toBe(200);
  await page.reload();
  await expect(panel).toContainText('Concluída por Lucas');
  await expect(panel).toContainText('feitos 8 pts');
  if (SHOTS) await panel.screenshot({ path: `${SHOTS}/pontos-jornada.png` });

  // a pessoa vê só a própria nota: sem ranking, sem pódio, sem colegas
  await page.goto('/times/gamificacao');
  const mine = page.getByRole('region', { name: 'Minha nota' });
  await expect(mine).toContainText('Tarefas da jornada');
  await expect(page.getByRole('region', { name: 'Ranking' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: /Pódio/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Time Residencial' }).getByRole('table')).toHaveCount(0);
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/minha-nota.png` });

  // a liderança vê o time (notas e dispersão) como ferramenta de gestão
  await login(page, 'ana@yepnet.test');
  await page.goto('/times');
  const aside = page.getByRole('complementary', { name: 'Gamificação do time' });
  await expect(aside.getByRole('region', { name: 'Times no mês' })).toBeVisible();
  await expect(aside.getByRole('list', { name: /Pódio/ })).toHaveCount(0);
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/visao-geral-times.png` });
  await page.goto('/times/gamificacao');
  const team = page.getByRole('region', { name: 'Time Residencial' });
  await expect(team.getByRole('status', { name: /Dispersão do time/ })).toBeVisible();
  await expect(team.getByRole('table')).toContainText('Lucas');

  // só o primeiro lugar do ano vê o selo na própria tela
  const g = await (await page.request.get('/api/v1/times/gamificacao')).json();
  expect(g.gold.length).toBeGreaterThan(0);
  const email = psql(`select email from users where id = '${g.gold[0].userId}'`);
  await login(page, email);
  await expect(page.getByRole('img', { name: /Selo BK de Qualidade/ }).first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Selo BK de Qualidade' })).toContainText('Medalha de ouro');
});
