import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/** Ofícios: modelo com texto e posição editáveis no timbrado da filial; emissão a partir do contrato, com número da filial. */
const SHOTS = process.env.E2E_SHOTS;
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';
const psql = (q: string) => execFileSync('psql', [DB, '-Atc', q]).toString().trim();

test('modelo de ofício e emissão pelo contrato', async ({ page }) => {
  test.setTimeout(150_000);
  const tag = Date.now().toString(36);
  const tenant = psql(`select tenant_id from users where email = 'carlos@yepnet.test'`);
  const branch = psql(`insert into sales_branches (tenant_id, name, cnpj, city, state) values ('${tenant}', 'BKT Sergipe ${tag}', '18.929.415/0001-00', 'Aracaju', 'SE') returning id`).split('\n')[0];
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('carlos@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();

  // filial: quem assina e próximo número
  await page.goto('/settings/modelos?aba=oficios');
  const fil = page.getByRole('group', { name: `Filial BKT Sergipe ${tag}` });
  await fil.getByLabel('Razão social').fill('BKT SOLUÇÕES E TECNOLOGIA LTDA');
  await fil.getByLabel('Quem assina').fill('José Welliton Sá da Silva');
  await fil.getByLabel('Cargo').fill('Diretor Executivo');
  await fil.getByLabel(/^Próximo nº/).fill('71');
  await fil.getByRole('button', { name: 'Salvar filial' }).click();
  await expect(page.getByText(`BKT Sergipe ${tag}: salvo`)).toBeVisible();

  // modelo: começa do ofício de reajuste; move o bloco da assinatura arrastando
  await page.getByRole('button', { name: 'Novo modelo' }).click();
  await page.getByLabel('Nome do modelo').fill(`Reajuste ${tag}`);
  await page.getByLabel('Prévia no timbrado da filial').selectOption(branch!);
  const sig = page.getByRole('button', { name: 'Bloco Assinatura' });
  await expect(sig).toBeVisible();
  const box = (await sig.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 20, box.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel('Topo (mm)')).not.toHaveValue('228');
  // assinatura digitalizada direto no bloco, com altura ajustável
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADwAAAAUCAYAAADRA14pAAAAQklEQVR42u3QMQ0AAAgDIN8/tBV8MAb9I7IsRUZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGDj8fKA0VN4/rTQAAAABJRU5ErkJggg==', 'base64');
  await page.getByRole('group', { name: 'Assinatura digitalizada' }).getByLabel('Arquivo da assinatura digitalizada').setInputFiles({ name: 'assinatura.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('img', { name: 'Assinatura digitalizada' })).toBeVisible();
  await page.getByLabel('Altura da assinatura (mm)').fill('18');
  await page.getByRole('button', { name: 'Corpo', exact: true }).click();
  await expect(page.getByLabel('Texto do bloco')).toHaveValue(/solicitamos o reajuste/);
  await page.waitForTimeout(1500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/oficio-modelo.png`, fullPage: true });
  await page.getByRole('button', { name: 'Salvar modelo' }).click();
  await expect(page.getByText('Modelo salvo')).toBeVisible();

  // contrato com filial própria → emitir ofício
  const contact = psql(`select id from contacts where tenant_id = '${tenant}' order by created_at limit 1`);
  const me = await (await page.request.get('/api/v1/me')).json();
  const c = await (await page.request.post('/api/v1/contracts', { data: { contactId: contact, branchId: branch, billingType: 'recorrente', kind: 'publico', legalRegime: 'lei_14133', commercialOwnerId: me.user.id, version: { number: '171/2022', object: 'a contratação de empresa especializada na prestação de serviços de tecnologia da informação e comunicação - TIC', signedAt: '2022-11-24', startAt: '2022-11-24', termMonths: 60, monthlyCents: 100_000, adjustmentIndex: 'IPCA', items: [{ planId: null, description: 'Colocation', qty: 1, unitCents: 100_000 }], publicTerms: { agency: 'Companhia de Saneamento de Sergipe - DESO', processNumber: '2022.01.0001', modality: 'Pregão', commitmentNote: null, budgetLine: null, extensionMaxMonths: null } } } })).json();
  await page.goto(`/contracts/${c.id}`);
  await page.getByRole('button', { name: 'Emitir ofício' }).click();
  const dlg = page.getByRole('dialog', { name: 'Emitir ofício' });
  await dlg.getByLabel('Modelo').selectOption({ label: `Reajuste ${tag}` });
  await expect(dlg.getByLabel('Número do contrato')).toHaveValue('171/2022');
  await expect(dlg.getByLabel('Órgão / cliente')).toHaveValue('Companhia de Saneamento de Sergipe - DESO');
  await dlg.getByLabel('Destinatário', { exact: true }).fill('Luciano Gois Paul');
  await dlg.getByLabel('Cargo do destinatário').fill('Diretor-Presidente');
  await page.waitForTimeout(1800);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/oficio-emissao.png`, fullPage: true });
  const [popup] = await Promise.all([page.waitForEvent('popup'), dlg.getByRole('button', { name: /^Emitir ofício nº 71\// }).click()]);
  await popup.close();
  await expect(page.getByRole('region', { name: 'Ofícios emitidos' })).toContainText('Ofício nº 71/');
  psql(`update contracts set branch_id = null where branch_id = '${branch}'`);
});
