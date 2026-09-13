/**
 * The presence/reaction contract, shared by the Durable Object and the browser.
 *
 * Separate from `live.ts` because that file imports `cloudflare:workers`, which
 * neither the browser bundle nor `bun test` can resolve. The emoji set and the
 * response shape are the only things both sides need to agree on.
 */

/** Fixed set, not a picker: five options is a reaction, sixty is a decision. */
export const EMOJI = ["😂", "🤡", "👏", "🤮", "💀"] as const;
export type Emoji = (typeof EMOJI)[number];

export interface LiveState {
  viewers: number;
  /** message id → emoji → count */
  reactions: Record<number, Partial<Record<Emoji, number>>>;
}
