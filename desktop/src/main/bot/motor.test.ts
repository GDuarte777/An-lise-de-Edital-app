/**
 * Testes do motor. O foco é nas travas: nunca dois lances no mesmo item, nunca lance
 * redundante depois de um aceite, recusa de piso desarma, falha de rede não vira
 * martelo e a janela final é respeitada com o tempo projetado.
 */
import { Motor, type EventoMotor, type PedidoLance } from "./motor.js";
import { normalizarItem, type LeituraItem } from "./eventos.js";
import type { ConfiguracaoDisputa } from "./estrategias.js";
import type { ResultadoLance } from "./rest/portal.js";
import type { Temporizador } from "./tempo.js";
import { paraNumero } from "./decimal.js";

let falhas = 0;
function ok(label: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${extra !== undefined ? `\n     ${JSON.stringify(extra, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))}` : ""}`);
    falhas++;
  }
}

const pausa = () => new Promise<void>((r) => setTimeout(r, 0));

class Relogio implements Temporizador {
  private t = 1_760_000_000_000;
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

  async avancar(ms: number): Promise<void> {
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
      await pausa();
    }
    this.t = alvo;
  }

  get pendentes(): number {
    return this.fila.size;
  }
}

const ACEITO: ResultadoLance = { estado: "aceito", status: 200, dados: null };

function criar(opcoes: { respostas?: ResultadoLance[]; manual?: boolean; intervalo?: number; falhasToleradas?: number } = {}) {
  const relogio = new Relogio();
  const pedidos: PedidoLance[] = [];
  const eventos: EventoMotor[] = [];
  const resolvedores: ((r: ResultadoLance) => void)[] = [];
  const respostas = [...(opcoes.respostas ?? [])];

  const motor = new Motor({
    lancador: async (pedido) => {
      pedidos.push(pedido);
      if (opcoes.manual) return new Promise<ResultadoLance>((r) => resolvedores.push(r));
      return respostas.shift() ?? ACEITO;
    },
    temporizador: relogio,
    intervaloEntreLancesMs: opcoes.intervalo,
    falhasToleradas: opcoes.falhasToleradas,
    aoEvento: (e) => eventos.push(e)
  });

  const leitura = (campos: Record<string, unknown>): LeituraItem =>
    normalizarItem(
      {
        numeroItem: "7",
        numeroCompra: "900123/2026",
        situacaoItem: "EM_DISPUTA",
        ...campos
      },
      { agora: relogio.agora() }
    )!;

  return { motor, relogio, pedidos, eventos, resolvedores, leitura };
}

const cfg = (p: Partial<ConfiguracaoDisputa> = {}): ConfiguracaoDisputa => ({
  modo: "assumir-primeiro",
  pisoMinimo: 900,
  passo: { tipo: "fixo", valor: 10 },
  ...p
});

console.log("\n[1] Um evento, um lance");
{
  const { motor, pedidos, leitura } = criar();
  motor.armar("7", cfg());
  motor.aplicarLeitura(leitura({ valorMelhorLance: "1.000,00" }));
  await pausa();

  ok("enviou um lance", pedidos.length === 1, pedidos.length);
  ok("valor = melhor − passo", paraNumero(pedidos[0]?.valor ?? 0n) === 990, paraNumero(pedidos[0]?.valor ?? 0n));
  ok("compra e item no pedido", pedidos[0]?.compra === "900123/2026" && pedidos[0]?.item === "7", pedidos[0]);
  ok("fase do item vai no corpo", pedidos[0]?.fase === "EM_DISPUTA", pedidos[0]?.fase);
  ok("duas casas", pedidos[0]?.casas === 2);
}

console.log("\n[2] Item não armado não lança");
{
  const { motor, pedidos, leitura } = criar();
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000 }));
  await pausa();
  ok("nenhum lance", pedidos.length === 0, pedidos.length);
  ok("mas o estado foi guardado para a UI", motor.estadoProjetado("7") !== null);
  ok("e segue desarmado", motor.estaArmado("7") === false);
}

console.log("\n[3] Nunca dois lances em voo no mesmo item");
{
  const { motor, pedidos, resolvedores, leitura } = criar({ manual: true });
  motor.armar("7", cfg());
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000 }));
  await pausa();
  ok("primeiro lance saiu", pedidos.length === 1, pedidos.length);

  motor.aplicarLeitura(leitura({ valorMelhorLance: 990 }));
  motor.aplicarLeitura(leitura({ valorMelhorLance: 980 }));
  await pausa();
  ok("eventos novos não abrem segundo lance", pedidos.length === 1, pedidos.length);

  resolvedores[0](ACEITO);
  await pausa();
  ok("depois do aceite, o item volta a poder lançar", pedidos.length === 1, pedidos.length);
  motor.aplicarLeitura(leitura({ valorMelhorLance: 950 }));
  await pausa();
  ok("e o próximo evento lança", pedidos.length === 2, pedidos.length);
}

console.log("\n[4] Aceite impede lance redundante");
{
  const { motor, pedidos, leitura } = criar();
  motor.armar("7", cfg());
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000 }));
  await pausa();
  ok("lançou 990", paraNumero(pedidos[0].valor) === 990);

  // O portal ainda não ecoou nosso lance: o evento repete o melhor valor antigo.
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000 }));
  await pausa();
  ok("não lança de novo sobre estado velho", pedidos.length === 1, pedidos.length);
  ok("o motor já se sabe dono do melhor valor", paraNumero(motor.estadoProjetado("7")!.nossoMelhorValor!) === 990);
}

console.log("\n[5] Recusa de piso desarma o item");
{
  const { motor, eventos, leitura } = criar({
    respostas: [{ estado: "recusado", codigo: "ULTRAPASSA_VALOR_MINIMO", mensagem: "abaixo do mínimo", status: 400 }]
  });
  motor.armar("7", cfg({ pisoMinimo: 900 }));
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000 }));
  await pausa();
  ok("desarmou", motor.estaArmado("7") === false);
  ok("com o código do portal", eventos.some((e) => e.tipo === "desarmado" && e.codigo === "ULTRAPASSA_VALOR_MINIMO"), eventos);
}

console.log("\n[6] Recusa de variação segura o item, não desarma");
{
  const { motor, eventos, leitura } = criar({
    respostas: [
      { estado: "recusado", codigo: "NAO_RESPEITA_VARIACAO_MELHOR_LANCE", mensagem: "reduza mais", status: 400 }
    ]
  });
  motor.armar("7", cfg());
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000 }));
  await pausa();
  ok("segue armado", motor.estaArmado("7") === true);
  ok("motivo visível ao operador", motor.motivoDe("7") === "reduza mais", motor.motivoDe("7"));
  ok("evento de recusa registrado", eventos.some((e) => e.tipo === "recusado"), eventos);
}

console.log("\n[7] O piso é respeitado antes de qualquer envio");
{
  const { motor, pedidos, eventos, leitura } = criar();
  motor.armar("7", cfg({ pisoMinimo: 995, passo: { tipo: "fixo", valor: 10 } }));
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000 }));
  await pausa();
  ok("nada foi enviado", pedidos.length === 0, pedidos.length);
  ok("desarmou por piso", eventos.some((e) => e.tipo === "desarmado" && e.codigo === "ULTRAPASSA_VALOR_MINIMO"), eventos);
}

console.log("\n[8] Falhas seguidas desarmam em vez de martelar");
{
  const falha: ResultadoLance = { estado: "falha", status: 500, mensagem: "erro interno" };
  const { motor, pedidos, eventos, leitura } = criar({ respostas: [falha, falha, falha], falhasToleradas: 3 });
  motor.armar("7", cfg());
  for (const melhor of [1000, 1000, 1000]) {
    motor.aplicarLeitura(leitura({ valorMelhorLance: melhor }));
    await pausa();
  }
  ok("tentou três vezes", pedidos.length === 3, pedidos.length);
  ok("desarmou na terceira", motor.estaArmado("7") === false);
  ok("contou as falhas", eventos.filter((e) => e.tipo === "falhou").length === 3, eventos.filter((e) => e.tipo === "falhou").length);

  motor.aplicarLeitura(leitura({ valorMelhorLance: 900 }));
  await pausa();
  ok("desarmado não lança mais", pedidos.length === 3, pedidos.length);
}

console.log("\n[9] Sessão caída para tudo");
{
  const { motor, eventos, leitura } = criar({ respostas: [{ estado: "sessao-caiu", status: 401 }] });
  motor.armar("7", cfg());
  motor.armar("9", cfg());
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000 }));
  await pausa();
  ok("item que lançou desarmou", motor.estaArmado("7") === false);
  ok("e o outro item também", motor.estaArmado("9") === false);
  ok("avisou uma vez", eventos.filter((e) => e.tipo === "sessao-caiu").length === 1);
}

console.log("\n[10] Intervalo mínimo entre lances nossos");
{
  const { motor, relogio, pedidos, leitura } = criar({ intervalo: 2_000 });
  motor.armar("7", cfg({ pisoMinimo: 800 }));
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000 }));
  await pausa();
  ok("primeiro lance imediato", pedidos.length === 1, pedidos.length);

  motor.aplicarLeitura(leitura({ valorMelhorLance: 900, valorMeuLance: 990 }));
  await pausa();
  ok("segundo lance espera o intervalo", pedidos.length === 1, pedidos.length);

  await relogio.avancar(2_000);
  ok("e sai quando o intervalo fecha", pedidos.length === 2, pedidos.length);
  ok("com o valor novo", paraNumero(pedidos[1].valor) === 890, paraNumero(pedidos[1].valor));
}

console.log("\n[11] Janela final: espera e dispara sozinha");
{
  const { motor, relogio, pedidos, eventos, leitura } = criar();
  motor.armar("7", cfg({ janelaFinal: { ativo: true, segundos: 30 } }));
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000, segundosRestantes: 100 }));
  await pausa();
  ok("fora da janela não lança", pedidos.length === 0, pedidos.length);
  ok("explicou a espera", eventos.some((e) => e.tipo === "aguardando" && /últimos 30s/.test(e.porque)), eventos);
  ok("agendou a reavaliação", relogio.pendentes === 1, relogio.pendentes);

  await relogio.avancar(69_000);
  ok("ainda fora da janela", pedidos.length === 0, pedidos.length);
  await relogio.avancar(2_000);
  ok("dentro da janela, lançou sozinho", pedidos.length === 1, pedidos.length);
}

console.log("\n[12] Tempo é projetado, não copiado");
{
  const { motor, relogio, leitura } = criar();
  motor.armar("7", cfg());
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000, segundosRestantes: 100 }));
  await pausa();
  await relogio.avancar(40_000);
  const s = motor.estadoProjetado("7")!.segundosRestantes!;
  ok("100s menos 40s decorridos", Math.round(s) === 60, s);
}

console.log("\n[13] Sem tempo legível e com janela ligada, não oferta");
{
  const { motor, pedidos, leitura } = criar();
  motor.armar("7", cfg({ janelaFinal: { ativo: true, segundos: 30 } }));
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000 }));
  await pausa();
  ok("falha fechada", pedidos.length === 0, pedidos.length);
  ok("motivo é o tempo ilegível", /tempo restante/i.test(motor.motivoDe("7") ?? ""), motor.motivoDe("7"));
}

console.log("\n[14] Evento parcial não cega nem fecha o item");
{
  const { motor, relogio, pedidos, leitura } = criar();
  motor.armar("7", cfg({ pisoMinimo: 800 }));
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000, permitirDizima: true }));
  await pausa();
  ok("lançou com 4 casas", pedidos[0]?.casas === 4, pedidos[0]?.casas);

  // Mensagem só com o melhor valor: nada de situação, nada de dízima, nada de compra.
  motor.aplicarLeitura(normalizarItem({ numeroItem: "7", valorMelhorLance: 900 }, { agora: relogio.agora() })!);
  await pausa();
  ok("item continua armado", motor.estaArmado("7") === true, motor.motivoDe("7"));
  ok("e continua em 4 casas", pedidos[1]?.casas === 4, pedidos[1]?.casas);
  ok("compra anterior foi preservada", pedidos[1]?.compra === "900123/2026", pedidos[1]?.compra);
}

console.log("\n[15] Sem compra ou fase, não se inventa requisição");
{
  const { motor, pedidos, leitura } = criar();
  motor.armar("5", cfg());
  motor.aplicarLeitura(normalizarItem({ numeroItem: "5", valorMelhorLance: 1000, aceitaLance: true }, {})!);
  await pausa();
  ok("não enviou", pedidos.length === 0, pedidos.length);
  ok("motivo explícito", /número da compra/.test(motor.motivoDe("5") ?? ""), motor.motivoDe("5"));
  void leitura;
}

console.log("\n[16] pararTudo e rearmar");
{
  const { motor, pedidos, leitura } = criar();
  motor.armar("7", cfg());
  motor.pararTudo();
  motor.aplicarLeitura(leitura({ valorMelhorLance: 1000 }));
  await pausa();
  ok("parado não lança", pedidos.length === 0, pedidos.length);

  motor.armar("7", cfg());
  await pausa();
  ok("rearmar decide com a última leitura", pedidos.length === 1, pedidos.length);
}

console.log(falhas === 0 ? "\n🎉 motor por evento: tudo passou\n" : `\n💥 ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
