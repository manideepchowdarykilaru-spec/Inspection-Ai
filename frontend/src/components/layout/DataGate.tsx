import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Database, RefreshCcw, ScanLine, ServerCrash } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { hydrate, onSyncError } from '@/services/storage';
import { useToast } from '@/context/ToastContext';

/**
 * Loads the working set from PostgreSQL before the application renders.
 *
 * Every screen reads the cache synchronously, so hydration has to complete
 * first. A failure here means the API or the database is unreachable, which is
 * worth stating plainly rather than rendering empty tables that look like a
 * department with no inspections on record.
 */
export function DataGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    setState('loading');
    try {
      await hydrate();
      setState('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The API did not respond.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A background write that fails must not pass silently.
  useEffect(() => {
    const unsubscribe = onSyncError((detail) =>
      toast.error(
        'Change not saved to the database',
        `${detail}. The screen has been refreshed from the server.`,
      ),
    );
    return () => {
      unsubscribe();
    };
  }, [toast]);

  if (state === 'ready') return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-navy-900">
          <ScanLine size={20} className="text-accent-400" />
        </span>

        {state === 'loading' ? (
          <>
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-slate-700">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
              Loading inspection records
            </div>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Database size={12} /> Connecting to the PostgreSQL database
            </p>
          </>
        ) : (
          <div className="surface p-6 text-left">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700">
                <ServerCrash size={18} />
              </span>
              <div className="min-w-0">
                <h1 className="text-sm font-bold text-slate-900">Cannot reach the inspection database</h1>
                <p className="mt-1 break-words text-xs leading-relaxed text-slate-600">{message}</p>
              </div>
            </div>

            <ol className="mt-4 space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <li>
                1. Copy <code className="font-mono text-2xs">.env.example</code> to{' '}
                <code className="font-mono text-2xs">.env</code> and set your PostgreSQL password.
              </li>
              <li>
                2. Run <code className="font-mono text-2xs">npm run db:setup</code> to create and seed the
                database.
              </li>
              <li>
                3. Run <code className="font-mono text-2xs">npm run dev</code> — it starts the API and the
                interface together.
              </li>
            </ol>

            <Button className="mt-4 w-full justify-center" icon={<RefreshCcw size={14} />} onClick={() => void load()}>
              Retry connection
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
