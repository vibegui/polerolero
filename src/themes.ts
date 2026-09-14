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
// The hidden game
// -----------------------------------------------------------------------------

/** How many times a drift target must land, or a point be hammered, to count. */
const LANDINGS = 3;

export type GoalId = "arrastar" | "evitar" | "insistir" | "blindar" | "encerrar";

export interface Goal {
  id: GoalId;
  /** A tag, for arrastar and evitar. Null for the others. */
  target: string | null;
}

/** What the model is told, in its own side's voice. Never states it outright. */
export function goalHint(goal: Goal): string {
  switch (goal.id) {
    case "arrastar":
      return `OBJETIVO SECRETO — puxe a conversa para ${goal.target}. Não anuncie isso. Use o argumento que te deram, mas encaminhe o assunto para lá, como quem acha que é o que realmente importa.`;
    case "evitar":
      return `OBJETIVO SECRETO — não deixe a conversa entrar em ${goal.target}. Não anuncie isso. Se o oponente puxar para lá, desvie para outra coisa sem admitir que está desviando.`;
    case "insistir":
      return "OBJETIVO SECRETO — você quer que ESTE ponto cole. Volte a ele, repita a ideia com outras palavras, trate como o fato central da discussão. Não anuncie isso.";
    case "blindar":
      return "OBJETIVO SECRETO — não responda o que ele perguntou. Nunca. Reaja, ataque, mude o eixo, mas não entregue a resposta. Não anuncie isso e não pareça fugindo.";
    case "encerrar":
      return "OBJETIVO SECRETO — você quer encerrar este assunto e levar a discussão para outro lugar. Trate o tema como já resolvido e esgotado. Não anuncie isso.";
  }
}

/** What the closing card says. Written flat, like a referee reading a card. */
export function goalLabel(goal: Goal): string {
  switch (goal.id) {
    case "arrastar": return `arrastar a conversa para ${goal.target}`;
    case "evitar": return `impedir que se falasse de ${goal.target}`;
    case "insistir": return "martelar o mesmo argumento até colar";
    case "blindar": return "nunca responder o que foi perguntado";
    case "encerrar": return "ser quem encerra o assunto";
  }
}

/**
 * Hand out the two objectives.
 *
 * Half the time they are handed out in direct conflict — one side dragging the
 * conversation toward a tag the other side is trying to keep off the table.
 * That pairing is the only one where both objectives cannot both succeed, and
 * it is by far the best thing the mechanic produces, so it gets the weight.
 */
export function assignGoals(
  subject: Subject,
  rand: () => number = Math.random,
): Record<Side, Goal> {
  const drift = (side: Side): string | null => {
    // A drift target has to be somewhere this side can actually go: a tag its
    // own nodes carry, and not the subject everyone is already on.
    const own = [...new Set(subjectNodes(subject, side).flatMap((n) => n.tags))]
      .filter((t) => t !== subject.id);
    return own.length > 0 ? (own[Math.floor(rand() * own.length)] as string) : null;
  };

  if (rand() < 0.5) {
    // Head to head: one drags, the other blocks the same tag.
    const puller: Side = rand() < 0.5 ? "lula" : "bolsonaro";
    const target = drift(puller);
    if (target) {
      return {
        [puller]: { id: "arrastar", target },
        [OTHER[puller]]: { id: "evitar", target },
      } as Record<Side, Goal>;
    }
  }

  const solo = (side: Side): Goal => {
    // `insistir` is only an achievement where NOT repeating was an option. In a
    // three-argument theme you hit three repeats by arithmetic, not strategy,
    // and the closing card then congratulates both sides for having no choice.
    const roomToChoose = subjectNodes(subject, side).length >= LANDINGS * 2;
    const pick = roomToChoose
      ? (["insistir", "blindar", "encerrar", "arrastar"] as const)
      : (["blindar", "encerrar", "arrastar"] as const);
    const id = pick[Math.floor(rand() * pick.length)] as GoalId;
    return { id, target: id === "arrastar" ? drift(side) : null };
  };
  return { lula: solo("lula"), bolsonaro: solo("bolsonaro") };
}

// -----------------------------------------------------------------------------
// Resolution — no model call, ever
// -----------------------------------------------------------------------------

export interface GoalVerdict {
  goal: Goal;
  done: boolean;
  /** One short line for the closing card. Says how, not just whether. */
  detail: string;
}

/**
 * Score one side's secret objective against what actually got published.
 *
 * `msgs` is the theme's argument messages in order, both sides, cards excluded.
 * Everything here reads `side` and `arg_id` and looks the tags up in the trees,
 * which is the whole reason the objectives were designed as tag predicates: the
 * scoreboard cannot disagree with the feed, because it is computed from it.
 */
export function resolveGoal(
  goal: Goal,
  side: Side,
  msgs: Message[],
  closedBy: Side,
): GoalVerdict {
  const tagsOf = (m: Message) => NODE_BY_ID.get(m.arg_id)?.tags ?? [];
  const mine = msgs.filter((m) => m.side === side);
  const theirs = msgs.filter((m) => m.side !== side);
  const v = (done: boolean, detail: string): GoalVerdict => ({ goal, done, detail });

  switch (goal.id) {
    case "arrastar": {
      const hits = mine.filter((m) => tagsOf(m).includes(goal.target ?? "")).length;
      return v(hits >= LANDINGS, `puxou para ${goal.target} em ${hits} de ${mine.length} mensagens`);
    }
    case "evitar": {
      const leaks = theirs.filter((m) => tagsOf(m).includes(goal.target ?? "")).length;
      return v(leaks === 0, leaks === 0
        ? `segurou: o outro lado não chegou em ${goal.target}`
        : `vazou ${leaks}x — o outro lado chegou em ${goal.target}`);
    }
    case "insistir": {
      const count = new Map<string, number>();
      for (const m of mine) count.set(m.arg_id, (count.get(m.arg_id) ?? 0) + 1);
      const top = [...count.values()].reduce((a, b) => Math.max(a, b), 0);
      return v(top >= LANDINGS, `repetiu o mesmo argumento ${top}x`);
    }
    case "blindar": {
      // A message "answered" when the argument it played rebuts a tag the
      // opponent had just put on the table — the same adjacency pickArgument
      // uses to choose a responsive reply.
      let chances = 0, answered = 0;
      for (let i = 1; i < msgs.length; i++) {
        const m = msgs[i]!, prev = msgs[i - 1]!;
        if (m.side !== side || prev.side === side) continue;
        chances++;
        const rebuts = NODE_BY_ID.get(m.arg_id)?.rebuts ?? [];
        if (rebuts.some((t) => tagsOf(prev).includes(t))) answered++;
      }
      // Never answering because you were never asked is not blindar.
      return v(chances >= LANDINGS && answered === 0,
        chances === 0 ? "não foi cobrado" : `respondeu ${answered} de ${chances} cobranças`);
    }
    case "encerrar":
      return v(closedBy === side, closedBy === side ? "encerrou o assunto" : "não conseguiu encerrar");
  }
}

/**
 * Who is on the back foot, and therefore who wants out of this subject.
 *
 * A side changes the subject when it is losing — that is the whole tell, and it
 * used to be "whoever's turn it is", which made the change arbitrary and made
 * the `encerrar` objective a coin toss scored against a coin toss.
 *
 * Two signals, both computed from what was published:
 *  - its secret objective is failing (`encerrar` is excluded: it is decided BY
 *    this function, so it cannot also be an input to it);
 *  - it has been answering more than it has been answered, which is what being
 *    led by the other side looks like in the tag graph.
 */
export function losingSide(
  goals: Record<Side, Goal>,
  msgs: Message[],
): Side {
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
  const score = (side: Side): number => {
    const goal = goals[side];
    const onTrack = goal.id === "encerrar" ? 0 : resolveGoal(goal, side, msgs, side).done ? 1 : -1;
    // Scaled well under 1 so a met objective always outweighs the tiebreak.
    return onTrack - answered(side) / Math.max(1, msgs.length);
  };
  const l = score("lula"), b = score("bolsonaro");
  if (l !== b) return l < b ? "lula" : "bolsonaro";
  // Dead heat: whoever spoke last is the one who has run out of things to add.
  return msgs[msgs.length - 1]?.side ?? "lula";
}
