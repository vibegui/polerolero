# Contribuindo com argumentos

Toda a discussão sai de dois arquivos:

- [`arguments/lula.json`](./arguments/lula.json)
- [`arguments/bolsonaro.json`](./arguments/bolsonaro.json)

Um PR aqui é **um objeto novo em um array**. Só isso.

```json
{
  "id": "lula-bolsa-familia",
  "claim": "Esmola é o que voces chamam de esmola. Bolsa Família tirou o Brasil do Mapa da Fome.",
  "tags": ["social", "economia", "fome"],
  "rebuts": ["esmola", "gastanca", "vagabundo"],
  "register": "indignado",
  "verdict": "depende",
  "explain": "Transferência de renda condicionada é uma das políticas sociais mais estudadas do mundo... Atribuir a saída do Mapa da Fome só ao programa é simplificação.",
  "source": "https://..."
}
```

| campo | | o que é |
|---|---|---|
| `id` | obrigatório | único, no formato `lado-assunto` |
| `claim` | obrigatório | a bobagem, na voz do personagem. É também o texto publicado quando o modelo falha, então tem que se sustentar sozinho |
| `tags` | obrigatório | sobre o que este argumento **é**. É o que o outro lado vai poder responder |
| `rebuts` | obrigatório | `tags` do **outro lado** que este argumento responde. É a aresta que liga os dois lados |
| `register` | obrigatório | `orgulhoso`, `indignado`, `deboche` ou `conspiratorio` |
| `verdict` | obrigatório | `verdadeiro`, `falso` ou `depende`. Vai aparecer no painel de rastreio da mensagem |
| `explain` | obrigatório | por que esse veredicto. **Inclua o que a frase acerta**, mesmo quando o veredicto é duro — é isso que separa este projeto de um panfleto |
| `source` | opcional | link para a checagem/desmentido. Encorajado |

### Sobre o veredicto

`depende` não é covardia — é o veredicto certo para a maior parte das brigas
reais, e o painel o mostra como **"é mais complicado"**. Use `falso` quando a
afirmação central é contrariada pela evidência disponível, e `verdadeiro` quando
ela se sustenta, mesmo que o tom seja insuportável. Um argumento do seu próprio
lado marcado como `falso` é o tipo de contribuição mais valiosa aqui.

O `explain` é lido por quem clicou em "ver o argumento" no meio da discussão.
Escreva para essa pessoa: curto, sem jargão, sem número inventado. Se não tem
certeza de uma estatística, descreva a direção da evidência em vez de citar o
número.

## Regras

1. **Contribua para os dois lados.** Um PR que só engorda um lado desequilibra a
   peça, e o equilíbrio é o assunto dela. Se só conhece um lado bem, tudo bem —
   mas diga isso no PR.
2. **Nada de fato inventado sobre pessoa real.** Sem crime inventado, sem número
   inventado, sem citação inventada. A graça está na *forma* do argumento, não em
   difamação. PRs com fato fabricado são fechados sem discussão.
3. **Sem xingamento, sem slur.** O filtro em `src/generate.ts` já barra, mas não
   faça o filtro trabalhar.
4. **`rebuts` tem que casar.** Pelo menos uma tag sua precisa existir no outro
   lado, senão o argumento nunca é escolhido. O teste garante isso — rode:

```bash
bun run check && bun test
```
