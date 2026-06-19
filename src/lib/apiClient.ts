import { User } from "../types";

export type TokenRefreshHandler = (token: string, refreshToken?: string) => void;

async function performFetch(path: string, options: RequestInit, token?: string): Promise<Response> {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(path, { ...options, headers });
}

// Wrapper autour de fetch pour les routes protégées (requireAuth côté server.ts).
// Si le serveur répond 401 (access_token Supabase expiré) et qu'un refreshToken est
// disponible, on rafraîchit la session une fois via /api/auth/refresh puis on rejoue
// la requête, sans jamais demander à l'utilisateur de se reconnecter manuellement.
export async function authFetch(
  path: string,
  options: RequestInit,
  user: User,
  onTokenRefresh: TokenRefreshHandler
): Promise<Response> {
  let response = await performFetch(path, options, user.token);

  if (response.status === 401 && user.refreshToken) {
    try {
      const refreshResponse = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: user.refreshToken })
      });

      if (refreshResponse.ok) {
        const refreshed = await refreshResponse.json();
        if (refreshed.token) {
          onTokenRefresh(refreshed.token, refreshed.refreshToken);
          response = await performFetch(path, options, refreshed.token);
        }
      }
    } catch {
      // Le rafraîchissement a échoué : on retourne la réponse 401 d'origine.
    }
  }

  return response;
}
