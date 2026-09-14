import type { Env, Message, Side, ThemeRow } from "./env.ts";
import { composeMessage } from "./generate.ts";
import { isAsleep, sleepHours, wakeUpAfter } from "./sleep.ts";
import { gapFor } from "./style.ts";
import { losingSide, pickSubject, subjectNodes, themeLength } from "./themes.ts";
import { NODE_BY_ID, OTHER } from "./trees.ts";
import { inBlackout } from "./blackout.ts";

/**
 * Read a numeric var, falling back only when it is genuinely absent.
 *
 * This was `Number(x) || fallback`, which silently swallows a deliberate zero:
 * MAX_PER_DAY=0 — "stop spending, run off the trees" — parsed as 0, hit the
 * falsy branch, and came back 1600. The one setting whose whole purpose is to
 * cap spend could not be set to its most important value.
 */
/**
 * Older messages the two of them can be caught repeating, 1-14 days back.
 *
 * Exported so the SQL itself is testable. The picker had unit tests and the
 * filter was verified against a real production pool, but nothing covered this
 * query — the one link that decides whether the picker is ever handed anything
 * at all. Three attempts to confirm it from `wrangler tail` produced "zero
 * callbacks" and were worthless: the tail captured no worker events at all.
 *
 * ponytail: ORDER BY RANDOM() sorts the whole window (~13k rows at steady
 * state) once per tick. Fine at this size and indexed on due_at; if the table
 * ever makes this hurt, sample a random id range instead.
 */
export async function callbackPool(env: Env): Promise<Message[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, side, body, arg_id, due_at, topic, kind, theme_id FROM messages
       WHERE kind = 'message'
         AND due_at < unixepoch() - 86400
         AND due_at > unixepoch() - 1209600
       ORDER BY RANDOM() LIMIT ?1`,
  ).bind(CALLBACK_POOL).all<Message>();
  return results;
}

export function setting(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** How far back to look for already-used arguments, and for the transcript. */
const RECENT_WINDOW = 200;
/** Size of the older-message pool a run draws its callbacks from. */
const CALLBACK_POOL = 80;
/** Chance a side hammers its own previous argument instead of a fresh one. */
const PRESS_CHANCE = 0.18;
/** Chance a side posts twice in a row — the afterthought, not a new turn. */
const DOUBLE_CHANCE = 0.1;
/** Themes kept out of the rotation, newest first. */
const SUBJECT_MEMORY = 8;
/**
 * How long one run may hold the generation lease.
 *
 * Shorter than the five-minute cron interval, so a run that dies mid-flight
 * costs at most one skipped tick instead of stalling the feed until someone
 * notices. Long enough to cover MAX_PER_RUN model calls at the 25s timeout.
 */
const LOCK_SECONDS = 240;
/**
 * Wall-clock budget for one run, comfortably inside the lease.
 *
 * Each turn may now make two model calls at a 25s timeout, so the worst case
 * is MAX_PER_RUN * 2 * 25s = 500s — twice the lease and longer than the cron
 * interval. A run that outlives its own lease is exactly the overlap the lease
 * exists to prevent. Stopping early costs nothing: the buffer is the point, and
 * the next tick tops it up.
 */
const RUN_BUDGET_MS = 200_000;

// -----------------------------------------------------------------------------
// Buffer top-up
// -----------------------------------------------------------------------------

/**
 * Keep BUFFER_TARGET messages queued ahead of now, generating at most
 * MAX_PER_RUN per tick.
 *
 * Thinking in "keep the buffer full" rather than "emit one per minute" is what
 * makes this self-healing: a failed run retries five minutes later with roughly
 * fifteen minutes of runway still queued, and nobody watching sees a gap.
 */
export async function topUp(env: Env): Promise<void> {
  if (inBlackout(env)) {
    console.log("electoral blackout: not generating");
    return;
  }

  // Take the lease before anything else reads the buffer. Cron delivery is
  // at-least-once and a duplicate run is not harmless: both copies read the
  // same newest row, both append from it, and the feed ends up with two
  // messages a second apart carrying the same argument — at twice the spend.
  const lease = await env.DB.prepare(
    "UPDATE locks SET until = unixepoch() + ?1 WHERE name = 'topup' AND until < unixepoch()",
  ).bind(LOCK_SECONDS).run();
  if (!lease.meta?.changes) {
    console.log(JSON.stringify({ event: "topup_skipped", reason: "another run holds the lease" }));
    return;
  }

  try {
    await generate(env);
  } finally {
    // Release early so the next tick is not forced to wait out the deadline.
    await env.DB.prepare("UPDATE locks SET until = 0 WHERE name = 'topup'").run();
  }
}

async function generate(env: Env): Promise<void> {
  const interval = setting(env.MESSAGE_INTERVAL_SECONDS, 60);
  const target = setting(env.BUFFER_TARGET, 20);
  const maxPerRun = setting(env.MAX_PER_RUN, 10);
  const maxPerDay = setting(env.MAX_PER_DAY, 1600);
  const now = Math.floor(Date.now() / 1000);

  // Newest row first: it carries the last side, the last arg_id and MAX(due_at)
  // in one read, because due_at is monotonic with id.
  const { results: recentRows } = await env.DB.prepare(
    "SELECT id, side, body, arg_id, due_at, topic, kind, theme_id FROM messages ORDER BY id DESC LIMIT ?1",
  ).bind(RECENT_WINDOW).all<Message>();

  // A pool of older messages, so the two of them can be caught repeating
  // themselves across days. Read once per tick and reused for every message in
  // the run: pickCallback samples it, so one read is not one callback.
  //
  // ponytail: ORDER BY RANDOM() sorts the whole 1–14 day window (~13k rows at
  // steady state) 288 times a day. Fine at this size and indexed on due_at;
  // if the table ever makes this hurt, sample a random id range instead.
  const olderRows = await callbackPool(env);

  const newest = recentRows[0];
  const pending = newest ? Math.max(0, Math.ceil((newest.due_at - now) / interval)) : 0;
  let toGenerate = Math.min(target - pending, maxPerRun);
  if (toGenerate <= 0) return;

  // Budget guard. Bounds spend deterministically even under a retry storm or a
  // cron misfire; past the ceiling the stream keeps running off the trees at $0.
  const spent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM messages WHERE created_at > unixepoch() - 86400",
  ).first<{ n: number }>();
  const allowLlm = (spent?.n ?? 0) < maxPerDay;

  // recentRows is newest-first; the transcript reads oldest-first.
  const transcript: Message[] = recentRows.slice().reverse();
  const recent: string[] = recentRows.map((m) => m.arg_id);
  let side: Side = newest ? OTHER[newest.side] : "lula";
  let dueAt = Math.max(newest?.due_at ?? now, now);

  const [sleepFrom, sleepTo] = sleepHours(env);
  let sleptThisRun = false;
  const insert = env.DB.prepare(
    "INSERT INTO messages (side, body, arg_id, due_at, topic, kind, theme_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, unixepoch())",
  );
  const pause = env.DB.prepare(
    "INSERT INTO messages (side, body, arg_id, due_at, kind, created_at) VALUES (?1, ?2, '', ?3, 'pause', unixepoch())",
  );

  // The theme currently in play, and how far into it we are. A row with a null
  // outcome IS the live theme; there is never more than one.
  let theme = await env.DB.prepare(
    "SELECT * FROM themes WHERE outcome IS NULL ORDER BY id DESC LIMIT 1",
  ).first<ThemeRow>();
  let inTheme = theme
    ? ((await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM messages WHERE theme_id = ?1 AND kind = 'message'",
      ).bind(theme.id).first<{ n: number }>())?.n ?? 0)
    : 0;
  const { results: pastThemes } = await env.DB.prepare(
    "SELECT subject FROM themes ORDER BY id DESC LIMIT ?1",
  ).bind(SUBJECT_MEMORY).all<{ subject: string }>();
  const recentSubjects = pastThemes.map((t) => t.subject);

  const started = Date.now();
  while (toGenerate-- > 0) {
    if (Date.now() - started > RUN_BUDGET_MS) {
      console.log(JSON.stringify({ event: "run_budget_reached", generated: inTheme }));
      break;
    }
    // Skip the night. The buffer keeps filling past the window, so the first
    // cron tick after midnight finds ~6h of runway already queued and makes no
    // LLM calls at all until morning.
    const candidate = new Date((dueAt + interval) * 1000);
    if (isAsleep(candidate, sleepFrom, sleepTo)) {
      const wake = Math.floor(wakeUpAfter(candidate, sleepTo).getTime() / 1000);
      if (newest?.kind !== "pause" && !sleptThisRun) {
        await pause
          .bind(side, "Os dois foram dormir. A briga recomeça às 6h.", dueAt + interval)
          .run();
        sleptThisRun = true;
      }
      dueAt = wake - interval;
      continue;
    }

    // ---- theme boundary: close what was running, and open the next ----
    if (!theme || inTheme >= theme.ends_after) {
      if (theme) {
        const { results: themeMsgs } = await env.DB.prepare(
          "SELECT id, side, body, arg_id, due_at, topic, kind, theme_id FROM messages WHERE theme_id = ?1 AND kind = 'message' ORDER BY id",
        ).bind(theme.id).all<Message>();
        // Whoever is losing is the one who wants out, so they are the one who
        // changes the subject. It used to be "whoever's turn it is".
        side = losingSide(themeMsgs);
        // `outcome` is also the closed flag: the live theme is the row where it
        // is still null. No card is written — the change says itself.
        await env.DB.prepare("UPDATE themes SET outcome = ?1 WHERE id = ?2")
          .bind(JSON.stringify({ closedBy: side, messages: themeMsgs.length }), theme.id)
          .run();
      }

      const subject = pickSubject(recentSubjects);
      const endsAfter = themeLength(
        Math.min(subjectNodes(subject, "lula").length, subjectNodes(subject, "bolsonaro").length),
      );
      const opened = await env.DB.prepare(
        `INSERT INTO themes
           (subject, kind, title, opened_by, lula_goal, bolsonaro_goal,
            started_at, ends_after)
         VALUES (?1, ?2, ?3, ?4, '', '', ?5, ?6) RETURNING *`,
      )
        .bind(
          subject.id, subject.kind, subject.title, side,
          dueAt + interval, endsAfter,
        )
        .first<ThemeRow>();
      if (!opened) throw new Error("could not open a theme");

      recentSubjects.unshift(subject.id);
      theme = opened;
      inTheme = 0;
      // No `continue`: the very next thing written IS the subject change, said
      // by the losing side, as an ordinary message. There is no card.
    }

    // ---- an ordinary argument, inside the theme ----
    const subject = { id: theme.subject, kind: theme.kind as "tag" | "topic", title: theme.title };
    // Pressing means refusing to move on: same argument, new angle. It is also
    // the only way the `insistir` objective can ever be met.
    const myLast = transcript.findLast(
      (m) => m.side === side && m.theme_id === theme!.id && m.kind === "message",
    );
    const press = myLast && Math.random() < PRESS_CHANCE
      ? NODE_BY_ID.get(myLast.arg_id) ?? null
      : null;

    const { body, argId, gap } = await composeMessage(
      env, side, transcript, recent, allowLlm, subject,
      olderRows, dueAt + interval, press, inTheme === 0,
    );
    dueAt += gap;
    const topic = subject.kind === "topic" ? subject.id : null;
    await insert.bind(side, body, argId, dueAt, topic, "message", theme.id).run();

    transcript.push({
      id: 0, side, body, arg_id: argId, due_at: dueAt, topic, kind: "message", theme_id: theme.id,
    });
    recent.unshift(argId);
    inTheme++;
    // Not every turn changes hands. Sometimes someone just isn't finished.
    if (Math.random() >= DOUBLE_CHANCE) side = OTHER[side];
  }
}



