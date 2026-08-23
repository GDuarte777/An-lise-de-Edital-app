import { extrairValores as ex } from "./sniffer.js";

let f = 0;
const ok = (l: string, c: boolean, x?: unknown) => {
  if (c) console.log(`  ✅ ${l}`);
  else { console.log(`  ❌ ${l}${x !== undefined ? " -> " + JSON.stringify(x) : ""}`); f++; }
};

console.log("\n[1] Formato brasileiro com milhar");
ok("R$ 1.250,50 -> 1250.5", ex("Melhor lance: R$ 1.250,50")[0] === 1250.5, ex("Melhor lance: R$ 1.250,50"));
ok("R$ 12.345.678,90", ex("R$ 12.345.678,90")[0] === 12345678.9);

console.log("\n[2] Varios valores, ordenados do maior");
{
  const v = ex("Seu lance R$ 990,00 | Melhor R$ 1.100,00 | Inicial R$ 2.000,00");
  ok("tres valores", v.length === 3, v);
  ok("ordem decrescente", v[0] === 2000 && v[1] === 1100 && v[2] === 990, v);
}

console.log("\n[3] Nao confunde numero de item com dinheiro");
{
  const v = ex("Item 4 do pregao 90013 — lance R$ 875,00");
  ok("so o valor monetario", v.length === 1 && v[0] === 875, v);
}

console.log("\n[4] Texto sem valor");
ok("array vazio", ex("Pregoeiro: disputa encerrada").length === 0);
ok("string vazia", ex("").length === 0);

console.log("\n[5] Centavos preservados exatamente");
{
  const v = ex("R$ 1.000,01");
  ok("1000.01 exato", v[0] === 1000.01, v);
}

console.log(f === 0 ? "\n🎉 TODOS OS TESTES PASSARAM\n" : `\n💥 ${f} FALHA(S)\n`);
process.exit(f === 0 ? 0 : 1);
