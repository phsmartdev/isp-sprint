import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVATION as C, activationConfig, activationState, validateActivation, type SignalHit } from './activation';

const h = (kind: SignalHit['kind'], on: string, person: string | null = 'p1'): SignalHit => ({ kind, on, person });
describe('ativação de contas-alvo', () => {
  it('1:1 exige 6 pontos, um sinal forte e duas pessoas em 30 dias', () => {
    const hits = [h('reuniao_visita', '2026-10-05', 'p1'), h('resposta_mensagem', '2026-10-10', 'p1'), h('resposta_mensagem', '2026-10-12', 'p1')];
    expect(activationState(hits, C, '1_1', '2026-10-20')).toMatchObject({ state: 'engajada', points: 7, strong: 1, people: 1 });
    const two = [...hits.slice(0, 2), h('resposta_mensagem', '2026-10-12', 'p2')];
    expect(activationState(two, C, '1_1', '2026-10-20').state).toBe('ativada');
  });
  it('1:muitos basta 3 pontos em 90 dias; sem sinal na janela seguinte, esfria', () => {
    const hits = [h('passo_play', '2026-07-10'), h('resposta_mensagem', '2026-07-15')];
    expect(activationState(hits, C, '1_muitos', '2026-08-01').state).toBe('ativada');
    expect(activationState(hits, C, '1_muitos', '2026-10-20').state).toBe('esfriando');
    expect(activationState(hits, C, '1_muitos', '2027-02-01').state).toBe('nao_engajada');
  });
  it('sinal desligado não conta; parâmetros ajustáveis e validados', () => {
    const cfg = activationConfig({ signals: { ...C.signals, passo_play: 'nao_conta' }, tiers: { ...C.tiers, '1_muitos': { windowDays: 90, minPoints: 2, minStrong: 0, minPeople: 1 } } });
    expect(activationState([h('passo_play', '2026-10-01')], cfg, '1_muitos', '2026-10-20').state).toBe('nao_engajada');
    expect(activationState([h('resposta_mensagem', '2026-10-01')], cfg, '1_muitos', '2026-10-20').state).toBe('ativada');
    expect(validateActivation(activationConfig({ tiers: { ...C.tiers, '1_1': { windowDays: 3, minPoints: 0, minStrong: 0, minPeople: 0 } } })).length).toBeGreaterThan(0);
    expect(validateActivation(C)).toEqual([]);
  });
});
