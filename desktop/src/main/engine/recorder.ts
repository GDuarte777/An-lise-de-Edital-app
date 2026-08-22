import { writeFile } from "node:fs/promises";
import type { Session } from "electron";

/**
 * Modo Captura: registra as requisições que a própria sala de disputa faz enquanto o
 * operador navega nela normalmente, e exporta um arquivo com URLs, métodos e formatos.
 *
 * É esse arquivo que permite preencher o MAPEAMENTO em comprasnet.ts com dados reais,
 * em vez de adivinhar nomes de campo.
 *
 * O que NÃO é gravado: cabeçalhos de autenticação, cookies e qualquer corpo de
 * requisição de login. O objetivo é descobrir o formato da API, não coletar credenciais
 * — e um arquivo de captura tende a ser compartilhado para análise.
 */

const CABECALHOS_SENSIVEIS = new Set(["authorization", "cookie", "set-cookie", "x-csrf-token", "proxy-authorization"]);

const URLS_DE_LOGIN = [/sso\.acesso\.gov\.br/i, /login/i, /oauth/i, /token/i, /autenticacao/i];

export interface RequisicaoCapturada {
  em: string;
  metodo: string;
  url: string;
  tipoRecurso: string;
  /** Cabeçalhos com os sensíveis substituídos por "[omitido]". */
  cabecalhos: Record<string, string>;
  statusResposta?: number;
}

export class GravadorTrafego {
  private readonly capturas: RequisicaoCapturada[] = [];
  private gravando = false;

  constructor(private readonly sessao: Session) {}

  private ehLogin(url: string): boolean {
    return URLS_DE_LOGIN.some((re) => re.test(url));
  }

  private sanitizar(cabecalhos: Record<string, string | string[] | undefined>): Record<string, string> {
    const saida: Record<string, string> = {};
    for (const [chave, valor] of Object.entries(cabecalhos)) {
      saida[chave] = CABECALHOS_SENSIVEIS.has(chave.toLowerCase())
        ? "[omitido]"
        : Array.isArray(valor)
          ? valor.join("; ")
          : String(valor ?? "");
    }
    return saida;
  }

  iniciar(): void {
    if (this.gravando) return;
    this.gravando = true;
    this.capturas.length = 0;

    this.sessao.webRequest.onSendHeaders({ urls: ["https://*.comprasnet.gov.br/*", "https://*.compras.gov.br/*"] }, (detalhes) => {
      if (this.ehLogin(detalhes.url)) return;
      this.capturas.push({
        em: new Date().toISOString(),
        metodo: detalhes.method,
        url: detalhes.url,
        tipoRecurso: detalhes.resourceType,
        cabecalhos: this.sanitizar(detalhes.requestHeaders ?? {})
      });
    });

    this.sessao.webRequest.onCompleted({ urls: ["https://*.comprasnet.gov.br/*", "https://*.compras.gov.br/*"] }, (detalhes) => {
      const alvo = [...this.capturas].reverse().find((c) => c.url === detalhes.url && c.statusResposta === undefined);
      if (alvo) alvo.statusResposta = detalhes.statusCode;
    });
  }

  parar(): void {
    this.gravando = false;
  }

  get total(): number {
    return this.capturas.length;
  }

  /** Só o que interessa para mapear a API: chamadas XHR/fetch, sem assets. */
  chamadasDeApi(): RequisicaoCapturada[] {
    return this.capturas.filter((c) => c.tipoRecurso === "xhr" || c.tipoRecurso === "fetch");
  }

  async exportar(caminho: string): Promise<number> {
    const chamadas = this.chamadasDeApi();
    const conteudo = {
      geradoEm: new Date().toISOString(),
      aviso:
        "Cabeçalhos de autenticação e cookies foram omitidos. Confira o arquivo antes de compartilhar. " +
        "Os corpos de resposta NÃO são capturados aqui — copie-os manualmente do DevTools para os endpoints relevantes.",
      totalRequisicoes: this.capturas.length,
      chamadasDeApi: chamadas
    };
    await writeFile(caminho, JSON.stringify(conteudo, null, 2), "utf-8");
    return chamadas.length;
  }
}
