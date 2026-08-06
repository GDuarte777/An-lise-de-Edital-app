import { useState, useEffect, useRef } from "react";
import { 
  Play, Square, HelpCircle, Sliders, AlertTriangle, TrendingDown, 
  Trash2, RefreshCw, Layers, ShieldAlert, ShieldCheck, Cpu, HeartPulse, 
  Terminal, MessageSquare, ChevronDown, Check, Sparkles, Clock, Info, Download 
} from "lucide-react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend 
} from "recharts";
import { EditalAnalysis } from "../types";
import confetti from "canvas-confetti";

interface LanceBotTabProps {
  activeEdital: EditalAnalysis | null;
}

interface SimulatedLog {
  id: string;
  timestamp: string;
  type: "system" | "competitor" | "own" | "warning" | "success" | "chat";
  msg: string;
}

interface ChatMessageSimulated {
  id: string;
  sender: string;
  text: string;
  time: string;
}

interface ChartDataPoint {
  sec: number;
  "Menor Concorrente": number;
  "Nosso Lance": number;
}

const PREGOEIRO_PHRASES = [
  "Atenção licitantes, o item entrou na fase competitiva de lances de disputa aberta!",
  "Aviso: Licitantes que não enviarem documentos complementares serão desclassificados.",
  "Pregoeiro: Solicito redução de preço final para o arrematante do lote.",
  "Estou abrindo negociação com a melhor oferta para diminuir o valor unitário.",
  "Prorrogado o lote por mais 2 minutos devido às sucessivas ofertas inseridas nos últimos segundos."
];

export default function LanceBotTab({ activeEdital }: LanceBotTabProps) {
  const [editalHistory, setEditalHistory] = useState<any[]>([]);
  const [selectedEditalId, setSelectedEditalId] = useState<string>("");

  // Form states matching user requirements (persisted in localStorage)
  const [pregaoId, setPregaoId] = useState(() => localStorage.getItem("aip_bot_pregaoId") || "2026042100002");
  const [itemNum, setItemNum] = useState(() => localStorage.getItem("aip_bot_itemNum") || "1");
  const [valorInicial, setValorInicial] = useState(() => Number(localStorage.getItem("aip_bot_valorInicial")) || 1250.00);
  const [valorLimiteMinimo, setValorLimiteMinimo] = useState(() => Number(localStorage.getItem("aip_bot_valorLimiteMinimo")) || 850.00);
  const [tipoDecremento, setTipoDecremento] = useState<"fixo" | "percentual">(() => (localStorage.getItem("aip_bot_tipoDecremento") as any) || "fixo");
  const [valorDecremento, setValorDecremento] = useState(() => Number(localStorage.getItem("aip_bot_valorDecremento")) || 15.00);
  const [intervaloMs, setIntervaloMs] = useState(15000); // Default to 15 seconds as requested by the user

  // Save form fields to localStorage
  useEffect(() => { localStorage.setItem("aip_bot_pregaoId", pregaoId); }, [pregaoId]);
  useEffect(() => { localStorage.setItem("aip_bot_itemNum", itemNum); }, [itemNum]);
  useEffect(() => { localStorage.setItem("aip_bot_valorInicial", String(valorInicial)); }, [valorInicial]);
  useEffect(() => { localStorage.setItem("aip_bot_valorLimiteMinimo", String(valorLimiteMinimo)); }, [valorLimiteMinimo]);
  useEffect(() => { localStorage.setItem("aip_bot_tipoDecremento", tipoDecremento); }, [tipoDecremento]);
  useEffect(() => { localStorage.setItem("aip_bot_valorDecremento", String(valorDecremento)); }, [valorDecremento]);

  // Active status & Mode configuration
  const [isBotOn, setIsBotOn] = useState(false);
  const [isRealMode, setIsRealMode] = useState<boolean>(false);
  const [token, setToken] = useState<string>(() => localStorage.getItem("aip_comprasnet_token") || "");
  const [cookie, setCookie] = useState<string>(() => localStorage.getItem("aip_comprasnet_cookie") || "");
  const [lastSyncedFromExt, setLastSyncedFromExt] = useState<string>("");
  const [showExtGuide, setShowExtGuide] = useState<boolean>(false);

  // Advanced configurations for optimal bidding
  const [biddingStrategy, setBiddingStrategy] = useState<"imediato" | "cadenciado-15s" | "sniper" | "personalizado">("cadenciado-15s");
  const [modoAntiDetecao, setModoAntiDetecao] = useState<boolean>(true);
  const [coberturaGarantida] = useState<boolean>(true);

  // Auto-update timer interval when strategy changes
  useEffect(() => {
    if (biddingStrategy === "cadenciado-15s") {
      setIntervaloMs(15000);
    } else if (biddingStrategy === "imediato") {
      setIntervaloMs(1500);
    } else if (biddingStrategy === "sniper") {
      setIntervaloMs(5000); // 5 seconds interval for faster action under pressure
    }
  }, [biddingStrategy]);

  const [logs, setLogs] = useState<SimulatedLog[]>([
    {
      id: "1",
      timestamp: new Date().toLocaleTimeString("pt-BR"),
      type: "system",
      msg: "Robô de lances carregado. Pronto para conectar ao Compras.gov.br."
    }
  ]);

  // Alert safety
  const [margemEstourada, setMargemEstourada] = useState(false);

  // Real-time chart states
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [simulatedTimeSec, setSimulatedTimeSec] = useState(0);

  // Live pregoeiro chat list
  const [chatMessages, setChatMessages] = useState<ChatMessageSimulated[]>([
    {
      id: "c1",
      sender: "Pregoeiro Oficial",
      text: "Sejam bem-vindos à sala de disputa aberta. Verifiquem suas credenciais e documentos.",
      time: "10:14:15"
    }
  ]);

  const [competitorPriceState, setCompetitorPriceState] = useState<number>(1250.00);
  const [ourPriceState, setOurPriceState] = useState<number | null>(null);

  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  // Load edital history
  useEffect(() => {
    const loadEditalHistory = () => {
      const saved = localStorage.getItem("aip_edital_history");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setEditalHistory(parsed);
        } catch (e) {
          console.error("Erro ao ler histórico de editais no robô:", e);
        }
      }
    };

    loadEditalHistory();
    window.addEventListener("aip_edital_history_updated", loadEditalHistory);
    window.addEventListener("storage", loadEditalHistory);

    return () => {
      window.removeEventListener("aip_edital_history_updated", loadEditalHistory);
      window.removeEventListener("storage", loadEditalHistory);
    };
  }, []);

  // Persist token & cookie changes
  useEffect(() => {
    localStorage.setItem("aip_comprasnet_token", token);
  }, [token]);

  useEffect(() => {
    localStorage.setItem("aip_comprasnet_cookie", cookie);
  }, [cookie]);

  // Poll for extension session credentials sync
  useEffect(() => {
    let intv = setInterval(async () => {
      try {
        const res = await fetch("/api/session/current");
        if (res.ok) {
          const data = await res.json();
          if (data.token && data.token !== token) {
            setToken(data.token);
            if (data.cookie) setCookie(data.cookie);
            setLastSyncedFromExt(data.updatedAt || new Date().toLocaleTimeString("pt-BR"));
            pushLog(`⚡ Credenciais atualizadas automaticamente via Extensão do Chrome!`, "success");
          }
        }
      } catch (e: any) {
        // Log gently as a warning to prevent polluting platform error logs when offline or server is restarting
        console.warn("Erro de sincronização de credenciais da extensão (servidor offline ou reiniciando):", e?.message || e);
      }
    }, 2500);

    return () => clearInterval(intv);
  }, [token]);

  // Check if a bot job is already running on the server for the selected pregao + item
  useEffect(() => {
    const checkActiveBot = async () => {
      try {
        const res = await fetch(`/api/bot/status?pregaoId=${pregaoId}&itemNum=${itemNum}`);
        if (res.ok) {
          const data = await res.json();
          if (data.isActive) {
            setIsBotOn(true);
            setLogs(data.logs);
            setChartData(data.chartData);
            setCompetitorPriceState(data.currentCompetitorPrice);
            setOurPriceState(data.currentOurPrice);
            pushLog(`🔄 Sincronizado com o robô de lances em execução ativa no servidor.`, "success");
          }
        }
      } catch (e: any) {
        // Log gently as a warning
        console.warn("Erro ao sincronizar robô ativo:", e?.message || e);
      }
    };
    checkActiveBot();
  }, [pregaoId, itemNum]);

  // Update initial active edital
  useEffect(() => {
    if (activeEdital) {
      setSelectedEditalId("active");
      fillDataFromEdital(activeEdital);
    }
  }, [activeEdital]);

  const fillDataFromEdital = (ed: any) => {
    if (!ed) return;
    const certNum = ed.identificacaoCertame?.numeroCertame || "";
    const buyer = ed.identificacaoCertame?.orgaoComprador || "";
    if (certNum) {
      // clean punctuation for ID
      setPregaoId(certNum.replace(/\D/g, "") || "2026110904321");
    }
    // Estimate initial budget if present
    setValorInicial(1300.00);
    setValorLimiteMinimo(880.00);
    
    // Add log
    pushLog(`Dados pré-carregados a partir do edital: ${buyer.substring(0, 35)}...`, "system");
  };

  const handleSelectEditalChange = (id: string) => {
    setSelectedEditalId(id);
    if (id === "active") {
      fillDataFromEdital(activeEdital);
    } else if (id) {
      const selectedItem = editalHistory.find(h => h.id === id || h.timestamp === id);
      if (selectedItem) {
        fillDataFromEdital(selectedItem.analysis || selectedItem);
      }
    }
  };

  // Helper to add log
  const pushLog = (msg: string, type: "system" | "competitor" | "own" | "warning" | "success" | "chat") => {
    const timestamp = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(prev => [
      ...prev,
      {
        id: `log-${Date.now()}-${Math.random()}`,
        timestamp,
        type,
        msg
      }
    ]);
  };

  // Autoscrolling handlers for console logs and chat messages
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTo({
        top: logsContainerRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [logs]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [chatMessages]);

  // Main polling engine to sync with background server-side bot state
  useEffect(() => {
    let pollInterval: any = null;

    if (isBotOn) {
      const syncStatus = async () => {
        try {
          const res = await fetch(`/api/bot/status?pregaoId=${pregaoId}&itemNum=${itemNum}`);
          if (res.ok) {
            const data = await res.json();
            
            if (data.logs && data.logs.length > 0) {
              setLogs(data.logs);
            }
            if (data.chartData && data.chartData.length > 0) {
              setChartData(data.chartData);
            }
            if (data.currentCompetitorPrice !== undefined) {
              setCompetitorPriceState(data.currentCompetitorPrice);
            }
            if (data.currentOurPrice !== undefined) {
              setOurPriceState(data.currentOurPrice);
            }

            // If backend bot stopped itself (like safety margins hit or token expired)
            if (data.isActive === false && isBotOn) {
              setIsBotOn(false);
              setMargemEstourada(true);
              confetti({ particleCount: 45, spread: 60, colors: ["#ef4444", "#f87171"] });
            }
          }
        } catch (e: any) {
          console.warn("Erro ao sincronizar com servidor de lances (servidor offline ou reiniciando):", e?.message || e);
        }
      };

      syncStatus();
      pollInterval = setInterval(syncStatus, Math.max(1200, intervaloMs));
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [isBotOn, pregaoId, itemNum, intervaloMs]);

  // Start or Stop the server-side bot
  const toggleBot = async () => {
    if (!isBotOn) {
      // Validate inputs for live mode
      if (isRealMode && !token) {
        pushLog("⚠️ ERRO: Para o Modo Produção Real, você precisa informar seu Token de Autorização Compras.gov.br!", "warning");
        alert("Por favor, cole seu Token de Autorização Compras.gov.br para iniciar os lances ao vivo.");
        return;
      }

      setMargemEstourada(false);
      setChartData([{ sec: 0, "Menor Concorrente": valorInicial, "Nosso Lance": valorInicial }]);
      setCompetitorPriceState(valorInicial);
      setOurPriceState(valorInicial);

      try {
        const res = await fetch("/api/bot/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pregaoId,
            itemNum,
            valorInicial,
            valorLimiteMinimo,
            tipoDecremento,
            valorDecremento,
            intervaloMs,
            isRealMode,
            token,
            cookie,
            biddingStrategy,
            modoAntiDetecao
          })
        });

        const data = await res.json();
        if (res.ok) {
          setIsBotOn(true);
          pushLog(data.message || "Robô de lances iniciado com sucesso no servidor!", "success");
        } else {
          pushLog(`❌ Erro do servidor ao ligar robô: ${data.error}`, "warning");
        }
      } catch (e: any) {
        pushLog(`❌ Falha na conexão com o servidor de lances: ${e.message}`, "warning");
      }
    } else {
      // Stop the server-side bot
      try {
        const res = await fetch("/api/bot/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pregaoId, itemNum })
        });

        const data = await res.json();
        if (res.ok) {
          setIsBotOn(false);
          pushLog(data.message || "Robô de lances suspenso no servidor.", "warning");
        } else {
          pushLog(`❌ Erro do servidor ao desligar robô: ${data.error}`, "warning");
        }
      } catch (e: any) {
        pushLog(`❌ Falha de rede ao parar robô: ${e.message}`, "warning");
      }
    }
  };

  const handleClearLogs = () => {
    // If bot is active, don't clear serverside logs but clean frontend states
    setLogs([
      {
        id: `init-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString("pt-BR"),
        type: "system",
        msg: "Terminal limpo. Robô pronto."
      }
    ]);
  };

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      
      {/* Upper overview and informative banners */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 shadow-xs relative overflow-hidden">
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1 md:max-w-2xl">
            <span className="bg-[#FFF0E5] text-[#FF5A00] text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest border border-[#FFD6C2] inline-flex items-center gap-1.5 mb-2">
              <Cpu className="w-3 h-3 animate-spin" />
              mecanismo rpa lances assíncronos
            </span>
            <h2 className="text-xl md:text-2xl font-bold text-[#111827] tracking-tight">
              Robô de Lances Automáticos (Compras.gov.br)
            </h2>
            <p className="text-xs text-[#6B7280] leading-relaxed font-normal">
              Painel operacional moderno para disputas de lances no portal oficial. Ele conjuga os coeficientes
              de inteligência do repositório <strong className="text-[#111827] font-semibold">LanceBot</strong> com as conexões resilientes assíncronas
              do <strong className="text-[#111827] font-semibold">python-comprasnet</strong>.
            </p>
          </div>
          
          {/* Quick Select Edital Context */}
          <div className="bg-[#F9FAFB] border border-[#E5E7EB] p-3.5 rounded-xl flex flex-col gap-1.5 shrink-0 w-full md:w-80 select-none">
            <span className="text-[10px] font-bold text-[#374151] uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#FF5A00]" />
              Importar Margens de Edital:
            </span>
            <select
              value={selectedEditalId}
              onChange={(e) => handleSelectEditalChange(e.target.value)}
              className="bg-white border border-[#D1D5DB] rounded-lg px-2.5 py-1.5 text-xs text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] w-full"
            >
              <option value="">Não importar (Configurar Manual)</option>
              {activeEdital && (
                <option value="active">
                  ★ Edital Ativo em Memória
                </option>
              )}
              {editalHistory.map((item, idx) => {
                const ed = item.analysis || item;
                const org = ed.identificacaoCertame?.orgaoComprador || `Edital #${idx + 1}`;
                return (
                  <option key={item.id || item.timestamp || idx} value={item.id || item.timestamp}>
                    {org.substring(0, 30)}...
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      {/* Main operational Cockpit view */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: CRITICAL CONFIGURATION CONSOLE & STATE CONTROLS */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-5 shadow-xs select-none">
            <h3 className="text-xs font-bold text-[#FF5A00] uppercase tracking-widest flex items-center gap-2 border-b border-[#E5E7EB] pb-3">
              <Sliders className="w-4.5 h-4.5" />
              Parâmetros de Operação
            </h3>

            {/* MODE SWITCHER */}
            <div className="flex bg-[#F3F4F6] p-1 rounded-xl border border-[#E5E7EB] select-none">
              <button
                type="button"
                onClick={() => setIsRealMode(false)}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                  !isRealMode 
                    ? "bg-[#FF5A00] text-white shadow-2xs" 
                    : "text-[#4B5563] hover:text-[#111827] hover:bg-white"
                }`}
              >
                🛡️ Modo Sandbox (Simulado)
              </button>
              <button
                type="button"
                onClick={() => setIsRealMode(true)}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                  isRealMode 
                    ? "bg-rose-600 text-white shadow-2xs" 
                    : "text-[#4B5563] hover:text-[#111827] hover:bg-white"
                }`}
              >
                🚨 Compras.gov.br (Real)
              </button>
            </div>

            {/* REAL PORTAL CREDENTIALS FORM */}
            {isRealMode && (
              <div className="bg-[#FFF5F5] border border-rose-200 rounded-xl p-3 space-y-3 animate-fade-in text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Credenciais da Sessão Compras.gov.br
                  </span>
                  
                  <button
                    type="button"
                    onClick={() => setShowExtGuide(!showExtGuide)}
                    className="text-[10px] font-bold text-[#FF5A00] hover:text-[#E65000] transition-all cursor-pointer bg-[#FFF0E5] px-2 py-0.5 rounded-md border border-[#FFD6C2]"
                  >
                    🔌 {showExtGuide ? "Fechar Tutorial" : "Usar Extensão Chrome"}
                  </button>
                </div>

                {lastSyncedFromExt && (
                  <div className="bg-[#D1FAE5] border border-[#A7F3D0] text-[#065F46] p-2 rounded-lg text-[10px] flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    <strong>✓ Sincronizado automaticamente via Extensão do Chrome às {lastSyncedFromExt}!</strong>
                  </div>
                )}

                {showExtGuide ? (
                  <div className="bg-white dark:bg-[#121212] p-4 rounded-xl border border-[#E5E7EB] dark:border-[#27272A] space-y-4 text-[11px] leading-relaxed text-[#374151] dark:text-zinc-300 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E7EB] dark:border-[#27272A] pb-3">
                      <div>
                        <p className="font-bold text-[#111827] dark:text-zinc-100 text-xs">
                          Instalação Direta da Extensão Chrome (Download em 1-Clique)
                        </p>
                        <p className="text-[10px] text-[#6B7280] dark:text-zinc-400">
                          Não é necessário criar arquivos manualmente! Baixe o pacote compactado e carregue diretamente no seu Chrome.
                        </p>
                      </div>

                      <a
                        href="/api/download-extension"
                        download="lancebot-extensao-horasis.zip"
                        className="inline-flex items-center justify-center gap-2 bg-[#FF5A00] hover:bg-[#E65000] text-white font-bold text-xs px-4 py-2 rounded-lg shadow-sm transition-all shrink-0 active:scale-95 cursor-pointer text-decoration-none"
                      >
                        <Download className="w-4 h-4" />
                        Baixar Extensão (.ZIP Pronto)
                      </a>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-normal">
                      <div className="bg-[#F9FAFB] dark:bg-[#18181B] border border-[#E5E7EB] dark:border-[#27272A] p-3 rounded-lg space-y-1">
                        <span className="font-bold text-[#FF5A00] text-xs font-mono">Passo 1</span>
                        <p className="text-[11px] text-[#111827] dark:text-zinc-200 font-medium">Baixar e Extrair</p>
                        <p className="text-[10px] text-[#6B7280] dark:text-zinc-400">Clique no botão laranja acima para baixar o arquivo <code className="text-[#FF5A00] font-mono">lancebot-extensao.zip</code> e extraia a pasta no seu computador.</p>
                      </div>

                      <div className="bg-[#F9FAFB] dark:bg-[#18181B] border border-[#E5E7EB] dark:border-[#27272A] p-3 rounded-lg space-y-1">
                        <span className="font-bold text-[#FF5A00] text-xs font-mono">Passo 2</span>
                        <p className="text-[11px] text-[#111827] dark:text-zinc-200 font-medium">Abrir Extensões no Chrome</p>
                        <p className="text-[10px] text-[#6B7280] dark:text-zinc-400">No Chrome, digite <code className="text-[#FF5A00] font-mono">chrome://extensions</code> na barra de navegação e ative o botão <strong className="text-[#111827] dark:text-zinc-200">"Modo do desenvolvedor"</strong> no canto superior direito.</p>
                      </div>

                      <div className="bg-[#F9FAFB] dark:bg-[#18181B] border border-[#E5E7EB] dark:border-[#27272A] p-3 rounded-lg space-y-1">
                        <span className="font-bold text-[#FF5A00] text-xs font-mono">Passo 3</span>
                        <p className="text-[11px] text-[#111827] dark:text-zinc-200 font-medium">Carregar sem Compactação</p>
                        <p className="text-[10px] text-[#6B7280] dark:text-zinc-400">Clique em <strong className="text-[#111827] dark:text-zinc-200">"Carregar sem compactação"</strong> e escolha a pasta extraída. A extensão sincronizará seus tokens automaticamente!</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-[#6B7280] leading-relaxed font-normal">
                    O Comprasnet possui segurança anti-bot robusta no login. Você pode colar suas credenciais capturadas manualmente ou instalar nossa <strong>Extensão de Captura Automática</strong> acima para atualizar sua sessão instantaneamente.
                  </p>
                )}

                <div className="space-y-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-[#374151]">
                      Token de Autorização (Bearer ey...)
                    </label>
                    <textarea
                      rows={2}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Cole o cabeçalho Authorization inteiro ou apenas o token JWT (Começa com Bearer...)"
                      className="bg-white border border-[#D1D5DB] rounded-lg p-2 text-[#111827] focus:outline-none focus:ring-1 focus:ring-rose-500 text-[10px] font-mono leading-tight resize-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-[#374151]">
                      Cookie de Sessão (Opcional - JSESSIONID=...)
                    </label>
                    <input
                      type="text"
                      value={cookie}
                      onChange={(e) => setCookie(e.target.value)}
                      placeholder="JSESSIONID=xxxx; ticket=xxxx..."
                      className="bg-white border border-[#D1D5DB] rounded-lg px-2.5 py-1.5 text-[#111827] focus:outline-none focus:ring-1 focus:ring-rose-500 text-[10px] font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Inputs grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              
              {/* ID PREGÃO COMPOSTO */}
              <div className="flex flex-col gap-1.5 col-span-1 md:col-span-2">
                <label className="text-xs font-semibold text-[#374151]">
                  Código do Pregão do Órgão (ID Comprasnet)
                </label>
                <input
                  type="text"
                  value={pregaoId}
                  onChange={(e) => setPregaoId(e.target.value)}
                  placeholder="Ex: 2026110904321"
                  className="bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] text-xs font-mono"
                />
              </div>

              {/* ITEM NUMBER */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#374151]">
                  Número do Item / Lote
                </label>
                <input
                  type="text"
                  value={itemNum}
                  onChange={(e) => setItemNum(e.target.value)}
                  placeholder="Ex: 1"
                  className="bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] text-xs font-mono"
                />
              </div>

              {/* BIDDING TIMING STRATEGY */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#374151] flex items-center gap-1">
                  Estratégia de Tempo & Disparo
                  <span title="Escolha como o robô se comportará na disputa temporal. O modo de 15 segundos evita detecção e cansa psicologicamente os adversários.">
                    <Info className="w-3.5 h-3.5 text-[#FF5A00] cursor-pointer" />
                  </span>
                </label>
                <select
                  value={biddingStrategy}
                  onChange={(e) => setBiddingStrategy(e.target.value as any)}
                  className="bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] text-xs"
                >
                  <option value="cadenciado-15s">⏱️ Cadenciado Recomendado (15s)</option>
                  <option value="imediato">⚡ Reativo Imediato (1.5s)</option>
                  <option value="sniper">🎯 Pressão / Sniper (5s)</option>
                  <option value="personalizado">⚙️ Intervalo Personalizado (Ms)</option>
                </select>
              </div>

              {/* DYNAMIC SCANNING FREQUENCY OR CUSTOM SLIDER */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#374151]">
                  Intervalo Real de Execução
                </label>
                {biddingStrategy === "personalizado" ? (
                  <input
                    type="number"
                    step="100"
                    min="500"
                    value={intervaloMs}
                    onChange={(e) => setIntervaloMs(Number(e.target.value))}
                    placeholder="Ex: 15000"
                    className="bg-white border border-[#FF5A00] rounded-lg px-3 py-2 text-[#FF5A00] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] text-xs font-mono"
                  />
                ) : (
                  <div className="bg-[#F9FAFB] border border-[#E5E7EB] text-[#374151] rounded-lg px-3 py-2 text-xs font-mono flex justify-between items-center">
                    <span>{(intervaloMs / 1000).toFixed(1)} segundos</span>
                    <span className="text-[9px] bg-[#FFF0E5] px-1.5 py-0.5 rounded text-[#FF5A00] font-sans font-bold uppercase tracking-wider">Automático</span>
                  </div>
                )}
              </div>

              {/* VALOR ESTIMADO INICIAL */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#374151]">
                  Mapeado Inicial (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={valorInicial}
                  onChange={(e) => setValorInicial(Number(e.target.value))}
                  className="bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] text-xs font-mono"
                />
              </div>

              {/* VALOR LIMITE MINIMO (SAFETY CEILING) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#374151] flex items-center gap-1">
                  Mínimo Aceitável (R$)
                  <span title="Abaixo disso, o robô interrompe o envio de lances automaticamente.">
                    <Info className="w-3.5 h-3.5 text-[#FF5A00] cursor-pointer" />
                  </span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={valorLimiteMinimo}
                  onChange={(e) => setValorLimiteMinimo(Number(e.target.value))}
                  className="bg-white border border-[#FF5A00] text-[#059669] rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#FF5A00] text-xs font-bold font-mono"
                />
              </div>

              {/* TYPE OF DECREMENT */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#374151]">
                  Metodologia Decremento
                </label>
                <select
                  value={tipoDecremento}
                  onChange={(e) => setTipoDecremento(e.target.value as any)}
                  className="bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] text-xs"
                >
                  <option value="fixo">Valor Fixo (BRL)</option>
                  <option value="percentual">Percentual (%)</option>
                </select>
              </div>

              {/* DECREMENT VALUE */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#374151]">
                  Dimensão Decremento
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={valorDecremento}
                  onChange={(e) => setValorDecremento(Number(e.target.value))}
                  className="bg-white border border-[#D1D5DB] rounded-lg px-3 py-2 text-[#111827] focus:outline-none focus:ring-1 focus:ring-[#FF5A00] text-xs font-mono animate-fade-in"
                />
              </div>

            </div>

            {/* SEGURANÇA & COBERTURA DE LANCES WIDGET */}
            <div className="bg-[#F9FAFB] rounded-xl p-4 border border-[#E5E7EB] space-y-3.5 text-xs">
              <span className="text-[10px] font-bold text-[#FF5A00] uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Módulos de Proteção & Cobertura LanceBot
              </span>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* SAFE COV */}
                <div className="bg-white border border-[#E5E7EB] p-2.5 rounded-lg space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-700 font-bold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Cobertura Ativa
                  </div>
                  <p className="text-[10px] text-[#6B7280] leading-normal">
                    Garante que qualquer lance de concorrente seja coberto com precisão até o limite de R$ {valorLimiteMinimo.toFixed(2)}.
                  </p>
                </div>

                {/* SELF-BID PREVENT */}
                <div className="bg-white border border-[#E5E7EB] p-2.5 rounded-lg space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-700 font-bold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Anti-Autolance
                  </div>
                  <p className="text-[10px] text-[#6B7280] leading-normal">
                    Impede o envio de lances se você já for o atual líder da sala, poupando margem financeira operacional.
                  </p>
                </div>

                {/* HUMAN SIM JITTER TOGGLE */}
                <button
                  type="button"
                  onClick={() => setModoAntiDetecao(!modoAntiDetecao)}
                  className={`text-left bg-white border p-2.5 rounded-lg space-y-1 cursor-pointer transition-all ${
                    modoAntiDetecao ? "border-emerald-500 hover:bg-[#F0FDF4]" : "border-[#E5E7EB] hover:bg-[#F9FAFB]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-[11px] text-[#111827]">
                      <span className={`w-1.5 h-1.5 rounded-full ${modoAntiDetecao ? "bg-emerald-500 animate-ping" : "bg-slate-400"}`} />
                      Simulador Humano
                    </div>
                    <span className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                      modoAntiDetecao ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}>
                      {modoAntiDetecao ? "ATIVADO" : "DESATIVADO"}
                    </span>
                  </div>
                  <p className="text-[10px] text-[#6B7280] leading-normal">
                    Adiciona variação randômica de ±1.5s aos lances para emular operador humano e burlar defesas anti-bot.
                  </p>
                </button>
              </div>
            </div>

            {/* BOT STATE CONTROLLER WITH POWER BUTTON */}
            <div className="bg-[#F9FAFB] rounded-xl p-4.5 border border-[#E5E7EB] space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-full ${
                    isBotOn 
                      ? "bg-emerald-100 text-emerald-700 animate-pulse border border-emerald-300" 
                      : "bg-slate-100 text-slate-500"
                  }`}>
                    <HeartPulse className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#111827] uppercase tracking-wider">
                      {isBotOn ? "ROBÔ EM OPERAÇÃO" : "ROBÔ DESLIGADO"}
                    </p>
                    <p className="text-[10px] text-[#6B7280] font-mono">
                      {isBotOn ? `Acompanhando pregão a cada ${intervaloMs}ms` : "Aguardando partida segura do licitante"}
                    </p>
                  </div>
                </div>

                {/* Switch button UI */}
                <button
                  onClick={toggleBot}
                  className={`w-14 h-7 rounded-full transition-all duration-300 relative focus:outline-none cursor-pointer border ${
                    isBotOn 
                      ? "bg-emerald-600 border-emerald-700 shadow-xs" 
                      : "bg-slate-300 border-slate-400"
                  }`}
                >
                  <span className={`absolute top-[2px] left-[2.5px] w-[21px] h-[21px] rounded-full bg-white transition-all shadow-xs ${
                    isBotOn ? "translate-x-7" : ""
                  }`} />
                </button>
              </div>

              {/* Margem Estourada Visual Warn banner */}
              {margemEstourada && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2 w-full text-red-700 leading-normal animate-shake">
                  <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="text-xs font-normal">
                    <p className="font-bold text-red-900">🚫 Alerta: MARGEM ESTOURADA!</p>
                    <p className="text-[10px] leading-relaxed text-red-700">
                      O menor lance na sala ultrapassou seu valor mínimo limite de R$ {valorLimiteMinimo.toFixed(2)}. 
                      As regras de decremento forçaram o desligamento preventivo do bot.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Simulation utilities */}
            <div className="flex gap-2 justify-between">
              {!isRealMode && (
                <button
                  type="button"
                  onClick={() => {
                    setCompetitorPriceState(p => {
                      const next = Math.round(Math.max(valorLimiteMinimo - 10, p - 8) * 100) / 100;
                      pushLog(`[Simulador Manual]: Concorrente postou uma oferta rápida de R$ ${next.toFixed(2)}`, "competitor");
                      return next;
                    });
                  }}
                  className="bg-white border border-[#D1D5DB] hover:bg-[#F9FAFB] text-[#374151] py-2 px-3 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1 w-full cursor-pointer shadow-2xs"
                >
                  <TrendingDown className="w-3.5 h-3.5 text-[#FF5A00]" />
                  Simular Lance Concorrente
                </button>
              )}
              
              <button
                type="button"
                onClick={handleClearLogs}
                className="bg-white border border-[#D1D5DB] hover:bg-rose-50 hover:border-rose-300 text-[#374151] hover:text-rose-700 py-2 px-3 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1 w-full cursor-pointer shadow-2xs animate-fade-in"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpar Painel Logs
              </button>
            </div>

          </div>

          {/* PYTHON INTEGRATION GUIDE ACCORDING TO SRE REQUEST */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-3 shadow-xs">
            <h4 className="text-xs font-bold text-[#111827] flex items-center gap-2">
              <Terminal className="w-4.5 h-4.5 text-[#FF5A00]" />
              Integração RPA LanceBot Python
            </h4>
            <p className="text-[11px] text-[#6B7280] leading-relaxed font-normal">
              O loop assíncrono desta tela representa perfeitamente o comportamento do nosso arquivo 
              <code className="text-[#FF5A00] font-mono bg-[#F3F4F6] px-1 py-0.5 rounded mx-1">lance_bot.py</code> 
              descartado no repositório. Para acoplar a IA, instancie o script Python mapeando os parâmetros em uma API Fast/Flask RPC ou canal WebSocket.
            </p>
            <div className="bg-[#111827] p-3 rounded-xl border border-[#374151] font-mono text-[9px] text-slate-300 max-h-52 overflow-y-auto select-text leading-tight scrollbar-thin">
              <span className="text-slate-500"># Mapeamento do MVP Python:</span>
              <br />
              <span className="text-blue-400">bot</span> = MotorLancesComprasnet({'{'}
              <br />
              &nbsp;&nbsp;<span className="text-emerald-400">"pregao_id"</span>: <span className="text-amber-400">"{pregaoId}"</span>,
              <br />
              &nbsp;&nbsp;<span className="text-emerald-400">"item_num"</span>: <span className="text-amber-400">"{itemNum}"</span>,
              <br />
              &nbsp;&nbsp;<span className="text-emerald-400">"valor_limite_minimo"</span>: <span className="text-amber-400">{valorLimiteMinimo}</span>,
              <br />
              &nbsp;&nbsp;<span className="text-emerald-400">"tipo_decremento"</span>: <span className="text-amber-400">"{tipoDecremento}"</span>,
              <br />
              &nbsp;&nbsp;<span className="text-emerald-400">"valor_decremento"</span>: <span className="text-amber-400">{valorDecremento}</span>,
              <br />
              &nbsp;&nbsp;<span className="text-emerald-400">"intervalo_ms"</span>: <span className="text-amber-400">{intervaloMs}</span>
              <br />
              {'}'})
              <br />
              <span className="text-purple-400">await</span> <span className="text-blue-400">bot</span>.iniciar_loop()
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: LIVESTREAM GRAPH & LIVE LOGS / CONCIERGE CHATS */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* CHART: VISUAL BID TRACKER */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 space-y-4 shadow-xs select-none">
            <h3 className="text-xs font-bold text-[#111827] uppercase tracking-widest flex items-center gap-2">
              <Clock className="w-4.5 h-4.5 text-[#FF5A00] animate-pulse" />
              Monitoramento Compras.gov (Tempo Real)
            </h3>

            {/* Simulated Live Figures */}
            <div className="grid grid-cols-3 gap-3 border border-[#E5E7EB] p-3 rounded-xl bg-[#F9FAFB] font-mono">
              <div className="text-center">
                <span className="text-[9px] text-[#6B7280] uppercase">Menor Concorrente</span>
                <p className="text-sm font-bold text-[#FF5A00] mt-1">R$ {competitorPriceState.toFixed(2)}</p>
              </div>
              <div className="text-center border-x border-[#E5E7EB]">
                <span className="text-[9px] text-[#6B7280] uppercase">Nossa Oferta</span>
                <p className="text-sm font-bold text-[#059669] mt-1">
                  {ourPriceState ? `R$ ${ourPriceState.toFixed(2)}` : "Aguardando"}
                </p>
              </div>
              <div className="text-center">
                <span className="text-[9px] text-[#6B7280] uppercase">Limite Mínimo</span>
                <p className="text-sm font-bold text-rose-600 mt-1">R$ {valorLimiteMinimo.toFixed(2)}</p>
              </div>
            </div>

            {/* Line chart container */}
            <div className="h-60 w-full bg-white rounded-xl p-1 border border-[#E5E7EB]">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 15, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="sec" name="Temp. (s)" stroke="#6b7280" fontSize={10} angle={-10} offset={2} />
                    <YAxis domain={['auto', 'auto']} stroke="#6b7280" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "8px", color: "#111827" }} />
                    <Legend wrapperStyle={{ fontSize: '10px', marginTop: '10px' }} />
                    
                    {/* Dashed line representing safety minimum margin */}
                    <ReferenceLine y={valorLimiteMinimo} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Mínimo Aceitável', fill: '#dc2626', fontSize: 9, position: 'top' }} />

                    <Line type="monotone" dataKey="Menor Concorrente" stroke="#ea580c" strokeWidth={1.5} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="Nosso Lance" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-[#6B7280] p-5 text-center gap-2 select-none">
                  <Play className="w-8 h-8 text-[#FF5A00] animate-bounce" />
                  <p className="text-xs font-bold text-[#111827]">Painel Gráfico Ocioso</p>
                  <p className="text-[10px] text-[#6B7280] max-w-[280px]">
                    Ligue o switch do Robô de Lances acima p/ estabelecer conexão e traçar o gráfico de concorrência.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* DUAL TERMINAL PANE: CHAT PREGOEIRO & REALTIME LOGS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-auto md:h-72">
            
            {/* TERMINAL 1: REALTIME BOT TELEMETRY LOGS (ENCLOSED DARK CONTAINER) */}
            <div className="bg-[#111827] border border-[#374151] rounded-xl flex flex-col h-full overflow-hidden select-text shadow-xs">
              <div className="bg-[#1F2937] border-b border-[#374151] py-2.5 px-4 flex items-center justify-between select-none shrink-0">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5 font-mono">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  Console Logs RPA
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              </div>
              
              <div ref={logsContainerRef} className="flex-1 overflow-y-auto p-4 space-y-2.5 font-mono text-[10px] md:text-[11px] leading-relaxed select-text">
                {logs.map((lg) => {
                  let color = "text-slate-300";
                  if (lg.type === "competitor") color = "text-amber-400 font-semibold";
                  if (lg.type === "own") color = "text-emerald-400 font-bold";
                  if (lg.type === "warning") color = "text-rose-400 font-extrabold bg-red-950/40 p-1 rounded border border-red-800";
                  if (lg.type === "success") color = "text-orange-300 font-bold";
                  if (lg.type === "chat") color = "text-cyan-300";

                  return (
                    <div key={lg.id} className="flex gap-1.5 items-start">
                      <span className="text-slate-500 select-none">[{lg.timestamp}]</span>
                      <span className={color}>{lg.msg}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* TERMINAL 2: LIVE CHAT FROM PREGOEIRO */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl flex flex-col h-full overflow-hidden shadow-xs">
              <div className="bg-[#F9FAFB] border-b border-[#E5E7EB] py-2.5 px-4 flex items-center justify-between select-none shrink-0">
                <span className="text-[10px] font-bold text-[#FF5A00] uppercase tracking-widest flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-[#FF5A00]" />
                  Chat Oficial do Pregoeiro
                </span>
                <span className="text-[10px] text-[#6B7280] font-mono">Pregão Ativo</span>
              </div>
              
              <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 font-normal text-xs md:text-sm select-text">
                {chatMessages.map((cm) => (
                  <div key={cm.id} className="bg-[#F9FAFB] border border-[#E5E7EB] p-2 px-3 rounded-lg space-y-1">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-bold text-[#FF5A00]">{cm.sender}</span>
                      <span className="text-[#6B7280] font-mono text-[9px]">{cm.time}</span>
                    </div>
                    <p className="text-[#374151] text-xs leading-relaxed">{cm.text}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
