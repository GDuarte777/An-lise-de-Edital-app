/**
 * Ponto de entrada da API na Vercel.
 *
 * O `vercel.json` usava o formato legado (`version: 2` + `builds`), que aponta
 * direto para o `server.ts` na raiz. Enquanto o servidor só importava pacotes do
 * npm, isso funcionou. Em 17/09 ele passou a importar módulos relativos de
 * `src/` (segredos, pncpQuery) e a função quebrou: o build continuava
 * publicando o site — o frontend novo ia ao ar normalmente —, mas toda chamada
 * a /api devolvia FUNCTION_INVOCATION_FAILED antes de executar qualquer linha
 * do nosso código. Nem o marcador gravado no primeiro import chegava a rodar.
 *
 * Com a convenção `api/[...path].ts`, a Vercel compila esta função com o
 * rastreamento normal de dependências, que acompanha imports relativos, e
 * entrega em `req.url` o caminho original (/api/chat, /api/analyze-edital), de
 * modo que as rotas do Express continuam casando sem nenhuma reescrita.
 *
 * O app é o mesmo: `server.ts` já exporta o Express por padrão e, com a variável
 * VERCEL presente, não abre porta nem carrega o Vite.
 */
export { default } from "../server";
