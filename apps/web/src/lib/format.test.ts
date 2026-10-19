import { describe, expect, it } from 'vitest';
import { fmtBRL, fmtDate, fmtDuration, fmtPct, isoToLocalInput, localInputToIso } from './format';
import { qs } from './api';

describe('formatação da interface', () => {
  it('moeda BRL a partir de centavos', () => {
    expect(fmtBRL(14990)).toMatch(/R\$\s?149,90/);
    expect(fmtBRL(null)).toBe('—');
  });
  it('percentual sem dado vira N/D, nunca 0', () => {
    expect(fmtPct(null)).toBe('N/D');
    expect(fmtPct(0.217)).toBe('21,7%');
  });
  it('cronômetro passa de 7 minutos sem cortar', () => {
    expect(fmtDuration(0)).toBe('00:00');
    expect(fmtDuration(7 * 60 + 5)).toBe('07:05');
    expect(fmtDuration(12 * 60)).toBe('12:00');
  });
  it('datetime-local ida e volta preserva o instante', () => {
    const iso = localInputToIso('2026-10-20T10:30')!;
    expect(isoToLocalInput(iso)).toBe('2026-10-20T10:30');
    expect(localInputToIso('')).toBeNull();
  });
  it('querystring ignora vazios', () => {
    expect(qs({ a: '1', b: '', c: undefined, d: 0 })).toBe('?a=1&d=0');
  });
});

it('data sem hora não muda de dia por causa do fuso', () => {
  expect(fmtDate('2026-10-03')).toBe('03/10/2026');
  expect(fmtDate('2027-01-01')).toBe('01/01/2027');
});
