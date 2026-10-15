/**
 * O robô novo operando de verdade, pela sala de disputa.
 *
 * Por que por aqui e não pelo WebSocket/REST: o token de captcha das leituras e o token
 * do envio só existem dentro da página que o operador abriu. O agente que já vive nessa
 * página (`motor-extensao.ts`) sabe ler os cartões dos itens, o cronômetro e o chat, e
 * sabe clicar no botão de lance. Então ele é usado como OLHO e MÃO, e o cérebro é o novo:
 * `decidir()` com aritmética inteira, piso do operador, as duas variações do edital, os
 * cinco modos e a janela dos segundos finais.
 *
 * O ciclo de decisão do agente da página fica desligado de propósito: quem decide é o
 * motor novo, aqui no processo principal. Dois cérebros disputando o mesmo item seria a
 * pior combinação possível — por isso `armar()` do agente nunca é chamado.
 */
import type { WebContents } from "electron";

import {
  formatarSegundos,
  type ConfigItem,
  type EstadoPainel,
  type EventoLog,
  type FaseItem,
  type ItemPainel,
  type LinhaClassificacao,
  type MensagemChat,
  type NivelLog
} from "../../compartilhado/painel.js";
import { formatar, paraNumero } from "../bot/decimal.js";
import { lerDinheiro, type LeituraItem } from "../bot/eventos.js";
import { extrairMensagens, paraConfiguracaoMotor } from "../bot/fonte-viva.js";
import { Motor, type EventoMotor } from "../bot/motor.js";
import { extrairCodigoRecusa, type ResultadoLance } from "../bot/rest/portal.js";
import { INTERVALO_MINIMO_MS } from "../bot/limites.js";

/** Leitura crua que o agente da página devolve. Nada de nó do DOM passa por aqui. */
interface ItemDaTela {
  numero: string;
  melhorValor: number | null;
  meuValor: number | null;
  aberto: boolean;
  situacao: "aguardando" | "aberto" | "encerrado" | string;
  fase: string;
  segundosRestantes: number | null;
  posicao?: number | null;
  participantes?: number | null;
}

interface TelaDaSala {
  ausente?: boolean;
  disputa?: {
    titulo?: string;
    uasg?: string;
    orgao?: string;
    compra?: string;
    tempoRestante?: string;
    segundosRestantes?: number | null;
    conexaoCaiu?: boolean;
    naSalaDeDisputa?: boolean;
  } | null;
  itens?: ItemDaTela[];
  chat?: unknown[];
}

export interface OpcoesFonteSala {
  /** Janela da sala de disputa. Função porque ela pode ser fechada e reaberta. */
  obterConteudo: () => WebContents | null;
  /** Garante a sala aberta antes de começar (e depois de ela ser fechada). */
  garantirSala: () => Promise<WebContents>;
  /** Entre duas leituras da tela. Nunca abaixo do piso do freio. */
  intervaloMs?: number;
  aoEstado: (estado: EstadoPainel) => void;
}

const LIMITE_LOG = 300;

export class FonteSalaViva {
  private readonly motor: Motor;
  private readonly configs = new Map<string, ConfigItem>();
  private readonly leituras = new Map<string, LeituraItem>();
  private readonly daTela = new Map<string, ItemDaTela>();

  private chat: MensagemChat[] = [];
  private log: EventoLog[] = [];
  private cabecalho: NonNullable<TelaDaSala["disputa"]> = {};
  private relogio: NodeJS.Timeout | null = null;
  private lendo = false;
  private vivo = false;
  private semAgente = 0;

  constructor(private readonly opcoes: OpcoesFonteSala) {
    this.motor = new Motor({
      lancador: (pedido) => this.lancar(pedido.item, paraNumero(pedido.valor)),
      aoEvento: (e) => this.aoEventoMotor(e)
    });
  }

  async iniciar(): Promise<EstadoPainel> {
    if (this.vivo) return this.estadoAtual();
    this.vivo = true;
    this.registrar("sistema", "Abrindo a sala de disputa para o robô olhar.");
    await this.opcoes.garantirSala();
    this.agendar(0);
    return this.estadoAtual();
  }

  encerrar(): void {
    this.vivo = false;
    if (this.relogio) clearTimeout(this.relogio);
    this.relogio = null;
    this.motor.pararTudo("painel fechado");
  }

  // ---------- laço de leitura ----------

  private get intervalo(): number {
    return Math.max(INTERVALO_MINIMO_MS * 2, this.opcoes.intervaloMs ?? 900);
  }

  private agendar(atraso = this.intervalo): void {
    if (!this.vivo) return;
    if (this.relogio) clearTimeout(this.relogio);
    this.relogio = setTimeout(() => {
      void this.tick();
    }, atraso);
  }

  private async tick(): Promise<void> {
    if (!this.vivo || this.lendo) return;
    this.lendo = true;
    try {
      const tela = await this.lerTela();
      if (tela) this.absorver(tela);
    } catch (erro) {
      this.registrar("alerta", `Não consegui ler a sala: ${erro instanceof Error ? erro.message : String(erro)}`);
    } finally {
      this.lendo = false;
      this.publicar();
      this.agendar();
    }
  }

  private async lerTela(): Promise<TelaDaSala | null> {
    const conteudo = this.opcoes.obterConteudo();
    if (!conteudo || conteudo.isDestroyed()) {
      this.registrar("alerta", "A janela da sala foi fechada. Reabrindo.");
      await this.opcoes.garantirSala();
      return null;
    }
    const tela = (await conteudo.executeJavaScript(SCRIPT_LEITURA, true)) as TelaDaSala;
    if (tela?.ausente) {
      this.semAgente++;
      if (this.semAgente === 1 || this.semAgente % 10 === 0) {
        this.registrar("alerta", "O leitor do robô ainda não está ativo nesta página da sala.");
      }
      return null;
    }
    this.semAgente = 0;
    return tela;
  }

  private absorver(tela: TelaDaSala): void {
    if (tela.disputa) this.cabecalho = tela.disputa;

    const mensagens = extrairMensagens(tela.chat ?? []);
    if (mensagens.length > 0) this.absorverChat(mensagens);

    const compra = (this.cabecalho.compra ?? "").trim() || "sala";
    for (const item of tela.itens ?? []) {
      if (!item.numero) continue;
      this.daTela.set(item.numero, item);
      const leitura = paraLeitura(item, compra, this.configs.get(item.numero));
      this.leituras.set(item.numero, leitura);
      this.motor.aplicarLeitura(leitura);
    }
  }

  /** Só mensagem nova entra — a tela devolve as últimas 60 a cada leitura. */
  private absorverChat(mensagens: MensagemChat[]): void {
    const vistas = new Set(this.chat.map((m) => `${m.em}|${m.autor}|${m.texto}`));
    const novas = mensagens.filter((m) => !vistas.has(`${m.em}|${m.autor}|${m.texto}`));
    if (novas.length === 0) return;
    this.chat = [...this.chat, ...novas].slice(-200);
    for (const m of novas) if (m.doPregoeiro) this.registrar("pregoeiro", m.texto);
  }

  // ---------- envio ----------

  /**
   * O lance é dado pela própria página: é lá que estão o token da sessão e o captcha.
   * Uma tentativa por decisão, sempre — repetir sozinho arriscaria lance dobrado.
   */
  private async lancar(item: string, valor: number): Promise<ResultadoLance> {
    const conteudo = this.opcoes.obterConteudo();
    if (!conteudo || conteudo.isDestroyed()) {
      return { estado: "falha", status: 0, mensagem: "a janela da sala não está aberta" };
    }

    const bruto = (await conteudo.executeJavaScript(scriptEnvio(item, valor), true)) as {
      ok?: boolean;
      aceito?: boolean;
      confirmado?: boolean;
      motivo?: string;
    } | null;

    const motivo = bruto?.motivo ?? "o portal não respondeu nada";

    if (!bruto?.ok) return { estado: "falha", status: 0, mensagem: motivo };

    if (bruto.confirmado === false) {
      // "Cliquei e não sei o que aconteceu": o pior caso. Para o item na hora, porque
      // tentar de novo poderia mandar um segundo lance por cima de um que entrou.
      this.motor.desarmar(
        item,
        `O portal não confirmou o envio (${motivo}). Robô parado neste item para não arriscar lance dobrado.`
      );
      return { estado: "falha", status: 0, mensagem: motivo };
    }

    if (bruto.aceito) return { estado: "aceito", status: 200, dados: motivo };

    const codigo = extrairCodigoRecusa(motivo);
    if (codigo) return { estado: "recusado", codigo, mensagem: motivo, status: 400 };
    // Recusa confirmada sem código conhecido: conta como falha, e três seguidas desarmam.
    return { estado: "falha", status: 400, mensagem: motivo };
  }

  // ---------- comandos do painel ----------

  configurar(numeroItem: string, mudanca: Partial<ConfigItem>): EstadoPainel {
    const atual = this.configs.get(numeroItem) ?? configVazia();
    const nova = { ...atual, ...mudanca };
    this.configs.set(numeroItem, nova);
    const daTela = this.daTela.get(numeroItem);
    if (daTela) {
      const leitura = paraLeitura(daTela, (this.cabecalho.compra ?? "").trim() || "sala", nova);
      this.leituras.set(numeroItem, leitura);
      this.motor.aplicarLeitura(leitura);
    }
    if (this.motor.estaArmado(numeroItem)) this.motor.armar(numeroItem, paraConfiguracaoMotor(nova));
    this.publicar();
    return this.estadoAtual();
  }

  armar(numeroItem: string): EstadoPainel {
    const cfg = this.configs.get(numeroItem);
    if (!cfg || cfg.pisoMinimo === null) {
      this.registrar("alerta", `Item ${numeroItem}: informe o lance mínimo antes de ligar o robô.`);
      this.publicar();
      return this.estadoAtual();
    }
    this.motor.armar(numeroItem, paraConfiguracaoMotor(cfg));
    this.publicar();
    return this.estadoAtual();
  }

  desarmar(numeroItem: string, motivo = "desligado pelo operador"): EstadoPainel {
    this.motor.desarmar(numeroItem, motivo);
    this.publicar();
    return this.estadoAtual();
  }

  async classificacao(numeroItem: string): Promise<LinhaClassificacao[]> {
    const conteudo = this.opcoes.obterConteudo();
    if (!conteudo || conteudo.isDestroyed()) return [];
    const bruto = (await conteudo.executeJavaScript(scriptClassificacao(numeroItem), true)) as {
      meuValor?: number | null;
      valores?: number[];
    } | null;

    const valores = (bruto?.valores ?? []).filter((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
    return valores.map((valor, i) => ({
      posicao: i + 1,
      // A tela da sala não mostra o nome dos concorrentes — e inventar nome seria pior
      // que admitir que não dá para saber.
      fornecedor: bruto?.meuValor === valor ? "Você" : "Concorrente",
      valor,
      eu: bruto?.meuValor === valor,
      em: null
    }));
  }

  // ---------- publicação ----------

  estadoAtual(): EstadoPainel {
    const agora = Date.now();
    const itens = [...this.daTela.keys()]
      .map((numero) => this.paraItemPainel(numero, agora))
      .sort((a, b) => a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));

    const segundos = this.cabecalho.segundosRestantes ?? null;

    return {
      disputa: {
        identificada: Boolean(this.cabecalho.naSalaDeDisputa) || itens.length > 0,
        titulo: this.cabecalho.titulo?.trim() || "Disputa",
        modalidade: "Sala de disputa do Compras.gov.br",
        numero: this.cabecalho.compra?.trim() || "—",
        uasg: this.cabecalho.uasg?.trim() || "—",
        orgao: this.cabecalho.orgao?.trim() || "—",
        tempoRestante: this.cabecalho.tempoRestante?.trim() || formatarSegundos(segundos),
        segundosRestantes: segundos,
        conexao: this.cabecalho.conexaoCaiu ? "caiu" : this.semAgente > 0 ? "instavel" : "ligada",
        origem: "rest"
      },
      itens,
      chat: this.chat,
      log: this.log,
      atualizadoEm: new Date(agora).toISOString()
    };
  }

  private paraItemPainel(numero: string, agora: number): ItemPainel {
    const daTela = this.daTela.get(numero);
    const projetado = this.motor.estadoProjetado(numero, agora);
    const cfg = this.configs.get(numero) ?? configVazia();

    return {
      numero,
      descricao: (daTela?.fase ?? "").trim() || `Item ${numero}`,
      fase: faseDaTela(daTela?.situacao),
      aceitaLance: daTela?.aberto === true,
      melhorValor: projetado?.melhorValorGeral != null ? paraNumero(projetado.melhorValorGeral) : (daTela?.melhorValor ?? null),
      meuValor: projetado?.nossoMelhorValor != null ? paraNumero(projetado.nossoMelhorValor) : (daTela?.meuValor ?? null),
      minhaPosicao: daTela?.posicao ?? null,
      participantes: daTela?.participantes ?? null,
      variacaoMinima: null,
      permitirDizima: cfg.permitirDecimais,
      segundosRestantes: projetado?.segundosRestantes ?? daTela?.segundosRestantes ?? null,
      armado: this.motor.estaArmado(numero),
      ultimaRecusa: this.motor.motivoDe(numero),
      config: cfg
    };
  }

  private registrar(nivel: NivelLog, msg: string): void {
    this.log = [...this.log, { em: new Date().toISOString(), nivel, msg }].slice(-LIMITE_LOG);
  }

  private aoEventoMotor(evento: EventoMotor): void {
    switch (evento.tipo) {
      case "enviando":
        this.registrar("proprio", `Item ${evento.item}: enviando ${formatar(evento.valor, evento.casas)}.`);
        break;
      case "aceito":
        this.registrar("sucesso", `Item ${evento.item}: ${formatar(evento.valor, evento.casas)} aceito pelo portal.`);
        break;
      case "recusado":
        this.registrar("alerta", `Item ${evento.item}: portal recusou (${evento.codigo}) — ${evento.mensagem}`);
        break;
      case "falhou":
        this.registrar("alerta", `Item ${evento.item}: falha ao enviar (${evento.seguidas}ª) — ${evento.mensagem}`);
        break;
      case "armado":
        this.registrar("sistema", `Item ${evento.item}: robô ligado.`);
        break;
      case "desarmado":
        this.registrar("alerta", `Item ${evento.item}: robô parado — ${evento.porque}`);
        break;
      case "sessao-caiu":
        this.registrar("alerta", "A sessão do portal caiu; o robô parou em todos os itens.");
        break;
      case "leitura-incompleta":
      case "aguardando":
        // Espera e lacuna de leitura aparecem no cartão do item, não no log.
        break;
    }
    this.publicar();
  }

  private publicar(): void {
    this.opcoes.aoEstado(this.estadoAtual());
  }
}

// ---------- conversões ----------

function configVazia(): ConfigItem {
  return {
    pisoMinimo: null,
    passoTipo: "fixo",
    passoValor: null,
    modo: "assumir-primeiro",
    margemPercentual: null,
    valorFechado: null,
    permitirDecimais: false,
    somenteSegundosFinais: false,
    segundosJanela: 30
  };
}

function faseDaTela(situacao: string | undefined): FaseItem {
  if (situacao === "encerrado") return "encerrado";
  if (situacao === "aberto") return "em-disputa";
  return "aguardando";
}

/**
 * Item da tela → leitura do motor.
 *
 * `permitirDizima` sai da opção do operador: aqui o lance é digitado no campo do portal,
 * e o campo é que aceita (ou não) quatro casas — por isso a conferência do valor digitado
 * no agente da página é a última palavra.
 */
function paraLeitura(item: ItemDaTela, compra: string, cfg: ConfigItem | undefined): LeituraItem {
  const melhor = lerDinheiro(item.melhorValor);
  const meu = lerDinheiro(item.meuValor);
  const camposIlegiveis: string[] = [];
  if (melhor === null) camposIlegiveis.push("melhorValorGeral");
  if (item.segundosRestantes === null || !Number.isFinite(item.segundosRestantes)) {
    camposIlegiveis.push("segundosRestantes");
  }

  return {
    estado: {
      numero: item.numero,
      aceitaLance: item.aberto === true,
      melhorValorGeral: melhor,
      nossoMelhorValor: meu,
      // A tela da sala não publica as variações mínimas do edital; sem elas o motor usa
      // o passo do operador e deixa a recusa do portal ser a autoridade.
      variacaoMinimaMelhorLance: null,
      variacaoMinimaFornecedor: null,
      permitirDizima: cfg?.permitirDecimais === true,
      posicao: typeof item.posicao === "number" && item.posicao >= 1 ? item.posicao : null,
      segundosRestantes:
        typeof item.segundosRestantes === "number" && Number.isFinite(item.segundosRestantes)
          ? item.segundosRestantes
          : null
    },
    aceitaLida: item.aberto,
    dizimaLida: cfg?.permitirDecimais === true,
    fase: item.fase?.trim() || item.situacao || "sala",
    compra,
    descricao: item.fase?.trim() || null,
    recebidoEm: Date.now(),
    camposIlegiveis
  };
}

// ---------- scripts executados na página da sala ----------

/**
 * Lê a tela inteira numa ida só. Devolve apenas dados simples: nó de DOM não atravessa
 * a ponte, e `lerCartao` devolve um (`cartao`) que fica de fora de propósito.
 */
const SCRIPT_LEITURA = `(() => {
  const b = window.__lancebot;
  if (!b) return { ausente: true };
  let disputa = null;
  try { disputa = b.identificarDisputa(); } catch (e) { disputa = null; }

  const itens = [];
  try {
    b.cartoes().forEach((cartao) => {
      let i = null;
      try { i = b.lerCartao(cartao); } catch (e) { i = null; }
      if (!i || !i.numero) return;
      const linha = {
        numero: String(i.numero),
        melhorValor: typeof i.melhorValor === "number" ? i.melhorValor : null,
        meuValor: typeof i.meuValor === "number" ? i.meuValor : null,
        aberto: Boolean(i.aberto),
        situacao: String(i.situacao || ""),
        fase: String(i.fase || ""),
        segundosRestantes: typeof i.segundosRestantes === "number" ? i.segundosRestantes : null,
        posicao: null,
        participantes: null
      };
      if (linha.aberto) {
        try {
          const c = b.classificacao(linha.numero);
          linha.posicao = typeof c.posicao === "number" ? c.posicao : null;
          linha.participantes = typeof c.total === "number" ? c.total : null;
        } catch (e) { /* classificação é extra, não bloqueia a leitura */ }
      }
      itens.push(linha);
    });
  } catch (e) { /* sem cartões legíveis nesta passada */ }

  let chat = [];
  try { chat = b.chat() || []; } catch (e) { chat = []; }

  return { ausente: false, disputa: disputa, itens: itens, chat: chat };
})()`;

function scriptEnvio(item: string, valor: number): string {
  return `(async () => {
  const b = window.__lancebot;
  if (!b) return { ok: false, motivo: "o leitor do robô não está ativo nesta página" };
  const i = b.acharItem(${JSON.stringify(item)});
  if (!i) return { ok: false, motivo: "o item ${item} não está visível na sala" };
  try {
    return await b.enviarLance(i, ${JSON.stringify(valor)});
  } catch (e) {
    return { ok: false, motivo: String((e && e.message) || e) };
  }
})()`;
}

function scriptClassificacao(item: string): string {
  return `(() => {
  const b = window.__lancebot;
  if (!b) return null;
  try { return b.classificacao(${JSON.stringify(item)}); } catch (e) { return null; }
})()`;
}
