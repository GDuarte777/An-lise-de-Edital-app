// ═══════════════════════════════════════════════════════════════════════
// BACKEND DA PLATAFORMA — ponto de entrada (Supabase Edge Function)
//
// Todo o backend roda aqui. A Vercel publica apenas o frontend estático; não
// existe mais nenhuma função serverless dela no caminho de uma requisição.
//
// Por que a mudança: a função da Vercel vinha morrendo na carga do módulo e
// devolvendo FUNCTION_INVOCATION_FAILED sem executar uma única linha nossa —
// nem a telemetria de boot chegava a gravar. Sem log de dentro e sem acesso ao
// log da plataforma, o diagnóstico virou eliminação de hipóteses às cegas.
// Aqui o log da função é legível pelo próprio Supabase, que já é a base de
// dados da plataforma, então a observabilidade deixa de depender de terceiros.
//
// Endereço público:
//   https://<projeto>.supabase.co/functions/v1/api/<rota>
// que o frontend enxerga como /api/<rota> (ver src/utils/aiClientHelper.ts).
// ═══════════════════════════════════════════════════════════════════════
import process from "node:process";
import { criarAplicativo, type Requisicao } from "./expresso.ts";
import { registrarRotas } from "./rotas.ts";
import {
  limitarRequisicoes,
  registrarDiagnostico,
  memoriaMb,
  describeAiFailure,
} from "./nucleo.ts";

/**
 * Teto do corpo da requisição.
 *
 * Um PDF de edital chega em base64 dentro de um JSON, o que já infla o
 * conteúdo em ~33%. O runtime de borda tem memória limitada e segura o texto
 * cru e o objeto convertido ao mesmo tempo, então um teto alto não é
 * generosidade: é a garantia de que a função é morta de fora, sem log e sem
 * resposta. Acima do teto o cliente recebe um 413 explicando o caminho
 * alternativo, que é o envio em partes por /api/upload-chunk.
 */
const LIMITE_CORPO_BYTES = Number(process.env.MAX_REQUEST_BODY_BYTES || 20 * 1024 * 1024);

const CABECALHOS_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept, accept-profile, prefer",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const app = criarAplicativo();

// Registra entrada e saída de cada chamada. O par início/fim é o que denuncia
// uma requisição morta no meio por estouro de memória ou de tempo: é a única
// assinatura que não dá para obter de dentro do código de outra forma.
app.use("/api", (req, _res, next) => {
  if (req.path !== "/api/health") {
    registrarDiagnostico(
      "inicio",
      `${req.method} ${req.path}`,
      `memoria=${memoriaMb()}MB`,
    );
  }
  next();
});

app.use("/api", limitarRequisicoes);

registrarRotas(app);

// Uma rota /api desconhecida responde JSON, nunca HTML: o cliente faz
// JSON.parse da resposta e um HTML aqui vira "Unexpected token '<'".
app.use("/api", (req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
});

// Tratador de erros. A rota e o tipo do erro vão na resposta de propósito:
// quando algo quebrar em produção, a mensagem na tela do usuário já diz onde,
// sem depender de acesso ao log da plataforma.
app.use((erro: any, req: Requisicao, res: any, _next: any) => {
  const rota = `${req.method} ${req.path}`;
  console.error(`[api] Erro não tratado em ${rota}:`, erro?.stack || erro?.message || erro);
  registrarDiagnostico("erro", rota, String(erro?.message || erro).slice(0, 500), String(erro?.stack || ""));
  if (res.headersSent) return;
  res.status(500).json({
    error: describeAiFailure(erro),
    rota,
    tipo: erro?.name || "Error",
    detalhe: String(erro?.message || erro).slice(0, 300),
  });
});

/** Normaliza o caminho recebido pelo gateway do Supabase para o formato /api/*. */
function caminhoDaRota(pathname: string): string {
  // O gateway entrega /functions/v1/api/<rota>; o dev local entrega /api/<rota>.
  const semGateway = pathname.replace(/^\/functions\/v1/, "");
  if (semGateway === "" || semGateway === "/") return "/api";
  return semGateway.startsWith("/api") ? semGateway : `/api${semGateway}`;
}

Deno.serve(async (requisicao: Request) => {
  if (requisicao.method === "OPTIONS") {
    return new Response("ok", { headers: CABECALHOS_CORS });
  }

  const url = new URL(requisicao.url);
  const caminho = caminhoDaRota(url.pathname);
  const comecou = Date.now();

  const cabecalhos: Record<string, string> = {};
  requisicao.headers.forEach((valor, nome) => {
    cabecalhos[nome.toLowerCase()] = valor;
  });

  const query: Record<string, string> = {};
  url.searchParams.forEach((valor, nome) => {
    query[nome] = valor;
  });

  let corpo: any = {};
  if (requisicao.method !== "GET" && requisicao.method !== "HEAD") {
    const declarado = Number(cabecalhos["content-length"] || 0);
    if (declarado > LIMITE_CORPO_BYTES) {
      return responder(413, {
        error:
          `Arquivo grande demais para envio direto (limite de ${Math.round(LIMITE_CORPO_BYTES / 1024 / 1024)}MB). ` +
          `Para editais extensos, use a aba "Análise de Edital", que envia o documento em partes.`,
      });
    }
    try {
      const texto = await requisicao.text();
      if (texto.length > LIMITE_CORPO_BYTES) {
        return responder(413, {
          error: `Corpo da requisição acima do limite de ${Math.round(LIMITE_CORPO_BYTES / 1024 / 1024)}MB.`,
        });
      }
      corpo = texto ? JSON.parse(texto) : {};
    } catch (erro: any) {
      return responder(400, { error: `Corpo da requisição não é um JSON válido: ${erro?.message || erro}` });
    }
  }

  const req: Requisicao = {
    method: requisicao.method,
    path: caminho,
    originalUrl: caminho + (url.search || ""),
    headers: cabecalhos,
    query,
    body: corpo,
    socket: { remoteAddress: cabecalhos["x-forwarded-for"] || "" },
    ip: (cabecalhos["x-forwarded-for"] || "").split(",")[0].trim(),
  };

  try {
    const saida = await app.despachar(req);
    if (caminho !== "/api/health") {
      registrarDiagnostico(
        "fim",
        `${req.method} ${caminho}`,
        `status=${saida.status} ${Date.now() - comecou}ms memoria=${memoriaMb()}MB`,
      );
    }
    return new Response(saida.corpo, {
      status: saida.status,
      headers: { ...CABECALHOS_CORS, ...saida.cabecalhos },
    });
  } catch (erro: any) {
    // Rede de segurança final: nada que aconteça numa rota pode fazer a função
    // devolver a página de erro genérica da plataforma em vez de uma mensagem.
    console.error("[api] Falha fora da cadeia de rotas:", erro?.stack || erro?.message || erro);
    registrarDiagnostico("erro", `${req.method} ${caminho}`, String(erro?.message || erro).slice(0, 500), String(erro?.stack || ""));
    return responder(500, {
      error: describeAiFailure(erro),
      rota: `${req.method} ${caminho}`,
      tipo: erro?.name || "Error",
    });
  }
});

function responder(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" },
  });
}

registrarDiagnostico(
  "boot",
  "",
  `runtime=deno plataforma=supabase deploy=${process.env.SB_EXECUTION_ID || "?"}`,
);
