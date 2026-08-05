import { isSupabaseEnabled, supabase, APP_ORIGIN } from "./config.js";
import { getDB } from "./db.js";

// Aperçu de partage (Open Graph / Twitter Cards) pour les pages d'événement.
//
// WhatsApp, Facebook, X et consorts n'exécutent PAS le JavaScript : ils lisent le HTML brut
// renvoyé par le serveur. Une application en page unique leur renvoie donc toujours le même
// index.html générique, quel que soit l'événement partagé — un lien nu, sans affiche ni titre.
// Ces balises doivent donc être injectées côté serveur, avant livraison (cf. la route /e/:id
// dans server.ts), et pas depuis le navigateur.
//
// Seuls les événements APPROUVÉS reçoivent un aperçu : un événement en attente de modération
// ou rejeté ne doit pas se retrouver mis en avant dans une conversation.

export interface PreviewEvent {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  venue: string;
  banner: string;
  price: number;
}

// Échappement pour insertion dans un attribut HTML (content="..."). Le titre, le lieu et la
// description sont saisis par l'organisateur : sans cet échappement, un guillemet suffirait à
// sortir de l'attribut et à injecter du balisage arbitraire dans la page servie à tous.
function escapeAttribute(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatEventDateFr(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Récupère un événement publiquement partageable. Renvoie null si l'identifiant est inconnu ou
// si l'événement n'est pas approuvé — l'appelant sert alors la page normale, sans aperçu.
export async function findPublicEventById(id: string): Promise<PreviewEvent | null> {
  if (!id) return null;

  if (isSupabaseEnabled && supabase) {
    try {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, description, date, time, venue, banner, price, status")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      // Un status absent correspond aux lignes créées avant l'introduction de la colonne :
      // elles sont considérées approuvées, comme partout ailleurs dans le code.
      if (!data || (data.status && data.status !== "approved")) return null;
      return {
        id: data.id,
        title: data.title,
        description: data.description || "",
        date: data.date,
        time: data.time,
        venue: data.venue,
        banner: data.banner || "",
        price: Number(data.price) || 0,
      };
    } catch (err: any) {
      console.error("[Supabase Error] Lecture d'un événement pour l'aperçu de partage :", err.message);
    }
  }

  const db = getDB();
  const evt = (db.events || []).find((e: any) => e.id === id) as any;
  if (!evt || (evt.status && evt.status !== "approved")) return null;
  return {
    id: evt.id,
    title: evt.title,
    description: evt.description || "",
    date: evt.date,
    time: evt.time,
    venue: evt.venue,
    banner: evt.banner || "",
    price: Number(evt.price) || 0,
  };
}

const MAX_DESCRIPTION_LENGTH = 200;

function buildDescription(event: PreviewEvent): string {
  // L'accroche du partage doit d'abord répondre à "c'est quand, c'est où, c'est combien" :
  // c'est ce que le lecteur cherche dans une conversation WhatsApp, avant le texte de
  // présentation.
  const priceLabel = event.price > 0
    ? `À partir de ${event.price.toLocaleString("fr-FR")} FCFA`
    : "Entrée gratuite";
  const head = `${formatEventDateFr(event.date)} à ${event.time} · ${event.venue} · ${priceLabel}`;

  const body = String(event.description || "").replace(/\s+/g, " ").trim();
  if (!body) return head;

  const remaining = MAX_DESCRIPTION_LENGTH - head.length - 3;
  if (remaining <= 20) return head;
  const truncated = body.length > remaining ? `${body.slice(0, remaining).trimEnd()}…` : body;
  return `${head} — ${truncated}`;
}

// URL absolue de l'affiche. Les robots ne savent pas résoudre une URL relative, et refusent
// une image en data: URI — or les bannières uploadées sont justement stockées en base64
// (cf. src/lib/imageCompress.ts). Dans ce cas on pointe vers l'endpoint qui la décode et la
// sert comme une vraie image (GET /api/events/:id/banner).
function buildImageUrl(event: PreviewEvent): string {
  if (/^https?:\/\//i.test(event.banner)) return event.banner;
  return `${APP_ORIGIN}/api/events/${encodeURIComponent(event.id)}/banner`;
}

export function buildEventPreviewTags(event: PreviewEvent): string {
  const title = `${event.title} · ClicBillet`;
  const description = buildDescription(event);
  const imageUrl = buildImageUrl(event);
  const pageUrl = `${APP_ORIGIN}/e/${encodeURIComponent(event.id)}`;

  return [
    `<title>${escapeAttribute(title)}</title>`,
    `<meta name="description" content="${escapeAttribute(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="ClicBillet" />`,
    `<meta property="og:locale" content="fr_FR" />`,
    `<meta property="og:title" content="${escapeAttribute(title)}" />`,
    `<meta property="og:description" content="${escapeAttribute(description)}" />`,
    `<meta property="og:url" content="${escapeAttribute(pageUrl)}" />`,
    `<meta property="og:image" content="${escapeAttribute(imageUrl)}" />`,
    // Dimensions déclarées : sans elles, WhatsApp rend souvent une vignette carrée minuscule
    // au lieu de la grande image. 1200x630 est le format attendu par les principaux robots.
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeAttribute(event.title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttribute(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttribute(description)}" />`,
    `<meta name="twitter:image" content="${escapeAttribute(imageUrl)}" />`,
    `<link rel="canonical" href="${escapeAttribute(pageUrl)}" />`,
  ].join("\n    ");
}

// Retire du gabarit le titre et les balises d'aperçu génériques, puis insère celles de
// l'événement juste avant </head>.
//
// Ce retrait n'est PAS cosmétique : index.html porte déjà des og:title / og:description /
// og:image décrivant la plateforme en général, et les robots d'aperçu retiennent la PREMIÈRE
// occurrence de chaque propriété. Injecter les balises de l'événement à la suite sans
// supprimer les autres les rendrait purement décoratives — tous les liens partagés
// afficheraient la même vignette générique.
export function injectPreviewTags(html: string, tags: string): string {
  const cleaned = html
    .replace(/<title>.*?<\/title>/is, "")
    .replace(/<meta\s+[^>]*property=["']og:[^"']*["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+[^>]*name=["']twitter:[^"']*["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+[^>]*name=["']description["'][^>]*>\s*/gi, "");

  if (cleaned.includes("</head>")) {
    return cleaned.replace("</head>", `    ${tags}\n  </head>`);
  }
  return cleaned;
}
