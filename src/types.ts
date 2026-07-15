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
  itensEdital?: {
    numero: number;
    descricao: string;
    quantidade: number;
    unidade?: string;
    valorEstimado?: string;
  }[];
}

export type ChatRole = "user" | "assistant";

export interface Attachment {
  name: string;
  type: string;
  data: string; // Base64 representation of imagery/data files
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  attachment?: Attachment;
}

export interface ChatSession {
  id: string;
  title: string;
  selectedEditalId: string; // Empty string for none, "active" for active in memory, or edital timestamp/id
  messages: ChatMessage[];
  createdAt: string;
}

export interface SyncItem {
  id: string;
  name: string;
  type: "document" | "sheet" | "proposal" | "declaration";
  path: string;
  timestamp: string;
  url?: string;
}

export interface CompetitorIrregularity {
  campoExigido: string;
  propostaConcorrente: string;
  gravidade: "ALTA" | "MÉDIA" | "BAIXA";
  baseLegal: string;
  impacto: string;
}

export interface CompetitorAnalysis {
  competitorName?: string;
  isCompliant: boolean;
  irregularidadesEncontradas: CompetitorIrregularity[];
  pontosFortesConcorrente: string[];
  modeloRecurso: string;
  analiseEstiloMarkdown: string;
}

export interface CompetitorHistoryItem {
  id: string;
  competitorName: string;
  focusItems: string;
  date: string;
  editalTitle?: string;
  analysis: CompetitorAnalysis;
}
