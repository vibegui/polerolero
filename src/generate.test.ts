import { expect, test } from "bun:test";
import { EXCLUSION_WINDOW, MAX_BODY_CHARS, TREES, guard, pickArgument } from "./generate.ts";
import { LENGTHS, MOVES, pickLength } from "./style.ts";
import type { Side } from "./env.ts";
import { TOPICS, TOPIC_RUN, pickTopic } from "./topics.ts";

// Selection is the one piece of logic here that rots silently: it keeps
// returning *something* while quietly repeating the same three arguments, and
// nobody notices until the feed is visibly a loop. Two assertions cover it.

test("never reuses an argument from inside the exclusion window", () => {
  const recent = TREES.lula.slice(0, EXCLUSION_WINDOW).map((n) => n.id);
  for (let i = 0; i < 60; i++) {
    expect(recent).not.toContain(pickArgument("lula", "bolso-ladrao", recent).id);
  }
});

// The window has to stay well under the tree size. When it does not, nothing is
// ever eligible, every pick falls through to the least-recently-used branch, and
// the feed emits one argument forever — which is precisely what shipped.
test("the exclusion window leaves room to choose", () => {
  for (const side of ["lula", "bolsonaro"] as const) {
    expect(TREES[side].length).toBeGreaterThan(EXCLUSION_WINDOW + 4);
  }
});

test("still returns an argument when history is saturated", () => {
  const recent = [...TREES.bolsonaro, ...TREES.bolsonaro].map((n) => n.id);
  const picked = pickArgument("bolsonaro", "lula-anulado", recent);
  expect(TREES.bolsonaro.map((n) => n.id)).toContain(picked.id);
});

test("prefers an argument that rebuts the opponent's topic", () => {
  // lula-anulado is tagged justica/lawfare/corrupcao; bolso-ladrao rebuts those.
  const picks = new Set(
    Array.from({ length: 80 }, () => pickArgument("bolsonaro", "lula-anulado", []).id),
  );
  const onTopic = TREES.bolsonaro
    .filter((n) => n.rebuts.some((t) => ["justica", "lawfare", "corrupcao"].includes(t)))
    .map((n) => n.id);
  expect(onTopic.length).toBeGreaterThan(0);
  for (const id of picks) expect(onTopic).toContain(id);
});

test("guard caps length and strips only balanced wrapping quotes", () => {
  expect(guard("a".repeat(4000))!.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
  expect(guard('"Cercado dos dois lados"')).toBe("Cercado dos dois lados");
  // A lone leading quote must survive, or stripping it orphans the closing one.
  expect(guard('"Mexer nos dados" é veredito?')).toBe('"Mexer nos dados" é veredito?');
});

test("guard rejects frame leaks and empty output", () => {
  expect(guard("  ")).toBeNull();
  expect(guard("Como uma IA, não posso opinar.")).toBeNull();
  expect(guard("```js\ncode\n```")).toBeNull();
});

test("every argument can answer at least one opponent tag", () => {
  for (const side of ["lula", "bolsonaro"] as const) {
    const oppTags = new Set(TREES[side === "lula" ? "bolsonaro" : "lula"].flatMap((n) => n.tags));
    for (const node of TREES[side]) {
      expect(node.rebuts.some((t) => oppTags.has(t))).toBe(true);
    }
  }
});

// The trace panel renders these straight onto a public page, so a node missing
// a verdict or shipping an empty explanation is a visible hole, not a warning.
test("every argument carries a verdict and an explanation", () => {
  for (const side of ["lula", "bolsonaro"] as const) {
    for (const node of TREES[side]) {
      expect(["verdadeiro", "falso", "depende"]).toContain(node.verdict);
      expect(node.explain.length).toBeGreaterThan(80);
    }
  }
});

test("length sampler covers every bucket and stays in range", () => {
  expect(pickLength(0).spec).toBe(LENGTHS[0]!.spec);
  expect(pickLength(0.999).spec).toBe(LENGTHS.at(-1)!.spec);
  const seen = new Set(Array.from({ length: 400 }, () => pickLength().paragraphs));
  expect(seen.size).toBe(new Set(LENGTHS.map((l) => l.paragraphs)).size);
  expect(MOVES.length).toBeGreaterThanOrEqual(6);

  // Explaining a case takes room, so most of the weight has to sit above one
  // short paragraph — a feed of one-liners was the thing this replaced.
  const multi = LENGTHS.filter((l) => l.paragraphs > 1).reduce((n, l) => n + l.weight, 0);
  const total = LENGTHS.reduce((n, l) => n + l.weight, 0);
  expect(multi / total).toBeGreaterThanOrEqual(0.4);
});

test("guard drops a restarted draft glued onto the first one", () => {
  const draft = "O senhor pergunta quem controla o INPE. Eu pergunto quem controla o bairro.";
  // Exactly the failure seen in the feed: model wrote it, stopped, wrote it again.
  const out = guard(`${draft} Ordem invertida.${draft} Prioridade invertida.`)!;
  expect(out).toBe(`${draft} Ordem invertida.`);
  // A message that merely repeats a short phrase must survive untouched.
  const fine = "Fila de cirurgia? E a fila do caixão, meu amigo? Fila é fila.";
  expect(guard(fine)).toBe(fine);
});

test("over-long messages end on a sentence, never mid-word", () => {
  // Non-repeating on purpose: repeated text would be eaten by the restart
  // detector before it ever reached the length cap.
  const sentences = Array.from(
    { length: 60 },
    (_, i) => `Argumento inflamado numero ${i} que segue sem parar nenhuma vez.`,
  ).join(" ");
  const out = guard(`${sentences} Togacracia, cens`)!;
  expect(out.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
  expect(out.endsWith(".")).toBe(true);

  // No sentence break at all -> fall back to a word boundary, never mid-word.
  const noStops = Array.from({ length: 300 }, (_, i) => `palavra${i}`).join(" ");
  const out2 = guard(noStops)!;
  expect(out2.endsWith("…")).toBe(true);
  expect(/palavra\d+…$/.test(out2)).toBe(true);
});

// The trees carry adjudicated facts now, so a node asserting one has to carry the
// citation with it — an unsourced "STF condenou" on a public page is just a claim.
test("nodes about convictions and investigations carry a source", () => {
  const mustCite = /condenou|condenad|STF|Polícia Federal|inquérito|sentença|PEC |Lei \d/i;
  for (const side of ["lula", "bolsonaro"] as const) {
    for (const node of TREES[side]) {
      if (mustCite.test(node.explain)) {
        expect(node.source, `${node.id} asserts a legal fact without a source`).toBeTruthy();
      }
    }
  }
});

test("both trees stayed answerable to each other after expanding", () => {
  for (const side of ["lula", "bolsonaro"] as const) {
    const oppTags = new Set(TREES[side === "lula" ? "bolsonaro" : "lula"].flatMap((n) => n.tags));
    const orphans = TREES[side].filter((n) => !n.rebuts.some((t) => oppTags.has(t)));
    expect(orphans.map((n) => n.id)).toEqual([]);
  }
});

// The bug this catches shipped to production and ran for over an hour: the feed
// emitted ONE argument per side, forever. Every unit test passed, because they
// all fed synthetic inputs instead of running the actual loop. This one runs the
// loop the way index.ts does — alternating sides, prepending each pick onto a
// shared history — and asserts the feed keeps moving.
test("the selector does not lock onto one argument over a long run", () => {
  const recent: string[] = [];
  const picked: Record<Side, string[]> = { lula: [], bolsonaro: [] };
  let side: Side = "lula";
  let opp: string | null = null;

  for (let i = 0; i < 600; i++) {
    const node = pickArgument(side, opp, recent);
    (picked[side] as string[]).push(node.id);
    recent.unshift(node.id);
    opp = node.id;
    side = side === "lula" ? "bolsonaro" : "lula";
  }

  for (const s of ["lula", "bolsonaro"] as const) {
    const tail = (picked[s] as string[]).slice(-30);
    // A locked selector scores 1 here. A healthy one uses most of its tree.
    expect(new Set(tail).size, `${s} repeated itself in the last 30 turns`).toBeGreaterThan(10);
    expect(new Set(picked[s] as string[]).size).toBeGreaterThan(TREES[s].length / 2);
  }
});

test("every hot topic arms both sides and cites the episode", () => {
  expect(TOPICS.length).toBeGreaterThan(0);
  for (const t of TOPICS) {
    // A one-sided topic is not a topic, it is a talking point with a title.
    expect(t.lula.length, `${t.id} has no lula arguments`).toBeGreaterThan(0);
    expect(t.bolsonaro.length, `${t.id} has no bolsonaro arguments`).toBeGreaterThan(0);
    expect(t.summary.length).toBeGreaterThan(60);
    for (const n of [...t.lula, ...t.bolsonaro]) {
      expect(["verdadeiro", "falso", "depende"]).toContain(n.verdict);
      expect(n.explain.length).toBeGreaterThan(80);
      expect(n.source, `${n.id} has no source`).toBeTruthy();
    }
    // The two sides must be able to answer each other inside the topic.
    const lulaTags = new Set(t.lula.flatMap((n) => n.tags));
    expect(t.bolsonaro.some((n) => n.rebuts.some((x) => lulaTags.has(x)))).toBe(true);
  }
});

test("a topic holds for a run and then releases the feed", () => {
  const id = TOPICS[0]!.id;
  // Mid-run: keeps going regardless of the roll.
  expect(pickTopic([id, id], 0.99)).toBe(id);
  // Run complete: must hand back, or a topic could hold the feed forever.
  expect(pickTopic(Array(TOPIC_RUN).fill(id), 0.0)).toBeNull();
  // Idle: a high roll stays out, a low roll enters.
  expect(pickTopic([null, null], 0.99)).toBeNull();
  expect(pickTopic([null, null], 0.0)).not.toBeNull();
});

test("topics eventually fire but do not dominate the feed", () => {
  const history: (string | null)[] = [];
  for (let i = 0; i < 2000; i++) history.unshift(pickTopic(history));
  const onTopic = history.filter(Boolean).length / history.length;
  expect(onTopic).toBeGreaterThan(0.05);
  expect(onTopic).toBeLessThan(0.6);
});
