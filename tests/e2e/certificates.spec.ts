import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/** Certificado de curso: a pessoa envia pela tela, a liderança valida, os pontos aparecem. */
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

test('certificado de curso complementar: envio, validação e pontos', async ({ page }) => {
  test.setTimeout(120_000);
  const st = Date.now().toString(36);
  const tenant = psql(`select tenant_id from users where email = 'lucas@yepnet.test'`);
  const base = psql(`select config from gamification_settings where tenant_id = '${tenant}' and status = 'aprovada' order by version desc limit 1`) || '{}';
  const cfg = JSON.stringify({ ...JSON.parse(base), journeys: JSON.parse(base).journeys ?? [], certificates: { pointsPerCertificate: 10, pointsPerHourTenths: 5, maxHoursCounted: 40, monthlyCapPoints: 40 } }).replace(/'/g, "''");
  psql(`insert into gamification_settings (tenant_id, version, config, note, status, created_by) values ('${tenant}', (select coalesce(max(version),0)+1 from gamification_settings where tenant_id = '${tenant}'), '${cfg}'::jsonb, 'E2E', 'aprovada', (select id from users where email = 'carlos@yepnet.test'))`);
  psql(`update users set sectors = array['comercial'] where email = 'lucas@yepnet.test'`);

  await login(page, 'lucas@yepnet.test');
  await page.goto('/meus-pontos');
  const panel = page.getByRole('region', { name: 'Certificados de cursos' });
  await panel.getByRole('button', { name: 'Enviar certificado' }).click();
  const dlg = page.getByRole('dialog', { name: 'Enviar certificado' });
  await dlg.getByLabel('Curso').fill(`Negociação consultiva ${st}`);
  await dlg.getByLabel('Instituição').fill('Escola Fictícia');
  await dlg.getByLabel('Área').selectOption('Comercial');
  await dlg.getByLabel('Carga horária (h)').fill('8');
  await dlg.getByLabel('Concluído em').fill('2026-10-01');
  await dlg.getByLabel(/Certificado \(PDF/).setInputFiles('tests/e2e/fixtures/playbook-ficticio.pdf');
  await expect(dlg).toContainText('14 pts');
  await dlg.getByRole('button', { name: 'Enviar para validação' }).click();
  await expect(panel.getByRole('list', { name: 'Meus certificados' })).toContainText('Aguardando validação');

  await login(page, 'carlos@yepnet.test');
  await page.goto('/meus-pontos');
  const item = page.getByRole('listitem', { name: `Certificado Negociação consultiva ${st}` });
  await expect(item).toContainText('vale 14 pts');
  await page.screenshot({ path: 'test-results/certificados-validar.png', fullPage: true });
  await item.getByRole('button', { name: 'Validar' }).click();
  await expect(item).toHaveCount(0);

  await login(page, 'lucas@yepnet.test');
  await page.goto('/meus-pontos');
  await expect(page.getByRole('list', { name: 'Meus certificados' })).toContainText('+14 pts');
});
