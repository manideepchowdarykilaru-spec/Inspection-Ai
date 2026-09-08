import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@shared/types';
import {
  can as hasCapability,
  restoreSession,
  signIn as signInService,
  signOut as signOutService,
  type Capability,
  type Credentials,
  type Session,
} from '@/services/authService';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (credentials: Credentials) => Promise<Session>;
  signOut: () => void;
  can: (capability: Capability) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSession(restoreSession());
    setLoading(false);
  }, []);

  const signIn = useCallback(async (credentials: Credentials) => {
    const next = await signInService(credentials);
    setSession(next);
    return next;
  }, []);

  const signOut = useCallback(() => {
    signOutService();
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      signIn,
      signOut,
      can: (capability) => hasCapability(session?.user.role, capability),
    }),
    [session, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
