import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { emptyEconInput, financeEngine, type EconCell, type EconSettings } from '@isp/domain';
import { EconomicsResult } from './Economics';
import { fmtBRL } from '../../lib/format';
import { MASK, moneyHidden, setMoneyHidden } from '../../lib/privacy';

const settings: EconSettings = { marginTargetBp: 2000, tmaMonthlyBp: 0, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, overheadBp: 0, incomeTaxBp: 0 };
const result = () => financeEngine({
  settings, publicSector: false,
  input: { ...emptyEconInput(), termMonths: 12, capex: [{ description: 'Equipamento', kind: 'venda', qtyMilli: 1000, unitCents: 90000 }, { description: 'Implantação', kind: 'servico', qtyMilli: 1000, unitCents: 220000 }], opex: [{ description: 'Mensal', qtyMilli: 1000, unitCents: 10000 }] },
  items: [
    { description: 'Venda', kind: 'venda', revenueCents: 200000, doc: { name: 'NF-e', percentBp: 1000, fixedCents: 0, complete: true } },
    { description: 'Instalação', kind: 'servico', revenueCents: 100000, doc: { name: 'NFS-e', percentBp: 1500, fixedCents: 0, complete: true } },
    { description: 'Link', kind: 'recorrencia', revenueCents: 10000, doc: { name: 'NFS-e', percentBp: 1500, fixedCents: 0, complete: true } },
  ],
});
const title = (cesta: string, ritmo: string) => `Memória de cálculo · ${cesta} · ${ritmo}`;
let hidden: boolean;
beforeEach(() => { hidden = moneyHidden(); setMoneyHidden(false); });
afterEach(() => { cleanup(); setMoneyHidden(hidden); });

describe('memória de cálculo no preço por cesta', () => {
  it('detalha cada cesta e ritmo com seus próprios valores e a fórmula da parcela mensal', () => {
    const r = result(), before = JSON.stringify(r);
    render(<EconomicsResult r={r} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver cálculo avançado' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mostrar Preço por cesta' }));
    const supplyTitle = title('Fornecimento (venda pura)', 'pagamento único');
    const monthlyTitle = title('Implantação (instalação ou fornecimento + instalação)', 'mensal');
    const supply = screen.getByLabelText(supplyTitle) as HTMLDetailsElement;
    const monthly = screen.getByLabelText(monthlyTitle) as HTMLDetailsElement;
    expect(supply.open).toBe(false);
    fireEvent.click(within(supply).getByText(supplyTitle));
    fireEvent.click(within(monthly).getByText(monthlyTitle));
    expect(supply.open).toBe(true);
    const row = within(supply).getByText('Investimento inicial (I)').closest('div')!;
    expect(row.textContent).toContain(fmtBRL(90000));
    expect(supply.textContent).toContain(fmtBRL(128572));
    expect(monthly.textContent).toContain(fmtBRL(120000));
    expect(monthly.textContent).toContain(fmtBRL(46154));
    expect(within(monthly).getByText('Parcela do investimento (P_inv)')).toBeTruthy();
    expect(monthly.textContent).toContain('1–6');
    expect(JSON.stringify(r)).toBe(before);
  });

  it('respeita a ocultação dos valores financeiros', () => {
    const r = result(), visiblePrice = fmtBRL(46154);
    setMoneyHidden(true);
    render(<EconomicsResult r={r} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver cálculo avançado' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mostrar Preço por cesta' }));
    const memory = screen.getByLabelText('Memórias de cálculo por cesta');
    expect(memory.textContent).toContain(MASK);
    expect(memory.textContent).not.toContain(visiblePrice);
  });

  it('preserva fotografias sem detalhamento e não duplica as memórias no resumo compacto', () => {
    const r = result();
    delete (r.deal!.cells[0] as Partial<EconCell>).result;
    const { unmount } = render(<EconomicsResult r={r} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver cálculo avançado' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mostrar Preço por cesta' }));
    expect(screen.getByText(/Esta fotografia não tem o detalhamento da cesta/)).toBeTruthy();
    unmount();
    render(<EconomicsResult r={result()} compact />);
    expect(screen.queryByLabelText('Memórias de cálculo por cesta')).toBeNull();
  });
});
