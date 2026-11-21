// Aligné sur src/lib/eventStatus.ts du site : un événement est « passé » une fois sa fin
// dépassée ; sans fin saisie, on suppose EVENT_DEFAULT_DURATION_HOURS (cf. server/lib/config.ts).
const DEFAULT_DURATION_HOURS = 12;

export interface Schedule {
  date: string;
  time: string;
  endDate?: string | null;
  endTime?: string | null;
}

export function eventEnd(e: Schedule): Date {
  if (e.endDate && e.endTime) {
    const d = new Date(`${e.endDate}T${e.endTime}`);
    if (!isNaN(d.getTime())) return d;
  }
  const start = new Date(`${e.date}T${e.time}`);
  return new Date(start.getTime() + DEFAULT_DURATION_HOURS * 3600 * 1000);
}

export function isEventPast(e: Schedule): boolean {
  const end = eventEnd(e);
  return !isNaN(end.getTime()) && end.getTime() < Date.now();
}
