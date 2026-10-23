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

import { competitorKey, competitorStats } from './bids';
describe('inteligência por concorrente', () => {
  const row = (opportunityId: string, company: string, bidCents: number | null, extra: Partial<BidParticipant> = {}, at = '2026-10-01') => ({ opportunityId, at, company, document: null, lot: '', bidCents, status: 'ativo' as const, winner: false, isUs: false, ...extra });
  it('mesmo CNPJ com nomes diferentes é um concorrente só; nome sem CNPJ ignora acento e caixa', () => {
    expect(competitorKey({ document: '11.222.333/0001-81', company: 'A' })).toBe(competitorKey({ document: '11222333000181', company: 'B' }));
    expect(competitorKey({ document: null, company: 'Rede  Ágil' })).toBe(competitorKey({ document: '', company: 'rede agil' }));
  });
  it('pregões juntos, vitórias, contra nós, lance médio e mínimo; nossa empresa fica de fora', () => {
    const doc = '11222333000181';
    const s = competitorStats([
      row('o1', 'Nós', 100, { isUs: true, winner: true }), row('o1', 'Rede Alfa', 120, { document: doc }),
      row('o2', 'Nós', 200, { isUs: true }), row('o2', 'Rede Alfa Telecom', 180, { document: doc, winner: true }, '2026-10-05'),
      row('o3', 'Rede Alfa', 50, { document: doc, lot: '1', winner: true }), row('o3', 'Rede Alfa', null, { document: doc, lot: '2' }),
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ name: 'Rede Alfa Telecom', document: doc, bids: 3, lots: 4, wins: 2, ourWinsAgainst: 1, theirWinsAgainstUs: 1, avgBidCents: Math.round((120 + 180 + 50) / 3), minBidCents: 50, lastAt: '2026-10-05' });
    expect(s[0]!.winRate).toBe(0.5);
  });
});
