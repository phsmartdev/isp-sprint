import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { b2gViability, type B2gParams, type B2gProduct, type EconSettings } from '@isp/domain';
import { B2gPanel, emptyB2gForm } from './B2gPanel';
import { fmtBRL } from '../../lib/format';
import { moneyHidden, setMoneyHidden } from '../../lib/privacy';

const settings: EconSettings = { marginTargetBp: 2000, tmaMonthlyBp: 0, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, netMarginMinBp: 900, netMarginMaxBp: 4100 };
const params: B2gParams = { mode: 'A', autoPrice: true, variableBp: 0, riskBp: 0, incomeTaxBp: 0, overheadBp: 0, netMinBp: 900, netTargetBp: 2000, termMonths: 12, paybackMonths: 6, weights: { folga: 0.06, manter: 0.36, custo: 0.58 } };
const products = (known = true): B2gProduct[] => ['folga', 'manter', 'custo'].map((id) => ({ id, description: id, kind: 'venda', profile: 'fornecimento', estimatedCents: known ? 100000 : 0, priceDefined: known, doc: { name: 'NF-e', taxBp: 1000, fixedCents: 0 } }));
const result = (known = true) => b2gViability(products(known), [{ description: 'Custo', kind: 'venda', qtyMilli: 1000, unitCents: 165000 }], [], params);
let hidden: boolean;
beforeEach(() => { hidden = moneyHidden(); setMoneyHidden(false); });
afterEach(() => { cleanup(); setMoneyHidden(hidden); });

describe('leitura da margem por cesta e produto', () => {
  it('usa a faixa configurada para orientar redução, manutenção e correção do preço', () => {
    const r = result(), before = JSON.stringify(r);
    render(<B2gPanel r={r} f={emptyB2gForm()} set={vi.fn()} settings={settings} disabled={false} />);
    const basket = screen.getByRole('region', { name: 'Cesta Fornecimento' });
    expect(within(basket).getByText('Reduzir preço: acima da faixa')).toBeTruthy();
    expect(within(basket).getByText('Manter na faixa')).toBeTruthy();
    expect(within(basket).getByText('Aumentar preço ou reduzir custo')).toBeTruthy();
    const l = r.unica!.lines[0]!;
    expect(screen.getByLabelText('Negociação de folga').textContent).toContain(fmtBRL(l.priceCents! - l.floorCents!));
    expect(within(basket).getByText(/Preço sugerido da cesta/).textContent).toContain(fmtBRL(r.unica!.lines.reduce((t, l) => t + l.suggestedCents!, 0)));
    expect(JSON.stringify(r)).toBe(before);
  });

  it('sem valor de venda mantém os sugeridos e a margem líquida apenas na cesta', () => {
    render(<B2gPanel r={result(false)} f={emptyB2gForm()} set={vi.fn()} settings={settings} disabled={false} />);
    const basket = screen.getByRole('region', { name: 'Cesta Fornecimento' });
    expect(within(basket).getByText(/margem líquida apresentada somente para a cesta/)).toBeTruthy();
    expect(within(basket).queryByRole('columnheader', { name: 'Líquida / negociação' })).toBeNull();
    expect(within(basket).queryByRole('columnheader', { name: 'Valor de venda' })).toBeNull();
    expect(within(basket).getByRole('columnheader', { name: 'Preço sugerido' })).toBeTruthy();
    expect(screen.queryByLabelText('Negociação de folga')).toBeNull();
  });

  it('sem faixa completa não inventa recomendações de preço', () => {
    render(<B2gPanel r={result()} f={emptyB2gForm()} set={vi.fn()} settings={{ ...settings, netMarginMaxBp: undefined }} disabled={false} />);
    expect(screen.getAllByText('Configure a faixa de margem líquida.')).toHaveLength(3);
    expect(screen.queryByText('Manter na faixa')).toBeNull();
  });
});
