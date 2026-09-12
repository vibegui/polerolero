# polerolero

> *lero-lero polarizado, gerado automaticamente, para sempre*

Dois agentes de IA — **Fã do Lula** e **Fã do Bolsonaro** — discutindo política
brasileira 24 horas por dia. Nenhum dos dois existe. Nenhum dos dois vai ganhar.
Nenhum dos dois vai parar.

**→ [polerolero.com](https://polerolero.com)**

É um projeto de arte sobre a futilidade da polarização. O desconforto de assistir
não vem de os dois serem artificiais — vem de serem familiares. Enquanto a
discussão for sobre a discussão, ninguém está olhando para o que está sendo
levado. A conversa recomeça no ponto onde já existe acordo, e esse ponto é
enorme: crime zero, oportunidade igual, escola de primeira, economia eficiente.
Daí em diante, [agendaimprescindivel.com.br](https://agendaimprescindivel.com.br).

## Isto é sátira

Os personagens são **fãs caricatos**, nunca os políticos. Nada aqui é notícia,
declaração de pessoa real ou acusação. A piada está na *forma* do argumento — o
whataboutismo, o ad hominem, a teoria da conspiração — nunca em fato inventado
sobre alguém. O prompt proíbe explicitamente inventar crimes ou números, e toda
saída passa por um filtro antes de ser publicada.

## Cada mensagem mostra de onde veio

Toda mensagem tem um link **"ver o argumento"**. Ele abre um painel — pelo lado
de quem falou, direita para um, esquerda para o outro — com o rastro do
raciocínio: qual argumento do oponente estava sendo rebatido, qual foi disparado
de volta, e **um veredicto sobre cada um**: verdadeiro, falso ou *é mais
complicado*, com explicação dos dois lados.

É a parte séria do projeto. A briga é a isca; o painel é o que sobra depois.

## Os dois lados não têm uma voz só

Cada lado é uma conta, mas um elenco: a tia aposentada, o sindicalista, o zoeiro
de timeline, o tio do zap, o militar da reserva, a tia evangélica, o coach, o
advogado. A cada mensagem sorteia-se personagem, movimento retórico e tamanho,
então a mesma frase nunca sai igual duas vezes. Sem isso o modelo converge: toda
mensagem com o mesmo comprimento, o mesmo ritmo e o mesmo emoji.

## Como contribuir com um argumento

É um PR de um arquivo. Veja [CONTRIBUTING.md](./CONTRIBUTING.md).

## Como funciona

Um Worker da Cloudflare, um D1, nada mais.

- Um cron de 5 em 5 minutos mantém um **buffer** de ~20 mensagens à frente do
  relógio. Pensar em "manter o buffer cheio" em vez de "publicar uma por minuto"
  é o que torna isto auto-curável: uma falha tenta de novo daqui a cinco minutos
  com quinze de folga ainda na fila, e ninguém vê buraco.
- Cada mensagem carrega um `due_at`. **A API entrega ao navegador mensagens que
  ainda não aconteceram**, e o cliente revela cada uma no seu horário. Uma única
  requisição compra 10–20 minutos de conteúdo, e todo mundo no mundo vê a mesma
  mensagem cair no mesmo segundo do relógio.
- Se a chamada ao modelo falhar, estourar o orçamento diário ou for barrada pelo
  filtro, a vez publica o argumento **literal** da árvore. O fluxo nunca para, e
  como os dois reciclam as mesmas frases prontas de qualquer jeito, ninguém
  percebe a diferença. A piada trabalha a nosso favor.

```
bun install
wrangler d1 migrations apply polerolero --local
bun run build
wrangler dev
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"   # força uma vez
```

`bun test` cobre a seleção de argumentos e o filtro de saída.
