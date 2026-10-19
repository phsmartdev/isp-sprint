import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Module } from '@isp/domain';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './components/layout/AppShell';
import { EmptyState, LoadingRows } from './components/ui/primitives';
import { LoginPage } from './pages/Login';
import { HomePage } from './pages/Home';
import { LeadsPage } from './pages/Leads';
import { OpportunitiesPage } from './pages/Opportunities';
import { NewOpportunityPage, OpportunityWorkspacePage } from './pages/OpportunityWorkspace';
import { CustomersPage } from './pages/Customers';
import { CustomerDetailPage } from './pages/CustomerDetail';
import { ActivitiesPage } from './pages/Activities';
import { ReportsPage } from './pages/Reports';
import { IntelligencePage } from './pages/Intelligence';
import { CampaignDetailPage, CampaignsPage } from './pages/Campaigns';
import { AdminLayout, AdminOverview, AdminUsers, AdminPlans, AdminSources, AdminIntegrations, AdminSecurity, AdminBranding, AdminLogs } from './pages/admin/Admin';
import { AdminJourneys } from './pages/admin/Journeys';
import { AdminArea } from './pages/admin/Area';
import { AdminViability } from './pages/admin/Viability';
import { AdminInstructions } from './pages/admin/Instructions';
import { AdminEmail } from './pages/admin/Email';
import { AdminData } from './pages/admin/DataAdmin';
import { AdminCustomFields } from './pages/admin/CustomFields';
import { AdminProposalTemplates } from './pages/admin/ProposalTemplates';
import { ProfilePage } from './pages/admin/Profile';

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <LoadingRows />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/** Rota protegida pelo nível do módulo; a API também recusa. */
function Gate({ module, min, children }: { module: Module; min?: 'proprio' | 'equipe' | 'total'; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(module, min)) return <div className="card"><EmptyState title="Sem acesso a este módulo" description="Seu perfil não tem acesso a esta área. Fale com a gerência se precisar." /></div>;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route index element={<Gate module="inicio"><HomePage /></Gate>} />
        <Route path="leads" element={<Gate module="leads"><LeadsPage /></Gate>} />
        <Route path="opportunities" element={<Gate module="oportunidades"><OpportunitiesPage /></Gate>} />
        <Route path="pipeline" element={<Navigate to="/opportunities" replace />} />
        <Route path="opportunities/new" element={<Gate module="oportunidades"><NewOpportunityPage /></Gate>} />
        <Route path="opportunities/:id" element={<Gate module="oportunidades"><OpportunityWorkspacePage /></Gate>} />
        <Route path="customers" element={<Gate module="clientes"><CustomersPage /></Gate>} />
        <Route path="customers/:id" element={<Gate module="clientes"><CustomerDetailPage /></Gate>} />
        <Route path="activities" element={<Gate module="atividades"><ActivitiesPage /></Gate>} />
        <Route path="reports" element={<Gate module="relatorios"><ReportsPage /></Gate>} />
        <Route path="intelligence" element={<Gate module="inteligencia"><IntelligencePage /></Gate>} />
        <Route path="campaigns" element={<Gate module="campanhas"><CampaignsPage /></Gate>} />
        <Route path="campaigns/:id" element={<Gate module="campanhas"><CampaignDetailPage /></Gate>} />
        <Route path="settings/profile" element={<ProfilePage />} />
        <Route path="settings" element={<Gate module="configuracoes" min="total"><AdminLayout /></Gate>}>
          <Route index element={<AdminOverview />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="plans" element={<AdminPlans />} />
          <Route path="journeys" element={<AdminJourneys />} />
          <Route path="stages" element={<Navigate to="/settings/journeys" replace />} />
          <Route path="area" element={<AdminArea />} />
          <Route path="viability" element={<AdminViability />} />
          <Route path="instructions" element={<AdminInstructions />} />
          <Route path="email" element={<AdminEmail />} />
          <Route path="data" element={<AdminData />} />
          <Route path="fields" element={<AdminCustomFields />} />
          <Route path="proposals" element={<AdminProposalTemplates />} />
          <Route path="sources" element={<AdminSources />} />
          <Route path="integrations" element={<AdminIntegrations />} />
          <Route path="notifications" element={<Navigate to="/settings/email" replace />} />
          <Route path="security" element={<AdminSecurity />} />
          <Route path="branding" element={<AdminBranding />} />
          <Route path="logs" element={<AdminLogs />} />
        </Route>
        <Route path="*" element={<div className="card"><EmptyState title="Esta página não existe" description="Confira o endereço ou volte para o início." /></div>} />
      </Route>
    </Routes>
  );
}
