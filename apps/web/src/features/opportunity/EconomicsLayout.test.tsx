import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { emptyEconInput, financeEngine, b2gFromEconomics, type DealKind, type EconInput, type EconItem, type EconSettings } from '@isp/domain';
import { EconomicsResult, EconomicsTab } from './Economics';
import { api } from '../../lib/api';
import { moneyHidden, setMoneyHidden } from '../../lib/privacy';
vi.mock('../../lib/api', async (original) => ({ ...await original<typeof import('../../lib/api')>(), api: vi.fn() }));
const settings: EconSettings = { marginTargetBp: 2000, tmaMonthlyBp: 0, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, badDebtBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, overheadBp: 0, incomeTaxBp: 0, netMarginTargetBp: 2000, netMarginMinBp: 900, netMarginMaxBp: 4100 };
const baseInput: EconInput = { ...emptyEconInput(), termMonths: 12, capex: [{ description: 'Equipamento', kind: 'venda', impact: 'material', qtyMilli: 1000, unitCents: 90000 }, { description: 'Instalação', kind: 'servico', impact: 'servico', qtyMilli: 1000, unitCents: 100000 }, { description: 'Implantação', kind: 'recorrencia', qtyMilli: 1000, unitCents: 120000 }], opex: [{ description: 'Mensal', qtyMilli: 1000, unitCents: 10000, kind: 'recorrencia' }] };
const items: EconItem[] = [
  { id: '1', qtyMilli: 1000, unit: 'un', description: 'OTDR', kind: 'venda', priceDefined: false, revenueCents: 0, doc: { name: 'NF-e', percentBp: 1000, fixedCents: 0, complete: true } },
  { id: '2', qtyMilli: 1000, unit: 'un', description: 'Instalação avulsa', kind: 'servico', priceDefined: false, revenueCents: 0, doc: { name: 'NFS-e', percentBp: 1500, fixedCents: 0, complete: true } },
  { id: '3', qtyMilli: 1000, unit: 'un', description: 'Link dedicado', kind: 'recorrencia', priceDefined: false, revenueCents: 0, doc: { name: 'NFS-e', percentBp: 1500, fixedCents: 0, complete: true } },
];
const clients: QueryClient[] = [];
let hidden: boolean;
beforeEach(() => { hidden = moneyHidden(); setMoneyHidden(false); vi.mocked(api).mockReset(); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); clients.splice(0).forEach((c) => c.clear()); setMoneyHidden(hidden); vi.unstubAllGlobals(); });

function setup(selected: DealKind[] = ['venda', 'servico', 'recorrencia'], override?: Partial<EconInput>, publicSector = false) {
  const selectedItems = selected.map((kind) => ({ ...items[kind === 'venda' ? 0 : kind === 'servico' ? 1 : 2]!, kind, description: kind === 'locacao' ? 'Aluguel roteador' : items[kind === 'venda' ? 0 : kind === 'servico' ? 1 : 2]!.description }));
  const profiles = new Set<DealKind>(selected.map((k) => k === 'venda' ? 'venda' : k === 'servico' ? 'servico' : 'recorrencia'));
  const input: EconInput = { ...baseInput, capex: baseInput.capex.filter((c) => profiles.has(c.kind!)), opex: profiles.has('recorrencia') ? baseInput.opex : [], ...override };
  const calc = (i: EconInput) => { const r = financeEngine({ input: i, items: selectedItems, settings, publicSector }); return { ...r, b2g: b2gFromEconomics({ input: i, items: selectedItems, settings, publicSector }, undefined, r) }; };
  let data = { input, settings, items: selectedItems, publicSector, saved: { updatedAt: '2026-11-19T12:00:00Z' }, result: calc(input), stale: false, editable: true, emitter: null, financeHidden: false, modelOverrides: [], settingsVersion: { id: 'settings', validFrom: '2026-11-19' }, status: 'calculada', canDecide: false, decisions: [], history: [] };
  const requests: (EconInput & { economicsUpdatedAt?: string | null })[] = [];
  vi.mocked(api).mockImplementation(async (_url, options) => {
    if (options?.method === 'PUT') {
      const body = options.body as EconInput & { economicsUpdatedAt?: string | null };
      requests.push(body);
      const { economicsUpdatedAt: _timestamp, ...input } = body;
      data = { ...data, input, result: calc(input), saved: { updatedAt: '2026-11-19T12:00:01Z' } };
      return { result: data.result } as never;
    }
    return data as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><EconomicsTab oppId="opp" /></QueryClientProvider>);
  return { requests, data: () => data };
}
const panel = (name: string) => screen.getByRole('region', { name: 'Viabilidade — ' + name });

describe('viabilidade global por cesta', () => {
  it('mantém o cálculo avançado de resultado, sem exibir toda a memória inicialmente', () => {
    const r = financeEngine({ input: baseInput, items, settings, publicSector: false });
    render(<EconomicsResult r={r} settings={settings} compact />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver cálculo avançado' }));
    const dialog = screen.getByRole('dialog', { name: 'Cálculo avançado' });
    expect(within(dialog).getByRole('button', { name: 'Mostrar Entradas' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it.each([
    ['venda'], ['servico'], ['recorrencia'], ['locacao'], ['recorrencia', 'locacao'],
    ['venda', 'servico'], ['venda', 'recorrencia'], ['servico', 'recorrencia'],
    ['venda', 'servico', 'recorrencia'],
  ] as DealKind[][])('mostra somente os perfis dos tipos %j', async (...selected) => {
    setup(selected);
    await screen.findAllByRole('region', { name: /^Viabilidade —/ });
    await waitFor(() => expect(screen.getAllByRole('region', { name: /^Viabilidade —/ })).toHaveLength(new Set(selected.map((k) => k === 'venda' ? 'fornecimento' : k === 'servico' ? 'instalacao' : 'implantacao')).size));
    expect(screen.queryByRole('button', { name: 'Mostrar A venda' })).toBeNull();
    expect(screen.queryByLabelText('Margem de contribuição (%)')).toBeNull();
  });
  it('salva margem e payback independentes, com proteção da versão, preservando custos', async () => {
    const { requests } = setup();
    await screen.findByLabelText('Margem líquida de Venda');
    fireEvent.change(screen.getByLabelText('Margem líquida de Venda'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Margem líquida de Recorrência'), { target: { value: '35' } });
    fireEvent.change(screen.getByLabelText('Payback de Recorrência'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar viabilidade' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ pricingMode: 'global', baskets: { fornecimento: { netTargetBp: 3000 }, instalacao: { netTargetBp: 2000 }, implantacao: { netTargetBp: 3500, paybackMonths: 2 } }, economicsUpdatedAt: '2026-11-19T12:00:00Z' });
    expect(requests[0]!.capex).toEqual(baseInput.capex);
    expect(requests[0]!.opex).toEqual(baseInput.opex);
    await screen.findByText('Salvo', { exact: true });
  });
  it('bloqueia alvo fora da faixa sem remover os controles necessários para corrigir', async () => {
    setup();
    const field = await screen.findByLabelText('Margem líquida de Venda');
    fireEvent.change(field, { target: { value: '8' } });
    expect((screen.getByRole('button', { name: 'Salvar viabilidade' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText('Margem líquida de Venda')).toBe(field);
    fireEvent.change(field, { target: { value: '25' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Salvar viabilidade' }) as HTMLButtonElement).disabled).toBe(false));
  });
  it('abre cálculo avançado somente da cesta escolhida', async () => {
    setup();
    await screen.findByLabelText('Margem líquida de Venda');
    fireEvent.click(within(panel('Venda')).getByRole('button', { name: 'Cálculo avançado' }));
    const dialog = screen.getByRole('dialog', { name: 'Cálculo avançado — Venda' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mostrar Documentos fiscais e avisos' }));
    expect(within(dialog).getByText('OTDR')).toBeTruthy();
    expect(within(dialog).queryByText('Link dedicado')).toBeNull();
  });
  it('oculta o rateio e as premissas, sem gravar valores nos produtos', async () => {
    const { requests } = setup();
    await screen.findByLabelText('Margem líquida de Venda');
    fireEvent.click(within(panel('Venda')).getByRole('button', { name: 'Usar preço sugerido' }));
    await waitFor(() => expect((screen.getByLabelText('Preço da venda de Venda') as HTMLInputElement).value).not.toBe(''));
    expect(screen.queryByRole('button', { name: 'Ver valores por item' })).toBeNull();
    expect(screen.queryByText('Premissas fiscais e ajustes da negociação')).toBeNull();
    expect(requests).toHaveLength(0);
    expect(vi.mocked(api).mock.calls.some(([url]) => url.endsWith('/items'))).toBe(false);
  });
  it('oferece consolidado e média mensal sem duplicar editor de custos', async () => {
    setup(['venda', 'recorrencia']);
    await screen.findByLabelText('Margem líquida de Venda');
    expect(screen.getByRole('table', { name: 'DRE da negociação' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Adicionar custo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Por mês' }));
    expect(screen.getByText(/Média por mês do contrato inteiro/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Contrato inteiro' }));
    expect(screen.queryByText(/Média por mês do contrato inteiro/)).toBeNull();
  });
  it.each([[100, 'text-danger'], [1000000, 'text-success']] as const)('colore o resultado do contrato no preço da venda de %i centavos', async (price, color) => {
    setup(['recorrencia'], { priceCents: price });
    await screen.findByRole('table', { name: 'DRE da negociação' });
    const row = within(screen.getByRole('table', { name: 'DRE da negociação' })).getByText('(=) Resultado líquido do contrato').closest('tr');
    expect(row?.classList.contains(color)).toBe(true);
    const overview = screen.getByRole('region', { name: 'Visão geral do negócio' });
    const metric = within(overview).getByText('Resultado líquido (DRE)').nextElementSibling;
    expect(metric?.classList.contains(color)).toBe(true);
  });
  it('mudar payback preserva o preço da venda e identifica a base do caixa', async () => {
    setup(['recorrencia'], { priceCents: 750000 });
    const field = await screen.findByLabelText('Preço da venda de Recorrência');
    const original = (field as HTMLInputElement).value;
    fireEvent.change(screen.getByLabelText('Payback de Recorrência'), { target: { value: '9' } });
    await screen.findByText(/Visão geral calculada com os preços da venda/);
    expect((field as HTMLInputElement).value).toBe(original);
    expect((screen.getByLabelText('Payback de Recorrência') as HTMLInputElement).value).toBe('6');
    expect(within(panel('Recorrência')).getByText(/No preço da venda · no sugerido:/)).toBeTruthy();
  });
  it.each([[false, 6], [true, 12]] as const)('limita o prazo pelo setor público=%s, teto=%i', async (publicSector, limit) => {
    setup(['recorrencia'], undefined, publicSector);
    const field = await screen.findByLabelText('Payback de Recorrência') as HTMLInputElement;
    expect(field.max).toBe(String(limit));
    fireEvent.change(field, { target: { value: String(limit + 1) } });
    expect(field.value).toBe(String(limit));
    fireEvent.change(field, { target: { value: '2' } });
    expect(field.value).toBe('2');
  });
  it('mostra o percentual configurado da inferência, sem confundir com a participação no preço', async () => {
    setup(['recorrencia'], { priceCents: 400000 });
    await screen.findByText('35% da base');
    const row = within(panel('Recorrência')).getByText('(−) Inferência custo de serviço').parentElement!;
    expect(row.textContent).toContain('420,00');
    expect(row.textContent).toContain('35% da base');
    fireEvent.change(screen.getByLabelText('Preço da venda de Recorrência'), { target: { value: '8000' } });
    await waitFor(() => expect(within(panel('Recorrência')).getByText('As métricas abaixo vêm do preço da venda').parentElement?.textContent).toContain('8.000,00'));
    const updatedRow = within(panel('Recorrência')).getByText('(−) Inferência custo de serviço').parentElement!;
    expect(updatedRow.textContent).toContain('35% da base');
    expect(updatedRow.textContent).toContain('420,00');
  });
  it('encurtar o payback eleva a sugestão sem trocar a margem alvo e explica o aumento do lucro final', async () => {
    setup(['recorrencia']);
    await screen.findByLabelText('Payback de Recorrência');
    const card = panel('Recorrência');
    const initial = within(card).getByText('Preço sugerido').parentElement!.textContent;
    fireEvent.change(screen.getByLabelText('Payback de Recorrência'), { target: { value: '2' } });
    await within(card).findByText(/Para cumprir o teto de payback de 2 meses/);
    expect(within(card).getByText('Preço sugerido').parentElement!.textContent).not.toBe(initial);
    expect((screen.getByLabelText('Margem líquida de Recorrência') as HTMLInputElement).value).toBe('20');
    expect(within(card).getByText(/A mensalidade permanece constante durante a vigência/)).toBeTruthy();
  });
  it('preserva proposta global antiga ao migrar para os controles por cesta', async () => {
    const { requests } = setup(['venda', 'servico', 'recorrencia'], { priceCents: 25000, salePriceCents: 300000 });
    await screen.findByLabelText('Margem líquida de Venda');
    const sale = (screen.getByLabelText('Preço da venda de Venda') as HTMLInputElement).value;
    const installation = (screen.getByLabelText('Preço da venda de Instalação') as HTMLInputElement).value;
    expect(sale).not.toBe('');
    expect(installation).not.toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar viabilidade' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.baskets!.fornecimento!.priceCents! + requests[0]!.baskets!.instalacao!.priceCents!).toBe(300000);
    expect(requests[0]!.baskets!.implantacao!.priceCents).toBe(25000);
    expect(requests[0]!.priceCents).toBeNull();
    expect(requests[0]!.salePriceCents).toBeNull();
  });
});
