import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SettingsLayout } from './features/settings/SettingsLayout';
import { lazy, Suspense, type ReactNode } from 'react';
import type { FeatureKey, Module } from '@isp/domain';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './components/layout/AppShell';
import { EmptyState, LoadingRows } from './components/ui/primitives';
import { LoginPage, ResetPasswordPage } from './pages/Login';
import { useMoneyHidden } from './lib/privacy';
const PeopleLayout = lazy(() => import('./pages/people/PeopleLayout').then((m) => ({ default: m.PeopleLayout })));
const MySpacePage = lazy(() => import('./pages/people/MySpace').then((m) => ({ default: m.MySpacePage })));
const PeopleProfilePage = lazy(() => import('./pages/people/Profile').then((m) => ({ default: m.ProfilePage })));
const PeopleConfigPage = lazy(() => import('./pages/people/AdminConfig').then((m) => ({ default: m.PeopleConfigPage })));
const PeoplePostPage = lazy(() => import('./pages/people/feed/PostPage').then((m) => ({ default: m.PostPage })));
const PeopleSavedPage = lazy(() => import('./pages/people/Saved').then((m) => ({ default: m.SavedPage })));
const PeopleCommunitiesPage = lazy(() => import('./pages/people/Communities').then((m) => ({ default: m.CommunitiesPage })));
const PeopleCommunityPage = lazy(() => import('./pages/people/CommunityPage').then((m) => ({ default: m.CommunityPage })));
const PeopleRecognitionPage = lazy(() => import('./pages/people/Recognition').then((m) => ({ default: m.RecognitionPage })));
const PeopleAdminAnnouncements = lazy(() => import('./pages/people/AdminAnnouncements').then((m) => ({ default: m.AdminAnnouncementsPage })));
const PeopleAdminRecognition = lazy(() => import('./pages/people/AdminRecognition').then((m) => ({ default: m.AdminRecognitionPage })));
const PeopleNotifications = lazy(() => import('./pages/people/Notifications').then((m) => ({ default: m.NotificationsPage })));
const PeopleMyReports = lazy(() => import('./pages/people/MyReports').then((m) => ({ default: m.MyReportsPage })));
const PeopleAdminModeration = lazy(() => import('./pages/people/AdminModeration').then((m) => ({ default: m.AdminModerationPage })));
const PeopleAdminPanel = lazy(() => import('./pages/people/AdminPanel').then((m) => ({ default: m.AdminPanelPage })));
// telas carregadas só quando abertas: o arquivo inicial fica pequeno e o sistema abre mais rápido
const EmailPage = lazy(() => import('./pages/email/Email').then((m) => ({ default: m.EmailPage })));
const MailboxesPage = lazy(() => import('./pages/email/Email').then((m) => ({ default: m.MailboxesPage })));
const AbmPage = lazy(() => import('./pages/marketing/Abm').then((m) => ({ default: m.AbmPage })));
const Abm360Page = lazy(() => import('./pages/marketing/Abm360').then((m) => ({ default: m.Abm360Page })));
const ProductPage = lazy(() => import('./pages/product/Product').then((m) => ({ default: m.ProductPage })));
const InterventionsPage = lazy(() => import('./pages/results/Interventions').then((m) => ({ default: m.InterventionsPage })));
const AnalysisPage = lazy(() => import('./pages/results/Analysis').then((m) => ({ default: m.AnalysisPage })));
const RitualsPage = lazy(() => import('./pages/results/Rituals').then((m) => ({ default: m.RitualsPage })));
const VacationsPage = lazy(() => import('./pages/results/Vacations').then((m) => ({ default: m.VacationsPage })));
const GamificationPage = lazy(() => import('./pages/results/Gamification').then((m) => ({ default: m.GamificationPage })));
const MyPointsPage = lazy(() => import('./pages/MyPoints').then((m) => ({ default: m.MyPointsPage })));
const PerformancePage = lazy(() => import('./pages/results/Performance').then((m) => ({ default: m.PerformancePage })));
const MeetingPage = lazy(() => import('./pages/results/Meeting').then((m) => ({ default: m.MeetingPage })));
const DecisionsPage = lazy(() => import('./pages/results/Decisions').then((m) => ({ default: m.DecisionsPage })));
const GoalsPage = lazy(() => import('./pages/performance/Goals').then((m) => ({ default: m.GoalsPage })));
const ApprovalPage = lazy(() => import('./pages/Approval').then((m) => ({ default: m.ApprovalPage })));
const ApprovalsPage = lazy(() => import('./pages/Approvals').then((m) => ({ default: m.ApprovalsPage })));
const HomePage = lazy(() => import('./pages/Home').then((m) => ({ default: m.HomePage })));
const LeadsPage = lazy(() => import('./pages/Leads').then((m) => ({ default: m.LeadsPage })));
const OpportunitiesPage = lazy(() => import('./pages/Opportunities').then((m) => ({ default: m.OpportunitiesPage })));
const NewOpportunityPage = lazy(() => import('./pages/OpportunityWorkspace').then((m) => ({ default: m.NewOpportunityPage })));
const OpportunityWorkspacePage = lazy(() => import('./pages/OpportunityWorkspace').then((m) => ({ default: m.OpportunityWorkspacePage })));
const BudgetPlanningPage = lazy(() => import('./pages/budget/Planning').then((m) => ({ default: m.BudgetPlanningPage })));
const BudgetAssetsPage = lazy(() => import('./pages/budget/Resources').then((m) => ({ default: m.BudgetAssetsPage })));
const BudgetContractsPage = lazy(() => import('./pages/budget/Resources').then((m) => ({ default: m.BudgetContractsPage })));
const BudgetPurchasesPage = lazy(() => import('./pages/budget/Resources').then((m) => ({ default: m.BudgetPurchasesPage })));
const BudgetSoftwarePage = lazy(() => import('./pages/budget/Resources').then((m) => ({ default: m.BudgetSoftwarePage })));
const BudgetIndicatorsPage = lazy(() => import('./pages/budget/Indicators').then((m) => ({ default: m.BudgetIndicatorsPage })));
const CustomersPage = lazy(() => import('./pages/Customers').then((m) => ({ default: m.CustomersPage })));
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetail').then((m) => ({ default: m.CustomerDetailPage })));
const ActivitiesPage = lazy(() => import('./pages/Activities').then((m) => ({ default: m.ActivitiesPage })));
const ProjectsPage = lazy(() => import('./pages/projects/Projects').then((m) => ({ default: m.ProjectsPage })));
const TasksPage = lazy(() => import('./pages/tasks/Tasks').then((m) => ({ default: m.TasksPage })));
const ProjectDetailPage = lazy(() => import('./pages/projects/ProjectDetail').then((m) => ({ default: m.ProjectDetailPage })));
const ReportsPage = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportsPage })));
const IntelligencePage = lazy(() => import('./pages/Intelligence').then((m) => ({ default: m.IntelligencePage })));
const CampaignDetailPage = lazy(() => import('./pages/Campaigns').then((m) => ({ default: m.CampaignDetailPage })));
const CampaignsPage = lazy(() => import('./pages/Campaigns').then((m) => ({ default: m.CampaignsPage })));
const ContractsPage = lazy(() => import('./pages/contracts/Contracts').then((m) => ({ default: m.ContractsPage })));
const ContractDetailPage = lazy(() => import('./pages/contracts/ContractDetail').then((m) => ({ default: m.ContractDetailPage })));
const NewContractPage = lazy(() => import('./pages/contracts/NewContract').then((m) => ({ default: m.NewContractPage })));
const ArpDetailPage = lazy(() => import('./pages/contracts/ArpDetail').then((m) => ({ default: m.ArpDetailPage })));
const CustomerSuccessPage = lazy(() => import('./pages/cs/CustomerSuccess').then((m) => ({ default: m.CustomerSuccessPage })));
const TeamPanelPage = lazy(() => import('./pages/results/TeamPanel').then((m) => ({ default: m.TeamPanelPage })));
const TeamPeoplePage = lazy(() => import('./pages/results/TeamHubs').then((m) => ({ default: m.TeamPeoplePage })));
const TeamTrackingPage = lazy(() => import('./pages/results/TeamHubs').then((m) => ({ default: m.TeamTrackingPage })));
const GiftsPage = lazy(() => import('./pages/Gifts').then((m) => ({ default: m.GiftsPage })));
const SupportPage = lazy(() => import('./features/support/Support').then((m) => ({ default: m.SupportPage })));
const JourneyPage = lazy(() => import('./pages/cs/Journey').then((m) => ({ default: m.JourneyPage })));
const KickoffPrintPage = lazy(() => import('./pages/cs/Journey').then((m) => ({ default: m.KickoffPrintPage })));
const PublicKickoffPage = lazy(() => import('./pages/cs/Journey').then((m) => ({ default: m.PublicKickoffPage })));
const PublicJourneyPage = lazy(() => import('./pages/cs/JourneyTrailTab').then((m) => ({ default: m.PublicJourneyPage })));
const PublicSurveyPage = lazy(() => import('./pages/cs/Surveys').then((m) => ({ default: m.PublicSurveyPage })));
const SurveyPage = lazy(() => import('./pages/cs/Surveys').then((m) => ({ default: m.SurveyPage })));
const PublicNoticePage = lazy(() => import('./pages/PublicNotice').then((m) => ({ default: m.PublicNoticePage })));
const KpiBoardPage = lazy(() => import('./pages/KpiBoardPage').then((m) => ({ default: m.KpiBoardPage })));

/** Endereços antigos continuam funcionando (links, favoritos, avisos): vão para a aba certa mantendo os filtros. */
function GoTo({ to, aba }: { to: string; aba?: string }) {
  const loc = useLocation();
  const q = new URLSearchParams(loc.search);
  if (aba) q.set('aba', aba);
  const s = q.toString();
  return <Navigate replace to={`${to}${s ? `?${s}` : ''}${loc.hash}`} />;
}

const PlaybooksPage = lazy(() => import('./pages/playbooks/Library').then((m) => ({ default: m.PlaybooksPage })));
const PlaybookReaderPage = lazy(() => import('./pages/playbooks/Reader').then((m) => ({ default: m.PlaybookReaderPage })));
const PlaybookNewPage = lazy(() => import('./pages/playbooks/Editor').then((m) => ({ default: m.PlaybookNewPage })));
const PlaybookEditorPage = lazy(() => import('./pages/playbooks/Editor').then((m) => ({ default: m.PlaybookEditorPage })));
const PlaybookApprovePage = lazy(() => import('./pages/playbooks/Versions').then((m) => ({ default: m.PlaybookApprovePage })));
const PlaybookVersionsPage = lazy(() => import('./pages/playbooks/Versions').then((m) => ({ default: m.PlaybookVersionsPage })));

// Configurações carregam sob demanda: o código de cada tela só baixa quando ela é aberta
const AdminModules = lazy(() => import('./pages/admin/Modules').then((m) => ({ default: m.AdminModules })));
const AdminSalesBranches = lazy(() => import('./pages/admin/SalesBranches').then((m) => ({ default: m.AdminSalesBranches })));
const AdminGmailSettings = lazy(() => import('./pages/admin/GmailSettings').then((m) => ({ default: m.AdminGmailSettings })));
const AdminResultsSettings = lazy(() => import('./pages/admin/ResultsSettings').then((m) => ({ default: m.AdminResultsSettings })));
const ImportEnginePage = lazy(() => import('./pages/admin/import/ImportEngine').then((m) => ({ default: m.ImportEnginePage })));
const ImportTemplatePage = lazy(() => import('./pages/admin/import/ImportEngine').then((m) => ({ default: m.ImportTemplatePage })));
const ImportRunPage = lazy(() => import('./pages/admin/import/ImportEngine').then((m) => ({ default: m.ImportRunPage })));
const AdminAbmSettings = lazy(() => import('./pages/admin/AbmSettings').then((m) => ({ default: m.AdminAbmSettings })));
const AdminPerformanceSettings = lazy(() => import('./pages/admin/PerformanceSettings').then((m) => ({ default: m.AdminPerformanceSettings })));
const AdminContractComms = lazy(() => import('./pages/admin/ContractComms').then((m) => ({ default: m.AdminContractComms })));
const AdminContractResponsibilities = lazy(() => import('./pages/admin/ContractResponsibilities').then((m) => ({ default: m.AdminContractResponsibilities })));
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
    <Suspense fallback={<div className="p-6"><LoadingRows rows={6} /></div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/k/:token" element={<PublicKickoffPage />} />
      <Route path="/j/:token" element={<PublicJourneyPage />} />
      <Route path="/p/:token" element={<PublicSurveyPage />} />
      <Route path="/r/:token" element={<PublicNoticePage />} />
      <Route path="/kickoff/:id/pdf" element={<Gate module="clientes"><KickoffPrintPage /></Gate>} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
      <Route path="/painel/indicadores" element={<RequireAuth><Gate module="inteligencia"><KpiBoardPage /></Gate></RequireAuth>} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Gate module="inicio"><HomePage /></Gate>} />
        <Route path="pessoas" element={<Gate module="pessoas" feature="pessoas_cultura.experiencia"><PeopleLayout /></Gate>}>
          <Route index element={<MySpacePage />} />
          <Route path="perfil/:userId" element={<PeopleProfilePage />} />
          <Route path="publicacao/:id" element={<PeoplePostPage />} />
          <Route path="salvos" element={<PeopleSavedPage />} />
          <Route path="comunidades" element={<PeopleCommunitiesPage />} />
          <Route path="comunidades/:id" element={<PeopleCommunityPage />} />
          <Route path="admin/configuracoes" element={<PeopleConfigPage />} />
          <Route path="reconhecimento" element={<PeopleRecognitionPage />} />
          <Route path="admin/comunicados" element={<PeopleAdminAnnouncements />} />
          <Route path="admin/reconhecimentos" element={<PeopleAdminRecognition />} />
          <Route path="notificacoes" element={<PeopleNotifications />} />
          <Route path="denuncias" element={<PeopleMyReports />} />
          <Route path="admin/moderacao" element={<PeopleAdminModeration />} />
          <Route path="admin/painel" element={<PeopleAdminPanel />} />
        </Route>
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
        <Route path="desempenho/metas" element={<GoTo to="/times/metas" />} />
        <Route path="times/metas" element={<Gate module="desempenho"><GoalsPage /></Gate>} />
        <Route path="times" element={<Gate module="resultados"><TeamPanelPage /></Gate>} />
        <Route path="times/acompanhamento" element={<Gate module="resultados"><TeamTrackingPage /></Gate>} />
        <Route path="times/pessoas" element={<TeamPeoplePage />} />
        <Route path="times/intervencoes" element={<GoTo to="/times/acompanhamento" aba="intervencoes" />} />
        <Route path="times/intervencoes/:id/analise" element={<Gate module="resultados"><AnalysisPage /></Gate>} />
        <Route path="times/rituais" element={<GoTo to="/times/acompanhamento" aba="rituais" />} />
        <Route path="apoio" element={<SupportPage />} />
        <Route path="playbooks" element={<Suspense fallback={<LoadingRows rows={6} />}><PlaybooksPage /></Suspense>} />
        <Route path="playbooks/novo" element={<Suspense fallback={<LoadingRows rows={6} />}><PlaybookNewPage /></Suspense>} />
        <Route path="playbooks/:id" element={<Suspense fallback={<LoadingRows rows={6} />}><PlaybookReaderPage /></Suspense>} />
        <Route path="playbooks/:id/editar" element={<Suspense fallback={<LoadingRows rows={6} />}><PlaybookEditorPage /></Suspense>} />
        <Route path="playbooks/:id/versoes" element={<Suspense fallback={<LoadingRows rows={6} />}><PlaybookVersionsPage /></Suspense>} />
        <Route path="playbooks/:id/aprovar/:versionId" element={<Suspense fallback={<LoadingRows rows={6} />}><PlaybookApprovePage /></Suspense>} />
        <Route path="brindes" element={<Gate module="campanhas"><GiftsPage /></Gate>} />
        <Route path="times/ferias" element={<GoTo to="/times/pessoas" aba="ferias" />} />
        <Route path="times/gamificacao" element={<GoTo to="/times/pessoas" aba="gamificacao" />} />
        <Route path="meus-pontos" element={<MyPointsPage />} />
        <Route path="times/performance" element={<GoTo to="/times/pessoas" aba="performance" />} />
        <Route path="times/rituais/reunioes/:id" element={<Gate module="resultados"><MeetingPage /></Gate>} />
        <Route path="times/decisoes" element={<GoTo to="/times/acompanhamento" aba="decisoes" />} />
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
          <Route path="viability" element={<EconGate><AdminViability /></EconGate>} />
          <Route path="financial-studio" element={<EconGate><AdminFinancialStudio /></EconGate>} />
          <Route path="modelos" element={<AdminModels />} />
          <Route path="instructions" element={<Navigate to="/settings/modelos?aba=instrucao" replace />} />
          <Route path="email" element={<Navigate to="/settings/modelos?aba=emails" replace />} />
          <Route path="data" element={<AdminData />} />
          <Route path="importacao" element={<ImportEnginePage />} />
          <Route path="importacao/modelos/:id" element={<ImportTemplatePage />} />
          <Route path="importacao/execucoes/:id" element={<ImportRunPage />} />
          <Route path="fields" element={<AdminCustomFields />} />
          <Route path="contracts" element={<Navigate to="/settings/modulos?cfg=contratos" replace />} />
          <Route path="approvals" element={<AdminApprovalSettings />} />
          <Route path="contratos-responsabilidades" element={<AdminContractResponsibilities />} />
          <Route path="contratos-comunicacao" element={<AdminContractComms />} />
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
    </Suspense>
  );
}

/** Viabilidade econômica é uma funcionalidade do CRM que a empresa liga ou desliga (Configurações → Permissões → Módulos e liberação). */
function EconGate({ children }: { children: ReactNode }) {
  const { feature } = useAuth();
  if (feature('crm.viabilidade')) return <>{children}</>;
  return (
    <section className="card p-5">
      <h2 className="text-md font-bold text-ink">Viabilidade econômica desligada</h2>
      <p className="mt-1 text-sm text-muted">Esta funcionalidade do CRM não está liberada na empresa. Quem administra liga em Configurações → Permissões → Módulos e liberação, no módulo CRM.</p>
    </section>
  );
}
