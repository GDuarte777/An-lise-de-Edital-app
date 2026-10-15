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

/**
 * Texto → micro, por aritmética inteira (sem passar por `number` em nenhuma etapa).
 *
 * Existe porque o portal entrega dinheiro como texto ("1.234,56", "550.99") e converter
 * com `Number()` reintroduz exatamente o erro de representação que este módulo evita.
 *
 * Devolve `null` em vez de lançar: quem lê evento do portal precisa poder tratar campo
 * ilegível como "não li" e falhar fechado. E o caso ambíguo é ilegível de propósito —
 * "1.234" pode ser mil duzentos e trinta e quatro ou um e duzentos e trinta e quatro, e
 * adivinhar aqui custaria o lance.
 */
export function paraMicroDeTexto(texto: unknown): Micro | null {
  if (typeof texto !== "string") return null;
  let t = texto.replace(/[\s ]/g, "").replace(/^R\$/i, "");
  if (!t) return null;

  const negativo = t.startsWith("-");
  if (negativo) t = t.slice(1);
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return null;

  const pontos = (t.match(/\./g) ?? []).length;
  const virgulas = (t.match(/,/g) ?? []).length;

  let inteiroTxt: string;
  let fracTxt = "";

  if (pontos > 0 && virgulas > 0) {
    // Os dois símbolos presentes: o último é o decimal, o outro é milhar.
    const decimal = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ",";
    const milhar = decimal === "." ? "," : ".";
    const corte = t.lastIndexOf(decimal);
    inteiroTxt = t.slice(0, corte);
    fracTxt = t.slice(corte + 1);
    if (!/^\d{1,4}$/.test(fracTxt)) return null;
    if (inteiroTxt.includes(decimal)) return null;
    if (!grupoDeMilharValido(inteiroTxt, milhar)) return null;
    inteiroTxt = inteiroTxt.split(milhar).join("");
  } else if (pontos + virgulas === 0) {
    inteiroTxt = t;
  } else {
    const simbolo = pontos > 0 ? "." : ",";
    const quantos = pontos + virgulas;
    const depois = t.slice(t.lastIndexOf(simbolo) + 1);
    const separadorDeMilhar =
      quantos > 1 || (simbolo === "." && depois.length === 3 && !t.startsWith("0."));
    if (separadorDeMilhar) {
      if (!grupoDeMilharValido(t, simbolo)) return null;
      // Um único ponto com três dígitos é ambíguo: não se adivinha dinheiro.
      if (quantos === 1) return null;
      inteiroTxt = t.split(simbolo).join("");
    } else {
      if (!/^\d{1,4}$/.test(depois)) return null;
      inteiroTxt = t.slice(0, t.lastIndexOf(simbolo));
      fracTxt = depois;
    }
  }

  if (inteiroTxt === "") inteiroTxt = "0";
  if (!/^\d+$/.test(inteiroTxt)) return null;
  if (inteiroTxt.length > 13) return null;

  const micro = BigInt(inteiroTxt) * ESCALA + BigInt(fracTxt.padEnd(4, "0"));
  return negativo ? -micro : micro;
}

function grupoDeMilharValido(texto: string, simbolo: string): boolean {
  const partes = texto.split(simbolo);
  if (partes.length === 1) return true;
  if (!/^\d{1,3}$/.test(partes[0])) return false;
  return partes.slice(1).every((p) => /^\d{3}$/.test(p));
}
