// ═══════════════════════════════════════════════════════════════════════
// ENDEREÇO DO BACKEND
//
// O backend da plataforma roda inteiramente no Supabase, como Edge Function.
// A Vercel publica apenas os arquivos estáticos do frontend — nenhuma função
// serverless dela participa mais de uma requisição.
//
// O código do frontend continua escrito em termos de "/api/chat",
// "/api/analyze-edital" e assim por diante. Esta função é o único lugar que
// sabe para onde esses caminhos realmente vão:
//
//   /api/chat  →  https://<projeto>.supabase.co/functions/v1/api/chat
//
// Deixar isso concentrado aqui é o que permite apontar o frontend para um
// `supabase functions serve` local, para um projeto de teste ou para produção
// trocando uma variável, sem tocar em nenhuma tela.
// ═══════════════════════════════════════════════════════════════════════

const URL_PADRAO_SUPABASE = "https://cghlfhndoqohmrrvppjj.supabase.co";
const CHAVE_PADRAO_SUPABASE = "sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o";

function lerLocalStorage(chave: string): string {
  try {
    return localStorage.getItem(chave) || "";
  } catch {
    // Em SSR, em aba anônima com armazenamento bloqueado ou dentro de um
    // worker, o acesso lança. Isso nunca pode impedir uma chamada de API.
    return "";
  }
}

function ambiente(nome: string): string {
  return (import.meta as any)?.env?.[nome] || "";
}

/** URL do projeto Supabase em uso (sem barra final). */
export function urlDoSupabase(): string {
  const url = ambiente("VITE_SUPABASE_URL") || lerLocalStorage("supabase_url") || URL_PADRAO_SUPABASE;
  return url.replace(/\/+$/, "");
}

/** Chave publicável do Supabase, exigida pelo gateway das Edge Functions. */
export function chaveAnonimaDoSupabase(): string {
  return ambiente("VITE_SUPABASE_ANON_KEY") || lerLocalStorage("supabase_anon_key") || CHAVE_PADRAO_SUPABASE;
}

/**
 * Base das rotas de API.
 *
 * VITE_API_BASE existe para apontar o frontend a um backend local
 * (`supabase functions serve`, normalmente http://127.0.0.1:54321/functions/v1)
 * sem precisar alterar código.
 */
export function baseDaApi(): string {
  const explicita = ambiente("VITE_API_BASE") || lerLocalStorage("api_base");
  if (explicita) return explicita.replace(/\/+$/, "");
  return `${urlDoSupabase()}/functions/v1`;
}

/**
 * Converte um caminho interno ("/api/chat") no endereço real da Edge Function.
 *
 * Aceita também um caminho já absoluto e o devolve intacto, para que quem já
 * tem a URL completa possa passar por aqui sem caso especial.
 */
export function urlDaApi(caminho: string): string {
  if (/^https?:\/\//i.test(caminho)) return caminho;
  const relativo = caminho.startsWith("/") ? caminho : `/${caminho}`;
  return `${baseDaApi()}${relativo}`;
}

/**
 * Cabeçalhos que o gateway do Supabase espera em toda chamada a uma função.
 *
 * `apikey` identifica o projeto. Sem ele o gateway responde 401 antes de a
 * função existir — e o corpo dessa resposta não é o JSON que o frontend
 * espera, o que aparece na tela como "resposta inválida do servidor".
 */
export function cabecalhosDaApi(): Record<string, string> {
  return { apikey: chaveAnonimaDoSupabase() };
}
