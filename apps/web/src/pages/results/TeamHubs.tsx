/**
 * Gestão de Times em 4 telas: Painel, Metas e indicadores, Acompanhamento (rituais, intervenções, decisões)
 * e Pessoas (performance, gamificação, férias). As telas antigas viram abas e continuam com o mesmo conteúdo.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { CalendarCheck, Users } from 'lucide-react';
import { EmbeddedPage, PageHeader } from '../../components/layout/PageHeader';
import { Tabs } from '../../components/ui/primitives';
import { useAuth } from '../../auth/AuthProvider';
import { RitualsPage } from './Rituals';
import { InterventionsPage } from './Interventions';
import { DecisionsPage } from './Decisions';
import { PerformancePage } from './Performance';
import { GamificationPage } from './Gamification';
import { VacationsPage } from './Vacations';

type Tab = { key: string; label: string; el: ReactNode };

function Hub({ icon, title, subtitle, tabs }: { icon: ReactNode; title: string; subtitle: string; tabs: Tab[] }) {
  const [params, setParams] = useSearchParams();
  const cur = tabs.find((t) => t.key === params.get('aba')) ?? tabs[0]!;
  return (
    <div>
      <PageHeader icon={icon} title={title} subtitle={subtitle} />
      <Tabs label={title} className="mb-5" value={cur.key} onChange={(k) => setParams(k === tabs[0]!.key ? {} : { aba: k }, { replace: true })} tabs={tabs.map((t) => ({ key: t.key, label: t.label }))} />
      <EmbeddedPage.Provider value={true}><div key={cur.key}>{cur.el}</div></EmbeddedPage.Provider>
    </div>
  );
}

export function TeamTrackingPage() {
  return <Hub icon={<CalendarCheck />} title="Acompanhamento" subtitle="A rotina de gestão: reuniões do time, o que está fora da meta e as decisões e impedimentos."
    tabs={[{ key: 'rituais', label: 'Reuniões e rituais', el: <RitualsPage /> }, { key: 'intervencoes', label: 'Intervenções', el: <InterventionsPage /> }, { key: 'decisoes', label: 'Decisões e impedimentos', el: <DecisionsPage /> }]} />;
}

export function TeamPeoplePage() {
  const { can } = useAuth();
  const all = can('resultados');
  return <Hub icon={<Users />} title="Pessoas" subtitle="Performance de cada pessoa e time, regras de pontuação e férias."
    tabs={[{ key: 'performance', label: 'Performance', el: <PerformancePage /> }, ...(all ? [{ key: 'gamificacao', label: 'Pontuação e regras', el: <GamificationPage /> }, { key: 'ferias', label: 'Férias', el: <VacationsPage /> }] : [])]} />;
}

/** Endereços antigos continuam funcionando (links, favoritos, avisos): vão para a aba certa mantendo os filtros. */
export function GoTo({ to, aba }: { to: string; aba?: string }) {
  const loc = useLocation();
  const q = new URLSearchParams(loc.search);
  if (aba) q.set('aba', aba);
  const s = q.toString();
  return <Navigate replace to={`${to}${s ? `?${s}` : ''}${loc.hash}`} />;
}
