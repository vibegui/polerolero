import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { Env, Message, ThemeRow } from "./env.ts";
import { topUp } from "./topup.ts";
import { THEME_MAX, THEME_MIN } from "./themes.ts";

/**
 * topUp against a real SQLite, running the real migrations.
 *
 * The unit tests cover the predicates; nothing covered the *lifecycle* — that a
 * theme opens, that messages get stapled to it, that it closes exactly once
 * with an outcome, and that due_at never goes backwards. Every one of those is
 * a SQL-shaped bug that type checking cannot see, and `wrangler dev`'s local
 * scheduled dispatch is broken in this environment (it 500s on the pre-existing
 * code too), so there is no other way to exercise it before deploying.
 *
 * MAX_PER_DAY is 0, which forces allowLlm false: no network, no spend, and the
 * exact code path a degraded tick takes in production.
 */
function testEnv(): { env: Env; db: Database } {
  const db = new Database(":memory:");
  for (const f of readdirSync("migrations").sort()) {
    // Strip -- comments before splitting: the migrations explain themselves at
    // length, and a comment sentence containing a semicolon splits into a
    // fragment that SQLite rejects as incomplete input.
    const sql = readFileSync(`migrations/${f}`, "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    for (const stmt of sql.split(";")) if (stmt.trim()) db.run(stmt);
  }
  // The slice of D1 that index.ts actually uses.
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const q = db.query(sql);
    const api = {
      bind: (...a: unknown[]) => { args = a; return api; },
      all: async <T,>() => ({ results: q.all(...(args as never[])) as T[] }),
      first: async <T,>() => (q.get(...(args as never[])) ?? null) as T | null,
      run: async () => { q.run(...(args as never[])); },
    };
    return api;
  };
  const env = {
    DB: { prepare },
    MESSAGE_INTERVAL_SECONDS: "60",
    BUFFER_TARGET: "60",
    MAX_PER_RUN: "60",
    MAX_PER_DAY: "0", // forces allowLlm false — no model call, no spend
    SLEEP_FROM: "0",
    SLEEP_TO: "0", // never asleep, so the test is not clock-dependent
  } as unknown as Env;
  return { env, db };
}

test("a run opens a theme, fills it, closes it once, and never rewinds the clock", async () => {
  const { env, db } = testEnv();

  // Enough turns to cover a full theme plus the start of the next.
  for (let i = 0; i < 4; i++) await topUp(env);

  const themes = db.query("SELECT * FROM themes ORDER BY id").all() as ThemeRow[];
  const msgs = db.query("SELECT * FROM messages ORDER BY id").all() as Message[];
  expect(themes.length).toBeGreaterThan(0);
  expect(msgs.length).toBeGreaterThan(THEME_MIN);

  // Exactly one theme is live at a time.
  expect(themes.filter((t) => t.outcome === null).length).toBe(1);

  for (const t of themes) {
    expect(t.ends_after).toBeGreaterThanOrEqual(THEME_MIN);
    expect(t.ends_after).toBeLessThanOrEqual(THEME_MAX);
    const opens = msgs.filter((m) => m.theme_id === t.id && m.kind === "tema");
    const closes = msgs.filter((m) => m.theme_id === t.id && m.kind === "fecho");
    expect(opens.length, `theme ${t.id} opened ${opens.length}x`).toBe(1);
    expect(closes.length, `theme ${t.id} closed ${closes.length}x`).toBe(t.outcome ? 1 : 0);
    // A closed theme's card must carry a decided verdict for BOTH sides, or the
    // reveal renders half-empty on a public page.
    if (t.outcome) {
      const o = JSON.parse(t.outcome);
      for (const side of ["lula", "bolsonaro"]) {
        expect(typeof o[side].done).toBe("boolean");
        expect(o[side].detail.length).toBeGreaterThan(3);
      }
    }
  }

  // Every argument belongs to a theme, and the feed is strictly ordered.
  for (const m of msgs) {
    if (m.kind === "message") expect(m.theme_id, `message ${m.id} has no theme`).toBeTruthy();
  }
  for (let i = 1; i < msgs.length; i++) {
    expect(msgs[i]!.due_at, `row ${msgs[i]!.id} rewinds`).toBeGreaterThan(msgs[i - 1]!.due_at);
  }

  // The metronome is gone: gaps have to actually vary.
  const gaps = msgs.slice(1).map((m, i) => m.due_at - msgs[i]!.due_at);
  expect(new Set(gaps).size).toBeGreaterThan(3);
});

test("a theme closes only after its full run, and the next one is a new subject", async () => {
  const { env, db } = testEnv();
  for (let i = 0; i < 4; i++) await topUp(env);

  const themes = db.query("SELECT * FROM themes ORDER BY id").all() as ThemeRow[];
  for (const t of themes.filter((x) => x.outcome)) {
    const n = (db.query(
      "SELECT COUNT(*) AS n FROM messages WHERE theme_id = ? AND kind = 'message'",
    ).get(t.id) as { n: number }).n;
    expect(n, `theme ${t.id} closed at ${n} of ${t.ends_after}`).toBeGreaterThanOrEqual(t.ends_after);
  }
  const subjects = themes.map((t) => t.subject);
  expect(new Set(subjects).size, "the rotation repeated a subject back to back").toBe(subjects.length);
});
