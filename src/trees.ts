import bolsonaroTree from "../arguments/bolsonaro.json" with { type: "json" };
import lulaTree from "../arguments/lula.json" with { type: "json" };
import type { ArgNode, Side } from "./env.ts";
import { TOPICS } from "./topics.ts";

/**
 * The argument trees, and the id index over them.
 *
 * These live apart from generate.ts because themes.ts needs them too, and
 * having themes.ts reach into generate.ts while generate.ts reaches back for
 * subjectNodes() is an import cycle whose failure mode is a top-level const
 * read inside its own temporal dead zone — a crash at module init, in
 * production, that no type check catches.
 */

export const TREES: Record<Side, ArgNode[]> = {
  lula: lulaTree as ArgNode[],
  bolsonaro: bolsonaroTree as ArgNode[],
};

export const OTHER: Record<Side, Side> = { lula: "bolsonaro", bolsonaro: "lula" };

/** Every argument in play, standing trees and hot topics alike, by id. */
export const NODE_BY_ID = new Map(
  [
    ...TREES.lula,
    ...TREES.bolsonaro,
    ...TOPICS.flatMap((t) => [...t.lula, ...t.bolsonaro]),
  ].map((n) => [n.id, n] as const),
);
