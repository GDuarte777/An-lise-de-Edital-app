import { useState, useRef, useEffect } from "react";
import { ChatMessage, ChatSession, CompanyData, EditalAnalysis, Attachment } from "../types";
import { 
  MessageSquare, X, Send, Bot, User, Sparkles, Loader2, Plus, Trash2, 
  Paperclip, Image, FileText, ChevronLeft, Edit2, Check, ArrowRight 
} from "lucide-react";
import confetti from "canvas-confetti";

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
  
  // Loaded edital history
  const [editalHistory, setEditalHistory] = useState<any[]>([]);

  // Load edital history from localStorage dynamically
  const reloadEditalHistory = () => {
    const saved = localStorage.getItem("aip_edital_history");
    if (saved) {
      try {
        setEditalHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Erro ao carregar histórico de editais:", e);
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      reloadEditalHistory();
    }
  }, [isOpen]);

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

  // Editing session title states
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionTitleInput, setSessionTitleInput] = useState("");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  // Sync sessions with localStorage and update scroll
  useEffect(() => {
    localStorage.setItem("aip_chat_sessions", JSON.stringify(sessions));
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

  const handleFileAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reject files larger than 12MB to protect local storage
    if (file.size > 12 * 1024 * 1024) {
      alert("O arquivo excede o limite recomendado de 12MB. Selecione uma imagem ou arquivo menor.");
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

    // Update active session messages immediately
    const updatedMessages = [...(activeSession.messages || []), userMsg];
    
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, messages: updatedMessages };
      }
      return s;
    }));

    setInputVal("");
    setSelectedAttachment(null);
    setLoading(true);

    try {
      const selectedEditalObj = getSelectedEditalObject(activeSession.selectedEditalId);
      
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages,
          companyData: companyData,
          activeEditalAnalysis: selectedEditalObj
        })
      });

      if (!response.ok) {
        throw new Error("Erro na rede.");
      }

      const data = await response.json();
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: data.reply || "Desculpe, não consegui obter uma resposta para essa pergunta. Tente novamente.",
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      };

      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          return { ...s, messages: [...updatedMessages, assistantMsg] };
        }
        return s;
      }));
    } catch (error) {
      console.error("Erro no chat:", error);
      const errMessage: ChatMessage = {
        id: `msg-err-${Date.now()}`,
        role: "assistant",
        content: "❌ *Instabilidade na comunicação*: Não consegui contatar o servidor central do Gemini. Por favor, certifique-se de que o backend está online ou tente novamente em instantes.",
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      };

      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          return { ...s, messages: [...updatedMessages, errMessage] };
        }
        return s;
      }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 font-sans">
      
      {/* Floating Circle Button */}
      {!isOpen && (
        <button
          onClick={() => {
            setIsOpen(true);
            setShowSidebarMobile(true);
          }}
          className="relative bg-gradient-to-r from-indigo-650 to-indigo-550 hover:from-indigo-550 hover:to-indigo-450 text-white p-4 rounded-full shadow-lg hover:shadow-indigo-500/20 shadow-indigo-950/40 hover:scale-105 active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer group border border-white/10"
          id="floating-chat-trigger"
        >
          <span className="absolute top-0 right-0 h-3 w-3 rounded-full bg-emerald-400 border-2 border-slate-950 animate-ping" />
          <MessageSquare className="w-6 h-6" />
          <span className="absolute right-14 bg-slate-950/90 text-white text-[11px] font-semibold py-1 px-2.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 border border-white/10 shadow-md backdrop-blur-md pointer-events-none whitespace-nowrap">
            Assistente Multi-canal Ativo
          </span>
        </button>
      )}

      {/* Expanded Dual-Pane Chat Modal window */}
      {isOpen && (
        <div 
          id="chat-popup-container"
          className="bg-slate-900/40 border border-white/10 backdrop-blur-xl rounded-2xl shadow-2xl fixed inset-4 md:inset-auto md:bottom-6 md:right-6 w-auto md:w-[780px] lg:w-[860px] h-auto md:h-[580px] flex flex-row overflow-hidden animate-scale-up z-50"
        >
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
              
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-white p-1.5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Edital Selection Context Ribbon */}
            <div className="bg-slate-950/50 px-4 py-2 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs shrink-0 select-none">
              <div className="flex items-center gap-1.5 text-slate-300">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Edital no qual focar o Chat:</span>
              </div>
              
              <select
                value={activeSession.selectedEditalId}
                onChange={(e) => handleSelectEdital(e.target.value)}
                className="bg-slate-900 text-white border border-white/15 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Nenhum (Conversa Geral)</option>
                {activeEdital && (
                  <option value="active">
                    ★ Edital Ativo ({activeEdital.identificacaoCertame?.orgaoComprador?.substring(0, 20) || "Em Memória"}...)
                  </option>
                )}
                {editalHistory.map((item, idx) => {
                  const ed = item.analysis || item;
                  return (
                    <option key={item.id || idx} value={item.id}>
                      {item.title || `Pregão de ${ed.identificacaoCertame?.orgaoComprador?.substring(0, 20) || "Histórico"}`}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Scrollable Messages Area */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/10"
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
                    className={`max-w-[80%] rounded-2xl p-3 leading-normal border shadow-sm ${
                      m.role === "user"
                        ? "bg-indigo-600/80 border-indigo-500/30 text-white rounded-tr-none"
                        : "bg-white/5 text-slate-100 border-white/10 rounded-tl-none"
                    }`}
                  >
                    {/* Render attachment if any */}
                    {m.attachment && (
                      <div className="mb-2.5 bg-slate-950/40 p-2 rounded-xl border border-white/10 text-slate-300 flex items-center gap-2 max-w-sm">
                        {m.attachment.type.startsWith("image/") ? (
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

                    <p className="whitespace-pre-wrap font-normal prose text-xs prose-invert leading-normal">
                      {m.content}
                    </p>
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

            {/* Chatbot suggestions rows (Only show on startup with default message) */}
            {activeSession.messages.length === 1 && (
              <div className="px-4 py-2 border-t border-white/10 bg-white/5 space-y-1.5 shrink-0 select-none">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-indigo-400" />
                  Dúvidas Frequentes:
                </span>
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none scroll-smooth">
                  {CONSTANT_SUGGESTIONS.map((s, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSend(s)}
                      className="shrink-0 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-lg px-2.5 py-1 text-[10px] text-left cursor-pointer transition-colors max-w-xs"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                title="Anexar Imagem ou Arquivo de Edital"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <input 
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="Escreva sua dúvida técnica, fiscal, ou anexe um arquivo..."
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

    </div>
  );
}
