import { describe, expect, it } from 'vitest';
import { consolidateItems, DEFAULT_MEASUREMENT_TEXTS, emailListOk, measurementEmailHtml, officialPeriod, type MeasurementProposal } from './measurementReport';

describe('relatório de medição', () => {
  it('período oficial: mês anterior, envio no dia escolhido (limitado ao fim do mês)', () => {
    expect(officialPeriod('2026-11-09', 5)).toEqual({ referenceMonth: '2026-10', dueOn: '2026-11-05' });
    expect(officialPeriod('2026-01-02', 31)).toEqual({ referenceMonth: '2025-12', dueOn: '2026-01-31' });
    expect(officialPeriod('2026-02-10', 31).dueOn).toBe('2026-02-28');
  });
  it('consolida por descrição + unidade + preço e numera pelo contrato', () => {
    const r = consolidateItems([
      { description: 'Fusão Óptica', unit: 'un', qtyMilli: 60_000, unitCents: 7_000, totalCents: 420_000 },
      { description: 'fusao  optica', unit: 'un', qtyMilli: 42_000, unitCents: 7_000, totalCents: 294_000 },
      { description: 'Item avulso', unit: 'h', qtyMilli: 2_000, unitCents: 10_000, totalCents: 20_000 },
      { description: 'Projeto executivo', unit: 'km', qtyMilli: 56_000, unitCents: 450, totalCents: 25_200 },
    ], [{ description: 'Projeto executivo', number: '15', unit: 'M' }, { description: 'Fusão óptica' }]);
    expect(r.map((i) => [i.item, i.qtyMilli, i.totalCents])).toEqual([['2', 102_000, 714_000], ['15', 56_000, 25_200], [null, 2_000, 20_000]]);
    expect(r[1]!.unitLabel).toBe('M');
  });
  it('e-mail: só propostas incluídas, em ordem de envio, com totais e texto escapado', () => {
    const p = (code: number, sentOn: string, v: number, included = true): MeasurementProposal => ({ opportunityId: String(code), code, title: `Recuperação <óptica> ${code}`, sentOn, valueCents: v, attachment: null, contractNumber: null, included });
    const html = measurementEmailHtml({ referenceMonth: '2026-10', texts: DEFAULT_MEASUREMENT_TEXTS, proposals: [p(2, '2026-10-13', 141_160), p(1, '2026-10-05', 133_440), p(3, '2026-10-20', 99_999, false)], items: [] });
    expect(html.indexOf('OP-1')).toBeLessThan(html.indexOf('OP-2'));
    expect(html).not.toContain('OP-3');
    expect(html).toContain('R$ 2.746,00');
    expect(html).toContain('mês de outubro');
    expect(html).toContain('&lt;ÓPTICA&gt;');
  });
  it('lista de e-mails', () => { expect(emailListOk('a@b.com; c@d.com.br')).toBe(true); expect(emailListOk('a@b')).toBe(false); });
});

import { nextProposalNumber } from './measurementReport';
describe('número da proposta', () => {
  it('PC AAMMDD e sufixo no mesmo dia', () => {
    expect(nextProposalNumber('2026-11-09', [])).toBe('PC 261109');
    expect(nextProposalNumber('2026-11-09', ['PC 261109'])).toBe('PC 261109-2');
    expect(nextProposalNumber('2026-11-09', ['PC 261109', 'PC 261109-2'])).toBe('PC 261109-3');
  });
});

import { defaultTables, normalizeGrid } from './measurementReport';
describe('tabelas editáveis', () => {
  it('parte do CRM, aceita coluna e linha novas e texto livre', () => {
    const p: MeasurementProposal = { opportunityId: 'a', code: 9, number: 'PC 261005', title: 'Serviço fictício', sentOn: '2026-10-05', valueCents: 100_00, attachment: null, contractNumber: null, included: true };
    const t = defaultTables([p], []);
    expect(t.proposals.rows[0]).toEqual(['05/10/2026', 'SERVIÇO FICTÍCIO', 'PC 261005', 'R$ 100,00']);
    t.proposals.columns.push({ label: 'Observação', align: 'left' });
    t.proposals.rows.push(['—', 'Ajuste combinado <com o fiscal>', '', 'R$ 0,00']);
    const g = normalizeGrid(t.proposals);
    expect(g.rows.every((r) => r.length === 5)).toBe(true);
    const html = measurementEmailHtml({ referenceMonth: '2026-10', texts: DEFAULT_MEASUREMENT_TEXTS, proposals: [p], items: [], tables: { proposals: g, items: t.items } });
    expect(html).toContain('Observação');
    expect(html).toContain('&lt;com o fiscal&gt;');
    expect(html).toContain('colspan="3"');
  });
});
