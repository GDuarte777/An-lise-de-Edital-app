/**
 * As duas regras novas mexem em DINHEIRO, então vivem em teste próprio.
 *
 * "Permitir lances em casas decimais" faz o robô ofertar ABAIXO do mínimo configurado —
 * um centésimo de centavo — para passar à frente de quem digitou exatamente o mesmo
 * valor. É o que a opção significa; o que estes testes garantem é que ela nunca desce
 * mais que um passo, e nunca sem empate.
 *
 * "Disputar apenas nos segundos finais" falha FECHADA: sem saber o tempo, não oferta.
 */
const M = require("../../extensao-lancebot/margem.js") || global.__lancebotMargem;
const margem = M.decidir ? M : global.__lancebotMargem;

let falhas = 0;
const ok = (r, c, x) => {
  if (c) console.log(`  ✅ ${r}`);
  else { console.log(`  ❌ ${r}${x !== undefined ? " -> " + JSON.stringify(x) : ""}`); falhas++; }
};

const agora = Date.now();
const tela = (p) => ({ melhorValor: 1000, aberto: true, lidoEm: agora, ...p });
const cfg = (p) => ({ piso: 1000, decremento: 1, tipo: "fixo", ...p });

console.log("\n[1] A briga de centavos, no exemplo do operador");
{
  // Minimo configurado: R$ 550,99. Com a opcao ligada, o robo disputa os CENTAVOS ate
  // R$ 550,00 — o valor cheio abaixo do configurado. Os reais nao sao negociaveis.
  const c = (p) => cfg({ piso: 550.99, decremento: 1, decimais: true, ...p });

  ok("o minimo efetivo vira 550,00", margem.pisoEfetivo(c()) === 550, margem.pisoEfetivo(c()));

  // Concorrente cobre o minimo nos centavos.
  const cobriu = tela({ melhorValor: 550.98, meuValor: 550.99 });
  const r = margem.decidir(c(), cobriu, agora);
  ok("desce um centavo abaixo do concorrente", r.acao === "enviar" && r.valor === 550.97, r);
  ok("marcado como briga de centavos", r.centavos === true, r);

  // A briga continua descendo.
  ok("segue centavo a centavo",
     margem.decidir(c(), tela({ melhorValor: 550.5, meuValor: 550.97 }), agora).valor === 550.49);
  ok("um centavo acima do fundo ainda oferta",
     margem.decidir(c(), tela({ melhorValor: 550.01, meuValor: 550.02 }), agora).valor === 550);

  // E para no valor cheio.
  const fundo = margem.decidir(c(), tela({ melhorValor: 550, meuValor: 550.01 }), agora);
  ok("NAO desce abaixo de 550,00", fundo.acao === "parar", fundo);
  ok("e diz que a margem estourou", /margem estourada/i.test(fundo.motivo), fundo);

  // Empate exato tambem e disputado.
  const empate = margem.decidir(c(), tela({ melhorValor: 550.99, meuValor: 550.99 }), agora);
  ok("desempata quem digitou o mesmo valor", empate.acao === "enviar" && empate.valor === 550.98, empate);
}

console.log("\n[2] Sem a opcao, o minimo e intocavel");
{
  const c = cfg({ piso: 550.99, decremento: 1, decimais: false });
  const r = margem.decidir(c, tela({ melhorValor: 550.98, meuValor: 550.99 }), agora);
  ok("nao desce nos centavos", r.acao === "parar", r);

  const emp = margem.decidir(c, tela({ melhorValor: 550.99, meuValor: 550.99 }), agora);
  ok("empate apenas aguarda", emp.acao === "aguardar", emp);
  ok("e ensina ate onde a opcao iria", /550,00|550\.00/.test(emp.motivo), emp);

  // Minimo redondo: nao ha centavo nenhum para brigar.
  const redondo = cfg({ piso: 550, decremento: 1, decimais: true });
  ok("minimo redondo nao abre espaco",
     margem.decidir(redondo, tela({ melhorValor: 550, meuValor: 550 }), agora).acao === "parar");
}

console.log("\n[3] Longe do minimo, a opcao nao muda nada");
{
  const normal = tela({ melhorValor: 1200, meuValor: 1300 });
  const a = margem.decidir(cfg({ piso: 1000, decremento: 1, decimais: false }), normal, agora);
  const b = margem.decidir(cfg({ piso: 1000, decremento: 1, decimais: true }), normal, agora);
  ok("mesmo lance com e sem a opcao", a.acao === "enviar" && b.acao === "enviar" && a.valor === b.valor, { a, b });
  ok("e o lance e o decremento normal", a.valor === 1199, a);
}

console.log("\n[4] Disputar apenas nos segundos finais");
{
  const c = cfg({ piso: 500, segundosFinais: 10 });

  const cedo = margem.decidir(c, tela({ segundosRestantes: 120 }), agora);
  ok("cedo demais: aguarda", cedo.acao === "aguardar", cedo);
  ok("e diz quanto falta", /faltam 120s/i.test(cedo.motivo), cedo);

  const naHora = margem.decidir(c, tela({ segundosRestantes: 8 }), agora);
  ok("nos segundos finais: oferta", naHora.acao === "enviar", naHora);

  // Falha FECHADA: sem o tempo na tela, nao arrisca ofertar cedo.
  const semTempo = margem.decidir(c, tela({ segundosRestantes: null }), agora);
  ok("sem saber o tempo, NAO oferta", semTempo.acao === "parar", semTempo);
  ok("e explica por que", /tempo restante/i.test(semTempo.motivo), semTempo);

  // Sem a opcao ligada, tempo desconhecido nao atrapalha.
  const semOpcao = margem.decidir(cfg({ piso: 500 }), tela({ segundosRestantes: null }), agora);
  ok("opcao desligada nao exige o tempo", semOpcao.acao === "enviar", semOpcao);
}

console.log("\n[5] As travas antigas continuam de pe");
{
  const c = cfg({ piso: 1000, decimais: true, segundosFinais: 10 });
  const velha = margem.decidir(c, tela({ melhorValor: 1000, meuValor: 1000, segundosRestantes: 5, lidoEm: agora - 20000 }), agora);
  ok("leitura velha nao vira lance nem com desempate", velha.acao === "parar", velha);
  const fechado = margem.decidir(c, tela({ aberto: false, meuValor: 1000, segundosRestantes: 5 }), agora);
  ok("item fechado nao vira lance", fechado.acao === "parar", fechado);
}

console.log(falhas === 0 ? "\n🎉 TODOS OS TESTES PASSARAM\n" : `\n💥 ${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
