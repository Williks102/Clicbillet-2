import crypto from "crypto";
import { PAYOUT_DETAILS_ENCRYPTION_KEY } from "./config.js";

// Chiffrement au repos des coordonnées de retrait (payouts.details : numéro mobile money /
// IBAN) avec AES-256-GCM. Format stocké auto-descriptif ("enc:v1:<iv>:<tag>:<ciphertext>", tout
// en base64) pour permettre une future rotation d'algorithme/version sans migration bloquante.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const FORMAT_PREFIX = "enc:v1:";

export function encryptPayoutDetails(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, PAYOUT_DETAILS_ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${FORMAT_PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

// Tolère les lignes créées avant l'introduction du chiffrement (toujours en clair) : les
// retourne telles quelles plutôt que d'échouer, pour ne pas casser l'affichage admin des
// anciennes demandes de retrait.
export function decryptPayoutDetails(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(FORMAT_PREFIX)) return stored;

  try {
    const [ivB64, tagB64, dataB64] = stored.slice(FORMAT_PREFIX.length).split(":");
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(dataB64, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, PAYOUT_DETAILS_ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (e: any) {
    console.error("[Payouts] Échec du déchiffrement d'un champ details :", e.message);
    return "[Déchiffrement impossible]";
  }
}
