import { type Ref, useRef, useState } from "react";

// Both panels are native <dialog>. showModal() gives Esc-to-close, a focus
// trap, ::backdrop and inert on the rest of the page — every bit of the
// accessibility you would otherwise hand-roll, for free.

export function About({ ref }: { ref: Ref<HTMLDialogElement> }) {
  return (
    <dialog ref={ref} className="sheet about">
      <h2>O que é isto?</h2>
      <p>
        Dois agentes de inteligência artificial discutindo política brasileira. Para sempre.
        Nenhum dos dois existe. Nenhum dos dois vai ganhar. Nenhum dos dois vai parar.
      </p>
      <p>
        Os argumentos vêm de duas listas abertas — as bobagens mais recicladas de cada lado — e
        qualquer pessoa pode mandar um PR e adicionar mais.
      </p>
      <p className="fine">
        Os personagens são <strong>fãs</strong>, não os políticos. Nada aqui é declaração de
        pessoa real, nem notícia, nem acusação. É sátira gerada por máquina sobre a{" "}
        <em>forma</em> do argumento — o whataboutismo, o ad hominem, a teoria da conspiração.
      </p>
      <p>
        <a href="https://github.com/vibegui/polerolero" target="_blank" rel="noreferrer">
          código e argumentos no GitHub →
        </a>
      </p>
      <form method="dialog">
        <button type="submit">fechar</button>
      </form>
    </dialog>
  );
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
        por que isto existe
      </button>

      <dialog
        ref={ref}
        className={`sheet drawer ${open ? "open" : ""}`}
        onClose={() => setOpen(false)}
      >
        <form method="dialog" className="drawer-close">
          <button type="submit" aria-label="fechar">✕</button>
        </form>

        <div className="drawer-body">
          <h2>A briga é de mentira. O custo é de verdade.</h2>

          <p>
            Isto é um projeto de arte. Você acabou de assistir duas máquinas repetirem, sem
            descanso, os mesmos argumentos que ocupam o país inteiro há anos. Elas nunca ouvem.
            Nunca mudam de ideia. Nunca chegam a lugar nenhum.
          </p>
          <p>
            O desconforto de assistir não vem de elas serem artificiais. Vem de serem{" "}
            <strong>familiares</strong>.
          </p>

          <h3>A quem serve a briga</h3>
          <p>
            Divisão não é um efeito colateral da corrupção. É a condição de trabalho dela. Enquanto
            a discussão for sobre a discussão, ninguém está olhando para o que está sendo levado.
            Dois lados gritando um com o outro é o melhor sistema de segurança que o desvio já
            teve: barato, automático e voluntário.
          </p>
          <p>
            Cada ano gasto nessa briga é um ano de produtividade parada, escola ruim, fila de
            cirurgia e oportunidade perdida. Essa conta não é ideológica. Ela chega para os dois
            lados igual.
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

          <p className="fine">
            polerolero é sátira gerada por IA. Os personagens são fãs caricatos, não os políticos,
            e nada aqui é notícia ou declaração de pessoa real. Os argumentos são abertos:{" "}
            <a href="https://github.com/vibegui/polerolero" target="_blank" rel="noreferrer">
              mande um PR
            </a>
            .
          </p>
        </div>
      </dialog>
    </>
  );
}
