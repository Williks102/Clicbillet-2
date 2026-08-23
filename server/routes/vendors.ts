import express from "express";
import crypto from "crypto";
import { isSupabaseEnabled, supabase } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { getVendorCategories } from "../lib/vendorCategories.js";
import { runInBackground } from "../lib/utils.js";
import { sendVendorLeadEmail } from "../lib/email.js";
import { vendorLeadRateLimiter } from "../lib/rateLimiters.js";
import { validateVendorLead } from "../lib/validators.js";

// Marché des prestataires événementiels (photographe, régie, MC...) : routes publiques.
// Voir server/routes/vendorRequests.ts (demande de fiche + modération) et
// server/routes/vendor.ts (tableau de bord authentifié, phase suivante).

const router = express.Router();

router.get("/api/vendor-categories", async (_req: express.Request, res: express.Response) => {
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  res.json(await getVendorCategories());
});

// Preuve sociale affichée sur la bande "Nous rejoindre" (JoinVendorCta.tsx) et le marché
// public : deux compteurs seulement, jamais le détail. Le détail par catégorie/prestataire
// reste réservé à GET /api/admin/vendor-stats (server/routes/admin.ts), qui sert à décider
// d'une formule d'abonnement — celui-ci sert à donner confiance à un visiteur.
router.get("/api/vendor-stats/public", async (_req: express.Request, res: express.Response) => {
  res.set("Cache-Control", "public, max-age=120, stale-while-revalidate=600");

  if (isSupabaseEnabled && supabase) {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [{ count: activeVendors, error: profErr }, { count: leadsLast30Days, error: leadErr }] = await Promise.all([
        supabase.from("vendor_profiles_public").select("id", { count: "exact", head: true }),
        supabase.from("vendor_leads").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
      ]);
      if (profErr) throw profErr;
      if (leadErr) throw leadErr;
      return res.json({ activeVendors: activeVendors || 0, leadsLast30Days: leadsLast30Days || 0 });
    } catch (err: any) {
      console.error("[Supabase Error] Statistiques publiques prestataires, repli sur db.json :", err.message);
    }
  }

  const db = getDB();
  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const activeVendors = (db.vendorProfiles || []).filter((p: any) => p.active !== false && p.alias).length;
  const leadsLast30Days = (db.vendorLeads || []).filter((l: any) => new Date(l.createdAt).getTime() >= thirtyDaysAgoMs).length;
  res.json({ activeVendors, leadsLast30Days });
});

function mapPublicProfile(row: any): any {
  return {
    id: row.id,
    alias: row.alias,
    businessName: row.business_name,
    city: row.city,
    description: row.description || null,
    coverImage: row.cover_image || null,
    portfolioImages: row.portfolio_images || [],
    categorySlugs: row.category_slugs || [],
    foundingMember: row.founding_member === true,
    createdAt: row.created_at,
  };
}

function mapLocalProfile(row: any): any {
  return {
    id: row.id,
    alias: row.alias,
    businessName: row.businessName,
    city: row.city,
    description: row.description || null,
    coverImage: row.coverImage || null,
    portfolioImages: row.portfolioImages || [],
    categorySlugs: row.categorySlugs || [],
    foundingMember: row.foundingMember === true,
    createdAt: row.createdAt,
  };
}

// Catalogue public des fiches prestataires, filtrable par catégorie et par ville — même esprit
// que GET /api/events?category=. Lecture seule, aucune authentification requise.
router.get("/api/vendors", async (req: express.Request, res: express.Response) => {
  const { category, city } = req.query;
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");

  if (isSupabaseEnabled && supabase) {
    try {
      let query = supabase.from("vendor_profiles_public").select("*").order("created_at", { ascending: false });
      if (category) query = query.contains("category_slugs", [String(category)]);
      if (city) query = query.ilike("city", `%${String(city).trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      return res.json((data || []).map(mapPublicProfile));
    } catch (err: any) {
      console.error("[Supabase Error] Liste des prestataires, repli sur db.json :", err.message);
    }
  }

  const db = getDB();
  const profiles = (db.vendorProfiles || []).filter((p: any) => p.active !== false && p.alias);
  const filtered = profiles.filter((p: any) => {
    if (category && !(p.categorySlugs || []).includes(String(category))) return false;
    if (city && !String(p.city || "").toLowerCase().includes(String(city).trim().toLowerCase())) return false;
    return true;
  });
  res.json(filtered.map(mapLocalProfile));
});

// Fiche publique d'un prestataire (/p/:alias côté frontend), jumeau de
// GET /api/organizers/:alias (server/routes/events.ts).
router.get("/api/vendors/:alias", async (req: express.Request, res: express.Response) => {
  const alias = String(req.params.alias || "").trim().toLowerCase();
  if (!alias) return res.status(404).json({ error: "Prestataire introuvable." });

  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");

  if (isSupabaseEnabled && supabase) {
    try {
      const { data, error } = await supabase
        .from("vendor_profiles_public")
        .select("*")
        .ilike("alias", alias)
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Prestataire introuvable." });
      return res.json({ vendor: mapPublicProfile(data) });
    } catch (err: any) {
      console.error("[Supabase Error] Fiche prestataire, repli sur db.json :", err.message);
    }
  }

  const db = getDB();
  const profile = (db.vendorProfiles || []).find((p: any) =>
    p.active !== false && String(p.alias || "").toLowerCase() === alias
  );
  if (!profile) return res.status(404).json({ error: "Prestataire introuvable." });
  res.json({ vendor: mapLocalProfile(profile) });
});

// Formulaire public de demande de devis (fiche prestataire) : pas d'authentification requise
// — mêmes visiteurs que le catalogue d'événements. Écrit dans vendor_leads (boîte de
// réception du tableau de bord prestataire) puis relaie un e-mail au prestataire, best-effort
// comme tous les autres envois du projet.
router.post(
  "/api/vendors/:alias/contact",
  vendorLeadRateLimiter,
  validateVendorLead,
  async (req: express.Request, res: express.Response) => {
    const alias = String(req.params.alias || "").trim().toLowerCase();
    const { name, email, phone, eventDate, message } = req.body;

    if (isSupabaseEnabled && supabase) {
      try {
        const { data: vendor, error: vendorError } = await supabase
          .from("vendor_profiles")
          .select("id, user_id, business_name, active")
          .ilike("alias", alias)
          .maybeSingle();
        if (vendorError) throw vendorError;
        if (!vendor || vendor.active === false) {
          return res.status(404).json({ error: "Prestataire introuvable." });
        }

        const { data: vendorUser } = await supabase.from("users").select("email").eq("id", vendor.user_id).maybeSingle();

        const { error: insertError } = await supabase.from("vendor_leads").insert({
          id: `lead-${crypto.randomUUID()}`,
          vendor_id: vendor.id,
          sender_name: String(name).trim(),
          sender_email: String(email).trim(),
          sender_phone: phone ? String(phone).trim() : null,
          event_date: eventDate ? String(eventDate).trim() : null,
          message: String(message).trim(),
        });
        if (insertError) throw insertError;

        runInBackground(sendVendorLeadEmail({
          vendorName: vendor.business_name,
          vendorEmail: vendorUser?.email || "",
          senderName: name,
          senderEmail: email,
          senderPhone: phone || null,
          eventDate: eventDate || null,
          message,
        }));

        return res.json({ success: true });
      } catch (err: any) {
        console.error("[Supabase Error] Envoi de la demande de devis :", err.message);
        return res.status(500).json({ error: "Impossible d'envoyer votre demande pour le moment." });
      }
    }

    const db = getDB();
    const vendor = (db.vendorProfiles || []).find((p: any) =>
      p.active !== false && String(p.alias || "").toLowerCase() === alias
    );
    if (!vendor) return res.status(404).json({ error: "Prestataire introuvable." });

    const vendorUser = (db.users || []).find((u: any) => u.id === vendor.userId) as any;
    if (!Array.isArray(db.vendorLeads)) db.vendorLeads = [];
    db.vendorLeads.push({
      id: `lead-${crypto.randomUUID()}`,
      vendorId: vendor.id,
      senderName: String(name).trim(),
      senderEmail: String(email).trim(),
      senderPhone: phone ? String(phone).trim() : null,
      eventDate: eventDate ? String(eventDate).trim() : null,
      message: String(message).trim(),
      createdAt: new Date().toISOString(),
    });
    saveDB(db);

    runInBackground(sendVendorLeadEmail({
      vendorName: vendor.businessName,
      vendorEmail: vendorUser?.email || "",
      senderName: name,
      senderEmail: email,
      senderPhone: phone || null,
      eventDate: eventDate || null,
      message,
    }));

    res.json({ success: true });
  }
);

export default router;
