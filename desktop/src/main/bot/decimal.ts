/**
 * Aritmética de dinheiro exata, em inteiros.
 *
 * Por que isto existe: o robô do SIGA faz as quatro operações em BigNumber (exato) mas
 * arredonda em ponto flutuante nativo — `Math.floor(v * 10**casas) / 10**casas` — e essa
 * função é a ÚLTIMA coisa chamada antes de enviar o lance. Em valor de borda o lance sai
 * com artefato de float. Aqui não existe float em nenhuma etapa: todo valor vive como
 * inteiro de micro-unidades (1e-4 do real) e só vira `number` na saída.
 *
 * Escala 4 porque é o máximo que o portal aceita: item com `permitirDizima` usa 4 casas,
 * o resto usa 2.
 */

/** Micro-unidades por real. 4 casas decimais é o limite do portal. */
export const ESCALA = 10_000n;

/** Valor monetário em micro-unidades (R$ 1,00 === 10000n). */
export type Micro = bigint;

export type Casas = 2 | 4;

/**
 * `number` → micro. O `Math.round` é seguro e não é o bug do SIGA: aqui ele desfaz o erro
 * de representação do double de entrada (550.99 * 10000 = 5509899.999…), enquanto lá o
 * arredondamento acontecia no resultado do cálculo, já propagado.
 */
export function paraMicro(valor: number): Micro {
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    throw new Error(`Valor monetário inválido: ${JSON.stringify(valor)}.`);
  }
  if (Math.abs(valor) > 1e12) {
    throw new Error(`Valor monetário fora da faixa aceitável: ${valor}.`);
  }
  return BigInt(Math.round(valor * 10_000));
}

export function paraNumero(m: Micro): number {
  return Number(m) / 10_000;
}

export function somar(a: Micro, b: Micro): Micro {
  return a + b;
}

export function subtrair(a: Micro, b: Micro): Micro {
  return a - b;
}

/**
 * Trunca para `casas` decimais, sempre para baixo (nunca arredonda para cima).
 *
 * Truncar para baixo é o lado seguro em lance de menor preço: o valor resultante é
 * sempre ≤ o calculado, então nunca "sobe" o lance sem o operador pedir. O piso é
 * checado depois, na guarda de margem.
 */
export function truncar(m: Micro, casas: Casas): Micro {
  if (m < 0n) throw new Error("Valor monetário negativo não é lance válido.");
  const passo = casas === 4 ? 1n : 100n;
  return (m / passo) * passo;
}

/**
 * Reduz `m` em `pct` por cento, truncando para baixo.
 *
 * Feito como uma única divisão inteira — `m * (100 - pct) / 100` — e não como
 * "calcular o desconto e subtrair", para não truncar duas vezes.
 */
export function reduzirPercentual(m: Micro, pct: number): Micro {
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
    throw new Error(`Percentual inválido: ${JSON.stringify(pct)}. Use um valor entre 0 e 100.`);
  }
  const fator = BigInt(Math.round((100 - pct) * 10_000)); // 2 casas de pct já cabem
  return (m * fator) / 1_000_000n;
}

/** Acresce `pct` por cento a `m`, truncando para baixo (usado no teto de margem). */
export function acrescerPercentual(m: Micro, pct: number): Micro {
  if (!Number.isFinite(pct) || pct < 0) {
    throw new Error(`Percentual inválido: ${JSON.stringify(pct)}.`);
  }
  const fator = BigInt(Math.round((100 + pct) * 10_000));
  return (m * fator) / 1_000_000n;
}

/** Texto para log e para a UI. Nunca usado para montar o corpo da requisição. */
export function formatar(m: Micro, casas: Casas = 2): string {
  const negativo = m < 0n;
  const abs = negativo ? -m : m;
  const inteiro = abs / ESCALA;
  const frac = (abs % ESCALA).toString().padStart(4, "0").slice(0, casas);
  const milhar = inteiro.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}R$ ${milhar}${casas > 0 ? `,${frac}` : ""}`;
}

/**
 * Serializa para o corpo do POST de lance.
 *
 * String, não `number`: `JSON.stringify(550.99)` é confiável hoje, mas um valor de 4 casas
 * como 0.1234 já depende de como o V8 imprime o double. Aqui o dígito é nosso.
 */
export function paraCorpoRequisicao(m: Micro, casas: Casas): string {
  const t = truncar(m, casas);
  const inteiro = t / ESCALA;
  const frac = (t % ESCALA).toString().padStart(4, "0").slice(0, casas);
  return `${inteiro}.${frac}`;
}
