import type { ContractConsumptionResult } from '@isp/domain';
import { Button, Notice } from '../../components/ui/primitives';
import { fmtBRL } from '../../lib/format';
import { BUSINESS_LABELS } from './productNegotiation';

export function ConsumptionTotals({ result, kind }: { result: ContractConsumptionResult; kind?: keyof typeof BUSINESS_LABELS }) {
  const totals = kind ? result.totals.filter((total) => total.kind === kind) : result.totals;
  if (!totals.length) return null;
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm" aria-label={kind ? 'Resumo ' + BUSINESS_LABELS[kind] : 'Resumo do consumo'}>
    <thead className="bg-surface-2 text-xs text-muted"><tr>{['Tipo de negócio', 'Valor contratual', 'Percentual aplicado', 'Inferência custo de serviço'].map((heading) => <th key={heading} scope="col" className="px-4 py-2">{heading}</th>)}</tr></thead>
    <tbody>{totals.map((total) => {
      const suffix = total.frequency === 'mensal' ? '/mês' : ' (único)';
      const rate = total.kind === 'venda' ? 'Repasse' : total.kind && result.rateBp != null ? `${(result.rateBp / 100).toLocaleString('pt-BR')}%` : '—';
      return <tr key={`${total.kind}:${total.frequency}`} className="border-t border-line">
        <td className="px-4 py-2">{total.kind ? BUSINESS_LABELS[total.kind] : 'Tipo a definir'}</td>
        <td className="num px-4 py-2">{fmtBRL(total.contractCents) + suffix}</td>
        <td className="px-4 py-2">{rate}</td>
        <td className="num px-4 py-2">{total.inferenceCents == null ? 'Indisponível' : fmtBRL(total.inferenceCents) + suffix}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export function ContractConsumptionPanel({ saved, preview, hidden, onProducts }: { saved?: ContractConsumptionResult | null; preview?: ContractConsumptionResult; hidden: boolean; onProducts?: () => void }) {
  const changed = saved && preview && saved.rateBp !== preview.rateBp;
  const result = preview?.rateBp == null ? preview ?? saved : saved ?? preview;
  return <section className="card space-y-3 p-4" aria-label="Viabilidade do consumo de contrato">
    <h2 className="text-md font-bold text-ink">Consumo de contrato</h2>
    {hidden ? <Notice tone="info">Seu perfil não tem acesso à inferência de custo de serviço.</Notice> : <>
      {changed && <Notice tone="warning">A inferência salva usa parâmetros anteriores. Abra Produtos e salve novamente para atualizar.</Notice>}
      {preview?.rateBp == null && <Notice tone="warning">Configure os parâmetros vigentes em Configurações → Viabilidade para obter a inferência.</Notice>}
      {!saved && <p className="text-sm text-muted">Confira os valores tabelados e salve na aba Produtos.</p>}
      {result && <ConsumptionTotals result={result} />}
      {onProducts && <Button size="sm" onClick={onProducts}>Abrir Produtos</Button>}
    </>}
  </section>;
}
