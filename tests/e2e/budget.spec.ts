import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

test('Recursos e Orçamento: estrutura, líder planeja, Diretoria aprova o total, gasto com comprovante, Guardião e relatório', async ({ browser }) => {
  test.setTimeout(240_000);
  const dir = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(dir, 'carlos@yepnet.test');
  // menu do módulo
  await dir.getByRole('button', { name: /Recursos e Orçamento/ }).click();
  await dir.getByRole('link', { name: 'Planejamento orçamentário' }).click();
  await dir.getByRole('button', { name: 'Criar estrutura sugerida' }).click();
  await expect(dir.getByRole('tab', { name: 'Plano de contas e centros' })).toBeVisible();
  await dir.getByRole('tab', { name: 'Plano de contas e centros' }).click();
  const plan = dir.getByRole('region', { name: 'Plano de contas' });
  await expect(plan).toContainText('Plataforma de CRM');
  // nova subcategoria
  await plan.getByRole('listitem').filter({ hasText: /^3\.2\s*Ferramentas/ }).getByRole('button', { name: '+ conta abaixo' }).click();
  await dir.getByLabel('Nome').fill('Inteligência artificial');
  await dir.getByRole('button', { name: 'Criar conta' }).click();
  await expect(plan).toContainText('Inteligência artificial');
  // líder do Marketing = Ana
  await dir.getByRole('region', { name: 'Centros de custo' }).getByRole('listitem').filter({ hasText: 'MKT · Marketing' }).getByRole('button', { name: 'Editar' }).click();
  await dir.getByLabel('Líder').selectOption({ label: 'Ana Souza' });
  await dir.getByRole('button', { name: 'Salvar' }).click();
  await expect(dir.getByRole('region', { name: 'Centros de custo' })).toContainText('Líder: Ana Souza');

  // líder planeja e envia
  const ana = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(ana, 'ana@yepnet.test');
  await ana.goto('/orcamento?t=centro');
  await ana.getByRole('button', { name: 'Planejar item' }).click();
  let dlg = ana.getByRole('dialog', { name: 'Planejar item' });
  await dlg.getByLabel('O quê').fill('Campanha de mídia paga no LinkedIn');
  await dlg.getByLabel('Como').fill('Agência fictícia, 3 meses, público decisores');
  await dlg.getByLabel('Conta (subcategoria)').selectOption({ label: '3.1.01 · Comunicação › Mídia paga' });
  await dlg.getByLabel('Valor (R$)').fill('10000');
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await expect(ana.getByRole('region', { name: 'Itens planejados' })).toContainText('Campanha de mídia paga no LinkedIn');
  await ana.getByRole('button', { name: /Enviar à Diretoria/ }).click();
  await expect(ana.getByRole('region', { name: 'Itens planejados' })).toContainText('Em aprovação');

  // Diretoria aprova o total do centro
  await dir.goto('/orcamento?t=visao');
  const row = dir.getByRole('region', { name: /Centros de custo no/ }).getByRole('row').filter({ hasText: 'MKT · Marketing' });
  await expect(row).toContainText('Aguardando a Diretoria');
  await row.getByRole('button', { name: 'MKT · Marketing' }).click();
  await dir.getByRole('button', { name: 'Aprovar o total do centro' }).click();
  await dir.getByRole('dialog').getByRole('button', { name: 'Aprovar' }).click();
  await expect(dir.getByRole('region', { name: 'Itens planejados' })).toContainText('Aprovado');

  // líder lança gasto com comprovante (checagem com o Financeiro obrigatória)
  await ana.reload();
  await ana.getByRole('button', { name: 'Lançar gasto' }).first().click();
  dlg = ana.getByRole('dialog', { name: 'Lançar gasto' });
  await dlg.getByLabel('Item planejado').selectOption({ index: 1 });
  await dlg.getByLabel('Valor (R$)').fill('4000');
  await dlg.locator('input[type="file"]').setInputFiles({ name: 'nota.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF') });
  await expect(dlg.getByRole('button', { name: 'Lançar gasto' })).toBeDisabled();
  await dlg.getByLabel(/checagem prévia com o Financeiro/).check();
  await dlg.getByRole('button', { name: 'Lançar gasto' }).click();
  await expect(ana.getByRole('region', { name: 'Gastos realizados' })).toContainText('−R$');
  await expect(ana.getByLabel('Resumo do centro de custo')).toContainText('40%');
  // acima do disponível: bloqueado, pede Guardião
  await ana.getByRole('button', { name: 'Lançar gasto' }).first().click();
  dlg = ana.getByRole('dialog', { name: 'Lançar gasto' });
  await dlg.getByLabel('Conta (subcategoria)').selectOption({ label: '3.1.01 · Comunicação › Mídia paga' });
  await dlg.getByLabel('Descrição').fill('Impulsionamento extra');
  await dlg.getByLabel('Valor (R$)').fill('7000');
  await dlg.getByLabel(/checagem prévia com o Financeiro/).check();
  await dlg.getByRole('button', { name: 'Lançar gasto' }).click();
  await expect(ana.getByText(/Budget Guardião/).first()).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancelar' }).click();
  // Guardião: até 15% com justificativa
  await ana.getByRole('button', { name: 'Budget Guardião' }).click();
  dlg = ana.getByRole('dialog', { name: 'Budget Guardião' });
  await dlg.getByLabel('Conta (subcategoria)').selectOption({ label: '3.1.01 · Comunicação › Mídia paga' });
  await dlg.getByLabel('Valor (R$)').fill('1000');
  await expect(dlg).toContainText('dentro dos 15%');
  await dlg.getByLabel('Justificativa formal').fill('Campanha performou acima do esperado; ampliar alcance no mês');
  await dlg.getByRole('button', { name: 'Registrar ajuste' }).click();
  await expect(ana.getByRole('region', { name: 'Budget Guardião' })).toContainText('Registrado (até 15%)');

  // licença em dólar sem senha, com referência do Vault
  await ana.goto('/orcamento/softwares');
  await ana.getByRole('button', { name: 'Nova licença' }).click();
  dlg = ana.getByRole('dialog', { name: 'Nova licença' });
  await dlg.getByLabel('Software').fill('Ferramenta fictícia de automação');
  await dlg.getByLabel('Moeda').selectOption('USD');
  await dlg.getByLabel('Valor (US$)').fill('100');
  await dlg.getByLabel('Cotação usada (R$ por US$)').fill('5,50');
  await dlg.getByLabel(/Usuário e senha registrados no cofre/).check();
  await dlg.getByLabel('Referência no Vault').fill('Marketing / Automação');
  await dlg.getByLabel('Forma de pagamento').selectOption('cartao_corporativo');
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await expect(ana.getByRole('region', { name: 'Softwares e licenças' })).toContainText('R$ 550,00');

  // relatório dos setores
  await dir.goto('/orcamento/indicadores');
  const sectors = dir.getByRole('region', { name: 'Orçamento por setor' });
  await sectors.getByRole('button', { name: /MKT · Marketing/ }).click();
  await expect(sectors).toContainText('Comunicação');
  await expect(dir.getByRole('region', { name: 'Budget Guardião no período' })).toContainText('Campanha performou');
  await dir.screenshot({ path: 'test-results/orcamento-indicadores.png', fullPage: true });
  await ana.goto('/orcamento?t=centro');
  await ana.screenshot({ path: 'test-results/orcamento-centro.png', fullPage: true });
});
