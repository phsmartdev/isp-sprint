import { expect, test, type Page } from '@playwright/test';

/**
 * Estúdio de gravação (etapa 1), com gravação REAL no Chromium: câmera e microfone simulados pelo próprio navegador
 * (--use-fake-device-for-media-stream) e a captura da aba aceita automaticamente. Conferimos o arquivo gerado:
 * duração sem as pausas, vídeo com a câmera incorporada, áudio presente, corte efetivo e recuperação após recarregar.
 */
test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-accept-this-tab-capture', '--auto-select-tab-capture-source-by-title=BKT', '--autoplay-policy=no-user-gesture-required'],
  },
});

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('Sprint@2026');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: /^Conta de / })).toBeVisible();
}
const SHOTS = process.env.ACADEMIA_SHOTS;
const shot = async (page: Page, n: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
const secs = (t: string) => { const [m, s] = t.split(':').map(Number); return m! * 60 + s!; };

/** Lê o arquivo da revisão no navegador: duração, tamanho do vídeo, se tem áudio e a cor da moldura da câmera. */
const inspect = (page: Page) => page.evaluate(async () => {
  const el = document.querySelector('[data-testid="review-player"]') as HTMLVideoElement;
  const buf = await (await fetch(el.src)).arrayBuffer();
  let audio = 0;
  try { const a = await new AudioContext().decodeAudioData(buf.slice(0)); audio = a.duration; } catch { audio = -1; }
  const v = document.createElement('video'); v.muted = true; v.src = el.src;
  await new Promise((r) => { v.onloadeddata = r; });
  v.currentTime = 1; await new Promise((r) => { v.onseeked = r; });
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
  const g = c.getContext('2d')!; g.drawImage(v, 0, 0);
  // moldura azul (#2F5986) ao redor da câmera no canto inferior direito (25% da largura, câmera 4:3 do Chromium)
  const W = c.width, H = c.height, w = Math.round(W * 0.25), h = Math.round(w / (4 / 3)), m = Math.round(W * 0.025);
  const px = g.getImageData(W - w - m - 2, H - m - Math.round(h / 2), 1, 1).data;
  return { width: W, height: H, audio, border: [px[0]!, px[1]!, px[2]!] };
});

test('estúdio: grava tela + câmera + microfone com pausa, revisa, corta e recupera gravação interrompida', async ({ page }) => {
  test.setTimeout(150_000);
  page.on('dialog', (d) => void d.accept());
  await login(page, 'ana@yepnet.test');
  await page.goto('/playbooks?aba=academia');
  await page.getByRole('button', { name: 'Gravar treinamento' }).click();
  await expect(page.getByRole('heading', { name: 'Estúdio de gravação' })).toBeVisible();

  // nada é gravado antes do clique: primeiro ativa as fontes (o navegador pede permissão), depois inicia
  await page.getByRole('button', { name: 'Tela + câmera + microfone' }).click();
  await expect(page.getByTestId('rec-indicator')).toHaveCount(0);
  await page.getByRole('button', { name: /^Ativar tela, câmera e microfone/ }).click();
  await expect(page.getByRole('button', { name: 'Iniciar gravação' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (document.querySelector('[data-testid="preview"]') as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
  await expect.poll(async () => Number(await page.getByTestId('level').evaluate((e) => parseFloat((e as HTMLElement).style.width)))).toBeGreaterThan(0); // nível do microfone
  // câmera e microfone escolhidos pela lista (rótulos aparecem depois da permissão)
  await expect(page.getByLabel('Microfone', { exact: true })).toBeDisabled(); // não troca no meio da prévia

  await page.getByRole('button', { name: 'Iniciar gravação' }).click();
  await expect(page.getByTestId('countdown')).toHaveText('3');
  await expect(page.getByTestId('rec-indicator')).toContainText('Gravando', { timeout: 5_000 });
  await page.waitForTimeout(2_500);
  await shot(page, 'estudio-gravando');
  await page.getByRole('button', { name: 'Pausar' }).click();
  await expect(page.getByTestId('rec-indicator')).toContainText('Pausado');
  const paused = secs((await page.getByTestId('rec-timer').textContent())!);
  await page.waitForTimeout(2_500);
  expect(secs((await page.getByTestId('rec-timer').textContent())!)).toBe(paused); // cronômetro parado
  await page.getByRole('button', { name: 'Retomar' }).click();
  await page.waitForTimeout(2_500);
  await page.getByRole('button', { name: 'Encerrar' }).click();

  // revisão abre sozinha; arquivo reproduzível, sem as pausas, com vídeo, áudio e a câmera incorporada
  await expect(page.getByRole('heading', { name: 'Revisar gravação' })).toBeVisible({ timeout: 15_000 });
  const info = (await page.getByTestId('take-info').textContent())!;
  const dur = secs(info.split(' · ')[0]!);
  expect(dur).toBeGreaterThanOrEqual(4);
  expect(dur).toBeLessThanOrEqual(6); // ~5 s gravados; os 2,5 s de pausa não entram
  const f = await inspect(page);
  expect(f.width).toBeGreaterThan(0);
  expect(f.audio).toBeGreaterThan(3);
  expect(f.border[2]).toBeGreaterThan(f.border[0] + 30); // moldura azul da câmera dentro do vídeo

  // corte real: de 1 s a 3 s
  await page.getByLabel('Início do corte').fill('1');
  await page.getByLabel('Fim do corte').fill('3');
  await expect(page.getByTestId('trim-start')).toHaveText('0:01');
  await page.getByLabel('Título').fill('Apresentação comercial');
  await shot(page, 'estudio-revisao');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Cortar e baixar' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe('Apresentacao-comercial.webm');
  const cut = await page.evaluate(async () => {
    const b = (window as unknown as { __studioLast: Blob }).__studioLast;
    const a = await new AudioContext().decodeAudioData(await b.arrayBuffer());
    return a.duration;
  });
  expect(cut).toBeGreaterThan(1.4);
  expect(cut).toBeLessThan(2.8);

  // descartar pede confirmação
  await page.getByRole('button', { name: 'Descartar e gravar outra' }).click();
  await page.getByRole('dialog', { name: 'Descartar a gravação?' }).getByRole('button', { name: 'Descartar' }).click();
  await expect(page.getByRole('heading', { name: 'Estúdio de gravação' })).toBeVisible();

  // gravação interrompida (a aba recarrega no meio): o que foi gravado é recuperado
  await page.getByRole('button', { name: 'Câmera + microfone', exact: true }).click();
  await page.getByRole('button', { name: /^Ativar câmera e microfone/ }).click();
  await page.getByRole('button', { name: 'Iniciar gravação' }).click();
  await expect(page.getByTestId('rec-indicator')).toContainText('Gravando', { timeout: 5_000 });
  await page.waitForTimeout(3_500);
  await page.reload();
  await expect(page.getByText(/Há uma gravação interrompida neste navegador/)).toBeVisible();
  await page.getByRole('button', { name: 'Recuperar gravação' }).click();
  await expect(page.getByRole('heading', { name: 'Revisar gravação' })).toBeVisible();
  const rec = await inspect(page);
  expect(rec.width).toBeGreaterThan(0);
  expect(rec.audio).toBeGreaterThan(1.5);
});

test('estúdio: somente áudio, e a operação não acessa', async ({ page }) => {
  await login(page, 'ana@yepnet.test');
  await page.goto('/playbooks/academia/estudio');
  await page.getByRole('button', { name: 'Somente áudio' }).click();
  await page.getByRole('button', { name: /^Ativar microfone/ }).click();
  await page.getByRole('button', { name: 'Iniciar gravação' }).click();
  await expect(page.getByTestId('rec-indicator')).toContainText('Gravando', { timeout: 5_000 });
  await page.waitForTimeout(2_000);
  await page.getByRole('button', { name: 'Encerrar' }).click();
  await expect(page.getByTestId('take-info')).toContainText('WEBA');
  await login(page, 'lucas@yepnet.test');
  await page.goto('/playbooks/academia/estudio');
  await expect(page.getByText('Estúdio restrito')).toBeVisible();
});
