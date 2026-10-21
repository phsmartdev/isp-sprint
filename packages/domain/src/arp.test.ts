import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES, autoMap, checkAdhesion, computeBalances, key, parseImportRows, parseNumberBR, simulateOperation, toMilli, validateRules,
  type AgencyBase, type Allocation, type ArpLedgerEntry, type ItemBase,
} from './arp';

const items: ItemBase[] = [{ id: 'i1', registeredMilli: toMilli(100), unitCents: 1000 }, { id: 'i2', registeredMilli: toMilli(50), unitCents: 2000 }];
const agencies: AgencyBase[] = [{ id: 'g', kind: 'gerenciador' }, { id: 'p', kind: 'participante' }, { id: 'n', kind: 'nao_participante' }];
const alloc: Allocation[] = [{ itemId: 'i1', agencyId: 'p', qtyMilli: toMilli(40) }];

describe('saldos pelo ledger', () => {
  it('distribuição: gerenciador fica com o não distribuído; reserva não é consumo', () => {
    const b = computeBalances(items, agencies, alloc, [
      { kind: 'reserva', itemId: 'i1', agencyId: 'p', qtyMilli: toMilli(10) },
      { kind: 'consumo', itemId: 'i1', agencyId: 'g', qtyMilli: toMilli(5) },
    ]);
    expect(b.byItemAgency.get(key('i1', 'g'))).toMatchObject({ quota: toMilli(60), contracted: toMilli(5), available: toMilli(55) });
    expect(b.byItemAgency.get(key('i1', 'p'))).toMatchObject({ quota: toMilli(40), reserved: toMilli(10), contracted: 0, available: toMilli(30) });
    expect(b.byItem.get('i1')).toMatchObject({ registered: toMilli(100), reserved: toMilli(10), contracted: toMilli(5), available: toMilli(85) });
  });
  it('estorno devolve saldo sem apagar o consumo; adesão é cota à parte', () => {
    const led: ArpLedgerEntry[] = [
      { kind: 'consumo', itemId: 'i1', agencyId: 'g', qtyMilli: toMilli(20) },
      { kind: 'estorno', itemId: 'i1', agencyId: 'g', qtyMilli: toMilli(20) },
      { kind: 'adesao', itemId: 'i1', agencyId: 'n', qtyMilli: toMilli(30) },
      { kind: 'consumo', itemId: 'i1', agencyId: 'n', qtyMilli: toMilli(10) },
    ];
    const b = computeBalances(items, agencies, alloc, led);
    expect(b.byItem.get('i1')).toMatchObject({ registered: toMilli(100), available: toMilli(100), adhesionAuthorized: toMilli(30), adhesionAvailable: toMilli(20) });
    expect(led).toHaveLength(4);
  });
});

describe('limites de adesão', () => {
  const r = DEFAULT_RULES.federal;
  const ctx = (agencyUsed = 0, totalUsed = 0) => ({ registered: new Map([['i1', toMilli(100)]]), agencyAuthorized: new Map([['i1', agencyUsed]]), totalAuthorized: new Map([['i1', totalUsed]]) });
  it('50% por órgão e 200% no total', () => {
    expect(checkAdhesion(r, [{ itemId: 'i1', qtyMilli: toMilli(50) }], ctx()).ok).toBe(true);
    expect(checkAdhesion(r, [{ itemId: 'i1', qtyMilli: toMilli(51) }], ctx()).lines[0]!.violations[0]).toContain('limite por órgão');
    expect(checkAdhesion(r, [{ itemId: 'i1', qtyMilli: toMilli(10) }], ctx(0, toMilli(195))).lines[0]!.violations[0]).toContain('limite total');
  });
  it('configuração não ultrapassa o teto legal', () => {
    expect(validateRules('federal', { ...r, adhesionPerAgencyBp: 6000 })[0]).toContain('teto legal');
    expect(validateRules('municipal', { ...r, adhesionPerAgencyBp: 3000 })).toEqual([]);
  });
});

describe('motor de operações', () => {
  const ctx = (ledger: ArpLedgerEntry[] = [], allowConversion = true) => ({
    items: new Map(items.map((i) => [i.id, { ...i, label: i.id }])),
    agencies: new Map(agencies.map((a) => [a.id, { ...a, name: a.id }])),
    balances: computeBalances(items, agencies, alloc, ledger),
    rules: { ...DEFAULT_RULES.federal, allowConversion },
    status: 'vigente' as const,
  });
  it('conversão não aumenta valor nem cria item', () => {
    const ok = simulateOperation({ kind: 'conversao', criteria: 'Critério fictício de teste', sources: [{ itemId: 'i1', agencyId: 'g', qtyMilli: toMilli(20) }], targets: [{ itemId: 'i2', agencyId: 'g', qtyMilli: toMilli(10) }] }, ctx());
    expect(ok.ok).toBe(true);
    expect(ok.entries.map((e) => `${e.kind}:${e.dir}`)).toEqual(['conversao:saida', 'conversao:entrada']);
    const up = simulateOperation({ kind: 'conversao', criteria: 'Critério fictício de teste', sources: [{ itemId: 'i1', agencyId: 'g', qtyMilli: toMilli(10) }], targets: [{ itemId: 'i2', agencyId: 'g', qtyMilli: toMilli(10) }] }, ctx());
    expect(up.errors.join(' ')).toContain('não pode aumentar o valor');
    const ghost = simulateOperation({ kind: 'conversao', criteria: 'Critério fictício de teste', sources: [{ itemId: 'i1', agencyId: 'g', qtyMilli: 1 }], targets: [{ itemId: 'novo', agencyId: 'g', qtyMilli: 1 }] }, ctx());
    expect(ghost.errors.join(' ')).toContain('não cria objeto novo');
  });
  it('remanejamento: mesmo item, origem e destino, sem passar do disponível', () => {
    const s = simulateOperation({ kind: 'remanejamento', sources: [{ itemId: 'i1', agencyId: 'p', qtyMilli: toMilli(10) }], targets: [{ itemId: 'i1', agencyId: 'g', qtyMilli: toMilli(10) }] }, ctx());
    expect(s.ok).toBe(true);
    expect(s.impact.find((x) => x.agencyId === 'p')!.after.quota).toBe(toMilli(30));
    const tooMuch = simulateOperation({ kind: 'remanejamento', sources: [{ itemId: 'i1', agencyId: 'p', qtyMilli: toMilli(41) }], targets: [{ itemId: 'i1', agencyId: 'g', qtyMilli: toMilli(41) }] }, ctx());
    expect(tooMuch.errors.join(' ')).toContain('Saldo insuficiente');
  });
  it('correção gera estorno e lançamento novo; não corrige duas vezes', () => {
    const c = { id: 'L1', kind: 'consumo' as const, itemId: 'i1', agencyId: 'g', qtyMilli: toMilli(8), reversed: false };
    const s = simulateOperation({ kind: 'correcao', sources: [], targets: [], correctsEntry: c, correctedQtyMilli: toMilli(5) }, ctx([{ kind: 'consumo', itemId: 'i1', agencyId: 'g', qtyMilli: toMilli(8) }]));
    expect(s.entries).toEqual([expect.objectContaining({ kind: 'estorno', reversesId: 'L1', qtyMilli: toMilli(8) }), expect.objectContaining({ kind: 'consumo', qtyMilli: toMilli(5) })]);
    expect(simulateOperation({ kind: 'correcao', sources: [], targets: [], correctsEntry: { ...c, reversed: true }, correctedQtyMilli: 0 }, ctx()).ok).toBe(false);
  });
});

describe('importação', () => {
  it('mapeia cabeçalhos diferentes e confere total', () => {
    expect(autoMap(['Qtd.', 'Preço Unit.', 'Descrição do Objeto', 'Lote', 'Item', 'UN'])).toEqual({ 'Qtd.': 'registeredQty', 'Preço Unit.': 'unitPrice', 'Descrição do Objeto': 'description', Lote: 'lot', Item: 'itemNumber', UN: 'unit' });
    expect(parseNumberBR('R$ 1.234,56')).toBe(1234.56);
    expect(parseNumberBR('1,234.56')).toBe(1234.56);
    const r = parseImportRows([
      { itemNumber: '1', description: 'Link 100 Mbps', unit: 'mês', registeredQty: '12', unitPrice: '1.500,00', totalPrice: '18.000,00' },
      { itemNumber: '2', description: 'Roteador', unit: 'un', registeredQty: '10', unitPrice: '300', totalPrice: '2.000,00' },
      { itemNumber: '1', description: 'Link 100 Mbps', unit: 'mês', registeredQty: '12', unitPrice: '1.500,00', agency: 'Prefeitura X', agencyQty: '4' },
    ]);
    expect(r.items).toHaveLength(2);
    expect(r.issues).toEqual([expect.objectContaining({ row: 3, field: 'totalPrice', level: 'erro' })]);
    expect(r.items[1]).toMatchObject({ agency: 'Prefeitura X', agencyMilli: 4000 });
  });
});

describe('alteração de item e critério de conversão', () => {
  const base = { items: new Map([['i1', { id: 'i1', registeredMilli: 10_000, unitCents: 100, label: 'item 1', unit: 'mês' }], ['i2', { id: 'i2', registeredMilli: 10_000, unitCents: 100, label: 'item 2', unit: 'un' }]]), agencies: new Map([['g', { id: 'g', kind: 'gerenciador' as const, name: 'G' }]]), balances: computeBalances([{ id: 'i1', registeredMilli: 10_000, unitCents: 100 }, { id: 'i2', registeredMilli: 10_000, unitCents: 100 }], [{ id: 'g', kind: 'gerenciador' }], [], []), rules: DEFAULT_RULES.federal, status: 'vigente' as const };
  it('conversão exige critério e avisa unidades diferentes, sem presumir equivalência', () => {
    const no = simulateOperation({ kind: 'conversao', sources: [{ itemId: 'i1', agencyId: 'g', qtyMilli: 1000 }], targets: [{ itemId: 'i2', agencyId: 'g', qtyMilli: 1000 }] }, base);
    expect(no.errors.join(' ')).toContain('critério');
    const yes = simulateOperation({ kind: 'conversao', criteria: '1 mês = 1 un (parecer 12/2026)', sources: [{ itemId: 'i1', agencyId: 'g', qtyMilli: 1000 }], targets: [{ itemId: 'i2', agencyId: 'g', qtyMilli: 1000 }] }, base);
    expect(yes.warnings.join(' ')).toContain('Unidades diferentes');
  });
  it('alteração de item não gera lançamento de saldo e não aceita descrição vazia', () => {
    const r = simulateOperation({ kind: 'alteracao_item', sources: [{ itemId: 'i1', agencyId: 'g', qtyMilli: 0 }], targets: [], itemPatch: { description: 'Nova descrição' } }, base);
    expect(r.ok).toBe(true);
    expect(r.entries).toHaveLength(0);
    expect(simulateOperation({ kind: 'alteracao_item', sources: [{ itemId: 'i1', agencyId: 'g', qtyMilli: 0 }], targets: [], itemPatch: { description: '' } }, base).ok).toBe(false);
  });
});
