import type { Env } from "./env.ts";

/**
 * Res.-TSE 23.610/2019 art. 9º-B §3º-A, as inserted by Res. 23.755/2026, forbids
 * publishing NEW AI-synthetic content using the image, voice or manifestation of
 * a candidate or public figure from 72 hours before the vote until 24 hours
 * after it — "mesmo que rotulados", so the disclaimer does not cure it.
 *
 * This feed publishes a new synthetic message about named candidates every sixty
 * seconds. It has to stop on its own, because a calendar reminder is not a
 * control. Dates are vars so a second round or a schedule change is a deploy,
 * not a code edit; the window is closed by default if they are malformed.
 */
export function inBlackout(env: Env, now = Date.now()): boolean {
  const from = Date.parse(env.BLACKOUT_FROM ?? "");
  const to = Date.parse(env.BLACKOUT_TO ?? "");
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  return now >= from && now <= to;
}

