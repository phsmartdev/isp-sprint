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

  it('reordena os custos, preserva campos recolhidos e mantém salvar e cálculo avançado', async () => {
    const requests = setup();
    const supply = await screen.findByRole('heading', { name: 'Investimentos de fornecimento' });
    const implantation = screen.getByRole('heading', { name: 'Serviço Fornecimento + Instalação' });
    const monthly = screen.getByRole('heading', { name: 'Custos mensais para manter o serviço' });
    const sale = screen.getByRole('heading', { name: 'A venda' });
    expect(supply.compareDocumentPosition(implantation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(implantation.compareDocumentPosition(monthly) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(monthly.compareDocumentPosition(sale) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Base dos indicadores')).toBeNull();
    const section = supply.closest('section')!;
    expect(within(section).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'Adicionar outro' }));
    const description = within(section).getByLabelText('Custo direto do Fornecimento (venda pura): descrição 2');
    fireEvent.change(description, { target: { value: 'Cabo adicional' } });
    fireEvent.change(within(section).getByLabelText('Custo direto do Fornecimento (venda pura): valor 2'), { target: { value: '50,00' } });
    fireEvent.change(within(section).getByLabelText('Custo direto do Fornecimento (venda pura): impacta o quê 2'), { target: { value: 'material' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Recolher Custo direto do Fornecimento (venda pura)' }));
    expect(within(section).queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar A venda' }));
    fireEvent.change(screen.getByLabelText('Vigência (meses)'), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Recolher A venda' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar viabilidade econômica' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.termMonths).toBe(24);
    expect(requests[0]!.capex.find((c) => c.description === 'Cabo adicional')).toMatchObject({ unitCents: 5000, kind: 'venda', impact: 'material' });
    expect(requests[0]!.capex.find((c) => c.description === 'Equipamento')!.unitCents).toBe(90000);
    fireEvent.click(screen.getByRole('button', { name: 'Ver fluxo de caixa e cálculo básico' }));
    const basic = screen.getByLabelText('Fluxo de caixa e cálculo básico');
    fireEvent.click(within(basic).getByRole('button', { name: 'Ver cálculo avançado' }));
    expect(screen.getByRole('dialog', { name: 'Cálculo avançado' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(within(section).getByRole('button', { name: 'Mostrar Custo direto do Fornecimento (venda pura)' }));
    expect((within(section).getByLabelText('Custo direto do Fornecimento (venda pura): descrição 2') as HTMLInputElement).value).toBe('Cabo adicional');
  });

  it('permite importar e colar com a listagem recolhida e abre os itens incluídos', async () => {
    setup();
    const heading = await screen.findByRole('heading', { name: 'Investimentos de fornecimento' });
    const section = heading.closest('section')!;
    const file = new File([''], 'custos.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => 'Descrição;Unidade;Quantidade;Valor unitário;Impacta o quê?\nCabo CSV;un;2;10,00;Material/Equipamento' });
    fireEvent.change(within(section).getByLabelText('Importar planilha: Custo direto do Fornecimento (venda pura)'), { target: { files: [file] } });
    await waitFor(() => expect(within(section).getByDisplayValue('Cabo CSV')).toBeTruthy());
    expect(within(section).getByRole('button', { name: 'Recolher Custo direto do Fornecimento (venda pura)' })).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Recolher Custo direto do Fornecimento (venda pura)' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Colar do Excel' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Itens colados'), { target: { value: 'Descrição\tUnidade\tQuantidade\tValor unitário\nCabo colado\tun\t3\t20,00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Incluir itens' }));
    await waitFor(() => expect(within(section).getByDisplayValue('Cabo colado')).toBeTruthy());
    expect(within(section).getByDisplayValue('Cabo CSV')).toBeTruthy();
  });
  it.each([
    ['venda'], ['servico'], ['recorrencia'], ['locacao'], ['recorrencia', 'locacao'],
    ['venda', 'servico'], ['venda', 'recorrencia'], ['servico', 'recorrencia'],
    ['venda', 'servico', 'recorrencia'],
  ])('mostra apenas as cestas dos tipos %j', async (...selectedKinds) => {
    const selected = selectedKinds.map((kind) => ({ ...items[kind === 'venda' ? 0 : kind === 'servico' ? 1 : 2]!, kind: kind as EconItem['kind'] }));
    setup(selected);
    await screen.findByRole('heading', { name: 'A venda' });
    await waitFor(() => {
      expect(!!screen.queryByRole('heading', { name: 'Investimentos de fornecimento' })).toBe(selectedKinds.includes('venda'));
      expect(!!screen.queryByRole('heading', { name: 'Serviço de Instalação (Sem recorrência)' })).toBe(selectedKinds.includes('servico'));
      expect(!!screen.queryByRole('heading', { name: 'Serviço Fornecimento + Instalação' })).toBe(selectedKinds.includes('recorrencia') || selectedKinds.includes('locacao'));
    });
    const totals = screen.getByLabelText('Custos totais por cesta');
    expect(within(totals).getAllByRole('term')).toHaveLength(new Set(selectedKinds.map((k) => k === 'venda' ? 'fornecimento' : k === 'servico' ? 'instalacao' : 'implantacao')).size);
    expect(!!screen.queryByRole('heading', { name: 'Custos mensais para manter o serviço' })).toBe(selectedKinds.includes('recorrencia') || selectedKinds.includes('locacao'));
  });

  it('preserva custos de um perfil removido e permite revisá-los sob demanda', async () => {
    const requests = setup([items[2]!]);
    await screen.findByRole('heading', { name: 'Serviço Fornecimento + Instalação' });
    expect(screen.queryByRole('heading', { name: 'Investimentos de fornecimento' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar custos preservados' }));
    expect(screen.getByRole('heading', { name: 'Investimentos de fornecimento' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Recolher custos preservados' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar viabilidade econômica' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.capex.map((c) => c.unitCents)).toEqual([90000, 100000, 120000]);
  });

  it('trocar o perfil dos produtos atualiza a cesta mesmo com cálculo salvo anterior', async () => {
    const previousArgs = { input, items: [items[0]!], settings, publicSector: false };
    const previous = { ...financeEngine(previousArgs), b2g: b2gFromEconomics(previousArgs) };
    setup([items[2]!], previous, true);
    await screen.findByRole('heading', { name: 'Serviço Fornecimento + Instalação' });
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
