import { useState, useEffect } from "react";
import { EditalAnalysis, CompanyData, SyncItem, Certificate } from "../types";
import { 
  FileUp, FileText, CheckCircle2, AlertTriangle, Clock, ArrowRight, Loader2, Play, 
  Sparkles, RefreshCw, ChevronRight, FileCode, CheckSquare, Edit3, Settings, ClipboardPaste, 
  Coins, HelpCircle, HardDriveDownload, MonitorCheck, Save, Send, Database, FileSpreadsheet, Eye,
  Trash2, ShieldCheck, ShieldAlert, Award, TrendingUp, Landmark, MapPin, Gauge, Plus, X,
  LayoutGrid, List, Search, Check, Calendar, ExternalLink, Globe
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { addSyncedItem, syncAnalysisToGoogleSheets } from "../utils/googleSync";
import { 
  syncEditalToSupabase, 
  syncDocumentToSupabase, 
  callSupabaseGeminiEdgeFunction,
  fetchEditaisFromSupabase,
  saveEditalToSupabase,
  deleteEditalFromSupabase
} from "../utils/supabaseClient";
import confetti from "canvas-confetti";
import { getActiveAiConfig, apiFetch, prepareAttachmentsForServer } from "../utils/aiClientHelper";

function cleanMarkdownText(text: string | undefined): string {
  if (!text) return "";
  let cleaned = text
    .replace(/\\n/gi, "\n")
    .replace(/\\r/gi, "\r")
    .replace(/\\t/gi, "\t")
    .replace(/\\"/g, '"');

  // Fix literal mangled section dividers "nn---", "n---", "NN---"
  cleaned = cleaned.replace(/n{1,2}---/gi, "\n\n---\n\n");

  // Fix mangled list bullet points "n•", "n-", "n*", "nn•", "nn-", "nn*"
  cleaned = cleaned.replace(/\s*n{1,2}[•\-\*]\s*/g, "\n- ");

  // Fix mangled numbered list items "nn1.", "n1.", "nn 1."
  cleaned = cleaned.replace(/\s*n{1,2}\s*(\d+)\.\s*/g, "\n$1. ");

  // Fix mangled markdown section headers "nn##", "NN##", "n##"
  cleaned = cleaned.replace(/\s*n{1,2}(#{1,6}\s*)/gi, "\n\n$1");

  // Fix mangled line breaks before section emojis (e.g. "n🎯", "nn💰", "n✅", "n⚠️", "n📜", "n💡")
  cleaned = cleaned.replace(/\s*n{1,2}([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])/gu, "\n\n$1");

  // Fix mangled 'n' before bold headers like "n. **Lote", "nn. **Lote"
  cleaned = cleaned.replace(/\s*n{1,2}\.\s*(\*\*|\*)/g, "\n\n- $1");
  cleaned = cleaned.replace(/\s*n{1,2}\s*(\*\*|\*)/g, "\n\n$1");

  // Fix mangled "n " or "nn " between sentences/titles
  cleaned = cleaned.replace(/([a-z0-9\):])\s*n{1,2}\s*([A-ZÁÉÍÓÚÀÂÊÔÃÕ0-9\-\*•])/g, "$1\n\n$2");

  // Fix legacy table backslashes
  cleaned = cleaned.replace(/\|N\|\s*/gi, "|\n| ");
  cleaned = cleaned.replace(/\|N\s*/gi, "|\n");

  return cleaned.trim();
}

function extractCleanPncpQuery(rawIdNum: string, fullText: string): string {
  const combined = (rawIdNum + " " + fullText).trim();

  // 1. Look for process number format (e.g. 1.00.000.008453/2025-95 or 23078.001234/2026-12)
  const processMatch = combined.match(/\b(\d{1,3}\.\d{2,3}\.\d{3}\.\d{6}\/\d{4}-\d{2})\b/) 
    || combined.match(/\b(\d{5,6}\.\d{6}\/\d{4}-\d{2})\b/)
    || combined.match(/\b(\d{6}\/\d{4}-\d{2})\b/);

  if (processMatch) {
    return processMatch[1];
  }

  // 2. Look for edital / dispensa / pregão number format (e.g. 77/2026 or 00077/2026)
  const editalNumMatch = combined.match(/\b(\d{1,6}\/202[4-9])\b/);
  if (editalNumMatch) {
    return editalNumMatch[1];
  }

  // Fallback: strip Portuguese labels like "Dispensa nº", "Processo nº", "Edital", parentheses, etc.
  let cleaned = rawIdNum
    .replace(/(?:Dispensa|Preg[aã]o|Concorr[eê]ncia|Inexigibilidade|Edital|Processo|Certame|Licita[cç][aã]o|Contrata[cç][aã]o)\s*(?:n[oºª\.]*)?/gi, "")
    .replace(/[\(\)\[\]\{\}]/g, " ")
    .replace(/[\:\;\,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || rawIdNum.trim();
}

function getPncpLink(edital: EditalAnalysis | null): string | null {
  if (!edital) return null;

  const knownLink = edital.identificacaoCertame?.linkPNCP || edital.linkPNCP;
  if (knownLink && typeof knownLink === "string" && knownLink.startsWith("http")) {
    if (knownLink.includes("/app/editais/")) {
      return knownLink;
    }
  }

  const text = (edital.rawText || "") + " " + (edital.reportMarkdown || "");

  // Direct PNCP edital page link in text (/app/editais/CNPJ/ANO/SEQ)
  const directPncpMatch = text.match(/(https?:\/\/(?:www\.)?pncp\.gov\.br\/app\/editais\/\d{14}\/\d{4}\/\d+)/i);
  if (directPncpMatch) {
    return directPncpMatch[1];
  }

  // Any generic PNCP or Comprasnet URL in text
  const anyUrlMatch = text.match(/(https?:\/\/(?:www\.)?(?:pncp\.gov\.br|cnetmobile\.estaleiro\.serpro\.gov\.br|gov\.br\/compras)\/[^\s\)\"\'>]+)/i);
  if (anyUrlMatch) {
    return anyUrlMatch[1].replace(/[.,;]$/, "");
  }

  // PNCP control number (e.g. 26989715000102-1-000077/2026 or 00394804000100-1-000012/2026)
  const numControleMatch = text.match(/(\d{14})[-_]?1[-_]?(\d{1,6})\/(\d{4})/);
  if (numControleMatch) {
    const cnpj = numControleMatch[1];
    const seq = parseInt(numControleMatch[2], 10);
    const ano = numControleMatch[3];
    return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`;
  }

  // CNPJ (14 digits) + Year + Seq
  const cnpjMatch = text.match(/(?:CNPJ[:\s]*)?(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{14})/i);
  const yearMatch = text.match(/\b(202[4-9])\b/);
  const numSeqMatch = text.match(/(?:Dispensa|Pregão|Edital|Processo|Contratação|nº|n°)\s*(?:nº|n°)?\s*(\d{1,6})\/202[4-9]/i);

  if (cnpjMatch && yearMatch && numSeqMatch) {
    const cleanCnpj = cnpjMatch[1].replace(/\D/g, "");
    if (cleanCnpj.length === 14) {
      const seq = parseInt(numSeqMatch[1], 10);
      const ano = yearMatch[1];
      if (!isNaN(seq) && seq > 0) {
        return `https://pncp.gov.br/app/editais/${cleanCnpj}/${ano}/${seq}`;
      }
    }
  }

  // Fallback to knownLink if it exists
  if (knownLink && typeof knownLink === "string" && knownLink.startsWith("http")) {
    return knownLink;
  }

  // Clean query fallback
  const idNum = edital.identificacaoCertame?.identificacaoNumerica || "";
  const cleanTerm = extractCleanPncpQuery(idNum, text);

  if (cleanTerm && cleanTerm.length >= 2) {
    return `https://pncp.gov.br/app/editais?q=${encodeURIComponent(cleanTerm)}`;
  }

  return "https://pncp.gov.br/app/editais";
}

function getDataHoraDisputa(edital: EditalAnalysis | null): string {
  if (!edital) return "Não especificada no Edital";
  if (edital.identificacaoCertame?.dataHoraSessao) return edital.identificacaoCertame.dataHoraSessao;
  
  const text = (edital.rawText || "") + " " + (edital.reportMarkdown || "");
  const match = text.match(/(?:Abertura|Sessão|Disputa|Data|Sessão Pública)[:\s]+(\d{2}\/\d{2}\/\d{4}[^.\n]*)/i);
  if (match) return match[1].trim();

  return edital.prazoEntrega || "A Definir no Edital";
}

interface EditalAnalyzerTabProps {
  companyData: CompanyData;
  activeEdital: EditalAnalysis | null;
  setActiveEdital: (analysis: EditalAnalysis | null) => void;
  onOpenDocPreview: (title: string, markdown: string, type: "proposal" | "declaration") => void;
  onNavigateToCreateDoc?: (templateId?: string) => void;
}

interface AttachedFile {
  id: string;
  name: string;
  size: string;
  type: string;
  base64: string;
}

export default function EditalAnalyzerTab({ companyData, activeEdital, setActiveEdital, onOpenDocPreview, onNavigateToCreateDoc }: EditalAnalyzerTabProps) {
  const [textInput, setTextInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  // File size error popup modal state (>60MB)
  const [fileSizeErrorModal, setFileSizeErrorModal] = useState<{
    show: boolean;
    fileName: string;
    fileSizeMb: string;
  } | null>(null);

  // Extra Prompt/Customization states for document creation
  const [extraInstructions, setExtraInstructions] = useState("");
  const [uploadedTemplateText, setUploadedTemplateText] = useState("");
  const [showCustomDocForm, setShowCustomDocForm] = useState(false);
  
  // Custom Proposal Details Modal state
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [proposalFileTitle, setProposalFileTitle] = useState("");
  const [proposalDispensa, setProposalDispensa] = useState("");
  const [proposalProcesso, setProposalProcesso] = useState("");
  const [proposalOrgao, setProposalOrgao] = useState("");
  const [proposalObject, setProposalObject] = useState("");
  const [proposalItems, setProposalItems] = useState<any[]>([]);
  const [valPrazo, setValPrazo] = useState("");
  const [valPgto, setValPgto] = useState("");
  const [valEntrega, setValEntrega] = useState("");
  const [valLocal, setValLocal] = useState("");
  const [proposalDate, setProposalDate] = useState("");
  const [selectedItemNumbers, setSelectedItemNumbers] = useState<number[]>([]);
  const [originalEdital, setOriginalEdital] = useState<EditalAnalysis | null>(null);
  const [refining, setRefining] = useState(false);
  const [isRefined, setIsRefined] = useState(false);

  // Modern Item Selector UI states
  const [itemSelectorViewMode, setItemSelectorViewMode] = useState<"compact" | "detailed">("compact");
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [hoveredItemNumber, setHoveredItemNumber] = useState<number | null>(null);

  // Certificate Management Intelligence state
  const [userCertificates, setUserCertificates] = useState<Certificate[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("aip_certificates");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setUserCertificates(parsed);
        }
      } catch (e) {
        setUserCertificates([]);
      }
    }
  }, [activeEdital]);

  const matchAndEvaluateCertificate = (docText: string) => {
    if (!docText) return {
      matchedCert: null,
      statusType: "not_registered" as const,
      badgeText: "Sem Cadastro",
      badgeColor: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
      message: "Não localizado na sua Gestão de Certidões.",
      isWarning: false
    };

    const norm = docText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const candidate = userCertificates.find(c => {
      const cName = c.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const cId = c.id.toLowerCase();

      if (norm.includes("receita federal") || norm.includes("tributos federais") || norm.includes("divida ativa da uniao") || norm.includes("inss") || (norm.includes("federal") && norm.includes("debito"))) {
        return cId.includes("receita") || cName.includes("receita") || cName.includes("federal");
      }
      if (norm.includes("estadual") || norm.includes("sefaz") || norm.includes("fazenda estadual")) {
        return cId.includes("estadual") || cName.includes("estadual");
      }
      if (norm.includes("municipal") || norm.includes("iptu") || norm.includes("iss") || norm.includes("fazenda municipal")) {
        return cId.includes("municipal") || cName.includes("municipal");
      }
      if (norm.includes("trabalhista") || norm.includes("cndt") || norm.includes("debitos trabalhistas")) {
        return cId.includes("trabalhista") || cName.includes("trabalhista") || cName.includes("cndt");
      }
      if (norm.includes("fgts") || norm.includes("crf") || norm.includes("caixa economica")) {
        return cId.includes("fgts") || cName.includes("fgts") || cName.includes("crf");
      }
      if (norm.includes("falencia") || norm.includes("concordata") || norm.includes("recuperacao judicial")) {
        return cId.includes("falencia") || cName.includes("falencia");
      }
      if (norm.includes("sicaf") || norm.includes("crc")) {
        return cId.includes("sicaf") || cName.includes("sicaf");
      }
      if (norm.includes("balanco") || norm.includes("demostrativ") || norm.includes("contabil") || norm.includes("livro diario")) {
        return cId.includes("balanco") || cId.includes("contabil") || cName.includes("balanco") || cName.includes("contabil") || cName.includes("livro");
      }
      if (norm.includes("atestado") || norm.includes("capacidade tecnica")) {
        return cId.includes("atestado") || cName.includes("atestado");
      }
      if (norm.includes("contrato social") || norm.includes("estatuto")) {
        return cId.includes("contrato") || cName.includes("contrato") || cName.includes("estatuto");
      }
      if (norm.includes("alvara") || norm.includes("licenca")) {
        return cId.includes("alvara") || cName.includes("alvara") || cName.includes("licenca");
      }

      const words = cName.split(" ").filter(w => w.length > 3);
      return words.some(w => norm.includes(w));
    });

    if (!candidate) {
      return {
        matchedCert: null,
        statusType: "not_registered" as const,
        badgeText: "Verificar Acervo",
        badgeColor: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
        message: "Não localizado explicitamente na Gestão de Certidões. Verifique seu acervo.",
        isWarning: false
      };
    }

    if (!candidate.fileUploaded) {
      return {
        matchedCert: candidate,
        statusType: "not_uploaded" as const,
        badgeText: "Sem Arquivo",
        badgeColor: "bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40",
        message: `Cadastrado como "${candidate.name}", mas nenhum arquivo PDF foi anexado.`,
        isWarning: true
      };
    }

    if (!candidate.expirationDate) {
      return {
        matchedCert: candidate,
        statusType: "no_date" as const,
        badgeText: "Data Pendente",
        badgeColor: "bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40",
        message: `Defina a data de validade de "${candidate.name}" na Gestão de Certidões.`,
        isWarning: true
      };
    }

    const parts = candidate.expirationDate.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const expDate = new Date(year, month, day, 23, 59, 59, 999);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const diffTime = expDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const formattedDate = `${day.toString().padStart(2, '0')}/${(month + 1).toString().padStart(2, '0')}/${year}`;

      if (diffDays <= 0) {
        return {
          matchedCert: candidate,
          statusType: "expired" as const,
          badgeText: "VENCIDA",
          badgeColor: "bg-rose-500/20 text-rose-800 dark:text-rose-300 border-rose-500/40",
          message: `🚨 A certidão "${candidate.name}" VENCEU em ${formattedDate}. Regularize na Gestão de Certidões!`,
          isWarning: true
        };
      } else if (diffDays <= 15) {
        return {
          matchedCert: candidate,
          statusType: "expiring_soon" as const,
          badgeText: `Vence em ${diffDays}d`,
          badgeColor: "bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-500/40",
          message: `⚠️ Atenção: "${candidate.name}" vence em ${diffDays} dia(s) (${formattedDate}).`,
          isWarning: true
        };
      } else {
        return {
          matchedCert: candidate,
          statusType: "valid" as const,
          badgeText: "Válida & Regular",
          badgeColor: "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
          message: `Válida e regular até ${formattedDate}.`,
          isWarning: false
        };
      }
    }

    return {
      matchedCert: candidate,
      statusType: "valid" as const,
      badgeText: "Válida",
      badgeColor: "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
      message: "Cadastrada e regular.",
      isWarning: false
    };
  };

  useEffect(() => {
    if (activeEdital?.itensEdital) {
      const activeNums = activeEdital.itensEdital.map(it => it.numero);
      // Only overwrite if the user selected nothing or there's absolutely no overlap (e.g. brand new document)
      const hasOverlap = selectedItemNumbers.some(n => activeNums.includes(n));
      if (!hasOverlap || selectedItemNumbers.length === 0) {
        setSelectedItemNumbers(activeNums);
      }
    } else {
      setSelectedItemNumbers([]);
    }
  }, [activeEdital]);

  // Helper numbers to words (Português)
  function numeroParaExtenso(valor: number): string {
    const unidades = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
    const dezenas = ["", "dez", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
    const dezenaEspeciais = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
    const centenas = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

    function tresDigitos(num: number): string {
      if (num === 0) return "";
      let res = "";
      const c = Math.floor(num / 100);
      const d = Math.floor((num % 100) / 10);
      const u = num % 10;

      if (c > 0) {
        if (c === 1 && d === 0 && u === 0) {
          res += "cem";
        } else {
          res += centenas[c];
        }
      }

      if (d > 0 || u > 0) {
        if (res !== "") res += " e ";
        if (d === 1) {
          res += dezenaEspeciais[u];
        } else {
          if (d > 0) {
            res += dezenas[d];
            if (u > 0) res += " e " + unidades[u];
          } else {
            res += unidades[u];
          }
        }
      }
      return res;
    }

    if (valor === 0) return "zero reais";

    const parteInteira = Math.floor(valor);
    const parteDecimal = Math.round((valor - parteInteira) * 100);

    let extensoInteiro = "";
    if (parteInteira > 0) {
      const bilhoes = Math.floor(parteInteira / 1000000000);
      const milhoes = Math.floor((parteInteira % 1000000000) / 1000000);
      const milhares = Math.floor((parteInteira % 1000000) / 1000);
      const unidadesSimples = parteInteira % 1000;

      let partes: string[] = [];

      if (bilhoes > 0) {
        partes.push(tresDigitos(bilhoes) + (bilhoes === 1 ? " bilhão" : " bilhões"));
      }
      if (milhoes > 0) {
        partes.push(tresDigitos(milhoes) + (milhoes === 1 ? " milhão" : " milhões"));
      }
      if (milhares > 0) {
        partes.push(tresDigitos(milhares) + " mil");
      }
      if (unidadesSimples > 0) {
        partes.push(tresDigitos(unidadesSimples));
      }

      extensoInteiro = partes.join(", ");
      
      if (parteInteira === 1) {
        extensoInteiro += " real";
      } else {
        if (parteInteira % 1000000 === 0 && parteInteira > 0) {
          extensoInteiro += " de reais";
        } else {
          extensoInteiro += " reais";
        }
      }
    }

    let extensoDecimal = "";
    if (parteDecimal > 0) {
      extensoDecimal = tresDigitos(parteDecimal);
      if (parteDecimal === 1) {
        extensoDecimal += " centavo";
      } else {
        extensoDecimal += " centavos";
      }
    }

    if (extensoInteiro && extensoDecimal) {
      return extensoInteiro + " e " + extensoDecimal;
    } else if (extensoInteiro) {
      return extensoInteiro;
    } else if (extensoDecimal) {
      return extensoDecimal;
    }
    return "zero reais";
  }

  const formatCurrency = (val: number) => {
    return val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getGlobalSum = () => {
    let sum = 0;
    proposalItems.forEach(it => {
      const cleanVal = parseFloat(String(it.totalValue || "0").replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
      if (!isNaN(cleanVal)) {
        sum += cleanVal;
      }
    });
    return sum;
  };

  const handleOpenProposalModal = () => {
    const dispensaDefault = activeEdital?.identificacaoCertame?.modalidade && activeEdital?.identificacaoCertame?.identificacaoNumerica
      ? `${activeEdital.identificacaoCertame.modalidade} nº ${activeEdital.identificacaoCertame.identificacaoNumerica}`
      : "Dispensa de Licitação nº 046/2026";

    const processoDefault = "Processo Administrativo nº 209/2026";
    const orgaoDefault = activeEdital?.identificacaoCertame?.orgaoComprador || "Secretaria Municipal de Educação de Juazeiro/BA";
    const objetoDefault = activeEdital?.descricaoProduto || "fornecimento de equipamentos audiovisuais e tecnológicos destinados ao preenchimento integral das metas do Programa Educomunicativo Conexão Escola, sob coordenação da TV Escola Juazeiro";
    
    const defaultItems = [
      {
        description: activeEdital?.descricaoProduto || "PROJETOR MULTIMÍDIA INTERATIVO, BRILHO DE 4.000 LUMENS, RESOLUÇÃO NATIVA FULL HD, CONECTIVIDADE HDMI/USB",
        quantity: 8,
        brandModel: "Epson PowerLite L210SF",
        unitValue: "2.500,00",
        totalValue: "20.000,00"
      }
    ];

    let finalItems = defaultItems;
    if (activeEdital?.itensEdital && activeEdital.itensEdital.length > 0) {
      // Filter by user selection
      const itemsToMap = activeEdital.itensEdital.filter(it => selectedItemNumbers.includes(it.numero));
      const targetItems = itemsToMap.length > 0 ? itemsToMap : activeEdital.itensEdital;

      finalItems = targetItems.map(it => {
        let unitVal = "0,00";
        if (it.valorEstimado) {
          const match = it.valorEstimado.match(/([0-9.]+,[0-9]{2})/);
          if (match) {
            unitVal = match[1];
          } else {
            // strip currency signs and attempt standard parse
            const cleaned = it.valorEstimado.replace(/[^\d,.-]/g, "").trim();
            if (cleaned) unitVal = cleaned;
          }
        }

        // Calculate total
        let totalVal = "0,00";
        const q = it.quantidade || 1;
        const uStr = unitVal.replace(/\./g, "").replace(",", ".");
        const u = parseFloat(uStr);
        if (!isNaN(u)) {
          totalVal = (q * u).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        return {
          description: it.descricao.toUpperCase(),
          quantity: it.quantidade || 1,
          brandModel: "",
          unitValue: unitVal,
          totalValue: totalVal
        };
      });
    }

    setProposalDispensa(dispensaDefault);
    setProposalProcesso(processoDefault);
    setProposalOrgao(orgaoDefault);
    setProposalObject(objetoDefault);
    setProposalItems(finalItems);
    
    // Custom clean filename
    const cleanNum = (activeEdital?.identificacaoCertame?.identificacaoNumerica || "046-2026").replace(/\//g, "-");
    setProposalFileTitle(`Proposta Comercial - Dispensa ${cleanNum}.pdf`);
    
    setValPrazo("60 (sessenta) dias, a contar da data de apresentação deste documento.");
    setValPgto(activeEdital?.viabilidadeFinanceira?.prazoPagamento || "Em até 30 (trinta) dias úteis, contados da finalização da regular liquidação da despesa pelo Município.");
    setValEntrega(activeEdital?.logisticaCronograma?.prazoEntregaReal || "Até 15 (quinze) dias corridos, contados a partir do recebimento da Ordem de Fornecimento ou Nota de Empenho.");
    setValLocal(activeEdital?.logisticaCronograma?.enderecoEntrega || "Secretaria Municipal de Educação de Juazeiro/BA, diretamente no Setor de TI. Sem custos logísticos para o órgão.");
    
    const formattedDate = `Alagoinhas - BA, ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    setProposalDate(formattedDate);

    setShowProposalModal(true);
  };

  const handleItemChange = (index: number, field: string, val: any) => {
    const updated = [...proposalItems];
    updated[index][field] = val;
    
    if (field === "quantity" || field === "unitValue") {
      const q = parseFloat(String(updated[index].quantity || "0"));
      const uStr = String(updated[index].unitValue || "0")
        .replace(/\s/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const u = parseFloat(uStr);
      
      if (!isNaN(q) && !isNaN(u)) {
        const total = q * u;
        updated[index].totalValue = formatCurrency(total);
      }
    }
    setProposalItems(updated);
  };

  const handleAddProposalItem = () => {
    setProposalItems([
      ...proposalItems,
      {
        description: "",
        quantity: 1,
        brandModel: "",
        unitValue: "0,00",
        totalValue: "0,00"
      }
    ]);
  };

  const handleRemoveProposalItem = (index: number) => {
    if (proposalItems.length === 1) {
      alert("A proposta deve conter ao menos 1 item.");
      return;
    }
    setProposalItems(proposalItems.filter((_, idx) => idx !== index));
  };

  const handleGenerateProposal = async () => {
    setGeneratingDoc("proposal");
    setShowProposalModal(false);
    
    const sum = getGlobalSum();
    const sumStr = formatCurrency(sum);
    const extensoStr = numeroParaExtenso(sum);

    const details = {
      proposalFileTitle,
      proposalDispensa,
      proposalProcesso,
      proposalOrgao,
      proposalObject,
      proposalItems,
      totalValueGlobal: sumStr,
      totalValueExtenso: extensoStr,
      valPrazo,
      valPgto,
      valEntrega,
      valLocal,
      proposalDate
    };

    try {
      const response = await apiFetch("/api/generate-document", {
        method: "POST",
        body: {
          docType: "proposal",
          analysisData: activeEdital,
          companyData: companyData,
          extraInstructions,
          proposalDetails: details
        }
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || "Erro de processamento da proposta.");
      }

      const data = await response.json();
      if (data.markdown) {
        const finalTitle = data.title || proposalFileTitle || "Proposta Comercial de Licitação.md";
        onOpenDocPreview(finalTitle, data.markdown, "proposal");
        addSyncedItem(finalTitle, "proposal", data.markdown);
      }
    } catch (err) {
      console.error(err);
      alert("Não foi possível gerar a proposta comercial automática. Tente novamente.");
    } finally {
      setGeneratingDoc(null);
    }
  };
  
  // Document generation processing states
  const [generatingDoc, setGeneratingDoc] = useState<string | null>(null);

  // Sub-tabs for edital analysis view
  const [analysisActiveTab, setAnalysisActiveTab] = useState<"report" | "struc" | "checklist">("report");

  // Histórico de Editais (Supabase com fallback Local)
  const [history, setHistory] = useState<any[]>([]);
  const [showConfirmClearHistory, setShowConfirmClearHistory] = useState(false);

  useEffect(() => {
    async function loadHistory() {
      try {
        const dbEditais = await fetchEditaisFromSupabase();
        if (dbEditais && dbEditais.length > 0) {
          setHistory(dbEditais);
          localStorage.setItem("aip_edital_history", JSON.stringify(dbEditais));
          window.dispatchEvent(new Event("aip_edital_history_updated"));
          return;
        }
      } catch (e) {
        console.warn("Falha ao buscar editais do Supabase, tentando local:", e);
      }

      try {
        const saved = localStorage.getItem("aip_edital_history");
        if (saved) {
          setHistory(JSON.parse(saved));
        }
      } catch (e) {
        setHistory([]);
      }
    }
    loadHistory();

    const handleExternalText = () => {
      const extText = localStorage.getItem("aip_auto_analyze_text");
      if (extText) {
        setTextInput(extText);
        setAttachedFiles([]);
        localStorage.removeItem("aip_auto_analyze_text");
        
        // Trigger auto analysis after a tiny delay so the state update is processed
        setTimeout(() => {
          const btn = document.getElementById("trigger-analyze-btn");
          if (btn) btn.click();
        }, 150);
      }
    };

    window.addEventListener("aip_trigger_external_text", handleExternalText);
    
    // Check on mount as well
    handleExternalText();

    return () => {
      window.removeEventListener("aip_trigger_external_text", handleExternalText);
    };
  }, []);

  const processSelectedFiles = (fileList: File[]) => {
    const maxSizeBytes = 60 * 1024 * 1024; // 60 MB

    fileList.forEach((file) => {
      if (file.size > maxSizeBytes) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        setFileSizeErrorModal({
          show: true,
          fileName: file.name,
          fileSizeMb: sizeMb
        });
        return;
      }

      let resolvedType = file.type;
      const lowerName = file.name.toLowerCase();
      if (!resolvedType || resolvedType === "application/octet-stream") {
        if (lowerName.endsWith(".pdf")) {
          resolvedType = "application/pdf";
        } else if (lowerName.endsWith(".txt")) {
          resolvedType = "text/plain";
        } else {
          resolvedType = "application/pdf";
        }
      }

      const reader = new FileReader();

      if (resolvedType === "text/plain") {
        reader.onload = (event) => {
          const txtContent = (event.target?.result as string) || "";
          let base64String = "";
          try {
            base64String = btoa(unescape(encodeURIComponent(txtContent)));
          } catch (e) {
            base64String = "";
          }
          
          setAttachedFiles(prev => {
            const filtered = prev.filter(f => f.name !== file.name);
            return [
              ...filtered,
              {
                id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                name: file.name,
                size: `${(file.size / 1024).toFixed(1)} KB`,
                type: "text/plain",
                base64: base64String
              }
            ];
          });
        };
        reader.readAsText(file);
      } else {
        reader.onload = (event) => {
          const resultStr = (event.target?.result as string) || "";
          const base64String = resultStr.includes(",") ? resultStr.split(",")[1] : resultStr;
          
          setAttachedFiles(prev => {
            const filtered = prev.filter(f => f.name !== file.name);
            return [
              ...filtered,
              {
                id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                name: file.name,
                size: `${(file.size / 1024).toFixed(1)} KB`,
                type: resolvedType,
                base64: base64String
              }
            ];
          });
        };
        reader.readAsDataURL(file);
      }
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    processSelectedFiles(Array.from(files));
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processSelectedFiles(Array.from(e.dataTransfer.files));
      e.dataTransfer.clearData();
    }
  };

  const handleRemoveFile = (id: string) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleAnalyze = async () => {
    if (!textInput.trim() && attachedFiles.length === 0) {
      alert("Por favor, cole o texto do edital ou faça upload de um ou mais arquivos anexos primeiro.");
      return;
    }

    setLoading(true);
    try {
      let data: any;

      console.log(`[Analyzer] Processing edital analysis with ${attachedFiles.length} file attachments...`);

      const preparedAttachments = await prepareAttachmentsForServer(attachedFiles);

      const response = await apiFetch("/api/analyze-edital", {
        method: "POST",
        body: {
          textInput: textInput,
          attachments: preparedAttachments
        }
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || "Erro na resposta do servidor.");
      }

      data = await response.json();

      if (data && data.analysis) {
        const fileNamesSummary = attachedFiles.length > 0
          ? `Anexos (${attachedFiles.length}): ${attachedFiles.map(f => f.name).join(", ")}`
          : "Edital em Texto";
        const analysisResult: EditalAnalysis = {
          ...data.analysis,
          rawText: textInput || fileNamesSummary
        };
        
        setActiveEdital(analysisResult);
        setOriginalEdital(analysisResult);
        setIsRefined(false);

        confetti({ particleCount: 100, spread: 70, origin: { y: 0.8 } });

        // Salvar no Histórico Local e no Supabase Privado
        const firstFileName = attachedFiles.length > 0 ? attachedFiles[0].name : null;
        const newHistoryItem = {
          id: Date.now().toString(),
          title: analysisResult.descricaoProduto 
            ? `Análise - ${analysisResult.descricaoProduto.slice(0, 45)}${analysisResult.descricaoProduto.length > 45 ? "..." : ""}` 
            : (firstFileName ? `Anexo: ${firstFileName}` : `Análise S/N`),
          date: new Date().toLocaleString("pt-BR"),
          analysis: analysisResult
        };

        saveEditalToSupabase(newHistoryItem).catch((e) => console.warn("Erro ao salvar edital no Supabase:", e));

        setHistory(prev => {
          const updated = [newHistoryItem, ...prev];
          localStorage.setItem("aip_edital_history", JSON.stringify(updated));
          return updated;
        });

        window.dispatchEvent(new Event("aip_edital_history_updated"));
        window.dispatchEvent(new CustomEvent("aip_edital_analyzed", { detail: newHistoryItem }));

        // Auto-sync log results dynamically to Google Sheets/Drive simulation!
        syncAnalysisToGoogleSheets(`Análise Edital - ${analysisResult.descricaoProduto.slice(0, 30)}`, analysisResult);
      } else {
        alert("Não foi possível processar a análise com formato estruturado.");
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Houve um problema ao processar a análise do edital com o Gemini. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  // Helper for dynamic filtering of points & documents based on selectedItemNumbers
  const getFilteredArray = (array: string[] | undefined) => {
    if (!array) return [];
    if (!activeEdital?.itensEdital || activeEdital.itensEdital.length <= 1) return array;
    if (selectedItemNumbers.length === activeEdital.itensEdital.length) return array;
    if (selectedItemNumbers.length === 0) return [];

    const unselectedNumbers = activeEdital.itensEdital
      .map(it => it.numero)
      .filter(num => !selectedItemNumbers.includes(num));

    return array.filter(text => {
      const mentionsUnselected = unselectedNumbers.some(num => {
        const regex = new RegExp(`\\b(item|lote|produto)\\s*0*${num}\\b`, 'i');
        return regex.test(text);
      });
      const mentionsSelected = selectedItemNumbers.some(num => {
        const regex = new RegExp(`\\b(item|lote|produto)\\s*0*${num}\\b`, 'i');
        return regex.test(text);
      });

      if (mentionsUnselected && !mentionsSelected) {
        return false; // hide points belonging only to unselected items
      }
      return true;
    });
  };

  const getDynamicDescricaoProduto = () => {
    if (!activeEdital) return "";
    if (!activeEdital.itensEdital || activeEdital.itensEdital.length <= 1) return activeEdital.descricaoProduto;
    if (selectedItemNumbers.length === activeEdital.itensEdital.length) return activeEdital.descricaoProduto;
    if (selectedItemNumbers.length === 0) return "Nenhum item selecionado para cotação.";

    const selected = activeEdital.itensEdital.filter(it => selectedItemNumbers.includes(it.numero));
    return `[Descrição Focada nos Itens Selecionados]\n` + selected.map(it => `• Item ${String(it.numero).padStart(2, '0')}: ${it.descricao} (Qtd: ${it.quantidade} ${it.unidade || "un"}${it.valorEstimado ? ` - Estimado: ${it.valorEstimado}` : ""})`).join("\n\n");
  };

  const parseCurrencyValue = (valStr?: string): number => {
    if (!valStr) return 0;
    const totalMatch = valStr.match(/total\s*:?\s*r\$\s*([0-9.]+,[0-9]{2})/i);
    if (totalMatch) {
      const cleaned = totalMatch[1].replace(/\./g, "").replace(",", ".");
      const n = parseFloat(cleaned);
      if (!isNaN(n)) return n;
    }

    const match = valStr.match(/([0-9.]+,[0-9]{2})/);
    if (match) {
      const cleaned = match[1].replace(/\./g, "").replace(",", ".");
      const n = parseFloat(cleaned);
      if (!isNaN(n)) return n;
    }

    const numOnly = valStr.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
    const n = parseFloat(numOnly);
    return isNaN(n) ? 0 : n;
  };

  const getSelectedItemsStats = () => {
    if (!activeEdital?.itensEdital || activeEdital.itensEdital.length === 0) {
      return {
        count: 0,
        totalEditalCount: 0,
        totalQuantity: 0,
        totalValorEstimado: 0,
        hasValidValues: false,
        formattedValorEstimado: activeEdital?.viabilidadeFinanceira?.valorEstimado || "Não informado"
      };
    }

    const totalEditalCount = activeEdital.itensEdital.length;
    const selected = activeEdital.itensEdital.filter(it => selectedItemNumbers.includes(it.numero));

    let totalQuantity = 0;
    let totalValorEstimado = 0;
    let hasValidValues = false;

    selected.forEach(it => {
      const qty = it.quantidade || 1;
      totalQuantity += qty;

      if (it.valorEstimado) {
        const val = parseCurrencyValue(it.valorEstimado);
        if (val > 0) {
          hasValidValues = true;
          const isTotalExplicit = /total|global/i.test(it.valorEstimado);
          if (isTotalExplicit) {
            totalValorEstimado += val;
          } else {
            totalValorEstimado += val * qty;
          }
        }
      }
    });

    let formattedValorEstimado = "R$ 0,00";
    if (hasValidValues && totalValorEstimado > 0) {
      formattedValorEstimado = totalValorEstimado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    } else if (selected.length === totalEditalCount && activeEdital?.viabilidadeFinanceira?.valorEstimado) {
      formattedValorEstimado = activeEdital.viabilidadeFinanceira.valorEstimado;
    } else if (selected.length === 0) {
      formattedValorEstimado = "R$ 0,00";
    } else {
      formattedValorEstimado = activeEdital?.viabilidadeFinanceira?.valorEstimado || "Consulte os itens";
    }

    return {
      count: selected.length,
      totalEditalCount,
      totalQuantity,
      totalValorEstimado,
      hasValidValues,
      formattedValorEstimado
    };
  };

  const handleRefineWithAi = async () => {
    if (!activeEdital) return;
    if (!textInput.trim() && attachedFiles.length === 0) {
      alert("Para realizar o refinamento avançado com IA, o edital precisa ter sido enviado/carregado nesta sessão ativa.");
      return;
    }

    setRefining(true);
    try {
      const selectedItemsObjects = activeEdital.itensEdital?.filter(it => selectedItemNumbers.includes(it.numero)) || [];
      const preparedAttachments = await prepareAttachmentsForServer(attachedFiles);

      const response = await apiFetch("/api/analyze-edital", {
        method: "POST",
        body: {
          textInput: textInput,
          attachments: preparedAttachments,
          selectedItems: selectedItemsObjects
        }
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || "Erro de processamento no refinamento.");
      }

      const data = await response.json();
      if (data && data.analysis) {
        const fileNamesSummary = attachedFiles.length > 0
          ? `Anexos (${attachedFiles.length}): ${attachedFiles.map(f => f.name).join(", ")}`
          : "Edital em Texto";
        const refinedResult: EditalAnalysis = {
          ...data.analysis,
          // Preserve full items list so we don't lock out the selection controls!
          itensEdital: activeEdital.itensEdital,
          rawText: textInput || fileNamesSummary
        };

        setActiveEdital(refinedResult);
        setIsRefined(true);
        confetti({ particleCount: 60, spread: 50 });
      } else {
        alert("Não foi possível processar o refinamento da análise.");
      }
    } catch (e: any) {
      console.error(e);
      alert("Erro ao refinar análise com Gemini: " + (e.message || e));
    } finally {
      setRefining(false);
    }
  };

  const handleRestoreFullAnalysis = () => {
    if (originalEdital) {
      setActiveEdital(originalEdital);
      setIsRefined(false);
      if (originalEdital.itensEdital) {
        setSelectedItemNumbers(originalEdital.itensEdital.map(it => it.numero));
      }
    }
  };

  // Document generators proxying to /api/generate-document
  const triggerDocumentGeneration = async (docType: "proposal" | "joint_declaration" | "custom_declaration") => {
    if (!activeEdital) {
      alert("Aviso: Para gerar um documento 100% qualificado, é altamento recomendado fazer a Análise Completa de Edital na caixa acima primeiro!");
    }

    setGeneratingDoc(docType);
    try {
      const response = await apiFetch("/api/generate-document", {
        method: "POST",
        body: {
          docType,
          analysisData: activeEdital,
          companyData: companyData,
          extraInstructions,
          uploadedTemplateText: docType === "custom_declaration" ? uploadedTemplateText : undefined
        }
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || "Erro de processamento do documento.");
      }

      const data = await response.json();
      if (data.markdown) {
        const docTitle = docType === "proposal" ? "Proposta Comercial de Licitação.md" : 
                         docType === "joint_declaration" ? "Declaração Conjunta Unificada.md" : 
                         "Declaração Customizada Editalícia.md";
        
        // Open modal
        onOpenDocPreview(docTitle, data.markdown, docType === "proposal" ? "proposal" : "declaration");
        
        // Save to Drive
        addSyncedItem(docTitle, docType === "proposal" ? "proposal" : "declaration", data.markdown);
      }
    } catch (err) {
      console.error(err);
      alert("Não foi possível gerar este documento de declaração automático. Tente novamente.");
    } finally {
      setGeneratingDoc(null);
    }
  };

  return (
    <div id="edital-analyzer-tab" className="space-y-6">
      
      {/* Upload and input form */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-xs p-5 md:p-6 relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="bg-[#EEF2FF] text-[#4F46E5] p-2 rounded-lg border border-[#C7D2FE]">
              <FileUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[#111827] text-base">Leitura Inteligente de Editais</h3>
              <p className="text-[#6B7280] text-xs leading-normal">Carregue arquivos em formato PDF, TXT ou cole partes relevantes para que a IA extraia obrigações</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeEdital && (
              <button
                onClick={() => {
                  setActiveEdital(null);
                  setTextInput("");
                  setAttachedFiles([]);
                }}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-md border border-rose-200 text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                Limpar Painel
              </button>
            )}
          </div>
        </div>

        {/* Drag and drop panel */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div 
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="border-2 border-dashed border-[#D1D5DB] hover:border-[#FF5A00] rounded-xl p-5 bg-[#F9FAFB] transition-all text-center relative"
            >
              <input 
                type="file" 
                id="edital-file-upload" 
                accept=".txt,.pdf"
                multiple
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
              />
              <FileUp className="w-8 h-8 text-[#FF5A00] mx-auto mb-2" />
              <p className="text-xs font-semibold text-[#111827]">Arraste seus anexos ou Clique para selecionar arquivos</p>
              <p className="text-[10px] text-[#6B7280] mt-1">Selecione 1 ou mais arquivos (PDF ou TXT) do edital e anexos (Max 60MB cada)</p>

              {attachedFiles.length > 0 && (
                <div className="mt-4 space-y-2 text-left relative z-10" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between text-xs font-semibold text-[#374151] border-b border-[#E5E7EB] pb-1.5">
                    <span className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-[#059669]" />
                      Anexos Prontos para Análise ({attachedFiles.length}):
                    </span>
                    <button 
                      type="button" 
                      onClick={() => setAttachedFiles([])}
                      className="text-[10px] text-rose-600 hover:underline cursor-pointer"
                    >
                      Remover todos
                    </button>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {attachedFiles.map((f) => (
                      <div key={f.id} className="bg-[#FFF0E5] border border-[#FFD6C2] rounded-lg p-2 flex items-center justify-between text-xs text-[#374151]">
                        <div className="flex items-center gap-2 truncate pr-2">
                          <FileText className="w-4 h-4 text-[#FF5A00] shrink-0" />
                          <span className="font-semibold truncate">{f.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-medium text-[#4B5563] text-[10px] bg-white px-1.5 py-0.5 rounded border border-[#E5E7EB]">
                            {f.size}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(f.id)}
                            className="text-[#6B7280] hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Remover anexo"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <span className="text-xs font-semibold text-[#6B7280]">Ou cole a íntegra ou partes do texto do edital:</span>
              <textarea 
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                className="w-full h-44 border border-[#D1D5DB] rounded-xl p-3 text-xs bg-white text-[#111827] focus:outline-hidden focus:ring-1 focus:ring-[#FF5A00] font-mono leading-relaxed"
                placeholder="Cole as seções do edital sobre objeto, prazo, contraprestação e documentos de habilitação..."
              />
            </div>

            <button
              id="trigger-analyze-btn"
              onClick={handleAnalyze}
              disabled={loading || (!textInput.trim() && attachedFiles.length === 0)}
              className="w-full bg-[#FF5A00] hover:bg-[#E65000] disabled:bg-[#F3F4F6] disabled:text-[#9CA3AF] text-white font-bold py-2.5 rounded-lg text-sm transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Mapeando Cláusulas do Edital com o Gemini...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Mapear e Analisar Edital agora
                </>
              )}
            </button>
          </div>

          {/* Column 2: Info & History */}
          <div className="space-y-4">
            {/* Histórico Local de Editais */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 md:p-5 space-y-3 text-xs shadow-xs">
              <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-2">
                <h4 className="font-bold text-[#111827] flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-[#FF5A00]" />
                  Histórico Local de Editais
                </h4>
                {history.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    {showConfirmClearHistory ? (
                      <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-right-1 duration-150">
                        <button
                          onClick={() => {
                            // Delete all from Supabase
                            history.forEach(item => {
                              deleteEditalFromSupabase(item.id).catch(() => {});
                            });
                            setHistory([]);
                            localStorage.removeItem("aip_edital_history");
                            window.dispatchEvent(new Event("aip_edital_history_updated"));
                            setActiveEdital(null);
                            setShowConfirmClearHistory(false);
                          }}
                          className="text-[10px] text-[#059669] hover:text-[#047857] font-bold bg-[#ECFDF5] px-2 py-0.5 rounded border border-[#A7F3D0] transition-all cursor-pointer"
                        >
                          Sim, apagar tudo!
                        </button>
                        <button
                          onClick={() => setShowConfirmClearHistory(false)}
                          className="text-[10px] text-[#6B7280] hover:text-[#111827] bg-[#F3F4F6] px-2 py-0.5 rounded border border-[#E5E7EB] transition-all cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setShowConfirmClearHistory(true);
                        }}
                        className="text-[10px] text-rose-600 hover:text-rose-700 font-bold tracking-tight bg-rose-50 px-2 py-0.5 rounded border border-rose-200 transition-all cursor-pointer"
                      >
                        Apagar Tudo
                      </button>
                    )}
                  </div>
                )}
              </div>

              {history.length === 0 ? (
                <p className="text-[#9CA3AF] text-center py-4 text-[11px]">Nenhuma análise armazenada no Supabase ainda.</p>
              ) : (
                <div className="space-y-2 max-h-[170px] overflow-y-auto pr-1">
                  {history.map((item) => {
                    const isSelected = activeEdital && activeEdital.descricaoProduto === item.analysis.descricaoProduto;
                    return (
                      <div 
                        key={item.id}
                        className={`flex items-center justify-between p-2.5 rounded-lg border text-[11px] transition duration-150 ${
                          isSelected
                            ? "bg-[#EEF2FF] border-[#818CF8] text-[#111827] shadow-xs"
                            : "bg-[#F9FAFB] border-[#E5E7EB] hover:border-[#D1D5DB] text-[#374151] hover:text-[#111827]"
                        }`}
                      >
                        <button
                          onClick={() => {
                            setActiveEdital(item.analysis);
                            setOriginalEdital(item.analysis);
                            setIsRefined(false);
                            if (item.analysis.rawText) {
                              if (item.analysis.rawText.startsWith("Arquivo: ") || item.analysis.rawText.startsWith("Anexos")) {
                                setTextInput("");
                              } else {
                                setTextInput(item.analysis.rawText);
                              }
                            }
                          }}
                          className="flex-1 text-left truncate mr-2 font-medium cursor-pointer animate-fade-in"
                          title="Clique para carregar esta análise"
                        >
                          <div className="font-semibold truncate leading-tight">{item.title}</div>
                          <div className="text-[9px] text-[#6B7280] flex items-center gap-1 mt-1 font-mono">
                            <Clock className="w-2.5 h-2.5 shrink-0" />
                            {item.date}
                          </div>
                        </button>
                        
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // Delete from Supabase
                            deleteEditalFromSupabase(item.id).catch(() => {});
                            const updated = history.filter((h: any) => h.id !== item.id);
                            setHistory(updated);
                            localStorage.setItem("aip_edital_history", JSON.stringify(updated));
                            window.dispatchEvent(new Event("aip_edital_history_updated"));
                            if (isSelected) {
                              setActiveEdital(null);
                              setTextInput("");
                              setAttachedFiles([]);
                            }
                          }}
                          className="text-[#6B7280] hover:text-rose-600 p-1 bg-white hover:bg-rose-50 rounded transition-colors cursor-pointer shrink-0 ml-1 border border-[#E5E7EB] hover:border-rose-200"
                          title="Apagar análise do histórico"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] p-8 text-center space-y-3">
          <Loader2 className="w-10 h-10 text-[#FF5A00] animate-spin mx-auto" />
          <p className="text-[#111827] font-semibold text-sm">Decifrando escopo de contratação pública...</p>
          <p className="text-[#6B7280] text-xs">Isso pode levar de 5 a 15 segundos dependendo do tamanho das cláusulas fornecidas.</p>
        </div>
      )}

      {/* Analysis Results Display */}
      {activeEdital && !loading && (() => {
        const selectedStats = getSelectedItemsStats();
        return (
        <div className="space-y-6 animate-fade-in" id="analysis-results-section">
          
          {/* Executive Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            
            <div className="bg-white border border-[#E5E7EB] text-[#111827] p-5 rounded-xl shadow-xs space-y-2 max-h-[160px] overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#6B7280] font-bold uppercase tracking-wider block">Descrição do Objeto</span>
                <span className="text-[10px] font-bold text-[#FF5A00] bg-[#FFF0E5] px-2 py-0.5 rounded border border-[#FFD6C2] shrink-0">
                  {selectedStats.count} de {selectedStats.totalEditalCount} itens
                </span>
              </div>
              <p className="font-semibold text-[#111827] text-xs md:text-sm leading-snug whitespace-pre-line">
                {getDynamicDescricaoProduto()}
              </p>
            </div>

            {/* Dynamic Financial Summary Card based on Selected Items */}
            <div className="bg-white border border-[#E5E7EB] p-5 rounded-xl space-y-1.5 text-[#111827] shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#6B7280] font-bold uppercase tracking-wider block">Valor Estimado Selecionado</span>
                <Coins className="w-4 h-4 text-[#FF5A00] shrink-0" />
              </div>
              <div className="mt-1">
                <p className="font-bold text-[#FF5A00] text-base md:text-lg font-mono tracking-tight leading-tight">
                  {selectedStats.formattedValorEstimado}
                </p>
                <p className="text-[11px] text-[#6B7280] font-medium mt-1">
                  {selectedStats.count > 0 
                    ? `${selectedStats.count} ${selectedStats.count === 1 ? 'item marcado' : 'itens marcados'} (${selectedStats.totalQuantity} un)` 
                    : "Nenhum item selecionado"}
                </p>
              </div>
            </div>

            <div className="bg-white border border-[#E5E7EB] p-5 rounded-xl space-y-1.5 text-[#111827] shadow-xs">
              <span className="text-[10px] text-[#6B7280] font-bold uppercase tracking-wider block">Prazo de Entrega ao Governo</span>
              <div className="flex items-center gap-2 mt-1">
                <Clock className="w-5 h-5 text-[#059669] shrink-0" />
                <p className="font-bold text-[#111827] text-sm md:text-base leading-snug">
                  {activeEdital.prazoEntrega}
                </p>
              </div>
            </div>

            <div className="bg-white border border-[#E5E7EB] p-5 rounded-xl space-y-1.5 text-[#111827] shadow-xs">
              <span className="text-[10px] text-[#6B7280] font-bold uppercase tracking-wider block">Condição de Pagamento</span>
              <div className="flex items-center gap-2 mt-1">
                <Coins className="w-5 h-5 text-[#FF5A00] shrink-0" />
                <p className="font-bold text-[#111827] text-sm md:text-base leading-snug">
                  {activeEdital.prazoPagamento}
                </p>
              </div>
            </div>

          </div>

          {/* Mapping of Items / Lotes - Modern Minimalist Selector */}
          {activeEdital.itensEdital && activeEdital.itensEdital.length > 0 && (
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 md:p-5 space-y-4 animate-fade-in shadow-xs">
              
              {/* Header Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E7EB] pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="bg-[#FFF0E5] text-[#FF5A00] p-2 rounded-lg border border-[#FFD6C2] shrink-0">
                    <CheckSquare className="w-4 h-4 md:w-5 md:h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-[#111827] text-sm md:text-base">Itens e Lotes do Certame</h4>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF0E5] text-[#FF5A00] border border-[#FFD6C2]">
                        {selectedItemNumbers.length} de {activeEdital.itensEdital.length} selecionados
                      </span>
                    </div>
                    <p className="text-[#6B7280] text-xs mt-0.5">
                      Selecione os itens desejados para cotar ou gerar a proposta automática.
                    </p>
                  </div>
                </div>

                {/* Quick Actions & View Switcher */}
                <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
                  {/* Search input for 5+ items */}
                  {activeEdital.itensEdital.length >= 5 && (
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={itemSearchQuery}
                        onChange={(e) => setItemSearchQuery(e.target.value)}
                        placeholder="Buscar item..."
                        className="bg-white border border-[#D1D5DB] rounded-lg pl-8 pr-2.5 py-1 text-xs text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] w-28 md:w-36 transition-all"
                      />
                    </div>
                  )}

                  <div className="flex items-center bg-[#F9FAFB] p-0.5 rounded-lg border border-[#E5E7EB]">
                    <button
                      type="button"
                      onClick={() => setItemSelectorViewMode("compact")}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                        itemSelectorViewMode === "compact"
                          ? "bg-[#FF5A00] text-white shadow-xs"
                          : "text-[#6B7280] hover:text-[#111827]"
                      }`}
                      title="Visão Compacta (Pills/Chips)"
                    >
                      <LayoutGrid className="w-3 h-3" />
                      <span className="hidden md:inline">Compacto</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setItemSelectorViewMode("detailed")}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                        itemSelectorViewMode === "detailed"
                          ? "bg-[#FF5A00] text-white shadow-xs"
                          : "text-[#6B7280] hover:text-[#111827]"
                      }`}
                      title="Visão Detalhada (Lista)"
                    >
                      <List className="w-3 h-3" />
                      <span className="hidden md:inline">Lista</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1 border-l border-[#E5E7EB] pl-2">
                    <button
                      type="button"
                      onClick={() => setSelectedItemNumbers(activeEdital.itensEdital?.map(it => it.numero) || [])}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-[#E5E7EB] text-[#374151] hover:text-[#111827] bg-[#F9FAFB] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedItemNumbers([])}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-[#E5E7EB] text-[#374151] hover:text-[#111827] bg-[#F9FAFB] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                    >
                      Nenhum
                    </button>
                  </div>
                </div>
              </div>

              {/* Filtering items if searchQuery is present */}
              {(() => {
                const filteredItens = activeEdital.itensEdital.filter(it => {
                  if (!itemSearchQuery.trim()) return true;
                  const q = itemSearchQuery.toLowerCase();
                  return (
                    `item ${it.numero}`.includes(q) ||
                    String(it.numero).includes(q) ||
                    it.descricao.toLowerCase().includes(q) ||
                    (it.valorEstimado && it.valorEstimado.toLowerCase().includes(q))
                  );
                });

                if (filteredItens.length === 0) {
                  return (
                    <div className="py-6 text-center text-xs text-[#6B7280] bg-[#F9FAFB] rounded-xl border border-[#E5E7EB]">
                      Nenhum item encontrado para "{itemSearchQuery}".
                    </div>
                  );
                }

                if (itemSelectorViewMode === "compact") {
                  const currentHoveredItem = activeEdital.itensEdital.find(it => it.numero === hoveredItemNumber);
                  return (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2 max-h-[220px] overflow-y-auto pr-1">
                        {filteredItens.map((it) => {
                          const isSelected = selectedItemNumbers.includes(it.numero);
                          return (
                            <button
                              key={it.numero}
                              type="button"
                              onMouseEnter={() => setHoveredItemNumber(it.numero)}
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedItemNumbers(selectedItemNumbers.filter(n => n !== it.numero));
                                } else {
                                  setSelectedItemNumbers([...selectedItemNumbers, it.numero]);
                                }
                              }}
                              className={`group px-3 py-1.5 rounded-xl border text-xs font-medium transition-all duration-150 flex items-center gap-2 cursor-pointer select-none text-left ${
                                isSelected
                                  ? "bg-[#FFF0E5] border-[#FFD6C2] text-[#111827] shadow-xs hover:bg-[#FFE5D4]"
                                  : "bg-[#F9FAFB] border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB] hover:text-[#111827] hover:bg-[#F3F4F6]"
                              }`}
                            >
                              <div className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border ${
                                isSelected
                                  ? "bg-[#FF5A00] border-[#E65000] text-white"
                                  : "border-[#D1D5DB] bg-white group-hover:border-[#9CA3AF]"
                              }`}>
                                {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                              </div>

                              <span className={`font-bold ${isSelected ? "text-[#FF5A00]" : "text-[#374151]"}`}>
                                Item {String(it.numero).padStart(2, '0')}
                              </span>

                              <span className="text-[#6B7280] max-w-[140px] md:max-w-[180px] truncate">
                                {it.descricao}
                              </span>

                              {it.valorEstimado && (
                                <span className={`text-[11px] font-mono font-semibold ml-1 ${isSelected ? "text-[#059669]" : "text-[#6B7280]"}`}>
                                  {it.valorEstimado}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Dynamic Detail Card on Hover */}
                      {currentHoveredItem && (
                        <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-3 text-xs space-y-1 animate-fade-in">
                          <div className="flex items-center justify-between text-[#FF5A00] font-bold">
                            <span>Item {String(currentHoveredItem.numero).padStart(2, '0')} &bull; Qtd: {currentHoveredItem.quantidade} {currentHoveredItem.unidade || "un"}</span>
                            {currentHoveredItem.valorEstimado && <span className="text-[#059669] font-mono">{currentHoveredItem.valorEstimado}</span>}
                          </div>
                          <p className="text-[#374151] text-[11px] leading-relaxed">
                            {currentHoveredItem.descricao}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                }

                {/* Detailed View Mode (Ultra-clean Table/List) */}
                return (
                  <div className="divide-y divide-[#E5E7EB] border border-[#E5E7EB] rounded-xl overflow-hidden bg-white">
                    {filteredItens.map((it) => {
                      const isSelected = selectedItemNumbers.includes(it.numero);
                      return (
                        <div
                          key={it.numero}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedItemNumbers(selectedItemNumbers.filter(n => n !== it.numero));
                            } else {
                              setSelectedItemNumbers([...selectedItemNumbers, it.numero]);
                            }
                          }}
                          className={`p-3 transition-colors cursor-pointer flex items-center gap-3 select-none ${
                            isSelected ? "bg-[#FFF0E5] hover:bg-[#FFE5D4]" : "hover:bg-[#F9FAFB]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="rounded border-[#D1D5DB] text-[#FF5A00] focus:ring-0 focus:ring-offset-0 w-4 h-4 cursor-pointer"
                          />
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                            isSelected ? "bg-[#FFF0E5] text-[#FF5A00] border border-[#FFD6C2]" : "bg-[#F3F4F6] text-[#6B7280]"
                          }`}>
                            Item {String(it.numero).padStart(2, '0')}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-[#111827] truncate" title={it.descricao}>
                              {it.descricao}
                            </p>
                          </div>
                          <span className="text-[11px] text-[#6B7280] shrink-0 font-mono">
                            Qtd: <strong className="text-[#111827]">{it.quantidade}</strong> {it.unidade || "un"}
                          </span>
                          {it.valorEstimado && (
                            <span className="text-xs font-mono font-semibold text-[#059669] shrink-0 ml-2">
                              {it.valorEstimado}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Bottom Action / Summary Bar */}
              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-2.5 text-[#374151]">
                  <Sparkles className="w-4 h-4 text-[#FF5A00] shrink-0" />
                  <span>
                    <strong className="text-[#111827] font-semibold">{selectedStats.count}</strong> de <strong className="text-[#111827]">{selectedStats.totalEditalCount}</strong> itens selecionados.
                  </span>
                  <span className="hidden sm:inline text-[#D1D5DB]">|</span>
                  <span className="bg-[#FFF0E5] text-[#FF5A00] px-2 py-0.5 rounded border border-[#FFD6C2] font-mono font-semibold">
                    Valor Estimado: {selectedStats.formattedValorEstimado}
                  </span>
                  <span className="bg-[#FFF0E5] text-[#FF5A00] px-2 py-0.5 rounded border border-[#FFD6C2] font-mono font-semibold">
                    Qtd Total: {selectedStats.totalQuantity} un
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isRefined ? (
                    <>
                      <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded border border-amber-200 font-bold text-[10px] uppercase">
                        Foco Refinado por IA
                      </span>
                      <button
                        type="button"
                        onClick={handleRestoreFullAnalysis}
                        className="px-3 py-1.5 font-bold text-xs bg-white hover:bg-[#F3F4F6] text-[#111827] border border-[#D1D5DB] rounded-lg cursor-pointer transition-colors flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Ver Edital Completo
                      </button>
                    </>
                  ) : (
                    selectedItemNumbers.length > 0 && selectedItemNumbers.length < activeEdital.itensEdital.length && (
                      <button
                        type="button"
                        onClick={handleRefineWithAi}
                        disabled={refining}
                        className="px-3 py-1.5 font-bold text-xs bg-[#FF5A00] hover:bg-[#E65000] text-white rounded-lg shadow-xs cursor-pointer transition-all flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {refining ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Refinando Foco...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            Refinar Foco (Gemini IA)
                          </>
                        )}
                      </button>
                    )
                  )}
                </div>
              </div>

            </div>
          )}

          {/* Tab Selector Menu for Sub-Information Panels */}
          <div className="flex border-b border-[#E5E7EB] gap-2 overflow-x-auto pb-px">
            <button
              onClick={() => setAnalysisActiveTab("report")}
              className={`pb-3 text-xs md:text-sm font-semibold border-b-2 px-1.5 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                analysisActiveTab === "report"
                  ? "border-[#FF5A00] text-[#FF5A00] font-bold"
                  : "border-transparent text-[#6B7280] hover:text-[#111827]"
              }`}
            >
              <Sparkles className="w-4 h-4 text-[#FF5A00]" />
              Parecer Executivo
            </button>
            <button
              onClick={() => setAnalysisActiveTab("struc")}
              className={`pb-3 text-xs md:text-sm font-semibold border-b-2 px-1.5 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                analysisActiveTab === "struc"
                  ? "border-[#FF5A00] text-[#FF5A00] font-bold"
                  : "border-transparent text-[#6B7280] hover:text-[#111827]"
              }`}
            >
              <Gauge className="w-4 h-4 text-[#059669]" />
              Dossiê Estruturado por Tópicos
            </button>
            <button
              onClick={() => setAnalysisActiveTab("checklist")}
              className={`pb-3 text-xs md:text-sm font-semibold border-b-2 px-1.5 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                analysisActiveTab === "checklist"
                  ? "border-[#FF5A00] text-[#FF5A00] font-bold"
                  : "border-transparent text-[#6B7280] hover:text-[#111827]"
              }`}
            >
              <CheckSquare className="w-4 h-4 text-[#2563EB]" />
              Checklist & Alertas Rápidos
            </button>
          </div>

          {/* TAB 1: EXECUTIVE BRIEFING (MARKDOWN REPORT) */}
          {analysisActiveTab === "report" && (
            <div className="space-y-6 animate-fade-in">
              {/* Main Executive Report Card */}
              <div className="bg-white dark:bg-[#121212] p-6 md:p-8 rounded-xl border border-[#E5E7EB] dark:border-[#27272A] shadow-xs space-y-6 relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-[#E5E7EB] dark:border-[#27272A] pb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-[#FF5A00]" />
                    <h3 className="text-sm md:text-base font-bold text-[#111827] dark:text-zinc-100 tracking-tight">
                      Parecer Executivo de Estratégia de Mercado
                    </h3>
                  </div>
                  <span className="font-mono text-[9px] text-[#FF5A00] font-bold uppercase tracking-widest hidden sm:block bg-[#FFF0E5] dark:bg-[#2A170A] px-2.5 py-1 rounded">
                    Senior Market Strategy Report
                  </span>
                </div>

                {/* Prominent Quick Action Bar for Dispute Date & PNCP Link */}
                {activeEdital && (
                  <div className="bg-[#FFF0E5] dark:bg-[#2A170A]/60 border border-[#FF5A00]/30 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-start sm:items-center gap-3">
                      <div className="p-2.5 bg-[#FF5A00] text-white rounded-lg shadow-2xs shrink-0 mt-0.5 sm:mt-0">
                        <Calendar className="w-5 h-5" />
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[#6B7280] dark:text-zinc-400 font-bold block">
                          Data e Hora Oficial da Disputa / Sessão Pública
                        </span>
                        <span className="text-xs sm:text-sm font-extrabold text-[#111827] dark:text-zinc-100 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-[#FF5A00]" />
                          {getDataHoraDisputa(activeEdital)}
                        </span>
                      </div>
                    </div>

                    {getPncpLink(activeEdital) && (
                      <a
                        href={getPncpLink(activeEdital)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#FF5A00] hover:bg-[#E65000] text-white text-xs font-bold rounded-lg transition-all shadow-2xs hover:shadow-xs shrink-0 cursor-pointer"
                      >
                        <Globe className="w-4 h-4" />
                        <span>Acessar Licitação no Portal PNCP</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                )}

                {activeEdital.reportMarkdown ? (
                  <div className="prose max-w-none text-[#111827] dark:text-zinc-200 text-xs md:text-sm leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                      h1: ({node, ...props}) => <h1 className="text-sm md:text-base font-bold text-[#111827] dark:text-zinc-100 border-b border-[#E5E7EB] dark:border-[#27272A] pb-2 mt-6 mb-3 flex items-center gap-2 uppercase tracking-wide text-[#FF5A00]" {...props} />,
                      h2: ({node, ...props}) => <h2 className="text-xs md:text-sm font-bold text-[#111827] dark:text-zinc-100 mt-5 mb-2.5 border-b border-[#E5E7EB] dark:border-[#27272A] pb-1 flex items-center gap-2" {...props} />,
                      h3: ({node, ...props}) => <h3 className="text-xs md:text-sm font-bold text-[#FF5A00] mt-4 mb-2" {...props} />,
                      p: ({node, ...props}) => <p className="mb-3.5 text-[#111827] dark:text-zinc-200 leading-relaxed font-sans text-xs md:text-sm font-medium" {...props} />,
                      ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 space-y-2 text-[#111827] dark:text-zinc-200 font-sans text-xs md:text-sm font-medium" {...props} />,
                      ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-4 space-y-2 text-[#111827] dark:text-zinc-200 font-sans text-xs md:text-sm font-medium" {...props} />,
                      li: ({node, ...props}) => <li className="leading-relaxed text-[#111827] dark:text-zinc-200" {...props} />,
                      hr: ({node, ...props}) => <hr className="border-t border-[#E5E7EB] dark:border-[#27272A] my-6" {...props} />,
                      blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-[#FF5A00] pl-4 py-2 my-4 bg-[#FFF0E5] dark:bg-[#2A170A]/40 rounded-r-lg text-xs md:text-sm text-[#111827] dark:text-zinc-200 italic font-medium" {...props} />,
                      table: ({node, ...props}) => (
                        <div className="overflow-x-auto my-4 rounded-xl border border-[#E5E7EB] dark:border-[#27272A] bg-white dark:bg-[#121212]">
                          <table className="w-full text-left border-collapse text-[11px] md:text-xs" {...props} />
                        </div>
                      ),
                      thead: ({node, ...props}) => <thead className="bg-gray-100 dark:bg-[#18181B] border-b border-[#E5E7EB] dark:border-[#27272A] text-[#111827] dark:text-zinc-100 font-bold" {...props} />,
                      th: ({node, ...props}) => <th className="p-2.5 font-bold text-[10px] uppercase tracking-wider text-[#111827] dark:text-zinc-300" {...props} />,
                      tbody: ({node, ...props}) => <tbody className="divide-y divide-[#E5E7EB] dark:divide-[#27272A]" {...props} />,
                      td: ({node, ...props}) => <td className="p-2.5 text-[#111827] dark:text-zinc-200 font-sans leading-normal" {...props} />,
                      strong: ({node, ...props}) => <strong className="font-extrabold text-[#111827] dark:text-white" {...props} />,
                    }}>{cleanMarkdownText(activeEdital.reportMarkdown)}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="text-center py-10 space-y-2">
                    <div className="bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 p-3 rounded-full w-12 h-12 flex items-center justify-center mx-auto border border-amber-200 dark:border-amber-900">
                      <ShieldAlert className="w-6 h-6" />
                    </div>
                    <h5 className="font-bold text-[#111827] dark:text-zinc-100 text-sm">Parecer Executivo Indisponível</h5>
                    <p className="text-[#6B7280] dark:text-zinc-400 text-xs max-w-sm mx-auto leading-normal">
                      Este item do histórico não possui o parecer executivo formatado. Faça uma nova análise para visualizar o parecer executivo completo.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: DETAILED STRATEGIC PILLARS */}
          {analysisActiveTab === "struc" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in text-[#374151]">
              
              {/* Pillar 1: IDENTIFICATION */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-2">
                  <Landmark className="w-4 h-4 text-[#FF5A00] shrink-0" />
                  <h4 className="font-bold text-[#111827] text-xs uppercase tracking-wide">1. Identificação do Certame</h4>
                </div>
                {activeEdital.identificacaoCertame ? (
                  <div className="text-xs space-y-3 leading-normal">
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Órgão Comprador / Unidade Gestora</span>
                      <span className="text-[#111827] font-semibold">{activeEdital.identificacaoCertame.orgaoComprador}</span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Modalidade do Processo</span>
                      <span className="text-[#111827] font-semibold">{activeEdital.identificacaoCertame.modalidade}</span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Identificação Numérica / PCE</span>
                      <span className="text-[#111827] font-semibold">{activeEdital.identificacaoCertame.identificacaoNumerica}</span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Sessão Pública (Data/Hora/Fuso)</span>
                      <span className="text-[#111827] font-extrabold flex items-center gap-1.5 mt-0.5 text-[#FF5A00]">
                        <Calendar className="w-3.5 h-3.5" />
                        {getDataHoraDisputa(activeEdital)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Link Direto no Portal PNCP</span>
                      {getPncpLink(activeEdital) ? (
                        <a
                          href={getPncpLink(activeEdital)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#FF5A00] font-bold hover:text-[#E65000] hover:underline flex items-center gap-1 mt-0.5"
                        >
                          <Globe className="w-3.5 h-3.5 shrink-0" />
                          <span>Acessar Licitação no PNCP</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-[#9CA3AF]">Não informado</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-[#9CA3AF] text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 2: TECHNICAL SPECIFICATIONS & SNARES */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-2">
                  <Gauge className="w-4 h-4 text-amber-600 shrink-0" />
                  <h4 className="font-bold text-[#111827] text-xs uppercase tracking-wide">2. Especificações Técnicas & Pegadinhas</h4>
                </div>
                {activeEdital.especificacoesTecnicas ? (
                  <div className="text-xs space-y-4 pb-1">
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider mb-1.5">Exigências Físicas do Produto (Checklist Mandatório)</span>
                      <ul className="list-disc pl-4 space-y-1 text-[#374151]">
                        {getFilteredArray(activeEdital.especificacoesTecnicas.exigenciasFisicas).map((item, idx) => (
                          <li key={idx} className="leading-snug">{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <span className="text-amber-700 block font-mono text-[9px] uppercase tracking-wider mb-1.5 font-bold">Pegadinhas Técnicas Ocultas / Risco de Desclassificação</span>
                      <ul className="list-disc pl-4 space-y-1 text-[#374151]">
                        {getFilteredArray(activeEdital.especificacoesTecnicas.pegadinhasOcultas).map((item, idx) => (
                          <li key={idx} className="leading-snug">{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <p className="text-[#9CA3AF] text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 3: BUREAUCRACY & ENTRY BARRIERS */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-2">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                  <h4 className="font-bold text-[#111827] text-xs uppercase tracking-wide">3. Burocracia & Barreiras de Entrada</h4>
                </div>
                {activeEdital.burocraciaBarreiras ? (
                  <div className="text-xs space-y-3 leading-normal">
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Amostra Exigida?</span>
                      <span className="text-[#111827] font-semibold">{activeEdital.burocraciaBarreiras.exigeAmostra}</span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Carta de Solidariedade/Exclusividade?</span>
                      <span className="text-[#111827] font-semibold">{activeEdital.burocraciaBarreiras.exigeCartaSolidariedade}</span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Garantia de Proposta ou Contratual?</span>
                      <span className="text-[#111827] font-semibold">{activeEdital.burocraciaBarreiras.exigenciaGarantia}</span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Consórcios ou Subcontratações?</span>
                      <span className="text-[#111827] font-semibold">{activeEdital.burocraciaBarreiras.consorcioSubcontratacao}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[#9CA3AF] text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 4: LOGISTICS & RISK ANALYSIS */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-2">
                  <MapPin className="w-4 h-4 text-[#059669] shrink-0" />
                  <h4 className="font-bold text-[#111827] text-xs uppercase tracking-wide">4. Logística, Cronograma & Prazo</h4>
                </div>
                {activeEdital.logisticaCronograma ? (
                  <div className="text-xs space-y-3 leading-normal">
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Prazo Real de Entrega</span>
                      <span className="text-[#111827] font-semibold flex items-center gap-2">
                        {activeEdital.logisticaCronograma.prazoEntregaReal}
                        <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${
                          activeEdital.logisticaCronograma.classificacaoPrazo.toLowerCase().includes("crít") || 
                          activeEdital.logisticaCronograma.classificacaoPrazo.toLowerCase().includes("relâ")
                            ? "bg-rose-50 text-rose-700 border border-rose-200" 
                            : activeEdital.logisticaCronograma.classificacaoPrazo.toLowerCase().includes("aceit")
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        }`}>
                          {activeEdital.logisticaCronograma.classificacaoPrazo}
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Endereço Exato & Almoxarifado</span>
                      <span className="text-[#111827] font-semibold">{activeEdital.logisticaCronograma.enderecoEntrega}</span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Prazo de Garantia Requerido</span>
                      <span className="text-[#111827] font-semibold">{activeEdital.logisticaCronograma.prazoGarantia}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[#9CA3AF] text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 5: FINANCIAL VIABILITY */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 border-b border-[#E5E7EB] pb-2">
                  <Coins className="w-4 h-4 text-[#FF5A00] shrink-0" />
                  <h4 className="font-bold text-[#111827] text-xs uppercase tracking-wide">5. Viabilidade Financeira & Margem</h4>
                </div>
                {activeEdital.viabilidadeFinanceira ? (
                  <div className="text-xs space-y-3 leading-normal">
                    {activeEdital.itensEdital && activeEdital.itensEdital.length > 0 && (
                      <div className="bg-[#FFF0E5] border border-[#FFD6C2] p-2.5 rounded-lg text-[#FF5A00]">
                        <span className="text-[#FF5A00] block font-mono text-[9px] uppercase tracking-wider font-bold">Valor Estimado (Itens Selecionados)</span>
                        <span className="text-[#111827] font-mono font-bold text-sm block mt-0.5">
                          {selectedStats.formattedValorEstimado}
                        </span>
                        <span className="text-[10px] text-[#6B7280] block mt-0.5">
                          Referente a {selectedStats.count} de {selectedStats.totalEditalCount} itens ({selectedStats.totalQuantity} un)
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Valor Estimado Global (Edital Completo)</span>
                      <span className="text-[#111827] font-semibold">{activeEdital.viabilidadeFinanceira.valorEstimado}</span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Distorções Identificadas vs Mercado Privado</span>
                      <span className="text-[#111827] font-semibold">{activeEdital.viabilidadeFinanceira.distorcoesPreco}</span>
                    </div>
                    <div>
                      <span className="text-[#6B7280] block font-mono text-[9px] uppercase tracking-wider">Prazo de Recebimento de Pagamento</span>
                      <span className="text-[#111827] font-semibold">{activeEdital.viabilidadeFinanceira.prazoPagamento}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[#9CA3AF] text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 6: CONCLUDING RECOMMENDATION */}
              <div className="bg-[#FFF0E5] border border-[#FFD6C2] rounded-xl p-5 space-y-3 lg:col-span-2 shadow-xs">
                <div className="flex items-center gap-2 border-b border-[#FFD6C2] pb-2">
                  <TrendingUp className="w-4 h-4 text-[#FF5A00] shrink-0" />
                  <h4 className="font-bold text-[#111827] text-xs uppercase tracking-wide">6. Parecer Final do Analista & Estratégia de Lances</h4>
                </div>
                {activeEdital.parecerFinal ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs leading-normal">
                    <div>
                      <span className="text-[#FF5A00] block font-mono text-[9px] uppercase tracking-wider font-bold">Veredito Final</span>
                      <span className="text-[#111827] font-bold bg-white px-2 py-1 rounded inline-block border border-[#FFD6C2] mt-1">{activeEdital.parecerFinal.veredito}</span>
                    </div>
                    <div>
                      <span className="text-[#FF5A00] block font-mono text-[9px] uppercase tracking-wider font-bold">Grau de Risco Global</span>
                      <span className={`px-2 py-1 rounded font-bold uppercase inline-block border mt-1 ${
                        activeEdital.parecerFinal.grauRisco.toLowerCase().includes("alto") 
                          ? "bg-rose-50 text-rose-700 border-rose-200" 
                          : activeEdital.parecerFinal.grauRisco.toLowerCase().includes("médio")
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      }`}>{activeEdital.parecerFinal.grauRisco}</span>
                    </div>
                    <div>
                      <span className="text-[#FF5A00] block font-mono text-[9px] uppercase tracking-wider font-bold">Estratégia Recomendada de Lances</span>
                      <span className="text-[#374151] block font-semibold mt-1 leading-snug">{activeEdital.parecerFinal.estrategiaLances}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[#9CA3AF] text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

            </div>
          )}

          {/* TAB 3: CHECKLIST & INSTANT ALERTS */}
          {analysisActiveTab === "checklist" && (
            <div className="space-y-6 animate-fade-in">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Opportunities (Oportunidades ou Pontos positivos) */}
                <div className="bg-white border border-[#E5E7EB] dark:bg-[#121212] dark:border-[#27272A] rounded-xl p-5 space-y-4 shadow-xs">
                  <h4 className="font-bold text-[#111827] dark:text-zinc-100 flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-[#059669] dark:text-emerald-400 shrink-0" />
                    Pontos Positivos / Vantagens Competitivas
                  </h4>
                  <ul className="space-y-3 pl-1 text-xs text-[#374151] dark:text-zinc-300 select-none">
                    {getFilteredArray(activeEdital.pontosPositivos).map((item, idx) => (
                      <li key={idx} className="flex gap-2.5 items-start">
                        <span className="bg-[#ECFDF5] border border-[#A7F3D0] text-[#059669] dark:bg-emerald-950/50 dark:border-emerald-800/60 dark:text-emerald-400 h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Warnings (Riscos ou Pegadinhas de Alerta) */}
                <div className="bg-white border border-[#E5E7EB] dark:bg-[#121212] dark:border-[#27272A] rounded-xl p-5 space-y-4 shadow-xs">
                  <h4 className="font-bold text-[#111827] dark:text-zinc-100 flex items-center gap-2 text-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    Pontos de Alerta / Atenção e Riscos
                  </h4>
                  <ul className="space-y-3 pl-1 text-xs text-[#374151] dark:text-zinc-300 select-none">
                    {getFilteredArray(activeEdital.pontosAlerta).map((item, idx) => (
                      <li key={idx} className="flex gap-2.5 items-start">
                        <span className="bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-950/50 dark:border-amber-800/60 dark:text-amber-400 h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Habilitation Documents checklist */}
                <div className="lg:col-span-2 bg-white border border-[#E5E7EB] dark:bg-[#121212] dark:border-[#27272A] rounded-xl p-5 space-y-4 shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E7EB] dark:border-[#27272A] pb-3">
                    <div className="flex items-center gap-2">
                      <CheckSquare className="w-4 h-4 text-[#FF5A00] shrink-0" />
                      <h4 className="font-bold text-[#111827] dark:text-zinc-100 text-sm">
                        Certidões e Documentos Exigidos na Disputa
                      </h4>
                    </div>
                    <span className="text-xs bg-[#FFF0E5] text-[#FF5A00] border border-[#FFD6C2] dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-800/60 px-2.5 py-1 rounded-full font-semibold">
                      Exigências habilitatórias decifradas: {getFilteredArray(activeEdital.documentosExigidos).length}
                    </span>
                  </div>

                  {(() => {
                    const docList = getFilteredArray(activeEdital.documentosExigidos);
                    const evaluatedDocs = docList.map(doc => ({ doc, ...matchAndEvaluateCertificate(doc) }));
                    const warnings = evaluatedDocs.filter(item => item.isWarning);

                    return (
                      <div className="space-y-4">
                        {/* Summary Warning Banner - ONLY SHOWN IF THERE ARE WARNINGS */}
                        {warnings.length > 0 && (
                          <div className="bg-rose-50 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-800/60 rounded-xl p-4 flex items-start gap-3 text-xs text-rose-800 dark:text-rose-200 animate-fade-in shadow-xs">
                            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <h5 className="font-bold text-rose-900 dark:text-rose-100 text-sm">
                                  Alerta Crítico de Habilitação na Disputa
                                </h5>
                                <span className="bg-rose-100 text-rose-700 dark:bg-rose-900/80 dark:text-rose-200 px-2 py-0.5 rounded text-[10px] font-bold border border-rose-300 dark:border-rose-700">
                                  {warnings.length} {warnings.length === 1 ? 'pendência' : 'pendências'}
                                </span>
                              </div>
                              <p className="text-rose-800 dark:text-rose-200/90 leading-relaxed">
                                Identificamos que {warnings.length === 1 ? '1 documento exigido' : `${warnings.length} documentos exigidos`} nesta disputa consta{warnings.length === 1 ? '' : 'm'} com alertas (vencido, a vencer em breve ou sem arquivo anexado) na sua aba de Gestão de Certidões. Regularize-os antes da disputa para garantir sua habilitação.
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          {evaluatedDocs.map((item, idx) => (
                            <div 
                              key={idx} 
                              className={`flex flex-col justify-between gap-3 border rounded-xl p-3.5 text-xs transition-all ${
                                item.isWarning 
                                  ? "bg-rose-50/60 border-rose-200 text-rose-950 dark:bg-rose-950/30 dark:border-rose-800/60 dark:text-rose-100 shadow-xs" 
                                  : "bg-[#F9FAFB] border-[#E5E7EB] text-[#374151] dark:bg-[#121212] dark:border-[#27272A] dark:text-zinc-200"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-2.5">
                                  <div className={`h-6 w-6 font-bold rounded-lg flex items-center justify-center shrink-0 text-[10px] mt-0.5 ${
                                    item.isWarning 
                                      ? "bg-rose-100 text-rose-700 border border-rose-300 dark:bg-rose-900/80 dark:text-rose-200 dark:border-rose-700" 
                                      : "bg-[#FFF0E5] text-[#FF5A00] border border-[#FFD6C2] dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-800/60"
                                  }`}>
                                    {idx + 1}
                                  </div>
                                  <span className="font-semibold text-[#111827] dark:text-zinc-100 leading-snug">{item.doc}</span>
                                </div>

                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase shrink-0 font-mono ${item.badgeColor}`}>
                                  {item.badgeText}
                                </span>
                              </div>

                              {/* Status or warning note */}
                              <div className={`text-[11px] pt-2 border-t flex flex-wrap items-center justify-between gap-2 ${
                                item.isWarning 
                                  ? "border-rose-200/80 text-rose-800 dark:border-rose-800/50 dark:text-rose-300 font-medium" 
                                  : "border-[#E5E7EB] text-[#6B7280] dark:border-[#27272A] dark:text-zinc-400"
                              }`}>
                                <span className="leading-tight flex items-center gap-1.5">
                                  {item.isWarning && <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />}
                                  {!item.isWarning && item.statusType === "valid" && <ShieldCheck className="w-3.5 h-3.5 text-[#059669] dark:text-emerald-400 shrink-0" />}
                                  {item.message}
                                </span>
                                {item.matchedCert && (
                                  <span className="text-[9px] text-[#9CA3AF] dark:text-zinc-500 font-mono shrink-0">
                                    Vínculo: {item.matchedCert.name}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>

              </div>
            </div>
          )}




        </div>
        );
      })()}

      {/* PROPOSAL BUILDER MODAL */}
      {showProposalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white border border-[#E5E7EB] rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between bg-[#F9FAFB] shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="bg-[#FFF0E5] text-[#FF5A00] p-2 rounded-lg border border-[#FFD6C2]">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-[#111827] text-base">Configurar Valores e Dados da Proposta</h3>
                  <p className="text-[#6B7280] text-xs">Preencha os valores solicitados pelo edital. O modelo PDF se adaptará automaticamente.</p>
                </div>
              </div>
              <button 
                onClick={() => setShowProposalModal(false)}
                className="text-[#6B7280] hover:text-[#111827] p-1 rounded-lg transition-colors bg-white border border-[#E5E7EB] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 overflow-y-auto flex-1 font-sans text-xs">
              
              {/* File Title and Header Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-[#374151] mb-1">Título do Documento PDF</label>
                  <input 
                    type="text"
                    value={proposalFileTitle}
                    onChange={(e) => setProposalFileTitle(e.target.value)}
                    className="w-full bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#FF5A00]"
                    placeholder="Ex: Proposta Comercial - Dispensa 046-2026.pdf"
                  />
                  <p className="text-[10px] text-[#6B7280] mt-1">Este será o nome do arquivo quando você fizer o download ou imprimir.</p>
                </div>

                <div>
                  <label className="block font-semibold text-[#374151] mb-1">Identificação / Modalidade / Pregão</label>
                  <input 
                    type="text"
                    value={proposalDispensa}
                    onChange={(e) => setProposalDispensa(e.target.value)}
                    className="w-full bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#FF5A00]"
                    placeholder="Ex: Dispensa de Licitação nº 046/2026"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#374151] mb-1">Número do Processo Administrativo</label>
                  <input 
                    type="text"
                    value={proposalProcesso}
                    onChange={(e) => setProposalProcesso(e.target.value)}
                    className="w-full bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#FF5A00]"
                    placeholder="Ex: Processo Administrativo nº 209/2026"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#374151] mb-1">Órgão Público Destinatário</label>
                  <input 
                    type="text"
                    value={proposalOrgao}
                    onChange={(e) => setProposalOrgao(e.target.value)}
                    className="w-full bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#FF5A00]"
                    placeholder="Ex: Secretaria Municipal de Educação de Juazeiro/BA"
                  />
                </div>
              </div>

              {/* Proposal Object */}
              <div>
                <label className="block font-semibold text-[#374151] mb-1">Objeto da Proposta / Introdução</label>
                <textarea 
                  value={proposalObject}
                  onChange={(e) => setProposalObject(e.target.value)}
                  rows={2}
                  className="w-full bg-white border border-[#D1D5DB] rounded-lg p-3 text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#FF5A00]"
                  placeholder="Escreva breve resumo do fornecimento..."
                />
              </div>

              {/* Editable Items Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-2">
                  <h4 className="font-bold text-[#111827] text-sm flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-[#FF5A00]" />
                    Itens, Quantidades e Preços (Planilha Orçamentária)
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddProposalItem}
                    className="px-3 py-1.5 bg-[#FFF0E5] text-[#FF5A00] border border-[#FFD6C2] hover:bg-[#FFE5D4] rounded-md font-semibold flex items-center gap-1 transition-all cursor-pointer text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar Item
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] max-h-[250px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-[#F3F4F6] sticky top-0 border-b border-[#E5E7EB]">
                      <tr>
                        <th className="p-3 text-[#6B7280] font-semibold w-12">#</th>
                        <th className="p-3 text-[#6B7280] font-semibold w-1/2">Descrição Detalhada do Item</th>
                        <th className="p-3 text-[#6B7280] font-semibold w-20">Qtd</th>
                        <th className="p-3 text-[#6B7280] font-semibold">Marca / Modelo</th>
                        <th className="p-3 text-[#6B7280] font-semibold w-28">Val. Unitário</th>
                        <th className="p-3 text-[#6B7280] font-semibold w-28">Val. Total</th>
                        <th className="p-3 text-[#6B7280] font-semibold w-12">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {proposalItems.map((item, index) => (
                        <tr key={index} className="hover:bg-white transition-colors">
                          <td className="p-3 text-[#6B7280] font-mono font-semibold">{index + 1}</td>
                          <td className="p-3">
                            <textarea
                              rows={2}
                              value={item.description}
                              onChange={(e) => handleItemChange(index, "description", e.target.value)}
                              className="w-full bg-white border border-[#D1D5DB] rounded-md p-1.5 text-[11px] text-[#111827] focus:ring-1 focus:ring-[#FF5A00] focus:outline-none"
                              placeholder="Ex: Fone de ouvido profissional USB com cancelador..."
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(index, "quantity", parseInt(e.target.value) || 1)}
                              className="w-full bg-white border border-[#D1D5DB] rounded-md p-1.5 text-center text-[#111827] focus:ring-1 focus:ring-[#FF5A00] focus:outline-none"
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              value={item.brandModel}
                              onChange={(e) => handleItemChange(index, "brandModel", e.target.value)}
                              className="w-full bg-white border border-[#D1D5DB] rounded-md p-1.5 text-[#111827] focus:ring-1 focus:ring-[#FF5A00] focus:outline-none"
                              placeholder="Ex: Epson L210"
                            />
                          </td>
                          <td className="p-3">
                            <div className="relative">
                              <span className="absolute left-1.5 top-2 text-[#9CA3AF] text-[10px]">R$</span>
                              <input
                                type="text"
                                value={item.unitValue}
                                onChange={(e) => handleItemChange(index, "unitValue", e.target.value)}
                                className="w-full bg-white border border-[#D1D5DB] rounded-md py-1.5 pl-6 pr-1.5 text-[#111827] focus:ring-1 focus:ring-[#FF5A00] focus:outline-none font-mono"
                                placeholder="0,00"
                              />
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="relative">
                              <span className="absolute left-1.5 top-2 text-[#9CA3AF] text-[10px]">R$</span>
                              <input
                                type="text"
                                value={item.totalValue}
                                onChange={(e) => handleItemChange(index, "totalValue", e.target.value)}
                                className="w-full bg-white border border-[#D1D5DB] rounded-md py-1.5 pl-6 pr-1.5 text-[#111827] focus:ring-1 focus:ring-[#FF5A00] focus:outline-none font-mono font-bold"
                                placeholder="0,00"
                              />
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveProposalItem(index)}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition-all cursor-pointer border border-transparent hover:border-rose-200"
                              title="Remover Item"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Subtotals & Extenso Display Box */}
                <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <span className="text-[#6B7280] font-mono text-[10px] uppercase tracking-wider block">Valor Total Global (Soma de Itens)</span>
                    <span className="text-xl font-bold text-[#059669] font-mono">R$ {formatCurrency(getGlobalSum())}</span>
                  </div>
                  <div className="flex-1 md:text-right">
                    <span className="text-[#6B7280] font-mono text-[10px] uppercase tracking-wider block">Total por Extenso</span>
                    <span className="text-[#374151] font-semibold italic">"{numeroParaExtenso(getGlobalSum())}"</span>
                  </div>
                </div>
              </div>

              {/* Conditions / Condições Comerciais */}
              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-4 space-y-4">
                <h4 className="font-bold text-[#111827] text-xs uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#FF5A00]" />
                  3. Condições Comerciais Obrigatórias
                </h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-[#374151] mb-1">Prazo de Validade da Proposta</label>
                    <input 
                      type="text"
                      value={valPrazo}
                      onChange={(e) => setValPrazo(e.target.value)}
                      className="w-full bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] placeholder-[#9CA3AF] focus:ring-1 focus:ring-[#FF5A00]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-[#374151] mb-1">Condições de Pagamento</label>
                    <input 
                      type="text"
                      value={valPgto}
                      onChange={(e) => setValPgto(e.target.value)}
                      className="w-full bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] placeholder-[#9CA3AF] focus:ring-1 focus:ring-[#FF5A00]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-[#374151] mb-1">Prazo de Entrega</label>
                    <input 
                      type="text"
                      value={valEntrega}
                      onChange={(e) => setValEntrega(e.target.value)}
                      className="w-full bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] placeholder-[#9CA3AF] focus:ring-1 focus:ring-[#FF5A00]"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-[#374151] mb-1">Local de Entrega</label>
                    <input 
                      type="text"
                      value={valLocal}
                      onChange={(e) => setValLocal(e.target.value)}
                      className="w-full bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] placeholder-[#9CA3AF] focus:ring-1 focus:ring-[#FF5A00]"
                    />
                  </div>
                </div>
              </div>

              {/* Data da Proposta */}
              <div>
                <label className="block font-semibold text-[#374151] mb-1">Local e Data de Emissão</label>
                <input 
                  type="text"
                  value={proposalDate}
                  onChange={(e) => setProposalDate(e.target.value)}
                  className="w-full bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] font-sans"
                />
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-[#E5E7EB] flex items-center justify-end gap-3 bg-[#F9FAFB] shrink-0">
              <button
                type="button"
                onClick={() => setShowProposalModal(false)}
                className="px-4 py-2 border border-[#D1D5DB] text-[#374151] rounded-lg font-semibold hover:bg-white hover:text-[#111827] transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGenerateProposal}
                className="px-6 py-2 bg-[#FF5A00] hover:bg-[#E65000] text-white rounded-lg font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                {generatingDoc === "proposal" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Gerando Proposta...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-[#FFD6C2]" />
                    Gerar Proposta Oficial PDF
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Modal Popup de Alerta de Tamanho de Arquivo Excedido (> 60MB) */}
      {fileSizeErrorModal && fileSizeErrorModal.show && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-fade-in">
          <div className="bg-white border border-rose-200 rounded-2xl max-w-md w-full p-6 shadow-2xl relative space-y-5 overflow-hidden text-left">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-rose-500" />
            
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-600 shrink-0">
                <AlertTriangle className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-[#111827] leading-tight">
                  Arquivo Maior que 60 MB
                </h3>
                <p className="text-xs text-rose-600 font-medium">
                  Tamanho limite por anexo: <span className="underline font-bold">60 MB</span>
                </p>
              </div>
            </div>

            <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-4 text-xs space-y-3 text-[#374151]">
              <p className="leading-relaxed">
                O arquivo <strong className="text-[#111827]">"{fileSizeErrorModal.fileName}"</strong> possui <strong className="text-rose-600 font-semibold">{fileSizeErrorModal.fileSizeMb} MB</strong> e excede o limite máximo permitido.
              </p>
              <div className="space-y-1.5 text-[#6B7280] border-t border-[#E5E7EB] pt-2.5">
                <p className="font-semibold text-[#111827]">💡 Como proceder:</p>
                <ul className="list-disc list-inside space-y-1 pl-1 text-[11px]">
                  <li>Comprima ou divida o PDF em arquivos menores (&lt; 60 MB);</li>
                  <li>Ou copie o texto do edital e cole no campo de texto livre ao lado.</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setFileSizeErrorModal(null)}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-semibold shadow-xs transition-all flex items-center gap-2 cursor-pointer text-xs"
              >
                <Check className="w-4 h-4" />
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
