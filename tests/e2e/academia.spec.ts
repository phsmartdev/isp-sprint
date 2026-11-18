import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * Academia (Fase 1), ponta a ponta: a supervisão monta a trilha com vídeos do YouTube, a Gerência publica, a operação
 * assiste no player dentro do RevOps (reprodução parcial, pausa, retomada após sair e entrar, avanço na barra, conclusão,
 * vídeo indisponível) e a liderança acompanha. O player do YouTube é SIMULADO no navegador (mesma interface da IFrame API),
 * com o tempo andando pelo relógio real; o oEmbed é simulado na API.
 */
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://isp:isp@localhost:5432/isp_sprint_test';
const psql = (q: string) => execFileSync('psql', [DB, '-Atc', q]).toString().trim();
const SHOTS = process.env.ACADEMIA_SHOTS; // pasta para capturas de tela (opcional)
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}

/** IFrame API simulada: window.__yt.p controla o player (play, pause, seek); duração de 20 s por vídeo. */
const FAKE_IFRAME_API = `
window.__yt = { start: null, p: null };
window.YT = { PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 }, Player: function (el, opts) {
  var dur = 20, pos = (opts.playerVars && opts.playerVars.start) || 0, playing = false, since = 0, rate = 1, done = false;
  window.__yt.start = pos;
  el.textContent = 'Player do YouTube (simulado) ' + opts.videoId; el.setAttribute('data-video', opts.videoId);
  var fire = function (s) { opts.events && opts.events.onStateChange && opts.events.onStateChange({ data: s }); };
  var cur = function () { return playing ? Math.min(dur, pos + (performance.now() - since) / 1000 * rate) : pos; };
  var self = this;
  this.getCurrentTime = function () { var c = cur(); if (playing && c >= dur && !done) { done = true; pos = dur; playing = false; setTimeout(function () { fire(0); }, 0); } return c; };
  this.getDuration = function () { return dur; };
  this.getPlayerState = function () { self.getCurrentTime(); return playing ? 1 : pos >= dur ? 0 : 2; };
  this.getPlaybackRate = function () { return rate; };
  this.seekTo = function (s) { pos = s; since = performance.now(); };
  this.pauseVideo = function () { pos = cur(); playing = false; fire(2); };
  this.destroy = function () { playing = false; };
  window.__yt.p = {
    play: function (r) { pos = cur(); rate = r || 1; since = performance.now(); playing = true; done = false; fire(1); },
    pause: function () { self.pauseVideo(); },
    seek: function (s) { pos = s; since = performance.now(); },
    pos: function () { return cur(); },
  };
} };
setTimeout(function () { window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(); }, 0);
`;

test('academia: montar trilha, aprovar, assistir com progresso real e acompanhar', async ({ page }) => {
  test.setTimeout(240_000);
  await page.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_IFRAME_API }));
  const st = Date.now().toString(36).slice(-5);
  const title = `Onboarding E2E ${st}`;
  const vids = ['a', 'b', 'c'].map((x) => `e2e${st}${x}`.padEnd(11, 'x').slice(0, 11));

  // 1) supervisão cria a trilha e inclui os vídeos
  await login(page, 'ana@yepnet.test');
  await page.goto('/playbooks?aba=academia');
  await expect(page.getByRole('tab', { name: 'Biblioteca de Playbooks' })).toBeVisible();
  await page.getByRole('button', { name: 'Nova trilha' }).click();
  await page.getByLabel('Nome da trilha').fill(title);
  await page.getByLabel('Descrição').fill('Primeiros passos do time comercial.');
  await page.getByRole('button', { name: 'Criar e incluir vídeos' }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  for (const v of vids) {
    await page.getByLabel('Link do YouTube (vídeo ou playlist) ou link de apoio').fill(`https://www.youtube.com/watch?v=${v}`);
    await page.getByRole('button', { name: 'Incluir', exact: true }).click();
    await expect(page.getByPlaceholder(`Aula simulada ${v}`)).toBeVisible();
  }
  await expect(page.getByTestId('ed-lesson')).toHaveCount(3);
  await shot(page, '1-editor');
  await page.getByRole('button', { name: 'Salvar estrutura' }).click();
  await expect(page.getByText('Estrutura salva')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar para aprovação' }).click();
  await expect(page.getByText(/Versão 1 enviada/)).toBeVisible();

  // 2) Gerência aprova e publica
  await login(page, 'carlos@yepnet.test');
  await page.goto('/playbooks?aba=academia');
  const row = page.getByRole('region', { name: 'Aguardando a sua decisão' }).getByRole('listitem').filter({ hasText: title });
  await row.getByRole('button', { name: 'Decidir' }).click();
  await page.getByRole('button', { name: 'Aprovar e publicar' }).click();
  await expect(page.getByText('Trilha publicada')).toBeVisible();

  // 3) a operação se inscreve e assiste
  await login(page, 'lucas@yepnet.test');
  await page.goto('/playbooks?aba=trilhas');
  await page.getByTestId('track-card').filter({ hasText: title }).click();
  await page.getByRole('button', { name: 'Inscrever-me' }).click();
  await page.getByRole('button', { name: 'Começar' }).click();
  await expect(page.getByTestId('yt-player')).toContainText(vids[0]!);
  await page.waitForFunction(() => !!(window as any).__yt?.p);
  // reprodução parcial em 2x por ~6 s (≈12 s de vídeo) e pausa: o progresso salvo aparece
  await page.evaluate(() => (window as any).__yt.p.play(2));
  await page.waitForTimeout(6_000);
  await page.evaluate(() => (window as any).__yt.p.pause());
  await expect.poll(async () => Number((await page.getByTestId('lesson-pct').textContent())!.replace('%', '').replace(',', '.')), { timeout: 10_000 }).toBeGreaterThan(40);
  const partial = Number((await page.getByTestId('lesson-pct').textContent())!.replace('%', '').replace(',', '.'));
  expect(partial).toBeLessThan(90);
  await expect(page.getByText('Conclui com 90%')).toBeVisible();
  // anotação presa ao ponto em que o vídeo parou (~12 s)
  await page.getByLabel('Nova anotação').fill('Pergunta sobre orçamento');
  const at = (await page.getByTestId('note-at').textContent())!;
  expect(at).toMatch(/^0:1[0-4]$/);
  await page.getByRole('button', { name: 'Salvar anotação' }).click();
  await expect(page.getByTestId('notes')).toContainText('Pergunta sobre orçamento');
  await expect(page.getByRole('link', { name: `Ir para ${at} do vídeo` })).toBeVisible();
  await shot(page, '2-aula');

  // 4) sai, entra de novo: o progresso continua e o player retoma de onde parou
  await login(page, 'lucas@yepnet.test');
  await page.goto('/playbooks?aba=aprendizagem');
  await page.getByTestId('continue').click();
  await page.waitForFunction(() => !!(window as any).__yt?.p);
  await expect(page.getByTestId('lesson-pct')).toHaveText(`${partial.toLocaleString('pt-BR')}%`);
  const start = await page.evaluate(() => (window as any).__yt.start as number);
  expect(start).toBeGreaterThanOrEqual(10);
  // a anotação continua lá; clicar no tempo leva o vídeo àquele ponto
  await page.evaluate(() => (window as any).__yt.p.seek(2));
  await page.getByRole('link', { name: `Ir para ${at} do vídeo` }).click();
  const atSec = Number(at.split(':')[1]);
  expect(Math.floor(await page.evaluate(() => (window as any).__yt.p.pos() as number))).toBe(atSec);
  // termina o vídeo: chega a 100% e conclui a aula
  await page.evaluate(() => (window as any).__yt.p.play(2));
  await expect(page.getByText('Aula concluída')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('lesson-pct')).toHaveText('100%');

  // 5) segunda aula: arrastar a barra até o fim não conclui
  await page.getByRole('link', { name: 'Próxima aula' }).click();
  await expect(page.getByTestId('yt-player')).toContainText(vids[1]!);
  await page.waitForFunction(() => !!(window as any).__yt?.p);
  await page.evaluate(() => { const p = (window as any).__yt.p; p.play(1); });
  await page.waitForTimeout(2_200);
  await page.evaluate(() => { const p = (window as any).__yt.p; p.seek(18.5); });
  await page.waitForTimeout(2_500); // termina sozinho
  await expect.poll(async () => Number((await page.getByTestId('lesson-pct').textContent())!.replace('%', '').replace(',', '.')), { timeout: 10_000 }).toBeGreaterThan(5);
  const seeked = Number((await page.getByTestId('lesson-pct').textContent())!.replace('%', '').replace(',', '.'));
  expect(seeked).toBeLessThan(40);
  await expect(page.getByText('Aula concluída')).toHaveCount(0);

  // 6) terceiro vídeo ficou indisponível: sai da conta e a jornada avisa
  psql(`update academy_contents set state = 'removido' where external_id = '${vids[2]}'`);
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByText('Removido — fora do cálculo')).toBeVisible();
  await expect(page.getByTestId('track-pct')).toHaveText('50%'); // 1 de 2 obrigatórias disponíveis
  await expect(page.getByText('1 de 2 aulas obrigatórias concluídas · 1 indisponível(is) fora da conta')).toBeVisible();
  await expect(page.getByText('Ao concluir, você recebe o certificado')).toBeVisible();
  // anotações na página da trilha: o link abre a aula no ponto anotado
  await expect(page.getByRole('region', { name: 'Minhas anotações' })).toContainText('Pergunta sobre orçamento');
  await shot(page, '3-jornada');
  await page.getByRole('region', { name: 'Minhas anotações' }).getByRole('link', { name: new RegExp(`Ir para ${at}`) }).click();
  await page.waitForFunction(() => !!(window as any).__yt?.p);
  expect(await page.evaluate(() => (window as any).__yt.start as number)).toBe(atSec);
  await page.goto('/playbooks?aba=trilhas'); // volta para o fluxo da liderança

  // 7) a liderança acompanha o progresso real
  await login(page, 'ana@yepnet.test');
  await page.goto('/playbooks?aba=academia');
  await page.getByRole('table', { name: 'Indicadores por trilha' }).getByRole('button', { name: title }).click();
  const person = page.getByRole('table', { name: 'Pessoas na trilha' }).getByRole('row').filter({ hasText: 'Lucas Lima' });
  await expect(person).toContainText('Em andamento');
  await expect(person).toContainText('50%');
  await shot(page, '4-acompanhamento');
});

test('integrações: a tela abre com o cartão do YouTube (Academia) e a chave não aparece', async ({ page }) => {
  await login(page, 'carlos@yepnet.test');
  await page.goto('/settings/integrations');
  await expect(page.getByRole('heading', { name: 'YouTube (Academia)' })).toBeVisible();
  await expect(page.getByText('Esta tela encontrou um erro')).toHaveCount(0);
});
