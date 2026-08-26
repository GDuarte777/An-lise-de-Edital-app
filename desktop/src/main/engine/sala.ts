import { BrowserWindow } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { scriptAgenteSala, type DiagnosticoSala, type EnvioSala, type ItemVisivel, type LeituraSala, type SeletoresAprendidos } from "./sala-script.js";
import type { EstadoItem, PortalAdapter, ReferenciaItem, ResultadoEnvio } from "./portal.js";

/**
 * Operação real na sala de disputa do Compras.gov.br.
 *
 * A sala fica aberta numa janela Chromium do próprio aplicativo, na mesma sessão em que
 * o operador entrou no gov.br. O robô lê a tela e aciona os controles da tela — não
 * reproduz requisição nenhuma. Isso é o que faz o lance ser real: quem envia é o
 * JavaScript do portal, com os tokens que ele acabou de emitir.
 *
 * A janela é deliberadamente visível. O operador precisa poder ver o que o robô está
 * fazendo com a conta dele e assumir o controle a qualquer momento.
 */

const URL_SALA = "https://sala-disputa.comprasnet.gov.br/";

export interface OpcoesSala {
  /** Sessão persistente do portal (partition), a mesma do login. */
  partition: string;
  /** Onde guardar os seletores aprendidos de um envio manual. */
  caminhoSeletores: string;
  aoRegistrar?: (nivel: "sistema" | "alerta", msg: string) => void;
}

interface JanelaSala {
  janela: BrowserWindow;
  pregaoId: string;
}

export class GerenciadorSalas {
  private readonly salas = new Map<string, JanelaSala>();
  private seletores: SeletoresAprendidos = {};
  private carregado = false;

  constructor(private readonly opcoes: OpcoesSala) {}

  private log(nivel: "sistema" | "alerta", msg: string): void {
    this.opcoes.aoRegistrar?.(nivel, msg);
  }

  async carregarSeletores(): Promise<void> {
    if (this.carregado) return;
    this.carregado = true;
    try {
      this.seletores = JSON.parse(await readFile(this.opcoes.caminhoSeletores, "utf-8")) as SeletoresAprendidos;
    } catch {
      this.seletores = {};
    }
  }

  private async guardarSeletores(novos: SeletoresAprendidos): Promise<void> {
    this.seletores = novos;
    await mkdir(dirname(this.opcoes.caminhoSeletores), { recursive: true });
    await writeFile(this.opcoes.caminhoSeletores, JSON.stringify(novos, null, 2), "utf-8");
  }

  get seletoresAprendidos(): SeletoresAprendidos {
    return this.seletores;
  }

  /** Adota uma janela de sala que já foi aberta por outro caminho da interface. */
  registrar(janela: BrowserWindow, pregaoId: string): void {
    const chave = pregaoId || "_";
    this.salas.set(chave, { janela, pregaoId });
    janela.on("closed", () => {
      if (this.salas.get(chave)?.janela === janela) this.salas.delete(chave);
    });
  }

  janelaDe(pregaoId: string): BrowserWindow | null {
    // Casamento exato de propósito: devolver a sala de outro pregão faria o robô ler a
    // tela errada e digitar o lance no item errado.
    const registro = this.salas.get(pregaoId || "_");
    if (!registro) return null;
    if (registro.janela.isDestroyed()) {
      this.salas.delete(pregaoId || "_");
      return null;
    }
    return registro.janela;
  }

  /**
   * Garante uma sala aberta para este pregão. Reaproveita a janela que já existir: abrir
   * uma segunda sala do mesmo pregão faria o portal derrubar a primeira sessão.
   */
  async garantir(pregaoId: string): Promise<BrowserWindow> {
    await this.carregarSeletores();

    const existente = this.janelaDe(pregaoId);
    if (existente) {
      await this.injetar(existente);
      return existente;
    }

    const janela = new BrowserWindow({
      width: 1320,
      height: 900,
      title: `Sala de Disputa — ${pregaoId || "Compras.gov.br"}`,
      autoHideMenuBar: true,
      show: true,
      webPreferences: {
        partition: this.opcoes.partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    // Reinjeta a cada navegação: a sala é uma SPA e troca de rota ao entrar no item.
    const reinjetar = () => void this.injetar(janela).catch(() => undefined);
    janela.webContents.on("dom-ready", reinjetar);
    janela.webContents.on("did-navigate-in-page", reinjetar);

    const url = pregaoId ? `${URL_SALA}?compra=${encodeURIComponent(pregaoId)}` : URL_SALA;
    await janela.loadURL(url);
    await this.assentar(janela);

    this.registrar(janela, pregaoId);
    this.log("sistema", `Sala de disputa aberta para ${pregaoId || "o portal"}.`);
    return janela;
  }

  /** Espera a SPA desenhar. Sem isto, a primeira leitura acontece numa tela vazia. */
  private async assentar(janela: BrowserWindow, limiteMs = 12000): Promise<void> {
    const inicio = Date.now();
    let anterior = -1;
    while (Date.now() - inicio < limiteMs) {
      let tamanho = 0;
      try {
        tamanho = (await janela.webContents.executeJavaScript(
          "(document.body && document.body.innerText ? document.body.innerText.length : 0)",
          true
        )) as number;
      } catch {
        return;
      }
      if (tamanho > 200 && tamanho === anterior) return;
      anterior = tamanho;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  /** Injeta (ou reativa) o agente na página, com os seletores aprendidos. */
  private async injetar(janela: BrowserWindow): Promise<void> {
    if (janela.isDestroyed()) return;
    try {
      await janela.webContents.executeJavaScript(scriptAgenteSala(this.seletores), true);
    } catch {
      // Página em transição: a próxima injeção cobre.
    }
  }

  /**
   * Chama uma função do agente. Reinjeta e tenta de novo quando a página trocou de rota
   * entre a injeção e a chamada — que é o caso comum numa SPA.
   */
  private async chamar<T>(pregaoId: string, expressao: string): Promise<T> {
    const janela = await this.garantir(pregaoId);
    const executar = () => janela.webContents.executeJavaScript(expressao, true) as Promise<T>;

    const vivo = (await janela.webContents.executeJavaScript(
      "Boolean(window.__lancebotSala)",
      true
    )) as boolean;
    if (!vivo) await this.injetar(janela);

    try {
      return await executar();
    } catch {
      await this.injetar(janela);
      return await executar();
    }
  }

  /** Persiste os seletores se o operador tiver enviado um lance manual desde a última vez. */
  private async colherAprendizado(pregaoId: string): Promise<void> {
    try {
      const novo = (await this.chamar<SeletoresAprendidos | null>(
        pregaoId,
        "(window.__lancebotSala && window.__lancebotSala.aprendidoNovo) " +
          "? (window.__lancebotSala.aprendidoNovo = false, window.__lancebotSala.aprendido) : null"
      )) as SeletoresAprendidos | null;
      if (novo && novo.campo && novo.botao) {
        await this.guardarSeletores(novo);
        this.log("sistema", "Aprendi o campo e o botão de lance a partir do seu envio manual.");
      }
    } catch {
      // Aprendizado é acessório; nunca pode derrubar o ciclo.
    }
  }

  async ler(ref: ReferenciaItem): Promise<LeituraSala> {
    await this.colherAprendizado(ref.pregaoId);
    return this.chamar<LeituraSala>(ref.pregaoId, `window.__lancebotSala.ler(${JSON.stringify(ref.itemNum)})`);
  }

  async diagnosticar(ref: ReferenciaItem): Promise<DiagnosticoSala> {
    return this.chamar<DiagnosticoSala>(
      ref.pregaoId,
      `window.__lancebotSala.diagnostico(${JSON.stringify(ref.itemNum)})`
    );
  }

  async listarVisiveis(pregaoId = ""): Promise<ItemVisivel[]> {
    return this.chamar<ItemVisivel[]>(pregaoId, "window.__lancebotSala.listar()");
  }

  async enviar(ref: ReferenciaItem, valor: number, seco = false): Promise<EnvioSala> {
    const resultado = await this.chamar<EnvioSala>(
      ref.pregaoId,
      `window.__lancebotSala.enviar(${JSON.stringify(ref.itemNum)}, ${valor}, { seco: ${seco ? "true" : "false"} })`
    );
    if (resultado.seletores?.campo && resultado.seletores.botao && !this.seletores.campo) {
      await this.guardarSeletores({ ...resultado.seletores, aprendidoEm: new Date().toISOString() });
    }
    return resultado;
  }

  /**
   * Varre páginas do portal numa janela oculta e devolve as disputas que elas mostram.
   *
   * É o caminho que faz a lista existir logo depois do login, sem depender de o
   * DescobridorApi ter aprendido endpoint nenhum — que era o motivo de "Suas disputas"
   * viver vazia. A janela é a mesma sessão autenticada, então o portal responde como
   * responderia ao operador.
   */
  async coletarDisputas(urls: string[]): Promise<ItemVisivel[]> {
    await this.carregarSeletores();
    const saida: ItemVisivel[] = [];

    for (const url of urls) {
      const janela = new BrowserWindow({
        show: false,
        width: 1400,
        height: 1000,
        webPreferences: {
          partition: this.opcoes.partition,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      });
      try {
        await janela.loadURL(url);
        await this.assentar(janela, 9000);
        await this.injetar(janela);
        const itens = (await janela.webContents.executeJavaScript(
          "window.__lancebotSala ? window.__lancebotSala.listar() : []",
          true
        )) as ItemVisivel[];
        saida.push(...itens);
      } catch (erro) {
        this.log("alerta", `Não consegui ler ${url}: ${erro instanceof Error ? erro.message : String(erro)}`);
      } finally {
        if (!janela.isDestroyed()) janela.destroy();
      }
    }
    return saida;
  }

  fechar(pregaoId?: string): void {
    for (const [chave, registro] of this.salas) {
      if (pregaoId && registro.pregaoId !== pregaoId) continue;
      if (!registro.janela.isDestroyed()) registro.janela.close();
      this.salas.delete(chave);
    }
  }
}

/**
 * Adapter de produção. Só existe para amarrar o gerenciador ao contrato que o motor
 * conhece — toda a inteligência está no agente, dentro da página.
 */
export class SalaDisputaAdapter implements PortalAdapter {
  readonly nome = "Compras.gov.br — sala de disputa";
  readonly ehSimulacao = false;

  constructor(private readonly salas: GerenciadorSalas) {}

  async lerEstado(ref: ReferenciaItem): Promise<EstadoItem> {
    const leitura = await this.salas.ler(ref);
    if (!leitura.ok || leitura.menorLance === null) {
      throw new Error(
        leitura.motivo ??
          "Não consegui ler o lance atual na sala. Confira se a sala de disputa deste item está aberta."
      );
    }
    return {
      menorLance: leitura.menorLance,
      nossoLance: leitura.nossoLance ?? undefined,
      aberto: leitura.aberto,
      lidoEm: new Date()
    };
  }

  async enviarLance(ref: ReferenciaItem, valor: number): Promise<ResultadoEnvio> {
    const envio = await this.salas.enviar(ref, valor);

    // `ok: false` é "não cheguei a enviar" — campo não encontrado, botão sumido, valor
    // recusado pela máscara. Isso é falha nossa, não recusa do portal: virando exceção,
    // entra no contador de erros do motor em vez de ser registrado como lance negado.
    if (!envio.ok) throw new Error(envio.mensagem);

    return { aceito: envio.aceito, confirmado: envio.confirmado, mensagem: envio.mensagem };
  }
}
