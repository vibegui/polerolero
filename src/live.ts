import { DurableObject } from "cloudflare:workers";
import { EMOJI, type Emoji, type LiveState } from "./live-shared.ts";

/**
 * Presence and reactions, shared by everyone watching.
 *
 * This is the one part of the site that genuinely needs coordination, and it is
 * where a Durable Object earns its place — unlike the feed, which stays on
 * `due_at` scheduling precisely so it needs none. A single global instance:
 * there is one fight and one audience.
 *
 * Presence lives in memory, because it is worthless the moment it is stale and
 * writing a row per viewer per heartbeat would be absurd. Reactions live in the
 * DO's SQLite, because someone who reacts expects it to still be there tomorrow.
 */

/** A viewer is "here" if they heartbeat within this window. */
const PRESENCE_TTL_MS = 45_000;

export class LiveRoom extends DurableObject {
  /** session id → last heartbeat. Rebuilt from scratch after eviction, which is
   *  correct: nobody is watching a room that has been idle long enough to evict. */
  private seen = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx as never, env as never);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS reactions (
           message_id INTEGER NOT NULL,
           emoji      TEXT    NOT NULL,
           session    TEXT    NOT NULL,
           PRIMARY KEY (message_id, emoji, session)
         )`,
      );
    });
  }

  /**
   * One round trip does everything: heartbeat, optional react, and read back the
   * counts for the messages currently on screen. Three endpoints would be three
   * times the requests for a page that polls.
   */
  async sync(
    session: string,
    ids: number[],
    react?: { id: number; emoji: string },
  ): Promise<LiveState> {
    const now = Date.now();
    this.seen.set(session, now);
    for (const [k, t] of this.seen) if (now - t > PRESENCE_TTL_MS) this.seen.delete(k);

    if (react && (EMOJI as readonly string[]).includes(react.emoji)) {
      // Toggle: reacting twice takes it back. One reaction per person per emoji
      // per message, which is what the primary key enforces.
      const existing = this.ctx.storage.sql
        .exec(
          "SELECT 1 FROM reactions WHERE message_id = ? AND emoji = ? AND session = ?",
          react.id,
          react.emoji,
          session,
        )
        .toArray();
      if (existing.length > 0) {
        this.ctx.storage.sql.exec(
          "DELETE FROM reactions WHERE message_id = ? AND emoji = ? AND session = ?",
          react.id,
          react.emoji,
          session,
        );
      } else {
        this.ctx.storage.sql.exec(
          "INSERT INTO reactions (message_id, emoji, session) VALUES (?, ?, ?)",
          react.id,
          react.emoji,
          session,
        );
      }
    }

    const reactions: LiveState["reactions"] = {};
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT message_id, emoji, COUNT(*) AS n FROM reactions
             WHERE message_id IN (${placeholders}) GROUP BY message_id, emoji`,
          ...ids,
        )
        .toArray() as { message_id: number; emoji: Emoji; n: number }[];
      for (const r of rows) {
        (reactions[r.message_id] ??= {})[r.emoji] = r.n;
      }
    }

    return { viewers: this.seen.size, reactions };
  }
}
