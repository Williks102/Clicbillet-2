// La session vit désormais dans un cookie httpOnly posé par le serveur (jamais lisible par du
// JS, donc invulnérable au vol par XSS — contrairement à l'ancien stockage du token dans
// localStorage). Le navigateur l'envoie automatiquement avec chaque requête same-origin :
// il suffit de credentials:"include" (explicite, même si déjà implicite en same-origin) et de
// l'en-tête X-Requested-With, exigé côté serveur en défense CSRF (cf. server.ts).
function withAuthDefaults(options: RequestInit): RequestInit {
  const headers = new Headers(options.headers || {});
  headers.set("X-Requested-With", "ClicBillet");
  return { ...options, headers, credentials: "include" };
}

// Wrapper autour de fetch pour les routes protégées (requireAuth côté server.ts).
// Si le serveur répond 401 (access_token Supabase expiré), on tente un rafraîchissement de
// session une fois via /api/auth/refresh (qui lit le refresh token depuis son propre cookie
// httpOnly, sans rien à transmettre) puis on rejoue la requête, sans jamais demander à
// l'utilisateur de se reconnecter manuellement.
export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  let response = await fetch(path, withAuthDefaults(options));

  if (response.status === 401) {
    try {
      const refreshResponse = await fetch("/api/auth/refresh", withAuthDefaults({ method: "POST" }));
      if (refreshResponse.ok) {
        response = await fetch(path, withAuthDefaults(options));
      }
    } catch {
      // Le rafraîchissement a échoué : on retourne la réponse 401 d'origine.
    }
  }

  return response;
}
