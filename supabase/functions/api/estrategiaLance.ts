// ═══════════════════════════════════════════════════════════════════════
// MODELO DE LANCE
//
// Dado o melhor lance vigente no item e a configuração do robô, decide qual é
// o próximo lance — ou por que não há lance a dar.
//
// Esta é a única barreira entre o robô e um prejuízo real, então ela falha
// fechada: entrada que não seja número finito, piso ausente, redução ausente
// ou resultado abaixo do piso viram recusa. Nunca um lance "aproximado".
//
// Fica em arquivo próprio, sem nenhuma dependência de rede ou de banco, porque
// é a única parte do robô que dá para testar de verdade — e é a parte que
// precisa estar certa.
// ═══════════════════════════════════════════════════════════════════════

export interface ConfiguracaoRobo {
  mode?: string | null;
  dispute_type?: string | null;
  item_selection_enabled?: boolean | null;
  /** Piso global, usado quando o item não tem piso próprio. */
  minimum_value?: number | null;
  /** Faixa de redução por lance, em pontos percentuais. */
  min_reduction?: number | null;
  max_reduction?: number | null;
}

export interface ItemRobo {
  participar?: boolean | null;
  valor_minimo?: number | null;
  lance_manual?: number | null;
  /** Redução fixa, em reais. */
  desconto?: number | null;
  /** Redução percentual. */
  variacao?: number | null;
}

export interface EntradaDecisao {
  config: ConfiguracaoRobo | null;
  item: ItemRobo | null;
  /** Menor valor vigente no item, lido do portal. */
  melhorLance: unknown;
  /** Último valor que nós enviamos neste item, se houver. */
  meuLance?: unknown;
  /** Entre 0 e 1. Só é usado no modo Estratégico; recebe-o para o teste ser determinístico. */
  sorteio?: number;
}

export interface Decisao {
  is_winning: boolean;
  should_bid: boolean;
  suggested_bid: number | null;
  message: string;
}

function numero(valor: unknown): number | null {
  const n = typeof valor === "string" ? Number(valor.replace(",", ".")) : Number(valor);
  return Number.isFinite(n) ? n : null;
}

function positivo(valor: unknown): number | null {
  const n = numero(valor);
  return n !== null && n > 0 ? n : null;
}

/** Arredonda para centavos evitando o erro de ponto flutuante de (x * 100) / 100. */
export function arredondarCentavos(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function reais(valor: number): string {
  return `R$ ${valor.toFixed(2).replace(".", ",")}`;
}

/**
 * Piso de margem do item.
 *
 * O piso do item vence o piso global: quem preencheu um valor para aquele item
 * decidiu especificamente sobre ele. Devolve `null` quando não há piso em
 * lugar nenhum — e aí não existe lance automático possível.
 */
export function pisoDoItem(config: ConfiguracaoRobo | null, item: ItemRobo | null): number | null {
  const doItem = positivo(item?.valor_minimo);
  if (doItem !== null) return doItem;
  return positivo(config?.minimum_value);
}

/**
 * Diz se este item pode receber lance segundo a configuração do robô.
 *
 * Mesma regra que a extensão aplica antes de pedir a sugestão. Ela existe nos
 * dois lados de propósito: a extensão aplica para não gastar uma chamada, e o
 * backend aplica porque é ele quem responde — e a resposta do backend é o que
 * efetivamente autoriza um lance.
 */
export function itemAutorizado(config: ConfiguracaoRobo | null, item: ItemRobo | null): boolean {
  if (!config) return false;
  if (config.dispute_type !== "por_item") return true;
  if (config.item_selection_enabled === true) {
    // Seleção explícita ligada: só disputa o que foi marcado E tem piso.
    return item?.participar === true && positivo(item?.valor_minimo) !== null;
  }
  // Seleção explícita desligada: disputa tudo, menos o que foi desmarcado.
  return !item || item.participar !== false;
}

/** Redução a aplicar sobre o melhor lance, já resolvida em reais. */
function reducaoEmReais(
  config: ConfiguracaoRobo,
  item: ItemRobo | null,
  melhorLance: number,
  sorteio: number,
): { valor: number; origem: string } | null {
  // Ordem de precedência: o que foi configurado para o item vence o que foi
  // configurado para o robô inteiro, e o valor fixo vence o percentual.
  const fixo = positivo(item?.desconto);
  if (fixo !== null) return { valor: fixo, origem: `desconto fixo de ${reais(fixo)}` };

  const percentualDoItem = positivo(item?.variacao);
  if (percentualDoItem !== null && percentualDoItem < 100) {
    return { valor: melhorLance * (percentualDoItem / 100), origem: `variação de ${percentualDoItem}%` };
  }

  const minimo = positivo(config.min_reduction);
  const maximo = positivo(config.max_reduction);
  if (minimo === null && maximo === null) return null;

  const piso = minimo ?? maximo!;
  const teto = maximo ?? minimo!;
  if (piso >= 100) return null;

  // No modo Estratégico a redução varia dentro da faixa: uma sequência de
  // lances com decremento idêntico é a assinatura mais óbvia de robô, e o
  // concorrente que a identifica passa a prever o próximo valor.
  const percentual = config.mode === "Estratégico" && teto > piso
    ? piso + (Math.min(teto, 99.99) - piso) * Math.min(Math.max(sorteio, 0), 1)
    : piso;

  return { valor: melhorLance * (percentual / 100), origem: `redução de ${percentual.toFixed(2)}%` };
}

export function decidirLance(entrada: EntradaDecisao): Decisao {
  const { config, item } = entrada;
  const melhorLance = positivo(entrada.melhorLance);
  const meuLance = positivo(entrada.meuLance);

  if (!config) {
    return { is_winning: false, should_bid: false, suggested_bid: null, message: "Robô sem configuração carregada." };
  }

  if (melhorLance === null) {
    return {
      is_winning: false,
      should_bid: false,
      suggested_bid: null,
      message: "Melhor lance do portal ainda não foi lido para este item — nenhum lance será enviado.",
    };
  }

  // Já lideramos: cobrir o próprio lance só queima margem.
  if (meuLance !== null && melhorLance >= meuLance) {
    return {
      is_winning: true,
      should_bid: false,
      suggested_bid: null,
      message: `Já lideramos o item com ${reais(meuLance)}.`,
    };
  }

  if (!itemAutorizado(config, item)) {
    return {
      is_winning: false,
      should_bid: false,
      suggested_bid: null,
      message: "Item fora da configuração do robô — lance bloqueado.",
    };
  }

  const piso = pisoDoItem(config, item);
  if (piso === null) {
    // Sem piso em lugar nenhum não há como saber quando parar. Zero não serve
    // de padrão: zero é um piso válido, e o robô desceria até lá achando que
    // estava obedecendo.
    return {
      is_winning: false,
      should_bid: false,
      suggested_bid: null,
      message: "Item sem valor mínimo configurado — lance automático bloqueado até definir o piso de margem.",
    };
  }

  // Lance manual é ordem direta do operador: vale o valor exato, sem cálculo.
  // O piso continua valendo, porque ele é o limite que o próprio operador pôs.
  const manual = positivo(item?.lance_manual);
  if (manual !== null) {
    if (manual >= melhorLance) {
      return {
        is_winning: false,
        should_bid: false,
        suggested_bid: null,
        message: `Lance manual de ${reais(manual)} não cobre o melhor lance atual (${reais(melhorLance)}).`,
      };
    }
    if (manual < piso) {
      return {
        is_winning: false,
        should_bid: false,
        suggested_bid: null,
        message: `Lance manual de ${reais(manual)} está abaixo do valor mínimo de ${reais(piso)} — bloqueado.`,
      };
    }
    return {
      is_winning: false,
      should_bid: true,
      suggested_bid: arredondarCentavos(manual),
      message: `Lance manual de ${reais(manual)}.`,
    };
  }

  const reducao = reducaoEmReais(config, item, melhorLance, entrada.sorteio ?? Math.random());
  if (!reducao) {
    return {
      is_winning: false,
      should_bid: false,
      suggested_bid: null,
      message: "Robô sem redução configurada (desconto, variação ou faixa de redução) — nada a enviar.",
    };
  }

  const proximo = arredondarCentavos(melhorLance - reducao.valor);

  if (proximo <= 0) {
    return {
      is_winning: false,
      should_bid: false,
      suggested_bid: null,
      message: `A ${reducao.origem} levaria o lance a ${reais(proximo)}, que não é um valor válido.`,
    };
  }

  if (proximo >= melhorLance) {
    return {
      is_winning: false,
      should_bid: false,
      suggested_bid: null,
      message: `A ${reducao.origem} não reduz o lance abaixo de ${reais(melhorLance)} — nada a enviar.`,
    };
  }

  if (proximo < piso) {
    // O texto precisa conter "valor mínimo": é por ele que a extensão
    // reconhece o caso e avisa o operador na aba Alertas, em vez de enterrar
    // a informação no log.
    return {
      is_winning: false,
      should_bid: false,
      suggested_bid: null,
      message: `Atingimos o valor mínimo do item: o próximo lance seria ${reais(proximo)}, abaixo do piso de ${reais(piso)}. Robô parado neste item.`,
    };
  }

  return {
    is_winning: false,
    should_bid: true,
    suggested_bid: proximo,
    message: `Próximo lance ${reais(proximo)} (${reducao.origem}, piso ${reais(piso)}).`,
  };
}

/**
 * Autoriza (ou não) um valor específico, já escolhido, antes do envio.
 *
 * A extensão chama isto no último instante, depois do tempo de resposta e com
 * o valor na mão. É a checagem que pega o caso em que a configuração mudou no
 * app entre o cálculo e o envio.
 */
export function autorizarLance(
  config: ConfiguracaoRobo | null,
  item: ItemRobo | null,
  valor: unknown,
): { allowed: boolean; message: string } {
  const valorLance = positivo(valor);
  if (valorLance === null) return { allowed: false, message: "Valor de lance inválido." };
  if (!config) return { allowed: false, message: "Robô sem configuração carregada." };
  if (!itemAutorizado(config, item)) return { allowed: false, message: "Item fora da configuração do robô." };

  const piso = pisoDoItem(config, item);
  if (piso === null) return { allowed: false, message: "Item sem valor mínimo configurado." };
  if (valorLance < piso) {
    return { allowed: false, message: `Lance de ${reais(valorLance)} abaixo do valor mínimo de ${reais(piso)}.` };
  }
  return { allowed: true, message: "Autorizado." };
}
