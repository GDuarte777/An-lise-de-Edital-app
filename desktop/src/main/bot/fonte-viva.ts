/**
 * A disputa de verdade, no formato que o painel já sabe desenhar.
 *
 * Junta as três peças prontas — cliente STOMP (estado empurrado), adapter REST (carga
 * inicial, classificação e envio) e motor (decisão) — e publica `EstadoPainel`. É a troca
 * da `demonstracao.ts` pela disputa real, com o mesmo contrato, de propósito: a tela não
 * muda de ideia só porque a fonte passou a ser o portal.
 *
 * O que ainda está marcado [inferido] são os nomes dos tópicos STOMP. Eles estão numa
 * tabela só (`TOPICOS`), como os nomes de campo em `eventos.ts`: a primeira captura de
 * disputa real corrige a tabela, e nada mais no código precisa mudar.
 */
import { formatarSegundos, type ConfigItem, type DisputaPainel, type EstadoPainel, type EventoLog, type FaseItem, type ItemPainel, type LinhaClassificacao, type MensagemChat, type NivelLog } from "../../compartilhado/painel.js";
import { formatar, paraNumero } from "./decimal.js";
import { normalizarItem, normalizarItens, lerDinheiro, type LeituraItem } from "./eventos.js";
import type { ConfiguracaoDisputa } from "./estrategias.js";
import { Motor, type EventoMotor } from "./motor.js";
import type { PortalRest } from "./rest/portal.js";
import type { ClienteStomp, EventoStomp } from "./stomp/cliente.js";
import type { Quadro } from "./stomp/quadros.js";
import { TEMPORIZADOR_REAL, type Temporizador } from "./tempo.js";

/** [inferido] Tópicos da disputa. `{compra}` é trocado pelo número da compra. */
export const TOPICOS = {
  itens: "/topic/disputa/{compra}/itens",
  lances: "/topic/disputa/{compra}/lances",
  chat: "/topic/mensagem/{compra}",
  avisos: "/topic/disputa/{compra}/avisos"
} as const;

const LIMITE_LOG = 300;
const LIMITE_CHAT = 200;

export interface OpcoesFonteViva {
  compra: string;
  cliente: ClienteStomp;
  portal: PortalRest;
  /** Identificação da compra para o cabeçalho do painel. Só texto, nada de decisão. */
  cabecalho?: Partial<Pick<DisputaPainel, "titulo" | "modalidade" | "numero" | "uasg" | "orgao">>;
  temporizador?: Temporizador;
}

export class FonteViva {
  private readonly tempo: Temporizador;
  private readonly motor: Motor;
  private readonly ouvintes = new Set<(e: EstadoPainel) => void>();
  private readonly cancelamentos: (() => void)[] = [];

  private readonly configs = new Map<string, ConfigItem>();
  private readonly leituras = new Map<string, LeituraItem>();
  private readonly descricoes = new Map<string, string>();
  private readonly fases = new Map<string, FaseItem>();
  private chat: MensagemChat[] = [];
  private log: EventoLog[] = [];
  private conexao: DisputaPainel["conexao"] = "caiu";
  private origem: DisputaPainel["origem"] = "websocket";

  constructor(private readonly opcoes: OpcoesFonteViva) {
    this.tempo = opcoes.temporizador ?? TEMPORIZADOR_REAL;
    this.motor = new Motor({
      lancador: (pedido) => opcoes.portal.enviarLance(pedido),
      temporizador: this.tempo,
      aoEvento: (e) => this.aoEventoMotor(e)
    });

    this.cancelamentos.push(
      opcoes.cliente.assinar(this.topico(TOPICOS.itens), (q) => this.aoQuadroItens(q)),
      opcoes.cliente.assinar(this.topico(TOPICOS.lances), (q) => this.aoQuadroItens(q)),
      opcoes.cliente.assinar(this.topico(TOPICOS.chat), (q) => this.aoQuadroChat(q)),
      opcoes.cliente.assinar(this.topico(TOPICOS.avisos), (q) => this.aoQuadroChat(q))
    );
  }

  private topico(padrao: string): string {
    return padrao.replace("{compra}", this.opcoes.compra);
  }

  /** Chamado pelo dono da fonte quando o cliente STOMP muda de estado. */
  aoEventoConexao(evento: EventoStomp): void {
    if (evento.tipo === "conectado") {
      this.conexao = "ligada";
      this.origem = "websocket";
      this.registrar("sucesso", "Conectado ao canal de disputa do portal.");
    } else if (evento.tipo === "desconectado") {
      this.conexao = evento.reconectarEmMs === null ? "caiu" : "instavel";
      this.registrar("alerta", `Canal de disputa caiu: ${evento.motivo}.`);
    } else if (evento.tipo === "erro-servidor") {
      this.registrar("alerta", `Portal recusou o canal: ${evento.mensagem}.`);
    } else if (evento.tipo === "pulso-perdido") {
      this.conexao = "instavel";
    }
    this.publicar();
  }

  /** Carga inicial por REST: o socket só manda o que mudar depois que a gente entrou. */
  async cargaInicial(): Promise<void> {
    const r = await this.opcoes.portal.ler("itensAguardandoDisputa", { compra: this.opcoes.compra });
    if (r.estado === "ok") {
      this.origem = this.conexao === "ligada" ? "websocket" : "rest";
      for (const leitura of normalizarItens(r.dados, { agora: this.tempo.agora() })) {
        this.absorver(leitura);
      }
      this.registrar("sistema", "Carga inicial dos itens feita por REST.");
    } else if (r.estado === "sem-captcha") {
      this.registrar(
        "alerta",
        "A leitura inicial precisa do captcha da sua janela do portal. Abra a sala de disputa para liberar."
      );
    } else if (r.estado === "sessao-caiu") {
      this.motor.sessaoCaiu();
      this.registrar("alerta", "Sessão do portal caiu. Refaça o login para continuar.");
    } else {
      this.registrar("alerta", `Carga inicial falhou (${r.status}): ${r.mensagem}`);
    }
    this.publicar();
  }

  // ---------- entrada de dados ----------

  private aoQuadroItens(quadro: Quadro): void {
    const dados = corpoJson(quadro);
    if (dados === undefined) return;
    const agora = this.tempo.agora();
    const lista = Array.isArray(dados) || temLista(dados)
      ? normalizarItens(dados, { agora })
      : [normalizarItem(dados, { agora })].flatMap((l) => (l ? [l] : []));
    if (lista.length === 0) {
      this.registrar("alerta", "Chegou mensagem de item que não pôde ser lida.");
      this.publicar();
      return;
    }
    for (const leitura of lista) this.absorver(leitura);
    this.publicar();
  }

  private aoQuadroChat(quadro: Quadro): void {
    const dados = corpoJson(quadro);
    const mensagens = extrairMensagens(dados);
    if (mensagens.length === 0) return;
    this.chat = [...this.chat, ...mensagens].slice(-LIMITE_CHAT);
    for (const m of mensagens) {
      if (m.doPregoeiro) this.registrar("pregoeiro", m.texto);
    }
    this.publicar();
  }

  /** Guarda a leitura e empurra para o motor, já com a opção de decimais do operador. */
  private absorver(leitura: LeituraItem): void {
    const numero = leitura.estado.numero;
    this.leituras.set(numero, leitura);
    this.fases.set(numero, faseDe(leitura));
    this.motor.aplicarLeitura(this.compor(numero, leitura));
  }

  /**
   * A opção "permitir lances em casas decimais" só pode reduzir o que o portal permite:
   * sem dízima no item, 4 casas não existem; com dízima, quem decide brigar no centavo é
   * o operador.
   */
  private compor(numero: string, leitura: LeituraItem): LeituraItem {
    const cfg = this.configs.get(numero);
    const permitir = leitura.estado.permitirDizima && cfg?.permitirDecimais === true;
    if (permitir === leitura.estado.permitirDizima) return leitura;
    return { ...leitura, estado: { ...leitura.estado, permitirDizima: permitir } };
  }

  // ---------- comandos do painel ----------

  configurar(numeroItem: string, mudanca: Partial<ConfigItem>): void {
    const atual = this.configs.get(numeroItem) ?? padraoDe(mudanca);
    const nova = { ...atual, ...mudanca };
    this.configs.set(numeroItem, nova);
    if (this.motor.estaArmado(numeroItem)) this.rearmar(numeroItem, nova);
    this.publicar();
  }

  armar(numeroItem: string): void {
    const cfg = this.configs.get(numeroItem);
    if (!cfg) {
      this.registrar("alerta", `Item ${numeroItem} sem configuração: defina o lance mínimo antes de armar.`);
      this.publicar();
      return;
    }
    this.rearmar(numeroItem, cfg);
    this.publicar();
  }

  desarmar(numeroItem: string, motivo = "desarmado pelo operador"): void {
    this.motor.desarmar(numeroItem, motivo);
    this.publicar();
  }

  private rearmar(numeroItem: string, cfg: ConfigItem): void {
    const leitura = this.leituras.get(numeroItem);
    if (leitura) this.motor.aplicarLeitura(this.compor(numeroItem, leitura));
    this.motor.armar(numeroItem, paraConfiguracaoMotor(cfg));
  }

  /** Classificação do item. O que não der para ler não entra na lista. */
  async classificacao(numeroItem: string): Promise<LinhaClassificacao[]> {
    const r = await this.opcoes.portal.ler("lancesPorParticipante", {
      compra: this.opcoes.compra,
      item: numeroItem
    });
    if (r.estado !== "ok") {
      this.registrar(
        "alerta",
        r.estado === "sem-captcha"
          ? "A classificação precisa do captcha da sua janela do portal."
          : `Não foi possível ler a classificação do item ${numeroItem}.`
      );
      this.publicar();
      return [];
    }
    return extrairClassificacao(r.dados);
  }

  // ---------- publicação ----------

  estadoAtual(): EstadoPainel {
    const agora = this.tempo.agora();
    const itens = [...this.leituras.values()]
      .map((leitura) => this.paraItemPainel(leitura, agora))
      .sort((a, b) => a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));

    const emDisputa = itens.filter((i) => i.fase === "em-disputa" && i.segundosRestantes !== null);
    const menor = emDisputa.length
      ? Math.min(...emDisputa.map((i) => i.segundosRestantes as number))
      : null;

    return {
      disputa: {
        identificada: true,
        titulo: this.opcoes.cabecalho?.titulo ?? `Disputa ${this.opcoes.compra}`,
        modalidade: this.opcoes.cabecalho?.modalidade ?? "Pregão eletrônico",
        numero: this.opcoes.cabecalho?.numero ?? this.opcoes.compra,
        uasg: this.opcoes.cabecalho?.uasg ?? "—",
        orgao: this.opcoes.cabecalho?.orgao ?? "—",
        tempoRestante: formatarSegundos(menor),
        segundosRestantes: menor,
        conexao: this.conexao,
        origem: this.origem
      },
      itens,
      chat: this.chat,
      log: this.log,
      atualizadoEm: new Date(agora).toISOString()
    };
  }

  assinar(ouvinte: (e: EstadoPainel) => void): () => void {
    this.ouvintes.add(ouvinte);
    ouvinte(this.estadoAtual());
    return () => this.ouvintes.delete(ouvinte);
  }

  encerrar(): void {
    this.motor.pararTudo("painel encerrado");
    for (const cancelar of this.cancelamentos) cancelar();
    this.cancelamentos.length = 0;
    this.ouvintes.clear();
  }

  private paraItemPainel(leitura: LeituraItem, agora: number): ItemPainel {
    const numero = leitura.estado.numero;
    const projetado = this.motor.estadoProjetado(numero, agora) ?? leitura.estado;
    const cfg = this.configs.get(numero) ?? padraoDe({});
    return {
      numero,
      descricao: this.descricoes.get(numero) ?? `Item ${numero}`,
      fase: this.fases.get(numero) ?? "aguardando",
      aceitaLance: projetado.aceitaLance,
      melhorValor: projetado.melhorValorGeral === null ? null : paraNumero(projetado.melhorValorGeral),
      meuValor: projetado.nossoMelhorValor === null ? null : paraNumero(projetado.nossoMelhorValor),
      minhaPosicao: null,
      participantes: null,
      variacaoMinima:
        projetado.variacaoMinimaMelhorLance === null ? null : paraNumero(projetado.variacaoMinimaMelhorLance),
      permitirDizima: leitura.estado.permitirDizima,
      segundosRestantes: projetado.segundosRestantes,
      armado: this.motor.estaArmado(numero),
      ultimaRecusa: this.motor.motivoDe(numero),
      config: cfg
    };
  }

  private registrar(nivel: NivelLog, msg: string): void {
    this.log = [...this.log, { em: new Date(this.tempo.agora()).toISOString(), nivel, msg }].slice(-LIMITE_LOG);
  }

  private aoEventoMotor(evento: EventoMotor): void {
    switch (evento.tipo) {
      case "enviando":
        this.registrar("proprio", `Item ${evento.item}: enviando ${formatar(evento.valor, evento.casas)}.`);
        break;
      case "aceito":
        this.registrar("sucesso", `Item ${evento.item}: lance de ${formatar(evento.valor, evento.casas)} aceito.`);
        break;
      case "recusado":
        this.registrar("alerta", `Item ${evento.item}: portal recusou (${evento.codigo}) — ${evento.mensagem}`);
        break;
      case "falhou":
        this.registrar("alerta", `Item ${evento.item}: falha ao enviar (${evento.seguidas}ª) — ${evento.mensagem}`);
        break;
      case "desarmado":
        this.registrar("alerta", `Item ${evento.item}: robô desarmado — ${evento.porque}`);
        break;
      case "armado":
        this.registrar("sistema", `Item ${evento.item}: robô armado.`);
        break;
      case "sessao-caiu":
        this.registrar("alerta", "Sessão do portal caiu; o robô parou em todos os itens.");
        break;
      case "leitura-incompleta":
        this.registrar(
          "alerta",
          `Item ${evento.item}: o portal não informou ${evento.campos.join(", ")}. O robô não chuta valor.`
        );
        break;
      case "aguardando":
        // Espera é o estado normal; vai no cartão do item, não no log.
        break;
    }
    this.publicar();
  }

  private publicar(): void {
    if (this.ouvintes.size === 0) return;
    const estado = this.estadoAtual();
    for (const ouvinte of this.ouvintes) ouvinte(estado);
  }
}

// ---------- tradução de formatos ----------

/** `ConfigItem` (da tela, com campos vazios) → configuração do motor. */
export function paraConfiguracaoMotor(cfg: ConfigItem): ConfiguracaoDisputa {
  return {
    modo: cfg.modo,
    // Piso vazio vira 0 de propósito: o motor recusa com CONFIG_INVALIDA e o operador lê
    // o motivo, em vez de o robô assumir um piso que ninguém escreveu.
    pisoMinimo: cfg.pisoMinimo ?? 0,
    passo:
      cfg.passoValor === null || cfg.passoValor <= 0
        ? undefined
        : { tipo: cfg.passoTipo, valor: cfg.passoValor },
    margemPercentual: cfg.margemPercentual ?? undefined,
    valorFechado: cfg.valorFechado ?? undefined,
    janelaFinal: { ativo: cfg.somenteSegundosFinais, segundos: cfg.segundosJanela }
  };
}

function padraoDe(mudanca: Partial<ConfigItem>): ConfigItem {
  return {
    pisoMinimo: null,
    passoTipo: "fixo",
    passoValor: null,
    modo: "assumir-primeiro",
    margemPercentual: null,
    valorFechado: null,
    permitirDecimais: false,
    somenteSegundosFinais: false,
    segundosJanela: 30,
    ...mudanca
  };
}

function faseDe(leitura: LeituraItem): FaseItem {
  const texto = (leitura.fase ?? "").toLowerCase();
  if (/encerrad|fechad|finalizad|homologad|adjudicad|cancelad/.test(texto)) return "encerrado";
  if (leitura.estado.aceitaLance) return "em-disputa";
  if (/aguardando|nao.?inicia|não.?inicia/.test(texto)) return "aguardando";
  return leitura.estado.segundosRestantes === null ? "aguardando" : "em-disputa";
}

function corpoJson(quadro: Quadro): unknown {
  const corpo = quadro.corpo.trim();
  if (!corpo) return undefined;
  try {
    return JSON.parse(corpo);
  } catch {
    return undefined;
  }
}

function temLista(dados: unknown): boolean {
  if (!dados || typeof dados !== "object") return false;
  const o = dados as Record<string, unknown>;
  return Array.isArray(o.itens) || Array.isArray(o.content);
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** Mensagens de chat: aceita uma só ou lista, e descarta o que não tiver texto. */
export function extrairMensagens(dados: unknown): MensagemChat[] {
  const lista = Array.isArray(dados)
    ? dados
    : dados && typeof dados === "object" && Array.isArray((dados as Record<string, unknown>).mensagens)
      ? ((dados as Record<string, unknown>).mensagens as unknown[])
      : dados && typeof dados === "object"
        ? [dados]
        : [];

  return lista.flatMap((cru) => {
    if (!cru || typeof cru !== "object") return [];
    const o = cru as Record<string, unknown>;
    const corpo = texto(o.texto) ?? texto(o.mensagem) ?? texto(o.conteudo) ?? texto(o.descricao);
    if (!corpo) return [];
    const autor = texto(o.autor) ?? texto(o.remetente) ?? texto(o.nome) ?? "Portal";
    const quando = texto(o.dataHora) ?? texto(o.data) ?? texto(o.em);
    const doPregoeiro =
      o.doPregoeiro === true || /pregoeir|agente.?de.?contrata|sistema/i.test(autor);
    return [
      {
        em: quando ?? new Date().toISOString(),
        autor,
        texto: corpo,
        doPregoeiro
      }
    ];
  });
}

/** Classificação: posição, fornecedor e valor. Linha sem valor legível é descartada. */
export function extrairClassificacao(dados: unknown): LinhaClassificacao[] {
  const lista = Array.isArray(dados)
    ? dados
    : dados && typeof dados === "object" && Array.isArray((dados as Record<string, unknown>).content)
      ? ((dados as Record<string, unknown>).content as unknown[])
      : [];

  const linhas = lista.flatMap((cru) => {
    if (!cru || typeof cru !== "object") return [];
    const o = cru as Record<string, unknown>;
    const micro = lerDinheiro(o.valorLance ?? o.valor ?? o.melhorLance);
    if (micro === null) return [];
    const posicaoCrua = o.posicao ?? o.classificacao ?? o.ordem;
    return [
      {
        posicao: typeof posicaoCrua === "number" && Number.isFinite(posicaoCrua) ? posicaoCrua : 0,
        fornecedor:
          texto(o.fornecedor) ?? texto(o.razaoSocial) ?? texto(o.nomeFornecedor) ?? "Fornecedor não identificado",
        valor: paraNumero(micro),
        eu: o.meuLance === true || o.proprio === true || o.eu === true,
        em: texto(o.dataHora) ?? texto(o.data)
      }
    ];
  });

  // Sem posição informada, a ordem é o próprio preço — menor primeiro.
  if (linhas.every((l) => l.posicao === 0)) {
    linhas.sort((a, b) => a.valor - b.valor);
    linhas.forEach((l, i) => (l.posicao = i + 1));
  } else {
    linhas.sort((a, b) => a.posicao - b.posicao);
  }
  return linhas;
}
