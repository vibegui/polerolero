export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  LIVE: DurableObjectNamespace<import('./live.ts').LiveRoom>;

  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_NAME: string;
  LLM_MODEL: string;
  BUFFER_TARGET: string;
  MAX_PER_RUN: string;
  MAX_PER_DAY: string;
  MESSAGE_INTERVAL_SECONDS: string;
  /** ISO instants bounding the TSE electoral blackout. See inBlackout(). */
  BLACKOUT_FROM?: string;
  BLACKOUT_TO?: string;

  CF_AI_GATEWAY_TOKEN?: string;
  /** Only needed if BYOK is ever turned off in the Gateway dashboard. */
  OPENROUTER_API_KEY?: string;
}

export type Side = "lula" | "bolsonaro";

export interface Message {
  id: number;
  side: Side;
  body: string;
  arg_id: string;
  due_at: number;
  /** Hot topic this message belongs to, or null for the standing trees. */
  topic: string | null;
}

export interface ArgNode {
  id: string;
  claim: string;
  /** What this claim is about. Drives what the opponent can answer with. */
  tags: string[];
  /** Opponent tags this claim answers — the adjacency edge. */
  rebuts: string[];
  register: string;
  /** Editorial verdict on the claim itself, shown in the trace panel. */
  verdict: "verdadeiro" | "falso" | "depende";
  /** Why — including what the claim gets right when the verdict is not kind. */
  explain: string;
  source?: string;
}
