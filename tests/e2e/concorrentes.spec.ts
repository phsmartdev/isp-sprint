import { expect, test, type Page } from '@playwright/test';

/** Bloco 3: aba Pregão (ranking + linha do tempo append-only) e Inteligência → Concorrentes. */
async function login(page: Page, email: string, password = 'Sprint@2026') {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('Pregão: participantes, ranking, ações do concorrente e inteligência por CNPJ', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, 'carlos@yepnet.test');
  const tag = Date.now().toString(36);
  await page.goto('/opportunities/new');
  await page.getByLabel('Nome do cliente').fill(`Prefeitura Pregão ${tag}`);
  await page.getByLabel('Tipo de venda').selectOption({ label: 'Licitação' });
  await page.getByLabel('Filial').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Iniciar Negociação' }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);

  await page.getByRole('tab', { name: 'Pregão' }).click();
  const ranking = page.getByRole('region', { name: 'Ranking do pregão' });
  await ranking.getByRole('button', { name: 'Registrar participantes' }).click();
  const dlg = page.getByRole('dialog', { name: 'Participantes do pregão' });
  await dlg.getByLabel('Empresa 1', { exact: true }).fill('Nossa Empresa');
  await dlg.getByLabel('Nossa empresa 1').check();
  await dlg.getByLabel('Lance 1').fill('120.000,00');
  const rival = `Rede Rival ${tag}`;
  await dlg.getByLabel('Empresa 2', { exact: true }).fill(rival);
  await dlg.getByLabel('CNPJ 2').fill('12.345.678/0001-95');
  await dlg.getByLabel('Lance 2').fill('110.000,00');
  await dlg.getByRole('button', { name: 'Vencedora = 1º de cada lote' }).click();
  await dlg.getByRole('button', { name: 'Salvar participantes' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(ranking.locator('tbody tr').first()).toContainText(rival);
  await expect(ranking.locator('tbody tr').first()).toContainText('Vencedora');
  // mais de um lote: o lote fica ao lado da marcação de vencedora; cada lote tem a sua
  await ranking.getByRole('button', { name: 'Editar' }).click();
  await dlg.getByLabel('Quantidade de lotes').fill('2');
  await dlg.getByRole('button', { name: 'Adicionar empresa' }).first().click();
  await dlg.getByLabel('Empresa 3', { exact: true }).fill(`Outra Rede ${tag}`);
  await dlg.getByLabel('Lance 3').fill('80.000,00');
  await dlg.getByLabel('Lote 3', { exact: true }).selectOption('2');
  await dlg.getByLabel('Vencedora 3').check();
  await dlg.getByRole('button', { name: 'Salvar participantes' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(ranking).toContainText('Lote 2');
  await expect(page.getByRole('region', { name: 'Participantes do pregão' })).toContainText(`Outra Rede ${tag}`);

  const tl = page.getByRole('region', { name: 'Linha do tempo do pregão' });
  await tl.getByRole('button', { name: 'Registrar ação' }).click();
  const act = page.getByRole('dialog', { name: 'Registrar ação do pregão' });
  await act.getByLabel('Empresa').selectOption({ label: rival });
  await act.getByLabel('Ação').selectOption({ label: 'Recurso' });
  await act.getByLabel('Descrição').fill('Recurso contra a nossa proposta');
  await act.getByRole('button', { name: 'Registrar' }).click();
  await expect(act).toHaveCount(0);
  await expect(tl).toContainText('Recurso contra a nossa proposta');

  await page.goto('/intelligence?v=concorrentes');
  await page.getByLabel('Buscar concorrente').fill(tag);
  const row = page.getByRole('row', { name: new RegExp(rival) });
  await expect(row).toContainText('12.345.678/0001-95');
  await row.getByRole('button', { name: rival }).click();
  const drawer = page.getByRole('dialog', { name: `Concorrente: ${rival}` });
  await expect(drawer.getByRole('region', { name: 'Pregões com este concorrente' })).toContainText('R$ 110.000,00 · 1º');
  await expect(drawer.getByRole('region', { name: 'Ações do concorrente nos pregões' })).toContainText('Recurso contra a nossa proposta');
});
