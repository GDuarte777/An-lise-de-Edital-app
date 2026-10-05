// ═══════════════════════════════════════════════════════════════════════
// MINI-EXPRESS PARA O RUNTIME DE BORDA
//
// As rotas da plataforma foram escritas contra a API do Express (req.body,
// res.status().json(), middlewares com next()). Reescrever duas mil linhas de
// rota para o formato Request/Response do Deno seria reescrever regra de
// negócio testada só para trocar a casca — e cada linha reescrita é uma chance
// de introduzir um defeito novo num código que o usuário precisa funcionando.
//
// Em vez disso, esta camada oferece a fatia do Express que as rotas realmente
// usam, que é pequena: método + caminho, cabeçalhos, query, corpo JSON,
// status/json/send/setHeader e a cadeia de middlewares. As rotas vêm do
// servidor Node praticamente sem alteração, e o que roda no Supabase é o mesmo
// código que já rodava.
//
// O que esta camada NÃO faz, de propósito: roteadores aninhados e streaming.
// Nenhuma rota deste projeto usa; implementar por precaução seria superfície
// sem cliente.
//
// Parâmetros de rota (`/x/:id`) entraram quando o assistente de lances passou
// a atender `/api/apps/:appId/functions/bidAssistant`. O formato do caminho não
// é escolha nossa: é o que a extensão já chama, e mantê-lo é o que permite
// trocar de backend sem reempacotar a extensão instalada em cada máquina.
// ═══════════════════════════════════════════════════════════════════════

export interface Requisicao {
  method: string;
  /** Caminho sem query string, sempre começando em `/api`. */
  path: string;
  originalUrl: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  /** Segmentos `:nome` do caminho registrado. Vazio para rotas sem parâmetro. */
  params: Record<string, string>;
  body: any;
  socket: { remoteAddress: string };
  ip: string;
}

export interface Resposta {
  statusCode: number;
  headersSent: boolean;
  status(codigo: number): Resposta;
  json(valor: any): Resposta;
  send(valor: any): Resposta;
  setHeader(nome: string, valor: string): Resposta;
  end(): Resposta;
}

type Manipulador = (req: Requisicao, res: Resposta, next: (erro?: any) => void) => any;
type ManipuladorDeErro = (erro: any, req: Requisicao, res: Resposta, next: (erro?: any) => void) => any;

interface Registro {
  metodo: string | null;
  caminho: string | null;
  manipulador: Manipulador | ManipuladorDeErro;
  ehErro: boolean;
}

/** Corpo já resolvido de uma resposta, pronto para virar um `Response` do Deno. */
interface Saida {
  status: number;
  cabecalhos: Record<string, string>;
  corpo: BodyInit | null;
}

function criarResposta(): { res: Resposta; saida: () => Saida | null } {
  let escrita: Saida | null = null;
  const cabecalhos: Record<string, string> = {};
  let status = 200;

  const res: Resposta = {
    get statusCode() {
      return status;
    },
    set statusCode(valor: number) {
      status = valor;
    },
    get headersSent() {
      return escrita !== null;
    },
    status(codigo: number) {
      status = codigo;
      return res;
    },
    setHeader(nome: string, valor: string) {
      cabecalhos[nome] = valor;
      return res;
    },
    json(valor: any) {
      if (escrita) return res;
      cabecalhos["Content-Type"] = "application/json";
      escrita = { status, cabecalhos, corpo: JSON.stringify(valor) };
      return res;
    },
    send(valor: any) {
      if (escrita) return res;
      let corpo: BodyInit | null;
      if (valor == null) {
        corpo = null;
      } else if (typeof valor === "string") {
        corpo = valor;
        cabecalhos["Content-Type"] = cabecalhos["Content-Type"] || "text/plain; charset=utf-8";
      } else if (valor instanceof Uint8Array) {
        // Buffer do node:buffer É um Uint8Array, então isto cobre os dois casos.
        corpo = valor;
        cabecalhos["Content-Type"] = cabecalhos["Content-Type"] || "application/octet-stream";
      } else {
        cabecalhos["Content-Type"] = "application/json";
        corpo = JSON.stringify(valor);
      }
      escrita = { status, cabecalhos, corpo };
      return res;
    },
    end() {
      if (escrita) return res;
      escrita = { status, cabecalhos, corpo: null };
      return res;
    },
  };

  return { res, saida: () => escrita };
}

export class AplicativoExpresso {
  private registros: Registro[] = [];

  private registrar(metodo: string | null, args: any[]) {
    const caminho = typeof args[0] === "string" ? args[0] : null;
    const manipuladores = args.filter((a) => typeof a === "function");
    for (const manipulador of manipuladores) {
      this.registros.push({
        metodo,
        caminho,
        manipulador,
        // A assinatura de quatro argumentos é o que distingue um tratador de
        // erro de um middleware comum — mesma convenção do Express.
        ehErro: metodo === null && manipulador.length >= 4,
      });
    }
  }

  get(...args: any[]) { this.registrar("GET", args); }
  post(...args: any[]) { this.registrar("POST", args); }
  put(...args: any[]) { this.registrar("PUT", args); }
  patch(...args: any[]) { this.registrar("PATCH", args); }
  delete(...args: any[]) { this.registrar("DELETE", args); }
  all(...args: any[]) { this.registrar(null, args); }
  use(...args: any[]) { this.registrar(null, args); }

  /**
   * Diz se o registro atende esta requisição e, em caso afirmativo, devolve os
   * parâmetros extraídos do caminho.
   *
   * Devolver `null` em vez de `false` é o que separa "não casou" de "casou sem
   * parâmetro nenhum": um objeto vazio é um casamento válido.
   */
  private combina(registro: Registro, req: Requisicao): Record<string, string> | null {
    if (registro.metodo && registro.metodo !== req.method) return null;
    if (!registro.caminho) return {};
    if (registro.metodo) {
      if (registro.caminho === req.path) return {};
      if (!registro.caminho.includes(":")) return null;
      return casarParametros(registro.caminho, req.path);
    }
    // `use("/api", fn)` casa com o prefixo, como no Express.
    return req.path === registro.caminho || req.path.startsWith(registro.caminho + "/") ? {} : null;
  }

  /**
   * Executa a cadeia registrada e devolve a resposta HTTP.
   *
   * O percurso é sequencial e assíncrono: cada manipulador pode responder
   * (encerrando o percurso), chamar next() para seguir, ou chamar next(erro)
   * para pular direto para os tratadores de erro. Uma rejeição não capturada
   * dentro de um handler `async` vira next(erro) — no Express 4 ela não vira,
   * e era justamente isso que derrubava o processo inteiro sem deixar log.
   */
  async despachar(req: Requisicao): Promise<Saida> {
    const { res, saida } = criarResposta();
    let erroAtual: any = null;

    for (const registro of this.registros) {
      if (saida()) break;
      // Enquanto há erro em voo só rodam tratadores de erro; sem erro, só os comuns.
      if (Boolean(erroAtual) !== registro.ehErro) continue;
      const parametros = this.combina(registro, req);
      if (!parametros) continue;
      req.params = parametros;

      let seguir = false;
      let proximoErro: any = null;
      const next = (erro?: any) => {
        seguir = true;
        if (erro) proximoErro = erro;
      };

      try {
        const resultado = registro.ehErro
          ? (registro.manipulador as ManipuladorDeErro)(erroAtual, req, res, next)
          : (registro.manipulador as Manipulador)(req, res, next);
        if (resultado && typeof resultado.then === "function") await resultado;
      } catch (erro) {
        seguir = true;
        proximoErro = erro;
      }

      if (saida()) break;
      if (proximoErro) {
        erroAtual = proximoErro;
        continue;
      }
      // next() sem argumento dentro de um tratador de erro repassa o mesmo erro.
      if (seguir) continue;

      // Não respondeu e não chamou next(): no Express a requisição ficaria
      // pendurada até o timeout da plataforma, que é exatamente o tipo de falha
      // muda que se tentou eliminar aqui. Vira erro explícito e observável.
      erroAtual = new Error(`A rota ${req.method} ${req.path} terminou sem responder.`);
    }

    const escrita = saida();
    if (escrita) return escrita;

    if (erroAtual) throw erroAtual;
    return {
      status: 404,
      cabecalhos: { "Content-Type": "application/json" },
      corpo: JSON.stringify({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` }),
    };
  }
}

/**
 * Casa um caminho com `:nome` contra o caminho recebido.
 *
 * A comparação é segmento a segmento, sem expressão regular: um caminho de
 * rota é dado nosso, mas o caminho recebido vem de fora, e montar uma regex
 * com pedaço de entrada externa é como se constrói uma negação de serviço por
 * backtracking sem perceber.
 */
function casarParametros(molde: string, caminho: string): Record<string, string> | null {
  const segmentosMolde = molde.split("/");
  const segmentosCaminho = caminho.split("/");
  if (segmentosMolde.length !== segmentosCaminho.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < segmentosMolde.length; i++) {
    const esperado = segmentosMolde[i];
    const recebido = segmentosCaminho[i];
    if (esperado.startsWith(":")) {
      // Um segmento vazio casaria com `:appId` e deixaria a rota rodar sem o
      // identificador, que é pior do que não casar.
      if (!recebido) return null;
      params[esperado.slice(1)] = decodeURIComponent(recebido);
      continue;
    }
    if (esperado !== recebido) return null;
  }
  return params;
}

export function criarAplicativo(): AplicativoExpresso {
  return new AplicativoExpresso();
}
