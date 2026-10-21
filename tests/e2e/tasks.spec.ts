import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.E2E_SHOTS;
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
async function logout(page: Page) {
  await page.getByRole('button', { name: /^Conta de / }).click();
  await page.getByRole('menuitem', { name: /Sair/ }).click();
  await expect(page).toHaveURL(/\/login$/);
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

test('Tarefas: rápida, delegada, detalhe com checklist, comentário, tempo e conclusão; quadro, calendário e lista; aviso para quem recebe', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'lucas@yepnet.test');
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: /^Projetos/ }).click();
  await page.getByRole('link', { name: 'Tarefas' }).first().click();
  await expect(page.getByRole('heading', { name: 'Tarefas', level: 1 })).toBeVisible();

  // tarefa rápida para hoje
  await page.getByLabel('Tarefa rápida').fill('Ligar para o síndico do Edifício Fictício');
  await page.getByLabel('Tarefa rápida').press('Enter');
  const hoje = page.getByRole('region', { name: 'Hoje' });
  await expect(hoje.getByText('Ligar para o síndico do Edifício Fictício')).toBeVisible();

  // pedir uma tarefa ao Rafael
  await page.getByRole('button', { name: 'Nova tarefa' }).first().click();
  const nt = page.getByRole('dialog', { name: 'Nova tarefa' });
  await nt.getByLabel('Título').fill('Levantar fotos da fachada para o projeto');
  await nt.getByLabel('Responsável').selectOption({ label: 'Rafael Mendes' });
  await nt.getByLabel('Etiquetas').fill('vistoria');
  await nt.getByRole('button', { name: 'Criar tarefa' }).click();
  // o detalhe abre logo após criar, para completar o resto
  await expect(page.getByRole('dialog', { name: 'Tarefa' }).getByLabel('Título da tarefa')).toHaveValue('Levantar fotos da fachada para o projeto');
  await page.getByRole('dialog', { name: 'Tarefa' }).getByRole('button', { name: 'Fechar' }).click();
  await expect(page.getByRole('region', { name: 'Delegadas' }).getByText('Levantar fotos da fachada para o projeto')).toBeVisible();
  await shot(page, 'tarefas-minhas');

  // detalhe: checklist, comentário com menção, tempo, concluir
  await hoje.getByRole('button', { name: /Ligar para o síndico/ }).click();
  const dr = page.getByRole('dialog', { name: 'Tarefa' });
  await dr.getByLabel('Novo item do checklist').fill('Confirmar horário da vistoria');
  await dr.getByRole('button', { name: 'Adicionar', exact: true }).first().click();
  await expect(dr.getByRole('checkbox', { name: 'Confirmar horário da vistoria' })).toBeVisible();
  await dr.getByRole('checkbox', { name: 'Confirmar horário da vistoria' }).check();
  await dr.getByLabel('Tempo', { exact: true }).fill('20min');
  await dr.getByRole('button', { name: 'Registrar' }).click();
  await expect(dr.getByText('20min', { exact: true }).first()).toBeVisible();
  await dr.getByLabel('Comentário').fill('Combinado para quinta. @Raf');
  await dr.getByRole('listbox').getByRole('option', { name: /Rafael Mendes/ }).click();
  await dr.getByRole('button', { name: 'Comentar' }).click();
  await expect(dr.getByText(/Combinado para quinta/)).toBeVisible();
  await shot(page, 'tarefas-detalhe');
  await dr.getByRole('button', { name: 'Concluir', exact: true }).click();
  await expect(dr.getByText('Concluída').first()).toBeVisible();
  await dr.getByRole('button', { name: 'Fechar' }).click();

  // quadro, calendário, lista
  await page.getByRole('tab', { name: 'Quadro' }).click();
  await expect(page.getByRole('region', { name: 'Coluna A fazer' })).toBeVisible();
  await shot(page, 'tarefas-quadro');
  await page.getByRole('tab', { name: 'Calendário' }).click();
  await expect(page.getByRole('button', { name: 'Semana' })).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'tarefas-calendario');
  await page.getByRole('tab', { name: 'Lista' }).click();
  await page.getByLabel('Incluir concluídas').check();
  await expect(page.getByRole('button', { name: 'Ligar para o síndico do Edifício Fictício' })).toBeVisible();
  await shot(page, 'tarefas-lista');

  // Rafael recebe o aviso e a tarefa
  await logout(page);
  await login(page, 'rafael@yepnet.test');
  await page.getByRole('button', { name: /menç/i }).click();
  await expect(page.getByText('pediu uma tarefa para você')).toBeVisible();
  await page.getByRole('link', { name: /Levantar fotos da fachada/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Tarefa' }).getByLabel('Título da tarefa')).toHaveValue('Levantar fotos da fachada para o projeto');
});
