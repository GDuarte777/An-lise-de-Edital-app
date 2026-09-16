import { Certificate, EditalAnalysis } from "../types";

// ═══════════════════════════════════════════════════════════════════════
// CRUZAMENTO ENTRE O QUE O EDITAL EXIGE E O QUE A EMPRESA TEM.
//
// A aba de certidões já sabia cruzar isso, mas só perguntando à IA: uma
// chamada de rede por consulta, resposta em prosa, e um fallback local que
// comparava os nomes com `includes` — ou seja, "CND Receita Federal" nunca
// casava com a exigência escrita como "prova de regularidade para com a
// Fazenda Nacional", que é como o edital realmente escreve.
//
// Este módulo faz o cruzamento localmente e sem IA, por duas razões
// práticas: o resultado é instantâneo e é sempre o mesmo para a mesma
// entrada — dá para conferir antes de mandar a documentação. A IA continua
// útil para interpretar o edital; a conferência do checklist, não.
//
// A pergunta que ele responde não é "tenho a certidão?", e sim "vou estar
// habilitado NO DIA DA SESSÃO?" — que é diferente sempre que uma certidão
// vence entre hoje e a disputa. Esse é o erro que desclassifica empresa
// preparada, e é o que o checklist marca em vermelho.
// ═══════════════════════════════════════════════════════════════════════

export type ExigenciaSituacao =
  | "coberta"        // documento no portfólio, arquivo enviado e válido na data da sessão
  | "vence_antes"    // válido hoje, mas expira antes da sessão
  | "vencida"        // já expirou
  | "sem_arquivo"    // consta na lista de certidões, mas nenhum arquivo foi enviado
  | "sem_validade"   // arquivo enviado, mas sem data de validade preenchida
  | "a_gerar"        // declaração/proposta que a própria plataforma emite
  | "nao_cadastrada"; // nada no portfólio corresponde à exigência

/** Como o documento chega até a licitação — muda a orientação que a UI dá ao usuário. */
export type OrigemDocumento =
  | "certidao"    // emitida por órgão externo, tem validade
  | "declaracao"  // a empresa mesmo assina; a aba "Criar Documentos" gera
  | "societario"  // contrato social, CNPJ, identidade dos sócios
  | "financeiro"  // balanço, índices contábeis
  | "tecnico"     // atestados, registros em conselho, licenças
  | "proposta";   // proposta comercial e planilhas de preço

export interface ExigenciaChecklist {
  /** Texto da exigência exatamente como veio do edital. */
  exigencia: string;
  /** Chave do catálogo, quando reconhecemos o documento. */
  categoria: string | null;
  /** Rótulo curto e padronizado do documento reconhecido. */
  rotulo: string | null;
  origem: OrigemDocumento | null;
  /** Certidão do portfólio que atende a exigência, quando existe. */
  certificado: Certificate | null;
  situacao: ExigenciaSituacao;
  /** Dias entre hoje e o vencimento (negativo = já venceu). */
  diasParaVencer: number | null;
  /** Frase pronta explicando a situação, já no tom do app. */
  detalhe: string;
  /** Impede a habilitação se não for resolvido até a sessão. */
  bloqueante: boolean;
}

export interface ResultadoHabilitacao {
  itens: ExigenciaChecklist[];
  /** Data da sessão extraída do edital, quando identificada. */
  dataSessao: Date | null;
  totalExigencias: number;
  cobertas: number;
  /** Itens que impedem a habilitação (vencidos, ausentes ou que vencem antes da sessão). */
  bloqueantes: number;
  /** Itens que pedem ação mas não desclassificam sozinhos (declarações a gerar, validade em branco). */
  atencao: number;
  /** 0 a 100 — proporção de exigências efetivamente cobertas. */
  score: number;
  /** Certidões do portfólio vencidas/vencendo que o edital não pediu, mas que valem um aviso. */
  alertasPortfolio: string[];
}

// ─────────────────────────── normalização ───────────────────────────

/**
 * Editais escrevem o mesmo documento de dez formas diferentes, com acento,
 * caixa alta, numeração de item e pontuação no meio. Tudo é reduzido a
 * minúsculas sem acento e sem pontuação antes de qualquer comparação.
 */
export function normalizarTexto(texto: string): string {
  return (texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Palavras que aparecem em quase toda exigência e não ajudam a distinguir
// um documento de outro — ficam de fora da comparação por similaridade.
const PALAVRAS_VAZIAS = new Set([
  "de", "da", "do", "das", "dos", "e", "ou", "a", "o", "as", "os", "em", "para",
  "com", "por", "no", "na", "nos", "nas", "ao", "aos", "que", "sua", "seu",
  "documento", "documentos", "certidao", "certidoes", "prova", "comprovante",
  "apresentar", "apresentacao", "relativa", "relativo", "referente", "vigente",
  "valida", "validade", "original", "copia", "autenticada", "sede", "licitante",
  "empresa", "emitida", "emitido", "negativa", "positiva", "efeito", "efeitos",
]);

function tokensSignificativos(texto: string): string[] {
  return normalizarTexto(texto)
    .split(" ")
    .filter((t) => t.length >= 4 && !PALAVRAS_VAZIAS.has(t));
}

// ─────────────────────────── catálogo ───────────────────────────

interface CategoriaDocumento {
  chave: string;
  rotulo: string;
  origem: OrigemDocumento;
  /**
   * Termos que identificam o documento. Precisam cobrir tanto o jargão do
   * edital ("regularidade para com a Fazenda Nacional") quanto o nome curto
   * que o usuário cadastra no portfólio ("CND Receita Federal").
   */
  termos: string[];
}

/**
 * Catálogo dos documentos de habilitação da Lei 14.133/2021. A ordem importa:
 * a primeira categoria cujo termo aparecer no texto vence, então os documentos
 * mais específicos vêm antes dos genéricos (senão "certidão negativa de
 * falência" cairia em "certidão negativa" de tributos).
 */
const CATALOGO: CategoriaDocumento[] = [
  // ── Regularidade fiscal e trabalhista ──
  {
    chave: "fgts",
    rotulo: "CRF / FGTS",
    origem: "certidao",
    termos: ["fgts", "crf", "fundo de garantia", "caixa economica federal regularidade"],
  },
  {
    chave: "trabalhista",
    rotulo: "CNDT – Débitos Trabalhistas",
    origem: "certidao",
    termos: ["cndt", "trabalhista", "debitos trabalhistas", "justica do trabalho", "tst"],
  },
  {
    chave: "federal",
    rotulo: "CND Federal (Receita/INSS)",
    origem: "certidao",
    termos: [
      "receita federal", "fazenda nacional", "tributos federais", "divida ativa da uniao",
      "prgfn", "pgfn", "inss", "seguridade social", "fazenda federal", "uniao",
    ],
  },
  // As duas inscrições vêm antes das CNDs estadual/municipal de propósito:
  // "Inscrição Municipal" contém a palavra "municipal" e, na ordem inversa,
  // seria classificada como certidão negativa de tributos municipais.
  {
    chave: "inscricao-estadual",
    rotulo: "Inscrição Estadual",
    origem: "societario",
    termos: ["inscricao estadual"],
  },
  {
    chave: "inscricao-municipal",
    rotulo: "Inscrição Municipal",
    origem: "societario",
    termos: ["inscricao municipal", "cadastro mobiliario"],
  },
  {
    chave: "estadual",
    rotulo: "CND Estadual",
    origem: "certidao",
    termos: ["fazenda estadual", "estadual", "icms", "sefaz", "secretaria da fazenda do estado"],
  },
  {
    chave: "municipal",
    rotulo: "CND Municipal",
    origem: "certidao",
    termos: ["fazenda municipal", "municipal", "mobiliario", "iss", "prefeitura"],
  },
  {
    chave: "sicaf",
    rotulo: "SICAF",
    origem: "certidao",
    termos: ["sicaf", "cadastramento unificado", "crc", "registro cadastral"],
  },

  // ── Qualificação econômico-financeira ──
  {
    chave: "falencia",
    rotulo: "Certidão de Falência e Concordata",
    origem: "certidao",
    termos: [
      "falencia", "concordata", "recuperacao judicial", "recuperacao extrajudicial",
      "distribuidor", "distribuidora civel",
    ],
  },
  {
    chave: "balanco",
    rotulo: "Balanço Patrimonial",
    origem: "financeiro",
    termos: [
      "balanco patrimonial", "demonstracoes contabeis", "demonstracao do resultado",
      "livro contabil", "livro diario", "indices contabeis", "liquidez", "escrituracao contabil",
      "sped contabil", "dre",
    ],
  },
  {
    chave: "capital-social",
    rotulo: "Capital Social / Patrimônio Líquido",
    origem: "financeiro",
    termos: ["capital social", "patrimonio liquido", "capital minimo", "capital integralizado"],
  },

  // ── Habilitação jurídica ──
  {
    chave: "contrato-social",
    rotulo: "Contrato Social / Ato Constitutivo",
    origem: "societario",
    termos: [
      "contrato social", "ato constitutivo", "estatuto", "alteracao contratual",
      "requerimento de empresario", "consolidado", "registro comercial", "junta comercial",
    ],
  },
  {
    chave: "cnpj",
    rotulo: "Cartão CNPJ",
    origem: "societario",
    termos: ["cnpj", "cadastro nacional da pessoa juridica", "situacao cadastral"],
  },
  {
    chave: "ccmei",
    rotulo: "CCMEI",
    origem: "societario",
    termos: ["ccmei", "certificado da condicao de microempreendedor"],
  },
  {
    chave: "identidade-socios",
    rotulo: "Identidade dos Sócios",
    origem: "societario",
    termos: [
      "identidade", "cedula de identidade", "carteira nacional de habilitacao", "cnh",
      "socios", "administrador", "representante legal documento pessoal",
    ],
  },
  {
    chave: "procuracao",
    rotulo: "Procuração / Credenciamento",
    origem: "societario",
    termos: ["procuracao", "credenciamento", "instrumento de mandato", "poderes especificos"],
  },

  // ── Qualificação técnica ──
  {
    chave: "atestado-tecnico",
    rotulo: "Atestado de Capacidade Técnica",
    origem: "tecnico",
    termos: [
      "atestado de capacidade", "capacidade tecnica", "atestado tecnico",
      "acervo tecnico", "cat ", "aptidao para desempenho",
    ],
  },
  {
    chave: "registro-conselho",
    rotulo: "Registro em Conselho de Classe",
    origem: "tecnico",
    // "CRF" ficou de fora porque colide com o CRF do FGTS, que é
    // incomparavelmente mais frequente em edital do que o Conselho de Farmácia.
    termos: ["crea", "cau", "crm", "crq", "crmv", "conselho regional", "conselho de classe"],
  },
  {
    chave: "licenca-sanitaria",
    rotulo: "Licença Sanitária / ANVISA",
    origem: "tecnico",
    termos: [
      "licenca sanitaria", "alvara sanitario", "vigilancia sanitaria", "anvisa",
      "autorizacao de funcionamento", "afe", "registro do produto",
    ],
  },
  {
    chave: "alvara",
    rotulo: "Alvará de Funcionamento",
    origem: "tecnico",
    termos: ["alvara de funcionamento", "alvara de localizacao", "licenca de funcionamento"],
  },

  // ── Declarações que a própria plataforma gera ──
  {
    chave: "decl-menor",
    rotulo: "Declaração de Não Emprego de Menor",
    origem: "declaracao",
    termos: ["menor", "trabalho do menor", "xxxiii", "menores de dezoito", "trabalho infantil"],
  },
  {
    chave: "decl-me-epp",
    rotulo: "Declaração de ME/EPP",
    origem: "declaracao",
    termos: [
      "microempresa", "empresa de pequeno porte", "me epp", "enquadramento",
      "simples nacional", "optante pelo simples", "lei complementar 123",
    ],
  },
  {
    chave: "decl-fato-impeditivo",
    rotulo: "Declaração de Inexistência de Fato Impeditivo",
    origem: "declaracao",
    termos: [
      "fato impeditivo", "fatos impeditivos", "inidoneidade", "idoneidade",
      "suspensa de licitar", "penalidade",
    ],
  },
  {
    chave: "decl-proposta-independente",
    rotulo: "Declaração de Elaboração Independente de Proposta",
    origem: "declaracao",
    termos: ["elaboracao independente", "proposta independente", "conluio"],
  },
  {
    chave: "decl-habilitacao",
    rotulo: "Declaração de Cumprimento dos Requisitos de Habilitação",
    origem: "declaracao",
    termos: ["pleno conhecimento", "cumprimento dos requisitos", "cumpre plenamente", "pleno atendimento"],
  },
  {
    chave: "decl-reserva-cargos",
    rotulo: "Declaração de Reserva de Cargos (PCD)",
    origem: "declaracao",
    termos: ["reserva de cargos", "pessoa com deficiencia", "reabilitado", "cota de aprendiz"],
  },

  // ── Proposta ──
  {
    chave: "proposta",
    rotulo: "Proposta Comercial",
    origem: "proposta",
    termos: [
      "proposta comercial", "proposta de precos", "planilha de precos",
      "planilha de custos", "carta proposta", "proposta escrita",
    ],
  },
];

/**
 * Descobre a que documento do catálogo um texto se refere.
 * Compara com limites de palavra para que "uniao" não case dentro de
 * "reuniao" e "cnh" não case dentro de outra sigla maior.
 */
export function classificarDocumento(texto: string): CategoriaDocumento | null {
  const alvo = ` ${normalizarTexto(texto)} `;
  for (const categoria of CATALOGO) {
    for (const termo of categoria.termos) {
      const t = normalizarTexto(termo);
      if (!t) continue;
      if (alvo.includes(` ${t} `)) return categoria;
    }
  }
  return null;
}

// ─────────────────────────── datas ───────────────────────────

/**
 * A data da sessão vem da IA como texto livre ("15/03/2026 às 09:00",
 * "2026-03-15T09:00", "15 de março de 2026"). Aceitamos os três formatos;
 * o que não der para ler vira `null` e o checklist passa a comparar só com
 * hoje, avisando que não conseguiu projetar a validade.
 */
export function parseDataSessao(valor: string | undefined | null): Date | null {
  if (!valor) return null;
  const texto = String(valor).trim();
  if (!texto) return null;

  let m = texto.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0);
    return isNaN(d.getTime()) ? null : d;
  }

  m = texto.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[^\d]{1,6}(\d{1,2}):(\d{2}))?/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0);
    return isNaN(d.getTime()) ? null : d;
  }

  const MESES = [
    "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  const normalizado = normalizarTexto(texto);
  m = normalizado.match(/(\d{1,2}) de ([a-z]+) de (\d{4})/);
  if (m) {
    const mes = MESES.indexOf(m[2]);
    if (mes >= 0) {
      const d = new Date(Number(m[3]), mes, Number(m[1]));
      return isNaN(d.getTime()) ? null : d;
    }
  }

  return null;
}

/** Interpreta "AAAA-MM-DD" (formato gravado pelo portfólio) no fuso local. */
function parseDataValidade(valor: string | undefined): Date | null {
  if (!valor) return null;
  const m = String(valor).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return parseDataSessao(valor);
  // Fim do dia: uma certidão que vence dia 20 ainda vale no dia 20.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return isNaN(d.getTime()) ? null : d;
}

function inicioDoDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function diffEmDias(de: Date, ate: Date): number {
  return Math.ceil((inicioDoDia(ate).getTime() - inicioDoDia(de).getTime()) / 86400000);
}

function formatarData(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

// ─────────────────────────── cruzamento ───────────────────────────

/**
 * Nem toda exigência tem nome de catálogo — muitos editais escrevem exigências
 * próprias ("catálogo do fabricante", "comprovante de assistência técnica na
 * capital"). Para essas, vale a sobreposição de palavras relevantes com os
 * nomes das certidões cadastradas. O limite de 2 palavras em comum evita casar
 * por coincidência de uma palavra só.
 */
function melhorCertificadoPorSimilaridade(exigencia: string, certs: Certificate[]): Certificate | null {
  const tokensExigencia = new Set(tokensSignificativos(exigencia));
  if (tokensExigencia.size === 0) return null;

  let melhor: Certificate | null = null;
  let melhorPontuacao = 0;

  for (const cert of certs) {
    const tokensCert = tokensSignificativos(cert.name);
    if (tokensCert.length === 0) continue;
    const comuns = tokensCert.filter((t) => tokensExigencia.has(t)).length;
    // Proporção em relação ao nome da certidão: casar 2 de 3 palavras vale
    // mais do que casar 2 de 12.
    const pontuacao = comuns >= 2 ? comuns / tokensCert.length : 0;
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhor = cert;
    }
  }

  return melhorPontuacao >= 0.5 ? melhor : null;
}

interface AvaliacaoValidade {
  situacao: ExigenciaSituacao;
  diasParaVencer: number | null;
  detalhe: string;
  bloqueante: boolean;
}

function avaliarCertificado(cert: Certificate, hoje: Date, dataSessao: Date | null): AvaliacaoValidade {
  if (!cert.fileUploaded) {
    return {
      situacao: "sem_arquivo",
      diasParaVencer: null,
      detalhe: "Está no seu portfólio, mas nenhum arquivo foi enviado ainda.",
      bloqueante: true,
    };
  }

  // A IA de leitura da certidão já marcou que o arquivo enviado não confere
  // com a linha — isso derruba a habilitação do mesmo jeito que não ter.
  if (cert.documentMatchesRow === false) {
    return {
      situacao: "sem_arquivo",
      diasParaVencer: null,
      detalhe: cert.validationFeedback
        ? `O arquivo enviado não confere com esta certidão: ${cert.validationFeedback}`
        : "O arquivo enviado não confere com esta certidão. Reenvie o documento correto.",
      bloqueante: true,
    };
  }

  const validade = parseDataValidade(cert.expirationDate);
  if (!validade) {
    return {
      situacao: "sem_validade",
      diasParaVencer: null,
      detalhe: "Arquivo enviado, mas sem data de validade preenchida — não dá para saber se estará válido na sessão.",
      bloqueante: false,
    };
  }

  const dias = diffEmDias(hoje, validade);

  if (validade.getTime() < hoje.getTime()) {
    return {
      situacao: "vencida",
      diasParaVencer: dias,
      detalhe: `Venceu em ${formatarData(validade)}. Emita a segunda via antes de enviar a documentação.`,
      bloqueante: true,
    };
  }

  if (dataSessao && validade.getTime() < dataSessao.getTime()) {
    return {
      situacao: "vence_antes",
      diasParaVencer: dias,
      detalhe: `Válida hoje, mas vence em ${formatarData(validade)} — antes da sessão em ${formatarData(dataSessao)}. Renove antes da disputa.`,
      bloqueante: true,
    };
  }

  const sufixo = dias <= 15 ? ` Faltam ${dias} dia(s) para vencer; considere renovar.` : "";
  return {
    situacao: "coberta",
    diasParaVencer: dias,
    detalhe: `Válida até ${formatarData(validade)}.${sufixo}`,
    bloqueante: false,
  };
}

/**
 * Monta o checklist de habilitação cruzando as exigências do edital com o
 * portfólio de certidões do usuário.
 *
 * @param hoje injetável para manter os testes estáveis; na UI é `new Date()`.
 */
export function montarChecklistHabilitacao(
  analise: Pick<EditalAnalysis, "documentosExigidos" | "identificacaoCertame"> | null | undefined,
  certificados: Certificate[],
  hoje: Date = new Date(),
): ResultadoHabilitacao {
  const exigencias = (analise?.documentosExigidos || [])
    .map((e) => String(e || "").trim())
    .filter((e) => e.length > 0);

  const dataSessao = parseDataSessao(analise?.identificacaoCertame?.dataHoraSessao);

  // Indexa o portfólio por categoria uma única vez. Quando o usuário tem mais
  // de uma certidão da mesma categoria (uma vencida e a renovada, por exemplo),
  // fica a de validade mais longa — é a que ele vai efetivamente apresentar.
  const porCategoria = new Map<string, Certificate>();
  for (const cert of certificados) {
    const categoria = classificarDocumento(cert.name);
    if (!categoria) continue;
    const atual = porCategoria.get(categoria.chave);
    if (!atual) {
      porCategoria.set(categoria.chave, cert);
      continue;
    }
    const validadeAtual = parseDataValidade(atual.expirationDate)?.getTime() ?? -Infinity;
    const validadeNova = parseDataValidade(cert.expirationDate)?.getTime() ?? -Infinity;
    // Desempate: prefere a que tem arquivo enviado, depois a de validade maior.
    const pesoAtual = (atual.fileUploaded ? 1 : 0) * 1e15 + validadeAtual;
    const pesoNovo = (cert.fileUploaded ? 1 : 0) * 1e15 + validadeNova;
    if (pesoNovo > pesoAtual) porCategoria.set(categoria.chave, cert);
  }

  const itens: ExigenciaChecklist[] = exigencias.map((exigencia) => {
    const categoria = classificarDocumento(exigencia);
    const cert = categoria
      ? porCategoria.get(categoria.chave) ?? null
      : melhorCertificadoPorSimilaridade(exigencia, certificados);

    if (cert) {
      const avaliacao = avaliarCertificado(cert, hoje, dataSessao);
      return {
        exigencia,
        categoria: categoria?.chave ?? null,
        rotulo: categoria?.rotulo ?? cert.name,
        origem: categoria?.origem ?? "certidao",
        certificado: cert,
        ...avaliacao,
      };
    }

    // Declarações e proposta não ficam no portfólio de certidões: são emitidas
    // por disputa. Cobrar "cadastre esse documento" seria orientação errada —
    // o caminho certo é a aba "Criar Documentos".
    if (categoria && (categoria.origem === "declaracao" || categoria.origem === "proposta")) {
      return {
        exigencia,
        categoria: categoria.chave,
        rotulo: categoria.rotulo,
        origem: categoria.origem,
        certificado: null,
        situacao: "a_gerar" as const,
        diasParaVencer: null,
        detalhe: "Documento emitido por disputa — gere em \"Criar Documentos\" e assine antes do envio.",
        bloqueante: false,
      };
    }

    return {
      exigencia,
      categoria: categoria?.chave ?? null,
      rotulo: categoria?.rotulo ?? null,
      origem: categoria?.origem ?? null,
      certificado: null,
      situacao: "nao_cadastrada" as const,
      diasParaVencer: null,
      detalhe: "Não encontramos nada equivalente no seu portfólio. Providencie o documento e cadastre em \"Gestão de Certidões\".",
      bloqueante: true,
    };
  });

  const cobertas = itens.filter((i) => i.situacao === "coberta").length;
  const bloqueantes = itens.filter((i) => i.bloqueante).length;
  const atencao = itens.filter((i) => !i.bloqueante && i.situacao !== "coberta").length;

  // Avisos sobre o portfólio que o edital não pediu, mas que vão pegar o
  // usuário na próxima disputa. Só as vencidas/vencendo, e com arquivo enviado.
  const categoriasExigidas = new Set(itens.map((i) => i.categoria).filter(Boolean));
  const alertasPortfolio: string[] = [];
  for (const cert of certificados) {
    if (!cert.fileUploaded) continue;
    const categoria = classificarDocumento(cert.name);
    if (categoria && categoriasExigidas.has(categoria.chave)) continue;
    const validade = parseDataValidade(cert.expirationDate);
    if (!validade) continue;
    const dias = diffEmDias(hoje, validade);
    if (validade.getTime() < hoje.getTime()) {
      alertasPortfolio.push(`"${cert.name}" venceu em ${formatarData(validade)}.`);
    } else if (dias <= 15) {
      alertasPortfolio.push(`"${cert.name}" vence em ${formatarData(validade)} (${dias} dia(s)).`);
    }
  }

  return {
    itens,
    dataSessao,
    totalExigencias: itens.length,
    cobertas,
    bloqueantes,
    atencao,
    score: itens.length === 0 ? 0 : Math.round((cobertas / itens.length) * 100),
    alertasPortfolio,
  };
}

// ─────────────────────────── exportação ───────────────────────────

const ROTULO_SITUACAO: Record<ExigenciaSituacao, string> = {
  coberta: "OK",
  vence_antes: "VENCE ANTES DA SESSÃO",
  vencida: "VENCIDA",
  sem_arquivo: "SEM ARQUIVO",
  sem_validade: "VALIDADE EM BRANCO",
  a_gerar: "A GERAR",
  nao_cadastrada: "NÃO LOCALIZADA",
};

export function rotuloSituacao(situacao: ExigenciaSituacao): string {
  return ROTULO_SITUACAO[situacao];
}

/** Versão em texto do checklist, para colar em e-mail ou anexar ao processo. */
export function checklistParaTexto(resultado: ResultadoHabilitacao, tituloEdital: string): string {
  const linhas: string[] = [];
  linhas.push(`CHECKLIST DE HABILITAÇÃO — ${tituloEdital}`);
  if (resultado.dataSessao) {
    linhas.push(`Sessão: ${resultado.dataSessao.toLocaleString("pt-BR")}`);
  }
  linhas.push(
    `Cobertas: ${resultado.cobertas}/${resultado.totalExigencias} · Bloqueios: ${resultado.bloqueantes} · Atenção: ${resultado.atencao}`,
  );
  linhas.push("");

  for (const item of resultado.itens) {
    linhas.push(`[${rotuloSituacao(item.situacao)}] ${item.exigencia}`);
    if (item.certificado) linhas.push(`   Documento: ${item.certificado.name}`);
    linhas.push(`   ${item.detalhe}`);
    linhas.push("");
  }

  if (resultado.alertasPortfolio.length > 0) {
    linhas.push("OUTRAS CERTIDÕES DO PORTFÓLIO QUE PEDEM ATENÇÃO:");
    for (const alerta of resultado.alertasPortfolio) linhas.push(`- ${alerta}`);
  }

  return linhas.join("\n");
}
