import type { Env, Message, Side } from "./env.ts";
import { OTHER, composeMessage } from "./generate.ts";
import { pickTopic } from "./topics.ts";

export { LiveRoom } from "./live.ts";
import { inBlackout } from "./blackout.ts";
export { inBlackout };

const PAGE = 40;
/** How far back to look for already-used arguments, and for the transcript. */
const RECENT_WINDOW = 200;

// -----------------------------------------------------------------------------
// HTTP
// -----------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/live" && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as {
        session?: string;
        ids?: number[];
        react?: { id: number; emoji: string };
      } | null;
      if (!body?.session) return new Response("bad session", { status: 400 });
      // One global room: there is one fight and one audience.
      const room = env.LIVE.get(env.LIVE.idFromName("global"));
      const state = await room.sync(
        String(body.session).slice(0, 64),
        (body.ids ?? []).filter(Number.isSafeInteger).slice(0, 60),
        body.react,
      );
      return Response.json(state, { headers: { "cache-control": "no-store" } });
    }

    if (url.pathname !== "/api/messages") {
      // Only /api/* reaches the worker at all (run_worker_first in
      // wrangler.jsonc); anything else here is a stray /api path.
      return new Response("not found", { status: 404 });
    }

    const beforeParam = url.searchParams.get("before");
    const before = beforeParam === null ? null : Number(beforeParam);
    if (before !== null && !Number.isSafeInteger(before)) {
      return new Response("bad before", { status: 400 });
    }

    const { results } = before === null
      ? await env.DB.prepare(
          "SELECT id, side, body, arg_id, due_at, topic FROM messages ORDER BY id DESC LIMIT ?1",
        ).bind(PAGE).all<Message>()
      : await env.DB.prepare(
          "SELECT id, side, body, arg_id, due_at, topic FROM messages WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
        ).bind(before, PAGE).all<Message>();

    return Response.json(
      { messages: results, now: Math.floor(Date.now() / 1000) },
      {
        headers: {
          // History pages were `max-age=31536000, immutable`, which is true of
          // the data and wrong for the obligation: a message can be ordered
          // removed, and an immutable year-long copy in every browser and
          // intermediary cannot be recalled. Deleting the D1 row would change
          // nothing. A day of shared cache with revalidation keeps scroll-back
          // effectively free while leaving a removal a way to propagate.
          "cache-control": before === null
            ? "public, max-age=30"
            : "public, max-age=0, s-maxage=86400, must-revalidate",
        },
      },
    );
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(topUp(env));
  },
};

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

  const interval = Number(env.MESSAGE_INTERVAL_SECONDS) || 60;
  const target = Number(env.BUFFER_TARGET) || 20;
  const maxPerRun = Number(env.MAX_PER_RUN) || 10;
  const maxPerDay = Number(env.MAX_PER_DAY) || 1600;
  const now = Math.floor(Date.now() / 1000);

  // Newest row first: it carries the last side, the last arg_id and MAX(due_at)
  // in one read, because due_at is monotonic with id.
  const { results: recentRows } = await env.DB.prepare(
    "SELECT id, side, body, arg_id, due_at, topic FROM messages ORDER BY id DESC LIMIT ?1",
  ).bind(RECENT_WINDOW).all<Message>();

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
  // Newest-first, same as recentRows — pickTopic reads run length off the head.
  const topics: (string | null)[] = recentRows.map((m) => m.topic);
  let side: Side = newest ? OTHER[newest.side] : "lula";
  let dueAt = Math.max(newest?.due_at ?? now, now);

  const insert = env.DB.prepare(
    "INSERT INTO messages (side, body, arg_id, due_at, topic, created_at) VALUES (?1, ?2, ?3, ?4, ?5, unixepoch())",
  );

  while (toGenerate-- > 0) {
    // One call per message, never one call writing both sides: a single
    // completion covering the whole exchange makes the two personas converge in
    // register, and the two voices being distinct is the entire joke.
    const topic = pickTopic(topics);
    const { body, argId } = await composeMessage(env, side, transcript, recent, allowLlm, topic);
    dueAt += interval;
    await insert.bind(side, body, argId, dueAt, topic).run();

    transcript.push({ id: 0, side, body, arg_id: argId, due_at: dueAt, topic });
    recent.unshift(argId);
    topics.unshift(topic);
    side = OTHER[side];
  }
}
