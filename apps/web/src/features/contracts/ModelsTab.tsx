/**
 * Gestão de Contratos → Modelos: os modelos de contrato e de proposta que se reaproveitam sempre que
 * um contrato é gerado (arte com campos ou Word com timbrado). Substitui a antiga aba de Habilitação.
 */
import { Tabs } from '../../components/ui/primitives';
import { useAuth } from '../../auth/AuthProvider';
import { useUrlState } from '../../lib/hooks';
import { AdminContractTemplates, AdminProposalTemplates } from '../../pages/admin/ProposalTemplates';
import { TemplatesManager } from './SignaturePanels';

type Kind = 'contratos' | 'propostas';

export function ModelsTab() {
  const { can, mod } = useAuth();
  // modelos com arte (contrato e proposta) usam o editor da Configuração; o Word fica com a gestão de contratos
  const admin = can('configuracoes', 'total');
  const tabs: { key: Kind; label: string }[] = [{ key: 'contratos', label: 'Modelos de contrato' }, ...(admin && mod('crm') ? [{ key: 'propostas' as const, label: 'Modelos de proposta' }] : [])];
  const [f, setF] = useUrlState({ m: 'contratos' });
  const kind: Kind = tabs.some((t) => t.key === f.m) ? (f.m as Kind) : 'contratos';
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink">Modelos de contratos e propostas</h2>
        <p className="max-w-3xl text-sm text-muted">Crie uma vez e reaproveite sempre: na ficha do contrato, “Gerar pelo modelo” preenche cliente, valores e vigência; na oportunidade, “Gerar proposta” usa os modelos de proposta.</p>
      </div>
      {tabs.length > 1 && <Tabs<Kind> label="Tipo de modelo" value={kind} onChange={(m) => setF({ m })} tabs={tabs} />}
      {kind === 'contratos' && <>{admin && <AdminContractTemplates />}<TemplatesManager /></>}
      {kind === 'propostas' && <AdminProposalTemplates />}
    </div>
  );
}
