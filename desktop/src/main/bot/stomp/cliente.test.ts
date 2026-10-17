/**
 * Testes do cliente STOMP com socket e relógio falsos. O que se quer provar aqui é o
 * comportamento ruim: socket que cai, portal que silencia, quadro partido em duas
 * leituras, token que mudou entre tentativas.
 */
import { ClienteStomp, type AbrirSocket, type ManipuladoresSocket, type SocketStomp, type Temporizador, type EventoStomp, montarUrlWebSocket } from "./cliente.js";
import { analisar, serializar, PULSO, type Quadro } from "./quadros.js";

let falhas = 0;
function ok(label: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${extra !== undefined ? `\n     ${JSON.stringify(extra)}` : ""}`);
    falhas++;
  }
}

class Relogio implements Temporizador {
  private t = 1_000_000;
  private seq = 0;
  private fila = new Map<number, { em: number; acao: () => void }>();

  agora(): number {
    return this.t;
  }

  agendar(ms: number, acao: () => void): () => void {
    const id = ++this.seq;
    this.fila.set(id, { em: this.t + ms, acao });
    return () => this.fila.delete(id);
  }

  avancar(ms: number): void {
    const alvo = this.t + ms;
    for (;;) {
      let proximo: { id: number; em: number; acao: () => void } | null = null;
      for (const [id, item] of this.fila) {
        if (item.em <= alvo && (proximo === null || item.em < proximo.em)) proximo = { id, ...item };
      }
      if (!proximo) break;
      this.fila.delete(proximo.id);
      this.t = proximo.em;
      proximo.acao();
    }
    this.t = alvo;
  }

  get pendentes(): number {
    return this.fila.size;
  }
}

class SocketFalso implements SocketStomp {
  enviados: string[] = [];
  fechado = false;

  constructor(
    readonly url: string,
    readonly subprotocolos: readonly string[],
    private readonly m: ManipuladoresSocket
  ) {}

  enviar(texto: string): void {
    this.enviados.push(texto);
  }

  fechar(): void {
    this.fechado = true;
  }

  abrir(): void {
    this.m.aoAbrir();
  }

  texto(t: string): void {
    this.m.aoTexto(t);
  }

  cair(motivo: string): void {
    this.m.aoFechar(motivo);
  }

  erro(mensagem: string): void {
    this.m.aoErro(new Error(mensagem));
  }

  get quadros(): Quadro[] {
    return this.enviados.filter((e) => e !== PULSO).map(analisar);
  }

  get pulsos(): number {
    return this.enviados.filter((e) => e === PULSO).length;
  }

  comando(nome: string): Quadro[] {
    return this.quadros.filter((q) => q.comando === nome);
  }
}

function montar(extra: Partial<Parameters<typeof criar>[0]> = {}) {
  return criar({ ...extra });
}

function criar(opcoes: {
  token?: () => string;
  pulso?: { envio: number; recepcao: number };
  toleranciaPulso?: number;
}) {
  const relogio = new Relogio();
  const sockets: SocketFalso[] = [];
  const eventos: EventoStomp[] = [];
  const abrirSocket: AbrirSocket = (url, subprotocolos, m) => {
    const s = new SocketFalso(url, subprotocolos, m);
    sockets.push(s);
    return s;
  };
  const cliente = new ClienteStomp({
    url: "wss://portal.exemplo/comprasnet-websocket/socket/websocket?protocolVersion=13",
    autorizacao: opcoes.token ?? (() => "Bearer token-1"),
    pulso: opcoes.pulso ?? { envio: 10_000, recepcao: 10_000 },
    toleranciaPulso: opcoes.toleranciaPulso,
    temporizador: relogio,
    abrirSocket,
    aoEvento: (e) => eventos.push(e)
  });
  const conectado = (heartBeat = "10000,10000") =>
    `CONNECTED\nversion:1.2\nheart-beat:${heartBeat}\n\n\u0000`;
  return { relogio, sockets, eventos, cliente, conectado, ultimo: () => sockets[sockets.length - 1] };
}

console.log("\n[1] CONNECT");
{
  const { cliente, sockets, ultimo, conectado } = montar();
  cliente.conectar();
  ok("abriu um socket", sockets.length === 1, sockets.length);
  ok("estado conectando", cliente.estado === "conectando", cliente.estado);
  ok("nada enviado antes de o socket abrir", ultimo().enviados.length === 0);

  ultimo().abrir();
  const connect = ultimo().comando("CONNECT")[0];
  ok("CONNECT enviado", connect !== undefined);
  ok("leva o token", connect?.cabecalhos.Authorization === "Bearer token-1", connect?.cabecalhos);
  ok("accept-version 1.2", connect?.cabecalhos["accept-version"] === "1.2");
  ok("host vem da URL", connect?.cabecalhos.host === "portal.exemplo", connect?.cabecalhos.host);
  ok("anuncia o pulso", connect?.cabecalhos["heart-beat"] === "10000,10000");
  ok("ainda não está conectado", cliente.estado === "conectando", cliente.estado);

  ultimo().texto(conectado());
  ok("CONNECTED promove o estado", cliente.estado === "conectado", cliente.estado);
}

console.log("\n[2] Token ausente não conecta");
{
  const { cliente, sockets, eventos } = montar({ token: () => "" });
  cliente.conectar();
  ok("nenhum socket aberto", sockets.length === 0);
  ok("estado parado", cliente.estado === "parado", cliente.estado);
  ok("avisou o motivo", eventos.some((e) => e.tipo === "desconectado" && e.motivo === "sem token de sessão"), eventos);
}

console.log("\n[3] Assinaturas");
{
  const { cliente, ultimo, conectado } = montar();
  const recebidas: string[] = [];
  const cancelar = cliente.assinar("/topic/disputa.123", (q) => recebidas.push(q.corpo));
  cliente.assinar("/topic/chat.123", (q) => recebidas.push(`chat:${q.corpo}`));

  cliente.conectar();
  ultimo().abrir();
  ultimo().texto(conectado());
  const subs = ultimo().comando("SUBSCRIBE");
  ok("assinaturas feitas antes de conectar são enviadas no CONNECTED", subs.length === 2, subs.length);
  ok("cada uma com id próprio", subs[0].cabecalhos.id !== subs[1].cabecalhos.id, subs.map((s) => s.cabecalhos.id));
  ok("ack auto", subs.every((s) => s.cabecalhos.ack === "auto"));

  const id = subs[0].cabecalhos.id;
  ultimo().texto(serializar({ comando: "MESSAGE", cabecalhos: { subscription: id, destination: "/topic/disputa.123" }, corpo: "lance" }));
  ok("MESSAGE roteada pela assinatura", recebidas.join("|") === "lance", recebidas);

  ultimo().texto(serializar({ comando: "MESSAGE", cabecalhos: { destination: "/topic/chat.123" }, corpo: "oi" }));
  ok("sem id, roteia pelo destino", recebidas.join("|") === "lance|chat:oi", recebidas);

  cancelar();
  const un = ultimo().comando("UNSUBSCRIBE")[0];
  ok("cancelar envia UNSUBSCRIBE com o id", un?.cabecalhos.id === id, un?.cabecalhos);
  ultimo().texto(serializar({ comando: "MESSAGE", cabecalhos: { subscription: id }, corpo: "tarde" }));
  ok("mensagem de assinatura cancelada não é entregue", recebidas.length === 2, recebidas);
}

console.log("\n[4] Quadro partido em duas leituras");
{
  const { cliente, ultimo, conectado } = montar();
  const recebidas: string[] = [];
  cliente.assinar("/topic/x", (q) => recebidas.push(q.corpo));
  cliente.conectar();
  ultimo().abrir();
  ultimo().texto(conectado());

  const bruto = serializar({ comando: "MESSAGE", cabecalhos: { destination: "/topic/x" }, corpo: "valor" });
  ultimo().texto(bruto.slice(0, 14));
  ok("metade não entrega nada", recebidas.length === 0, recebidas);
  ultimo().texto(bruto.slice(14));
  ok("a outra metade completa", recebidas.join("") === "valor", recebidas);
}

console.log("\n[5] Pulso");
{
  const { cliente, relogio, ultimo, conectado } = montar();
  cliente.conectar();
  ultimo().abrir();
  ultimo().texto(conectado("20000,5000"));

  relogio.avancar(9_000);
  ok("não pulsa antes da hora", ultimo().pulsos === 0, ultimo().pulsos);
  relogio.avancar(2_000);
  ok("pulsa no intervalo negociado", ultimo().pulsos === 1, ultimo().pulsos);
  relogio.avancar(10_000);
  ok("segue pulsando", ultimo().pulsos === 2, ultimo().pulsos);
}

console.log("\n[6] Silêncio do portal derruba e reconecta com recuo");
{
  const { cliente, relogio, sockets, eventos, ultimo, conectado } = montar();
  cliente.conectar();
  ultimo().abrir();
  ultimo().texto(conectado("20000,10000"));

  // Pulso negociado: espera 20s, tolerância 2 → 40s de silêncio é morte.
  relogio.avancar(39_000);
  ok("antes do limite segue conectado", cliente.estado === "conectado", cliente.estado);
  relogio.avancar(1_000);
  ok("silêncio além da tolerância derruba", cliente.estado === "aguardando-reconexao", cliente.estado);
  ok("socket morto foi fechado", sockets[0].fechado);
  ok("registrou pulso perdido", eventos.some((e) => e.tipo === "pulso-perdido"), eventos.map((e) => e.tipo));
  const queda = eventos.find((e) => e.tipo === "desconectado");
  ok("1ª queda agenda reconexão em 1s", queda?.tipo === "desconectado" && queda.reconectarEmMs === 1_000, queda);

  relogio.avancar(1_000);
  ok("reconectou", sockets.length === 2 && cliente.estado === "conectando", { n: sockets.length, estado: cliente.estado });
  ultimo().abrir();
  ultimo().texto(conectado());
  ok("volta a conectado", cliente.estado === "conectado", cliente.estado);
}

console.log("\n[7] Queda remota: recuo exponencial e token relido");
{
  let token = "Bearer token-1";
  const { cliente, relogio, sockets, eventos, ultimo } = montar({ token: () => token });
  cliente.conectar();
  ultimo().abrir();

  ultimo().cair("socket fechado pelo portal");
  ok("1ª falha: 1s", quedas(eventos).at(-1) === 1_000, quedas(eventos));
  relogio.avancar(1_000);
  ultimo().cair("de novo");
  ok("2ª falha: 2s", quedas(eventos).at(-1) === 2_000, quedas(eventos));
  relogio.avancar(2_000);
  ultimo().cair("e outra");
  ok("3ª falha: 4s", quedas(eventos).at(-1) === 4_000, quedas(eventos));

  token = "Bearer token-2";
  relogio.avancar(4_000);
  ultimo().abrir();
  const connect = ultimo().comando("CONNECT")[0];
  ok("token é lido de novo a cada tentativa", connect?.cabecalhos.Authorization === "Bearer token-2", connect?.cabecalhos);
  ok("quatro sockets abertos no total", sockets.length === 4, sockets.length);
}

function quedas(eventos: EventoStomp[]): number[] {
  return eventos.flatMap((e) => (e.tipo === "desconectado" && e.reconectarEmMs !== null ? [e.reconectarEmMs] : []));
}

console.log("\n[8] ERROR do portal");
{
  const { cliente, eventos, ultimo, conectado } = montar();
  cliente.conectar();
  ultimo().abrir();
  ultimo().texto(conectado());
  ultimo().texto("ERROR\nmessage:sessao expirada\n\ncorpo com dado de sessao\u0000");

  const erro = eventos.find((e) => e.tipo === "erro-servidor");
  ok("avisa o erro do servidor", erro?.tipo === "erro-servidor" && erro.mensagem === "sessao expirada", erro);
  ok("nenhum evento carrega o corpo", !JSON.stringify(eventos).includes("corpo com dado"), eventos);
  ok("derruba para reconectar", cliente.estado === "aguardando-reconexao", cliente.estado);
}

console.log("\n[9] Quadro ilegível derruba em vez de seguir fingindo");
{
  const { cliente, eventos, ultimo, conectado } = montar();
  cliente.conectar();
  ultimo().abrir();
  ultimo().texto(conectado());
  ultimo().texto("MESSAGE\nx:a\\q\n\n\u0000");
  ok("estado caiu", cliente.estado === "aguardando-reconexao", cliente.estado);
  ok("motivo é o do codec", eventos.some((e) => e.tipo === "desconectado" && /escape/i.test(e.motivo)), eventos);
}

console.log("\n[10] Desconexão deliberada não reconecta");
{
  const { cliente, relogio, sockets, ultimo, conectado } = montar();
  cliente.conectar();
  ultimo().abrir();
  ultimo().texto(conectado());
  cliente.desconectar();

  ok("DISCONNECT enviado", sockets[0].comando("DISCONNECT").length === 1);
  ok("socket fechado", sockets[0].fechado);
  ok("estado parado", cliente.estado === "parado", cliente.estado);
  ok("nenhum timer pendente", relogio.pendentes === 0, relogio.pendentes);
  relogio.avancar(120_000);
  ok("não reabriu socket", sockets.length === 1, sockets.length);

  let explodiu = false;
  try { cliente.enviar("/app/x", "{}"); } catch { explodiu = true; }
  ok("enviar desconectado é erro", explodiu);
}

console.log("\n[11] URL do WebSocket");
{
  ok(
    "produção vira wss com protocolVersion",
    montarUrlWebSocket("producao") ===
      "wss://cnetmobile.estaleiro.serpro.gov.br/comprasnet-websocket/socket/websocket?protocolVersion=13",
    montarUrlWebSocket("producao")
  );
  ok("treinamento aponta para tre-", montarUrlWebSocket("treinamento").includes("tre-cnetmobile"), montarUrlWebSocket("treinamento"));
}

console.log(falhas === 0 ? "\n🎉 cliente STOMP: tudo passou\n" : `\n💥 ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
