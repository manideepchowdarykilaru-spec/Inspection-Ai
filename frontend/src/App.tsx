import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { AppLayout } from '@/layouts/AppLayout';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import { RequireCapability } from '@/components/layout/RequireCapability';
import { DataGate } from '@/components/layout/DataGate';

/*
 * The landing and login screens ship in the main bundle so they paint at once.
 * Every workspace screen is its own chunk, fetched when first visited — the
 * charting library alone is 430 KB and is only needed by the dashboard and
 * analytics, so a phone opening a saved inspection never downloads it.
 */
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const NewInspection = lazy(() => import('@/pages/NewInspection'));
const TextExtraction = lazy(() => import('@/pages/TextExtraction'));
const AnalysisWorkspace = lazy(() => import('@/pages/AnalysisWorkspace'));
const InspectionDetail = lazy(() => import('@/pages/InspectionDetail'));
const InspectionHistory = lazy(() => import('@/pages/InspectionHistory'));
const ProductRepository = lazy(() => import('@/pages/ProductRepository'));
const ProductDetail = lazy(() => import('@/pages/ProductDetail'));
const Violations = lazy(() => import('@/pages/Violations'));
const Reports = lazy(() => import('@/pages/Reports'));
const ReportDetail = lazy(() => import('@/pages/ReportDetail'));
const Analytics = lazy(() => import('@/pages/Analytics'));
const EvidenceGallery = lazy(() => import('@/pages/EvidenceGallery'));
const Notifications = lazy(() => import('@/pages/Notifications'));
const UserManagement = lazy(() => import('@/pages/UserManagement'));
const AccessRequests = lazy(() => import('@/pages/AccessRequests'));
const RuleConfiguration = lazy(() => import('@/pages/RuleConfiguration'));
const Settings = lazy(() => import('@/pages/Settings'));

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          {/* The link opens straight on the sign-in screen. */}
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          {/* Only the workspace needs the inspection records; the public screens do not wait for them. */}
          <Route
            path="/app"
            element={
              <DataGate>
                <AppLayout />
              </DataGate>
            }
          >
            <Route index element={<Screen><Dashboard /></Screen>} />
            <Route path="new-inspection" element={<Screen><NewInspection /></Screen>} />
            <Route path="extract" element={<Screen><TextExtraction /></Screen>} />
            <Route path="analysis" element={<Screen><AnalysisWorkspace /></Screen>} />
            <Route path="inspections" element={<Screen><InspectionHistory /></Screen>} />
            <Route path="inspections/:id" element={<Screen><InspectionDetail /></Screen>} />
            <Route path="products" element={<Screen><ProductRepository /></Screen>} />
            <Route path="products/:id" element={<Screen><ProductDetail /></Screen>} />
            <Route path="violations" element={<Screen><Violations /></Screen>} />
            <Route path="reports" element={<Screen><Reports /></Screen>} />
            <Route path="reports/:id" element={<Screen><ReportDetail /></Screen>} />
            <Route path="analytics" element={<Screen><Analytics /></Screen>} />
            <Route path="evidence" element={<Screen><EvidenceGallery /></Screen>} />
            <Route path="notifications" element={<Screen><Notifications /></Screen>} />
            <Route
              path="users"
              element={
                <RequireCapability capability="users:manage">
                  <Screen><UserManagement /></Screen>
                </RequireCapability>
              }
            />
            <Route
              path="access-requests"
              element={
                <RequireCapability capability="users:manage">
                  <Screen><AccessRequests /></Screen>
                </RequireCapability>
              }
            />
            <Route
              path="rules"
              element={
                <RequireCapability capability="rules:manage">
                  <Screen><RuleConfiguration /></Screen>
                </RequireCapability>
              }
            />
            <Route path="settings" element={<Screen><Settings /></Screen>} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
