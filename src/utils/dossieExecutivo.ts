import { jsPDF } from "jspdf";
import {
  EditalAnalysis,
  DossieExecutivoData,
  DossieParametroOficial,
  DossiePontoAtencao,
  DossieChecklistCategoria,
} from "../types";
import { resolverCapagPorOrgaoOuLocal } from "./capagData";
import { normalizarCodigoUasg, extrairCodigoUasg } from "./identificacaoEdital";

export interface TemaDossieConfig {
  id: "emerald" | "terracotta" | "navy";
  nome: string;
  primaryHex: string;
  primaryRgb: [number, number, number];
  tintHex: string;
  tintRgb: [number, number, number];
  borderTintHex: string;
  alertHex: string;
  alertRgb: [number, number, number];
}

export const TEMAS_DOSSIE: Record<"emerald" | "terracotta" | "navy", TemaDossieConfig> = {
  emerald: {
    id: "emerald",
    nome: "Verde Institucional",
    primaryHex: "#0d5c38",
    primaryRgb: [13, 92, 56],
    tintHex: "#e6f4ed",
    tintRgb: [230, 244, 237],
    borderTintHex: "#a7d7bf",
    alertHex: "#b91c1c",
    alertRgb: [185, 28, 28],
  },
  terracotta: {
    id: "terracotta",
    nome: "Terracota Executivo",
    primaryHex: "#7c2d12",
    primaryRgb: [124, 45, 18],
    tintHex: "#fdf0eb",
    tintRgb: [253, 240, 235],
    borderTintHex: "#e6b8a6",
    alertHex: "#b91c1c",
    alertRgb: [185, 28, 28],
  },
  navy: {
    id: "navy",
    nome: "Azul Corporativo",
    primaryHex: "#1e3a8a",
    primaryRgb: [30, 58, 138],
    tintHex: "#eff6ff",
    tintRgb: [239, 246, 255],
    borderTintHex: "#bfdbfe",
    alertHex: "#b91c1c",
    alertRgb: [185, 28, 28],
  },
};

export function parseValorMonetario(raw: string | number | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (!raw) return 0;
  const str = String(raw).trim();
  const brMatch = str.match(/(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/);
  if (brMatch) {
    const num = parseFloat(brMatch[1].replace(/\./g, "").replace(",", "."));
    return Number.isFinite(num) ? num : 0;
  }
  const usMatch = str.match(/(\d+(?:\.\d{1,2})?)/);
  if (usMatch) {
    const num = parseFloat(usMatch[1]);
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
}

export function formatarMoedaBR(valor: number): string {
  if (!Number.isFinite(valor) || valor <= 0) return "—";
  return `R$ ${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function extrairUasgEdital(edital: EditalAnalysis): string {
  const ic: any = edital.identificacaoCertame || {};
  const candidato =
    normalizarCodigoUasg(ic.codigoUASG) ||
    normalizarCodigoUasg(ic.uasg) ||
    normalizarCodigoUasg(ic.uasgUndCompradora) ||
    normalizarCodigoUasg((edital as any).uasg);
  if (candidato) return candidato;

  const combined = [ic.orgaoComprador || "", edital.rawText || "", edital.reportMarkdown || ""].join(" ");
  return extrairCodigoUasg(combined) || "";
}

function inferirCategoriaKicker(edital: EditalAnalysis): string {
  const texto = `${edital.descricaoProduto || ""} ${(edital.itensEdital || []).map(i => i.descricao).join(" ")}`.toLowerCase();
  if (/saas|software|licen[cç]a|sistema|nuvem|ia\b|intelig[eê]ncia artificial|ti\b/.test(texto)) {
    return "SOFTWARE E TECNOLOGIA (SAAS)";
  }
  if (/epi|cal[cç]ado|bota|t[eê]nis|luva|capacete|prote[cç][aã]o/.test(texto)) {
    return "EPI E SEGURANÇA OCUPACIONAL";
  }
  if (/fardamento|uniforme|vestu[aá]rio|camisa|jaqueta|tecido/.test(texto)) {
    return "VESTUÁRIO E FARDAMENTO";
  }
  if (/medicamento|hospitalar|sa[uú]de|m[eé]dico|odonto|enfermagem/.test(texto)) {
    return "SAÚDE E INSUMOS HOSPITALARES";
  }
  if (/obra|engenharia|reforma|pavimenta[cç][aã]o|constru[cç][aã]o/.test(texto)) {
    return "OBRAS E SERVIÇOS DE ENGENHARIA";
  }
  if (/alimento|merenda|g[eê]nero|cesta b[aá]sica/.test(texto)) {
    return "GÊNEROS ALIMENTÍCIOS";
  }
  if (/ve[ií]culo|frota|loca[cç][aã]o|transporte|combust[ií]vel/.test(texto)) {
    return "FROTA, LOGÍSTICA E TRANSPORTE";
  }
  if (/mobili[aá]rio|cadeira|mesa|arm[aá]rio|eletro|ar[- ]condicionado/.test(texto)) {
    return "EQUIPAMENTOS E MOBILIÁRIO";
  }
  return "CONTRATAÇÃO PÚBLICA";
}

function transformarAlertaEmPontoAtencao(textoBruto: string, indice: number): DossiePontoAtencao {
  const limpo = textoBruto.replace(/^[\s•\-\*\d\.]+/, "").trim();
  const prefixoMatch = limpo.match(/^(?:PONTO DE ATEN[CÇ][AÃ]O|PEGADINHA|ALERTA)\s*\d*\s*[\—\-\:]\s*(.+)/i);
  const corpo = prefixoMatch ? prefixoMatch[1].trim() : limpo;

  // Tenta separar título e explicação por ":" ou "—"
  const separadorDoisPontos = corpo.indexOf(":");
  const separadorTravessao = corpo.indexOf(" — ");

  if (separadorDoisPontos > 4 && separadorDoisPontos < 130) {
    const titulo = corpo.slice(0, separadorDoisPontos).replace(/\*\*/g, "").trim();
    const descricao = corpo.slice(separadorDoisPontos + 1).trim();
    return {
      prefixo: `PONTO DE ATENÇÃO ${indice + 1}`,
      titulo,
      descricao: descricao || titulo,
    };
  }

  if (separadorTravessao > 4 && separadorTravessao < 110) {
    const titulo = corpo.slice(0, separadorTravessao).replace(/\*\*/g, "").trim();
    const descricao = corpo.slice(separadorTravessao + 3).trim();
    return {
      prefixo: `PONTO DE ATENÇÃO ${indice + 1}`,
      titulo,
      descricao: descricao || titulo,
    };
  }

  // Extrai primeiras palavras como título
  const palavras = corpo.replace(/\*\*/g, "").split(/\s+/);
  const tituloCurto = palavras.slice(0, Math.min(8, palavras.length)).join(" ");
  return {
    prefixo: `PONTO DE ATENÇÃO ${indice + 1}`,
    titulo: tituloCurto,
    descricao: corpo,
  };
}

function categorizarDocumentosHabilitacao(edital: EditalAnalysis): DossieChecklistCategoria[] {
  const docs = (edital.documentosExigidos || []).filter(
    d => d && !/^n[ãa]o\s+(especificad|identificad|informad)/i.test(d.trim())
  );

  const propostaItens: string[] = [];
  const juridicaFiscalItens: string[] = [];
  const economicoIntegridadeItens: string[] = [];
  const tecnicaItens: string[] = [];

  for (const doc of docs) {
    const lower = doc.toLowerCase();
    if (/proposta|cat[aá]logo|folheto|marca|modelo|amostra|planilha de custo|declara[cç][aã]o de integralidade/.test(lower)) {
      propostaItens.push(doc);
    } else if (/atestado|capacidade t[eé]cnica|acervo|crea|cau|cat\b|qualifica[cç][aã]o t[eé]cnica|c\.a\.|certificado de aprova/.test(lower)) {
      tecnicaItens.push(doc);
    } else if (/fal[eê]ncia|balan[cç]o|[ií]ndice|patrim[oô]nio l[ií]quido|econ[oô]mico|ceis|cnep|tcu|inid[oô]neo|cgu|correcional/.test(lower)) {
      economicoIntegridadeItens.push(doc);
    } else {
      juridicaFiscalItens.push(doc);
    }
  }

  const categorias: DossieChecklistCategoria[] = [];

  categorias.push({
    categoria: "Proposta Comercial e Especificação Técnica",
    descricao:
      propostaItens.length > 0
        ? propostaItens.join("; ")
        : "Planilha de preços em R$ (máx. 2 casas decimais) com indicação de **marca, modelo/referência** e descrição técnica compatível com o Termo de Referência.",
  });

  if (juridicaFiscalItens.length > 0) {
    categorias.push({
      categoria: "Habilitação Jurídica, Fiscal e Trabalhista",
      descricao: juridicaFiscalItens.join("; "),
    });
  } else {
    categorias.push({
      categoria: "Habilitação Jurídica, Fiscal e Trabalhista",
      descricao:
        "Contrato Social consolidado (ou CCMEI); Cartão CNPJ; **CND Conjunta Federal/INSS (PGFN)**; **CND Estadual**; **CND Municipal**; **CRF/FGTS**; e **CNDT (Trabalhista)** conforme exigido no instrumento convocatório.",
    });
  }

  if (economicoIntegridadeItens.length > 0) {
    categorias.push({
      categoria: "Qualificação Econômico-Financeira e Integridade",
      descricao: economicoIntegridadeItens.join("; "),
    });
  } else {
    categorias.push({
      categoria: "Qualificação Econômico-Financeira e Integridade",
      descricao:
        "Certidão Negativa de Falência e Recuperação Judicial; verificação de regularidade nos cadastros **CEIS, CNEP e TCU** conforme regras do edital.",
    });
  }

  if (tecnicaItens.length > 0) {
    categorias.push({
      categoria: "Qualificação Técnica e Amostras",
      descricao: tecnicaItens.join("; "),
    });
  } else {
    const amostraTexto = edital.burocraciaBarreiras?.exigeAmostra;
    categorias.push({
      categoria: "Qualificação Técnica",
      descricao:
        amostraTexto && !/^n[ãa]o/i.test(amostraTexto)
          ? `Atestado(s) de Capacidade Técnica compatíveis com o objeto + atendimento à regra de amostra/prova de conceito (${amostraTexto}).`
          : "Atestado(s) de Capacidade Técnica emitido(s) por pessoa jurídica de direito público ou privado comprovando fornecimento compatível com o objeto.",
    });
  }

  return categorias;
}

export function construirDossieExecutivo(
  edital: EditalAnalysis,
  selectedItemNumbers?: number[]
): DossieExecutivoData {
  const todosItens = Array.isArray(edital.itensEdital) ? edital.itensEdital : [];
  const itensFoco =
    selectedItemNumbers && selectedItemNumbers.length > 0
      ? todosItens.filter(it => selectedItemNumbers.includes(it.numero))
      : todosItens;
  const itensAtivos = itensFoco.length > 0 ? itensFoco : todosItens;

  // Calcula valor global dos itens
  let somaGlobalItens = 0;
  let somaQuantidades = 0;
  for (const it of itensAtivos) {
    const qtd = Number(it.quantidade) || 0;
    const unit = parseValorMonetario(it.valorEstimado);
    somaQuantidades += qtd;
    if (qtd > 0 && unit > 0) {
      somaGlobalItens += qtd * unit;
    } else if (unit > 0) {
      somaGlobalItens += unit;
    }
  }

  const valorEstimadoTexto =
    edital.viabilidadeFinanceira?.valorEstimado &&
    !/^n[ãa]o\s+(especificad|identificad|informad)/i.test(edital.viabilidadeFinanceira.valorEstimado)
      ? edital.viabilidadeFinanceira.valorEstimado
      : somaGlobalItens > 0
      ? formatarMoedaBR(somaGlobalItens)
      : "Orçamento não divulgado / consultar planilha";

  const ic: any = edital.identificacaoCertame || {};
  const pncpMeta: any = (edital as any).dadosOficiaisPNCP || {};
  const modalidade = ic.modalidade || pncpMeta.modalidade || "Licitação Pública";
  const numCertame = ic.numeroEdital || ic.identificacaoNumerica || pncpMeta.numeroCompra || "";
  const orgao = ic.orgaoComprador || pncpMeta.orgao || "Órgão Público Comprador";
  const uasg = extrairUasgEdital(edital);
  const dataSessao = ic.dataHoraSessao || "Consultar cronograma oficial no portal";

  // Diagnóstico CAPAG do órgão comprador
  const capagEnte = resolverCapagPorOrgaoOuLocal({
    uf: pncpMeta.uf,
    municipio: pncpMeta.municipio,
    orgao: `${orgao} ${edital.rawText || ""}`,
  });

  const categoriaKicker = inferirCategoriaKicker(edital);
  const modalidadeUpper = modalidade.toUpperCase();
  const kickerPadrao = `INTELIGÊNCIA LICITATÓRIA • ${modalidadeUpper} • LEI Nº 14.133/2021 • ${categoriaKicker}`;

  const tituloPadrao = numCertame
    ? `Dossiê Executivo: ${modalidade}${numCertame.toLowerCase().includes("nº") ? " " : " nº "}${numCertame}`
    : `Dossiê Executivo: ${modalidade}`;

  const partesSubtitulo = [`Órgão: ${orgao}`];
  if (numCertame) partesSubtitulo.push(`Processo / Certame: ${numCertame}`);
  if (uasg) partesSubtitulo.push(`UASG: ${uasg}`);
  if (ic.idContratacaoPNCP || edital.idContratacaoPNCP) {
    partesSubtitulo.push(`ID PNCP: ${ic.idContratacaoPNCP || edital.idContratacaoPNCP}`);
  }
  const subtituloPadrao = partesSubtitulo.join(" • ");

  const objetoResumo =
    edital.descricaoProduto && !/^n[ãa]o\s+(especificad|identificad)/i.test(edital.descricaoProduto)
      ? edital.descricaoProduto.slice(0, 320)
      : itensAtivos.length > 0
      ? itensAtivos
          .slice(0, 3)
          .map(i => i.descricao)
          .join("; ")
      : "fornecimento de bens/serviços conforme especificações do Termo de Referência";

  const prazoEntrega =
    edital.logisticaCronograma?.prazoEntregaReal ||
    edital.prazoEntrega ||
    "Conforme Ordem de Fornecimento / Termo de Referência";
  const localEntrega =
    edital.logisticaCronograma?.enderecoEntrega || "Endereço indicado pelo órgão demandante no Termo de Referência";
  const prazoPagamento =
    edital.viabilidadeFinanceira?.prazoPagamento ||
    edital.prazoPagamento ||
    "Até 30 dias após recebimento definitivo e ateste da Nota Fiscal";

  const sintesePadrao = `Contratação via **${modalidade}${numCertame ? ` (${numCertame})` : ""}** conduzida por **${orgao}**, tendo como objeto **${objetoResumo}** (${itensAtivos.length} ${itensAtivos.length === 1 ? "item mapeado" : "itens mapeados"}${somaQuantidades > 0 ? `, totalizando **${somaQuantidades.toLocaleString("pt-BR")} unidades**` : ""}), com valor global estimado de **${valorEstimadoTexto}**. Prazo de entrega de **${prazoEntrega}** e pagamento previsto em **${prazoPagamento}** (Comprador classificado com **CAPAG Nota ${capagEnte.notaCapag} — ${capagEnte.veredito.statusPagador}**).`;

  const dadosOficiaisPadrao: DossieParametroOficial[] = [
    {
      parametro: "Órgão Demandante e Identificação",
      regra: `**${orgao}**${uasg ? ` • Código UASG: **${uasg}**` : ""}${
        ic.idContratacaoPNCP || edital.idContratacaoPNCP
          ? ` • Controle PNCP: **${ic.idContratacaoPNCP || edital.idContratacaoPNCP}**`
          : ""
      }.`,
    },
    {
      parametro: "Modalidade e Critério de Disputa",
      regra: `**${modalidade}** (Lei Federal nº 14.133/2021)${
        edital.parecerFinal?.estrategiaLances ? ` • Estratégia recomendada: ${edital.parecerFinal.estrategiaLances}` : ""
      }.`,
    },
    {
      parametro: "Cronograma da Sessão Pública",
      regra: `Sessão / Abertura: **${dataSessao}**. Verifique o prazo limite para cadastro de proposta e pedidos de esclarecimento/impugnação no portal.`,
    },
    {
      parametro: "Valor Global Estimado",
      regra: `**${valorEstimadoTexto}**${
        edital.viabilidadeFinanceira?.distorcoesPreco &&
        !/^n[ãa]o\s+(especificad|identificad)/i.test(edital.viabilidadeFinanceira.distorcoesPreco)
          ? ` (${edital.viabilidadeFinanceira.distorcoesPreco})`
          : ""
      }.`,
    },
    {
      parametro: "Prazo de Entrega / Execução",
      regra: `**${prazoEntrega}**${
        edital.logisticaCronograma?.classificacaoPrazo
          ? ` (Classificação logística: **${edital.logisticaCronograma.classificacaoPrazo}**)`
          : ""
      }.`,
    },
    {
      parametro: "Local e Condições de Entrega",
      regra: `**${localEntrega}**. Frete, tributos, seguros e descarregamento inclusos no preço cotado.`,
    },
    {
      parametro: "Recebimento, Pagamento e CAPAG",
      regra: `**${prazoPagamento}**. Diagnóstico fiscal Tesouro Nacional (STN): **CAPAG ${capagEnte.notaCapag} (${capagEnte.veredito.statusPagador})** — ${capagEnte.veredito.estrategiaComercial}`,
    },
    {
      parametro: "Garantia, Amostras e Subcontratação",
      regra: [
        edital.logisticaCronograma?.prazoGarantia
          ? `Garantia exigida: **${edital.logisticaCronograma.prazoGarantia}**`
          : "Garantia legal do fabricante / CDC",
        edital.burocraciaBarreiras?.exigeAmostra
          ? `Amostra/PoC: **${edital.burocraciaBarreiras.exigeAmostra}**`
          : null,
        edital.burocraciaBarreiras?.exigenciaGarantia
          ? `Garantia contratual: **${edital.burocraciaBarreiras.exigenciaGarantia}**`
          : null,
        edital.burocraciaBarreiras?.consorcioSubcontratacao
          ? `Consórcio/Subcontratação: **${edital.burocraciaBarreiras.consorcioSubcontratacao}**`
          : null,
      ]
        .filter(Boolean)
        .join(" • "),
    },
  ];

  // Constrói pontos de atenção combinando pontosAlerta + pegadinhasOcultas
  const alertasBrutos = [
    ...(edital.pontosAlerta || []),
    ...(edital.especificacoesTecnicas?.pegadinhasOcultas || []),
  ].filter(a => a && !/^n[ãa]o\s+(especificad|identificad|informad)/i.test(a.trim()));

  // Remove duplicados aproximados
  const alertasUnicos: string[] = [];
  for (const a of alertasBrutos) {
    const chave = a.toLowerCase().slice(0, 45);
    if (!alertasUnicos.some(x => x.toLowerCase().slice(0, 45) === chave)) {
      alertasUnicos.push(a);
    }
  }

  const pontosAtencaoPadrao: DossiePontoAtencao[] =
    alertasUnicos.length > 0
      ? alertasUnicos.map((a, idx) => transformarAlertaEmPontoAtencao(a, idx))
      : [
          {
            prefixo: "PONTO DE ATENÇÃO 1",
            titulo: "Conferência Estrita do Descritivo Técnico e Marca/Modelo na Proposta",
            descricao:
              "Certifique-se de informar **marca, modelo e fabricante** exatos na proposta comercial e evite copiar literalmente expressões genéricas do Termo de Referência sem especificar o produto real ofertado.",
          },
          {
            prefixo: "PONTO DE ATENÇÃO 2",
            titulo: "Prazo de Envio da Proposta Readequada e Documentos de Habilitação",
            descricao:
              "Acompanhe o chat da sessão pública atentamente: após a fase de lances, o pregoeiro/agente de contratação convoca o licitante para envio da proposta ajustada e habilitação em prazo estrito (geralmente **2 horas**).",
          },
        ];

  const checklistPadrao = categorizarDocumentosHabilitacao(edital);
  const rodapePadrao = `Dossiê Executivo • ${modalidade}${numCertame ? ` ${numCertame}` : ""} — ${orgao}`;

  // Se o edital já possui dossieExecutivo vindo da IA ou editado pelo usuário, mescla com segurança
  const existente = edital.dossieExecutivo;
  if (existente && typeof existente === "object") {
    return {
      kicker: existente.kicker || kickerPadrao,
      titulo: existente.titulo || tituloPadrao,
      subtituloOrgao: existente.subtituloOrgao || subtituloPadrao,
      sinteseTitulo: existente.sinteseTitulo || "SÍNTESE ESTRATÉGICA DA OPORTUNIDADE",
      sinteseTexto: existente.sinteseTexto || sintesePadrao,
      secao1Titulo: existente.secao1Titulo || "1. Dados Oficiais, Valores, Prazo e Local de Entrega",
      colunaRegraTitulo:
        existente.colunaRegraTitulo ||
        `Regra Oficial do Edital / Termo de Referência${numCertame ? ` (${numCertame})` : ""}`,
      dadosOficiais:
        Array.isArray(existente.dadosOficiais) && existente.dadosOficiais.length > 0
          ? existente.dadosOficiais
          : dadosOficiaisPadrao,
      secao2Titulo:
        existente.secao2Titulo ||
        `2. Planilha de Itens, Quantitativos e Valores Máximos (${
          itensAtivos.length === 1 ? "Item Único" : `${itensAtivos.length} Itens`
        })`,
      especificacaoComum:
        existente.especificacaoComum !== undefined
          ? existente.especificacaoComum
          : edital.descricaoProduto || "",
      secao3Titulo:
        existente.secao3Titulo || '3. Pontos de Atenção ("Pegadinhas") e Riscos Críticos do Edital',
      pontosAtencao:
        Array.isArray(existente.pontosAtencao) && existente.pontosAtencao.length > 0
          ? existente.pontosAtencao
          : pontosAtencaoPadrao,
      secao4Titulo: existente.secao4Titulo || "4. Checklist Rápido de Habilitação e Proposta",
      checklistCategorizado:
        Array.isArray(existente.checklistCategorizado) && existente.checklistCategorizado.length > 0
          ? existente.checklistCategorizado
          : checklistPadrao,
      rodapeTexto: existente.rodapeTexto || rodapePadrao,
      temaCor: existente.temaCor || "emerald",
    };
  }

  return {
    kicker: kickerPadrao,
    titulo: tituloPadrao,
    subtituloOrgao: subtituloPadrao,
    sinteseTitulo: "SÍNTESE ESTRATÉGICA DA OPORTUNIDADE",
    sinteseTexto: sintesePadrao,
    secao1Titulo: "1. Dados Oficiais, Valores, Prazo e Local de Entrega",
    colunaRegraTitulo: `Regra Oficial do Edital / Termo de Referência${numCertame ? ` (${numCertame})` : ""}`,
    dadosOficiais: dadosOficiaisPadrao,
    secao2Titulo: `2. Planilha de Itens, Quantitativos e Valores Máximos (${
      itensAtivos.length === 1 ? "Item Único" : `${itensAtivos.length} Itens`
    })`,
    especificacaoComum: edital.descricaoProduto || "",
    secao3Titulo: '3. Pontos de Atenção ("Pegadinhas") e Riscos Críticos do Edital',
    pontosAtencao: pontosAtencaoPadrao,
    secao4Titulo: "4. Checklist Rápido de Habilitação e Proposta",
    checklistCategorizado: checklistPadrao,
    rodapeTexto: rodapePadrao,
    temaCor: "emerald",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR VETORIAL DE GERAÇÃO DE PDF A4 (FIEL AOS MODELOS DE REFERÊNCIA)
// ═══════════════════════════════════════════════════════════════════════════

interface StyledToken {
  text: string;
  bold: boolean;
  color: [number, number, number];
}

/**
 * Converte um texto com marcações `**negrito**` em tokens estilizados
 * para renderização vetorial no jsPDF com quebra automática de linha.
 */
function tokenizarTextoComNegrito(
  texto: string,
  baseColor: [number, number, number] = [30, 41, 59],
  boldColor: [number, number, number] = [15, 23, 42]
): StyledToken[] {
  const limpo = String(texto || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .trim();
  if (!limpo) return [];

  const partes = limpo.split(/(\*\*[^*]+\*\*)/g);
  const tokens: StyledToken[] = [];

  for (const parte of partes) {
    if (!parte) continue;
    const isBold = parte.startsWith("**") && parte.endsWith("**") && parte.length > 4;
    const conteudo = isBold ? parte.slice(2, -2) : parte;
    const palavras = conteudo.split(/(\s+)/);
    for (const p of palavras) {
      if (!p) continue;
      tokens.push({
        text: p,
        bold: isBold,
        color: isBold ? boldColor : baseColor,
      });
    }
  }
  return tokens;
}

/**
 * Quebra uma lista de tokens estilizados em linhas que cabem em `maxWidthMm`.
 */
function quebrarTokensEmLinhas(
  doc: jsPDF,
  tokens: StyledToken[],
  maxWidthMm: number,
  fontSizePt: number
): StyledToken[][] {
  doc.setFontSize(fontSizePt);
  const linhas: StyledToken[][] = [];
  let linhaAtual: StyledToken[] = [];
  let larguraAtual = 0;

  for (const token of tokens) {
    const isSpace = /^\s+$/.test(token.text);
    if (isSpace && linhaAtual.length === 0) {
      continue;
    }

    doc.setFont("helvetica", token.bold ? "bold" : "normal");
    const tokenWidth = doc.getTextWidth(token.text);

    if (larguraAtual + tokenWidth > maxWidthMm && linhaAtual.length > 0 && !isSpace) {
      // Remove espaço final da linha anterior
      if (linhaAtual.length > 0 && /^\s+$/.test(linhaAtual[linhaAtual.length - 1].text)) {
        linhaAtual.pop();
      }
      linhas.push(linhaAtual);
      linhaAtual = [token];
      larguraAtual = tokenWidth;
    } else {
      linhaAtual.push(token);
      larguraAtual += tokenWidth;
    }
  }

  if (linhaAtual.length > 0) {
    if (/^\s+$/.test(linhaAtual[linhaAtual.length - 1].text)) {
      linhaAtual.pop();
    }
    if (linhaAtual.length > 0) {
      linhas.push(linhaAtual);
    }
  }

  return linhas;
}

function desenharLinhasDeTokens(
  doc: jsPDF,
  linhas: StyledToken[][],
  startX: number,
  startY: number,
  fontSizePt: number,
  lineHeightMm: number
): number {
  doc.setFontSize(fontSizePt);
  let cursorY = startY;
  for (const linha of linhas) {
    let cursorX = startX;
    for (const token of linha) {
      doc.setFont("helvetica", token.bold ? "bold" : "normal");
      doc.setTextColor(token.color[0], token.color[1], token.color[2]);
      doc.text(token.text, cursorX, cursorY);
      cursorX += doc.getTextWidth(token.text);
    }
    cursorY += lineHeightMm;
  }
  return cursorY;
}

export function gerarPdfDossieExecutivo(
  dossie: DossieExecutivoData,
  itens: NonNullable<EditalAnalysis["itensEdital"]>,
  resumoExtra?: {
    veredito?: string;
    grauRisco?: string;
    capagLabel?: string;
    valorGlobalFormatado?: string;
    salvarArquivo?: boolean;
  }
): jsPDF {
  const tema = TEMAS_DOSSIE[dossie.temaCor || "emerald"] || TEMAS_DOSSIE.emerald;
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const marginX = 16;
  const pageWidth = 210;
  const contentWidth = pageWidth - marginX * 2; // 178mm
  const bottomLimitY = 274; // Acima do rodapé que fica em 281mm
  let y = 15;

  const ensureSpace = (neededMm: number, onNewPage?: () => void) => {
    if (y + neededMm > bottomLimitY) {
      doc.addPage();
      y = 18;
      if (onNewPage) onNewPage();
    }
  };

  // 1. Barra Superior Institucional Colorida
  doc.setFillColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  doc.rect(marginX, y, contentWidth, 1.3, "F");
  y += 6.5;

  // 2. Kicker em Caixa Alta
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  const kickerLines = doc.splitTextToSize((dossie.kicker || "INTELIGÊNCIA LICITATÓRIA").toUpperCase(), contentWidth);
  doc.text(kickerLines, marginX, y);
  y += kickerLines.length * 4 + 3;

  // 3. Título Principal do Dossiê Executivo
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17.5);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(dossie.titulo || "Dossiê Executivo de Licitação", contentWidth);
  doc.text(titleLines, marginX, y);
  y += titleLines.length * 7 + 1;

  // 4. Subtítulo (Órgão • Processo • Objeto)
  const subtituloTokens = tokenizarTextoComNegrito(
    (dossie.subtituloOrgao || "").replace(/(Órgão:|Processo[^:]*:|Pedido[^:]*:|Objeto:|Demandante:|UASG:|ID PNCP:)/g, "**$1**"),
    [71, 85, 105],
    [15, 23, 42]
  );
  const subtituloLinhas = quebrarTokensEmLinhas(doc, subtituloTokens, contentWidth, 9.5);
  y = desenharLinhasDeTokens(doc, subtituloLinhas, marginX, y, 9.5, 4.4);
  y += 2.5;

  // Linha divisória institucional
  doc.setFillColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  doc.rect(marginX, y, contentWidth, 0.5, "F");
  y += 5;

  // 5. Faixa Cognitiva Rápida (4 Indicadores Executivos)
  if (resumoExtra && (resumoExtra.veredito || resumoExtra.capagLabel || resumoExtra.valorGlobalFormatado)) {
    const cards = [
      { label: "VEREDITO ESTRATÉGICO", value: resumoExtra.veredito || "Analisar Condições" },
      { label: "GRAU DE RISCO", value: resumoExtra.grauRisco || "Médio" },
      { label: "RISCO PAGADOR (CAPAG)", value: resumoExtra.capagLabel || "Consultar STN" },
      { label: "VALOR GLOBAL ESTIMADO", value: resumoExtra.valorGlobalFormatado || "Ver Planilha" },
    ];
    const gap = 2.5;
    const cardW = (contentWidth - gap * 3) / 4;
    const cardH = 12.5;

    for (let i = 0; i < cards.length; i++) {
      const cx = marginX + i * (cardW + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.25);
      doc.roundedRect(cx, y, cardW, cardH, 1.2, 1.2, "FD");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(cards[i].label, cx + 2.2, y + 4.2);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.2);
      doc.setTextColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
      const valTrunc = doc.splitTextToSize(String(cards[i].value), cardW - 4.4)[0] || "";
      doc.text(valTrunc, cx + 2.2, y + 9.4);
    }
    y += cardH + 5;
  }

  // 6. Quadro de Síntese Estratégica da Oportunidade
  const sinteseTokens = tokenizarTextoComNegrito(dossie.sinteseTexto, [30, 41, 59], [15, 23, 42]);
  const sinteseInnerWidth = contentWidth - 11;
  const sinteseLinhas = quebrarTokensEmLinhas(doc, sinteseTokens, sinteseInnerWidth, 10);
  const sinteseLineH = 4.8;
  const sinteseBoxH = 11 + sinteseLinhas.length * sinteseLineH + 3.5;

  ensureSpace(sinteseBoxH + 4);

  // Fundo e borda do quadro de síntese
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.rect(marginX, y, contentWidth, sinteseBoxH, "FD");

  // Barra lateral esquerda característica dos PDFs enviados
  doc.setFillColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  doc.rect(marginX, y, 1.6, sinteseBoxH, "F");

  // Título da Síntese
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  doc.text((dossie.sinteseTitulo || "SÍNTESE ESTRATÉGICA DA OPORTUNIDADE").toUpperCase(), marginX + 5.5, y + 6.5);

  // Corpo da Síntese
  desenharLinhasDeTokens(doc, sinteseLinhas, marginX + 5.5, y + 12, 10, sinteseLineH);
  y += sinteseBoxH + 7;

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 1: DADOS OFICIAIS, VALORES, PRAZO E LOCAL DE ENTREGA
  // ─────────────────────────────────────────────────────────────────────────
  ensureSpace(22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  doc.text(dossie.secao1Titulo || "1. Dados Oficiais, Valores, Prazo e Local de Entrega", marginX, y);
  y += 2.2;
  doc.setDrawColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  doc.setLineWidth(0.35);
  doc.line(marginX, y, marginX + contentWidth, y);
  y += 3;

  const col1W = 50;
  const col2W = contentWidth - col1W;

  const drawSecao1Header = () => {
    doc.setFillColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
    doc.rect(marginX, y, contentWidth, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text("Parâmetro", marginX + 3, y + 5.3);
    const col2Title = doc.splitTextToSize(dossie.colunaRegraTitulo || "Regra Oficial do Edital e Termo de Referência", col2W - 6)[0];
    doc.text(col2Title, marginX + col1W + 3, y + 5.3);
    y += 8;
  };

  drawSecao1Header();

  for (let i = 0; i < dossie.dadosOficiais.length; i++) {
    const row = dossie.dadosOficiais[i];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    const paramLines = doc.splitTextToSize(row.parametro || "", col1W - 6);

    const regraTokens = tokenizarTextoComNegrito(row.regra || "—", [30, 41, 59], [15, 23, 42]);
    const regraLines = quebrarTokensEmLinhas(doc, regraTokens, col2W - 6, 9);

    const lineCount = Math.max(paramLines.length, regraLines.length, 1);
    const lineH = 4.3;
    const rowH = lineCount * lineH + 4.5;

    ensureSpace(rowH, drawSecao1Header);

    // Fundo zebrado
    if (i % 2 === 1) {
      doc.setFillColor(248, 250, 252);
    } else {
      doc.setFillColor(255, 255, 255);
    }
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.rect(marginX, y, col1W, rowH, "FD");
    doc.rect(marginX + col1W, y, col2W, rowH, "FD");

    // Texto coluna 1 (Parâmetro)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(paramLines, marginX + 3, y + 5);

    // Texto coluna 2 (Regra Oficial com suporte a **negrito**)
    desenharLinhasDeTokens(doc, regraLines, marginX + col1W + 3, y + 5, 9, lineH);
    y += rowH;
  }

  y += 8;

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 2: PLANILHA DE ITENS, QUANTITATIVOS E VALORES MÁXIMOS
  // ─────────────────────────────────────────────────────────────────────────
  ensureSpace(24);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  doc.text(dossie.secao2Titulo || "2. Planilha de Itens, Quantitativos e Valores Máximos", marginX, y);
  y += 2.2;
  doc.setDrawColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  doc.setLineWidth(0.35);
  doc.line(marginX, y, marginX + contentWidth, y);
  y += 4;

  // Especificação Técnica Comum (opcional)
  if (dossie.especificacaoComum && dossie.especificacaoComum.trim().length > 0) {
    const textoEsp = dossie.especificacaoComum.startsWith("**")
      ? dossie.especificacaoComum
      : `**Especificação Técnica Geral do Objeto:** ${dossie.especificacaoComum}`;
    const espTokens = tokenizarTextoComNegrito(textoEsp, [30, 41, 59], [15, 23, 42]);
    const espLinhas = quebrarTokensEmLinhas(doc, espTokens, contentWidth, 9.2);
    ensureSpace(espLinhas.length * 4.4 + 4);
    y = desenharLinhasDeTokens(doc, espLinhas, marginX, y + 1, 9.2, 4.4);
    y += 3;
  }

  // Colunas da tabela de itens: Item (13mm) | Descrição (91mm) | Qtd./Unid. (24mm) | Unit. Máx. (25mm) | Total Máx. (25mm) = 178mm
  const wItem = 13;
  const wDesc = 91;
  const wQtd = 24;
  const wUnit = 25;
  const wTot = 25;

  const drawItensHeader = () => {
    doc.setFillColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
    doc.rect(marginX, y, contentWidth, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.8);
    doc.setTextColor(255, 255, 255);
    doc.text("Item", marginX + wItem / 2, y + 5.3, { align: "center" });
    doc.text("Descrição Resumida / Especificação Técnica", marginX + wItem + 3, y + 5.3);
    doc.text("Qtd.", marginX + wItem + wDesc + wQtd - 2.5, y + 5.3, { align: "right" });
    doc.text("Unit. Máx.", marginX + wItem + wDesc + wQtd + wUnit - 2.5, y + 5.3, { align: "right" });
    doc.text("Total Máx.", marginX + contentWidth - 2.5, y + 5.3, { align: "right" });
    y += 8;
  };

  if (itens.length > 0) {
    ensureSpace(18);
    drawItensHeader();

    let somaTotalGlobal = 0;
    let somaQtdTotal = 0;

    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];
      const numStr = String(it.numero || i + 1).padStart(2, "0");
      const qtdNum = Number(it.quantidade) || 0;
      somaQtdTotal += qtdNum;
      const unidStr = (it.unidade || "un").trim();
      const qtdFormatted = qtdNum > 0 ? `${qtdNum.toLocaleString("pt-BR")} ${unidStr}` : unidStr;

      const unitNum = parseValorMonetario(it.valorEstimado);
      const totalNum = qtdNum > 0 && unitNum > 0 ? qtdNum * unitNum : unitNum;
      somaTotalGlobal += totalNum;

      const unitFormatted = unitNum > 0 ? formatarMoedaBR(unitNum) : it.valorEstimado || "—";
      const totalFormatted = totalNum > 0 ? formatarMoedaBR(totalNum) : "—";

      const descTokens = tokenizarTextoComNegrito(it.descricao || "Item do edital", [30, 41, 59], [15, 23, 42]);
      const descLines = quebrarTokensEmLinhas(doc, descTokens, wDesc - 5, 8.8);
      const lineH = 4.2;
      const rowH = Math.max(descLines.length, 1) * lineH + 4.2;

      ensureSpace(rowH, drawItensHeader);

      if (i % 2 === 1) {
        doc.setFillColor(248, 250, 252);
      } else {
        doc.setFillColor(255, 255, 255);
      }
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.2);

      let cx = marginX;
      doc.rect(cx, y, wItem, rowH, "FD");
      cx += wItem;
      doc.rect(cx, y, wDesc, rowH, "FD");
      cx += wDesc;
      doc.rect(cx, y, wQtd, rowH, "FD");
      cx += wQtd;
      doc.rect(cx, y, wUnit, rowH, "FD");
      cx += wUnit;
      doc.rect(cx, y, wTot, rowH, "FD");

      // Número do item
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.8);
      doc.setTextColor(15, 23, 42);
      doc.text(numStr, marginX + wItem / 2, y + 5, { align: "center" });

      // Descrição
      desenharLinhasDeTokens(doc, descLines, marginX + wItem + 2.5, y + 5, 8.8, lineH);

      // Quantidade
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.8);
      doc.setTextColor(15, 23, 42);
      const qtdLines = doc.splitTextToSize(qtdFormatted, wQtd - 4);
      doc.text(qtdLines, marginX + wItem + wDesc + wQtd - 2.5, y + 5, { align: "right" });

      // Unitário
      doc.text(
        doc.splitTextToSize(unitFormatted, wUnit - 3)[0] || "—",
        marginX + wItem + wDesc + wQtd + wUnit - 2.5,
        y + 5,
        { align: "right" }
      );

      // Total
      doc.setFont("helvetica", "bold");
      doc.text(
        doc.splitTextToSize(totalFormatted, wTot - 3)[0] || "—",
        marginX + contentWidth - 2.5,
        y + 5,
        { align: "right" }
      );

      y += rowH;
    }

    // Linha de Rodapé: VALOR GLOBAL ESTIMADO DA CONTRATAÇÃO
    const totalRowH = 8.5;
    ensureSpace(totalRowH + 2, drawItensHeader);

    doc.setFillColor(tema.tintRgb[0], tema.tintRgb[1], tema.tintRgb[2]);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);

    const wLabelGlobal = wItem + wDesc;
    doc.rect(marginX, y, wLabelGlobal, totalRowH, "FD");
    doc.rect(marginX + wLabelGlobal, y, wQtd, totalRowH, "FD");
    doc.rect(marginX + wLabelGlobal + wQtd, y, wUnit, totalRowH, "FD");
    doc.rect(marginX + wLabelGlobal + wQtd + wUnit, y, wTot, totalRowH, "FD");

    // Linha inferior mais espessa no totalizador (como nos PDFs de referência)
    doc.setDrawColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
    doc.setLineWidth(0.6);
    doc.line(marginX, y + totalRowH, marginX + contentWidth, y + totalRowH);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.8);
    doc.setTextColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
    doc.text(
      `VALOR GLOBAL ESTIMADO DA CONTRATAÇÃO (${itens.length} ${itens.length === 1 ? "ITEM" : "ITENS"})`,
      marginX + 3,
      y + 5.6
    );
    doc.text(
      somaQtdTotal > 0 ? `${somaQtdTotal.toLocaleString("pt-BR")}` : "—",
      marginX + wLabelGlobal + wQtd - 2.5,
      y + 5.6,
      { align: "right" }
    );
    doc.text("—", marginX + wLabelGlobal + wQtd + wUnit - 2.5, y + 5.6, { align: "right" });
    doc.text(
      somaTotalGlobal > 0 ? formatarMoedaBR(somaTotalGlobal) : resumoExtra?.valorGlobalFormatado || "—",
      marginX + contentWidth - 2.5,
      y + 5.6,
      { align: "right" }
    );
    y += totalRowH + 8;
  } else {
    y += 4;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 3: PONTOS DE ATENÇÃO ("PEGADINHAS") E RISCOS CRÍTICOS DO EDITAL
  // ─────────────────────────────────────────────────────────────────────────
  ensureSpace(22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  doc.text(
    dossie.secao3Titulo || '3. Pontos de Atenção ("Pegadinhas") e Riscos Críticos do Edital',
    marginX,
    y
  );
  y += 2.2;
  doc.setDrawColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  doc.setLineWidth(0.35);
  doc.line(marginX, y, marginX + contentWidth, y);
  y += 5.5;

  for (let i = 0; i < dossie.pontosAtencao.length; i++) {
    const pa = dossie.pontosAtencao[i];
    const cabecalhoVermelho = `${pa.prefixo || `PONTO DE ATENÇÃO ${i + 1}`} — ${pa.titulo}: `;

    // Tokens em vermelho negrito para o título do Ponto de Atenção
    const redWords = cabecalhoVermelho.split(/(\s+)/).filter(Boolean);
    const redTokens: StyledToken[] = redWords.map(w => ({
      text: w,
      bold: true,
      color: tema.alertRgb,
    }));

    // Tokens do corpo explicativo (com suporte a **negrito**)
    const bodyTokens = tokenizarTextoComNegrito(pa.descricao || "", [30, 41, 59], [15, 23, 42]);
    const todosTokens = [...redTokens, ...bodyTokens];

    const bulletIndent = 4.5;
    const linhasPonto = quebrarTokensEmLinhas(doc, todosTokens, contentWidth - bulletIndent, 9.6);
    const lineH = 4.6;
    const blockH = linhasPonto.length * lineH + 2.8;

    ensureSpace(blockH);

    // Bullet vermelho
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(tema.alertRgb[0], tema.alertRgb[1], tema.alertRgb[2]);
    doc.text("•", marginX + 0.5, y);

    y = desenharLinhasDeTokens(doc, linhasPonto, marginX + bulletIndent, y, 9.6, lineH);
    y += 2.4;
  }

  y += 4;

  // ─────────────────────────────────────────────────────────────────────────
  // SEÇÃO 4: CHECKLIST RÁPIDO DE HABILITAÇÃO E PROPOSTA
  // ─────────────────────────────────────────────────────────────────────────
  ensureSpace(22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  doc.text(dossie.secao4Titulo || "4. Checklist Rápido de Habilitação e Proposta", marginX, y);
  y += 2.2;
  doc.setDrawColor(tema.primaryRgb[0], tema.primaryRgb[1], tema.primaryRgb[2]);
  doc.setLineWidth(0.35);
  doc.line(marginX, y, marginX + contentWidth, y);
  y += 5.5;

  for (let i = 0; i < dossie.checklistCategorizado.length; i++) {
    const cat = dossie.checklistCategorizado[i];
    const textoCombinado = `**${cat.categoria}:** ${cat.descricao}`;
    const tokensCat = tokenizarTextoComNegrito(textoCombinado, [30, 41, 59], [15, 23, 42]);
    const bulletIndent = 4.5;
    const linhasCat = quebrarTokensEmLinhas(doc, tokensCat, contentWidth - bulletIndent, 9.6);
    const lineH = 4.6;
    const blockH = linhasCat.length * lineH + 2.5;

    ensureSpace(blockH);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text("•", marginX + 0.5, y);

    y = desenharLinhasDeTokens(doc, linhasCat, marginX + bulletIndent, y, 9.6, lineH);
    y += 2.2;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RODAPÉ OFICIAL NUMERADO EM TODAS AS PÁGINAS ("Página X de Y")
  // ─────────────────────────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.line(marginX, 281, marginX + contentWidth, 281);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);

    const rodapeEsq = doc.splitTextToSize(dossie.rodapeTexto || dossie.titulo, contentWidth - 28)[0] || "";
    doc.text(rodapeEsq, marginX, 285.5);
    doc.text(`Página ${p} de ${totalPages}`, marginX + contentWidth, 285.5, { align: "right" });
  }

  // Nome limpo do arquivo PDF
  const nomeBase = (dossie.titulo || "Dossie Executivo")
    .replace(/[:\/\\?%*|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (resumoExtra?.salvarArquivo !== false) {
    doc.save(`${nomeBase}.pdf`);
  }
  return doc;
}
