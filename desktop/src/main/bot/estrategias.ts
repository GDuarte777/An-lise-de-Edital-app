/**
 * Motor de decisão do lance.
 *
 * Cinco modos de disputa, uma única porta de saída. Todo modo calcula um valor-alvo e
 * entrega para a mesma função `validar`, que é a dona do dinheiro: piso do operador e as
 * duas variações mínimas do edital. Nenhum modo envia nada por conta própria.
 *
 * Os códigos de recusa são os mesmos nomes que o portal usa nas respostas
 * (ULTRAPASSA_VALOR_MINIMO, NAO_RESPEITA_VARIACAO_*), de propósito: quando o robô recusa
 * um lance, o operador lê a mesma palavra que leria se tivesse ofertado na mão e levado a
 * recusa do Compras.gov.br.
 */

import {
  type Casas,
  type Micro,
  acrescerPercentual,
  formatar,
  paraMicro,
  reduzirPercentual,
  truncar
} from "./decimal.js";
import { avaliarJanela, type JanelaFinal } from "./relogio.js";

export type ModoDisputa = "assumir-primeiro" | "posicionar" | "manter" | "margem" | "fechado";

export type CodigoRecusa =
  | "ULTRAPASSA_VALOR_MINIMO"
  | "NAO_RESPEITA_VARIACAO_MELHOR_LANCE"
  | "NAO_RESPEITA_VARIACAO_FORNECEDOR"
  | "ITEM_NAO_ACEITA_LANCE"
  | "LEITURA_INVALIDA"
  | "CONFIG_INVALIDA";

/** Tudo que o robô sabe do item neste instante. `null` significa "não li", nunca "zero". */
export interface EstadoItem {
  numero: string;
  aceitaLance: boolean;
  /** Menor lance válido do item, de qualquer fornecedor. */
  melhorValorGeral: Micro | null;
  /** Nosso melhor lance já registrado no item. */
  nossoMelhorValor: Micro | null;
  /** Redução mínima exigida pelo edital em relação ao melhor lance. */
  variacaoMinimaMelhorLance: Micro | null;
  /** Redução mínima exigida em relação ao nosso próprio lance anterior. */
  variacaoMinimaFornecedor: Micro | null;
  /** Item que aceita dízima opera em 4 casas; o resto, 2. */
  permitirDizima: boolean;
  /**
   * Nossa posição no item, quando dá para saber. Existe por causa do empate: com valores
   * iguais, o portal classifica na frente quem lançou primeiro. Empatar em 1º é posição
   * boa; empatar em 2º é estar atrás com o mesmo número na tela.
   */
  posicao: number | null;
  segundosRestantes: number | null;
}

export interface PassoOperador {
  tipo: "fixo" | "percentual";
  /** Reais (fixo) ou pontos percentuais (percentual). */
  valor: number;
}

export interface ConfiguracaoDisputa {
  modo: ModoDisputa;
  /** Menor valor que o operador aceita receber. O robô nunca desce abaixo disto. */
  pisoMinimo: number;
  passo?: PassoOperador;
  /** Só no modo "margem": percentual acima do melhor valor que ele aceita manter. */
  margemPercentual?: number;
  /** Só no modo "fechado": o valor único a ofertar. */
  valorFechado?: number;
  janelaFinal?: JanelaFinal;
}

export type Decisao =
  | { acao: "enviar"; valor: Micro; casas: Casas; porque: string }
  | { acao: "aguardar"; porque: string }
  | { acao: "parar"; codigo: CodigoRecusa; porque: string };

/** Um centavo em micro-unidades: o passo do desempate. */
const CENTAVO = 100n;

/** Modos cujo objetivo é ficar na frente — os únicos em que liderar significa parar. */
const MODOS_PARA_VENCER: ModoDisputa[] = ["assumir-primeiro", "posicionar", "manter"];

function casasDoItem(item: EstadoItem): Casas {
  return item.permitirDizima ? 4 : 2;
}

/**
 * A porta única. Recebe um alvo já calculado e decide se ele pode sair.
 *
 * `permitirAcimaDoMelhor` existe só para o modo margem, onde ofertar acima do melhor
 * valor é o objetivo declarado (segurar posição dentro de uma faixa, não vencer).
 */
export function validar(
  alvo: Micro,
  item: EstadoItem,
  pisoMinimo: Micro,
  casas: Casas,
  permitirAcimaDoMelhor = false
): Decisao {
  const valor = truncar(alvo, casas);

  if (valor <= 0n) {
    return {
      acao: "parar",
      codigo: "LEITURA_INVALIDA",
      porque: `O cálculo resultou em ${formatar(valor, casas)}, que não é lance válido.`
    };
  }

  if (valor < pisoMinimo) {
    return {
      acao: "parar",
      codigo: "ULTRAPASSA_VALOR_MINIMO",
      porque:
        `O lance precisaria ser ${formatar(valor, casas)}, abaixo do seu piso de ` +
        `${formatar(pisoMinimo, casas)}. Robô parado para proteger a margem.`
    };
  }

  if (item.melhorValorGeral !== null && !permitirAcimaDoMelhor) {
    if (valor >= item.melhorValorGeral) {
      return {
        acao: "aguardar",
        porque:
          `${formatar(valor, casas)} não melhora o melhor lance atual ` +
          `(${formatar(item.melhorValorGeral, casas)}).`
      };
    }
    const reducao = item.melhorValorGeral - valor;
    const exigida = item.variacaoMinimaMelhorLance;
    if (exigida !== null && exigida > 0n && reducao < exigida) {
      return {
        acao: "parar",
        codigo: "NAO_RESPEITA_VARIACAO_MELHOR_LANCE",
        porque:
          `O edital exige reduzir ao menos ${formatar(exigida, casas)} sobre o melhor lance; ` +
          `o cálculo reduziu só ${formatar(reducao, casas)}.`
      };
    }
  }

  if (item.nossoMelhorValor !== null) {
    if (valor >= item.nossoMelhorValor) {
      return {
        acao: "aguardar",
        porque:
          `Nosso lance atual (${formatar(item.nossoMelhorValor, casas)}) já é igual ou melhor ` +
          `que ${formatar(valor, casas)}.`
      };
    }
    const reducaoPropria = item.nossoMelhorValor - valor;
    const exigidaPropria = item.variacaoMinimaFornecedor;
    if (exigidaPropria !== null && exigidaPropria > 0n && reducaoPropria < exigidaPropria) {
      return {
        acao: "parar",
        codigo: "NAO_RESPEITA_VARIACAO_FORNECEDOR",
        porque:
          `O edital exige reduzir ao menos ${formatar(exigidaPropria, casas)} sobre o seu próprio ` +
          `lance; o cálculo reduziu só ${formatar(reducaoPropria, casas)}.`
      };
    }
  }

  return { acao: "enviar", valor, casas, porque: `Lance calculado: ${formatar(valor, casas)}.` };
}

/** Desconto do operador aplicado a um valor de referência. */
function aplicarPasso(base: Micro, passo: PassoOperador | undefined): Micro {
  if (!passo) return base;
  if (passo.tipo === "percentual") return reduzirPercentual(base, passo.valor);
  return base - paraMicro(passo.valor);
}

/** O maior entre o passo do operador e a variação mínima do edital. */
function alvoBatendoMelhor(item: EstadoItem, passo: PassoOperador | undefined): Micro | null {
  if (item.melhorValorGeral === null) return null;
  const porPasso = aplicarPasso(item.melhorValorGeral, passo);
  const exigida = item.variacaoMinimaMelhorLance ?? 0n;
  const porEdital = item.melhorValorGeral - (exigida > 0n ? exigida : 1n);
  return porPasso < porEdital ? porPasso : porEdital;
}

export function decidir(item: EstadoItem, cfg: ConfiguracaoDisputa): Decisao {
  const casas = casasDoItem(item);

  let pisoMinimo: Micro;
  try {
    pisoMinimo = paraMicro(cfg.pisoMinimo);
  } catch {
    return {
      acao: "parar",
      codigo: "CONFIG_INVALIDA",
      porque: `Piso mínimo inválido: ${JSON.stringify(cfg.pisoMinimo)}.`
    };
  }
  if (pisoMinimo <= 0n) {
    return {
      acao: "parar",
      codigo: "CONFIG_INVALIDA",
      porque: "Piso mínimo precisa ser maior que zero — sem piso o robô não tem o que proteger."
    };
  }

  if (!item.aceitaLance) {
    return {
      acao: "parar",
      codigo: "ITEM_NAO_ACEITA_LANCE",
      porque: `O item ${item.numero} não está aceitando lances.`
    };
  }

  const janela = avaliarJanela(item.segundosRestantes, cfg.janelaFinal ?? { ativo: false, segundos: 0 });
  if (!janela.ofertar) return { acao: "aguardar", porque: janela.porque };

  /*
   * Já lideramos?
   *
   * Nos modos que disputam para vencer, baixar preço estando na frente é disputar
   * contra si mesmo — queima margem sem concorrente nenhum do outro lado. Esta guarda
   * é a diferença entre um robô e uma torneira aberta: sem ela, o item desceria do
   * melhor lance até o piso sozinho.
   *
   * O empate é o caso limite: ali ainda há o que fazer, mas só um centavo, e só se o
   * operador tiver ligado a disputa em casas decimais.
   */
  if (MODOS_PARA_VENCER.includes(cfg.modo) && item.nossoMelhorValor !== null && item.melhorValorGeral !== null) {
    if (item.nossoMelhorValor < item.melhorValorGeral) {
      return {
        acao: "aguardar",
        porque:
          `Já lideramos com ${formatar(item.nossoMelhorValor, casas)} contra ` +
          `${formatar(item.melhorValorGeral, casas)}. Nada a fazer até alguém cobrir.`
      };
    }
    if (item.nossoMelhorValor === item.melhorValorGeral) {
      // Empate. Descer um centavo só faz sentido se estivermos ATRÁS no empate: se o
      // melhor lance do item é o nosso, baixar de novo seria leiloar contra a própria
      // margem, um centavo por leitura, até o piso.
      if (item.posicao === null) {
        return {
          acao: "aguardar",
          porque:
            `Nosso lance empata com o melhor do item (${formatar(item.melhorValorGeral, casas)}), e não ` +
            `consegui ler nossa posição. Sem saber se o empate está a nosso favor, não baixo o preço.`
        };
      }
      if (item.posicao <= 1) {
        return {
          acao: "aguardar",
          porque:
            `Nosso lance é o melhor do item (${formatar(item.melhorValorGeral, casas)}). ` +
            `Nada a fazer até alguém cobrir.`
        };
      }
      if (!item.permitirDizima) {
        return {
          acao: "aguardar",
          porque:
            `Empate em ${formatar(item.melhorValorGeral, casas)} e estamos em ${item.posicao}º — no ` +
            `empate ganha quem lançou primeiro. Ligue "permitir lances em casas decimais" para brigar ` +
            `no centavo.`
        };
      }
      // Atrás no empate, com centavos liberados: desce um centavo, nunca o passo cheio.
      return validar(item.melhorValorGeral - CENTAVO, item, pisoMinimo, casas);
    }
  }

  switch (cfg.modo) {
    case "fechado": {
      if (cfg.valorFechado === undefined) {
        return { acao: "parar", codigo: "CONFIG_INVALIDA", porque: "Modo fechado sem valor configurado." };
      }
      let alvo: Micro;
      try {
        alvo = paraMicro(cfg.valorFechado);
      } catch {
        return {
          acao: "parar",
          codigo: "CONFIG_INVALIDA",
          porque: `Valor do lance fechado inválido: ${JSON.stringify(cfg.valorFechado)}.`
        };
      }
      // No fechado ninguém vê o lance alheio: não há melhor valor para comparar.
      return validar(alvo, { ...item, melhorValorGeral: null }, pisoMinimo, casas, true);
    }

    case "margem": {
      if (cfg.margemPercentual === undefined) {
        return { acao: "parar", codigo: "CONFIG_INVALIDA", porque: "Modo margem sem percentual configurado." };
      }
      if (item.melhorValorGeral === null) {
        return {
          acao: "parar",
          codigo: "LEITURA_INVALIDA",
          porque: "Modo margem depende do melhor valor do item, e ele não pôde ser lido."
        };
      }
      let teto: Micro;
      try {
        teto = acrescerPercentual(item.melhorValorGeral, cfg.margemPercentual);
      } catch (e) {
        return {
          acao: "parar",
          codigo: "CONFIG_INVALIDA",
          porque: e instanceof Error ? e.message : String(e)
        };
      }
      if (item.nossoMelhorValor !== null && item.nossoMelhorValor <= teto) {
        return {
          acao: "aguardar",
          porque:
            `Nosso lance (${formatar(item.nossoMelhorValor, casas)}) já está dentro da margem de ` +
            `${cfg.margemPercentual}% — teto ${formatar(teto, casas)}.`
        };
      }
      return validar(teto, item, pisoMinimo, casas, true);
    }

    case "manter": {
      // Reduz só o mínimo legal: mantém o item em disputa sem queimar margem.
      if (item.melhorValorGeral === null) {
        return {
          acao: "parar",
          codigo: "LEITURA_INVALIDA",
          porque: "Não foi possível ler o melhor valor do item."
        };
      }
      const exigida = item.variacaoMinimaMelhorLance ?? 0n;
      const alvo = item.melhorValorGeral - (exigida > 0n ? exigida : 1n);
      return validar(alvo, item, pisoMinimo, casas);
    }

    case "assumir-primeiro": {
      const alvo = alvoBatendoMelhor(item, cfg.passo);
      if (alvo === null) {
        return {
          acao: "parar",
          codigo: "LEITURA_INVALIDA",
          porque: "Não foi possível ler o melhor valor do item."
        };
      }
      return validar(alvo, item, pisoMinimo, casas);
    }

    case "posicionar": {
      // Tenta a melhor posição possível; se o passo do operador furaria o piso, oferta o
      // próprio piso — que é o melhor lance legítimo que ainda respeita a margem dele.
      const agressivo = alvoBatendoMelhor(item, cfg.passo);
      if (agressivo === null) {
        return {
          acao: "parar",
          codigo: "LEITURA_INVALIDA",
          porque: "Não foi possível ler o melhor valor do item."
        };
      }
      if (agressivo >= pisoMinimo) return validar(agressivo, item, pisoMinimo, casas);
      return validar(pisoMinimo, item, pisoMinimo, casas);
    }
  }
}
