/**
 * Coletor da sessão do portal: token e captcha, colhidos do tráfego do próprio portal.
 *
 * Este arquivo existe por causa de um 403 com o operador logado na frente da tela. O
 * diagnóstico dizia "1 cookie encontrado, o portal respondeu que não há usuário logado",
 * e a conclusão errada seria que o login falhou. O que acontece é outra coisa:
 *
 *   o Compras.gov.br novo (SPA do SERPRO) NÃO guarda a sessão em cookie. Ela é um token
 *   que o próprio aplicativo da página manda no cabeçalho `Authorization` de cada
 *   chamada. Sem esse cabeçalho, a API responde 403 — mesmo com a sessão viva.
 *
 * É exactamente o modelo que a análise do SIGA mostrou. Então o token é colhido de onde
 * ele existe: as requisições que a página do portal já faz, observadas na sessão do
 * Electron. Nada é decifrado, nada é forjado — é a mesma credencial que o navegador do
 * operador acabou de usar, na máquina dele.
 *
 * Regras que não se negociam aqui:
 *  - o valor do token e o do captcha NUNCA entram em log, IPC ou disco. Para fora deste
 *    módulo vai só presença e idade (`estado()`);
 *  - captcha velho é tratado como inexistente: ele vale segundos, e usar vencido faria o
 *    robô achar que pode ler quando não pode.
 */

/** Depois disto, o token provavelmente venceu — o portal renova de minutos em minutos. */
export const VALIDADE_TOKEN_MS = 15 * 60 * 1000;

/**
 * Captcha do portal vale pouco e é de uso único. 90 segundos é o limite em que ainda
 * vale tentar; passou disso, o robô trata como "não tenho captcha" e diz ao operador.
 */
export const VALIDADE_CAPTCHA_MS = 90 * 1000;

export interface EstadoSessaoPortal {
  temToken: boolean;
  /** Em segundos, para a interface mostrar "colhido há 12s". */
  idadeTokenS: number | null;
  temCaptcha: boolean;
  idadeCaptchaS: number | null;
  /** Host da API que o portal está usando de verdade (não um endereço nosso). */
  hostApi: string | null;
  /** Quantas requisições do portal já passaram pelo coletor — evidência de que ele vê. */
  observadas: number;
}

export interface Observacao {
  url: string;
  autorizacao?: string;
  em?: number;
}

/**
 * O coletor em si, sem Electron: recebe observações e guarda a mais recente. Assim a
 * regra de validade e a de sigilo são testáveis sem abrir janela.
 */
export class ColetorSessaoPortal {
  private token: string | null = null;
  private tokenEm = 0;
  private captcha: string | null = null;
  private captchaEm = 0;
  private host: string | null = null;
  private vistas = 0;

  constructor(private readonly agora: () => number = () => Date.now()) {}

  /** Uma requisição do portal passou. Dela se aproveita o que é credencial. */
  observar(obs: Observacao): void {
    const em = obs.em ?? this.agora();
    let aproveitou = false;

    const autorizacao = (obs.autorizacao ?? "").trim();
    if (ehTokenPlausivel(autorizacao)) {
      this.token = autorizacao;
      this.tokenEm = em;
      aproveitou = true;
    }

    const captcha = extrairCaptcha(obs.url);
    if (captcha) {
      this.captcha = captcha;
      this.captchaEm = em;
      aproveitou = true;
    }

    const host = hostDe(obs.url);
    if (host && /serpro\.gov\.br$|compras(net)?\.gov\.br$/i.test(host)) this.host = host;

    if (aproveitou) this.vistas++;
  }

  /** Token da sessão, como o portal o manda. `null` quando não há ou já venceu. */
  tokenAtual(): string | null {
    if (!this.token) return null;
    return this.agora() - this.tokenEm <= VALIDADE_TOKEN_MS ? this.token : null;
  }

  /**
   * Captcha recente. Devolve `null` tanto quando não há quanto quando está velho — e a
   * diferença não importa para quem chama: nos dois casos não se lê.
   */
  captchaAtual(): string | null {
    if (!this.captcha) return null;
    return this.agora() - this.captchaEm <= VALIDADE_CAPTCHA_MS ? this.captcha : null;
  }

  hostApi(): string | null {
    return this.host;
  }

  /** O que a interface pode ver. Valor de credencial nunca sai daqui. */
  estado(): EstadoSessaoPortal {
    const agora = this.agora();
    const token = this.tokenAtual();
    const captcha = this.captchaAtual();
    return {
      temToken: token !== null,
      idadeTokenS: token === null ? null : Math.round((agora - this.tokenEm) / 1000),
      temCaptcha: captcha !== null,
      idadeCaptchaS: captcha === null ? null : Math.round((agora - this.captchaEm) / 1000),
      hostApi: this.host,
      observadas: this.vistas
    };
  }

  /** Usado ao sair do portal: credencial de sessão encerrada não fica em memória. */
  esquecer(): void {
    this.token = null;
    this.tokenEm = 0;
    this.captcha = null;
    this.captchaEm = 0;
    this.vistas = 0;
  }
}

/**
 * Token plausível é `Bearer <jwt>` ou um JWT nu — três partes separadas por ponto,
 * começando por `eyJ` (o `{"` de um cabeçalho JSON em base64).
 *
 * A checagem existe para não guardar lixo: `Authorization: Basic ...` de alguma chamada
 * de terceiro, ou um `Bearer undefined` que o SPA manda enquanto não logou.
 */
export function ehTokenPlausivel(valor: string): boolean {
  const nu = valor.replace(/^Bearer\s+/i, "").trim();
  if (!nu || nu.length < 40) return false;
  const partes = nu.split(".");
  if (partes.length !== 3) return false;
  if (!/^eyJ[\w-]+$/.test(partes[0])) return false;
  return partes.slice(1).every((p) => /^[\w-]*$/.test(p) && p.length > 0);
}

/** Token de captcha na query, do jeito que o portal manda nas leituras. */
export function extrairCaptcha(url: string): string | null {
  const m = /[?&]captcha=([^&#]+)/i.exec(url);
  if (!m) return null;
  const valor = decodeURIComponent(m[1]);
  return valor.length >= 20 ? valor : null;
}

function hostDe(url: string): string | null {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}
