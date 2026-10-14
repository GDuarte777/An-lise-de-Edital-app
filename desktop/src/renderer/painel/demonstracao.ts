/**
 * Disputa de demonstração.
 *
 * Existe por dois motivos honestos: dá para julgar o desenho da tela sem esperar um
 * pregão de verdade, e dá para ver o motor decidindo — porque quem decide aqui é o
 * `decidir()` real de `main/bot/estrategias`, não um roteiro. Se o piso recusar um
 * lance na demonstração, é a mesma função que vai recusar na disputa.
 *
 * O estado sai marcado como `origem: "demonstracao"` e a tela mostra isso em destaque.
 * Nenhuma requisição sai da máquina.
 */

import { paraMicro, paraNumero } from "../../main/bot/decimal.js";
import { decidir, type EstadoItem } from "../../main/bot/estrategias.js";
import {
  configPadrao,
  formatarSegundos,
  type ComandosPainel,
  type EstadoPainel,
  type EventoLog,
  type FontePainel,
  type ItemPainel,
  type LinhaClassificacao
} from "../../compartilhado/painel.js";

const CONCORRENTES = ["COMERCIAL ALFA LTDA", "SUPRI BRASIL ME", "DISTRIB. HORIZONTE", "NORDESTE SUPRIMENTOS"];

function item(
  numero: string,
  descricao: string,
  fase: ItemPainel["fase"],
  melhor: number | null,
  extra: Partial<ItemPainel> = {}
): ItemPainel {
  return {
    numero,
    descricao,
    fase,
    aceitaLance: fase === "em-disputa",
    melhorValor: melhor,
    meuValor: null,
    minhaPosicao: null,
    participantes: 4,
    variacaoMinima: 0.01,
    permitirDizima: false,
    segundosRestantes: fase === "em-disputa" ? 420 : null,
    armado: false,
    ultimaRecusa: null,
    config: configPadrao(),
    ...extra
  };
}

export function criarDemonstracao(): FontePainel {
  const ouvintes = new Set<(e: EstadoPainel) => void>();
  const log: EventoLog[] = [];
  const historico = new Map<string, LinhaClassificacao[]>();

  const registrar = (nivel: EventoLog["nivel"], msg: string) => {
    log.push({ em: new Date().toISOString(), nivel, msg });
    if (log.length > 200) log.shift();
  };

  const estado: EstadoPainel = {
    disputa: {
      identificada: true,
      titulo: "Pregão Eletrônico nº 90012/2026",
      modalidade: "Pregão Eletrônico",
      numero: "90012/2026",
      uasg: "160083",
      orgao: "Comando do Exército — 4ª Região Militar",
      tempoRestante: "00:07:00",
      segundosRestantes: 420,
      conexao: "ligada",
      origem: "demonstracao"
    },
    itens: [
      item("1", "Cartucho de toner preto, 12.000 páginas", "em-disputa", 489.9, {
        config: { ...configPadrao(), pisoMinimo: 430, passoValor: 0.5 }
      }),
      item("2", "Papel A4 75g, resma 500 folhas", "em-disputa", 24.78, {
        permitirDizima: true,
        config: { ...configPadrao(), pisoMinimo: 22, passoValor: 0.01, permitirDecimais: true }
      }),
      item("3", "Cadeira giratória com apoio lombar", "aguardando", null),
      item("4", "Monitor LED 24 polegadas", "encerrado", 712.4, { meuValor: 712.4, minhaPosicao: 1 })
    ],
    chat: [
      {
        em: new Date(Date.now() - 180_000).toISOString(),
        autor: "Pregoeiro",
        texto: "Bom dia. A fase de lances do item 1 está aberta.",
        doPregoeiro: true
      }
    ],
    log,
    atualizadoEm: new Date().toISOString()
  };

  registrar("sistema", "Modo demonstração: nenhum lance sai desta máquina.");

  const emitir = () => {
    estado.atualizadoEm = new Date().toISOString();
    const copia: EstadoPainel = { ...estado, itens: estado.itens.map((i) => ({ ...i })), log: [...log] };
    for (const o of ouvintes) o(copia);
  };

  const anotarClassificacao = (numero: string, valor: number, fornecedor: string, eu: boolean) => {
    const linhas = historico.get(numero) ?? [];
    linhas.push({ posicao: 0, fornecedor, valor, eu, em: new Date().toISOString() });
    linhas.sort((a, b) => a.valor - b.valor);
    linhas.forEach((l, idx) => (l.posicao = idx + 1));
    historico.set(numero, linhas.slice(0, 20));
  };

  /** Um ciclo do relógio: tempo corre, concorrente reage, nosso motor decide. */
  const tique = () => {
    if (estado.disputa.segundosRestantes !== null && estado.disputa.segundosRestantes > 0) {
      estado.disputa.segundosRestantes--;
      estado.disputa.tempoRestante = formatarSegundos(estado.disputa.segundosRestantes);
    }

    for (const it of estado.itens) {
      if (it.fase !== "em-disputa") continue;
      if (it.segundosRestantes !== null && it.segundosRestantes > 0) it.segundosRestantes--;

      // Concorrente cobre de vez em quando.
      if (it.melhorValor !== null && Math.random() < 0.08) {
        const corte = it.permitirDizima ? 0.01 : 0.5;
        const novo = Number((it.melhorValor - corte).toFixed(it.permitirDizima ? 4 : 2));
        if (novo > 0) {
          const quem = CONCORRENTES[Math.floor(Math.random() * CONCORRENTES.length)]!;
          it.melhorValor = novo;
          it.minhaPosicao = it.meuValor !== null && it.meuValor <= novo ? 1 : (it.minhaPosicao ?? 2) + 0;
          anotarClassificacao(it.numero, novo, quem, false);
          registrar("concorrente", `Item ${it.numero}: ${quem} ofertou R$ ${novo.toFixed(2)}.`);
        }
      }

      if (!it.armado) continue;

      const leitura: EstadoItem = {
        numero: it.numero,
        aceitaLance: it.aceitaLance,
        melhorValorGeral: it.melhorValor === null ? null : paraMicro(it.melhorValor),
        nossoMelhorValor: it.meuValor === null ? null : paraMicro(it.meuValor),
        variacaoMinimaMelhorLance: it.variacaoMinima === null ? null : paraMicro(it.variacaoMinima),
        variacaoMinimaFornecedor: null,
        permitirDizima: it.config.permitirDecimais || it.permitirDizima,
        segundosRestantes: it.segundosRestantes
      };

      const decisao = decidir(leitura, {
        modo: it.config.modo,
        pisoMinimo: it.config.pisoMinimo ?? 0,
        passo:
          it.config.passoValor === null
            ? undefined
            : { tipo: it.config.passoTipo, valor: it.config.passoValor },
        margemPercentual: it.config.margemPercentual ?? undefined,
        valorFechado: it.config.valorFechado ?? undefined,
        janelaFinal: { ativo: it.config.somenteSegundosFinais, segundos: it.config.segundosJanela }
      });

      if (decisao.acao === "enviar") {
        const valor = paraNumero(decisao.valor);
        it.meuValor = valor;
        it.melhorValor = valor;
        it.minhaPosicao = 1;
        it.ultimaRecusa = null;
        anotarClassificacao(it.numero, valor, "VOCÊ", true);
        registrar("sucesso", `Item ${it.numero}: lance de R$ ${valor.toFixed(2)} aceito (simulado).`);
      } else if (decisao.acao === "parar") {
        it.armado = false;
        it.ultimaRecusa = decisao.porque;
        registrar("alerta", `Item ${it.numero} desarmado — ${decisao.codigo}: ${decisao.porque}`);
      }
    }

    if (Math.random() < 0.01) {
      estado.chat.push({
        em: new Date().toISOString(),
        autor: "Pregoeiro",
        texto: "Senhores fornecedores, atentem-se ao prazo de encerramento.",
        doPregoeiro: true
      });
      if (estado.chat.length > 80) estado.chat.shift();
    }

    emitir();
  };

  const timer = setInterval(tique, 1000);

  const comandos: ComandosPainel = {
    configurar(numero, mudanca) {
      const it = estado.itens.find((i) => i.numero === numero);
      if (!it) return;
      it.config = { ...it.config, ...mudanca };
      emitir();
    },
    armar(numero) {
      const it = estado.itens.find((i) => i.numero === numero);
      if (!it) return;
      if (it.config.pisoMinimo === null || it.config.pisoMinimo <= 0) {
        it.ultimaRecusa = "Informe o lance mínimo (R$) antes de ligar o robô.";
        emitir();
        return;
      }
      it.armado = true;
      it.ultimaRecusa = null;
      registrar("sistema", `Item ${numero}: robô ligado — ${it.config.modo}, piso R$ ${it.config.pisoMinimo.toFixed(2)}.`);
      emitir();
    },
    desarmar(numero, motivo) {
      const it = estado.itens.find((i) => i.numero === numero);
      if (!it) return;
      it.armado = false;
      registrar("sistema", motivo ?? `Item ${numero}: robô desligado pelo operador.`);
      emitir();
    },
    async classificacao(numero) {
      return historico.get(numero) ?? [];
    }
  };

  return {
    estadoAtual: () => ({ ...estado, itens: estado.itens.map((i) => ({ ...i })), log: [...log] }),
    assinar(ouvinte) {
      ouvintes.add(ouvinte);
      ouvinte(this.estadoAtual());
      return () => ouvintes.delete(ouvinte);
    },
    comandos,
    encerrar: () => clearInterval(timer)
  };
}
