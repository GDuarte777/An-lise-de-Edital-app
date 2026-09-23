/**
 * Sonda mínima, sem nenhuma dependência.
 *
 * Toda chamada a /api devolve FUNCTION_INVOCATION_FAILED, e a telemetria mostra
 * que nem o primeiro import do servidor chega a executar. Isso tem duas
 * explicações possíveis, e nenhuma observação feita até agora as separa:
 *
 *   a) a esteira de funções do projeto está quebrada — nenhuma função roda;
 *   b) a esteira funciona e o problema é o módulo do servidor (peso do pacote,
 *      algum import, o tempo de inicialização).
 *
 * Este arquivo não importa NADA: nem express, nem o servidor, nem um utilitário.
 * Se /api/ping responder, (a) está descartado e o problema é o nosso módulo.
 * Se /api/ping também falhar, o problema é do projeto na Vercel e nenhuma
 * mudança no código teria efeito.
 */
export default function handler(_req: any, res: any) {
  res.setHeader("Content-Type", "application/json");
  res.status(200).end(
    JSON.stringify({
      ping: "ok",
      node: process.version,
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 8),
      regiao: process.env.VERCEL_REGION || "local",
      quando: new Date().toISOString()
    })
  );
}
