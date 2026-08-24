import crypto from "crypto";
import { isSupabaseEnabled, supabase } from "./config.js";

// Création d'une fiche prestataire, factorisée entre l'approbation d'une demande
// (server/routes/vendorRequests.ts) et la création directe par un admin
// (server/routes/admin.ts, POST /api/admin/users) : les deux aboutissent à la même ligne
// vendor_profiles (+ vendor_profile_categories), seule la provenance diffère.

// Programme "prestataire fondateur" (cf. supabase_setup.sql section 31) : toute fiche créée
// avant cette date porte le badge "Fondateur", figé définitivement à la création. Repousser
// cette constante prolonge le programme ; la retirer (mettre une date passée) le clôt — dans
// les deux cas, les fiches déjà créées gardent le statut qu'elles avaient au moment voulu.
const VENDOR_FOUNDER_PROGRAM_ENDS = new Date("2027-06-30T23:59:59Z");
export function isWithinFounderProgram(): boolean {
  return new Date() <= VENDOR_FOUNDER_PROGRAM_ENDS;
}

export interface NewVendorProfileInput {
  userId: string;
  businessName: string;
  phone: string;
  city: string;
  description: string | null;
  categorySlugs: string[];
}

// Forme "plate" (pas d'union discriminée) : ce projet n'active pas strictNullChecks
// (tsconfig.json), sous lequel le rétrécissement de type sur "ok" ne s'applique pas fiablement
// (cf. server/lib/organizerAlias.ts). "id" est vide si ok=false ; "status"/"error" sont sans
// objet si ok=true.
export interface VendorProfileCreationResult {
  ok: boolean;
  id: string;
  status: number;
  error?: string;
}

// `db` n'est utilisé QUE si Supabase n'est pas configuré, et n'est ni relu ni sauvegardé ici :
// l'appelant a déjà son propre `db = getDB()` en cours (souvent pour y écrire autre chose dans
// la même requête, ex. le statut de la demande ou le compte utilisateur) et reste seul
// responsable d'un unique `saveDB(db)` final — un second appel écraserait sinon ce que cette
// fonction vient d'y ajouter.
export async function createVendorProfileForUser(
  input: NewVendorProfileInput,
  db?: any
): Promise<VendorProfileCreationResult> {
  if (isSupabaseEnabled && supabase) {
    const { data: existingProfile, error: checkError } = await supabase
      .from("vendor_profiles").select("id").eq("user_id", input.userId).maybeSingle();
    if (checkError) throw checkError;
    if (existingProfile) {
      return { ok: false, id: "", status: 409, error: "Ce compte a déjà une fiche prestataire." };
    }

    const vendorId = `vnd-${crypto.randomUUID()}`;
    const { error: profileError } = await supabase.from("vendor_profiles").insert({
      id: vendorId,
      user_id: input.userId,
      business_name: input.businessName,
      phone: input.phone,
      city: input.city,
      description: input.description,
      founding_member: isWithinFounderProgram()
    });
    if (profileError) throw profileError;

    if (input.categorySlugs.length > 0) {
      const { error: catError } = await supabase.from("vendor_profile_categories").insert(
        input.categorySlugs.map((slug) => ({ vendor_id: vendorId, category_slug: slug }))
      );
      if (catError) throw catError;
    }
    return { ok: true, id: vendorId, status: 201 };
  }

  if (!Array.isArray(db.vendorProfiles)) db.vendorProfiles = [];
  if (db.vendorProfiles.some((p: any) => p.userId === input.userId)) {
    return { ok: false, id: "", status: 409, error: "Ce compte a déjà une fiche prestataire." };
  }

  const id = `vnd-${crypto.randomUUID()}`;
  db.vendorProfiles.push({
    id,
    userId: input.userId,
    alias: null,
    businessName: input.businessName,
    phone: input.phone,
    city: input.city,
    description: input.description,
    coverImage: null,
    portfolioImages: [],
    categorySlugs: input.categorySlugs,
    foundingMember: isWithinFounderProgram(),
    active: true,
    createdAt: new Date().toISOString()
  });
  return { ok: true, id, status: 201 };
}
