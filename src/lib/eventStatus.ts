// Un événement est "passé" dès que sa date + heure de début sont dépassées. Format attendu :
// date "YYYY-MM-DD", time "HH:MM" (cf. Event.date/Event.time dans types.ts).
export function isEventPast(evt: { date: string; time: string }): boolean {
  const eventDateTime = new Date(`${evt.date}T${evt.time}`);
  if (isNaN(eventDateTime.getTime())) return false;
  return eventDateTime.getTime() < Date.now();
}
