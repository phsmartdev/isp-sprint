/**
 * Configurações → Modelos: um lugar só para os modelos usados no dia a dia —
 * contratos, propostas, timbrado das filiais, e-mails, instrução do negócio e roteiros dos tipos de tarefa.
 */
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '../../components/ui/primitives';
import { AdminContractTemplates, AdminProposalTemplates } from './ProposalTemplates';
import { TemplatesManager } from '../../features/contracts/SignaturePanels';
import { AdminEmail } from './Email';
import { AdminInstructions } from './Instructions';
import { AdminTaskScripts } from './TaskScripts';
import { AdminLetterheads } from './Letterheads';
import { AdminOffices } from '../../features/offices/AdminOffices';
import { StructuresAdmin } from '../../features/accounts/Structures';

const TABS = [
  { key: 'contratos', label: 'Contratos' },
  { key: 'propostas', label: 'Propostas' },
  { key: 'oficios', label: 'Ofícios' },
  { key: 'timbrado', label: 'Timbrado das filiais' },
  { key: 'emails', label: 'E-mails' },
  { key: 'instrucao', label: 'Instrução' },
  { key: 'tarefas', label: 'Tipos de tarefa' },
  { key: 'estruturas', label: 'Estruturas' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function AdminModels() {
  const [search, setSearch] = useSearchParams();
  const raw = search.get('aba');
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : 'contratos';
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-ink">Modelos</h1><p className="text-sm text-muted">Contratos, propostas, ofícios, timbrado das filiais, e-mails, a instrução do negócio e os roteiros de cada tipo de tarefa.</p></div>
      <Tabs label="Modelos" value={tab} onChange={(k) => setSearch({ aba: k }, { replace: true })} tabs={[...TABS]} />
      <div>
        {tab === 'contratos' && <div className="space-y-6"><AdminContractTemplates /><TemplatesManager /></div>}
        {tab === 'propostas' && <AdminProposalTemplates />}
        {tab === 'oficios' && <AdminOffices />}
        {tab === 'timbrado' && <AdminLetterheads />}
        {tab === 'emails' && <AdminEmail />}
        {tab === 'instrucao' && <AdminInstructions />}
        {tab === 'tarefas' && <AdminTaskScripts />}
        {tab === 'estruturas' && <StructuresAdmin />}
      </div>
    </div>
  );
}
