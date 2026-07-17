import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { ChatMessage, ChatSession, CompanyData, EditalAnalysis, Attachment } from "../types";
import { 
  MessageSquare, X, Send, Bot, User, Sparkles, Loader2, Plus, Trash2, 
  Paperclip, Image, FileText, ChevronLeft, Edit2, Check, ArrowRight, RotateCcw,
  FolderOpen, FileCheck, Download, Eye, ClipboardCopy, CheckSquare, Globe, Database, Printer,
  ChevronDown, Search
} from "lucide-react";
import confetti from "canvas-confetti";
import { getActiveAiConfig, apiFetch } from "../utils/aiClientHelper";
import { addSyncedItem } from "../utils/googleSync";
import { 
  callSupabaseGeminiEdgeFunction,
  fetchChatSessionsFromSupabase,
  saveChatSessionToSupabase,
  deleteChatSessionFromSupabase
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

export default function FloatingAiChat({ companyData, activeEdital }: FloatingAiChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showSidebarMobile, setShowSidebarMobile] = useState(true);
  
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
  
  // Loaded edital history
  const [editalHistory, setEditalHistory] = useState<any[]>([]);

  // States for the modernized custom selector
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownSearch, setDropdownSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load edital history from localStorage dynamically
  const reloadEditalHistory = () => {
    const saved = localStorage.getItem("aip_edital_history");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setEditalHistory(parsed);
        }
      } catch (e) {
        console.error("Erro ao carregar histórico de editais:", e);
      }
    }
  };

  // Keep editalHistory always in sync (active listener + periodic sync)
  useEffect(() => {
    reloadEditalHistory(); // Sync on mount

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "aip_edital_history") {
        reloadEditalHistory();
      }
    };

    const handleFocus = () => {
      reloadEditalHistory();
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("focus", handleFocus);
    
    // Quick polling fallback to handle updates from within the same window
    const interval = setInterval(reloadEditalHistory, 1500);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("focus", handleFocus);
      clearInterval(interval);
    };
  }, []);

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

  // Multiple sessions state
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem("aip_chat_sessions");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
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
        selectedEditalId: "active",
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

  // Parse message content into text blocks and generated_document blocks
  const parseMessageContent = (content: string) => {
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

  // Resizing configuration & state
  const DEFAULT_WIDTH = 860;
  const DEFAULT_HEIGHT = 580;
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem("aip_chat_width");
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const [height, setHeight] = useState(() => {
    const saved = localStorage.getItem("aip_chat_height");
    return saved ? parseInt(saved, 10) : DEFAULT_HEIGHT;
  });
  const [isDesktop, setIsDesktop] = useState(false);

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

  // Load from Supabase on mount
  useEffect(() => {
    async function loadChatSessions() {
      try {
        const dbSessions = await fetchChatSessionsFromSupabase();
        if (dbSessions && dbSessions.length > 0) {
          setSessions(dbSessions);
          setActiveSessionId(dbSessions[0].id);
        }
      } catch (e) {
        console.warn("Erro ao carregar sessões de chat do Supabase:", e);
      }
    }
    loadChatSessions();
  }, []);

  // Sync sessions with localStorage, Supabase and update scroll
  useEffect(() => {
    localStorage.setItem("aip_chat_sessions", JSON.stringify(sessions));
    
    // Sync to Supabase in background
    sessions.forEach(session => {
      saveChatSessionToSupabase(session).catch(e => console.warn("Erro de sincronismo de chat no Supabase:", e));
    });

    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [sessions, activeSessionId, isOpen]);

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
    const newId = `chat-${Date.now()}`;
    const newSession: ChatSession = {
      id: newId,
      title: `Conversa ${sessions.length + 1}`,
      selectedEditalId: activeEdital ? "active" : "",
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

  const handleDeleteChat = (e: React.MouseEvent, idToDelete: string) => {
    e.stopPropagation();
    
    deleteChatSessionFromSupabase(idToDelete).catch((err) => console.warn("Erro ao deletar sessão de chat do Supabase:", err));
    const updated = sessions.filter(s => s.id !== idToDelete);
    
    if (updated.length === 0) {
      // Re-create a default one if all were deleted
      const defaultS: ChatSession = {
        id: "chat-default",
        title: "Chat Principal",
        selectedEditalId: "active",
        messages: [
          {
            id: `msg-init-${Date.now()}`,
            role: "assistant",
            content: `Olá! Sou o seu **Assessor de Licitações Inteligente**. Como posso te ajudar hoje?`,
            timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
          }
        ],
        createdAt: new Date().toLocaleString("pt-BR")
      };
      setSessions([defaultS]);
      setActiveSessionId("chat-default");
    } else {
      setSessions(updated);
      if (activeSessionId === idToDelete) {
        setActiveSessionId(updated[0].id);
      }
    }

    // Trigger sweet success of storage deletion
    confetti({ particleCount: 30, spread: 40, colors: ["#ef4444", "#f87171"] });
    setShowSidebarMobile(true);
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

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
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
        body: { message: text }
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
      const selectedEditalObj = getSelectedEditalObject(activeSession.selectedEditalId);
      let replyText = "";

      const response = await apiFetch("/api/chat", {
        method: "POST",
        body: {
          messages: updatedMessages,
          companyData: companyData,
          activeEditalAnalysis: selectedEditalObj,
          systemCertificates: loadSystemCertificates()
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
      console.error("Erro no chat:", error);
      const errorText = error?.message || String(error);
      const errMessage: ChatMessage = {
        id: `msg-err-${Date.now()}`,
        role: "assistant",
        content: errorText.startsWith("❌") 
          ? errorText 
          : `❌ **Erro na comunicação com a IA:** ${errorText}\n\nVerifique se sua chave de API está configurada corretamente em **IA & Modelos**.`,
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
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 font-sans">
      
      {/* Floating Circle Button - Modern, visible and robust design */}
      {!isOpen && (
        <button
          onClick={() => {
            setIsOpen(true);
            setShowSidebarMobile(true);
          }}
          className="flex items-center gap-2.5 px-4.5 py-3 rounded-full bg-gradient-to-r from-indigo-600 via-indigo-550 to-violet-600 hover:from-indigo-550 hover:to-violet-550 text-white shadow-xl hover:shadow-indigo-500/25 shadow-slate-950/40 hover:scale-105 active:scale-95 transition-all duration-300 text-center cursor-pointer relative group border border-white/15 overflow-visible select-none"
          id="floating-chat-trigger"
        >
          {/* Inner hover glow */}
          <span className="absolute inset-0 rounded-full bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

          {/* Glowing pulse indicator ONLY if hasUnread is true */}
          {hasUnread && (
            <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-4.5 w-4.5 bg-emerald-500 border-2 border-slate-900" />
            </span>
          )}

          {/* Animated icon container */}
          <div className="bg-white/10 p-1.5 rounded-full border border-white/10 flex items-center justify-center shrink-0">
            <MessageSquare className="w-4.5 h-4.5 text-white group-hover:scale-110 transition-transform duration-300" />
          </div>

          {/* Pill text label */}
          <div className="flex flex-col text-left shrink-0 pr-1">
            <span className="text-[9px] font-extrabold uppercase tracking-widest text-indigo-200 leading-none mb-0.5">Online</span>
            <span className="text-xs font-bold text-white tracking-wide leading-none">Assessor IA</span>
          </div>

          {/* Mini Action Arrow */}
          <ArrowRight className="w-3.5 h-3.5 text-white/70 group-hover:translate-x-1 transition-transform duration-300 shrink-0" />

          {/* Elegant Tooltip overlay */}
          <span className="absolute right-0 bottom-14 bg-slate-950/95 text-slate-200 text-[10.5px] font-medium py-2 px-3 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 border border-white/10 shadow-2xl backdrop-blur-md pointer-events-none whitespace-nowrap">
            Dúvidas? Pergunte ao Assessor Inteligente!
          </span>
        </button>
      )}

      {/* Expanded Dual-Pane Chat Modal window */}
      {isOpen && (
        <div 
          id="chat-popup-container"
          className="bg-slate-900/40 border border-white/10 backdrop-blur-xl rounded-2xl shadow-2xl fixed inset-4 md:inset-auto md:bottom-6 md:right-6 w-auto md:w-[780px] lg:w-[860px] h-auto md:h-[580px] flex flex-row overflow-hidden animate-scale-up z-50"
          style={{
            width: isDesktop ? `${width}px` : undefined,
            height: isDesktop ? `${height}px` : undefined,
          }}
        >
          {/* Resize handles */}
          {isDesktop && (
            <>
              {/* Left Edge Handle */}
              <div
                className="absolute left-0 top-1 bottom-1 w-1.5 cursor-ew-resize hover:bg-indigo-500/40 active:bg-indigo-500 transition-colors z-50"
                onMouseDown={(e) => handleResizeStart(e, "left")}
                title="Arraste para redimensionar largura"
              />
              {/* Top Edge Handle */}
              <div
                className="absolute top-0 left-1 right-1 h-1.5 cursor-ns-resize hover:bg-indigo-500/40 active:bg-indigo-500 transition-colors z-50"
                onMouseDown={(e) => handleResizeStart(e, "top")}
                title="Arraste para redimensionar altura"
              />
              {/* Top-Left Corner Handle */}
              <div
                className="absolute left-0 top-0 w-3.5 h-3.5 cursor-nwse-resize hover:bg-indigo-500/50 active:bg-indigo-500 transition-colors z-50 border-t-2 border-l-2 border-slate-500/40 rounded-tl"
                onMouseDown={(e) => handleResizeStart(e, "top-left")}
                title="Arraste para redimensionar"
              />
            </>
          )}
          {/* LEFT SIDEBAR VIEW - CHATS CATALOG */}
          <div className={`
            ${showSidebarMobile ? "flex w-full" : "hidden md:flex"} 
            md:w-64 border-r border-white/10 flex-col bg-slate-950/50 shrink-0 h-full
          `}>
            {/* Sidebar Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 tracking-wider uppercase flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                Canais de Chat
              </span>
              <button
                onClick={handleNewChat}
                className="bg-indigo-600 hover:bg-indigo-500 text-white p-1.5 rounded-lg flex items-center gap-1 text-[11px] font-semibold hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
                title="Novo canal de chat"
              >
                <Plus className="w-3.5 h-3.5" />
                Novo
              </button>
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
                    className={`group w-full text-left p-3 rounded-xl transition-all flex flex-col justify-between cursor-pointer border ${
                      isActive 
                        ? "bg-indigo-600/20 border-indigo-500/30 text-white" 
                        : "bg-transparent border-transparent hover:bg-white/5 text-slate-300"
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
                            className="bg-slate-900 border border-indigo-500 rounded px-1.5 py-0.5 text-xs text-white flex-1 focus:outline-none"
                            autoFocus
                          />
                          <button 
                            onClick={() => handleSaveRename(s.id)}
                            className="p-1 text-emerald-400 hover:text-emerald-350 bg-emerald-500/10 rounded"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <span className="font-bold text-xs truncate max-w-[150px]">
                          {s.title}
                        </span>
                      )}

                      {!isEditing && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => handleStartRename(e, s)}
                            className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded"
                            title="Renomear chat"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteChat(e, s.id)}
                            className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded"
                            title="Apagar chat (limpa do DB)"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-1.5 flex items-center justify-between w-full text-[10px] text-slate-400">
                      <span className="truncate max-w-[120px]">
                        {lastMsg ? lastMsg.content.slice(0, 30) + (lastMsg.content.length > 30 ? "..." : "") : "Sem mensagens"}
                      </span>
                      {s.selectedEditalId && (
                        <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-400/20 px-1 rounded truncate max-w-[80px]">
                          {s.selectedEditalId === "active" ? "Edital Ativo" : "Histórico"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Sidebar Footer */}
            <div className="p-3 border-t border-white/10 bg-slate-950/20 text-[10px] text-slate-400 flex flex-col gap-1 select-none">
              <p>📌 *Bco. Dados*: LocalStorage</p>
              <p>🗑️ Ao excluir, o espaço é liberado.</p>
            </div>
          </div>

          {/* RIGHT CHAT WINDOW VIEW */}
          <div className={`
            ${!showSidebarMobile ? "flex" : "hidden md:flex"} 
            flex-1 flex-col h-full bg-slate-900/10
          `}>
            {/* Header */}
            <div className="bg-white/5 border-b border-white/10 text-white p-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                {/* Back to sidebar button on Mobile */}
                <button
                  onClick={() => setShowSidebarMobile(true)}
                  className="md:hidden text-slate-400 hover:text-white p-1 hover:bg-white/10 rounded-lg shrink-0 mr-1"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                
                <div className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 p-1.5 rounded-lg">
                  <Bot className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-bold text-xs md:text-sm">{activeSession.title}</h3>
                  <p className="text-[10px] text-slate-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Assessoria Gemini Inteligente
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {isDesktop && (width !== DEFAULT_WIDTH || height !== DEFAULT_HEIGHT) && (
                  <button
                    onClick={() => {
                      setWidth(DEFAULT_WIDTH);
                      setHeight(DEFAULT_HEIGHT);
                      localStorage.removeItem("aip_chat_width");
                      localStorage.removeItem("aip_chat_height");
                    }}
                    className="text-xs text-indigo-300 hover:text-indigo-200 border border-indigo-500/20 hover:border-indigo-500/40 bg-indigo-500/10 px-2 py-1 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                    title="Restaurar o tamanho padrão da janela do chat"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Tamanho Padrão</span>
                  </button>
                )}

                <button
                  onClick={() => setIsOpen(false)}
                  className="text-slate-400 hover:text-white p-1.5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Edital Selection Context Ribbon - Ultra Compact & Elegant Custom Dropdown */}
            <div className="bg-slate-950/70 px-4 py-2 border-b border-white/10 flex items-center justify-between gap-3 shrink-0 select-none text-xs relative z-30">
              <div className="flex items-center gap-1.5 min-w-0">
                <Database className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="text-[11px] font-bold text-slate-300 shrink-0">Foco do Chat:</span>
                
                {/* Visual state indicator dot */}
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeSession.selectedEditalId ? "bg-indigo-400 animate-pulse" : "bg-slate-500"}`} />
                
                <span className="text-[10px] text-slate-400 hidden sm:inline truncate max-w-[120px] md:max-w-[180px]">
                  {activeSession.selectedEditalId ? "Focando em edital específico" : "Geral / Sem edital"}
                </span>
              </div>
              
              {/* Custom Searchable Select Dropdown Container */}
              <div ref={dropdownRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="max-w-[195px] sm:max-w-[340px] flex items-center justify-between gap-2 bg-slate-900/90 hover:bg-slate-800/95 border border-white/10 hover:border-indigo-500/40 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none transition-all cursor-pointer shadow-sm active:scale-95 text-left"
                >
                  <span className="truncate">
                    {activeSession.selectedEditalId === "" && "💬 Nenhum Edital (Conversa Geral)"}
                    {activeSession.selectedEditalId === "active" && (
                      `✨ Edital Ativo (${activeEdital?.identificacaoCertame?.orgaoComprador?.substring(0, 20) || "Em Análise"}...)`
                    )}
                    {activeSession.selectedEditalId !== "" && activeSession.selectedEditalId !== "active" && (
                      (() => {
                        const found = editalHistory.find(h => h.id === activeSession.selectedEditalId);
                        const ed = found?.analysis || found;
                        return `📄 ${found?.title || ed?.identificacaoCertame?.orgaoComprador?.substring(0, 20) || "Edital Histórico"}`;
                      })()
                    )}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${isDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {/* Dropdown Popover */}
                {isDropdownOpen && (
                  <div className="absolute right-0 mt-1.5 w-64 sm:w-80 bg-slate-950/95 border border-white/15 rounded-xl shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden max-h-72 animate-scale-up">
                    {/* Search Field */}
                    <div className="p-2 border-b border-white/10 flex items-center gap-2 bg-slate-900/40 shrink-0">
                      <Search className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1" />
                      <input
                        type="text"
                        placeholder="Buscar edital analisado..."
                        value={dropdownSearch}
                        onChange={(e) => setDropdownSearch(e.target.value)}
                        className="w-full bg-transparent text-slate-200 placeholder-slate-500 text-[11px] focus:outline-none py-1"
                        autoFocus
                      />
                      {dropdownSearch && (
                        <button
                          type="button"
                          onClick={() => setDropdownSearch("")}
                          className="text-slate-500 hover:text-slate-300 p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Scrollable Options List */}
                    <div className="overflow-y-auto py-1 max-h-56 divide-y divide-white/5 scrollbar-thin">
                      {/* Option: Conversa Geral */}
                      {(!dropdownSearch || "conversa geral sem focar nenhum edital".includes(dropdownSearch.toLowerCase())) && (
                        <button
                          type="button"
                          onClick={() => {
                            handleSelectEdital("");
                            setIsDropdownOpen(false);
                            setDropdownSearch("");
                          }}
                          className={`w-full text-left px-3 py-2 text-[11px] hover:bg-white/5 flex items-center justify-between transition-colors ${activeSession.selectedEditalId === "" ? "text-indigo-400 font-bold bg-indigo-500/5" : "text-slate-300"}`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <MessageSquare className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                            <span className="truncate">Nenhum Edital (Conversa Geral)</span>
                          </span>
                          {activeSession.selectedEditalId === "" && <Check className="w-3.5 h-3.5 text-indigo-450 shrink-0" />}
                        </button>
                      )}

                      {/* Group: Active Edital */}
                      {activeEdital && (!dropdownSearch || (activeEdital.identificacaoCertame?.orgaoComprador || "").toLowerCase().includes(dropdownSearch.toLowerCase())) && (
                        <div>
                          <div className="px-3 py-1 bg-white/2 text-[9px] font-extrabold uppercase tracking-wider text-indigo-300 shrink-0">
                            ✨ Edital Ativo em Análise
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              handleSelectEdital("active");
                              setIsDropdownOpen(false);
                              setDropdownSearch("");
                            }}
                            className={`w-full text-left px-3 py-2 text-[11px] hover:bg-white/5 flex items-center justify-between transition-colors ${activeSession.selectedEditalId === "active" ? "text-indigo-400 font-bold bg-indigo-500/5" : "text-slate-300"}`}
                          >
                            <span className="flex items-center gap-2 truncate">
                              <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                              <span className="truncate">
                                {activeEdital.identificacaoCertame?.orgaoComprador || "Edital Carregado"}
                              </span>
                            </span>
                            {activeSession.selectedEditalId === "active" && <Check className="w-3.5 h-3.5 text-indigo-450 shrink-0" />}
                          </button>
                        </div>
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
                              <div className="px-3 py-1 bg-white/2 text-[9px] font-extrabold uppercase tracking-wider text-slate-400 shrink-0 flex items-center justify-between">
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
                                    className={`w-full text-left px-3 py-2 text-[11px] hover:bg-white/5 flex flex-col justify-center transition-colors ${isSelected ? "text-indigo-400 font-bold bg-indigo-500/5" : "text-slate-300"}`}
                                  >
                                    <div className="flex items-center justify-between w-full gap-2">
                                      <span className="flex items-center gap-2 truncate">
                                        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                        <span className="truncate">{title}</span>
                                      </span>
                                      {isSelected && <Check className="w-3.5 h-3.5 text-indigo-450 shrink-0" />}
                                    </div>
                                    <span className="text-[9px] text-slate-500 ml-5 truncate block">
                                      {desc}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        } else if (dropdownSearch && filteredHistory.length === 0) {
                          return (
                            <div className="px-3 py-4 text-center text-[11px] text-slate-500">
                              Nenhum edital encontrado para "{dropdownSearch}"
                            </div>
                          );
                        } else if (editalHistory.length === 0) {
                          return (
                            <div className="px-3 py-4 text-center text-[11px] text-slate-500">
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

            {/* Scrollable Messages Area */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/10 select-text"
            >
              {activeSession.messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex gap-2 text-xs md:text-sm ${
                    m.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {m.role === "assistant" && (
                    <div className="bg-white/5 border border-white/10 text-indigo-400 p-2 rounded-lg h-7 w-7 flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}
                  
                  <div
                    className={`max-w-[80%] rounded-2xl p-3 leading-normal border shadow-sm select-text ${
                      m.role === "user"
                        ? "bg-indigo-600/80 border-indigo-500/30 text-white rounded-tr-none"
                        : "bg-white/5 text-slate-100 border-white/10 rounded-tl-none"
                    }`}
                  >
                    {/* Render attachment if any */}
                    {m.attachment && (
                      <div className="mb-2.5 bg-slate-950/40 p-2 rounded-xl border border-white/10 text-slate-300 flex items-center gap-2 max-w-sm">
                        {m.attachment.type === "application/system-doc" ? (
                          <div className="flex items-center gap-2 w-full">
                            <div className="bg-indigo-500/15 text-indigo-400 p-1.5 rounded-lg border border-indigo-500/30">
                              <FolderOpen className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold truncate text-indigo-200">
                                {m.attachment.name}
                              </p>
                              <p className="text-[9px] text-indigo-300 uppercase font-mono font-bold">
                                Documento do Sistema
                              </p>
                            </div>
                          </div>
                        ) : m.attachment.type.startsWith("image/") ? (
                          <div className="flex flex-col gap-1 w-full">
                            <img 
                              src={m.attachment.data} 
                              alt="Anexo" 
                              className="max-h-40 rounded-lg object-contain bg-slate-900 border border-white/10 w-full"
                              referrerPolicy="no-referrer"
                            />
                            <span className="text-[10px] text-slate-400 truncate mt-1">
                              📷 {m.attachment.name}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 w-full">
                            <div className="bg-red-500/10 text-red-400 p-1.5 rounded-lg">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold truncate text-slate-200">
                                {m.attachment.name}
                              </p>
                              <p className="text-[9px] text-slate-400 uppercase">
                                Documento / {m.attachment.type.split("/")[1] || "File"}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="text-xs leading-normal select-text space-y-3">
                      {m.role === "assistant" ? (
                        parseMessageContent(m.content).map((part, pIdx) => {
                          if (part.type === "document") {
                            const docTitle = part.title || "documento.md";
                            const docContent = part.content;
                            const wordCount = getWordCount(docContent);

                            return (
                              <div 
                                key={pIdx} 
                                className="my-3 bg-slate-950/60 rounded-xl border border-indigo-500/35 overflow-hidden shadow-xl"
                              >
                                {/* Doc Card Header */}
                                <div className="bg-indigo-950/50 px-3.5 py-2.5 border-b border-indigo-500/25 flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <div className="p-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-400">
                                      <FileText className="w-4 h-4" />
                                    </div>
                                    <div>
                                      <p className="text-[9px] font-bold uppercase tracking-wider text-indigo-400">Documento Oficial Gerado</p>
                                      <p className="text-xs font-bold text-slate-100 truncate max-w-[180px] sm:max-w-xs">{docTitle}</p>
                                    </div>
                                  </div>
                                  <span className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/25 px-2 py-0.5 rounded-full text-[9px] font-mono">
                                    {wordCount} palavras
                                  </span>
                                </div>

                                {/* Doc Card Body with Actions */}
                                <div className="p-3.5 flex flex-col gap-2 bg-slate-900/10">
                                  <p className="text-[11px] text-slate-300 flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                    Pronto para impressão, exportação ou download.
                                  </p>
                                  
                                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-white/5">
                                    {/* Action: Preview */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPreviewDocTitle(docTitle);
                                        setPreviewDocContent(docContent);
                                      }}
                                      className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 hover:text-white px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1"
                                      title="Visualizar documento em tela cheia para impressão"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      <span>Visualizar</span>
                                    </button>

                                    {/* Action: Copy */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(docContent);
                                        alert("Documento copiado para a área de transferência!");
                                      }}
                                      className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 hover:text-white px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1"
                                      title="Copiar texto em formato Markdown"
                                    >
                                      <ClipboardCopy className="w-3.5 h-3.5" />
                                      <span>Copiar</span>
                                    </button>

                                    {/* Action: Download */}
                                    <button
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
                                      className="flex-1 bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500/20 hover:border-indigo-500 text-indigo-300 hover:text-white px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1"
                                      title="Baixar arquivo Markdown (.md)"
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      <span>Baixar</span>
                                    </button>

                                    {/* Action: Sync/Save to GDrive */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        let docType: "document" | "sheet" | "proposal" | "declaration" = "document";
                                        if (docTitle.toLowerCase().includes("proposta")) docType = "proposal";
                                        else if (docTitle.toLowerCase().includes("declara")) docType = "declaration";
                                        
                                        addSyncedItem(docTitle.replace(".md", ""), docType, docContent);
                                        confetti({ particleCount: 50, spread: 60, colors: ["#10b981", "#059669"] });
                                        alert(`Sucesso! "${docTitle}" foi importado para sua central de sincronismo (Google Drive & Supabase).`);
                                      }}
                                      className="flex-1 bg-emerald-600/20 hover:bg-emerald-600 border border-emerald-500/30 hover:border-emerald-500 text-emerald-400 hover:text-white px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1"
                                      title="Salvar na Central de Sincronismo"
                                    >
                                      <Database className="w-3.5 h-3.5" />
                                      <span>Importar</span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          } else {
                            return (
                              <ReactMarkdown 
                                key={pIdx}
                                components={{
                                  p: ({node, ...props}) => <p className="mb-1.5 last:mb-0 select-text whitespace-pre-wrap leading-normal font-sans" {...props} />,
                                  strong: ({node, ...props}) => <strong className="font-bold select-text text-indigo-200 font-extrabold" {...props} />,
                                  ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-2 mt-1 space-y-1 select-text" {...props} />,
                                  ol: ({node, ...props}) => <ol className="list-decimal pl-4 mb-2 mt-1 space-y-1 select-text" {...props} />,
                                  li: ({node, ...props}) => <li className="select-text whitespace-pre-wrap" {...props} />,
                                  code: ({node, ...props}) => <code className="bg-slate-950/50 px-1 rounded text-[11px] font-mono select-text" {...props} />,
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
                            p: ({node, ...props}) => <p className="mb-1.5 last:mb-0 select-text whitespace-pre-wrap leading-normal font-sans" {...props} />,
                            strong: ({node, ...props}) => <strong className="font-bold select-text text-white font-black" {...props} />,
                            ul: ({node, ...props}) => <ul className="list-disc pl-4 mb-2 mt-1 space-y-1 select-text" {...props} />,
                            ol: ({node, ...props}) => <ol className="list-decimal pl-4 mb-2 mt-1 space-y-1 select-text" {...props} />,
                            li: ({node, ...props}) => <li className="select-text whitespace-pre-wrap" {...props} />,
                            code: ({node, ...props}) => <code className="bg-slate-950/50 px-1 rounded text-[11px] font-mono select-text" {...props} />,
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>
                      )}
                    </div>
                    <span className={`text-[9px] block text-right mt-1.5 ${
                      m.role === "user" ? "text-indigo-200" : "text-slate-400"
                    }`}>
                      {m.timestamp}
                    </span>
                  </div>

                  {m.role === "user" && (
                    <div className="bg-white/10 border border-white/10 text-white p-2 rounded-lg h-7 w-7 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex gap-2 justify-start items-center text-xs text-slate-400 animate-pulse">
                  <div className="bg-white/5 border border-white/10 text-indigo-400 p-2 rounded-lg h-7 w-7 flex items-center justify-center shrink-0">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                  <span>Pesquisando histórico de licitações e estruturando resposta...</span>
                </div>
              )}
            </div>



            {/* PRE-UPLOADED ATTACHMENT TRAY */}
            {selectedAttachment && (
              <div className="px-4 py-2 bg-slate-950/80 border-t border-white/10 flex items-center justify-between gap-2 text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  {selectedAttachment.type.startsWith("image/") ? (
                    <Image className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <FileText className="w-4 h-4 text-rose-400" />
                  )}
                  <span className="truncate max-w-[200px] font-bold text-white">
                    {selectedAttachment.name}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    (Pronto para envio)
                  </span>
                </div>
                <button
                  onClick={() => setSelectedAttachment(null)}
                  className="text-red-400 hover:text-red-300 p-1 hover:bg-white/5 rounded-lg"
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
              className="p-3 border-t border-white/10 bg-slate-900/65 flex items-center gap-2 shrink-0 select-none"
            >
              <input 
                type="file"
                ref={attachmentInputRef}
                onChange={handleFileAttachmentChange}
                className="hidden"
                accept="image/*,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              />

              <button
                type="button"
                onClick={handleFileAttachmentClick}
                className="bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 p-2 rounded-xl transition-all h-9 w-9 flex items-center justify-center cursor-pointer shrink-0"
                title="Anexar Imagem ou Arquivo Local"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleOpenSystemDocSelector}
                className="bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-600/20 p-2 rounded-xl transition-all h-9 w-9 flex items-center justify-center cursor-pointer shrink-0"
                title="Anexar documento ou edital do sistema"
              >
                <FolderOpen className="w-4 h-4" />
              </button>

              <input 
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onPaste={handlePaste}
                placeholder="Escreva sua dúvida, cole uma imagem (Ctrl+V) ou anexe arquivos..."
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs md:text-sm text-white placeholder-slate-400 focus:outline-none focus:bg-slate-950/60 focus:ring-1 focus:ring-indigo-500"
              />

              <button
                type="submit"
                disabled={loading || (!inputVal.trim() && !selectedAttachment)}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-white/5 text-white disabled:text-slate-500 p-2 rounded-xl hover:scale-[1.02] active:scale-95 transition-all h-9 w-9 flex items-center justify-center cursor-pointer shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>

          </div>
        </div>
      )}

      {/* SYSTEM DOCUMENTS SELECTOR MODAL */}
      {showSystemDocSelector && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in select-text">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg h-auto max-h-[80vh] flex flex-col shadow-2xl overflow-hidden select-text">
            
            {/* Header */}
            <div className="bg-slate-950/60 p-4 border-b border-white/10 flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-indigo-400" />
                <div className="text-left">
                  <h4 className="text-sm font-bold text-white">Documentos do Sistema</h4>
                  <p className="text-[10px] text-slate-400">Selecione um arquivo já presente na plataforma para anexar ao chat</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSystemDocSelector(false)}
                className="text-slate-400 hover:text-white p-1.5 hover:bg-white/10 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
              
              {/* 1. Editais section */}
              <div className="space-y-2 select-text">
                <h5 className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider text-left select-none">📄 Editais e Análises</h5>
                <div className="space-y-1.5">
                  {/* Active edital option */}
                  {activeEdital ? (
                    <button
                      type="button"
                      onClick={() => handleSelectSystemEdital({ title: "Edital_Ativo.txt", analysis: activeEdital })}
                      className="w-full text-left bg-indigo-500/10 hover:bg-indigo-500/25 border border-indigo-500/30 p-2.5 rounded-xl transition-all flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-200 truncate">★ Edital Ativo em Memória</p>
                        <p className="text-[9px] text-indigo-300 truncate">
                          {activeEdital.identificacaoCertame?.orgaoComprador || "Órgão Licitante"}
                        </p>
                      </div>
                      <span className="bg-indigo-500/20 text-indigo-300 text-[8px] uppercase font-bold px-1.5 py-0.5 rounded-md border border-indigo-400/25">Anexar</span>
                    </button>
                  ) : (
                    <p className="text-[10px] text-slate-500 italic px-2 text-left select-none">Nenhum edital ativo em foco no momento.</p>
                  )}

                  {/* Historical editais options */}
                  {editalHistory.length > 0 && (
                    <div className="pt-1.5 space-y-1">
                      <p className="text-[9px] text-slate-400 font-bold text-left select-none font-mono">Histórico de Editais Analisados:</p>
                      {editalHistory.map((item, idx) => {
                        const ed = item.analysis || item;
                        const organ = ed.identificacaoCertame?.orgaoComprador || "Histórico";
                        const title = item.title || `Pregão de ${organ.substring(0, 15)}`;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleSelectSystemEdital(item)}
                            className="w-full text-left bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 rounded-xl transition-all flex items-center justify-between gap-2 cursor-pointer"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-slate-300 truncate">{title}</p>
                              <p className="text-[9px] text-slate-500 truncate">{organ}</p>
                            </div>
                            <span className="bg-slate-800 text-slate-400 text-[8px] uppercase font-bold px-1.5 py-0.5 rounded-md border border-white/5">Anexar</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Certificados/Documentos section */}
              <div className="space-y-2 select-text">
                <h5 className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider text-left select-none">💼 Certidões e Documentos da Empresa</h5>
                <div className="space-y-1.5">
                  {systemCerts.length > 0 ? (
                    systemCerts.map((cert) => (
                      <button
                        key={cert.id}
                        type="button"
                        onClick={() => handleSelectSystemCert(cert)}
                        className="w-full text-left bg-white/5 hover:bg-white/10 border border-white/10 p-2.5 rounded-xl transition-all flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-300 truncate">{cert.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${cert.status === "valid" ? "bg-emerald-400" : cert.status === "expiring_soon" ? "bg-yellow-400 animate-pulse" : "bg-rose-400"}`} />
                            <p className="text-[9px] text-slate-500">
                              {cert.status === "valid" ? "Válida" : cert.status === "expiring_soon" ? "Próxima ao Vencimento" : "Vencida/Pendente"}
                              {cert.expirationDate ? ` • Vencimento: ${cert.expirationDate}` : ""}
                            </p>
                          </div>
                        </div>
                        <span className="bg-slate-800 text-slate-400 text-[8px] uppercase font-bold px-1.5 py-0.5 rounded-md border border-white/5">Anexar</span>
                      </button>
                    ))
                  ) : (
                    <p className="text-[10px] text-slate-500 italic px-2 text-left select-none">Nenhuma certidão ou documento cadastrado no momento.</p>
                  )}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="bg-slate-950/40 p-3 border-t border-white/10 flex justify-end select-none">
              <button
                type="button"
                onClick={() => setShowSystemDocSelector(false)}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN DOCUMENT PREVIEW MODAL */}
      {previewDocContent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md overflow-y-auto select-text">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-4xl h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-scale-up select-text">
            
            {/* Modal Header */}
            <div className="bg-slate-950/60 p-4 border-b border-white/10 flex items-center justify-between select-none">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" />
                <div className="text-left">
                  <h4 className="text-sm font-bold text-white">Visualizador de Documento Oficial</h4>
                  <p className="text-[10px] text-slate-400">{previewDocTitle}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {/* Print button */}
                <button
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
                              body { font-family: 'Inter', sans-serif; padding: 50px; color: #1e293b; line-height: 1.65; background-color: #ffffff; }
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
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Printer className="w-4 h-4" />
                  <span>Imprimir</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPreviewDocTitle(null);
                    setPreviewDocContent(null);
                  }}
                  className="text-slate-400 hover:text-white p-2 hover:bg-white/10 rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Document Sheet Canvas */}
            <div className="flex-1 overflow-y-auto p-8 bg-slate-950/25 flex justify-center select-text">
              <div className="w-full max-w-2xl bg-white text-slate-900 shadow-xl rounded-xl p-8 sm:p-12 border border-slate-200 select-text overflow-y-auto font-sans text-xs md:text-sm text-left">
                <ReactMarkdown
                  components={{
                    p: ({node, ...props}) => <p className="mb-4 select-text leading-relaxed font-sans text-slate-800 text-justify" {...props} />,
                    strong: ({node, ...props}) => <strong className="font-bold select-text text-slate-950" {...props} />,
                    h1: ({node, ...props}) => <h1 className="text-base md:text-lg font-bold border-b pb-2 mb-4 text-slate-900 tracking-tight text-center uppercase" {...props} />,
                    h2: ({node, ...props}) => <h2 className="text-xs md:text-sm font-bold mb-3 text-slate-900 mt-6 border-b pb-1 border-slate-100" {...props} />,
                    h3: ({node, ...props}) => <h3 className="text-[11px] md:text-xs font-bold mb-2 text-slate-800 mt-4" {...props} />,
                    ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-4 space-y-1 select-text text-slate-700" {...props} />,
                    ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-4 space-y-1 select-text text-slate-700" {...props} />,
                    li: ({node, ...props}) => <li className="select-text whitespace-pre-wrap leading-relaxed" {...props} />,
                    table: ({node, ...props}) => (
                      <div className="overflow-x-auto my-4 border border-slate-150 rounded-lg">
                        <table className="min-w-full divide-y divide-slate-200" {...props} />
                      </div>
                    ),
                    thead: ({node, ...props}) => <thead className="bg-slate-55" {...props} />,
                    tbody: ({node, ...props}) => <tbody className="divide-y divide-slate-100" {...props} />,
                    tr: ({node, ...props}) => <tr className="hover:bg-slate-50/50" {...props} />,
                    th: ({node, ...props}) => <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600 border-b bg-slate-50" {...props} />,
                    td: ({node, ...props}) => <td className="px-3 py-1.5 text-[11px] text-slate-700 border-b select-text whitespace-pre-wrap" {...props} />,
                    code: ({node, ...props}) => <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-[11px] font-mono" {...props} />,
                  }}
                >
                  {previewDocContent}
                </ReactMarkdown>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-950/40 p-4 border-t border-white/10 flex justify-end gap-2 select-none">
              <button
                type="button"
                onClick={() => {
                  setPreviewDocTitle(null);
                  setPreviewDocContent(null);
                }}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Fechar Visualizador
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
