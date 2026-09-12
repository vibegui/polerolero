// Cloudflare AI Gateway client. Trimmed port of
// /Users/guilherme/conductor/workspaces/cury.chat/freetown/api/ai/gateway.ts —
// only the non-streaming OpenRouter path, which is all this worker needs.
//
// BYOK is configured in the Gateway dashboard, so the worker ships no provider
// key: the Gateway injects it. The only secret here is CF_AI_GATEWAY_TOKEN
// (Authenticated Gateway).

import type { Env } from "./env.ts";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/**
 * An empty completion is a failure, not an answer.
 *
 * Learned the expensive way in cury.chat: a reasoning-capable model can spend
 * its entire output budget on reasoning_tokens and return empty `content`.
 * Raising max_tokens from 1024 to 4096 took GLM-5.3 Flash from 3 empty answers
 * out of 13 to zero. GLM refuses to run with reasoning disabled at all, so the
 * ceiling has to leave real room for it: see max_tokens below.
 */
export class EmptyCompletionError extends Error {
  constructor(completionTokens?: number) {
    super(`model returned empty content (completion_tokens=${completionTokens ?? "?"})`);
    this.name = "EmptyCompletionError";
  }
}

type ChatCompletionJson = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export async function chat(
  env: Env,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const url = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_NAME}/openrouter/v1/chat/completions`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    // OpenRouter app-attribution headers (public, not auth).
    "HTTP-Referer": "https://polerolero.com",
    "X-Title": "polerolero",
  };
  // `cf-aig-authorization` is the Authenticated-Gateway header, distinct from
  // `Authorization` (which would carry a provider key we deliberately don't have).
  if (env.CF_AI_GATEWAY_TOKEN) {
    headers["cf-aig-authorization"] = `Bearer ${env.CF_AI_GATEWAY_TOKEN}`;
  }
  if (env.OPENROUTER_API_KEY) headers.Authorization = `Bearer ${env.OPENROUTER_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages,
      temperature: 0.95,
      // Not 400. GLM-5.3 Flash rejects `reasoning: {enabled:false}` outright
      // ("Reasoning is mandatory for this endpoint"), so it WILL think before
      // answering and those tokens come out of this ceiling. Set it too low and
      // the model spends the whole budget reasoning and returns empty content —
      // measured in cury.chat, where raising 1024→4096 took GLM from 3 empty
      // answers in 13 to zero. The ceiling is a limit, not a target: a one-line
      // insult still bills as a one-line insult.
      max_tokens: 2048,
      reasoning: { effort: "low" },
    }),
  });

  if (!res.ok) throw new Error(`openrouter via gateway: ${res.status} ${await res.text()}`);

  const json = (await res.json()) as ChatCompletionJson;
  const text = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new EmptyCompletionError(json.usage?.completion_tokens);
  return text;
}
