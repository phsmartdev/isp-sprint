import { describe, expect, it } from 'vitest';
import { approvalStagesFor, audienceAllows, contentErrors, diffContent, nextReview, nextVersion, playbookCode, reviewAlertsDue, reviewState, sectionsOf, videoEmbed, type PlaybookContent } from './playbooks';

const viewer = { userId: 'u1', teamIds: ['t1'], costCenterIds: ['c9'], profiles: ['operacao'] };
describe('playbooks', () => {
  it('público: corporativo, compartilhado por time ou centro, restrito por perfil ou pessoa; lista vazia não libera', () => {
    const base = { teamIds: [], costCenterIds: [], profiles: [], userIds: [] };
    expect(audienceAllows({ ...base, visibility: 'corporativo' }, viewer)).toBe(true);
    expect(audienceAllows({ ...base, visibility: 'compartilhado' }, viewer)).toBe(false);
    expect(audienceAllows({ ...base, visibility: 'compartilhado', costCenterIds: ['c9'] }, viewer)).toBe(true);
    expect(audienceAllows({ ...base, visibility: 'compartilhado', teamIds: ['t2'] }, viewer)).toBe(false);
    expect(audienceAllows({ ...base, visibility: 'restrito', teamIds: ['t1'] }, viewer)).toBe(false); // restrito ignora time
    expect(audienceAllows({ ...base, visibility: 'restrito', profiles: ['operacao'] }, viewer)).toBe(true);
    expect(audienceAllows({ ...base, visibility: 'restrito', userIds: ['u1'] }, viewer)).toBe(true);
  });
  it('versões, código e alçadas', () => {
    expect(nextVersion(null, false)).toBe('1.0');
    expect(nextVersion('2.3', false)).toBe('2.4');
    expect(nextVersion('2.3', true)).toBe('3.0');
    expect(playbookCode('{CAT}-PB-{NUM}', 'com', 1)).toBe('COM-PB-001');
    expect(approvalStagesFor({ gerencia: true, diretoria: true }, 'baixa')).toEqual(['gerencia', 'diretoria']);
    expect(approvalStagesFor({ gerencia: false, diretoria: false }, 'baixa')).toEqual(['diretoria']);
    expect(approvalStagesFor({ gerencia: false, diretoria: false }, 'alta')).toEqual(['gerencia', 'diretoria']);
  });
  it('revisão: próxima data, situação e alertas 30/15/7/0', () => {
    expect(nextReview('2026-01-31', 'mensal', null)).toBe('2026-02-28');
    expect(nextReview('2026-01-10', 'personalizada', 45)).toBe('2026-02-24');
    expect(reviewState('2026-11-20', '2026-11-07', null)).toBe('proxima');
    expect(reviewState('2026-11-01', '2026-11-07', null)).toBe('vencida');
    expect(reviewState('2026-11-01', '2026-11-07', 'rascunho')).toBe('em_revisao');
    expect(reviewState('2027-03-01', '2026-11-07', 'revisao_gerencia')).toBe('aguardando_aprovacao');
    expect(reviewAlertsDue('2026-11-20', '2026-11-07', [30, 15, 7, 0])).toEqual([15]);
    expect(reviewAlertsDue('2026-11-07', '2026-11-07', [30, 15, 7, 0])).toEqual([0]);
    expect(reviewAlertsDue('2027-01-20', '2026-11-07', [30, 15, 7, 0])).toEqual([]);
  });
  it('conteúdo: integridade, seções e comparação', () => {
    const c: PlaybookContent = { blocks: [
      { id: 'a', type: 'heading', level: 1, text: 'Descoberta' },
      { id: 'b', type: 'text', text: 'Pergunte sobre o contexto do cliente' },
      { id: 'c', type: 'heading', level: 1, text: 'Proposta' },
    ] };
    expect(contentErrors(c)).toEqual([]);
    expect(contentErrors({ blocks: [{ id: 'x', type: 'video', url: 'https://evil.example/v' }] })).toEqual(['Bloco 1: use um link do YouTube ou Vimeo.']);
    expect(contentErrors({ blocks: [{ id: 'x', type: 'feature', path: 'javascript:alert(1)', label: 'x' }] })[0]).toMatch(/tela do sistema/);
    expect(sectionsOf(c).map((x) => [x.title, x.start, x.end])).toEqual([['Descoberta', 0, 2], ['Proposta', 2, 3]]);
    const d = diffContent(c, { blocks: [c.blocks[0]!, { id: 'b', type: 'text', text: 'Pergunte sobre o momento do cliente' }, { id: 'n', type: 'divider' }] });
    expect(d.map((x) => [x.id, x.change])).toEqual([['a', 'igual'], ['b', 'alterado'], ['n', 'adicionado'], ['c', 'removido']]);
    expect(d[1]!.words!.filter((w) => w.op !== 'eq').map((w) => [w.op, w.text])).toEqual([['del', 'contexto'], ['add', 'momento']]);
    expect(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });
});
