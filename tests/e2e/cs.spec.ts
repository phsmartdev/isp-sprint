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
