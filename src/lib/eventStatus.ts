// Statut temporel d'un événement. Format attendu : date "YYYY-MM-DD", time "HH:MM"
// (cf. Event.date / Event.time / Event.endDate / Event.endTime dans types.ts).
//
// Deux notions bien distinctes, à ne pas confondre :
//   - hasEventStarted : l'heure de DÉBUT est dépassée (l'événement a commencé, ou est fini) ;
//   - isEventPast     : l'heure de FIN est dépassée (l'événement est terminé).
// Un concert en cours a donc hasEventStarted = true et isEventPast = false — c'est ce qui
// permet de continuer à afficher/scanner ses billets pendant qu'il se déroule.

// Doivent rester alignés avec EVENT_DEFAULT_DURATION_HOURS / EVENT_SCAN_GRACE_HOURS
// (server/lib/config.ts) : quand l'organisateur n'a pas saisi de fin, on suppose cette durée,
// et le scan reste toléré pendant la marge qui suit. C'est de l'affichage — la décision qui
// compte (autoriser un scan) est prise côté serveur, seul juge en la matière.
export const EVENT_DEFAULT_DURATION_HOURS = 12;
export const EVENT_SCAN_GRACE_HOURS = 3;
const DEFAULT_DURATION_HOURS = EVENT_DEFAULT_DURATION_HOURS;

export interface EventSchedule {
  date: string;
  time: string;
  endDate?: string | null;
  endTime?: string | null;
}

export function getEventStart(evt: EventSchedule): Date {
  return new Date(`${evt.date}T${evt.time}`);
}

export function getEventEnd(evt: EventSchedule): Date {
  if (evt.endDate && evt.endTime) {
    const declared = new Date(`${evt.endDate}T${evt.endTime}`);
    if (!isNaN(declared.getTime())) return declared;
  }
  const start = getEventStart(evt);
  if (isNaN(start.getTime())) return start;
  return new Date(start.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000);
}

export function hasEventStarted(evt: EventSchedule): boolean {
  const start = getEventStart(evt);
  if (isNaN(start.getTime())) return false;
  return start.getTime() < Date.now();
}

export function isEventPast(evt: EventSchedule): boolean {
  const end = getEventEnd(evt);
  if (isNaN(end.getTime())) return false;
  return end.getTime() < Date.now();
}
