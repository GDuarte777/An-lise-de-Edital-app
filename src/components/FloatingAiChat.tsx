import { useState, useRef, useEffect } from "react";
import { ChatMessage, CompanyData, EditalAnalysis } from "../types";
import { MessageSquare, X, Send, Bot, User, CornerDownLeft, Sparkles, Loader2, HelpCircle, ArrowRight } from "lucide-react";

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
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem("aip_chat_history");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // Fallback to default
      }
    }
    return [
      {
        id: "chat-1",
        role: "assistant",
        content: `Olá! Sou o seu **Assessor de Licitações Inteligente**. Como posso te ajudar hoje?
        
Posso analisar editais, validar exigências fiscais contra suas certidões atuais, ou redigir recursos jurídicos para recursos. Sinta-se livre para tirar dúvidas!`,
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      }
    ];
  });

  const [inputVal, setInputVal] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem("aip_chat_history", JSON.stringify(messages));
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const handleSend = async (text: string) => {
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputVal("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg],
          companyData: companyData,
          activeEditalAnalysis: activeEdital
        })
      });

      if (!response.ok) {
        throw new Error("Erro na rede.");
      }

      const data = await response.json();
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: data.reply || "Desculpe, não consegui obter uma resposta adequada. Tente novamente.",
        timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (error) {
      console.error("Erro no chat:", error);
      setMessages(prev => [
        ...prev,
        {
          id: `msg-err-${Date.now()}`,
          role: "assistant",
          content: "❌ *Instabilidade de Conexão*: Não consegui me comunicar com o servidor do Gemini. Certatifique-se de que o backend está online or tente reinicializar o painel.",
          timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 font-sans">
      
      {/* Floating Circle Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="relative bg-gradient-to-r from-indigo-650 to-indigo-550 hover:from-indigo-550 hover:to-indigo-450 text-white p-4 rounded-full shadow-lg hover:shadow-indigo-500/20 shadow-indigo-950/40 hover:scale-105 active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer group border border-white/10"
          id="floating-chat-trigger"
        >
          {/* Pulsing indicator */}
          <span className="absolute top-0 right-0 h-3 w-3 rounded-full bg-emerald-400 border-2 border-slate-950 animate-ping" />
          <MessageSquare className="w-6 h-6" />
          <span className="absolute right-14 bg-slate-950/90 text-white text-[11px] font-semibold py-1 px-2.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 border border-white/10 shadow-md backdrop-blur-md pointer-events-none whitespace-nowrap">
            Assistente Gemini On-line
          </span>
        </button>
      )}

      {/* Expanded Chat Box Popup */}
      {isOpen && (
        <div 
          id="chat-popup-container"
          className="bg-slate-900/40 border border-white/10 backdrop-blur-xl rounded-2xl shadow-2xl w-85 md:w-[420px] h-[550px] flex flex-col overflow-hidden animate-scale-up"
        >
          {/* Header */}
          <div className="bg-white/5 border-b border-white/10 text-white p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 p-1.5 rounded-lg">
                <Bot className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h3 className="font-bold text-xs md:text-sm">Assessor de Licitações</h3>
                <p className="text-[10px] text-slate-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Alimentado por Gemini 2.5-Flash
                </p>
              </div>
            </div>
            
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white p-1.5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages Area */}
          <div 
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/20"
          >
            {/* Display message content */}
            {messages.map((m) => (
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
                  className={`max-w-[80%] rounded-2xl p-3 leading-normal border ${
                    m.role === "user"
                      ? "bg-indigo-600/80 border-indigo-500/30 text-white rounded-tr-none"
                      : "bg-white/5 text-slate-100 border-white/10 rounded-tl-none"
                  }`}
                >
                  <p className="whitespace-pre-line font-normal prose text-xs prose-invert leading-normal">
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
                <span>Formulando estratégia regulamentar...</span>
              </div>
            )}
          </div>

          {/* Quick Suggestions row */}
          {messages.length === 1 && (
            <div className="px-4 py-2 border-t border-white/10 bg-white/5 space-y-1.5 shrink-0">
              <span className="text-[10px] font-bold text-slate-450 uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-indigo-400" />
                Sugestões Rápidas:
              </span>
              <div className="flex gap-1.5 overflow-x-auto pb-1 select-none scrollbar-none scroll-smooth">
                {CONSTANT_SUGGESTIONS.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(s)}
                    className="shrink-0 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-md px-2.5 py-1 text-[10px] md:text-xs text-left cursor-pointer transition-colors max-w-xs"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input Form Box */}
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(inputVal);
            }}
            className="p-3 border-t border-white/10 bg-slate-900/65 flex items-center gap-2 shrink-0"
          >
            <input 
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="Escreva aqui sua busca técnica, consulta fiscal..."
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs md:text-sm text-white placeholder-slate-400 focus:outline-none focus:bg-slate-950/60 focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={loading || !inputVal.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-white/5 text-white disabled:text-slate-500 p-2 rounded-xl hover:scale-[1.02] active:scale-95 transition-all h-9 w-9 flex items-center justify-center cursor-pointer shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

        </div>
      )}

    </div>
  );
}
