import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { Env, Message, ThemeRow } from "./env.ts";
import { callbackPool, topUp } from "./topup.ts";
import { THEME_MAX, THEME_MIN } from "./themes.ts";
import { TREES } from "./trees.ts";

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
      run: async () => ({ meta: { changes: q.run(...(args as never[])).changes } }),
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


test("a second run cannot append while the first holds the lease", async () => {
  const { env, db } = testEnv();
  // Cron delivery is at-least-once. Two overlapping runs both read the same
  // newest row and both append from it: production got two lula messages one
  // second apart carrying the SAME arg_id, at twice the model spend.
  db.run("UPDATE locks SET until = unixepoch() + 240 WHERE name = 'topup'");
  await topUp(env);
  expect((db.query("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n).toBe(0);

  // An expired lease is not a wedged one: the next tick simply takes it.
  db.run("UPDATE locks SET until = unixepoch() - 1 WHERE name = 'topup'");
  await topUp(env);
  expect((db.query("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n)
    .toBeGreaterThan(0);
});

test("the lease is released even when a run throws", async () => {
  const { env, db } = testEnv();
  // A run that dies holding the lease would stall the feed until the deadline.
  db.run("DROP TABLE themes");
  await topUp(env).catch(() => {});
  expect((db.query("SELECT until FROM locks WHERE name = 'topup'").get() as { until: number }).until)
    .toBe(0);
});

test("the callback pool query actually returns the messages it should", async () => {
  const { env, db } = testEnv();
  const now = Math.floor(Date.now() / 1000);
  const add = (daysAgo: number, kind = "message") =>
    db.run(
      "INSERT INTO messages (side, body, arg_id, due_at, kind, created_at) VALUES ('lula', 'b', 'lula-comunismo', ?, ?, ?)",
      [now - Math.round(daysAgo * 86400), kind, now],
    );

  add(3); add(7); add(13.5); // inside the window
  add(0.5); // too recent — still in the transcript
  add(30); // too old to be recognised
  add(3, "pause"); // a card, not an argument

  const pool = await callbackPool(env);
  expect(pool.length, "the 1-14 day window did not select what it should").toBe(3);
  for (const m of pool) {
    expect(m.kind).toBe("message");
    expect(now - m.due_at).toBeGreaterThan(86_400);
    expect(now - m.due_at).toBeLessThan(1_209_600);
  }
});

test("a degraded turn reuses a past rendering instead of the canned claim", async () => {
  const { env, db } = testEnv();
  const now = Math.floor(Date.now() / 1000);
  // Every argument the feed has ever published owns a library of phrasings that
  // already cleared the guard. Seed one per node, the way months of running
  // would, then force every turn to degrade (MAX_PER_DAY=0 → no model call).
  for (const side of ["lula", "bolsonaro"] as const) {
    for (const n of TREES[side]) {
      // Three phrasings each: an argument that has run for months owns several,
      // and one alone is exhausted the moment the same point is pressed twice.
      for (let v = 1; v <= 3; v++) {
        db.run(
          "INSERT INTO messages (side, body, arg_id, due_at, kind, created_at) VALUES (?, ?, ?, ?, 'message', ?)",
          [side, `RENDERIZACAO ${v} DE ${n.id}`, n.id, now - (5 + v) * 86400, now],
        );
      }
    }
  }
  const seeded = (db.query("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n;
  for (let i = 0; i < 2; i++) await topUp(env);

  const fresh = db.query("SELECT body, arg_id FROM messages WHERE id > ? AND kind = 'message'")
    .all(seeded) as { body: string; arg_id: string }[];
  expect(fresh.length).toBeGreaterThan(10);

  const claims = new Set([...TREES.lula, ...TREES.bolsonaro].map((n) => n.claim));
  const verbatim = fresh.filter((m) => claims.has(m.body));
  expect(verbatim.map((m) => m.arg_id), "a canned claim was published verbatim").toEqual([]);
  // And what it published is a real past rendering of the SAME argument.
  for (const m of fresh) {
    if (m.body.startsWith("RENDERIZACAO")) expect(m.body).toMatch(new RegExp(`DE ${m.arg_id}$`));
  }
});
