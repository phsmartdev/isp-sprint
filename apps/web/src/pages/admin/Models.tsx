/**
 * Configurações → Modelos: um lugar só para os modelos usados no dia a dia —
 * contratos, propostas, timbrado das filiais, e-mails, instrução do negócio e roteiros dos tipos de tarefa.
 */
import { useSearchParams } from 'react-router-dom';
import { Tabs } from '../../components/ui/primitives';
import { AdminContractTemplates, AdminProposalTemplates } from './ProposalTemplates';
import { AdminEmail } from './Email';
import { AdminInstructions } from './Instructions';
import { AdminTaskScripts } from './TaskScripts';
import { AdminLetterheads } from './Letterheads';

const TABS = [
  { key: 'contratos', label: 'Contratos' },
  { key: 'propostas', label: 'Propostas' },
  { key: 'timbrado', label: 'Timbrado das filiais' },
  { key: 'emails', label: 'E-mails' },
  { key: 'instrucao', label: 'Instrução' },
  { key: 'tarefas', label: 'Tipos de tarefa' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function AdminModels() {
  const [search, setSearch] = useSearchParams();
  const raw = search.get('aba');
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : 'contratos';
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-bold text-ink">Modelos</h1><p className="text-sm text-muted">Contratos, propostas, timbrado das filiais, e-mails, a instrução do negócio e os roteiros de cada tipo de tarefa.</p></div>
      <Tabs label="Modelos" value={tab} onChange={(k) => setSearch({ aba: k }, { replace: true })} tabs={[...TABS]} />
      <div>
        {tab === 'contratos' && <AdminContractTemplates />}
        {tab === 'propostas' && <AdminProposalTemplates />}
        {tab === 'timbrado' && <AdminLetterheads />}
        {tab === 'emails' && <AdminEmail />}
        {tab === 'instrucao' && <AdminInstructions />}
        {tab === 'tarefas' && <AdminTaskScripts />}
      </div>
    </div>
  );
}
