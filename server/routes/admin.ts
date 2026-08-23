import express from "express";
import sharp from "sharp";
import { isSupabaseEnabled, supabase, supabaseAdmin } from "../lib/config.js";
import { getDB, saveDB } from "../lib/db.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { runInBackground } from "../lib/utils.js";
import { sendOrganizerPayoutStatusEmail } from "../lib/email.js";
import { getDefaultCommissionRate, computeCommissionBreakdown, fetchRevenueAggregates, fetchReportStats, MAX_LIST_ROWS } from "../lib/commission.js";
import { isPaidTicket } from "../lib/ticketPayment.js";
import { findTicketsByReference, confirmPaymentForTickets } from "../lib/paymentConfirmation.js";
import { decryptPayoutDetails } from "../lib/payoutEncryption.js";
import { getCategories, slugifyCategory, inValiderCacheCategories } from "../lib/categories.js";
import { getVendorCategories, inValiderCacheVendorCategories } from "../lib/vendorCategories.js";

const router = express.Router();

// Admin-specific Management APIs
router.get("/api/admin/stats", async (req: express.Request, res: express.Response) => {
  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { data: users, error: uErr } = await adminClient.from("users").select("*").limit(MAX_LIST_ROWS);
      const { data: events, error: eErr } = await adminClient.from("events").select("*").limit(MAX_LIST_ROWS);
      // Les listes servent à l'affichage (tableaux, activité récente) et sont bornées ; les
      // TOTAUX, eux, ne doivent jamais en dépendre — cf. commentaire de MAX_LIST_ROWS.
      const { data: tickets, error: tErr } = await adminClient
        .from("tickets")
        .select("*")
        .order("purchase_date", { ascending: false })
        .limit(MAX_LIST_ROWS);

      if (uErr) throw uErr;
      if (eErr) throw eErr;
      if (tErr) throw tErr;

      const matchedTickets = tickets || [];
      const defaultCommissionRate = await getDefaultCommissionRate();
      const eventCommissionRateById = new Map((events || []).map((e: any) => [e.id, e.commission_rate != null ? Number(e.commission_rate) : null]));

      const [aggregates, report] = await Promise.all([
        fetchRevenueAggregates(adminClient, null),
        fetchReportStats(adminClient, null),
      ]);
      const fallback = () => {
        const b = computeCommissionBreakdown(matchedTickets, eventCommissionRateById, defaultCommissionRate);
        return {
          totalRevenue: b.totalGrossRevenue,
          totalPlatformCommission: b.totalCommission,
          commissionRate: b.effectiveCommissionRate,
          totalTicketsSold: matchedTickets.filter(isPaidTicket).reduce((sum: number, t: any) => sum + Number(t.quantity || 1), 0),
        };
      };
      const { totalRevenue, totalPlatformCommission, commissionRate, totalTicketsSold } = aggregates ?? fallback();
      const totalOrganizerPayout = totalRevenue - totalPlatformCommission;

      const [{ count: usersCount }, { count: eventsCount }] = await Promise.all([
        adminClient.from("users").select("id", { count: "exact", head: true }),
        adminClient.from("events").select("id", { count: "exact", head: true }),
      ]);
      const totalUsers = usersCount ?? (users || []).length;
      const totalEvents = eventsCount ?? (events || []).length;

      const mappedUsers = (users || []).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, publicCode: u.public_code || null }));
      const mappedEvents = (events || []).map(e => ({
        id: e.id,
        title: e.title,
        description: e.description,
        date: e.date,
        time: e.time,
        endDate: e.end_date ?? null,
        endTime: e.end_time ?? null,
        price: Number(e.price),
        venue: e.venue,
        category: e.category,
        categorySlug: e.category_slug,
        banner: e.banner,
        ticketsSold: e.tickets_sold ?? 0,
        totalTickets: e.total_tickets,
        organizerId: e.organizer_id,
        organizerName: e.organizer_name,
        status: e.status || "approved",
        scheduledOnsale: e.scheduled_onsale,
        commissionRate: e.commission_rate != null ? Number(e.commission_rate) : null
      }));
      const mappedTickets = matchedTickets.map(t => ({
        id: t.id,
        eventId: t.event_id,
        eventTitle: t.event_title,
        eventDate: t.event_date,
        eventTime: t.event_time,
        eventVenue: t.event_venue,
        buyerId: t.buyer_id,
        buyerName: t.buyer_name,
        buyerEmail: t.buyer_email,
        tier: t.tier,
        pricePaid: Number(t.price_paid),
        qrCodeData: t.qr_code_data,
        scanned: t.scanned,
        scannedAt: t.scanned_at,
        transactionRef: t.transaction_ref,
        purchaseDate: t.purchase_date,
        quantity: t.quantity,
        paymentStatus: t.transaction_ref?.startsWith("PENDING-") ? "pending" : "paid"
      }));

      return res.json({
        totalRevenue,
        totalPlatformCommission,
        totalOrganizerPayout,
        commissionRate,
        totalTicketsSold,
        totalUsers,
        totalEvents,
        users: mappedUsers,
        events: mappedEvents,
        tickets: mappedTickets,
        // Indicateurs agrégés en base : exacts quel que soit le volume, contrairement au
        // calcul local que les écrans font à partir de la liste bornée ci-dessus.
        report
      });
    } catch (err: any) {
      console.error("[Supabase Error] Admin stats, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const defaultCommissionRate = await getDefaultCommissionRate();
  const eventCommissionRateById = new Map<string, number | null>(db.events.map((e: any) => [e.id, e.commissionRate != null ? Number(e.commissionRate) : null]));
  const { totalGrossRevenue: totalRevenue, totalCommission: totalPlatformCommission, effectiveCommissionRate: commissionRate } = computeCommissionBreakdown(db.tickets, eventCommissionRateById, defaultCommissionRate);
  const totalOrganizerPayout = totalRevenue - totalPlatformCommission;
  
  const totalTicketsSold = db.tickets.filter(isPaidTicket).reduce((sum: number, t: any) => sum + t.quantity, 0);
  const totalUsers = db.users.length;
  const totalEvents = db.events.length;

  res.json({
    totalRevenue, // Gross
    totalPlatformCommission, // Commission collected by ClicBillet
    totalOrganizerPayout, // Net given out
    commissionRate,
    totalTicketsSold,
    totalUsers,
    totalEvents,
    users: db.users.map((u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role, publicCode: u.publicCode || null })),
    events: db.events,
    tickets: db.tickets.map(t => ({
      ...t,
      paymentStatus: t.transactionRef?.startsWith("PENDING-") ? "pending" : "paid"
    }))
  });
});

router.post("/api/admin/validate-payment", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  const { referenceNumber } = req.body;
  if (!referenceNumber) {
    return res.status(400).json({ error: "Référence ou ID du billet manquant." });
  }

  const resolvedTickets = await findTicketsByReference([referenceNumber]);
  if (resolvedTickets.length === 0) {
    return res.status(404).json({ error: "Billet introuvable." });
  }

  const confirmedCount = await confirmPaymentForTickets(resolvedTickets);
  const wasSupabase = resolvedTickets[0].source === "supabase";
  return res.json({
    success: true,
    message: wasSupabase ? "Paiement validé avec succès." : "Paiement validé localement.",
    confirmedCount
  });
});

router.delete("/api/admin/users/:id", async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  if (id === "usr-admin") {
    return res.status(400).json({ error: "Le compte administrateur principal ne peut pas être révoqué ou supprimé." });
  }

  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      // events.organizer_id n'est pas une clé étrangère vers users(id) (aucune contrainte en
      // base) : supprimer un organisateur ayant des événements approuvés les laisserait actifs
      // et achetables indéfiniment, sans plus personne pour les gérer ni réclamer les paiements
      // dus. On bloque plutôt que d'orpheliner silencieusement.
      const { count: activeEventsCount } = await adminClient
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("organizer_id", id)
        .eq("status", "approved");
      if ((activeEventsCount || 0) > 0) {
        return res.status(409).json({ error: `Cet organisateur a ${activeEventsCount} événement(s) approuvé(s) actif(s). Réaffectez-les ou rejetez-les avant de supprimer le compte.` });
      }

      // Supprime le compte Supabase Auth lui-même : sans ça, seule la ligne public.users
      // disparaît. auth.users (mot de passe compris) reste valide, et /api/auth/login recrée
      // automatiquement un profil (avec le rôle d'origine) à la prochaine connexion réussie —
      // la "suppression" ne révoquait donc rien en pratique.
      const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(id);
      if (authDeleteError && (authDeleteError as any).status !== 404) throw authDeleteError;

      const { error } = await adminClient
        .from("users")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return res.json({ success: true, message: "Compte utilisateur révoqué avec succès." });
    } catch (err: any) {
      console.error("[Supabase Error] Deleting user, falling back to local file DB:", err.message);
    }
  }

  const db = getDB();
  const index = db.users.findIndex(u => u.id === id);
  if (index !== -1) {
    db.users.splice(index, 1);
    saveDB(db);
    return res.json({ success: true, message: "Compte utilisateur révoqué avec succès." });
  }
  res.status(404).json({ error: "Utilisateur introuvable." });
});

router.get("/api/admin/payouts", async (req: express.Request, res: express.Response) => {
  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { data, error } = await adminClient.from("payouts").select("*").order("request_date", { ascending: false });
      if (!error) {
        return res.json(data.map((p: any) => ({
          ...p, organizerId: p.organizer_id, requestDate: p.request_date, details: decryptPayoutDetails(p.details)
        })));
      }
    } catch(e) {}
  }
  const db = getDB();
  res.json((db.payouts || []).map((p: any) => ({ ...p, details: decryptPayoutDetails(p.details) })));
});

const PAYOUT_STATUSES = ["pending", "completed", "rejected"];

router.patch("/api/admin/payouts/:id/status", async (req: express.Request, res: express.Response) => {
  const { status } = req.body;
  if (!PAYOUT_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Statut de retrait invalide." });
  }
  if (isSupabaseEnabled && supabase) {
    try {
      const { data: updatedPayout, error } = await supabase.from("payouts").update({ status }).eq("id", req.params.id).select().maybeSingle();
      if (!error) {
        if (updatedPayout) {
          try {
            const { data: organizerUser } = await supabase.from("users").select("email,name").eq("id", updatedPayout.organizer_id).maybeSingle();
            const mappedPayout = { ...updatedPayout, organizerId: updatedPayout.organizer_id, requestDate: updatedPayout.request_date };
            runInBackground(sendOrganizerPayoutStatusEmail(organizerUser?.email, organizerUser?.name || updatedPayout.organizer_id, mappedPayout));
          } catch (e: any) {
            console.warn("[Email] Notification organisateur (statut retrait) échouée :", e.message);
          }
        }
        return res.json({ success: true });
      }
    } catch(e) {}
  }
  const db = getDB();
  db.payouts = db.payouts || [];
  const p = db.payouts.find(p => p.id === req.params.id);
  if (p) {
    p.status = status;
    saveDB(db);

    try {
      const organizerUser = db.users.find((u: any) => u.id === (p as any).organizerId);
      runInBackground(sendOrganizerPayoutStatusEmail(organizerUser?.email, organizerUser?.name || (p as any).organizerId, p));
    } catch (e: any) {
      console.warn("[Email] Notification organisateur (statut retrait) échouée :", e.message);
    }

    return res.json({ success: true });
  }
  res.status(404).json({ error: "Introuvable" });
});

// --- Transactions History ---
router.get("/api/admin/transactions", async (req: express.Request, res: express.Response) => {
  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const { data, error } = await adminClient.from("transactions").select("*").order("date", { ascending: false });
      if (!error) return res.json(data.map((t: any) => ({...t, eventId: t.event_id, buyerEmail: t.buyer_email, errorDetails: t.error_details})));
    } catch(e) {}
  }
  const db = getDB();
  res.json(db.transactions || []);
});

// --- Maintenance ponctuelle : recompresse les bannières d'événements déjà stockées en
// base64 brut (uploadées avant que le client ne les redimensionne lui-même côté navigateur,
// cf. src/lib/imageCompress.ts). Une bannière de plusieurs Mo est renvoyée intégralement
// dans /api/events à chaque visiteur — équivalent HTTP de scripts/compress-existing-banners.mjs,
// pensé pour être déclenché depuis le dashboard admin sans accès terminal ni identifiants
// Supabase à manipuler. Par défaut en aperçu (dryRun) ; { apply: true } pour appliquer.
const BANNER_SKIP_THRESHOLD_BYTES = 300 * 1024;
const BANNER_MAX_WIDTH = 1280;
const BANNER_JPEG_QUALITY = 80;

function parseBannerDataUrl(dataUrl: string): { buffer: Buffer } | null {
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { buffer: Buffer.from(match[1], "base64") };
}

router.post("/api/admin/compress-banners", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  const adminClient = supabaseAdmin;
  if (!adminClient) {
    return res.status(400).json({ error: "Supabase non configuré." });
  }

  const apply = req.body?.apply === true;

  const { data: events, error } = await adminClient
    .from("events")
    .select("id, title, banner")
    .like("banner", "data:image%");

  if (error) {
    return res.status(500).json({ error: "Échec de la lecture des événements : " + error.message });
  }

  const details: { id: string; title: string; beforeMB: number; afterMB: number }[] = [];
  let processed = 0, skipped = 0, failed = 0, totalBefore = 0, totalAfter = 0;

  for (const evt of events || []) {
    const originalSize = evt.banner.length;
    if (originalSize <= BANNER_SKIP_THRESHOLD_BYTES) {
      skipped++;
      continue;
    }

    const parsed = parseBannerDataUrl(evt.banner);
    if (!parsed) {
      failed++;
      continue;
    }

    try {
      const resizedBuffer = await sharp(parsed.buffer)
        .resize({ width: BANNER_MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: BANNER_JPEG_QUALITY })
        .toBuffer();
      const newDataUrl = `data:image/jpeg;base64,${resizedBuffer.toString("base64")}`;

      if (newDataUrl.length >= originalSize) {
        skipped++;
        continue;
      }

      totalBefore += originalSize;
      totalAfter += newDataUrl.length;
      processed++;
      details.push({
        id: evt.id,
        title: evt.title,
        beforeMB: Number((originalSize / 1024 / 1024).toFixed(2)),
        afterMB: Number((newDataUrl.length / 1024 / 1024).toFixed(2)),
      });

      if (apply) {
        const { error: updateError } = await adminClient.from("events").update({ banner: newDataUrl }).eq("id", evt.id);
        if (updateError) {
          failed++;
          processed--;
        }
      }
    } catch {
      failed++;
    }
  }

  res.json({
    dryRun: !apply,
    processed,
    skipped,
    failed,
    totalBeforeMB: Number((totalBefore / 1024 / 1024).toFixed(2)),
    totalAfterMB: Number((totalAfter / 1024 / 1024).toFixed(2)),
    details,
  });
});




// ==========================================
// RÉFÉRENTIEL DES CATÉGORIES (onglet Configuration)
// ==========================================
// Ajouter une catégorie demandait jusqu'ici de modifier deux fichiers du code et de
// redéployer. C'est une décision éditoriale, pas un changement de logiciel : elle se prend
// donc depuis l'interface d'administration.

router.get("/api/admin/categories", requireAuth, requireRole("admin"), async (_req: express.Request, res: express.Response) => {
  // `true` : les catégories désactivées comprises — c'est précisément l'écran où on les gère.
  res.json(await getCategories(true));
});

router.post("/api/admin/categories", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  if (!isSupabaseEnabled || !supabase) {
    return res.status(503).json({ error: "Référentiel indisponible sans base de données." });
  }
  const label = String(req.body?.label || "").trim();
  if (label.length < 2 || label.length > 60) {
    return res.status(400).json({ error: "Le nom de la catégorie doit faire entre 2 et 60 caractères." });
  }

  // La clé est DÉRIVÉE du libellé, jamais saisie : c'est ce qui garantit qu'elle reste
  // normalisée, et donc comparable, quoi qu'on tape dans le champ.
  const slug = slugifyCategory(label);
  if (!slug) {
    return res.status(400).json({ error: "Ce nom ne produit aucune clé exploitable. Utilisez au moins une lettre ou un chiffre." });
  }

  const { data: existante } = await supabase.from("categories").select("slug, label, active").eq("slug", slug).maybeSingle();
  if (existante) {
    // Une catégorie reprise d'une ancienne saisie libre est désactivée : la « recréer »
    // revient à la réactiver, plutôt que de renvoyer une erreur incompréhensible sur une
    // catégorie que l'administrateur ne voit pas dans sa liste active.
    if (!existante.active) {
      await supabase.from("categories").update({ label, active: true }).eq("slug", slug);
      inValiderCacheCategories();
      return res.status(200).json({ slug, label, reactivee: true });
    }
    return res.status(409).json({ error: `La catégorie « ${existante.label} » existe déjà.` });
  }

  const { data: derniere } = await supabase
    .from("categories").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();

  const { error } = await supabase.from("categories").insert({
    slug,
    label,
    icon: String(req.body?.icon || "Tag"),
    sort_order: (Number(derniere?.sort_order) || 0) + 10,
    active: true
  });
  if (error) return res.status(500).json({ error: "Création impossible." });

  inValiderCacheCategories();
  res.status(201).json({ slug, label });
});

router.patch("/api/admin/categories/:slug", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  if (!isSupabaseEnabled || !supabase) {
    return res.status(503).json({ error: "Référentiel indisponible sans base de données." });
  }
  const maj: Record<string, any> = {};

  // Le libellé se renomme librement ; la CLÉ ne bouge pas. C'est tout l'intérêt de les avoir
  // séparés : rebaptiser « Théâtre & Humour » en « Spectacles » ne touche aucun événement et
  // ne casse aucun lien partagé.
  if (typeof req.body?.label === "string") {
    const label = req.body.label.trim();
    if (label.length < 2 || label.length > 60) {
      return res.status(400).json({ error: "Le nom de la catégorie doit faire entre 2 et 60 caractères." });
    }
    maj.label = label;
  }
  if (typeof req.body?.active === "boolean") maj.active = req.body.active;
  if (typeof req.body?.icon === "string") maj.icon = req.body.icon;
  if (Number.isFinite(Number(req.body?.sortOrder))) maj.sort_order = Number(req.body.sortOrder);

  if (Object.keys(maj).length === 0) {
    return res.status(400).json({ error: "Aucune modification fournie." });
  }

  const { error } = await supabase.from("categories").update(maj).eq("slug", req.params.slug);
  if (error) return res.status(500).json({ error: "Modification impossible." });

  inValiderCacheCategories();
  res.json({ success: true });
});

router.delete("/api/admin/categories/:slug", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  if (!isSupabaseEnabled || !supabase) {
    return res.status(503).json({ error: "Référentiel indisponible sans base de données." });
  }
  const slug = req.params.slug;

  // Une catégorie portée par des événements n'est jamais supprimée : elle est DÉSACTIVÉE.
  // La supprimer laisserait ces événements sans catégorie valide — la contrainte d'intégrité
  // le refuserait de toute façon, mais avec un message que personne ne peut interpréter.
  const { count } = await supabase
    .from("events").select("id", { count: "exact", head: true }).eq("category_slug", slug);

  if ((count || 0) > 0) {
    const { error } = await supabase.from("categories").update({ active: false }).eq("slug", slug);
    if (error) return res.status(500).json({ error: "Désactivation impossible." });
    inValiderCacheCategories();
    return res.json({
      success: true,
      desactivee: true,
      evenements: count,
      message: `${count} événement(s) utilisent cette catégorie : elle a été retirée des listes sans être supprimée, pour ne pas les laisser sans catégorie.`
    });
  }

  const { error } = await supabase.from("categories").delete().eq("slug", slug);
  if (error) return res.status(500).json({ error: "Suppression impossible." });
  inValiderCacheCategories();
  res.json({ success: true, desactivee: false });
});

// ==========================================
// CATÉGORIES DE PRESTATAIRES (marché prestataires)
// ==========================================
// Même gabarit que /api/admin/categories ci-dessus, référentiel séparé (supabase_setup.sql
// section 30) : les catégories d'événements et de prestataires n'ont pas vocation à évoluer
// ensemble.

router.get("/api/admin/vendor-categories", requireAuth, requireRole("admin"), async (_req: express.Request, res: express.Response) => {
  res.json(await getVendorCategories(true));
});

router.post("/api/admin/vendor-categories", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  if (!isSupabaseEnabled || !supabase) {
    return res.status(503).json({ error: "Référentiel indisponible sans base de données." });
  }
  const label = String(req.body?.label || "").trim();
  if (label.length < 2 || label.length > 60) {
    return res.status(400).json({ error: "Le nom de la catégorie doit faire entre 2 et 60 caractères." });
  }

  const slug = slugifyCategory(label);
  if (!slug) {
    return res.status(400).json({ error: "Ce nom ne produit aucune clé exploitable. Utilisez au moins une lettre ou un chiffre." });
  }

  const { data: existante } = await supabase.from("vendor_categories").select("slug, label, active").eq("slug", slug).maybeSingle();
  if (existante) {
    if (!existante.active) {
      await supabase.from("vendor_categories").update({ label, active: true }).eq("slug", slug);
      inValiderCacheVendorCategories();
      return res.status(200).json({ slug, label, reactivee: true });
    }
    return res.status(409).json({ error: `La catégorie « ${existante.label} » existe déjà.` });
  }

  const { data: derniere } = await supabase
    .from("vendor_categories").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();

  const { error } = await supabase.from("vendor_categories").insert({
    slug,
    label,
    icon: String(req.body?.icon || "Tag"),
    sort_order: (Number(derniere?.sort_order) || 0) + 10,
    active: true
  });
  if (error) return res.status(500).json({ error: "Création impossible." });

  inValiderCacheVendorCategories();
  res.status(201).json({ slug, label });
});

router.patch("/api/admin/vendor-categories/:slug", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  if (!isSupabaseEnabled || !supabase) {
    return res.status(503).json({ error: "Référentiel indisponible sans base de données." });
  }
  const maj: Record<string, any> = {};

  if (typeof req.body?.label === "string") {
    const label = req.body.label.trim();
    if (label.length < 2 || label.length > 60) {
      return res.status(400).json({ error: "Le nom de la catégorie doit faire entre 2 et 60 caractères." });
    }
    maj.label = label;
  }
  if (typeof req.body?.active === "boolean") maj.active = req.body.active;
  if (typeof req.body?.icon === "string") maj.icon = req.body.icon;
  if (Number.isFinite(Number(req.body?.sortOrder))) maj.sort_order = Number(req.body.sortOrder);

  if (Object.keys(maj).length === 0) {
    return res.status(400).json({ error: "Aucune modification fournie." });
  }

  const { error } = await supabase.from("vendor_categories").update(maj).eq("slug", req.params.slug);
  if (error) return res.status(500).json({ error: "Modification impossible." });

  inValiderCacheVendorCategories();
  res.json({ success: true });
});

router.delete("/api/admin/vendor-categories/:slug", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  if (!isSupabaseEnabled || !supabase) {
    return res.status(503).json({ error: "Référentiel indisponible sans base de données." });
  }
  const slug = req.params.slug;

  // Une catégorie portée par des fiches prestataire n'est jamais supprimée : elle est
  // DÉSACTIVÉE, comme pour les catégories d'événements.
  const { count } = await supabase
    .from("vendor_profile_categories").select("vendor_id", { count: "exact", head: true }).eq("category_slug", slug);

  if ((count || 0) > 0) {
    const { error } = await supabase.from("vendor_categories").update({ active: false }).eq("slug", slug);
    if (error) return res.status(500).json({ error: "Désactivation impossible." });
    inValiderCacheVendorCategories();
    return res.json({
      success: true,
      desactivee: true,
      prestataires: count,
      message: `${count} fiche(s) prestataire utilisent cette catégorie : elle a été retirée des listes sans être supprimée, pour ne pas les laisser sans catégorie.`
    });
  }

  const { error } = await supabase.from("vendor_categories").delete().eq("slug", slug);
  if (error) return res.status(500).json({ error: "Suppression impossible." });
  inValiderCacheVendorCategories();
  res.json({ success: true, desactivee: false });
});

// Suspension d'une fiche prestataire (abus, litige signalé) : la fiche disparaît du marché
// public et de la recherche, sans être supprimée — l'historique des demandes de devis déjà
// reçues (vendor_leads) reste intact, et la réactivation est immédiate.
router.patch("/api/admin/vendors/:id/active", requireAuth, requireRole("admin"), async (req: express.Request, res: express.Response) => {
  const { active } = req.body;
  if (typeof active !== "boolean") {
    return res.status(400).json({ error: "Le champ 'active' (booléen) est requis." });
  }

  if (isSupabaseEnabled && supabase) {
    try {
      const { error } = await supabase.from("vendor_profiles").update({ active }).eq("id", req.params.id);
      if (error) throw error;
      return res.json({ success: true, active });
    } catch (err: any) {
      console.error("[Supabase Error] Suspension de la fiche prestataire :", err.message);
      return res.status(500).json({ error: "Modification impossible." });
    }
  }

  const db = getDB();
  const profile = (db.vendorProfiles || []).find((p: any) => p.id === req.params.id) as any;
  if (!profile) return res.status(404).json({ error: "Fiche prestataire introuvable." });
  profile.active = active;
  saveDB(db);
  res.json({ success: true, active });
});

// Suivi du marché de prestataires : rien n'était visible entre la file de modération (combien
// de demandes en attente) et le catalogue public (quelles fiches sont en ligne). Sans ces
// chiffres — fiches réellement publiées, devis reçus par catégorie, prestataires qui
// convertissent le mieux — décider quand et comment introduire un abonnement resterait un
// pari plutôt qu'une décision informée par l'usage réel.
router.get("/api/admin/vendor-stats", requireAuth, requireRole("admin"), async (_req: express.Request, res: express.Response) => {
  const categories = await getVendorCategories(true);
  const labelBySlug = new Map(categories.map((c) => [c.slug, c.label]));

  const adminClient = supabaseAdmin;
  if (adminClient) {
    try {
      const [{ data: requests, error: reqErr }, { data: profiles, error: profErr }, { data: profileCats, error: catErr }, { data: leads, error: leadErr }] = await Promise.all([
        adminClient.from("vendor_requests").select("status").limit(MAX_LIST_ROWS),
        adminClient.from("vendor_profiles").select("id, business_name, alias, active, created_at").limit(MAX_LIST_ROWS),
        adminClient.from("vendor_profile_categories").select("vendor_id, category_slug").limit(MAX_LIST_ROWS),
        adminClient.from("vendor_leads").select("vendor_id, created_at").limit(MAX_LIST_ROWS),
      ]);
      if (reqErr) throw reqErr;
      if (profErr) throw profErr;
      if (catErr) throw catErr;
      if (leadErr) throw leadErr;

      return res.json(buildVendorStats(
        (requests || []).map((r: any) => ({ status: r.status })),
        (profiles || []).map((p: any) => ({ id: p.id, businessName: p.business_name, alias: p.alias, active: p.active !== false })),
        (profileCats || []).map((c: any) => ({ vendorId: c.vendor_id, categorySlug: c.category_slug })),
        (leads || []).map((l: any) => ({ vendorId: l.vendor_id, createdAt: l.created_at })),
        labelBySlug
      ));
    } catch (err: any) {
      console.error("[Supabase Error] Statistiques prestataires, repli sur db.json :", err.message);
    }
  }

  const db = getDB();
  return res.json(buildVendorStats(
    (db.vendorRequests || []).map((r: any) => ({ status: r.status })),
    (db.vendorProfiles || []).map((p: any) => ({ id: p.id, businessName: p.businessName, alias: p.alias, active: p.active !== false })),
    (db.vendorProfiles || []).flatMap((p: any) => (p.categorySlugs || []).map((slug: string) => ({ vendorId: p.id, categorySlug: slug }))),
    (db.vendorLeads || []).map((l: any) => ({ vendorId: l.vendorId, createdAt: l.createdAt })),
    labelBySlug
  ));
});

function buildVendorStats(
  requests: { status: string }[],
  profiles: { id: string; businessName: string; alias: string | null; active: boolean }[],
  profileCategories: { vendorId: string; categorySlug: string }[],
  leads: { vendorId: string; createdAt: string }[],
  labelBySlug: Map<string, string>
) {
  const activeProfiles = profiles.filter((p) => p.active && p.alias);
  // Approuvée mais sans alias choisi : la fiche existe mais n'apparaît nulle part sur le
  // marché public — c'est le décrochage entre "validé par l'admin" et "réellement en ligne".
  const incompleteProfiles = profiles.filter((p) => p.active && !p.alias);
  const suspendedProfiles = profiles.filter((p) => !p.active);

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const leadsLast30Days = leads.filter((l) => new Date(l.createdAt).getTime() >= thirtyDaysAgo).length;

  const activeProfileIds = new Set(activeProfiles.map((p) => p.id));
  const categorySlugsByVendor = new Map<string, string[]>();
  for (const c of profileCategories) {
    if (!categorySlugsByVendor.has(c.vendorId)) categorySlugsByVendor.set(c.vendorId, []);
    categorySlugsByVendor.get(c.vendorId)!.push(c.categorySlug);
  }

  const leadCountByVendor = new Map<string, number>();
  for (const l of leads) {
    leadCountByVendor.set(l.vendorId, (leadCountByVendor.get(l.vendorId) || 0) + 1);
  }

  const activeProfilesBySlug = new Map<string, number>();
  const leadsBySlug = new Map<string, number>();
  for (const [vendorId, slugs] of categorySlugsByVendor) {
    const isActive = activeProfileIds.has(vendorId);
    const vendorLeadCount = leadCountByVendor.get(vendorId) || 0;
    for (const slug of slugs) {
      if (isActive) activeProfilesBySlug.set(slug, (activeProfilesBySlug.get(slug) || 0) + 1);
      leadsBySlug.set(slug, (leadsBySlug.get(slug) || 0) + vendorLeadCount);
    }
  }

  const byCategory = [...new Set([...activeProfilesBySlug.keys(), ...leadsBySlug.keys()])]
    .map((slug) => ({
      slug,
      label: labelBySlug.get(slug) || slug,
      activeProfiles: activeProfilesBySlug.get(slug) || 0,
      leads: leadsBySlug.get(slug) || 0,
    }))
    .sort((a, b) => b.leads - a.leads);

  const topVendors = activeProfiles
    .map((p) => ({ id: p.id, businessName: p.businessName, alias: p.alias, leads: leadCountByVendor.get(p.id) || 0 }))
    .sort((a, b) => b.leads - a.leads)
    .slice(0, 5);

  return {
    requests: {
      total: requests.length,
      pending: requests.filter((r) => r.status === "pending").length,
      approved: requests.filter((r) => r.status === "approved").length,
      rejected: requests.filter((r) => r.status === "rejected").length,
    },
    profiles: {
      total: profiles.length,
      active: activeProfiles.length,
      incomplete: incompleteProfiles.length,
      suspended: suspendedProfiles.length,
    },
    leads: {
      total: leads.length,
      last30Days: leadsLast30Days,
    },
    byCategory,
    topVendors,
  };
}

export default router;
