import Constants from "expo-constants";

// URL du backend : EXPO_PUBLIC_API_URL (cf. .env.example), sinon le site de production.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://www.clicbillet.com").replace(/\/$/, "");

export const SITE_URL = API_URL;

// La session vit dans des cookies httpOnly posés par le serveur : le client HTTP natif
// (NSURLSession / OkHttp) les conserve et les renvoie tout seul avec credentials:"include".
// X-Requested-With est exigé par le serveur en défense CSRF sur toute requête d'écriture.
function init(options: RequestInit): RequestInit {
  const headers = new Headers(options.headers || {});
  headers.set("X-Requested-With", "ClicBillet");
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return { ...options, headers, credentials: "include" };
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function raw(path: string, options: RequestInit): Promise<Response> {
  let res = await fetch(`${API_URL}${path}`, init(options));
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    try {
      const r = await fetch(`${API_URL}/api/auth/refresh`, init({ method: "POST" }));
      if (r.ok) res = await fetch(`${API_URL}${path}`, init(options));
    } catch {
      // on retourne le 401 d'origine
    }
  }
  return res;
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await raw(path, options);
  } catch {
    throw new ApiError("Connexion impossible. Vérifiez votre réseau.", 0, null);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error || "Une erreur est survenue.", res.status, data);
  return data as T;
}

export const post = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const appVersion = Constants.expoConfig?.version ?? "1.0.0";
