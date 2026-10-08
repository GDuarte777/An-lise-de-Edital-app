# Notas para o Claude Code

## Fluxo de entrega

**Terminar uma mudança significa deixá-la mesclada no `main`.** Não pare no
branch e não pergunte se pode abrir o PR: abra, espere o CI, mescle. O dono do
repositório testa a funcionalidade na aplicação publicada — mudança parada em
branch é mudança que ele não tem como experimentar.

A sequência, sempre nesta ordem:

1. Desenvolver em `claude/clever-curie-w2z71c`, partindo do `main` atualizado
   (`git fetch origin main && git checkout -B claude/clever-curie-w2z71c origin/main`).
   Se o PR anterior desse branch já foi mesclado, recomeçar dele é o certo.
2. Rodar localmente as mesmas quatro etapas do CI, antes de empurrar:
   `npm run lint` · `npm run typecheck:edge` · `npm test` · `npm run build`.
3. Abrir o PR, esperar os checks, mesclar fixando o SHA do head
   (`expectedHeadSha`), e confirmar o CI no `main` depois do merge.

Mesclar com CI vermelho, ou sem esperar os checks, não. A pressa é para não
deixar o trabalho parado, não para pular a verificação.

## Verificação

- `npm run lint` — tipos do frontend.
- `npm run typecheck:edge` — tipos do backend (Supabase Edge Functions, Deno).
- `npm test` — vitest. Testes de componente pedem jsdom no topo do arquivo,
  com `// @vitest-environment jsdom`.
- `npm run build` — pega import quebrado e asset ausente, que a checagem de
  tipos não vê.

O que pendura o vitest em jsdom (medido no `NotepadTab`, out/2026): **desmontar
uma árvore cujo `Popover` ou `DropdownMenu` do radix foi aberto custa ~44 s.**
Quem trava é o `cleanup()` do `afterEach`, não a interação — o fluxo de abrir o
popover, digitar e salvar roda em ~190 ms e grava certo. O sintoma enganoso é o
teste estourar o prazo numa asserção que nada tem a ver com o radix, porque o
`waitFor` disputa o laço com a desmontagem.

Consequência prática: fluxo que começa abrindo um `Popover` ou `DropdownMenu`
não vale teste de renderização nesta suíte — a regra vai para um módulo puro em
`utils/`, que é o que se testa. Dois detalhes para quem tentar de novo:
`DropdownMenu` não abre com `fireEvent.click` em jsdom (o `button` do
PointerEvent não chega ao handler do radix), só com
`fireEvent.keyDown(gatilho, { key: "Enter" })`.

É essa, com alta probabilidade, a causa do travamento do `DisputasSheetTab`, que
abre vários `Popover` e `DropdownMenu` por renderização — e não o `setInterval`
de polling, já que o `CalendarTab` usa o mesmo padrão e testa bem. Esse
componente continua sem teste de renderização.

Componente de linha de lista declarado DENTRO do corpo de outro componente
remonta a cada renderização (o React vê um tipo de elemento novo), o que destrói
menu aberto e faz o radix reabrir em laço. Ver o comentário de `ItemPasta` em
`NotepadTab.tsx`.

## Princípio que vale mais que os outros

Esta é uma plataforma de licitações: **nunca inventar conteúdo de edital, preço
ou exigência de habilitação.** Campo que a fonte não trouxe fica em branco ou é
omitido — nunca preenchido por suposição, nem rotulado como "não informado" de
um jeito que convide a IA a completar a lacuna. O repositório já teve dois casos
desse tipo (gerador de licitações fictícias no Radar e bloco de habilitação
fixo enviado à IA como se fosse do certame), e os dois foram removidos.
