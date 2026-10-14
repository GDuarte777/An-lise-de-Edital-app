/** Entrada humana de dinheiro: piso lido errado é prejuízo, então aqui recusa em vez de adivinhar. */
import { formatarReal, formatarSegundos, lerMoedaBR } from "./painel.js";

let falhas = 0;
const ok = (l: string, c: boolean, extra?: unknown) => {
  if (c) console.log(`  ✅ ${l}`);
  else { console.log(`  ❌ ${l}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`); falhas++; }
};

console.log("\n[1] Leitura de moeda em pt-BR");
ok("1.250,50", lerMoedaBR("1.250,50") === 1250.5);
ok("1250,50", lerMoedaBR("1250,50") === 1250.5);
ok("1250.50", lerMoedaBR("1250.50") === 1250.5);
ok("1.250 é mil duzentos e cinquenta", lerMoedaBR("1.250") === 1250, lerMoedaBR("1.250"));
ok("1.250.000", lerMoedaBR("1.250.000") === 1250000, lerMoedaBR("1.250.000"));
ok("ignora R$ e espaço", lerMoedaBR(" R$ 550,99 ") === 550.99);
ok("4 casas", lerMoedaBR("24,7800") === 24.78);
ok("texto vira null", lerMoedaBR("abc") === null);
ok("vazio vira null", lerMoedaBR("") === null);
ok("lixo com número vira null", lerMoedaBR("12a3") === null);

console.log("\n[2] Formatação");
ok("segundos viram HH:MM:SS", formatarSegundos(3661) === "01:01:01", formatarSegundos(3661));
ok("negativo vira null", formatarSegundos(-1) === null);
ok("null continua null", formatarSegundos(null) === null);
ok("valor nulo vira travessão", formatarReal(null) === "—");
ok("4 casas quando pedido", formatarReal(24.78, 4).includes("24,7800"), formatarReal(24.78, 4));

console.log(falhas === 0 ? "\n🎉 contrato do painel: tudo passou\n" : `\n💥 ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
