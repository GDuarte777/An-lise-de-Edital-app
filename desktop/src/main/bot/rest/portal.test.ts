/**
 * Testes do adapter REST. O que importa aqui: o lance sai com valor exato e uma única
 * vez, a leitura sem captcha não é tentada, e 401 não vira retentativa.
 */
import { PortalRest, extrairCodigoRecusa, type EventoRest, type PedidoHttp, type RespostaHttp } from "./portal.js";
import { paraMicro } from "../decimal.js";
import { Freio, Recuo } from "../limites.js";

let falhas = 0;
function ok(label: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${extra !== undefined ? `\n     ${JSON.stringify(extra)}` : ""}`);
    falhas++;
  }
}

function criar(
  respostas: (RespostaHttp | Error)[],
  extra: { captcha?: () => Promise<string | null>; token?: () => string; tentativas?: number } = {}
) {
  const pedidos: PedidoHttp[] = [];
  const eventos: EventoRest[] = [];
  const esperas: number[] = [];
  let i = 0;
  const portal = new PortalRest({
    ambiente: "treinamento",
    transporte: async (pedido) => {
      pedidos.push(pedido);
      const r = respostas[Math.min(i++, respostas.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
    autorizacao: extra.token ?? (() => "Bearer token-1"),
    captcha: extra.captcha ?? (async () => "tok-captcha/+1"),
    // Freio com piso real seria 200 ms por requisição; nos testes o piso é o mesmo, só
    // que o relógio de espera do recuo é instantâneo.
    freio: new Freio(),
    recuo: new Recuo(1_000, 60_000),
    tentativasMaximas: extra.tentativas,
    esperar: async (ms) => {
      esperas.push(ms);
    },
    aoEvento: (e) => eventos.push(e)
  });
  return { portal, pedidos, eventos, esperas };
}

const json = (status: number, corpo: unknown): RespostaHttp => ({ status, corpo: JSON.stringify(corpo) });

console.log("\n[1] Leitura com captcha");
{
  const { portal, pedidos } = criar([json(200, { itens: [{ numero: "1" }] })]);
  const r = await portal.ler("itensAguardandoDisputa", { compra: "900123/2026" });
  ok("resultado ok", r.estado === "ok", r);
  ok("JSON interpretado", r.estado === "ok" && (r.dados as { itens: unknown[] }).itens.length === 1, r);
  ok("host de treinamento", pedidos[0].url.startsWith("https://tre-cnetmobile.estaleiro.serpro.gov.br/"), pedidos[0].url);
  ok("compra escapada no caminho", pedidos[0].url.includes("900123%2F2026"), pedidos[0].url);
  ok("captcha escapado na query", pedidos[0].url.includes("captcha=tok-captcha%2F%2B1"), pedidos[0].url);
  ok("Authorization presente", pedidos[0].cabecalhos.Authorization === "Bearer token-1", pedidos[0].cabecalhos);
}

console.log("\n[2] Sem captcha não se lê");
{
  const { portal, pedidos, eventos } = criar([json(200, {})], { captcha: async () => null });
  const r = await portal.ler("comprasEmDisputa");
  ok("fail-closed", r.estado === "sem-captcha", r);
  ok("nenhuma requisição gasta", pedidos.length === 0, pedidos.length);
  ok("avisou o operador", eventos.some((e) => e.tipo === "sem-captcha"), eventos);
}

console.log("\n[3] 401 não vira retentativa");
{
  const { portal, pedidos, eventos } = criar([{ status: 401, corpo: "" }]);
  const r = await portal.ler("comprasEmDisputa");
  ok("sessão caiu", r.estado === "sessao-caiu", r);
  ok("uma única requisição", pedidos.length === 1, pedidos.length);
  ok("evento de sessão caída", eventos.some((e) => e.tipo === "sessao-caiu"), eventos);
}

console.log("\n[4] 429 recua e tenta de novo");
{
  const { portal, pedidos, esperas } = criar([{ status: 429, corpo: "" }, json(200, { ok: true })]);
  const r = await portal.ler("comprasEmDisputa");
  ok("acerta na segunda", r.estado === "ok", r);
  ok("duas requisições", pedidos.length === 2, pedidos.length);
  ok("esperou o recuo de 1s", esperas.join(",") === "1000", esperas);
}

console.log("\n[5] 5xx persistente para no limite de tentativas");
{
  const { portal, pedidos, esperas } = criar([{ status: 503, corpo: "indisponivel" }], { tentativas: 3 });
  const r = await portal.ler("comprasEmDisputa");
  ok("falha declarada", r.estado === "falha" && r.status === 503, r);
  ok("três tentativas, não mais", pedidos.length === 3, pedidos.length);
  ok("recuo exponencial entre elas", esperas.join(",") === "1000,2000", esperas);
}

console.log("\n[6] Envio do lance");
{
  const { portal, pedidos } = criar([json(200, { aceito: true })]);
  const r = await portal.enviarLance({
    compra: "900123/2026",
    item: "7",
    valor: paraMicro(550.99),
    casas: 2,
    fase: "ABERTA"
  });
  ok("aceito", r.estado === "aceito", r);
  ok("é POST", pedidos[0].metodo === "POST", pedidos[0].metodo);
  ok("sem captcha na URL do lance", !pedidos[0].url.includes("captcha"), pedidos[0].url);
  ok(
    "corpo exato",
    pedidos[0].corpo === '{"valorInformado":"550.99","faseItem":"ABERTA"}',
    pedidos[0].corpo
  );
  ok("content-type json", pedidos[0].cabecalhos["content-type"] === "application/json", pedidos[0].cabecalhos);
}

console.log("\n[7] O centavo que o robô analisado perdia");
{
  // 4.35 em ponto flutuante é 4.3499999…; Math.floor(4.35 * 100) / 100 dá 4.34.
  const { portal, pedidos } = criar([json(200, {})]);
  await portal.enviarLance({ compra: "1", item: "1", valor: paraMicro(4.35), casas: 2, fase: "ABERTA" });
  ok("4.35 sai 4.35, não 4.34", pedidos[0].corpo?.includes('"4.35"') === true, pedidos[0].corpo);

  const d = criar([json(200, {})]);
  await d.portal.enviarLance({ compra: "1", item: "1", valor: paraMicro(550.9999), casas: 4, fase: "ABERTA" });
  ok("dízima permitida vai com 4 casas", d.pedidos[0].corpo?.includes('"550.9999"') === true, d.pedidos[0].corpo);
}

console.log("\n[8] Recusa do portal");
{
  const { portal } = criar([
    { status: 400, corpo: JSON.stringify({ codigo: "ULTRAPASSA_VALOR_MINIMO", message: "Valor abaixo do mínimo" }) }
  ]);
  const r = await portal.enviarLance({ compra: "1", item: "1", valor: paraMicro(10), casas: 2, fase: "ABERTA" });
  ok("classificada pelo código", r.estado === "recusado" && r.codigo === "ULTRAPASSA_VALOR_MINIMO", r);
  ok("mensagem legível", r.estado === "recusado" && r.mensagem === "Valor abaixo do mínimo", r);

  ok("código reconhecido no corpo cru", extrairCodigoRecusa("erro: NAO_RESPEITA_VARIACAO_MELHOR_LANCE aqui") === "NAO_RESPEITA_VARIACAO_MELHOR_LANCE");
  ok("corpo sem código conhecido não é adivinhado", extrairCodigoRecusa('{"message":"deu errado"}') === null);
}

console.log("\n[9] Lance nunca é repetido sozinho");
{
  const { portal, pedidos, esperas } = criar([{ status: 500, corpo: "erro interno" }]);
  const r = await portal.enviarLance({ compra: "1", item: "1", valor: paraMicro(10), casas: 2, fase: "ABERTA" });
  ok("falha devolvida ao motor", r.estado === "falha" && r.status === 500, r);
  ok("uma requisição só, mesmo em 5xx", pedidos.length === 1, pedidos.length);
  ok("nenhum recuo automático", esperas.length === 0, esperas);
}

console.log("\n[10] Rede e sessão");
{
  const queda = criar([new Error("getaddrinfo ENOTFOUND")]);
  const r = await queda.portal.enviarLance({ compra: "1", item: "1", valor: paraMicro(10), casas: 2, fase: "ABERTA" });
  ok("rede caída é status 0, não 500", r.estado === "falha" && r.status === 0, r);

  const semToken = criar([json(200, {})], { token: () => "" });
  let explodiu = false;
  try {
    await semToken.portal.usuario();
  } catch {
    explodiu = true;
  }
  ok("sem token a requisição é abortada", explodiu);

  const viva = criar([json(200, { cnpj: "***" })]);
  ok("usuario() não leva captcha", (await viva.portal.usuario()).estado === "ok" && !viva.pedidos[0].url.includes("captcha"), viva.pedidos[0]?.url);
  ok("usuario() não exige token de captcha para existir", viva.pedidos.length === 1);

  const retoken = criar([json(200, { token: "novo" })]);
  const rr = await retoken.portal.renovarToken();
  ok("renovarToken é POST", rr.estado === "ok" && retoken.pedidos[0].metodo === "POST", retoken.pedidos[0]);
}

console.log("\n[11] Rota desconhecida é erro de programação");
{
  const { portal } = criar([json(200, {})]);
  let explodiu = false;
  try {
    await portal.ler("rotaQueNaoExiste");
  } catch {
    explodiu = true;
  }
  ok("não improvisa URL", explodiu);
}

console.log("\n[12] Log não guarda sessão");
{
  const { portal, eventos } = criar([json(200, { segredo: "nao-deveria-aparecer" })]);
  await portal.ler("comprasEmDisputa");
  const texto = JSON.stringify(eventos);
  ok("sem token de sessão no log", !texto.includes("token-1"), texto);
  ok("sem token de captcha no log", !texto.includes("tok-captcha"), texto);
  ok("sem corpo de resposta no log", !texto.includes("nao-deveria-aparecer"), texto);
}

console.log("\n[13] Freio: duas leituras não saem no mesmo instante");
{
  const { portal } = criar([json(200, {}), json(200, {})]);
  const t0 = Date.now();
  await portal.ler("comprasEmDisputa");
  await portal.ler("comprasEmDisputa");
  const gasto = Date.now() - t0;
  // Folga de 10 ms porque isto é relógio de parede: no Windows o timer tem granularidade
  // de ~15 ms e o setTimeout às vezes acorda 1 ms antes da conta. Medir 199 em vez de 200
  // não é freio frouxo — a regra do intervalo é testada com relógio na mão em bot.test.ts.
  ok("respeitou o piso de 200 ms", gasto >= 190, gasto);
}

console.log(falhas === 0 ? "\n🎉 adapter REST: tudo passou\n" : `\n💥 ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
