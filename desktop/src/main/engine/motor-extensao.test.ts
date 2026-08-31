import { createRequire } from "node:module";

import { FONTE_MOTOR_EXTENSAO } from "./motor-extensao.js";

/**
 * O aplicativo e a extensão têm que usar o MESMO motor. Este teste falha se o arquivo
 * gerado ficar para trás da fonte — que é exatamente como dois motores começam a
 * divergir e um deles passa a errar sozinho na tela real.
 */
const require_ = createRequire(import.meta.url);
const { montar } = require_("../../../scripts/gerar-motor.cjs") as { montar: () => string };

let falhas = 0;
const ok = (r: string, c: boolean, x?: unknown) => {
  if (c) console.log(`  ✅ ${r}`);
  else { console.log(`  ❌ ${r}${x !== undefined ? " -> " + String(x).slice(0, 200) : ""}`); falhas++; }
};

console.log("\n[motor compartilhado app ↔ extensão]");

const fonte = montar();
ok("o gerado está em dia com extensao-lancebot/ (rode: npm run motor)", FONTE_MOTOR_EXTENSAO === fonte);

// O que veio da coleta na tela real e o agente antigo do aplicativo não tinha.
ok("traz os componentes reais do portal",
   /app-card-item/.test(FONTE_MOTOR_EXTENSAO) && /app-todos-lances/.test(FONTE_MOTOR_EXTENSAO));
ok("traz os rótulos reais de dinheiro",
   /valor\\s\+do\\s\+lance|valor\\s\+ofertado/i.test(FONTE_MOTOR_EXTENSAO));
ok("traz a guarda de margem", /__lancebotMargem/.test(FONTE_MOTOR_EXTENSAO));
ok("expõe a API que o aplicativo chama", /window\.__lancebot\s*=/.test(FONTE_MOTOR_EXTENSAO));

// Injetado no aplicativo, o motor não pode sair dando lance por conta própria: quem
// decide continua sendo o MotorLances, no processo principal.
ok("nasce desligado", /ligado:\s*false/.test(FONTE_MOTOR_EXTENSAO));

console.log(falhas === 0 ? "\n🎉 motor compartilhado: tudo passou\n" : `\n💥 ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
