import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { b2gFromEconomics, emptyEconInput, financeEngine, type EconResult, type EconInput, type EconItem, type EconSettings } from '@isp/domain';
import { EconomicsResult, EconomicsTab } from './Economics';
import { api } from '../../lib/api';
import { moneyHidden, setMoneyHidden } from '../../lib/privacy';

vi.mock('../../lib/api', async (original) => ({ ...await original<typeof import('../../lib/api')>(), api: vi.fn() }));
const settings: EconSettings = { marginTargetBp: 2000, tmaMonthlyBp: 0, commissionBp: 0, lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 0, contingencyOpexBp: 0, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, overheadBp: 0, incomeTaxBp: 0, netMarginTargetBp: 2000, netMarginMinBp: 900, netMarginMaxBp: 4100 };
const input: EconInput = { ...emptyEconInput(), termMonths: 12, capex: [{ description: 'Equipamento', kind: 'venda', impact: 'material', qtyMilli: 1000, unitCents: 90000 }, { description: 'Instalação', kind: 'servico', impact: 'servico', qtyMilli: 1000, unitCents: 100000 }, { description: 'Implantação', kind: 'recorrencia', qtyMilli: 1000, unitCents: 120000 }], opex: [{ description: 'Mensal', qtyMilli: 1000, unitCents: 10000 }] };
const items: EconItem[] = [
  { description: 'Venda', kind: 'venda', revenueCents: 200000, doc: { name: 'NF-e', percentBp: 1000, fixedCents: 0, complete: true } },
  { description: 'Instalação', kind: 'servico', revenueCents: 100000, doc: { name: 'NFS-e', percentBp: 1500, fixedCents: 0, complete: true } },
  { description: 'Link', kind: 'recorrencia', revenueCents: 10000, doc: { name: 'NFS-e', percentBp: 1500, fixedCents: 0, complete: true } },
];
const calculate = (value = input) => financeEngine({ input: value, items, settings, publicSector: false });
let hidden: boolean;
const clients: QueryClient[] = [];
beforeEach(() => {
  hidden = moneyHidden(); setMoneyHidden(false); vi.mocked(api).mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); clients.splice(0).forEach((c) => c.clear()); setMoneyHidden(hidden); vi.unstubAllGlobals(); });

function setup(selected = items, previous?: EconResult, stale = false) {
  const calc = (value = input) => financeEngine({ input: value, items: selected, settings, publicSector: false });
  const requests: EconInput[] = [];
  let data = { input, settings, items: selected, publicSector: false, saved: { updatedAt: '2026-11-18T12:00:00Z' }, result: previous ?? calc(), stale, editable: true, emitter: null, financeHidden: false, modelOverrides: [], settingsVersion: { id: 'settings', validFrom: '2026-11-18' }, status: 'calculada', canDecide: false, decisions: [], history: [] };
  vi.mocked(api).mockImplementation(async (url, options) => {
    if (url === '/cost-items') return { items: [] } as never;
    if (options?.method === 'PUT') {
      const body = options.body as EconInput;
      requests.push(body);
      data = { ...data, input: body, result: calc(body) };
      return { result: data.result } as never;
    }
    return data as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><EconomicsTab oppId="opp" /></QueryClientProvider>);
  return requests;
}

describe('organização da viabilidade', () => {
  it('mantém os indicadores laterais e abre o detalhamento em janela', () => {
    render(<EconomicsResult r={calculate()} settings={settings} compact />);
    expect(screen.getByText('Base dos indicadores')).toBeTruthy();
    expect(screen.getByText('Base da aprovação')).toBeTruthy();
    expect(screen.queryByText(/Vigência fiscal.*No preço sugerido/)).toBeNull();
    expect(screen.queryByLabelText('Preço por cesta')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver cálculo avançado' }));
    const dialog = screen.getByRole('dialog', { name: 'Cálculo avançado' });
    const entries = within(dialog).getByRole('button', { name: 'Mostrar Entradas' });
    expect(entries.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(entries);
    expect(entries.getAttribute('aria-expanded')).toBe('true');
    expect(within(dialog).getByRole('button', { name: 'Recolher Desdobramento financeiro' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('mantém os custos para o cálculo sem oferecer outro editor na viabilidade', async () => {
    const requests = setup();
    await screen.findByLabelText('Custos da negociação');
    expect(screen.getByText(/coluna Quando separa/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Adicionar custo mensal' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Investimentos de fornecimento' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar viabilidade econômica' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.capex).toEqual(input.capex.map((c) => expect.objectContaining(c)));
    expect(requests[0]!.opex).toEqual(input.opex.map((c) => expect.objectContaining(c)));
  });
  it.each([
    ['venda'], ['servico'], ['recorrencia'], ['locacao'], ['recorrencia', 'locacao'],
    ['venda', 'servico'], ['venda', 'recorrencia'], ['servico', 'recorrencia'],
    ['venda', 'servico', 'recorrencia'],
  ])('mostra apenas as cestas dos tipos %j', async (...selectedKinds) => {
    const selected = selectedKinds.map((kind) => ({ ...items[kind === 'venda' ? 0 : kind === 'servico' ? 1 : 2]!, kind: kind as EconItem['kind'] }));
    setup(selected);
    await screen.findByLabelText('Custos da negociação');
    const totals = screen.getByLabelText('Custos totais por cesta');
    expect(within(totals).getAllByRole('term')).toHaveLength(new Set(selectedKinds.map((k) => k === 'venda' ? 'fornecimento' : k === 'servico' ? 'instalacao' : 'implantacao')).size);
  });

  it('preserva custos de um perfil removido e permite revisá-los sob demanda', async () => {
    const requests = setup([items[2]!]);
    await screen.findByLabelText('Custos da negociação');
    expect(screen.queryByRole('heading', { name: 'Investimentos de fornecimento' })).toBeNull();
    expect(screen.getByText(/Há custos preservados de tipos sem produtos/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar viabilidade econômica' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.capex.map((c) => c.unitCents)).toEqual([90000, 100000, 120000]);
  });

  it('trocar o perfil dos produtos atualiza a cesta mesmo com cálculo salvo anterior', async () => {
    const previousArgs = { input, items: [items[0]!], settings, publicSector: false };
    const previous = { ...financeEngine(previousArgs), b2g: b2gFromEconomics(previousArgs) };
    setup([items[2]!], previous, true);
    await screen.findByLabelText('Custos da negociação');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar Preço sugerido por produto' }));
    const basket = screen.getByRole('region', { name: 'Cesta Serviço Fornecimento + Instalação' });
    expect(within(basket).getByText('Link')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Cesta Fornecimento' })).toBeNull();
  });

  it('recomenda o alvo das configurações, permite editar a margem e bloqueia fora da faixa', async () => {
    const requests = setup();
    await screen.findByRole('button', { name: 'Mostrar A venda' });
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar A venda' }));
    const sale = screen.getByRole('region', { name: 'A venda' });
    const target = within(sale).getByLabelText('Margem líquida esperada (%)') as HTMLInputElement;
    expect(target.disabled).toBe(false);
    expect(target.value).toBe('20');
    expect(within(sale).queryByLabelText('Margem de contribuição (%)')).toBeNull();
    fireEvent.change(target, { target: { value: '30' } });
    expect((screen.getByLabelText('Margem líquida esperada (%)', { selector: '#b2g-nt' }) as HTMLInputElement).value).toBe('30');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar viabilidade econômica' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.b2g!.netTargetBp).toBe(3000);
    fireEvent.change(target, { target: { value: '8' } });
    expect((screen.getByRole('button', { name: 'Salvar viabilidade econômica' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(target, { target: { value: '42' } });
    expect((screen.getByRole('button', { name: 'Salvar viabilidade econômica' }) as HTMLButtonElement).disabled).toBe(true);

  });

});
