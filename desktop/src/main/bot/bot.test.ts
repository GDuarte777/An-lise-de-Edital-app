/**
 * Testes do núcleo do robô. Cobrem o que custa dinheiro: aritmética, piso, variação
 * mínima do edital e a janela final.
 */
import {
  ESCALA,
  formatar,
  paraCorpoRequisicao,
  paraMicro,
  paraNumero,
  reduzirPercentual,
  acrescerPercentual,
  truncar
} from "./decimal.js";
import { avaliarJanela } from "./relogio.js";
import { Freio, Recuo, INTERVALO_MINIMO_MS } from "./limites.js";
import { decidir, type EstadoItem, type ConfiguracaoDisputa } from "./estrategias.js";

let falhas = 0;
function ok(label: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${extra !== undefined ? `\n     ${JSON.stringify(extra, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))}` : ""}`);
    falhas++;
  }
}

const item = (p: Partial<EstadoItem> = {}): EstadoItem => ({
  numero: "1",
  aceitaLance: true,
  melhorValorGeral: paraMicro(1000),
  nossoMelhorValor: null,
  variacaoMinimaMelhorLance: null,
  variacaoMinimaFornecedor: null,
  permitirDizima: false,
  segundosRestantes: 600,
  ...p
});
const cfg = (p: Partial<ConfiguracaoDisputa> = {}): ConfiguracaoDisputa => ({
  modo: "assumir-primeiro",
  pisoMinimo: 800,
  passo: { tipo: "fixo", valor: 15 },
  ...p
});

console.log("\n[1] Aritmética exata — o bug de float que o concorrente tem");
{
  // Math.floor(4.35 * 100) / 100 === 4.34 em ponto flutuante nativo.
  const comFloat = Math.floor(4.35 * 100) / 100;
  ok("ponto flutuante nativo erra 4,35 (prova do bug)", comFloat === 4.34, comFloat);
  ok("nosso truncar acerta 4,35", paraNumero(truncar(paraMicro(4.35), 2)) === 4.35);
  ok("550,99 cabe exato em micro", paraMicro(550.99) === 5_509_900n);
  ok("escala é 4 casas", ESCALA === 10_000n);
  ok("trunca para baixo, nunca para cima", paraNumero(truncar(paraMicro(1.009), 2)) === 1.0);
  ok("reduz 10% de 1000 = 900", paraNumero(reduzirPercentual(paraMicro(1000), 10)) === 900);
  ok("acresce 5% de 1000 = 1050", paraNumero(acrescerPercentual(paraMicro(1000), 5)) === 1050);
  ok("corpo da requisição em 2 casas", paraCorpoRequisicao(paraMicro(550.99), 2) === "550.99");
  ok("corpo da requisição em 4 casas", paraCorpoRequisicao(paraMicro(550.99), 4) === "550.9900");
  ok("formata em pt-BR com milhar", formatar(paraMicro(1234.5), 2) === "R$ 1.234,50", formatar(paraMicro(1234.5), 2));
  let recusou = false;
  try { paraMicro(Number.NaN); } catch { recusou = true; }
  ok("recusa valor não numérico", recusou);
}

console.log("\n[2] Piso do operador — a barreira que protege a margem");
{
  const base = decidir(item(), cfg());
  ok("1000 - 15 = 985", base.acao === "enviar" && paraNumero(base.valor) === 985, base);
  const d1 = decidir(item(), cfg({ pisoMinimo: 985 }));
  ok("lance exatamente no piso é permitido", d1.acao === "enviar" && paraNumero(d1.valor) === 985, d1);
  const d2 = decidir(item(), cfg({ pisoMinimo: 990 }));
  ok("recusa abaixo do piso", d2.acao === "parar" && d2.codigo === "ULTRAPASSA_VALOR_MINIMO", d2);
  ok("mensagem cita o piso", d2.acao === "parar" && d2.porque.includes("990,00"), d2);
}

console.log("\n[3] Variação mínima do edital");
{
  const d = decidir(item({ variacaoMinimaMelhorLance: paraMicro(50) }), cfg());
  ok("usa a variação do edital quando ela é maior que o passo", d.acao === "enviar" && paraNumero(d.valor) === 950, d);

  const d2 = decidir(
    item({ nossoMelhorValor: paraMicro(990), variacaoMinimaFornecedor: paraMicro(50) }),
    cfg()
  );
  ok(
    "recusa por variação sobre o próprio lance",
    d2.acao === "parar" && d2.codigo === "NAO_RESPEITA_VARIACAO_FORNECEDOR",
    d2
  );
}

console.log("\n[4] Modos de disputa");
{
  const manter = decidir(item({ variacaoMinimaMelhorLance: paraMicro(50) }), cfg({ modo: "manter" }));
  ok("manter reduz só o mínimo legal (950)", manter.acao === "enviar" && paraNumero(manter.valor) === 950, manter);

  const posicionar = decidir(item(), cfg({ modo: "posicionar", passo: { tipo: "fixo", valor: 300 }, pisoMinimo: 800 }));
  ok("posicionar cai no piso em vez de furá-lo", posicionar.acao === "enviar" && paraNumero(posicionar.valor) === 800, posicionar);

  const margemDentro = decidir(
    item({ nossoMelhorValor: paraMicro(1020) }),
    cfg({ modo: "margem", margemPercentual: 5, pisoMinimo: 500 })
  );
  ok("margem: já dentro da faixa → aguarda", margemDentro.acao === "aguardar", margemDentro);

  const margemFora = decidir(
    item({ nossoMelhorValor: paraMicro(1100) }),
    cfg({ modo: "margem", margemPercentual: 5, pisoMinimo: 500 })
  );
  ok("margem: fora da faixa → oferta o teto (1050)", margemFora.acao === "enviar" && paraNumero(margemFora.valor) === 1050, margemFora);

  const fechado = decidir(item(), cfg({ modo: "fechado", valorFechado: 777, pisoMinimo: 700 }));
  ok("fechado oferta o valor configurado", fechado.acao === "enviar" && paraNumero(fechado.valor) === 777, fechado);

  const fechadoFura = decidir(item(), cfg({ modo: "fechado", valorFechado: 777, pisoMinimo: 800 }));
  ok("fechado também respeita o piso", fechadoFura.acao === "parar" && fechadoFura.codigo === "ULTRAPASSA_VALOR_MINIMO", fechadoFura);
}

console.log("\n[5] Item com dízima opera em 4 casas");
{
  const d = decidir(
    item({ permitirDizima: true, melhorValorGeral: paraMicro(0.5) }),
    cfg({ modo: "assumir-primeiro", passo: { tipo: "percentual", valor: 10 }, pisoMinimo: 0.4 })
  );
  ok("0,5 - 10% = 0,45 com 4 casas", d.acao === "enviar" && paraNumero(d.valor) === 0.45 && d.casas === 4, d);
}

console.log("\n[6] Falha fechada");
{
  const semLeitura = decidir(item({ melhorValorGeral: null }), cfg());
  ok("sem melhor valor lido, não oferta", semLeitura.acao === "parar" && semLeitura.codigo === "LEITURA_INVALIDA", semLeitura);

  const fechadoItem = decidir(item({ aceitaLance: false }), cfg());
  ok("item fechado, não oferta", fechadoItem.acao === "parar" && fechadoItem.codigo === "ITEM_NAO_ACEITA_LANCE", fechadoItem);

  const semPiso = decidir(item(), cfg({ pisoMinimo: 0 }));
  ok("piso zero é configuração inválida", semPiso.acao === "parar" && semPiso.codigo === "CONFIG_INVALIDA", semPiso);
}

console.log("\n[7] Janela final (sniping)");
{
  ok("desligada: sempre pode ofertar", avaliarJanela(null, { ativo: false, segundos: 0 }).ofertar);
  ok("ligada sem tempo legível: NÃO oferta", !avaliarJanela(null, { ativo: true, segundos: 30 }).ofertar);
  ok("ligada e fora da janela: aguarda", !avaliarJanela(45, { ativo: true, segundos: 30 }).ofertar);
  ok("ligada e dentro da janela: oferta", avaliarJanela(20, { ativo: true, segundos: 30 }).ofertar);
  ok("cronômetro zerado: não oferta", !avaliarJanela(-1, { ativo: true, segundos: 30 }).ofertar);

  const d = decidir(item({ segundosRestantes: null }), cfg({ janelaFinal: { ativo: true, segundos: 30 } }));
  ok("decisão respeita a janela e aguarda", d.acao === "aguardar", d);
}

console.log("\n[8] Freio de requisições — sem desligamento");
{
  const f = new Freio(5);
  ok("intervalo nunca abaixo do piso", f.intervalo === INTERVALO_MINIMO_MS, f.intervalo);
  const f2 = new Freio(500);
  ok("intervalo configurável para cima", f2.intervalo === 500);
  const t0 = 1_000_000;
  void f2.vez(t0);
  ok("segunda chamada no mesmo instante espera", f2.esperaPrevista(t0) === 500, f2.esperaPrevista(t0));

  const r = new Recuo(1_000, 60_000);
  ok("1ª falha espera 1s", r.registrarFalha() === 1_000);
  ok("2ª falha espera 2s", r.registrarFalha() === 2_000);
  ok("3ª falha espera 4s", r.registrarFalha() === 4_000);
  r.registrarSucesso();
  ok("sucesso zera o recuo", r.nivel === 0);
}

console.log(falhas === 0 ? "\n🎉 núcleo do robô: tudo passou\n" : `\n💥 ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
