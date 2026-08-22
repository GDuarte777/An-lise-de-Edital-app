import { EstrategiaMargem, arredondarCentavos } from "./strategy.js";

let falhas = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${extra !== undefined ? `\n     ${JSON.stringify(extra)}` : ""}`);
    falhas++;
  }
}

console.log("\n[1] Decremento fixo");
{
  const e = new EstrategiaMargem({ valorLimiteMinimo: 800, tipoDecremento: "fixo", valorDecremento: 15 });
  const d = e.decidir(1000);
  check("1000 - 15 = 985", d.acao === "enviar" && d.valor === 985, d);
}

console.log("\n[2] Decremento percentual");
{
  const e = new EstrategiaMargem({ valorLimiteMinimo: 800, tipoDecremento: "percentual", valorDecremento: 10 });
  const d = e.decidir(1000);
  check("1000 - 10% = 900", d.acao === "enviar" && d.valor === 900, d);
}

console.log("\n[3] Piso de margem — o caso que protege o dinheiro");
{
  const e = new EstrategiaMargem({ valorLimiteMinimo: 990, tipoDecremento: "fixo", valorDecremento: 15 });
  const d = e.decidir(1000);
  check("recusa lance abaixo do piso", d.acao === "recusar", d);
  check("motivo cita o piso", d.acao === "recusar" && d.motivo.includes("990.00"), d);
}

console.log("\n[4] Lance exatamente no piso é permitido");
{
  const e = new EstrategiaMargem({ valorLimiteMinimo: 985, tipoDecremento: "fixo", valorDecremento: 15 });
  const d = e.decidir(1000);
  check("985 com piso 985 -> envia", d.acao === "enviar" && d.valor === 985, d);
}

console.log("\n[5] Não cobre o próprio lance");
{
  const e = new EstrategiaMargem({ valorLimiteMinimo: 100, tipoDecremento: "fixo", valorDecremento: 10 });
  check("menor == nosso -> aguarda", e.decidir(500, 500).acao === "aguardar");
  check("menor > nosso -> aguarda", e.decidir(520, 500).acao === "aguardar");
  check("concorrente abaixou -> envia", e.decidir(490, 500).acao === "enviar");
}

console.log("\n[6] Entradas inválidas do portal falham fechado");
{
  const e = new EstrategiaMargem({ valorLimiteMinimo: 100, tipoDecremento: "fixo", valorDecremento: 10 });
  for (const v of [NaN, Infinity, 0, -50, undefined as unknown as number, null as unknown as number]) {
    check(`recusa menorLance=${String(v)}`, e.decidir(v).acao === "recusar");
  }
}

console.log("\n[7] Configuração inválida é rejeitada na construção");
{
  const ruins: Array<[string, () => void]> = [
    ["decremento zero", () => new EstrategiaMargem({ valorLimiteMinimo: 1, tipoDecremento: "fixo", valorDecremento: 0 })],
    ["decremento negativo", () => new EstrategiaMargem({ valorLimiteMinimo: 1, tipoDecremento: "fixo", valorDecremento: -5 })],
    ["percentual >= 100", () => new EstrategiaMargem({ valorLimiteMinimo: 1, tipoDecremento: "percentual", valorDecremento: 100 })],
    ["piso negativo", () => new EstrategiaMargem({ valorLimiteMinimo: -1, tipoDecremento: "fixo", valorDecremento: 5 })],
    ["piso NaN", () => new EstrategiaMargem({ valorLimiteMinimo: NaN, tipoDecremento: "fixo", valorDecremento: 5 })]
  ];
  for (const [label, fn] of ruins) {
    let lancou = false;
    try { fn(); } catch { lancou = true; }
    check(`rejeita ${label}`, lancou);
  }
}

console.log("\n[8] Arredondamento de centavos");
{
  check("0.1+0.2 -> 0.3", arredondarCentavos(0.1 + 0.2) === 0.3);
  check("1.005 -> 1.01", arredondarCentavos(1.005) === 1.01);
  const e = new EstrategiaMargem({ valorLimiteMinimo: 0.01, tipoDecremento: "percentual", valorDecremento: 33.333 });
  const d = e.decidir(100);
  check("percentual quebrado vira centavos", d.acao === "enviar" && Number.isInteger(d.valor * 100), d);
}

console.log(falhas === 0 ? "\n🎉 TODOS OS TESTES PASSARAM\n" : `\n💥 ${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
