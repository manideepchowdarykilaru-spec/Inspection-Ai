import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { AppLayout } from '@/layouts/AppLayout';
import Landing from '@/pages/Landing';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import NewInspection from '@/pages/NewInspection';
import TextExtraction from '@/pages/TextExtraction';
import AnalysisWorkspace from '@/pages/AnalysisWorkspace';
import InspectionDetail from '@/pages/InspectionDetail';
import InspectionHistory from '@/pages/InspectionHistory';
import ProductRepository from '@/pages/ProductRepository';
import ProductDetail from '@/pages/ProductDetail';
import Violations from '@/pages/Violations';
import Reports from '@/pages/Reports';
import ReportDetail from '@/pages/ReportDetail';
import Analytics from '@/pages/Analytics';
import EvidenceGallery from '@/pages/EvidenceGallery';
import Notifications from '@/pages/Notifications';
import UserManagement from '@/pages/UserManagement';
import RuleConfiguration from '@/pages/RuleConfiguration';
import Settings from '@/pages/Settings';
import { RequireCapability } from '@/components/layout/RequireCapability';
import { DataGate } from '@/components/layout/DataGate';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <DataGate>
          <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />

          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="new-inspection" element={<NewInspection />} />
            <Route path="extract" element={<TextExtraction />} />
            <Route path="analysis" element={<AnalysisWorkspace />} />
            <Route path="inspections" element={<InspectionHistory />} />
            <Route path="inspections/:id" element={<InspectionDetail />} />
            <Route path="products" element={<ProductRepository />} />
            <Route path="products/:id" element={<ProductDetail />} />
            <Route path="violations" element={<Violations />} />
            <Route path="reports" element={<Reports />} />
            <Route path="reports/:id" element={<ReportDetail />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="evidence" element={<EvidenceGallery />} />
            <Route path="notifications" element={<Notifications />} />
            <Route
              path="users"
              element={
                <RequireCapability capability="users:manage">
                  <UserManagement />
                </RequireCapability>
              }
            />
            <Route
              path="rules"
              element={
                <RequireCapability capability="rules:manage">
                  <RuleConfiguration />
                </RequireCapability>
              }
            />
            <Route path="settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </DataGate>
      </ToastProvider>
    </AuthProvider>
  );
}
