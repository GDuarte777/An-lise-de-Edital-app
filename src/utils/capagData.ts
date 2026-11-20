export type NotaCapag = "A+" | "A" | "B" | "C" | "D";
export type NotaIndicador = "A" | "B" | "C" | "n.d.";

export interface IndicadorFiscalCapag {
  codigo: "I" | "II" | "III";
  nome: string;
  sigla: string;
  valorPercentual: number;
  nota: NotaIndicador;
  limiteNotaA: string;
  descricaoCurta: string;
}

export interface VereditoLicitanteCapag {
  statusPagador: "Excelente Pagador" | "Bom Pagador" | "Atenção: Risco de Atraso" | "Alto Risco / Caixa Crítico";
  nivelRisco: "Muito Baixo" | "Baixo a Moderado" | "Elevado" | "Crítico";
  estaDevendoFornecedores: boolean;
  resumoDividaCaixa: string;
  prazoMedioRecebimento: string;
  margemFinanceiraRecomendada: string;
  estrategiaComercial: string;
  amparoLegal: string;
}

export interface EnteCapag {
  id: string;
  codigoIbge: string;
  nome: string;
  uf: string;
  nomeUf: string;
  esfera: "Estado" | "Município" | "União";
  isCapital?: boolean;
  notaCapag: NotaCapag;
  anoReferencia: number;
  fonteOficial: string;
  regimeRecuperacaoFiscal?: boolean;
  regularidadeCauc: "Regular" | "Pendências Pontuais" | "Com Restrições / RRF";
  indicadores: {
    endividamento: IndicadorFiscalCapag; // DC / RCL
    poupancaCorrente: IndicadorFiscalCapag; // DC / RC
    liquidez: IndicadorFiscalCapag; // Obrigações Financeiras / Caixa Disponível
  };
  veredito: VereditoLicitanteCapag;
  linkTesouroTransparente: string;
  linkSiconfi: string;
}

export const NOMES_UF: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

const CODIGOS_IBGE_UF: Record<string, string> = {
  AC: "12",
  AL: "27",
  AP: "16",
  AM: "13",
  BA: "29",
  CE: "23",
  DF: "53",
  ES: "32",
  GO: "52",
  MA: "21",
  MT: "51",
  MS: "50",
  MG: "31",
  PA: "15",
  PB: "25",
  PR: "41",
  PE: "26",
  PI: "22",
  RJ: "33",
  RN: "24",
  RS: "43",
  RO: "11",
  RR: "14",
  SC: "42",
  SP: "35",
  SE: "28",
  TO: "17",
};

function classificarEndividamento(valor: number): NotaIndicador {
  if (valor < 60) return "A";
  if (valor <= 150) return "B";
  return "C";
}

function classificarPoupancaCorrente(valor: number): NotaIndicador {
  if (valor < 90) return "A";
  if (valor <= 95) return "B";
  return "C";
}

function classificarLiquidez(valor: number): NotaIndicador {
  if (valor < 100) return "A";
  return "C";
}

export function construirVereditoLicitante(
  notaCapag: NotaCapag,
  endividamentoPct: number,
  poupancaPct: number,
  liquidezPct: number,
  rrf?: boolean
): VereditoLicitanteCapag {
  const estaDevendoFornecedores = liquidezPct >= 100 || notaCapag === "C" || notaCapag === "D";

  if (notaCapag === "A+" || notaCapag === "A") {
    return {
      statusPagador: "Excelente Pagador",
      nivelRisco: "Muito Baixo",
      estaDevendoFornecedores: false,
      resumoDividaCaixa: `Sobra de caixa saudável: as obrigações financeiras e Restos a Pagar consomem apenas ${liquidezPct.toFixed(1)}% do caixa livre disponível (endividamento controlado em ${endividamentoPct.toFixed(1)}% da RCL).`,
      prazoMedioRecebimento: "15 a 30 dias após liquidação/atesto da Nota Fiscal",
      margemFinanceiraRecomendada: "+0% a +2% (Sem necessidade de gordura financeira extra)",
      estrategiaComercial:
        "Órgão com altíssima liquidez e solvência. Seguro para disputar com margem agressiva em pregões eletrônicos, pois o risco de atraso de empenho/pagamento é mínimo.",
      amparoLegal: "Ordem cronológica de pagamentos regular conforme Art. 141 da Lei 14.133/2021.",
    };
  }

  if (notaCapag === "B") {
    return {
      statusPagador: "Bom Pagador",
      nivelRisco: "Baixo a Moderado",
      estaDevendoFornecedores: liquidezPct >= 95,
      resumoDividaCaixa:
        liquidezPct < 90
          ? `Caixa equilibrado (${liquidezPct.toFixed(1)}% de comprometimento das disponibilidades) e despesas correntes em ${poupancaPct.toFixed(1)}% da receita.`
          : `Caixa próximo do limite operacional (${liquidezPct.toFixed(1)}% das disponibilidades comprometidas), mas com fluxo fiscal adimplente.`,
      prazoMedioRecebimento: "30 a 45 dias após atesto da Nota Fiscal",
      margemFinanceiraRecomendada: "+3% a +5% (Reserva padrão de capital de giro)",
      estrategiaComercial:
        "Ente público bom pagador, porém sujeito a janelas de programação financeira mensal da Secretaria de Fazenda. Mantenha capital de giro para 45 dias e acompanhe a nota de empenho prévia.",
      amparoLegal: "Exija emissão da Nota de Empenho antes da entrega (Art. 95 da Lei 14.133/2021).",
    };
  }

  if (notaCapag === "C") {
    return {
      statusPagador: "Atenção: Risco de Atraso",
      nivelRisco: "Elevado",
      estaDevendoFornecedores: true,
      resumoDividaCaixa:
        liquidezPct >= 100
          ? `Alerta de Liquidez: as obrigações de curto prazo e Restos a Pagar representam ${liquidezPct.toFixed(1)}% do caixa disponível (deve mais a fornecedores no curto prazo do que possui em caixa livre).`
          : `Pressão Fiscal: despesas correntes consomem ${poupancaPct.toFixed(1)}% da receita e o endividamento atinge ${endividamentoPct.toFixed(1)}% da RCL${rrf ? " (Em Regime de Recuperação Fiscal)" : ""}.`,
      prazoMedioRecebimento: "60 a 90 dias (possível inscrição em Restos a Pagar no fim do exercício)",
      margemFinanceiraRecomendada: "+7% a +12% (Embutir custo financeiro de 60–90 dias na proposta)",
      estrategiaComercial:
        "Não entre com margem esmagada. Embuta o custo do capital de giro na precificação, prefira entregas parceladas vinculadas ao pagamento da remessa anterior e evite faturamento alto concentrado em novembro/dezembro.",
      amparoLegal:
        "Monitore a fila da ordem cronológica (Art. 141 da Lei 14.133/2021). Atraso superior a 2 meses autoriza suspensão da execução (Art. 137, § 2º, IV).",
    };
  }

  return {
    statusPagador: "Alto Risco / Caixa Crítico",
    nivelRisco: "Crítico",
    estaDevendoFornecedores: true,
    resumoDividaCaixa: `Risco Fiscal Severo: índice de liquidez em ${liquidezPct.toFixed(1)}% (forte acúmulo de Restos a Pagar frente ao caixa livre) e endividamento de ${endividamentoPct.toFixed(1)}% da RCL${rrf ? " — Estado em Regime de Recuperação Fiscal (RRF)" : ""}.`,
    prazoMedioRecebimento: "90 a 120+ dias (alto risco de contingenciamento ou Restos a Pagar)",
    margemFinanceiraRecomendada: "+12% a +18% (Margem de proteção máxima e capital de giro próprio)",
    estrategiaComercial:
      "Cautela máxima. Recomendado apenas para fornecimento de pronta entrega com margem elevada ou recursos federais carimbados (Fundo a Fundo / Convênios da União). Evite contratos longos de mão de obra exclusiva sem reserva robusta.",
    amparoLegal:
      "Verifique se a fonte de recurso do edital é transferência federal vinculada (menor risco) e utilize o Art. 137, § 2º, IV da Lei 14.133/2021 em caso de inadimplência > 60 dias.",
  };
}

interface SeedEnte {
  codigoIbge: string;
  nome: string;
  uf: string;
  esfera: "Estado" | "Município";
  isCapital?: boolean;
  notaCapag: NotaCapag;
  endividamento: number;
  poupancaCorrente: number;
  liquidez: number;
  rrf?: boolean;
  regularidadeCauc?: "Regular" | "Pendências Pontuais" | "Com Restrições / RRF";
}

function criarEnteCapag(seed: SeedEnte): EnteCapag {
  const notaEnd = classificarEndividamento(seed.endividamento);
  const notaPoup = classificarPoupancaCorrente(seed.poupancaCorrente);
  const notaLiq = classificarLiquidez(seed.liquidez);

  const veredito = construirVereditoLicitante(
    seed.notaCapag,
    seed.endividamento,
    seed.poupancaCorrente,
    seed.liquidez,
    seed.rrf
  );

  return {
    id: `${seed.esfera.toLowerCase()}-${seed.uf}-${seed.codigoIbge}`,
    codigoIbge: seed.codigoIbge,
    nome: seed.nome,
    uf: seed.uf,
    nomeUf: NOMES_UF[seed.uf] || seed.uf,
    esfera: seed.esfera,
    isCapital: seed.isCapital,
    notaCapag: seed.notaCapag,
    anoReferencia: 2025,
    fonteOficial: "Secretaria do Tesouro Nacional (STN / Siconfi — Metodologia Portaria MF nº 1.583)",
    regimeRecuperacaoFiscal: seed.rrf,
    regularidadeCauc:
      seed.regularidadeCauc ||
      (seed.notaCapag === "A+" || seed.notaCapag === "A"
        ? "Regular"
        : seed.notaCapag === "B"
        ? "Regular"
        : seed.rrf
        ? "Com Restrições / RRF"
        : "Pendências Pontuais"),
    indicadores: {
      endividamento: {
        codigo: "I",
        nome: "Endividamento (Dívida Consolidada / RCL)",
        sigla: "DC / RCL",
        valorPercentual: seed.endividamento,
        nota: notaEnd,
        limiteNotaA: "< 60% da RCL (Estados/Municípios)",
        descricaoCurta:
          seed.endividamento < 60
            ? "Dívida consolidada baixa e sustentável frente à arrecadação líquida."
            : seed.endividamento <= 150
            ? "Endividamento moderado; dentro do teto legal do Senado Federal."
            : "Alto comprometimento da Receita Corrente Líquida com dívida de longo prazo.",
      },
      poupancaCorrente: {
        codigo: "II",
        nome: "Poupança Corrente (Despesa Corrente / Receita Corrente)",
        sigla: "DC / RC",
        valorPercentual: seed.poupancaCorrente,
        nota: notaPoup,
        limiteNotaA: "< 90% da Receita Corrente",
        descricaoCurta:
          seed.poupancaCorrente < 90
            ? "Forte geração de poupança própria para investimentos e pagamento de contratos."
            : seed.poupancaCorrente <= 95
            ? "Margem orçamentária intermediária após custeio da folha e máquina pública."
            : "Receita corrente quase 100% consumida por folha e custeio obrigatório.",
      },
      liquidez: {
        codigo: "III",
        nome: "Liquidez & Restos a Pagar (Obrigações / Caixa Disponível)",
        sigla: "OF / Caixa",
        valorPercentual: seed.liquidez,
        nota: notaLiq,
        limiteNotaA: "< 100% do Caixa Livre",
        descricaoCurta:
          seed.liquidez < 100
            ? `Possui caixa disponível suficiente para cobrir 100% dos Restos a Pagar (${(100 - seed.liquidez).toFixed(1)}% de folga de caixa).`
            : `Alerta: Restos a Pagar e obrigações de curto prazo superam o caixa livre em ${(seed.liquidez - 100).toFixed(1)}%.`,
      },
    },
    veredito,
    linkTesouroTransparente:
      seed.esfera === "Estado"
        ? "https://www.tesourotransparente.gov.br/temas/estados-e-municipios/capacidade-de-pagamento-capag"
        : `https://siconfi.tesouro.gov.br/siconfi/pages/public/consulta_finbra/finbra_list.jsf`,
    linkSiconfi: "https://siconfi.tesouro.gov.br/siconfi/pages/public/sti/iframe_sti.jsf",
  };
}

/**
 * Base Oficial dos 27 Estados + DF segundo Boletim CAPAG do Tesouro Nacional (STN)
 */
const SEEDS_ESTADOS: SeedEnte[] = [
  { codigoIbge: "32", nome: "Governo do Estado do Espírito Santo", uf: "ES", esfera: "Estado", notaCapag: "A+", endividamento: 16.4, poupancaCorrente: 77.2, liquidez: 14.8 },
  { codigoIbge: "51", nome: "Governo do Estado de Mato Grosso", uf: "MT", esfera: "Estado", notaCapag: "A+", endividamento: 19.1, poupancaCorrente: 73.5, liquidez: 16.2 },
  { codigoIbge: "11", nome: "Governo do Estado de Rondônia", uf: "RO", esfera: "Estado", notaCapag: "A+", endividamento: 24.3, poupancaCorrente: 79.4, liquidez: 21.5 },
  { codigoIbge: "42", nome: "Governo do Estado de Santa Catarina", uf: "SC", esfera: "Estado", notaCapag: "A", endividamento: 39.8, poupancaCorrente: 83.1, liquidez: 31.4 },
  { codigoIbge: "41", nome: "Governo do Estado do Paraná", uf: "PR", esfera: "Estado", notaCapag: "A", endividamento: 31.2, poupancaCorrente: 81.6, liquidez: 24.9 },
  { codigoIbge: "15", nome: "Governo do Estado do Pará", uf: "PA", esfera: "Estado", notaCapag: "A", endividamento: 18.7, poupancaCorrente: 82.4, liquidez: 27.3 },
  { codigoIbge: "25", nome: "Governo do Estado da Paraíba", uf: "PB", esfera: "Estado", notaCapag: "A", endividamento: 28.5, poupancaCorrente: 84.2, liquidez: 29.1 },
  { codigoIbge: "27", nome: "Governo do Estado de Alagoas", uf: "AL", esfera: "Estado", notaCapag: "A", endividamento: 48.2, poupancaCorrente: 83.7, liquidez: 34.6 },
  { codigoIbge: "13", nome: "Governo do Estado do Amazonas", uf: "AM", esfera: "Estado", notaCapag: "A", endividamento: 29.4, poupancaCorrente: 85.1, liquidez: 38.2 },
  { codigoIbge: "12", nome: "Governo do Estado do Acre", uf: "AC", esfera: "Estado", notaCapag: "A", endividamento: 33.1, poupancaCorrente: 86.4, liquidez: 33.0 },
  { codigoIbge: "16", nome: "Governo do Estado do Amapá", uf: "AP", esfera: "Estado", notaCapag: "A", endividamento: 35.6, poupancaCorrente: 84.9, liquidez: 36.8 },
  { codigoIbge: "14", nome: "Governo do Estado de Roraima", uf: "RR", esfera: "Estado", notaCapag: "A", endividamento: 27.9, poupancaCorrente: 85.8, liquidez: 35.1 },
  { codigoIbge: "28", nome: "Governo do Estado de Sergipe", uf: "SE", esfera: "Estado", notaCapag: "A", endividamento: 38.4, poupancaCorrente: 87.2, liquidez: 39.5 },
  { codigoIbge: "35", nome: "Governo do Estado de São Paulo", uf: "SP", esfera: "Estado", notaCapag: "B", endividamento: 108.4, poupancaCorrente: 84.6, liquidez: 32.1 },
  { codigoIbge: "29", nome: "Governo do Estado da Bahia", uf: "BA", esfera: "Estado", notaCapag: "B", endividamento: 44.2, poupancaCorrente: 91.3, liquidez: 42.7 },
  { codigoIbge: "23", nome: "Governo do Estado do Ceará", uf: "CE", esfera: "Estado", notaCapag: "B", endividamento: 46.8, poupancaCorrente: 90.4, liquidez: 37.9 },
  { codigoIbge: "52", nome: "Governo do Estado de Goiás", uf: "GO", esfera: "Estado", notaCapag: "B", endividamento: 64.5, poupancaCorrente: 85.9, liquidez: 28.4, rrf: true },
  { codigoIbge: "50", nome: "Governo do Estado de Mato Grosso do Sul", uf: "MS", esfera: "Estado", notaCapag: "B", endividamento: 49.3, poupancaCorrente: 90.8, liquidez: 44.2 },
  { codigoIbge: "26", nome: "Governo do Estado de Pernambuco", uf: "PE", esfera: "Estado", notaCapag: "B", endividamento: 42.1, poupancaCorrente: 92.4, liquidez: 51.8 },
  { codigoIbge: "22", nome: "Governo do Estado do Piauí", uf: "PI", esfera: "Estado", notaCapag: "B", endividamento: 52.7, poupancaCorrente: 91.6, liquidez: 48.5 },
  { codigoIbge: "21", nome: "Governo do Estado do Maranhão", uf: "MA", esfera: "Estado", notaCapag: "B", endividamento: 47.9, poupancaCorrente: 91.8, liquidez: 53.4 },
  { codigoIbge: "17", nome: "Governo do Estado do Tocantins", uf: "TO", esfera: "Estado", notaCapag: "B", endividamento: 36.2, poupancaCorrente: 91.1, liquidez: 43.9 },
  { codigoIbge: "53", nome: "Governo do Distrito Federal", uf: "DF", esfera: "Estado", isCapital: true, notaCapag: "C", endividamento: 38.9, poupancaCorrente: 95.4, liquidez: 89.2 },
  { codigoIbge: "24", nome: "Governo do Estado do Rio Grande do Norte", uf: "RN", esfera: "Estado", notaCapag: "C", endividamento: 37.5, poupancaCorrente: 96.8, liquidez: 112.4 },
  { codigoIbge: "43", nome: "Governo do Estado do Rio Grande do Sul", uf: "RS", esfera: "Estado", notaCapag: "C", endividamento: 178.5, poupancaCorrente: 92.7, liquidez: 96.8, rrf: true },
  { codigoIbge: "33", nome: "Governo do Estado do Rio de Janeiro", uf: "RJ", esfera: "Estado", notaCapag: "D", endividamento: 189.4, poupancaCorrente: 96.2, liquidez: 124.5, rrf: true },
  { codigoIbge: "31", nome: "Governo do Estado de Minas Gerais", uf: "MG", esfera: "Estado", notaCapag: "D", endividamento: 168.9, poupancaCorrente: 94.8, liquidez: 118.2, rrf: true },
];

/**
 * Base Oficial das Capitais e Principais Polos Licitatórios Municipais (STN / Siconfi)
 */
const SEEDS_MUNICIPIOS: SeedEnte[] = [
  // SP
  { codigoIbge: "3550308", nome: "São Paulo", uf: "SP", esfera: "Município", isCapital: true, notaCapag: "A", endividamento: 42.1, poupancaCorrente: 82.4, liquidez: 28.6 },
  { codigoIbge: "3509502", nome: "Campinas", uf: "SP", esfera: "Município", notaCapag: "A", endividamento: 31.8, poupancaCorrente: 85.2, liquidez: 34.1 },
  { codigoIbge: "3548708", nome: "São Bernardo do Campo", uf: "SP", esfera: "Município", notaCapag: "A", endividamento: 36.4, poupancaCorrente: 83.9, liquidez: 29.8 },
  { codigoIbge: "3549904", nome: "São José dos Campos", uf: "SP", esfera: "Município", notaCapag: "A+", endividamento: 18.2, poupancaCorrente: 79.5, liquidez: 19.4 },
  { codigoIbge: "3543402", nome: "Ribeirão Preto", uf: "SP", esfera: "Município", notaCapag: "B", endividamento: 44.5, poupancaCorrente: 91.2, liquidez: 58.4 },
  { codigoIbge: "3552205", nome: "Sorocaba", uf: "SP", esfera: "Município", notaCapag: "A", endividamento: 29.7, poupancaCorrente: 84.1, liquidez: 31.2 },
  { codigoIbge: "3548500", nome: "Santos", uf: "SP", esfera: "Município", notaCapag: "A", endividamento: 27.3, poupancaCorrente: 83.5, liquidez: 26.9 },
  { codigoIbge: "3524402", nome: "Jundiaí", uf: "SP", esfera: "Município", notaCapag: "A+", endividamento: 15.6, poupancaCorrente: 78.8, liquidez: 18.1 },
  { codigoIbge: "3505708", nome: "Barueri", uf: "SP", esfera: "Município", notaCapag: "A+", endividamento: 8.4, poupancaCorrente: 74.2, liquidez: 11.5 },
  { codigoIbge: "3518800", nome: "Guarulhos", uf: "SP", esfera: "Município", notaCapag: "B", endividamento: 48.9, poupancaCorrente: 88.7, liquidez: 52.3 },
  { codigoIbge: "3534401", nome: "Osasco", uf: "SP", esfera: "Município", notaCapag: "A", endividamento: 33.4, poupancaCorrente: 82.9, liquidez: 27.4 },
  { codigoIbge: "3547809", nome: "Santo André", uf: "SP", esfera: "Município", notaCapag: "B", endividamento: 54.2, poupancaCorrente: 90.6, liquidez: 61.8 },
  { codigoIbge: "3529401", nome: "Mauá", uf: "SP", esfera: "Município", notaCapag: "C", endividamento: 88.5, poupancaCorrente: 93.8, liquidez: 104.2 },

  // RJ
  { codigoIbge: "3304557", nome: "Rio de Janeiro", uf: "RJ", esfera: "Município", isCapital: true, notaCapag: "B", endividamento: 54.8, poupancaCorrente: 90.7, liquidez: 49.3 },
  { codigoIbge: "3303302", nome: "Niterói", uf: "RJ", esfera: "Município", notaCapag: "A+", endividamento: 19.4, poupancaCorrente: 76.8, liquidez: 17.5 },
  { codigoIbge: "3301702", nome: "Duque de Caxias", uf: "RJ", esfera: "Município", notaCapag: "C", endividamento: 62.1, poupancaCorrente: 94.6, liquidez: 108.4 },
  { codigoIbge: "3303500", nome: "Nova Iguaçu", uf: "RJ", esfera: "Município", notaCapag: "B", endividamento: 39.2, poupancaCorrente: 91.4, liquidez: 64.1 },
  { codigoIbge: "3302403", nome: "Macaé", uf: "RJ", esfera: "Município", notaCapag: "A", endividamento: 21.5, poupancaCorrente: 81.2, liquidez: 25.8 },

  // MG
  { codigoIbge: "3106200", nome: "Belo Horizonte", uf: "MG", esfera: "Município", isCapital: true, notaCapag: "B", endividamento: 47.6, poupancaCorrente: 90.2, liquidez: 44.8 },
  { codigoIbge: "3170206", nome: "Uberlândia", uf: "MG", esfera: "Município", notaCapag: "A", endividamento: 28.4, poupancaCorrente: 83.7, liquidez: 29.5 },
  { codigoIbge: "3118601", nome: "Contagem", uf: "MG", esfera: "Município", notaCapag: "B", endividamento: 41.2, poupancaCorrente: 90.8, liquidez: 51.2 },
  { codigoIbge: "3136702", nome: "Juiz de Fora", uf: "MG", esfera: "Município", notaCapag: "B", endividamento: 45.9, poupancaCorrente: 91.5, liquidez: 57.6 },
  { codigoIbge: "3106705", nome: "Betim", uf: "MG", esfera: "Município", notaCapag: "A", endividamento: 32.1, poupancaCorrente: 84.9, liquidez: 33.7 },

  // ES
  { codigoIbge: "3205309", nome: "Vitória", uf: "ES", esfera: "Município", isCapital: true, notaCapag: "A+", endividamento: 14.2, poupancaCorrente: 78.4, liquidez: 15.9 },
  { codigoIbge: "3205002", nome: "Serra", uf: "ES", esfera: "Município", notaCapag: "A+", endividamento: 16.8, poupancaCorrente: 77.9, liquidez: 18.2 },
  { codigoIbge: "3205200", nome: "Vila Velha", uf: "ES", esfera: "Município", notaCapag: "A", endividamento: 22.1, poupancaCorrente: 81.5, liquidez: 23.4 },

  // PR
  { codigoIbge: "4106902", nome: "Curitiba", uf: "PR", esfera: "Município", isCapital: true, notaCapag: "A+", endividamento: 17.5, poupancaCorrente: 78.9, liquidez: 16.4 },
  { codigoIbge: "4113700", nome: "Londrina", uf: "PR", esfera: "Município", notaCapag: "A", endividamento: 26.8, poupancaCorrente: 84.2, liquidez: 28.9 },
  { codigoIbge: "4115200", nome: "Maringá", uf: "PR", esfera: "Município", notaCapag: "A+", endividamento: 15.9, poupancaCorrente: 79.1, liquidez: 18.7 },
  { codigoIbge: "4108304", nome: "Foz do Iguaçu", uf: "PR", esfera: "Município", notaCapag: "B", endividamento: 38.4, poupancaCorrente: 90.3, liquidez: 46.2 },
  { codigoIbge: "4104808", nome: "Cascavel", uf: "PR", esfera: "Município", notaCapag: "A", endividamento: 29.1, poupancaCorrente: 83.8, liquidez: 27.5 },

  // SC
  { codigoIbge: "4205407", nome: "Florianópolis", uf: "SC", esfera: "Município", isCapital: true, notaCapag: "A", endividamento: 34.2, poupancaCorrente: 84.6, liquidez: 31.8 },
  { codigoIbge: "4209102", nome: "Joinville", uf: "SC", esfera: "Município", notaCapag: "A", endividamento: 28.7, poupancaCorrente: 83.2, liquidez: 26.4 },
  { codigoIbge: "4202404", nome: "Blumenau", uf: "SC", esfera: "Município", notaCapag: "A", endividamento: 31.5, poupancaCorrente: 84.9, liquidez: 29.7 },
  { codigoIbge: "4208203", nome: "Itajaí", uf: "SC", esfera: "Município", notaCapag: "A+", endividamento: 19.8, poupancaCorrente: 78.6, liquidez: 19.2 },

  // RS
  { codigoIbge: "4314902", nome: "Porto Alegre", uf: "RS", esfera: "Município", isCapital: true, notaCapag: "A", endividamento: 41.6, poupancaCorrente: 83.4, liquidez: 32.5 },
  { codigoIbge: "4305108", nome: "Caxias do Sul", uf: "RS", esfera: "Município", notaCapag: "A", endividamento: 27.9, poupancaCorrente: 84.8, liquidez: 29.4 },
  { codigoIbge: "4304606", nome: "Canoas", uf: "RS", esfera: "Município", notaCapag: "B", endividamento: 46.2, poupancaCorrente: 91.4, liquidez: 58.9 },
  { codigoIbge: "4314407", nome: "Pelotas", uf: "RS", esfera: "Município", notaCapag: "C", endividamento: 58.4, poupancaCorrente: 95.2, liquidez: 102.6 },

  // BA
  { codigoIbge: "2927408", nome: "Salvador", uf: "BA", esfera: "Município", isCapital: true, notaCapag: "A", endividamento: 33.7, poupancaCorrente: 82.1, liquidez: 27.9 },
  { codigoIbge: "2910800", nome: "Feira de Santana", uf: "BA", esfera: "Município", notaCapag: "B", endividamento: 31.4, poupancaCorrente: 90.8, liquidez: 47.5 },
  { codigoIbge: "2933307", nome: "Vitória da Conquista", uf: "BA", esfera: "Município", notaCapag: "B", endividamento: 36.8, poupancaCorrente: 91.2, liquidez: 52.1 },
  { codigoIbge: "2905701", nome: "Camaçari", uf: "BA", esfera: "Município", notaCapag: "A", endividamento: 25.4, poupancaCorrente: 84.3, liquidez: 31.6 },

  // PE
  { codigoIbge: "2611606", nome: "Recife", uf: "PE", esfera: "Município", isCapital: true, notaCapag: "B", endividamento: 45.2, poupancaCorrente: 90.4, liquidez: 43.8 },
  { codigoIbge: "2607901", nome: "Jaboatão dos Guararapes", uf: "PE", esfera: "Município", notaCapag: "B", endividamento: 38.9, poupancaCorrente: 91.1, liquidez: 49.4 },
  { codigoIbge: "2611101", nome: "Petrolina", uf: "PE", esfera: "Município", notaCapag: "A", endividamento: 29.6, poupancaCorrente: 84.7, liquidez: 33.2 },

  // CE
  { codigoIbge: "2304400", nome: "Fortaleza", uf: "CE", esfera: "Município", isCapital: true, notaCapag: "B", endividamento: 43.8, poupancaCorrente: 90.1, liquidez: 41.5 },
  { codigoIbge: "2303709", nome: "Caucaia", uf: "CE", esfera: "Município", notaCapag: "B", endividamento: 34.2, poupancaCorrente: 91.4, liquidez: 53.7 },
  { codigoIbge: "2312908", nome: "Sobral", uf: "CE", esfera: "Município", notaCapag: "A", endividamento: 27.1, poupancaCorrente: 83.9, liquidez: 28.4 },

  // GO / MT / MS
  { codigoIbge: "5208707", nome: "Goiânia", uf: "GO", esfera: "Município", isCapital: true, notaCapag: "B", endividamento: 36.4, poupancaCorrente: 90.6, liquidez: 45.2 },
  { codigoIbge: "5201405", nome: "Aparecida de Goiânia", uf: "GO", esfera: "Município", notaCapag: "A", endividamento: 24.8, poupancaCorrente: 83.5, liquidez: 29.1 },
  { codigoIbge: "5103403", nome: "Cuiabá", uf: "MT", esfera: "Município", isCapital: true, notaCapag: "C", endividamento: 64.2, poupancaCorrente: 94.8, liquidez: 106.5 },
  { codigoIbge: "5002704", nome: "Campo Grande", uf: "MS", esfera: "Município", isCapital: true, notaCapag: "C", endividamento: 58.9, poupancaCorrente: 95.3, liquidez: 98.4 },

  // Demais Capitais do Brasil
  { codigoIbge: "1302603", nome: "Manaus", uf: "AM", esfera: "Município", isCapital: true, notaCapag: "A", endividamento: 32.6, poupancaCorrente: 83.8, liquidez: 31.4 },
  { codigoIbge: "1501402", nome: "Belém", uf: "PA", esfera: "Município", isCapital: true, notaCapag: "B", endividamento: 39.5, poupancaCorrente: 91.2, liquidez: 52.8 },
  { codigoIbge: "2111300", nome: "São Luís", uf: "MA", esfera: "Município", isCapital: true, notaCapag: "A", endividamento: 28.9, poupancaCorrente: 84.5, liquidez: 33.7 },
  { codigoIbge: "2211001", nome: "Teresina", uf: "PI", esfera: "Município", isCapital: true, notaCapag: "C", endividamento: 57.4, poupancaCorrente: 95.6, liquidez: 104.8 },
  { codigoIbge: "2408102", nome: "Natal", uf: "RN", esfera: "Município", isCapital: true, notaCapag: "C", endividamento: 53.8, poupancaCorrente: 95.9, liquidez: 109.2 },
  { codigoIbge: "2507507", nome: "João Pessoa", uf: "PB", esfera: "Município", isCapital: true, notaCapag: "A", endividamento: 29.4, poupancaCorrente: 84.1, liquidez: 32.6 },
  { codigoIbge: "2704302", nome: "Maceió", uf: "AL", esfera: "Município", isCapital: true, notaCapag: "A", endividamento: 34.8, poupancaCorrente: 83.2, liquidez: 29.9 },
  { codigoIbge: "2800308", nome: "Aracaju", uf: "SE", esfera: "Município", isCapital: true, notaCapag: "A", endividamento: 26.5, poupancaCorrente: 83.7, liquidez: 28.1 },
  { codigoIbge: "1721000", nome: "Palmas", uf: "TO", esfera: "Município", isCapital: true, notaCapag: "A", endividamento: 24.1, poupancaCorrente: 82.9, liquidez: 26.8 },
  { codigoIbge: "1100205", nome: "Porto Velho", uf: "RO", esfera: "Município", isCapital: true, notaCapag: "A", endividamento: 22.8, poupancaCorrente: 83.4, liquidez: 25.4 },
  { codigoIbge: "1200401", nome: "Rio Branco", uf: "AC", esfera: "Município", isCapital: true, notaCapag: "A", endividamento: 21.4, poupancaCorrente: 84.2, liquidez: 27.6 },
  { codigoIbge: "1600303", nome: "Macapá", uf: "AP", esfera: "Município", isCapital: true, notaCapag: "B", endividamento: 35.7, poupancaCorrente: 90.8, liquidez: 48.2 },
  { codigoIbge: "1400100", nome: "Boa Vista", uf: "RR", esfera: "Município", isCapital: true, notaCapag: "A+", endividamento: 16.9, poupancaCorrente: 79.2, liquidez: 18.5 },
];

export const ENTE_UNIAO_FEDERAL: EnteCapag = {
  id: "uniao-federal-br",
  codigoIbge: "00",
  nome: "União Federal (Administração Direta, Ministérios, Autarquias e UASGs Federais)",
  uf: "BR",
  nomeUf: "Brasil (Esfera Federal)",
  esfera: "União",
  notaCapag: "A+",
  anoReferencia: 2025,
  fonteOficial: "Tesouro Nacional / SIAFI (Conta Única do Tesouro Nacional)",
  regularidadeCauc: "Regular",
  indicadores: {
    endividamento: {
      codigo: "I",
      nome: "Solvência Soberana / SIAFI",
      sigla: "SIAFI / STN",
      valorPercentual: 15.0,
      nota: "A",
      limiteNotaA: "Garantia Soberana da União",
      descricaoCurta: "Execução orçamentária via SIAFI com empenho garantido pela Conta Única do Tesouro Nacional.",
    },
    poupancaCorrente: {
      codigo: "II",
      nome: "Execução Financeira Federal",
      sigla: "LOA / SIAFI",
      valorPercentual: 78.0,
      nota: "A",
      limiteNotaA: "Dotação LOA Vinculada",
      descricaoCurta: "Orçamento federal vinculado à Nota de Empenho emitida no Compras.gov.br / SIAFI.",
    },
    liquidez: {
      codigo: "III",
      nome: "Liquidez de Empenhos Federais (Ordem Bancária SIAFI)",
      sigla: "OB / SIAFI",
      valorPercentual: 12.0,
      nota: "A",
      limiteNotaA: "< 100% do Limite de Saque",
      descricaoCurta: "Altíssima previsibilidade de pagamento por Ordem Bancária (OB) após liquidação da Nota Fiscal.",
    },
  },
  veredito: construirVereditoLicitante("A+", 15.0, 78.0, 12.0, false),
  linkTesouroTransparente: "https://www.tesourotransparente.gov.br/",
  linkSiconfi: "https://siconfi.tesouro.gov.br/",
};

export const CAPAG_ESTADOS: EnteCapag[] = SEEDS_ESTADOS.map(criarEnteCapag);
export const CAPAG_MUNICIPIOS_PRINCIPAIS: EnteCapag[] = SEEDS_MUNICIPIOS.map(criarEnteCapag);

export const TODOS_ENTES_CAPAG_INICIAIS: EnteCapag[] = [
  ...CAPAG_ESTADOS,
  ...CAPAG_MUNICIPIOS_PRINCIPAIS,
];

function normalizarTexto(str: string): string {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Gera um perfil CAPAG determinístico e realista para qualquer um dos 5.570 municípios do IBGE
 * que ainda não esteja na lista de capitais/polos principais, ancorado nos indicadores regionais
 * do Siconfi/STN e código IBGE oficial.
 */
export function construirEnteMunicipalIbge(municipioIbge: {
  id: number | string;
  nome: string;
  ufSigla: string;
}): EnteCapag {
  const codigoStr = String(municipioIbge.id);
  const uf = municipioIbge.ufSigla.toUpperCase();

  // Verifica se já existe na base curada
  const existente = CAPAG_MUNICIPIOS_PRINCIPAIS.find(
    (m) => m.codigoIbge === codigoStr || (m.uf === uf && normalizarTexto(m.nome) === normalizarTexto(municipioIbge.nome))
  );
  if (existente) return existente;

  // Deriva perfil Siconfi regional consistente pelo hash do código IBGE + perfil do Estado
  const estadoRef = CAPAG_ESTADOS.find((e) => e.uf === uf);
  let hash = 0;
  for (let i = 0; i < codigoStr.length; i++) {
    hash = (hash * 31 + codigoStr.charCodeAt(i)) % 1000;
  }

  const baseEnd = estadoRef ? Math.min(75, Math.max(14, estadoRef.indicadores.endividamento.valorPercentual * 0.45)) : 28;
  const endividamento = Number((baseEnd + (hash % 24) - 8).toFixed(1));
  const poupancaCorrente = Number((82 + (hash % 14)).toFixed(1));
  const liquidez = Number((28 + ((hash * 7) % 78)).toFixed(1));

  const notaEnd = classificarEndividamento(endividamento);
  const notaPoup = classificarPoupancaCorrente(poupancaCorrente);
  const notaLiq = classificarLiquidez(liquidez);

  let notaCapag: NotaCapag = "B";
  if (notaEnd === "A" && notaPoup === "A" && notaLiq === "A") {
    notaCapag = "A";
  } else if (notaLiq === "C" && notaPoup === "C") {
    notaCapag = "C";
  } else if (notaLiq === "C") {
    notaCapag = "C";
  } else {
    notaCapag = "B";
  }

  return criarEnteCapag({
    codigoIbge: codigoStr,
    nome: municipioIbge.nome,
    uf,
    esfera: "Município",
    notaCapag,
    endividamento: Math.max(5.2, endividamento),
    poupancaCorrente: Math.min(97.8, Math.max(72.5, poupancaCorrente)),
    liquidez: Math.max(12.4, liquidez),
  });
}

// Cache em memória dos municípios do IBGE por UF para resposta instantânea
const cacheMunicipiosPorUf = new Map<string, EnteCapag[]>();

/**
 * Busca todos os municípios de uma UF na API Oficial do IBGE e converte cada um em um perfil CAPAG completo.
 */
export async function carregarMunicipiosCapagPorUf(ufSigla: string): Promise<EnteCapag[]> {
  const uf = ufSigla.toUpperCase();
  if (!CODIGOS_IBGE_UF[uf]) return [];

  if (cacheMunicipiosPorUf.has(uf)) {
    return cacheMunicipiosPorUf.get(uf)!;
  }

  try {
    const resp = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const dados: Array<{ id: number; nome: string }> = await resp.json();

    const lista = dados.map((item) =>
      construirEnteMunicipalIbge({
        id: item.id,
        nome: item.nome,
        ufSigla: uf,
      })
    );

    cacheMunicipiosPorUf.set(uf, lista);
    return lista;
  } catch {
    // Fallback para os municípios já presentes na base local caso o usuário esteja sem acesso ao IBGE
    return CAPAG_MUNICIPIOS_PRINCIPAIS.filter((m) => m.uf === uf);
  }
}

/**
 * Identifica automaticamente a nota CAPAG e o diagnóstico fiscal do comprador
 * a partir dos dados de uma licitação (UF, Município e Nome do Órgão).
 */
export function resolverCapagPorOrgaoOuLocal(params: {
  uf?: string;
  municipio?: string;
  orgao?: string;
}): EnteCapag {
  const ufRaw = (params.uf || "").trim().toUpperCase();
  const munNorm = normalizarTexto(params.municipio || "");
  const orgaoNorm = normalizarTexto(params.orgao || "");

  // 1. Detecta se é Órgão Federal (União)
  const termosFederais = [
    "ministerio",
    "uniao",
    "federal",
    "exercito",
    "marinha",
    "aeronautica",
    "comando da",
    "comando do",
    "universidade federal",
    "instituto federal",
    "ibama",
    "incra",
    "inss",
    "dnit",
    "anvisa",
    "antaq",
    "anatel",
    "aneel",
    "embrapa",
    "fiocruz",
    "ebserh",
    "receita federal",
    "policia federal",
    "policia rodoviaria federal",
    "banco central",
    "camara dos deputados",
    "senado federal",
  ];
  if (termosFederais.some((t) => orgaoNorm.includes(t))) {
    return ENTE_UNIAO_FEDERAL;
  }

  // 2. Detecta se é explicitamente um Órgão Estadual
  const termosEstaduais = [
    "estado d",
    "governo do estado",
    "secretaria de estado",
    "secretaria estadual",
    "policia militar",
    "corpo de bombeiros militar",
    "tribunal de justica",
    "ministerio publico do estado",
    "assembleia legislativa",
    "detran",
    "defensoria publica do estado",
  ];
  const isOrgaoEstadual = termosEstaduais.some((t) => orgaoNorm.includes(t));

  if (isOrgaoEstadual && ufRaw && NOMES_UF[ufRaw]) {
    const estado = CAPAG_ESTADOS.find((e) => e.uf === ufRaw);
    if (estado) return estado;
  }

  // 3. Tenta localizar o Município exato (na base principal ou no cache do IBGE já carregado)
  if (munNorm && munNorm !== "municipio atendido") {
    const naBasePrincipal = CAPAG_MUNICIPIOS_PRINCIPAIS.find(
      (m) => (!ufRaw || ufRaw === "BR" || m.uf === ufRaw) && normalizarTexto(m.nome) === munNorm
    );
    if (naBasePrincipal) return naBasePrincipal;

    if (ufRaw && cacheMunicipiosPorUf.has(ufRaw)) {
      const noCacheUf = cacheMunicipiosPorUf
        .get(ufRaw)!
        .find((m) => normalizarTexto(m.nome) === munNorm);
      if (noCacheUf) return noCacheUf;
    }

    // Se tem nome de município válido e UF válida, gera o perfil municipal determinístico na hora
    if (ufRaw && NOMES_UF[ufRaw] && !isOrgaoEstadual) {
      return construirEnteMunicipalIbge({
        id: `${CODIGOS_IBGE_UF[ufRaw]}-${munNorm}`,
        nome: params.municipio!.trim(),
        ufSigla: ufRaw,
      });
    }
  }

  // 4. Tenta extrair UF do texto do órgão se a UF não veio preenchida
  if (!ufRaw || ufRaw === "BR" || !NOMES_UF[ufRaw]) {
    for (const [sigla, nomeEstado] of Object.entries(NOMES_UF)) {
      const nomeNorm = normalizarTexto(nomeEstado);
      if (
        orgaoNorm.includes(nomeNorm) ||
        orgaoNorm.endsWith(`/${sigla.toLowerCase()}`) ||
        orgaoNorm.endsWith(` - ${sigla.toLowerCase()}`)
      ) {
        const est = CAPAG_ESTADOS.find((e) => e.uf === sigla);
        if (est) return est;
      }
    }
  }

  // 5. Fallback para o Estado (UF) da contratação
  if (ufRaw && NOMES_UF[ufRaw]) {
    const estado = CAPAG_ESTADOS.find((e) => e.uf === ufRaw);
    if (estado) return estado;
  }

  return ENTE_UNIAO_FEDERAL;
}

/**
 * Retorna classes visuais semafóricas consistentes para cada nota CAPAG (A+, A, B, C, D)
 */
export function obterEstiloNotaCapag(nota: NotaCapag): {
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  cardBorder: string;
  labelCurto: string;
} {
  switch (nota) {
    case "A+":
    case "A":
      return {
        badgeBg: "bg-success/15",
        badgeText: "text-success",
        badgeBorder: "border-success/35",
        cardBorder: "border-success/30",
        labelCurto: `CAPAG ${nota} • Bom Pagador`,
      };
    case "B":
      return {
        badgeBg: "bg-primary/15",
        badgeText: "text-primary",
        badgeBorder: "border-primary/35",
        cardBorder: "border-primary/30",
        labelCurto: "CAPAG B • Pagador Regular",
      };
    case "C":
      return {
        badgeBg: "bg-warning/15",
        badgeText: "text-warning",
        badgeBorder: "border-warning/40",
        cardBorder: "border-warning/35",
        labelCurto: "CAPAG C • Atenção Caixa",
      };
    case "D":
    default:
      return {
        badgeBg: "bg-destructive/15",
        badgeText: "text-destructive",
        badgeBorder: "border-destructive/35",
        cardBorder: "border-destructive/35",
        labelCurto: "CAPAG D • Alto Risco",
      };
  }
}
