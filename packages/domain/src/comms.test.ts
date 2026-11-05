import { describe, expect, it } from 'vitest';
import { leadDays, nextNode, renderComm, templateIssues, unknownVariables, validateCommGraph, waitUntil, type CommGraph } from './comms';

const base: CommGraph = {
  nodes: [
    { id: 'g', type: 'gatilho', x: 0, y: 0, data: { trigger: 'renovacao' } },
    { id: 'w', type: 'espera', x: 0, y: 0, data: { mode: 'antes', days: 60 } },
    { id: 's', type: 'envio', x: 0, y: 0, data: { templateId: 't', channels: ['email'], recipients: [{ kind: 'cliente', value: '' }], approverRole: 'SC' } },
    { id: 'c', type: 'condicao', x: 0, y: 0, data: { condition: 'confirmado' } },
    { id: 'f1', type: 'fim', x: 0, y: 0, data: {} },
    { id: 'f2', type: 'fim', x: 0, y: 0, data: {} },
  ],
  edges: [{ id: '1', source: 'g', target: 'w' }, { id: '2', source: 'w', target: 's' }, { id: '3', source: 's', target: 'c' }, { id: '4', source: 'c', target: 'f1', handle: 'sim' }, { id: '5', source: 'c', target: 'f2', handle: 'nao' }],
};

describe('esteira: desenho', () => {
  it('desenho completo passa; caminhos seguem as setas e a resposta da condição', () => {
    expect(validateCommGraph(base)).toEqual([]);
    expect(nextNode(base, 'g')).toBe('w');
    expect(nextNode(base, 'c', true)).toBe('f1');
    expect(nextNode(base, 'c', false)).toBe('f2');
    expect(leadDays(base)).toBe(60);
  });
  it('acusa gatilho duplicado, passo solto, ciclo, envio sem aprovador e condição sem "não"', () => {
    const msgs = (g: CommGraph) => validateCommGraph(g).map((i) => i.message).join(' | ');
    expect(msgs({ ...base, nodes: [...base.nodes, { id: 'g2', type: 'gatilho', x: 0, y: 0, data: { trigger: 'reajuste' } }] })).toMatch(/exatamente um gatilho/);
    expect(msgs({ ...base, nodes: [...base.nodes, { id: 'x', type: 'fim', x: 0, y: 0, data: {} }] })).toMatch(/não está ligado/);
    expect(msgs({ ...base, edges: [...base.edges.filter((e) => e.id !== '5'), { id: '6', source: 'c', target: 'w', handle: 'nao' }] })).toMatch(/ciclo/);
    expect(msgs({ ...base, nodes: base.nodes.map((n) => (n.id === 's' ? { ...n, data: { ...n.data, approverRole: null } } : n)) })).toMatch(/aprova/);
    expect(msgs({ ...base, edges: base.edges.filter((e) => e.id !== '5') })).toMatch(/"sim" e uma "não"/);
  });
  it('espera relativa à data do gatilho ou ao passo anterior', () => {
    expect(waitUntil('antes', 30, '2026-12-31', '2026-11-05')).toBe('2026-12-01');
    expect(waitUntil('depois', 5, '2026-12-31', '2026-11-05')).toBe('2027-01-05');
    expect(waitUntil('aguardar', 7, '2026-12-31', '2026-11-05')).toBe('2026-11-12');
  });
});

describe('esteira: templates', () => {
  it('variáveis inexistentes, campos por canal e valor ausente sem invenção', () => {
    expect(unknownVariables('{{cliente}} {{xpto}} {{ contrato }}')).toEqual(['xpto']);
    expect(templateIssues({ subject: '', body: 'x', whatsapp: '' }, ['email', 'whatsapp'])).toHaveLength(2);
    expect(renderComm('Olá {{cliente}}, vence {{fim_vigencia}}', { cliente: 'A & B' }, true)).toBe('Olá A &amp; B, vence —');
  });
});
