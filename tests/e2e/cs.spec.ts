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

test('Sucesso do Cliente: jornada automática, kickoff editável, conta 360°, cobertura e gestão', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const H = { origin: new URL(page.url()).origin };
  const api = async (method: 'get' | 'post' | 'patch', url: string, data?: object) => {
    const r = await page.request[method](`/api/v1${url}`, { headers: H, ...(data ? { data } : {}) });
    expect(r.status(), await r.text()).toBeLessThan(300);
    return r.json();
  };
  // contrato validado → negociação no funil Sucesso do Cliente → Planejamento inicia a jornada
  const plan = (await api('get', '/meta/lookups')).plans[0];
  const o = await api('post', '/opportunities', { newContact: { name: 'Clínica Fictícia CS E2E', segment: 'empresarial' }, planId: plan.id, cableMeters: 40, saleType: 'ativa' });
  await api('post', `/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await api('get', `/opportunities/${o.id}`)).rowVersion });
  const me = await api('get', '/me');
  const c = await api('post', '/contracts', { opportunityId: o.id, billingType: 'recorrente', commercialOwnerId: me.user.id, version: { number: 'CS-E2E-1', object: 'Conectividade da clínica', signedAt: day(-200), startAt: day(-200), termMonths: 24, monthlyCents: 2_000_000, items: [{ planId: null, description: 'Link dedicado 500 Mbps', qty: 1, unitCents: 2_000_000 }] } });
  await api('post', `/contracts/${c.id}/validate`);
  const pipe = (await api('get', '/meta/lookups')).pipelines.find((p: { key: string }) => p.key === 'sucesso_cliente');
  const board = await api('get', `/opportunities/board?pipelineId=${pipe.id}`).catch(() => null);
  const csOpp = (board?.columns ?? []).flatMap((col: { cards: { id: string; title: string; contactName?: string; rowVersion: number }[] }) => col.cards).find((x: { contactName?: string; title: string }) => (x.contactName ?? x.title).includes('Clínica Fictícia CS E2E'))
    ?? (await api('get', `/opportunities?pipelineId=${pipe.id}&q=Cl%C3%ADnica%20Fict%C3%ADcia%20CS%20E2E`)).items[0];
  await api('post', `/opportunities/${csOpp.id}/transition`, { toStage: 'planejamento', rowVersion: (await api('get', `/opportunities/${csOpp.id}`)).rowVersion });

  // jornadas
  await page.goto('/sucesso?t=jornadas');
  await page.getByRole('link', { name: 'Clínica Fictícia CS E2E' }).click();
  await expect(page.getByRole('region', { name: 'Trilha da jornada' })).toBeVisible();
  await page.getByRole('tab', { name: 'Linha do tempo' }).click();
  await expect(page.getByRole('heading', { name: 'Linha do tempo' })).toBeVisible();
  await expect(page.getByText('Reunião de kickoff')).toBeVisible();
  await expect(page.getByText('Formalização', { exact: true })).toBeVisible();
  await shot(page, 'cs-jornada');
  await page.getByRole('tab', { name: 'Apresentação de kickoff' }).click();
  await expect(page.getByText(/Revise antes de apresentar/)).toBeVisible();
  await page.getByRole('button', { name: /Níveis mínimos de serviço/ }).click();
  await page.getByLabel(/Conteúdo/).fill('- Disponibilidade 99,7%\n- Atendimento 24x7');
  await page.getByRole('button', { name: 'Marcar como revisado' }).click();
  await page.getByLabel('Descrição da versão').fill('SLA revisado');
  await page.getByRole('button', { name: 'Salvar nova versão' }).click();
  await expect(page.getByText(/Versão 2/)).toBeVisible();
  await shot(page, 'cs-kickoff');
  await page.getByRole('button', { name: 'Apresentar' }).click();
  await expect(page.getByRole('dialog', { name: 'Apresentação' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('2 /')).toBeVisible();
  await page.getByRole('button', { name: 'Sair da apresentação' }).click();
  await page.getByRole('button', { name: 'Compartilhar link' }).click();
  const link = await page.locator('text=/\\/k\\//').first().textContent();
  await page.getByRole('button', { name: 'Registrar kickoff' }).click();
  const ko = page.getByRole('dialog', { name: 'Registrar reunião de kickoff' });
  await ko.getByLabel('Participantes').fill('Diretoria da clínica e CSM');
  await ko.getByLabel('O que foi combinado').fill('Cronograma de implantação validado.');
  await ko.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText(/Kickoff em/)).toBeVisible();

  // link do cliente sem login
  const anon = await (await page.context().browser()!.newContext()).newPage();
  await anon.goto(link!.trim().replace(/^https?:\/\/[^/]+/, ''));
  await expect(anon.getByText('Disponibilidade 99,7%')).toBeHidden();
  await expect(anon.getByText('Kickoff', { exact: true })).toBeVisible();

  // conta 360°
  await page.goto(`/customers/${o.contactId}?t=sucesso`);
  await expect(page.getByText('Por que esta prioridade:')).toBeVisible();
  await expect(page.getByText('Aguardando IXC').first()).toBeVisible();
  await page.getByRole('button', { name: 'Registrar contato' }).click();
  const fu = page.getByRole('dialog', { name: /Registrar contato/ });
  await fu.getByLabel('Resultado').fill('Ligação com a diretora: implantação tranquila.');
  await fu.getByRole('button', { name: 'Registrar' }).click();
  await expect(fu).toBeHidden();
  await page.getByRole('button', { name: 'Avaliar IPC' }).click();
  const ipc = page.getByRole('dialog', { name: 'Avaliar Score IPC' });
  for (const k of ['Potencial de receita adicional', 'Segmento / setor de atuação', 'Necessidade / criticidade do serviço', 'Grau de relacionamento / acesso', 'Maturidade da conta']) await ipc.getByLabel(k).selectOption('medio');
  await ipc.getByLabel('Justificativa').fill('Primeira avaliação após o kickoff.');
  await ipc.getByRole('button', { name: 'Registrar avaliação' }).click();
  await expect(ipc).toBeHidden();
  await expect(page.getByText(/Total: \d+/)).toBeVisible();
  await shot(page, 'cs-360');

  // carteira, atenção e gestão
  await page.goto('/sucesso?t=atencao');
  await expect(page.getByRole('button', { name: 'Clínica Fictícia CS E2E' })).toBeVisible();
  await shot(page, 'cs-atencao');
  await page.getByRole('tab', { name: 'Gestão' }).click();
  await expect(page.getByRole('heading', { name: 'Scorecard dos CSMs' })).toBeVisible();
  await shot(page, 'cs-gestao');
  await page.getByRole('tab', { name: 'Cobertura' }).click();
  await expect(page.getByText(/resultado registrado/)).toBeVisible();

  // configuração versionada
  await page.goto('/settings/customer-success');
  await expect(page.getByRole('heading', { name: 'Políticas de acompanhamento (cadência)' })).toBeVisible();
  await page.getByLabel('Horas por CSM/mês').fill('100');
  await page.getByLabel('O que mudou').fill('Capacidade revista');
  await page.getByRole('button', { name: 'Salvar nova versão' }).click();
  await expect(page.getByText(/Vigente: v1/)).toBeVisible();
});

test('Trilha Visual: paradas sobre os marcos, histórico, apresentar jornada e link externo com código e revogação', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const H = { origin: new URL(page.url()).origin };
  const api = async (method: 'get' | 'post' | 'patch', url: string, data?: object) => {
    const r = await page.request[method](`/api/v1${url}`, { headers: H, ...(data ? { data } : {}) });
    expect(r.status(), await r.text()).toBeLessThan(300);
    return r.json();
  };
  const plan = (await api('get', '/meta/lookups')).plans[0];
  const o = await api('post', '/opportunities', { newContact: { name: 'Laboratório Fictício Trilha', segment: 'empresarial' }, planId: plan.id, cableMeters: 40, saleType: 'ativa' });
  await api('post', `/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await api('get', `/opportunities/${o.id}`)).rowVersion });
  const me = await api('get', '/me');
  const c = await api('post', '/contracts', { opportunityId: o.id, billingType: 'recorrente', commercialOwnerId: me.user.id, version: { number: 'TR-E2E-1', object: 'Conectividade do laboratório', signedAt: day(-30), startAt: day(-30), termMonths: 12, monthlyCents: 800_000, items: [{ planId: null, description: 'Link 300 Mbps', qty: 1, unitCents: 800_000 }] } });
  await api('post', `/contracts/${c.id}/validate`);
  const j = await api('post', '/cs/journeys', { contractId: c.id });
  const jid = j.journeyId ?? j.id ?? (await api('get', `/cs/journeys?contractId=${c.id}`)).items[0].id;
  const t = await api('get', `/cs/journeys/${jid}/trail`);
  await api('patch', `/cs/milestones/${t.stops[0].id}`, { done: true, notes: 'Boas-vindas enviadas à diretoria' });

  await page.goto(`/sucesso/jornadas/${jid}`);
  const trail = page.getByRole('region', { name: 'Trilha da jornada' });
  await expect(trail.getByRole('button', { name: new RegExp(`^${t.stops[0].title}: Concluído`) })).toBeVisible();
  await expect(trail.getByRole('button', { name: /: Agora/ }).getByText('Estamos aqui')).toBeVisible();
  await trail.getByRole('button', { name: new RegExp(`^${t.stops[0].title}:`) }).click();
  const sel = page.getByRole('region', { name: 'Marco selecionado' });
  await expect(sel.getByRole('heading', { name: t.stops[0].title })).toBeVisible();
  await expect(sel.getByText(/concluiu/)).toBeVisible();
  await expect(sel.getByText(/atualizou as observações/)).toBeVisible();

  // apresentar jornada: visão geral, avança pelo teclado, observações ocultas por padrão
  await page.getByRole('button', { name: 'Apresentar jornada' }).click();
  const pres = page.getByRole('dialog', { name: 'Apresentar jornada' });
  await expect(pres.getByRole('heading', { name: 'Onde estamos na jornada' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(pres.getByRole('heading', { name: t.stops[0].title })).toBeVisible();
  await expect(pres.getByText('Boas-vindas enviadas à diretoria')).toBeHidden();
  await pres.getByLabel('Mostrar observações internas').check();
  await expect(pres.getByText('Boas-vindas enviadas à diretoria')).toBeVisible();
  await pres.getByRole('button', { name: 'Sair da apresentação' }).click();

  // link externo com código
  await page.getByRole('button', { name: 'Compartilhar trilha' }).click();
  const dlg = page.getByRole('dialog', { name: 'Compartilhar trilha' });
  await dlg.getByLabel('Para quem é o link').fill('Diretoria do laboratório');
  await dlg.getByRole('button', { name: 'Criar link' }).click();
  const made = page.getByRole('dialog', { name: 'Link criado' });
  const url = await made.getByLabel('Link', { exact: true }).inputValue();
  const code = (await made.getByLabel(/^Código \d/).textContent())!.trim();
  await made.getByRole('button', { name: 'Concluir' }).click();
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(url.replace(/^https?:\/\/[^/]+/, ''));
  await anon.getByLabel('Código de acesso').fill(code === '000000' ? '111111' : '000000');
  await anon.getByRole('button', { name: 'Ver a trilha' }).click();
  await expect(anon.getByRole('alert')).toContainText('Restam 4');
  await anon.getByLabel('Código de acesso').fill(code);
  await anon.getByRole('button', { name: 'Ver a trilha' }).click();
  await expect(anon.getByRole('heading', { name: 'Laboratório Fictício Trilha' })).toBeVisible();
  await expect(anon.getByRole('region', { name: 'Trilha da jornada' })).toBeVisible();
  await expect(anon.getByText('Boas-vindas enviadas à diretoria')).toHaveCount(0);

  // revogar: o acesso para
  await page.getByRole('tab', { name: 'Links externos' }).click();
  const links = page.getByRole('region', { name: 'Links externos da trilha' });
  await expect(links.getByText(/1 acesso\(s\)/)).toBeVisible();
  await links.getByRole('button', { name: 'Revogar' }).click();
  await page.getByLabel(/^Motivo/).fill('Diretoria trocou de contato');
  await page.getByRole('dialog', { name: 'Revogar link' }).getByRole('button', { name: 'Revogar link' }).click();
  await expect(page.getByText('Link revogado: o acesso parou agora')).toBeVisible();
  await expect(links.getByText('Revogado', { exact: true })).toBeVisible();
  const again = await (await browser.newContext()).newPage();
  await again.goto(url.replace(/^https?:\/\/[^/]+/, ''));
  await expect(again.getByRole('alert')).toContainText('Peça um novo link');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Trilha' }).click();
  await shot(page, 'cs-trilha');
});

test('Pesquisas por link: construtor, convite pela ficha da pessoa, resposta pública única, resultados e revisão do posicionamento', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'carlos@yepnet.test');
  const H = { origin: new URL(page.url()).origin };
  const post = async (url: string, data: object) => { const r = await page.request.post(`/api/v1${url}`, { headers: H, data }); expect(r.status(), await r.text()).toBeLessThan(300); return r.json(); };
  const acc = await post('/abm/new-account', { name: `Clínica Fictícia Pesquisa ${Date.now().toString(36)}`, reason: 'Teste de pesquisas' });
  await post(`/accounts/${acc.contactId}/stakeholders`, { person: { name: 'Paula Fictícia Teste' }, roles: ['decisor'] });
  const sname = `Pesquisa E2E ${Date.now().toString(36)}`;

  await page.goto('/sucesso?t=pesquisas');
  await page.getByRole('button', { name: 'Nova pesquisa' }).click();
  const ed = page.getByRole('dialog', { name: 'Nova pesquisa' });
  await ed.getByLabel('Nome interno').fill(sname);
  await ed.getByRole('button', { name: 'Incluir pergunta' }).click();
  const q4 = ed.getByRole('group', { name: 'Pergunta 4' });
  await q4.getByLabel('Pergunta 4: texto').fill('Você apoia ampliar a rede?');
  await q4.getByLabel('Pergunta 4: tipo').selectOption('escolha');
  await q4.getByLabel('Pergunta 4: destino da resposta').selectOption('stakeholder_posicionamento');
  await expect(q4.getByText('Este dado sempre passa por revisão.')).toBeVisible();
  await q4.getByLabel('Pergunta 4: opção 1', { exact: true }).fill('Apoio');
  await q4.getByLabel('Pergunta 4: opção 2', { exact: true }).fill('Não apoio');
  await q4.getByLabel('Pergunta 4: opção 1 corresponde a').selectOption('favoravel');
  await q4.getByLabel('Pergunta 4: opção 2 corresponde a').selectOption('resistente');
  await expect(ed.getByText(/influência não aparece como destino/)).toBeVisible();
  await ed.getByRole('button', { name: 'Criar pesquisa' }).click();
  await expect(page.getByText('Pesquisa criada', { exact: true })).toBeVisible();

  // convite pela ficha da pessoa (Conta 360 → Stakeholders)
  await page.goto(`/abm/contas/${acc.id}?t=stakeholders`);
  await page.getByRole('button', { name: 'Paula Fictícia Teste' }).click();
  await page.getByRole('button', { name: 'Enviar pesquisa' }).click();
  const inv = page.getByRole('dialog', { name: 'Novo convite' });
  await inv.getByLabel('Pesquisa', { exact: true }).selectOption({ label: sname });
  await inv.getByRole('button', { name: 'Criar convite' }).click();
  const url = await page.getByRole('dialog', { name: 'Convite criado' }).getByLabel('Link pessoal').inputValue();
  await page.getByRole('button', { name: 'Concluir' }).click();

  // resposta sem login, uma vez só
  const anon = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await anon.goto(url.replace(/^https?:\/\/[^/]+/, ''));
  await expect(anon.getByText('Olá, Paula')).toBeVisible();
  await anon.getByRole('button', { name: 'Enviar respostas' }).click();
  await expect(anon.getByRole('alert').first()).toContainText('Responda esta pergunta');
  await anon.getByRole('radio', { name: '10' }).click();
  await anon.getByLabel('Não apoio').check();
  await anon.getByRole('button', { name: 'Enviar respostas' }).click();
  await expect(anon.getByRole('status')).toContainText('Obrigado');
  await anon.reload();
  await expect(anon.getByRole('alert')).toContainText('já foi respondido');

  // resultados e revisão do posicionamento
  await page.goto('/sucesso?t=pesquisas');
  const pend = page.getByRole('region', { name: 'Atualizações para revisar' });
  await expect(pend.getByText(/Posicionamento da pessoa: Desconhecido → Resistente/)).toBeVisible();
  await pend.getByRole('listitem').filter({ hasText: 'Paula Fictícia Teste' }).getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Atualização aplicada ao cadastro')).toBeVisible();
  await page.getByRole('link', { name: sname }).click();
  await expect(page.getByText('Taxa de resposta').locator('..')).toContainText('100%');
  await expect(page.getByText('NPS', { exact: true }).locator('..')).toContainText('100');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'pesquisas');
});

test('Sucesso do Cliente por conta: o card da conta lista os contratos e um contrato novo entra no mesmo card', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  const H = { origin: new URL(page.url()).origin };
  const api = async (method: 'get' | 'post', url: string, data?: object) => {
    const r = await page.request[method](`/api/v1${url}`, { headers: H, ...(data ? { data } : {}) });
    expect(r.status(), await r.text()).toBeLessThan(300);
    return r.json();
  };
  const lk = await api('get', '/meta/lookups');
  const me = await api('get', '/me');
  const name = `Rede Fictícia Conta CS ${Date.now().toString(36)}`;
  const sell = async (num: string, monthly: number, contactId?: string) => {
    const o = await api('post', '/opportunities', contactId ? { contactId, planId: lk.plans[0].id } : { newContact: { name, segment: 'empresarial' }, planId: lk.plans[0].id });
    await api('post', `/opportunities/${o.id}/transition`, { toStage: 'ganha', confirm: true, rowVersion: (await api('get', `/opportunities/${o.id}`)).rowVersion });
    const c = await api('post', '/contracts', { opportunityId: o.id, billingType: 'recorrente', commercialOwnerId: me.user.id, version: { number: num, object: `Serviço ${num}`, signedAt: day(-30), startAt: day(-20), termMonths: 12, monthlyCents: monthly, items: [{ planId: null, description: num, qty: 1, unitCents: monthly }] } });
    await api('post', `/contracts/${c.id}/validate`);
    return o.contactId as string;
  };
  const contactId = await sell('CC-A', 500_000);
  await sell('CC-B', 200_000, contactId);
  const pipe = (await api('get', '/meta/lookups')).pipelines.find((p: { key: string }) => p.key === 'sucesso_cliente');
  await page.goto(`/opportunities?pipelineId=${pipe.id}&q=${encodeURIComponent(name)}`);
  const list = page.getByLabel(`Contratos de ${name}`);
  await expect(list).toHaveCount(1); // um card por conta
  await expect(list).toContainText('2 contratos vigentes');
  await expect(list).toContainText('CC-A');
  await expect(list).toContainText('CC-B');
  // dentro do card da conta: troca o CS só do contrato CC-B
  const card = (await api('get', `/opportunities?pipelineId=${pipe.id}&q=${encodeURIComponent(name)}`)).items[0];
  await page.goto(`/opportunities/${card.id}`);
  const box = page.getByLabel('Contratos da conta');
  await expect(box).toContainText('CC-A');
  await box.getByRole('button', { name: 'Trocar CS do contrato CC-B' }).click();
  const dlg = page.getByRole('dialog', { name: 'CS do contrato CC-B' });
  await dlg.getByLabel('CS responsável deste contrato').selectOption({ label: 'Lucas Lima' });
  await dlg.getByLabel('Motivo (opcional)').fill('Especialista no serviço');
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await expect(box.getByRole('listitem').filter({ hasText: 'CC-B' })).toContainText('CS: Lucas Lima (só este contrato)');
  await expect(box.getByRole('listitem').filter({ hasText: 'CC-A' })).not.toContainText('só este contrato');
  await box.getByRole('link', { name: /CC-B/ }).click();
  await expect(page).toHaveURL(/\/contracts\//);
  await expect(page.getByRole('heading', { name: /Contrato CC-B/ })).toBeVisible();
});
