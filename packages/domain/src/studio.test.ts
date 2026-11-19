import { describe, expect, it } from 'vitest';
import { cameraRect, clockMs, clockPause, clockResume, clockStart, modeNeeds, studioNext, trimRange } from './studio';

describe('Estúdio', () => {
  it('máquina de estados: só operações válidas', () => {
    expect(studioNext('ocioso', 'pronto')).toBe('previa');
    expect(studioNext('previa', 'iniciar')).toBe('contagem');
    expect(studioNext('contagem', 'contagem_fim')).toBe('gravando');
    expect(studioNext('gravando', 'pausar')).toBe('pausado');
    expect(studioNext('pausado', 'retomar')).toBe('gravando');
    expect(studioNext('gravando', 'encerrar')).toBe('finalizando');
    expect(studioNext('finalizando', 'arquivo_pronto')).toBe('revisao');
    // inválidas
    expect(studioNext('ocioso', 'iniciar')).toBeNull(); // sem prévia (sem autorização) não grava
    expect(studioNext('gravando', 'iniciar')).toBeNull(); // não inicia duas vezes
    expect(studioNext('previa', 'pausar')).toBeNull();
    expect(studioNext('pausado', 'pausar')).toBeNull();
    expect(studioNext('finalizando', 'encerrar')).toBeNull();
    // compartilhamento de tela interrompido durante a gravação: encerra e salva o que já foi gravado
    expect(studioNext('gravando', 'falha')).toBe('finalizando');
  });

  it('cronômetro não conta pausas', () => {
    let c = clockStart(0);
    c = clockPause(c, 10_000);
    expect(clockMs(c, 50_000)).toBe(10_000);
    c = clockResume(c, 50_000);
    expect(clockMs(c, 55_000)).toBe(15_000);
    expect(clockPause(clockPause(c, 60_000), 70_000).accMs).toBe(20_000); // pausar duas vezes não soma
  });

  it('câmera nos quatro cantos, tamanho limitado; corte válido', () => {
    const cv = { w: 1920, h: 1080 };
    expect(cameraRect('inf_dir', 25, cv, 16 / 9)).toEqual({ x: 1920 - 480 - 48, y: 1080 - 270 - 48, w: 480, h: 270 });
    expect(cameraRect('sup_esq', 25, cv, 16 / 9)).toMatchObject({ x: 48, y: 48 });
    expect(cameraRect('inf_dir', 80, cv, 16 / 9).w).toBe(768); // máximo 40%
    expect(modeNeeds('audio')).toEqual({ screen: false, camera: false, mic: true });
    expect(modeNeeds('tela_camera_mic')).toEqual({ screen: true, camera: true, mic: true });
    expect(trimRange(2, 8, 10)).toEqual({ start: 2, end: 8, length: 6 });
    expect(trimRange(5, 5.5, 10)).toBeNull();
    expect(trimRange(-3, 30, 10)).toEqual({ start: 0, end: 10, length: 10 });
  });
});
