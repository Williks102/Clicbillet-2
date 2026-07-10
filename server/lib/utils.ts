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

