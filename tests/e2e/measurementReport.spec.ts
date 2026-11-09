import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/** Relatório de Medição na conta: marcar o envio, ver o consumo ao vivo como o e-mail, gerar e revisar o rascunho. */
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

test('conta com Relatório de Medição: consumo ao vivo igual ao e-mail e rascunho para envio', async ({ page }) => {
  test.setTimeout(120_000);
  const st = Date.now().toString(36);
  await login(page, 'carlos@yepnet.test');
  const o = psql(`select o.id || '|' || o.contact_id from opportunities o where o.stage = 'ganha' and o.deleted_at is null and not exists (select 1 from contracts c where c.opportunity_id = o.id) limit 1`).split('|');
  const year = new Date().getFullYear();
  const c = await (await page.request.post('/api/v1/contracts', { data: { opportunityId: o[0], billingType: 'medicao', kind: 'publico', legalRegime: 'lei_14133', commercialOwnerId: psql(`select id from users where email = 'carlos@yepnet.test'`), version: { number: `CTR-E2E-${st}`, object: 'Rede óptica fictícia', signedAt: `${year}-01-10`, startAt: `${year}-01-10`, termMonths: 12, monthlyCents: 0, totalCents: 10_000_000, items: [], publicTerms: { agency: 'Órgão Fictício', processNumber: '9/2026', modality: 'Pregão', commitmentNote: null, budgetLine: null, extensionMaxMonths: null } } } })).json();
  psql(`insert into contract_lines (tenant_id, contract_id, position, item_number, description, unit, qty4, price4) select tenant_id, id, 1, '27', 'Fusão Óptica', 'Und', 10000000, 700000 from contracts where id = '${c.id}'`);
  const opp = psql(`insert into opportunities select (jsonb_populate_record(null::opportunities, to_jsonb(o) || jsonb_build_object('id', gen_random_uuid(), 'code', nextval(pg_get_serial_sequence('opportunities', 'code')), 'title', 'Recuperação óptica fictícia ${st}', 'stage', 'proposta', 'measurement_contract_id', '${c.id}'::uuid, 'proposal_status', 'enviada', 'measurement_cents', 714000, 'created_at', now(), 'updated_at', now()))).* from opportunities o where o.id = '${o[0]}' returning id`).split('\n')[0];
  psql(`insert into opportunity_items (tenant_id, opportunity_id, position, description, unit, qty_milli, unit_cents) select tenant_id, id, 0, 'Fusão óptica', 'un', 102000, 7000 from opportunities where id = '${opp}'`);
  psql(`insert into opportunity_attachments (tenant_id, opportunity_id, kind, filename, mime, size_bytes, sha256, data) select tenant_id, id, 'proposta', 'Proposta ${st}.pdf', 'application/pdf', 4, 'x', '\\x25504446'::bytea from opportunities where id = '${opp}'`);
  psql(`insert into opportunity_events (tenant_id, opportunity_id, type, payload) select tenant_id, id, 'email_sent', '{"kind":"proposta"}'::jsonb from opportunities where id = '${opp}'`);

  await page.goto(`/customers/${o[1]}?t=medicao`);
  const cfg = page.getByRole('region', { name: 'Envio de Relatório de Medição' });
  await cfg.getByLabel(/Envio de Relatório de Medição/).check();
  await cfg.getByLabel('Dia previsto de envio').fill('5');
  await cfg.getByLabel('Para').fill('medicao@orgao-ficticio.test');
  await cfg.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Configuração salva').last()).toBeVisible();
  await expect(cfg.getByText(/Próximo envio: relatório de/)).toBeVisible();

  const live = page.getByRole('region', { name: 'Consumo ao vivo' });
  await expect(live.getByRole('link', { name: new RegExp(`Proposta ${st}.pdf`) })).toBeVisible();
  const mail = live.frameLocator('iframe[title="Prévia do e-mail"]');
  await expect(mail.getByText(`RECUPERAÇÃO ÓPTICA FICTÍCIA ${st.toUpperCase()}`)).toBeVisible();
  await expect(mail.getByRole('row', { name: /27 Fusão óptica Und 102/ })).toContainText('R$ 7.140,00');
  await page.screenshot({ path: 'test-results/medicao-ao-vivo.png', fullPage: true });

  await live.getByRole('button', { name: 'Gerar relatório para envio' }).click();
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const label = `${months[Number(month.slice(5)) - 1]} de ${month.slice(0, 4)}`;
  const item = page.getByRole('listitem', { name: `Relatório ${label}` });
  await item.getByRole('button', { name: 'Revisar e enviar' }).click();
  const dlg = page.getByRole('dialog', { name: `Relatório de Medição · ${label}` });
  await expect(dlg.getByLabel('Para')).toHaveValue('medicao@orgao-ficticio.test');
  await expect(dlg.frameLocator('iframe[title="Prévia do e-mail"]').getByText('Valor Total', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/medicao-rascunho.png', fullPage: true });
});

test('exemplo: 1 contrato com 6 medições; tabela do e-mail com coluna e linha novas', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/data');
  await page.getByRole('button', { name: 'Carregar exemplo' }).click();
  await expect(page).toHaveURL(/\/customers\/.+\?t=medicao/);
  const list = page.getByRole('region', { name: 'Relatórios enviados e a enviar' });
  const row = list.getByRole('listitem').first();
  await expect(row).toContainText('6 proposta(s)');
  await row.getByRole('button', { name: 'Revisar e enviar' }).click();
  const dlg = page.getByRole('dialog', { name: /Relatório de Medição · / });
  const props = dlg.getByRole('group', { name: 'Tabela Histórico de propostas' });
  await expect(props.getByLabel(/linha 1, Nº da proposta/)).toHaveValue(/^PC \d{6}/);
  await props.getByRole('button', { name: 'Coluna', exact: true }).click();
  await props.getByLabel('Histórico de propostas: título da coluna 5').fill('Observação');
  await props.getByLabel('Histórico de propostas: linha 1, Observação').fill('Atestado pelo fiscal');
  await props.getByRole('button', { name: 'Linha', exact: true }).click();
  await props.getByLabel('Histórico de propostas: linha 7, Serviço').fill('Texto livre: visita técnica sem custo');
  const mail = dlg.frameLocator('iframe[title="Prévia do e-mail"]');
  await expect(mail.getByText('Atestado pelo fiscal')).toBeVisible();
  await expect(mail.getByRole('row', { name: /27 Fusão óptica Und 102/ })).toBeVisible();
  await dlg.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dlg.getByRole('button', { name: 'Refazer a partir do CRM' })).toBeVisible();
  await dlg.screenshot({ path: 'test-results/medicao-exemplo-edicao.png' });
});
