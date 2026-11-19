import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../lib/api';
import { AdminViability } from './Viability';

vi.mock('../../lib/api', async (original) => ({ ...await original<typeof import('../../lib/api')>(), api: vi.fn() }));
vi.mock('../../components/ui/overlay', () => ({ useToast: () => vi.fn() }));
afterEach(cleanup);

it('edita a inferência de serviço e publica despesas fixas em zero, sem exibir o campo antigo', async () => {
  const current = {
    id: 'settings', validFrom: '2026-11-18', marginTargetBp: 0, marginSuggestedBp: 0, marginMaxBp: 9999,
    tmaAnnualBp: 1200, inflationAnnualBp: 0, badDebtBp: 0, commissionBp: 0,
    lossPrivateBp: 0, lossPublicBp: 0, contingencyCapexBp: 200, contingencyOpexBp: 500,
    overheadBp: 3500, incomeTaxBp: 1500, netMarginTargetBp: 2000, netMarginMinBp: 900,
    netMarginMaxBp: 4100, paybackMaxPrivate: 6, paybackMaxPublic: 12, horizonMaxMonths: 24,
  };
  const published: Record<string, unknown>[] = [];
  vi.mocked(api).mockImplementation(async (url, options) => {
    if (url === '/admin/cost-items') return { items: [], today: '2026-11-18' } as never;
    if (options?.method === 'POST') { published.push(options.body as Record<string, unknown>); return {} as never; }
    return { current, versions: [], today: '2026-11-18' } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  try {
    render(<MemoryRouter><QueryClientProvider client={client}><AdminViability /></QueryClientProvider></MemoryRouter>);
    const field = await screen.findByLabelText('Inferência custo de serviço');
    expect((field as HTMLInputElement).value).toBe('35');
    expect(screen.queryByLabelText('Despesas fixas rateadas')).toBeNull();
    fireEvent.change(field, { target: { value: '20,5' } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole('button', { name: 'Publicar parâmetros' }));
    await waitFor(() => expect(published).toHaveLength(1));
    expect(published[0]).toMatchObject({ serviceCostBp: 2050, overheadBp: 0, contingencyCapexBp: 200, netMarginTargetBp: 2000 });
  } finally { client.clear(); }
});
