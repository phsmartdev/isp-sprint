import { describe, expect, it } from 'vitest';
import { participantsError, rankParticipants, type BidParticipant } from './bids';

const p = (company: string, bidCents: number | null, extra: Partial<BidParticipant> = {}): BidParticipant => ({ company: `Empresa ${company}`, document: null, lot: '', bidCents, status: 'ativo', winner: false, isUs: false, ...extra });

describe('participantes da licitação', () => {
  it('ranking por lote, menor lance primeiro; empate divide a posição; sem lance e desclassificada ficam fora', () => {
    const rows = [p('A', 300), p('B', 100), p('C', 200, { lot: '2' }), p('D', 100), p('E', null), p('F', 50, { status: 'desclassificado' }), p('G', 150, { lot: '2' })];
    expect(rankParticipants(rows)).toEqual([3, 1, 2, 1, null, null, 1]);
  });
  it('um vencedor por lote; lote único aceita só um', () => {
    expect(participantsError([p('A', 1, { winner: true }), p('B', 2, { winner: true })])).toMatch(/Lote único/);
    expect(participantsError([p('A', 1, { winner: true, lot: '1' }), p('B', 2, { winner: true, lot: '2' })])).toBeNull();
    expect(participantsError([p('A', 1, { winner: true, lot: '1' }), p('B', 2, { winner: true, lot: '1' })])).toMatch(/Lote 1/);
  });
  it('valida empresa, CNPJ, duplicidade e vencedor desclassificado', () => {
    expect(participantsError([{ ...p('A', 1), company: ' ' }])).toMatch(/empresa/);
    expect(participantsError([p('A', 1, { document: '123' })])).toMatch(/14 dígitos/);
    expect(participantsError([p('A', 1, { document: '11.222.333/0001-81' }), p('A2', 2, { document: '11222333000181' })])).toMatch(/duas vezes/);
    expect(participantsError([p('A', 1, { status: 'desistente', winner: true })])).toMatch(/não pode vencer/);
  });
});
