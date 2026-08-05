import crypto from "crypto";
import { waitUntil } from "@vercel/functions";
import { EVENT_SCAN_GRACE_HOURS, EVENT_DEFAULT_DURATION_HOURS } from "./config.js";

export function runInBackground(promise: Promise<unknown>): void {
  const safePromise = promise.catch((err) => {
    console.error("[Background Job] Échec :", err);
  });
  if (process.env.VERCEL) {
    waitUntil(safePromise);
  }
}

export interface EventSchedule {
  date: string;
  time: string;
  // Fin déclarée par l'organisateur. Absente sur les événements créés avant son introduction.
  endDate?: string | null;
  endTime?: string | null;
}

export function getEventStart(evt: EventSchedule): Date {
  return new Date(`${evt.date}T${evt.time}`);
}

// Fin réelle de l'événement. À défaut de fin déclarée, on applique une durée forfaitaire au
// début plutôt que de considérer l'événement terminé dès qu'il commence.
export function getEventEnd(evt: EventSchedule): Date {
  if (evt.endDate && evt.endTime) {
    const declared = new Date(`${evt.endDate}T${evt.endTime}`);
    if (!isNaN(declared.getTime())) return declared;
  }
  const start = getEventStart(evt);
  if (isNaN(start.getTime())) return start;
  return new Date(start.getTime() + EVENT_DEFAULT_DURATION_HOURS * 60 * 60 * 1000);
}

// L'événement a commencé (il peut être en cours OU terminé). À distinguer de isEventPast :
// un transfert de billet se ferme au DÉBUT (on ne repasse pas un billet à quelqu'un d'autre
// une fois les portes ouvertes), alors que la vente et le scan restent ouverts jusqu'à la fin.
export function hasEventStarted(evt: { date: string; time: string }): boolean {
  const start = new Date(`${evt.date}T${evt.time}`);
  if (isNaN(start.getTime())) return false;
  return start.getTime() < Date.now();
}

// Un événement est "passé" une fois SA FIN dépassée — et non dès son heure de début, qui le
// faisait disparaître du catalogue alors qu'il battait son plein (miroir de
// src/lib/eventStatus.ts côté frontend — pas d'import cross src/server dans ce repo).
export function isEventPast(evt: EventSchedule): boolean {
  const end = getEventEnd(evt);
  if (isNaN(end.getTime())) return false;
  return end.getTime() < Date.now();
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

// Fenêtre pendant laquelle un billet peut être présenté à l'entrée : elle s'ouvre en même
// temps que le QR code devient visible pour l'acheteur (cohérence des deux bornes), et se
// ferme à la fin de l'événement plus une marge de tolérance.
//
// Repli permissif quand la date est invalide, comme pour isQrUnlocked : mieux vaut laisser
// entrer un porteur légitime que bloquer une entrée sur une donnée corrompue.
export function getScanWindow(evt: EventSchedule): { opensAt: Date; closesAt: Date } {
  return {
    opensAt: getQrUnlockTime(evt),
    closesAt: new Date(getEventEnd(evt).getTime() + EVENT_SCAN_GRACE_HOURS * 60 * 60 * 1000),
  };
}

export function getScanWindowState(evt: EventSchedule): "too-early" | "open" | "closed" {
  const { opensAt, closesAt } = getScanWindow(evt);
  if (isNaN(opensAt.getTime()) || isNaN(closesAt.getTime())) return "open";
  const now = Date.now();
  if (now < opensAt.getTime()) return "too-early";
  if (now > closesAt.getTime()) return "closed";
  return "open";
}

// Le suffixe aléatoire (pas seulement l'id du billet) est ce qui rend le transfert de billet
// possible : régénérer cette valeur invalide immédiatement toute copie (capture d'écran, email)
// du QR précédent, puisque /api/verify-ticket compare désormais la chaîne scannée telle quelle
// à cette valeur stockée plutôt que d'en extraire seulement l'id du billet.
export function generateTicketQrCode(ticketId: string): string {
  return `clicbillet-verify:${ticketId}:${crypto.randomBytes(9).toString("hex")}`;
}

