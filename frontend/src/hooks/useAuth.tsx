import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiBase, getToken, setToken, type AuthUser } from "../lib/api";

/**
 * Client-side session state. The backend verifies every request via the
 * HMAC bearer token; this context only mirrors it for the UI.
 */

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  /** True once the initial /api/auth/me check has settled. */
  ready: boolean;
  applyAuth: (token: string, user: AuthUser) => void;
  logout: () => void;
  /** Scoped token for the connected workspace (read access to its metrics). */
  tenantToken: string | null;
  setTenantToken: (token: string | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface MeResponse {
  user: AuthUser;
}

const TENANT_TOKEN_KEY = "passthrough.tenantToken";

function loadTenantToken(): string | null {
  try {
    return localStorage.getItem(TENANT_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState<boolean>(token === null);
  const [tenantToken, setTenantTokenState] = useState<string | null>(loadTenantToken);

  useEffect(() => {
    let cancelled = false;
    async function check(): Promise<void> {
      const current = getToken();
      if (current === null) {
        setReady(true);
        return;
      }
      try {
        const response = await fetch(`${apiBase()}/api/auth/me`, {
          headers: { authorization: `Bearer ${current}` },
        });
        if (!response.ok) {
          throw new Error("session expired");
        }
        const payload = (await response.json()) as MeResponse;
        if (!cancelled) {
          setUser(payload.user);
          setReady(true);
        }
      } catch {
        if (!cancelled) {
          setToken(null);
          setTokenState(null);
          setUser(null);
          setReady(true);
        }
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyAuth = useCallback((nextToken: string, nextUser: AuthUser) => {
    setToken(nextToken);
    setTokenState(nextToken);
    setUser(nextUser);
  }, []);

  const setTenantToken = useCallback((next: string | null) => {
    setTenantTokenState(next);
    try {
      if (next === null) {
        localStorage.removeItem(TENANT_TOKEN_KEY);
      } else {
        localStorage.setItem(TENANT_TOKEN_KEY, next);
      }
    } catch {
      // Storage unavailable — token lives for the session only.
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ token, user, ready, applyAuth, logout, tenantToken, setTenantToken }),
    [token, user, ready, applyAuth, logout, tenantToken, setTenantToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
