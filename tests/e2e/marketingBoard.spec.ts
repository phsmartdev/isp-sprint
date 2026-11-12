import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/** Quadro do Marketing: resumo em cima, Sprint, criar tarefa com observador e etiqueta, alerta de prazo e fura-fila. */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';
const psql = (q: string) => execFileSync('psql', [DB, '-Atc', q]).toString().trim();
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('quadro do Marketing: Sprint, tarefa, prazo e fura-fila', async ({ page }) => {
  test.setTimeout(120_000);
  const tid = psql(`select tenant_id from users where email = 'carlos@yepnet.test'`);
  psql(`delete from mkt_cards where tenant_id = '${tid}'; delete from mkt_sprints where tenant_id = '${tid}'; delete from mkt_tags where tenant_id = '${tid}'`);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/marketing/quadro');
  await expect(page.getByRole('heading', { name: 'Quadro do Marketing' })).toBeVisible();

  // planejar a Sprint
  await page.getByRole('button', { name: 'Planejar Sprint' }).click();
  const sp = page.getByRole('dialog', { name: 'Planejar Sprint' });
  await sp.getByLabel('Objetivo da Sprint').fill('Lançar a campanha de fim de ano (fictícia)');
  await sp.getByRole('button', { name: 'Planejar' }).click();
  await expect(page.getByText('Sprint planejada').last()).toBeVisible();

  // etiqueta
  await page.getByRole('button', { name: 'Etiquetas' }).click();
  const tg = page.getByRole('dialog', { name: 'Etiquetas do Marketing' });
  await tg.getByLabel('Nova etiqueta').fill('Campanha Fim de Ano');
  await tg.getByRole('button', { name: 'Criar' }).click();
  await expect(tg.getByRole('listitem', { name: 'Etiqueta Campanha Fim de Ano' })).toBeVisible();
  await tg.getByRole('button', { name: 'Fechar' }).last().click();

  // nova tarefa com observador, vertical, etiqueta e prazo vencido
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
  const dr = page.getByRole('dialog', { name: 'Nova tarefa de Marketing' });
  await dr.getByLabel('Título').fill('Peças da campanha de fim de ano');
  await dr.getByLabel('Briefing').fill('Três peças para redes sociais e uma para e-mail.');
  await dr.getByLabel('Prazo').fill(yesterday);
  await dr.getByRole('button', { name: 'Ana', exact: false }).first().click();
  await dr.getByRole('button', { name: 'Arte' }).click();
  await dr.getByRole('button', { name: 'Campanha Fim de Ano' }).click();
  await dr.getByLabel('Coluna').selectOption('a_fazer');
  await dr.getByRole('button', { name: 'Criar tarefa' }).click();
  await expect(page.getByText('Tarefa criada').last()).toBeVisible();

  const resumo = page.getByRole('region', { name: 'Resumo da Sprint' });
  await expect(resumo).toContainText('Atrasadas');
  const card = page.getByRole('region', { name: 'A fazer' }).getByRole('button', { name: /MKT-\d+ Peças da campanha de fim de ano/ });
  await expect(card).toContainText('Atrasada');
  await expect(card).toContainText('Arte');
  await page.screenshot({ path: 'test-results/quadro-marketing.png', fullPage: false });

  // abrir a Sprint: comunicação oficial; nova demanda vira fura-fila
  await page.getByRole('button', { name: 'Abrir Sprint' }).click();
  const ab = page.getByRole('dialog', { name: 'Abrir Sprint' });
  await ab.getByRole('button', { name: 'Abrir Sprint' }).click();
  const em = page.getByRole('dialog', { name: /Comunicação oficial/ });
  await expect(em.getByLabel('Assunto')).toHaveValue('Abertura da Sprint de Marketing | Planejamento Quinzenal');
  await expect(em.getByLabel('Texto')).toHaveValue(/Peças da campanha de fim de ano/);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
  const d2 = page.getByRole('dialog', { name: 'Nova tarefa de Marketing' });
  await d2.getByLabel('Título').fill('Material urgente para o comercial');
  await expect(d2).toContainText('Sprint fechada');
  await d2.getByLabel('Critério').selectOption('receita');
  await d2.getByLabel('Justificativa').fill('Pedido do comercial com prazo do edital.');
  await d2.getByRole('button', { name: 'Pedir fura-fila' }).click();
  await expect(page.getByText('Fura-fila enviado para a liderança').last()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Backlog' }).getByRole('button', { name: /MKT-\d+ Material urgente/ })).toContainText('Fura-fila aguardando liderança');
});
