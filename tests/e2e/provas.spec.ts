import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/** Prova do treinamento na wiki: quem mantém monta, quem lê faz, aprovado baixa o certificado. */
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

test('prova e certificado do treinamento', async ({ page }) => {
  await login(page, 'carlos@yepnet.test');
  expect((await page.request.get('/api/v1/playbooks')).ok()).toBe(true);
  const pb = psql(`select p.id from playbooks p join playbook_versions v on v.id = p.current_version_id where v.meta->'contexts' ? 'sistema:diretriz_gamificacao' limit 1`);
  psql(`delete from training_certificates where playbook_id = '${pb}'; delete from training_attempts where exam_id in (select id from training_exams where playbook_id = '${pb}'); delete from training_exams where playbook_id = '${pb}'`);
  await page.goto(`/playbooks/${pb}`);
  const sec = page.getByRole('region', { name: 'Prova e certificado' });
  await sec.getByRole('button', { name: 'Criar prova' }).click();
  const dlg = page.getByRole('dialog', { name: 'Prova do treinamento' });
  await dlg.getByLabel('Nome do curso no certificado').fill('Gamificação na prática (fictício)');
  await dlg.getByLabel('Enunciado da questão 1').fill('Existe ranking na gamificação?');
  await dlg.getByLabel('Alternativa 1 da questão 1').fill('Sim, público');
  await dlg.getByLabel('Alternativa 2 da questão 1').fill('Não');
  await dlg.getByLabel('Alternativa 2 correta').check();
  await dlg.getByLabel('Explicação da questão 1').fill('A gamificação é colaborativa.');
  await dlg.getByRole('button', { name: 'Salvar prova' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(sec).toContainText('Questões');

  await login(page, 'lucas@yepnet.test');
  await page.goto(`/playbooks/${pb}`);
  await sec.getByRole('button', { name: 'Fazer a prova' }).click();
  const take = page.getByRole('dialog', { name: /Prova ·/ });
  await expect(take).not.toContainText('A gamificação é colaborativa.');
  await take.getByLabel('Não').check();
  await take.getByRole('button', { name: 'Enviar respostas' }).click();
  await expect(take.getByRole('status')).toContainText('Aprovado · 100%');
  await expect(take).toContainText('A gamificação é colaborativa.');
  await expect(take.getByRole('link', { name: /Baixar certificado TRN-/ })).toBeVisible();
  await take.getByRole('button', { name: 'Fechar', exact: true }).last().click();
  await expect(sec).toContainText('Aprovado com 100%');
  await sec.screenshot({ path: 'test-results/prova.png' });
});
