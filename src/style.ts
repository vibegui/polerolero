/**
 * What varies between messages, now that nothing else does.
 *
 * There used to be a cast of seven characters per side — the tia aposentada,
 * the militar da reserva, the coach. It read as costume: the model spent its
 * output performing an accent instead of making a case, and every message
 * announced its archetype in the first three words. Variety in *voice* was the
 * wrong axis. What actually needs to vary is how long a message is and what
 * kind of move it makes; the voice stays one ordinary partisan on each side.
 */

/**
 * The argumentative move, sampled per message. These are shapes an argument can
 * take, not moods to act out — "reply to the strongest version" and "grant the
 * small point" are the two that keep an infinite feed from reading as a loop.
 */
export const MOVES = [
  "responda diretamente ao ponto do oponente, e só depois emende o seu",
  "aponte uma contradição entre o que o oponente disse agora e o que esse lado costuma defender",
  "não responda ao ponto: mude o assunto para o seu argumento, e explique por que ele importa mais",
  "reconheça um detalhe pequeno do que o oponente disse, e use isso para negar o resto",
  "questione a fonte ou o critério que o oponente usou para afirmar aquilo",
  "responda à versão mais forte do argumento do oponente, e mostre por que ainda não basta",
  "trate o argumento do oponente como velho e já respondido, e apresente o seu como o que falta discutir",
] as const;

/**
 * Length is sampled per message, and specified in SENTENCES rather than
 * characters. Character ceilings do not work: told "180 a 320 caracteres" while
 * also being told to explain the case, the model ignored the ceiling and every
 * message in a batch came back between 772 and 979 — bunched against the hard
 * cap. Sentence and paragraph counts it actually obeys.
 *
 * The short bucket also has to *release* the model from explaining, or it can't
 * be short: it exists for the beat where someone just fires back.
 */
export const LENGTHS = [
  {
    weight: 25,
    paragraphs: 1,
    pace: 0.5,
    spec:
      "UMA ou DUAS frases, e só. NESTA mensagem não introduza caso novo e não " +
      "explique nada. Responda A ÚLTIMA COISA QUE ELE DISSE, especificamente: " +
      "pegue a afirmação dele e devolva. Sem isso vira frase solta, que é pior " +
      "que mensagem longa.",
  },
  {
    weight: 30,
    paragraphs: 1,
    pace: 0.85,
    spec: "UM parágrafo de 3 ou 4 frases. Sem quebra de linha.",
  },
  {
    weight: 27,
    paragraphs: 2,
    pace: 1.15,
    spec:
      "DOIS parágrafos, de 2 a 3 frases cada, separados por uma LINHA EM BRANCO. " +
      "O primeiro responde ao oponente; o segundo apresenta e explica o seu argumento.",
  },
  {
    weight: 18,
    paragraphs: 3,
    pace: 1.6,
    spec: "TRÊS parágrafos, de 2 a 3 frases cada, separados por uma LINHA EM BRANCO.",
  },
] as const;

export function pickLength(rand = Math.random()): (typeof LENGTHS)[number] {
  const total = LENGTHS.reduce((s, l) => s + l.weight, 0);
  let r = rand * total;
  for (const l of LENGTHS) {
    r -= l.weight;
    if (r <= 0) return l;
  }
  return LENGTHS[0];
}

/**
 * Seconds until the NEXT message, given how long this one was.
 *
 * Every message used to land exactly 60s after the last one, which reads as a
 * metronome rather than as an argument. A two-sentence jab gets fired back at
 * almost immediately; a three-paragraph wall needs time to be read. So the gap
 * is driven by the length just published, plus jitter — the rhythm has a cause
 * instead of being noise.
 *
 * The `pace` weights are set so the weighted mean lands within a couple of
 * percent of `interval`: this changes the texture, not the daily volume, and
 * therefore not the bill.
 */
export function gapFor(pace: number, interval: number, rand = Math.random()): number {
  const jitter = 0.8 + rand * 0.45;
  return Math.max(10, Math.round(interval * pace * jitter));
}
