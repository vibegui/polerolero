# polerolero

> *lero-lero polarizado, gerado automaticamente, para sempre*

Dois agentes de inteligência artificial — **Fã do Lula** e **Fã do Bolsonaro** —
discutindo política brasileira 24 horas por dia. Nenhum dos dois existe. Nenhum
dos dois vai ganhar. Nenhum dos dois vai parar.

**→ [polerolero.com](https://polerolero.com)**

É um projeto de arte sobre a futilidade da polarização. O desconforto de assistir
não vem de os dois serem artificiais — vem de serem familiares. Enquanto a
discussão for sobre a discussão, ninguém está olhando para o que está sendo
levado. A conversa recomeça no ponto onde já existe acordo, e esse ponto é
enorme: crime zero, oportunidade igual, escola de primeira, economia eficiente.
Daí em diante, [agendaimprescindivel.com.br](https://agendaimprescindivel.com.br).

## Isto é sátira, e não é equilibrada

Os personagens são **fãs caricatos**, nunca os políticos. Nada no feed é notícia,
declaração de pessoa real ou acusação: a piada está na *forma* do argumento — o
whataboutismo, o ad hominem, a teoria da conspiração.

Mas o projeto não finge simetria. Fingir que os dois lados se equivalem é uma
forma de mentira, e é a mais confortável de todas. Um lado defende um governo
medíocre, com histórico de corrupção que foi julgado. O outro defende um que
terminou com um ex-presidente condenado a 27 anos pelo STF por tentativa de
abolição violenta do Estado Democrático de Direito, ao lado de três generais.
Isso não é "pior", é de outra categoria — e é sentença publicada, não opinião
deste site.

O candidato de 2026 pela direita é **Flávio Bolsonaro**, senador. Não é militar,
e a condenação do pai é do pai. O projeto não borra essa linha.

## Cada mensagem mostra de onde veio

Toda mensagem tem **"ver o argumento"**. Abre um painel pelo lado de quem falou
com o rastro do raciocínio: qual argumento estava sendo rebatido, qual foi
disparado de volta, e **um veredicto sobre cada um** — verdadeiro, falso ou *é
mais complicado* — com explicação e fonte.

É a parte séria do projeto. A briga é a isca; o painel é o que sobra depois.

Os veredictos são resumo editorial deste projeto, não checagem profissional, e
existem para ser contestados. A contribuição mais valiosa aqui é marcar como
falso um argumento do seu próprio lado.

## Assuntos do momento

Além das duas listas permanentes, existem **hot topics**: arquivos com argumentos
para os dois lados de um episódio específico — o caso Banco Master, o conflito
entre Mendonça e Moraes no STF, o fim da taxa das blusinhas. De vez em quando os
bots entram num deles e passam alguns turnos ali antes de voltar.

Adicionar um assunto é adicionar um arquivo.

## Como contribuir

Um argumento novo é **um objeto num arquivo JSON**. Um veredicto que você acha
injusto é uma linha trocada. Veja [CONTRIBUTING.md](./CONTRIBUTING.md).

## Como funciona

Um Worker da Cloudflare, um D1, um Durable Object.

- Um cron de 5 em 5 minutos mantém um **buffer** de ~20 mensagens à frente do
  relógio, em vez de publicar uma por minuto. Uma falha tenta de novo daqui a
  cinco minutos com quinze de folga na fila, e ninguém vê buraco.
- Cada mensagem carrega um `due_at`. **A API entrega ao navegador mensagens que
  ainda não aconteceram**, e o cliente revela cada uma no seu horário. Uma
  requisição compra 10–20 minutos, e todo mundo no mundo vê a mesma mensagem cair
  no mesmo segundo do relógio. É por isso que não tem socket nem estado por
  visitante.
- **Os dois se lembram.** De vez em quando um deles desenterra algo que o outro
  disse dias atrás sobre o mesmo assunto, cita as palavras dele e diz que já
  respondeu isso. É a única citação do site que dá pra conferir rolando a tela
  pra cima — e é o projeto inteiro em uma mensagem: a briga é um loop, e aqui o
  loop é dito em voz alta.
- **Os dois dormem** da meia-noite às 6h de Brasília. Um card centralizado avisa,
  o gerador pula a janela inteira de uma vez, e nenhuma chamada ao modelo é feita
  durante a madrugada.
- **Quem está assistindo agora** e as **reações** são compartilhadas por todo
  mundo, num Durable Object global — a única parte disto que precisa mesmo de
  coordenação.
- Se a chamada ao modelo falhar, estourar o orçamento ou for barrada pelo filtro,
  a vez publica o argumento **literal** da árvore. O fluxo nunca para, e como os
  dois reciclam as mesmas frases prontas de qualquer jeito, ninguém percebe.

O tamanho de cada mensagem é sorteado em **frases**, não em caracteres, e o
personagem não existe: cada lado é uma voz comum. Uma tentativa anterior deu a
cada lado um elenco de sete tipos e o resultado foi fantasia — o modelo gastava a
resposta imitando sotaque em vez de defender um ponto.

Nenhuma mensagem pode citar instituição que não esteja no material entregue ao
modelo. Isso é verificado no código, não pedido no prompt: um quarto das
mensagens já citou IBGE ou INPE como prova de coisa que o próprio argumento nunca
mencionou.

## Desenvolvimento

```bash
bun install
wrangler d1 migrations apply polerolero --local
bun run build
wrangler dev
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"
bun run check && bun test
```

Quem for mexer no código: leia [AGENTS.md](./AGENTS.md) antes. Quase tudo lá é
cicatriz de coisa que já quebrou em produção.

---

polerolero é um projeto pessoal de Guilherme Rodrigues — [vibegui.com](https://vibegui.com).
Sem vínculo com partido, campanha ou candidatura. Erro factual ou pedido de
retificação: [abra uma issue](https://github.com/vibegui/polerolero/issues/new)
ou escreva para gui@deco.cx.
