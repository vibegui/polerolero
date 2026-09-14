# Agent instructions — polerolero

Read this before touching anything. Most of it is scar tissue: every rule below
exists because the thing it forbids already shipped and broke in production.

## What this is

An always-on feed where two AI agents argue about Brazilian politics forever,
at polerolero.com. It is an art project with a real editorial spine: every
message links to the arguments behind it, each carrying a verdict —
`verdadeiro` / `falso` / `depende` — and a source.

**It takes a position, deliberately.** It does not feign symmetry between the
two sides. That position is grounded in the adjudicated record, not in
preference, and the drawer says so in the site's own voice. Do not "rebalance"
it into false equivalence.

**The hard line:** the 2026 candidate is **Flávio Bolsonaro**, a senator. He is
not military, and his rachadinha case was shelved on procedural nullity — never
tried on the merits. His father's conviction is his father's. Never blur them.
Blurring them makes this the exact thing it exists to criticise.

## Run it

```bash
bun install
wrangler d1 migrations apply polerolero --local
bun run build            # vite -> dist/, required before wrangler dev
wrangler dev             # :8787
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"   # force a tick
bun run check && bun test
```

`wrangler dev` snapshots `dist/` at startup. **Rebuild means restart**, or the
HTML asks for asset hashes the server doesn't know and every module 404s into
the SPA fallback as `text/html`.

Ticks make real, billed model calls — there is no local emulation. To exercise
generation logic for free, empty `.dev.vars`: every call fails and falls back to
the argument's verbatim `claim`, which takes the same code path.

Deploy: push to `main` (Cloudflare builds) or `wrangler deploy`. **Migrations
that drop or rename a column must be applied AFTER the new worker is live** —
applying `0003_drop_persona` first took the API down, because the running worker
still selected the column.

## Architecture, and why

One Worker. One D1. One Durable Object. Everything else is a binding.

- **`due_at` scheduling.** Every row carries the instant it becomes visible, 60s
  apart. The API serves rows *from the future*; the client renders what's due and
  sets local timers for the rest. One fetch buys 10–20 minutes, and everyone on
  earth sees the same message land on the same wall-clock second. This is why
  the feed needs no socket and no per-viewer state. Don't replace it with
  polling-for-new; you'd lose the synchrony, which is the best property here.
- **Buffer top-up, not one-per-minute.** `scheduled()` keeps ~20 messages queued
  ahead and exits. A failed run retries in five minutes with fifteen of runway
  left, so nobody sees a gap.
- **One model call per message.** Never one call writing both sides — the two
  voices converge in register and the joke dies.
- **Themes.** There is always exactly one theme running (`src/themes.ts`,
  `themes` table). It is either a tag from the standing trees or a hot topic,
  it lasts `themeLength(pool)` arguments — three per available argument,
  clamped 10-30 — and the side that is LOSING changes it, as an ordinary
  message, which is the whole tell. `losingSide()` measures that by who has
  been answering more: answering is being led, and the side setting the agenda
  is winning.

  There used to be a secret rhetorical objective per side, revealed on a card
  when the theme closed. It was cut: it read as a game layer bolted onto a
  conversation, and the conversation is the piece worth having. `kind='tema'`
  and `kind='fecho'` rows survive only in history and render as nothing. The
  goal columns are still on the table, written empty.


- **Cadence is not a metronome.** Gaps come from `gapFor(length.pace, ...)`, so
  a two-sentence jab is fired back at fast and a three-paragraph wall gets time
  to be read. The `pace` weights are set so the weighted mean is within 2% of
  `MESSAGE_INTERVAL_SECONDS` — this changes the texture, not the daily volume,
  and therefore not the bill. A test asserts the mean.
- **Callbacks — the long memory.** `CONTEXT_TURNS = 6` gives the two of them
  amnesia. On roughly a quarter of the longer messages, `pickCallback()` digs a
  message the *opponent* published 1–14 days ago out of a pool read once per
  tick, and hands it over to be quoted back. Relevance is the same tag adjacency
  `pickArgument` runs on, so the hit is by construction the opponent making
  today's point already — which is the thesis, not a bug. Quoting it is the only
  quote on the site a reader can check by scrolling up, so the callback text is
  added to the material `inspect()` allows; leaving it out threw away every
  message that quoted an institution the opponent had named.
- **`LiveRoom` DO** holds presence (in memory, worthless when stale) and
  reactions (its SQLite, expected to persist). One global room. This is the only
  part that genuinely needs coordination.
- **Degradation, always.** Any failure publishes the argument's verbatim
  `claim`. The feed never stops and a bad API day costs nothing.

## Invariants you can break by accident

**The exclusion window must stay well below tree size.** `EXCLUSION_WINDOW = 24`
against ~40 nodes per side. When the window exceeded the tree, nothing was ever
eligible, every pick fell to the least-recently-used branch — which is itself a
fixed point — and the live feed published *one argument per side for over an
hour*. A test asserts the margin. Every unit test passed throughout, because
they fed synthetic inputs; the regression test now runs 600 turns of the real
loop.

**The guard fails closed, and it is a trust boundary.** `inspect()` in
`src/generate.ts` rejects slurs, incitement, first-person impersonation of a
named politician, crime imputation against a named person, English leaking
mid-sentence, garbled camelCase tokens, and — the important one — **any
institution not present in the material the model was handed**. 25% of live
messages once cited IBGE/INPE/TCU as proof of things their own argument never
mentioned; a prompt rule did not hold, because the model isn't lying, it's
pattern-completing.

Use word boundaries. The first version was `includes()` over substrings and
blocked `desviados` (contains a slur), `matar a fome` and `desmatar` — the core
vocabulary of this subject — while passing `ele é pedófilo`.

Adjudicated vocabulary (`condenado`, `denunciado`, `réu`, `investigado`) must
keep passing. Blocking it would gut the honest half of the project.

**The electoral blackout is law, not a preference.** Res.-TSE 23.610 art. 9º-B
§3º-A forbids publishing new AI-synthetic content about candidates from 72h
before to 24h after the vote, *even if labelled*. `inBlackout()` halts
generation; the window is in `wrangler.jsonc` vars. **Confirm the round dates
before each round.** Related: the site must name a contactable operator (Lei
9.504 art. 57-D bans anonymity during the campaign), and history pages must stay
removable — never put `immutable` back on `?before=`, or a court-ordered
takedown becomes technically unexecutable.

**A small argument pool still has to exclude something.** `pickArgument`'s
window was `min(EXCLUSION_WINDOW, pool - 4)`, which is **zero** on a four-node
theme — no exclusion at all, and a simulated run repeated one claim five times
in twenty-three turns. It is now `max(1, min(EXCLUSION_WINDOW, pool - 2))`.
Related: `themeLength` scales the session to the material, and `insistir` is
never assigned to a side with fewer than six arguments, because there repeating
is arithmetic rather than strategy.

**It is one to one, and there is no audience.** The system prompt said "num
grupo de WhatsApp" and the model duly opened messages with "Gente, esse ponto
ele já trouxe", narrating the argument to spectators who do not exist. The
personas address each OTHER, in second person, always. `AUDIENCE` in the guard
rejects vocatives — matched only at sentence start, because "a gente" means
"we" and is in half the messages here.

**The canned `claim` is a last resort, not a fallback.** It is a one-line
internal summary, not something a person would type, and publishing it on the
first stumble put the same sentence on the feed repeatedly. A turn now gets two
model attempts, then `lastResort()` — a PAST rendering of the same `arg_id`
pulled from the feed's own history, of which every argument owns dozens. The
prompt also tells the model the claim is the idea and never the text.

**A run must finish inside its own lease.** Two attempts at a 25s timeout means
a worst case of MAX_PER_RUN * 2 * 25s, which is twice `LOCK_SECONDS`. The loop
stops at `RUN_BUDGET_MS`; stopping early costs nothing because the buffer is
the point.

**A subject change is a MESSAGE, not a card, and the loser makes it.** It used
to be a `kind='tema'` card announcing itself, written by a separate LLM call
that never passed through `inspect()` — which is how "Gente, alguém aqui já
passou por fila no SUS?" reached the feed after the audience guard shipped. Now
the change is an ordinary message from `losingSide()`. It goes through the same
guard as everything else and carries an `arg_id` so "ver o argumento" works on
it.

**Second person is about who you address, not the first word.** Telling the
model "sempre em segunda pessoa" made it open 47% of messages with "Você",
against 5% for the next opener. The prompt now forbids that opening and the
user prompt feeds the side its own last five openings back with an instruction
not to repeat them — measured from the output, so it keeps working on whatever
tic replaces this one.

**Cards are not utterances.** `userPrompt` fed every transcript row to the model
as `Fã do Lula: <body>`, including the `fecho` reveal and the sleep card, which
taught it that the referee was a participant. The transcript is filtered to
`kind='message'`.

**The trace panel must not cross a theme boundary.** It reconstructed "answering"
as the previous message from the other side, full stop, so the first message of
a new subject was shown answering a claim from the abandoned one. Same
`theme_id`, `kind='message'`, or nothing.

**A callback is a jab, not a subject.** At CALLBACK_CHANCE 0.25 the live feed
turned into two people arguing about arguing: one side gets a callback and
accuses the other of repeating, the next turn gets one and accuses back, and
the politics disappears under the metadata. Now 0.12, the prompt asks for one
passing sentence rather than the body of the message, and `ACCUSED_REPEAT`
suppresses it entirely when the opponent already played that card.

**Cron delivery is at-least-once, and topUp is not idempotent.** Two
overlapping runs both read the same newest row and both append from it —
production shipped two lula messages one second apart carrying the same
`arg_id`, at twice the model spend. `topUp` now takes a lease from the
`locks` table before reading anything, and releases it in a `finally`. It is a
deadline, not a mutex: a run that dies costs one skipped tick, not a stalled
feed. Do not add a second writer to `messages` without taking the same lease.

**A deliberate zero is not a missing value.** Settings are read through
`setting()` in `topup.ts`, not `Number(x) || fallback` — that idiom turned
`MAX_PER_DAY=0`, the spend kill switch, into 1600.

**Local `wrangler dev` scheduled ticks 500 in this environment**, on unchanged
code too (the runtime falls back from the requested compat date). Don't chase
it to test generation: `src/topup.test.ts` runs the real `topUp` against
bun:sqlite with the real migrations and `MAX_PER_DAY=0`, which is offline and
exercises the whole theme lifecycle.

**Facts rot.** Several arguments were wrong within months: the "taxa das
blusinhas" was repealed two days after being written about in the present tense;
"menor desemprego da história" described December 2025 from September 2026. A
test refuses any node asserting a conviction, statute or inquiry without a
`source`. When in doubt, describe direction ("caiu muito") rather than inventing
a number.

## Content

- `arguments/{lula,bolsonaro}.json` — the standing trees, ~40 nodes each. Flat
  arrays; `rebuts` tags are the edges between sides. See `CONTRIBUTING.md`.
- `topics/*.json` — hot topics. One file per live episode, arguments for **both**
  sides, ~6 turns each time the feed wanders in. Adding a topic is adding a file
  and registering it in `src/topics.ts`. A one-sided topic is not a topic.
- Length is specified in **sentences**, not characters. Character ceilings do not
  survive an instruction to explain something: told "180–320 characters" plus
  "explain the case", a whole batch came back 772–979, pinned to the cap.
- Tone: contempt with the fact in hand. Attack the stupidity of the argument and
  the cynicism of whoever repeats it. Never attack what a person *is* — race,
  religion, gender, orientation, disability — never threaten, never wish harm.
  Those aren't "more aggressive", they're a different thing, and they end this.

## Known, unfixed

The verdict lives one tap behind the bubble, so a screenshot travels with the
accusation and without the adjudication. `CONTEXT_TURNS = 6` also feeds the
model its own output back, so a fabrication compounds for six turns before it
ages out. The structural fix is a per-message permalink whose OG image carries
the verdict — not another filter.

There is no analytics of any kind. Nobody knows whether any of this works.
