import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { apiRequest, ApiError, NetworkError } from '@/lib/api/client';
import {
  clearTokens,
  getAccessToken,
  getInstallId,
  saveTokens,
} from '@/lib/api/config';
import { clearAll as clearOutbox } from '@/lib/outbox/store';
import {
  clearBackgroundState,
  setActiveGeofence,
} from '@/lib/background/state';
import { stopGeofencing, stopLocationUpdates } from '@/lib/background/tasks';

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: 'super_admin' | 'company_admin' | 'manager' | 'employee';
  companyId: string | null;
  employeeId: string | null;
};

type AuthState = {
  user: AuthUser | null;
  /** True until the stored session has been checked on cold start. */
  initialising: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initialising, setInitialising] = useState(true);

  const loadUser = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const me = await apiRequest<AuthUser>('/api/auth/me');
      setUser(me);
    } catch (error) {
      // A network failure must not sign the user out — they may be offline
      // mid-shift, and the app still needs to queue events under their identity.
      if (error instanceof NetworkError) return;
      if (error instanceof ApiError && error.status === 401) {
        await clearTokens();
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadUser();
      setInitialising(false);
    })();
  }, [loadUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    const installId = await getInstallId();
    const result = await apiRequest<{
      accessToken: string;
      refreshToken: string;
      user: AuthUser;
    }>('/api/auth/login', {
      method: 'POST',
      anonymous: true,
      body: { email: email.trim().toLowerCase(), password, installId },
    });

    await saveTokens(result.accessToken, result.refreshToken);
    setUser(result.user);
  }, []);

  const signOut = useCallback(async () => {
    // Stop background tracking first: leaving a foreground service running for
    // a signed-out user would be both confusing and a privacy problem.
    await stopLocationUpdates().catch(() => {});
    await stopGeofencing().catch(() => {});
    await setActiveGeofence(null).catch(() => {});
    await clearBackgroundState();

    const { getRefreshToken } = await import('@/lib/api/config');
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        body: { refreshToken },
      }).catch(() => {});
    }

    await clearTokens();
    // Queued events belong to the account that created them.
    await clearOutbox().catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, initialising, signIn, signOut, refreshUser: loadUser }),
    [user, initialising, signIn, signOut, loadUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
