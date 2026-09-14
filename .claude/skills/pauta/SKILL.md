---
name: pauta
description: "Research the Brazilian news cycle across the ideological spectrum and turn it into polerolero content — new topics/*.json for both sides, refreshed facts on existing ones, and a read on who actually votes for each candidate. Use when the user says /pauta, asks to update the topics, refresh the facts, add a scandal, check what the country is arguing about this week, or look at the voting-intention breakdown."
---

# /pauta

The feed argues about what is in `arguments/` and `topics/`. Nothing reaches it
any other way. This is how that material gets refreshed without the project
turning into the thing it criticises.

```
/pauta                 # full pass: scan the cycle, propose topics, open a PR
/pauta escandalos      # only scandals and investigations, both sides
/pauta <assunto>       # research one subject and draft a topic for it
/pauta demografia      # voting intention broken down by who is actually voting
/pauta checar          # re-verify the facts in existing topics; flag what rotted
```

## Read across the spectrum, on purpose

Reading one outlet produces one side's talking points with a verdict attached,
which is exactly the failure this project exists to mock. Always sample all
three columns:

| lean | outlets |
|---|---|
| centre / reference | g1 (Globo), Folha, Estadão, Poder360, Agência Brasil, Agência Senado |
| left of centre | CNN Brasil, Carta Capital, Brasil de Fato, Intercept Brasil |
| right of centre | Jovem Pan, Gazeta do Povo, Revista Oeste, Antagonista |

Fact-checkers for verdicts, never as the only source: Lupa, Aos Fatos, Comprova,
Estadão Verifica.

**The cross-source rule.** A story becomes a topic only if outlets from **more
than one column** are carrying it. One column alone is a talking point, not a
subject — and a talking point with a verdict on it is a pamphlet.

When the columns disagree about what happened, that disagreement IS the topic.
Write both readings as arguments and put the adjudicated part in `explain`.

## What a topic must satisfy

The tests enforce most of this; read `CONTRIBUTING.md` and `AGENTS.md` first.

- **Both sides, at least 2 nodes each.** A one-sided topic is a talking point
  with a title. A topic shipped with one `lula` node this week and the test
  caught it before it starved a side of a 10–30 message theme.
- **Every node carries a `source`.** Non-negotiable for anything asserting a
  conviction, charge, inquiry, statute or number.
- **Reuse the existing tag vocabulary.** Run this before writing:
  ```bash
  python3 -c "import json,glob;t=set();[t.update(n['tags']) for f in ['arguments/lula.json','arguments/bolsonaro.json'] for n in json.load(open(f))];print(' '.join(sorted(t)))"
  ```
  A topic that invents its own tags is an **island**: the bots cannot drift in
  or out of it, and it will only ever be reached as a whole-theme jump.
- `register` is one of `orgulhoso`, `indignado`, `deboche`, `conspiratorio`.
- `verdict` is `verdadeiro`, `falso` or `depende`. `depende` is the honest
  answer most of the time and renders as "é mais complicado".
- **`explain` must say what the claim gets right**, even when the verdict is
  harsh. That is the line between this project and a pamphlet.
- **Mark at least one node against its own side** when the evidence supports it.
  `CONTRIBUTING.md` calls this the most valuable contribution here.

## The line that cannot be crossed

An open inquiry is not a charge, a charge is not a conviction, and an annulment
on procedural grounds is neither acquittal nor guilt. Write every scandal node
to that distinction — the guard in `src/generate.ts` enforces it at runtime and
will throw the message away, but the node text is what a reader sees in the
panel.

The 2026 candidate on the right is **Flávio Bolsonaro**, a senator. He is not
military, and his father's conviction is his father's. Never blur them.

Electoral law is live: Res.-TSE 23.610 and Código Eleitoral arts. 324 and 326-A.
Check `BLACKOUT_FROM`/`BLACKOUT_TO` in `wrangler.jsonc` against the actual round
dates before every pass.

## Demography — who each one is talking to

`/pauta demografia` pulls the latest voting intention from **Datafolha, Quaest,
AtlasIntel, Ipespe, Genial/Quaest**, and — this is the part that matters —
the crosstabs, not the headline number: sex, age, income band, schooling,
region, religion (evangelical vs catholic), race, urban/rural.

Write the digest to `research/demografia.md`: for each side, who its base
actually is, which groups moved since the last wave, and which subjects each
group cares about. Cite the institute and the field dates for every figure.

This does **not** go into a prompt as instructions to pander. It informs what
subjects deserve topics at all: if a bloc is decisive and the feed has nothing
about what it argues over, that is the gap to fill next.

Never invent a number. If the institutes disagree, say they disagree and give
the range. Polls have margins and houses have leans.

## The pass

1. Scan the three columns for the week. List candidate stories with which
   columns carry each.
2. Drop anything in one column only. Say what you dropped and why.
3. For survivors, research the adjudicated state: what is decided, what is
   merely alleged, what the institutes measured.
4. Draft `topics/<id>.json`. Check the tag vocabulary first.
5. Register it in the `TOPICS` array in `src/topics.ts` (alphabetical).
6. `bun run check && bun test` — the invariant tests catch a starved side, a
   missing source, a short summary and a disconnected tag graph.
7. Verify the topic is not an island:
   ```bash
   python3 -c "
   import json,sys
   d=json.load(open(sys.argv[1]))
   std={t for f in ['arguments/lula.json','arguments/bolsonaro.json'] for n in json.load(open(f)) for t in n['tags']}
   lt={t for n in d['lula'] for t in n['tags']}; bt={t for n in d['bolsonaro'] for t in n['tags']}
   print('bridges to the standing trees:', len((lt|bt)&std))" topics/<id>.json
   ```
8. Open a PR. **Do not auto-merge.** A verdict is editorial and a human signs
   it — auto-publishing unreviewed verdicts is the one failure that would make
   this project the thing it exists to criticise.

## Retiring a topic

Facts rot, and this project has shipped several that did: the "taxa das
blusinhas" was repealed two days after being written about in the present
tense. `/pauta checar` re-verifies each topic's claims against current sources
and either updates `explain` or sets `"active": false`, which takes it out of
the rotation without deleting the history that referenced it.
