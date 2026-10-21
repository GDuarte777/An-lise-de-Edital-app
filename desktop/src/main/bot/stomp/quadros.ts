/**
 * Codec de quadros STOMP 1.2 — a parte do protocolo que não precisa de rede.
 *
 * Formato de um quadro:
 *
 *   COMANDO\n
 *   cabecalho:valor\n
 *   \n
 *   corpo\0
 *
 * O byte NULO termina o quadro, e é por isso que um socket pode entregar dois quadros
 * numa leitura e meio quadro na seguinte: `analisarFluxo` existe para lidar com isso.
 *
 * Escape de cabeçalhos (regra do 1.2): \r \n : e \ viram \\r \\n \\c \\\\. CONNECT e
 * CONNECTED são a exceção da especificação — neles não há escape. Respeitar essa exceção
 * importa: o token de Authorization vai no CONNECT e não pode ser mexido.
 */

export interface Quadro {
  comando: string;
  cabecalhos: Record<string, string>;
  corpo: string;
}

export const NULO = "\u0000";
/** Um EOL sozinho é o pulso (heart-beat) do STOMP, não um quadro. */
export const PULSO = "\n";

const SEM_ESCAPE = new Set(["CONNECT", "CONNECTED"]);

function escapar(texto: string): string {
  return texto
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/:/g, "\\c");
}

function desescapar(texto: string): string {
  let saida = "";
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] !== "\\") {
      saida += texto[i];
      continue;
    }
    const proximo = texto[++i];
    if (proximo === "r") saida += "\r";
    else if (proximo === "n") saida += "\n";
    else if (proximo === "c") saida += ":";
    else if (proximo === "\\") saida += "\\";
    else throw new Error(`Sequência de escape inválida "\\${proximo}" em cabeçalho STOMP.`);
  }
  return saida;
}

export function serializar(q: Quadro): string {
  if (!/^[A-Z]+$/.test(q.comando)) {
    throw new Error(`Comando STOMP inválido: ${JSON.stringify(q.comando)}.`);
  }
  const cru = SEM_ESCAPE.has(q.comando);
  const linhas = [q.comando];
  for (const [chave, valor] of Object.entries(q.cabecalhos)) {
    linhas.push(cru ? `${chave}:${valor}` : `${escapar(chave)}:${escapar(valor)}`);
  }
  return `${linhas.join("\n")}\n\n${q.corpo}${NULO}`;
}

/**
 * Acha a linha em branco que separa cabeçalhos do corpo. O 1.2 aceita EOL como `\n` ou
 * `\r\n`, então os dois precisam ser reconhecidos — e só aqui, porque dentro do corpo
 * `\r` é dado do servidor e não pode ser mexido.
 */
function cortarCabeca(texto: string): { cabeca: string; corpo: string } {
  for (let i = 0; i < texto.length; i++) {
    if (texto.startsWith("\n\n", i)) return { cabeca: texto.slice(0, i), corpo: texto.slice(i + 2) };
    if (texto.startsWith("\r\n\r\n", i)) return { cabeca: texto.slice(0, i), corpo: texto.slice(i + 4) };
  }
  return { cabeca: texto, corpo: "" };
}

export function analisar(bruto: string): Quadro {
  const semNulo = bruto.endsWith(NULO) ? bruto.slice(0, -1) : bruto;
  const { cabeca, corpo } = cortarCabeca(semNulo);

  const linhas = cabeca.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const comando = (linhas.shift() ?? "").trim();
  if (!comando) throw new Error("Quadro STOMP sem comando.");

  const cru = SEM_ESCAPE.has(comando);
  const cabecalhos: Record<string, string> = {};
  for (const linha of linhas) {
    if (linha === "") continue;
    const sep = linha.indexOf(":");
    if (sep <= 0) throw new Error(`Cabeçalho STOMP malformado: ${JSON.stringify(linha)}.`);
    const chave = cru ? linha.slice(0, sep) : desescapar(linha.slice(0, sep));
    const valor = cru ? linha.slice(sep + 1) : desescapar(linha.slice(sep + 1));
    // Repetido: o primeiro vale (regra do 1.2).
    if (!(chave in cabecalhos)) cabecalhos[chave] = valor;
  }

  return { comando, cabecalhos, corpo };
}

/**
 * Separa quadros completos do que chegou pelo socket e devolve o resto para a próxima
 * leitura. Pulsos (EOL sozinho entre quadros) são contados, não viram quadro.
 */
export function analisarFluxo(acumulado: string): {
  quadros: Quadro[];
  pulsos: number;
  resto: string;
} {
  const quadros: Quadro[] = [];
  let pulsos = 0;
  let restante = acumulado;

  for (;;) {
    // Pulsos antes do próximo quadro.
    while (restante.startsWith("\n") || restante.startsWith("\r\n")) {
      pulsos++;
      restante = restante.startsWith("\r\n") ? restante.slice(2) : restante.slice(1);
    }
    const fim = restante.indexOf(NULO);
    if (fim === -1) break;
    const bruto = restante.slice(0, fim);
    restante = restante.slice(fim + 1);
    if (bruto.trim() === "") continue;
    quadros.push(analisar(bruto));
  }

  return { quadros, pulsos, resto: restante };
}

/**
 * Negocia o pulso. No STOMP cada lado anuncia "sei enviar a cada X, quero receber a cada
 * Y" e o intervalo efetivo é o maior entre o que um pode e o outro quer.
 */
export function negociarPulso(
  meu: { envio: number; recepcao: number },
  doServidor: string | undefined
): { enviarCadaMs: number; esperarCadaMs: number } {
  if (!doServidor) return { enviarCadaMs: 0, esperarCadaMs: 0 };
  const [servidorEnvia, servidorQuer] = doServidor.split(",").map((n) => Number(n.trim()) || 0);
  const enviarCadaMs = meu.envio === 0 || servidorQuer === 0 ? 0 : Math.max(meu.envio, servidorQuer);
  const esperarCadaMs = meu.recepcao === 0 || servidorEnvia === 0 ? 0 : Math.max(meu.recepcao, servidorEnvia);
  return { enviarCadaMs, esperarCadaMs };
}
