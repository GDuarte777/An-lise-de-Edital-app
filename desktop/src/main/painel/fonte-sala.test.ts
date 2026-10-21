/**
 * Testes da fonte que opera pela sala. A página é falsa: devolve o que o agente real
 * devolveria e registra o que foi mandado executar nela. O que se prova aqui é o
 * caminho inteiro — ler a tela, decidir com o motor novo, digitar o lance — e as duas
 * paradas que protegem dinheiro: sem piso não arma, e "não confirmou" para o item.
 */
import { readFileSync } from "node:fs";

import { FonteSalaViva } from "./fonte-sala.js";
import type { EstadoPainel } from "../../compartilhado/painel.js";

let falhas = 0;
function ok(label: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${extra !== undefined ? `\n     ${JSON.stringify(extra)}` : ""}`);
    falhas++;
  }
}

const pausa = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));

const TELA = {
  ausente: false,
  disputa: {
    titulo: "Pregão Eletrônico N° 90012/2026",
    uasg: "160123",
    orgao: "COMANDO DO EXÉRCITO",
    compra: "90012026",
    tempoRestante: "00:04:12",
    segundosRestantes: 252,
    conexaoCaiu: false,
    naSalaDeDisputa: true
  },
  itens: [
    {
      numero: "7",
      melhorValor: 1000,
      meuValor: null,
      aberto: true,
      situacao: "aberto",
      fase: "Item 7 - CAFÉ TORRADO E MOÍDO",
      segundosRestantes: 252,
      posicao: 3,
      participantes: 5
    },
    {
      numero: "8",
      melhorValor: 2000,
      meuValor: null,
      aberto: false,
      situacao: "encerrado",
      fase: "Item 8 - AÇÚCAR",
      segundosRestantes: null
    }
  ],
  chat: [{ autor: "Pregoeiro", texto: "Item 7 em disputa.", em: "2026-10-15T12:00:00.000Z" }]
};

function montar(opcoes: { tela?: unknown; envio?: unknown } = {}) {
  const executados: string[] = [];
  const estados: EstadoPainel[] = [];
  let destruida = false;

  const conteudo = {
    isDestroyed: () => destruida,
    executeJavaScript: async (script: string) => {
      executados.push(script);
      if (script.includes("enviarLance")) return opcoes.envio ?? { ok: true, aceito: true, confirmado: true, motivo: "HTTP 200" };
      if (script.includes("classificacao(") && !script.includes("cartoes")) return { meuValor: 990, valores: [990, 1000, 1100] };
      return opcoes.tela ?? TELA;
    }
  };

  const fonte = new FonteSalaViva({
    obterConteudo: () => conteudo as never,
    garantirSala: async () => conteudo as never,
    intervaloMs: 5_000, // uma leitura só; o resto do teste é por comando
    aoEstado: (e) => estados.push(e)
  });

  return { fonte, executados, estados, destruir: () => (destruida = true) };
}

console.log("\n[1] Uma leitura da sala vira painel");
{
  const { fonte, estados } = montar();
  await fonte.iniciar();
  await pausa(30);
  const e = fonte.estadoAtual();

  ok("cabeçalho da disputa", e.disputa.titulo === "Pregão Eletrônico N° 90012/2026", e.disputa);
  ok("UASG e órgão", e.disputa.uasg === "160123" && e.disputa.orgao === "COMANDO DO EXÉRCITO", e.disputa);
  ok("tempo como o portal mostra", e.disputa.tempoRestante === "00:04:12", e.disputa.tempoRestante);
  ok("dois itens", e.itens.length === 2, e.itens.length);
  ok("item aberto vira em-disputa", e.itens[0].fase === "em-disputa", e.itens[0]);
  ok("item fechado vira encerrado", e.itens[1].fase === "encerrado", e.itens[1]);
  ok("melhor valor na tela", e.itens[0].melhorValor === 1000, e.itens[0].melhorValor);
  ok("posição e participantes", e.itens[0].minhaPosicao === 3 && e.itens[0].participantes === 5, e.itens[0]);
  ok("descrição do item", /CAFÉ TORRADO/.test(e.itens[0].descricao), e.itens[0].descricao);
  ok("chat do pregoeiro", e.chat.length === 1 && e.chat[0].doPregoeiro === true, e.chat);
  ok("a tela foi avisada", estados.length > 0, estados.length);
  fonte.encerrar();
}

console.log("\n[2] Armar faz o lance ser digitado na sala");
{
  const { fonte, executados } = montar();
  await fonte.iniciar();
  await pausa(30);

  fonte.configurar("7", { pisoMinimo: 900, passoTipo: "fixo", passoValor: 10 });
  fonte.armar("7");
  await pausa(30);

  const envio = executados.find((s) => s.includes("enviarLance"));
  ok("mandou enviar", envio !== undefined);
  ok("no item certo", envio?.includes('acharItem("7")') === true, envio?.slice(0, 160));
  ok("com o valor calculado (1000 − 10)", envio?.includes("i, 990)") === true, envio?.slice(-80));
  ok("cartão mostra o robô ligado", fonte.estadoAtual().itens[0].armado === true);
  ok("meu valor atualizado", fonte.estadoAtual().itens[0].meuValor === 990, fonte.estadoAtual().itens[0].meuValor);
  ok("log do aceite", fonte.estadoAtual().log.some((l) => l.nivel === "sucesso"), fonte.estadoAtual().log);
  fonte.encerrar();
}

console.log("\n[3] Sem piso não arma");
{
  const { fonte, executados } = montar();
  await fonte.iniciar();
  await pausa(30);
  fonte.armar("7");
  await pausa(20);
  ok("nada foi enviado", executados.every((s) => !s.includes("enviarLance")));
  ok("pediu o lance mínimo", fonte.estadoAtual().log.some((l) => /lance mínimo/.test(l.msg)), fonte.estadoAtual().log);
  ok("segue desarmado", fonte.estadoAtual().itens[0].armado === false);
  fonte.encerrar();
}

console.log("\n[4] Piso é respeitado antes de digitar");
{
  const { fonte, executados } = montar();
  await fonte.iniciar();
  await pausa(30);
  fonte.configurar("7", { pisoMinimo: 995, passoValor: 10 });
  fonte.armar("7");
  await pausa(30);
  ok("nenhum lance abaixo do piso", executados.every((s) => !s.includes("enviarLance")));
  ok("robô parado e explicado", /piso/i.test(fonte.estadoAtual().itens[0].ultimaRecusa ?? ""), fonte.estadoAtual().itens[0].ultimaRecusa);
  fonte.encerrar();
}

console.log("\n[5] “Cliquei e não sei o que aconteceu” para o item");
{
  const { fonte } = montar({ envio: { ok: true, aceito: false, confirmado: false, motivo: "sem confirmação em 6s" } });
  await fonte.iniciar();
  await pausa(30);
  fonte.configurar("7", { pisoMinimo: 900, passoValor: 10 });
  fonte.armar("7");
  await pausa(30);

  ok("desarmou o item", fonte.estadoAtual().itens[0].armado === false, fonte.estadoAtual().itens[0]);
  ok(
    "motivo fala de lance dobrado",
    /lance dobrado/i.test(fonte.estadoAtual().log.map((l) => l.msg).join(" ")),
    fonte.estadoAtual().log.map((l) => l.msg)
  );
  fonte.encerrar();
}

console.log("\n[6] Recusa do portal com código conhecido");
{
  const { fonte } = montar({
    envio: { ok: true, aceito: false, confirmado: true, motivo: "O portal recusou: ULTRAPASSA_VALOR_MINIMO" }
  });
  await fonte.iniciar();
  await pausa(30);
  fonte.configurar("7", { pisoMinimo: 900, passoValor: 10 });
  fonte.armar("7");
  await pausa(30);
  ok("desarmou pelo código do portal", fonte.estadoAtual().itens[0].armado === false);
  ok(
    "log traz o código",
    fonte.estadoAtual().log.some((l) => /ULTRAPASSA_VALOR_MINIMO/.test(l.msg)),
    fonte.estadoAtual().log.map((l) => l.msg)
  );
  fonte.encerrar();
}

console.log("\n[7] Sala sem o leitor ativo");
{
  const { fonte } = montar({ tela: { ausente: true } });
  await fonte.iniciar();
  await pausa(30);
  ok("nenhum item inventado", fonte.estadoAtual().itens.length === 0);
  ok("avisa que o leitor não está ativo", fonte.estadoAtual().log.some((l) => /leitor do robô/.test(l.msg)), fonte.estadoAtual().log);
  ok("conexão marcada como instável", fonte.estadoAtual().disputa.conexao === "instavel", fonte.estadoAtual().disputa.conexao);
  fonte.encerrar();
}

console.log("\n[8] Classificação");
{
  const { fonte } = montar();
  await fonte.iniciar();
  await pausa(30);
  const linhas = await fonte.classificacao("7");
  ok("três linhas", linhas.length === 3, linhas);
  ok("ordem por preço", linhas[0].valor === 990 && linhas[0].posicao === 1, linhas[0]);
  ok("o nosso lance é marcado", linhas[0].eu === true && linhas[0].fornecedor === "Você", linhas[0]);
  ok("concorrente não ganha nome inventado", linhas[1].fornecedor === "Concorrente", linhas[1]);
  fonte.encerrar();
}

console.log("\n[9] Janela da sala fechada");
{
  const { fonte, destruir } = montar();
  await fonte.iniciar();
  await pausa(30);
  destruir();
  const linhas = await fonte.classificacao("7");
  ok("classificação não quebra", linhas.length === 0);
  fonte.encerrar();
}

console.log("\n[10] As funções usadas na página existem de verdade");
{
  // Esta checagem é a que pega rename: os scripts chamam o agente por nome, e o agente
  // vive em outro arquivo. Sem isto, trocar o nome de `cartoes` só apareceria em disputa.
  const fonteSala = readFileSync(new URL("./fonte-sala.ts", import.meta.url), "utf-8");
  const agente = readFileSync(new URL("../engine/motor-extensao.ts", import.meta.url), "utf-8");
  const exportado = agente.slice(agente.indexOf("window.__lancebot = {"));

  const usadas = [...new Set([...fonteSala.matchAll(/\bb\.([a-zA-Z]+)\s*\(/g)].map((m) => m[1]))];
  ok("os scripts usam pelo menos 5 funções do agente", usadas.length >= 5, usadas);
  for (const nome of usadas) {
    ok(`agente expõe ${nome}`, new RegExp(`\\b${nome}\\b`).test(exportado), exportado.slice(0, 200));
  }
}

console.log(falhas === 0 ? "\n🎉 fonte da sala: tudo passou\n" : `\n💥 ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
