import express from "express";
import { isSupabaseEnabled, supabase } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { requireAuth } from "../lib/auth.js";
import { validateVendorAlias, MAX_VENDOR_DESCRIPTION_LENGTH } from "../lib/vendorAlias.js";
import { getVendorCategories } from "../lib/vendorCategories.js";

const router = express.Router();

// Tableau de bord prestataire (marché de prestataires) : jumeau des routes de profil public
// organisateur (server/routes/organizer.ts), en plus simple — pas de rôle à vérifier
// (requireAuth suffit, monté globalement sur /api/vendor dans server.ts), juste "ce compte
// a-t-il un profil prestataire ?", résolu au début de chaque handler.

const MAX_PORTFOLIO_IMAGES = 6;

function mapProfile(row: any): any {
  return {
    id: row.id,
    alias: row.alias || null,
    businessName: row.business_name,
    phone: row.phone,
    city: row.city,
    description: row.description || null,
    coverImage: row.cover_image || null,
    portfolioImages: row.portfolio_images || [],
    categorySlugs: row.category_slugs || [],
    foundingMember: row.founding_member === true,
    active: row.active !== false,
  };
}

function mapLocalProfile(row: any): any {
  return {
    id: row.id,
    alias: row.alias || null,
    businessName: row.businessName,
    phone: row.phone,
    city: row.city,
    description: row.description || null,
    coverImage: row.coverImage || null,
    portfolioImages: row.portfolioImages || [],
    categorySlugs: row.categorySlugs || [],
    foundingMember: row.foundingMember === true,
    active: row.active !== false,
  };
}

router.get("/api/vendor/profile", requireAuth, async (req: express.Request, res: express.Response) => {
  const authUser = req.user!;

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: profile, error } = await supabase
        .from("vendor_profiles")
        .select("*")
        .eq("user_id", authUser.id)
        .maybeSingle();
      if (error) throw error;
      if (!profile) return res.status(404).json({ error: "Aucune fiche prestataire pour ce compte." });

      const { data: cats } = await supabase.from("vendor_profile_categories").select("category_slug").eq("vendor_id", profile.id);
      return res.json(mapProfile({ ...profile, category_slugs: (cats || []).map((c: any) => c.category_slug) }));
    } catch (err: any) {
      console.error("[Supabase Error] Lecture du profil prestataire, repli sur db.json :", err.message);
    }
  }

  const db = getDB();
  const profile = (db.vendorProfiles || []).find((p: any) => p.userId === authUser.id);
  if (!profile) return res.status(404).json({ error: "Aucune fiche prestataire pour ce compte." });
  res.json(mapLocalProfile(profile));
});

router.get("/api/vendor/check-alias", requireAuth, async (req: express.Request, res: express.Response) => {
  const authUser = req.user!;
  const result = validateVendorAlias(String(req.query.alias || ""));
  if (!result.valid) {
    return res.json({ available: false, error: result.error });
  }

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: mine } = await supabase.from("vendor_profiles").select("id").eq("user_id", authUser.id).maybeSingle();
      let query = supabase.from("vendor_profiles").select("id").ilike("alias", result.alias);
      if (mine) query = query.neq("id", mine.id);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return res.json({ available: !data, alias: result.alias });
    } catch (err: any) {
      console.error("[Supabase Error] Vérification de l'alias prestataire :", err.message);
      return res.status(500).json({ error: "Vérification impossible pour le moment." });
    }
  }

  const db = getDB();
  const taken = (db.vendorProfiles || []).some((p: any) =>
    p.userId !== authUser.id && String(p.alias || "").toLowerCase() === result.alias
  );
  res.json({ available: !taken, alias: result.alias });
});

router.patch("/api/vendor/profile", requireAuth, async (req: express.Request, res: express.Response) => {
  const authUser = req.user!;
  const { alias, businessName, phone, city, description, coverImage, portfolioImages, categorySlugs } = req.body;

  const maj: Record<string, any> = {};

  if (alias !== undefined) {
    const result = validateVendorAlias(String(alias || ""));
    if (!result.valid) return res.status(400).json({ error: result.error });
    maj.alias = result.alias;
  }
  if (businessName !== undefined) {
    const trimmed = String(businessName || "").trim();
    if (!trimmed || trimmed.length > 120) return res.status(400).json({ error: "Le nom de votre structure est requis (120 caractères maximum)." });
    maj.business_name = trimmed;
  }
  if (phone !== undefined) {
    const normalizedPhone = String(phone || "").replace(/\s+/g, "");
    if (!normalizedPhone || normalizedPhone.length < 8 || normalizedPhone.length > 20 || !/^\+?\d+$/.test(normalizedPhone)) {
      return res.status(400).json({ error: "Un numéro de téléphone valide est requis." });
    }
    maj.phone = normalizedPhone;
  }
  if (city !== undefined) {
    const trimmed = String(city || "").trim();
    if (!trimmed || trimmed.length > 100) return res.status(400).json({ error: "La ville est requise (100 caractères maximum)." });
    maj.city = trimmed;
  }
  if (description !== undefined) {
    maj.description = String(description || "").trim().slice(0, MAX_VENDOR_DESCRIPTION_LENGTH) || null;
  }
  if (coverImage !== undefined) {
    if (coverImage !== null && typeof coverImage !== "string") return res.status(400).json({ error: "Photo de couverture invalide." });
    maj.cover_image = coverImage || null;
  }
  if (portfolioImages !== undefined) {
    if (!Array.isArray(portfolioImages) || portfolioImages.length > MAX_PORTFOLIO_IMAGES || !portfolioImages.every((s) => typeof s === "string")) {
      return res.status(400).json({ error: `Le portfolio est limité à ${MAX_PORTFOLIO_IMAGES} photos.` });
    }
    maj.portfolio_images = portfolioImages;
  }

  let resolvedCategorySlugs: string[] | undefined;
  if (categorySlugs !== undefined) {
    if (!Array.isArray(categorySlugs) || categorySlugs.length < 1 || categorySlugs.length > 3 || !categorySlugs.every((s) => typeof s === "string" && s.trim())) {
      return res.status(400).json({ error: "Choisissez entre 1 et 3 catégories." });
    }
    const actives = await getVendorCategories();
    const activeSlugSet = new Set(actives.map((c) => c.slug));
    resolvedCategorySlugs = [...new Set(categorySlugs.map((s: string) => s.trim()))];
    if (resolvedCategorySlugs.some((s) => !activeSlugSet.has(s))) {
      return res.status(400).json({ error: "Une ou plusieurs catégories choisies n'existent pas ou plus." });
    }
  }

  if (Object.keys(maj).length === 0 && !resolvedCategorySlugs) {
    return res.status(400).json({ error: "Aucune modification fournie." });
  }

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: profile, error: readError } = await supabase
        .from("vendor_profiles").select("id").eq("user_id", authUser.id).maybeSingle();
      if (readError) throw readError;
      if (!profile) return res.status(404).json({ error: "Aucune fiche prestataire pour ce compte." });

      if (maj.alias) {
        const { data: existing } = await supabase
          .from("vendor_profiles").select("id").ilike("alias", maj.alias).neq("id", profile.id).maybeSingle();
        if (existing) return res.status(409).json({ error: "Cet alias est déjà pris." });
      }

      if (Object.keys(maj).length > 0) {
        const { error: updateError } = await supabase.from("vendor_profiles").update(maj).eq("id", profile.id);
        if (updateError) {
          if ((updateError as any).code === "23505") return res.status(409).json({ error: "Cet alias est déjà pris." });
          throw updateError;
        }
      }

      if (resolvedCategorySlugs) {
        await supabase.from("vendor_profile_categories").delete().eq("vendor_id", profile.id);
        await supabase.from("vendor_profile_categories").insert(
          resolvedCategorySlugs.map((slug) => ({ vendor_id: profile.id, category_slug: slug }))
        );
      }

      return res.json({ success: true });
    } catch (err: any) {
      console.error("[Supabase Error] Mise à jour du profil prestataire :", err.message);
      return res.status(500).json({ error: "Échec de la mise à jour du profil." });
    }
  }

  const db = getDB();
  const profile = (db.vendorProfiles || []).find((p: any) => p.userId === authUser.id) as any;
  if (!profile) return res.status(404).json({ error: "Aucune fiche prestataire pour ce compte." });

  if (maj.alias) {
    const taken = (db.vendorProfiles || []).some((p: any) =>
      p.id !== profile.id && String(p.alias || "").toLowerCase() === maj.alias
    );
    if (taken) return res.status(409).json({ error: "Cet alias est déjà pris." });
    profile.alias = maj.alias;
  }
  if (maj.business_name !== undefined) profile.businessName = maj.business_name;
  if (maj.phone !== undefined) profile.phone = maj.phone;
  if (maj.city !== undefined) profile.city = maj.city;
  if (maj.description !== undefined) profile.description = maj.description;
  if (maj.cover_image !== undefined) profile.coverImage = maj.cover_image;
  if (maj.portfolio_images !== undefined) profile.portfolioImages = maj.portfolio_images;
  if (resolvedCategorySlugs) profile.categorySlugs = resolvedCategorySlugs;
  saveDB(db);

  res.json({ success: true });
});

// Boîte de réception des demandes de devis reçues (formulaire public /p/:alias).
router.get("/api/vendor/leads", requireAuth, async (req: express.Request, res: express.Response) => {
  const authUser = req.user!;

  if (isSupabaseEnabled && supabase) {
    try {
      const { data: profile, error: profileError } = await supabase
        .from("vendor_profiles").select("id").eq("user_id", authUser.id).maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return res.status(404).json({ error: "Aucune fiche prestataire pour ce compte." });

      const { data, error } = await supabase
        .from("vendor_leads").select("*").eq("vendor_id", profile.id).order("created_at", { ascending: false });
      if (error) throw error;
      return res.json((data || []).map((l: any) => ({
        id: l.id,
        senderName: l.sender_name,
        senderEmail: l.sender_email,
        senderPhone: l.sender_phone || null,
        eventDate: l.event_date || null,
        message: l.message,
        createdAt: l.created_at,
      })));
    } catch (err: any) {
      console.error("[Supabase Error] Lecture des demandes de devis, repli sur db.json :", err.message);
    }
  }

  const db = getDB();
  const profile = (db.vendorProfiles || []).find((p: any) => p.userId === authUser.id);
  if (!profile) return res.status(404).json({ error: "Aucune fiche prestataire pour ce compte." });

  const leads = (db.vendorLeads || [])
    .filter((l: any) => l.vendorId === profile.id)
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((l: any) => ({
      id: l.id,
      senderName: l.senderName,
      senderEmail: l.senderEmail,
      senderPhone: l.senderPhone || null,
      eventDate: l.eventDate || null,
      message: l.message,
      createdAt: l.createdAt,
    }));
  res.json(leads);
});

export default router;
