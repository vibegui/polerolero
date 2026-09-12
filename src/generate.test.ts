import { expect, test } from "bun:test";
import { MAX_BODY_CHARS, TREES, guard, pickArgument } from "./generate.ts";
import { LENGTHS, MOVES, pickLength } from "./style.ts";

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
