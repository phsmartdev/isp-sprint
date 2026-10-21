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
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test('Projetos: criar por modelo, quadro com arrastar, lista, calendário, linha do tempo, marcos e vínculo com a ata', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  await page.getByRole('link', { name: 'Projetos' }).first().click();
  await expect(page.getByRole('heading', { name: 'Projetos', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Novo projeto' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Novo projeto' });
  await dlg.getByLabel('Nome do projeto').fill('Implantação Escola Fictícia E2E');
  await dlg.getByLabel('Tipo').selectOption('implantacao');
  await dlg.getByLabel('Modelo').selectOption({ label: 'Implantação de cliente corporativo' });
  await dlg.getByLabel('Início').fill(day(-10));
  await dlg.getByLabel('Pessoa para a equipe').selectOption({ label: 'Lucas Lima' });
  await dlg.getByRole('button', { name: 'Adicionar' }).click();
  await dlg.getByRole('button', { name: 'Criar projeto' }).click();
  await expect(page.getByRole('heading', { name: 'Implantação Escola Fictícia E2E' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Etapa Planejamento' })).toBeVisible();
  await expect(page.getByText('Atrasado').first()).toBeVisible(); // início no passado: kickoff vencido
  await shot(page, 'proj-quadro');

  // arrastar a primeira tarefa para Concluído
  const card = page.getByRole('region', { name: 'Etapa Planejamento' }).getByText('Agendar kickoff com o cliente');
  await card.dragTo(page.getByRole('region', { name: 'Etapa Concluído' }));
  await expect(page.getByRole('region', { name: 'Etapa Concluído' }).getByText('Agendar kickoff com o cliente')).toBeVisible();

  // nova tarefa pelo diálogo
  await page.getByRole('button', { name: 'Nova tarefa' }).click();
  const tk = page.getByRole('dialog', { name: 'Nova tarefa' });
  await tk.getByLabel('Título').fill('Confirmar acesso ao rack');
  await tk.getByLabel('Responsável').selectOption({ label: 'Lucas Lima' });
  await tk.getByLabel('Prazo').fill(day(2));
  await tk.getByRole('button', { name: 'Criar tarefa' }).click();
  await expect(page.getByText('Confirmar acesso ao rack')).toBeVisible();

  await page.getByRole('tab', { name: /Lista/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Concluir Agendar kickoff com o cliente' })).toBeChecked();
  await shot(page, 'proj-lista');
  await page.getByRole('tab', { name: 'Calendário' }).click();
  await expect(page.getByRole('button', { name: 'Hoje' })).toBeVisible();
  await shot(page, 'proj-calendario');
  await page.getByRole('tab', { name: 'Linha do tempo' }).click();
  await expect(page.getByText(/Cada barra vai do início ao prazo/)).toBeVisible();
  await shot(page, 'proj-linha');
  await page.getByRole('tab', { name: /Marcos/ }).click();
  await page.getByRole('button', { name: 'Marcar atingido' }).first().click();
  await expect(page.getByText(/Atingido em/)).toBeVisible();
  await shot(page, 'proj-marcos');

  // a tarefa do Lucas aparece na agenda dele
  await page.getByRole('button', { name: /^Conta de / }).click();
  await page.getByRole('menuitem', { name: /Sair/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, 'lucas@yepnet.test');
  await page.goto(`/activities?q=rack&day=${day(2)}`);
  await expect(page.getByText('Confirmar acesso ao rack')).toBeVisible();

  await page.goto('/projetos');
  await expect(page.getByRole('link', { name: 'Implantação Escola Fictícia E2E' })).toBeVisible();
  await shot(page, 'proj-lista-projetos');
});
