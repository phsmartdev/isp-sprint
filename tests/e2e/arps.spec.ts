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

const CSV = [
  'Lote;Item;Código;Descrição;Unidade;Quantidade registrada;Valor unitário;Valor total;Órgão participante;Quantitativo do órgão',
  '1;1;111;Link dedicado 100 Mbps;mês;120;1.500,00;180.000,00;;',
  '1;1;111;Link dedicado 100 Mbps;mês;120;1.500,00;180.000,00;Secretaria de Saúde E2E;36',
  '1;2;222;Instalação de ponto de acesso;un;40;800,00;32.000,00;;',
  '1;3;333;Item com erro;un;10;5,00;99,00;;',
].join('\r\n');

test('atas: cadastra, importa planilha com prévia, torna vigente, cria oportunidade que reserva saldo', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/contracts?t=atas');
  await expect(page.getByRole('tab', { name: 'Atas de registro de preços' })).toHaveAttribute('aria-selected', 'true');

  const number = `E2E-${Date.now() % 100000}/2026`;
  await page.getByRole('button', { name: 'Nova ata' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Número da ata').fill(number);
  await dlg.getByLabel('Objeto').fill('Serviços de conectividade para a rede municipal');
  await dlg.getByLabel('Órgão gerenciador').fill('Prefeitura E2E');
  await dlg.getByLabel('Fornecedor registrado').fill('BKT Telecom');
  await dlg.getByLabel('Início da vigência').fill('2026-01-01');
  await dlg.getByLabel('Fim da vigência').fill('2027-12-31');
  await dlg.getByRole('button', { name: 'Cadastrar ata' }).click();

  // vai direto para a ficha com o assistente de importação aberto
  await expect(page).toHaveURL(/\/contracts\/atas\/[0-9a-f-]{36}/);
  const imp = page.getByRole('dialog', { name: 'Importar itens da ata' });
  await expect(imp).toBeVisible();
  await imp.getByLabel('Arquivo da planilha').setInputFiles({ name: 'ata.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf-8') });
  await expect(imp.getByLabel('Campo para a coluna Descrição')).toHaveValue('description');
  await expect(imp.getByLabel('Campo para a coluna Órgão participante')).toHaveValue('agency');
  await shot(page, 'arp-import-colunas');
  await imp.getByRole('button', { name: /Validar 4 linha/ }).click();
  await expect(imp.getByText(/Valor total \(99.00\) não confere/)).toBeVisible();
  await expect(imp.getByText('Órgãos participantes que serão cadastrados: Secretaria de Saúde E2E.')).toBeVisible();
  await shot(page, 'arp-import-previa');
  await expect(imp.getByRole('button', { name: 'Aplicar importação' })).toBeDisabled();
  await imp.getByText(/Importar só as 3 linha/).click();
  await imp.getByRole('button', { name: 'Aplicar importação' }).click();
  await expect(imp).toBeHidden();

  await expect(page.getByRole('cell', { name: 'Link dedicado 100 Mbps' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Instalação de ponto de acesso' })).toBeVisible();
  await expect(page.getByText('Item com erro')).toHaveCount(0);

  await page.getByRole('button', { name: 'Tornar vigente' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Tornar vigente' }).click();
  await expect(page.getByText('Vigente', { exact: true }).first()).toBeVisible();

  // oportunidade da ata reserva o saldo do participante
  await page.getByRole('tab', { name: 'Oportunidades' }).click();
  await page.getByRole('button', { name: 'Nova oportunidade' }).click();
  const op = page.getByRole('dialog', { name: 'Nova oportunidade da ata' });
  await op.getByLabel('Órgão contratante').selectOption({ label: 'Secretaria de Saúde E2E' });
  await op.getByLabel('Quantidade do item 1').fill('40');
  await expect(op.getByText('Acima do saldo')).toBeVisible();
  await op.getByLabel('Quantidade do item 1').fill('12');
  await expect(op.getByText('R$ 18.000,00')).toBeVisible();
  await op.getByRole('button', { name: 'Criar e reservar' }).click();
  await expect(op).toBeHidden();
  await expect(page.getByText('Em negociação')).toBeVisible();
  await shot(page, 'arp-oportunidades');

  await page.getByRole('tab', { name: 'Itens e saldos' }).click();
  const row = page.getByRole('row', { name: /Link dedicado 100 Mbps/ });
  await expect(row.getByRole('cell').nth(6)).toHaveText('12');
  await expect(row.getByRole('cell').nth(9)).toContainText('108');
  await shot(page, 'arp-itens');

  await page.getByRole('tab', { name: 'Movimentações' }).click();
  await expect(page.getByRole('cell', { name: 'Reserva' }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Conversões e remanejamentos' }).click();
  await page.getByRole('button', { name: 'Nova operação' }).click();
  const opd = page.getByRole('dialog', { name: 'Nova operação entre itens' });
  await opd.getByLabel('Item', { exact: true }).selectOption({ index: 1 });
  await opd.getByLabel('Sai de: órgão 1').selectOption({ label: 'Secretaria de Saúde E2E' });
  await opd.getByLabel('Sai de: quantidade 1').fill('500');
  await opd.getByLabel('Vai para: órgão 1').selectOption({ label: 'Prefeitura E2E' });
  await opd.getByLabel('Vai para: quantidade 1').fill('500');
  await opd.getByRole('button', { name: 'Simular' }).click();
  await expect(opd.getByText('Operação não admitida')).toBeVisible();
  await expect(opd.getByText(/Saldo insuficiente/).first()).toBeVisible();
  await opd.getByLabel('Sai de: quantidade 1').fill('4');
  await opd.getByLabel('Vai para: quantidade 1').fill('4');
  await opd.getByRole('button', { name: 'Simular' }).click();
  await expect(opd.getByText('Operação admissível')).toBeVisible();
  await opd.getByLabel('Justificativa').fill('Secretaria não vai usar todo o quantitativo previsto.');
  await opd.getByRole('button', { name: 'Solicitar operação' }).click();
  await expect(page.getByText('Aguardando aprovação', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Relatórios' }).click();
  await expect(page.getByRole('columnheader', { name: 'Qtd. original' })).toBeVisible();

  // aparece na lista de atas e na Inteligência
  await page.goto('/contracts?t=atas');
  await expect(page.getByRole('link', { name: `Ata ${number}` })).toBeVisible();
  await shot(page, 'arp-lista');
  await page.goto('/intelligence?v=atas');
  await expect(page.getByText('Reservado em oportunidades')).toBeVisible();

  // vendedor: dentro da oportunidade, atrela ao saldo da ata e pede adesão para outro órgão
  const seller = await (await page.context().browser()!.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await login(seller, 'lucas@yepnet.test');
  await seller.goto('/opportunities/new');
  await seller.getByLabel('Nome do cliente').fill('Secretaria de Saúde E2E (compra)');
  await seller.getByLabel('Plano', { exact: true }).selectOption({ index: 1 });
  await seller.getByText('Oferta / curiosidade').click();
  await seller.getByRole('button', { name: 'Iniciar Sprint' }).click();
  await expect(seller).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  await seller.getByRole('button', { name: 'Atrelar ao saldo da ata' }).click();
  const ad = seller.getByRole('dialog', { name: 'Atrelar ao saldo de uma ata' });
  await ad.getByRole('combobox', { name: /^Ata/ }).selectOption({ index: 1 });
  await ad.getByLabel('Órgão contratante').selectOption({ label: 'Secretaria de Saúde E2E' });
  await ad.getByLabel('Quantidade do item 1').fill('5');
  await ad.getByRole('button', { name: 'Reservar saldo' }).click();
  await expect(ad).toBeHidden();
  const panel = seller.getByRole('region', { name: 'Ata de registro de preços' });
  await expect(panel.getByText('Reservado', { exact: true })).toBeVisible();
  await expect(panel.getByRole('link', { name: `Ata ${number}` })).toBeVisible();

  await panel.getByRole('button', { name: 'Alterar saldo ou pedir adesão' }).click();
  const ad2 = seller.getByRole('dialog', { name: `Saldo da ata ${number}` });
  await ad2.getByText('Pedir nova adesão').click();
  await ad2.getByRole('combobox', { name: /^Órgão ou instituição/ }).selectOption({ value: 'novo' });
  await ad2.getByLabel('Nome do órgão ou instituição').fill('Universidade Fictícia E2E');
  await ad2.getByLabel('Justificativa do órgão').fill('Conectividade dos campi do interior.');
  await ad2.getByLabel('Quantidade do item 1').fill('100');
  await expect(ad2.getByText('Acima do limite legal')).toBeVisible();
  await ad2.getByLabel('Quantidade do item 1').fill('10');
  await ad2.getByRole('button', { name: 'Pedir adesão' }).click();
  await expect(ad2).toBeHidden();
  await expect(panel.getByText('Adesão solicitada')).toBeVisible();
  await expect(panel.getByText('Universidade Fictícia E2E')).toBeVisible();
  await shot(seller, 'arp-na-oportunidade');
});
