#!/usr/bin/env node
/**
 * Embute o motor da extensão dentro do aplicativo.
 *
 * O motor de leitura da tela (`extensao-lancebot/margem.js` + `conteudo.js`) foi
 * construído sobre o HTML REAL do portal, coletado na sessão do operador: os
 * componentes `app-card-item`, `app-identificacao-e-fase-item` e `app-todos-lances`, os
 * rótulos "Valor do lance (unitário)" e "Valor ofertado", e o dinheiro com QUATRO casas
 * decimais. O agente que o aplicativo já tinha foi escrito antes dessa coleta e não
 * conhece nada disso — na tela de verdade ele não acharia o preço.
 *
 * Em vez de manter dois motores (que iam divergir na primeira correção), o aplicativo
 * passa a injetar exatamente o mesmo arquivo que a extensão usa. Este script gera o
 * módulo TypeScript com esse conteúdo; `motor-extensao.test.ts` falha se o gerado ficar
 * fora de sincronia com a fonte.
 */
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..", "extensao-lancebot");
const DESTINO = path.join(__dirname, "..", "src", "main", "engine", "motor-extensao.ts");
const ARQUIVOS = ["margem.js", "conteudo.js"];

/**
 * Quebra de linha SEMPRE em LF.
 *
 * No Windows o git entrega os arquivos com CRLF, mas um template literal do JavaScript
 * normaliza CRLF para LF ao virar valor. Sem normalizar aqui, o conteúdo lido do disco
 * nunca bate com o embutido, e a checagem de sincronia falha no Windows mesmo estando
 * tudo em dia — foi exatamente o que quebrou o build.
 */
const emLf = (t) => t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

function montar() {
  const partes = ARQUIVOS.map((nome) => {
    const fonte = emLf(fs.readFileSync(path.join(RAIZ, nome), "utf-8"));
    return `/* ===== extensao-lancebot/${nome} ===== */\n${fonte}`;
  });
  return partes.join("\n");
}

function gerar() {
  const motor = montar();
  const escapado = motor.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return `// GERADO POR scripts/gerar-motor.cjs — NÃO EDITE À MÃO.
// Fonte: ${ARQUIVOS.map((a) => "extensao-lancebot/" + a).join(", ")}
// Rode \`npm run motor\` depois de mexer no motor da extensão.

/**
 * Motor de leitura e lance, o MESMO que a extensão usa.
 *
 * Está aqui porque foi construído sobre o HTML real do portal, e o agente antigo do
 * aplicativo não foi. Injetar o mesmo arquivo nos dois lugares é o que impede os dois
 * motores de divergirem.
 *
 * Injetado, ele NÃO opera sozinho: só expõe \`window.__lancebot\`. O laço de lance dele
 * fica desligado (\`estado.ligado === false\`) até alguém chamar \`ligar()\`, e quem manda
 * no lance dentro do aplicativo continua sendo o MotorLances, no processo principal.
 */
export const FONTE_MOTOR_EXTENSAO = \`${escapado}\`;
`;
}

if (require.main === module) {
  const conteudo = gerar();
  const anterior = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, "utf-8") : "";
  if (anterior === conteudo) {
    console.log("motor-extensao.ts já está em dia.");
  } else {
    fs.writeFileSync(DESTINO, conteudo, "utf-8");
    console.log("motor-extensao.ts gerado a partir de", ARQUIVOS.join(" + "));
  }
}

module.exports = { gerar, montar, DESTINO };
