import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { emptyEconInput, type EconInput } from '@isp/domain';
import { DealProducts } from './DealProducts';
import { api } from '../../lib/api';
import type { Opportunity } from '../../lib/types';

vi.mock('../../lib/api', async (original) => ({ ...await original<typeof import('../../lib/api')>(), api: vi.fn() }));
vi.mock('../../lib/hooks', () => ({ useLookups: () => ({ data: { plans: [] } }) }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../components/ui/overlay', async (original) => ({ ...await original<typeof import('../../components/ui/overlay')>(), useToast: () => toast }));
vi.mock('./DeliveryAddresses', () => ({ NewDeliveryAddressModal: () => null, addressLine: () => 'Endereço' }));
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach((c) => c.clear()); vi.mocked(api).mockReset(); toast.mockReset(); });
const kinds = ['venda', 'servico', 'recorrencia', 'locacao'] as const;
const initial: EconInput = { ...emptyEconInput(), paybackMonths: 6, b2g: { netTargetBp: 3000 }, capex: kinds.map((kind) => ({ description: 'Investimento ' + kind, qtyMilli: 1000, unitCents: 800000, kind, impact: 'material' })), opex: [{ description: 'Operação recorrente', qtyMilli: 1000, unitCents: 10000, kind: 'recorrencia', impact: 'operacional' }] };
function setup(hidden = false, onlyMonthly = false, bid = false, consumption = false, hasSettings = true) {
  const requests: { items: { dealKind: string; priceDefined: boolean; unitCents: number }[]; economics?: EconInput; bidMode?: string; bidGlobalCents?: number }[] = [];
  const selected = onlyMonthly ? kinds.filter((k) => k === 'recorrencia') : kinds;
  const items = selected.map((dealKind, position) => ({ id: String(position), description: 'Produto ' + dealKind, unit: 'un', qtyMilli: 1000, unitCents: 0, priceDefined: false, discountCents: 0, surchargeCents: 0, notes: null, bidUnitCents: null, fiscalDocTypeId: 'doc', dealKind }));
  const input = { ...initial, capex: initial.capex.filter((c) => selected.includes(c.kind as never)) };
  const settings = { marginTargetBp: 0, tmaMonthlyBp: 10, commissionBp: 0, lossPrivateBp: 100, lossPublicBp: 100, badDebtBp: 100, contingencyCapexBp: 200, contingencyOpexBp: 500, overheadBp: 0, incomeTaxBp: 757, paybackMaxPrivate: 6, paybackMaxPublic: 12, blockOutsidePolicy: true, netMarginTargetBp: 2000, netMarginMinBp: 900, netMarginMaxBp: 9900 };
  vi.mocked(api).mockImplementation(async (url, options) => {
    if (options?.method === 'PUT') { requests.push(options.body as never); return { id: 'opp', rowVersion: 2 } as never; }
    if (url.endsWith('/items')) return { items, editable: true, rowVersion: 1, bid } as never;
    if (url.endsWith('/economics')) return { consumption, input: hidden ? null : input, editable: !hidden, financeHidden: hidden, settings: hidden || !hasSettings ? null : settings, publicSector: false } as never;
    if (url === '/fiscal-docs') return { items: [{ id: 'doc', branchId: 'branch', fiscalKind: 'servico', code: 'NFS-E', name: 'Serviço', rates: { percentBp: 1000, fixedCents: 0, complete: true } }] } as never;
    return { items: [] } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><DealProducts opp={{ id: 'opp', branchId: 'branch', saleKind: consumption ? 'consumo_contrato' : 'venda_consultiva' } as Opportunity} /></QueryClientProvider>);
  return requests;
}
describe('produtos e custos por tipo de negócio', () => {
  it('usa o valor importado na inferência do consumo e permite salvar sem parâmetros', async () => {
    const requests = setup(false, true, false, true, false);
    const recurrence = await screen.findByRole('region', { name: 'Negociação Recorrência' });
    const actions = within(recurrence).getByRole('group', { name: 'Ações de itens para consumo do contrato' });
    const file = Object.assign(new File([], 'contrato.csv'), { text: async () => 'Descrição;Quantidade;Valor unitário contratado\nLink contratado;5;100,00' });
    fireEvent.change(within(actions).getByLabelText('Importar itens de consumo de Recorrência'), { target: { files: [file] } });
    await within(recurrence).findByDisplayValue('Link contratado');
    const summary = within(recurrence).getByRole('table', { name: 'Resumo Recorrência' });
    expect(within(summary).getAllByText('Indisponível')).toHaveLength(2);
    expect(within(recurrence).queryByText('Preço sugerido da cesta')).toBeNull();
    expect(within(recurrence).getByLabelText('Valor unitário contratado 3')).toHaveProperty('value', '100,00');
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar produtos e consumo' })[0]!);
    await waitFor(() => expect(requests[0]?.economics?.opex).toContainEqual(expect.objectContaining({ description: 'Link contratado', kind: 'recorrencia', qtyMilli: 5000, unitCents: 10000 })));
  });
  it('mantém as ações de produtos e custos em grupos separados', async () => {
    const requests = setup(false, true);
    const recurrence = await screen.findByRole('region', { name: 'Negociação Recorrência' });
    const productActions = within(recurrence).getByRole('group', { name: 'Ações dos produtos da proposta' });
    const costActions = within(recurrence).getByRole('group', { name: 'Ações de custos da negociação' });
    expect(within(productActions).getByRole('button', { name: 'Colar produtos do Excel' })).toBeTruthy();
    expect(within(productActions).getByLabelText('Importar produtos de Recorrência')).toBeTruthy();
    expect(within(costActions).getByRole('button', { name: 'Adicionar custo' })).toBeTruthy();
    expect(within(recurrence).getByRole('button', { name: 'Colar custos do Excel' })).toBeTruthy();
    const costImport = within(costActions).getByLabelText('Importar custos de Recorrência');
    const file = Object.assign(new File([], 'custos.csv'), { text: async () => 'Descrição;Quantidade;Valor unitário\nCabo importado;2;15,00' });
    fireEvent.change(costImport, { target: { files: [file] } });
    await within(recurrence).findByDisplayValue('Cabo importado');
    fireEvent.click(within(productActions).getByRole('button', { name: 'Adicionar produto ou serviço' }));
    fireEvent.change(within(recurrence).getByLabelText('Produto ou serviço 1.2'), { target: { value: 'Produto adicionado' } });
    fireEvent.change(within(recurrence).getByLabelText('Valor unitário do custo 1'), { target: { value: '200,00' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar produtos e custos' })[0]!);
    await waitFor(() => expect(requests[0]?.economics?.capex[0]?.unitCents).toBe(20000));
    expect(requests[0]?.economics?.capex).toContainEqual(expect.objectContaining({ description: 'Cabo importado', unitCents: 1500 }));
    expect(requests[0]?.items).toHaveLength(2);
  });
  it('separa Instalação, Venda, Aluguel e Recorrência; Quando distingue único e mensal', async () => {
    setup();
    const installation = await screen.findByRole('region', { name: 'Negociação Instalação' });
    expect(screen.getAllByRole('radiogroup', { name: /Tipo de negócio/ })).toHaveLength(4);
    expect(within(installation).getByRole('radio', { name: 'Instalação' }).getAttribute('aria-checked')).toBe('true');
    expect((within(installation).getByLabelText('Quando do custo 1') as HTMLSelectElement).disabled).toBe(true);
    const recurrence = screen.getByRole('region', { name: 'Negociação Recorrência' });
    expect((within(recurrence).getByLabelText('Quando do custo 1') as HTMLSelectElement).value).toBe('unico');
    expect((within(recurrence).getByLabelText('Quando do custo 2') as HTMLSelectElement).value).toBe('mensal');
    expect(within(recurrence).getByRole('columnheader', { name: 'Quando' })).toBeTruthy();
    expect(within(recurrence).queryByRole('columnheader', { name: 'Perfil de custo' })).toBeNull();
  });
  it('salva produtos e custos juntos e preserva margem, payback e ausência de valores', async () => {
    const requests = setup();
    const recurrence = await screen.findByRole('region', { name: 'Negociação Recorrência' });
    fireEvent.change(within(recurrence).getByLabelText('Quando do custo 1'), { target: { value: 'mensal' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar produtos e custos' })[0]!);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.economics!.capex.map((c) => c.kind)).not.toContain('recorrencia');
    expect(requests[0]!.economics!.opex.filter((c) => c.kind === 'recorrencia')).toHaveLength(2);
    expect(requests[0]!.economics).toMatchObject({ paybackMonths: 6, b2g: { netTargetBp: 3000 } });
    expect(requests[0]!.items.every((i) => !i.priceDefined && i.unitCents === 0)).toBe(true);
    expect(requests[0]!.items.map((i) => i.dealKind)).toEqual(kinds);
  });
  it('cola custos únicos e mensais na mesma negociação sem reclassificar produtos', async () => {
    const requests = setup();
    const recurrence = await screen.findByRole('region', { name: 'Negociação Recorrência' });
    fireEvent.click(within(recurrence).getByRole('button', { name: 'Colar custos do Excel' }));
    fireEvent.change(screen.getByLabelText('Custos colados'), { target: { value: 'Descrição\tQuantidade\tValor unitário\tFrequência\nCabo colado\t2\t20,00\tÚnico\nLink terceiro\t1\t50,00\tMensal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Incluir custos' }));
    await screen.findByDisplayValue('Link terceiro');
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar produtos e custos' })[0]!);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.economics!.capex.find((c) => c.description === 'Cabo colado')).toMatchObject({ kind: 'recorrencia', qtyMilli: 2000, unitCents: 2000 });
    expect(requests[0]!.economics!.opex.find((c) => c.description === 'Link terceiro')).toMatchObject({ kind: 'recorrencia', unitCents: 5000 });
  });
  it('não transforma custo mensal em único ao trocar o tipo sem ajuste explícito', async () => {
    setup(false, true);
    const recurrence = await screen.findByRole('region', { name: 'Negociação Recorrência' });
    fireEvent.click(within(recurrence).getByRole('radio', { name: 'Instalação' }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error', message: expect.stringContaining('coluna Quando') }));
    expect(screen.queryByRole('region', { name: 'Negociação Instalação' })).toBeNull();
    fireEvent.change(within(recurrence).getByLabelText('Quando do custo 2'), { target: { value: 'unico' } });
    fireEvent.click(within(recurrence).getByRole('radio', { name: 'Instalação' }));
    expect(screen.getByRole('region', { name: 'Negociação Instalação' })).toBeTruthy();
  });
  it('sem permissão financeira mantém produtos sem consultar ou sobrescrever custos', async () => {
    const requests = setup(true);
    const sale = await screen.findByRole('region', { name: 'Negociação Venda' });
    expect(screen.queryByText('Custos da negociação')).toBeNull();
    expect(vi.mocked(api).mock.calls.some(([url]) => url === '/cost-items')).toBe(false);
    fireEvent.change(within(sale).getByDisplayValue('Produto venda'), { target: { value: 'Produto corrigido' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar produtos e custos' })[0]!);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.economics).toBeUndefined();
  });
  it('move um produto para outro tipo mantendo os custos em sua cesta de origem', async () => {
    const requests = setup();
    const sale = await screen.findByRole('region', { name: 'Negociação Venda' });
    fireEvent.click(within(sale).getByRole('button', { name: 'Editar valores' }));
    fireEvent.change(screen.getByLabelText('Tipo de negócio de Produto venda'), { target: { value: 'servico' } });
    expect(within(screen.getByRole('region', { name: 'Negociação Instalação' })).getByDisplayValue('Produto venda')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar produtos e custos' })[0]!);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.items.filter((i) => i.dealKind === 'servico')).toHaveLength(2);
    expect(requests[0]!.economics!.capex.find((c) => c.description === 'Investimento venda')!.kind).toBe('venda');
  });

  it('mantém lances globais e permite recolher os valores na licitação', async () => {
    const requests = setup(false, false, true);
    const sale = await screen.findByRole('region', { name: 'Negociação Venda' });
    expect(within(sale).getByLabelText('Valor Produto venda')).toBeTruthy();
    fireEvent.click(within(sale).getByRole('button', { name: 'Ocultar valores' }));
    expect(within(sale).queryByLabelText('Valor Produto venda')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Global' }));
    fireEvent.change(screen.getByLabelText('Lance global'), { target: { value: '2000,00' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar produtos e custos' })[0]!);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ bidMode: 'global', bidGlobalCents: 200000 });
  });

});
