import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/** Data Import Engine pela tela: conector CSV, modelo aprovado, assistente (simulação → revisão → aprovação → execução → conferência). */
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

test('importação por modelo salvo: simular, aprovar, executar e conferir', async ({ page }) => {
  test.setTimeout(180_000);
  const st = Date.now().toString(36);
  await login(page, 'carlos@yepnet.test');
  const dirEmail = `dir-imp-e2e-${st}@yepnet.test`;
  expect((await page.request.post('/api/v1/admin/users', { data: { name: 'Diretor Importação', email: dirEmail, profile: 'diretoria', teamIds: [] } })).status()).toBe(201);
  psql(`update users set password_hash = (select password_hash from users where email = 'carlos@yepnet.test') where email = '${dirEmail}'`);

  // conector CSV (Diretoria) pela tela
  await login(page, dirEmail);
  await page.goto('/settings/importacao?aba=conectores');
  await page.getByRole('button', { name: 'Novo conector' }).click();
  const dlg = page.getByRole('dialog', { name: 'Novo conector' });
  await dlg.getByLabel('Origem').selectOption('csv');
  await dlg.getByLabel('Nome').fill(`CSV ${st}`);
  await dlg.getByRole('button', { name: 'Criar' }).click();
  const card = page.getByRole('listitem', { name: `CSV ${st}` });
  await expect(card).toBeVisible();
  const conn = (await (await page.request.get('/api/v1/admin/import/connectors')).json()).items.find((c: { name: string }) => c.name === `CSV ${st}`);
  for (const [entity, content] of [['empresas', `id;nome\nE${st};Empresa CSV ${st}\n`], ['negocios', `id;titulo;empresa_id;responsavel;valor;situacao\nN1${st};Negócio CSV ${st};E${st};carlos@yepnet.test;1.234,56;ganho\nN2${st};Negócio aberto ${st};E${st};carlos@yepnet.test;99,90;aberto\n`]] as const) {
    await card.getByRole('button', { name: 'Enviar arquivo (CSV ou Excel)' }).click();
    const up = page.getByRole('dialog', { name: 'Enviar arquivo' });
    await up.getByLabel('Arquivo CSV ou Excel').setInputFiles({ name: `${entity}.csv`, mimeType: 'text/csv', buffer: Buffer.from(content) });
    const sheet = up.getByRole('listitem', { name: `Aba ${entity}` });
    await expect(sheet.getByLabel('Entidade')).toHaveValue(entity);
    await expect(sheet.getByText('ID = id')).toBeVisible(); // coluna de ID sugerida
    await up.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByText(/linha\(s\) recebidas/)).toBeVisible();
  }
  await card.getByRole('button', { name: 'Testar conexão' }).click();
  await expect(card.getByText('Conexão ok')).toBeVisible();

  // modelo feito pela Gerência e aprovado pela Diretoria
  await login(page, 'carlos@yepnet.test');
  const stage = (await (await page.request.get('/api/v1/admin/import/schema')).json()).refs.etapa[1].id;
  const pol = { onNew: 'criar', onExisting: 'atualizar', emptyValues: 'manter', matchByKey: 'revisar' };
  const config = {
    source: 'csv', timezone: 'America/Sao_Paulo', execution: { batchSize: 50, largeVolume: 500 }, tables: [],
    entities: [
      { source: 'empresas', target: 'conta', enabled: true, legacy: 'preservar', filter: [], policy: pol, fields: [
        { id: 'a', target: 'name', kind: 'direta', sources: ['nome'], transforms: [{ op: 'trim' }], approved: true },
        { id: 'b', target: 'segment', kind: 'constante', sources: [], value: 'empresarial', transforms: [], approved: true }] },
      { source: 'negocios', target: 'oportunidade', enabled: true, legacy: 'preservar', filter: [], policy: pol, fields: [
        { id: 'a', target: 'title', kind: 'direta', sources: ['titulo'], transforms: [], approved: true },
        { id: 'b', target: 'account', kind: 'direta', sources: ['empresa_id'], transforms: [], approved: true },
        { id: 'c', target: 'owner', kind: 'direta', sources: ['responsavel'], transforms: [], approved: true },
        { id: 'd', target: 'stage', kind: 'constante', sources: [], value: stage, transforms: [], approved: true },
        { id: 'e', target: 'status', kind: 'condicional', sources: [], rules: [{ when: [{ path: 'situacao', op: 'eq', value: 'ganho' }], value: 'ganha' }], value: 'aberta', transforms: [], approved: true },
        { id: 'f', target: 'valueCents', kind: 'direta', sources: ['valor'], transforms: [{ op: 'cents', decimal: ',', unit: 'reais' }], approved: true }] },
    ],
  };
  const tpl = await (await page.request.post('/api/v1/admin/import/templates', { data: { name: `CSV → ISP Sprint | Empresas e negócios ${st}`, connectorId: conn.id, config } })).json();
  await login(page, dirEmail);
  expect((await page.request.post(`/api/v1/admin/import/versions/${tpl.versionId}/approve`)).ok()).toBe(true);

  // biblioteca → Utilizar → assistente
  await page.goto('/settings/importacao?aba=modelos');
  const item = page.getByRole('listitem', { name: `CSV → ISP Sprint | Empresas e negócios ${st}` });
  await expect(item.getByText('v1.0 aprovada')).toBeVisible();
  await item.getByRole('button', { name: 'Utilizar' }).click();
  const next = page.getByRole('button', { name: 'Continuar' });
  await expect(page.getByLabel('Versão')).toHaveValue(tpl.versionId);
  await next.click(); // origem
  await expect(page.getByLabel('Conector')).toHaveValue(conn.id);
  await next.click(); // escopo
  await page.getByRole('radio', { name: /Todas as contas e oportunidades/ }).check();
  await next.click(); // registros
  await expect(page.getByText(/Conferência:/)).toBeVisible();
  await next.click(); // mapeamento
  await expect(page.getByRole('row', { name: 'Campo Nome / razão social' })).toBeVisible();
  await page.getByRole('tab', { name: /negocios → Oportunidades/ }).click();
  await expect(page.getByRole('row', { name: 'Campo Valor' }).locator('td').nth(2)).toContainText('1.234,56'); // exemplo real da origem
  await page.screenshot({ path: 'test-results/import-mapeamento.png', fullPage: true });
  await next.click(); // validação
  await page.getByRole('button', { name: 'Validar correspondências' }).click();
  await expect(page.getByText('Sem pendências: destino e origem conferidos.')).toBeVisible();
  await next.click(); // simulação
  await page.getByRole('button', { name: 'Simular' }).click();
  await expect(page.getByText('Concluída', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('region', { name: 'Indicadores de qualidade' })).toBeVisible();
  await page.getByRole('list', { name: 'Lista de registros' }).getByRole('button', { name: new RegExp(`Negócio CSV ${st}`) }).click();
  const rec = page.getByRole('article', { name: 'Registro selecionado' });
  await expect(rec.getByText('de: 1.234,56')).toBeVisible();
  await page.screenshot({ path: 'test-results/import-simulacao.png', fullPage: true });
  expect(psql(`select count(*) from opportunities where title like 'Negócio % ${st}'`)).toBe('0'); // simulação não grava
  await next.click(); // revisão
  await next.click(); // aprovação
  await page.getByLabel('Confirmo a gravação definitiva no ISP Sprint conforme a simulação.').check();
  await page.getByRole('button', { name: 'Aprovar e executar' }).click();
  await expect(page.getByRole('region', { name: 'Simulação × importação' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Conferir resultados' }).click();
  await expect(page.getByRole('region', { name: 'Simulação × importação' }).getByRole('row', { name: /Criar/ })).toContainText('3');
  await page.screenshot({ path: 'test-results/import-conferencia.png', fullPage: true });
  expect(psql(`select count(*) from opportunities where title like 'Negócio % ${st}'`)).toBe('2');
  expect(psql(`select stage || ':' || value_cents from opportunities where title = 'Negócio CSV ${st}'`)).toBe('ganha:123456');
});
