import type { ArgNode, Message, Side } from "./env.ts";
import { NODE_BY_ID, OTHER, TREES } from "./trees.ts";
import { TOPICS, TOPIC_BY_ID } from "./topics.ts";

/**
 * Themes, and the game played underneath them.
 *
 * The feed used to be a slideshow: a 12% chance of wandering into a topic for
 * six turns, and the rest of the time consecutive messages jumped between
 * unrelated subjects. There was never a *conversation*, only a sequence.
 *
 * Now there is always exactly one theme running. It lasts 20-30 arguments, a
 * side visibly decides to change it, and while it runs each side is pursuing a
 * secret objective that is NOT "win the argument" — it is a rhetorical one:
 * drag the subject onto your turf, keep the other side off a subject, hammer
 * one point until it sticks, never actually answer. When the theme closes, the
 * feed says what each of them was really doing.
 *
 * That is the thesis of the whole project stated as a mechanic: the argument
 * being made is not the objective being pursued.
 *
 * The hard design constraint that makes it buildable: **every objective is a
 * predicate over rows already stored** — side, arg_id, theme_id — resolvable
 * with the trees and no model call at all. A judge call would be a second
 * fabrication surface, and this project has enough of those.
 */

// -----------------------------------------------------------------------------
// Subjects
// -----------------------------------------------------------------------------

export interface Subject {
  id: string;
  kind: "tag" | "topic";
  title: string;
}

/** A node belongs to a tag theme if it argues that subject or answers it. */
export function tagNodes(tag: string, side: Side): ArgNode[] {
  return TREES[side].filter((n) => n.tags.includes(tag) || n.rebuts.includes(tag));
}

/**
 * Tags with enough material on BOTH sides to hold a 25-message theme.
 *
 * Computed, not hand-listed: a hand-listed set silently rots the moment someone
 * adds or renames a tag in the trees, and the failure mode is a theme where one
 * side has two arguments and repeats them for twenty turns.
 */
const MIN_NODES_PER_SIDE = 4;

/** Display names. A bare tag like "stf" is not a sentence anyone would say. */
const TAG_TITLES: Record<string, string> = {
  social: "Programas sociais",
  economia: "Economia e custo de vida",
  corrupcao: "Corrupção",
  democracia: "Democracia",
  justica: "Justiça",
  golpe: "8 de janeiro e a tentativa de golpe",
  internacional: "Política externa",
  soberania: "Soberania nacional",
  stf: "O Supremo",
};


export const TAG_SUBJECTS: Subject[] = (() => {
  const all = new Set([...TREES.lula, ...TREES.bolsonaro].flatMap((n) => [...n.tags, ...n.rebuts]));
  return [...all]
    .filter((t) => tagNodes(t, "lula").length >= MIN_NODES_PER_SIDE &&
                   tagNodes(t, "bolsonaro").length >= MIN_NODES_PER_SIDE)
    .sort()
    .map((t) => ({ id: t, kind: "tag" as const, title: TAG_TITLES[t] ?? t }));
})();


export const SUBJECTS: Subject[] = [
  ...TAG_SUBJECTS,
  ...TOPICS.map((t) => ({ id: t.id, kind: "topic" as const, title: t.title })),
];

export function subjectNodes(subject: Subject, side: Side): ArgNode[] {
  if (subject.kind === "topic") {
    const t = TOPIC_BY_ID.get(subject.id);
    return t ? t[side] : TREES[side];
  }
  return tagNodes(subject.id, side);
}

/** Themes run this many arguments — long enough to be a conversation. */
export const THEME_MIN = 10;
export const THEME_MAX = 30;

/**
 * How long a theme runs, given how much material it actually has.
 *
 * A fixed 20-30 was wrong: a topic file with four arguments a side cannot fill
 * thirty turns, and the simulated run showed it repeating one claim five times.
 * Three turns per available argument scales the session to the subject, so a
 * thin topic ends before it starts looping and a rich tag runs long. The real
 * fix for short themes is more arguments in the file, not a longer session.
 */
export function themeLength(pool: number, rand = Math.random()): number {
  const target = Math.min(THEME_MAX, Math.max(THEME_MIN, pool * 3));
  // Clamp after the jitter too, so THEME_MIN/THEME_MAX mean what they say and
  // callers can assert against them.
  return Math.max(THEME_MIN, Math.min(THEME_MAX, Math.round(target * (0.85 + rand * 0.3))));
}
/** How many recent subjects are off-limits, so the rotation does not cycle. */
const SUBJECT_COOLDOWN = 5;

export function pickSubject(recentSubjects: string[], rand = Math.random()): Subject {
  const cool = recentSubjects.slice(0, SUBJECT_COOLDOWN);
  const open = SUBJECTS.filter((s) => !cool.includes(s.id));
  const pool = open.length > 0 ? open : SUBJECTS;
  return pool[Math.floor(rand * pool.length)] as Subject;
}

// -----------------------------------------------------------------------------
// Who is losing
// -----------------------------------------------------------------------------

/**
 * Who is on the back foot, and therefore who wants out of this subject.
 *
 * A side changes the subject when it is losing — that is the whole tell, and it
 * used to be "whoever's turn it is", which made the change arbitrary.
 *
 * The signal is answering. A message "answered" when the argument it played
 * rebuts a tag the opponent had just put on the table — the same adjacency
 * pickArgument uses to choose a responsive reply. The side doing more of that
 * is the one being led; the side setting the agenda is winning.
 *
 * There used to be a second input here: each side carried a secret rhetorical
 * objective and failing it counted as losing. It was cut — it read as a game
 * layer bolted onto a conversation, and the conversation is the piece worth
 * having. The theme structure it hung off stays.
 */
export function losingSide(msgs: Message[]): Side {
  const answered = (side: Side): number => {
    let n = 0;
    for (let i = 1; i < msgs.length; i++) {
      const m = msgs[i]!, prev = msgs[i - 1]!;
      if (m.side !== side || prev.side === side) continue;
      const rebuts = NODE_BY_ID.get(m.arg_id)?.rebuts ?? [];
      if (rebuts.some((t) => (NODE_BY_ID.get(prev.arg_id)?.tags ?? []).includes(t))) n++;
    }
    return n;
  };
  const l = answered("lula"), b = answered("bolsonaro");
  if (l !== b) return l > b ? "lula" : "bolsonaro";
  // Dead heat: whoever spoke last is the one who has run out of things to add.
  return msgs[msgs.length - 1]?.side ?? "lula";
}
