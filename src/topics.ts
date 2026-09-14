import bancoMaster from "../topics/banco-master.json" with { type: "json" };
import darkHorse from "../topics/dark-horse.json" with { type: "json" };
import educacao2026 from "../topics/educacao-2026.json" with { type: "json" };
import inssFraude from "../topics/inss-fraude.json" with { type: "json" };
import rachadinha from "../topics/rachadinha.json" with { type: "json" };
import saude2026 from "../topics/saude-2026.json" with { type: "json" };
import seguranca2026 from "../topics/seguranca-2026.json" with { type: "json" };
import mendoncaMoraes from "../topics/mendonca-moraes.json" with { type: "json" };
import taxaBlusinhas from "../topics/taxa-blusinhas.json" with { type: "json" };
import type { ArgNode, Side } from "./env.ts";

/**
 * Hot topics: whatever the country is actually arguing about this week.
 *
 * The standing trees hold the evergreen fight — urna, corrupção, gastança. That
 * fight is timeless, which is the joke, but it also means the feed never reacts
 * to anything. A topic is a small self-contained file with arguments for BOTH
 * sides of one live episode; the bots wander into it, spend a few turns there,
 * and wander back out.
 *
 * Adding one is adding a file. That is the whole point — a topic is the unit a
 * contributor can actually write in an afternoon, unlike a verdict on a
 * decade-old controversy.
 */
export interface Topic {
  id: string;
  title: string;
  summary: string;
  active: boolean;
  source?: string;
  lula: ArgNode[];
  bolsonaro: ArgNode[];
}

export const TOPICS: Topic[] = [
  bancoMaster as Topic,
  darkHorse as Topic,
  educacao2026 as Topic,
  inssFraude as Topic,
  mendoncaMoraes as Topic,
  rachadinha as Topic,
  saude2026 as Topic,
  seguranca2026 as Topic,
  taxaBlusinhas as Topic,
].filter((t) => t.active);

export const TOPIC_BY_ID = new Map(TOPICS.map((t) => [t.id, t] as const));

/** Chance of wandering into a topic on any turn that is not already in one. */
export const TOPIC_CHANCE = 0.12;
/** How many turns the two of them stay on a topic once they start. */
export const TOPIC_RUN = 6;

export function topicNodes(topic: Topic, side: Side): ArgNode[] {
  return topic[side];
}

/**
 * Decide which topic this message belongs to, given the most recent topics
 * (newest first, one entry per message, null for the standing trees).
 *
 * Continue an unfinished run; otherwise roll for a new one. Keeping this pure
 * and derived from history means a restarted worker picks up mid-topic instead
 * of dropping the thread.
 */
export function pickTopic(recentTopics: (string | null)[], rand = Math.random()): string | null {
  if (TOPICS.length === 0) return null;

  const current = recentTopics[0];
  if (current) {
    let run = 0;
    while (run < recentTopics.length && recentTopics[run] === current) run++;
    if (run < TOPIC_RUN) return current;
    // Run just ended — back to the standing trees, so a topic can't chain
    // straight into itself and hold the feed forever.
    return null;
  }

  if (rand >= TOPIC_CHANCE) return null;
  const pick = TOPICS[Math.floor((rand / TOPIC_CHANCE) * TOPICS.length)];
  return (pick ?? TOPICS[0])!.id;
}
