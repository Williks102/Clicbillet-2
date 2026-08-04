import crypto from "crypto";
import { waitUntil } from "@vercel/functions";

export function runInBackground(promise: Promise<unknown>): void {
  const safePromise = promise.catch((err) => {
    console.error("[Background Job] Échec :", err);
  });
  if (process.env.VERCEL) {
    waitUntil(safePromise);
  }
}

// Un événement est "passé" dès que sa date + heure de début sont dépassées (miroir de
// src/lib/eventStatus.ts côté frontend — pas d'import cross src/server dans ce repo).
export function isEventPast(evt: { date: string; time: string }): boolean {
  const eventDateTime = new Date(`${evt.date}T${evt.time}`);
  if (isNaN(eventDateTime.getTime())) return false;
  return eventDateTime.getTime() < Date.now();
}

// Anti-fraude : le QR code réel d'un billet ne doit pas être exploitable des jours/semaines
// à l'avance (revente d'une capture d'écran avant que l'acheteur légitime n'arrive). Il ne
// devient visible/scannable qu'à partir de H-4 avant le début de l'événement.
export const QR_UNLOCK_HOURS_BEFORE_EVENT = 4;

export function getQrUnlockTime(evt: { date: string; time: string }): Date {
  const eventDateTime = new Date(`${evt.date}T${evt.time}`);
  return new Date(eventDateTime.getTime() - QR_UNLOCK_HOURS_BEFORE_EVENT * 60 * 60 * 1000);
}

// Repli permissif (déverrouillé) si la date/heure de l'événement est invalide : mieux vaut
// laisser voir un QR code que bloquer un acheteur légitime à cause d'une donnée corrompue.
export function isQrUnlocked(evt: { date: string; time: string }): boolean {
  const unlockTime = getQrUnlockTime(evt);
  if (isNaN(unlockTime.getTime())) return true;
  return Date.now() >= unlockTime.getTime();
}

// Le suffixe aléatoire (pas seulement l'id du billet) est ce qui rend le transfert de billet
// possible : régénérer cette valeur invalide immédiatement toute copie (capture d'écran, email)
// du QR précédent, puisque /api/verify-ticket compare désormais la chaîne scannée telle quelle
// à cette valeur stockée plutôt que d'en extraire seulement l'id du billet.
export function generateTicketQrCode(ticketId: string): string {
  return `clicbillet-verify:${ticketId}:${crypto.randomBytes(9).toString("hex")}`;
}

