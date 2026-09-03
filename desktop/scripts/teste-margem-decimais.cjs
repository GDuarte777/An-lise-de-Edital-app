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

console.log("\n[1] Empate: o caso que a opcao existe para resolver");
{
  // Concorrente digitou exatamente o mesmo valor do operador.
  const empate = tela({ melhorValor: 1000, meuValor: 1000 });

  const sem = margem.decidir(cfg({ decimais: false }), empate, agora);
  ok("sem a opcao, apenas aguarda", sem.acao === "aguardar", sem);
  ok("e ensina como desempatar", /casas decimais/i.test(sem.motivo), sem);

  const com = margem.decidir(cfg({ decimais: true }), empate, agora);
  ok("com a opcao, desempata", com.acao === "enviar", com);
  ok("por exatamente um centesimo de centavo", com.valor === 999.9999, com);
  ok("marcado como desempate", com.desempate === true, com);
}

console.log("\n[2] O passo decimal NAO vira porta dos fundos");
{
  // Já ofertamos o desempate; o concorrente cobriu. Não há mais espaço abaixo do mínimo.
  const depois = tela({ melhorValor: 999.9999, meuValor: 999.9999 });
  const r = margem.decidir(cfg({ piso: 1000, decimais: true }), depois, agora);
  ok("nao desce um segundo passo", r.acao !== "enviar", r);

  // Concorrente MUITO abaixo do mínimo: a opção não autoriza persegui-lo.
  const fundo = tela({ melhorValor: 500, meuValor: 1000 });
  const r2 = margem.decidir(cfg({ piso: 1000, decimais: true }), fundo, agora);
  ok("nao persegue lance muito abaixo do minimo", r2.acao === "parar", r2);
  ok("e diz que a margem estourou", /margem estourada/i.test(r2.motivo), r2);
}

console.log("\n[3] Sem empate, a opcao nao muda nada");
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
