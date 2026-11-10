import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/** Central de Playbooks: liderança cria do modelo e edita por blocos, Gerência aprova, Diretoria homologa, a operação lê e confirma ciência. */
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

test('playbook: criar do modelo, editar, aprovar em duas etapas, ler e dar ciência', async ({ page }) => {
  test.setTimeout(180_000);
  const st = Date.now().toString(36);
  const title = `Venda Consultiva ${st}`;
  // Diretoria fictícia para homologar (mesma senha do ambiente de teste)
  await login(page, 'carlos@yepnet.test');
  const dirEmail = `dir-e2e-${st}@yepnet.test`;
  expect((await page.request.post('/api/v1/admin/users', { data: { name: 'Diretora Fictícia', email: dirEmail, profile: 'diretoria', teamIds: [] } })).status()).toBe(201);
  psql(`update users set password_hash = (select password_hash from users where email = 'carlos@yepnet.test') where email = '${dirEmail}'`);

  // supervisão cria pelo ícone do topo
  await login(page, 'ana@yepnet.test');
  await page.getByRole('link', { name: 'Playbooks' }).click();
  await expect(page.getByRole('heading', { name: 'Playbooks', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Playbooks' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Novo playbook' }).click();
  await page.getByLabel('Categoria').selectOption({ label: 'Comercial e Vendas (COM)' });
  await page.getByLabel('Começar de um modelo').selectOption({ index: 1 });
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('Descrição').fill('Como conduzir a venda consultiva do início ao fim.');
  await page.getByLabel('Time dono').selectOption({ label: 'Residencial' });
  await expect(page.getByLabel('Centro de custo responsável')).not.toHaveValue('');
  await page.getByLabel('Responsável pela manutenção').selectOption({ index: 1 });
  await page.getByLabel('Leitura obrigatória: pedir confirmação de ciência').check();
  await page.getByRole('button', { name: 'Criar e editar o conteúdo' }).click();

  // editor por blocos: inserir um texto no fim e um destaque, salvamento automático
  await expect(page.getByRole('region', { name: 'Conteúdo' })).toBeVisible();
  const ins = page.getByRole('button', { name: 'Inserir bloco aqui' });
  await ins.last().click();
  await page.getByRole('menuitem', { name: 'Texto' }).click();
  const blocks = page.getByRole('region', { name: 'Conteúdo' }).locator('[aria-label^="Bloco "]');
  const last = blocks.last();
  await last.getByLabel('Texto').fill('Na **descoberta**, pergunte pelo problema antes de falar do produto.');
  await expect(page.getByRole('status').filter({ hasText: /^Salvo/ })).toBeVisible({ timeout: 15_000 });
  // reordenar: sobe o bloco novo
  await last.getByRole('button', { name: 'Subir bloco' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Salvo/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Prévia' }).click();
  await expect(page.getByRole('article', { name: 'Prévia' })).toContainText('pergunte pelo problema');
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.screenshot({ path: 'test-results/playbook-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
  const dlg = page.getByRole('dialog', { name: 'Enviar para aprovação' });
  await dlg.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Enviado à Gerência')).toBeVisible();

  // operação ainda não vê (não publicado)
  await login(page, 'lucas@yepnet.test');
  await page.goto(`/playbooks?q=${encodeURIComponent(st)}`);
  await expect(page.getByRole('article', { name: title })).toHaveCount(0);

  // Gerência aprova, lado a lado
  await login(page, 'carlos@yepnet.test');
  await page.goto('/playbooks?aba=aprovacoes');
  await page.getByRole('link', { name: 'Analisar' }).first().click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('region', { name: 'O que mudou' })).toContainText('pergunte pelo problema');
  await page.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await expect(page.getByText('Aprovado e enviado à Diretoria')).toBeVisible();

  // Diretoria homologa e publica
  await login(page, dirEmail);
  await page.goto('/playbooks?aba=aprovacoes');
  await page.getByRole('link', { name: 'Analisar' }).first().click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.screenshot({ path: 'test-results/playbook-aprovacao.png', fullPage: true });
  await page.getByRole('button', { name: 'Homologar' }).click();
  await expect(page.getByText('Homologado e publicado')).toBeVisible();

  // operação encontra pela busca, lê e confirma ciência
  await login(page, 'lucas@yepnet.test');
  await page.goto('/playbooks');
  await page.getByLabel('Buscar playbooks').fill('pergunte pelo problema');
  await expect(page.getByText('1 playbook(s) para “pergunte pelo problema”')).toBeVisible();
  const card = page.getByRole('article', { name: title });
  await expect(card).toHaveCount(1);
  await page.screenshot({ path: 'test-results/playbook-biblioteca.png', fullPage: true });
  await card.getByRole('link', { name: title }).click();
  await expect(page.getByText('pergunte pelo problema')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmo que li e entendi' }).click();
  await expect(page.getByText(/Ciência confirmada na versão 1\.0/)).toBeVisible();
  await page.screenshot({ path: 'test-results/playbook-leitura.png', fullPage: true });

  // histórico mostra quem aprovou
  await page.goto(page.url().split('?')[0] + '/versoes');
  const row = page.getByRole('listitem').filter({ hasText: 'v1.0' });
  await expect(row).toContainText('Vigente');
  await expect(row).toContainText('Carlos Silva');
  await expect(row).toContainText('Diretora Fictícia');
});

test('categorias: a Diretoria cria, edita e exclui direto na biblioteca', async ({ page }) => {
  test.setTimeout(120_000);
  const st = Date.now().toString(36);
  await login(page, 'carlos@yepnet.test');
  const dirEmail = `dir-cat-${st}@yepnet.test`;
  expect((await page.request.post('/api/v1/admin/users', { data: { name: 'Diretor Categorias', email: dirEmail, profile: 'diretoria', teamIds: [] } })).status()).toBe(201);
  psql(`update users set password_hash = (select password_hash from users where email = 'carlos@yepnet.test') where email = '${dirEmail}'`);
  await login(page, dirEmail);
  await page.goto('/playbooks');
  const cats = page.getByRole('region', { name: 'Categorias' });
  await cats.getByRole('button', { name: 'Nova categoria' }).click();
  let dlg = page.getByRole('dialog', { name: 'Nova categoria' });
  await dlg.getByLabel('Nome').fill(`Treinamento ${st}`);
  await dlg.getByLabel('Prefixo do código').fill('TRN');
  await dlg.getByLabel('Descrição').fill('Trilhas de capacitação.');
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  const item = cats.getByRole('listitem', { name: `Treinamento ${st}` });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: `Editar Treinamento ${st}` }).click();
  dlg = page.getByRole('dialog', { name: 'Editar categoria' });
  await dlg.getByLabel('Nome').fill(`Capacitação ${st}`);
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  const renamed = cats.getByRole('listitem', { name: `Capacitação ${st}` });
  await expect(renamed).toBeVisible();
  await page.screenshot({ path: 'test-results/playbook-categorias.png', fullPage: true });
  await renamed.getByRole('button', { name: `Excluir Capacitação ${st}` }).click();
  await page.getByRole('dialog', { name: `Excluir “Capacitação ${st}”?` }).getByRole('button', { name: 'Excluir' }).click();
  await expect(renamed).toHaveCount(0);
  expect(psql(`select count(*) from playbook_categories where name like '%${st}'`)).toBe('0');
});

test('Diretriz de Gamificação: regra vigente em abas, simulador e calculadora de meta', async ({ page }) => {
  test.setTimeout(120_000);
  const tenant = psql(`select tenant_id from users where email = 'lucas@yepnet.test'`);
  const pipe = psql(`select id from pipelines where tenant_id = '${tenant}' limit 1`);
  const cfg = JSON.stringify({ journeys: [{ key: 'e2e_jornada', name: 'Jornada E2E', pipelineId: pipe, wonPoints: 40, components: [{ key: 'diag', name: 'Diagnóstico fictício', stageKey: null, points: 10, dueDays: 3, level: null }] }] });
  psql(`insert into gamification_settings (tenant_id, version, config, note, status, created_by) values ('${tenant}', (select coalesce(max(version),0)+1 from gamification_settings where tenant_id = '${tenant}'), '${cfg}'::jsonb, 'E2E', 'aprovada', (select id from users where email = 'carlos@yepnet.test'))`);
  await login(page, 'lucas@yepnet.test');
  await page.goto('/playbooks');
  await expect(page.getByRole('heading', { name: 'Playbooks', level: 1 })).toBeVisible();
  const q = `select p.id from playbooks p join playbook_versions v on v.id = p.current_version_id where p.tenant_id = '${tenant}' and v.meta->'contexts' ? 'sistema:diretriz_gamificacao'`;
  await expect.poll(() => psql(q)).not.toBe(''); // criada na primeira abertura da Central
  const pid = psql(q);
  await page.goto(`/playbooks/${pid}`);
  await expect(page.getByRole('heading', { name: 'Diretriz de Gamificação' }).first()).toBeVisible();
  const rule = page.getByRole('region', { name: 'Regra vigente da gamificação' });
  await expect(rule.getByRole('tab', { name: 'Níveis e nota' })).toHaveAttribute('aria-selected', 'true');
  await expect(rule.getByText('você', { exact: true })).toBeVisible();
  await rule.getByRole('tab', { name: 'Como pontuar' }).click();
  await expect(rule.getByText('Diagnóstico fictício')).toBeVisible();
  await rule.getByRole('tab', { name: 'Simular minha nota' }).click();
  await expect(rule.getByTestId('sim-score')).toBeVisible();
  const calc = page.getByRole('region', { name: 'Quantas tarefas faltam para a minha meta?' });
  await calc.getByLabel('Quero chegar a (pontos)').fill('1000');
  await calc.getByLabel('Tarefa ou evento').selectOption({ label: 'Diagnóstico fictício · 10 pts' });
  await expect(calc.getByTestId('calc-need')).toHaveText('84'); // 10 pts + 20% no prazo = 12 → 1000/12
  await calc.getByLabel('Qualificada pela gerência (+30%)').check();
  await expect(calc.getByTestId('calc-need')).toHaveText('67'); // 15 pts
  await calc.getByLabel('Quantidade de Diagnóstico fictício').fill('40');
  await expect(calc.getByLabel('Resultado do plano')).toContainText('600');
  const flow = page.getByLabel('Fluxograma Do pedido aos pontos');
  await flow.scrollIntoViewIfNeeded();
  await expect(flow.getByText('Colega assume')).toBeVisible();
  await flow.screenshot({ path: 'test-results/diretriz-fluxo.png' });
  await page.screenshot({ path: 'test-results/diretriz-gamificacao.png', fullPage: true });
});

test('importar playbook de PDF: estrutura padrão como primeiro rascunho, com o PDF original anexado', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/playbooks/novo');
  await page.getByLabel('Arquivo PDF do playbook').setInputFiles('tests/e2e/fixtures/playbook-ficticio.pdf');
  const res = page.getByLabel('Resultado da importação');
  await expect(res).toContainText('3 página(s)');
  await expect(res.getByRole('listitem')).toHaveText(['Objetivo', 'Pontos de atencao', 'Passo a passo', 'Encerramento']);
  await expect(page.getByLabel('Título')).toHaveValue('Playbook de Atendimento Ficticio');
  await page.screenshot({ path: 'test-results/playbook-importar-pdf.png', fullPage: true });
});
