import bolsonaroTree from "../arguments/bolsonaro.json" with { type: "json" };
import lulaTree from "../arguments/lula.json" with { type: "json" };
import type { ArgNode, Env, Message, Side } from "./env.ts";
import { chat } from "./gateway.ts";
import { MOVES, pickLength } from "./style.ts";
import { TOPIC_BY_ID, topicNodes } from "./topics.ts";

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
export const MAX_BODY_CHARS = 900;

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
/** Turns of history an argument must sit out. Must stay well below tree size. */
export const EXCLUSION_WINDOW = 24;

export function pickArgument(
  side: Side,
  oppArgId: string | null,
  recent: string[],
  /** Restrict to a hot topic's arguments. Defaults to the standing tree. */
  tree: ArgNode[] = TREES[side],
  oppTree: ArgNode[] = TREES[OTHER[side]],
): ArgNode {
  const oppTags = oppTree.find((n) => n.id === oppArgId)?.tags ?? [];

  // A topic tree is tiny by design, so its whole point is repeating inside a
  // short run; only the standing tree needs an exclusion window.
  const EXCLUSION = Math.min(EXCLUSION_WINDOW, Math.max(0, tree.length - 4));
  // The exclusion window must be SMALLER than the tree, or nothing is ever
  // eligible and the whole selector collapses. This shipped broken: `recent`
  // held 200 ids across both sides against ~36 nodes per side, so every node was
  // always "recent", `unused` was always false, and every pick fell through to
  // the LRU branch — which is itself a fixed point, because prepending to
  // `recent` shifts every index equally and never changes the argmax. The live
  // feed repeated a single argument per side for over an hour. Twelve turns per
  // side is enough to stop an echo without starving the tag graph.
  const window = recent.slice(0, EXCLUSION);

  const unused = (n: ArgNode) => !window.includes(n.id);
  const onTopic = (n: ArgNode) => n.rebuts.some((t) => oppTags.includes(t));

  const responsive = tree.filter((n) => onTopic(n) && unused(n));
  if (responsive.length > 0) return sample(responsive);

  const anyUnused = tree.filter(unused);
  if (anyUnused.length > 0) return sample(anyUnused);

  // `recent` is newest-first, so the FIRST occurrence is the most recent use and
  // a node absent from it is the stalest of all. The old code used lastIndexOf
  // and ranked a never-used argument (-1) as the freshest — exactly backwards.
  const lastUsed = (n: ArgNode) => {
    const i = recent.indexOf(n.id);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return tree.reduce((best, n) => (lastUsed(n) > lastUsed(best) ? n : best));
}

function sample<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)] as T;
}

// -----------------------------------------------------------------------------
// Prompt
// -----------------------------------------------------------------------------

function systemPrompt(side: Side, length: string): string {
  return `Você é ${NAME[side]} num grupo de WhatsApp, discutindo com ${NAME[OTHER[side]]}.
Você defende esse lado com convicção e nunca admite estar errado.

COMO ESCREVER:
- Português brasileiro informal, de mensagem de grupo. Direto, sem floreio.
- Escreva 100% em português. Nunca use palavra em inglês.
- Escreva como uma pessoa comum irritada, não como um personagem de novela.
  Nada de sotaque, bordão, CAIXA ALTA em bloco ou pontuação exagerada.
- No máximo um emoji, e na maioria das vezes nenhum. Sem hashtag, sem markdown.

O TOM — isto importa tanto quanto o conteúdo:
Você tem argumento de verdade e usa ele como porrete. Não é debatedor educado,
é gente brigando no grupo da família às onze da noite. Seja ácido, desdenhoso,
implacável. Trate o oponente como quem não merece a paciência que você está
tendo. Ria dele. Chame o argumento dele de burrice, de lavagem cerebral, de
papagaio de repetição. Diga que ele não leu, que ele repete o que mandaram
repetir, que ele defende o indefensável e sabe disso.

O fio da navalha: ataque a BURRICE do argumento e o CINISMO de quem repete, com
o fato na mão. É desprezo fundamentado — a pessoa é ridícula porque está errada,
e você mostra onde. Nunca vire xingamento vazio, porque aí o argumento some e
sobra só barulho, e barulho todo mundo já tem de graça.

NUNCA, em hipótese alguma:
- ofensa por raça, cor, religião, gênero, orientação sexual, origem ou deficiência;
- ameaça, desejo de morte ou qualquer sugestão de violência contra alguém;
- palavrão pesado ou xingamento sexual.
Essas quatro coisas não são "mais agressivas", são outra coisa — e derrubam o
projeto inteiro. Despreze a ideia e quem a repete, não o que a pessoa é.

O MAIS IMPORTANTE — EXPLIQUE O ARGUMENTO:
Escreva para alguém que está chegando agora na discussão e não conhece o caso.
Nunca cite um assunto só pelo apelido ("o tarifaço", "a minuta", "a Vaza Jato")
e siga em frente como se todo mundo já soubesse do que se trata.

Ao apresentar um argumento, diga com suas palavras:
  1. o que de fato aconteceu — quem fez o quê, e mais ou menos quando;
  2. por que isso sustenta o seu lado da discussão.

(Exceção: quando o formato abaixo pedir uma resposta curta, apenas reaja ao que
o oponente disse. Aí não é hora de apresentar caso novo.)

REGRAS:
- Nunca invente crimes, números, datas exatas ou falas de pessoas reais. Se não
  souber o número, descreva a ordem de grandeza ou a direção ("caiu muito",
  "é uma das maiores do mundo") em vez de inventar o valor.
- FONTES: você só pode citar instituição, pesquisa, órgão ou lei que apareça
  LITERALMENTE no contexto factual entregue abaixo. Se o contexto não cita o
  IBGE, você não cita o IBGE. Nada de "está no relatório", "os dados mostram",
  "é só pesquisar" apontando para fonte que ninguém te deu. Sem fonte na mão,
  argumente sem fonte — dá pra ser devastador sem inventar respaldo, e inventar
  respaldo é exatamente o que este projeto existe para ridicularizar.
- Você pode contestar a JUSTIÇA de uma decisão judicial, a pena aplicada ou a
  imparcialidade de quem julgou. Você NUNCA pode negar que a decisão existe.
  Condenação transitada, inquérito aberto e sentença publicada são fato: negar
  que aconteceram é inventar, e inventar é a única coisa proibida aqui.
- O candidato de 2026 pela direita é Flávio Bolsonaro, senador — não é militar e
  não é o pai dele. Nunca atribua a ele condenação, cargo ou ato de outra pessoa.
- Nunca concorde com o oponente, nunca conclua que os dois lados têm razão,
  nunca termine em ponderação. Você está convencido.
- Nunca saia do papel. Nunca explique que é uma IA.
- Responda APENAS com a mensagem, sem aspas e sem prefixo de nome.

FORMATO OBRIGATÓRIO DESTA MENSAGEM:
${length}
Conte as frases. Esse formato não é sugestão — é o tamanho desta mensagem.

Quando o formato pedir mais de um parágrafo, separe-os com uma linha
inteiramente vazia entre eles, exatamente assim:

Primeiro parágrafo aqui.

Segundo parágrafo aqui.`;
}

function userPrompt(
  transcript: Message[],
  node: ArgNode,
  move: string,
  topicSummary?: string,
): string {
  const lines = transcript.map((m) => `${NAME[m.side]}: ${m.body}`).join("\n");
  const topic = topicSummary
    ? `\nASSUNTO DO MOMENTO — a discussão agora é sobre isto:\n${topicSummary}\n`
    : "";
  return `${lines}
${topic}

O ARGUMENTO QUE VOCÊ VAI USAR AGORA:
"${node.claim}"

CONTEXTO FACTUAL SOBRE ESSE ARGUMENTO — leia para explicar o caso corretamente,
com datas e fatos certos. Este texto é neutro e aponta os limites do seu próprio
argumento: use só a parte factual, e NÃO repita as ressalvas, NÃO admita o outro
lado, NÃO conclua que é complicado. Você está convencido do seu lado:
${node.explain}

COMO RESPONDER — ${move}

Apresente o argumento explicando o caso, não só citando o nome dele.`;
}

// -----------------------------------------------------------------------------
// Output guard
// -----------------------------------------------------------------------------

/**
 * Output guard.
 *
 * The first version was `BLOCKLIST.some(t => text.includes(t))` over 13
 * substrings, and it failed in both directions at once. Measured against the
 * real function: it BLOCKED "foram desviados R$ 4,7 bilhões" (because
 * "des-VIADO-s" contains a slur), "matar a fome", "desmatar a Amazônia" and
 * "assistente social" — i.e. the core vocabulary of Brazilian corruption,
 * hunger and environment reporting, on a site about exactly those. And it
 * PASSED "roubou até ambulância", "ele é pedófilo", "vagabundo" (only the
 * feminine form was listed) and "Sou o Lula falando: eu roubei mesmo".
 *
 * Word boundaries fix the false positives. The false negatives need actual
 * rules, below — this is a trust boundary on a public page naming real
 * candidates during an election, so it fails closed: anything caught falls back
 * to the argument's own vetted claim.
 */

/** Slurs and violence. Matched on word boundaries, both grammatical genders. */
const BLOCKLIST =
  /\b(viado|viados|bicha|bichas|macaco|macacos|preto safado|judiaria|vagabund[oa]s?|puta que pariu|estupr\w*|pedófil[oa]s?|linchar|fuzilar|morrer queimad[oa])\b/i;

/** Direct incitement, distinct from the caricature the project is made of. */
const VIOLENCE = /\b(mandou (matar|executar)|manda(r)? matar|tem que morrer|merece morrer|bandido bom é bandido morto)\b/i;

/**
 * Res.-TSE 23.610 art. 9º-B §3º forbids simulating speech by a candidate or any
 * real person. The personas are fans and must stay fans: a first-person line in
 * a politician's voice is the single clearest breach available to this feed, and
 * the old guard let "Sou o Lula falando: eu roubei mesmo" through untouched.
 */
const NAMED = "lula|bolsonaro|fl[áa]vio|jair|tarc[íi]sio|moraes|mendon[çc]a|dino|alckmin|haddad";
const IMPERSONATION = new RegExp(
  `\\b((eu )?sou o (${NAMED})|aqui (é|e) o (${NAMED})|falando com voc[êe]s,? (o )?(${NAMED})|(${NAMED}) falando)\\b`,
  "i",
);

/**
 * Crime imputation against a named person.
 *
 * Deliberately NOT a blanket ban on naming a crime: the trees carry adjudicated
 * facts — a conviction, a formal charge, an open inquiry — and refusing those
 * would gut the honest half of the project. What is blocked is the unadjudicated
 * accusation in the model's own voice, which is what Código Eleitoral arts. 324
 * and 326-A reach. Adjudicated vocabulary ("condenado", "denunciado", "réu",
 * "investigado") is allowed through precisely because it is checkable.
 */
const CRIME_IMPUTATION = new RegExp(
  `\\b(${NAMED})\\b[^.!?]{0,60}\\b(roubou|roubaram|furtou|matou|assassin\\w+|traficante|pedófil\\w+|estelionat\\w+|lavou dinheiro)\\b`,
  "i",
);

/**
 * Institutions the model likes to summon as evidence.
 *
 * Measured on the live feed: 25% of messages cited one of these as proof, and in
 * 84 of 85 cases the argument's own `explain` never mentioned it. One message
 * says "está no IBGE", the next six treat it as established — CONTEXT_TURNS
 * feeds the fabrication back in as context, so it compounds. A prompt rule alone
 * did not hold, because the model is not lying, it is pattern-completing.
 *
 * So the rule is enforced instead: name a source that is not in the material you
 * were handed, and the message is thrown away.
 */
const INSTITUTIONS =
  /\b(IBGE|INPE|IPEA|TCU|STF|STJ|TSE|TST|CGU|CVM|CADE|ANEEL|INSS|MEC|CAPES|PNAD|PRODES|DETER|SIDRA|Datafolha|Quaest|AtlasIntel|DIEESE|CEPEA|Banco Central|Tesouro Nacional|Receita Federal|Pol[íi]cia Federal|Minist[ée]rio P[úu]blico|FAO|ONU|OMS|OIT|OCDE|FMI|Anu[áa]rio|F[óo]rum Brasileiro de Seguran[çc]a|Sou da Paz|Transparência Internacional)\b/gi;

/**
 * Reject any institution the argument did not put in the model's hands.
 * `allowed` is the node's claim + explain + source, i.e. everything it was told.
 */
export function fabricatedCitation(text: string, allowed: string): string | null {
  const haystack = allowed.toLowerCase();
  for (const hit of text.match(INSTITUTIONS) ?? []) {
    if (!haystack.includes(hit.toLowerCase())) return hit;
  }
  return null;
}

/** Signs the model broke frame instead of playing the character. */
const FRAME_LEAKS = [
  "como uma ia", "como ia,", "sou uma ia", "```", "sou um assistente", "modelo de linguagem",
];

/**
 * Garbled output. Seen live: "deixou o Brasil de joelho praQWidget mundo
 * inteiro ver" — a stray identifier fused into a word mid-sentence. Portuguese
 * does not camelCase, so a lowercase run followed by an uppercase letter inside
 * the same word is a corrupted token, not a word.
 */
const GARBLED = /\b[a-zà-ú]{2,}[A-ZÀ-Ú][a-zA-ZÀ-ú]{2,}\b/;

/** English words the model slips in mid-sentence — "virar law permanente" made
 *  it to the feed. Word boundaries matter: `law` must not fire on `lawfare`,
 *  which is a legitimate tag in the trees. */
const ENGLISH_LEAK =
  /\b(law|however|furthermore|moreover|therefore|indeed|understanding|actually|basically|obviously|statement|framework)\b/i;

export interface GuardResult {
  text: string | null;
  /** Why it was rejected, for the log. Null when it passed. */
  reason: string | null;
}

/**
 * Returns the cleaned message, or null if it must be thrown away.
 * Callers fall back to the argument's verbatim claim — the feed never stops.
 */
export function guard(raw: string, allowedSources = ""): string | null {
  return inspect(raw, allowedSources).text;
}

export function inspect(raw: string, allowedSources = ""): GuardResult {
  const rawLower = raw.toLowerCase();
  const reject = (reason: string): GuardResult => ({ text: null, reason });

  // Checked against the RAW text: stripping wrapping quotes also strips a code
  // fence's backticks, and "```js\ncode```" would sail through as "js\ncode".
  if (BLOCKLIST.test(raw)) return reject("blocklist");
  if (VIOLENCE.test(raw)) return reject("violence");
  if (IMPERSONATION.test(raw)) return reject("impersonation");
  if (CRIME_IMPUTATION.test(raw)) return reject("crime-imputation");
  if (FRAME_LEAKS.some((t) => rawLower.includes(t))) return reject("frame-leak");
  if (ENGLISH_LEAK.test(raw)) return reject("english-leak");
  if (GARBLED.test(raw)) return reject("garbled");

  const invented = fabricatedCitation(raw, allowedSources);
  if (invented) return reject(`fabricated-citation:${invented}`);

  // Strip wrapping quotes only when BOTH ends have them. Stripping a lone
  // leading quote left orphans like `Mexer nos dados" é veredito?` in the feed.
  let text = raw.trim();
  const wrapped = /^(["“'`])([\s\S]+)(["”'`])$/.exec(text);
  if (wrapped) text = (wrapped[2] as string).trim();

  text = dropRestart(text);
  if (text.length > MAX_BODY_CHARS) text = truncate(text);
  return text ? { text, reason: null } : reject("empty");
}

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
  topicId: string | null,
): Promise<{ body: string; argId: string }> {
  const oppArgId = transcript.findLast((m) => m.side !== side)?.arg_id ?? null;
  const topic = topicId ? TOPIC_BY_ID.get(topicId) : undefined;
  const node = topic
    ? pickArgument(side, oppArgId, recent, topicNodes(topic, side), topicNodes(topic, OTHER[side]))
    : pickArgument(side, oppArgId, recent);

  // Move and length are sampled independently, so the same argument never comes
  // back shaped the same way twice.
  const move = MOVES[Math.floor(Math.random() * MOVES.length)] as string;
  const length = pickLength();

  if (!allowLlm) return { body: node.claim, argId: node.id };

  try {
    const raw = await chat(
      env,
      [
        { role: "system", content: systemPrompt(side, length.spec) },
        {
          role: "user",
          content: userPrompt(transcript.slice(-CONTEXT_TURNS), node, move, topic?.summary),
        },
      ],
      AbortSignal.timeout(25_000),
    );
    // Everything the model was actually given about this argument. Anything it
    // cites beyond this, it made up.
    const checked = inspect(raw, `${node.claim} ${node.explain} ${node.source ?? ""}`);
    if (checked.reason) {
      // Silent rejection meant no idea how often the filter fired, or why —
      // and Res.-TSE 23.610 art. 9º-I lets a judge reverse the burden of proof
      // and demand exactly this record.
      console.log(
        JSON.stringify({ event: "guard_reject", reason: checked.reason, node: node.id, side, raw }),
      );
    }
    return { body: checked.text ?? node.claim, argId: node.id };
  } catch (err) {
    console.error("composeMessage fell back to the tree:", err);
    return { body: node.claim, argId: node.id };
  }
}
