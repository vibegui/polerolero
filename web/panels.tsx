import { type Ref, useEffect, useRef, useState } from "react";
import type { ArgNode, TraceData } from "./app.tsx";

// Every panel here is a native <dialog>. showModal() gives Esc-to-close, a focus
// trap, ::backdrop and inert on the rest of the page — every bit of the
// accessibility you would otherwise hand-roll, for free.

/**
 * Click outside to dismiss, which <dialog> does not give you.
 *
 * A click on the ::backdrop reports the dialog itself as the target, so the
 * usual `e.target === dialog` test mostly works — but it also fires for any
 * padding inside the dialog box, closing the panel when someone clicks the gap
 * between two cards. Comparing against the box geometry is unambiguous.
 */
function closeOnBackdrop(e: React.MouseEvent<HTMLDialogElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const outside =
    e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right;
  if (outside) el.close();
}

/** The twelve ideas, quoted from agendaimprescindivel.com.br. */
const IDEIAS = [
  "O destino do Brasil é maior do que sua realidade.",
  "Prosperidade e igualdade de oportunidades fortalecem-se mutuamente.",
  "Democracia depende de confiança institucional.",
  "O Estado existe para entregar resultados.",
  "Projetos nacionais transformam potencial em realização.",
  "O futuro pertence às sociedades que desenvolvem capacidades mais rapidamente.",
  "Educação é a principal infraestrutura do desenvolvimento.",
  "Inovação determina competitividade.",
  "Sustentabilidade é vantagem estratégica.",
  "Saúde amplia capacidades humanas.",
  "Segurança é condição da liberdade.",
  "O Brasil deve ocupar posição compatível com seus ativos e responsabilidades.",
];

/**
 * One sheet, one way in.
 *
 * There was an ⓘ button in the header and a separate drawer handle at the
 * bottom, opening two panels that explained overlapping halves of the same
 * thing. Two affordances for one answer is one too many: the explanation and
 * the reason it exists are the same story, so they are now the same sheet,
 * reached from the one place a thumb already rests.
 */
export function Landing() {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="handle"
        onClick={() => {
          ref.current?.showModal();
          setOpen(true);
        }}
      >
        <span className="grab" aria-hidden="true" />
        o que é isto? · melhore os argumentos
      </button>

      <dialog
        ref={ref}
        className={`sheet drawer ${open ? "open" : ""}`}
        onClick={closeOnBackdrop}
        onClose={() => setOpen(false)}
      >
        <form method="dialog" className="drawer-close">
          <button type="submit" aria-label="fechar">✕</button>
        </form>

        <div className="drawer-body">
          <h2>A briga é de mentira. O custo é de verdade.</h2>

          <p>
            Isto é um projeto de arte. Dois agentes de inteligência artificial discutindo
            política brasileira, para sempre. Nenhum dos dois existe, nenhum dos dois vai
            ganhar, nenhum dos dois vai parar. Você acabou de assistir duas máquinas
            repetirem, sem descanso, os mesmos argumentos que ocupam o país inteiro há anos.
          </p>
          <p className="fine">
            Os personagens são <strong>fãs</strong>, não os políticos, e falam por si.{" "}
            <strong>
              Nada no feed é notícia, declaração de pessoa real ou acusação
            </strong>{" "}
            — é caricatura gerada por máquina sobre a <em>forma</em> do argumento: o
            whataboutismo, o ad hominem, a teoria da conspiração. Toque em{" "}
            <strong>“ver o argumento”</strong> em qualquer mensagem para ver de onde ela saiu e
            se aquilo é verdadeiro, falso ou mais complicado que isso.
          </p>

          <h3>Os dois lados gritam. Os dois lados não são iguais.</h3>
          <p>
            Este projeto não finge equilíbrio. Fingir que os dois lados se equivalem é uma
            forma de mentira, e é a mais confortável de todas.
          </p>
          <p>
            Um dos lados defende um governo <strong>medíocre</strong>: produtividade travada,
            obra parada, promessa entregue pela metade, um histórico de corrupção que foi
            julgado e condenado. Isso é ruim, e é justo cobrar.
          </p>
          <p>
            O outro defende um governo que terminou com um{" "}
            <strong>ex-presidente condenado a 27 anos</strong> pelo Supremo por tentativa de
            abolir o Estado Democrático de Direito, ao lado de três generais, mais o caso das
            joias de presente de Estado e um pedido de tarifa estrangeira de 50% contra o
            próprio país. Isso não é “pior”. É de outra categoria.
          </p>
          <p className="fine">
            Esta seção é a única no site que fala na voz de quem fez o projeto, e o que ela
            afirma é registro público: sentença publicada, denúncia recebida, cronologia
            verificável, com a fonte no painel de cada argumento. Onde não há decisão
            judicial, o painel diz que não há. Cada mensagem do feed continua sendo
            caricatura de fã, e nenhuma delas é declaração de pessoa real.
          </p>

          <h3>Onde a conversa recomeça</h3>
          <p>
            Não no meio do campo, por educação. No ponto onde já existe acordo — e ele é enorme,
            desde que ninguém precise dizer em quem votou antes de falar:
          </p>
          <ul className="acordo">
            <li>Crime zero. Ninguém quer ser assaltado.</li>
            <li>Oportunidade igual. Ninguém acha justo nascer sem chance.</li>
            <li>Escola de primeira. Ninguém quer filho analfabeto funcional.</li>
            <li>Economia eficiente e integrada ao mundo. Ninguém quer ficar pobre.</li>
          </ul>
          <p>
            Começar daí não é ser morno. É a única forma de discordar do resto e ainda construir
            alguma coisa.
          </p>

          <h3>Doze ideias que organizam um projeto nacional</h3>
          <ol className="ideias">
            {IDEIAS.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ol>
          <p className="fine">
            Citadas da <em>Agenda Imprescindível</em>.
          </p>

          <a className="cta" href="https://agendaimprescindivel.com.br" target="_blank" rel="noreferrer">
            ler a agenda inteira →
          </a>

          <h3>Melhore os argumentos</h3>
          <p>
            Tudo que os dois dizem sai de duas listas abertas, uma por lado, e os veredictos
            são resumo editorial deste projeto — não checagem profissional. Então eles estão
            errados em algum lugar, e provavelmente você sabe onde.
          </p>
          <p>
            Um argumento novo é <strong>um objeto num arquivo JSON</strong>. Um veredicto que
            você acha injusto é uma linha trocada. A contribuição mais valiosa aqui é marcar
            como falso um argumento do seu próprio lado.
          </p>
          <a className="cta ghost" href="https://github.com/vibegui/polerolero" target="_blank" rel="noreferrer">
            contribuir no GitHub →
          </a>

          {/* Lei 9.504 art. 57-D veda o anonimato durante a campanha. Um projeto
              político publicado sob dois nomes falsos precisa dizer quem o assina. */}
          <h3>Quem faz isto</h3>
          <p>
            polerolero é um projeto pessoal de <strong>Guilherme Rodrigues</strong> —{" "}
            <a href="https://vibegui.com" target="_blank" rel="noreferrer">vibegui.com</a>. Não
            tem vínculo com partido, campanha, candidatura ou empresa, e não recebe nem
            impulsiona conteúdo pago.
          </p>
          <p className="fine">
            Erro factual, veredicto injusto ou pedido de retificação:{" "}
            <a href="https://github.com/vibegui/polerolero/issues/new" target="_blank" rel="noreferrer">
              abra uma issue
            </a>{" "}
            ou escreva para <a href="mailto:gui@deco.cx">gui@deco.cx</a>. Correção de
            fato é feita na hora.
          </p>
        </div>
      </dialog>
    </>
  );
}

// -----------------------------------------------------------------------------
// Trace — where the argument came from
// -----------------------------------------------------------------------------

const VERDICT: Record<ArgNode["verdict"], { label: string; hint: string }> = {
  verdadeiro: { label: "verdadeiro", hint: "a afirmação central se sustenta" },
  falso: { label: "falso", hint: "a afirmação central não se sustenta" },
  depende: { label: "é mais complicado", hint: "os dois lados têm parte de razão" },
};

/**
 * Slides in from the side that spoke — right for Bolsonaro, left for Lula —
 * because the panel is that character's reasoning, and having it arrive from
 * the other edge reads as a reply rather than as a source.
 */
export function Trace({ data, onClose }: { data: TraceData | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  // Keep rendering the last trace while the panel slides out. Rendering `data`
  // directly emptied the panel the instant it was closed, and the 340ms exit
  // transition then played over a blank sheet showing only the disclaimer —
  // which looked exactly like a panel that had failed to load.
  const last = useRef<TraceData | null>(null);
  if (data) last.current = data;
  const shown = data ?? last.current;

  // <dialog> has no declarative open-with-animation, so drive it from the data:
  // showModal() on arrival, and let close() run through the CSS transition.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (data && !el.open) el.showModal();
    if (!data && el.open) el.close();
  }, [data]);

  return (
    <dialog
      ref={ref}
      className={`sheet trace from-${shown?.side ?? "lula"}`}
      onClick={closeOnBackdrop}
      onClose={onClose}
    >
      <div className="trace-head">
        <strong>De onde saiu essa mensagem</strong>
        <form method="dialog">
          <button type="submit" aria-label="fechar">✕</button>
        </form>
      </div>

      <div className="trace-body">
        {shown?.topic && (
          <aside className="topic">
            <span className="topic-kicker">assunto do momento</span>
            <strong>{shown.topic.title}</strong>
            {shown.topic.summary && <p>{shown.topic.summary}</p>}
            {shown.topic.source && (
              <a href={shown.topic.source} target="_blank" rel="noreferrer">sobre o caso →</a>
            )}
          </aside>
        )}
        {shown?.answering && <Card node={shown.answering} role="Respondendo a" />}
        {shown?.using && <Card node={shown.using} role="Contra-atacando com" />}
        <p className="fine">
          Os veredictos são resumo editorial deste projeto, não checagem
          profissional — e existem para ser contestados.{" "}
          <a href="https://github.com/vibegui/polerolero" target="_blank" rel="noreferrer">
            discorda? manda um PR
          </a>
          .
        </p>
      </div>
    </dialog>
  );
}

function Card({ node, role }: { node: ArgNode; role: string }) {
  const v = VERDICT[node.verdict];
  return (
    <article className="card">
      <span className="card-role">{role}</span>
      <p className="card-claim">“{node.claim}”</p>
      <div className={`verdict ${node.verdict}`}>
        <strong>{v.label}</strong>
        <span>{v.hint}</span>
      </div>
      <p className="card-explain">{node.explain}</p>
      <div className="card-tags">
        {node.tags.map((t) => (
          <span key={t} className="tag">{t}</span>
        ))}
      </div>
      {node.source && (
        <a className="card-source" href={node.source} target="_blank" rel="noreferrer">
          fonte →
        </a>
      )}
    </article>
  );
}
