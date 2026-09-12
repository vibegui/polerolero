import { expect, test } from "bun:test";
import { TREES, guard, pickArgument } from "./generate.ts";

// Selection is the one piece of logic here that rots silently: it keeps
// returning *something* while quietly repeating the same three arguments, and
// nobody notices until the feed is visibly a loop. Two assertions cover it.

test("never reuses an argument that is still inside the recent window", () => {
  const recent = TREES.lula.map((n) => n.id).slice(0, TREES.lula.length - 1);
  for (let i = 0; i < 50; i++) {
    const picked = pickArgument("lula", "bolso-ladrao", recent);
    expect(recent).not.toContain(picked.id);
  }
});

test("still returns an argument when the whole tree has been used", () => {
  // Newest-first, so the last entry is the least recently used.
  const recent = TREES.bolsonaro.map((n) => n.id);
  const picked = pickArgument("bolsonaro", "lula-anulado", recent);
  expect(picked.id).toBe(recent.at(-1) as string);
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
  expect(guard("a".repeat(500))!.length).toBeLessThanOrEqual(220);
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
