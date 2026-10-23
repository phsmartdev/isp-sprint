import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Sprint@2026';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

async function newOpportunity(page: Page, name: string, opts: { type?: string } = {}) {
  await page.goto('/opportunities/new');
  await page.getByLabel('Nome do cliente').fill(name);
  await page.getByLabel('Tipo de venda').selectOption({ label: opts.type ?? 'Venda Consultiva' });
  await page.getByLabel('Filial').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Iniciar Negociação' }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  return page.url();
}

test('login inválido mostra erro e não entra', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('lucas@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('errada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos');
  await expect(page).toHaveURL(/\/login/);
});

test('login: mostrar senha, esqueci minha senha e link de redefinição inválido', async ({ page }) => {
  await page.goto('/login');
  const pwd = page.getByLabel('Senha', { exact: true });
  await pwd.fill('Sprint@2026');
  await expect(pwd).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Mostrar senha' }).click();
  await expect(pwd).toHaveAttribute('type', 'text');
  // o E2E sobe a API com o cliente Google (simulado) configurado: o botão aparece
  await expect(page.getByRole('link', { name: 'Entrar com Google' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
  await page.getByLabel('E-mail').fill('ninguem@exemplo.test');
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await expect(page.getByRole('status')).toContainText('Se o e-mail estiver cadastrado');
  await page.goto('/redefinir-senha?token=token-invalido-de-teste-123');
  await page.getByLabel('Nova senha', { exact: true }).fill('NovaSenha@2026');
  await page.getByLabel('Repita a nova senha', { exact: true }).fill('NovaSenha@2026');
  await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  await expect(page.getByRole('alert')).toContainText('Link inválido ou expirado');
  await page.goto('/login?erro=google_sem_usuario');
  await expect(page.getByRole('alert')).toContainText('Não há usuário ativo no CRM');
});

test('rota protegida redireciona para login e volta depois', async ({ page }) => {
  await page.goto('/opportunities');
  await expect(page).toHaveURL(/\/login\?next=%2Fopportunities/);
  await page.getByLabel('E-mail').fill('lucas@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/opportunities$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Oportunidades' })).toBeVisible();
});

test('menu segue o nível de acesso: vendedor, supervisão e gerência', async ({ browser }) => {
  const v = await (await browser.newContext()).newPage();
  await login(v, 'lucas@yepnet.test');
  const nav = v.getByRole('navigation', { name: 'Navegação principal' });
  await nav.getByRole('button', { name: /^Marketing/ }).click();
  await expect(nav.getByRole('link', { name: /Leads/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Inteligência/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /Configuração/ })).toHaveCount(0);
  await v.goto('/settings/security');
  await expect(v.getByText('Sem acesso a este módulo')).toBeVisible();
  await v.goto('/reports');
  await expect(v.getByText('Seu perfil vê apenas os próprios números.')).toBeVisible();

  const s = await (await browser.newContext()).newPage();
  await login(s, 'ana@yepnet.test');
  await expect(s.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: /Inteligência/ })).toBeVisible();
  await expect(s.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: /Configuração/ })).toHaveCount(0);

  const g = await (await browser.newContext()).newPage();
  await login(g, 'carlos@yepnet.test');
  await g.goto('/settings/security');
  await expect(g.getByRole('heading', { name: 'Níveis de acesso por módulo' })).toBeVisible();
  await expect(g.getByLabel('Gerência em Configurações')).toBeDisabled();
});

test('gerência muda nível na matriz e o vendedor sente na hora', async ({ browser }) => {
  const g = await (await browser.newContext()).newPage();
  await login(g, 'carlos@yepnet.test');
  await g.goto('/settings/security');
  await g.getByLabel('Vendedor em Inteligência').selectOption('proprio');
  await expect(g.getByText('Vendedor · Inteligência: Próprio')).toBeVisible();
  const v = await (await browser.newContext()).newPage();
  await login(v, 'lucas@yepnet.test');
  await expect(v.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: /Inteligência/ })).toBeVisible();
  await g.getByLabel('Vendedor em Inteligência').selectOption('nenhum');
  await expect(g.getByText('Vendedor · Inteligência: Sem acesso')).toBeVisible();
});

test('Personalização: identidade BKT fixa, sem envio de imagens', async ({ page }) => {
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/branding');
  await expect(page.getByRole('heading', { name: 'Identidade visual BKT' })).toBeVisible();
  await expect(page.getByText('Mascote — Leads')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'BKT' }).first()).toBeVisible();
});

test('Sprint: cria, salva sozinho, sobrevive a refresh sem zerar o tempo', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await newOpportunity(page, 'Cliente E2E Autosave');
  await page.getByLabel('Nome do deal').fill('Autosave — 500 Mega com Wi-Fi 6');
  await expect(page.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible();
  await page.waitForTimeout(2200);
  const before = await page.getByRole('timer').locator('p').first().textContent();
  await page.reload();
  await expect(page.getByLabel('Nome do deal')).toHaveValue('Autosave — 500 Mega com Wi-Fi 6');
  const after = await page.getByRole('timer').locator('p').first().textContent();
  expect(after).not.toBe('00:00');
  expect(after! >= before!).toBe(true);
  await page.getByRole('tab', { name: 'Histórico' }).click();
  await expect(page.getByText('Oportunidade criada')).toBeVisible();
});

test('Nova oportunidade: tipo de venda obrigatório; só os quatro tipos; CNPJ e endereço do cliente; sem duplicar CNPJ', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await page.goto('/opportunities/new');
  const tipo = page.getByLabel('Tipo de venda');
  await expect(tipo.locator('option')).toHaveCount(5);
  const options = (await tipo.locator('option').allTextContents()).slice(1);
  expect(options).toEqual(['Licitação', 'Adesão à Ata', 'Consumo de Contrato', 'Venda Consultiva']);
  await expect(page.getByText('O que motivou o contato?')).toHaveCount(0);
  await expect(page.getByText('Prévia da viabilidade')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Endereço de entrega' })).toBeVisible();
  await expect(page.getByLabel('Condomínio')).toHaveCount(0);
  const doc = `${Date.now()}`.slice(-14).padStart(14, '1');
  await page.getByLabel('Nome do cliente').fill('Prefeitura E2E Tipo');
  await page.getByLabel('CNPJ').fill(doc);
  await page.locator('#no-acc-street').fill('Praça da Matriz');
  await page.getByRole('button', { name: 'Iniciar Negociação' }).click();
  await expect(page.getByText('Escolha o tipo de venda', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Escolha a filial da venda')).toBeVisible();
  await tipo.selectOption({ label: 'Licitação' });
  await expect(page.getByLabel('Etapa do funil')).toBeVisible();
  await page.getByLabel('Etapa do funil').selectOption({ label: 'Análise do edital' });
  const filiais = (await page.getByLabel('Filial').locator('option').allTextContents()).slice(1);
  expect(filiais).toEqual(['BKT Soluções', 'UPNET']);
  await page.getByLabel('Filial').selectOption({ label: 'UPNET' });
  await expect(page.getByRole('heading', { name: 'Informações de Licitação' })).toBeVisible();
  await page.getByLabel('Tipo de disputa').selectOption('Dispensa');
  await page.getByRole('button', { name: 'Iniciar Negociação' }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('region', { name: 'Informações do deal' })).toContainText('Licitação');
  await expect(page.getByRole('region', { name: 'Informações do deal' })).toContainText('UPNET');
  await expect(page.locator('#ws-stage')).toHaveValue('analise_edital');
  // mesmo CNPJ de novo: recusa e orienta a usar a conta existente
  await page.goto('/opportunities/new');
  await page.getByLabel('Tipo de venda').selectOption({ label: 'Venda Consultiva' });
  await page.getByLabel('Filial').selectOption({ index: 1 });
  await page.getByLabel('Nome do cliente').fill('Outra Prefeitura');
  await page.getByLabel('CNPJ').fill(doc);
  await page.getByRole('button', { name: 'Iniciar Negociação' }).click();
  await expect(page.getByText(/Já existe uma conta com este CNPJ: Prefeitura E2E Tipo/).first()).toBeVisible();
});

test('Sprint: venda fechada pede confirmação e não confirma contrato', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await newOpportunity(page, 'Cliente E2E Ganho');
  await page.getByRole('button', { name: 'Venda fechada' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('O contrato só conta como confirmado após validação no IXC');
  await dialog.getByRole('button', { name: 'Marcar venda fechada' }).click();
  // comemora o fechamento
  await expect(page.getByRole('status', { name: 'Venda fechada' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ws-stage')).toHaveValue('ganha');
  const opp = await (await page.request.get(`/api/v1/opportunities/${page.url().split('/').pop()}`)).json();
  expect(opp.contractRequestStatus).not.toBe('confirmada');
  await expect(page.locator('#ws-stage')).toBeDisabled();
});

test('Oportunidades: mover pelo menu (alternativa ao arrastar) e perder exige motivo', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await newOpportunity(page, 'Cliente E2E Kanban');
  const created = await (await page.request.get(`/api/v1/opportunities/${page.url().split('/').pop()}`)).json();
  await page.goto(`/opportunities?pipelineId=${created.pipelineId}&q=E2E%20Kanban`);
  const card = page.locator('li', { hasText: 'Cliente E2E Kanban' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Mover .* para outra etapa/ }).click();
  await page.getByRole('menuitem', { name: 'Proposta' }).click();
  await expect(page.getByRole('region', { name: /Proposta/ }).getByText('Cliente E2E Kanban')).toBeVisible();
  await card.getByRole('button', { name: /Mover .* para outra etapa/ }).click();
  await page.getByRole('menuitem', { name: 'Perdida' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Marcar como perdida' })).toBeDisabled();
  await dialog.getByLabel('Motivo da perda').selectOption('preco');
  await dialog.getByRole('button', { name: 'Marcar como perdida' }).click();
  await expect(page.getByText('Cliente E2E Kanban')).toHaveCount(0);
});

test('edição simultânea gera conflito visível, não sobrescreve em silêncio', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await login(a, 'lucas@yepnet.test');
  const url = await newOpportunity(a, 'Cliente E2E Conflito');
  const b = await (await browser.newContext()).newPage();
  await login(b, 'ana@yepnet.test');
  await b.goto(url);
  await expect(b.getByLabel('Nome do deal')).toBeVisible();
  await a.getByLabel('Nome do deal').fill('Versão da aba A');
  await expect(a.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible();
  await b.getByLabel('Nome do deal').fill('Versão da aba B');
  await expect(b.getByText('Outra pessoa alterou esta oportunidade')).toBeVisible();
  await b.getByRole('button', { name: 'Recarregar versão atual' }).click();
  await expect(b.getByLabel('Nome do deal')).toHaveValue('Versão da aba A');
});

test('fora do time ou de outra empresa não abre a oportunidade por URL', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await login(a, 'mariana@yepnet.test');
  const url = await newOpportunity(a, 'Cliente E2E Isolamento');
  for (const email of ['ana@yepnet.test', 'lucas@yepnet.test', 'vendedor@outro.test']) {
    const b = await (await browser.newContext()).newPage();
    await login(b, email);
    await b.goto(url);
    await expect(b.getByRole('alert')).toContainText('Oportunidade não encontrada');
  }
});

test('lead: criar, buscar e converter abre o workspace', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await page.goto('/leads');
  await page.getByRole('button', { name: 'Novo lead' }).first().click();
  await page.getByLabel('Nome').fill('Lead E2E Conversão');
  await page.getByRole('button', { name: 'Criar lead' }).click();
  await expect(page.getByText('Lead criado')).toBeVisible();
  await page.getByLabel('Buscar leads').fill('E2E Conversão');
  await page.getByRole('cell', { name: /^Lead E2E Conversão Internet/ }).click();
  await page.getByRole('button', { name: 'Converter em oportunidade' }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Lead E2E Conversão' })).toBeVisible();
});

test('agendar retorno não duplica e aparece na oportunidade', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await newOpportunity(page, 'Cliente E2E Retorno');
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Agendar retorno' }).first().click();
    await page.getByRole('dialog').getByLabel('O que fazer').fill('Retornar com comparação');
    await page.getByRole('dialog').getByRole('button', { name: 'Agendar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(page.getByText('Essa atividade já estava agendada')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Concluir: Retornar com comparação/ })).toHaveCount(1);
});

for (const width of [390, 768, 1280, 1440]) {
  test(`sem rolagem horizontal da página em ${width}px`, async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
    await login(page, 'carlos@yepnet.test');
    for (const path of ['/', '/leads', '/opportunities', '/customers', '/activities', '/reports', '/intelligence', '/settings', '/settings/security', '/contracts', '/contracts?t=lista', '/contracts?t=funil', '/contracts?t=calendario', '/contracts?t=renovacoes', '/contracts?t=relatorios', '/intelligence?v=contratos', '/settings/contracts', '/aprovacoes', '/settings/approvals']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} em ${width}px`).toBeLessThanOrEqual(1);
    }
  });
}

test('gerência abre jornadas, viabilidade, área, modelo de instrução e e-mail; vendedor não', async ({ browser }) => {
  const g = await (await browser.newContext()).newPage();
  await login(g, 'carlos@yepnet.test');
  for (const [path, heading] of [
    ['/settings/journeys', 'Jornadas de vendas'],
    ['/settings/viability', 'Viabilidade da venda'],
    ['/settings/area', 'Área de atendimento'],
    ['/settings/instructions', 'Modelo de instrução da inteligência do negócio'],
    ['/settings/email', 'Servidor de e-mail (SMTP)'],
  ] as const) {
    await g.goto(path);
    await expect(g.getByRole('heading', { name: heading })).toBeVisible();
  }
  await g.goto('/settings/journeys');
  await g.getByRole('button', { name: 'Configurar' }).first().click();
  await g.getByRole('tab', { name: /Automações/ }).click();
  await expect(g.getByText(/Perdeu|Recupera/).first()).toBeVisible();

  const v = await (await browser.newContext()).newPage();
  await login(v, 'lucas@yepnet.test');
  await v.goto('/settings/viability');
  await expect(v.getByText('Sem acesso a este módulo')).toBeVisible();
});

test('digitar em campo de janela não troca de campo nem fecha a janela', async ({ page }) => {
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/plans');
  await page.getByRole('button', { name: 'Cadastrar plano' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Linha').click();
  await page.keyboard.type('Yep Mais Família', { delay: 30 });
  await expect(dialog.getByLabel('Linha')).toHaveValue('Yep Mais Família');
  await expect(dialog.getByLabel('Linha')).toBeFocused();
  await dialog.getByRole('button', { name: 'Adicionar produto' }).click();
  await dialog.getByLabel('Valor unitário do produto 1').fill('');
  await dialog.getByLabel('Valor unitário do produto 1').pressSequentially('79,90', { delay: 30 });
  await expect(dialog.getByLabel('Valor unitário do produto 1')).toBeFocused();
  await expect(dialog).toBeVisible();
});
