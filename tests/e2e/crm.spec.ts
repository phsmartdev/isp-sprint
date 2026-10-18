import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Sprint@2026';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

async function newOpportunity(page: Page, name: string, opts: { plan?: boolean } = {}) {
  await page.goto('/opportunities/new');
  await page.getByLabel('Nome do cliente').fill(name);
  if (opts.plan !== false) await page.getByLabel('Plano', { exact: true }).selectOption({ index: 1 });
  await page.getByText('Oferta / curiosidade').click();
  await page.getByRole('button', { name: 'Iniciar Sprint' }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  return page.url();
}

test('login inválido mostra erro e não entra', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('lucas@yepnet.test');
  await page.getByLabel('Senha').fill('errada');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('E-mail ou senha incorretos');
  await expect(page).toHaveURL(/\/login/);
});

test('rota protegida redireciona para login e volta depois', async ({ page }) => {
  await page.goto('/opportunities');
  await expect(page).toHaveURL(/\/login\?next=%2Fopportunities/);
  await page.getByLabel('E-mail').fill('lucas@yepnet.test');
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/opportunities$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Oportunidades' })).toBeVisible();
});

test('menu segue o nível de acesso: vendedor, supervisão e gerência', async ({ browser }) => {
  const v = await (await browser.newContext()).newPage();
  await login(v, 'lucas@yepnet.test');
  const nav = v.getByRole('navigation', { name: 'Navegação principal' });
  await expect(nav.getByRole('link', { name: /Leads/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Inteligência/ })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: /Configurações/ })).toHaveCount(0);
  await v.goto('/settings/security');
  await expect(v.getByText('Sem acesso a este módulo')).toBeVisible();
  await v.goto('/reports');
  await expect(v.getByText('Seu perfil vê apenas os próprios números.')).toBeVisible();

  const s = await (await browser.newContext()).newPage();
  await login(s, 'ana@yepnet.test');
  await expect(s.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: /Inteligência/ })).toBeVisible();
  await expect(s.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: /Configurações/ })).toHaveCount(0);

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

test('Personalização: espaços de imagem com envio na tela de configurações', async ({ page }) => {
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/branding');
  await expect(page.getByText('Mascote — Leads')).toBeVisible();
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
  await page.getByLabel('Arquivo para Mascote — Leads').setInputFiles({ name: 'dino.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Mascote — Leads atualizado')).toBeVisible();
  await page.getByLabel('Arquivo para Logo (fundo escuro)').setInputFiles({ name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByText(/SVG não é aceito/)).toBeVisible();
});

test('Sprint: cria, salva sozinho, sobrevive a refresh sem zerar o tempo', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await newOpportunity(page, 'Cliente E2E Autosave');
  await page.getByLabel('Anotações da conversa').fill('Satisfeita com o atual, curiosa com a oferta. Preço atual não informado.');
  await expect(page.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible();
  await page.waitForTimeout(2200);
  const before = await page.getByRole('timer').locator('p').first().textContent();
  await page.reload();
  await expect(page.getByLabel('Anotações da conversa')).toHaveValue(/curiosa com a oferta/);
  const after = await page.getByRole('timer').locator('p').first().textContent();
  expect(after).not.toBe('00:00');
  expect(after! >= before!).toBe(true);
  await page.getByRole('tab', { name: 'Histórico' }).click();
  await expect(page.getByText('Oportunidade criada')).toBeVisible();
});

test('Sprint: plano define o valor pelo catálogo', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await newOpportunity(page, 'Cliente E2E Plano', { plan: false });
  const plan = page.getByLabel('Plano', { exact: true });
  const option = plan.locator('option').nth(1);
  const text = (await option.textContent())!;
  await plan.selectOption({ index: 1 });
  await expect(page.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible();
  const price = text.split('—')[1]!.trim();
  await expect(page.getByText(new RegExp(`^Catálogo: ${price.replace(/[$.]/g, '\\$&')}/mês`))).toBeVisible();
});

test('Sprint: venda fechada pede confirmação e não confirma contrato', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await newOpportunity(page, 'Cliente E2E Ganho');
  await page.getByRole('button', { name: 'Venda fechada' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('O contrato só conta como confirmado após validação no IXC');
  await dialog.getByRole('button', { name: 'Marcar venda fechada' }).click();
  await expect(page.locator('#ws-stage')).toHaveValue('ganha');
  await expect(page.getByText(/Contrato: (?!Confirmad)/)).toBeVisible();
  await expect(page.locator('#ws-stage')).toBeDisabled();
});

test('Oportunidades: mover pelo menu (alternativa ao arrastar) e perder exige motivo', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await newOpportunity(page, 'Cliente E2E Kanban');
  await page.goto('/opportunities?q=E2E%20Kanban');
  const card = page.locator('li', { hasText: 'Cliente E2E Kanban' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Mover .* para outra etapa/ }).click();
  await page.getByRole('menuitem', { name: 'Proposta' }).click();
  await expect(page.getByRole('region', { name: /Proposta/ }).getByText('Cliente E2E Kanban')).toBeVisible();
  await card.getByRole('button', { name: /Mover .* para outra etapa/ }).click();
  await page.getByRole('menuitem', { name: 'Perdido' }).click();
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
  await expect(b.getByLabel('Anotações da conversa')).toBeVisible();
  await a.getByLabel('Próxima ação').fill('Versão da aba A');
  await expect(a.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible();
  await b.getByLabel('Anotações da conversa').fill('Versão da aba B');
  await expect(b.getByText('Outra pessoa alterou esta oportunidade')).toBeVisible();
  await b.getByRole('button', { name: 'Recarregar versão atual' }).click();
  await expect(b.getByLabel('Próxima ação')).toHaveValue('Versão da aba A');
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
    for (const path of ['/', '/leads', '/opportunities', '/customers', '/activities', '/reports', '/intelligence', '/settings', '/settings/security']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} em ${width}px`).toBeLessThanOrEqual(1);
    }
  });
}

test('cadastro com condomínio, metragem e venda ativa mostra comissão, CAC e LTV', async ({ page }) => {
  await login(page, 'lucas@yepnet.test');
  await page.goto('/opportunities/new');
  await page.getByLabel('Nome do cliente').fill('Cliente E2E Viabilidade');
  await page.getByLabel('Nome do deal').fill('500 Mega Ap 101');
  const condo = page.getByLabel('Condomínio');
  await condo.selectOption({ index: 1 });
  await page.getByLabel('Apartamento').fill('101');
  await page.getByLabel('Plano', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('radiogroup', { name: 'Tipo de venda' }).getByRole('radio', { name: 'Ativa' }).click();
  await page.getByLabel('Metragem de cabo (m)').fill('80');
  const preview = page.locator('aside');
  await expect(preview.getByText('CAC', { exact: true }).first()).toBeVisible();
  await expect(preview.getByText('LTV histórico')).toBeVisible();
  await page.getByRole('button', { name: 'Iniciar Sprint' }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Sua comissão').first()).toBeVisible();
  await expect(page.getByLabel('Apartamento').first()).toHaveValue('101');
});

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
