import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Session } from "electron";

/**
 * Descoberta automática da API do portal.
 *
 * O aplicativo não sabe, e não tem como adivinhar, quais endpoints a sala de disputa
 * usa — inventar nomes de campo foi o defeito que derrubou a versão anterior deste
 * projeto. Em vez de pedir ao operador que exporte um arquivo de captura, o app aprende
 * sozinho: enquanto ele navega no portal embutido, observamos as chamadas que a própria
 * página faz e classificamos cada uma pelo formato da resposta.
 *
 * O que é aprendido fica gravado em disco, então a calibração acontece uma vez e vale
 * para as próximas execuções.
 *
 * Nada de cabeçalho de autenticação ou cookie é lido ou gravado aqui: as requisições do
 * robô saem da mesma sessão do Chromium, que anexa as credenciais por conta própria.
 */

export type PapelEndpoint = "estado-item" | "lista-disputas" | "envio-lance" | "desconhecido";

export interface EndpointAprendido {
  papel: PapelEndpoint;
  /** URL com os identificadores variáveis trocados por {pregaoId} / {itemNum}. */
  padrao: string;
  metodo: string;
  /** Caminho do campo dentro da resposta, ex.: "dados.menorLance". */
  campos: Record<string, string>;
  exemploUrl: string;
  aprendidoEm: string;
  /** Quantas vezes uma chamada com esse padrão foi observada. Mais vezes = mais confiança. */
  ocorrencias: number;
}

export interface EstadoCalibracao {
  estadoItem?: EndpointAprendido;
  listaDisputas?: EndpointAprendido;
  envioLance?: EndpointAprendido;
}

/** Nomes que costumam identificar cada grandeza em APIs de pregão brasileiras. */
const PISTAS = {
  menorLance: ["menorlance", "menorvalor", "valormenorlance", "melhorlance", "valorlance", "lanceatual", "valoratual"],
  nossoLance: ["meulance", "meuvalor", "lancefornecedor", "valorfornecedor", "nossolance"],
  aberto: ["aberto", "emdisputa", "situacaoitem", "statusitem", "fase", "situacao", "status"],
  identItem: ["item", "numeroitem", "nritem", "iditem"],
  identPregao: ["pregao", "numeropregao", "idcompra", "numerocompra", "licitacao"]
} as const;

const URLS_IGNORADAS = /\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map)(\?|$)/i;
const URLS_LOGIN = /sso\.acesso\.gov\.br|\/login|\/oauth|\/token|autentica/i;

function normalizar(chave: string): string {
  return chave.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Percorre um objeto e devolve os caminhos de todas as folhas, até uma profundidade. */
function achatar(valor: unknown, prefixo = "", profundidade = 0): Array<[string, unknown]> {
  if (profundidade > 4 || valor === null || typeof valor !== "object") {
    return prefixo ? [[prefixo, valor]] : [];
  }
  if (Array.isArray(valor)) {
    // Basta o primeiro elemento para descobrir o formato da coleção.
    return valor.length > 0 ? achatar(valor[0], `${prefixo}[]`, profundidade + 1) : [];
  }
  const saida: Array<[string, unknown]> = [];
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    saida.push(...achatar(v, prefixo ? `${prefixo}.${chave}` : chave, profundidade + 1));
  }
  return saida;
}

function pareceNumero(valor: unknown): boolean {
  if (typeof valor === "number") return Number.isFinite(valor);
  if (typeof valor !== "string") return false;
  return /^-?[\d.,]+$/.test(valor.trim()) && /\d/.test(valor);
}

/** Procura, entre os caminhos achatados, o primeiro cujo nome final case com as pistas. */
function acharCampo(campos: Array<[string, unknown]>, pistas: readonly string[], exigirNumero: boolean): string | undefined {
  for (const [caminho, valor] of campos) {
    const folha = normalizar(caminho.split(".").pop() ?? "");
    if (!pistas.some((p) => folha.includes(p))) continue;
    if (exigirNumero && !pareceNumero(valor)) continue;
    return caminho;
  }
  return undefined;
}

/**
 * Substitui na URL os trechos que parecem identificadores por marcadores, para que o
 * padrão sirva a qualquer pregão e item.
 */
export function gerarPadrao(url: string, pregaoId?: string, itemNum?: string): string {
  let padrao = url;
  if (pregaoId) padrao = padrao.split(pregaoId).join("{pregaoId}");
  if (itemNum) padrao = padrao.split(`/${itemNum}`).join("/{itemNum}");
  // Sobrando números longos no caminho, tratamos como identificador de pregão.
  padrao = padrao.replace(/\/\d{8,}/g, "/{pregaoId}");
  return padrao;
}

/** Registro cru do que foi visto, para diagnóstico quando a classificação não acerta. */
export interface ChamadaObservada {
  metodo: string;
  url: string;
  status: number;
  em: string;
  /** Campos do topo da resposta, quando ela é JSON — ajuda a identificar o endpoint. */
  camposVistos?: string[];
  classificadaComo?: PapelEndpoint;
}

export class DescobridorApi {
  private estado: EstadoCalibracao = {};
  private readonly contagem = new Map<string, number>();
  private readonly observadas: ChamadaObservada[] = [];
  private ligado = false;
  private aoAprender: (e: EstadoCalibracao) => void = () => {};

  constructor(
    private readonly sessao: Session,
    private readonly caminhoArquivo: string
  ) {}

  get calibracao(): EstadoCalibracao {
    return this.estado;
  }

  /** Verdadeiro quando dá para ler o item e enviar lance — o mínimo para operar. */
  get prontoParaProducao(): boolean {
    return Boolean(this.estado.estadoItem && this.estado.envioLance);
  }

  observar(cb: (e: EstadoCalibracao) => void): void {
    this.aoAprender = cb;
  }

  async carregar(): Promise<void> {
    try {
      this.estado = JSON.parse(await readFile(this.caminhoArquivo, "utf-8")) as EstadoCalibracao;
    } catch {
      this.estado = {};
    }
  }

  private async salvar(): Promise<void> {
    await mkdir(dirname(this.caminhoArquivo), { recursive: true });
    await writeFile(this.caminhoArquivo, JSON.stringify(this.estado, null, 2), "utf-8");
    this.aoAprender(this.estado);
  }

  /**
   * Passa a observar o tráfego da sessão. Só olhamos chamadas de dados (xhr/fetch) para
   * os domínios do portal, ignorando assets e qualquer coisa ligada a autenticação.
   */
  ligar(): void {
    if (this.ligado) return;
    this.ligado = true;

    const filtro = { urls: ["https://*.comprasnet.gov.br/*", "https://*.compras.gov.br/*"] };

    this.sessao.webRequest.onCompleted(filtro, (detalhes) => {
      // Em execução o Electron reporta "xhr" para chamadas de dados, mas esse valor não
      // consta da união de tipos de onCompleted — daí a comparação via string.
      const tipo = String(detalhes.resourceType);
      if (tipo !== "xhr" && tipo !== "fetch") return;
      if (URLS_IGNORADAS.test(detalhes.url) || URLS_LOGIN.test(detalhes.url)) return;
      if (detalhes.statusCode < 200 || detalhes.statusCode >= 300) return;

      const chave = `${detalhes.method} ${gerarPadrao(detalhes.url)}`;
      this.contagem.set(chave, (this.contagem.get(chave) ?? 0) + 1);

      // Guarda o rastro cru: se a heurística errar, o operador consegue ver o que o
      // portal realmente expôs, em vez de ficar sem pista nenhuma.
      if (!this.observadas.some((o) => o.metodo === detalhes.method && o.url === detalhes.url)) {
        this.observadas.push({
          metodo: detalhes.method,
          url: detalhes.url,
          status: detalhes.statusCode,
          em: new Date().toISOString()
        });
        if (this.observadas.length > 200) this.observadas.shift();
      }

      if (detalhes.method === "POST" || detalhes.method === "PUT") {
        void this.classificarEnvio(detalhes.url, detalhes.method);
      } else {
        void this.classificarLeitura(detalhes.url, detalhes.method);
      }
    });
  }

  desligar(): void {
    this.ligado = false;
  }

  /**
   * Refaz a chamada observada — na mesma sessão, então autenticada — para inspecionar o
   * corpo da resposta, que o webRequest não entrega.
   */
  private async lerCorpo(url: string): Promise<unknown | null> {
    try {
      const resp = await this.sessao.fetch(url, { method: "GET", headers: { Accept: "application/json" } });
      if (!resp.ok) return null;
      const tipo = resp.headers.get("content-type") ?? "";
      if (!tipo.includes("json")) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  private async classificarLeitura(url: string, metodo: string): Promise<void> {
    const corpo = await this.lerCorpo(url);
    if (!corpo) return;

    const campos = achatar(corpo);
    if (campos.length === 0) return;

    const menorLance = acharCampo(campos, PISTAS.menorLance, true);
    const ehColecao = Array.isArray(corpo) || campos.some(([c]) => c.includes("[]"));

    // Resposta com valor de lance e sem ser lista: é o estado de um item.
    if (menorLance && !ehColecao) {
      const anterior = this.estado.estadoItem;
      const ocorrencias = (anterior?.exemploUrl === url ? anterior.ocorrencias : 0) + 1;
      this.estado.estadoItem = {
        papel: "estado-item",
        padrao: gerarPadrao(url),
        metodo,
        campos: {
          menorLance,
          ...(acharCampo(campos, PISTAS.nossoLance, true) ? { nossoLance: acharCampo(campos, PISTAS.nossoLance, true)! } : {}),
          ...(acharCampo(campos, PISTAS.aberto, false) ? { aberto: acharCampo(campos, PISTAS.aberto, false)! } : {})
        },
        exemploUrl: url,
        aprendidoEm: new Date().toISOString(),
        ocorrencias
      };
      await this.salvar();
      return;
    }

    // Lista contendo identificadores de pregão/item: é o painel de disputas.
    if (ehColecao && acharCampo(campos, PISTAS.identPregao, false)) {
      this.estado.listaDisputas = {
        papel: "lista-disputas",
        padrao: gerarPadrao(url),
        metodo,
        campos: {
          ...(acharCampo(campos, PISTAS.identPregao, false) ? { pregao: acharCampo(campos, PISTAS.identPregao, false)! } : {}),
          ...(acharCampo(campos, PISTAS.identItem, false) ? { item: acharCampo(campos, PISTAS.identItem, false)! } : {}),
          ...(acharCampo(campos, PISTAS.aberto, false) ? { situacao: acharCampo(campos, PISTAS.aberto, false)! } : {})
        },
        exemploUrl: url,
        aprendidoEm: new Date().toISOString(),
        ocorrencias: (this.estado.listaDisputas?.ocorrencias ?? 0) + 1
      };
      await this.salvar();
    }
  }

  /**
   * POSTs cujo caminho remete a lance são candidatos a envio. Registramos o padrão sem
   * nunca reenviar a requisição: repetir um POST de lance seria mandar um lance real.
   */
  private async classificarEnvio(url: string, metodo: string): Promise<void> {
    if (!/lance|proposta|oferta/i.test(url)) return;

    this.estado.envioLance = {
      papel: "envio-lance",
      padrao: gerarPadrao(url),
      metodo,
      campos: {},
      exemploUrl: url,
      aprendidoEm: new Date().toISOString(),
      ocorrencias: (this.estado.envioLance?.ocorrencias ?? 0) + 1
    };
    await this.salvar();
  }

  /** Tudo que foi visto do portal, mais recente primeiro. Base do diagnóstico. */
  get chamadasObservadas(): ChamadaObservada[] {
    return [...this.observadas].reverse();
  }

  /** Corrige manualmente o que foi aprendido, quando a heurística erra. */
  async ajustar(parcial: Partial<EstadoCalibracao>): Promise<void> {
    this.estado = { ...this.estado, ...parcial };
    await this.salvar();
  }

  async esquecer(): Promise<void> {
    this.estado = {};
    this.contagem.clear();
    await this.salvar();
  }
}
