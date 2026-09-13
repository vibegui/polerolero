/**
 * The fans sleep.
 *
 * An argument that runs at 03:00 with nobody watching is the one stretch where
 * the joke costs money and returns nothing — and a fight that never pauses is
 * less believable than one that does. Between midnight and 06:00 in Brasília
 * the feed stops and says so.
 *
 * The window is computed in São Paulo local time rather than assuming UTC-3.
 * Brazil dropped DST in 2019, so that assumption is true today and is exactly
 * the kind of thing that breaks silently if it ever comes back.
 */

const ZONE = "America/Sao_Paulo";
export const SLEEP_FROM_HOUR = 0;
export const WAKE_HOUR = 6;

/** Hours are read from vars so the window can move without a deploy — and so
 *  this is testable at all, since you cannot wait until midnight to find out
 *  whether the branch works. Falls back to the real window on bad input. */
export function sleepHours(env: { SLEEP_FROM?: string; SLEEP_TO?: string }): [number, number] {
  const from = Number(env.SLEEP_FROM);
  const to = Number(env.SLEEP_TO);
  const ok = (n: number) => Number.isInteger(n) && n >= 0 && n < 24;
  return ok(from) && ok(to) && from < to ? [from, to] : [SLEEP_FROM_HOUR, WAKE_HOUR];
}

interface Local {
  y: number;
  m: number;
  d: number;
  h: number;
}

function localParts(at: Date): Local {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  // hour12:false can render midnight as "24" in some ICU builds.
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24 };
}

/** Milliseconds to add to a São Paulo wall-clock time to get the UTC instant. */
function offsetMs(at: Date): number {
  const p = localParts(at);
  const minutes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    minute: "2-digit",
  }).formatToParts(at);
  const min = Number(minutes.find((x) => x.type === "minute")?.value ?? 0);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, min) - at.getTime() + (at.getTime() % 60_000);
}

export function isAsleep(at: Date, from = SLEEP_FROM_HOUR, to = WAKE_HOUR): boolean {
  const h = localParts(at).h;
  return h >= from && h < to;
}

/**
 * The instant the fight resumes: 06:00 São Paulo on the day `at` belongs to.
 * Only called while asleep, and the sleep window never spans a local date
 * boundary going forward — 00:00–06:00 is always the same local day.
 */
export function wakeUpAfter(at: Date, to = WAKE_HOUR): Date {
  const p = localParts(at);
  return new Date(Date.UTC(p.y, p.m - 1, p.d, to, 0, 0) - offsetMs(at));
}
