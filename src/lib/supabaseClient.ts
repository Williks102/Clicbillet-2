import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Client Supabase côté navigateur, clé anon publique uniquement (jamais service_role).
// Usage volontairement restreint : seul l'abonnement Realtime à "ses propres tickets"
// (cf. policy tickets_select_own dans supabase_setup.sql) passe par ce client. Tout le
// reste de l'app continue de parler exclusivement à /api/* (server.ts).
const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseClient: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      })
    : null;
