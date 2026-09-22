/**
 * Marcador de carga do módulo — o PRIMEIRO import de server.ts.
 *
 * O FUNCTION_INVOCATION_FAILED persiste e a tabela de diagnóstico está vazia,
 * inclusive sem a linha "boot". Só que aquele marcador ficava depois de todos os
 * imports: em ESM os imports rodam antes de qualquer statement do módulo, então
 * um crash ao carregar @google/genai, pdf-parse ou qualquer outra dependência
 * acontece ANTES e não deixa registro.
 *
 * Este arquivo é importado primeiro, não depende de nada do projeto e não usa
 * nenhuma API além de fetch. Se a linha "boot-inicial" aparecer, o processo
 * chegou a executar código; se NÃO aparecer nem ela, ou o módulo não carrega de
 * jeito nenhum, ou o que está publicado não é este código.
 */
const URL_SUPABASE = process.env.VITE_SUPABASE_URL || "https://cghlfhndoqohmrrvppjj.supabase.co";
const CHAVE_SUPABASE =
  process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o";

try {
  const controle = new AbortController();
  setTimeout(() => controle.abort(), 3000);

  void fetch(`${URL_SUPABASE}/rest/v1/logs_diagnostico`, {
    method: "POST",
    headers: {
      apikey: CHAVE_SUPABASE,
      Authorization: `Bearer ${CHAVE_SUPABASE}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      fase: "boot-inicial",
      rota: "",
      detalhe: [
        `node=${process.version}`,
        `vercel=${Boolean(process.env.VERCEL)}`,
        `região=${process.env.VERCEL_REGION || "?"}`,
        `commit=${(process.env.VERCEL_GIT_COMMIT_SHA || "?").slice(0, 8)}`
      ].join(" ")
    }),
    signal: controle.signal
  }).catch(() => {});
} catch {
  // um marcador de diagnóstico jamais pode impedir o servidor de subir
}

export const MARCA_BOOT = true;
