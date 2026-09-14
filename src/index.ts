import type { Env, Message, ThemeRow } from "./env.ts";
import { topUp } from "./topup.ts";

export { LiveRoom } from "./live.ts";
import { inBlackout } from "./blackout.ts";
export { inBlackout };

const PAGE = 40;

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
          "SELECT id, side, body, arg_id, due_at, topic, kind, theme_id FROM messages ORDER BY id DESC LIMIT ?1",
        ).bind(PAGE).all<Message>()
      : await env.DB.prepare(
          "SELECT id, side, body, arg_id, due_at, topic, kind, theme_id FROM messages WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
        ).bind(before, PAGE).all<Message>();

    // The theme rows the page needs to render its cards. Fetched with the
    // messages rather than on demand: the closing card is a reveal, and it has
    // to land on the same tick as the message it follows, not one request later.
    const themeIds = [...new Set(results.map((m) => m.theme_id).filter((x): x is number => !!x))];
    const themes = themeIds.length > 0
      ? (await env.DB.prepare(
          `SELECT * FROM themes WHERE id IN (${themeIds.map(() => "?").join(",")})`,
        ).bind(...themeIds).all<ThemeRow>()).results
      : [];

    return Response.json(
      { messages: results, themes, now: Math.floor(Date.now() / 1000) },
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
    // A throw inside waitUntil is invisible: the cron just silently stops
    // producing and the feed drains hours later with nothing in the log to say
    // why. Catch and record it, then let the next tick retry.
    ctx.waitUntil(
      topUp(env).catch((err) => {
        console.error("topUp failed:", err instanceof Error ? err.stack ?? err.message : err);
      }),
    );
  },
};

