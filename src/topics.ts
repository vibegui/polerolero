import aborto from "../topics/aborto.json" with { type: "json" };
import armas from "../topics/armas.json" with { type: "json" };
import bancoMaster from "../topics/banco-master.json" with { type: "json" };
import desmatamento from "../topics/desmatamento.json" with { type: "json" };
import drogas from "../topics/drogas.json" with { type: "json" };
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
 *
 * A topic is now one kind of THEME (see themes.ts), which is what decides how
 * long the two of them stay on it. The old pickTopic/TOPIC_CHANCE dice — 12%
 * chance, six turns — are gone: there is always a theme running, and it runs
 * for 20-30 arguments.
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
  aborto as Topic,
  armas as Topic,
  bancoMaster as Topic,
  desmatamento as Topic,
  drogas as Topic,
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

export function topicNodes(topic: Topic, side: Side): ArgNode[] {
  return topic[side];
}
