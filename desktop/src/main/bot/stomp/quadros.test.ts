/**
 * Testes do codec STOMP. Cobrem o que quebra em produção e não aparece em sala limpa:
 * socket que entrega meio quadro, dois quadros numa leitura, pulso entre quadros,
 * cabeçalho com `:` no valor e o CONNECT — onde o token de Authorization não pode
 * sofrer escape.
 */
import { analisar, analisarFluxo, negociarPulso, serializar, NULO, type Quadro } from "./quadros.js";

let falhas = 0;
function ok(label: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${extra !== undefined ? `\n     ${JSON.stringify(extra)}` : ""}`);
    falhas++;
  }
}

const q = (p: Partial<Quadro> = {}): Quadro => ({ comando: "SEND", cabecalhos: {}, corpo: "", ...p });

console.log("\n[1] Ida e volta");
{
  const original = q({
    comando: "MESSAGE",
    cabecalhos: { destination: "/topic/disputa.123", "message-id": "77", "content-type": "application/json" },
    corpo: '{"valorInformado":"550.9900"}'
  });
  const volta = analisar(serializar(original));
  ok("comando preservado", volta.comando === "MESSAGE", volta.comando);
  ok("cabeçalhos preservados", JSON.stringify(volta.cabecalhos) === JSON.stringify(original.cabecalhos), volta.cabecalhos);
  ok("corpo preservado", volta.corpo === original.corpo, volta.corpo);
  ok("quadro termina em NULO", serializar(original).endsWith(NULO));

  const vazio = analisar(serializar(q({ comando: "DISCONNECT" })));
  ok("quadro sem cabeçalho e sem corpo", vazio.comando === "DISCONNECT" && vazio.corpo === "" && Object.keys(vazio.cabecalhos).length === 0, vazio);
}

console.log("\n[2] Escape de cabeçalhos");
{
  const bruto = serializar(q({ cabecalhos: { "x-nota": "a:b\nc\\d\re" } }));
  ok("escapa : \\n \\r e \\ ao serializar", bruto.includes("x-nota:a\\cb\\nc\\\\d\\re"), bruto);
  ok("desescapa de volta", analisar(bruto).cabecalhos["x-nota"] === "a:b\nc\\d\re", analisar(bruto).cabecalhos);

  let explodiu = false;
  try { analisar("SEND\nx:a\\q\n\n\u0000"); } catch { explodiu = true; }
  ok("escape inválido é erro, não silêncio", explodiu);
}

console.log("\n[3] CONNECT / CONNECTED — a exceção da especificação");
{
  const token = "Bearer eyJhbGciOi.JIUzI1NiJ9.aG9yYXNpcw==";
  const bruto = serializar(q({ comando: "CONNECT", cabecalhos: { Authorization: token, "accept-version": "1.2" } }));
  ok("token do CONNECT vai literal, sem escape", bruto.includes(`Authorization:${token}`), bruto);
  ok("CONNECT volta com o token intacto", analisar(bruto).cabecalhos.Authorization === token, analisar(bruto).cabecalhos);

  const conectado = analisar("CONNECTED\nversion:1.2\nheart-beat:10000,10000\n\n\u0000");
  ok("CONNECTED lido sem desescape", conectado.cabecalhos["heart-beat"] === "10000,10000", conectado.cabecalhos);

  // Fora da exceção, o mesmo valor sofre escape.
  const send = serializar(q({ cabecalhos: { Authorization: token } }));
  ok("fora do CONNECT o : é escapado", send.includes("Authorization:Bearer eyJhbGciOi.JIUzI1NiJ9.aG9yYXNpcw=="), send);
}

console.log("\n[4] Cabeçalho repetido: o primeiro vale (1.2)");
{
  const lido = analisar("MESSAGE\ndestination:/a\ndestination:/b\n\ncorpo\u0000");
  ok("primeira ocorrência ganha", lido.cabecalhos.destination === "/a", lido.cabecalhos);
}

console.log("\n[5] Malformados");
{
  for (const [label, bruto] of [
    ["sem comando", "\n\ncorpo\u0000"],
    ["cabeçalho sem :", "SEND\nabc\n\n\u0000"],
    ["cabeçalho com chave vazia", "SEND\n:v\n\n\u0000"]
  ] as const) {
    let explodiu = false;
    try { analisar(bruto); } catch { explodiu = true; }
    ok(`${label} é erro`, explodiu);
  }

  let comandoRuim = false;
  try { serializar(q({ comando: "send" })); } catch { comandoRuim = true; }
  ok("comando minúsculo não é serializado", comandoRuim);
}

console.log("\n[6] EOL em \\r\\n");
{
  const lido = analisar("MESSAGE\r\ndestination:/topic/x\r\ncontent-length:5\r\n\r\ncorpo\u0000");
  ok("comando sem \\r sobrando", lido.comando === "MESSAGE", lido.comando);
  ok("valor sem \\r sobrando", lido.cabecalhos.destination === "/topic/x", lido.cabecalhos);
  ok("corpo intacto", lido.corpo === "corpo", lido.corpo);
}

console.log("\n[7] Fluxo do socket");
{
  const a = serializar(q({ comando: "MESSAGE", cabecalhos: { "message-id": "1" }, corpo: "um" }));
  const b = serializar(q({ comando: "MESSAGE", cabecalhos: { "message-id": "2" }, corpo: "dois" }));

  const dois = analisarFluxo(a + b);
  ok("dois quadros numa leitura", dois.quadros.length === 2 && dois.quadros[1].corpo === "dois", dois.quadros.map((x) => x.corpo));
  ok("nada sobra", dois.resto === "", dois.resto);

  // Quadro cortado no meio: a primeira leitura entrega um quadro e guarda o resto.
  const corte = a.length + 12;
  const p1 = analisarFluxo((a + b).slice(0, corte));
  ok("meio quadro não é entregue", p1.quadros.length === 1, p1.quadros.length);
  const p2 = analisarFluxo(p1.resto + (a + b).slice(corte));
  ok("resto + continuação completa o quadro", p2.quadros.length === 1 && p2.quadros[0].corpo === "dois", p2.quadros);
  ok("fim do fluxo sem sobra", p2.resto === "", p2.resto);

  const semNada = analisarFluxo("MESSAGE\ndesti");
  ok("leitura sem NULO não entrega quadro", semNada.quadros.length === 0 && semNada.resto === "MESSAGE\ndesti", semNada);
}

console.log("\n[8] Pulsos");
{
  const a = serializar(q({ comando: "MESSAGE", cabecalhos: { id: "1" }, corpo: "um" }));
  const f = analisarFluxo(`\n\n${a}\n`);
  ok("pulsos antes e depois são contados", f.pulsos === 3, f.pulsos);
  ok("pulso não vira quadro", f.quadros.length === 1, f.quadros.length);
  ok("pulso consumido não sobra", f.resto === "", JSON.stringify(f.resto));
  ok("pulso em \\r\\n também conta", analisarFluxo("\r\n\r\n").pulsos === 2, analisarFluxo("\r\n\r\n").pulsos);
  ok("só pulso: nenhum quadro", analisarFluxo("\n").quadros.length === 0);
}

console.log("\n[9] Negociação do pulso");
{
  ok(
    "sem cabeçalho do servidor, pulso desligado",
    JSON.stringify(negociarPulso({ envio: 10_000, recepcao: 10_000 }, undefined)) === JSON.stringify({ enviarCadaMs: 0, esperarCadaMs: 0 })
  );
  const n = negociarPulso({ envio: 10_000, recepcao: 10_000 }, "20000,5000");
  ok("envio = max(o que eu posso, o que ele quer)", n.enviarCadaMs === 10_000, n);
  ok("espera = max(o que eu quero, o que ele manda)", n.esperarCadaMs === 20_000, n);

  const m = negociarPulso({ envio: 10_000, recepcao: 10_000 }, "0,0");
  ok("servidor que não quer nem manda desliga os dois", m.enviarCadaMs === 0 && m.esperarCadaMs === 0, m);

  const z = negociarPulso({ envio: 0, recepcao: 0 }, "10000,10000");
  ok("cliente que não pulsa fica desligado", z.enviarCadaMs === 0 && z.esperarCadaMs === 0, z);
}

console.log(falhas === 0 ? "\n🎉 codec STOMP: tudo passou\n" : `\n💥 ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
