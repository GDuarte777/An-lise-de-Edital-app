import { useState, useEffect } from "react";
import { EditalAnalysis, CompanyData, SyncItem, Certificate } from "../types";
import { 
  FileUp, FileText, CheckCircle2, AlertTriangle, Clock, ArrowRight, Loader2, Play, 
  Sparkles, RefreshCw, ChevronRight, FileCode, CheckSquare, Edit3, Settings, ClipboardPaste, 
  Coins, HelpCircle, HardDriveDownload, MonitorCheck, Save, Send, Database, FileSpreadsheet, Eye,
  Trash2, ShieldCheck, ShieldAlert, Award, TrendingUp, Landmark, MapPin, Gauge, Plus, X,
  LayoutGrid, List, Search, Check, Calendar, ExternalLink, Globe, Building2
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./ui/table";
import { addSyncedItem, syncAnalysisToGoogleSheets } from "../utils/googleSync";
import { 
  syncEditalToSupabase, 
  syncDocumentToSupabase, 
  callSupabaseGeminiEdgeFunction,
  fetchEditaisFromSupabase,
  saveEditalToSupabase,
  deleteEditalFromSupabase,
  subscribeToSupabaseTable,
  saveDisputaToSupabase,
  generateUUID
} from "../utils/supabaseClient";
import confetti from "canvas-confetti";
import { getActiveAiConfig, apiFetch, prepareAttachmentsForServer, validateApiKeyFormat, formatAiError, readJsonResponse, readJsonResponseSafe } from "../utils/aiClientHelper";

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

export function buildPncpEditalUrl(str: string): string | null {
  if (!str) return null;
  const cleanedText = str.trim();

  // 1. Canonical PNCP URL or URL in text (/app/editais/CNPJ/ANO/SEQ)
  const canonicalMatch = cleanedText.match(/https?:\/\/(?:www\.)?pncp\.gov\.br\/app\/editais\/(\d{14})\/(\d{4})\/(\d{1,6})/i);
  if (canonicalMatch) {
    const cnpj = canonicalMatch[1];
    const ano = canonicalMatch[2];
    const seqPadded = canonicalMatch[3].padStart(6, '0');
    return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seqPadded}`;
  }

  // 2. ID Contratação PNCP / Controle PNCP format: e.g. 79151312000156-1-000501/2026 or 79151312000156-1-000501-2026
  const controlMatch = cleanedText.match(/(\d{14})[-_\s/]?1[-_\s/]?(\d{1,6})[/-_](\d{4})/);
  if (controlMatch) {
    const cnpj = controlMatch[1];
    const seqPadded = controlMatch[2].padStart(6, '0');
    const ano = controlMatch[3];
    return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seqPadded}`;
  }

  // 3. Slash format: 14-digit CNPJ / 4-digit Year / 1-6 digit Seq
  const slashMatch1 = cleanedText.match(/(\d{14})[/-_](\d{4})[/-_](\d{1,6})/);
  if (slashMatch1) {
    const cnpj = slashMatch1[1];
    const ano = slashMatch1[2];
    const seqPadded = slashMatch1[3].padStart(6, '0');
    return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seqPadded}`;
  }

  // 4. Slash format: 14-digit CNPJ / 1-6 digit Seq / 4-digit Year
  const slashMatch2 = cleanedText.match(/(\d{14})[/-_](\d{1,6})[/-_](\d{4})/);
  if (slashMatch2) {
    const cnpj = slashMatch2[1];
    const seqPadded = slashMatch2[2].padStart(6, '0');
    const ano = slashMatch2[3];
    return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seqPadded}`;
  }

  // 5. Generic PNCP URL
  const genericMatch = cleanedText.match(/(https?:\/\/(?:www\.)?pncp\.gov\.br\/[^\s\)\"\'>]+)/i);
  if (genericMatch) {
    return genericMatch[1].replace(/[.,;]$/, "");
  }

  return null;
}

export function getUasg(edital: EditalAnalysis | null): string {
  if (!edital) return "Não informada";

  const explicitUasg = (edital as any).uasg || (edital as any).uasgUndCompradora || (edital.identificacaoCertame as any)?.uasg || (edital.identificacaoCertame as any)?.uasgUndCompradora;
  if (explicitUasg && typeof explicitUasg === "string" && explicitUasg.trim().length > 0) {
    return explicitUasg.trim();
  }

  const combinedText = [
    edital.identificacaoCertame?.orgaoComprador || "",
    edital.identificacaoCertame?.identificacaoNumerica || "",
    edital.rawText || "",
    edital.reportMarkdown || ""
  ].join(" ");

  const uasgMatch = combinedText.match(/(?:UASG|Unidade\s+Compradora|Unidade\s+Gestora|Código\s+Unidade|Und\.?\s*Compradora)[:\s]*(\d{5,6}\b[^\n,;]*)/i)
    || combinedText.match(/\b(\d{5,6})\s*-\s*[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ\s]{3,}/i);

  if (uasgMatch) {
    return uasgMatch[1].trim();
  }

  return "Não informada";
}

export function getIdContratacaoPNCP(edital: EditalAnalysis | null): string {
  if (!edital) return "Não identificado";

  const explicitId = edital.idContratacaoPNCP || edital.identificacaoCertame?.idContratacaoPNCP;
  if (explicitId && typeof explicitId === "string" && explicitId.trim().length > 0) {
    return explicitId.trim();
  }

  const combinedText = [
    edital.identificacaoCertame?.linkPNCP || "",
    edital.linkPNCP || "",
    edital.rawText || "",
    edital.reportMarkdown || "",
    edital.identificacaoCertame?.identificacaoNumerica || ""
  ].join(" ");

  const matchControl = combinedText.match(/(\d{14})[-_\s/]?1[-_\s/]?(\d{1,6})[/-_](\d{4})/);
  if (matchControl) {
    const cnpj = matchControl[1];
    const seqPadded = matchControl[2].padStart(6, '0');
    const ano = matchControl[3];
    return `${cnpj}-1-${seqPadded}/${ano}`;
  }

  const matchUrl = combinedText.match(/pncp\.gov\.br\/app\/editais\/(\d{14})\/(\d{4})\/(\d{1,6})/i);
  if (matchUrl) {
    const cnpj = matchUrl[1];
    const ano = matchUrl[2];
    const seqPadded = matchUrl[3].padStart(6, '0');
    return `${cnpj}-1-${seqPadded}/${ano}`;
  }

  const cnpjMatch = combinedText.match(/(?:CNPJ[:\s]*)?(\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i);
  const yearMatch = combinedText.match(/\b(202[4-9])\b/);
  const seqMatch = combinedText.match(/(?:Dispensa|Pregão|Edital|Processo|Contratação|nº|n°)\s*(?:nº|n°)?\s*(\d{1,6})\/202[4-9]/i);

  if (cnpjMatch && yearMatch && seqMatch) {
    const cleanCnpj = cnpjMatch[1].replace(/\D/g, "");
    const ano = yearMatch[1];
    const seqPadded = seqMatch[1].padStart(6, '0');
    if (cleanCnpj.length === 14) {
      return `${cleanCnpj}-1-${seqPadded}/${ano}`;
    }
  }

  return "Não identificado";
}

export function getPncpDirectUrl(edital: EditalAnalysis | null): string | null {
  if (!edital) return null;

  const knownLink = edital.identificacaoCertame?.linkPNCP || edital.linkPNCP;
  if (knownLink && typeof knownLink === "string") {
    const directMatch = knownLink.match(/https?:\/\/(?:www\.)?pncp\.gov\.br\/app\/editais\/(\d{14})\/(\d{4})\/(\d{1,6})/i);
    if (directMatch) {
      const cnpj = directMatch[1];
      const ano = directMatch[2];
      const seq = directMatch[3].padStart(6, '0');
      return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`;
    }
  }

  const idPNCP = getIdContratacaoPNCP(edital);
  if (idPNCP && idPNCP !== "Não identificado") {
    const m = idPNCP.match(/(\d{14})[-_\s/]?1?[-_\s/]?(\d{1,6})[/-_](\d{4})/);
    if (m) {
      const cnpj = m[1];
      const seq = m[2].padStart(6, '0');
      const ano = m[3];
      return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`;
    }

    const m2 = idPNCP.match(/(\d{14})[/-_](\d{4})[/-_](\d{1,6})/);
    if (m2) {
      const cnpj = m2[1];
      const ano = m2[2];
      const seq = m2[3].padStart(6, '0');
      return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}`;
    }

    const cleanPath = idPNCP.replace(/^https?:\/\/(?:www\.)?pncp\.gov\.br\/app\/editais\//i, "").trim();
    if (cleanPath) {
      return `https://pncp.gov.br/app/editais/${cleanPath}`;
    }
  }

  const combinedText = [
    edital.rawText || "",
    edital.reportMarkdown || "",
    edital.identificacaoCertame?.identificacaoNumerica || "",
    edital.identificacaoCertame?.orgaoComprador || ""
  ].join(" ");

  const builtFromText = buildPncpEditalUrl(combinedText);
  if (builtFromText && builtFromText.includes("/app/editais/")) {
    return builtFromText;
  }

  const idNum = edital.identificacaoCertame?.identificacaoNumerica || "";
  const cleanTerm = extractCleanPncpQuery(idNum, combinedText);

  if (cleanTerm && cleanTerm.length >= 2) {
    return `https://pncp.gov.br/app/editais?q=${encodeURIComponent(cleanTerm)}`;
  }

  return "https://pncp.gov.br/app/editais";
}

export function getPncpLink(edital: EditalAnalysis | null): string | null {
  return getPncpDirectUrl(edital);
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
      badgeColor: "bg-muted text-muted-foreground border-border",
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
        badgeColor: "bg-muted text-muted-foreground border-border",
        message: "Não localizado explicitamente na Gestão de Certidões. Verifique seu acervo.",
        isWarning: false
      };
    }

    if (!candidate.fileUploaded) {
      return {
        matchedCert: candidate,
        statusType: "not_uploaded" as const,
        badgeText: "Sem Arquivo",
        badgeColor: "bg-warning/15 text-warning border-warning/40",
        message: `Cadastrado como "${candidate.name}", mas nenhum arquivo PDF foi anexado.`,
        isWarning: true
      };
    }

    if (!candidate.expirationDate) {
      return {
        matchedCert: candidate,
        statusType: "no_date" as const,
        badgeText: "Data Pendente",
        badgeColor: "bg-warning/15 text-warning border-warning/40",
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
          badgeColor: "bg-destructive/15 text-destructive border-destructive/40",
          message: `🚨 A certidão "${candidate.name}" VENCEU em ${formattedDate}. Regularize na Gestão de Certidões!`,
          isWarning: true
        };
      } else if (diffDays <= 15) {
        return {
          matchedCert: candidate,
          statusType: "expiring_soon" as const,
          badgeText: `Vence em ${diffDays}d`,
          badgeColor: "bg-warning/15 text-warning border-warning/40",
          message: `⚠️ Atenção: "${candidate.name}" vence em ${diffDays} dia(s) (${formattedDate}).`,
          isWarning: true
        };
      } else {
        return {
          matchedCert: candidate,
          statusType: "valid" as const,
          badgeText: "Válida & Regular",
          badgeColor: "bg-success/15 text-success border-success/30",
          message: `Válida e regular até ${formattedDate}.`,
          isWarning: false
        };
      }
    }

    return {
      matchedCert: candidate,
      statusType: "valid" as const,
      badgeText: "Válida",
      badgeColor: "bg-success/15 text-success border-success/30",
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
        const errData = await readJsonResponseSafe(response);
        throw new Error(errData.error || errData.message || "Erro de processamento da proposta.");
      }

      const data = await readJsonResponse(response);
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

  // Histórico de Editais (Supabase com fallback Local e Realtime)
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

    // Subscribe to real-time events on editais_analisados
    const unsubscribe = subscribeToSupabaseTable("editais_analisados", () => {
      loadHistory();
    });

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

    const handleWindowFocus = () => loadHistory();
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("aip_trigger_external_text", handleExternalText);
    
    // Check on mount as well
    handleExternalText();

    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleWindowFocus);
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

    // 🔑 Validate API key BEFORE sending to avoid long waits on misconfiguration
    const aiConfig = getActiveAiConfig();
    const keyError = validateApiKeyFormat(aiConfig.apiKey, aiConfig.provider);
    if (keyError) {
      alert(keyError);
      return;
    }

    setLoading(true);
    // AbortController for 120s timeout
    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 120_000);

    try {
      let data: any;

      console.log(`[Analyzer] Processing edital analysis with ${attachedFiles.length} file attachments...`);

      const preparedAttachments = await prepareAttachmentsForServer(attachedFiles);

      const response = await apiFetch("/api/analyze-edital", {
        method: "POST",
        signal: abortCtrl.signal,
        body: {
          textInput: textInput,
          attachments: preparedAttachments
        }
      });

      if (!response.ok) {
        const errData = await readJsonResponseSafe(response);
        throw new Error(errData.error || errData.message || `Erro na resposta do servidor (${response.status}).`);
      }

      data = await readJsonResponse(response);

      // O servidor responde 200 mesmo quando a IA falha, entregando uma extração local
      // marcada com degraded/reason. Sem avisar, o usuário lê um relatório pobre achando
      // que foi a IA que o produziu.
      if (data?.degraded && data?.reason) {
        alert(`⚠️ A IA não conseguiu analisar este edital.\n\n${data.reason}\n\nO que aparece abaixo é apenas uma extração local do texto, sem análise da IA.`);
      }

      if (data && data.analysis) {
        const fileNamesSummary = attachedFiles.length > 0
          ? `Anexos (${attachedFiles.length}): ${attachedFiles.map(f => f.name).join(", ")}`
          : "Edital em Texto";
        const analysisResult: EditalAnalysis = {
          ...data.analysis,
          // Ensure all required arrays are never undefined
          pontosPositivos: Array.isArray(data.analysis.pontosPositivos) ? data.analysis.pontosPositivos : [],
          pontosAlerta: Array.isArray(data.analysis.pontosAlerta) ? data.analysis.pontosAlerta : [],
          documentosExigidos: Array.isArray(data.analysis.documentosExigidos) ? data.analysis.documentosExigidos : [],
          itensEdital: Array.isArray(data.analysis.itensEdital) ? data.analysis.itensEdital : [],
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

        // Auto-save to planilhas_disputas in Supabase in real-time
        try {
          const iden: any = analysisResult.identificacaoCertame || {};
          const fin: any = analysisResult.viabilidadeFinanceira || {};
          const rawValStr = String(fin.valorEstimado || fin.valorEstimadoTotal || "");
          
          // Extract the GLOBAL/TOTAL value (prefer the largest R$ value found)
          const allPrices = rawValStr.match(/([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2}))/g) || [];
          const parsedPrices = allPrices.map(p =>
            parseFloat(p.replace(/\./g, "").replace(",", "."))
          ).filter(v => !isNaN(v) && v > 0);
          
          // Use the largest found value as the global estimated value
          const numVal = parsedPrices.length > 0
            ? Math.max(...parsedPrices)
            : (typeof fin.valorEstimado === "number" ? fin.valorEstimado : 0);

          const disputaRow = {
            id: generateUUID(),
            orgao: iden.orgaoComprador || (analysisResult.descricaoProduto ? analysisResult.descricaoProduto.slice(0, 50) : "Órgão do Edital"),
            uasgUndCompradora: iden.codigoUASG || iden.uasg || iden.identificacaoNumerica || "",
            numeroLicitacao: iden.numeroLicitacao || iden.identificacaoNumerica || "",
            portal: iden.portalEletronico || "Compras.gov.br",
            produtoItem: analysisResult.descricaoProduto || "Objeto da Licitação",
            quantidade: analysisResult.itensEdital?.[0]?.quantidade || 1,
            unidadeMedida: analysisResult.itensEdital?.[0]?.unidade || "Unidade",
            valorEstimadoItem: numVal,
            nossoValorAlvo: numVal > 0 ? Number((numVal * 0.90).toFixed(2)) : 0,
            valorMinimoPiso: numVal > 0 ? Number((numVal * 0.82).toFixed(2)) : 0,
            dataHoraDisputa: iden.dataHoraSessao || new Date().toLocaleDateString("pt-BR") + " 09:00",
            status: "Agendada" as const,
            observacoes: `Gerado automaticamente da análise do edital.`,
            linkPNCP: iden.linkPNCP || analysisResult.linkPNCP || ""
          };
          saveDisputaToSupabase(disputaRow).then(() => {
            window.dispatchEvent(new Event("aip_sync_disputas"));
          }).catch(() => {});
        } catch (e) {
          console.warn("Could not auto-add disputa row:", e);
        }

        setHistory(prev => {
          const updated = [newHistoryItem, ...prev];
          localStorage.setItem("aip_edital_history", JSON.stringify(updated));
          return updated;
        });

        window.dispatchEvent(new Event("aip_edital_history_updated"));
        window.dispatchEvent(new CustomEvent("aip_edital_analyzed", { detail: newHistoryItem }));

        // Auto-sync log results dynamically to Google Sheets/Drive simulation!
        syncAnalysisToGoogleSheets(`Análise Edital - ${(analysisResult.descricaoProduto || "").slice(0, 30)}`, analysisResult);

        setTimeout(() => {
          const section = document.getElementById("analysis-results-section");
          if (section) {
            section.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 150);
      } else {
        alert("A IA não retornou dados estruturados. Tente novamente ou verifique se o texto do edital está legível.");
      }
    } catch (e: any) {
      if (e?.name === "AbortError" || e?.message?.includes("aborted")) {
        alert("⏱️ A análise excedeu 120 segundos. O arquivo pode ser muito grande ou a IA está sobrecarregada. Tente novamente com um texto menor ou aguarde alguns instantes.");
      } else {
        alert(formatAiError(e));
      }
      console.error("[handleAnalyze] Error:", e);
    } finally {
      clearTimeout(timeoutId);
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
        const errData = await readJsonResponseSafe(response);
        throw new Error(errData.error || errData.message || "Erro de processamento no refinamento.");
      }

      const data = await readJsonResponse(response);
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
        const errData = await readJsonResponseSafe(response);
        throw new Error(errData.error || errData.message || "Erro de processamento do documento.");
      }

      const data = await readJsonResponse(response);
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
      <Card className="p-5 md:p-6 relative overflow-hidden gap-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="bg-accent text-accent-foreground p-2 rounded-lg border border-border">
              <FileUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-foreground text-base">Leitura Inteligente de Editais</h3>
              <p className="text-muted-foreground text-xs leading-normal">Carregue arquivos em formato PDF, TXT ou cole partes relevantes para que a IA extraia obrigações</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeEdital && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setActiveEdital(null);
                  setTextInput("");
                  setAttachedFiles([]);
                }}
                className="text-xs font-semibold text-destructive border-destructive/30 bg-destructive/10 hover:bg-destructive/20 hover:text-destructive"
              >
                Limpar Painel
              </Button>
            )}
          </div>
        </div>

        {/* Drag and drop panel */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="border-2 border-dashed border-border hover:border-primary rounded-xl p-5 bg-muted/50 transition-all text-center relative"
            >
              <input
                type="file"
                id="edital-file-upload"
                accept=".txt,.pdf"
                multiple
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <FileUp className="w-8 h-8 text-primary mx-auto mb-2" />
              <p className="text-xs font-semibold text-foreground">Arraste seus anexos ou Clique para selecionar arquivos</p>
              <p className="text-[10px] text-muted-foreground mt-1">Selecione 1 ou mais arquivos (PDF ou TXT) do edital e anexos (Max 60MB cada)</p>

              {attachedFiles.length > 0 && (
                <div className="mt-4 space-y-2 text-left relative z-10" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between text-xs font-semibold text-foreground border-b border-border pb-1.5">
                    <span className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-success" />
                      Anexos Prontos para Análise ({attachedFiles.length}):
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachedFiles([])}
                      className="text-[10px] text-destructive hover:underline cursor-pointer"
                    >
                      Remover todos
                    </button>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {attachedFiles.map((f) => (
                      <div key={f.id} className="bg-accent border border-border rounded-lg p-2 flex items-center justify-between text-xs text-foreground">
                        <div className="flex items-center gap-2 truncate pr-2">
                          <FileText className="w-4 h-4 text-primary shrink-0" />
                          <span className="font-semibold truncate">{f.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-medium text-muted-foreground text-[10px] bg-card px-1.5 py-0.5 rounded border border-border">
                            {f.size}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(f.id)}
                            className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10 transition-colors cursor-pointer"
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
              <span className="text-xs font-semibold text-muted-foreground">Ou cole a íntegra ou partes do texto do edital:</span>
              <Textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                className="w-full h-44 rounded-xl p-3 text-xs font-mono leading-relaxed resize-none"
                placeholder="Cole as seções do edital sobre objeto, prazo, contraprestação e documentos de habilitação..."
              />
            </div>

            <Button
              id="trigger-analyze-btn"
              onClick={handleAnalyze}
              disabled={loading || (!textInput.trim() && attachedFiles.length === 0)}
              className="w-full font-bold py-2.5 h-auto rounded-lg text-sm"
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
            </Button>
          </div>

          {/* Column 2: Info & History */}
          <div className="space-y-4">
            {/* Histórico Local de Editais */}
            <Card className="p-4 md:p-5 space-y-3 text-xs gap-0">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <h4 className="font-bold text-foreground flex items-center gap-1.5">
                  <Database className="w-4 h-4 text-primary" />
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
                          className="text-[10px] text-success hover:opacity-80 font-bold bg-success/10 px-2 py-0.5 rounded border border-success/30 transition-all cursor-pointer"
                        >
                          Sim, apagar tudo!
                        </button>
                        <button
                          onClick={() => setShowConfirmClearHistory(false)}
                          className="text-[10px] text-muted-foreground hover:text-foreground bg-muted px-2 py-0.5 rounded border border-border transition-all cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setShowConfirmClearHistory(true);
                        }}
                        className="text-[10px] text-destructive hover:opacity-80 font-bold tracking-tight bg-destructive/10 px-2 py-0.5 rounded border border-destructive/30 transition-all cursor-pointer"
                      >
                        Apagar Tudo
                      </button>
                    )}
                  </div>
                )}
              </div>

              {history.length === 0 ? (
                <p className="text-muted-foreground text-center py-4 text-[11px]">Nenhuma análise armazenada no Supabase ainda.</p>
              ) : (
                <div className="space-y-2 max-h-[170px] overflow-y-auto pr-1">
                  {history.map((item) => {
                    const isSelected = activeEdital && activeEdital.descricaoProduto === item.analysis.descricaoProduto;
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between p-2.5 rounded-lg border text-[11px] transition duration-150 ${
                          isSelected
                            ? "bg-accent border-ring text-foreground shadow-xs"
                            : "bg-muted/50 border-border hover:border-ring/50 text-foreground/80 hover:text-foreground"
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
                          <div className="text-[9px] text-muted-foreground flex items-center gap-1 mt-1 font-mono">
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
                          className="text-muted-foreground hover:text-destructive p-1 bg-card hover:bg-destructive/10 rounded transition-colors cursor-pointer shrink-0 ml-1 border border-border hover:border-destructive/30"
                          title="Apagar análise do histórico"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </div>
      </Card>

      {loading && (
        <Card className="p-8 text-center space-y-3">
          <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto" />
          <p className="text-foreground font-semibold text-sm">Decifrando escopo de contratação pública...</p>
          <p className="text-muted-foreground text-xs">Isso pode levar de 5 a 15 segundos dependendo do tamanho das cláusulas fornecidas.</p>
        </Card>
      )}

      {/* Analysis Results Display */}
      {activeEdital && !loading && (() => {
        const selectedStats = getSelectedItemsStats();
        return (
        <div className="space-y-6 animate-fade-in" id="analysis-results-section">
          
          {/* Executive Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

            <Card className="p-5 space-y-2 max-h-[160px] overflow-y-auto gap-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">Descrição do Objeto</span>
                <Badge variant="outline" className="text-[10px] font-bold text-primary bg-accent border-border shrink-0">
                  {selectedStats.count} de {selectedStats.totalEditalCount} itens
                </Badge>
              </div>
              <p className="font-semibold text-foreground text-xs md:text-sm leading-snug whitespace-pre-line">
                {getDynamicDescricaoProduto()}
              </p>
            </Card>

            {/* Dynamic Financial Summary Card based on Selected Items */}
            <Card className="p-5 space-y-1.5 gap-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">Valor Estimado Selecionado</span>
                <Coins className="w-4 h-4 text-primary shrink-0" />
              </div>
              <div className="mt-1">
                <p className="font-bold text-primary text-base md:text-lg font-mono tracking-tight leading-tight">
                  {selectedStats.formattedValorEstimado}
                </p>
                <p className="text-[11px] text-muted-foreground font-medium mt-1">
                  {selectedStats.count > 0
                    ? `${selectedStats.count} ${selectedStats.count === 1 ? 'item marcado' : 'itens marcados'} (${selectedStats.totalQuantity} un)`
                    : "Nenhum item selecionado"}
                </p>
              </div>
            </Card>

            <Card className="p-5 space-y-1.5 gap-0">
              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">Prazo de Entrega ao Governo</span>
              <div className="flex items-center gap-2 mt-1">
                <Clock className="w-5 h-5 text-success shrink-0" />
                <p className="font-bold text-foreground text-sm md:text-base leading-snug">
                  {activeEdital.prazoEntrega}
                </p>
              </div>
            </Card>

            <Card className="p-5 space-y-1.5 gap-0">
              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">Condição de Pagamento</span>
              <div className="flex items-center gap-2 mt-1">
                <Coins className="w-5 h-5 text-primary shrink-0" />
                <p className="font-bold text-foreground text-sm md:text-base leading-snug">
                  {activeEdital.prazoPagamento}
                </p>
              </div>
            </Card>

          </div>

          {/* Mapping of Items / Lotes - Modern Minimalist Selector */}
          {activeEdital.itensEdital && activeEdital.itensEdital.length > 0 && (
            <Card className="p-4 md:p-5 space-y-4 animate-fade-in gap-0">

              {/* Header Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="bg-accent text-accent-foreground p-2 rounded-lg border border-border shrink-0">
                    <CheckSquare className="w-4 h-4 md:w-5 md:h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-foreground text-sm md:text-base">Itens e Lotes do Certame</h4>
                      <Badge variant="outline" className="text-[10px] font-bold bg-accent text-primary border-border rounded-full">
                        {selectedItemNumbers.length} de {activeEdital.itensEdital.length} selecionados
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      Selecione os itens desejados para cotar ou gerar a proposta automática.
                    </p>
                  </div>
                </div>

                {/* Quick Actions & View Switcher */}
                <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
                  {/* Search input for 5+ items */}
                  {activeEdital.itensEdital.length >= 5 && (
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <Input
                        type="text"
                        value={itemSearchQuery}
                        onChange={(e) => setItemSearchQuery(e.target.value)}
                        placeholder="Buscar item..."
                        className="pl-8 pr-2.5 py-1 h-auto text-xs w-28 md:w-36"
                      />
                    </div>
                  )}

                  <div className="flex items-center bg-muted p-0.5 rounded-lg border border-border">
                    <button
                      type="button"
                      onClick={() => setItemSelectorViewMode("compact")}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                        itemSelectorViewMode === "compact"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
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
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="Visão Detalhada (Lista)"
                    >
                      <List className="w-3 h-3" />
                      <span className="hidden md:inline">Lista</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1 border-l border-border pl-2">
                    <button
                      type="button"
                      onClick={() => setSelectedItemNumbers(activeEdital.itensEdital?.map(it => it.numero) || [])}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-border text-foreground/80 hover:text-foreground bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedItemNumbers([])}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-border text-foreground/80 hover:text-foreground bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
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
                    <div className="py-6 text-center text-xs text-muted-foreground bg-muted/50 rounded-xl border border-border">
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
                                  ? "bg-accent border-primary/30 text-foreground shadow-xs hover:bg-accent/70"
                                  : "bg-muted/50 border-border text-muted-foreground hover:border-ring/50 hover:text-foreground hover:bg-muted"
                              }`}
                            >
                              <div className={`w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border ${
                                isSelected
                                  ? "bg-primary border-primary text-primary-foreground"
                                  : "border-border bg-card group-hover:border-ring/50"
                              }`}>
                                {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                              </div>

                              <span className={`font-bold ${isSelected ? "text-primary" : "text-foreground"}`}>
                                Item {String(it.numero).padStart(2, '0')}
                              </span>

                              <span className="text-muted-foreground max-w-[140px] md:max-w-[180px] truncate">
                                {it.descricao}
                              </span>

                              {it.valorEstimado && (
                                <span className={`text-[11px] font-mono font-semibold ml-1 ${isSelected ? "text-success" : "text-muted-foreground"}`}>
                                  {it.valorEstimado}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Dynamic Detail Card on Hover */}
                      {currentHoveredItem && (
                        <div className="bg-muted/50 border border-border rounded-xl p-3 text-xs space-y-1 animate-fade-in">
                          <div className="flex items-center justify-between text-primary font-bold">
                            <span>Item {String(currentHoveredItem.numero).padStart(2, '0')} &bull; Qtd: {currentHoveredItem.quantidade} {currentHoveredItem.unidade || "un"}</span>
                            {currentHoveredItem.valorEstimado && <span className="text-success font-mono">{currentHoveredItem.valorEstimado}</span>}
                          </div>
                          <p className="text-foreground/80 text-[11px] leading-relaxed">
                            {currentHoveredItem.descricao}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                }

                {/* Detailed View Mode (Ultra-clean Table/List) */}
                return (
                  <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-card">
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
                            isSelected ? "bg-accent hover:bg-accent/70" : "hover:bg-muted/50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="rounded border-border text-primary focus:ring-0 focus:ring-offset-0 w-4 h-4 cursor-pointer"
                          />
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                            isSelected ? "bg-accent text-primary border border-border" : "bg-muted text-muted-foreground"
                          }`}>
                            Item {String(it.numero).padStart(2, '0')}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate" title={it.descricao}>
                              {it.descricao}
                            </p>
                          </div>
                          <span className="text-[11px] text-muted-foreground shrink-0 font-mono">
                            Qtd: <strong className="text-foreground">{it.quantidade}</strong> {it.unidade || "un"}
                          </span>
                          {it.valorEstimado && (
                            <span className="text-xs font-mono font-semibold text-success shrink-0 ml-2">
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
              <div className="bg-muted/50 border border-border rounded-xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-2.5 text-foreground/80">
                  <Sparkles className="w-4 h-4 text-primary shrink-0" />
                  <span>
                    <strong className="text-foreground font-semibold">{selectedStats.count}</strong> de <strong className="text-foreground">{selectedStats.totalEditalCount}</strong> itens selecionados.
                  </span>
                  <span className="hidden sm:inline text-border">|</span>
                  <span className="bg-accent text-primary px-2 py-0.5 rounded border border-border font-mono font-semibold">
                    Valor Estimado: {selectedStats.formattedValorEstimado}
                  </span>
                  <span className="bg-accent text-primary px-2 py-0.5 rounded border border-border font-mono font-semibold">
                    Qtd Total: {selectedStats.totalQuantity} un
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {isRefined ? (
                    <>
                      <Badge variant="warning" className="text-[10px] uppercase">
                        Foco Refinado por IA
                      </Badge>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleRestoreFullAnalysis}
                        className="font-bold text-xs"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Ver Edital Completo
                      </Button>
                    </>
                  ) : (
                    selectedItemNumbers.length > 0 && selectedItemNumbers.length < activeEdital.itensEdital.length && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleRefineWithAi}
                        disabled={refining}
                        className="font-bold text-xs"
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
                      </Button>
                    )
                  )}
                </div>
              </div>

            </Card>
          )}

          {/* Tab Selector Menu for Sub-Information Panels */}
          <Tabs value={analysisActiveTab} onValueChange={(v) => setAnalysisActiveTab(v as "report" | "struc" | "checklist")}>
            <TabsList className="w-full sm:w-auto overflow-x-auto">
              <TabsTrigger value="report" className="gap-1.5 whitespace-nowrap">
                <Sparkles className="w-4 h-4 text-primary" />
                Parecer Executivo
              </TabsTrigger>
              <TabsTrigger value="struc" className="gap-1.5 whitespace-nowrap">
                <Gauge className="w-4 h-4 text-success" />
                Dossiê Estruturado por Tópicos
              </TabsTrigger>
              <TabsTrigger value="checklist" className="gap-1.5 whitespace-nowrap">
                <CheckSquare className="w-4 h-4 text-primary" />
                Checklist & Alertas Rápidos
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* TAB 1: EXECUTIVE BRIEFING (MARKDOWN REPORT) */}
          {analysisActiveTab === "report" && (
            <div className="space-y-6 animate-fade-in">
              {/* Main Executive Report Card */}
              <Card className="p-6 md:p-8 space-y-6 relative overflow-hidden">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    <h3 className="text-sm md:text-base font-bold text-foreground tracking-tight">
                      Parecer Executivo de Estratégia de Mercado
                    </h3>
                  </div>
                  <span className="font-mono text-[9px] text-primary font-bold uppercase tracking-widest hidden sm:block bg-accent px-2.5 py-1 rounded">
                    Senior Market Strategy Report
                  </span>
                </div>

                {/* Prominent Quick Action Bar for Dispute Date, UASG, ID PNCP & Direct PNCP Link */}
                {activeEdital && (
                  <div className="bg-accent border border-primary/30 rounded-xl p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4 shadow-2xs">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                      {/* 1. Data e Hora da Disputa */}
                      <div className="flex items-center gap-2.5 bg-card/80 p-2.5 rounded-lg border border-border">
                        <div className="p-2 bg-primary text-primary-foreground rounded-md shrink-0">
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground font-bold block truncate">
                            Data e Hora da Disputa
                          </span>
                          <span className="text-xs font-extrabold text-foreground flex items-center gap-1 truncate">
                            <Clock className="w-3 h-3 text-primary shrink-0" />
                            <span className="truncate">{getDataHoraDisputa(activeEdital)}</span>
                          </span>
                        </div>
                      </div>

                      {/* 2. UASG / Unidade Compradora */}
                      <div className="flex items-center gap-2.5 bg-card/80 p-2.5 rounded-lg border border-border">
                        <div className="p-2 bg-primary text-primary-foreground rounded-md shrink-0">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground font-bold block truncate">
                            UASG / Unidade
                          </span>
                          <span className="text-xs font-extrabold text-foreground block truncate" title={getUasg(activeEdital)}>
                            {getUasg(activeEdital)}
                          </span>
                        </div>
                      </div>

                      {/* 3. Id Contratação PNCP */}
                      <div className="flex items-center gap-2.5 bg-card/80 p-2.5 rounded-lg border border-border">
                        <div className="p-2 bg-primary text-primary-foreground rounded-md shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground font-bold block truncate">
                            Id Contratação PNCP
                          </span>
                          <span className="text-xs font-mono font-extrabold text-primary block truncate" title={getIdContratacaoPNCP(activeEdital)}>
                            {getIdContratacaoPNCP(activeEdital)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {getPncpDirectUrl(activeEdital) && (
                      <a
                        href={getPncpDirectUrl(activeEdital)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold rounded-xl transition-all shadow-2xs hover:shadow-xs shrink-0 cursor-pointer w-full xl:w-auto"
                      >
                        <Globe className="w-4 h-4" />
                        <span>Acessar Licitação no Portal PNCP</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                )}

                {activeEdital.reportMarkdown ? (
                  <div className="prose max-w-none text-foreground text-xs md:text-sm leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                      h1: ({node, ...props}) => <h1 className="text-sm md:text-base font-bold text-foreground border-b border-border pb-2 mt-6 mb-3 flex items-center gap-2 uppercase tracking-wide text-primary" {...props} />,
                      h2: ({node, ...props}) => <h2 className="text-xs md:text-sm font-bold text-foreground mt-5 mb-2.5 border-b border-border pb-1 flex items-center gap-2" {...props} />,
                      h3: ({node, ...props}) => <h3 className="text-xs md:text-sm font-bold text-primary mt-4 mb-2" {...props} />,
                      p: ({node, ...props}) => <p className="mb-3.5 text-foreground leading-relaxed font-sans text-xs md:text-sm font-medium" {...props} />,
                      ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 space-y-2 text-foreground font-sans text-xs md:text-sm font-medium" {...props} />,
                      ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-4 space-y-2 text-foreground font-sans text-xs md:text-sm font-medium" {...props} />,
                      li: ({node, ...props}) => <li className="leading-relaxed text-foreground" {...props} />,
                      hr: ({node, ...props}) => <hr className="border-t border-border my-6" {...props} />,
                      blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-primary pl-4 py-2 my-4 bg-accent rounded-r-lg text-xs md:text-sm text-foreground italic font-medium" {...props} />,
                      table: ({node, ...props}) => (
                        <div className="overflow-x-auto my-4 rounded-xl border border-border bg-card">
                          <table className="w-full text-left border-collapse text-[11px] md:text-xs" {...props} />
                        </div>
                      ),
                      thead: ({node, ...props}) => <thead className="bg-muted border-b border-border text-foreground font-bold" {...props} />,
                      th: ({node, ...props}) => <th className="p-2.5 font-bold text-[10px] uppercase tracking-wider text-foreground" {...props} />,
                      tbody: ({node, ...props}) => <tbody className="divide-y divide-border" {...props} />,
                      td: ({node, ...props}) => <td className="p-2.5 text-foreground font-sans leading-normal" {...props} />,
                      strong: ({node, ...props}) => <strong className="font-extrabold text-foreground" {...props} />,
                    }}>{cleanMarkdownText(activeEdital.reportMarkdown)}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="text-center py-10 space-y-2">
                    <div className="bg-warning/15 text-warning p-3 rounded-full w-12 h-12 flex items-center justify-center mx-auto border border-warning/40">
                      <ShieldAlert className="w-6 h-6" />
                    </div>
                    <h5 className="font-bold text-foreground text-sm">Parecer Executivo Indisponível</h5>
                    <p className="text-muted-foreground text-xs max-w-sm mx-auto leading-normal">
                      Este item do histórico não possui o parecer executivo formatado. Faça uma nova análise para visualizar o parecer executivo completo.
                    </p>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* TAB 2: DETAILED STRATEGIC PILLARS */}
          {analysisActiveTab === "struc" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in text-foreground">
              
              {/* Pillar 1: IDENTIFICATION */}
              <div className="bg-card border border-border rounded-xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 border-b border-border pb-2">
                  <Landmark className="w-4 h-4 text-primary shrink-0" />
                  <h4 className="font-bold text-foreground text-xs uppercase tracking-wide">1. Identificação do Certame</h4>
                </div>
                {activeEdital.identificacaoCertame ? (
                  <div className="text-xs space-y-3 leading-normal">
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Órgão Comprador / Unidade Gestora</span>
                      <span className="text-foreground font-semibold">{activeEdital.identificacaoCertame.orgaoComprador}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Modalidade do Processo</span>
                      <span className="text-foreground font-semibold">{activeEdital.identificacaoCertame.modalidade}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Identificação Numérica / PCE</span>
                      <span className="text-foreground font-semibold">{activeEdital.identificacaoCertame.identificacaoNumerica}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Sessão Pública (Data/Hora/Fuso)</span>
                      <span className="text-foreground font-extrabold flex items-center gap-1.5 mt-0.5 text-primary">
                        <Calendar className="w-3.5 h-3.5" />
                        {getDataHoraDisputa(activeEdital)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Link Direto no Portal PNCP</span>
                      {getPncpLink(activeEdital) ? (
                        <a
                          href={getPncpLink(activeEdital)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary font-bold hover:text-primary/80 hover:underline flex items-center gap-1 mt-0.5"
                        >
                          <Globe className="w-3.5 h-3.5 shrink-0" />
                          <span>Acessar Licitação no PNCP</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">Não informado</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 2: TECHNICAL SPECIFICATIONS & SNARES */}
              <div className="bg-card border border-border rounded-xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 border-b border-border pb-2">
                  <Gauge className="w-4 h-4 text-warning shrink-0" />
                  <h4 className="font-bold text-foreground text-xs uppercase tracking-wide">2. Especificações Técnicas & Pegadinhas</h4>
                </div>
                {activeEdital.especificacoesTecnicas ? (
                  <div className="text-xs space-y-4 pb-1">
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider mb-1.5">Exigências Físicas do Produto (Checklist Mandatório)</span>
                      <ul className="list-disc pl-4 space-y-1 text-foreground">
                        {getFilteredArray(activeEdital.especificacoesTecnicas.exigenciasFisicas).map((item, idx) => (
                          <li key={idx} className="leading-snug">{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <span className="text-warning block font-mono text-[9px] uppercase tracking-wider mb-1.5 font-bold">Pegadinhas Técnicas Ocultas / Risco de Desclassificação</span>
                      <ul className="list-disc pl-4 space-y-1 text-foreground">
                        {getFilteredArray(activeEdital.especificacoesTecnicas.pegadinhasOcultas).map((item, idx) => (
                          <li key={idx} className="leading-snug">{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 3: BUREAUCRACY & ENTRY BARRIERS */}
              <div className="bg-card border border-border rounded-xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 border-b border-border pb-2">
                  <ShieldAlert className="w-4 h-4 text-destructive shrink-0" />
                  <h4 className="font-bold text-foreground text-xs uppercase tracking-wide">3. Burocracia & Barreiras de Entrada</h4>
                </div>
                {activeEdital.burocraciaBarreiras ? (
                  <div className="text-xs space-y-3 leading-normal">
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Amostra Exigida?</span>
                      <span className="text-foreground font-semibold">{activeEdital.burocraciaBarreiras.exigeAmostra}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Carta de Solidariedade/Exclusividade?</span>
                      <span className="text-foreground font-semibold">{activeEdital.burocraciaBarreiras.exigeCartaSolidariedade}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Garantia de Proposta ou Contratual?</span>
                      <span className="text-foreground font-semibold">{activeEdital.burocraciaBarreiras.exigenciaGarantia}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Consórcios ou Subcontratações?</span>
                      <span className="text-foreground font-semibold">{activeEdital.burocraciaBarreiras.consorcioSubcontratacao}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 4: LOGISTICS & RISK ANALYSIS */}
              <div className="bg-card border border-border rounded-xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 border-b border-border pb-2">
                  <MapPin className="w-4 h-4 text-success shrink-0" />
                  <h4 className="font-bold text-foreground text-xs uppercase tracking-wide">4. Logística, Cronograma & Prazo</h4>
                </div>
                {activeEdital.logisticaCronograma ? (
                  <div className="text-xs space-y-3 leading-normal">
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Prazo Real de Entrega</span>
                      <span className="text-foreground font-semibold flex items-center gap-2">
                        {activeEdital.logisticaCronograma.prazoEntregaReal}
                        <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${
 activeEdital.logisticaCronograma.classificacaoPrazo.toLowerCase().includes("crít") || 
 activeEdital.logisticaCronograma.classificacaoPrazo.toLowerCase().includes("relâ")
 ? "bg-destructive/10 text-destructive border border-destructive/30" 
 : activeEdital.logisticaCronograma.classificacaoPrazo.toLowerCase().includes("aceit")
 ? "bg-warning/15 text-warning border border-warning/40"
 : "bg-success/10 text-success border border-success/30"
 }`}>
                          {activeEdital.logisticaCronograma.classificacaoPrazo}
                        </span>
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Endereço Exato & Almoxarifado</span>
                      <span className="text-foreground font-semibold">{activeEdital.logisticaCronograma.enderecoEntrega}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Prazo de Garantia Requerido</span>
                      <span className="text-foreground font-semibold">{activeEdital.logisticaCronograma.prazoGarantia}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 5: FINANCIAL VIABILITY */}
              <div className="bg-card border border-border rounded-xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 border-b border-border pb-2">
                  <Coins className="w-4 h-4 text-primary shrink-0" />
                  <h4 className="font-bold text-foreground text-xs uppercase tracking-wide">5. Viabilidade Financeira & Margem</h4>
                </div>
                {activeEdital.viabilidadeFinanceira ? (
                  <div className="text-xs space-y-3 leading-normal">
                    {activeEdital.itensEdital && activeEdital.itensEdital.length > 0 && (
                      <div className="bg-accent border border-primary/30 p-2.5 rounded-lg text-primary">
                        <span className="text-primary block font-mono text-[9px] uppercase tracking-wider font-bold">Valor Estimado (Itens Selecionados)</span>
                        <span className="text-foreground font-mono font-bold text-sm block mt-0.5">
                          {selectedStats.formattedValorEstimado}
                        </span>
                        <span className="text-[10px] text-muted-foreground block mt-0.5">
                          Referente a {selectedStats.count} de {selectedStats.totalEditalCount} itens ({selectedStats.totalQuantity} un)
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Valor Estimado Global (Edital Completo)</span>
                      <span className="text-foreground font-semibold">{activeEdital.viabilidadeFinanceira.valorEstimado}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Distorções Identificadas vs Mercado Privado</span>
                      <span className="text-foreground font-semibold">{activeEdital.viabilidadeFinanceira.distorcoesPreco}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-mono text-[9px] uppercase tracking-wider">Prazo de Recebimento de Pagamento</span>
                      <span className="text-foreground font-semibold">{activeEdital.viabilidadeFinanceira.prazoPagamento}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

              {/* Pillar 6: CONCLUDING RECOMMENDATION */}
              <div className="bg-accent border border-primary/30 rounded-xl p-5 space-y-3 lg:col-span-2 shadow-xs">
                <div className="flex items-center gap-2 border-b border-primary/30 pb-2">
                  <TrendingUp className="w-4 h-4 text-primary shrink-0" />
                  <h4 className="font-bold text-foreground text-xs uppercase tracking-wide">6. Parecer Final do Analista & Estratégia de Lances</h4>
                </div>
                {activeEdital.parecerFinal ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs leading-normal">
                    <div>
                      <span className="text-primary block font-mono text-[9px] uppercase tracking-wider font-bold">Veredito Final</span>
                      <span className="text-foreground font-bold bg-card px-2 py-1 rounded inline-block border border-primary/30 mt-1">{activeEdital.parecerFinal.veredito}</span>
                    </div>
                    <div>
                      <span className="text-primary block font-mono text-[9px] uppercase tracking-wider font-bold">Grau de Risco Global</span>
                      <span className={`px-2 py-1 rounded font-bold uppercase inline-block border mt-1 ${
 activeEdital.parecerFinal.grauRisco.toLowerCase().includes("alto") 
 ? "bg-destructive/10 text-destructive border-destructive/30" 
 : activeEdital.parecerFinal.grauRisco.toLowerCase().includes("médio")
 ? "bg-warning/15 text-warning border-warning/40"
 : "bg-success/10 text-success border-success/30"
 }`}>{activeEdital.parecerFinal.grauRisco}</span>
                    </div>
                    <div>
                      <span className="text-primary block font-mono text-[9px] uppercase tracking-wider font-bold">Estratégia Recomendada de Lances</span>
                      <span className="text-foreground block font-semibold mt-1 leading-snug">{activeEdital.parecerFinal.estrategiaLances}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-xs py-4 text-center">Indisponível para esta análise antiga do histórico.</p>
                )}
              </div>

            </div>
          )}

          {/* TAB 3: CHECKLIST & INSTANT ALERTS */}
          {analysisActiveTab === "checklist" && (
            <div className="space-y-6 animate-fade-in">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Opportunities (Oportunidades ou Pontos positivos) */}
                <div className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-xs">
                  <h4 className="font-bold text-foreground flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                    Pontos Positivos / Vantagens Competitivas
                  </h4>
                  <ul className="space-y-3 pl-1 text-xs text-foreground select-none">
                    {getFilteredArray(activeEdital.pontosPositivos).map((item, idx) => (
                      <li key={idx} className="flex gap-2.5 items-start">
                        <span className="bg-success/10 border border-success/30 text-success h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Warnings (Riscos ou Pegadinhas de Alerta) */}
                <div className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-xs">
                  <h4 className="font-bold text-foreground flex items-center gap-2 text-sm">
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                    Pontos de Alerta / Atenção e Riscos
                  </h4>
                  <ul className="space-y-3 pl-1 text-xs text-foreground select-none">
                    {getFilteredArray(activeEdital.pontosAlerta).map((item, idx) => (
                      <li key={idx} className="flex gap-2.5 items-start">
                        <span className="bg-warning/15 border border-warning/40 text-warning h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">
                          {idx + 1}
                        </span>
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Habilitation Documents checklist */}
                <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 space-y-4 shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
                    <div className="flex items-center gap-2">
                      <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                      <h4 className="font-bold text-foreground text-sm">
                        Certidões e Documentos Exigidos na Disputa
                      </h4>
                    </div>
                    <span className="text-xs bg-accent text-primary border border-primary/30 px-2.5 py-1 rounded-full font-semibold">
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
                          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex items-start gap-3 text-xs text-destructive animate-fade-in shadow-xs">
                            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <h5 className="font-bold text-destructive text-sm">
                                  Alerta Crítico de Habilitação na Disputa
                                </h5>
                                <span className="bg-destructive/15 text-destructive px-2 py-0.5 rounded text-[10px] font-bold border border-destructive/40">
                                  {warnings.length} {warnings.length === 1 ? 'pendência' : 'pendências'}
                                </span>
                              </div>
                              <p className="text-destructive leading-relaxed">
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
 ? "bg-destructive/60 border-destructive/30 text-destructive shadow-xs" 
 : "bg-muted border-border text-foreground "
 }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-2.5">
                                  <div className={`h-6 w-6 font-bold rounded-lg flex items-center justify-center shrink-0 text-[10px] mt-0.5 ${
 item.isWarning 
 ? "bg-destructive/15 text-destructive border border-destructive/40 " 
 : "bg-accent text-primary border border-primary/30 "
 }`}>
                                    {idx + 1}
                                  </div>
                                  <span className="font-semibold text-foreground leading-snug">{item.doc}</span>
                                </div>

                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase shrink-0 font-mono ${item.badgeColor}`}>
                                  {item.badgeText}
                                </span>
                              </div>

                              {/* Status or warning note */}
                              <div className={`text-[11px] pt-2 border-t flex flex-wrap items-center justify-between gap-2 ${
 item.isWarning 
 ? "border-destructive/80 text-destructive font-medium" 
 : "border-border text-muted-foreground "
 }`}>
                                <span className="leading-tight flex items-center gap-1.5">
                                  {item.isWarning && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                                  {!item.isWarning && item.statusType === "valid" && <ShieldCheck className="w-3.5 h-3.5 text-success shrink-0" />}
                                  {item.message}
                                </span>
                                {item.matchedCert && (
                                  <span className="text-[9px] text-muted-foreground font-mono shrink-0">
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
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/60 backdrop-blur-sm overflow-y-auto animate-fade-in">
          <div className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[92vh] sm:max-h-[88vh] overflow-hidden shadow-2xl flex flex-col my-auto">
            
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between bg-muted shrink-0">
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <div className="bg-accent text-primary p-2 rounded-xl border border-primary/30 shrink-0">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-foreground text-sm sm:text-base truncate">Configurar Valores e Dados da Proposta</h3>
                  <p className="text-muted-foreground text-[11px] sm:text-xs truncate">Preencha os valores solicitados pelo edital. O modelo PDF se adaptará automaticamente.</p>
                </div>
              </div>
              <button 
                onClick={() => setShowProposalModal(false)}
                className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg transition-colors bg-card border border-border cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 overflow-y-auto flex-1 font-sans text-xs">
              
              {/* File Title and Header Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-foreground mb-1">Título do Documento PDF</label>
                  <input 
                    type="text"
                    value={proposalFileTitle}
                    onChange={(e) => setProposalFileTitle(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Ex: Proposta Comercial - Dispensa 046-2026.pdf"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Este será o nome do arquivo quando você fizer o download ou imprimir.</p>
                </div>

                <div>
                  <label className="block font-semibold text-foreground mb-1">Identificação / Modalidade / Pregão</label>
                  <input 
                    type="text"
                    value={proposalDispensa}
                    onChange={(e) => setProposalDispensa(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Ex: Dispensa de Licitação nº 046/2026"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-foreground mb-1">Número do Processo Administrativo</label>
                  <input 
                    type="text"
                    value={proposalProcesso}
                    onChange={(e) => setProposalProcesso(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Ex: Processo Administrativo nº 209/2026"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-foreground mb-1">Órgão Público Destinatário</label>
                  <input 
                    type="text"
                    value={proposalOrgao}
                    onChange={(e) => setProposalOrgao(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Ex: Secretaria Municipal de Educação de Juazeiro/BA"
                  />
                </div>
              </div>

              {/* Proposal Object */}
              <div>
                <label className="block font-semibold text-foreground mb-1">Objeto da Proposta / Introdução</label>
                <textarea 
                  value={proposalObject}
                  onChange={(e) => setProposalObject(e.target.value)}
                  rows={2}
                  className="w-full bg-card border border-border rounded-lg p-3 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Escreva breve resumo do fornecimento..."
                />
              </div>

              {/* Editable Items Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <h4 className="font-bold text-foreground text-sm flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-primary" />
                    Itens, Quantidades e Preços (Planilha Orçamentária)
                  </h4>
                  <button
                    type="button"
                    onClick={handleAddProposalItem}
                    className="px-3 py-1.5 bg-accent text-primary border border-primary/30 hover:bg-accent rounded-md font-semibold flex items-center gap-1 transition-all cursor-pointer text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar Item
                  </button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-border bg-muted max-h-[250px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-muted sticky top-0 border-b border-border">
                      <tr>
                        <th className="p-3 text-muted-foreground font-semibold w-12">#</th>
                        <th className="p-3 text-muted-foreground font-semibold w-1/2">Descrição Detalhada do Item</th>
                        <th className="p-3 text-muted-foreground font-semibold w-20">Qtd</th>
                        <th className="p-3 text-muted-foreground font-semibold">Marca / Modelo</th>
                        <th className="p-3 text-muted-foreground font-semibold w-28">Val. Unitário</th>
                        <th className="p-3 text-muted-foreground font-semibold w-28">Val. Total</th>
                        <th className="p-3 text-muted-foreground font-semibold w-12">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {proposalItems.map((item, index) => (
                        <tr key={index} className="hover:bg-card transition-colors">
                          <td className="p-3 text-muted-foreground font-mono font-semibold">{index + 1}</td>
                          <td className="p-3">
                            <textarea
                              rows={2}
                              value={item.description}
                              onChange={(e) => handleItemChange(index, "description", e.target.value)}
                              className="w-full bg-card border border-border rounded-md p-1.5 text-[11px] text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                              placeholder="Ex: Fone de ouvido profissional USB com cancelador..."
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(index, "quantity", parseInt(e.target.value) || 1)}
                              className="w-full bg-card border border-border rounded-md p-1.5 text-center text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                            />
                          </td>
                          <td className="p-3">
                            <input
                              type="text"
                              value={item.brandModel}
                              onChange={(e) => handleItemChange(index, "brandModel", e.target.value)}
                              className="w-full bg-card border border-border rounded-md p-1.5 text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                              placeholder="Ex: Epson L210"
                            />
                          </td>
                          <td className="p-3">
                            <div className="relative">
                              <span className="absolute left-1.5 top-2 text-muted-foreground text-[10px]">R$</span>
                              <input
                                type="text"
                                value={item.unitValue}
                                onChange={(e) => handleItemChange(index, "unitValue", e.target.value)}
                                className="w-full bg-card border border-border rounded-md py-1.5 pl-6 pr-1.5 text-foreground focus:ring-1 focus:ring-primary focus:outline-none font-mono"
                                placeholder="0,00"
                              />
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="relative">
                              <span className="absolute left-1.5 top-2 text-muted-foreground text-[10px]">R$</span>
                              <input
                                type="text"
                                value={item.totalValue}
                                onChange={(e) => handleItemChange(index, "totalValue", e.target.value)}
                                className="w-full bg-card border border-border rounded-md py-1.5 pl-6 pr-1.5 text-foreground focus:ring-1 focus:ring-primary focus:outline-none font-mono font-bold"
                                placeholder="0,00"
                              />
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveProposalItem(index)}
                              className="p-1.5 text-destructive hover:bg-destructive/10 rounded-md transition-all cursor-pointer border border-transparent hover:border-destructive/30"
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
                <div className="bg-muted border border-border rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider block">Valor Total Global (Soma de Itens)</span>
                    <span className="text-xl font-bold text-success font-mono">R$ {formatCurrency(getGlobalSum())}</span>
                  </div>
                  <div className="flex-1 md:text-right">
                    <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider block">Total por Extenso</span>
                    <span className="text-foreground font-semibold italic">"{numeroParaExtenso(getGlobalSum())}"</span>
                  </div>
                </div>
              </div>

              {/* Conditions / Condições Comerciais */}
              <div className="bg-muted border border-border rounded-xl p-4 space-y-4">
                <h4 className="font-bold text-foreground text-xs uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  3. Condições Comerciais Obrigatórias
                </h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-foreground mb-1">Prazo de Validade da Proposta</label>
                    <input 
                      type="text"
                      value={valPrazo}
                      onChange={(e) => setValPrazo(e.target.value)}
                      className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground placeholder-muted-foreground focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-foreground mb-1">Condições de Pagamento</label>
                    <input 
                      type="text"
                      value={valPgto}
                      onChange={(e) => setValPgto(e.target.value)}
                      className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground placeholder-muted-foreground focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-foreground mb-1">Prazo de Entrega</label>
                    <input 
                      type="text"
                      value={valEntrega}
                      onChange={(e) => setValEntrega(e.target.value)}
                      className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground placeholder-muted-foreground focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-foreground mb-1">Local de Entrega</label>
                    <input 
                      type="text"
                      value={valLocal}
                      onChange={(e) => setValLocal(e.target.value)}
                      className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground placeholder-muted-foreground focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Data da Proposta */}
              <div>
                <label className="block font-semibold text-foreground mb-1">Local e Data de Emissão</label>
                <input 
                  type="text"
                  value={proposalDate}
                  onChange={(e) => setProposalDate(e.target.value)}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-sans"
                />
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-3.5 sm:p-5 border-t border-border flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 sm:gap-3 bg-muted shrink-0">
              <button
                type="button"
                onClick={() => setShowProposalModal(false)}
                className="w-full sm:w-auto px-4 py-2 border border-border text-foreground rounded-xl font-semibold hover:bg-card hover:text-foreground transition-all cursor-pointer text-xs text-center"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGenerateProposal}
                className="w-full sm:w-auto px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer text-xs text-center"
              >
                {generatingDoc === "proposal" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Gerando Proposta...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-primary/30" />
                    <span>Gerar Proposta Oficial PDF</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Modal Popup de Alerta de Tamanho de Arquivo Excedido (> 60MB) */}
      {fileSizeErrorModal && fileSizeErrorModal.show && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-card border border-destructive/30 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl relative space-y-4 sm:space-y-5 overflow-hidden text-left my-auto">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-destructive" />
            
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive shrink-0">
                <AlertTriangle className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base sm:text-lg font-bold text-foreground leading-tight">
                  Arquivo Maior que 60 MB
                </h3>
                <p className="text-xs text-destructive font-medium">
                  Tamanho limite por anexo: <span className="underline font-bold">60 MB</span>
                </p>
              </div>
            </div>

            <div className="bg-muted border border-border rounded-xl p-3.5 sm:p-4 text-xs space-y-3 text-foreground">
              <p className="leading-relaxed">
                O arquivo <strong className="text-foreground">"{fileSizeErrorModal.fileName}"</strong> possui <strong className="text-destructive font-semibold">{fileSizeErrorModal.fileSizeMb} MB</strong> e excede o limite máximo permitido.
              </p>
              <div className="space-y-1.5 text-muted-foreground border-t border-border pt-2.5">
                <p className="font-semibold text-foreground">💡 Como proceder:</p>
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
                className="w-full sm:w-auto px-5 py-2.5 bg-destructive hover:bg-destructive/90 text-white rounded-xl font-semibold shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer text-xs"
              >
                <Check className="w-4 h-4" />
                <span>Entendido</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
