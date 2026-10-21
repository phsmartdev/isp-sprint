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

test('Gestão de Times: estrutura organizacional e perspectivas por responsabilidade', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/resultados');
  await page.getByRole('button', { name: 'Nova unidade' }).click();
  let d = page.getByRole('dialog', { name: 'Nova unidade' });
  await d.getByLabel('Nome').fill('Diretoria Comercial E2E');
  await d.getByLabel('Tipo').selectOption('diretoria');
  await d.getByLabel('Responsável').selectOption({ label: 'Carlos Silva' });
  await d.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Diretoria Comercial E2E', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Nova unidade' }).click();
  d = page.getByRole('dialog', { name: 'Nova unidade' });
  await d.getByLabel('Nome').fill('Área Empresarial E2E');
  await d.getByLabel('Unidade superior').selectOption({ label: 'Diretoria Comercial E2E' });
  await d.getByLabel('Responsável').selectOption({ label: 'Ana Souza' });
  await d.getByLabel('Alçada para aprovar (R$)').fill('50.000,00');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Área Empresarial E2E', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Unidade do time Empresarial').selectOption({ label: 'Área Empresarial E2E' });
  await expect(page.getByText('Time atualizado')).toBeVisible();
  await shot(page, 'gr-estrutura');

  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('button', { name: /^Gestão de Times/ }).click();
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Visão geral', exact: true }).click();
  await expect(page).toHaveURL(/\/times/);
  await expect(page.getByRole('heading', { name: 'Gestão de Times', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Diretoria' })).toBeVisible();
  await expect(page.getByText('Estamos alcançando os objetivos do negócio?')).toBeVisible();
  await page.getByRole('tab', { name: 'Gestão' }).click();
  await expect(page.getByText('As equipes e os processos estão entregando o resultado esperado?')).toBeVisible();
  await shot(page, 'gr-perspectivas');
});

test('Apuração oficial: fechamento, validação e pedido de revisão', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const H = { origin: new URL(page.url()).origin };
  const api = async (method: 'get' | 'post', url: string, data?: object) => { const r = await page.request[method](`/api/v1${url}`, { headers: H, ...(data ? { data } : {}) }); expect(r.status(), await r.text()).toBeLessThan(300); return r.json(); };
  const users = (await api('get', '/admin/users')).users as { id: string; email: string }[];
  const lucas = users.find((u) => u.email === 'lucas@yepnet.test')!.id;
  const ind = (await api('post', '/performance/indicators', { def: { name: 'Tarefas E2E GR', category: 'tarefas', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'tarefa_concluida', measure: 'contagem' } } })).id;
  const past = (await api('post', '/performance/goals', { title: 'Meta fechada de janeiro', scope: 'individual', userId: lucas, indicatorId: ind, periodType: 'personalizado', periodStart: '2026-01-01', periodEnd: '2026-01-31', target: 6 })).id;
  await api('post', '/performance/goals', { title: 'Meta do mês do Lucas', scope: 'individual', userId: lucas, indicatorId: ind, periodType: 'mes', target: 6, recurring: true });
  await page.goto(`/desempenho/metas?goal=${past}`);
  const dr = page.getByRole('dialog', { name: 'Meta' });
  await expect(dr.getByText('Apuração oficial')).toBeVisible();
  await expect(dr.getByText(/Consolidado · v1/)).toBeVisible();
  await dr.getByRole('button', { name: 'Conferir dados de origem' }).click();
  await expect(dr.getByText(/Os dados (de origem não mudaram|mudaram)/)).toBeVisible();
  await dr.getByRole('button', { name: 'Validar apuração' }).click();
  await expect(dr.getByText(/Validado · v2/)).toBeVisible();
  await shot(page, 'gr-apuracao');
  await dr.getByRole('button', { name: 'Fechar' }).click();

  await page.getByRole('button', { name: /^Conta de / }).click();
  await page.getByRole('menuitem', { name: /Sair/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, 'lucas@yepnet.test');
  await page.goto('/desempenho/metas');
  await page.getByRole('button', { name: /Meta do mês do Lucas/ }).click();
  const d2 = page.getByRole('dialog', { name: 'Meta' });
  await d2.getByLabel('Alvo proposto').fill('4');
  await d2.getByLabel('Justificativa').fill('Uma semana de treinamento obrigatório');
  await d2.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.getByText('Pedido de revisão enviado à liderança')).toBeVisible();
});

test('Marketing → ABM e Produto no menu agrupado', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  await nav.getByRole('button', { name: /^Comercial/ }).click();
  await expect(nav.getByRole('link', { name: 'Contas', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: /^Marketing/ }).click();
  await nav.getByRole('link', { name: 'ABM', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ABM — Contas Estratégicas', level: 1 })).toBeVisible();

  // nova conta para prospectar: cadastro único, sem exigir o que ainda não se sabe
  const stamp = Date.now().toString(36);
  const name = `Hospital Regional Fictício ${stamp}`;
  await page.getByRole('button', { name: 'Nova conta' }).first().click();
  let d = page.getByRole('dialog', { name: 'Nova conta para prospectar' });
  await d.getByLabel(/Nome da organização/).fill(name);
  await d.getByLabel('Natureza').selectOption('publica');
  await d.getByLabel('Segmento').selectOption('governamental');
  await d.getByLabel('Cidade').fill('Aracaju');
  await d.getByLabel('Prioridade').selectOption('critica');
  await d.getByLabel(/Motivo da seleção/).fill('Edital de conectividade previsto para o próximo semestre');
  await d.getByRole('button', { name: 'Cadastrar e incluir no ABM' }).click();
  await expect(page.getByText('Conta cadastrada e incluída no ABM como candidata')).toBeVisible();
  const dr = page.getByRole('dialog', { name: 'Conta ABM' });
  await expect(dr.getByRole('heading', { name })).toBeVisible();
  await expect(dr.getByText('Candidata', { exact: true }).first()).toBeVisible();
  await expect(dr.getByText('Conta identificada')).toBeVisible();
  await dr.getByLabel('Status ABM').selectOption('selecionada');
  await dr.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Conta atualizada')).toBeVisible();
  await expect(dr.getByText(/mudou o status para Selecionada/)).toBeVisible();
  await shot(page, 'abm');
  await page.keyboard.press('Escape');

  // nome parecido: o sistema mostra a duplicidade e pede confirmação
  await page.getByRole('button', { name: 'Nova conta' }).first().click();
  d = page.getByRole('dialog', { name: 'Nova conta para prospectar' });
  await d.getByLabel(/Nome da organização/).fill(`Hosp. Regional Ficticio ${stamp}`);
  const dup = d.getByRole('region', { name: 'Possíveis duplicidades' });
  await expect(dup.getByText(name)).toBeVisible();
  await d.getByLabel(/Motivo da seleção/).fill('Unidade privada vizinha, outra mantenedora');
  await expect(d.getByRole('button', { name: 'Cadastrar e incluir no ABM' })).toBeDisabled();
  await dup.getByLabel('É outra organização').first().check();
  await d.getByLabel(/Por que não é a mesma organização/).fill('Mantenedora diferente, CNPJ próprio');
  await d.getByRole('button', { name: 'Cadastrar e incluir no ABM' }).click();
  await expect(page.getByText('Conta cadastrada e incluída no ABM como candidata')).toBeVisible();
  await page.keyboard.press('Escape');

  // conta existente: "Adicionar ao ABM" na própria ficha da conta (sem novo cadastro)
  await page.goto('/customers');
  await page.locator('tbody tr').first().click();
  await expect(page).toHaveURL(/\/customers\/.+/);
  const add = page.getByRole('button', { name: 'Adicionar ao ABM' });
  await expect(add.or(page.getByRole('link', { name: /^No ABM:/ }))).toBeVisible();
  if (await add.isVisible()) {
    await add.click();
    const m = page.getByRole('dialog', { name: 'Adicionar ao ABM' });
    await m.getByLabel(/Motivo da seleção/).fill('Cliente com potencial de expansão para filiais');
    await m.getByRole('button', { name: 'Adicionar' }).click();
    await expect(page.getByText('Conta adicionada ao ABM')).toBeVisible();
  }
  await expect(page.getByRole('link', { name: /^No ABM:/ })).toBeVisible();
  await page.goto('/abm');
  await page.keyboard.press('Escape');
  await nav.getByRole('link', { name: 'Produto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Produto', level: 1 })).toBeVisible();
  await expect(page.getByText('800 Mega').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Editar catálogo' })).toBeVisible();
  await shot(page, 'produto');
});

test('Intervenções: vermelho na apuração exige plano de ação; o avaliado só acompanha', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const H = { origin: new URL(page.url()).origin };
  const api = async (p: Page, method: 'get' | 'post', url: string, data?: object) => { const r = await p.request[method](`/api/v1${url}`, { headers: H, ...(data ? { data } : {}) }); expect(r.status(), await r.text()).toBeLessThan(300); return r.json(); };
  const users = (await api(page, 'get', '/admin/users')).users as { id: string; email: string }[];
  const lucas = users.find((u) => u.email === 'lucas@yepnet.test')!.id;
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  const from = d.toLocaleDateString('en-CA'); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); const to = e.toLocaleDateString('en-CA');
  const title = `Visitas do Lucas E2E ${Date.now().toString(36)}`;
  const goal = (await api(page, 'post', '/performance/goals', { title, scope: 'individual', userId: lucas, manualUnit: 'visitas', periodType: 'personalizado', periodStart: from, periodEnd: to, target: 10 })).id;
  await api(page, 'get', `/performance/goals/${goal}`); // fecha o período
  // quem não é o dono da meta retifica com o valor real: 3 de 10 → vermelho
  const ana = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await login(ana, 'ana@yepnet.test');
  await api(ana, 'post', `/results/closings/${goal}/rectify`, { reason: 'Valor conferido no relatório de visitas', value: 3, recompute: false });

  await page.goto('/times');
  await page.getByRole('link', { name: /Intervenções necessárias/ }).click();
  await expect(page.getByRole('heading', { name: 'Intervenções', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: title }).click();
  const dr = page.getByRole('dialog', { name: 'Intervenção' });
  await expect(dr.getByText('Plano de ação obrigatório · Resultado vermelho')).toBeVisible();
  await expect(dr.getByText(/Registrar o diagnóstico e o plano de ação até/)).toBeVisible();
  await expect(dr.getByRole('button', { name: 'Registrar plano de ação' })).toBeDisabled();
  await dr.getByRole('link', { name: 'Começar análise' }).click();
  // jornada: problema → Pareto → Ishikawa → 5 Porquês → conclusão
  await expect(page.getByRole('heading', { name: 'Análise da intervenção', level: 1 })).toBeVisible();
  await page.getByLabel(/^O quê/).fill('Visitas realizadas muito abaixo da meta');
  await page.getByLabel(/^Quanto/).fill('3 de 10 (30%)');
  await page.getByRole('tab', { name: /Pareto/ }).click();
  await page.getByLabel('Categoria 1', { exact: true }).fill('Agenda de suporte');
  await page.getByLabel('Valor 1', { exact: true }).fill('9');
  await page.getByRole('button', { name: 'Adicionar categoria' }).click();
  await page.getByLabel('Categoria 2', { exact: true }).fill('Cliente remarcou');
  await page.getByLabel('Valor 2', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Adicionar categoria' }).click();
  await page.getByLabel('Categoria 3', { exact: true }).fill('Deslocamento');
  await page.getByLabel('Valor 3', { exact: true }).fill('1');
  await expect(page.getByText(/Foco:.*Agenda de suporte/)).toBeVisible();
  await shot(page, 'gr-pareto');
  await page.getByRole('tab', { name: /Ishikawa/ }).click();
  for (const [cat, txt] of [['Método', 'Sem bloco fixo de visitas'], ['Pessoas', 'Suporte puxando o consultor'], ['Mercado', 'Chuvas no período']] as const) {
    await page.getByLabel(`Nova causa em ${cat}`).fill(txt);
    await page.getByRole('button', { name: `Adicionar causa em ${cat}` }).click();
  }
  await page.getByLabel('Investigar: Sem bloco fixo de visitas').check();
  await shot(page, 'gr-ishikawa');
  await page.getByRole('tab', { name: /5 Porquês/ }).click();
  const w = page.getByRole('region', { name: '5 Porquês: Sem bloco fixo de visitas' });
  await w.getByLabel(/^1º por quê/).fill('Agenda ocupada');
  await w.getByLabel(/^2º por quê/).fill('Chamados de suporte sem triagem');
  await w.getByLabel(/^3º por quê/).fill('Não há plantão de suporte para a carteira');
  await w.getByLabel('Causa raiz encontrada').fill('Falta de triagem de suporte da carteira');
  await w.getByLabel(/Evidência/).fill('9 de 13 visitas canceladas por chamado');
  await w.getByLabel('Causa raiz confirmada pela evidência').check();
  await page.getByRole('tab', { name: /Conclusão/ }).click();
  await expect(page.getByLabel('Diagnóstico')).toHaveValue(/Falta de triagem de suporte da carteira/);
  await expect(page.getByText('Salvo', { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Concluir análise' }).click();
  await expect(page.getByText(/Análise concluída\. O diagnóstico/)).toBeVisible();
  await shot(page, 'gr-analise');
  await page.getByRole('link', { name: 'Voltar à intervenção' }).click();
  // plano 5W2H: cada ação vira tarefa para quem executa
  await expect(dr.getByRole('button', { name: 'Registrar plano de ação' })).toBeDisabled();
  await dr.getByRole('button', { name: 'Nova ação 5W2H' }).click();
  await dr.getByLabel(/^O quê/).fill('Plantão de suporte para a carteira');
  await dr.getByLabel(/^Por quê/).fill('Falta de triagem de suporte da carteira');
  await dr.getByLabel(/^Quem/).selectOption({ label: 'Ana Souza' });
  await dr.getByLabel(/^Quando/).fill(new Date(Date.now() + 14 * 86_400_000).toLocaleDateString('en-CA'));
  await dr.getByLabel(/^Como/).fill('Escala semanal com dois consultores no suporte');
  await dr.getByRole('button', { name: 'Incluir ação' }).click();
  await expect(page.getByText('Ação incluída e tarefa criada para quem executa')).toBeVisible();
  await expect(dr.getByRole('link', { name: 'Plantão de suporte para a carteira' })).toBeVisible();
  await dr.getByRole('button', { name: 'Registrar plano de ação' }).click();
  await expect(dr.getByLabel(/^Diagnóstico/)).toHaveValue(/Falta de triagem/);
  await dr.getByRole('button', { name: 'Salvar plano' }).click();
  await expect(page.getByText('Plano de ação registrado')).toBeVisible();
  await expect(dr.getByText('Plano em execução').first()).toBeVisible();
  await expect(dr.getByText(/registrou o plano de ação/)).toBeVisible();
  await shot(page, 'gr-intervencao');

  // o avaliado acompanha, mas não age
  const lu = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await login(lu, 'lucas@yepnet.test');
  const mine = await api(lu, 'get', '/interventions?status=todas');
  const iv = mine.items.find((x: { goalTitle: string }) => x.goalTitle === title);
  if (iv) {
    await lu.goto(`/times/intervencoes?id=${iv.id}`);
    await expect(lu.getByRole('dialog', { name: 'Intervenção' }).getByRole('button', { name: /Concluir|Atualizar plano/ })).toHaveCount(0);
  }
});

test('Intervenção manual: escolhe o indicador e abre o roteiro sem meta fora da faixa', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  // garante ao menos um indicador cadastrado
  const H = { origin: new URL(page.url()).origin };
  const inds = await (await page.request.get('/api/v1/performance/indicators', { headers: H })).json();
  if (!inds.items.length) await page.request.post('/api/v1/performance/indicators', { headers: H, data: { def: { name: 'Tarefas concluídas', category: 'tarefas', calc: 'contagem', unit: 'quantidade', direction: 'maior', period: 'mes', base: { event: 'tarefa_concluida', measure: 'contagem' } } } });
  await page.goto('/times/intervencoes');
  await page.getByRole('button', { name: 'Nova intervenção' }).click();
  const dlg = page.getByRole('dialog', { name: 'Nova intervenção' });
  const opt = dlg.getByLabel('Indicador').locator('option');
  await expect(opt.nth(1)).toBeAttached();
  const indName = (await opt.nth(1).textContent())!.trim();
  await dlg.getByLabel('Indicador').selectOption({ index: 1 });
  const title = `Prospecção desacelerando ${Date.now().toString(36)}`;
  await dlg.getByLabel(/Problema ou oportunidade/).fill(title);
  await dlg.getByLabel(/Por que abrir agora/).fill('Queda nas últimas três semanas, ainda dentro da faixa');
  await dlg.getByLabel('Sobre').selectOption('pessoa');
  await dlg.getByLabel(/^Pessoa/).selectOption({ label: 'Lucas Lima' });
  await dlg.getByRole('button', { name: 'Abrir intervenção' }).click();
  await expect(page.getByText('Intervenção aberta. Comece pela análise de causa.')).toBeVisible();
  const dr = page.getByRole('dialog', { name: 'Intervenção' });
  await expect(dr.getByRole('heading', { name: title })).toBeVisible();
  await expect(dr.getByText('Plano de ação obrigatório · Aberta manualmente')).toBeVisible();
  await expect(dr.getByText(/Motivo: Queda nas últimas três semanas/)).toBeVisible();
  await expect(dr.getByRole('region', { name: `Evolução de ${indName}` })).toBeVisible();
  await expect(dr.getByRole('link', { name: 'Começar análise' })).toBeVisible();
  await shot(page, 'gr-intervencao-manual');
  // a análise abre normalmente mesmo sem meta ligada
  await dr.getByRole('link', { name: 'Começar análise' }).click();
  await expect(page.getByRole('heading', { name: 'Análise da intervenção', level: 1 })).toBeVisible();
  await expect(page.getByText(`${title} · responsável Carlos Silva`)).toBeVisible();
});

test('Rituais: cria ritual, conduz a reunião com pauta automática, registra decisão e impedimento e encerra a ata', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  await nav.getByRole('button', { name: /^Gestão de Times/ }).click();
  await nav.getByRole('link', { name: 'Rituais', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rituais', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /Novo ritual|Criar ritual/ }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Novo ritual' });
  await dlg.getByLabel('Começar de um modelo').selectOption({ label: 'Gestão: Reunião semanal de gestão' });
  const name = `Semanal comercial ${Date.now().toString(36)}`;
  await dlg.getByLabel(/^Nome/).fill(name);
  await dlg.getByLabel('Escopo').selectOption('empresa');
  await dlg.getByLabel('Dia da semana').selectOption(String(new Date().getDay()));
  await dlg.getByLabel(/^Participantes/).selectOption({ label: 'Ana Souza' });
  await dlg.getByRole('button', { name: 'Criar ritual' }).click();
  await expect(page.getByText('Ritual criado; as próximas reuniões já estão na agenda')).toBeVisible();
  const card = page.getByRole('listitem').filter({ hasText: name });
  await card.getByRole('link', { name: /^Próxima:/ }).click();

  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Resultados do escopo' })).toBeVisible();
  await page.getByRole('region', { name: 'Presença' }).getByLabel('Carlos Silva').check();
  await page.getByRole('region', { name: 'Presença' }).getByLabel('Ana Souza').check();
  await page.getByLabel('Metas da semana').fill('Residencial acima do ritmo; empresarial abaixo');
  const rec = page.getByRole('region', { name: 'Decisões e impedimentos da reunião' });
  await rec.getByRole('button', { name: 'Registrar decisão' }).click();
  await rec.getByLabel(/^Decisão/).fill('Priorizar condomínios com rede pronta');
  await rec.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByText('Decisão registrada', { exact: true })).toBeVisible();
  await rec.getByRole('button', { name: 'Registrar impedimento' }).click();
  await rec.getByLabel(/O que está travando/).fill('Mapa de cobertura desatualizado');
  await rec.getByLabel(/Quem remove/).selectOption({ label: 'Ana Souza' });
  await rec.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByText('Impedimento registrado e responsável avisado', { exact: true })).toBeVisible();
  await expect(page.getByText('Salvo').first()).toBeVisible({ timeout: 10_000 });
  await shot(page, 'gr-reuniao');
  await page.getByRole('button', { name: 'Encerrar ata' }).click();
  await expect(page.getByText('Ata encerrada e enviada aos participantes')).toBeVisible();
  await expect(page.getByText(/Ata encerrada por Carlos Silva/)).toBeVisible();
  await expect(page.getByLabel('Metas da semana')).toHaveAttribute('readonly', '');

  await page.goto('/times/decisoes');
  await expect(page.getByText('Priorizar condomínios com rede pronta')).toBeVisible();
  await page.getByRole('tab', { name: 'Impedimentos' }).click();
  await page.getByRole('button', { name: 'Mapa de cobertura desatualizado' }).click();
  const dr = page.getByRole('dialog', { name: 'Impedimento' });
  await dr.getByLabel('Situação').selectOption('removido');
  await dr.getByLabel(/Como foi removido/).fill('Engenharia publicou o mapa atualizado');
  await dr.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Impedimento atualizado', { exact: true })).toBeVisible();
  await expect(dr.getByText(/removeu: Engenharia publicou o mapa atualizado/)).toBeVisible();
});

test('ABM Conta 360: cabeçalho estratégico, objetivo, estrutura organizacional e histórico', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const H = { origin: new URL(page.url()).origin };
  const name = `Prefeitura Fictícia de Teste ${Date.now().toString(36)}`;
  const r = await page.request.post('/api/v1/abm/new-account', { headers: H, data: { name, nature: 'publica', segment: 'governamental', city: 'Aracaju', reason: 'Programa de cidades conectadas', objective: 'Abrir relacionamento com a Secretaria de Saúde' } });
  expect(r.status(), await r.text()).toBe(201);
  await page.goto('/abm');
  await page.getByLabel('Buscar conta').fill(name);
  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  const head = page.getByRole('banner', { name: 'Cabeçalho da conta' }).or(page.locator('header[aria-label="Cabeçalho da conta"]'));
  await expect(head.getByText('Abrir relacionamento com a Secretaria de Saúde')).toBeVisible();
  await expect(head.getByText('Conta identificada')).toBeVisible();

  const obj = page.getByRole('region', { name: 'Objetivos da conta' });
  await obj.getByRole('button', { name: 'Novo objetivo' }).click();
  await obj.getByLabel('Tipo').selectOption('identificar_decisores');
  await obj.getByLabel(/^Objetivo/).fill('Identificar quem decide a conectividade das UBS');
  await obj.getByRole('button', { name: 'Incluir objetivo' }).click();
  await expect(page.getByText('Objetivo incluído')).toBeVisible();
  await obj.getByRole('button', { name: 'Iniciar' }).click();
  await expect(obj.getByText('Em andamento')).toBeVisible();
  await obj.getByRole('button', { name: 'Marcar como atingido' }).click();
  await obj.getByLabel(/^Resultado/).fill('Secretário e coordenador de TI identificados em reunião');
  await obj.getByRole('button', { name: 'Confirmar' }).click();
  await expect(obj.getByText('Atingido', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Estrutura organizacional' }).click();
  await page.getByLabel(/^Nome/).fill('Secretaria de Saúde');
  await page.getByLabel('Tipo').selectOption('secretaria');
  await page.getByRole('button', { name: 'Incluir', exact: true }).click();
  await expect(page.getByText('Unidade incluída na estrutura')).toBeVisible();
  await page.getByLabel(/^Nome/).fill('Coordenação de TI');
  await page.getByLabel('Tipo').selectOption('departamento');
  await page.getByLabel('Fica abaixo de').selectOption({ label: 'Secretaria de Saúde' });
  await page.getByRole('button', { name: 'Incluir', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Estrutura organizacional' }).getByText('Coordenação de TI')).toBeVisible();

  await page.getByRole('tab', { name: 'Histórico' }).click();
  await expect(page.getByText(/criou um objetivo/).first()).toBeVisible();
  await expect(page.getByText(/alterou a estrutura organizacional/).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Resumo estratégico' }).click();
  await shot(page, 'abm-360');
});
