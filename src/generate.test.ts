import { expect, test } from "bun:test";
import {
  CALLBACK_CHANCE,
  EXCLUSION_WINDOW,
  MAX_BODY_CHARS,
  TREES,
  fabricatedCitation,
  guard,
  pickArgument,
  pickCallback,
} from "./generate.ts";
import { inBlackout } from "./blackout.ts";
import { isAsleep, wakeUpAfter } from "./sleep.ts";
import { LENGTHS, MOVES, gapFor, pickLength } from "./style.ts";
import type { Message, Side } from "./env.ts";
import {
  type Goal,
  SUBJECTS,
  THEME_MAX,
  THEME_MIN,
  assignGoals,
  goalHint,
  goalLabel,
  pickSubject,
  resolveGoal,
  subjectNodes,
  themeLength,
} from "./themes.ts";
import { OTHER } from "./trees.ts";
import { setting } from "./topup.ts";
import { TOPICS } from "./topics.ts";

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
  const draft = "O senhor pergunta quem controla o órgão. Eu pergunto quem controla o bairro.";
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
  // Deliberately broad. The first version of this pattern was a sieve: nine
  // nodes asserted convictions, charges and statutes and passed it clean.
  const mustCite =
    /conden|absolv|denúncia|denunciad|arquivad|anulad|réu|STF|STJ|TSE|TCU|IBGE|INPE|Polícia Federal|inquérito|sentença|pena[s]? |processo|julgad|lei |PEC |decreto/i;
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


// The old dice let a topic fire 12% of the time for six turns. Themes replaced
// that, so the property worth keeping is the opposite one: over a long run the
// rotation must actually reach every subject, not orbit a favourite few.
test("the rotation reaches every subject over a long run", () => {
  const seen = new Set<string>();
  const recent: string[] = [];
  for (let i = 0; i < 600; i++) {
    const s = pickSubject(recent);
    seen.add(s.id);
    recent.unshift(s.id);
  }
  expect(seen.size).toBe(SUBJECTS.length);
});

// Every one of these was measured against the previous guard, which was a
// substring scan. The left column is the vocabulary of Brazilian corruption,
// hunger and environment reporting — on a site about exactly those — and it was
// all being silently thrown away because "desviado" contains a slur.
test("guard stops mangling ordinary Portuguese", () => {
  for (const ok of [
    "Foram desviados R$ 4,7 bilhões do fundo.",
    "Bolsa Família serve pra matar a fome.",
    "A assistente social do posto confirma a fila.",
    "Precisamos parar de desmatar a Amazônia.",
    "Quem é fã do agro devia ler o relatório inteiro antes de falar.",
  ]) {
    expect(guard(ok), `blocked legitimate text: ${ok}`).not.toBeNull();
  }
});

// And the right column is what it used to let through onto a public page naming
// real candidates three weeks before an election.
test("guard blocks impersonation, slurs and crime imputation", () => {
  for (const bad of [
    "Sou o Lula falando: eu roubei mesmo, e daí?",   // TSE 23.610 art. 9º-B §3º
    "Ele é pedófilo, todo mundo sabe.",
    "DÁ MIMINDI PRA VAGABUNDO",                       // only the feminine was listed
    "O candidato mandou executar o adversário.",
    "Bolsonaro roubou o dinheiro do fundo.",          // unadjudicated, named person
  ]) {
    expect(guard(bad), `let through: ${bad}`).toBeNull();
  }
  // Adjudicated vocabulary must survive, or the honest half of the project dies.
  expect(guard("Bolsonaro foi condenado pelo STF a 27 anos.", "o STF condenou")).not.toBeNull();
  expect(guard("Flávio foi denunciado e o caso foi arquivado por nulidade.")).not.toBeNull();
});

test("the feed stops itself during the electoral blackout", () => {
  const env = { BLACKOUT_FROM: "2026-10-01T20:00:00Z", BLACKOUT_TO: "2026-10-05T20:00:00Z" } as never;
  expect(inBlackout(env, Date.parse("2026-09-30T12:00:00Z"))).toBe(false);
  expect(inBlackout(env, Date.parse("2026-10-02T12:00:00Z"))).toBe(true);
  expect(inBlackout(env, Date.parse("2026-10-04T23:00:00Z"))).toBe(true);
  expect(inBlackout(env, Date.parse("2026-10-06T12:00:00Z"))).toBe(false);
  // Unset or malformed dates must not silently disable the stop.
  expect(inBlackout({} as never, Date.now())).toBe(false);
});

// 25% of live messages cited an institution as proof that the argument's own
// explain never mentioned — "está no IBGE" about a node with no IBGE in it.
test("citing a source the argument never had is rejected", () => {
  const allowed = "Os dados do PRODES/INPE mostram quatro quedas anuais seguidas.";
  expect(fabricatedCitation("O INPE mostra que caiu.", allowed)).toBeNull();
  expect(fabricatedCitation("O IBGE mostra que caiu.", allowed)).toBe("IBGE");
  expect(guard("Segundo o IBGE, caiu muito.", allowed)).toBeNull();
  expect(guard("Segundo o INPE, caiu muito.", allowed)).not.toBeNull();
  // Arguing without naming a source must always be allowed.
  expect(guard("Caiu muito, e você sabe disso.", allowed)).not.toBeNull();
});

test("english slipping mid-sentence is caught, but lawfare survives", () => {
  expect(guard("A Lei 15.502 vai virar law permanente.")).toBeNull();
  expect(guard("Isso é lawfare puro, e você sabe.")).not.toBeNull();
  expect(guard("O advogado falou de lawfare e de perseguição.")).not.toBeNull();
});

test("corrupted tokens fused into a word are thrown away", () => {
  // Straight from the live feed.
  expect(guard("deixou o Brasil de joelho praQWidget mundo inteiro ver")).toBeNull();
  // Ordinary Portuguese, including caps for emphasis, must survive.
  expect(guard("deixou o Brasil de joelho pra o mundo inteiro ver")).not.toBeNull();
  expect(guard("Isso é ACORDA meu amigo, simples assim.")).not.toBeNull();
  expect(guard("O PT e o PL brigam, e o STF assiste.", "STF")).not.toBeNull();
});

// Midnight to 06:00 in Brasília. Computed in São Paulo local time rather than
// assuming UTC-3: Brazil dropped DST in 2019, which is exactly the kind of
// assumption that breaks silently if it ever returns.
test("the fans sleep from midnight to six, Brasília time", () => {
  const asleep = (iso: string) => isAsleep(new Date(iso));
  expect(asleep("2026-09-13T02:00:00Z")).toBe(false); // 23:00 SP
  expect(asleep("2026-09-13T02:59:00Z")).toBe(false); // 23:59 SP
  expect(asleep("2026-09-13T03:00:00Z")).toBe(true); // 00:00 SP
  expect(asleep("2026-09-13T08:59:00Z")).toBe(true); // 05:59 SP
  expect(asleep("2026-09-13T09:00:00Z")).toBe(false); // 06:00 SP

  // Wake is 06:00 local on the same local day, whatever the UTC date is doing.
  expect(wakeUpAfter(new Date("2026-09-13T04:00:00Z")).toISOString()).toBe(
    "2026-09-13T09:00:00.000Z",
  );
  expect(wakeUpAfter(new Date("2026-09-13T08:59:00Z")).toISOString()).toBe(
    "2026-09-13T09:00:00.000Z",
  );
});

// -----------------------------------------------------------------------------
// Callbacks
// -----------------------------------------------------------------------------

// The whole feature is a filter, and a filter that quietly matches nothing
// degrades to "no callbacks, ever" without a single error in the log — the same
// silent-rot failure mode pickArgument already shipped once.

/** A bolsonaro argument, plus a lula argument it is an answer to. */
const NODE = TREES.bolsonaro.find((n) => n.rebuts.length > 0)!;
const OPP = TREES.lula.find((n) => n.tags.some((t) => NODE.rebuts.includes(t)))!;

const DAY = 86_400;
const NOW = 1_800_000_000;

const msg = (over: Partial<Message> = {}): Message => ({
  id: 1,
  side: "lula",
  body: "primeiro parágrafo\n\nsegundo parágrafo",
  arg_id: OPP.id,
  due_at: NOW - 3 * DAY,
  topic: null,
  kind: "message",
  theme_id: null,
  ...over,
});

// The fixtures above are derived from the real trees, so this asserts the tag
// graph still connects the two sides at all. If it ever doesn't, callbacks are
// dead and so is half of pickArgument.
test("the trees still have an argument that answers the other side", () => {
  expect(NODE).toBeDefined();
  expect(OPP).toBeDefined();
});

test("digs up an old opponent message on the same tags", () => {
  const hit = pickCallback([msg()], "bolsonaro", NODE, NOW, 0);
  expect(hit).not.toBeNull();
  expect(hit!.daysAgo).toBe(3);
  // Only the first paragraph is handed over — that is all the model may quote.
  expect(hit!.body).toBe("primeiro parágrafo");
});

test("callbacks stay occasional", () => {
  expect(pickCallback([msg()], "bolsonaro", NODE, NOW, CALLBACK_CHANCE)).toBeNull();
  expect(pickCallback([msg()], "bolsonaro", NODE, NOW, 0.99)).toBeNull();
});

test("never calls back to your own words, a pause card, or yesterday's news", () => {
  const rejected: Partial<Message>[] = [
    { side: "bolsonaro" }, // same side: not a callback, just repeating yourself
    { kind: "pause" }, // the sleep card carries no argument
    { due_at: NOW - 3600 }, // still inside the transcript
    { arg_id: "arg-que-nao-existe-mais" }, // argument deleted from the tree
  ];
  for (const over of rejected) {
    expect(pickCallback([msg(over)], "bolsonaro", NODE, NOW, 0)).toBeNull();
  }
});

test("only calls back to an argument about the same thing", () => {
  const offTopic = TREES.lula.find((n) => !n.tags.some((t) => NODE.rebuts.includes(t)));
  expect(offTopic).toBeDefined();
  expect(pickCallback([msg({ arg_id: offTopic!.id })], "bolsonaro", NODE, NOW, 0)).toBeNull();
});

test("an empty pool is not an error", () => {
  expect(pickCallback([], "bolsonaro", NODE, NOW, 0)).toBeNull();
});

// -----------------------------------------------------------------------------
// Themes and the hidden game
// -----------------------------------------------------------------------------

// The objectives are scored by predicate, never by a model, so the scoreboard
// can only be wrong if these predicates are wrong. That makes them the one part
// of the mechanic worth pinning down.

const tmsg = (side: Side, arg_id: string, id = 0): Message => ({
  id, side, body: "", arg_id, due_at: 0, topic: null, kind: "message", theme_id: 1,
});

test("every theme has enough material on both sides to fill 20-30 turns", () => {
  expect(SUBJECTS.length).toBeGreaterThan(8);
  for (const s of SUBJECTS) {
    expect(subjectNodes(s, "lula").length, `${s.id} starves lula`).toBeGreaterThan(1);
    expect(subjectNodes(s, "bolsonaro").length, `${s.id} starves bolsonaro`).toBeGreaterThan(1);
  }
});

test("a theme restricts the argument pool but never empties it", () => {
  for (const s of SUBJECTS) {
    for (const side of ["lula", "bolsonaro"] as Side[]) {
      const pool = subjectNodes(s, side);
      const picked = pickArgument(side, null, [], pool, subjectNodes(s, OTHER[side]));
      expect(pool.map((n) => n.id), `${s.id}/${side} picked outside the theme`).toContain(picked.id);
    }
  }
});

test("the subject rotation does not repeat itself", () => {
  const recent = SUBJECTS.slice(0, 5).map((s) => s.id);
  for (let i = 0; i < 50; i++) expect(recent).not.toContain(pickSubject(recent, Math.random()).id);
});

test("arrastar counts only your own landings", () => {
  const target = TREES.lula[0]!.tags[0]!;
  const mine = TREES.lula.filter((n) => n.tags.includes(target)).slice(0, 3);
  const goal: Goal = { id: "arrastar", target };
  const msgs = mine.map((n) => tmsg("lula", n.id));
  expect(resolveGoal(goal, "lula", msgs, "lula").done).toBe(true);
  // The opponent landing the tag does nothing for you.
  expect(resolveGoal(goal, "bolsonaro", msgs, "lula").done).toBe(false);
});

test("evitar fails the moment the other side lands the tag", () => {
  const target = TREES.lula[0]!.tags[0]!;
  const leak = TREES.lula.find((n) => n.tags.includes(target))!;
  const goal: Goal = { id: "evitar", target };
  expect(resolveGoal(goal, "bolsonaro", [tmsg("lula", leak.id)], "lula").done).toBe(false);
  expect(resolveGoal(goal, "bolsonaro", [tmsg("bolsonaro", leak.id)], "lula").done).toBe(true);
});

test("insistir needs the same argument three times", () => {
  const id = TREES.lula[0]!.id;
  const goal: Goal = { id: "insistir", target: null };
  expect(resolveGoal(goal, "lula", [tmsg("lula", id), tmsg("lula", id)], "lula").done).toBe(false);
  expect(
    resolveGoal(goal, "lula", [tmsg("lula", id), tmsg("lula", id), tmsg("lula", id)], "lula").done,
  ).toBe(true);
});

test("blindar is not awarded to someone nobody asked anything", () => {
  const goal: Goal = { id: "blindar", target: null };
  // Never answering because you were never engaged is not stonewalling.
  expect(resolveGoal(goal, "lula", [tmsg("lula", TREES.lula[0]!.id)], "lula").done).toBe(false);

  // Three unanswered exchanges: bolsonaro plays arguments that rebut nothing
  // lula just said. Built from the real trees so it stays honest.
  const lulaNode = TREES.lula[0]!;
  const dodge = TREES.bolsonaro.find((n) => !n.rebuts.some((t) => lulaNode.tags.includes(t)))!;
  const seq: Message[] = [];
  for (let i = 0; i < 3; i++) {
    seq.push(tmsg("lula", lulaNode.id), tmsg("bolsonaro", dodge.id));
  }
  expect(resolveGoal(goal, "bolsonaro", seq, "lula").done).toBe(true);
});

test("encerrar goes to whoever walked away", () => {
  const goal: Goal = { id: "encerrar", target: null };
  expect(resolveGoal(goal, "lula", [], "lula").done).toBe(true);
  expect(resolveGoal(goal, "lula", [], "bolsonaro").done).toBe(false);
});

test("goals are always describable, in the prompt and on the closing card", () => {
  for (let i = 0; i < 200; i++) {
    const subject = SUBJECTS[i % SUBJECTS.length]!;
    const goals = assignGoals(subject);
    for (const side of ["lula", "bolsonaro"] as Side[]) {
      const g = goals[side];
      expect(goalHint(g).length).toBeGreaterThan(20);
      expect(goalLabel(g).length).toBeGreaterThan(10);
      // A targeted goal without a target renders as "para null" on a public page.
      if (g.id === "arrastar" || g.id === "evitar") expect(g.target).toBeTruthy();
    }
  }
});

test("pace weights keep the daily volume, and therefore the bill, unchanged", () => {
  const mean = LENGTHS.reduce((s, l) => s + l.weight * l.pace, 0) / 100;
  expect(mean).toBeGreaterThan(0.95);
  expect(mean).toBeLessThan(1.05);
  // And a gap is always a sane number of seconds, never zero or negative.
  for (const l of LENGTHS) {
    for (const r of [0, 0.5, 0.999]) {
      const g = gapFor(l.pace, 60, r);
      expect(g).toBeGreaterThan(9);
      expect(g).toBeLessThan(150);
    }
  }
});

test("a zero budget actually means zero", () => {
  // `Number(x) || fallback` turned MAX_PER_DAY=0 into 1600 — the kill switch
  // could not be switched. See setting() in topup.ts.
  expect(setting("0", 1600)).toBe(0);
  expect(setting(undefined, 1600)).toBe(1600);
  expect(setting("", 1600)).toBe(1600);
  expect(setting("nonsense", 1600)).toBe(1600);
  expect(setting("42", 1600)).toBe(42);
});

test("a thin theme ends before it starts looping", () => {
  // Four arguments a side cannot carry thirty turns. Before this, ends_after
  // was a flat 20-30 and a four-node topic repeated one claim five times.
  expect(themeLength(4, 0.5)).toBeLessThan(16);
  expect(themeLength(12, 0.5)).toBeGreaterThan(20);
  for (const pool of [1, 2, 4, 8, 20, 100]) {
    for (const r of [0, 0.5, 0.999]) {
      const n = themeLength(pool, r);
      expect(n).toBeGreaterThanOrEqual(THEME_MIN);
      expect(n).toBeLessThanOrEqual(THEME_MAX);
    }
  }
});

test("a small argument pool still excludes something", () => {
  // EXCLUSION was `min(24, pool - 4)`, which is ZERO at pool size 4: no
  // exclusion at all inside a thin theme.
  for (const s of SUBJECTS) {
    for (const side of ["lula", "bolsonaro"] as Side[]) {
      const pool = subjectNodes(s, side);
      if (pool.length < 2) continue;
      const opp = subjectNodes(s, OTHER[side]);
      const first = pickArgument(side, null, [], pool, opp);
      // With the freshly used argument in history it must not come straight back.
      for (let i = 0; i < 30; i++) {
        expect(pickArgument(side, null, [first.id], pool, opp).id).not.toBe(first.id);
      }
    }
  }
});

test("insistir is never handed out where repeating is unavoidable", () => {
  // A three-argument theme forces repeats, so awarding "martelou o mesmo
  // argumento" there congratulates both sides for arithmetic.
  for (const s of SUBJECTS) {
    for (let i = 0; i < 60; i++) {
      const goals = assignGoals(s);
      for (const side of ["lula", "bolsonaro"] as Side[]) {
        if (goals[side].id !== "insistir") continue;
        expect(subjectNodes(s, side).length, `${s.id}/${side} got insistir on a thin pool`)
          .toBeGreaterThanOrEqual(6);
      }
    }
  }
});
