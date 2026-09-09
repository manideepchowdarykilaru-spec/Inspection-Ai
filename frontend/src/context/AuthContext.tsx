import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@shared/types';
import { onUnauthorized } from '@/services/api';
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
  // Restored synchronously so the bearer token is in place before any child
  // effect (the data gate's hydration, for one) makes its first API call.
  const [session, setSession] = useState<Session | null>(() => restoreSession());
  const loading = false;

  const signIn = useCallback(async (credentials: Credentials) => {
    const next = await signInService(credentials);
    setSession(next);
    return next;
  }, []);

  const signOut = useCallback(() => {
    signOutService();
    setSession(null);
  }, []);

  // A refused API call means the token expired or was revoked: end the session
  // so the route guard returns the officer to the sign-in screen.
  useEffect(() => onUnauthorized(signOut), [signOut]);

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
