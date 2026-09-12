import bolsonaroTree from "../arguments/bolsonaro.json" with { type: "json" };
import lulaTree from "../arguments/lula.json" with { type: "json" };
import type { ArgNode, Env, Message, Side } from "./env.ts";
import { chat } from "./gateway.ts";
import { MOVES, PERSONAS, type Persona, pickLength } from "./personas.ts";

export const TREES: Record<Side, ArgNode[]> = {
  lula: lulaTree as ArgNode[],
  bolsonaro: bolsonaroTree as ArgNode[],
};

export const OTHER: Record<Side, Side> = { lula: "bolsonaro", bolsonaro: "lula" };

const NAME: Record<Side, string> = { lula: "Fã do Lula", bolsonaro: "Fã do Bolsonaro" };

/** Transcript handed to the model. Six turns, not twenty — this is the cost lever. */
const CONTEXT_TURNS = 6;
// Generous, because the length sampler asks for up to three paragraphs. This is
// the backstop against a model that ignores the spec entirely, not the target.
const MAX_BODY_CHARS = 760;

// -----------------------------------------------------------------------------
// Argument selection
// -----------------------------------------------------------------------------

/**
 * Pick the next argument for `side`, answering `oppArgId`.
 *
 * Deliberately dumb — tag matching, no embeddings. The "tree" is emergent from
 * tag adjacency; a nested structure would just be a merge-conflict machine on
 * the files people are meant to send PRs against.
 *
 * `recent` is newest-first, which is what makes step 5 a least-recently-used
 * pick: the largest index is the one seen longest ago.
 */
export function pickArgument(side: Side, oppArgId: string | null, recent: string[]): ArgNode {
  const tree = TREES[side];
  const oppTags = TREES[OTHER[side]].find((n) => n.id === oppArgId)?.tags ?? [];

  const unused = (n: ArgNode) => !recent.includes(n.id);
  const onTopic = (n: ArgNode) => n.rebuts.some((t) => oppTags.includes(t));

  const responsive = tree.filter((n) => onTopic(n) && unused(n));
  if (responsive.length > 0) return sample(responsive);

  const anyUnused = tree.filter(unused);
  if (anyUnused.length > 0) return sample(anyUnused);

  // Tree fully cycled inside the window. Least-recently-used, and there is
  // always one because `tree` is never empty.
  return tree.reduce((best, n) =>
    recent.lastIndexOf(n.id) > recent.lastIndexOf(best.id) ? n : best,
  );
}

function sample<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)] as T;
}

// -----------------------------------------------------------------------------
// Prompt
// -----------------------------------------------------------------------------

function systemPrompt(side: Side, persona: Persona, length: string): string {
  const emoji =
    persona.emoji.length > 0
      ? `Na maioria das mensagens não use emoji nenhum. Quando usar, no máximo UM, e só destes: ${persona.emoji.join(" ")}`
      : "Este personagem NUNCA usa emoji.";

  return `Você é ${NAME[side]} num grupo de WhatsApp, discutindo com ${NAME[OTHER[side]]}.
Você é caricato, inflamado, e nunca admite estar errado.

SEU PERSONAGEM NESTA MENSAGEM — ${persona.label}:
${persona.voice}

REGRAS:
- Português informal brasileiro. Escreva EXATAMENTE na voz do personagem acima:
  o jeito de escrever importa mais que o conteúdo.
- ${emoji}
- Nunca use hashtag, markdown, asterisco ou lista.
- Comece reagindo à última mensagem do oponente do jeito que ESTE personagem reagiria.
- Depois emende o seu argumento com suas palavras — não copie a frase literalmente.
- Nunca invente crimes, números ou fatos sobre pessoas reais. A piada está na
  FORMA do argumento (whataboutismo, ad hominem, teoria da conspiração),
  nunca em acusação inventada.
- Nunca saia do personagem. Nunca concorde. Nunca explique que é uma IA.
- Responda APENAS com a mensagem, sem aspas e sem prefixo de nome.

FORMATO OBRIGATÓRIO DESTA MENSAGEM:
${length}

Quando o formato pedir mais de um parágrafo, separe-os assim — com uma linha
inteiramente vazia entre eles, exatamente como neste exemplo:

Primeiro parágrafo aqui.

Segundo parágrafo aqui.`;
}

function userPrompt(transcript: Message[], node: ArgNode, move: string): string {
  const lines = transcript.map((m) => `${NAME[m.side]}: ${m.body}`).join("\n");
  return `${lines}

Seu próximo argumento (reescreva com suas palavras, tom ${node.register}):
${node.claim}

MOVIMENTO RETÓRICO desta mensagem — ${move}`;
}

// -----------------------------------------------------------------------------
// Output guard
// -----------------------------------------------------------------------------

/** Terms that must never reach a public page carrying my name. */
const BLOCKLIST = [
  "viado", "bicha", "macaco", "preto safado", "judiaria", "matar", "morrer queimado",
  "pau no cu", "vagabunda", "puta que pariu", "estupr", "linchar", "fuzilar",
];

/** Signs the model broke frame instead of playing the character. */
const FRAME_LEAKS = ["fã do ", "como uma ia", "como ia,", "sou uma ia", "```", "assistente"];

/**
 * Cut at the last sentence that fits, not at the last character.
 *
 * A hard slice ends the bubble mid-word — the feed had one closing on
 * "Togacracia, ce…", which reads as a broken render rather than as someone
 * trailing off. Falls back to a word boundary, then to a hard cut, so this can
 * always return something.
 */
function truncate(text: string): string {
  const head = text.slice(0, MAX_BODY_CHARS);
  const sentence = Math.max(
    head.lastIndexOf("."),
    head.lastIndexOf("!"),
    head.lastIndexOf("?"),
  );
  // Only honour a sentence break that leaves a real message behind; otherwise a
  // stray early period would throw away almost everything.
  if (sentence > MAX_BODY_CHARS * 0.5) return head.slice(0, sentence + 1).trimEnd();

  const word = head.lastIndexOf(" ");
  return `${(word > MAX_BODY_CHARS * 0.5 ? head.slice(0, word) : head.slice(0, MAX_BODY_CHARS - 1)).trimEnd()}…`;
}

/**
 * Models asked for a multi-paragraph answer sometimes write the whole message,
 * stop, and then write it again slightly differently — the two drafts arrive
 * glued together. Seen in the feed as one 900-character bubble that says the
 * same thing twice ("...é descomando.O senhor pergunta quem controla o INPE...").
 *
 * If the opening line shows up again further in, the second copy is a restart:
 * keep the first draft and drop everything from there.
 */
function dropRestart(text: string): string {
  const head = text.slice(0, 40).trim();
  if (head.length < 24) return text;
  const again = text.indexOf(head, 40);
  return again === -1 ? text : text.slice(0, again).trimEnd();
}

/**
 * Returns the cleaned message, or null if it must be thrown away.
 * Callers fall back to the argument's verbatim claim — the feed never stops.
 */
export function guard(raw: string): string | null {
  // Check leaks against the RAW text, not the trimmed one: stripping wrapping
  // quotes also strips a code fence's backticks, and "```js\ncode```" would
  // sail through as "js\ncode".
  const rawLower = raw.toLowerCase();
  if (BLOCKLIST.some((t) => rawLower.includes(t))) return null;
  if (FRAME_LEAKS.some((t) => rawLower.includes(t))) return null;

  // Strip wrapping quotes only when BOTH ends have them. Stripping a lone
  // leading quote left orphans like `Mexer nos dados" é veredito?` in the feed.
  let text = raw.trim();
  const wrapped = /^(["“'`])([\s\S]+)(["”'`])$/.exec(text);
  if (wrapped) text = (wrapped[2] as string).trim();

  text = dropRestart(text);

  // Length is the only cap. An earlier two-sentence trim looked tidier and
  // amputated the argument: "Mexe nos dados? Fala sério kkk." kept the sneer
  // and threw away the point, which is the one thing a message must carry.
  if (text.length > MAX_BODY_CHARS) text = truncate(text);

  return text || null;
}

// -----------------------------------------------------------------------------
// One message
// -----------------------------------------------------------------------------

/**
 * Compose the next message. Never throws: any failure — network, timeout, empty
 * completion, blocked output, spent budget — degrades to the argument's
 * verbatim claim. That is also the texture we want: these two recycle the same
 * canned lines anyway, so a degraded tick is indistinguishable from a good one.
 */
export async function composeMessage(
  env: Env,
  side: Side,
  transcript: Message[],
  recent: string[],
  allowLlm: boolean,
): Promise<{ body: string; argId: string; persona: string }> {
  const oppArgId = transcript.findLast((m) => m.side !== side)?.arg_id ?? null;
  const node = pickArgument(side, oppArgId, recent);

  // Persona, rhetorical move and length are sampled independently, so the same
  // argument never comes back the same way twice.
  const cast = PERSONAS[side];
  const persona = cast[Math.floor(Math.random() * cast.length)] as Persona;
  const move = MOVES[Math.floor(Math.random() * MOVES.length)] as string;
  const length = pickLength();

  if (!allowLlm) return { body: node.claim, argId: node.id, persona: persona.id };

  try {
    const raw = await chat(
      env,
      [
        { role: "system", content: systemPrompt(side, persona, length.spec) },
        {
          role: "user",
          content: userPrompt(transcript.slice(-CONTEXT_TURNS), node, move),
        },
      ],
      AbortSignal.timeout(25_000),
    );
    return { body: guard(raw) ?? node.claim, argId: node.id, persona: persona.id };
  } catch (err) {
    console.error("composeMessage fell back to the tree:", err);
    return { body: node.claim, argId: node.id, persona: persona.id };
  }
}
