import crypto from "crypto";
import { isSupabaseEnabled, supabase } from "./config.js";
import { getDB, saveDB } from "./db.js";

// Code public de compte (ex: "CB-7K4P2M") : référence courte affichée dans l'espace de chaque
// utilisateur, destinée à être dictée au téléphone ou collée dans un message au support. Elle
// remplace l'UUID Supabase (illisible à l'oral) et l'adresse e-mail (donnée personnelle qu'on
// préfère ne pas faire répéter à voix haute dans un guichet).
//
// CE CODE N'EST PAS UN SECRET et ne doit jamais servir à authentifier ni à autoriser quoi que
// ce soit : il identifie un compte dans une conversation, rien de plus. Toute route qui l'accepte
// en entrée doit rester derrière requireAuth/requireRole comme si le code n'existait pas.

// Alphabet sans 0/O/1/I/L : ces caractères sont systématiquement confondus à l'oral et à la
// lecture d'une capture d'écran, ce qui est exactement l'usage visé.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;
const CODE_PREFIX = "CB-";

export function generatePublicCode(): string {
  // crypto.randomInt (et pas Math.random) : le code est unique en base, deux comptes créés dans
  // la même milliseconde ne doivent pas tomber sur la même valeur à cause d'un PRNG faible.
  let body = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    body += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return `${CODE_PREFIX}${body}`;
}

const MAX_GENERATION_ATTEMPTS = 5;

// Attribue un code au compte s'il n'en a pas encore, et renvoie le code effectif.
//
// Appelée à l'inscription, mais aussi paresseusement depuis /api/auth/me : les comptes créés
// avant l'introduction de cette colonne n'ont pas de code, et on ne veut pas dépendre d'un
// script de migration exécuté manuellement pour que leur espace en affiche un. La contrainte
// unique en base (users_public_code_unique) reste l'arbitre en cas de collision — d'où la
// boucle de réessai plutôt qu'un simple SELECT préalable, qui laisserait passer une course
// entre deux inscriptions simultanées.
export async function ensureUserPublicCode(userId: string, existingCode?: string | null): Promise<string | null> {
  if (existingCode) return existingCode;
  if (!userId) return null;

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: current } = await supabase
        .from("users")
        .select("public_code")
        .eq("id", userId)
        .maybeSingle();

      if (current?.public_code) return current.public_code;

      for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
        const candidate = generatePublicCode();
        const { data, error } = await supabase
          .from("users")
          .update({ public_code: candidate })
          .eq("id", userId)
          .is("public_code", null)
          .select("public_code")
          .maybeSingle();

        if (!error) {
          // maybeSingle() sans ligne = un autre appel concurrent a posé un code entre-temps
          // (le filtre .is("public_code", null) ne matche plus) : on relit plutôt que d'écraser.
          if (data?.public_code) return data.public_code;
          const { data: refreshed } = await supabase
            .from("users")
            .select("public_code")
            .eq("id", userId)
            .maybeSingle();
          return refreshed?.public_code || null;
        }

        // 23505 = violation de contrainte unique : le code tiré est déjà pris, on retente.
        if ((error as any).code !== "23505") throw error;
      }

      console.warn(`[Public Code] Aucun code libre trouvé après ${MAX_GENERATION_ATTEMPTS} tentatives pour ${userId}.`);
      return null;
    } catch (err: any) {
      console.error("[Supabase Error] Attribution du code public, repli sur db.json :", err.message);
    }
  }

  const db = getDB();
  const dbUser = db.users.find((u: any) => u.id === userId) as any;
  if (!dbUser) return null;
  if (dbUser.publicCode) return dbUser.publicCode;

  const taken = new Set(db.users.map((u: any) => String(u.publicCode || "").toUpperCase()));
  let candidate = generatePublicCode();
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS && taken.has(candidate); attempt++) {
    candidate = generatePublicCode();
  }
  if (taken.has(candidate)) return null;

  dbUser.publicCode = candidate;
  saveDB(db);
  return candidate;
}
