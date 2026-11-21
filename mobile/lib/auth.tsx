import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, post } from "./api";
import type { User } from "./types";

type LoginResult = "ok" | "mfa";

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfa: (code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthValue>(null as unknown as AuthValue);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<User>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const res = await post("/api/auth/login", { email: email.trim(), password });
    if (res?.mfaRequired) return "mfa";
    setUser(await api<User>("/api/auth/me"));
    return "ok";
  }, []);

  const verifyMfa = useCallback(async (code: string) => {
    await post("/api/auth/mfa/login-verify", { code });
    setUser(await api<User>("/api/auth/me"));
  }, []);

  const logout = useCallback(async () => {
    try {
      await post("/api/auth/logout");
    } finally {
      setUser(null);
    }
  }, []);

  return <Ctx.Provider value={{ user, loading, login, verifyMfa, logout }}>{children}</Ctx.Provider>;
}
