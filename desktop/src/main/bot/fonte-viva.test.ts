/**
 * Teste de ponta a ponta das três camadas juntas, com socket e transporte falsos:
 * mensagem do portal entra pelo WebSocket, o motor decide, o lance sai pelo REST e o
 * painel enxerga o resultado. Nenhuma rede, nenhum Electron.
 */
import { FonteViva, extrairClassificacao, extrairMensagens, paraConfiguracaoMotor, TOPICOS } from "./fonte-viva.js";
import { ClienteStomp, type AbrirSocket, type ManipuladoresSocket, type SocketStomp } from "./stomp/cliente.js";
import { analisar, serializar, type Quadro } from "./stomp/quadros.js";
import { PortalRest, type PedidoHttp, type RespostaHttp } from "./rest/portal.js";
import type { EstadoPainel } from "../../compartilhado/painel.js";

let falhas = 0;
function ok(label: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${extra !== undefined ? `\n     ${JSON.stringify(extra)}` : ""}`);
    falhas++;
  }
}

const pausa = () => new Promise<void>((r) => setTimeout(r, 0));
const COMPRA = "900123/2026";

class SocketFalso implements SocketStomp {
  enviados: string[] = [];
  constructor(private readonly m: ManipuladoresSocket) {}
  enviar(t: string): void {
    this.enviados.push(t);
  }
  fechar(): void {}
  abrir(): void {
    this.m.aoAbrir();
  }
  texto(t: string): void {
    this.m.aoTexto(t);
  }
  cair(motivo: string): void {
    this.m.aoFechar(motivo);
  }
  quadros(comando: string): Quadro[] {
    return this.enviados.filter((e) => e !== "\n").map(analisar).filter((q) => q.comando === comando);
  }
}

function montar(respostas: Record<string, RespostaHttp> = {}) {
  const sockets: SocketFalso[] = [];
  const abrirSocket: AbrirSocket = (_url, _p, m) => {
    const s = new SocketFalso(m);
    sockets.push(s);
    return s;
  };
  const pedidos: PedidoHttp[] = [];
  const portal = new PortalRest({
    ambiente: "treinamento",
    transporte: async (pedido) => {
      pedidos.push(pedido);
      for (const [marca, resposta] of Object.entries(respostas)) {
        if (pedido.url.includes(marca)) return resposta;
      }
      return { status: 200, corpo: "{}" };
    },
    autorizacao: () => "Bearer token-1",
    captcha: async () => "captcha-1",
    aoEvento: () => {}
  });

  let fonte: FonteViva | null = null;
  const cliente = new ClienteStomp({
    url: "wss://portal.exemplo/socket",
    autorizacao: () => "Bearer token-1",
    abrirSocket,
    aoEvento: (e) => fonte?.aoEventoConexao(e)
  });
  fonte = new FonteViva({ compra: COMPRA, cliente, portal });

  const estados: EstadoPainel[] = [];
  fonte.assinar((e) => estados.push(e));

  cliente.conectar();
  sockets[0].abrir();
  sockets[0].texto("CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\u0000");

  const mensagem = (destino: string, corpo: unknown) => {
    const subs = sockets[0].quadros("SUBSCRIBE");
    const assinatura = subs.find((q) => q.cabecalhos.destination === destino);
    if (!assinatura) throw new Error(`Tópico não assinado: ${destino}`);
    sockets[0].texto(
      serializar({
        comando: "MESSAGE",
        cabecalhos: { subscription: assinatura.cabecalhos.id, destination: destino },
        corpo: JSON.stringify(corpo)
      })
    );
  };

  const topico = (padrao: string) => padrao.replace("{compra}", COMPRA);
  const ultimo = () => fonte!.estadoAtual();
  return { fonte: fonte!, sockets, pedidos, estados, mensagem, topico, ultimo };
}

const ITEM = {
  numeroItem: "7",
  numeroCompra: COMPRA,
  situacaoItem: "EM_DISPUTA",
  valorMelhorLance: "1.000,00",
  segundosRestantes: 300
};

console.log("\n[1] Assinaturas e conexão");
{
  const { sockets, ultimo, topico } = montar();
  const destinos = sockets[0].quadros("SUBSCRIBE").map((q) => q.cabecalhos.destination);
  ok("assinou itens, lances, chat e avisos", destinos.length === 4, destinos);
  ok("tópico com a compra no lugar", destinos.includes(topico(TOPICOS.itens)), destinos);
  ok("conexão ligada no painel", ultimo().disputa.conexao === "ligada", ultimo().disputa.conexao);
  ok("origem é o websocket", ultimo().disputa.origem === "websocket");
}

console.log("\n[2] Mensagem do portal aparece no painel");
{
  const { mensagem, topico, ultimo, pedidos } = montar();
  mensagem(topico(TOPICOS.itens), ITEM);
  await pausa();

  const item = ultimo().itens[0];
  ok("item apareceu", item?.numero === "7", ultimo().itens);
  ok("melhor valor convertido", item?.melhorValor === 1000, item?.melhorValor);
  ok("fase em disputa", item?.fase === "em-disputa", item?.fase);
  // O tempo é projetado do instante da leitura, então já descontou os milissegundos
  // gastos no caminho — é 300s menos o que passou, não 300s congelado.
  ok("tempo da disputa projetado no cabeçalho", Math.round(ultimo().disputa.segundosRestantes ?? 0) === 300, ultimo().disputa.segundosRestantes);
  ok("e formatado para a tela", /^00:0[45]:\d\d$/.test(ultimo().disputa.tempoRestante ?? ""), ultimo().disputa.tempoRestante);
  ok("item não armado não gera lance", pedidos.length === 0, pedidos.length);
}

console.log("\n[3] Armar faz o lance sair pelo REST");
{
  const { fonte, mensagem, topico, pedidos, ultimo } = montar();
  mensagem(topico(TOPICOS.itens), ITEM);
  await pausa();

  fonte.configurar("7", { pisoMinimo: 900, passoTipo: "fixo", passoValor: 10 });
  fonte.armar("7");
  await pausa();

  const lance = pedidos.find((p) => p.metodo === "POST");
  ok("POST de lance enviado", lance !== undefined, pedidos.map((p) => p.metodo));
  ok("na rota do item", lance?.url.includes("/itens/7/lances") === true, lance?.url);
  ok("corpo exato", lance?.corpo === '{"valorInformado":"990.00","faseItem":"EM_DISPUTA"}', lance?.corpo);
  ok("painel mostra o item armado", ultimo().itens[0].armado === true);
  ok("nosso valor no cartão", ultimo().itens[0].meuValor === 990, ultimo().itens[0].meuValor);
  ok("log registrou o aceite", ultimo().log.some((l) => l.nivel === "sucesso" && /aceito/.test(l.msg)), ultimo().log);
}

console.log("\n[4] Desarmar interrompe");
{
  const { fonte, mensagem, topico, pedidos } = montar();
  mensagem(topico(TOPICOS.itens), ITEM);
  await pausa();
  fonte.configurar("7", { pisoMinimo: 900, passoValor: 10 });
  fonte.armar("7");
  await pausa();
  const antes = pedidos.filter((p) => p.metodo === "POST").length;

  fonte.desarmar("7");
  mensagem(topico(TOPICOS.itens), { ...ITEM, valorMelhorLance: 950 });
  await pausa();
  ok("nenhum lance novo", pedidos.filter((p) => p.metodo === "POST").length === antes, antes);
  ok("cartão desarmado", fonte.estadoAtual().itens[0].armado === false);
}

console.log("\n[5] Armar sem configuração não arma");
{
  const { fonte, mensagem, topico, pedidos, ultimo } = montar();
  mensagem(topico(TOPICOS.itens), ITEM);
  await pausa();
  fonte.armar("7");
  await pausa();
  ok("não lançou", pedidos.filter((p) => p.metodo === "POST").length === 0);
  ok("explicou o porquê", ultimo().log.some((l) => /lance mínimo/.test(l.msg)), ultimo().log);
}

console.log("\n[6] Casas decimais: o operador escolhe, o portal manda");
{
  const comDizima = { ...ITEM, permitirDizima: true };

  const a = montar();
  a.mensagem(a.topico(TOPICOS.itens), comDizima);
  await pausa();
  a.fonte.configurar("7", { pisoMinimo: 900, passoValor: 10, permitirDecimais: false });
  a.fonte.armar("7");
  await pausa();
  ok(
    "sem a opção ligada, duas casas",
    a.pedidos.find((p) => p.metodo === "POST")?.corpo?.includes('"990.00"') === true,
    a.pedidos.find((p) => p.metodo === "POST")?.corpo
  );

  const b = montar();
  b.mensagem(b.topico(TOPICOS.itens), comDizima);
  await pausa();
  b.fonte.configurar("7", { pisoMinimo: 900, passoValor: 10, permitirDecimais: true });
  b.fonte.armar("7");
  await pausa();
  ok(
    "com a opção ligada, quatro casas",
    b.pedidos.find((p) => p.metodo === "POST")?.corpo?.includes('"990.0000"') === true,
    b.pedidos.find((p) => p.metodo === "POST")?.corpo
  );

  const c = montar();
  c.mensagem(c.topico(TOPICOS.itens), ITEM); // item sem dízima
  await pausa();
  c.fonte.configurar("7", { pisoMinimo: 900, passoValor: 10, permitirDecimais: true });
  c.fonte.armar("7");
  await pausa();
  ok(
    "opção ligada não cria casa que o portal não aceita",
    c.pedidos.find((p) => p.metodo === "POST")?.corpo?.includes('"990.00"') === true,
    c.pedidos.find((p) => p.metodo === "POST")?.corpo
  );
}

console.log("\n[7] Chat");
{
  const { mensagem, topico, ultimo } = montar();
  mensagem(topico(TOPICOS.chat), { autor: "Pregoeiro", texto: "Disputa aberta para o item 7." });
  mensagem(topico(TOPICOS.chat), { autor: "Fornecedor X", mensagem: "Bom dia." });
  await pausa();

  ok("duas mensagens no painel", ultimo().chat.length === 2, ultimo().chat);
  ok("pregoeiro marcado", ultimo().chat[0].doPregoeiro === true, ultimo().chat[0]);
  ok("fala do pregoeiro vai para o log", ultimo().log.some((l) => l.nivel === "pregoeiro"), ultimo().log);
  ok("mensagem sem texto é descartada", extrairMensagens({ autor: "X" }).length === 0);
}

console.log("\n[8] Classificação");
{
  const { fonte } = montar({
    "lances/por-participante": {
      status: 200,
      corpo: JSON.stringify([
        { fornecedor: "Beta", valorLance: "1.000,00" },
        { fornecedor: "Alfa", valorLance: "990,00", meuLance: true },
        { fornecedor: "Gama", valorLance: "ilegível" }
      ])
    }
  });
  const linhas = await fonte.classificacao("7");
  ok("duas linhas legíveis", linhas.length === 2, linhas);
  ok("ordenou pelo preço", linhas[0].fornecedor === "Alfa" && linhas[0].posicao === 1, linhas);
  ok("marcou o nosso lance", linhas[0].eu === true, linhas[0]);
  ok("respeita posição informada quando vem", extrairClassificacao([{ posicao: 2, valor: 10 }, { posicao: 1, valor: 20 }])[0].valor === 20);
}

console.log("\n[9] Queda do socket aparece no painel");
{
  const { sockets, ultimo } = montar();
  sockets[0].cair("portal fechou o socket");
  await pausa();
  ok("conexão instável (vai reconectar)", ultimo().disputa.conexao === "instavel", ultimo().disputa.conexao);
  ok("log registrou a queda", ultimo().log.some((l) => /canal de disputa caiu/i.test(l.msg)), ultimo().log);
}

console.log("\n[10] Carga inicial sem captcha avisa em vez de falhar");
{
  const sockets: SocketFalso[] = [];
  const abrirSocket: AbrirSocket = (_u, _p, m) => {
    const s = new SocketFalso(m);
    sockets.push(s);
    return s;
  };
  const portal = new PortalRest({
    ambiente: "treinamento",
    transporte: async () => ({ status: 200, corpo: "{}" }),
    autorizacao: () => "Bearer t",
    captcha: async () => null
  });
  const cliente = new ClienteStomp({ url: "wss://x/y", autorizacao: () => "Bearer t", abrirSocket });
  const fonte = new FonteViva({ compra: COMPRA, cliente, portal });
  await fonte.cargaInicial();
  ok(
    "pede o captcha da janela do operador",
    fonte.estadoAtual().log.some((l) => /captcha/i.test(l.msg)),
    fonte.estadoAtual().log
  );
  fonte.encerrar();
}

console.log("\n[11] Config da tela → config do motor");
{
  const cfg = paraConfiguracaoMotor({
    pisoMinimo: null,
    passoTipo: "percentual",
    passoValor: 0,
    modo: "margem",
    margemPercentual: 5,
    valorFechado: null,
    permitirDecimais: true,
    somenteSegundosFinais: true,
    segundosJanela: 30
  });
  ok("piso vazio vira 0 (motor recusa e explica)", cfg.pisoMinimo === 0, cfg.pisoMinimo);
  ok("passo zero não vira passo", cfg.passo === undefined, cfg.passo);
  ok("margem repassada", cfg.margemPercentual === 5);
  ok("janela final ligada", cfg.janelaFinal?.ativo === true && cfg.janelaFinal.segundos === 30, cfg.janelaFinal);
}

console.log(falhas === 0 ? "\n🎉 fonte viva: tudo passou\n" : `\n💥 ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
