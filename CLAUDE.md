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

Problema conhecido: `DisputasSheetTab` pendura o vitest ao ser renderizado em
jsdom (não é o `setInterval` de polling — o `CalendarTab` usa o mesmo padrão e
testa bem). Enquanto isso não for resolvido, esse componente não tem teste de
renderização.

## Princípio que vale mais que os outros

Esta é uma plataforma de licitações: **nunca inventar conteúdo de edital, preço
ou exigência de habilitação.** Campo que a fonte não trouxe fica em branco ou é
omitido — nunca preenchido por suposição, nem rotulado como "não informado" de
um jeito que convide a IA a completar a lacuna. O repositório já teve dois casos
desse tipo (gerador de licitações fictícias no Radar e bloco de habilitação
fixo enviado à IA como se fosse do certame), e os dois foram removidos.
