/**
 * Testes do tradutor de eventos do portal. A regra sob teste é sempre a mesma: o que não
 * pôde ser lido vira `null` e aparece em `camposIlegiveis` — nunca zero, nunca `true`.
 */
import { normalizarItem, normalizarItens, lerDinheiro, lerBooleano, situacaoAceitaLance, lerSegundosRestantes } from "./eventos.js";

let falhas = 0;
function ok(label: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label}${extra !== undefined ? `\n     ${JSON.stringify(extra, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))}` : ""}`);
    falhas++;
  }
}

const AGORA = 1_760_000_000_000;

console.log("\n[1] Item completo");
{
  const leitura = normalizarItem(
    {
      numeroItem: 7,
      numeroCompra: "900123/2026",
      valorMelhorLance: "1.234,56",
      valorMeuLance: 1300.5,
      situacaoItem: "EM_DISPUTA",
      valorVariacaoMinimaMelhorLance: "0,05",
      valorVariacaoMinimaMesmoFornecedor: 0.1,
      permitirDizima: false,
      segundosRestantes: 600
    },
    { agora: AGORA }
  );
  ok("leu o item", leitura !== null);
  const e = leitura!.estado;
  ok("número vira texto", e.numero === "7", e.numero);
  ok("melhor valor exato de texto BR", e.melhorValorGeral === 12_345_600n, String(e.melhorValorGeral));
  ok("nosso valor de número", e.nossoMelhorValor === 13_005_000n, String(e.nossoMelhorValor));
  ok("variação do melhor lance", e.variacaoMinimaMelhorLance === 500n, String(e.variacaoMinimaMelhorLance));
  ok("variação do fornecedor", e.variacaoMinimaFornecedor === 1_000n, String(e.variacaoMinimaFornecedor));
  ok("aceita lance pela situação", e.aceitaLance === true);
  ok("duas casas quando não há dízima", e.permitirDizima === false);
  ok("compra lida", leitura!.compra === "900123/2026", leitura!.compra);
  ok("fase para o POST", leitura!.fase === "EM_DISPUTA", leitura!.fase);
  ok("nada ilegível", leitura!.camposIlegiveis.length === 0, leitura!.camposIlegiveis);
}

console.log("\n[2] O que não se lê não se inventa");
{
  const leitura = normalizarItem({ numero: "3" }, { agora: AGORA })!;
  ok("melhor valor é null", leitura.estado.melhorValorGeral === null);
  ok("tempo é null", leitura.estado.segundosRestantes === null);
  ok("não aceita lance sem evidência", leitura.estado.aceitaLance === false);
  ok(
    "os três campos são declarados ilegíveis",
    ["melhorValorGeral", "segundosRestantes", "aceitaLance"].every((c) => leitura.camposIlegiveis.includes(c)),
    leitura.camposIlegiveis
  );
  ok("aceitaLida fica null (não falou do assunto)", leitura.aceitaLida === null);
  ok("sem número do item, não há leitura", normalizarItem({ valorMelhorLance: 10 }) === null);
  ok("payload que não é objeto volta null", normalizarItem("x") === null && normalizarItem(null) === null);
}

console.log("\n[3] Zero não é preço");
{
  ok("dinheiro zero vira null", lerDinheiro(0) === null);
  ok("dinheiro negativo vira null", lerDinheiro("-10,00") === null);
  ok("string vazia vira null", lerDinheiro("") === null);
  const leitura = normalizarItem({ numero: "1", valorMelhorLance: 0, situacao: "em disputa" }, { agora: AGORA })!;
  ok("item sem lance ainda não tem melhor valor", leitura.estado.melhorValorGeral === null);
  ok("e isso é declarado", leitura.camposIlegiveis.includes("melhorValorGeral"), leitura.camposIlegiveis);
}

console.log("\n[4] Situação e booleanos");
{
  ok("encerrado não aceita", situacaoAceitaLance("Disputa encerrada") === false);
  ok("aguardando não aceita", situacaoAceitaLance("AGUARDANDO_DISPUTA") === false);
  ok("em disputa aceita", situacaoAceitaLance("Em disputa") === true);
  ok("texto desconhecido é null", situacaoAceitaLance("xpto") === null);
  ok("vazio é null", situacaoAceitaLance("") === null);
  ok('"S" é true', lerBooleano("S") === true);
  ok('"N" é false', lerBooleano("N") === false);
  ok("número não é booleano", lerBooleano(1) === null);

  const fechado = normalizarItem({ numero: "1", aceitaLance: true, situacao: "ENCERRADO" }, { agora: AGORA })!;
  ok("campo explícito vence a situação", fechado.estado.aceitaLance === true, fechado.estado);
}

console.log("\n[5] Tempo restante");
{
  ok("segundos diretos", lerSegundosRestantes({ segundosRestantes: 42 }, AGORA) === 42);
  ok("segundos como texto", lerSegundosRestantes({ tempoRestante: "42" }, AGORA) === 42);
  ok("milissegundos nomeados", lerSegundosRestantes({ tempoRestanteMs: 90_000 }, AGORA) === 90);
  const fim = new Date(AGORA + 120_000).toISOString();
  ok("timestamp de encerramento", lerSegundosRestantes({ dataHoraEncerramento: fim }, AGORA) === 120);
  ok("timestamp inválido é null", lerSegundosRestantes({ dataHoraEncerramento: "ontem" }, AGORA) === null);
  ok("nada legível é null", lerSegundosRestantes({}, AGORA) === null);
}

console.log("\n[6] Listas");
{
  const cru = [{ numeroItem: "1", situacao: "em disputa" }, { sem: "numero" }, { numeroItem: "2" }];
  ok("array direto", normalizarItens(cru).length === 2, normalizarItens(cru).length);
  ok("envelope .itens", normalizarItens({ itens: cru }).length === 2);
  ok("envelope .content (paginado)", normalizarItens({ content: cru }).length === 2);
  ok("formato inesperado devolve lista vazia", normalizarItens({ x: 1 }).length === 0);
}

console.log(falhas === 0 ? "\n🎉 eventos do portal: tudo passou\n" : `\n💥 ${falhas} falha(s)\n`);
process.exit(falhas === 0 ? 0 : 1);
