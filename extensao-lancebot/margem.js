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

  const ehNumero = (n) => typeof n === "number" && Number.isFinite(n);

  const arredondarCentavos = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

  function validarConfig(cfg) {
    if (!ehNumero(cfg.piso) || cfg.piso < 0) throw new Error("Piso inválido: informe um número maior ou igual a zero.");
    if (!ehNumero(cfg.decremento) || cfg.decremento <= 0) throw new Error("Decremento inválido: informe um número maior que zero.");
    if (cfg.tipo === "percentual" && cfg.decremento >= 100) throw new Error("Decremento percentual precisa ser menor que 100%.");
  }

  /**
   * @param {{piso:number, decremento:number, tipo:"fixo"|"percentual"}} cfg
   * @param {{melhorValor:number, meuValor?:number, aberto:boolean, lidoEm:number}} estado
   * @param {number} agora
   */
  function decidir(cfg, estado, agora) {
    validarConfig(cfg);

    if (!estado.aberto) {
      return { acao: "parar", motivo: "O item não está aceitando lances." };
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

    if (ehNumero(estado.meuValor) && estado.melhorValor >= estado.meuValor) {
      return { acao: "aguardar", motivo: `Já lideramos com R$ ${estado.meuValor.toFixed(2)}.` };
    }

    const proximo = arredondarCentavos(
      cfg.tipo === "percentual"
        ? estado.melhorValor * (1 - cfg.decremento / 100)
        : estado.melhorValor - cfg.decremento
    );

    if (proximo <= 0) {
      return { acao: "parar", motivo: `O decremento levaria o lance a R$ ${proximo.toFixed(2)}, que não é válido.` };
    }

    if (proximo < cfg.piso) {
      return {
        acao: "parar",
        motivo: `Margem estourada: o próximo lance seria R$ ${proximo.toFixed(2)}, ` +
                `abaixo do seu piso de R$ ${cfg.piso.toFixed(2)}.`
      };
    }

    return { acao: "enviar", valor: proximo };
  }

  const api = { decidir, arredondarCentavos, VALIDADE_LEITURA_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (typeof window !== "undefined" ? window : globalThis).__lancebotMargem = api;
})();
