/**
 * Guarda de margem: decide o próximo lance e recusa qualquer valor abaixo do piso.
 *
 * É a única barreira entre o robô e prejuízo, então falha fechada: entrada que não seja
 * número finito, ou resultado que não respeite o piso, vira recusa — nunca um lance
 * "aproximado".
 *
 * Portado da versão que já rodava no aplicativo desktop, com uma trava nova que aquela
 * não tinha: leitura velha não vira lance. A tela do Comprasnet perde a conexão e
 * congela; sem esta trava o robô ofertaria contra um preço que não existe mais.
 */
(() => {
  const VALIDADE_LEITURA_MS = 8000;

  /** O passo da briga de centavos. */
  const PASSO_CENTAVO = 0.01;

  /**
   * O mínimo que vale quando "permitir lances em casas decimais" está ligado.
   *
   * O operador configura, por exemplo, R$ 550,99. Se um concorrente cobre esse valor nos
   * centavos, o robô passa a disputar centavo a centavo — até R$ 550,00, o valor cheio
   * abaixo do configurado. Os centavos do mínimo viram margem de briga; os reais, não.
   */
  const pisoEfetivo = (cfg) => (cfg.decimais ? Math.floor(cfg.piso) : cfg.piso);

  const ehNumero = (n) => typeof n === "number" && Number.isFinite(n);

  const arredondarCentavos = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
  const arredondar4 = (v) => Math.round((v + Number.EPSILON) * 10000) / 10000;

  function validarConfig(cfg) {
    if (!ehNumero(cfg.piso) || cfg.piso < 0) throw new Error("Piso inválido: informe um número maior ou igual a zero.");
    if (!ehNumero(cfg.decremento) || cfg.decremento <= 0) throw new Error("Decremento inválido: informe um número maior que zero.");
    if (cfg.tipo === "percentual" && cfg.decremento >= 100) throw new Error("Decremento percentual precisa ser menor que 100%.");
  }

  /**
   * @param {{piso:number, decremento:number, tipo:"fixo"|"percentual",
   *          decimais?:boolean, segundosFinais?:number|null}} cfg
   * @param {{melhorValor:number, meuValor?:number, aberto:boolean, lidoEm:number,
   *          segundosRestantes?:number|null}} estado
   * @param {number} agora
   */
  function decidir(cfg, estado, agora) {
    validarConfig(cfg);

    if (!estado.aberto) {
      return { acao: "parar", motivo: "O item não está aceitando lances." };
    }

    // "Disputar apenas nos segundos finais". Falha FECHADA: sem saber quanto falta, não
    // dá para saber se estamos nos segundos finais — e ofertar cedo quando o operador
    // pediu para esperar é pior do que não ofertar.
    if (ehNumero(cfg.segundosFinais) && cfg.segundosFinais > 0) {
      if (!ehNumero(estado.segundosRestantes)) {
        return {
          acao: "parar",
          motivo: "Você pediu para disputar só nos segundos finais, mas não consigo ler o " +
                  "tempo restante nesta tela. Sem isso não arrisco ofertar cedo."
        };
      }
      if (estado.segundosRestantes > cfg.segundosFinais) {
        return {
          acao: "aguardar",
          motivo: `Faltam ${Math.round(estado.segundosRestantes)}s — só disputo nos últimos ${cfg.segundosFinais}s.`
        };
      }
    }

    // Trava de validade: a tela do portal congela quando a conexão cai.
    const idade = agora - estado.lidoEm;
    if (idade > VALIDADE_LEITURA_MS) {
      return {
        acao: "parar",
        motivo: `A leitura da tela tem ${Math.round(idade / 1000)}s — velha demais para valer lance. ` +
                `A conexão com o portal provavelmente caiu.`
      };
    }

    if (!ehNumero(estado.melhorValor) || estado.melhorValor <= 0) {
      return { acao: "parar", motivo: `Melhor valor lido é inválido (${String(estado.melhorValor)}). Nenhum lance será enviado.` };
    }

    // Liderança folgada: nada a fazer.
    if (ehNumero(estado.meuValor) && estado.melhorValor > estado.meuValor) {
      return { acao: "aguardar", motivo: `Já lideramos com R$ ${estado.meuValor.toFixed(2)}.` };
    }

    // EMPATE — um concorrente digitou exatamente o mesmo valor que o seu.
    const empatado = ehNumero(estado.meuValor) && estado.melhorValor === estado.meuValor;
    if (empatado && !cfg.decimais) {
      return {
        acao: "aguardar",
        motivo: `Empate em R$ ${estado.melhorValor.toFixed(2)}. Ligue "lances em casas decimais" ` +
                `para disputar os centavos até R$ ${Math.floor(cfg.piso).toFixed(2)}.`
      };
    }

    const proximo = arredondarCentavos(
      cfg.tipo === "percentual"
        ? estado.melhorValor * (1 - cfg.decremento / 100)
        : estado.melhorValor - cfg.decremento
    );

    if (proximo <= 0) {
      return { acao: "parar", motivo: `O decremento levaria o lance a R$ ${proximo.toFixed(2)}, que não é válido.` };
    }

    const limite = pisoEfetivo(cfg);

    if (proximo < limite) {
      // "Permitir lances em casas decimais": os CENTAVOS do mínimo viram margem de
      // briga. Configurado R$ 550,99, o robô disputa centavo a centavo até R$ 550,00 —
      // e para ali. Os reais do mínimo continuam intocáveis.
      if (cfg.decimais) {
        const alvo = arredondarCentavos(estado.melhorValor - PASSO_CENTAVO);
        if (alvo > 0 && alvo < estado.melhorValor && alvo >= limite) {
          return { acao: "enviar", valor: alvo, centavos: true };
        }
      }
      return {
        acao: "parar",
        motivo: `Margem estourada: o próximo lance seria R$ ${proximo.toFixed(2)}, ` +
                `abaixo do seu mínimo de R$ ${limite.toFixed(2)}` +
                (cfg.decimais ? " (com a briga de centavos já contada)." : ".")
      };
    }

    return { acao: "enviar", valor: proximo };
  }

  const api = { decidir, arredondarCentavos, arredondar4, pisoEfetivo, PASSO_CENTAVO, VALIDADE_LEITURA_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (typeof window !== "undefined" ? window : globalThis).__lancebotMargem = api;
})();
