export interface CompanyData {
  razonSocial: string;
  cnpj: string;
  address: string;
  phone: string;
  email: string;
  representativeName: string;
  representativeCpf: string;
  bankDetails: string;
}

export interface Certificate {
  id: string;
  name: string;
  emissionDate: string;
  expirationDate: string;
  status: "expired" | "expiring_soon" | "valid";
  notes?: string;
  fileUploaded?: boolean;
  fileName?: string;
  documentMatchesRow?: boolean;
  validationFeedback?: string;
}

export interface EditalAnalysis {
  pontosPositivos: string[];
  pontosAlerta: string[];
  prazoEntrega: string;
  prazoPagamento: string;
  descricaoProduto: string;
  documentosExigidos: string[];
  rawText?: string;
  
  // Decoded 6 premium pillars
  identificacaoCertame?: {
    orgaoComprador: string;
    modalidade: string;
    identificacaoNumerica: string;
    dataHoraSessao: string;
  };
  especificacoesTecnicas?: {
    exigenciasFisicas: string[];
    pegadinhasOcultas: string[];
  };
  burocraciaBarreiras?: {
    exigeAmostra: string;
    exigeCartaSolidariedade: string;
    exigenciaGarantia: string;
    consorcioSubcontratacao: string;
  };
  logisticaCronograma?: {
    prazoEntregaReal: string;
    classificacaoPrazo: string;
    enderecoEntrega: string;
    prazoGarantia: string;
  };
  viabilidadeFinanceira?: {
    valorEstimado: string;
    distorcoesPreco: string;
    prazoPagamento: string;
  };
  parecerFinal?: {
    veredito: string;
    grauRisco: string;
    estrategiaLances: string;
  };
  reportMarkdown?: string;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
}

export interface SyncItem {
  id: string;
  name: string;
  type: "document" | "sheet" | "proposal" | "declaration";
  path: string;
  timestamp: string;
  url?: string;
}
