import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import bolsonaroTree from "../arguments/bolsonaro.json" with { type: "json" };
import lulaTree from "../arguments/lula.json" with { type: "json" };
import { EMOJI, type Emoji, type LiveState } from "../src/live-shared.ts";
import { TOPICS, TOPIC_BY_ID } from "../src/topics.ts";
import { Landing, Trace } from "./panels.tsx";

export type Side = "lula" | "bolsonaro";

export interface Message {
  id: number;
  side: Side;
  body: string;
  arg_id: string;
  due_at: number;
  topic: string | null;
}

export interface ArgNode {
  id: string;
  claim: string;
  tags: string[];
  rebuts: string[];
  register: string;
  verdict: "verdadeiro" | "falso" | "depende";
  explain: string;
  source?: string;
}

/** The trees are static per deploy, so they ride in the bundle rather than
 *  costing a request the moment someone taps "ver o argumento". */
export const TREES: Record<Side, ArgNode[]> = {
  lula: lulaTree as ArgNode[],
  bolsonaro: bolsonaroTree as ArgNode[],
};

// Topic nodes go in the same lookup: a message only carries an arg_id, and the
// trace panel should not have to know where the argument came from.
export const NODES = new Map(
  [
    ...TREES.lula,
    ...TREES.bolsonaro,
    ...TOPICS.flatMap((t) => [...t.lula, ...t.bolsonaro]),
  ].map((n) => [n.id, n] as const),
);

/** What the trace panel shows: the opponent claim being deflated, and the one
 *  fired back. Reconstructed on the client — both trees are already here, and
 *  the previous message is already on screen. */
export interface TraceData {
  side: Side;
  answering: ArgNode | null;
  using: ArgNode | null;
  topic: { title: string; summary: string; source?: string } | null;
}

const NAME: Record<Side, string> = { lula: "Fã do Lula", bolsonaro: "Fã do Bolsonaro" };

/** Server time minus browser time, in seconds. Phone clocks drift; the whole
 *  "everyone sees the same message at the same second" property depends on
 *  scheduling against the server's clock, not the device's. */
let clockSkew = 0;
const serverNow = () => Date.now() / 1000 + clockSkew;

/** Stable per-tab id. sessionStorage, not localStorage: two tabs are two
 *  viewers, and a reaction belongs to the tab that gave it. */
const SESSION = (() => {
  const key = "polerolero-session";
  let v = sessionStorage.getItem(key);
  if (!v) {
    v = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(key, v);
  }
  return v;
})();

export async function syncLive(
  ids: number[],
  react?: { id: number; emoji: Emoji },
): Promise<LiveState> {
  const res = await fetch("/api/live", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: SESSION, ids, react }),
  });
  if (!res.ok) throw new Error(`live: ${res.status}`);
  return (await res.json()) as LiveState;
}

async function load(before?: number): Promise<Message[]> {
  const url = before === undefined ? "/api/messages" : `/api/messages?before=${before}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  const json = (await res.json()) as { messages: Message[]; now: number };
  clockSkew = json.now - Date.now() / 1000;
  return json.messages.slice().reverse(); // API is newest-first; the feed reads oldest-first.
}

// -----------------------------------------------------------------------------

export function App() {
  // Everything the client knows, including messages whose due_at is still in
  // the future. `shown` is how many of them have been revealed.
  const [messages, setMessages] = useState<Message[]>([]);
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState<Side | null>(null);
  const [unread, setUnread] = useState(false);
  const [ready, setReady] = useState(false);
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [live, setLive] = useState<LiveState>({ viewers: 0, reactions: {} });

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prependFrom = useRef<number | null>(null);
  const loadingOlder = useRef(false);

  // --- initial load ---------------------------------------------------------
  useEffect(() => {
    load()
      .then((m) => {
        setMessages(m);
        // Clamp to what is already due, so a first-time visitor lands in a room
        // mid-argument instead of an empty one.
        setShown(m.filter((x) => x.due_at <= serverNow()).length);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  // --- drip scheduler -------------------------------------------------------
  // A setTimeout chain, never setInterval: each message is scheduled against
  // its own absolute due_at, so a slow frame or a sleeping tab cannot make the
  // stream drift away from every other viewer's.
  useEffect(() => {
    if (!ready) return;
    let timers: ReturnType<typeof setTimeout>[] = [];

    const clear = () => {
      for (const t of timers) clearTimeout(t);
      timers = [];
    };

    const schedule = () => {
      clear();
      const next = messages[shown];
      if (!next) {
        // Buffer drained — the server is behind or we've been open a while.
        timers.push(setTimeout(() => void refreshTail(), 15_000));
        return;
      }
      const delay = Math.max(0, (next.due_at - serverNow()) * 1000);
      const typingMs = Math.min(2500, 400 + next.body.length * 12);
      if (delay > typingMs) {
        timers.push(setTimeout(() => setTyping(next.side), delay - typingMs));
      } else if (delay > 0) {
        setTyping(next.side);
      }
      timers.push(
        setTimeout(() => {
          setTyping(null);
          setShown((n) => n + 1);
        }, delay),
      );
    };

    const refreshTail = async () => {
      try {
        const tail = await load();
        setMessages((prev) => {
          const lastId = prev[prev.length - 1]?.id ?? 0;
          const fresh = tail.filter((m) => m.id > lastId);
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      } catch {
        /* keep the current buffer; we'll try again on the next drain */
      }
    };

    schedule();

    // Coming back to a backgrounded tab: timers fired late or not at all, so
    // flush everything now due without animation and re-schedule from there.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = serverNow();
      setShown((n) => Math.max(n, messages.filter((m) => m.due_at <= now).length));
      void refreshTail();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, messages, shown]);

  // --- autoscroll -----------------------------------------------------------
  useEffect(() => {
    if (atBottom.current) {
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
      setUnread(false);
    } else if (shown > 0) {
      setUnread(true);
    }
  }, [shown]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // A ref, not state: this fires on every scroll event and a re-render per
    // event would make the feed stutter under the finger.
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) setUnread(false);
  }, []);

  // --- older pages ----------------------------------------------------------
  const loadOlder = useCallback(async () => {
    const el = scroller.current;
    const oldest = messages[0]?.id;
    if (!el || loadingOlder.current || oldest === undefined) return;
    loadingOlder.current = true;
    try {
      const page = await load(oldest);
      if (page.length === 0) return;
      // Capture scrollHeight synchronously, immediately before the state
      // update. By effect time the DOM has already grown and the delta is lost.
      prependFrom.current = el.scrollHeight;
      setMessages((prev) => [...page, ...prev]);
      setShown((n) => n + page.length);
    } catch {
      /* ignore — the sentinel will retry when it re-intersects */
    } finally {
      loadingOlder.current = false;
    }
  }, [messages]);

  // useLayoutEffect, not useEffect: useEffect can run after paint, and you see
  // the viewport jump to the top for one frame before it corrects.
  useLayoutEffect(() => {
    const from = prependFrom.current;
    if (from === null) return;
    prependFrom.current = null;
    const el = scroller.current;
    if (el) el.scrollTop += el.scrollHeight - from;
  }, [messages]);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    const root = scroller.current;
    if (!el || !root || !ready) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadOlder();
      },
      { root, rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ready, loadOlder]);

  const visible = messages.slice(0, shown);

  // Presence heartbeat doubles as the reaction poll — the room has to hear from
  // you to count you, so it may as well answer with what everyone else did.
  const visibleIds = visible.slice(-40).map((m) => m.id);
  const idsKey = visibleIds.join(",");
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const beat = () => {
      syncLive(idsKey ? idsKey.split(",").map(Number) : [])
        .then((s) => alive && setLive(s))
        .catch(() => {});
    };
    beat();
    const t = setInterval(beat, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ready, idsKey]);

  const react = useCallback(
    (id: number, emoji: Emoji) => {
      // Optimistic: a tap has to feel instant even though the room is the
      // authority. The next heartbeat overwrites this with the real count.
      setLive((prev) => {
        const cur = { ...(prev.reactions[id] ?? {}) };
        cur[emoji] = (cur[emoji] ?? 0) + 1;
        return { ...prev, reactions: { ...prev.reactions, [id]: cur } };
      });
      syncLive(visibleIds, { id, emoji })
        .then(setLive)
        .catch(() => {});
    },
    [visibleIds],
  );

  const openTrace = useCallback(
    (m: Message) => {
      const i = messages.findIndex((x) => x.id === m.id);
      // The message being answered is the previous one from the other side.
      const prev = messages.slice(0, i).findLast((x) => x.side !== m.side);
      const t = m.topic ? TOPIC_BY_ID.get(m.topic) : undefined;
      setTrace({
        side: m.side,
        topic: t ? { title: t.title, summary: t.summary, source: t.source } : null,
        answering: prev ? (NODES.get(prev.arg_id) ?? null) : null,
        using: NODES.get(m.arg_id) ?? null,
      });
    },
    [messages],
  );

  return (
    <div className="app">
      <Header viewers={live.viewers} />

      <div className="feed" ref={scroller} onScroll={onScroll}>
        <div ref={sentinel} className="sentinel" />
        {visible.map((m) => (
          <Bubble
            key={m.id}
            message={m}
            onTrace={openTrace}
            reactions={live.reactions[m.id]}
            onReact={react}
          />
        ))}
        {typing && (
          <div className={`row ${typing}`}>
            <div className="bubble typing" aria-label={`${NAME[typing]} está digitando`}>
              <span /><span /><span />
            </div>
          </div>
        )}
        {!ready && <p className="hint">carregando a briga…</p>}
        {/* Only ever true on a brand-new feed, which has no already-due backlog
            to fill the screen with. It fixes itself within the hour as messages
            come due and pile up, but the first visitors would otherwise land in
            a blank room with no idea whether the site is broken. */}
        {ready && shown === 0 && (
          <p className="hint">a discussão está começando… primeira mensagem em instantes.</p>
        )}
      </div>

      {unread && (
        <button
          type="button"
          className="pill"
          onClick={() => {
            atBottom.current = true;
            setUnread(false);
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
          }}
        >
          ↓ novas mensagens
        </button>
      )}

      <Landing />
      <Trace data={trace} onClose={() => setTrace(null)} />
    </div>
  );
}

// -----------------------------------------------------------------------------

function Header({ viewers }: { viewers: number }) {
  return (
    <header className="topbar">
      <div className="who">
        <span className="dot lula" aria-hidden="true" />
        <span className="dot bolsonaro" aria-hidden="true" />
      </div>
      <div className="titles">
        <h1>polerolero</h1>
        <p className="tagline">o gerador de lero lero polarizado</p>
      </div>
      {/* The label belongs up here with the wordmark, not on a band of its own:
          a whole row of chrome to carry six words was the most expensive thing
          on a screen whose entire job is the conversation. */}
      <div className="meta">
        <span className="band">sátira gerada por IA</span>
        {viewers > 0 && (
          <span className="viewers" title={`${viewers} assistindo agora`}>
            <span className="pulse" aria-hidden="true" />
            {viewers} assistindo
          </span>
        )}
      </div>
    </header>
  );
}

function Bubble({
  message,
  onTrace,
  reactions,
  onReact,
}: {
  message: Message;
  onTrace: (m: Message) => void;
  reactions?: Partial<Record<Emoji, number>>;
  onReact: (id: number, emoji: Emoji) => void;
}) {
  // The model separates paragraphs with a blank line; anything else stays one
  // block. Splitting here rather than using white-space:pre-wrap keeps the
  // paragraph spacing under CSS control instead of at the mercy of stray \n.
  const paras = message.body.split(/\n\s*\n/).filter(Boolean);
  return (
    <div className={`row ${message.side}`}>
      <div className="bubble">
        <span className="author">{NAME[message.side]}</span>
        {paras.map((t, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of a frozen message
          <p key={i}>{t}</p>
        ))}
        <button type="button" className="trace-link" onClick={() => onTrace(message)}>
          ver o argumento
        </button>
      </div>
      <div className="reactions">
        {EMOJI.map((e) => {
          const n = reactions?.[e] ?? 0;
          return (
            <button
              key={e}
              type="button"
              className={`react ${n > 0 ? "on" : ""}`}
              onClick={() => onReact(message.id, e)}
              aria-label={`reagir com ${e}`}
            >
              {e}
              {n > 0 && <span>{n}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
