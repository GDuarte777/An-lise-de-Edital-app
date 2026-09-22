import { BrowserWindow } from "electron";

import { FONTE_REGEX_HOST } from "./endereco.js";
import { autenticadoPor, type Sondagem } from "./reconhecimento.js";

/**
 * Guardião de sessão: é ele que faz o login do gov.br não expirar no aplicativo.
 *
 * O problema, na palavra do operador: a página do Compras.gov.br precisa ser atualizada
 * o tempo todo, e a sessão cai em torno de dez minutos — às vezes bem menos. Numa aba do
 * Chrome isso é fatal para um robô: a aba vai para segundo plano, o SPA para de renovar
 * o token, e quando chega a hora do lance não há mais sessão.
 *
 * A saída não é técnica, é de arquitetura: **quem controla a janela controla a sessão.**
 * Num aplicativo instalado a janela é nossa, então dá para mantê-la viva sozinha, sem o
 * operador apertar F5 e sem atrapalhar o que ele está fazendo. É por isso que os robôs
 * de mercado são aplicativos instalados, e não extensões.
 *
 * Como funciona:
 *
 *  - uma janela OCULTA, na mesma partition do login, segura uma página do portal;
 *  - de tempos em tempos — bem abaixo do prazo de expiração — essa página é recarregada;
 *    o SPA do portal refaz suas chamadas e, quando precisa, dispara sozinho o
 *    `PUT .../sessao/fornecedor/retoken` que a coleta flagrou. Os cookies renovados valem
 *    para a partition inteira, então TODAS as janelas do aplicativo seguem logadas —
 *    inclusive a sala onde o robô está operando;
 *  - a janela da sala nunca é recarregada por aqui. Recarregar a sala no meio de um lance
 *    seria trocar um problema por outro pior.
 *
 * Se a sessão cair de verdade (o portal devolver a tela de login), o guardião para e
 * avisa. Ele não fica tentando para sempre: sessão morta se resolve com o operador
 * entrando de novo, e insistir em silêncio só esconderia isso dele.
 */

/**
 * Intervalo de renovação. Bem abaixo dos ~10 minutos relatados, porque o operador
 * também relatou que às vezes cai muito antes. Renovar à toa custa uma requisição numa
 * janela oculta; renovar tarde custa a disputa.
 */
export const INTERVALO_RENOVACAO_MS = 3 * 60 * 1000;

/** Quantas renovações seguidas podem falhar antes de declarar a sessão perdida. */
export const FALHAS_ATE_DESISTIR = 3;

export interface EstadoGuardiao {
  ativo: boolean;
  autenticado: boolean;
  desde: string | null;
  ultimaRenovacaoEm: string | null;
  proximaRenovacaoEm: string | null;
  renovacoes: number;
  falhasSeguidas: number;
  /** Quantas vezes o próprio portal renovou o token sozinho, observado na rede. */
  retokensObservados: number;
  motivo: string;
}

export interface OpcoesGuardiao {
  partition: string;
  /** Endereço do portal a manter carregado. Vem do registro de endereços aprendidos. */
  endereco: () => string;
  intervaloMs?: number;
  /**
   * Chamado antes de cada renovação. Devolver `false` adia — é como o robô impede que a
   * sessão seja rotacionada exatamente durante o envio de um lance.
   */
  podeRenovar?: () => boolean;
  aoMudar?: (estado: EstadoGuardiao) => void;
  aoRegistrar?: (nivel: "sistema" | "alerta", msg: string) => void;
  /** Seam de teste: como decidir, a partir da sondagem, se ainda estamos logados. */
  reconhecer?: (s: Sondagem | null) => boolean;
  /**
   * Pergunta ao portal se a sessão vale, sem depender de interpretar a página.
   * Quando presente e afirmativa, encerra a renovação — é a resposta mais confiável.
   */
  confirmar?: () => Promise<boolean>;
}

const SCRIPT_SONDA_VIVA = `
(() => {
  const txt = ((document.body && document.body.innerText) || "").slice(0, 30000);
  return {
    url: location.href.slice(0, 300),
    noSso: /sso\\.acesso\\.gov\\.br|acesso\\.gov\\.br\\/(login|autorizar)/i.test(location.href),
    // Host conferido de verdade, com a mesma regra do resto do aplicativo: se o portal
    // redirecionar para outro domínio, isto precisa dizer "não é o portal".
    noPortal: new RegExp("${FONTE_REGEX_HOST}", "i").test(location.host),
    temSenha: Boolean(document.querySelector('input[type="password"]')),
    temSair: /\\b(sair|logout|encerrar sess[aã]o|desconectar)\\b/i.test(txt),
    temIdentidade: /\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}/.test(txt) || /\\d{2}\\.\\d{3}\\.\\d{3}\\/\\d{4}-\\d{2}/.test(txt) ||
                   /(logado como|usu[aá]rio:|bem[- ]vindo|ol[aá],)/i.test(txt),
    escolhendoPerfil: false,
    tamanho: txt.length,
    manterAberta: false
  };
})()
`;

export class GuardiaoSessao {
  private janela: BrowserWindow | null = null;
  private timer: NodeJS.Timeout | null = null;
  private renovando = false;

  private estado: EstadoGuardiao = {
    ativo: false,
    autenticado: false,
    desde: null,
    ultimaRenovacaoEm: null,
    proximaRenovacaoEm: null,
    renovacoes: 0,
    falhasSeguidas: 0,
    retokensObservados: 0,
    motivo: "Guardião parado."
  };

  constructor(private readonly opcoes: OpcoesGuardiao) {}

  get intervaloMs(): number {
    return this.opcoes.intervaloMs ?? INTERVALO_RENOVACAO_MS;
  }

  get atual(): EstadoGuardiao {
    return { ...this.estado };
  }

  private publicar(mudanca: Partial<EstadoGuardiao>): void {
    this.estado = { ...this.estado, ...mudanca };
    this.opcoes.aoMudar?.(this.atual);
  }

  private log(nivel: "sistema" | "alerta", msg: string): void {
    this.opcoes.aoRegistrar?.(nivel, msg);
  }

  private criarJanela(): BrowserWindow {
    const janela = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        partition: this.opcoes.partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    // O portal renova o token sozinho quando uma chamada volta 401. Observar isso é a
    // prova de que a sessão está viva de verdade, e não só de que a página carregou.
    janela.webContents.session.webRequest.onCompleted(
      { urls: ["*://*/*retoken*"] },
      (detalhes) => {
        if (detalhes.statusCode >= 200 && detalhes.statusCode < 300) {
          this.publicar({ retokensObservados: this.estado.retokensObservados + 1 });
        }
      }
    );

    janela.on("closed", () => {
      if (this.janela === janela) this.janela = null;
    });
    return janela;
  }

  private async sondar(): Promise<Sondagem | null> {
    if (!this.janela || this.janela.isDestroyed()) return null;
    try {
      return (await this.janela.webContents.executeJavaScript(SCRIPT_SONDA_VIVA, true)) as Sondagem;
    } catch {
      return null;
    }
  }

  private reconhecer(s: Sondagem | null): boolean {
    return (this.opcoes.reconhecer ?? autenticadoPor)(s);
  }

  private async carregarComRetentativa(): Promise<void> {
    let ultimo: unknown = null;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      if (!this.janela || this.janela.isDestroyed()) this.janela = this.criarJanela();
      try {
        await this.janela.loadURL(this.opcoes.endereco());
        return;
      } catch (erro) {
        ultimo = erro;
        await new Promise((r) => setTimeout(r, 600 * (tentativa + 1)));
      }
    }
    throw ultimo instanceof Error ? ultimo : new Error(String(ultimo));
  }

  /**
   * Uma renovação: recarrega a página oculta e confere que continuamos logados.
   * O SPA faz o resto — inclusive o retoken, quando é o caso.
   */
  async renovar(): Promise<boolean> {
    if (this.renovando) return this.estado.autenticado;
    if (this.opcoes.podeRenovar && !this.opcoes.podeRenovar()) {
      this.log("sistema", "Renovação adiada: o robô está no meio de um lance.");
      return this.estado.autenticado;
    }

    this.renovando = true;
    try {
      if (!this.janela || this.janela.isDestroyed()) this.janela = this.criarJanela();

      // Uma carga que falha não é sessão perdida: é rede. O portal do governo cai e
      // volta o tempo todo, e desistir na primeira tentativa faria o guardião declarar
      // a sessão morta por causa de um blip — justamente o que ele existe para evitar.
      await this.carregarComRetentativa();

      // A pergunta direta ao portal vale mais que qualquer leitura de tela: ela não
      // depende de a rota existir nem de o HTML ter os sinais que esperamos.
      if (this.opcoes.confirmar && (await this.opcoes.confirmar())) {
        const agora = new Date();
        this.publicar({
          autenticado: true,
          renovacoes: this.estado.renovacoes + 1,
          falhasSeguidas: 0,
          ultimaRenovacaoEm: agora.toISOString(),
          proximaRenovacaoEm: new Date(agora.getTime() + this.intervaloMs).toISOString(),
          motivo: `Sessão renovada às ${agora.toLocaleTimeString("pt-BR")}.`
        });
        return true;
      }

      // SPA: sondar antes de desenhar daria "caiu" por engano.
      let s: Sondagem | null = null;
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 400));
        s = await this.sondar();
        if (this.reconhecer(s)) break;
        if (s?.noSso || s?.temSenha) break; // conclusivo: caiu para o login
      }

      const vivo = this.reconhecer(s);
      const agora = new Date();

      if (vivo) {
        this.publicar({
          autenticado: true,
          renovacoes: this.estado.renovacoes + 1,
          falhasSeguidas: 0,
          ultimaRenovacaoEm: agora.toISOString(),
          proximaRenovacaoEm: new Date(agora.getTime() + this.intervaloMs).toISOString(),
          motivo: `Sessão renovada às ${agora.toLocaleTimeString("pt-BR")}.`
        });
        return true;
      }

      const falhas = this.estado.falhasSeguidas + 1;
      const caiuNoLogin = Boolean(s?.noSso || s?.temSenha);
      this.publicar({
        autenticado: false,
        falhasSeguidas: falhas,
        ultimaRenovacaoEm: agora.toISOString(),
        motivo: caiuNoLogin
          ? "O portal devolveu a tela de login: a sessão expirou."
          : "O portal carregou, mas sem sinal de usuário autenticado."
      });

      // Cair no login é conclusivo — não adianta insistir, só o operador resolve.
      if (caiuNoLogin || falhas >= FALHAS_ATE_DESISTIR) {
        // O diagnóstico vai junto na mensagem de parada. Substituí-lo por um genérico
        // "sessão perdida" tira do operador a única pista do que aconteceu.
        this.log("alerta", `Sessão do gov.br perdida. ${this.estado.motivo} Entre de novo para o robô voltar a operar.`);
        this.parar(`${this.estado.motivo} Entre no gov.br de novo para o robô voltar a operar.`);
      }
      return false;
    } catch (erro) {
      const falhas = this.estado.falhasSeguidas + 1;
      this.publicar({
        falhasSeguidas: falhas,
        motivo: `Falha ao renovar: ${erro instanceof Error ? erro.message : String(erro)}`
      });
      if (falhas >= FALHAS_ATE_DESISTIR) this.parar(this.estado.motivo);
      return false;
    } finally {
      this.renovando = false;
    }
  }

  /** Liga o guardião. A primeira renovação acontece na hora, não daqui a três minutos. */
  async iniciar(): Promise<EstadoGuardiao> {
    if (this.estado.ativo) return this.atual;

    this.publicar({
      ativo: true,
      desde: new Date().toISOString(),
      falhasSeguidas: 0,
      motivo: "Guardião ligado."
    });
    this.log("sistema", `Guardião de sessão ligado: renovação a cada ${Math.round(this.intervaloMs / 60000)} min.`);

    await this.renovar();

    if (this.estado.ativo) {
      this.timer = setInterval(() => void this.renovar(), this.intervaloMs);
      this.timer.unref?.();   // não segurar o processo vivo só por causa do guardião
    }
    return this.atual;
  }

  parar(motivo = "Guardião parado pelo operador."): EstadoGuardiao {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.janela && !this.janela.isDestroyed()) this.janela.destroy();
    this.janela = null;
    this.publicar({ ativo: false, proximaRenovacaoEm: null, motivo });
    return this.atual;
  }
}
