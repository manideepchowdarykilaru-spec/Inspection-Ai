import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { useAuth } from '@/context/AuthContext';

interface PageChrome {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  contextBar?: ReactNode;
}

const ChromeContext = createContext<((chrome: PageChrome) => void) | null>(null);

/** Lets each page publish its own header title, actions and context bar. */
export function usePageChrome(chrome: PageChrome, deps: unknown[] = []) {
  const setChrome = useContext(ChromeContext);
  useEffect(() => {
    setChrome?.(chrome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function AppLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chrome, setChrome] = useState<PageChrome>({ title: 'Dashboard' });

  useEffect(() => {
    setSidebarOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const value = useMemo(() => setChrome, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
          Restoring secure session…
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return (
    <ChromeContext.Provider value={value}>
      <div className="min-h-screen bg-slate-100">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="lg:pl-[264px]">
          <Header
            title={chrome.title}
            subtitle={chrome.subtitle}
            actions={chrome.actions}
            contextBar={chrome.contextBar}
            onMenuClick={() => setSidebarOpen(true)}
          />
          <main className="mx-auto w-full max-w-[1600px] px-4 py-5 lg:px-6 lg:py-6 print-full">
            <Outlet />
          </main>
          <footer className="mx-auto w-full max-w-[1600px] px-4 pb-8 text-2xs leading-relaxed text-slate-400 lg:px-6 no-print">
            LM-Inspect AI is an AI-assisted screening and decision-support system. Findings shown here are
            indicative. Final determination under the Legal Metrology Act, 2009 and the Legal Metrology
            (Packaged Commodities) Rules, 2011 rests with the authorised Legal Metrology official following
            physical verification where required.
          </footer>
        </div>
      </div>
    </ChromeContext.Provider>
  );
}
