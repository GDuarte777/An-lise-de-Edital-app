// Declarações para conferir o backend do Supabase (Deno) com o tsc do projeto.
//
// Não existe Deno instalado no ambiente de desenvolvimento deste repositório, e
// publicar código que só é verificado no servidor de produção é como voltar ao
// ponto de partida. Estes tipos deixam `npm run typecheck:edge` validar os
// arquivos de supabase/functions/api com o mesmo compilador do resto do projeto.
declare module "npm:@google/genai@2.8.0" {
  export * from "@google/genai";
}

declare module "npm:unpdf" {
  export function getDocumentProxy(dados: Uint8Array): Promise<unknown>;
  export function extractText(
    documento: unknown,
    opcoes?: { mergePages?: boolean }
  ): Promise<{ text: string; totalPages: number }>;
}

declare const Deno: {
  serve(manipulador: (requisicao: Request) => Response | Promise<Response>): unknown;
  env: { get(nome: string): string | undefined };
};
