import bolsonaroTree from "../arguments/bolsonaro.json" with { type: "json" };
import lulaTree from "../arguments/lula.json" with { type: "json" };
import type { ArgNode, Env, Message, Side } from "./env.ts";
import { chat } from "./gateway.ts";

export const TREES: Record<Side, ArgNode[]> = {
  lula: lulaTree as ArgNode[],
  bolsonaro: bolsonaroTree as ArgNode[],
};

export const OTHER: Record<Side, Side> = { lula: "bolsonaro", bolsonaro: "lula" };

const NAME: Record<Side, string> = { lula: "Fã do Lula", bolsonaro: "Fã do Bolsonaro" };

/** Transcript handed to the model. Six turns, not twenty — this is the cost lever. */
const CONTEXT_TURNS = 6;
const MAX_BODY_CHARS = 220;

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

function systemPrompt(side: Side): string {
  return `Você é "${NAME[side]}" num grupo de WhatsApp, discutindo com ${NAME[OTHER[side]]}.
Você é caricato, inflamado, e nunca admite estar errado.

REGRAS:
- 1 ou 2 frases. Máximo 180 caracteres. Português informal brasileiro, gírias, CAPS ocasional.
- Comece desqualificando a última mensagem do oponente em no máximo 6 palavras.
- Depois emende o SEU argumento, com suas palavras — não copie literalmente.
- No máximo 1 emoji. Nunca use hashtag. Nunca use markdown.
- Nunca invente crimes, números ou fatos sobre pessoas reais. A piada está na
  FORMA do argumento (whataboutismo, ad hominem, teoria da conspiração),
  nunca em acusação inventada.
- Nunca saia do personagem. Nunca concorde. Nunca explique que é uma IA.
- Responda APENAS com a mensagem, sem aspas e sem prefixo de nome.`;
}

function userPrompt(transcript: Message[], node: ArgNode): string {
  const lines = transcript.map((m) => `${NAME[m.side]}: ${m.body}`).join("\n");
  return `${lines}

Seu próximo argumento (reescreva com suas palavras, tom ${node.register}):
${node.claim}`;
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

  // Length is the only cap. An earlier two-sentence trim looked tidier and
  // amputated the argument: "Mexe nos dados? Fala sério kkk." kept the sneer
  // and threw away the point, which is the one thing a message must carry.
  if (text.length > MAX_BODY_CHARS) text = `${text.slice(0, MAX_BODY_CHARS - 1).trimEnd()}…`;

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
): Promise<{ body: string; argId: string }> {
  const oppArgId = transcript.findLast((m) => m.side !== side)?.arg_id ?? null;
  const node = pickArgument(side, oppArgId, recent);

  if (!allowLlm) return { body: node.claim, argId: node.id };

  try {
    const raw = await chat(
      env,
      [
        { role: "system", content: systemPrompt(side) },
        { role: "user", content: userPrompt(transcript.slice(-CONTEXT_TURNS), node) },
      ],
      AbortSignal.timeout(20_000),
    );
    return { body: guard(raw) ?? node.claim, argId: node.id };
  } catch (err) {
    console.error("composeMessage fell back to the tree:", err);
    return { body: node.claim, argId: node.id };
  }
}
