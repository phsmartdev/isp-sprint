import { EmailPage, MailboxesPage } from './pages/email/Email';
import { AbmPage } from './pages/marketing/Abm';
import { Abm360Page } from './pages/marketing/Abm360';
import { ProductPage } from './pages/product/Product';
import { ResultsPage } from './pages/results/Results';
import { InterventionsPage } from './pages/results/Interventions';
import { AnalysisPage } from './pages/results/Analysis';
import { RitualsPage } from './pages/results/Rituals';
import { MeetingPage } from './pages/results/Meeting';
import { DecisionsPage } from './pages/results/Decisions';
import { GoalsPage } from './pages/performance/Goals';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SettingsLayout } from './features/settings/SettingsLayout';
import { lazy, Suspense, type ReactNode } from 'react';
import type { FeatureKey, Module } from '@isp/domain';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './components/layout/AppShell';
import { EmptyState, LoadingRows } from './components/ui/primitives';
import { LoginPage, ResetPasswordPage } from './pages/Login';
import { useMoneyHidden } from './lib/privacy';
import { ApprovalPage } from './pages/Approval';
import { ApprovalsPage } from './pages/Approvals';
import { HomePage } from './pages/Home';
import { LeadsPage } from './pages/Leads';
import { OpportunitiesPage } from './pages/Opportunities';
import { NewOpportunityPage, OpportunityWorkspacePage } from './pages/OpportunityWorkspace';
import { BudgetPlanningPage } from './pages/budget/Planning';
import { BudgetAssetsPage, BudgetContractsPage, BudgetPurchasesPage, BudgetSoftwarePage } from './pages/budget/Resources';
import { BudgetIndicatorsPage } from './pages/budget/Indicators';
import { CustomersPage } from './pages/Customers';
import { CustomerDetailPage } from './pages/CustomerDetail';
import { ActivitiesPage } from './pages/Activities';
import { ProjectsPage } from './pages/projects/Projects';
import { TasksPage } from './pages/tasks/Tasks';
import { ProjectDetailPage } from './pages/projects/ProjectDetail';
import { ReportsPage } from './pages/Reports';
import { IntelligencePage } from './pages/Intelligence';
import { CampaignDetailPage, CampaignsPage } from './pages/Campaigns';
import { ContractsPage } from './pages/contracts/Contracts';
import { ContractDetailPage } from './pages/contracts/ContractDetail';
import { NewContractPage } from './pages/contracts/NewContract';
import { ArpDetailPage } from './pages/contracts/ArpDetail';
import { CustomerSuccessPage } from './pages/cs/CustomerSuccess';
import { JourneyPage, KickoffPrintPage, PublicKickoffPage } from './pages/cs/Journey';
import { PublicJourneyPage } from './pages/cs/JourneyTrailTab';
import { PublicSurveyPage, SurveyPage } from './pages/cs/Surveys';
import { KpiBoardPage } from './pages/KpiBoardPage';

// Configurações carregam sob demanda: o código de cada tela só baixa quando ela é aberta
const AdminModules = lazy(() => import('./pages/admin/Modules').then((m) => ({ default: m.AdminModules })));
const AdminSalesBranches = lazy(() => import('./pages/admin/SalesBranches').then((m) => ({ default: m.AdminSalesBranches })));
const AdminGmailSettings = lazy(() => import('./pages/admin/GmailSettings').then((m) => ({ default: m.AdminGmailSettings })));
const AdminResultsSettings = lazy(() => import('./pages/admin/ResultsSettings').then((m) => ({ default: m.AdminResultsSettings })));
const AdminAbmSettings = lazy(() => import('./pages/admin/AbmSettings').then((m) => ({ default: m.AdminAbmSettings })));
const AdminPerformanceSettings = lazy(() => import('./pages/admin/PerformanceSettings').then((m) => ({ default: m.AdminPerformanceSettings })));
const AdminApprovalSettings = lazy(() => import('./pages/admin/ApprovalSettings').then((m) => ({ default: m.AdminApprovalSettings })));
const AdminOverview = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.AdminOverview })));
const AdminUsers = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.AdminUsers })));
const AdminPlans = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.AdminPlans })));
const AdminSources = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.AdminSources })));
const AdminIntegrations = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.AdminIntegrations })));
const AdminSecurity = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.AdminSecurity })));
const AdminBranding = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.AdminBranding })));
const AdminLogs = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.AdminLogs })));
const AdminJourneys = lazy(() => import('./pages/admin/Journeys').then((m) => ({ default: m.AdminJourneys })));
const AdminArea = lazy(() => import('./pages/admin/Area').then((m) => ({ default: m.AdminArea })));
const AdminViability = lazy(() => import('./pages/admin/Viability').then((m) => ({ default: m.AdminViability })));
const AdminFinancialStudio = lazy(() => import('./pages/admin/FinancialStudio').then((m) => ({ default: m.AdminFinancialStudio })));
const AdminModels = lazy(() => import('./pages/admin/Models').then((m) => ({ default: m.AdminModels })));
const AdminData = lazy(() => import('./pages/admin/DataAdmin').then((m) => ({ default: m.AdminData })));
const AdminCustomFields = lazy(() => import('./pages/admin/CustomFields').then((m) => ({ default: m.AdminCustomFields })));
const ProfilePage = lazy(() => import('./pages/admin/Profile').then((m) => ({ default: m.ProfilePage })));
const AdminCsSettings = lazy(() => import('./pages/admin/CsSettings').then((m) => ({ default: m.AdminCsSettings })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <LoadingRows />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/** Rota protegida pelo nível do módulo; a API também recusa. */
function Gate({ module, min, feature, children }: { module: Module; min?: 'proprio' | 'equipe' | 'total'; feature?: FeatureKey; children: ReactNode }) {
  const { can, feature: on } = useAuth();
  if (feature && !on(feature)) return <div className="card"><EmptyState title="Módulo não liberado" description="Esta área faz parte de um módulo que ainda não foi liberado para você. Fale com a gerência se precisar." /></div>;
  if (!can(module, min)) return <div className="card"><EmptyState title="Sem acesso a este módulo" description="Seu perfil não tem acesso a esta área. Fale com a gerência se precisar." /></div>;
  return <>{children}</>;
}

export function App() {
  // olhinho dos valores: redesenha as telas ao ocultar/mostrar (sem perder o estado)
  useMoneyHidden();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/k/:token" element={<PublicKickoffPage />} />
      <Route path="/j/:token" element={<PublicJourneyPage />} />
      <Route path="/p/:token" element={<PublicSurveyPage />} />
      <Route path="/kickoff/:id/pdf" element={<Gate module="clientes"><KickoffPrintPage /></Gate>} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
      <Route path="/painel/indicadores" element={<RequireAuth><Gate module="inteligencia"><KpiBoardPage /></Gate></RequireAuth>} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Gate module="inicio"><HomePage /></Gate>} />
        <Route path="leads" element={<Gate module="leads"><LeadsPage /></Gate>} />
        <Route path="opportunities" element={<Gate module="oportunidades"><OpportunitiesPage /></Gate>} />
        <Route path="pipeline" element={<Navigate to="/opportunities" replace />} />
        <Route path="opportunities/new" element={<Gate module="oportunidades"><NewOpportunityPage /></Gate>} />
        <Route path="opportunities/:id" element={<Gate module="oportunidades"><OpportunityWorkspacePage /></Gate>} />
        <Route path="opportunities/:id/aprovacao" element={<ApprovalPage />} />
        <Route path="aprovacoes" element={<ApprovalsPage />} />
        <Route path="customers" element={<Gate module="clientes" feature="crm.contas"><CustomersPage /></Gate>} />
        <Route path="customers/:id" element={<Gate module="clientes"><CustomerDetailPage /></Gate>} />
        <Route path="sucesso" element={<Gate module="clientes" feature="crm.sucesso_cliente"><CustomerSuccessPage /></Gate>} />
        <Route path="sucesso/jornadas/:id" element={<Gate module="clientes" feature="crm.sucesso_cliente"><JourneyPage /></Gate>} />
        <Route path="sucesso/pesquisas/:id" element={<Gate module="clientes" feature="crm.sucesso_cliente"><SurveyPage /></Gate>} />
        <Route path="activities" element={<Gate module="atividades" feature="crm.atividades"><ActivitiesPage /></Gate>} />
        <Route path="tarefas" element={<Gate module="atividades" feature="projetos.tarefas"><TasksPage /></Gate>} />
        <Route path="projetos" element={<Gate module="projetos"><ProjectsPage /></Gate>} />
        <Route path="desempenho/metas" element={<Gate module="desempenho"><GoalsPage /></Gate>} />
        <Route path="times" element={<Gate module="resultados"><ResultsPage /></Gate>} />
        <Route path="times/intervencoes" element={<Gate module="resultados"><InterventionsPage /></Gate>} />
        <Route path="times/intervencoes/:id/analise" element={<Gate module="resultados"><AnalysisPage /></Gate>} />
        <Route path="times/rituais" element={<Gate module="resultados"><RitualsPage /></Gate>} />
        <Route path="times/rituais/reunioes/:id" element={<Gate module="resultados"><MeetingPage /></Gate>} />
        <Route path="times/decisoes" element={<Gate module="resultados"><DecisionsPage /></Gate>} />
        <Route path="resultados" element={<Navigate to="/times" replace />} />
        <Route path="email" element={<Gate module="email"><EmailPage /></Gate>} />
        <Route path="email/caixas" element={<Gate module="email"><MailboxesPage /></Gate>} />
        <Route path="abm" element={<Gate module="clientes" feature="marketing.abm"><AbmPage /></Gate>} />
        <Route path="abm/contas/:id" element={<Gate module="clientes" feature="marketing.abm"><Abm360Page /></Gate>} />
        <Route path="produto" element={<Gate module="inicio" feature="produto.catalogo"><ProductPage /></Gate>} />
        <Route path="projetos/:id" element={<Gate module="projetos"><ProjectDetailPage /></Gate>} />
        <Route path="reports" element={<Gate module="relatorios" feature="relatorios.comercial"><ReportsPage /></Gate>} />
        <Route path="intelligence" element={<Gate module="inteligencia"><IntelligencePage /></Gate>} />
        <Route path="campaigns" element={<Gate module="campanhas"><CampaignsPage /></Gate>} />
        <Route path="campaigns/:id" element={<Gate module="campanhas"><CampaignDetailPage /></Gate>} />
        <Route path="contracts" element={<Gate module="contratos"><ContractsPage /></Gate>} />
        <Route path="orcamento" element={<Gate module="orcamento" feature="orcamento.planejamento"><BudgetPlanningPage /></Gate>} />
        <Route path="orcamento/ferramentas" element={<Gate module="orcamento" feature="orcamento.recursos"><BudgetAssetsPage /></Gate>} />
        <Route path="orcamento/softwares" element={<Gate module="orcamento" feature="orcamento.recursos"><BudgetSoftwarePage /></Gate>} />
        <Route path="orcamento/contratos" element={<Gate module="orcamento" feature="orcamento.recursos"><BudgetContractsPage /></Gate>} />
        <Route path="orcamento/compras" element={<Gate module="orcamento" feature="orcamento.recursos"><BudgetPurchasesPage /></Gate>} />
        <Route path="orcamento/indicadores" element={<Gate module="orcamento" feature="orcamento.planejamento"><BudgetIndicatorsPage /></Gate>} />
        <Route path="contracts/new" element={<Gate module="contratos"><NewContractPage /></Gate>} />
        <Route path="contracts/atas/:id" element={<Gate module="contratos" feature="contratos.atas"><ArpDetailPage /></Gate>} />
        <Route path="contracts/:id" element={<Gate module="contratos"><ContractDetailPage /></Gate>} />
        <Route path="settings/profile" element={<Suspense fallback={<div className="card"><LoadingRows rows={6} /></div>}><ProfilePage /></Suspense>} />
        <Route path="settings" element={<Gate module="configuracoes" min="total"><SettingsLayout /></Gate>}>
          <Route index element={<AdminOverview />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="plans" element={<AdminPlans />} />
          <Route path="journeys" element={<AdminJourneys />} />
          <Route path="stages" element={<Navigate to="/settings/journeys" replace />} />
          <Route path="area" element={<AdminArea />} />
          <Route path="viability" element={<AdminViability />} />
          <Route path="financial-studio" element={<AdminFinancialStudio />} />
          <Route path="modelos" element={<AdminModels />} />
          <Route path="instructions" element={<Navigate to="/settings/modelos?aba=instrucao" replace />} />
          <Route path="email" element={<Navigate to="/settings/modelos?aba=emails" replace />} />
          <Route path="data" element={<AdminData />} />
          <Route path="fields" element={<AdminCustomFields />} />
          <Route path="contracts" element={<Navigate to="/settings/modulos?cfg=contratos" replace />} />
          <Route path="approvals" element={<AdminApprovalSettings />} />
          <Route path="customer-success" element={<AdminCsSettings />} />
          <Route path="desempenho" element={<AdminPerformanceSettings />} />
          <Route path="resultados" element={<AdminResultsSettings />} />
          <Route path="abm" element={<AdminAbmSettings />} />
          <Route path="gmail" element={<AdminGmailSettings />} />
          <Route path="modulos" element={<AdminModules />} />
          <Route path="filiais" element={<AdminSalesBranches />} />
          <Route path="proposals" element={<Navigate to="/settings/modelos?aba=propostas" replace />} />
          <Route path="contract-templates" element={<Navigate to="/settings/modelos?aba=contratos" replace />} />
          <Route path="sources" element={<AdminSources />} />
          <Route path="integrations" element={<AdminIntegrations />} />
          <Route path="notifications" element={<Navigate to="/settings/modelos?aba=emails" replace />} />
          <Route path="security" element={<AdminSecurity />} />
          <Route path="branding" element={<AdminBranding />} />
          <Route path="logs" element={<AdminLogs />} />
        </Route>
        <Route path="*" element={<div className="card"><EmptyState title="Esta página não existe" description="Confira o endereço ou volte para o início." /></div>} />
      </Route>
    </Routes>
  );
}
