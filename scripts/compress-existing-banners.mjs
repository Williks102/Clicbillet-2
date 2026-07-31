// Migration ponctuelle : recompresse les bannières d'événements déjà stockées en base64
// brut (uploadées avant que le client ne les redimensionne lui-même, cf.
// src/lib/imageCompress.ts). Une bannière de plusieurs Mo est renvoyée intégralement dans
// la réponse de /api/events à chaque visiteur de la page d'accueil — c'est la cause la plus
// probable d'un chargement des événements perçu comme lent.
//
// Usage :
//   node scripts/compress-existing-banners.mjs           # applique les changements
//   node scripts/compress-existing-banners.mjs --dry-run # affiche ce qui serait fait, sans écrire
//
// Nécessite SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (mêmes variables que le serveur,
// cf. .env). Ne touche jamais les bannières qui sont déjà de simples URL (uniquement celles
// commençant par "data:image").

import dotenv from "dotenv";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const DRY_RUN = process.argv.includes("--dry-run");

// En dessous de ce seuil (payload base64 déjà raisonnable), on laisse l'image telle quelle :
// pas besoin de la recompresser, et ça évite une dégradation JPEG inutile en cas de relance.
const SKIP_THRESHOLD_BYTES = 300 * 1024;
const MAX_WIDTH = 1280;
const JPEG_QUALITY = 80;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[compress-banners] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquant(e) — abandon.");
  console.error("Renseignez ces variables (les mêmes que celles utilisées par le serveur) avant de relancer.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function main() {
  console.log(`[compress-banners] Mode : ${DRY_RUN ? "dry-run (aucune écriture)" : "réel"}`);

  const { data: events, error } = await supabase
    .from("events")
    .select("id, title, banner")
    .like("banner", "data:image%");

  if (error) {
    console.error("[compress-banners] Échec de la lecture des événements :", error.message);
    process.exit(1);
  }

  if (!events || events.length === 0) {
    console.log("[compress-banners] Aucun événement avec une bannière base64 — rien à faire.");
    return;
  }

  console.log(`[compress-banners] ${events.length} événement(s) avec bannière base64 trouvé(s).`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (const evt of events) {
    const originalSize = evt.banner.length;

    if (originalSize <= SKIP_THRESHOLD_BYTES) {
      skipped++;
      continue;
    }

    const parsed = parseDataUrl(evt.banner);
    if (!parsed) {
      console.warn(`[compress-banners] "${evt.title}" (${evt.id}) : data URL illisible, ignoré.`);
      failed++;
      continue;
    }

    try {
      const resizedBuffer = await sharp(parsed.buffer)
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();

      const newDataUrl = `data:image/jpeg;base64,${resizedBuffer.toString("base64")}`;

      if (newDataUrl.length >= originalSize) {
        console.log(`[compress-banners] "${evt.title}" (${evt.id}) : déjà optimale, ignoré.`);
        skipped++;
        continue;
      }

      const reduction = (100 * (1 - newDataUrl.length / originalSize)).toFixed(1);
      console.log(
        `[compress-banners] "${evt.title}" (${evt.id}) : ${(originalSize / 1024 / 1024).toFixed(2)} Mo → ` +
        `${(newDataUrl.length / 1024 / 1024).toFixed(2)} Mo (-${reduction}%)`
      );

      totalBefore += originalSize;
      totalAfter += newDataUrl.length;
      processed++;

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from("events")
          .update({ banner: newDataUrl })
          .eq("id", evt.id);

        if (updateError) {
          console.error(`[compress-banners] Échec de la mise à jour de "${evt.title}" (${evt.id}) :`, updateError.message);
          failed++;
          processed--;
        }
      }
    } catch (err) {
      console.error(`[compress-banners] Échec du traitement de "${evt.title}" (${evt.id}) :`, err.message);
      failed++;
    }
  }

  console.log("\n[compress-banners] Terminé.");
  console.log(`  Traités   : ${processed}`);
  console.log(`  Ignorés   : ${skipped} (déjà légers ou déjà optimaux)`);
  console.log(`  Échoués   : ${failed}`);
  if (processed > 0) {
    console.log(
      `  Gain total : ${((totalBefore - totalAfter) / 1024 / 1024).toFixed(2)} Mo ` +
      `(${(totalBefore / 1024 / 1024).toFixed(2)} Mo → ${(totalAfter / 1024 / 1024).toFixed(2)} Mo)`
    );
  }
  if (DRY_RUN) {
    console.log("\nAucune écriture effectuée (--dry-run). Relancez sans ce flag pour appliquer.");
  }
}

main();
