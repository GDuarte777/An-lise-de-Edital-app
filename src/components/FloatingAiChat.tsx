import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { ChatMessage, ChatSession, CompanyData, EditalAnalysis, Attachment } from "../types";
import { 
  MessageSquare, X, Send, Bot, User, Sparkles, Loader2, Plus, Trash2, 
  Paperclip, Image, FileText, ChevronLeft, Edit2, Check, ArrowRight, RotateCcw,
  FolderOpen, FileCheck, Download, Eye, ClipboardCopy, CheckSquare, Globe, Database, Printer,
  ChevronDown, Search, AlertTriangle, Maximize2, Minimize2, Square
} from "lucide-react";
import confetti from "canvas-confetti";
import { getActiveAiConfig, apiFetch, formatAiError } from "../utils/aiClientHelper";
import { addSyncedItem } from "../utils/googleSync";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import { 
  callSupabaseGeminiEdgeFunction,
  fetchChatSessionsFromSupabase,
  saveChatSessionToSupabase,
  deleteChatSessionFromSupabase,
  clearAllChatSessionsInSupabase,
  fetchEditaisFromSupabase,
  subscribeToSupabaseTable
} from "../utils/supabaseClient";

interface FloatingAiChatProps {
  companyData: CompanyData;
  activeEdital: EditalAnalysis | null;
}

const CONSTANT_SUGGESTIONS = [
  "Quais certidões são recomendadas para nossa empresa?",
  "O laptop do edital atende às especificações necessárias?",
  "O que fazer se uma certidão vencer durante a licitação?",
  "Me passe conselhos para uma ME/EPP vencer pregões."
];

const DELETED_SESSIONS_KEY = "aip_deleted_chat_session_ids";

function getDeletedSessionIds(): string[] {
  try {
    const saved = localStorage.getItem(DELETED_SESSIONS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function addDeletedSessionId(id: string) {
  try {
    const current = getDeletedSessionIds();
    if (!current.includes(id)) {
      current.push(id);
      localStorage.setItem(DELETED_SESSIONS_KEY, JSON.stringify(current));
    }
  } catch (e) {
    console.error(e);
  }
}

function addMultipleDeletedSessionIds(ids: string[]) {
  try {
    const current = new Set(getDeletedSessionIds());
    ids.forEach(id => current.add(id));
    localStorage.setItem(DELETED_SESSIONS_KEY, JSON.stringify(Array.from(current)));
  } catch (e) {
    console.error(e);
  }
}

const MAX_CHATS_PER_USER = 20;
const MAX_MESSAGES_PER_CHAT = 200;

export default function FloatingAiChat({ companyData, activeEdital }: FloatingAiChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showSidebarMobile, setShowSidebarMobile] = useState(true);
  
  // Storage & Message Limit Modal State
  const [chatLimitModal, setChatLimitModal] = useState<{
    show: boolean;
    reason: "chat_count" | "message_count";
    currentCount: number;
    maxCount: number;
  } | null>(null);
  
  // Track unread messages status (defaults to true for visibility on first load)
  const [hasUnread, setHasUnread] = useState(() => {
    const saved = localStorage.getItem("aip_chat_has_unread");
    return saved !== "false";
  });

  // Clear unread indicator when opened
  useEffect(() => {
    if (isOpen) {
      setHasUnread(false);
      localStorage.setItem("aip_chat_has_unread", "false");
    }
  }, [isOpen]);
  
  // Multiple sessions state
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const deletedIds = getDeletedSessionIds();
    const saved = localStorage.getItem("aip_chat_sessions");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed.filter((s: ChatSession) => s && s.id && !deletedIds.includes(s.id));
          if (valid.length > 0) {
            return valid;
          }
        }
      } catch (e) {
        console.error("Erro ao carregar sessões de chat:", e);
      }
    }

    // Default first session
    return [
      {
        id: "chat-default",
        title: "Chat Principal",
        selectedEditalId: "",
        messages: [
          {
            id: "msg-init",
            role: "assistant",
            content: `Olá! Sou o seu **Assessor de Licitações Inteligente**. Como posso te ajudar hoje?
        
Posso analisar editais, validar exigências fiscais contra suas certidões atuais, ou redigir recursos jurídicos para recursos. Sinta-se livre para tirar dúvidas!`,
            timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
          }
        ],
        createdAt: new Date().toLocaleString("pt-BR")
      }
    ];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return sessions[0]?.id || "chat-default";
  });

  // Loaded edital history
  const [editalHistory, setEditalHistory] = useState<any[]>([]);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // States for the modernized custom selector
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownSearch, setDropdownSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load edital history from localStorage or Supabase dynamically
  const reloadEditalHistory = async () => {
    let list: any[] = [];
    const saved = localStorage.getItem("aip_edital_history");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          list = parsed;
        }
      } catch (e) {
        console.error("Erro ao carregar histórico de editais:", e);
      }
    }

    if (list.length === 0) {
      try {
        const dbEditais = await fetchEditaisFromSupabase();
        if (dbEditais && dbEditais.length > 0) {
          list = dbEditais;
          localStorage.setItem("aip_edital_history", JSON.stringify(dbEditais));
        }
      } catch (e) {
        // silent fallback
      }
    }

    setEditalHistory(prev => {
      if (JSON.stringify(prev) === JSON.stringify(list)) {
        return prev;
      }
      return list;
    });
  };

  // Keep editalHistory always in sync via event listeners
  useEffect(() => {
    reloadEditalHistory(); // Sync on mount

    const handleStorageChange = (e: StorageEvent) => {
      if (!e.key || e.key === "aip_edital_history") {
        reloadEditalHistory();
      }
    };

    const handleCustomUpdate = () => {
      reloadEditalHistory();
    };

    const handleEditalAnalyzed = (e: any) => {
      reloadEditalHistory();
      if (e?.detail?.id) {
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, selectedEditalId: e.detail.id } : s));
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("aip_edital_history_updated", handleCustomUpdate);
    window.addEventListener("aip_edital_analyzed", handleEditalAnalyzed);
    window.addEventListener("focus", handleCustomUpdate);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("aip_edital_history_updated", handleCustomUpdate);
      window.removeEventListener("aip_edital_analyzed", handleEditalAnalyzed);
      window.removeEventListener("focus", handleCustomUpdate);
    };
  }, [activeSessionId]);

  // Sync again when chat is opened
  useEffect(() => {
    if (isOpen) {
      reloadEditalHistory();
    }
  }, [isOpen]);

  // Click outside to close the custom selector dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const [inputVal, setInputVal] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);

  // System document selector & document preview state variables
  const [showSystemDocSelector, setShowSystemDocSelector] = useState(false);
  const [systemCerts, setSystemCerts] = useState<any[]>([]);
  const [previewDocTitle, setPreviewDocTitle] = useState<string | null>(null);
  const [previewDocContent, setPreviewDocContent] = useState<string | null>(null);

  // Load certificates from localStorage
  const loadSystemCertificates = () => {
    const saved = localStorage.getItem("aip_certificates");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return [];
  };

  // Helper to count words
  const getWordCount = (text: string) => {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  };

  const cleanMathAndLatex = (text: string) => {
    if (!text) return "";
    let cleaned = text;

    // Clean $$ ... $$ and $ ... $
    cleaned = cleaned.replace(/\$\$(.*?)\$\$/gs, (_, formula) => formula);
    cleaned = cleaned.replace(/\$(.*?)\$/g, (_, formula) => formula);

    // Replace LaTeX symbols with readable text
    cleaned = cleaned
      .replace(/\\text\{([^}]*)\}/g, "$1")
      .replace(/\\times/g, "x")
      .replace(/\\cdot/g, "x")
      .replace(/\\rightarrow/g, "→")
      .replace(/\\leftarrow/g, "←")
      .replace(/\\Rightarrow/g, "=>")
      .replace(/\\approx/g, "≈")
      .replace(/\\le/g, "≤")
      .replace(/\\ge/g, "≥")
      .replace(/\\neq/g, "≠")
      .replace(/\\/g, "");

    return cleaned;
  };

  // Parse message content into text blocks and generated_document blocks
  const parseMessageContent = (rawContent: string) => {
    const content = cleanMathAndLatex(rawContent);
    const parts: { type: "text" | "document"; content: string; title?: string }[] = [];
    const regex = /<generated_document\s+title="([^"]+)">([\s\S]*?)<\/generated_document>/gi;
    
    let lastIndex = 0;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      const matchIndex = match.index;
      
      if (matchIndex > lastIndex) {
        parts.push({
          type: "text",
          content: content.substring(lastIndex, matchIndex)
        });
      }
      
      parts.push({
        type: "document",
        title: match[1],
        content: match[2]
      });
      
      lastIndex = regex.lastIndex;
    }
    
    if (lastIndex < content.length) {
      parts.push({
        type: "text",
        content: content.substring(lastIndex)
      });
    }
    
    if (parts.length === 0) {
      return [{ type: "text", content }];
    }
    
    return parts;
  };

  // Helper to format certificate context
  const formatCertificateText = (cert: any) => {
    return `==========================================
DOCUMENTO DO SISTEMA: ${cert.name}
==========================================
ID do Registro: ${cert.id}
Tipo / Nome: ${cert.name}
Status Atual no Sistema: ${cert.status === 'valid' ? 'VÁLIDA (Regular)' : cert.status === 'expiring_soon' ? 'VENCENDO EM BREVE' : 'VENCIDA OU PENDENTE'}
Data de Emissão: ${cert.emissionDate || 'Não informada'}
Data de Validade: ${cert.expirationDate || 'Não informada'}
Arquivo físico enviado: ${cert.fileUploaded ? 'Sim (' + (cert.fileName || 'Anexo') + ')' : 'Não'}
Resultado da Verificação: ${cert.validationFeedback || 'Documento carregado no perfil da empresa. Em conformidade.'}
Notas Adicionais: ${cert.notes || 'Nenhuma.'}`;
  };

  // Helper to format edital context
  const formatEditalText = (edital: any) => {
    const organ = edital.identificacaoCertame?.orgaoComprador || "Órgão Não Identificado";
    const mod = edital.identificacaoCertame?.modalidade || "Modalidade Geral";
    const num = edital.identificacaoCertame?.identificacaoNumerica || "Nº Não Identificado";
    
    return `==========================================
EDITAL DO SISTEMA: ${organ} - ${num}
==========================================
Órgão Licitante: ${organ}
Modalidade: ${mod}
Identificação Numérica: ${num}
Sessão / Abertura: ${edital.identificacaoCertame?.dataHoraSessao || 'Não especificada'}

CRONOGRAMA E LOGÍSTICA:
- Prazo de Entrega: ${edital.prazoEntrega || 'Não informado'}
- Endereço de Entrega: ${edital.logisticaCronograma?.enderecoEntrega || 'Não especificado'}
- Prazo de Garantia: ${edital.logisticaCronograma?.prazoGarantia || 'Não informado'}

VIABILIDADE E ORÇAMENTO:
- Prazo de Pagamento: ${edital.prazoPagamento || 'Não informado'}
- Valor Estimado: ${edital.viabilidadeFinanceira?.valorEstimado || 'Não informado'}
- Distorções de Preço / Pegadinhas: ${edital.viabilidadeFinanceira?.distorcoesPreco || 'Nenhuma identificada'}

BUROCRACIA E BARREIRAS:
- Exige Amostra: ${edital.burocraciaBarreiras?.exigeAmostra || 'Não'}
- Exige Carta de Solidariedade: ${edital.burocraciaBarreiras?.exigeCartaSolidariedade || 'Não'}
- Exigência de Garantia contratual: ${edital.burocraciaBarreiras?.exigenciaGarantia || 'Não'}
- Consórcio / Subcontratação: ${edital.burocraciaBarreiras?.consorcioSubcontratacao || 'Não'}

ESPECIFICAÇÕES DO PRODUTO:
${edital.descricaoProduto || 'Não informado'}

DOCUMENTOS E CERTIDÕES EXIGIDAS NO EDITAL:
${edital.documentosExigidos?.map((doc: string) => `- ${doc}`).join('\n') || 'Nenhum listado'}

PONTOS DE ATENÇÃO (ALERTAS):
${edital.pontosAlerta?.map((p: string) => `- ${p}`).join('\n') || 'Nenhum'}

PONTOS POSITIVOS:
${edital.pontosPositivos?.map((p: string) => `- ${p}`).join('\n') || 'Nenhum'}

PARECER E ESTRATÉGIA:
- Veredito: ${edital.parecerFinal?.veredito || 'Sem parecer'}
- Grau de Risco: ${edital.parecerFinal?.grauRisco || 'Médio'}
- Estratégia Recomendada: ${edital.parecerFinal?.estrategiaLances || 'Competir de forma regular'}`;
  };

  const handleOpenSystemDocSelector = () => {
    reloadEditalHistory();
    const saved = localStorage.getItem("aip_certificates");
    if (saved) {
      try {
        setSystemCerts(JSON.parse(saved));
      } catch (e) {
        console.error("Erro ao carregar certidões do sistema:", e);
      }
    } else {
      setSystemCerts([]);
    }
    setShowSystemDocSelector(true);
  };

  const handleSelectSystemCert = (cert: any) => {
    const textContent = formatCertificateText(cert);
    setSelectedAttachment({
      name: `Certidão_${cert.id}.txt`,
      type: "application/system-doc",
      data: textContent
    });
    setShowSystemDocSelector(false);
    confetti({ particleCount: 15, spread: 30, colors: ["#6366f1", "#4f46e5"] });
  };

  const handleSelectSystemEdital = (editalItem: any) => {
    const edital = editalItem.analysis || editalItem;
    const organName = edital.identificacaoCertame?.orgaoComprador || "OrgaoLicitante";
    const cleanOrganName = organName.replace(/[^a-zA-Z0-0]/g, "_").substring(0, 15);
    const title = editalItem.title || `Edital_${cleanOrganName}.txt`;
    const textContent = formatEditalText(edital);
    setSelectedAttachment({
      name: title.endsWith(".txt") ? title : `${title}.txt`,
      type: "application/system-doc",
      data: textContent
    });
    setShowSystemDocSelector(false);
    confetti({ particleCount: 15, spread: 30, colors: ["#6366f1", "#4f46e5"] });
  };

  // Editing session title states
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionTitleInput, setSessionTitleInput] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        const cancelMsg: ChatMessage = {
          id: `msg-cancel-${Date.now()}`,
          role: "assistant",
          content: "⏹️ **Envio interrompido pelo usuário.**",
          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        };
        return { ...s, messages: [...s.messages, cancelMsg] };
      }
      return s;
    }));
  };

  // Resizing configuration & state
  const DEFAULT_WIDTH = 860;
  const DEFAULT_HEIGHT = 580;
  const [showClearConfirmModal, setShowClearConfirmModal] = useState(false);
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem("aip_chat_width");
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const [height, setHeight] = useState(() => {
    const saved = localStorage.getItem("aip_chat_height");
    return saved ? parseInt(saved, 10) : DEFAULT_HEIGHT;
  });
  const [isDesktop, setIsDesktop] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    const checkIsDesktop = () => setIsDesktop(window.innerWidth >= 768);
    checkIsDesktop();
    window.addEventListener("resize", checkIsDesktop);
    return () => window.removeEventListener("resize", checkIsDesktop);
  }, []);

  const handleResizeStart = (e: React.MouseEvent, direction: "top" | "left" | "top-left") => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = width;
    const startHeight = height;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (direction === "left" || direction === "top-left") {
        const deltaX = startX - moveEvent.clientX;
        const newWidth = Math.max(400, Math.min(1600, startWidth + deltaX));
        setWidth(newWidth);
        localStorage.setItem("aip_chat_width", String(newWidth));
      }
      if (direction === "top" || direction === "top-left") {
        const deltaY = startY - moveEvent.clientY;
        const newHeight = Math.max(300, Math.min(1200, startHeight + deltaY));
        setHeight(newHeight);
        localStorage.setItem("aip_chat_height", String(newHeight));
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };

    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const extractLocalTitle = (text: string): string => {
    if (!text) return "Conversa Rápida";
    const clean = text.replace(/[^\w\sÀ-ÿ]/g, "").trim();
    const words = clean.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return "Conversa Rápida";
    const titleWords = words.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    return titleWords.join(" ");
  };

  const [isLoadedFromDb, setIsLoadedFromDb] = useState(false);
  // Ref to track the previous sessions for change detection (prevents unnecessary Supabase writes)
  const prevSessionsRef = useRef<string>("");
  // Debounce timer for Supabase sync
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load from Supabase ONCE on mount — NO Realtime subscription to avoid infinite loop
  useEffect(() => {
    async function loadChatSessions() {
      try {
        const dbSessions = await fetchChatSessionsFromSupabase();
        const deletedIds = getDeletedSessionIds();

        if (dbSessions !== null) {
          // Clean up already-deleted sessions from Supabase silently
          const dbDeleted = dbSessions.filter(s => s && s.id && deletedIds.includes(s.id));
          for (const s of dbDeleted) {
            deleteChatSessionFromSupabase(s.id).catch(() => {});
          }

          const validDbSessions = dbSessions.filter(s => s && s.id && !deletedIds.includes(s.id));

          if (validDbSessions.length > 0) {
            // Limit to MAX_CHATS_PER_USER to prevent runaway accumulation
            const limitedSessions = validDbSessions.slice(0, MAX_CHATS_PER_USER);
            // If DB had more than limit, delete the extras from Supabase
            if (validDbSessions.length > MAX_CHATS_PER_USER) {
              validDbSessions.slice(MAX_CHATS_PER_USER).forEach(s => {
                deleteChatSessionFromSupabase(s.id).catch(() => {});
              });
            }
            setSessions(limitedSessions);
            setActiveSessionId(limitedSessions[0].id);
            localStorage.setItem("aip_chat_sessions", JSON.stringify(limitedSessions));
            // Seed the prev ref so the sync effect doesn't immediately re-sync
            prevSessionsRef.current = JSON.stringify(limitedSessions);
          } else {
            // DB is empty or all sessions are deleted — use existing local state, DO NOT create a new one here
            // (local state is already initialised from localStorage in useState)
            prevSessionsRef.current = JSON.stringify(sessions);
          }
        }
      } catch (e) {
        console.warn("Erro ao carregar sessões de chat do Supabase:", e);
      } finally {
        setIsLoadedFromDb(true);
      }
    }
    loadChatSessions();
    // ⚠️ IMPORTANT: NO Realtime subscription here — subscribing to sessoes_chat caused an
    // infinite loop: save → Realtime event → loadChatSessions → save → event → ...
    // Sessions are synced to Supabase via the debounced effect below instead.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync sessions with localStorage + Supabase (debounced, only on real changes)
  useEffect(() => {
    if (!isLoadedFromDb) return;

    const deletedIds = getDeletedSessionIds();
    const validSessions = sessions.filter(s => s && s.id && !deletedIds.includes(s.id));

    // Always sync localStorage immediately
    localStorage.setItem("aip_chat_sessions", JSON.stringify(validSessions));

    // Scroll to bottom
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }

    // Debounced Supabase sync — only write when sessions actually changed
    const serialized = JSON.stringify(validSessions);
    if (serialized === prevSessionsRef.current) return; // no real change, skip Supabase write
    prevSessionsRef.current = serialized;

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      validSessions.forEach(session => {
        saveChatSessionToSupabase(session).catch(e =>
          console.warn("[Chat Sync] Erro ao salvar sessão no Supabase:", e)
        );
      });
    }, 800); // 800ms debounce prevents cascading writes
  }, [sessions, isLoadedFromDb]); // ⚠️ isOpen and activeSessionId intentionally removed to prevent spurious syncs

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];

  const getSelectedEditalObject = (selectedId: string) => {
    if (selectedId === "active") {
      return activeEdital;
    }
    const item = editalHistory.find(h => h.id === selectedId);
    if (item) {
      return item.analysis || item;
    }
    return null;
  };

  const handleNewChat = () => {
    if (sessions.length >= MAX_CHATS_PER_USER) {
      setChatLimitModal({
        show: true,
        reason: "chat_count",
        currentCount: sessions.length,
        maxCount: MAX_CHATS_PER_USER
      });
      return;
    }

    const newId = `chat-${Date.now()}`;
    const newSession: ChatSession = {
      id: newId,
      title: `Conversa ${sessions.length + 1}`,
      selectedEditalId: "",
      messages: [
        {
          id: `msg-init-${Date.now()}`,
          role: "assistant",
          content: "Olá! Este é um novo chat. Envie suas dúvidas de licitação ou anexe um edital/imagem para ser examinado.",
          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        }
      ],
      createdAt: new Date().toLocaleString("pt-BR")
    };

    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(newId);
    setShowSidebarMobile(false);
  };

  const handleDeleteChat = async (e: React.MouseEvent, idToDelete: string) => {
    e.stopPropagation();
    
    // 1. Grava no registro local de exclusões permanentes
    addDeletedSessionId(idToDelete);

    // 2. Deleta permanentemente no Supabase
    try {
      await deleteChatSessionFromSupabase(idToDelete);
    } catch (err) {
      console.warn("Erro ao deletar sessão de chat do Supabase:", err);
    }

    // 3. Atualiza estado local e localStorage
    const updated = sessions.filter(s => s.id !== idToDelete);
    
    if (updated.length === 0) {
      const newDefaultId = `chat-${Date.now()}`;
      const defaultS: ChatSession = {
        id: newDefaultId,
        title: "Chat Principal",
        selectedEditalId: activeEdital ? "active" : "",
        messages: [
          {
            id: `msg-init-${Date.now()}`,
            role: "assistant",
            content: `Olá! Sou o seu **Assessor de Licitações Inteligente HORASIS**. Como posso te ajudar hoje?`,
            timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
          }
        ],
        createdAt: new Date().toLocaleString("pt-BR")
      };
      setSessions([defaultS]);
      setActiveSessionId(newDefaultId);
      localStorage.setItem("aip_chat_sessions", JSON.stringify([defaultS]));
      await saveChatSessionToSupabase(defaultS).catch(() => {});
    } else {
      setSessions(updated);
      localStorage.setItem("aip_chat_sessions", JSON.stringify(updated));
      if (activeSessionId === idToDelete) {
        setActiveSessionId(updated[0].id);
      }
    }

    confetti({ particleCount: 30, spread: 40, colors: ["#ef4444", "#f87171"] });
    setShowSidebarMobile(true);
  };

  const handleClearAllChats = async () => {
    setShowClearConfirmModal(false);

    // 1. Adiciona todas as sessões existentes na blacklist permanente de exclusão
    const currentIds = sessions.map(s => s.id);
    addMultipleDeletedSessionIds(currentIds);

    // 2. Apaga no Supabase
    try {
      await clearAllChatSessionsInSupabase();
    } catch (err) {
      console.warn("Erro ao limpar histórico no Supabase:", err);
    }

    // 3. Limpa localStorage
    localStorage.removeItem("aip_chat_sessions");

    // 4. Inicia um novo chat padrão com ID único
    const newDefaultId = `chat-${Date.now()}`;
    const defaultS: ChatSession = {
      id: newDefaultId,
      title: "Chat Principal",
      selectedEditalId: activeEdital ? "active" : "",
      messages: [
        {
          id: `msg-init-${Date.now()}`,
          role: "assistant",
          content: `Olá! Sou o seu **Assessor de Licitações Inteligente HORASIS**. Como posso te ajudar hoje?`,
          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        }
      ],
      createdAt: new Date().toLocaleString("pt-BR")
    };

    setSessions([defaultS]);
    setActiveSessionId(newDefaultId);
    localStorage.setItem("aip_chat_sessions", JSON.stringify([defaultS]));
    await saveChatSessionToSupabase(defaultS).catch(() => {});

    confetti({ particleCount: 50, spread: 60, colors: ["#ef4444", "#f87171"] });
  };

  const handleStartRename = (e: React.MouseEvent, s: ChatSession) => {
    e.stopPropagation();
    setEditingSessionId(s.id);
    setSessionTitleInput(s.title);
  };

  const handleSaveRename = (idToRename: string) => {
    if (sessionTitleInput.trim() === "") return;
    setSessions(prev => prev.map(s => {
      if (s.id === idToRename) {
        return { ...s, title: sessionTitleInput.trim() };
      }
      return s;
    }));
    setEditingSessionId(null);
  };

  const handleSelectEdital = (editalId: string) => {
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, selectedEditalId: editalId };
      }
      return s;
    }));
  };

  const handleFileAttachmentClick = () => {
    attachmentInputRef.current?.click();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        if (!file) continue;

        // Reject files larger than 100MB
        if (file.size > 100 * 1024 * 1024) {
          alert("A imagem colada excede o limite de 100MB.");
          continue;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          const base64Data = event.target?.result as string;
          setSelectedAttachment({
            name: file.name || `imagem-colada-${Date.now()}.png`,
            type: file.type || "image/png",
            data: base64Data
          });
        };
        reader.readAsDataURL(file);
        
        // Prevent default pasting of text (since we handled it as an image)
        e.preventDefault();
        break;
      }
    }
  };

  const handleFileAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reject files larger than 100MB to support larger documents
    if (file.size > 100 * 1024 * 1024) {
      alert("O arquivo excede o limite de 100MB. Por favor, selecione uma imagem ou documento menor.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64Data = event.target?.result as string;
      setSelectedAttachment({
        name: file.name,
        type: file.type || "application/octet-stream",
        data: base64Data
      });
    };
    reader.readAsDataURL(file);
    e.target.value = ""; // Clear file selector
  };

  const handleSend = async (text: string) => {
    if (!text.trim() && !selectedAttachment) return;

    if (activeSession.messages && activeSession.messages.length >= MAX_MESSAGES_PER_CHAT) {
      setChatLimitModal({
        show: true,
        reason: "message_count",
        currentCount: activeSession.messages.length,
        maxCount: MAX_MESSAGES_PER_CHAT
      });
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    // Set 60s timeout for chat responses
    const chatTimeoutId = setTimeout(() => abortControllerRef.current?.abort(), 60_000);

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      attachment: selectedAttachment || undefined
    };

    // Detect if this is the first user message in this session to auto-generate a title
    const isFirstUserMsg = activeSession.messages.filter(m => m.role === "user").length === 0;
    const initialLocalTitle = isFirstUserMsg ? extractLocalTitle(text) : "";

    // Update active session messages immediately (and set initial local title if applicable)
    const updatedMessages = [...(activeSession.messages || []), userMsg];
    
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { 
          ...s, 
          messages: updatedMessages,
          title: isFirstUserMsg ? initialLocalTitle : s.title
        };
      }
      return s;
    }));

    setInputVal("");
    setSelectedAttachment(null);
    setLoading(true);

    // Asynchronously request a beautiful AI-generated title for the thread
    if (isFirstUserMsg) {
      apiFetch("/api/chat/title", {
        method: "POST",
        signal: abortControllerRef.current.signal,
        body: { message: text, aiConfig: getActiveAiConfig() }
      })
      .then(res => {
        if (res.ok) return res.json();
        throw new Error();
      })
      .then(data => {
        if (data && data.title) {
          setSessions(prev => prev.map(s => {
            if (s.id === activeSessionId) {
              return { ...s, title: data.title };
            }
            return s;
          }));
        }
      })
      .catch(err => console.warn("Erro ao obter título da IA, mantendo provisório:", err));
    }

    try {
      const selectedEditalObj = activeSession.selectedEditalId ? getSelectedEditalObject(activeSession.selectedEditalId) : null;
      let replyText = "";

      const response = await apiFetch("/api/chat", {
        method: "POST",
        signal: abortControllerRef.current.signal,
        body: {
          messages: updatedMessages,
          companyData: companyData,
          activeEditalAnalysis: selectedEditalObj,
          systemCertificates: loadSystemCertificates(),
          aiConfig: getActiveAiConfig()
        }
      });

      const data = await response.json();

      if (!response.ok) {
        // Show server error message clearly to the user
        const errMsg = data?.error || "Erro na comunicação com a IA.";
        throw new Error(errMsg);
      }

      replyText = data.reply || "";

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: replyText || "Desculpe, não consegui obter uma resposta para essa pergunta. Tente novamente.",
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      };

      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          return { ...s, messages: [...updatedMessages, assistantMsg] };
        }
        return s;
      }));
      
      if (!isOpen) {
        setHasUnread(true);
        localStorage.setItem("aip_chat_has_unread", "true");
      }
    } catch (error: any) {
      clearTimeout(chatTimeoutId);
      if (error?.name === "AbortError" || error?.message?.includes("aborted")) {
        // Only show timeout message if it was NOT user-initiated (user abort sets abortControllerRef.current to null first)
        if (!abortControllerRef.current || abortControllerRef.current.signal.aborted) {
          const timeoutMsg: ChatMessage = {
            id: `msg-err-${Date.now()}`,
            role: "assistant",
            content: "⏱️ A resposta demorou mais de 60 segundos. O servidor pode estar sobrecarregado. Por favor, tente novamente em alguns instantes.",
            timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
          };
          setSessions(prev => prev.map(s => {
            if (s.id === activeSessionId) return { ...s, messages: [...updatedMessages, timeoutMsg] };
            return s;
          }));
        }
        return;
      }
      console.error("Erro no chat:", error);
      const friendlyError = formatAiError(error);
      const errMessage: ChatMessage = {
        id: `msg-err-${Date.now()}`,
        role: "assistant",
        content: friendlyError,
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      };

      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          return { ...s, messages: [...updatedMessages, errMessage] };
        }
        return s;
      }));
      
      if (!isOpen) {
        setHasUnread(true);
        localStorage.setItem("aip_chat_has_unread", "true");
      }
    } finally {
      clearTimeout(chatTimeoutId);
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 font-sans">
      
      {/* Floating Circle Button - Modern, visible and robust design */}
      {!isOpen && (
        <Button
          onClick={() => {
            setIsOpen(true);
            setShowSidebarMobile(true);
          }}
          size="icon"
          className="flex items-center p-3 h-auto w-auto rounded-full shadow-xl hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer relative group overflow-visible select-none hover:pr-4.5"
          id="floating-chat-trigger"
        >
          {/* Inner hover glow */}
          <span className="absolute inset-0 rounded-full bg-primary-foreground/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

          {/* Glowing pulse indicator ONLY if hasUnread is true */}
          {hasUnread && (
            <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75" />
              <span className="relative inline-flex rounded-full h-4.5 w-4.5 bg-warning border-2 border-background" />
            </span>
          )}

          {/* Animated icon container */}
          <div className="bg-primary-foreground/15 backdrop-blur-md p-1.5 rounded-full border border-primary-foreground/20 flex items-center justify-center shrink-0">
            <MessageSquare className="w-4.5 h-4.5 text-primary-foreground group-hover:scale-110 transition-transform duration-300" />
          </div>

          {/* Expandable info on hover */}
          <div className="flex items-center max-w-0 opacity-0 overflow-hidden group-hover:max-w-[200px] group-hover:opacity-100 transition-all duration-300 ease-out whitespace-nowrap">
            {/* Pill text label */}
            <div className="flex flex-col text-left shrink-0 pr-1.5 pl-2">
              <span className="text-[9px] font-black uppercase tracking-widest text-primary-foreground/70 leading-none mb-0.5">Online</span>
              <span className="text-xs font-semibold text-primary-foreground tracking-wide leading-none">Assessor IA</span>
            </div>

            {/* Mini Action Arrow */}
            <ArrowRight className="w-3.5 h-3.5 text-primary-foreground/90 group-hover:translate-x-1 transition-transform duration-300 shrink-0 mr-1.5" />
          </div>

          {/* Elegant Tooltip overlay */}
          <span className="absolute right-0 bottom-14 bg-popover text-popover-foreground text-[10.5px] font-medium py-2 px-3 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 border border-border shadow-2xl backdrop-blur-md pointer-events-none z-50 whitespace-nowrap">
            Clique para abrir o Assistente de Licitações
          </span>
        </Button>
      )}

      {/* Expanded Dual-Pane Chat Modal window */}
      {isOpen && (
        <div
          id="chat-popup-container"
          className={`bg-popover border border-border backdrop-blur-2xl rounded-2xl shadow-2xl shadow-black/10 dark:shadow-black/80 fixed flex flex-row overflow-hidden transition-all duration-300 z-50 text-popover-foreground ${
            isFullScreen
              ? "inset-2 sm:inset-4 md:inset-5 w-auto h-auto max-w-none max-h-none"
              : "inset-4 md:inset-auto md:bottom-6 md:right-6 w-auto md:w-[780px] lg:w-[860px] h-auto md:h-[580px] animate-scale-up"
          }`}
          style={{
            width: (!isFullScreen && isDesktop) ? `${width}px` : undefined,
            height: (!isFullScreen && isDesktop) ? `${height}px` : undefined,
          }}
        >
          {/* Resize handles */}
          {isDesktop && !isFullScreen && (
            <>
              {/* Left Edge Handle */}
              <div
                className="absolute left-0 top-1 bottom-1 w-1.5 cursor-ew-resize hover:bg-accent active:bg-accent transition-colors z-50"
                onMouseDown={(e) => handleResizeStart(e, "left")}
                title="Arraste para redimensionar largura"
              />
              {/* Top Edge Handle */}
              <div
                className="absolute top-0 left-1 right-1 h-1.5 cursor-ns-resize hover:bg-accent active:bg-accent transition-colors z-50"
                onMouseDown={(e) => handleResizeStart(e, "top")}
                title="Arraste para redimensionar altura"
              />
              {/* Top-Left Corner Handle */}
              <div
                className="absolute left-0 top-0 w-3.5 h-3.5 cursor-nwse-resize hover:bg-accent active:bg-accent transition-colors z-50 border-t-2 border-l-2 border-border rounded-tl"
                onMouseDown={(e) => handleResizeStart(e, "top-left")}
                title="Arraste para redimensionar"
              />
            </>
          )}
          {/* LEFT SIDEBAR VIEW - CHATS CATALOG */}
          <div className={`
            ${showSidebarMobile ? "flex w-full" : "hidden md:flex"}
            md:w-64 border-r border-border flex-col bg-muted/50 shrink-0 h-full
          `}>
            {/* Sidebar Header */}
            <div className="p-3.5 border-b border-border flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground tracking-wider uppercase flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-success" />
                Canais ({sessions.length}/{MAX_CHATS_PER_USER})
              </span>
              <Button
                onClick={handleNewChat}
                size="sm"
                variant={sessions.length >= MAX_CHATS_PER_USER ? "default" : "outline"}
                className={`text-[11px] font-semibold ${
                  sessions.length >= MAX_CHATS_PER_USER ? "bg-warning text-warning-foreground hover:bg-warning/90" : ""
                }`}
                title={sessions.length >= MAX_CHATS_PER_USER ? "Limite de 20 chats atingido" : "Novo canal de chat"}
              >
                <Plus className="w-3.5 h-3.5" />
                Novo
              </Button>
            </div>

            {/* Sidebar Channels List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-none">
              {sessions.map((s) => {
                const isActive = s.id === activeSessionId;
                const isEditing = s.id === editingSessionId;
                const lastMsg = s.messages && s.messages.length > 0 ? s.messages[s.messages.length - 1] : null;

                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      setActiveSessionId(s.id);
                      setShowSidebarMobile(false);
                    }}
                    className={`group w-full text-left p-2.5 rounded-xl transition-all flex flex-col justify-between cursor-pointer border ${
                      isActive
                        ? "bg-accent border-border text-foreground font-semibold shadow-xs"
                        : "bg-transparent border-transparent hover:bg-accent/60 text-muted-foreground"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 w-full">
                      {isEditing ? (
                        <div className="flex items-center gap-1 flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                          <input
                            type="text"
                            value={sessionTitleInput}
                            onChange={(e) => setSessionTitleInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRename(s.id);
                            }}
                            className="bg-background border border-border rounded px-1.5 py-0.5 text-xs text-foreground flex-1 focus:outline-none"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveRename(s.id)}
                            className="p-1 text-success hover:text-success/80 bg-success/10 rounded"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <span className="font-semibold text-xs truncate max-w-[150px] text-foreground">
                          {s.title}
                        </span>
                      )}

                      {!isEditing && (
                        <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => handleStartRename(e, s)}
                            className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded"
                            title="Renomear chat"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteChat(e, s.id)}
                            className="p-1 text-destructive hover:text-destructive/80 hover:bg-destructive/10 rounded"
                            title="Apagar chat definitivamente"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-1 flex items-center justify-between w-full text-[10px] text-muted-foreground">
                      <span className="truncate max-w-[120px]">
                        {lastMsg ? lastMsg.content.slice(0, 30) + (lastMsg.content.length > 30 ? "..." : "") : "Sem mensagens"}
                      </span>
                      {s.selectedEditalId && (
                        <Badge variant="success" className="px-1 py-0 rounded truncate max-w-[80px] text-[10px] font-normal">
                          {s.selectedEditalId === "active" ? "Edital Ativo" : "Histórico"}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Sidebar Footer */}
            <div className="p-3 border-t border-border bg-muted/50 text-[10px] text-muted-foreground flex flex-col gap-2 select-none">
              {/* Cota & Armazenamento Bar */}
              <div className="space-y-1 bg-card p-2 rounded-xl border border-border">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-muted-foreground flex items-center gap-1">
                    <Database className="w-3 h-3 text-success" />
                    Cota de Canais
                  </span>
                  <span className={`font-bold ${
                    sessions.length >= MAX_CHATS_PER_USER
                      ? "text-destructive"
                      : sessions.length >= 17
                      ? "text-warning"
                      : "text-success"
                  }`}>
                    {sessions.length} / {MAX_CHATS_PER_USER} chats
                  </span>
                </div>

                <div className="w-full bg-muted rounded-full h-1 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      sessions.length >= MAX_CHATS_PER_USER
                        ? "bg-destructive"
                        : sessions.length >= 17
                        ? "bg-warning"
                        : "bg-success"
                    }`}
                    style={{ width: `${Math.min(100, (sessions.length / MAX_CHATS_PER_USER) * 100)}%` }}
                  />
                </div>

                {sessions.length >= 17 && (
                  <p className="text-[10px] text-warning font-semibold pt-0.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0 text-warning" />
                    {sessions.length >= MAX_CHATS_PER_USER
                      ? "Limite de 20 chats atingido! Apague algum para criar novos."
                      : "Próximo do limite de 20 chats."}
                  </p>
                )}
              </div>

              <Button
                onClick={() => setShowClearConfirmModal(true)}
                variant="outline"
                size="sm"
                className="w-full bg-destructive/5 hover:bg-destructive/15 text-destructive hover:text-destructive border-destructive/15 text-xs font-semibold gap-1.5"
                title="Apagar todas as conversas do histórico"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Limpar Histórico Completo</span>
              </Button>
            </div>
          </div>

          {/* RIGHT CHAT WINDOW VIEW */}
          <div className={`
            ${!showSidebarMobile ? "flex" : "hidden md:flex"}
            flex-1 flex-col h-full bg-background
          `}>
            {/* Header */}
            <div className="bg-card/80 border-b border-border text-foreground p-3.5 flex items-center justify-between shrink-0 backdrop-blur-md">
              <div className="flex items-center gap-2">
                {/* Back to sidebar button on Mobile */}
                <button
                  onClick={() => setShowSidebarMobile(true)}
                  className="md:hidden text-muted-foreground hover:text-foreground p-1 hover:bg-accent rounded-lg shrink-0 mr-1"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                <div className="bg-success/10 border border-success/20 text-success p-1.5 rounded-lg">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-xs md:text-sm text-foreground">{activeSession.title}</h3>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    Assessoria Gemini Inteligente
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={(e) => handleDeleteChat(e, activeSession.id)}
                  variant="outline"
                  size="sm"
                  className="text-xs text-destructive border-destructive/20 bg-destructive/5 hover:bg-destructive/10 hover:text-destructive gap-1.5 font-semibold"
                  title="Apagar este chat definitivamente do layout e banco de dados"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Excluir Chat</span>
                </Button>

                {isDesktop && !isFullScreen && (width !== DEFAULT_WIDTH || height !== DEFAULT_HEIGHT) && (
                  <Button
                    onClick={() => {
                      setWidth(DEFAULT_WIDTH);
                      setHeight(DEFAULT_HEIGHT);
                      localStorage.removeItem("aip_chat_width");
                      localStorage.removeItem("aip_chat_height");
                    }}
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5 font-semibold"
                    title="Restaurar o tamanho padrão da janela do chat"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Tamanho Padrão</span>
                  </Button>
                )}

                <Button
                  onClick={() => setIsFullScreen(!isFullScreen)}
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5 font-semibold"
                  title={isFullScreen ? "Sair do modo tela cheia" : "Expandir chat para tela cheia"}
                >
                  {isFullScreen ? (
                    <>
                      <Minimize2 className="w-3.5 h-3.5 text-primary" />
                      <span className="hidden sm:inline">Restaurar</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-3.5 h-3.5 text-primary" />
                      <span className="hidden sm:inline">Tela Cheia</span>
                    </>
                  )}
                </Button>

                <Button
                  onClick={() => setIsOpen(false)}
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground shrink-0 h-8 w-8"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Edital Selection Context Ribbon - Ultra Compact & Minimalist Custom Dropdown */}
            <div className="bg-muted px-4 py-2 border-b border-border flex items-center justify-between gap-3 shrink-0 select-none text-xs relative z-30">
              <div className="flex items-center gap-1.5 min-w-0">
                <Database className="w-3.5 h-3.5 text-success shrink-0" />
                <span className="text-[11px] font-bold text-foreground shrink-0">Foco do Chat:</span>

                {/* Visual state indicator dot */}
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeSession.selectedEditalId ? "bg-success animate-pulse" : "bg-muted-foreground/40"}`} />

                <span className="text-[10px] text-muted-foreground hidden sm:inline truncate max-w-[120px] md:max-w-[180px] font-medium">
                  {activeSession.selectedEditalId ? "Focando em edital específico" : "Geral / Sem edital"}
                </span>
              </div>

              {/* Custom Searchable Select Dropdown Container */}
              <div ref={dropdownRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="max-w-[195px] sm:max-w-[340px] flex items-center justify-between gap-2 bg-background hover:bg-accent border border-border rounded-lg px-2.5 py-1.5 text-[11px] text-foreground focus:outline-none transition-all cursor-pointer active:scale-95 text-left font-medium"
                >
                  <span className="truncate">
                    {activeSession.selectedEditalId === "" && "💬 Nenhum Edital (Conversa Geral)"}
                    {activeSession.selectedEditalId === "active" && (
                      `⚡ Edital Ativo em Tela (${activeEdital?.descricaoProduto?.slice(0, 20) || activeEdital?.identificacaoCertame?.orgaoComprador?.substring(0, 20) || "Em Tela"})`
                    )}
                    {activeSession.selectedEditalId !== "" && activeSession.selectedEditalId !== "active" && (
                      (() => {
                        const found = editalHistory.find(h => h.id === activeSession.selectedEditalId);
                        const ed = found?.analysis || found;
                        return `📄 ${found?.title || ed?.identificacaoCertame?.orgaoComprador?.substring(0, 20) || "Edital Histórico"}`;
                      })()
                    )}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${isDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {/* Dropdown Popover */}
                {isDropdownOpen && (
                  <div className="absolute right-0 mt-1.5 w-64 sm:w-80 bg-popover border border-border rounded-xl shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden max-h-72 animate-scale-up">
                    {/* Search Field */}
                    <div className="p-2 border-b border-border flex items-center gap-2 bg-muted shrink-0">
                      <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-1" />
                      <input
                        type="text"
                        placeholder="Buscar edital analisado..."
                        value={dropdownSearch}
                        onChange={(e) => setDropdownSearch(e.target.value)}
                        className="w-full bg-transparent text-foreground placeholder-muted-foreground text-[11px] focus:outline-none py-1"
                        autoFocus
                      />
                      {dropdownSearch && (
                        <button
                          type="button"
                          onClick={() => setDropdownSearch("")}
                          className="text-muted-foreground hover:text-foreground p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Scrollable Options List */}
                    <div className="overflow-y-auto py-1 max-h-56 divide-y divide-border scrollbar-thin">
                      {/* Option: Conversa Geral */}
                      {(!dropdownSearch || "conversa geral sem focar nenhum edital".includes(dropdownSearch.toLowerCase())) && (
                        <button
                          type="button"
                          onClick={() => {
                            handleSelectEdital("");
                            setIsDropdownOpen(false);
                            setDropdownSearch("");
                          }}
                          className={`w-full text-left px-3 py-2 text-[11px] hover:bg-accent flex items-center justify-between transition-colors ${activeSession.selectedEditalId === "" ? "text-success font-bold bg-success/10" : "text-foreground"}`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <MessageSquare className="w-3.5 h-3.5 shrink-0 text-success" />
                            <span className="truncate">Nenhum Edital (Conversa Geral)</span>
                          </span>
                          {activeSession.selectedEditalId === "" && <Check className="w-3.5 h-3.5 text-success shrink-0" />}
                        </button>
                      )}

                      {/* Option: Active Edital on screen if available */}
                      {activeEdital && (!dropdownSearch || "edital ativo em tela".includes(dropdownSearch.toLowerCase()) || (activeEdital.descricaoProduto || "").toLowerCase().includes(dropdownSearch.toLowerCase()) || (activeEdital.identificacaoCertame?.orgaoComprador || "").toLowerCase().includes(dropdownSearch.toLowerCase())) && (
                        <button
                          type="button"
                          onClick={() => {
                            handleSelectEdital("active");
                            setIsDropdownOpen(false);
                            setDropdownSearch("");
                          }}
                          className={`w-full text-left px-3 py-2 text-[11px] hover:bg-accent flex flex-col justify-center transition-colors border-b border-border ${activeSession.selectedEditalId === "active" ? "text-success font-bold bg-success/10" : "text-foreground"}`}
                        >
                          <div className="flex items-center justify-between w-full gap-2">
                            <span className="flex items-center gap-2 truncate font-semibold">
                              <Sparkles className="w-3.5 h-3.5 text-success shrink-0" />
                              <span className="truncate">⚡ Edital Ativo em Tela</span>
                            </span>
                            {activeSession.selectedEditalId === "active" && <Check className="w-3.5 h-3.5 text-success shrink-0" />}
                          </div>
                          <span className="text-[9px] text-muted-foreground ml-5 truncate block">
                            {activeEdital.descricaoProduto ? activeEdital.descricaoProduto.slice(0, 45) : (activeEdital.identificacaoCertame?.orgaoComprador || "Em Análise")}
                          </span>
                        </button>
                      )}

                      {/* Group: History */}
                      {(() => {
                        const filteredHistory = editalHistory.filter(item => {
                          const ed = item.analysis || item;
                          const term = dropdownSearch.toLowerCase();
                          return (
                            (item.title || "").toLowerCase().includes(term) ||
                            (ed.identificacaoCertame?.orgaoComprador || "").toLowerCase().includes(term) ||
                            (ed.identificacaoCertame?.modalidadeLicitacao || "").toLowerCase().includes(term)
                          );
                        });

                        if (filteredHistory.length > 0) {
                          return (
                            <div>
                              <div className="px-3 py-1 bg-muted text-[9px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 flex items-center justify-between">
                                <span>📂 Editais Analisados ({filteredHistory.length})</span>
                              </div>
                              {filteredHistory.map((item, idx) => {
                                const ed = item.analysis || item;
                                const isSelected = activeSession.selectedEditalId === item.id;
                                const title = item.title || ed.identificacaoCertame?.orgaoComprador || "Edital Histórico";
                                const desc = ed.identificacaoCertame?.modalidadeLicitacao || "Pregão Eletrônico";

                                return (
                                  <button
                                    key={item.id || idx}
                                    type="button"
                                    onClick={() => {
                                      handleSelectEdital(item.id);
                                      setIsDropdownOpen(false);
                                      setDropdownSearch("");
                                    }}
                                    className={`w-full text-left px-3 py-2 text-[11px] hover:bg-accent flex flex-col justify-center transition-colors ${isSelected ? "text-success font-bold bg-success/10" : "text-foreground"}`}
                                  >
                                    <div className="flex items-center justify-between w-full gap-2">
                                      <span className="flex items-center gap-2 truncate">
                                        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                        <span className="truncate">{title}</span>
                                      </span>
                                      {isSelected && <Check className="w-3.5 h-3.5 text-success shrink-0" />}
                                    </div>
                                    <span className="text-[9px] text-muted-foreground ml-5 truncate block">
                                      {desc}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        } else if (dropdownSearch && filteredHistory.length === 0) {
                          return (
                            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                              Nenhum edital encontrado para "{dropdownSearch}"
                            </div>
                          );
                        } else if (editalHistory.length === 0) {
                          return (
                            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                              Nenhum edital analisado ainda
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Warning Banner if Chat message count is near/at limit */}
            {activeSession.messages && activeSession.messages.length >= 180 && (
              <div className="bg-warning/10 border-b border-warning/20 px-4 py-2 flex items-center justify-between text-xs text-warning shrink-0">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                  <span>
                    Este canal possui <strong>{activeSession.messages.length}/200</strong> mensagens.
                    {activeSession.messages.length >= MAX_MESSAGES_PER_CHAT
                      ? " Cota máxima atingida! Crie um novo chat para continuar conversando."
                      : " Ao atingir 200 mensagens, crie um novo canal de chat."}
                  </span>
                </div>
              </div>
            )}

            {/* Scrollable Messages Area */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 bg-background select-text"
            >
              {activeSession.messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex gap-2 text-xs md:text-sm select-text ${
                    m.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {m.role === "assistant" && (
                    <div className="bg-success/10 border border-success/20 text-success p-1.5 rounded-lg h-7 w-7 flex items-center justify-center shrink-0 select-none">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}

                  <div
                    className={`group relative max-w-[85%] sm:max-w-[80%] rounded-2xl p-3.5 leading-normal border shadow-xs select-text ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground border-primary rounded-tr-none"
                        : "bg-muted text-foreground border-border rounded-tl-none"
                    }`}
                  >
                    {/* Hover copy button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(m.content);
                        setCopiedMsgId(m.id);
                        setTimeout(() => setCopiedMsgId(null), 2000);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-2 right-2 p-1.5 bg-background/90 hover:bg-accent text-muted-foreground hover:text-foreground rounded-md border border-border select-none cursor-pointer z-10 shadow-md"
                      title="Copiar mensagem"
                    >
                      {copiedMsgId === m.id ? (
                        <Check className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <ClipboardCopy className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {/* Render attachment if any */}
                    {m.attachment && (
                      <div className="mb-2.5 bg-background/10 p-2 rounded-xl border border-current/10 flex items-center gap-2 max-w-sm select-text">
                        {m.attachment.type === "application/system-doc" ? (
                          <div className="flex items-center gap-2 w-full">
                            <div className="bg-background/20 p-1.5 rounded-lg border border-current/10 select-none">
                              <FolderOpen className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold truncate">
                                {m.attachment.name}
                              </p>
                              <p className="text-[9px] opacity-70 uppercase font-mono font-semibold">
                                Documento do Sistema
                              </p>
                            </div>
                          </div>
                        ) : m.attachment.type.startsWith("image/") ? (
                          <div className="flex flex-col gap-1 w-full">
                            <img
                              src={m.attachment.data}
                              alt="Anexo"
                              className="max-h-40 rounded-lg object-contain bg-background/20 border border-current/10 w-full select-none"
                              referrerPolicy="no-referrer"
                            />
                            <span className="text-[10px] opacity-70 truncate mt-1">
                              📷 {m.attachment.name}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 w-full">
                            <div className="bg-background/20 p-1.5 rounded-lg select-none">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold truncate">
                                {m.attachment.name}
                              </p>
                              <p className="text-[9px] opacity-70 uppercase">
                                Documento / {m.attachment.type.split("/")[1] || "File"}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="text-xs md:text-sm leading-relaxed space-y-3 select-text">
                      {m.role === "assistant" ? (
                        parseMessageContent(m.content).map((part, pIdx) => {
                          if (part.type === "document") {
                            const docTitle = part.title || "documento.md";
                            const docContent = part.content;
                            const wordCount = getWordCount(docContent);

                            return (
                              <div
                                key={pIdx}
                                className="my-3 bg-card rounded-xl border border-border overflow-hidden shadow-sm select-text text-card-foreground"
                              >
                                {/* Doc Card Header */}
                                <div className="bg-muted/50 px-3.5 py-2.5 border-b border-border flex items-center justify-between select-text">
                                  <div className="flex items-center gap-2">
                                    <div className="p-1.5 bg-success/10 border border-success/20 rounded-lg text-success select-none">
                                      <FileText className="w-4 h-4" />
                                    </div>
                                    <div>
                                      <p className="text-[9px] font-bold uppercase tracking-wider text-success">Documento Oficial Gerado</p>
                                      <p className="text-xs font-bold text-foreground truncate max-w-[180px] sm:max-w-xs">{docTitle}</p>
                                    </div>
                                  </div>
                                  <Badge variant="outline" className="text-[9px] font-mono font-normal">
                                    {wordCount} palavras
                                  </Badge>
                                </div>

                                {/* Doc Card Body with Actions */}
                                <div className="p-3.5 flex flex-col gap-2 bg-card">
                                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 select-text font-medium">
                                    <Sparkles className="w-3.5 h-3.5 text-warning shrink-0 select-none" />
                                    Pronto para impressão, exportação ou download.
                                  </p>

                                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border select-none">
                                    {/* Action: Preview */}
                                    <Button
                                      type="button"
                                      onClick={() => {
                                        setPreviewDocTitle(docTitle);
                                        setPreviewDocContent(docContent);
                                      }}
                                      variant="outline"
                                      size="sm"
                                      className="flex-1 text-[10px] font-semibold h-auto py-1.5"
                                      title="Visualizar documento em tela cheia para impressão"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      <span>Visualizar</span>
                                    </Button>

                                    {/* Action: Copy */}
                                    <Button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(docContent);
                                        alert("Documento copiado para a área de transferência!");
                                      }}
                                      variant="outline"
                                      size="sm"
                                      className="flex-1 text-[10px] font-semibold h-auto py-1.5"
                                      title="Copiar texto em formato Markdown"
                                    >
                                      <ClipboardCopy className="w-3.5 h-3.5" />
                                      <span>Copiar</span>
                                    </Button>

                                    {/* Action: Download */}
                                    <Button
                                      type="button"
                                      onClick={() => {
                                        const blob = new Blob([docContent], { type: "text/markdown;charset=utf-8;" });
                                        const url = URL.createObjectURL(blob);
                                        const link = document.createElement("a");
                                        link.href = url;
                                        link.setAttribute("download", docTitle);
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                      }}
                                      variant="outline"
                                      size="sm"
                                      className="flex-1 text-[10px] font-semibold h-auto py-1.5"
                                      title="Baixar arquivo Markdown (.md)"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      <span>Baixar</span>
                                    </Button>

                                    {/* Action: Sync/Save to GDrive */}
                                    <Button
                                      type="button"
                                      onClick={() => {
                                        let docType: "document" | "sheet" | "proposal" | "declaration" = "document";
                                        if (docTitle.toLowerCase().includes("proposta")) docType = "proposal";
                                        else if (docTitle.toLowerCase().includes("declara")) docType = "declaration";

                                        addSyncedItem(docTitle.replace(".md", ""), docType, docContent);
                                        confetti({ particleCount: 50, spread: 60, colors: ["#10b981", "#059669"] });
                                        alert(`Sucesso! "${docTitle}" foi importado para sua central de sincronismo (Google Drive & Supabase).`);
                                      }}
                                      variant="outline"
                                      size="sm"
                                      className="flex-1 text-[10px] font-semibold h-auto py-1.5 bg-success/10 hover:bg-success/20 border-success/20 hover:border-success/40 text-success hover:text-success"
                                      title="Salvar na Central de Sincronismo"
                                    >
                                      <Database className="w-3.5 h-3.5" />
                                      <span>Importar</span>
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            );
                          } else {
                            return (
                              <ReactMarkdown
                                key={pIdx}
                                components={{
                                  p: ({node, ...props}) => <p className="mb-1.5 last:mb-0 leading-normal font-sans select-text text-foreground" {...props} />,
                                  strong: ({node, ...props}) => <strong className="font-bold text-foreground select-text" {...props} />,
                                  ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-2 mt-1 space-y-1 select-text text-foreground" {...props} />,
                                  ol: ({node, ...props}) => <ol className="list-decimal pl-4 mb-2 mt-1 space-y-1 select-text text-foreground" {...props} />,
                                  li: ({node, ...props}) => <li className="leading-normal select-text text-foreground" {...props} />,
                                  code: ({node, ...props}) => <code className="bg-background text-foreground px-1 rounded text-[11px] font-mono select-text border border-border" {...props} />,
                                }}
                              >
                                {part.content}
                              </ReactMarkdown>
                            );
                          }
                        })
                      ) : (
                        <ReactMarkdown
                          components={{
                            p: ({node, ...props}) => <p className="mb-1.5 last:mb-0 leading-normal font-sans select-text text-primary-foreground" {...props} />,
                            strong: ({node, ...props}) => <strong className="font-bold text-primary-foreground select-text" {...props} />,
                            ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-2 mt-1 space-y-1 select-text text-primary-foreground" {...props} />,
                            ol: ({node, ...props}) => <ol className="list-decimal pl-4 mb-2 mt-1 space-y-1 select-text text-primary-foreground" {...props} />,
                            li: ({node, ...props}) => <li className="leading-normal select-text text-primary-foreground" {...props} />,
                            code: ({node, ...props}) => <code className="bg-primary-foreground/10 text-primary-foreground px-1 rounded text-[11px] font-mono select-text border border-primary-foreground/20" {...props} />,
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>
                      )}
                    </div>
                    <span className={`text-[9px] block text-right mt-1.5 font-medium ${
                      m.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}>
                      {m.timestamp}
                    </span>
                  </div>

                  {m.role === "user" && (
                    <div className="bg-primary text-primary-foreground p-1.5 rounded-lg h-7 w-7 flex items-center justify-center shrink-0 select-none shadow-xs">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex gap-2 justify-start items-center text-xs text-muted-foreground animate-pulse font-medium">
                  <div className="bg-success/10 border border-success/20 text-success p-1.5 rounded-lg h-7 w-7 flex items-center justify-center shrink-0">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                  <span>Pesquisando histórico de licitações e estruturando resposta...</span>
                </div>
              )}
            </div>

            {/* PRE-UPLOADED ATTACHMENT TRAY */}
            {selectedAttachment && (
              <div className="px-4 py-2 bg-muted border-t border-border flex items-center justify-between gap-2 text-xs text-foreground">
                <div className="flex items-center gap-2">
                  {selectedAttachment.type.startsWith("image/") ? (
                    <Image className="w-4 h-4 text-success" />
                  ) : (
                    <FileText className="w-4 h-4 text-destructive" />
                  )}
                  <span className="truncate max-w-[200px] font-bold text-foreground">
                    {selectedAttachment.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    (Pronto para envio)
                  </span>
                </div>
                <button
                  onClick={() => setSelectedAttachment(null)}
                  className="text-destructive hover:text-destructive/80 p-1 hover:bg-accent rounded-lg"
                  title="Remover anexo"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Bottom Input Box Area Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend(inputVal);
              }}
              className="p-3 border-t border-border bg-card/80 backdrop-blur-md flex items-center gap-2 shrink-0 select-none"
            >
              <input
                type="file"
                ref={attachmentInputRef}
                onChange={handleFileAttachmentChange}
                className="hidden"
                accept="image/*,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              />

              <Button
                type="button"
                onClick={handleFileAttachmentClick}
                variant="outline"
                size="icon"
                className="rounded-xl h-9 w-9 shrink-0"
                title="Anexar Imagem ou Arquivo Local"
              >
                <Paperclip className="w-4 h-4" />
              </Button>

              <Button
                type="button"
                onClick={handleOpenSystemDocSelector}
                variant="outline"
                size="icon"
                className="rounded-xl h-9 w-9 shrink-0"
                title="Anexar documento ou edital do sistema"
              >
                <FolderOpen className="w-4 h-4" />
              </Button>

              <Textarea
                rows={1}
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!loading && (inputVal.trim() || selectedAttachment)) {
                      handleSend(inputVal);
                    }
                  }
                }}
                onPaste={handlePaste}
                placeholder="Escreva sua dúvida (Shift+Enter para nova linha, Ctrl+V para colar)..."
                className="flex-1 bg-muted border-border rounded-xl px-3 py-2 text-xs md:text-sm text-foreground focus-visible:ring-1 transition-all resize-none min-h-[38px] max-h-[120px] overflow-y-auto leading-normal font-sans field-sizing-fixed"
              />

              {loading ? (
                <Button
                  type="button"
                  onClick={handleStopGeneration}
                  variant="destructive"
                  className="rounded-xl hover:scale-[1.02] active:scale-95 transition-all h-9 px-3 shrink-0 gap-1.5 text-xs font-semibold shadow-md"
                  title="Paralisar envio de mensagem"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span className="hidden sm:inline">Parar</span>
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={!inputVal.trim() && !selectedAttachment}
                  size="icon"
                  className="rounded-xl hover:scale-[1.02] active:scale-95 transition-all h-9 w-9 shrink-0 shadow-md"
                  title="Enviar mensagem (Enter)"
                >
                  <Send className="w-4 h-4" />
                </Button>
              )}
            </form>

          </div>
        </div>
      )}

      {/* SYSTEM DOCUMENTS SELECTOR MODAL */}
      {showSystemDocSelector && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/75 backdrop-blur-sm animate-fade-in select-text overflow-y-auto">
          <div className="bg-card text-card-foreground border border-border rounded-2xl w-full max-w-lg max-h-[92vh] sm:max-h-[82vh] flex flex-col shadow-2xl overflow-hidden select-text my-auto">

            {/* Header */}
            <div className="bg-muted/50 p-3.5 sm:p-4 border-b border-border flex items-center justify-between select-none shrink-0">
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <FolderOpen className="w-5 h-5 text-success shrink-0" />
                <div className="text-left min-w-0">
                  <h4 className="text-sm font-semibold text-foreground truncate">Documentos do Sistema</h4>
                  <p className="text-[10px] text-muted-foreground truncate">Selecione um arquivo já presente na plataforma para anexar ao chat</p>
                </div>
              </div>
              <Button
                type="button"
                onClick={() => setShowSystemDocSelector(false)}
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground shrink-0 h-8 w-8"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4 select-text">

              {/* 1. Editais section */}
              <div className="space-y-2 select-text">
                <h5 className="text-[10px] font-semibold text-success uppercase tracking-wider text-left select-none">📄 Editais e Análises</h5>
                <div className="space-y-1.5">
                  {editalHistory.length > 0 ? (
                    <div className="space-y-1">
                      {editalHistory.map((item, idx) => {
                        const ed = item.analysis || item;
                        const organ = ed.identificacaoCertame?.orgaoComprador || "Histórico";
                        const title = item.title || `Pregão de ${organ.substring(0, 15)}`;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleSelectSystemEdital(item)}
                            className="w-full text-left bg-muted/50 hover:bg-accent border border-border p-2.5 rounded-xl transition-all flex items-center justify-between gap-2 cursor-pointer"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">{title}</p>
                              <p className="text-[9px] text-muted-foreground truncate">{organ}</p>
                            </div>
                            <Badge variant="outline" className="text-[8px] uppercase font-bold shrink-0">Anexar</Badge>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground italic px-2 text-left select-none">Nenhum edital no histórico no momento.</p>
                  )}
                </div>
              </div>

              {/* 2. Certificados/Documentos section */}
              <div className="space-y-2 select-text">
                <h5 className="text-[10px] font-semibold text-success uppercase tracking-wider text-left select-none">💼 Certidões e Documentos da Empresa</h5>
                <div className="space-y-1.5">
                  {systemCerts.length > 0 ? (
                    systemCerts.map((cert) => (
                      <button
                        key={cert.id}
                        type="button"
                        onClick={() => handleSelectSystemCert(cert)}
                        className="w-full text-left bg-muted/50 hover:bg-accent border border-border p-2.5 rounded-xl transition-all flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{cert.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${cert.status === "valid" ? "bg-success" : cert.status === "expiring_soon" ? "bg-warning animate-pulse" : "bg-destructive"}`} />
                            <p className="text-[9px] text-muted-foreground truncate">
                              {cert.status === "valid" ? "Válida" : cert.status === "expiring_soon" ? "Próxima ao Vencimento" : "Vencida/Pendente"}
                              {cert.expirationDate ? ` • Vencimento: ${cert.expirationDate}` : ""}
                            </p>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[8px] uppercase font-bold shrink-0">Anexar</Badge>
                      </button>
                    ))
                  ) : (
                    <p className="text-[10px] text-muted-foreground italic px-2 text-left select-none">Nenhuma certidão ou documento cadastrado no momento.</p>
                  )}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="bg-muted/50 p-3 border-t border-border flex justify-end select-none shrink-0">
              <Button
                type="button"
                onClick={() => setShowSystemDocSelector(false)}
                variant="outline"
                className="w-full sm:w-auto text-xs font-medium"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN DOCUMENT PREVIEW MODAL */}
      {previewDocContent && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/80 backdrop-blur-md overflow-y-auto select-text">
          <div className="bg-card text-card-foreground border border-border rounded-2xl w-full max-w-4xl h-[92vh] sm:h-[88vh] flex flex-col shadow-2xl overflow-hidden animate-scale-up select-text my-auto">

            {/* Modal Header */}
            <div className="bg-muted/50 p-3.5 sm:p-4 border-b border-border flex items-center justify-between select-none shrink-0 gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="w-5 h-5 text-success shrink-0" />
                <div className="text-left min-w-0">
                  <h4 className="text-sm font-semibold text-foreground truncate">Visualizador de Documento Oficial</h4>
                  <p className="text-[10px] text-muted-foreground truncate">{previewDocTitle}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Print button */}
                <Button
                  type="button"
                  onClick={() => {
                    const printWindow = window.open("", "_blank");
                    if (printWindow) {
                      // Clean and replace markdown formatting into HTML block
                      let htmlContent = previewDocContent;
                      
                      // Very basic markdown to simple HTML parser for print window
                      htmlContent = htmlContent
                        .replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                        .replace(/\n\n/g, "<p></p>")
                        .replace(/#{4}\s+(.*?)(?=<br>|<p>|<\/p>|\n)/g, "<h4>$1</h4>")
                        .replace(/#{3}\s+(.*?)(?=<br>|<p>|<\/p>|\n)/g, "<h3>$1</h3>")
                        .replace(/#{2}\s+(.*?)(?=<br>|<p>|<\/p>|\n)/g, "<h2>$1</h2>")
                        .replace(/#{1}\s+(.*?)(?=<br>|<p>|<\/p>|\n)/g, "<h1>$1</h1>")
                        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                        .replace(/\*(.*?)\*/g, "<em>$1</em>")
                        .replace(/`([^`]+)`/g, "<code>$1</code>")
                        .replace(/\n/g, "<br>");

                      printWindow.document.write(`
                        <html>
                          <head>
                            <title>${previewDocTitle || "Documento"}</title>
                            <style>
                              @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
                              @page {
                                size: A4;
                                margin: 0;
                              }
                              @media print {
                                html, body {
                                  margin: 0;
                                  padding: 0;
                                  background-color: #ffffff;
                                  -webkit-print-color-adjust: exact;
                                  print-color-adjust: exact;
                                }
                              }
                              body { font-family: 'Inter', sans-serif; padding: 1.5cm 2cm; color: #1e293b; line-height: 1.65; background-color: #ffffff; box-sizing: border-box; }
                              .sheet { max-width: 800px; margin: 0 auto; background: #ffffff; }
                              pre, code { font-family: monospace; background: #f1f5f9; padding: 2px 4px; border-radius: 4px; font-size: 0.9em; }
                              table { border-collapse: collapse; width: 100%; margin: 24px 0; font-size: 0.9em; }
                              th, td { border: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; }
                              th { background-color: #f8fafc; font-weight: 600; }
                              h1 { font-size: 1.8em; font-weight: 700; color: #0f172a; border-b: 1px solid #e2e8f0; padding-bottom: 12px; margin-top: 0; margin-bottom: 24px; text-align: center; }
                              h2 { font-size: 1.3em; font-weight: 600; color: #1e293b; margin-top: 30px; margin-bottom: 14px; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; }
                              h3 { font-size: 1.1em; font-weight: 600; color: #334155; margin-top: 20px; margin-bottom: 10px; }
                              p { margin-bottom: 16px; text-align: justify; }
                              ul, ol { margin-bottom: 16px; padding-left: 20px; }
                              li { margin-bottom: 6px; }
                            </style>
                          </head>
                          <body>
                            <div class="sheet">
                              ${htmlContent}
                            </div>
                            <script>
                              window.onload = function() { 
                                setTimeout(function() {
                                  window.print(); 
                                }, 500);
                              }
                            </script>
                          </body>
                        </html>
                      `);
                      printWindow.document.close();
                    } else {
                      alert("Por favor, permita popups para poder imprimir o documento.");
                    }
                  }}
                  size="sm"
                  className="text-xs font-bold gap-1.5 bg-success text-success-foreground hover:bg-success/90"
                >
                  <Printer className="w-4 h-4" />
                  <span className="hidden sm:inline">Imprimir</span>
                </Button>

                <Button
                  type="button"
                  onClick={() => {
                    setPreviewDocTitle(null);
                    setPreviewDocContent(null);
                  }}
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground h-8 w-8"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Document Sheet Canvas */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-muted flex justify-center select-text">
              <div className="official-a4-paper w-full max-w-2xl bg-white text-slate-900 shadow-xl rounded-xl p-6 sm:p-12 border border-slate-200 select-text overflow-y-auto font-sans text-xs md:text-sm text-left">
                <ReactMarkdown
                  components={{
                    p: ({node, ...props}) => <p className="mb-4 leading-relaxed font-sans text-slate-800 text-justify" {...props} />,
                    strong: ({node, ...props}) => <strong className="font-bold text-slate-950" {...props} />,
                    h1: ({node, ...props}) => <h1 className="text-base md:text-lg font-bold border-b pb-2 mb-4 text-slate-900 tracking-tight text-center uppercase" {...props} />,
                    h2: ({node, ...props}) => <h2 className="text-xs md:text-sm font-bold mb-3 text-slate-900 mt-6 border-b pb-1 border-slate-100" {...props} />,
                    h3: ({node, ...props}) => <h3 className="text-[11px] md:text-xs font-bold mb-2 text-slate-800 mt-4" {...props} />,
                    ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 space-y-1 text-slate-700" {...props} />,
                    ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-4 space-y-1 text-slate-700" {...props} />,
                    li: ({node, ...props}) => <li className="leading-relaxed" {...props} />,
                    table: ({node, ...props}) => (
                      <div className="overflow-x-auto my-4 border border-slate-150 rounded-lg">
                        <table className="min-w-full divide-y divide-slate-200" {...props} />
                      </div>
                    ),
                    thead: ({node, ...props}) => <thead className="bg-slate-55" {...props} />,
                    tbody: ({node, ...props}) => <tbody className="divide-y divide-slate-100" {...props} />,
                    tr: ({node, ...props}) => <tr className="hover:bg-slate-50/50" {...props} />,
                    th: ({node, ...props}) => <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600 border-b bg-slate-50" {...props} />,
                    td: ({node, ...props}) => <td className="px-3 py-1.5 text-[11px] text-slate-700 border-b" {...props} />,
                    code: ({node, ...props}) => <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-[11px] font-mono" {...props} />,
                  }}
                >
                  {previewDocContent}
                </ReactMarkdown>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-muted/50 p-3 sm:p-4 border-t border-border flex justify-end gap-2 select-none shrink-0">
              <Button
                type="button"
                onClick={() => {
                  setPreviewDocTitle(null);
                  setPreviewDocContent(null);
                }}
                variant="outline"
                className="w-full sm:w-auto text-xs font-bold"
              >
                Fechar Visualizador
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Popup de Alerta de Cota/Limite Atingido */}
      {chatLimitModal && chatLimitModal.show && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/80 backdrop-blur-md animate-fade-in overflow-y-auto">
          <div className="bg-card text-card-foreground border border-warning/40 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl relative space-y-4 sm:space-y-5 overflow-hidden text-left my-auto">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-warning" />

            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-warning/20 border border-warning/30 rounded-xl text-warning shrink-0">
                <AlertTriangle className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="text-base sm:text-lg font-bold text-foreground leading-tight">
                  {chatLimitModal.reason === "chat_count"
                    ? "Limite de 20 Chats Atingido"
                    : "Limite de Mensagens Atingido"}
                </h3>
                <p className="text-xs text-warning font-medium truncate">
                  {chatLimitModal.reason === "chat_count"
                    ? `Cota máxima da conta: ${chatLimitModal.currentCount}/${chatLimitModal.maxCount} chats`
                    : `Cota máxima do canal: ${chatLimitModal.currentCount}/${chatLimitModal.maxCount} mensagens`}
                </p>
              </div>
            </div>

            <div className="bg-muted border border-border rounded-xl p-3.5 sm:p-4 text-xs space-y-3 text-muted-foreground">
              {chatLimitModal.reason === "chat_count" ? (
                <>
                  <p className="leading-relaxed">
                    Sua conta atingiu o limite máximo de <strong className="text-foreground">20 canais de chat salvos</strong> no banco de dados Supabase.
                  </p>
                  <div className="space-y-1.5 text-muted-foreground border-t border-border pt-2.5">
                    <p className="font-semibold text-foreground">💡 Como liberar espaço:</p>
                    <ul className="list-disc list-inside space-y-1 pl-1 text-[11px]">
                      <li>Abra o painel lateral de canais;</li>
                      <li>Clique no ícone de lixeira do chat que deseja excluir;</li>
                      <li>Após apagar um chat antigo, você poderá criar uma nova conversa imediatamente.</li>
                    </ul>
                  </div>
                </>
              ) : (
                <>
                  <p className="leading-relaxed">
                    Este canal de conversa atingiu o limite máximo de <strong className="text-foreground">200 mensagens</strong> para preservar a alta velocidade no Supabase.
                  </p>
                  <div className="space-y-1.5 text-muted-foreground border-t border-border pt-2.5">
                    <p className="font-semibold text-foreground">💡 Como proceder:</p>
                    <ul className="list-disc list-inside space-y-1 pl-1 text-[11px]">
                      <li>Clique em <strong className="text-success">"Novo"</strong> no painel de canais para iniciar um novo chat;</li>
                      <li>Ou apague este chat se desejar liberar espaço.</li>
                    </ul>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end pt-1">
              <Button
                type="button"
                onClick={() => setChatLimitModal(null)}
                className="w-full sm:w-auto px-5 py-2.5 bg-warning text-warning-foreground hover:bg-warning/90 rounded-xl font-semibold shadow-lg shadow-warning/20 gap-2 text-xs text-center h-auto"
              >
                <Check className="w-4 h-4" />
                <span>Entendido</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal to Clear All Chats (Replaces blocked window.confirm) */}
      {showClearConfirmModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card text-card-foreground border border-destructive/30 rounded-2xl p-5 sm:p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-destructive/20 border border-destructive/30 rounded-xl text-destructive shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="text-base font-bold text-foreground leading-tight">
                  Limpar Todo o Histórico?
                </h3>
                <p className="text-xs text-muted-foreground">
                  Esta ação é irreversível e excluirá todas as conversas salvas.
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground bg-muted p-3 rounded-xl border border-border leading-relaxed">
              Tem certeza que deseja apagar definitivamente todas as conversas do histórico e do banco de dados? Um novo chat principal limpo será iniciado.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <Button
                type="button"
                onClick={() => setShowClearConfirmModal(false)}
                variant="secondary"
                className="text-xs font-semibold"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleClearAllChats}
                variant="destructive"
                className="text-xs font-semibold gap-1.5 shadow-lg shadow-destructive/30"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Sim, Apagar Tudo</span>
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
