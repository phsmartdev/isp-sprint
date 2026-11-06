import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/** Gestão de Times → Férias: admissão, sugestão automática sem choque no time, confirmar, aviso no sino. */
const SHOTS = process.env.E2E_SHOTS;
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';
test('férias: sugerir, confirmar e avisar', async ({ page }) => {
  test.setTimeout(120_000);
  execFileSync('psql', [DB, '-c', 'delete from vacations; delete from vacation_people;']);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('ana@yepnet.test');
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
  await page.goto('/times/ferias');
  const team = page.getByRole('region', { name: 'Férias do time Residencial' });
  const lucas = (await (await page.request.get('/api/v1/times/ferias')).json()).people.find((p: { name: string }) => /Lucas/.test(p.name));
  await team.getByRole('button', { name: `Admissão de ${lucas.name}` }).click();
  await page.getByLabel('Data de admissão').fill('2024-03-15');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText('Admissão salva')).toBeVisible();
  await expect(team).toContainText('Admissão 15/03/2024');
  await page.getByRole('button', { name: 'Sugerir férias automaticamente' }).click();
  await expect(page.getByText(/férias sugeridas, sem choque no time/)).toBeVisible();
  const bar = team.getByRole('button', { name: new RegExp(`Férias de ${lucas.name}: .*Sugerida`) }).first();
  await expect(bar).toBeVisible();
  if (SHOTS) await page.locator('main').screenshot({ path: `${SHOTS}/ferias.png` });
  await bar.click();
  await page.getByRole('button', { name: 'Confirmar (programar)' }).click();
  await expect(page.getByText('Férias atualizadas')).toBeVisible();
  const prog = team.getByRole('button', { name: new RegExp(`Férias de ${lucas.name}: .*Programada`) }).first();
  await expect(prog).toBeVisible();
  // início perto: o aviso sai no sino da pessoa e da liderança
  let d = new Date(); d.setDate(d.getDate() + 10); while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  execFileSync('psql', [DB, '-c', `update vacations set start_date = '${iso}', alerted_at = null where status = 'programada'`]);
  await page.reload();
  await page.getByRole('button', { name: /Menções|Notificações|menções/i }).first().click();
  await expect(page.getByText('Férias chegando: revise rotinas e tarefas do período').first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/ferias-sino.png` });
});
