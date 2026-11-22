import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, post } from "./api";
import { GOOGLE_WEB_CLIENT_ID } from "./config";
import type { User } from "./types";

export type LoginResult = "ok" | "mfa";

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfa: (code: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  loginWithGoogle: () => Promise<LoginResult | "cancelled">;
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

  const refreshUser = useCallback(async () => setUser(await api<User>("/api/auth/me")), []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const res = await post("/api/auth/login", { email: email.trim(), password });
    if (res?.mfaRequired) return "mfa";
    await refreshUser();
    return "ok";
  }, [refreshUser]);

  const verifyMfa = useCallback(async (code: string) => {
    await post("/api/auth/mfa/login-verify", { code });
    await refreshUser();
  }, [refreshUser]);

  // L'inscription n'ouvre jamais de session : le serveur répond toujours « confirmez votre
  // e-mail » (même pour une adresse déjà inscrite, par anti-énumération). Le rôle est fixé à
  // « client » : devenir organisateur passe par une demande sur le site.
  const register = useCallback(async (name: string, email: string, password: string) => {
    await post("/api/auth/register", { name: name.trim(), email: email.trim(), password, role: "client" });
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    await post("/api/auth/forgot-password", { email: email.trim() });
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    await post("/api/auth/resend-confirmation", { email: email.trim() });
  }, []);

  const loginWithGoogle = useCallback(async (): Promise<LoginResult | "cancelled"> => {
    if (!GOOGLE_WEB_CLIENT_ID) throw new Error("La connexion Google n'est pas configurée.");
    const { GoogleSignin, isSuccessResponse } = require("@react-native-google-signin/google-signin");
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    await GoogleSignin.hasPlayServices?.();
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return "cancelled";
    const idToken: string | null = response.data.idToken;
    if (!idToken) throw new Error("Google n'a pas fourni de jeton. Réessayez.");
    const res = await post("/api/auth/google", { idToken });
    if (res?.mfaRequired) return "mfa";
    await refreshUser();
    return "ok";
  }, [refreshUser]);

  const logout = useCallback(async () => {
    try {
      await post("/api/auth/logout");
    } finally {
      setUser(null);
      if (GOOGLE_WEB_CLIENT_ID) {
        try {
          require("@react-native-google-signin/google-signin").GoogleSignin.signOut();
        } catch {
          // sans conséquence : la session ClicBillet est déjà fermée
        }
      }
    }
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, login, verifyMfa, register, forgotPassword, resendConfirmation, loginWithGoogle, logout }}>
      {children}
    </Ctx.Provider>
  );
}
