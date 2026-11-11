import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

/** Pessoas & Gestão · F1: feedback situacional descendente (SBI, ciência com manifestação) e ascendente confidencial mediado pelo RH. */
const SHOTS = process.env.E2E_SHOTS;
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';
const psql = (q: string) => execFileSync('psql', [DB, '-Atc', q]).toString().trim();
const login = async (page: Page, email: string) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
};
const SBI = {
  situation: 'Na reunião de pipeline de terça com o cliente Alfa',
  behavior: 'Você apresentou os números sem consultar a planilha atualizada',
  impact: 'O cliente questionou a previsão e precisamos refazer a proposta',
};

test('feedback descendente e ascendente confidencial', async ({ page, browser }) => {
  test.setTimeout(150_000);
  // RH = setor "rh" (Mariana); módulo liberado para o time Residencial (Ana lidera, Lucas é liderado) e para a Mariana
  psql(`update users set sectors = array['rh'] where email = 'mariana@yepnet.test'`);
  await login(page, 'carlos@yepnet.test');
  const lk = await (await page.request.get('/api/v1/meta/lookups')).json();
  for (const g of [{ subjectType: 'equipe', subjectId: lk.teams.find((t: { name: string }) => t.name === 'Residencial').id }, { subjectType: 'equipe', subjectId: lk.teams.find((t: { name: string }) => t.name === 'Governo').id }]) {
    expect((await page.request.post('/api/v1/admin/modules/pessoas_cultura/grants', { data: { ...g, effect: 'liberar', reason: 'Piloto do RH' } })).status()).toBe(201);
  }
  const { settings } = await (await page.request.get('/api/v1/pessoas/config')).json().catch(() => ({ settings: null }));
  if (settings) {
    const { badgeBaselineAt: _b, ...rest } = settings;
    await page.request.put('/api/v1/pessoas/config', { data: { ...rest, roles: { ...rest.roles, pessoasCultura: ['rh'] } } });
  } else {
    psql(`insert into people_settings (tenant_id, settings) select tenant_id, '{"roles":{"pessoasCultura":["rh"],"comunicacao":[],"moderacao":[]}}'::jsonb from users where email = 'carlos@yepnet.test' on conflict (tenant_id) do update set settings = jsonb_set(people_settings.settings, '{roles,pessoasCultura}', '["rh"]')`);
  }

  // Ana (liderança) registra feedback para o Lucas
  const actx = await browser.newContext();
  const a = await actx.newPage();
  await login(a, 'ana@yepnet.test');
  await a.goto('/pessoas');
  await a.getByRole('navigation', { name: 'Seções de Pessoas & Gestão' }).getByRole('link', { name: /Feedbacks/ }).click();
  await a.getByRole('link', { name: 'Novo feedback' }).click();
  const form = a.getByRole('form', { name: 'Novo feedback' });
  await form.getByLabel('Lucas Lima (Liderado)').check({ force: true });
  await form.getByLabel('Oportunidade de melhoria').check({ force: true });
  await expect(form.getByRole('note', { name: 'Quem vai ver' })).toContainText('Ninguém acima de você na estrutura, nem o RH');
  await form.getByLabel(/^Situação/).fill(SBI.situation);
  await form.getByLabel(/^Comportamento observado/).fill(SBI.behavior);
  await form.getByLabel(/^Impacto/).fill(SBI.impact);
  await form.getByLabel(/^Próximos passos/).fill('Checagem 30 minutos antes das reuniões');
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/dev-feedback-novo.png`, fullPage: true });
  await form.getByRole('button', { name: 'Enviar' }).click();
  await a.getByRole('dialog', { name: 'Enviar feedback' }).getByRole('button', { name: 'Enviar' }).click();
  await expect(a.getByText('Feedback enviado')).toBeVisible();
  await expect(a.getByRole('article', { name: 'Feedback' })).toContainText(SBI.behavior);

  // Lucas vê, registra ciência com divergência e envia feedback confidencial para a Ana
  const lctx = await browser.newContext();
  const l = await lctx.newPage();
  await login(l, 'lucas@yepnet.test');
  await l.goto('/pessoas/desenvolvimento/feedbacks');
  await l.getByRole('link', { name: /De Ana Souza/ }).click();
  await l.getByLabel('Sua manifestação (opcional)').fill('Concordo em parte: a planilha não estava atualizada no sistema.');
  await l.getByRole('button', { name: 'Registrar ciência e manifestação' }).click();
  await expect(l.getByText('Ciência registrada')).toBeVisible();
  await expect(l.getByRole('article', { name: 'Feedback' })).toContainText('Concordo em parte');
  await l.goto('/pessoas/desenvolvimento/feedbacks/novo');
  const lf = l.getByRole('form', { name: 'Novo feedback' });
  await lf.getByLabel('Ana Souza (Liderança)').check({ force: true });
  await lf.getByLabel('Alinhamento de expectativas').check({ force: true });
  await expect(lf.getByRole('note', { name: 'Quem vai ver' })).toContainText('Só o RH lê o que você escrever');
  await lf.getByLabel(/^Situação/).fill('Nas últimas três reuniões de segunda-feira do time');
  await lf.getByLabel(/^Comportamento observado/).fill('As prioridades da semana mudaram depois da reunião sem aviso ao time');
  await lf.getByLabel(/^Impacto/).fill('Retrabalho em propostas e clientes recebendo prazos diferentes');
  await lf.getByRole('button', { name: 'Enviar' }).click();
  await l.getByRole('dialog', { name: 'Enviar feedback' }).getByRole('button', { name: 'Enviar' }).click();
  await expect(l.getByRole('article', { name: 'Feedback' })).toContainText('Com o RH');
  await lctx.close();

  // Mariana (RH) media e repassa uma síntese
  const mctx = await browser.newContext();
  const m = await mctx.newPage();
  await login(m, 'mariana@yepnet.test');
  await m.goto('/pessoas/desenvolvimento/feedbacks');
  await m.getByRole('tab', { name: 'Mediação (RH)' }).click();
  await m.getByRole('link', { name: /Lucas Lima → Ana Souza/ }).click();
  const md = m.getByRole('region', { name: 'Mediação do RH' });
  await md.getByLabel(/^Síntese para a liderança/).fill('O time pede que mudanças de prioridade sejam avisadas logo após a reunião.');
  await md.getByLabel(/^Registro da mediação/).fill('Conversei com quem enviou; autorizou repassar a síntese.');
  await md.getByRole('button', { name: 'Registrar mediação' }).click();
  await expect(m.getByText('Mediação registrada')).toBeVisible();
  await mctx.close();

  // Ana recebe só a síntese, sem saber quem enviou
  await a.goto('/pessoas/desenvolvimento/feedbacks');
  await a.getByRole('link', { name: /Devolutiva do time \(via RH\)/ }).click();
  const art = a.getByRole('article', { name: 'Feedback' });
  await expect(art).toContainText('O time pede que mudanças de prioridade');
  await expect(art).not.toContainText('Lucas');
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/dev-feedback-sintese.png`, fullPage: true });
  await actx.close();
  psql(`update users set sectors = '{}' where email = 'mariana@yepnet.test'`);
});
