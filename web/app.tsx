import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import bolsonaroTree from "../arguments/bolsonaro.json" with { type: "json" };
import lulaTree from "../arguments/lula.json" with { type: "json" };
import { PERSONAS } from "../src/personas.ts";
import { About, Landing, Trace } from "./panels.tsx";

export type Side = "lula" | "bolsonaro";

export interface Message {
  id: number;
  side: Side;
  body: string;
  arg_id: string;
  due_at: number;
  persona: string | null;
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

export const NODES = new Map(
  [...TREES.lula, ...TREES.bolsonaro].map((n) => [n.id, n] as const),
);

export function personaLabel(side: Side, id: string | null): string | null {
  return PERSONAS[side].find((p) => p.id === id)?.label ?? null;
}

/** What the trace panel shows: the opponent claim being deflated, and the one
 *  fired back. Reconstructed on the client — both trees are already here, and
 *  the previous message is already on screen. */
export interface TraceData {
  side: Side;
  persona: string | null;
  answering: ArgNode | null;
  using: ArgNode | null;
}

const NAME: Record<Side, string> = { lula: "Fã do Lula", bolsonaro: "Fã do Bolsonaro" };

/** Server time minus browser time, in seconds. Phone clocks drift; the whole
 *  "everyone sees the same message at the same second" property depends on
 *  scheduling against the server's clock, not the device's. */
let clockSkew = 0;
const serverNow = () => Date.now() / 1000 + clockSkew;

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

  const openTrace = useCallback(
    (m: Message) => {
      const i = messages.findIndex((x) => x.id === m.id);
      // The message being answered is the previous one from the other side.
      const prev = messages.slice(0, i).findLast((x) => x.side !== m.side);
      setTrace({
        side: m.side,
        persona: m.persona,
        answering: prev ? (NODES.get(prev.arg_id) ?? null) : null,
        using: NODES.get(m.arg_id) ?? null,
      });
    },
    [messages],
  );

  return (
    <div className="app">
      <Header />

      <div className="feed" ref={scroller} onScroll={onScroll}>
        <div ref={sentinel} className="sentinel" />
        {visible.map((m) => (
          <Bubble key={m.id} message={m} onTrace={openTrace} />
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

function Header() {
  const about = useRef<HTMLDialogElement>(null);
  return (
    <header className="topbar">
      <div className="who">
        <span className="dot lula" aria-hidden="true" />
        <span className="dot bolsonaro" aria-hidden="true" />
      </div>
      <div className="titles">
        <h1>polerolero</h1>
        {/* The label lives here, not only inside the modal. A screenshot of the
            feed has to carry it too. */}
        <p className="band">sátira · gerado por IA · ninguém aqui é real</p>
      </div>
      <button type="button" className="info" onClick={() => about.current?.showModal()} aria-label="Sobre este projeto">
        ⓘ
      </button>
      <About ref={about} />
    </header>
  );
}

function Bubble({
  message,
  onTrace,
}: { message: Message; onTrace: (m: Message) => void }) {
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
    </div>
  );
}
